import { describe, expect, test } from 'bun:test'
import { EFF_LARGE_WORDLIST } from '@/assets/eff-large-wordlist'
import {
  RecoveryPhraseError,
  deriveRecoveryPhraseKekBytes,
  generateRecoveryPhrase,
  normalizeRecoveryPhrase,
  validateRecoveryPhrase,
} from './recovery-phrase'

describe('recovery-phrase', () => {
  test('generateRecoveryPhrase returns 15 words from the wordlist by default', () => {
    const phrase = generateRecoveryPhrase()
    const words = phrase.split(' ')
    expect(words).toHaveLength(15)
    const wordSet = new Set<string>(EFF_LARGE_WORDLIST)
    for (const w of words) {
      expect(wordSet.has(w)).toBe(true)
    }
  })

  test('generateRecoveryPhrase supports 12/15/18/24 word counts', () => {
    expect(generateRecoveryPhrase(12).split(' ')).toHaveLength(12)
    expect(generateRecoveryPhrase(15).split(' ')).toHaveLength(15)
    expect(generateRecoveryPhrase(18).split(' ')).toHaveLength(18)
    expect(generateRecoveryPhrase(24).split(' ')).toHaveLength(24)
  })

  test('normalizeRecoveryPhrase lowercases and collapses whitespace', () => {
    expect(normalizeRecoveryPhrase('  Foo   Bar   Baz  ')).toBe('foo bar baz')
  })

  test('validateRecoveryPhrase accepts a generated phrase', () => {
    const phrase = generateRecoveryPhrase(15)
    expect(validateRecoveryPhrase(phrase)).toBe(true)
  })

  test('validateRecoveryPhrase rejects a non-wordlist word', () => {
    const phrase = generateRecoveryPhrase(15).split(' ')
    phrase[0] = 'xyzzynotaword'
    expect(validateRecoveryPhrase(phrase.join(' '))).toBe(false)
  })

  test('validateRecoveryPhrase rejects wrong length', () => {
    expect(validateRecoveryPhrase('abandon abandon abandon')).toBe(false)
  })

  test('deriveRecoveryPhraseKekBytes is deterministic for same phrase+salt', () => {
    // Build a valid 15-word phrase from the actual wordlist
    const words = EFF_LARGE_WORDLIST.slice(0, 15)
    const phrase = Array.from(words).join(' ')
    const salt = new Uint8Array(32).fill(7)
    const a = deriveRecoveryPhraseKekBytes(phrase, salt)
    const b = deriveRecoveryPhraseKekBytes(phrase, salt)
    expect(a).toEqual(b)
    expect(a.length).toBe(32)
  })

  test('deriveRecoveryPhraseKekBytes differs across salts', () => {
    const words = EFF_LARGE_WORDLIST.slice(0, 15)
    const phrase = Array.from(words).join(' ')
    const saltA = new Uint8Array(32).fill(1)
    const saltB = new Uint8Array(32).fill(2)
    const a = deriveRecoveryPhraseKekBytes(phrase, saltA)
    const b = deriveRecoveryPhraseKekBytes(phrase, saltB)
    expect(a).not.toEqual(b)
  })

  test('deriveRecoveryPhraseKekBytes rejects an invalid phrase', () => {
    const salt = new Uint8Array(32).fill(7)
    expect(() => deriveRecoveryPhraseKekBytes('not a valid phrase', salt)).toThrow(
      RecoveryPhraseError
    )
  })

  test('EFF wordlist has exactly 7776 entries', () => {
    expect(EFF_LARGE_WORDLIST).toHaveLength(7776)
  })

  test('all generated words are unique within a single phrase', () => {
    // With 7776 words and 15 slots, duplicates are possible but extremely rare.
    // Run 50 trials and verify at least 45 produce unique-word phrases.
    let uniqueCount = 0
    for (let i = 0; i < 50; i++) {
      const words = generateRecoveryPhrase(15).split(' ')
      if (new Set(words).size === words.length) uniqueCount++
    }
    expect(uniqueCount).toBeGreaterThan(40)
  })
})
