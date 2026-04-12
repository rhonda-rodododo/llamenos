import { describe, expect, test } from 'bun:test'
import * as labels from '@shared/crypto-labels'
import {
  type CryptoLabel,
  LABEL_ITEMS_KEY_EXPORT,
  LABEL_MLS_PROVISION,
  LABEL_NOTE_EPOCH_KEY,
  LABEL_REGISTRY,
  LABEL_SAS_V2,
} from '@shared/crypto-labels'

describe('crypto-labels', () => {
  const entries = Object.entries(labels).filter(([, v]) => typeof v === 'string')
  const values = entries.map(([, v]) => v)

  test('all constants are non-empty strings', () => {
    for (const [name, value] of entries) {
      expect(typeof value, `${name} must be a string`).toBe('string')
      expect((value as string).length, `${name} must be non-empty`).toBeGreaterThan(0)
    }
  })

  test('all constants start with llamenos:', () => {
    for (const [name, value] of entries) {
      expect(value as string, `${name} must start with 'llamenos:'`).toMatch(/^llamenos:/)
    }
  })

  test('all constants are unique (no cross-context collision)', () => {
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })
})

describe('Tier 6 crypto labels', () => {
  test('LABEL_SAS_V2 exists and is distinct', () => {
    expect(LABEL_SAS_V2 as string).toBe('llamenos:sas:v2')
  })
  test('LABEL_ITEMS_KEY_EXPORT exists', () => {
    expect(LABEL_ITEMS_KEY_EXPORT as string).toBe('llamenos:items-key-export:v1')
  })
  test('LABEL_NOTE_EPOCH_KEY exists', () => {
    expect(LABEL_NOTE_EPOCH_KEY as string).toBe('llamenos:note-epoch-key:v1')
  })
  test('LABEL_MLS_PROVISION exists', () => {
    expect(LABEL_MLS_PROVISION as string).toBe('llamenos:mls-provision:v1')
  })
  test('all Tier 6 labels registered in LABEL_REGISTRY', () => {
    for (const label of [
      LABEL_SAS_V2,
      LABEL_ITEMS_KEY_EXPORT,
      LABEL_NOTE_EPOCH_KEY,
      LABEL_MLS_PROVISION,
    ]) {
      expect(LABEL_REGISTRY).toContain(label)
    }
  })
})
