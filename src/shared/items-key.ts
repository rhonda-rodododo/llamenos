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
 * Wire format: `items_key` is a non-extractable HKDF CryptoKey derived from
 * the user's master secret + an integer generation via HMAC-SHA-256. Each
 * wrap derives a **per-artifact AES-KW subkey** from items_key via HKDF with
 * `info = llamenos:items-key-wrap:<artifactId>`. This binds the wrap to a
 * specific artifact identifier: swapping two wrapped blobs in storage is
 * detected at unwrap time (wrong AES-KW subkey) rather than deferred to the
 * outer artifact AEAD. Two notes with the same items_key are NOT structurally
 * interchangeable.
 *
 * Security properties:
 *   - items_key is non-extractable: raw bytes never leave WebCrypto.
 *   - Wrap is deterministic given (items_key, artifactId, inner) — rotation
 *     re-wraps the SAME per-artifact key under the NEW items_key with the
 *     SAME artifactId, so the artifact ciphertext is unchanged.
 *   - Per-artifact binding is enforced at the wrap layer (HKDF info =
 *     artifactId), in addition to the outer `LABEL_NOTE_KEY:<noteId>` AAD
 *     already applied by note/file crypto.
 */

import { utf8ToBytes } from '@noble/hashes/utils.js'

/** HKDF info prefix for per-artifact wrap subkey derivation. */
const WRAP_INFO_PREFIX = 'llamenos:items-key-wrap:'
/** HKDF salt used for all items-key wrap subkey derivations. */
const WRAP_SALT = utf8ToBytes('llamenos:items-key-wrap:v1')

/**
 * Derive an items_key for the given master secret + generation.
 *
 * The master secret is a 32-byte per-user random value held inside the crypto
 * worker (see `key-store.ts`). Generation is a monotonically-increasing
 * integer; bumping it rotates the items_key without touching any artifact
 * ciphertext.
 *
 * HMAC-SHA-256 is used once as a KDF to turn (master, generation) into 32
 * bytes of keying material. Those bytes are then imported as a non-extractable
 * HKDF CryptoKey — wraps derive a per-artifact AES-KW subkey from this via
 * `deriveKey` with `info = llamenos:items-key-wrap:<artifactId>`.
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
    { name: 'HKDF' },
    /* extractable */ false,
    ['deriveKey']
  )
}

/**
 * Derive a per-artifact AES-KW wrap subkey from the items_key. The subkey is
 * deterministic given (items_key, artifactId) — the same items_key wrapping
 * two different artifactIds produces two *different* AES-KW keys, so a
 * ciphertext wrapped for artifact A cannot be unwrapped as artifact B even
 * under the same items_key.
 */
async function deriveWrapSubkey(itemsKey: CryptoKey, artifactId: string): Promise<CryptoKey> {
  if (artifactId.length === 0) {
    throw new Error('artifactId must be non-empty')
  }
  const info = utf8ToBytes(`${WRAP_INFO_PREFIX}${artifactId}`)
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: WRAP_SALT.buffer as ArrayBuffer,
      info: info.buffer as ArrayBuffer,
    },
    itemsKey,
    { name: 'AES-KW', length: 256 },
    /* extractable */ false,
    ['wrapKey', 'unwrapKey']
  )
}

/**
 * Wrap a 32-byte per-artifact key under the items_key, bound to `artifactId`.
 *
 * Returns the 40-byte AES-KW ciphertext (32 + 8-byte integrity check). The
 * wrap is produced against a per-artifact AES-KW subkey derived from
 * `(itemsKey, artifactId)` via HKDF, so swapping two wrapped blobs in
 * storage fails at unwrap time (wrong subkey) rather than deferring to the
 * outer artifact AEAD.
 *
 * The per-artifact key is imported as AES-GCM for encrypt/decrypt; it is
 * marked extractable so it can be wrapped, but the caller must drop the
 * returned CryptoKey handle after wrapping. Real artifact encrypt/decrypt
 * uses the raw bytes the caller already has.
 */
export async function wrapPerArtifactKey(
  perArtifactKey: Uint8Array,
  itemsKey: CryptoKey,
  artifactId: string
): Promise<Uint8Array> {
  if (perArtifactKey.length !== 32) {
    throw new Error(`per-artifact key must be 32 bytes, got ${perArtifactKey.length}`)
  }
  const wrapSubkey = await deriveWrapSubkey(itemsKey, artifactId)
  const inner = await crypto.subtle.importKey(
    'raw',
    perArtifactKey.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt']
  )
  const wrapped = await crypto.subtle.wrapKey('raw', inner, wrapSubkey, 'AES-KW')
  return new Uint8Array(wrapped)
}

/**
 * Unwrap a wrapped per-artifact key under the items_key and return the raw
 * 32 bytes. Callers typically re-import the bytes as AES-GCM for their
 * artifact cipher.
 *
 * `artifactId` must match the value used at wrap time — a mismatch derives a
 * different AES-KW subkey and `unwrapKey` throws.
 *
 * The intermediate unwrapped CryptoKey is marked extractable so we can call
 * `exportKey('raw')` — the caller is responsible for zeroing the returned
 * bytes after use.
 */
export async function unwrapPerArtifactKey(
  wrapped: Uint8Array,
  itemsKey: CryptoKey,
  artifactId: string
): Promise<Uint8Array> {
  const wrapSubkey = await deriveWrapSubkey(itemsKey, artifactId)
  const inner = await crypto.subtle.unwrapKey(
    'raw',
    wrapped.buffer as ArrayBuffer,
    wrapSubkey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt']
  )
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', inner))
  return raw
}

/**
 * Rewrap a per-artifact key from an old items_key to a new items_key, keeping
 * the same `artifactId` binding on both sides.
 *
 * This is the core of the items_key indirection: rotating the primitive only
 * requires re-wrapping a single 40-byte blob per artifact, not re-encrypting
 * the artifact body. The artifact ciphertext stays byte-identical across
 * rotation (tested explicitly in items-key.test.ts).
 */
export async function rewrapItemsKey(
  oldWrapped: Uint8Array,
  oldItemsKey: CryptoKey,
  newItemsKey: CryptoKey,
  artifactId: string
): Promise<Uint8Array> {
  const oldSubkey = await deriveWrapSubkey(oldItemsKey, artifactId)
  const newSubkey = await deriveWrapSubkey(newItemsKey, artifactId)
  const inner = await crypto.subtle.unwrapKey(
    'raw',
    oldWrapped.buffer as ArrayBuffer,
    oldSubkey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt']
  )
  const rewrapped = await crypto.subtle.wrapKey('raw', inner, newSubkey, 'AES-KW')
  return new Uint8Array(rewrapped)
}
