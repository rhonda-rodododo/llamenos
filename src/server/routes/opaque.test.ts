/**
 * Route-level tests for the OPAQUE handlers focused on error handling:
 *   - WASM failure → 500 opaque_protocol_failure
 *   - DB failure   → 500 opaque_storage_failure
 *   - login-state cache at capacity → 429 opaque_start_rate_limited
 *
 * Approach: mutate methods on the real shared `opaqueServer` object in
 * place (saving the originals and restoring in `afterAll`). We *cannot*
 * use `mock.module('../lib/opaque-server', ...)` here because that module
 * only re-exports `opaqueServer` from `src/client/lib/opaque-client`, and
 * bun's `mock.module` leaks across test files — the stub would still be
 * bound by the time `src/client/lib/opaque-client.test.ts` runs later in
 * the suite, breaking its real round-trip. Direct in-place mutation is
 * fully reversible in `afterAll`, so it cannot leak.
 *
 * The cap scenario for the login-state cache is driven by overriding the
 * real cache's max-entries knob (`_test_setMaxEntries`) rather than by
 * mocking `createLoginState`, so the actual throw-path in
 * `login-state-cache.ts` is exercised end-to-end.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'

// ---- Module-level stubs ---------------------------------------------------
//
// `mock.module` for db + opaque-server-setup must run BEFORE the target
// module is imported. Those two are safe to mock at the module boundary
// because they are not re-exported anywhere that another test file would
// observe. `opaque-server` is handled differently (see below).

type DbStub = {
  select: (...args: unknown[]) => unknown
  insert: (...args: unknown[]) => unknown
}

const dbStub: DbStub = {
  select: () => selectChain,
  insert: () => insertChain,
}

type QueryChain = Record<string, unknown>
let selectChain: QueryChain
let insertChain: QueryChain

// Import and capture the real `opaqueServer` object so we can mutate its
// methods in place. This works because `src/server/lib/opaque-server.ts`
// re-exports the same `opaqueServer` const from the client module, so
// *both* the server routes and the client-side round-trip test see the
// same object identity. Mutating methods here affects the routes; the
// afterAll restore puts the real methods back.
const realOpaqueServerModule = await import('../lib/opaque-server')
const { opaqueServer } = realOpaqueServerModule
type OpaqueServerLike = typeof opaqueServer

const originalOpaqueServerMethods: OpaqueServerLike = {
  ...opaqueServer,
}

function installOpaqueServerStubs() {
  opaqueServer.createRegistrationResponse = (async () =>
    'ok-registration-response') as typeof opaqueServer.createRegistrationResponse
  opaqueServer.finishRegistration = (async () =>
    'ok-password-file') as typeof opaqueServer.finishRegistration
  opaqueServer.startLogin = (async () => ({
    state: 'opaque-state',
    message: 'ok-credential-response',
  })) as typeof opaqueServer.startLogin
  opaqueServer.finishLogin = (async () => ({
    sessionKey: new Uint8Array(64),
  })) as typeof opaqueServer.finishLogin
}

function restoreOpaqueServer() {
  for (const key of Object.keys(originalOpaqueServerMethods) as Array<keyof OpaqueServerLike>) {
    ;(opaqueServer as Record<string, unknown>)[key as string] = originalOpaqueServerMethods[key]
  }
}

function resetStubs() {
  installOpaqueServerStubs()

  // Drizzle-like query builder that terminates in an awaited array. The
  // registration/finish path uses insert().values().onConflictDoUpdate(); the
  // login/start path uses select().from().where().limit() which is awaited.
  insertChain = {}
  insertChain.values = () => insertChain
  insertChain.onConflictDoUpdate = async () => undefined

  selectChain = {}
  selectChain.from = () => selectChain
  selectChain.where = () => selectChain
  selectChain.limit = async () => [{ passwordFile: 'stored-password-file' }]

  dbStub.select = () => selectChain
  dbStub.insert = () => insertChain
}
resetStubs()

const realDb = await import('../db')
const realOpaqueServerSetup = await import('../lib/opaque-server-setup')

mock.module('../lib/opaque-server-setup', () => ({
  ...realOpaqueServerSetup,
  getOrCreateServerSetup: async () => 'server-setup-base64',
}))

mock.module('../db', () => ({
  ...realDb,
  getDb: () => dbStub,
}))

// ---- Import the route + the real login-state cache helpers ---------------
//
// We import the real cache module so the cap test exercises the actual
// throw path — only `_test_setMaxEntries` and `_test_resetLoginStateCache`
// are used to set up scenarios.

const opaqueRoute = (await import('./opaque')).default
const { _test_resetLoginStateCache, _test_resetMaxEntries, _test_setMaxEntries } = await import(
  '../lib/login-state-cache'
)

// ---- Test-app factory ----------------------------------------------------

const TEST_PUBKEY = 'ab'.repeat(32)
const TEST_PURPOSE = 'root-kek'
const TEST_CRED_ID = `${TEST_PUBKEY}:${TEST_PURPOSE}`

type OpaqueEnv = {
  Variables: { pubkey: string }
}

function createTestApp() {
  const app = new Hono<OpaqueEnv>()
  app.use('*', async (c, next) => {
    c.set('pubkey', TEST_PUBKEY)
    await next()
  })
  app.route('/opaque', opaqueRoute)
  return app
}

function regStartBody() {
  return {
    purpose: TEST_PURPOSE,
    credentialIdentifier: TEST_CRED_ID,
    registrationRequest: 'fake-registration-request',
  }
}

function loginStartBody() {
  return {
    purpose: TEST_PURPOSE,
    credentialIdentifier: TEST_CRED_ID,
    credentialRequest: 'fake-credential-request',
  }
}

function loginFinishBody(sessionId: string) {
  return {
    sessionId,
    credentialFinalization: 'fake-credential-finalization',
  }
}

function post(app: Hono<OpaqueEnv>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---- Tests ---------------------------------------------------------------

describe('opaque routes — error handling', () => {
  beforeEach(() => {
    resetStubs()
    _test_resetLoginStateCache()
    _test_resetMaxEntries()
  })

  afterEach(() => {
    _test_resetLoginStateCache()
    _test_resetMaxEntries()
  })

  // Restore the shared `opaqueServer` methods to their originals. Without
  // this, `opaque-client.test.ts` (which imports the same shared object)
  // would pick up the stubs and fail its real round-trip. We also re-mock
  // the other module paths with their real modules as a defense-in-depth.
  afterAll(() => {
    restoreOpaqueServer()
    mock.module('../lib/opaque-server-setup', () => realOpaqueServerSetup)
    mock.module('../db', () => realDb)
  })

  test('registration/start happy path returns sessionId + registrationResponse', async () => {
    const app = createTestApp()
    const res = await post(app, '/opaque/registration/start', regStartBody())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sessionId: string; registrationResponse: string }
    expect(typeof json.sessionId).toBe('string')
    expect(json.registrationResponse).toBe('ok-registration-response')
  })

  test('registration/start WASM failure → 500 opaque_protocol_failure', async () => {
    opaqueServer.createRegistrationResponse = async () => {
      throw new Error('wasm boom')
    }
    const app = createTestApp()
    const res = await post(app, '/opaque/registration/start', regStartBody())
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_protocol_failure')
  })

  test('registration/start cache at capacity → 429 opaque_start_rate_limited', async () => {
    _test_setMaxEntries(0)
    const app = createTestApp()
    const res = await post(app, '/opaque/registration/start', regStartBody())
    expect(res.status).toBe(429)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_start_rate_limited')
  })

  test('registration/start still returns 400 on credential mismatch', async () => {
    const app = createTestApp()
    const res = await post(app, '/opaque/registration/start', {
      ...regStartBody(),
      credentialIdentifier: 'someone-else:root-kek',
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_credential_mismatch')
  })

  test('registration/finish DB failure → 500 opaque_storage_failure', async () => {
    // Seed a pending registration state so the handler reaches the DB path.
    const { createLoginState } = await import('../lib/login-state-cache')
    const sessionId = createLoginState({
      flow: 'registration',
      purpose: TEST_PURPOSE,
      userPubkey: TEST_PUBKEY,
      credentialIdentifier: TEST_CRED_ID,
      state: '',
    })
    // Make the insert chain throw at the terminal step.
    const failingInsertChain: Record<string, unknown> = {}
    failingInsertChain.values = () => failingInsertChain
    failingInsertChain.onConflictDoUpdate = async () => {
      throw new Error('db down')
    }
    dbStub.insert = () => failingInsertChain

    const app = createTestApp()
    const res = await post(app, '/opaque/registration/finish', {
      sessionId,
      credentialIdentifier: TEST_CRED_ID,
      registrationUpload: 'ZmFrZS1yZWdpc3RyYXRpb24tdXBsb2Fk',
    })
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_storage_failure')
  })

  test('registration/finish WASM failure → 500 opaque_protocol_failure', async () => {
    const { createLoginState } = await import('../lib/login-state-cache')
    const sessionId = createLoginState({
      flow: 'registration',
      purpose: TEST_PURPOSE,
      userPubkey: TEST_PUBKEY,
      credentialIdentifier: TEST_CRED_ID,
      state: '',
    })
    opaqueServer.finishRegistration = async () => {
      throw new Error('wasm boom')
    }
    const app = createTestApp()
    const res = await post(app, '/opaque/registration/finish', {
      sessionId,
      credentialIdentifier: TEST_CRED_ID,
      registrationUpload: 'ZmFrZS1yZWdpc3RyYXRpb24tdXBsb2Fk',
    })
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_protocol_failure')
  })

  test('login/start WASM failure → 500 opaque_protocol_failure', async () => {
    opaqueServer.startLogin = async () => {
      throw new Error('wasm boom')
    }
    const app = createTestApp()
    const res = await post(app, '/opaque/login/start', loginStartBody())
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_protocol_failure')
  })

  test('login/start DB failure → 500 opaque_storage_failure', async () => {
    const failingSelectChain: Record<string, unknown> = {}
    failingSelectChain.from = () => failingSelectChain
    failingSelectChain.where = () => failingSelectChain
    failingSelectChain.limit = async () => {
      throw new Error('db down')
    }
    dbStub.select = () => failingSelectChain
    const app = createTestApp()
    const res = await post(app, '/opaque/login/start', loginStartBody())
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_storage_failure')
  })

  test('login/start cache at capacity → 429 opaque_start_rate_limited', async () => {
    _test_setMaxEntries(0)
    const app = createTestApp()
    const res = await post(app, '/opaque/login/start', loginStartBody())
    expect(res.status).toBe(429)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_start_rate_limited')
  })

  test('login/finish WASM failure → 500 opaque_protocol_failure', async () => {
    const { createLoginState } = await import('../lib/login-state-cache')
    const sessionId = createLoginState({
      flow: 'login',
      purpose: TEST_PURPOSE,
      userPubkey: TEST_PUBKEY,
      credentialIdentifier: TEST_CRED_ID,
      state: 'opaque-state',
    })
    opaqueServer.finishLogin = async () => {
      throw new Error('wasm boom')
    }
    const app = createTestApp()
    const res = await post(app, '/opaque/login/finish', loginFinishBody(sessionId))
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_protocol_failure')
  })

  test('login/finish invalid session still returns 400', async () => {
    const app = createTestApp()
    const res = await post(
      app,
      '/opaque/login/finish',
      loginFinishBody('00000000-0000-0000-0000-000000000000')
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string; code: string }
    expect(json.code).toBe('opaque_invalid_session')
  })
})
