import { schnorr } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { aesGcmDecrypt, aesGcmEncrypt } from '@shared/aes-gcm'

/**
 * Generate a random Nostr keypair for an agent, sealing the nsec under a
 * deploy-level secret key.
 *
 * The seal key is combined with the agentId as HKDF salt so that each agent
 * instance gets a unique derived encryption key — even when multiple agents
 * share the same deploy secret.
 *
 * The sealLabel provides domain separation between agent types so ciphertexts
 * from one agent type cannot be replayed against another.
 *
 * @param agentId   Stable identifier for this agent instance (e.g. connection UUID)
 * @param sealKey   Hex-encoded 32-byte deploy secret
 * @param sealLabel Domain separation constant (from crypto-labels.ts)
 * @returns pubkey (hex x-only) and encryptedNsec (hex nonce || ciphertext)
 */
export async function generateAgentKeypair(
  agentId: string,
  sealKey: string,
  sealLabel: string
): Promise<{ pubkey: string; encryptedNsec: string }> {
  // Generate random keypair
  const nsecBytes = schnorr.utils.randomSecretKey()
  const pubkeyBytes = schnorr.getPublicKey(nsecBytes)
  const pubkey = bytesToHex(pubkeyBytes)
  const nsecHex = bytesToHex(nsecBytes)

  // Derive per-agent seal key via HKDF
  const sealKeyBytes = hexToBytes(sealKey)
  const derivedKey = hkdf(
    sha256,
    sealKeyBytes,
    new TextEncoder().encode(agentId),
    new TextEncoder().encode(sealLabel),
    32
  )

  // Encrypt nsec with AES-256-GCM
  const encryptedNsec = await aesGcmEncrypt(
    new TextEncoder().encode(nsecHex),
    derivedKey,
    new Uint8Array(0)
  )

  // Zero nsec from memory
  nsecBytes.fill(0)

  return { pubkey, encryptedNsec }
}

/**
 * Unseal an agent nsec that was previously sealed with generateAgentKeypair.
 *
 * @param agentId        Must match the agentId used during sealing
 * @param encryptedNsec  Hex-encoded nonce || ciphertext blob
 * @param sealKey        Hex-encoded 32-byte deploy secret
 * @param sealLabel      Must match the sealLabel used during sealing
 * @returns Hex-encoded nsec (32 bytes)
 * @throws If authentication tag verification fails (wrong agentId, sealKey, or sealLabel)
 */
export async function unsealAgentNsec(
  agentId: string,
  encryptedNsec: string,
  sealKey: string,
  sealLabel: string
): Promise<string> {
  const sealKeyBytes = hexToBytes(sealKey)
  const derivedKey = hkdf(
    sha256,
    sealKeyBytes,
    new TextEncoder().encode(agentId),
    new TextEncoder().encode(sealLabel),
    32
  )

  const decrypted = await aesGcmDecrypt(encryptedNsec, derivedKey, new Uint8Array(0))
  return new TextDecoder().decode(decrypted)
}
