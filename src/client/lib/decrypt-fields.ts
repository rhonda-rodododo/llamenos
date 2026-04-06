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

import { LABEL_USER_PII } from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import { cryptoWorker } from './crypto-worker-client'

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
 * @param obj         Any plain object (API response body, etc.)
 * @param readerPubkey  If provided, only return refs whose envelope matches
 *                      this pubkey. If omitted, returns the first envelope in
 *                      the array for each field.
 */
export function resolveEncryptedFields(
  obj: Record<string, unknown>,
  readerPubkey?: string
): EncryptedFieldRef[] {
  const refs: EncryptedFieldRef[] = []

  for (const key of Object.keys(obj)) {
    if (!key.startsWith('encrypted')) continue

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

    if (!envelope) continue

    refs.push({ plaintextKey, ciphertext, envelope })
  }

  return refs
}

// ---------------------------------------------------------------------------
// decryptObjectFields
// ---------------------------------------------------------------------------

/**
 * Decrypt all encrypted field pairs on `obj` in-place, writing plaintext to
 * the corresponding `foo` key. Uses the global `decryptCache` to skip
 * redundant worker calls.
 *
 * @param obj           Plain object with `encryptedFoo` + `fooEnvelopes` pairs.
 * @param readerPubkey  The current user's x-only public key hex.
 * @param label         Domain separation label (defaults to LABEL_USER_PII).
 * @returns The same object, mutated in place.
 */
export async function decryptObjectFields<T extends Record<string, unknown>>(
  obj: T,
  readerPubkey: string,
  label: string = LABEL_USER_PII
): Promise<T> {
  const refs = resolveEncryptedFields(obj, readerPubkey)
  if (refs.length === 0) return obj

  const worker = cryptoWorker

  await Promise.all(
    refs.map(async ({ plaintextKey, ciphertext, envelope }) => {
      // Check cache first
      const cached = decryptCache.get(ciphertext, label)
      if (cached !== null) {
        ;(obj as Record<string, unknown>)[plaintextKey] = cached
        return
      }

      try {
        const plaintext = await worker.decryptEnvelopeField(
          ciphertext,
          envelope.ephemeralPubkey,
          envelope.wrappedKey,
          label
        )
        decryptCache.set(ciphertext, label, plaintext)
        ;(obj as Record<string, unknown>)[plaintextKey] = plaintext
      } catch {
        // Leave field as-is (placeholder value from server)
      }
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
 * @param items         Array of plain objects.
 * @param readerPubkey  The current user's x-only public key hex.
 * @param label         Domain separation label (defaults to LABEL_USER_PII).
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
  label: string
): Promise<T | null> {
  const cached = decryptCache.get(ciphertext, label)
  if (cached !== null) {
    try {
      return JSON.parse(cached) as T
    } catch {
      return null
    }
  }
  try {
    const plaintext = await cryptoWorker.decryptEnvelopeField(
      ciphertext,
      envelope.ephemeralPubkey,
      envelope.wrappedKey,
      label
    )
    decryptCache.set(ciphertext, label, plaintext)
    return JSON.parse(plaintext) as T
  } catch {
    return null
  }
}

export async function decryptArrayFields<T extends Record<string, unknown>>(
  items: T[],
  readerPubkey: string,
  label: string = LABEL_USER_PII
): Promise<T[]> {
  await Promise.all(items.map((item) => decryptObjectFields(item, readerPubkey, label)))
  return items
}
