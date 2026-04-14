import { describe, expect, test } from 'bun:test'
import { SAS_EMOJI_NAMES_EN, SAS_EMOJI_TABLE } from './emoji-table'
import { deriveSasEmoji, deriveSasNamesEn } from './sas'

// Fixed test vectors — all 32 bytes unless otherwise noted.
const keyA = new Uint8Array(32).fill(0x11)
const keyB = new Uint8Array(32).fill(0x22)
const keyC = new Uint8Array(32).fill(0x33)
const nonce1 = new Uint8Array(16).fill(0xaa)
const nonce2 = new Uint8Array(16).fill(0xbb)

describe('deriveSasEmoji', () => {
  test('returns a 7-tuple', () => {
    const result = deriveSasEmoji(keyA, keyB, nonce1)
    expect(result.length).toBe(7)
  })

  test('deterministic for same inputs', () => {
    expect(deriveSasEmoji(keyA, keyB, nonce1)).toEqual(deriveSasEmoji(keyA, keyB, nonce1))
  })

  test('different target pubkey produces different SAS', () => {
    expect(deriveSasEmoji(keyA, keyB, nonce1)).not.toEqual(deriveSasEmoji(keyA, keyC, nonce1))
  })

  test('different verifier pubkey produces different SAS', () => {
    expect(deriveSasEmoji(keyA, keyC, nonce1)).not.toEqual(deriveSasEmoji(keyB, keyC, nonce1))
  })

  test('different nonce produces different SAS', () => {
    expect(deriveSasEmoji(keyA, keyB, nonce1)).not.toEqual(deriveSasEmoji(keyA, keyB, nonce2))
  })

  test('swapping verifier/target with same nonce yields SAME SAS (canonicalized)', () => {
    expect(deriveSasEmoji(keyA, keyB, nonce1)).toEqual(deriveSasEmoji(keyB, keyA, nonce1))
    expect(deriveSasEmoji(keyB, keyC, nonce2)).toEqual(deriveSasEmoji(keyC, keyB, nonce2))
  })

  test('each emoji is from the 64-entry table', () => {
    const table: string[] = [...SAS_EMOJI_TABLE]
    for (const e of deriveSasEmoji(keyA, keyB, nonce1)) {
      expect(table).toContain(e)
    }
  })

  test('throws on verifier pubkey shorter than 32 bytes', () => {
    expect(() => deriveSasEmoji(new Uint8Array(16), keyB, nonce1)).toThrow(
      'verifier pubkey must be 32 bytes'
    )
  })

  test('throws on target pubkey shorter than 32 bytes', () => {
    expect(() => deriveSasEmoji(keyA, new Uint8Array(16), nonce1)).toThrow(
      'target pubkey must be 32 bytes'
    )
  })

  test('throws on empty nonce', () => {
    expect(() => deriveSasEmoji(keyA, keyB, new Uint8Array(0))).toThrow('nonce must be non-empty')
  })

  test('known-answer test vector: fixed inputs produce fixed emoji sequence', () => {
    // Fixed inputs: keyA=0x11*32, keyB=0x22*32, nonce1=0xaa*16.
    // If this test fails after a refactor, the SAS derivation has silently
    // changed — bump LABEL_SAS_MLS_V3 and update the vector intentionally.
    // The vector is computed once by the production derivation and pinned.
    const got = deriveSasEmoji(keyA, keyB, nonce1)
    // The expected emoji are the SAS_EMOJI_TABLE entries at the indices
    // produced by HKDF-SHA256(LABEL_SAS_MLS_V3, lo || hi || nonce) — see
    // sas.ts. The actual emoji strings are asserted via their table index
    // so this vector is legible without requiring a particular emoji font.
    const expectedIndices = KAT_EXPECTED_INDICES
    expect(got).toEqual([
      SAS_EMOJI_TABLE[expectedIndices[0]],
      SAS_EMOJI_TABLE[expectedIndices[1]],
      SAS_EMOJI_TABLE[expectedIndices[2]],
      SAS_EMOJI_TABLE[expectedIndices[3]],
      SAS_EMOJI_TABLE[expectedIndices[4]],
      SAS_EMOJI_TABLE[expectedIndices[5]],
      SAS_EMOJI_TABLE[expectedIndices[6]],
    ])
  })

  test('birthday test over 1000 random (verifier, target, nonce) tuples: no collisions', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const v = new Uint8Array(32)
      const t = new Uint8Array(32)
      const n = new Uint8Array(16)
      crypto.getRandomValues(v)
      crypto.getRandomValues(t)
      crypto.getRandomValues(n)
      const sas = deriveSasEmoji(v, t, n).join(',')
      expect(seen.has(sas)).toBe(false)
      seen.add(sas)
    }
  })
})

describe('deriveSasNamesEn', () => {
  test('returns 7 english names parallel to emoji', () => {
    const emoji = deriveSasEmoji(keyA, keyB, nonce1)
    const names = deriveSasNamesEn(keyA, keyB, nonce1)
    expect(names.length).toBe(7)
    const table: string[] = [...SAS_EMOJI_TABLE]
    const nameTable: string[] = [...SAS_EMOJI_NAMES_EN]
    for (let i = 0; i < 7; i++) {
      const idx = table.indexOf(emoji[i])
      expect(names[i]).toBe(nameTable[idx])
    }
  })

  test('canonicalizes verifier/target ordering (same as deriveSasEmoji)', () => {
    expect(deriveSasNamesEn(keyA, keyB, nonce1)).toEqual(deriveSasNamesEn(keyB, keyA, nonce1))
  })
})

// --- Known-answer vector ---
// Indices produced by deriveSasEmoji(keyA, keyB, nonce1) with the canonical
// ordering described in sas.ts. Computed once by the production derivation
// and pinned here so future refactors can't silently break the output.
const KAT_EXPECTED_INDICES: readonly [number, number, number, number, number, number, number] = [
  52, 12, 18, 6, 22, 27, 27,
] as const
