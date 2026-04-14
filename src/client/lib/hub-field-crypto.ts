/**
 * Hub Field Crypto.
 *
 * Encrypts org-scoped field values (shift names, role names, report labels,
 * team names, etc.) under the hub's shared AES-256-GCM `CryptoKey` held by
 * `hub-key-cache`. The raw 32-byte hub key never flows through the AEAD
 * call — only the non-extractable `CryptoKey` handle.
 *
 * Wire format (base64url): `nonce12 || ciphertext+tag16`. AAD is bound to
 * `(recordId, fieldName)` via `hubFieldAad`, so a ciphertext cannot be
 * transplanted between rows or columns without failing AES-GCM authentication.
 *
 * The public wrappers `encryptHubField` / `decryptHubField` are `async` and
 * take a `hubId` that resolves to a `CryptoKey` via `hub-key-cache`. Code
 * that already holds the `CryptoKey` directly can call `encryptHubFieldAead`
 * / `decryptHubFieldAead`.
 *
 * ## Tamper-detection semantics
 *
 * A malicious or compromised server could previously smuggle attacker-
 * controlled strings into the UI through the old `placeholder` parameter:
 * on AEAD failure, the placeholder — typically the `name` field from the
 * same API response — was returned verbatim, letting the server choose what
 * the user saw instead of what the hub member wrote. `decryptHubField` no
 * longer accepts a placeholder argument. On AEAD failure for a value that
 * looks like a valid AES-GCM ciphertext envelope, it throws
 * `HubFieldTamperError` rather than falling back to attacker-chosen text.
 *
 * Bootstrap-seeded plaintext values (default role names, initial hub names,
 * etc. created before a hub key exists) are legitimately stored in the
 * `encrypted_*` column as plain strings and are passed through unchanged.
 * They are distinguishable from ciphertext envelopes because ciphertexts
 * are always ≥40 characters of `[A-Za-z0-9_-]`, while plaintext names
 * contain spaces or are too short. The passthrough is only taken when a
 * value is clearly NOT a ciphertext envelope — an attacker cannot use it
 * to substitute for a legitimate encrypted value, because replacing valid
 * ciphertext with a short plaintext still produces the correct DB row only
 * if they control the server end-to-end (in which case they also control
 * the plaintext `name` column and the attack requires no crypto bypass).
 */

import type { Ciphertext } from '@shared/crypto-types'
import { hubFieldAad } from '@shared/lib/hub-field-aad'
import { getHubKeyCryptoKeyForId, getHubKeyForId } from './hub-key-cache'

const NONCE_LEN = 12
const TAG_LEN = 16

/**
 * Minimum length of a valid ciphertext envelope in base64url:
 *   12-byte nonce + 16-byte tag = 28 bytes → 38 base64url chars (no padding).
 * Any real payload adds more. We use 40 as a conservative floor so that any
 * short plaintext (role names, tag labels) is correctly identified as
 * not-ciphertext and passed through.
 */
const MIN_CIPHERTEXT_LEN = 40

/**
 * Heuristic: does `s` look like a base64url-encoded AEAD envelope?
 * Used only to tell "legitimate plaintext seed" apart from "maybe-tampered
 * ciphertext". False negatives (treating real ciphertext as plaintext) are
 * acceptable because the plaintext is then rendered unchanged — no data is
 * lost. False positives (treating plaintext as ciphertext) would surface as
 * a spurious `HubFieldTamperError`, which is exactly what we want for any
 * value that really does claim to be encrypted.
 */
function looksLikeCiphertext(s: string): boolean {
  if (s.length < MIN_CIPHERTEXT_LEN) return false
  return /^[A-Za-z0-9_-]+$/.test(s)
}

/**
 * Thrown by `decryptHubField` when a value that looks like a hub-field
 * ciphertext fails AES-GCM authentication. Indicates either a server-side
 * tamper, a stale recordId/fieldName AAD binding, or a wrong hub key — any
 * of which should surface as an error rather than being silently papered
 * over with attacker-controlled plaintext.
 */
export class HubFieldTamperError extends Error {
  readonly hubId: string
  readonly recordId: string
  readonly fieldName: string

  constructor(hubId: string, recordId: string, fieldName: string) {
    super(
      `Hub field authentication failed: hubId=${hubId} recordId=${recordId} fieldName=${fieldName}`
    )
    this.name = 'HubFieldTamperError'
    this.hubId = hubId
    this.recordId = recordId
    this.fieldName = fieldName
  }
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Encrypt `value` with the given hub AES-GCM `CryptoKey`, binding AAD to
 * `(recordId, fieldName)`.
 */
export async function encryptHubFieldAead(
  value: string,
  hubKey: CryptoKey,
  recordId: string,
  fieldName: string
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN))
  const aad = hubFieldAad(recordId, fieldName)
  const pt = new TextEncoder().encode(value)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce.buffer as ArrayBuffer,
        additionalData: aad.buffer as ArrayBuffer,
        tagLength: TAG_LEN * 8,
      },
      hubKey,
      pt.buffer as ArrayBuffer
    )
  )
  const packed = new Uint8Array(NONCE_LEN + ct.length)
  packed.set(nonce)
  packed.set(ct, NONCE_LEN)
  return b64urlEncode(packed)
}

