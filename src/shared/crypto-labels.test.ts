import { describe, expect, test } from 'bun:test'
import * as labels from '@shared/crypto-labels'
import {
  LABEL_DEVICE_DISPLAY,
  LABEL_DEVICE_ENROLLMENT_SAS,
  LABEL_HUB_PTK_PREV_GEN,
  LABEL_MASTER_KEY_WRAP,
  LABEL_MASTER_RECOVERY_GROUP_WRAP,
  LABEL_MASTER_RECOVERY_HANDOFF,
  LABEL_MASTER_SELF_SIGNING,
  LABEL_MASTER_USER_SIGNING,
  LABEL_PAPER_KEY_ENCRYPTION,
  LABEL_PAPER_KEY_SIGNING,
  LABEL_PUK_DH,
  LABEL_PUK_PREVIOUS_GEN,
  LABEL_PUK_RECOVERY_GROUP_WRAP,
  LABEL_PUK_SECRETBOX,
  LABEL_PUK_SIGN,
  LABEL_PUK_WRAP_TO_DEVICE,
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
