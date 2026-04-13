import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Page } from '@playwright/test'
import { getPublicKey, nip19 } from 'nostr-tools'

/**
 * Pre-compute an encrypted key blob in Node.js (Playwright runtime) and inject
 * it into the browser's localStorage. Uses the same PBKDF2 + XChaCha20-Poly1305
 * format as key-store.ts so the app can decrypt it with the test PIN.
 */
export async function preloadEncryptedKey(page: Page, nsec: string, pin: string): Promise<void> {
  const encoder = new TextEncoder()
  const pinBytes = encoder.encode(pin)
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const keyMaterial = await crypto.subtle.importKey('raw', pinBytes, 'PBKDF2', false, [
    'deriveBits',
  ])
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    keyMaterial,
    256
  )
  const kek = new Uint8Array(derivedBits)

  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const cipher = xchacha20poly1305(kek, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(nsec))

  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
  const pubkey = getPublicKey(decoded.data)
  const hashInput = encoder.encode(`llamenos:keyid:${pubkey}`)
  const pubkeyHashBuf = await crypto.subtle.digest('SHA-256', hashInput)
  const pubkeyHash = bytesToHex(new Uint8Array(pubkeyHashBuf)).slice(0, 16)

  const data = {
    salt: bytesToHex(salt),
    iterations: 600_000,
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
    pubkey: pubkeyHash,
  }

  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: 'llamenos-encrypted-key',
    value: JSON.stringify(data),
  })
}
