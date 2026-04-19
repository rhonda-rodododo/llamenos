import { type DeviceKeypair, asEd25519SigningKey, asX25519EncryptionKey } from '@shared/types'

interface GenerateOptions {
  isPaperKey: boolean
}

/**
 * Generate a fresh device keypair with non-extractable private keys.
 * Uses native WebCrypto Ed25519 for signing and X25519 for encryption.
 */
export async function generateDeviceKeypair(opts: GenerateOptions): Promise<DeviceKeypair> {
  const signingPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    /* extractable */ false,
    ['sign', 'verify']
  )) as CryptoKeyPair
  const encryptionPair = (await crypto.subtle.generateKey(
    { name: 'X25519' },
    /* extractable */ false,
    ['deriveBits']
  )) as CryptoKeyPair

  const signingPub = new Uint8Array(await crypto.subtle.exportKey('raw', signingPair.publicKey))
  const encryptionPub = new Uint8Array(
    await crypto.subtle.exportKey('raw', encryptionPair.publicKey)
  )

  return {
    deviceId: crypto.randomUUID(),
    signing: { privateKey: asEd25519SigningKey(signingPair.privateKey), publicKey: signingPub },
    encryption: {
      privateKey: asX25519EncryptionKey(encryptionPair.privateKey),
      publicKey: encryptionPub,
    },
    createdAt: new Date().toISOString(),
    isPaperKey: opts.isPaperKey,
  }
}

/** Convert a raw 32-byte public key to hex string */
export function pubkeyToHex(pubkey: Uint8Array): string {
  return Array.from(pubkey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
