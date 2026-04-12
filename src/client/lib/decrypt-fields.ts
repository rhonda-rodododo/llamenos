/**
 * Decrypt-on-fetch field cache and utilities.
 *
 * Caches decrypted field values keyed by (ciphertext, label) to avoid
 * redundant crypto worker round-trips. Scans API response objects for
 * encrypted field pairs and decrypts them in place.
 *
 * Field convention: `encryptedFoo` (ciphertext) + `fooEnvelopes` (envelopes array)
 * → decrypted value written to `foo`.
 */

import { createDebugLog } from '@/lib/debug-log'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { type CryptoLabel, LABEL_USER_PII } from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import { CryptoWorkerLockedError, cryptoWorker, isWorkerLockedError } from './crypto-worker-client'
import * as keyManager from './key-manager'

const log = createDebugLog('llamenos:decrypt')

/**
 * Decryption diagnostics are enabled in dev builds automatically, OR at
 * runtime by setting `window.LLAMENOS_DEBUG_CRYPTO = true` in DevTools
 * before the next me-refresh. Keeps production clean by default while
 * allowing ad-hoc diagnosis when a user reports silent placeholders.
 */
function decryptDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return false
  return (window as unknown as { LLAMENOS_DEBUG_CRYPTO?: boolean }).LLAMENOS_DEBUG_CRYPTO === true
}

// ---------------------------------------------------------------------------
// Decrypt mismatch notification
// ---------------------------------------------------------------------------

export interface DecryptMismatchInfo {
  field: string
  readerPubkey: string
  envelopePubkeys: string[]
}

type DecryptMismatchHandler = (info: DecryptMismatchInfo) => void

let mismatchHandler: DecryptMismatchHandler | null = null
let mismatchFired = false

/**
 * Register a handler called (at most once per registration) when no envelope
 * matches the reader's pubkey. Resets the fire-once guard, so re-registering
 * re-arms the notification. Pass null to unregister and reset.
 */
export function setOnDecryptMismatch(handler: DecryptMismatchHandler | null): void {
  mismatchHandler = handler
  mismatchFired = false
}

/** Re-arm the fire-once guard so the next mismatch will fire the handler again. */
export function resetMismatchFired(): void {
  mismatchFired = false
}

// ---------------------------------------------------------------------------
// DecryptCache
// ---------------------------------------------------------------------------

/**
 * Simple Map-backed cache keyed by (ciphertext, label).
 * One global singleton is cleared when the key manager locks.
 */
export class DecryptCache {
  private map: Map<string, string> = new Map()

  private key(ciphertext: string, label: string): string {
    return `${label}:${ciphertext}`
  }

  get(ciphertext: string, label: string): string | null {
    return this.map.get(this.key(ciphertext, label)) ?? null
  }

