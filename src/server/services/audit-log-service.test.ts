/**
 * Unit tests for AuditLogService.appendSigned — the Tier 0 high-assurance
 * audit chain append path. Verifies chain integrity, entry-hash recomputation,
 * schnorr signature verification, and signer authorization via a stubbed
 * database and user lookup. See Tier 0 plan Task 19.
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
import { AuditLogService, type AuditSignerLookup } from './audit-log-service'

// ---- fixtures ----

const ADMIN_PRIVKEY = 'a1'.repeat(32)
const ADMIN_PUBKEY = bytesToHex(schnorr.getPublicKey(hexToBytes(ADMIN_PRIVKEY)))
const VOLUNTEER_PRIVKEY = 'b2'.repeat(32)
const VOLUNTEER_PUBKEY = bytesToHex(schnorr.getPublicKey(hexToBytes(VOLUNTEER_PRIVKEY)))

const HUB_ID = '11111111-1111-4111-8111-111111111111'
const USER_UUID = '22222222-2222-4222-8222-222222222222'

function signEntry(privkeyHex: string, base: UnsignedAuditEntry): SignedAuditEntry {
  const entryHash = computeEntryHash(base)
  const signature = bytesToHex(schnorr.sign(hexToBytes(entryHash), hexToBytes(privkeyHex)))
  return { ...base, entryHash, signature }
}

function membershipAddEntry(
  privkeyHex: string,
  pubkeyHex: string,
  prevEntryHash: string | null
): SignedAuditEntry {
  return signEntry(privkeyHex, {
    id: crypto.randomUUID(),
    hubId: HUB_ID,
    payload: {
      type: 'membership_add',
      userId: USER_UUID,
      pubkey: '00'.repeat(32),
      role: 'volunteer',
    } satisfies AuditEntryPayload,
    prevEntryHash,
    createdAt: new Date().toISOString(),
    signerDeviceId: 'device-1',
    signerPubkey: pubkeyHex,
  })
}

function hubDeleteEntry(
  privkeyHex: string,
  pubkeyHex: string,
  prevEntryHash: string | null
): SignedAuditEntry {
  return signEntry(privkeyHex, {
    id: crypto.randomUUID(),
    hubId: HUB_ID,
    payload: {
      type: 'hub_delete',
      hubId: HUB_ID,
    },
    prevEntryHash,
    createdAt: new Date().toISOString(),
    signerDeviceId: 'device-1',
    signerPubkey: pubkeyHex,
  })
}

// ---- in-memory fakes ----

class FakeStore {
  entries: SignedAuditEntry[] = []

  getHead(hubId: string): Promise<SignedAuditEntry | null> {
    const forHub = this.entries.filter((e) => e.hubId === hubId)
    return Promise.resolve(forHub[forHub.length - 1] ?? null)
  }

  insert(entry: SignedAuditEntry): Promise<void> {
    this.entries.push(entry)
    return Promise.resolve()
  }
}

function makeService(store: FakeStore, signerLookup: AuditSignerLookup): AuditLogService {
  return new AuditLogService({
    getHead: (hubId) => store.getHead(hubId),
    insert: (entry) => store.insert(entry),
    findSignerByPubkey: signerLookup,
  })
}

// ---- tests ----

describe('AuditLogService.appendSigned', () => {
  let store: FakeStore
  let signerLookup: AuditSignerLookup

  beforeEach(() => {
    store = new FakeStore()
    signerLookup = async (pubkey) => {
      if (pubkey === ADMIN_PUBKEY) return { id: USER_UUID, role: 'admin' }
      if (pubkey === VOLUNTEER_PUBKEY) return { id: USER_UUID, role: 'volunteer' }
      return null
    }
  })

  test('happy path: admin appends valid membership_add entry', async () => {
    const service = makeService(store, signerLookup)
    const entry = membershipAddEntry(ADMIN_PRIVKEY, ADMIN_PUBKEY, null)
    await service.appendSigned(entry)
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].id).toBe(entry.id)
  })

  test('happy path: second entry links to first via prevEntryHash', async () => {
    const service = makeService(store, signerLookup)
    const first = membershipAddEntry(ADMIN_PRIVKEY, ADMIN_PUBKEY, null)
    await service.appendSigned(first)
    const second = membershipAddEntry(ADMIN_PRIVKEY, ADMIN_PUBKEY, first.entryHash)
    await service.appendSigned(second)
    expect(store.entries).toHaveLength(2)
    expect(store.entries[1].prevEntryHash).toBe(first.entryHash)
  })

  test('rejects entry with prev_entry_hash mismatch', async () => {
    const service = makeService(store, signerLookup)
    const first = membershipAddEntry(ADMIN_PRIVKEY, ADMIN_PUBKEY, null)
    await service.appendSigned(first)
    const wrongPrev = 'ff'.repeat(32)
    const second = membershipAddEntry(ADMIN_PRIVKEY, ADMIN_PUBKEY, wrongPrev)
    await expect(service.appendSigned(second)).rejects.toMatchObject({
      name: 'AuditChainError',
      code: 'prev_entry_hash_mismatch',
    })
    expect(store.entries).toHaveLength(1)
  })

  test('rejects entry whose entryHash does not match recomputed hash', async () => {
    const service = makeService(store, signerLookup)
    const entry = membershipAddEntry(ADMIN_PRIVKEY, ADMIN_PUBKEY, null)
    const tampered: SignedAuditEntry = { ...entry, entryHash: '0'.repeat(64) }
    await expect(service.appendSigned(tampered)).rejects.toMatchObject({
      name: 'AuditChainError',
      code: 'entry_hash_mismatch',
    })
  })

  test('rejects entry with invalid signature', async () => {
    const service = makeService(store, signerLookup)
    const entry = membershipAddEntry(ADMIN_PRIVKEY, ADMIN_PUBKEY, null)
    // Swap signer pubkey to volunteer (signature no longer verifies for same entry hash)
    // But to avoid entry-hash mismatch we re-sign with a different private key as admin pubkey
    const wrongSig = bytesToHex(
      schnorr.sign(hexToBytes(entry.entryHash), hexToBytes(VOLUNTEER_PRIVKEY))
    )
    const bad: SignedAuditEntry = { ...entry, signature: wrongSig }
    await expect(service.appendSigned(bad)).rejects.toMatchObject({
      name: 'AuditChainError',
      code: 'signature_invalid',
    })
  })

  test('rejects entry from unknown signer', async () => {
    const service = makeService(store, signerLookup)
    const strangerPriv = 'cc'.repeat(32)
    const strangerPub = bytesToHex(schnorr.getPublicKey(hexToBytes(strangerPriv)))
    const entry = membershipAddEntry(strangerPriv, strangerPub, null)
    await expect(service.appendSigned(entry)).rejects.toMatchObject({
      name: 'AuditChainError',
      code: 'signer_unknown',
    })
  })

  test('rejects volunteer trying to append hub_delete', async () => {
    const service = makeService(store, signerLookup)
    const entry = hubDeleteEntry(VOLUNTEER_PRIVKEY, VOLUNTEER_PUBKEY, null)
    await expect(service.appendSigned(entry)).rejects.toMatchObject({
      name: 'AuditChainError',
      code: 'signer_not_authorized_for_payload',
    })
  })

  test('rejects admin trying to append hub_create (super_admin only)', async () => {
    const service = makeService(store, signerLookup)
    const base: UnsignedAuditEntry = {
      id: crypto.randomUUID(),
      hubId: HUB_ID,
      payload: { type: 'hub_create', hubId: HUB_ID, founderPubkey: '00'.repeat(32) },
      prevEntryHash: null,
      createdAt: new Date().toISOString(),
      signerDeviceId: 'device-1',
      signerPubkey: ADMIN_PUBKEY,
    }
    const entry = signEntry(ADMIN_PRIVKEY, base)
    await expect(service.appendSigned(entry)).rejects.toMatchObject({
      name: 'AuditChainError',
      code: 'signer_not_authorized_for_payload',
    })
  })

  test('translates postgres unique-violation from insert into chain_conflict', async () => {
    // Simulates migration 0052's UNIQUE(hub_id, prev_entry_hash) firing when
    // two appenders race on the same head. The error-code surface matches what
    // bun:sql / postgres.js raise for SQLSTATE 23505.
    const conflictingStore = {
      getHead: (_hubId: string) => Promise.resolve(null),
      insert: (_entry: SignedAuditEntry) => {
        const err = new Error('duplicate key value violates unique constraint') as Error & {
          code: string
          constraint_name: string
        }
        err.code = '23505'
        err.constraint_name = 'signed_audit_entries_hub_prev_hash_unique'
        throw err
      },
    }
    const service = new AuditLogService({
      getHead: conflictingStore.getHead,
      insert: conflictingStore.insert,
      findSignerByPubkey: signerLookup,
    })
    const entry = membershipAddEntry(ADMIN_PRIVKEY, ADMIN_PUBKEY, null)
    await expect(service.appendSigned(entry)).rejects.toMatchObject({
      name: 'AuditChainError',
      code: 'chain_conflict',
    })
  })

  test('rejects malformed entry (zod validation failure)', async () => {
    const service = makeService(store, signerLookup)
    const malformed = {
      id: 'not-a-uuid',
      hubId: HUB_ID,
      payload: { type: 'membership_remove', userId: USER_UUID },
      prevEntryHash: null,
      entryHash: '0'.repeat(64),
      signerDeviceId: 'd',
      signerPubkey: ADMIN_PUBKEY,
      signature: '0'.repeat(128),
      createdAt: new Date().toISOString(),
    } as unknown as SignedAuditEntry
    await expect(service.appendSigned(malformed)).rejects.toThrow()
  })
})
