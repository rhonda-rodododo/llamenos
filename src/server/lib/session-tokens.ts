import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

const TOKEN_BYTE_LENGTH = 32

/**
 * Generate a cryptographically random opaque session token.
 * Returns base64url-encoded 32 random bytes (43 chars, no padding).
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH)
  crypto.getRandomValues(bytes)
  // base64url: standard base64 + URL-safe substitutions, no padding
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Hash a session token with HMAC-SHA256 for safe DB storage.
 * Uses the HMAC_SECRET env var value passed in as `secret`.
 */
export function hashSessionToken(token: string, secret: string): string {
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(token))
  return bytesToHex(mac)
}

/**
 * Constant-time comparison of a presented token against a stored hash.
 */
export function verifySessionToken(token: string, storedHash: string, secret: string): boolean {
  const computed = hashSessionToken(token, secret)
  if (computed.length !== storedHash.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i)
  }
  return diff === 0
}
