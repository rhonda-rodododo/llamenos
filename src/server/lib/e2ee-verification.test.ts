import { describe, expect, test } from 'bun:test'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import { CryptoService } from './crypto-service'
import { HpkeService } from './hpke-service'

const TEST_SERVER_SECRET = '0000000000000000000000000000000000000000000000000000000000000001'
const TEST_HMAC_SECRET = '0000000000000000000000000000000000000000000000000000000000000002'

describe('E2EE verification', () => {
  const hpke = new HpkeService(TEST_SERVER_SECRET)
  const crypto = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET, hpke)

  test('server cannot decrypt envelope-encrypted data via server key', async () => {
    const serverPubkey = await crypto.getServerPubkey()

    // Encrypt name for server (in practice: server + admin)
    const { encrypted } = await crypto.envelopeEncrypt('Jane Smith', [serverPubkey], LABEL_USER_PII)

    // Server-key decryption CANNOT read envelope-encrypted data
    // (different encryption scheme: symmetric-derived vs HPKE)
    await expect(crypto.serverDecrypt(encrypted, LABEL_USER_PII)).rejects.toThrow()
  })

  test('server CAN decrypt its own HPKE envelope', async () => {
    const serverPubkey = await crypto.getServerPubkey()

    const { encrypted, envelopes } = await crypto.envelopeEncrypt(
      'Jane Smith',
      [serverPubkey],
      LABEL_USER_PII
    )

    const decrypted = await crypto.envelopeDecrypt(encrypted, envelopes[0], LABEL_USER_PII)
    expect(decrypted).toBe('Jane Smith')
  })

  test('server CAN decrypt server-key encrypted data', async () => {
    const ct = await crypto.serverEncrypt('+15551234567', LABEL_USER_PII)
    const pt = await crypto.serverDecrypt(ct, LABEL_USER_PII)
    expect(pt).toBe('+15551234567')
  })
})
