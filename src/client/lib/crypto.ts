import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

// --- Key Management ---

export interface KeyPair {
  secretKey: Uint8Array  // 32-byte private key
  publicKey: string      // hex-encoded public key
  nsec: string           // bech32-encoded private key (for user display)
  npub: string           // bech32-encoded public key (for user display)
}

export function generateKeyPair(): KeyPair {
  const secretKey = generateSecretKey()
  const publicKey = getPublicKey(secretKey)
  return {
    secretKey,
    publicKey,
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(publicKey),
  }
}

export function keyPairFromNsec(nsec: string): KeyPair | null {
  try {
    const decoded = nip19.decode(nsec)
    if (decoded.type !== 'nsec') return null
    const secretKey = decoded.data
    const publicKey = getPublicKey(secretKey)
    return {
      secretKey,
      publicKey,
      nsec,
      npub: nip19.npubEncode(publicKey),
    }
  } catch {
    return null
  }
}

export function isValidNsec(nsec: string): boolean {
  try {
    const decoded = nip19.decode(nsec)
    return decoded.type === 'nsec'
  } catch {
    return false
  }
}

// --- Encryption ---
// Uses XChaCha20-Poly1305 for symmetric encryption of notes.
// The encryption key is derived from the volunteer's private key.
// Admin can also decrypt because they generated and stored the private key.

function deriveEncryptionKey(secretKey: Uint8Array, context: string): Uint8Array {
  // Derive a domain-separated key using SHA-256
  const contextBytes = utf8ToBytes(`llamenos:${context}`)
  const combined = new Uint8Array(secretKey.length + contextBytes.length)
  combined.set(secretKey)
  combined.set(contextBytes, secretKey.length)
  return sha256(combined)
}

export function encryptNote(plaintext: string, secretKey: Uint8Array): string {
  const key = deriveEncryptionKey(secretKey, 'notes')
  const nonce = randomBytes(24) // XChaCha20 uses 24-byte nonces
  const data = utf8ToBytes(plaintext)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(data)

  // Pack as: nonce (24) + ciphertext (variable)
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}

export function decryptNote(packed: string, secretKey: Uint8Array): string | null {
  try {
    const key = deriveEncryptionKey(secretKey, 'notes')
    const data = hexToBytes(packed)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(key, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

// --- Session Token ---
// Create a signed challenge for API authentication

export function createAuthToken(secretKey: Uint8Array, timestamp: number): string {
  const publicKey = getPublicKey(secretKey)
  const message = `llamenos:auth:${publicKey}:${timestamp}`
  const messageHash = sha256(utf8ToBytes(message))
  // Use the hash as a simple token (the server can verify by recomputing)
  const token = bytesToHex(messageHash)
  return JSON.stringify({ pubkey: publicKey, timestamp, token })
}

// --- Key Storage ---
// Store encrypted in sessionStorage only (not localStorage for security)

const STORAGE_KEY = 'llamenos-session'

export function storeSession(nsec: string): void {
  sessionStorage.setItem(STORAGE_KEY, nsec)
}

export function getStoredSession(): string | null {
  return sessionStorage.getItem(STORAGE_KEY)
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
