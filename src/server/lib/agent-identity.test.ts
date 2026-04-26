import { describe, expect, it } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_FIREHOSE_AGENT_SEAL } from '@shared/crypto-labels'
import { generateAgentKeypair, unsealAgentNsec } from './agent-identity'

describe('generateAgentKeypair / unsealAgentNsec', () => {
  it('should generate keypair and round-trip seal/unseal', async () => {
    const sealKey = 'a'.repeat(64) // 32 bytes hex
    const agentId = 'test-connection-123'

    const { pubkey, encryptedNsec } = await generateAgentKeypair(
      agentId,
      sealKey,
      LABEL_FIREHOSE_AGENT_SEAL
    )

    expect(pubkey).toHaveLength(64) // 32 bytes x-only pubkey hex
    expect(encryptedNsec.length).toBeGreaterThan(0)

    const nsecHex = await unsealAgentNsec(
      agentId,
      encryptedNsec,
      sealKey,
      LABEL_FIREHOSE_AGENT_SEAL
    )
    expect(nsecHex).toHaveLength(64) // 32 bytes nsec hex

    // Verify the unsealed nsec derives back to the same pubkey
    const derivedPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(nsecHex)))
    expect(derivedPubkey).toBe(pubkey)
  })

  it('should produce different encryptedNsec for different agentIds', async () => {
    const sealKey = 'b'.repeat(64)

    const result1 = await generateAgentKeypair('agent-1', sealKey, LABEL_FIREHOSE_AGENT_SEAL)
    const result2 = await generateAgentKeypair('agent-2', sealKey, LABEL_FIREHOSE_AGENT_SEAL)

    // Different agents → different keypairs and different sealed blobs
    expect(result1.pubkey).not.toBe(result2.pubkey)
    expect(result1.encryptedNsec).not.toBe(result2.encryptedNsec)
  })

  it('should produce different encryptedNsec for different sealLabels', async () => {
    const sealKey = 'f'.repeat(64)
    const agentId = 'same-agent-id'

    const result1 = await generateAgentKeypair(agentId, sealKey, 'llamenos:agent-type-a')
    const result2 = await generateAgentKeypair(agentId, sealKey, 'llamenos:agent-type-b')

    // Different labels → different sealed blobs (distinct key derivation paths)
    expect(result1.encryptedNsec).not.toBe(result2.encryptedNsec)
  })

  it('should fail to unseal with wrong agentId', async () => {
    const sealKey = 'c'.repeat(64)
    const agentId = 'correct-connection'

    const { encryptedNsec } = await generateAgentKeypair(
      agentId,
      sealKey,
      LABEL_FIREHOSE_AGENT_SEAL
    )

    // Wrong agentId → different derived key → AEAD auth tag fails
    await expect(
      unsealAgentNsec('wrong-connection', encryptedNsec, sealKey, LABEL_FIREHOSE_AGENT_SEAL)
    ).rejects.toThrow()
  })

  it('should fail to unseal with wrong sealKey', async () => {
    const sealKey = 'd'.repeat(64)
    const wrongKey = 'e'.repeat(64)
    const agentId = 'some-connection'

    const { encryptedNsec } = await generateAgentKeypair(
      agentId,
      sealKey,
      LABEL_FIREHOSE_AGENT_SEAL
    )

    // Wrong sealKey → different derived key → AEAD auth tag fails
    await expect(
      unsealAgentNsec(agentId, encryptedNsec, wrongKey, LABEL_FIREHOSE_AGENT_SEAL)
    ).rejects.toThrow()
  })

  it('should fail to unseal with wrong sealLabel', async () => {
    const sealKey = 'a'.repeat(64)
    const agentId = 'some-connection'

    const { encryptedNsec } = await generateAgentKeypair(
      agentId,
      sealKey,
      LABEL_FIREHOSE_AGENT_SEAL
    )

    // Wrong label → different derived key → AEAD auth tag fails
    await expect(
      unsealAgentNsec(agentId, encryptedNsec, sealKey, 'llamenos:wrong-label')
    ).rejects.toThrow()
  })
})
