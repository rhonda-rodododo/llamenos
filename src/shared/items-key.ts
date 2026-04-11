/**
 * items_key — per-user key indirection (Tier 1)
 *
 * Inspired by Standard Notes 004. Every per-artifact symmetric key (per-note,
 * per-file, per-message) is wrapped under a single per-user `items_key`. When
 * a Tier 6 classical→PQ migration rotates primitives, only the items_key needs
 * to be re-wrapped per user; the on-disk artifact ciphertext stays byte-
 * identical and the per-artifact inner keys are rewrapped against the new
 * items_key without rewriting any note/file body.
 *
 * Wire format: `items_key` is a non-extractable AES-KW CryptoKey derived from
 * the user's master secret + an integer generation via HMAC-SHA-256. Per-
 * artifact keys are imported as AES-GCM raw bytes, wrapped with AES-KW under
 * items_key, and stored alongside the artifact as opaque bytes.
 *
 * Security properties:
 *   - items_key is non-extractable: raw bytes never leave WebCrypto.
 *   - Wrapping is deterministic given (items_key, inner) — rotation re-wraps
 *     the SAME per-artifact key under the NEW items_key, so the artifact
 *     ciphertext is unchanged.
 *   - Per-artifact AEAD binding (AAD) is the caller's responsibility and is
 *     handled by `LABEL_NOTE_KEY:<noteId>` / file-crypto equivalents.
 */

import { utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * Derive an items_key for the given master secret + generation.
 *
 * The master secret is a 32-byte per-user random value held inside the crypto
 * worker (see `key-store-v3.ts`). Generation is a monotonically-increasing
 * integer; bumping it rotates the items_key without touching any artifact
 * ciphertext.
 *
 * HMAC-SHA-256 is used as a KDF to turn the master secret + generation into
 * 32 bytes of keying material, which is then imported as a non-extractable
 * AES-KW key. Using HMAC-as-KDF (rather than HKDF) is intentional: AES-KW only
 * needs a single uniform 256-bit key, and HMAC with a high-entropy master key
 * is a valid PRF per RFC 2104 — no expand step required.
 */
export async function generateItemsKey(
  userMasterSecret: Uint8Array,
  generation: number
): Promise<CryptoKey> {
  if (userMasterSecret.length !== 32) {
    throw new Error(`items_key master secret must be 32 bytes, got ${userMasterSecret.length}`)
  }
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error(`items_key generation must be a non-negative integer, got ${generation}`)
  }
  const macKey = await crypto.subtle.importKey(
    'raw',
    userMasterSecret.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    /* extractable */ false,
    ['sign']
  )
  const info = utf8ToBytes(`llamenos:items-key:gen-${generation}`)
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, macKey, info.buffer as ArrayBuffer)
  )
  return crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-KW', length: 256 },
    /* extractable */ false,
    ['wrapKey', 'unwrapKey']
  )
}

/**
 * Wrap a 32-byte per-artifact key under the items_key.
 *
 * Returns the 40-byte AES-KW ciphertext (32 + 8-byte integrity check). The
 * caller is responsible for storing the wrapped bytes alongside the artifact
 * and for persisting the items_key generation so unwrap knows which items_key
 * to use.
 *
 * The per-artifact key is imported as AES-GCM for encrypt/decrypt; it is
 * marked extractable so it can be wrapped, but the caller must drop the
 * returned CryptoKey handle after wrapping. Real artifact encrypt/decrypt
 * uses the raw bytes the caller already has.
 */
export async function wrapPerArtifactKey(
  perArtifactKey: Uint8Array,
  itemsKey: CryptoKey
): Promise<Uint8Array> {
  if (perArtifactKey.length !== 32) {
    throw new Error(`per-artifact key must be 32 bytes, got ${perArtifactKey.length}`)
  }
  const inner = await crypto.subtle.importKey(
    'raw',
    perArtifactKey.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt']
  )
  const wrapped = await crypto.subtle.wrapKey('raw', inner, itemsKey, 'AES-KW')
  return new Uint8Array(wrapped)
}

/**
 * Unwrap a wrapped per-artifact key under the items_key and return the raw
 * 32 bytes. Callers typically re-import the bytes as AES-GCM for their
 * artifact cipher.
 *
 * The intermediate unwrapped CryptoKey is marked extractable so we can call
 * `exportKey('raw')` — the caller is responsible for zeroing the returned
 * bytes after use.
 */
export async function unwrapPerArtifactKey(
  wrapped: Uint8Array,
  itemsKey: CryptoKey
): Promise<Uint8Array> {
  const inner = await crypto.subtle.unwrapKey(
    'raw',
    wrapped.buffer as ArrayBuffer,
    itemsKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt']
  )
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', inner))
  return raw
}

/**
 * Rewrap a per-artifact key from an old items_key to a new items_key.
 *
 * This is the core of the items_key indirection: rotating the primitive only
 * requires re-wrapping a single 40-byte blob per artifact, not re-encrypting
 * the artifact body. The artifact ciphertext stays byte-identical across
 * rotation (tested explicitly in items-key.test.ts).
 */
export async function rewrapItemsKey(
  oldWrapped: Uint8Array,
  oldItemsKey: CryptoKey,
  newItemsKey: CryptoKey
): Promise<Uint8Array> {
  const inner = await crypto.subtle.unwrapKey(
    'raw',
    oldWrapped.buffer as ArrayBuffer,
    oldItemsKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt']
  )
  const rewrapped = await crypto.subtle.wrapKey('raw', inner, newItemsKey, 'AES-KW')
  return new Uint8Array(rewrapped)
}
