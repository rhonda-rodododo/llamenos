import { afterEach, describe, expect, mock, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
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

// Isolate from auth-facade-client mocks in other test files (e.g.
// unlock-factors.test.ts) that strip getAccessToken from the exported
// authFacadeClient. Without this, getAuthHeaders() throws
// "getAccessToken is not a function" when those mocks leak into this file.
mock.module('./auth-facade-client', () => ({
  authFacadeClient: {
    getAccessToken: () => null,
    setAccessToken: () => {},
    clearAccessToken: () => {},
  },
}))

const {
  logMlsGroupInit,
  logMlsMembersAdded,
  logMlsMembersRemoved,
  logMlsPathUpdate,
  logMlsEpochPurge,
  logMlsCiphersuiteUpgradePlanned,
  logMlsCiphersuiteUpgradeCompleted,
} = await import('./audit-log-client')

const UUID = '00000000-0000-4000-8000-000000000001'
const DEVICE_ID = 'device-abc'

function mockFetchWithHead(headHash: string | null): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/audit/head')) {
      return new Response(JSON.stringify({ entryHash: headHash }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (init?.method === 'POST' && url.includes('/audit')) {
      return new Response('{}', { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as typeof globalThis.fetch
}

describe('MLS audit helpers', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    mockGetPublicKey.mockClear()
    mockSignAuditEntry.mockClear()
  })

  describe('logMlsGroupInit', () => {
    test('creates signed mls_group_init entry with correct payload', async () => {
      globalThis.fetch = mockFetchWithHead(null)

      const entry = await logMlsGroupInit({
        hubId: UUID,
        groupId: 'llamenos:hub:test',
        ciphersuite: 1,
        creatorDeviceId: DEVICE_ID,
      })

      expect(entry.payload.type).toBe('mls_group_init')
      expect((entry.payload as Record<string, unknown>).hubId).toBe(UUID)
      expect((entry.payload as Record<string, unknown>).groupId).toBe('llamenos:hub:test')
      expect((entry.payload as Record<string, unknown>).ciphersuite).toBe(1)
      expect((entry.payload as Record<string, unknown>).creatorDeviceId).toBe(DEVICE_ID)
      expect((entry.payload as Record<string, unknown>).epoch).toBe(0)
      expect(entry.signerDeviceId).toBe(DEVICE_ID)
      expect(entry.entryHash).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.signature).toMatch(/^[0-9a-f]{128}$/)
    })

    test('links to previous audit head', async () => {
      const prevHash = 'cd'.repeat(32)
      globalThis.fetch = mockFetchWithHead(prevHash)

      const entry = await logMlsGroupInit({
        hubId: UUID,
        groupId: 'llamenos:hub:test',
        ciphersuite: 1,
        creatorDeviceId: DEVICE_ID,
      })

      expect(entry.prevEntryHash).toBe(prevHash)
    })
  })

  describe('logMlsMembersAdded', () => {
    test('creates signed mls_members_added entry', async () => {
      globalThis.fetch = mockFetchWithHead(null)

      const entry = await logMlsMembersAdded({
        hubId: UUID,
        addedDeviceIds: ['dev-a', 'dev-b'],
        epoch: 3,
        committerId: DEVICE_ID,
      })

      expect(entry.payload.type).toBe('mls_members_added')
      expect((entry.payload as Record<string, unknown>).hubId).toBe(UUID)
      expect((entry.payload as Record<string, unknown>).addedDeviceIds).toEqual(['dev-a', 'dev-b'])
      expect((entry.payload as Record<string, unknown>).epoch).toBe(3)
      expect((entry.payload as Record<string, unknown>).committerId).toBe(DEVICE_ID)
      expect(entry.signerDeviceId).toBe(DEVICE_ID)
    })
  })

  describe('logMlsMembersRemoved', () => {
    test('creates signed mls_members_removed entry', async () => {
      globalThis.fetch = mockFetchWithHead(null)

      const entry = await logMlsMembersRemoved({
        hubId: UUID,
        removedDeviceIds: ['dev-x'],
        epoch: 5,
        committerId: DEVICE_ID,
      })

      expect(entry.payload.type).toBe('mls_members_removed')
      expect((entry.payload as Record<string, unknown>).hubId).toBe(UUID)
      expect((entry.payload as Record<string, unknown>).removedDeviceIds).toEqual(['dev-x'])
      expect((entry.payload as Record<string, unknown>).epoch).toBe(5)
      expect((entry.payload as Record<string, unknown>).committerId).toBe(DEVICE_ID)
    })
  })

  describe('logMlsPathUpdate', () => {
    test('creates signed mls_path_update entry', async () => {
      globalThis.fetch = mockFetchWithHead(null)

      const entry = await logMlsPathUpdate({
        hubId: UUID,
        epoch: 7,
        updaterId: DEVICE_ID,
      })

      expect(entry.payload.type).toBe('mls_path_update')
      expect((entry.payload as Record<string, unknown>).hubId).toBe(UUID)
      expect((entry.payload as Record<string, unknown>).epoch).toBe(7)
      expect((entry.payload as Record<string, unknown>).updaterId).toBe(DEVICE_ID)
    })
  })

  describe('logMlsEpochPurge', () => {
    test('creates signed mls_epoch_purge entry', async () => {
      globalThis.fetch = mockFetchWithHead(null)

      const entry = await logMlsEpochPurge({
        hubId: UUID,
        purgedEpochRange: '1-10',
        reason: 'routine cleanup',
        signerDeviceId: DEVICE_ID,
      })

      expect(entry.payload.type).toBe('mls_epoch_purge')
      expect((entry.payload as Record<string, unknown>).hubId).toBe(UUID)
      expect((entry.payload as Record<string, unknown>).purgedEpochRange).toBe('1-10')
      expect((entry.payload as Record<string, unknown>).reason).toBe('routine cleanup')
    })
  })

  describe('logMlsCiphersuiteUpgradePlanned', () => {
    test('creates signed mls_ciphersuite_upgrade_planned entry', async () => {
      globalThis.fetch = mockFetchWithHead(null)

      const entry = await logMlsCiphersuiteUpgradePlanned({
        hubId: UUID,
        fromCs: 1,
        toCs: 3,
        targetDate: '2026-05-01',
        signerDeviceId: DEVICE_ID,
      })

      expect(entry.payload.type).toBe('mls_ciphersuite_upgrade_planned')
      expect((entry.payload as Record<string, unknown>).hubId).toBe(UUID)
      expect((entry.payload as Record<string, unknown>).fromCs).toBe(1)
      expect((entry.payload as Record<string, unknown>).toCs).toBe(3)
      expect((entry.payload as Record<string, unknown>).targetDate).toBe('2026-05-01')
    })
  })

  describe('logMlsCiphersuiteUpgradeCompleted', () => {
    test('creates signed mls_ciphersuite_upgrade_completed entry', async () => {
      globalThis.fetch = mockFetchWithHead(null)

      const entry = await logMlsCiphersuiteUpgradeCompleted({
        hubId: UUID,
        fromCs: 1,
        toCs: 3,
        epoch: 12,
        signerDeviceId: DEVICE_ID,
      })

      expect(entry.payload.type).toBe('mls_ciphersuite_upgrade_completed')
      expect((entry.payload as Record<string, unknown>).hubId).toBe(UUID)
      expect((entry.payload as Record<string, unknown>).fromCs).toBe(1)
      expect((entry.payload as Record<string, unknown>).toCs).toBe(3)
      expect((entry.payload as Record<string, unknown>).epoch).toBe(12)
    })
  })

  describe('signature verification', () => {
    test('all MLS entries have verifiable Schnorr signatures', async () => {
      globalThis.fetch = mockFetchWithHead(null)

      const entry = await logMlsGroupInit({
        hubId: UUID,
        groupId: 'llamenos:hub:test',
        ciphersuite: 1,
        creatorDeviceId: DEVICE_ID,
      })

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
  })
})
