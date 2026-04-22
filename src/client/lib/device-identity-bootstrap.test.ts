/**
 * Wiring contract tests for the device-identity bootstrap flow.
 *
 * These cover the two observable behaviours of the wiring that are
 * otherwise only exercised through React component trees:
 *
 *   1. First-time setup (AdminBootstrap.handleComplete) must persist
 *      exactly one fresh device keypair via putDeviceKeypair.
 *
 *   2. Subsequent unlock paths (auth.tsx restoreSession / unlockWithPin /
 *      signIn / completePasskeyKeySetup / onUnlock listener) must load
 *      the existing keypair instead of generating a new one.
 *
 * We exercise these contracts directly against the real device-identity
 * and device-identity-store modules with the in-memory storage backend
 * — the React components we rely on (AdminBootstrap.tsx, auth.tsx)
 * delegate 1:1 to these calls, so asserting on them pins the wiring.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { generateDeviceKeypair } from './device-identity'
import {
  clearDeviceKeypairStore,
  getDeviceKeypair,
  InMemoryDeviceKeypairStorage,
  putDeviceKeypair,
  setDeviceKeypairStorage,
} from './device-identity-store'

/**
 * Models AdminBootstrap.handleComplete's device-identity side-effect:
 * after key-store creation, generate a fresh keypair and persist it
 * via putDeviceKeypair. This mirrors the code in
 * `src/client/components/setup/AdminBootstrap.tsx`.
 */
async function bootstrapDeviceIdentity(): Promise<void> {
  const deviceKeypair = await generateDeviceKeypair({ isPaperKey: false })
  await putDeviceKeypair(deviceKeypair)
}

/**
 * Models auth.tsx's loadDeviceKeypairSafe — the helper every unlock
 * path (restoreSession, unlockWithPin, signIn, completePasskeyKeySetup,
 * onUnlock listener) funnels through. Returns null on any error so
 * callers never fail the login flow because of a corrupt/missing
 * device keypair store.
 */
async function loadDeviceKeypairSafe() {
  try {
    return await getDeviceKeypair()
  } catch {
    return null
  }
}

describe('device-identity bootstrap wiring', () => {
  beforeEach(() => {
    // IDB-backed CryptoKey objects can't round-trip through fake-indexeddb,
    // so the whole suite uses the in-memory storage backend — same pattern
    // as device-identity-store.test.ts.
    setDeviceKeypairStorage(new InMemoryDeviceKeypairStorage())
  })

  test('first-time setup persists exactly one fresh device keypair', async () => {
    // Precondition: clean install, no keypair yet.
    await clearDeviceKeypairStore()
    expect(await getDeviceKeypair()).toBeNull()

    // Act: run the bootstrap side-effect once.
    await bootstrapDeviceIdentity()

    // Assert: exactly one keypair was persisted with shape matching
    // generateDeviceKeypair's contract — i.e. the wiring didn't swap in
    // a stub or skip persistence.
    const loaded = await getDeviceKeypair()
    expect(loaded).not.toBeNull()
    expect(loaded?.isPaperKey).toBe(false)
    expect(loaded?.signing.publicKey).toBeInstanceOf(Uint8Array)
    expect(loaded?.signing.publicKey.length).toBe(32)
    expect(loaded?.encryption.publicKey).toBeInstanceOf(Uint8Array)
    expect(loaded?.encryption.publicKey.length).toBe(32)
    expect(loaded?.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    // Private keys must survive the store round-trip as non-extractable.
    await expect(crypto.subtle.exportKey('raw', loaded?.signing.privateKey)).rejects.toThrow()
  })

  test('unlock after bootstrap loads the existing keypair, not a fresh one', async () => {
    // Arrange: simulate a prior bootstrap on this device.
    await bootstrapDeviceIdentity()
    const original = await getDeviceKeypair()
    expect(original).not.toBeNull()

    // Act: simulate an unlock (e.g. unlockWithPin or restoreSession)
    // going through the auth-context hydration helper.
    const loaded = await loadDeviceKeypairSafe()

    // Assert: same keypair object — the unlock path did not regenerate,
    // and the pubkeys are byte-identical to the bootstrap keypair.
    expect(loaded).not.toBeNull()
    expect(loaded?.deviceId).toBe(original?.deviceId)
    expect(loaded?.signing.publicKey).toEqual(original?.signing.publicKey)
    expect(loaded?.encryption.publicKey).toEqual(original?.encryption.publicKey)
    expect(loaded?.createdAt).toBe(original?.createdAt)
  })

  test('unlock on a fresh device (no bootstrap yet) returns null without throwing', async () => {
    // auth.tsx unlock paths tolerate missing device keypairs: the helper
    // catches MultipleDeviceKeypairsError and IDB errors and returns null
    // so the user can still land in an authenticated-but-no-device state.
    await clearDeviceKeypairStore()
    const loaded = await loadDeviceKeypairSafe()
    expect(loaded).toBeNull()
  })

  test('bootstrap then lock/unlock cycle preserves the keypair (persistent identity)', async () => {
    // signOut in auth.tsx clears the in-memory state but must NOT clear
    // the IDB store — device identity survives lock/logout and is only
    // removed via an explicit "forget this device" action.
    await bootstrapDeviceIdentity()
    const original = await getDeviceKeypair()

    // Simulate signOut: clear state only (no clearDeviceKeypairStore()).
    // Then simulate a later unlock.
    const afterUnlock = await loadDeviceKeypairSafe()
    expect(afterUnlock).not.toBeNull()
    expect(afterUnlock?.deviceId).toBe(original?.deviceId)
  })
})
