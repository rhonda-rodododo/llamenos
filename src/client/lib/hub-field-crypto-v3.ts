/**
 * Hub Field Crypto v3 (Tier 1 HPKE) — module only.
 *
 * Replaces the hand-rolled XChaCha20-Poly1305 path in `hub-field-crypto.ts`
 * with native WebCrypto AES-256-GCM, matching the AEAD used by the HPKE
 * suite. The hub key is a non-extractable `CryptoKey` handle held by
 * `key-store-v3`; raw bytes never flow through the app outside the worker
 * boundary.
 *
 * Wire format (base64url): `nonce12 || ciphertext+tag16`.
 *
 * AAD binding uses `hubFieldAad(recordId, fieldName)` — same helper as v1,
 * so v1 and v3 agree on record/column framing. The crypto inside the
 * envelope is different, so v1 and v3 ciphertexts are not interchangeable;
 * migration 0053 wipes all v1 rows pre-prod.
 *
 * NOTE: This module is NOT wired to call sites in PR-A. Migration of
 * hub-field-crypto.ts call sites (routes, services, query selectors) is
 * deferred to PR-B along with items_key indirection.
 */

import { hubFieldAad } from '@shared/lib/hub-field-aad'

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
 * Encrypt `value` with the hub AES-GCM key, binding AAD to (recordId, fieldName).
 */
export async function encryptHubFieldV3(
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
 * Decrypt a v3 hub-field ciphertext. Returns `null` on any failure (invalid
 * base64, wrong AAD, tampered tag) so the caller can surface a placeholder.
 * The CALLER is responsible for distinguishing v3 ciphertexts from v1 ones —
 * this module is v3-only.
 */
export async function decryptHubFieldV3(
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
 * Generate a fresh non-extractable hub AES-GCM key. Used at hub creation
 * time and hub-key rotation. Raw bytes are intentionally unreachable — the
 * only way to persist is to wrap the handle via HPKE for each member (see
 * `hub-key-manager`).
 */
export async function generateHubKeyV3(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
