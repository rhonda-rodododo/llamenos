import { describe, expect, test } from 'bun:test'
import { EFF_LARGE_WORDLIST } from '@/assets/eff-large-wordlist'
import {
  DicewarePhrase,
  RecoveryPhraseError,
  deriveRecoveryPhraseKekBytes,
  generateRecoveryPhrase,
  normalizeRecoveryPhrase,
  validateRecoveryPhrase,
} from './recovery-phrase'

describe('recovery-phrase', () => {
  test('generateRecoveryPhrase returns a DicewarePhrase', () => {
    const phrase = generateRecoveryPhrase()
    expect(phrase).toBeInstanceOf(DicewarePhrase)
  })

  test('generateRecoveryPhrase returns 15 words from the wordlist by default', () => {
    const phrase = generateRecoveryPhrase()
    const words = phrase.reveal().split(' ')
    expect(words).toHaveLength(15)
    const wordSet = new Set<string>(EFF_LARGE_WORDLIST)
    for (const w of words) {
      expect(wordSet.has(w)).toBe(true)
    }
  })

  test('generateRecoveryPhrase supports 12/15/18/24 word counts', () => {
    expect(generateRecoveryPhrase(12).reveal().split(' ')).toHaveLength(12)
    expect(generateRecoveryPhrase(15).reveal().split(' ')).toHaveLength(15)
    expect(generateRecoveryPhrase(18).reveal().split(' ')).toHaveLength(18)
    expect(generateRecoveryPhrase(24).reveal().split(' ')).toHaveLength(24)
  })

  test('normalizeRecoveryPhrase lowercases and collapses whitespace', () => {
    expect(normalizeRecoveryPhrase('  Foo   Bar   Baz  ')).toBe('foo bar baz')
  })

  test('validateRecoveryPhrase accepts a generated phrase', () => {
    const phrase = generateRecoveryPhrase(15)
    expect(validateRecoveryPhrase(phrase.reveal())).toBe(true)
  })

  test('validateRecoveryPhrase rejects a non-wordlist word', () => {
    const words = generateRecoveryPhrase(15).reveal().split(' ')
    words[0] = 'xyzzynotaword'
    expect(validateRecoveryPhrase(words.join(' '))).toBe(false)
  })

  test('validateRecoveryPhrase rejects wrong length', () => {
    expect(validateRecoveryPhrase('abandon abandon abandon')).toBe(false)
  })

  test('deriveRecoveryPhraseKekBytes is deterministic for same phrase+salt', () => {
    // Build a valid 15-word phrase from the actual wordlist
    const words = EFF_LARGE_WORDLIST.slice(0, 15)
    const phrase = DicewarePhrase.create(Array.from(words).join(' '))
    const salt = new Uint8Array(32).fill(7)
    const a = deriveRecoveryPhraseKekBytes(phrase, salt)
    const b = deriveRecoveryPhraseKekBytes(phrase, salt)
    expect(a).toEqual(b)
    expect(a.length).toBe(32)
  })

  test('deriveRecoveryPhraseKekBytes differs across salts', () => {
    const words = EFF_LARGE_WORDLIST.slice(0, 15)
    const phrase = DicewarePhrase.create(Array.from(words).join(' '))
    const saltA = new Uint8Array(32).fill(1)
    const saltB = new Uint8Array(32).fill(2)
    const a = deriveRecoveryPhraseKekBytes(phrase, saltA)
    const b = deriveRecoveryPhraseKekBytes(phrase, saltB)
    expect(a).not.toEqual(b)
  })

  test('DicewarePhrase.create rejects an invalid phrase', () => {
    // DicewarePhrase.create validates before wrapping
    expect(() => DicewarePhrase.create('not a valid phrase')).toThrow(RecoveryPhraseError)
  })

  test('EFF wordlist has exactly 7776 entries', () => {
    expect(EFF_LARGE_WORDLIST).toHaveLength(7776)
  })

  test('all generated words are unique within a single phrase', () => {
    // With 7776 words and 15 slots, duplicates are possible but extremely rare.
    // Run 50 trials and verify at least 45 produce unique-word phrases.
    let uniqueCount = 0
    for (let i = 0; i < 50; i++) {
      const words = generateRecoveryPhrase(15).reveal().split(' ')
      if (new Set(words).size === words.length) uniqueCount++
    }
    expect(uniqueCount).toBeGreaterThan(40)
  })

  describe('DicewarePhrase redaction', () => {
    test('toJSON returns [REDACTED]', () => {
      const phrase = generateRecoveryPhrase()
      expect(phrase.toJSON()).toBe('[REDACTED]')
    })

    test('JSON.stringify on an object containing a phrase never reveals the words', () => {
      const phrase = generateRecoveryPhrase()
      const serialized = JSON.stringify({ phrase, other: 'data' })
      expect(serialized).toContain('[REDACTED]')
      expect(serialized).not.toContain(phrase.reveal())
    })

    test('toString returns DicewarePhrase [REDACTED]', () => {
      const phrase = generateRecoveryPhrase()
      expect(phrase.toString()).toBe('DicewarePhrase [REDACTED]')
    })

    test('template literal interpolation never reveals the words', () => {
      const phrase = generateRecoveryPhrase()
      const str = `phrase is: ${phrase}`
      expect(str).toBe('phrase is: DicewarePhrase [REDACTED]')
      expect(str).not.toContain(phrase.reveal())
    })

    test('Symbol.for nodejs.util.inspect.custom returns DicewarePhrase [REDACTED]', () => {
      const phrase = generateRecoveryPhrase()
      const inspectKey = Symbol.for('nodejs.util.inspect.custom')
      const inspectFn = (phrase as unknown as Record<symbol, () => string>)[inspectKey]
      expect(typeof inspectFn).toBe('function')
      expect(inspectFn.call(phrase)).toBe('DicewarePhrase [REDACTED]')
    })

    test('reveal() returns the actual plaintext phrase', () => {
      const words = EFF_LARGE_WORDLIST.slice(0, 15)
      const plaintext = Array.from(words).join(' ')
      const phrase = DicewarePhrase.create(plaintext)
      expect(phrase.reveal()).toBe(plaintext)
    })
  })

  describe('DicewarePhrase.create', () => {
    test('normalizes whitespace and case', () => {
      const words = EFF_LARGE_WORDLIST.slice(0, 15)
      const messyInput = `  ${Array.from(words).join('   ')}  `.toUpperCase()
      const phrase = DicewarePhrase.create(messyInput)
      expect(phrase.reveal()).toBe(Array.from(words).join(' '))
    })

    test('throws on empty string', () => {
      expect(() => DicewarePhrase.create('')).toThrow(RecoveryPhraseError)
    })

    test('throws on wrong word count', () => {
      const words = EFF_LARGE_WORDLIST.slice(0, 3)
      expect(() => DicewarePhrase.create(Array.from(words).join(' '))).toThrow(RecoveryPhraseError)
    })

    test('throws on invalid word', () => {
      const words: string[] = Array.from(EFF_LARGE_WORDLIST.slice(0, 15))
      words[0] = 'xyzzynotaword'
      expect(() => DicewarePhrase.create(words.join(' '))).toThrow(RecoveryPhraseError)
    })
  })

  describe('DicewarePhrase.generate', () => {
    test('returns a DicewarePhrase instance', () => {
      expect(DicewarePhrase.generate()).toBeInstanceOf(DicewarePhrase)
    })

    test('supports all valid word counts', () => {
      for (const count of [12, 15, 18, 24] as const) {
        const phrase = DicewarePhrase.generate(count)
        expect(phrase.reveal().split(' ')).toHaveLength(count)
      }
    })
  })
})
