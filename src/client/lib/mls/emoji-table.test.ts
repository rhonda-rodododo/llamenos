import { describe, expect, test } from 'bun:test'
import { SAS_EMOJI_NAMES_EN, SAS_EMOJI_TABLE } from './emoji-table'

describe('SAS emoji table', () => {
  test('exactly 64 entries (6 bits of entropy per emoji)', () => {
    expect(SAS_EMOJI_TABLE.length).toBe(64)
  })

  test('every entry is a non-empty string', () => {
    for (const e of SAS_EMOJI_TABLE) {
      expect(typeof e).toBe('string')
      expect(e.length).toBeGreaterThan(0)
    }
  })

  test('no duplicates', () => {
    expect(new Set(SAS_EMOJI_TABLE).size).toBe(64)
  })

  test('names table has the same length', () => {
    expect(SAS_EMOJI_NAMES_EN.length).toBe(64)
  })

  test('every name is non-empty and lowercase', () => {
    for (const name of SAS_EMOJI_NAMES_EN) {
      expect(name.length).toBeGreaterThan(0)
      expect(name as string).toBe(name.toLowerCase())
    }
  })
})
