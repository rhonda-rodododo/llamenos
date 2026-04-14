/**
 * Hub Key Manager
 *
 * Hub-wide symmetric encryption key management. Each hub has a random 32-byte
 * key (the hub PTK) that is HPKE-wrapped individually for each *device* that
 * needs it. On rotation, the old generation key is AES-GCM wrapped under the
 * new key (CLKR chain) so devices can walk back to decrypt historical data.
 *
 * Key lifecycle:
 *   1. Admin generates hub key via generateHubKey()
 *   2. Key is HPKE-wrapped for each device via wrapHubKeyForDevice[s]()
 *   3. Devices fetch their envelope from GET /api/hub/key
 *   4. Devices unwrap with their X25519 private key via unwrapHubKeyForDevice()
 *   5. Hub key encrypts/decrypts hub-scoped data via encryptForHub()/decryptFromHub()
 *   6. On rotation: rotateHubKeyClkr() generates new key, wraps old under new,
 *      HPKE-wraps new key to remaining devices, computes commitment hashes
 */

import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_HUB_KEY_WRAP, LABEL_HUB_PTK_PREV_GEN } from '@shared/crypto-labels'
import { symmetricDecrypt, symmetricEncrypt } from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type { HpkeEnvelope } from '@shared/hpke-envelope'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'

// ---- Random bytes helper ----

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

// ---- Hex helpers ----

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ---- Hub key generation (unchanged) ----

/**
 * Generate a random 32-byte hub key.
 * This is NOT derived from any user key — it's pure random.
 */
export function generateHubKey(): Uint8Array {
  return randomBytes(32)
}

// ---- Hub-scoped symmetric encryption (unchanged) ----

/**
 * Encrypt arbitrary data with the hub key using XChaCha20-Poly1305.
 * Returns hex: nonce(24) + ciphertext.
 * The AAD cryptographically binds the ciphertext to a context (e.g. record id + field name).
 */
export function encryptForHub(plaintext: string, hubKey: Uint8Array, aad: Uint8Array): Ciphertext {
  return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, aad)
}

/**
 * Discriminated result of a strict hub-field decryption attempt.
 *
 * `{ ok: false, reason: 'decrypt_failed' }` is returned for ANY thrown error
 * out of `symmetricDecrypt` — wrong hub key, AEAD tag mismatch (tampering),
 * AAD mismatch, structurally invalid ciphertext, etc. Once the bytes have
 * reached this function and the caller has selected a hub key + AAD to try,
 * we treat every failure as one bucket on purpose: distinguishing
 * "wrong key" from "tag mismatch" client-side is a footgun (it leaks bits
 * about which condition tripped), and the conservative read for a
 * security-sensitive caller is "this opened under the chosen key + AAD or
 * it didn't". Callers that want to retry under a different key are free
 * to do so on `ok: false` without learning *why* it failed.
 */
export type HubDecryptResult = { ok: true; value: string } | { ok: false; reason: 'decrypt_failed' }

/**
 * Strict form of hub-field decryption that returns a discriminated result.
 *
 * A `{ ok: false }` return means the ciphertext failed to open under the
 * given hub key and AAD — possible tampering, wrong key, or AAD mismatch
 * (see `HubDecryptResult` for the rationale on collapsing those cases).
 * Always logs the underlying error via `console.error` so the event is
 * visible during dev/test runs even when callers immediately discard the
 * result. (`vite.config.ts` sets `dropConsole: true` for prod, so the call
 * is dead-code-eliminated from the shipped client bundle — the structured
 * logger replacement is tracked under
 * `docs/superpowers/specs/2026-04-05-logging-infrastructure-design.md`.)
 *
 * Prefer this in any code path that needs to react to a decryption failure
 * (audit alert, sigchain step abort, recovery prompt). Legacy code that
 * just wants a `string | null` should keep using `decryptFromHub`, which
 * delegates to this function.
 */
