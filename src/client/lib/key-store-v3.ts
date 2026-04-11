/**
 * Tier 1 key store (v3).
 *
 * Replaces `key-store-v2` (ECIES-era) with an HPKE/AES-GCM design that
 * keeps the hub key as a native non-extractable `CryptoKey` handle and
 * zeroes the X25519 identity raw bytes on lock.
 *
 * Lifecycle:
 *   1. `create({ identityRaw, identityPublic, hubKeyRaw, pin })` wraps both
 *      secrets under a PBKDF2-derived KEK and persists the blob.
 *   2. `unlock(pin)` re-derives the KEK, unwraps hub key into a native
 *      non-extractable CryptoKey, decrypts identity raw bytes into a
 *      closure-held Uint8Array, and returns an `Unlocked` handle.
 *   3. `lock()` zeroes the closure-held identity bytes and drops the hub
 *      key handle. Raw bytes are unreferenced and eligible for GC.
 *   4. `rotatePin(old, new)` re-derives under the new PIN without needing
 *      to recompute the underlying secrets.
 *
 * Non-extractability caveats:
 *   - The hub key is truly non-extractable: unwrapKey returns a CryptoKey
 *     with `extractable: false`.
 *   - The X25519 identity private key is held as raw bytes in a closure
 *     because no Tier 1 target runtime exposes native X25519 wrapKey.
 *     Bytes are zeroed on lock; reach the HPKE suite via the polyfill in
 *     `@hpke/dhkem-x25519`. This gap closes when `crypto.subtle.deriveBits`
 *     ships for X25519 in Bun (see `native-curves-check.ts`).
 */

import { createHpkeSuite } from '@shared/crypto-suite'
import type { AesGcmDataWrap, KdfParams, KeyStorage, StoredKeyBlob } from './key-store-v3-types.js'

const PBKDF2_ITERATIONS = 600_000
const PBKDF2_HASH = 'SHA-256' as const
const KDF_SALT_LEN = 16
const AES_GCM_NONCE_LEN = 12
const AES_GCM_TAG_BITS = 128
const IDENTITY_WRAP_AAD = new TextEncoder().encode('llamenos:key-store-v3:identity')

export class KeyStoreLocked extends Error {
  constructor() {
    super('key-store-v3 is locked')
    this.name = 'KeyStoreLocked'
  }
}

export class KeyStoreMissing extends Error {
  constructor() {
    super('no key-store-v3 blob present — call create() first')
    this.name = 'KeyStoreMissing'
  }
}

export class KeyStoreWrongPin extends Error {
  constructor() {
    super('PIN did not decrypt key-store-v3 blob')
    this.name = 'KeyStoreWrongPin'
  }
}

export interface Unlocked {
  /** Raw 32-byte X25519 private key. Zero-ed on lock. */
  identityPrivateRaw: Uint8Array
  /** X25519 public key bytes (cached). */
  identityPublic: Uint8Array
  /** Non-extractable AES-GCM CryptoKey for the shared hub key. */
  hubKey: CryptoKey
}

export interface CreateParams {
  identityRaw: Uint8Array
  identityPublic: Uint8Array
  hubKeyRaw: Uint8Array
  pin: string
}

async function deriveKek(
  pin: string,
  kdf: KdfParams
): Promise<{ kekEnc: CryptoKey; kekWrap: CryptoKey }> {
  const pinBytes = new TextEncoder().encode(pin)
  const base = await crypto.subtle.importKey(
    'raw',
    pinBytes.buffer as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  )
  const saltBuf = kdf.salt.buffer as ArrayBuffer
  const kekEnc = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuf, iterations: kdf.iterations, hash: kdf.hash },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  const kekWrap = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuf, iterations: kdf.iterations, hash: kdf.hash },
    base,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  )
  return { kekEnc, kekWrap }
}

async function wrapHubKey(rawHub: Uint8Array, kekWrap: CryptoKey): Promise<Uint8Array> {
  // Import raw hub bytes briefly as an extractable AES-GCM key so we can
  // hand them to wrapKey — they never leave this scope unwrapped.
  const temp = await crypto.subtle.importKey(
    'raw',
    rawHub.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  )
  const wrapped = await crypto.subtle.wrapKey('raw', temp, kekWrap, 'AES-KW')
  return new Uint8Array(wrapped)
}

async function unwrapHubKey(wrapped: Uint8Array, kekWrap: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    wrapped.buffer as ArrayBuffer,
    kekWrap,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function wrapIdentity(identityRaw: Uint8Array, kekEnc: CryptoKey): Promise<AesGcmDataWrap> {
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LEN))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce.buffer as ArrayBuffer,
        additionalData: IDENTITY_WRAP_AAD.buffer as ArrayBuffer,
        tagLength: AES_GCM_TAG_BITS,
      },
      kekEnc,
      identityRaw.buffer as ArrayBuffer
    )
  )
  return { nonce, ciphertext }
}

