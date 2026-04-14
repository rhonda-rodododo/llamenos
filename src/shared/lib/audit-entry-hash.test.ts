import { describe, expect, test } from 'bun:test'
import { computeEntryHash } from './audit-entry-hash'

const HEX64 = 'ab'.repeat(32)
const UUID = '00000000-0000-4000-8000-000000000001'

const baseEntry = {
  id: UUID,
  hubId: UUID,
  payload: {
    type: 'membership_add' as const,
    userId: UUID,
    pubkey: HEX64,
    role: 'volunteer' as const,
  },
  prevEntryHash: null,
  createdAt: '2026-04-11T00:00:00.000Z',
  signerDeviceId: 'device-1',
  signerPubkey: HEX64,
}

describe('computeEntryHash', () => {
  test('returns 64-char hex (SHA-256)', () => {
    const hash = computeEntryHash(baseEntry)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('deterministic — same input yields same hash', () => {
    expect(computeEntryHash(baseEntry)).toBe(computeEntryHash(baseEntry))
  })

  test('changing id changes hash', () => {
    const alt = { ...baseEntry, id: '00000000-0000-4000-8000-000000000002' }
    expect(computeEntryHash(alt)).not.toBe(computeEntryHash(baseEntry))
  })

  test('changing hubId changes hash', () => {
    const alt = { ...baseEntry, hubId: '00000000-0000-4000-8000-000000000002' }
    expect(computeEntryHash(alt)).not.toBe(computeEntryHash(baseEntry))
  })

  test('changing payload changes hash', () => {
    const alt = {
      ...baseEntry,
      payload: { type: 'membership_remove' as const, userId: UUID },
    }
    expect(computeEntryHash(alt)).not.toBe(computeEntryHash(baseEntry))
  })

  test('changing prevEntryHash changes hash', () => {
    const alt = { ...baseEntry, prevEntryHash: 'cd'.repeat(32) }
    expect(computeEntryHash(alt)).not.toBe(computeEntryHash(baseEntry))
  })

  test('changing createdAt changes hash', () => {
    const alt = { ...baseEntry, createdAt: '2026-04-12T00:00:00.000Z' }
    expect(computeEntryHash(alt)).not.toBe(computeEntryHash(baseEntry))
  })

  test('changing signerDeviceId changes hash', () => {
    const alt = { ...baseEntry, signerDeviceId: 'device-2' }
    expect(computeEntryHash(alt)).not.toBe(computeEntryHash(baseEntry))
  })

  test('changing signerPubkey changes hash', () => {
    const alt = { ...baseEntry, signerPubkey: 'cd'.repeat(32) }
    expect(computeEntryHash(alt)).not.toBe(computeEntryHash(baseEntry))
  })

  test('null prevEntryHash vs non-null produces different hashes', () => {
    const withPrev = { ...baseEntry, prevEntryHash: HEX64 }
    expect(computeEntryHash(withPrev)).not.toBe(computeEntryHash(baseEntry))
  })
})