export function decryptFromHubWithError(
  packed: Ciphertext,
  hubKey: Uint8Array,
  aad: Uint8Array
): HubDecryptResult {
  try {
    return {
      ok: true,
      value: new TextDecoder().decode(symmetricDecrypt(packed, hubKey, aad)),
    }
  } catch (err) {
    // Log every failure — a hub-field that was readable yesterday and is
    // unreadable today is a security event, even if the caller decides to
    // swallow the result. console.error is the established pattern for
    // client-side genuine failures (see `lib/mls/core-crypto-loader.ts`)
    // and is dropped from the shipped production bundle by Vite's
    // `dropConsole: true`, so this stays dev/test-only on disk.
    // biome-ignore lint/suspicious/noConsole: genuine failure in catch — no structured logger available client-side
    console.error('[hub-key-manager] hub-field decryption failed (possible tampering)', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, reason: 'decrypt_failed' }
  }
}

/**
 * Decrypt hub-encrypted data using the hub key.
 *
 * Returns `null` on decryption failure (wrong key, corrupted data, AAD
 * mismatch, etc.). This is the legacy compatibility shim — new code that
 * needs to distinguish success from failure for security-relevant reasons
 * should call `decryptFromHubWithError` directly so the failure isn't
 * silently coalesced into the same value as "no ciphertext yet".
 */
export function decryptFromHub(
  packed: Ciphertext,
  hubKey: Uint8Array,
  aad: Uint8Array
): string | null {
  const result = decryptFromHubWithError(packed, hubKey, aad)
  return result.ok ? result.value : null
}

// ---- Per-device HPKE wrapping (Task 24) ----

/**
 * HPKE-wrap a hub key for a specific device.
 *
 * @param hubKey          The 32-byte hub symmetric key
 * @param deviceEncPubkey Recipient device's X25519 public key (CryptoKey from HPKE KEM)
 * @param deviceId        Stable device identifier (bound in AAD)
 * @param hubId           Hub UUID (bound in AAD)
 */
export async function wrapHubKeyForDevice(
  hubKey: Uint8Array,
  deviceEncPubkey: CryptoKey,
  deviceId: string,
  hubId: string
): Promise<HpkeEnvelope> {
  const aad = buildAad(LABEL_HUB_KEY_WRAP, deviceId, hubId)
  return hpkeSeal(hubKey, deviceEncPubkey, LABEL_HUB_KEY_WRAP, aad)
}

/**
 * Failure handling policy for {@link wrapHubKeyForDevices}.
 *
 * - `'abort'` — every device MUST wrap successfully. A single failure throws
 *   {@link HubKeyWrapError} and the caller discards the new hub key; no
 *   device is half-committed to a generation it cannot decrypt.
 * - `'tolerate'` — failures are logged via `console.error`, excluded from the
 *   result, and the remaining devices still receive their envelope. Only
 *   safe on the revoke path where the caller has already decided some
 *   devices will be intentionally excluded. Throws {@link HubKeyWrapError}
 *   if ALL devices fail (otherwise the result set would be empty and the
 *   new key would have no readers, which is always a bug).
 */
export type WrapFailurePolicy = 'abort' | 'tolerate'

/**
 * Error thrown by {@link wrapHubKeyForDevices} when a wrap cannot produce a
 * safe-to-commit envelope set for the configured policy.
 *
 * `failedDevices` names every device whose HPKE seal rejected the new key
 * (typically: corrupted X25519 pubkey, KEM internal failure, or a CryptoKey
 * handle for a key that is not `deriveBits`-capable). Callers that want to
 * rollback a rotation sigchain entry can use this list to flag the devices
 * that would be excluded.
 */
export class HubKeyWrapError extends Error {
  readonly failedDevices: ReadonlyArray<{ deviceId: string; error: string }>
  readonly hubId: string
  readonly policy: WrapFailurePolicy
  constructor(
    message: string,
    failedDevices: ReadonlyArray<{ deviceId: string; error: string }>,
    hubId: string,
    policy: WrapFailurePolicy
  ) {
    super(message)
    this.name = 'HubKeyWrapError'
    this.failedDevices = failedDevices
    this.hubId = hubId
    this.policy = policy
  }
}

