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
 */

import type { Ciphertext } from '@shared/crypto-types'
import { hubFieldAad } from '@shared/lib/hub-field-aad'
import { getHubKeyCryptoKeyForId, getHubKeyForId } from './hub-key-cache'

const NONCE_LEN = 12
const TAG_LEN = 16

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
 * base64, wrong AAD, tampered tag) so the caller can surface a placeholder.
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
 * Callers must tolerate the `undefined` case — pass plaintext to the server
 * as a fallback so the write still succeeds.
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
 * Decrypt a hub-encrypted field. Returns `placeholder` on ANY failure — missing
 * hub key, AEAD auth failure, or null/empty input. Never returns the raw server
 * value; callers must not pass server-sourced plaintext as `placeholder`.
 */
export async function decryptHubField(
  encrypted: string | null | undefined,
  hubId: string,
  recordId: string,
  fieldName: string,
  placeholder = ''
): Promise<string> {
  if (!encrypted) return placeholder
  const hubKey = getHubKeyCryptoKeyForId(hubId)
  if (!hubKey) return placeholder
  const decrypted = await decryptHubFieldAead(encrypted, hubKey, recordId, fieldName)
  return decrypted ?? placeholder
}

/**
 * Raw-bytes accessor kept for the Nostr event decryption path which still
 * needs the 32-byte hub key. Removed once the Nostr path also moves to
 * CryptoKey-only (tracked in `HPKE_MIGRATION_NOTES.md`).
 */
export function getHubKeyRawBytesForLegacyPath(hubId: string): Uint8Array | null {
  return getHubKeyForId(hubId)
}
