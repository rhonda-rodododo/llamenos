import { describe, expect, mock, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
// Import the real module eagerly so the mock below can preserve every real
// export (isWorkerLockedError, CryptoWorkerLockedError, CryptoWorkerClient)
// and only override `cryptoWorker`. Without this, bun's process-wide
// mock.module would strip the named exports and break sibling test files
// (crypto-worker-client.test.ts, decrypt-fields.test.ts) that import them.
import * as realCryptoWorkerClient from './crypto-worker-client'

const TEST_PRIVKEY = 'ab'.repeat(32)
const TEST_PUBKEY = bytesToHex(schnorr.getPublicKey(hexToBytes(TEST_PRIVKEY)))

const mockGetPublicKey = mock(async (): Promise<string | null> => TEST_PUBKEY)
const mockSignAuditEntry = mock(async (entryHashHex: string) => {
  const sig = schnorr.sign(hexToBytes(entryHashHex), hexToBytes(TEST_PRIVKEY))
  return bytesToHex(sig)
})

mock.module('./crypto-worker-client', () => ({
  ...realCryptoWorkerClient,
  cryptoWorker: {
    getPublicKey: mockGetPublicKey,
    signAuditEntry: mockSignAuditEntry,
  },
}))

const { buildSignedAuditEntry } = await import('./audit-log-client')

const HEX64 = 'cd'.repeat(32)
const UUID = '00000000-0000-4000-8000-000000000001'

describe('buildSignedAuditEntry', () => {
  test('constructs a valid SignedAuditEntry with correct hash and signature', async () => {
    const entry = await buildSignedAuditEntry({
      hubId: UUID,
      payload: { type: 'membership_add', userId: UUID, pubkey: HEX64, role: 'volunteer' },
      prevEntryHash: null,
      signerDeviceId: 'device-1',
    })

    expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(entry.hubId).toBe(UUID)
    expect(entry.payload.type).toBe('membership_add')
    expect(entry.prevEntryHash).toBeNull()
    expect(entry.signerPubkey).toBe(TEST_PUBKEY)
    expect(entry.entryHash).toMatch(/^[0-9a-f]{64}$/)
    expect(entry.signature).toMatch(/^[0-9a-f]{128}$/)

    const recomputedHash = computeEntryHash({
      id: entry.id,
      hubId: entry.hubId,
      payload: entry.payload,
      prevEntryHash: entry.prevEntryHash,
      createdAt: entry.createdAt,
      signerDeviceId: entry.signerDeviceId,
      signerPubkey: entry.signerPubkey,
    })
    expect(entry.entryHash).toBe(recomputedHash)

    const valid = schnorr.verify(
      hexToBytes(entry.signature),
      hexToBytes(entry.entryHash),
      hexToBytes(entry.signerPubkey)
    )
    expect(valid).toBe(true)
  })

  test('prevEntryHash is threaded through', async () => {
    const prevHash = 'ef'.repeat(32)
    const entry = await buildSignedAuditEntry({
      hubId: UUID,
      payload: { type: 'membership_remove', userId: UUID },
      prevEntryHash: prevHash,
      signerDeviceId: 'device-1',
    })
    expect(entry.prevEntryHash).toBe(prevHash)
  })

  test('throws when crypto worker is locked', async () => {
    mockGetPublicKey.mockImplementationOnce(async () => null)
    await expect(
      buildSignedAuditEntry({
        hubId: UUID,
        payload: { type: 'hub_delete', hubId: UUID },
        prevEntryHash: null,
        signerDeviceId: 'device-1',
      })
    ).rejects.toThrow('Crypto worker not unlocked')
  })
})