/**
 * HPKE-wrap a hub key for multiple devices in parallel.
 *
 * The failure policy controls whether partial success is acceptable. The
 * default — `'abort'` — is the safe choice for any caller that doesn't have
 * a specific reason to tolerate missing envelopes: if even one device can't
 * receive the new key, we must not commit the rotation, or that device will
 * silently be unable to read hub data going forward. Only callers that are
 * intentionally dropping devices (rotate-on-revoke) should pass `'tolerate'`.
 *
 * `HubKeyWrapError` carries the list of failed devices so the caller can
 * surface a usable UI / rollback a sigchain entry. Logging goes to
 * `console.error` (genuine failure, dropped from the prod bundle by Vite's
 * `dropConsole: true`) rather than `createDebugLog`, which strips to a no-op
 * at build time and would silently hide the condition in production.
 */
export async function wrapHubKeyForDevices(
  hubKey: Uint8Array,
  devices: Array<{ deviceId: string; encPubkey: CryptoKey }>,
  hubId: string,
  failurePolicy: WrapFailurePolicy = 'abort'
): Promise<Array<{ deviceId: string; envelope: HpkeEnvelope }>> {
  const settled = await Promise.allSettled(
    devices.map(async (d) => ({
      deviceId: d.deviceId,
      envelope: await wrapHubKeyForDevice(hubKey, d.encPubkey, d.deviceId, hubId),
    }))
  )

  const results: Array<{ deviceId: string; envelope: HpkeEnvelope }> = []
  const failures: Array<{ deviceId: string; error: string }> = []
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value)
    } else {
      const deviceId = devices[i].deviceId
      const error =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      failures.push({ deviceId, error })
      // biome-ignore lint/suspicious/noConsole: genuine failure in catch — stripped from prod bundle by Vite dropConsole
      console.error('[hub-key-manager] HPKE wrap failed for device', {
        deviceId,
        hubId,
        error,
        policy: failurePolicy,
      })
    }
  }

  if (failures.length > 0 && failurePolicy === 'abort') {
    throw new HubKeyWrapError(
      `HPKE wrapping failed for ${failures.length}/${devices.length} devices in hub ${hubId} — aborting rotation (no partial commit)`,
      failures,
      hubId,
      'abort'
    )
  }

  if (results.length === 0 && devices.length > 0) {
    throw new HubKeyWrapError(
      `HPKE wrapping failed for all ${devices.length} devices in hub ${hubId}`,
      failures,
      hubId,
      failurePolicy
    )
  }

  return results
}

/**
 * Unwrap a hub key from an HPKE envelope using a device's private key.
 *
 * @param envelope         The HpkeEnvelope received from the server
 * @param devicePrivateKey Device's X25519 private key (CryptoKey from HPKE KEM)
 * @param deviceId         The device identifier (must match what was used during wrapping)
 * @param hubId            Hub UUID (must match what was used during wrapping)
 * @returns                The 32-byte hub key
 */
export async function unwrapHubKeyForDevice(
  envelope: HpkeEnvelope,
  devicePrivateKey: CryptoKey,
  deviceId: string,
  hubId: string
): Promise<Uint8Array> {
  const aad = buildAad(LABEL_HUB_KEY_WRAP, deviceId, hubId)
  return hpkeOpen(envelope, devicePrivateKey, LABEL_HUB_KEY_WRAP, aad)
}

// ---- Old-generation AES-GCM wrapping (CLKR chain) ----

/**
 * AES-GCM-256 wrap an old-generation hub key under the new-generation hub key.
 *
 * The AAD binds the ciphertext to the hub and generation transition, preventing
 * an attacker from splicing wrap entries across hubs or generations.
 *
 * @returns Hex string of (12-byte IV || ciphertext+tag)
 */
