/**
 * Route-level tests for the OPAQUE handlers focused on error handling:
 *   - WASM failure → 500 opaque_protocol_failure
 *   - DB failure   → 500 opaque_storage_failure
 *   - login-state cache at capacity → 429 opaque_start_rate_limited
 *
 * These tests mock the WASM wrapper, the DB handle, and the login-state
 * cache via `mock.module`. The cap scenario is driven by overriding the
 * real cache's max-entries knob (`_test_setMaxEntries`) rather than by
 * mocking `createLoginState`, so the actual throw-path in
 * `login-state-cache.ts` is exercised end-to-end.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'

// ---- Module-level stubs ---------------------------------------------------
//
// `mock.module` must run BEFORE the target module is imported, so we set up
// the stubs first, then dynamically import `./opaque` inside the test factory.

type OpaqueServerStub = {
  createRegistrationResponse: (args: unknown) => Promise<string>
  finishRegistration: (args: unknown) => Promise<string>
  startLogin: (args: unknown) => Promise<{ state: string; message: string }>
  finishLogin: (args: unknown) => Promise<string>
}

type DbStub = {
  select: (...args: unknown[]) => unknown
  insert: (...args: unknown[]) => unknown
}

// Stable holder objects — fields are mutated in tests, never reassigned,
// so the bindings captured by the route module under `mock.module` stay
// pointed at the current stub implementations.
const opaqueServerStub: OpaqueServerStub = {
  createRegistrationResponse: async () => 'ok-registration-response',
  finishRegistration: async () => 'ok-password-file',
  startLogin: async () => ({ state: 'opaque-state', message: 'ok-credential-response' }),
  finishLogin: async () => 'ok-session-key',
}

const dbStub: DbStub = {
  select: () => selectChain,
  insert: () => insertChain,
}

type QueryChain = Record<string, unknown>
let selectChain: QueryChain
let insertChain: QueryChain

function resetStubs() {
  opaqueServerStub.createRegistrationResponse = async () => 'ok-registration-response'
  opaqueServerStub.finishRegistration = async () => 'ok-password-file'
  opaqueServerStub.startLogin = async () => ({
    state: 'opaque-state',
    message: 'ok-credential-response',
  })
  opaqueServerStub.finishLogin = async () => 'ok-session-key'

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

// Preserve the real modules' other exports so sibling tests that import
// them (e.g. `createDatabase`, `initDb`) keep their bindings. Bun's
// `mock.module` leaks module overrides across test files, so we only
// swap the specific functions opaque.ts depends on.
const realDb = await import('../db')
const realOpaqueServer = await import('../lib/opaque-server')
const realOpaqueServerSetup = await import('../lib/opaque-server-setup')

mock.module('../lib/opaque-server', () => ({
  ...realOpaqueServer,
  opaqueServer: opaqueServerStub,
}))

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

  // Restore real module exports after this file finishes. Bun's `mock.module`
  // leaks module overrides across test files, and `opaqueServer` is actually
  // re-exported from `src/client/lib/opaque-client` — so leaving the stub in
  // place would break `opaque-client.test.ts` when it runs later in the suite.
  afterAll(() => {
    mock.module('../lib/opaque-server', () => realOpaqueServer)
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
    opaqueServerStub.createRegistrationResponse = async () => {
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
    opaqueServerStub.finishRegistration = async () => {
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
    opaqueServerStub.startLogin = async () => {
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
    opaqueServerStub.finishLogin = async () => {
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