async function unwrapIdentity(wrap: AesGcmDataWrap, kekEnc: CryptoKey): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: wrap.nonce.buffer as ArrayBuffer,
      additionalData: IDENTITY_WRAP_AAD.buffer as ArrayBuffer,
      tagLength: AES_GCM_TAG_BITS,
    },
    kekEnc,
    wrap.ciphertext.buffer as ArrayBuffer
  )
  return new Uint8Array(pt)
}

export class KeyStoreV3 {
  private unlocked: Unlocked | null = null

  constructor(private readonly storage: KeyStorage) {}

  async hasBlob(): Promise<boolean> {
    return (await this.storage.load()) !== null
  }

  isLocked(): boolean {
    return this.unlocked === null
  }

  getUnlocked(): Unlocked {
    if (!this.unlocked) throw new KeyStoreLocked()
    return this.unlocked
  }

  async create(params: CreateParams): Promise<Unlocked> {
    const kdf: KdfParams = {
      name: 'PBKDF2',
      hash: PBKDF2_HASH,
      iterations: PBKDF2_ITERATIONS,
      salt: crypto.getRandomValues(new Uint8Array(KDF_SALT_LEN)),
    }
    const { kekEnc, kekWrap } = await deriveKek(params.pin, kdf)
    const wrappedIdentity = await wrapIdentity(params.identityRaw, kekEnc)
    const wrappedHubKey = await wrapHubKey(params.hubKeyRaw, kekWrap)

    const blob: StoredKeyBlob = {
      version: 3,
      createdAt: Date.now(),
      kdf,
      wrappedIdentity,
      wrappedHubKey,
      identityPublicKey: params.identityPublic,
    }
    await this.storage.save(blob)

    const hubKey = await unwrapHubKey(wrappedHubKey, kekWrap)
    this.unlocked = {
      identityPrivateRaw: new Uint8Array(params.identityRaw),
      identityPublic: new Uint8Array(params.identityPublic),
      hubKey,
    }
    return this.unlocked
  }

  async unlock(pin: string): Promise<Unlocked> {
    const blob = await this.storage.load()
    if (!blob) throw new KeyStoreMissing()
    const { kekEnc, kekWrap } = await deriveKek(pin, blob.kdf)
    let identityRaw: Uint8Array
    let hubKey: CryptoKey
    try {
      identityRaw = await unwrapIdentity(blob.wrappedIdentity, kekEnc)
      hubKey = await unwrapHubKey(blob.wrappedHubKey, kekWrap)
    } catch {
      throw new KeyStoreWrongPin()
    }
    this.unlocked = {
      identityPrivateRaw: identityRaw,
      identityPublic: new Uint8Array(blob.identityPublicKey),
      hubKey,
    }
    return this.unlocked
  }

  lock(): void {
    if (this.unlocked) {
      this.unlocked.identityPrivateRaw.fill(0)
      this.unlocked = null
    }
  }

  async rotatePin(oldPin: string, newPin: string): Promise<void> {
    const blob = await this.storage.load()
    if (!blob) throw new KeyStoreMissing()
    const { kekEnc: oldEnc, kekWrap: oldWrap } = await deriveKek(oldPin, blob.kdf)
    let identityRaw: Uint8Array
    let rawHub: Uint8Array
    try {
      identityRaw = await unwrapIdentity(blob.wrappedIdentity, oldEnc)
      // AES-KW doesn't let us extract the raw bytes of a non-extractable
      // unwrapped key, so we unwrap under AES-KW into an extractable temp
      // key here and re-export — the bytes only exist for the rotation scope.
      const tmpHub = await crypto.subtle.unwrapKey(
        'raw',
        blob.wrappedHubKey.buffer as ArrayBuffer,
        oldWrap,
        'AES-KW',
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )
      rawHub = new Uint8Array(await crypto.subtle.exportKey('raw', tmpHub))
    } catch {
      throw new KeyStoreWrongPin()
    }

    const newKdf: KdfParams = {
      name: 'PBKDF2',
      hash: PBKDF2_HASH,
      iterations: PBKDF2_ITERATIONS,
      salt: crypto.getRandomValues(new Uint8Array(KDF_SALT_LEN)),
    }
    const { kekEnc: newEnc, kekWrap: newWrap } = await deriveKek(newPin, newKdf)
    const wrappedIdentity = await wrapIdentity(identityRaw, newEnc)
    const wrappedHubKey = await wrapHubKey(rawHub, newWrap)

    await this.storage.save({
      ...blob,
      kdf: newKdf,
      wrappedIdentity,
      wrappedHubKey,
    })

    identityRaw.fill(0)
    rawHub.fill(0)
  }

  async wipe(): Promise<void> {
    this.lock()
    await this.storage.clear()
  }
}

/**
 * Convenience: generate a fresh HPKE X25519 keypair for seeding `create()`.
 * Kept here so callers never have to touch the suite directly.
 */
export async function generateIdentityKeyPair(): Promise<{
  privateRaw: Uint8Array
  publicRaw: Uint8Array
}> {
  const suite = createHpkeSuite()
  const kp = (await suite.kem.generateKeyPair()) as CryptoKeyPair
  const privateRaw = new Uint8Array(await suite.kem.serializePrivateKey(kp.privateKey))
  const publicRaw = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))
  return { privateRaw, publicRaw }
}