export async function wrapOldGenUnderNew(
  oldHubKey: Uint8Array,
  newHubKey: Uint8Array,
  hubId: string,
  newGen: number
): Promise<string> {
  const iv = randomBytes(12)
  const aadString = `${LABEL_HUB_PTK_PREV_GEN}:${hubId}:${newGen}`
  const aad = new TextEncoder().encode(aadString)

  const importedKey = await crypto.subtle.importKey(
    'raw',
    newHubKey as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  const ct = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      additionalData: aad as BufferSource,
    },
    importedKey,
    oldHubKey as BufferSource
  )

  const packed = new Uint8Array(12 + ct.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(ct), 12)
  return bytesToHex(packed)
}

/**
 * Unwrap an old-generation hub key from the CLKR chain.
 *
 * @param wrapped  Hex string produced by wrapOldGenUnderNew
 * @param newHubKey The new-generation hub key that was used as the wrapping key
 * @param hubId     Hub UUID (must match wrapping AAD)
 * @param newGen    The new generation number (must match wrapping AAD)
 * @returns         The 32-byte old-generation hub key
 */
export async function unwrapOldGen(
  wrapped: string,
  newHubKey: Uint8Array,
  hubId: string,
  newGen: number
): Promise<Uint8Array> {
  const packed = hexToBytes(wrapped)
  const iv = packed.slice(0, 12)
  const ct = packed.slice(12)
  const aadString = `${LABEL_HUB_PTK_PREV_GEN}:${hubId}:${newGen}`
  const aad = new TextEncoder().encode(aadString)

  const importedKey = await crypto.subtle.importKey(
    'raw',
    newHubKey as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad as BufferSource },
    importedKey,
    ct
  )

  return new Uint8Array(pt)
}

// ---- Generation chain walk ----

export interface GenerationWalkParams {
  currentHubKey: Uint8Array
  currentGen: number
  targetGen: number
  /** Map from generation number to hex-encoded wrap blob (oldGen wrapped under that gen's key) */
  wrapChain: Map<number, string>
  hubId: string
}

/**
 * Walk backwards from currentGen to targetGen, unwrapping at each step.
 *
 * At generation N, the wrap chain entry at key N contains the gen-(N-1) key
 * encrypted under the gen-N key. So we unwrap entry N to get key N-1, then
 * entry N-1 to get key N-2, etc.
 *
 * @throws If targetGen >= currentGen or if any chain entry is missing
 */
export async function walkGenerationChain(params: GenerationWalkParams): Promise<Uint8Array> {
  const { currentGen, targetGen, wrapChain, hubId } = params

  if (targetGen >= currentGen) {
    throw new Error(`targetGen (${targetGen}) must be < currentGen (${currentGen})`)
  }
  if (targetGen < 1) {
    throw new Error('targetGen must be >= 1')
  }

  let key: Uint8Array = new Uint8Array(params.currentHubKey)
  let gen = currentGen

  while (gen > targetGen) {
    const wrappedHex = wrapChain.get(gen)
    if (!wrappedHex) {
      throw new Error(`Missing wrap chain entry for generation ${gen}`)
    }
    key = await unwrapOldGen(wrappedHex, key, hubId, gen)
    gen--
  }

  return key
}

// ---- CLKR rotation (Task 25) ----

export interface HubKeyRotationResult {
  newHubKey: Uint8Array
  newGeneration: number
  oldGenWrappedUnderNew: string // hex
  deviceEnvelopes: Array<{ deviceId: string; envelope: HpkeEnvelope }>
  deviceCommitments: Array<{ deviceId: string; commitmentHash: string }>
}

/**
 * Why the rotation is happening. Drives the {@link WrapFailurePolicy} the
 * rotation passes into `wrapHubKeyForDevices`:
 *
 * - `revoke` — one or more devices were just removed from `remainingDevices`.
 *   The caller has already decided who's in the new generation, so residual
 *   wrap failures on stragglers are tolerable: the new key has at least one
 *   reader and the dropped device was going to lose access anyway.
 *   Maps to `'tolerate'` — partial wrap OK, logged loudly.
 *
 * - `schedule`, `add`, `manual` — every device in `remainingDevices` is
 *   expected to receive the new key. A partial wrap here would silently
 *   lock the failing device out of the new generation. Map to `'abort'`
 *   and let the caller rollback the sigchain entry.
 */
