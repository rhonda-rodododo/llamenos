import { describe, expect, test } from 'bun:test'
import { SAS_EMOJI_NAMES_EN, SAS_EMOJI_TABLE } from './emoji-table'
import { deriveSasEmoji, deriveSasNamesEn } from './sas'

describe('deriveSasEmoji', () => {
  const key1 = new Uint8Array(32).fill(1)
  const key2 = new Uint8Array(32).fill(2)

  test('returns 7 emoji', () => {
    const result = deriveSasEmoji(key1)
    expect(result.length).toBe(7)
  })

  test('deterministic for same input', () => {
    expect(deriveSasEmoji(key1)).toEqual(deriveSasEmoji(key1))
  })

  test('different inputs produce different outputs', () => {
    expect(deriveSasEmoji(key1)).not.toEqual(deriveSasEmoji(key2))
  })

  test('each emoji is from the 64-entry table', () => {
    const table: string[] = [...SAS_EMOJI_TABLE]
    for (const e of deriveSasEmoji(key1)) {
      expect(table).toContain(e)
    }
  })

  test('throws on key shorter than 32 bytes', () => {
    expect(() => deriveSasEmoji(new Uint8Array(16))).toThrow('32 bytes')
  })

  test('birthday test over 1000 random keys: no collisions', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const k = new Uint8Array(32)
      crypto.getRandomValues(k)
      const sas = deriveSasEmoji(k).join(',')
      expect(seen.has(sas)).toBe(false)
      seen.add(sas)
    }
  })
})

describe('deriveSasNamesEn', () => {
  const key1 = new Uint8Array(32).fill(1)

  test('returns 7 english names parallel to emoji', () => {
    const emoji = deriveSasEmoji(key1)
    const names = deriveSasNamesEn(key1)
    expect(names.length).toBe(7)
    // Names correspond to same indices
    const table: string[] = [...SAS_EMOJI_TABLE]
    const nameTable: string[] = [...SAS_EMOJI_NAMES_EN]
    for (let i = 0; i < 7; i++) {
      const idx = table.indexOf(emoji[i])
      expect(names[i]).toBe(nameTable[idx])
    }
  })
})
