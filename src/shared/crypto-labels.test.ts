import { describe, expect, test } from 'bun:test'
import * as labels from '@shared/crypto-labels'
import {
  type CryptoLabel,
  LABEL_DEVICE_DISPLAY,
  LABEL_DEVICE_ENROLLMENT_SAS,
  LABEL_HUB_PTK_PREV_GEN,
  LABEL_ITEMS_KEY_EXPORT,
  LABEL_MASTER_KEY_WRAP,
  LABEL_MASTER_RECOVERY_GROUP_WRAP,
  LABEL_MASTER_RECOVERY_HANDOFF,
  LABEL_MASTER_SELF_SIGNING,
  LABEL_MASTER_USER_SIGNING,
  LABEL_MLS_PROVISION,
  LABEL_NOTE_EPOCH_KEY,
  LABEL_PAPER_KEY_ENCRYPTION,
  LABEL_PAPER_KEY_SIGNING,
  LABEL_PUK_DH,
  LABEL_PUK_PREVIOUS_GEN,
  LABEL_PUK_RECOVERY_GROUP_WRAP,
  LABEL_PUK_SECRETBOX,
  LABEL_PUK_SIGN,
  LABEL_PUK_WRAP_TO_DEVICE,
  LABEL_REGISTRY,
  LABEL_SAS_MLS,
  LABEL_SAS_MLS_V3,
  LABEL_SFRAME_RATCHET,
  labelToId,
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

describe('Tier 3 labels', () => {
  test('all Tier 3 labels are registered', () => {
    expect(labelToId(LABEL_PUK_SIGN)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_DH)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_SECRETBOX)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_WRAP_TO_DEVICE)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_PREVIOUS_GEN)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_KEY_WRAP)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_SELF_SIGNING)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_USER_SIGNING)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_RECOVERY_HANDOFF)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_RECOVERY_GROUP_WRAP)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_RECOVERY_GROUP_WRAP)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_DEVICE_DISPLAY)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_DEVICE_ENROLLMENT_SAS)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PAPER_KEY_SIGNING)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PAPER_KEY_ENCRYPTION)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_HUB_PTK_PREV_GEN)).toBeGreaterThanOrEqual(0)
  })

  test('all Tier 3 labels have distinct ids', () => {
    const ids = new Set([
      labelToId(LABEL_PUK_SIGN),
      labelToId(LABEL_PUK_DH),
      labelToId(LABEL_PUK_SECRETBOX),
      labelToId(LABEL_PUK_WRAP_TO_DEVICE),
      labelToId(LABEL_PUK_PREVIOUS_GEN),
      labelToId(LABEL_MASTER_KEY_WRAP),
      labelToId(LABEL_MASTER_SELF_SIGNING),
      labelToId(LABEL_MASTER_USER_SIGNING),
      labelToId(LABEL_MASTER_RECOVERY_HANDOFF),
      labelToId(LABEL_MASTER_RECOVERY_GROUP_WRAP),
      labelToId(LABEL_PUK_RECOVERY_GROUP_WRAP),
      labelToId(LABEL_DEVICE_DISPLAY),
      labelToId(LABEL_DEVICE_ENROLLMENT_SAS),
      labelToId(LABEL_PAPER_KEY_SIGNING),
      labelToId(LABEL_PAPER_KEY_ENCRYPTION),
      labelToId(LABEL_HUB_PTK_PREV_GEN),
    ])
    expect(ids.size).toBe(16)
  })
})

describe('Tier 6 crypto labels', () => {
  test('LABEL_SAS_MLS exists and is registered (AEAD fingerprint label)', () => {
    expect(LABEL_SAS_MLS as string).toBe('llamenos:sas:v2')
    expect(LABEL_REGISTRY).toContain(LABEL_SAS_MLS)
    expect(labelToId(LABEL_SAS_MLS)).toBe(41)
  })
  test('LABEL_ITEMS_KEY_EXPORT is a plain string (HKDF-only, not in registry)', () => {
    expect(LABEL_ITEMS_KEY_EXPORT).toBe('llamenos:items-key-export:v1')
    expect(LABEL_REGISTRY).not.toContain(LABEL_ITEMS_KEY_EXPORT)
  })
  test('LABEL_NOTE_EPOCH_KEY is a plain string (HKDF-only, not in registry)', () => {
    expect(LABEL_NOTE_EPOCH_KEY).toBe('llamenos:note-epoch-key:v1')
    expect(LABEL_REGISTRY).not.toContain(LABEL_NOTE_EPOCH_KEY)
  })
  test('LABEL_MLS_PROVISION is a plain string (HKDF-only, not in registry)', () => {
    expect(LABEL_MLS_PROVISION).toBe('llamenos:mls-provision:v1')
    expect(LABEL_REGISTRY).not.toContain(LABEL_MLS_PROVISION)
  })
})

describe('Slice 7: HKDF label split', () => {
  test('LABEL_REGISTRY has 47 entries (42 base + 3 Slice 3 server + 2 auth/signal labels)', () => {
    expect(LABEL_REGISTRY.length).toBe(47)
  })

  test('LABEL_SFRAME_RATCHET is a plain string not in registry', () => {
    // Type check: LABEL_SFRAME_RATCHET is now plain string, not CryptoLabel.
    // Calling labelToId(LABEL_SFRAME_RATCHET) would be a compile-time error.
    expect(typeof LABEL_SFRAME_RATCHET).toBe('string')
    expect(LABEL_REGISTRY).not.toContain(LABEL_SFRAME_RATCHET)
  })

  test('LABEL_SAS_MLS_V3 is a plain string not in registry', () => {
    // Type check: LABEL_SAS_MLS_V3 is now plain string, not CryptoLabel.
    expect(typeof LABEL_SAS_MLS_V3).toBe('string')
    expect(LABEL_REGISTRY).not.toContain(LABEL_SAS_MLS_V3)
  })

  test('LABEL_ITEMS_KEY_EXPORT, LABEL_NOTE_EPOCH_KEY, LABEL_MLS_PROVISION not in registry', () => {
    expect(LABEL_REGISTRY).not.toContain(LABEL_ITEMS_KEY_EXPORT)
    expect(LABEL_REGISTRY).not.toContain(LABEL_NOTE_EPOCH_KEY)
    expect(LABEL_REGISTRY).not.toContain(LABEL_MLS_PROVISION)
  })

  test('labelToId throws for former HKDF-only label string values', () => {
    // These were retired from the registry. Passing their string values
    // (cast to CryptoLabel only for this test) must throw.
    expect(() => labelToId(LABEL_SFRAME_RATCHET as CryptoLabel)).toThrow()
    expect(() => labelToId(LABEL_SAS_MLS_V3 as CryptoLabel)).toThrow()
    expect(() => labelToId(LABEL_ITEMS_KEY_EXPORT as CryptoLabel)).toThrow()
    expect(() => labelToId(LABEL_NOTE_EPOCH_KEY as CryptoLabel)).toThrow()
    expect(() => labelToId(LABEL_MLS_PROVISION as CryptoLabel)).toThrow()
  })

  test('LABEL_SAS_MLS remains the last AEAD label at index 41', () => {
    expect(LABEL_REGISTRY[41] as string).toBe('llamenos:sas:v2')
  })
})