export type RotationReason = 'revoke' | 'schedule' | 'add' | 'manual'

function policyForReason(reason: RotationReason): WrapFailurePolicy {
  return reason === 'revoke' ? 'tolerate' : 'abort'
}

/**
 * Perform a CLKR hub key rotation.
 *
 * Generates a new random hub key, wraps the old key under the new one for
 * chain continuity, HPKE-wraps the new key to each remaining device, and
 * computes per-device commitment hashes for the sigchain entry.
 *
 * `rotationReason` controls the wrap failure policy — non-revoke rotations
 * (`schedule`, `add`, `manual`) abort the whole rotation if any device's
 * HPKE wrap fails, so the caller can rollback instead of half-committing a
 * new generation that locks the failing device out. Revoke rotations
 * tolerate wrap failures for intentionally-excluded devices and still
 * return a valid result for the remaining set. The thrown
 * {@link HubKeyWrapError} carries the failing device list so the caller
 * can surface them in the rollback audit entry.
 *
 * Commitment hash: SHA-256(deviceId || envelope.ct) as hex. This binds the
 * envelope to the device identity without revealing the key material, and is
 * recorded in the hub_ptk_rotate sigchain entry for auditability.
 */
export async function rotateHubKeyClkr(params: {
  hubId: string
  currentHubKey: Uint8Array
  currentGen: number
  remainingDevices: Array<{ deviceId: string; encPubkey: CryptoKey }>
  rotationReason: RotationReason
}): Promise<HubKeyRotationResult> {
  const { hubId, currentHubKey, currentGen, remainingDevices, rotationReason } = params
  const newGen = currentGen + 1

  // 1. Generate new hub key
  const newHubKey = generateHubKey()

  // 2. Wrap old key under new key for chain continuity
  const oldGenWrappedUnderNew = await wrapOldGenUnderNew(currentHubKey, newHubKey, hubId, newGen)

  // 3. HPKE-wrap new key to each remaining device. The failure policy is
  //    derived from the rotation reason: revoke rotations tolerate wrap
  //    failures (some devices may have been intentionally dropped), while
  //    schedule/add/manual rotations abort so the sigchain entry is never
  //    half-committed with a device silently locked out of the new gen.
  const deviceEnvelopes = await wrapHubKeyForDevices(
    newHubKey,
    remainingDevices,
    hubId,
    policyForReason(rotationReason)
  )

  // 4. Compute commitment hashes: SHA-256(deviceId || envelope.ct) as hex
  const deviceCommitments = deviceEnvelopes.map(({ deviceId, envelope }) => {
    const deviceIdBytes = new TextEncoder().encode(deviceId)
    const ctBytes = new TextEncoder().encode(envelope.ct)
    const preimage = new Uint8Array(deviceIdBytes.length + ctBytes.length)
    preimage.set(deviceIdBytes)
    preimage.set(ctBytes, deviceIdBytes.length)
    const hash = sha256(preimage)
    return { deviceId, commitmentHash: bytesToHex(hash) }
  })

  return {
    newHubKey,
    newGeneration: newGen,
    oldGenWrappedUnderNew,
    deviceEnvelopes,
    deviceCommitments,
  }
}

// ---- Rotation cascade planning (Task 26) ----

export interface RotationCascadePlan {
  triggerHub: string
  affectedHubs: string[]
  reason: 'member_removed' | 'device_removed' | 'scheduled' | 'manual'
}

/**
 * Plan which hubs need rotation when a trigger event occurs.
 *
 * Identity function for now — returns only the trigger hub. Future tiers will
 * extend this to walk hub-hierarchy relationships (e.g. when a member is removed
 * from a parent hub, child hubs may also need rotation).
 */
export function planRotationCascade(
  triggerHub: string,
  reason: RotationCascadePlan['reason']
): RotationCascadePlan {
  return {
    triggerHub,
    affectedHubs: [triggerHub],
    reason,
  }
}
