import { describe, expect, test } from 'bun:test'
import { probeNativeCurves } from './native-curves-check.js'

describe('probeNativeCurves', () => {
  test('returns booleans for every field', async () => {
    const r = await probeNativeCurves()
    expect(typeof r.x25519KeyGen).toBe('boolean')
    expect(typeof r.x25519DeriveBits).toBe('boolean')
    expect(typeof r.ed25519KeyGen).toBe('boolean')
    expect(typeof r.ed25519Sign).toBe('boolean')
  })

  test('probe does not throw under Bun (current target runtime)', async () => {
    await expect(probeNativeCurves()).resolves.toBeDefined()
  })
})
