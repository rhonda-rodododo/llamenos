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

/** Encrypted ciphertext — hex-encoded nonce(12) || AES-256-GCM ciphertext+tag */
export type Ciphertext = string & { readonly __brand: 'Ciphertext' } & Unloggable

/** HMAC-SHA256 hash — hex-encoded, one-way, cannot be reversed */
export type HmacHash = string & { readonly __brand: 'HmacHash' } & Unloggable

// ---------------------------------------------------------------------------
// Session-capsule hex brands
//
// The session-capsule subsystem shuttles several hex strings between the
// crypto worker, IndexedDB, and a cross-tab BroadcastChannel. Making each a
// distinct branded type turns field-swap bugs (e.g. accidentally passing an
// encryptedNsec hex into the capsuleNonce slot) into compile errors instead
// of silent corruption.
//
// `HexString<N>` carries the *expected* hex length in its type parameter.
// That length lives at the type level only — there is no runtime check
// unless you go through `asHex` / `tryHex`, which are the two legitimate
// ways to construct a branded value from an untyped string.
// ---------------------------------------------------------------------------

/**
 * Generic length-tagged hex string. The `N` type parameter records the
 * expected hex-character count — use it via the named aliases below rather
 * than inline.
 */
export type HexString<N extends number = number> = string & {
  readonly __brand: 'HexString'
  readonly __hexLen: N
} & Unloggable

/** 32-byte capsule token (64 hex chars). Main-thread opaque handle. */
export type SessionToken = HexString<64>

/** 12-byte AES-256-GCM nonce (24 hex chars). Used to decrypt the capsule. */
export type CapsuleNonceHex = HexString<24>

/**
 * Variable-length worker-encrypted nsec. Content is AES-256-GCM
 * ciphertext of the nsec hex string. Length is not fixed so it is branded
 * without a length parameter.
 */
export type EncryptedNsecHex = string & {
  readonly __brand: 'EncryptedNsecHex'
} & Unloggable

/** First 16 chars of SHA-256(pubkey). Identity check on the capsule. */
export type PubkeyHash16 = HexString<16>

// ---- Runtime helpers --------------------------------------------------------

const HEX_RE = /^[0-9a-fA-F]*$/

/**
 * Return true if `s` is a hex string. If `length` is provided, also require
 * the hex-character count to match exactly.
 */
export function isHex(s: string, length?: number): boolean {
  if (typeof s !== 'string') return false
  if (length !== undefined && s.length !== length) return false
  return HEX_RE.test(s)
}

/**
 * Construct a `HexString<N>` from `s`, throwing if `s` is not hex of the
 * given length. Intended for call sites that already own the value (e.g.
 * they just ran `bytesToHex(randomBytes(32))`) and want a hard failure on
 * any drift between the expected and actual length.
 */
export function asHex<N extends number>(s: string, length: N): HexString<N> {
  if (!isHex(s, length)) {
    throw new Error(
      `asHex: expected ${length} hex chars, got ${typeof s === 'string' ? s.length : typeof s}`
    )
  }
  return s as HexString<N>
}

/**
 * Construct a `HexString<N>` from `s`, returning null on any mismatch.
 * Intended for untrusted input at boundaries (postMessage, IDB read,
 * BroadcastChannel receive).
 */
export function tryHex<N extends number>(s: unknown, length: N): HexString<N> | null {
  if (typeof s !== 'string') return null
  if (!isHex(s, length)) return null
  return s as HexString<N>
}

// ---- Named constructors for session-capsule brands -------------------------

export const asSessionToken = (s: string): SessionToken => asHex(s, 64)
export const trySessionToken = (s: unknown): SessionToken | null => tryHex(s, 64)

export const asCapsuleNonce = (s: string): CapsuleNonceHex => asHex(s, 24)
export const tryCapsuleNonce = (s: unknown): CapsuleNonceHex | null => tryHex(s, 24)

export const asPubkeyHash16 = (s: string): PubkeyHash16 => asHex(s, 16)
export const tryPubkeyHash16 = (s: unknown): PubkeyHash16 | null => tryHex(s, 16)

/**
 * `EncryptedNsecHex` has no fixed length — the ciphertext size depends on
 * the underlying plaintext size. Validate only that the input is a non-empty
 * hex string.
 */
export function asEncryptedNsec(s: string): EncryptedNsecHex {
  if (typeof s !== 'string' || s.length === 0 || !HEX_RE.test(s)) {
    throw new Error('asEncryptedNsec: expected non-empty hex string')
  }
  return s as EncryptedNsecHex
}

export function tryEncryptedNsec(s: unknown): EncryptedNsecHex | null {
  if (typeof s !== 'string' || s.length === 0 || !HEX_RE.test(s)) return null
  return s as EncryptedNsecHex
}
