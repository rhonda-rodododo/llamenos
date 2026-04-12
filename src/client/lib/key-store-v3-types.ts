/**
 * Types for the Tier 1 key store. Kept in a separate file so they can be
 * imported by both the IDB adapter and the pure-in-memory test adapter
 * without pulling in `idb`.
 */

/**
 * KDF parameters used to derive the KEK from a PIN. Stored with the blob so
 * iteration counts can be raised over time without breaking older devices.
 */
export interface KdfParams {
  name: 'PBKDF2'
  hash: 'SHA-256'
  iterations: number
  salt: Uint8Array
}

/**
 * AES-GCM wrap of a raw-bytes secret. Used for the HPKE X25519 identity
 * private key (which cannot be stored as a native non-extractable CryptoKey
 * under Bun/current browsers — see `native-curves-check.ts`).
 */
export interface AesGcmDataWrap {
  nonce: Uint8Array
  ciphertext: Uint8Array
}

/**
 * Persisted shape. Everything a device needs to re-derive the user's keys
 * after lockdown, assuming the user remembers the PIN.
 *
 * `wrappedHubKey` is AES-KW output — on unlock we unwrap it into a native
 * non-extractable AES-GCM CryptoKey, so the hub key's raw bytes never live
 * in the JS heap.
 *
 * `wrappedIdentity` is AES-GCM ciphertext of 32 raw X25519 private key
 * bytes. We accept a pragmatic non-extractability gap here: while unlocked,
 * the raw bytes are held in a closure and zeroed on lock. When Bun/browsers
 * ship native X25519 deriveBits this path will convert to wrapKey/unwrapKey
 * and gain true non-extractability.
 */
export interface StoredKeyBlob {
  version: 3
  createdAt: number
  kdf: KdfParams
  wrappedIdentity: AesGcmDataWrap
  wrappedHubKey: Uint8Array // raw AES-KW wrap output
  identityPublicKey: Uint8Array // 32 bytes X25519 public, cached for fast access while locked
}

/**
 * Pluggable storage. The real implementation writes to IndexedDB; tests use
 * an in-memory Map so they can run under Bun where IDB is absent.
 */
export interface KeyStorage {
  load(): Promise<StoredKeyBlob | null>
  save(blob: StoredKeyBlob): Promise<void>
  clear(): Promise<void>
}

export function createMemoryKeyStorage(): KeyStorage {
  let blob: StoredKeyBlob | null = null
  return {
    async load() {
      return blob
    },
    async save(b) {
      blob = b
    },
    async clear() {
      blob = null
    },
  }
}