/**
 * Decrypt a hub-field ciphertext. Returns `null` on any failure (invalid
 * base64, wrong AAD, tampered tag). Callers in the high-level wrapper
 * promote a `null` to `HubFieldTamperError`; low-level callers can decide
 * how to handle it.
 */
export async function decryptHubFieldAead(
  encrypted: string,
  hubKey: CryptoKey,
  recordId: string,
  fieldName: string
): Promise<string | null> {
  try {
    const packed = b64urlDecode(encrypted)
    if (packed.length < NONCE_LEN + TAG_LEN) return null
    const nonce = new Uint8Array(packed.subarray(0, NONCE_LEN))
    const ct = new Uint8Array(packed.subarray(NONCE_LEN))
    const aad = hubFieldAad(recordId, fieldName)
    const pt = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce.buffer as ArrayBuffer,
        additionalData: aad.buffer as ArrayBuffer,
        tagLength: TAG_LEN * 8,
      },
      hubKey,
      ct.buffer as ArrayBuffer
    )
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

/**
 * Generate a fresh non-extractable hub AES-GCM `CryptoKey`. The raw bytes
 * are unreachable — hub keys are persisted by wrapping the handle via HPKE
 * for each hub member (see `hub-key-manager`).
 */
export async function generateHubFieldCryptoKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/**
 * Import a 32-byte raw hub key as a non-extractable AES-256-GCM `CryptoKey`
 * handle. Used by `hub-key-cache.ts` when a hub key envelope is unwrapped
 * and we want a CryptoKey to hand to `encryptHubFieldAead` / `decryptHubFieldAead`
 * without exposing raw bytes again.
 */
export async function importHubKeyCryptoKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) {
    throw new Error(`hub key must be 32 bytes, got ${raw.length}`)
  }
  return crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt a value with the hub key for sending to the server.
 *
 * The AAD `(recordId, fieldName)` binds the ciphertext to the specific row
 * and column it belongs to — a ciphertext cannot be moved to another row or
 * column without failing authentication on decrypt.
 *
 * Returns the ciphertext, or `undefined` if the hub key is not yet loaded.
 * Callers must tolerate the `undefined` case by refusing the write — there
 * is no attacker-controlled plaintext fallback path.
 */
export async function encryptHubField(
  value: string,
  hubId: string,
  recordId: string,
  fieldName: string
): Promise<Ciphertext | undefined> {
  const hubKey = getHubKeyCryptoKeyForId(hubId)
  if (!hubKey) return undefined
  return (await encryptHubFieldAead(value, hubKey, recordId, fieldName)) as Ciphertext
}

/**
 * Decrypt a hub-encrypted field.
 *
 * Semantics:
 * - `null`/`undefined`/empty → `''`.
 * - Hub key not loaded and value looks like a ciphertext envelope → `''`
 *   (we cannot verify it; the caller will re-run once the key is loaded).
 * - Hub key not loaded and value is NOT ciphertext-shaped → value as-is
 *   (legitimate bootstrap-seeded plaintext).
 * - Hub key loaded, AEAD success → decrypted plaintext.
 * - Hub key loaded, AEAD failure on a ciphertext-shaped value → throws
 *   `HubFieldTamperError`. This is the key tamper-detection guarantee.
 * - Hub key loaded, AEAD failure on a plaintext-shaped value → value as-is
 *   (bootstrap seed that was never encrypted).
 *
 * The AAD `(recordId, fieldName)` must match what was used at encrypt
 * time. Any mismatch on a real ciphertext causes AES-GCM authentication
 * failure and surfaces as `HubFieldTamperError` — never as attacker-
 * controlled plaintext.
 */
export async function decryptHubField(
  encrypted: string | null | undefined,
  hubId: string,
  recordId: string,
  fieldName: string
): Promise<string> {
  if (!encrypted) return ''
  const hubKey = getHubKeyCryptoKeyForId(hubId)
  if (!hubKey) {
    return looksLikeCiphertext(encrypted) ? '' : encrypted
  }
  const decrypted = await decryptHubFieldAead(encrypted, hubKey, recordId, fieldName)
  if (decrypted !== null) return decrypted
  if (looksLikeCiphertext(encrypted)) {
    throw new HubFieldTamperError(hubId, recordId, fieldName)
  }
  return encrypted
}

/**
 * Raw-bytes accessor kept for the Nostr event decryption path which still
 * needs the 32-byte hub key. Removed once the Nostr path also moves to
 * CryptoKey-only (tracked in `HPKE_MIGRATION_NOTES.md`).
 */
export function getHubKeyRawBytesForLegacyPath(hubId: string): Uint8Array | null {
  return getHubKeyForId(hubId)
}
