import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { RootKekEnvelopeBundle } from '@shared/schemas/root-kek-envelope'
// Eagerly import the real modules so mock.module factories below can spread
// their exports and only override specific members. Without this, bun's
// process-wide mock.module strips the named exports and breaks sibling test
// files that run later in the enumeration order and rely on those exports
// (e.g. crypto-worker-client.test.ts, panic-wipe.test.ts, recovery-phrase.test.ts).
import * as realCryptoWorkerClientNS from './crypto-worker-client'
import * as realOpaqueClientNS from './opaque-client'
import * as realRecoveryPhraseNS from './recovery-phrase'
import * as realWebauthnNS from './webauthn'

// Snapshot to plain objects at import time. ES module namespaces are live
// bindings — if we used the NS objects directly in the afterAll restore,
// bun's mock.module replacement would have already mutated them to expose
// the mocks. Plain snapshots freeze the real exports.
const realCryptoWorkerClient = { ...realCryptoWorkerClientNS }
const realOpaqueClient = { ...realOpaqueClientNS }
const realRecoveryPhrase = { ...realRecoveryPhraseNS }
const realWebauthn = { ...realWebauthnNS }

// ---- Mocks ----

const mockRootKekUnwrap = mock(async () => {})
const mockRootKekIsLoaded = mock(async () => true)

mock.module('./crypto-worker-client', () => ({
  ...realCryptoWorkerClient,
  cryptoWorker: {
    rootKekUnwrap: mockRootKekUnwrap,
    rootKekIsLoaded: mockRootKekIsLoaded,
    // Stub methods that sibling tests (panic-wipe → wipeKey → lock → cryptoWorker.lock)
    // may traverse under this mock. Kept minimal and no-op.
    lock: mock(async () => {}),
    unlock: mock(async () => null),
    isUnlocked: mock(async () => false),
  },
}))

const mockUnlockPrf = mock(async () => new Uint8Array(32).fill(1))
mock.module('./webauthn', () => ({
  ...realWebauthn,
  unlockPrfFromCredential: mockUnlockPrf,
  PrfUnsupportedError: class PrfUnsupportedError extends Error {},
}))

const mockOpaqueLoginStart = mock(async (_password: string) => ({
  state: 'client-state',
  message: 'start-req',
}))
const mockOpaqueLoginFinish = mock(
  async (_params: { stateBase64: string; password: string; credentialResponseBase64: string }) => ({
    message: 'finish-req',
    sessionKey: new Uint8Array(64).fill(9),
    exportKey: new Uint8Array(64).fill(2),
    serverStaticPk: new Uint8Array(32),
  })
)
mock.module('./opaque-client', () => ({
  ...realOpaqueClient,
  opaqueClient: {
    loginStart: mockOpaqueLoginStart,
    loginFinish: mockOpaqueLoginFinish,
  },
}))

const mockOpaqueLoginStartServer = mock(async (_msg: string) => ({
  loginResponse: 'server-resp',
}))
const mockOpaqueLoginFinishServer = mock(async (_msg: string) => {})
mock.module('./auth-facade-client', () => ({
  authFacadeClient: {
    opaqueLoginStart: mockOpaqueLoginStartServer,
    opaqueLoginFinish: mockOpaqueLoginFinishServer,
  },
}))

const mockDeriveRecoveryPhrase = mock((_phrase: string, _salt: Uint8Array) =>
  new Uint8Array(32).fill(3)
)
mock.module('./recovery-phrase', () => ({
  ...realRecoveryPhrase,
  deriveRecoveryPhraseKekBytes: mockDeriveRecoveryPhrase,
}))

// ---- Bundle factories ----

function makeBundle(
  envelopes: Array<{ factorType: string; factorId: string }>
): RootKekEnvelopeBundle {
  return {
    v: 3,
    userId: '00000000-0000-0000-0000-000000000001',
    rootKeyId: '00000000-0000-0000-0000-000000000002',
    envelopes: envelopes.map((e) => ({
      v: 3,
      factorType: e.factorType as 'prf' | 'opaque' | 'recoveryPhrase' | 'recoveryGroup',
      factorId: e.factorId,
      hkdfSalt: 'aa'.repeat(32),
      wrappedKey: 'bb'.repeat(40),
      createdAt: new Date().toISOString(),
    })),
    createdAt: new Date().toISOString(),
  }
}

let currentBundle: RootKekEnvelopeBundle | null = null

mock.module('./root-kek-store', () => ({
  loadBundleFromIdb: mock(async () => currentBundle),
}))

// ---- Tests ----

