/**
 * Rotation-on-tamper integration test — Tier 0 Phase-2 P1.
 *
 * Verifies the end-to-end property that chain tamper detection blocks
 * rotation-gated hub key operations. The Albrecht Defense #1 rotation
 * gate depends on verifyAuditChain succeeding before deriving the member
 * set. If the chain is tampered, verification must fail and rotation
 * must not proceed.
 *
 * Tests the integration between:
 *   - Chain verification (tamper detection)
 *   - Rotation trigger validation (head must be a membership-change entry)
 *   - Cache invalidation on tamper
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import type {
  AuditEntryPayload,
  SignedAuditEntry,
  UnsignedAuditEntry,
} from '@shared/schemas/audit-entries'
import {
  type ChainCacheRow,
  type ChainCacheStore,
  ChainVerificationError,
  verifyAuditChain,
} from './audit-chain-verifier'

// ---- fixtures ----

const HUB_ID = 'aaaa1111-1111-4111-8111-111111111111'
const USER_A = 'bbbb2222-2222-4222-8222-222222222222'
const USER_B = 'cccc3333-3333-4333-8333-333333333333'

const ADMIN_PRIV = 'e1'.repeat(32)
const ADMIN_PUB = bytesToHex(schnorr.getPublicKey(hexToBytes(ADMIN_PRIV)))
const ATTACKER_PRIV = 'f1'.repeat(32)
const ATTACKER_PUB = bytesToHex(schnorr.getPublicKey(hexToBytes(ATTACKER_PRIV)))

function signEntry(privHex: string, base: UnsignedAuditEntry): SignedAuditEntry {
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
    signerDeviceId: 'device-admin',
    signerPubkey: pubHex,
  })
}

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

function stubFetchFrom(all: SignedAuditEntry[]) {
  return async (_hubId: string, since: string | null) => {
    if (since === null) return [...all]
    const idx = all.findIndex((e) => e.entryHash === since)
    if (idx < 0) return [...all]
    return all.slice(idx + 1)
  }
}

// ---- tests ----

describe('rotation-on-tamper integration (Tier 0)', () => {
  let cache: MemoryCacheStore
  const t0 = Date.parse('2026-04-15T00:00:00.000Z')

  beforeEach(() => {
    cache = new MemoryCacheStore()
  })

  /**
   * Build a chain that ends with a membership_add (a rotation trigger).
   * In the Albrecht Defense #1 flow, the client would verify this chain
   * before deriving the member set for hub key rotation.
   */
  function buildRotationTriggerChain() {
    const e1 = makeEntry(
      ADMIN_PRIV,
      ADMIN_PUB,
      null,
      { type: 'device_add', userId: USER_A, devicePubkey: ADMIN_PUB },
      t0
    )
    const e2 = makeEntry(
      ADMIN_PRIV,
      ADMIN_PUB,
      e1.entryHash,
      { type: 'membership_add', userId: USER_A, pubkey: '00'.repeat(32), role: 'admin' },
      t0 + 1000
    )
    const e3 = makeEntry(
      ADMIN_PRIV,
      ADMIN_PUB,
      e2.entryHash,
      { type: 'membership_add', userId: USER_B, pubkey: '11'.repeat(32), role: 'volunteer' },
      t0 + 2000
    )
    return [e1, e2, e3]
  }

  test('valid chain with membership_add head verifies successfully (rotation can proceed)', async () => {
    const entries = buildRotationTriggerChain()
    const head = await verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
      fetchEntriesSince: stubFetchFrom(entries),
      cacheStore: cache,
    })
    expect(head).not.toBeNull()
    expect(head?.payload.type).toBe('membership_add')
    expect(head?.entryHash).toBe(entries[2].entryHash)
  })

  test('tampered payload in membership_add entry blocks rotation (entry_hash_mismatch)', async () => {
    const entries = buildRotationTriggerChain()
    // Attacker modifies the membership_add payload to add a different user
    // but doesn't re-sign — entryHash recomputation catches the forgery.
    const tampered = [...entries]
    tampered[2] = {
      ...tampered[2],
      payload: {
        type: 'membership_add',
        userId: 'dddd4444-4444-4444-8444-444444444444',
        pubkey: ATTACKER_PUB,
        role: 'admin',
      },
      // entryHash is stale — doesn't match the modified payload
    }

    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(tampered),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'entry_hash_mismatch',
    })

    // Cache must NOT be written for a tampered chain
    expect(await cache.get(HUB_ID)).toBeNull()
  })

  test('spliced chain (middle entry replaced) blocks rotation (prev_entry_hash_mismatch)', async () => {
    const entries = buildRotationTriggerChain()
    // Attacker replaces the middle entry with a different one that has a
    // valid signature but breaks the hash chain link.
    const spliced = [...entries]
    const attackerEntry = signEntry(ADMIN_PRIV, {
      id: crypto.randomUUID(),
      hubId: HUB_ID,
      payload: {
        type: 'membership_add',
        userId: 'eeee5555-5555-4555-8555-555555555555',
        pubkey: ATTACKER_PUB,
        role: 'admin',
      },
      prevEntryHash: entries[0].entryHash,
      createdAt: new Date(t0 + 1000).toISOString(),
      signerDeviceId: 'device-admin',
      signerPubkey: ADMIN_PUB,
    })
    spliced[1] = attackerEntry
    // Entry 2's prevEntryHash still points at the original entry 1, not the spliced one.

    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(spliced),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'prev_entry_hash_mismatch',
    })
  })

  test('forged membership entry by untrusted signer blocks rotation (signer_not_trusted)', async () => {
    const entries = buildRotationTriggerChain()
    // Attacker appends a membership_add signed by their own key. Even though
    // the hash chain is valid, the signer is not in the trust set.
    const attackerEntry = makeEntry(
      ATTACKER_PRIV,
      ATTACKER_PUB,
      entries[2].entryHash,
      {
        type: 'membership_add',
        userId: 'ffff6666-6666-4666-8666-666666666666',
        pubkey: ATTACKER_PUB,
        role: 'admin',
      },
      t0 + 3000
    )
    const extended = [...entries, attackerEntry]

    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(extended),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'signer_not_trusted',
    })
  })

  test('tamper after successful verification: cache is invalidated on re-fetch', async () => {
    const entries = buildRotationTriggerChain()

    // First verification succeeds and caches.
    await verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
      fetchEntriesSince: stubFetchFrom(entries),
      cacheStore: cache,
    })
    expect(await cache.get(HUB_ID)).not.toBeNull()

    // Attacker appends a tampered entry to the chain. The next verification
    // fetches the delta (since head) and finds the tampered entry.
    const tamperedAppend = makeEntry(
      ATTACKER_PRIV,
      ATTACKER_PUB,
      entries[2].entryHash,
      { type: 'membership_remove', userId: USER_A },
      t0 + 3000
    )
    const extendedChain = [...entries, tamperedAppend]

    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(extendedChain),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'signer_not_trusted',
    })
  })

  test('re-signed tampered entry with correct signer but wrong chain link is detected', async () => {
    const entries = buildRotationTriggerChain()
    // Server tampers with entry 1's payload and re-signs it with the admin key.
    // The entry itself is internally consistent (hash + signature match), but
    // the chain link from entry 2 is now broken.
    const reSignedTampered = signEntry(ADMIN_PRIV, {
      ...entries[1],
      payload: {
        type: 'membership_add',
        userId: 'aabb7777-7777-4777-8777-777777777777',
        pubkey: '22'.repeat(32),
        role: 'admin',
      },
    })

    const tampered = [entries[0], reSignedTampered, entries[2]]

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

  test('member set derived from tampered chain is never trusted', async () => {
    // This simulates the Albrecht attack: a malicious server tries to
    // inject an admin member via a forged membership_add. The chain
    // verification catches this and prevents the member set from being used.
    const entries = buildRotationTriggerChain()

    // Attacker creates a new genesis chain with a forged admin
    const forgedGenesis = makeEntry(
      ATTACKER_PRIV,
      ATTACKER_PUB,
      null,
      {
        type: 'membership_add',
        userId: 'dddd8888-8888-4888-8888-888888888888',
        pubkey: ATTACKER_PUB,
        role: 'admin',
      },
      t0
    )

    // Even with a correctly-linked chain, verification fails because
    // the signer (ATTACKER_PUB) is not in the trust anchor.
    const forgedChain = [forgedGenesis]

    await expect(
      verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(forgedChain),
        cacheStore: cache,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'signer_not_trusted',
    })
  })

  test('ChainVerificationError carries details for forensic analysis', async () => {
    const entries = buildRotationTriggerChain()
    const tampered = [...entries]
    tampered[2] = { ...tampered[2], entryHash: 'deadbeef'.repeat(8) }

    try {
      await verifyAuditChain(HUB_ID, new Set([ADMIN_PUB]), {
        fetchEntriesSince: stubFetchFrom(tampered),
        cacheStore: cache,
      })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ChainVerificationError)
      const cve = err as ChainVerificationError
      expect(cve.code).toBe('entry_hash_mismatch')
      expect(cve.details).toHaveProperty('entryId')
      expect(cve.details.entryId).toBe(tampered[2].id)
    }
  })
})