  set(ciphertext: string, label: string, plaintext: string): void {
    this.map.set(this.key(ciphertext, label), plaintext)
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}

/** Global singleton — cleared on key lock via key-manager lock callbacks. */
export const decryptCache = new DecryptCache()

// ---------------------------------------------------------------------------
// Decrypt recovery state
// ---------------------------------------------------------------------------

/** Prevents multiple concurrent decrypt failures from each firing lock. */
let lockFiring = false

/** @internal Reset recovery state, mismatch notification state, and decrypt cache — test-only, do not call in production. */
export function resetDecryptRecoveryState(): void {
  lockFiring = false
  mismatchFired = false
  mismatchHandler = null
  decryptCache.clear()
}

/**
 * Fire keyManager.lock() exactly once per failure batch.
 * Concurrent callers that arrive while the first lock is in-flight are no-ops.
 */
async function fireLockOnce(): Promise<void> {
  if (lockFiring) return
  lockFiring = true
  try {
    await keyManager.lock()
  } finally {
    lockFiring = false
  }
}

/**
 * Attempt to decrypt a single field with retry and recovery.
 *
 * 1. Try decrypt
 * 2. On CryptoWorkerLockedError → fire lock immediately (no retry — key is gone)
 * 3. On timeout/other error → retry once
 * 4. On second failure → probe worker state:
 *    - Worker locked → fire lock (PIN prompt)
 *    - Worker unlocked but decrypt still failing (or isUnlocked itself throws) →
 *      the worker is in a broken state. Reinitialize the worker and fire lock
 *      so the user is forced back through the PIN prompt into a fresh worker.
 *
 * NOTE: callers must ensure they are invoking this only for fields that were
 * encrypted under the given `label`. Mismatching labels on the *same*
 * envelope is a caller bug — not a transient failure — and will reach this
 * function's "broken worker" branch, which is the last line of defence. The
 * primary guard is that `decryptObjectFields` / `resolveEncryptedFields`
 * only scans the fields the caller asked for.
 */
async function decryptFieldWithRecovery(
  ciphertext: string,
  envelope: RecipientEnvelope,
  label: CryptoLabel
): Promise<string | null> {
  const worker = cryptoWorker
  // AAD is derived from the label for domain separation
  const aad = utf8ToBytes(label)

  // First attempt
  try {
    return await worker.decryptEnvelopeField(
      ciphertext,
      envelope.ephemeralPubkey,
      envelope.wrappedKey,
      label,
      aad
    )
  } catch (firstErr) {
    // Known locked — no point retrying, fire lock so PIN prompt appears
    if (isWorkerLockedError(firstErr)) {
      await fireLockOnce()
      return null
    }

    // Transient error — retry once
    try {
      return await worker.decryptEnvelopeField(
        ciphertext,
        envelope.ephemeralPubkey,
        envelope.wrappedKey,
        label,
        aad
      )
    } catch (secondErr) {
      // Both attempts failed.
      if (isWorkerLockedError(secondErr)) {
        await fireLockOnce()
        return null
      }
      // Probe worker state to decide between "genuinely locked" and "broken".
      try {
        const unlocked = await worker.isUnlocked()
        if (!unlocked) {
          await fireLockOnce()
          return null
        }
        // Worker claims unlocked but decrypt still fails. This should not
        // happen during normal operation — reinitialize the worker and force
        // the PIN prompt so the user lands in a clean state.
        if (decryptDebugEnabled()) {
          log('Field decrypt failed but worker is unlocked', {
            label,
            error: secondErr instanceof Error ? secondErr.message : String(secondErr),
          })
        }
        worker.reinitialize()
        await fireLockOnce()
      } catch {
        // isUnlocked itself failed — worker is definitely broken, fire lock
        worker.reinitialize()
        await fireLockOnce()
      }
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// EncryptedFieldRef
// ---------------------------------------------------------------------------

/** Represents a resolved encrypted field pair ready for decryption. */
export interface EncryptedFieldRef {
  /** The destination key on the object, e.g. `"name"` for `encryptedName`. */
  plaintextKey: string
  /** Hex-encoded ciphertext from `encryptedFoo`. */
  ciphertext: string
  /** The matching ECIES envelope for the reader. */
  envelope: RecipientEnvelope
}

// ---------------------------------------------------------------------------
// resolveEncryptedFields
// ---------------------------------------------------------------------------

/**
 * Scan a plain object for encrypted field pairs and return refs.
 *
 * Looks for keys matching `encrypted<Foo>` and a corresponding `<foo>Envelopes`
 * array. Derives `plaintextKey` by stripping the `encrypted` prefix and
 * lower-casing the first character.
 *
 * When `fieldNames` is provided, only those specific encrypted keys are
 * considered — this is REQUIRED whenever an object holds fields encrypted
 * under more than one domain-separation label (e.g. contacts carry both
 * LABEL_CONTACT_SUMMARY and LABEL_CONTACT_PII fields). Calling the scanner
 * without a filter on a multi-label object would attempt to decrypt every
 * encrypted field with the wrong label and fail AEAD authentication.
 *
 * @param obj           Any plain object (API response body, etc.)
 * @param readerPubkey  If provided, only return refs whose envelope matches
 *                      this pubkey. If omitted, returns the first envelope in
 *                      the array for each field.
 * @param fieldNames    If provided, restricts the scan to this exact set of
 *                      encrypted field keys (e.g. `['encryptedDisplayName']`).
 */
export function resolveEncryptedFields(
  obj: Record<string, unknown>,
  readerPubkey?: string,
  fieldNames?: readonly string[]
): EncryptedFieldRef[] {
  const refs: EncryptedFieldRef[] = []
  const allowed = fieldNames ? new Set(fieldNames) : null

  for (const key of Object.keys(obj)) {
    if (!key.startsWith('encrypted')) continue
    if (allowed && !allowed.has(key)) continue

    // encryptedFoo → foo  (strip 'encrypted', lower-case first char)
    const suffix = key.slice('encrypted'.length)
    if (!suffix) continue
    const plaintextKey = suffix.charAt(0).toLowerCase() + suffix.slice(1)
    const envelopesKey = `${plaintextKey}Envelopes`

    const ciphertext = obj[key]
    const envelopes = obj[envelopesKey]

    if (typeof ciphertext !== 'string' || !Array.isArray(envelopes) || envelopes.length === 0) {
      continue
    }

    const envelope: RecipientEnvelope | undefined = readerPubkey
      ? (envelopes as RecipientEnvelope[]).find((e) => e.pubkey === readerPubkey)
      : (envelopes[0] as RecipientEnvelope)

    if (!envelope) {
      if (readerPubkey) {
        const envelopePubkeys = (envelopes as RecipientEnvelope[]).map((e) => e.pubkey)
        if (decryptDebugEnabled()) {
          log(`No envelope for reader on field "${key}"`, {
            readerPubkey,
            envelopePubkeys,
          })
        }
        if (!mismatchFired) {
          mismatchFired = true
          // Always log mismatch — this is a security-relevant event (key doesn't
          // match stored envelopes). Per-field debug detail is gated above.
          log(
            `Pubkey/envelope mismatch detected on field "${key}". Reader pubkey does not match any envelope.`
          )
          mismatchHandler?.({ field: key, readerPubkey, envelopePubkeys })
        }
      }
      continue
    }

    refs.push({ plaintextKey, ciphertext, envelope })
  }

  return refs
}

// ---------------------------------------------------------------------------
// decryptObjectFields
// ---------------------------------------------------------------------------

/**
 * Decrypt encrypted field pairs on `obj` in-place, writing plaintext to
 * the corresponding `foo` key. Uses the global `decryptCache` to skip
 * redundant worker calls.
 *
 * When the object contains fields encrypted under multiple domain labels
 * (e.g. a contact has both LABEL_CONTACT_SUMMARY and LABEL_CONTACT_PII
 * fields) the caller MUST pass `fieldNames` to restrict the scan to the
 * fields that belong to the given label — otherwise cross-label decrypt
 * attempts will fail AEAD authentication and trigger the recovery/lock flow.
 *
 * @param obj           Plain object with `encryptedFoo` + `fooEnvelopes` pairs.
 * @param readerPubkey  The current user's x-only public key hex.
 * @param label         Domain separation label (defaults to LABEL_USER_PII).
 * @param fieldNames    Optional list of encrypted field keys to decrypt.
 *                      Required for objects with mixed-label fields.
 * @returns The same object, mutated in place.
 */
export async function decryptObjectFields<T extends Record<string, unknown>>(
  obj: T,
  readerPubkey: string,
  label: CryptoLabel = LABEL_USER_PII,
  fieldNames?: readonly string[]
): Promise<T> {
  const refs = resolveEncryptedFields(obj, readerPubkey, fieldNames)
  if (decryptDebugEnabled() && refs.length > 0) {
    log(
      `trying to decrypt ${refs.length} field(s): label=${label} readerPubkey=${readerPubkey?.slice(0, 12)} fields=${refs.map((r) => r.plaintextKey).join(',')}`
    )
  }
  if (refs.length === 0) return obj

  await Promise.all(
    refs.map(async ({ plaintextKey, ciphertext, envelope }) => {
      // Check cache first
      const cached = decryptCache.get(ciphertext, label)
      if (cached !== null) {
        ;(obj as Record<string, unknown>)[plaintextKey] = cached
        return
      }

      const plaintext = await decryptFieldWithRecovery(ciphertext, envelope, label)
      if (plaintext !== null) {
        decryptCache.set(ciphertext, label, plaintext)
        ;(obj as Record<string, unknown>)[plaintextKey] = plaintext
      } else if (decryptDebugEnabled()) {
        log(`Decryption returned null for "${plaintextKey}"`)
      }
      // If null, field keeps its server placeholder ("[encrypted]")
      // but lock has been fired — PIN prompt will appear
    })
  )

  return obj
}

// ---------------------------------------------------------------------------
// decryptArrayFields
// ---------------------------------------------------------------------------

/**
 * Decrypt encrypted field pairs on every item in an array in-place.
 *
 * When each item contains fields encrypted under multiple domain labels,
 * the caller MUST pass `fieldNames` to restrict the scan (see
 * `decryptObjectFields` for details).
 *
 * @param items         Array of plain objects.
 * @param readerPubkey  The current user's x-only public key hex.
 * @param label         Domain separation label (defaults to LABEL_USER_PII).
 * @param fieldNames    Optional list of encrypted field keys to decrypt.
 * @returns The same array, with each item mutated in place.
 */
/**
 * Decrypt a ciphertext + single envelope (ECIES wrapped key) to plaintext JSON.
 * Returns null on failure. Used for session meta, etc., where the payload is
 * envelope-encrypted JSON outside the standard `encryptedFoo + fooEnvelopes` convention.
 */
export async function decryptEnvelopeJson<T>(
  ciphertext: string,
  envelope: RecipientEnvelope,
  label: CryptoLabel
): Promise<T | null> {
  const cached = decryptCache.get(ciphertext, label)
  if (cached !== null) {
    try {
      return JSON.parse(cached) as T
    } catch {
      return null
    }
  }
  const plaintext = await decryptFieldWithRecovery(ciphertext, envelope, label)
  if (plaintext === null) return null
  decryptCache.set(ciphertext, label, plaintext)
  try {
    return JSON.parse(plaintext) as T
  } catch {
    return null
  }
}

export async function decryptArrayFields<T extends Record<string, unknown>>(
  items: T[],
  readerPubkey: string,
  label: CryptoLabel = LABEL_USER_PII,
  fieldNames?: readonly string[]
): Promise<T[]> {
  await Promise.all(items.map((item) => decryptObjectFields(item, readerPubkey, label, fieldNames)))
  return items
}
