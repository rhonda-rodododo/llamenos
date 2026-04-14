/**
 * Unit tests for the `unlock` branch taxonomy.
 *
 * These tests pin the discriminated `UnlockResult` contract: callers need
 * to distinguish a genuine wrong PIN from transient environment failures
 * (PRF cancelled, IdP session expired, no stored key) so the 3-try
 * lockout budget and key-wipe path is not burned on a correct PIN.
 *
 * Uses bun's process-wide `mock.module` to stub the dependencies of
 * `key-manager.ts` (key-store, auth facade, crypto worker, webauthn,
 * session-capsule). Each test file that uses `mock.module` must restore
 * the real exports in `afterAll` so sibling tests running later in the
 * enumeration order still see genuine behaviour — see
 * `unlock-factors.test.ts` for the canonical pattern this file mirrors.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realAuthFacadeNS from './auth-facade-client'
import * as realCryptoWorkerClientNS from './crypto-worker-client'
import * as realKeyStoreNS from './key-store'
import * as realSessionCapsuleNS from './session-capsule'
import * as realWebauthnNS from './webauthn'

const realAuthFacade = { ...realAuthFacadeNS }
const realCryptoWorkerClient = { ...realCryptoWorkerClientNS }
const realKeyStore = { ...realKeyStoreNS }
const realSessionCapsule = { ...realSessionCapsuleNS }
const realWebauthn = { ...realWebauthnNS }

// ---- Shared mock state ----

type Blob = ReturnType<typeof makeBlob>
let currentBlob: Blob | null = null

function makeBlob(overrides: Partial<{ prfUsed: boolean; idpIssuer: string }> = {}) {
  return {
    version: 2 as const,
    kdf: 'pbkdf2-sha256' as const,
    cipher: 'xchacha20-poly1305' as const,
    salt: 'a'.repeat(64),
    nonce: 'b'.repeat(48),
    ciphertext: 'c'.repeat(80),
    pubkeyHash: 'd'.repeat(32),
    prfUsed: false,
    // Non-synthetic issuer so the IdP branch is exercised.
    idpIssuer: 'real-issuer',
    ...overrides,
  }
}

const mockLoadEncryptedKey = mock(() => currentBlob)

// deriveKEK is pure — the real implementation is fine, but it reads a
// Uint8Array salt. We stub it to a constant 32-byte KEK so the worker mock
// doesn't need to care about real PBKDF2 output.
const mockDeriveKEK = mock(() => new Uint8Array(32).fill(0xaa))

mock.module('./key-store', () => ({
  ...realKeyStore,
  loadEncryptedKey: mockLoadEncryptedKey,
  deriveKEK: mockDeriveKEK,
  // SYNTHETIC_ISSUERS is read as a const — keep the real value so the
  // branch check `isSynthetic = SYNTHETIC_ISSUERS.includes(blob.idpIssuer)`
  // correctly picks the non-synthetic path for our test blobs.
}))

type UserInfoResult = {
  pubkey: string
  nsecSecret: Uint8Array
  pendingRotation: boolean
} | null
const mockGetUserInfo = mock(
  async (): Promise<UserInfoResult> => ({
    pubkey: 'real-pub',
    nsecSecret: new Uint8Array(32).fill(0x11),
    pendingRotation: false,
  })
)
const mockRefreshToken = mock(async () => ({ accessToken: 'tok' }))

mock.module('./auth-facade-client', () => ({
  ...realAuthFacade,
  authFacadeClient: {
    getUserInfo: mockGetUserInfo,
    refreshToken: mockRefreshToken,
    clearAccessToken: mock(() => {}),
    confirmRotation: mock(async () => {}),
  },
}))

// Default: crypto worker returns a valid pubkey (success case).
const mockCryptoUnlock = mock(async (): Promise<string | null> => 'abc123pubkeyhex')
const mockCryptoExportSession = mock(async () => ({
  tokenHex: '00'.repeat(16),
  encryptedNsecHex: '11'.repeat(32),
  capsuleNonceHex: '22'.repeat(12),
}))

mock.module('./crypto-worker-client', () => ({
  ...realCryptoWorkerClient,
  cryptoWorker: {
    unlock: mockCryptoUnlock,
    exportSession: mockCryptoExportSession,
    lock: mock(async () => {}),
    isUnlocked: mock(async () => false),
    reEncrypt: mock(async () => ({ nonce: '00'.repeat(12), ciphertext: '11'.repeat(32) })),
  },
}))

const mockRequestWebAuthnPRF = mock(
  async (): Promise<Uint8Array | null> => new Uint8Array(32).fill(0x42)
)
mock.module('./webauthn', () => ({
  ...realWebauthn,
  requestWebAuthnPRF: mockRequestWebAuthnPRF,
}))

mock.module('./session-capsule', () => ({
  ...realSessionCapsule,
  storeCapsule: mock(async () => {}),
  clearCapsule: mock(async () => {}),
  loadCapsule: mock(async () => null),
  updateAutoLockExpiry: mock(async () => {}),
}))

describe('key-manager unlock — discriminated UnlockResult branches', () => {
  afterAll(() => {
    mock.module('./key-store', () => realKeyStore)
    mock.module('./auth-facade-client', () => realAuthFacade)
    mock.module('./crypto-worker-client', () => realCryptoWorkerClient)
    mock.module('./webauthn', () => realWebauthn)
    mock.module('./session-capsule', () => realSessionCapsule)
  })

  beforeEach(() => {
    mockLoadEncryptedKey.mockClear()
    mockDeriveKEK.mockClear()
    mockGetUserInfo.mockClear()
    mockRefreshToken.mockClear()
    mockCryptoUnlock.mockClear()
    mockRequestWebAuthnPRF.mockClear()
    currentBlob = makeBlob()
    // Defaults that each test can override.
    mockCryptoUnlock.mockImplementation(async () => 'abc123pubkeyhex')
    mockGetUserInfo.mockImplementation(async () => ({
      pubkey: 'real-pub',
      nsecSecret: new Uint8Array(32).fill(0x11),
      pendingRotation: false,
    }))
    mockRequestWebAuthnPRF.mockImplementation(async () => new Uint8Array(32).fill(0x42))
  })

  test('no stored blob returns { ok: false, reason: "no-blob" }', async () => {
    currentBlob = null
    const { unlock } = await import('./key-manager')
    const result = await unlock('123456')
    expect(result).toEqual({ ok: false, reason: 'no-blob' })
  })

  test('IdP getUserInfo null after refresh returns "idp-unavailable"', async () => {
    mockGetUserInfo.mockImplementation(async () => null)
    const { unlock } = await import('./key-manager')
    const result = await unlock('123456')
    expect(result).toEqual({ ok: false, reason: 'idp-unavailable' })
    // Crypto worker must not be called when IdP unavailable — otherwise a
    // hypothetical KEK would be derived and potentially reach the worker.
    expect(mockCryptoUnlock).not.toHaveBeenCalled()
  })

  test('blob.prfUsed=true but PRF returns null → "prf-unavailable" (counter NOT burned)', async () => {
    currentBlob = makeBlob({ prfUsed: true })
    mockRequestWebAuthnPRF.mockImplementation(async () => null)
    const { unlock } = await import('./key-manager')
    const result = await unlock('123456')
    expect(result).toEqual({ ok: false, reason: 'prf-unavailable' })
    // Must not reach the crypto worker — returning wrong-pin here would
    // burn the user's lockout budget on a correct PIN.
    expect(mockCryptoUnlock).not.toHaveBeenCalled()
  })

  test('blob.prfUsed=true and PRF throws → "prf-unavailable"', async () => {
    currentBlob = makeBlob({ prfUsed: true })
    mockRequestWebAuthnPRF.mockImplementation(async () => {
      throw new Error('user cancelled')
    })
    const { unlock } = await import('./key-manager')
    const result = await unlock('123456')
    // requestWebAuthnPRF returning via the catch branch in webauthn.ts
    // resolves to null; a thrown error inside `requestWebAuthnPRF` is
    // caught there and surfaces as null — either way the outer check
    // should produce 'prf-unavailable'.
    expect(result).toEqual({ ok: false, reason: 'prf-unavailable' })
  })

  test('crypto worker returns null → "wrong-pin"', async () => {
    mockCryptoUnlock.mockImplementation(async () => null)
    const { unlock } = await import('./key-manager')
    const result = await unlock('123456')
    expect(result).toEqual({ ok: false, reason: 'wrong-pin' })
  })

  test('crypto worker throws → "wrong-pin"', async () => {
    mockCryptoUnlock.mockImplementation(async () => {
      throw new Error('auth tag mismatch')
    })
    const { unlock } = await import('./key-manager')
    const result = await unlock('123456')
    expect(result).toEqual({ ok: false, reason: 'wrong-pin' })
  })

  test('happy path returns { ok: true, pubkey }', async () => {
    const { unlock } = await import('./key-manager')
    const result = await unlock('123456')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pubkey).toBe('abc123pubkeyhex')
    }
  })

  test('PRF-required happy path passes PRF output into deriveKEK', async () => {
    currentBlob = makeBlob({ prfUsed: true })
    const { unlock } = await import('./key-manager')
    const result = await unlock('123456')
    expect(result.ok).toBe(true)
    // deriveKEK was called with the PRF bytes we returned from the mock.
    expect(mockDeriveKEK).toHaveBeenCalled()
    const calls = mockDeriveKEK.mock.calls as unknown as Array<[{ prfOutput?: Uint8Array }]>
    const args = calls[calls.length - 1]?.[0]
    expect(args?.prfOutput).toBeInstanceOf(Uint8Array)
    expect(args?.prfOutput?.length).toBe(32)
  })
})
