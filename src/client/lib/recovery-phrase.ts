/**
 * Diceware recovery phrase primitives.
 *
 * Generation: rejection sampling from the EFF large wordlist (7776 words,
 * ~12.9 bits/word). 15 words → ~194 bits of entropy.
 *
 * Derivation: normalized phrase → Argon2id(t=2, m=19 MiB, p=1) → 32 bytes.
 * The 32 bytes are HKDFed into an AES-KW wrapping key (domain-separated by
 * LABEL_RECOVERY_PHRASE_KEK) by the caller in the crypto worker.
 */
import { argon2id } from '@noble/hashes/argon2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_RECOVERY_PHRASE_KEK } from '@shared/crypto-labels'
import { EFF_LARGE_WORDLIST } from '@/assets/eff-large-wordlist'

const WORDLIST_SIZE = 7776

export class RecoveryPhraseError extends Error {
  constructor(public readonly code: 'invalid_word' | 'wrong_length' | 'empty' | 'rng_unavailable') {
    super(`Recovery phrase error: ${code}`)
    this.name = 'RecoveryPhraseError'
  }
}

/**
 * Opaque wrapper around a diceware recovery phrase.
 *
 * Redacts the plaintext in all serialization paths — `JSON.stringify`,
 * `console.log`, and Node.js inspect all return "[REDACTED]". The plaintext
 * is only accessible via the explicit `.reveal()` call, making it an
 * auditable pattern at the KDF boundary.
 */
export class DicewarePhrase {
  #phrase: string

  private constructor(phrase: string) {
    this.#phrase = phrase
  }

  /** Return the plaintext phrase. Only call at cryptographic boundaries. */
  reveal(): string {
    return this.#phrase
  }

  toJSON(): string {
    return '[REDACTED]'
  }

  toString(): string {
    return 'DicewarePhrase [REDACTED]'
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'DicewarePhrase [REDACTED]'
  }

  /**
   * Validate the input, normalize whitespace/case, and wrap in a
   * `DicewarePhrase`. Throws `RecoveryPhraseError` if invalid.
   */
  static create(words: string): DicewarePhrase {
    assertValidRecoveryPhrase(words)
    return new DicewarePhrase(normalizeRecoveryPhrase(words))
  }

  /**
   * Generate a fresh `DicewarePhrase` with `wordCount` EFF-large-wordlist words.
   * Default 15 = ~194 bits of entropy. Uses unbiased rejection sampling.
   */
  static generate(wordCount: 12 | 15 | 18 | 24 = 15): DicewarePhrase {
    return new DicewarePhrase(generateRawPhrase(wordCount))
  }
}

/**
 * Generate a raw recovery phrase string (module-private).
 * External callers should use `generateRecoveryPhrase()` or `DicewarePhrase.generate()`.
 */
function generateRawPhrase(wordCount: 12 | 15 | 18 | 24 = 15): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new RecoveryPhraseError('rng_unavailable')
  }
  const max = 65536 - (65536 % WORDLIST_SIZE)
  const words: string[] = []
  const buf = new Uint16Array(1)
  while (words.length < wordCount) {
    crypto.getRandomValues(buf)
    if (buf[0]! < max) {
      words.push(EFF_LARGE_WORDLIST[buf[0]! % WORDLIST_SIZE]!)
    }
  }
  return words.join(' ')
}

/**
 * Generate a recovery phrase wrapped in a `DicewarePhrase`.
 * Default 15 words = ~194 bits of entropy.
 */
export function generateRecoveryPhrase(wordCount: 12 | 15 | 18 | 24 = 15): DicewarePhrase {
  return DicewarePhrase.generate(wordCount)
}

export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .join(' ')
}

const wordSet = new Set<string>(EFF_LARGE_WORDLIST)

/**
 * Validate a recovery phrase. Throws RecoveryPhraseError with a specific
 * error code if invalid.
 */
export function validateRecoveryPhrase(phrase: string): boolean {
  const words = normalizeRecoveryPhrase(phrase).split(' ')
  if (words.length === 0 || words[0] === '') return false
  if (![12, 15, 18, 24].includes(words.length)) return false
  for (const w of words) {
    if (!wordSet.has(w)) return false
  }
  return true
}

/** Validate and throw with the specific error code. */
function assertValidRecoveryPhrase(phrase: string): void {
  const normalized = normalizeRecoveryPhrase(phrase)
  if (normalized === '') throw new RecoveryPhraseError('empty')
  const words = normalized.split(' ')
  if (![12, 15, 18, 24].includes(words.length)) {
    throw new RecoveryPhraseError('wrong_length')
  }
  for (const w of words) {
    if (!wordSet.has(w)) throw new RecoveryPhraseError('invalid_word')
  }
}

/**
 * Derive the recovery phrase KEK as 32 raw bytes. The caller is responsible
 * for importing these bytes as a non-extractable AES-KW CryptoKey via the
 * crypto worker.
 *
 * KDF parameters follow OWASP 2026 low-resource floor:
 *   Argon2id(t=2, m=19456 KiB, p=1, dkLen=32)
 * then HKDF-SHA256 with LABEL_RECOVERY_PHRASE_KEK + ':phrase' as info.
 */
export function deriveRecoveryPhraseKekBytes(phrase: DicewarePhrase, salt: Uint8Array): Uint8Array {
  const plaintext = phrase.reveal()
  assertValidRecoveryPhrase(plaintext)
  if (salt.length !== 32) {
    throw new Error(`Recovery phrase salt must be 32 bytes, got ${salt.length}`)
  }
  const normalized = normalizeRecoveryPhrase(plaintext)
  const ikm = utf8ToBytes(normalized)
  const raw = argon2id(ikm, salt, {
    t: RECOVERY_PHRASE_KDF_PARAMS.t,
    m: RECOVERY_PHRASE_KDF_PARAMS.m,
    p: RECOVERY_PHRASE_KDF_PARAMS.p,
    dkLen: 32,
  })
  ikm.fill(0)
  const info = utf8ToBytes(`${LABEL_RECOVERY_PHRASE_KEK}:phrase`)
  const kek = hkdf(sha256, raw, new Uint8Array(0), info, 32)
  raw.fill(0)
  return kek
}

export const RECOVERY_PHRASE_KDF_PARAMS = {
  algo: 'argon2id' as const,
  t: 2,
  m: 19456,
  p: 1,
}

/** Helper to generate a fresh 32-byte per-user salt. */
export function generateRecoveryPhraseSalt(): Uint8Array {
  const salt = new Uint8Array(32)
  crypto.getRandomValues(salt)
  return salt
}

export function hexSaltToBytes(hex: string): Uint8Array {
  return hexToBytes(hex)
}
export function bytesToHexSalt(bytes: Uint8Array): string {
  return bytesToHex(bytes)
}
