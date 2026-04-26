/**
 * WebCrypto AES-256-GCM symmetric encryption primitives.
 *
 * Wire format: hex(nonce[12] || ciphertext+tag[16])
 * Both Bun and browser runtimes support crypto.subtle — no branching needed.
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

const NONCE_LEN = 12
const TAG_BITS = 128

/**
 * AES-256-GCM encrypt with mandatory AAD binding.
 * Returns hex-encoded: nonce(12 bytes) || ciphertext+tag.
 */
export async function aesGcmEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN))
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce.buffer.slice(
          nonce.byteOffset,
          nonce.byteOffset + nonce.byteLength
        ) as ArrayBuffer,
        additionalData: aad.buffer.slice(
          aad.byteOffset,
          aad.byteOffset + aad.byteLength
        ) as ArrayBuffer,
        tagLength: TAG_BITS,
      },
      cryptoKey,
      plaintext.buffer.slice(
        plaintext.byteOffset,
        plaintext.byteOffset + plaintext.byteLength
      ) as ArrayBuffer
    )
  )
  const packed = new Uint8Array(NONCE_LEN + ct.length)
  packed.set(nonce)
  packed.set(ct, NONCE_LEN)
  return bytesToHex(packed)
}

/**
 * AES-256-GCM decrypt with mandatory AAD binding.
 * Input: hex-encoded nonce(12) || ciphertext+tag.
 * AAD must match what was passed to aesGcmEncrypt.
 */
export async function aesGcmDecrypt(
  packedHex: string,
  key: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const packed = hexToBytes(packedHex)
  const nonce = packed.slice(0, NONCE_LEN)
  const ciphertext = packed.slice(NONCE_LEN)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
  const pt = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer,
      additionalData: aad.buffer.slice(
        aad.byteOffset,
        aad.byteOffset + aad.byteLength
      ) as ArrayBuffer,
      tagLength: TAG_BITS,
    },
    cryptoKey,
    ciphertext.buffer.slice(
      ciphertext.byteOffset,
      ciphertext.byteOffset + ciphertext.byteLength
    ) as ArrayBuffer
  )
  return new Uint8Array(pt)
}
