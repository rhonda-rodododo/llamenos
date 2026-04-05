import type { Unloggable } from './logger-types'

/**
 * Branded types for field-level encryption.
 *
 * These types are structurally identical to `string` at runtime but TypeScript
 * treats them as incompatible with plain `string`. This makes it a compile-time
 * error to store plaintext in an encrypted column or read ciphertext without
 * going through the CryptoService.
 *
 * Both types also extend `Unloggable` so the compiler rejects passing them
 * to logger helpers — preventing accidental logging of sensitive data.
 */

/** Encrypted ciphertext — hex-encoded nonce(24) || XChaCha20-Poly1305 ciphertext */
export type Ciphertext = string & { readonly __brand: 'Ciphertext' } & Unloggable

/** HMAC-SHA256 hash — hex-encoded, one-way, cannot be reversed */
export type HmacHash = string & { readonly __brand: 'HmacHash' } & Unloggable