describe('runUnlockFactor', () => {
  // Restore the real modules after this file's tests finish so that later
  // test files (e.g. recovery-phrase.test.ts, panic-wipe.test.ts) see the
  // genuine exports instead of our mocks. bun's mock.module is process-global
  // with no built-in undo — we emulate undo by re-mocking with the snapshot.
  afterAll(() => {
    mock.module('./crypto-worker-client', () => realCryptoWorkerClient)
    mock.module('./webauthn', () => realWebauthn)
    mock.module('./recovery-phrase', () => realRecoveryPhrase)
    mock.module('./opaque-client', () => realOpaqueClient)
  })

  beforeEach(() => {
    mockRootKekUnwrap.mockClear()
    mockUnlockPrf.mockClear()
    mockOpaqueLoginStart.mockClear()
    mockOpaqueLoginFinish.mockClear()
    mockDeriveRecoveryPhrase.mockClear()
    currentBundle = makeBundle([
      { factorType: 'prf', factorId: 'cred-a' },
      { factorType: 'recoveryPhrase', factorId: 'phrase-1' },
    ])
  })

  test('PRF factor unwraps the matching envelope', async () => {
    const { runUnlockFactor } = await import('./unlock-factors')
    await runUnlockFactor({ type: 'prf', credentialId: 'cred-a' })
    expect(mockRootKekUnwrap).toHaveBeenCalledTimes(1)
    expect(mockUnlockPrf).toHaveBeenCalledTimes(1)
  })

  test('OPAQUE factor routes to the opaque envelope', async () => {
    currentBundle = makeBundle([
      { factorType: 'opaque', factorId: 'opaque-1' },
      { factorType: 'recoveryPhrase', factorId: 'phrase-1' },
    ])
    const { runUnlockFactor } = await import('./unlock-factors')
    await runUnlockFactor({
      type: 'opaque',
      password: 'horse-battery',
      userIdentifier: 'test-user-pub',
    })
    expect(mockRootKekUnwrap).toHaveBeenCalledTimes(1)
    expect(mockOpaqueLoginStart).toHaveBeenCalledTimes(1)
    expect(mockOpaqueLoginFinish).toHaveBeenCalledTimes(1)
  })

  test('recovery phrase factor derives KEK and unwraps', async () => {
    const { runUnlockFactor } = await import('./unlock-factors')
    await runUnlockFactor({
      type: 'recoveryPhrase',
      phrase: 'test phrase',
      salt: new Uint8Array(32).fill(7),
    })
    expect(mockRootKekUnwrap).toHaveBeenCalledTimes(1)
    expect(mockDeriveRecoveryPhrase).toHaveBeenCalledTimes(1)
  })

  test('recovery group factor uses provided rootKekBytes', async () => {
    currentBundle = makeBundle([
      { factorType: 'recoveryGroup', factorId: 'group-1' },
      { factorType: 'recoveryPhrase', factorId: 'phrase-1' },
    ])
    const { runUnlockFactor } = await import('./unlock-factors')
    const rootKekBytes = new Uint8Array(32).fill(4)
    await runUnlockFactor({ type: 'recoveryGroup', rootKekBytes })
    expect(mockRootKekUnwrap).toHaveBeenCalledTimes(1)
    // Verify bytes were zeroed
    expect(rootKekBytes.every((b) => b === 0)).toBe(true)
  })

  test('no matching envelope throws NoMatchingEnvelopeError', async () => {
    currentBundle = makeBundle([
      { factorType: 'recoveryPhrase', factorId: 'phrase-1' },
      { factorType: 'recoveryPhrase', factorId: 'phrase-2' },
    ])
    const { runUnlockFactor, NoMatchingEnvelopeError } = await import('./unlock-factors')
    await expect(
      runUnlockFactor({ type: 'prf', credentialId: 'cred-missing' })
    ).rejects.toBeInstanceOf(NoMatchingEnvelopeError)
  })

  test('missing bundle throws BundleMissingError', async () => {
    currentBundle = null
    const { runUnlockFactor, BundleMissingError } = await import('./unlock-factors')
    await expect(runUnlockFactor({ type: 'prf' })).rejects.toBeInstanceOf(BundleMissingError)
  })

  test('getAvailableFactorTypes returns empty set when no bundle', async () => {
    currentBundle = null
    const { getAvailableFactorTypes } = await import('./unlock-factors')
    const types = await getAvailableFactorTypes()
    expect(types.size).toBe(0)
  })

  test('getAvailableFactorTypes returns factor types from bundle', async () => {
    currentBundle = makeBundle([
      { factorType: 'prf', factorId: 'cred-a' },
      { factorType: 'recoveryPhrase', factorId: 'phrase-1' },
    ])
    const { getAvailableFactorTypes } = await import('./unlock-factors')
    const types = await getAvailableFactorTypes()
    expect(types.has('prf')).toBe(true)
    expect(types.has('recoveryPhrase')).toBe(true)
    expect(types.has('opaque')).toBe(false)
  })
})
