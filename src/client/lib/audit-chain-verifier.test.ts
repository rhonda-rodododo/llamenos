/**
 * Adversarial tests for audit-chain-verifier — Tier 0 Task 21.
 * Verifies chain-hash links, entry-hash recomputation, schnorr signatures,
 * trust-set maintenance via device_add/device_revoke, and IDB-backed
 * incremental verification. Uses in-process fetch + cache store stubs
 * so the verifier never touches a real network or IDB.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import type { AuditEntryPayload, SignedAuditEntry } from '@shared/schemas/audit-entries'
import {
  type ChainCacheRow,
  type ChainCacheStore,
  ChainVerificationError,
  verifyAuditChain,
} from './audit-chain-verifier'

// ---- fixtures ----

const HUB_ID = '11111111-1111-4111-8111-111111111111'
const USER_A = '22222222-2222-4222-8222-222222222222'
const USER_B = '33333333-3333-4333-8333-333333333333'

const ADMIN_PRIV = 'a1'.repeat(32)
const ADMIN_PUB = bytesToHex(schnorr.getPublicKey(hexToBytes(ADMIN_PRIV)))
const STRANGER_PRIV = 'cc'.repeat(32)
const STRANGER_PUB = bytesToHex(schnorr.getPublicKey(hexToBytes(STRANGER_PRIV)))
const DEVICE_PRIV = 'dd'.repeat(32)
const DEVICE_PUB = bytesToHex(schnorr.getPublicKey(hexToBytes(DEVICE_PRIV)))

function signEntry(
  privHex: string,
  base: Omit<SignedAuditEntry, 'entryHash' | 'signature'>
): SignedAuditEntry {
  const entryHash = computeEntryHash(base)
  const signature = bytesToHex(schnorr.sign(hexToBytes(entryHash), hexToBytes(privHex)))
  return { ...base, entryHash, signature }
}

function makeEntry(
  privHex: string,
  pubHex: string,
  prevEntryHash: string | null,
  payload: AuditEntryPayload,
  createdAtMs: number
): SignedAuditEntry {
  return signEntry(privHex, {
    id: crypto.randomUUID(),
    hubId: HUB_ID,
    payload,
    prevEntryHash,
    createdAt: new Date(createdAtMs).toISOString(),
    signerDeviceId: 'device-1',
    signerPubkey: pubHex,
  })
}

function buildChain(length: number, signer = { priv: ADMIN_PRIV, pub: ADMIN_PUB }) {
  const entries: SignedAuditEntry[] = []
  let prev: string | null = null
  const t0 = Date.parse('2026-04-11T00:00:00.000Z')
  for (let i = 0; i < length; i++) {
    const e = makeEntry(
      signer.priv,
      signer.pub,
      prev,
      { type: 'membership_add', userId: USER_A, pubkey: '00'.repeat(32), role: 'volunteer' },
      t0 + i * 1000
    )
    entries.push(e)
    prev = e.entryHash
  }
  return entries
}

// ---- stub cache store (in-memory) ----

class MemoryCacheStore implements ChainCacheStore {
  rows = new Map<string, ChainCacheRow>()
  get(hubId: string): Promise<ChainCacheRow | null> {
    return Promise.resolve(this.rows.get(hubId) ?? null)
  }
  put(row: ChainCacheRow): Promise<void> {
    this.rows.set(row.hubId, row)
    return Promise.resolve()
  }
  delete(hubId: string): Promise<void> {
    this.rows.delete(hubId)
    return Promise.resolve()
  }
}

// ---- stub fetcher ----

function stubFetchFrom(all: SignedAuditEntry[]) {
  return async (_hubId: string, since: string | null) => {
    if (since === null) return [...all]
    const idx = all.findIndex((e) => e.entryHash === since)
    if (idx < 0) return [...all]
    return all.slice(idx + 1)
  }
}

// ---- tests ----

describe('verifyAuditChain', () => {
  let cache: MemoryCacheStore

  beforeEach(() => {
    cache = new MemoryCacheStore()
  })

  test('verifies a valid 10-entry chain', async () => {
    const entries = buildChain(10)
    const head = await verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
      fetchEntriesSince: stubFetchFrom(entries),
      cacheStore: cache,
    })
    expect(head.entryHash).toBe(entries[9].entryHash)
    const row = await cache.get(HUB_ID)
    expect(row?.lastVerifiedEntryHash).toBe(entries[9].entryHash)
    expect(row?.trustedDevicePubkeys).toContain(ADMIN_PUB)
  })

  test('rejects divergent prevEntryHash', async () => {
    const entries = buildChain(5)
    // Tamper in-place with a field that doesn't feed entryHash — then re-hash
    // so the entry is internally consistent but the chain link is broken.
    const tampered = entries.map((e, i) =>
      i === 3 ? signEntry(ADMIN_PRIV, { ...e, prevEntryHash: 'ab'.repeat(32) }) : e
    )
    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(tampered),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'prev_entry_hash_mismatch',
    })
  })

  test('rejects tampered entryHash', async () => {
    const entries = buildChain(5)
    const bad = [...entries]
    bad[3] = { ...bad[3], entryHash: 'cd'.repeat(32) }
    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(bad),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'entry_hash_mismatch',
    })
  })

  test('rejects forged signature (wrong signer)', async () => {
    const entries = buildChain(3)
    // Re-sign entry 1 with stranger's privkey but keep admin pubkey in the
    // entry — the hash matches but signature verification fails.
    const forged = { ...entries[1] }
    forged.signature = bytesToHex(
      schnorr.sign(hexToBytes(forged.entryHash), hexToBytes(STRANGER_PRIV))
    )
    const bad = [entries[0], forged, entries[2]]
    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(bad),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'signature_invalid',
    })
  })

  test('rejects unknown signer', async () => {
    const entries = buildChain(3, { priv: STRANGER_PRIV, pub: STRANGER_PUB })
    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(entries),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'signer_not_trusted',
    })
  })

  test('device_add extends the trust set', async () => {
    const t0 = Date.parse('2026-04-11T00:00:00.000Z')
    const e1 = makeEntry(
      ADMIN_PRIV,
      ADMIN_PUB,
      null,
      { type: 'device_add', userId: USER_A, devicePubkey: DEVICE_PUB },
      t0
    )
    // Second entry signed by the newly-trusted device.
    const e2 = makeEntry(
      DEVICE_PRIV,
      DEVICE_PUB,
      e1.entryHash,
      { type: 'membership_add', userId: USER_B, pubkey: '00'.repeat(32), role: 'volunteer' },
      t0 + 1000
    )
    const head = await verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
      fetchEntriesSince: stubFetchFrom([e1, e2]),
      cacheStore: cache,
    })
    expect(head.entryHash).toBe(e2.entryHash)
    const row = await cache.get(HUB_ID)
    expect(row?.trustedDevicePubkeys).toContain(DEVICE_PUB)
  })

  test('device_revoke removes from trust set', async () => {
    const t0 = Date.parse('2026-04-11T00:00:00.000Z')
    const e1 = makeEntry(
      ADMIN_PRIV,
      ADMIN_PUB,
      null,
      { type: 'device_add', userId: USER_A, devicePubkey: DEVICE_PUB },
      t0
    )
    const e2 = makeEntry(
      ADMIN_PRIV,
      ADMIN_PUB,
      e1.entryHash,
      { type: 'device_revoke', userId: USER_A, devicePubkey: DEVICE_PUB },
      t0 + 1000
    )
    // Third entry signed by the revoked device — must be rejected.
    const e3 = makeEntry(
      DEVICE_PRIV,
      DEVICE_PUB,
      e2.entryHash,
      { type: 'membership_add', userId: USER_B, pubkey: '00'.repeat(32), role: 'volunteer' },
      t0 + 2000
    )
    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom([e1, e2, e3]),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'signer_not_trusted',
    })
  })

  test('incremental verification reads only delta after first call', async () => {
    const entries = buildChain(5)
    let fetchCalls: Array<string | null> = []
    const fetchImpl = async (_hubId: string, since: string | null) => {
      fetchCalls.push(since)
      if (since === null) return [...entries]
      const idx = entries.findIndex((e) => e.entryHash === since)
      return entries.slice(idx + 1)
    }

    const head1 = await verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
      fetchEntriesSince: fetchImpl,
      cacheStore: cache,
    })
    expect(head1.entryHash).toBe(entries[4].entryHash)
    expect(fetchCalls).toEqual([null])

    // Second call with no new entries — should fetch since head and get [].
    // verifyAuditChain must still return the cached head.
    fetchCalls = []
    const head2 = await verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
      fetchEntriesSince: fetchImpl,
      cacheStore: cache,
    })
    expect(head2.entryHash).toBe(entries[4].entryHash)
    expect(fetchCalls).toEqual([entries[4].entryHash])
  })
})
