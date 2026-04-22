/**
 * Wiring test: `rotateHubKeyClkr` must invalidate the Tier 0 signed audit
 * chain cache because a rotation can change the set of devices in the trust
 * anchor. Uses bun's `mock.module` to stub `audit-chain-verifier` so we can
 * assert the call without touching real IDB (which is absent in the bun
 * runtime).
 */
import { describe, expect, mock, test } from 'bun:test'
import { createHpkeSuite } from '@shared/crypto-suite'
import { asX25519EncryptionKey } from '@shared/types'
// Eagerly import the real module so mock.module can preserve its other
// named exports and only override `clearChainCache`. Without this, bun's
// process-wide mock.module would strip named exports and break sibling
// tests that import `verifyAuditChain` / `ChainVerificationError`.
import * as realVerifier from '@/lib/audit-chain-verifier'

const clearCalls: string[] = []
const mockClearChainCache = mock(async (hubId: string) => {
  clearCalls.push(hubId)
})

mock.module('@/lib/audit-chain-verifier', () => ({
  ...realVerifier,
  clearChainCache: mockClearChainCache,
}))

const { generateHubKey, rotateHubKeyClkr } = await import('./hub-key-manager')

const HUB_ID = '11111111-1111-4111-8111-111111111111'

async function generateDeviceKeypair() {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  return {
    privateKey: asX25519EncryptionKey(kp.privateKey as CryptoKey),
    publicKey: asX25519EncryptionKey(kp.publicKey as CryptoKey),
  }
}

describe('rotateHubKeyClkr — audit chain cache invalidation', () => {
  test('calls clearChainCache with the rotated hubId', async () => {
    clearCalls.length = 0
    const device = await generateDeviceKeypair()
    await rotateHubKeyClkr({
      hubId: HUB_ID,
      currentHubKey: generateHubKey(),
      currentGen: 1,
      remainingDevices: [{ deviceId: 'dev-1', encPubkey: device.publicKey }],
      rotationReason: 'manual',
    })
    expect(clearCalls).toContain(HUB_ID)
  })

  test('swallows clearChainCache failure without aborting rotation', async () => {
    clearCalls.length = 0
    // Swap the mock to a rejecting impl for this test only.
    const original = mockClearChainCache.getMockImplementation()
    mockClearChainCache.mockImplementation(async () => {
      throw new Error('idb unavailable')
    })
    try {
      const device = await generateDeviceKeypair()
      const result = await rotateHubKeyClkr({
        hubId: HUB_ID,
        currentHubKey: generateHubKey(),
        currentGen: 2,
        remainingDevices: [{ deviceId: 'dev-x', encPubkey: device.publicKey }],
        rotationReason: 'manual',
      })
      // Rotation still succeeded — caller sees a full result object.
      expect(result.newHubKey.length).toBe(32)
      expect(result.newGeneration).toBe(3)
      expect(result.deviceEnvelopes).toHaveLength(1)
    } finally {
      // Restore the original spying impl so other tests in the same run see
      // the normal push-to-list behaviour.
      if (original) mockClearChainCache.mockImplementation(original)
    }
  })
})
