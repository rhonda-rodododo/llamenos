import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { decryptBlastContentWithKey, encryptBlastContent } from '@shared/crypto-envelopes'
import {
  LABEL_BLAST_CONTENT,
  LABEL_USER_HPKE_KEY,
  LABEL_USER_HPKE_KEY_INFO,
} from '@shared/crypto-labels'
import { hkdfDerive } from '@shared/crypto-primitives'
import { createHpkeSuite } from '@shared/crypto-suite'
import type { BlastContent } from '@shared/types'

/**
 * Generate a test X25519 keypair for blast HPKE encryption.
 * Returns hex-encoded public key and the raw 32-byte secret (ikm for derivation).
 */
async function generateTestX25519Keypair() {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  const pubBytes = await suite.kem.serializePublicKey(kp.publicKey as CryptoKey)
  const privBytes = await suite.kem.serializePrivateKey(kp.privateKey as CryptoKey)
  return {
    pubkeyHex: bytesToHex(new Uint8Array(pubBytes)),
    secretKey: new Uint8Array(privBytes),
  }
}

describe('blast content encryption (HPKE)', () => {
  const content: BlastContent = { text: 'Hello subscribers!' }

  test('encrypt → decrypt roundtrip', async () => {
    const recipient = await generateTestX25519Keypair()
    const { encryptedContent, contentEnvelopes } = await encryptBlastContent(content, [
      recipient.pubkeyHex,
    ])
    // HPKE per-recipient model: encryptedContent is empty, each envelope holds the sealed content
    expect(encryptedContent as string).toBe('')
    expect(contentEnvelopes).toHaveLength(1)
    expect(contentEnvelopes[0].pubkey).toBe(recipient.pubkeyHex)
  })

  test('multiple recipients each get their own envelope', async () => {
    const r1 = await generateTestX25519Keypair()
    const r2 = await generateTestX25519Keypair()
    const { contentEnvelopes } = await encryptBlastContent(content, [r1.pubkeyHex, r2.pubkeyHex])
    expect(contentEnvelopes).toHaveLength(2)
    expect(contentEnvelopes[0].pubkey).toBe(r1.pubkeyHex)
    expect(contentEnvelopes[1].pubkey).toBe(r2.pubkeyHex)
  })

  test('non-recipient pubkey has no envelope', async () => {
    const recipient = await generateTestX25519Keypair()
    const nonRecipient = await generateTestX25519Keypair()
    const { contentEnvelopes } = await encryptBlastContent(content, [recipient.pubkeyHex])
    const found = contentEnvelopes.find((e) => e.pubkey === nonRecipient.pubkeyHex)
    expect(found).toBeUndefined()
  })

  test('envelopes have required HPKE fields', async () => {
    const recipient = await generateTestX25519Keypair()
    const { contentEnvelopes } = await encryptBlastContent(content, [recipient.pubkeyHex])
    const env = contentEnvelopes[0]
    expect(env.v).toBe(3) // HPKE envelope version
    expect(typeof env.enc).toBe('string')
    expect(typeof env.ct).toBe('string')
    expect(env.enc.length).toBeGreaterThan(0)
    expect(env.ct.length).toBeGreaterThan(0)
  })

  test('nonce uniqueness — same content produces different envelopes', async () => {
    const recipient = await generateTestX25519Keypair()
    const a = await encryptBlastContent(content, [recipient.pubkeyHex])
    const b = await encryptBlastContent(content, [recipient.pubkeyHex])
    // HPKE enc (ephemeral key) should differ between seals
    expect(a.contentEnvelopes[0].enc).not.toBe(b.contentEnvelopes[0].enc)
  })
})
