/**
 * Tier 0 signed audit chain — API E2E.
 *
 * Exercises POST /api/hubs/:hubId/audit (append signed entry) and
 * GET /api/hubs/:hubId/audit/signed (list / delta) against a live server.
 *
 * Covers:
 *   1. Happy-path append with prev=null and a signer whose users.roles resolve
 *      to `super_admin` via rolesToCanonical().
 *   2. Chain integrity (prev_entry_hash_mismatch).
 *   3. Signature verification (signature_invalid).
 *   4. Unknown signer rejection (signer_unknown).
 *   5. Role authorization (signer_not_authorized_for_payload).
 *   6. Zod validation failure (validation_failed).
 *   7. GET /signed returns the full chain.
 *   8. GET /signed?sinceEntryHash= returns only the delta.
 */

import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { expect, test } from '@playwright/test'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import type { AuditEntryPayload, SignedAuditEntry } from '@shared/schemas/audit-entries'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { TestContext, type TestUser } from '../api-helpers'

interface TestSigner {
  privkeyHex: string
  pubkeyHex: string
}

function signerFromBytes(sk: Uint8Array): TestSigner {
  return { privkeyHex: bytesToHex(sk), pubkeyHex: getPublicKey(sk) }
}

function userSigner(u: TestUser): TestSigner {
  return signerFromBytes(u.sk)
}

function buildMembershipAddEntry(
  hubId: string,
  signer: TestSigner,
  prevEntryHash: string | null
): SignedAuditEntry {
  const base: Omit<SignedAuditEntry, 'entryHash' | 'signature'> = {
    id: crypto.randomUUID(),
    hubId,
    payload: {
      type: 'membership_add',
      userId: crypto.randomUUID(),
      pubkey: '00'.repeat(32),
      role: 'volunteer',
    } satisfies AuditEntryPayload,
    prevEntryHash,
    createdAt: new Date().toISOString(),
    signerDeviceId: 'device-test',
    signerPubkey: signer.pubkeyHex,
  }
  const entryHash = computeEntryHash(base)
  const signature = bytesToHex(schnorr.sign(hexToBytes(entryHash), hexToBytes(signer.privkeyHex)))
  return { ...base, entryHash, signature }
}

function buildHubCreateEntry(
  hubId: string,
  signer: TestSigner,
  prevEntryHash: string | null
): SignedAuditEntry {
  const base: Omit<SignedAuditEntry, 'entryHash' | 'signature'> = {
    id: crypto.randomUUID(),
    hubId,
    payload: {
      type: 'hub_create',
      hubId,
      founderPubkey: signer.pubkeyHex,
    },
    prevEntryHash,
    createdAt: new Date().toISOString(),
    signerDeviceId: 'device-test',
    signerPubkey: signer.pubkeyHex,
  }
  const entryHash = computeEntryHash(base)
  const signature = bytesToHex(schnorr.sign(hexToBytes(entryHash), hexToBytes(signer.privkeyHex)))
  return { ...base, entryHash, signature }
}

let ctx: TestContext
let adminSigner: TestSigner
let volunteerSigner: TestSigner

test.describe('POST /api/hubs/:hubId/audit — signed audit chain', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['super-admin', 'volunteer'],
      hubName: 'Tier0 Audit Hub',
    })
    adminSigner = userSigner(ctx.user('super-admin'))
    volunteerSigner = userSigner(ctx.user('volunteer'))
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test('rejects malformed body (validation_failed)', async () => {
    const res = await ctx.adminApi.post(ctx.hubPath('/audit'), { garbage: true })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
    expect(body.details).toBeDefined()
  })

  test('rejects unknown signer (signer_unknown)', async () => {
    // Generate a fresh keypair NOT in the users table
    const sk = generateSecretKey()
    const stranger = signerFromBytes(sk)
    const entry = buildMembershipAddEntry(ctx.hubId, stranger, null)
    const res = await ctx.adminApi.post(ctx.hubPath('/audit'), entry)
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('signer_unknown')
  })

  test('rejects unauthorized payload type for signer role (signer_not_authorized_for_payload)', async () => {
    // Volunteer tries to append hub_create (super_admin only)
    const entry = buildHubCreateEntry(ctx.hubId, volunteerSigner, null)
    const res = await ctx.adminApi.post(ctx.hubPath('/audit'), entry)
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('signer_not_authorized_for_payload')
  })

  test('rejects invalid signature (signature_invalid)', async () => {
    // Build correctly then mutate signature. Use a different prev hash so we
    // don't collide with other rejected-entry tests — mutation means the hash
    // chain state is unchanged regardless.
    const entry = buildMembershipAddEntry(ctx.hubId, adminSigner, null)
    const badSig = bytesToHex(
      schnorr.sign(hexToBytes(entry.entryHash), hexToBytes(volunteerSigner.privkeyHex))
    )
    const tampered: SignedAuditEntry = { ...entry, signature: badSig }
    const res = await ctx.adminApi.post(ctx.hubPath('/audit'), tampered)
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('signature_invalid')
  })

  test('appends a valid signed entry (204) and GET /signed returns it', async () => {
    // Chain should be empty at this point — previous tests all failed to append.
    const listBefore = await ctx.adminApi.get(ctx.hubPath('/audit/signed'))
    expect(listBefore.status()).toBe(200)
    const beforeBody = await listBefore.json()
    expect(beforeBody.entries).toEqual([])

    const entry = buildMembershipAddEntry(ctx.hubId, adminSigner, null)
    const res = await ctx.adminApi.post(ctx.hubPath('/audit'), entry)
    expect(res.status()).toBe(204)

    const listAfter = await ctx.adminApi.get(ctx.hubPath('/audit/signed'))
    expect(listAfter.status()).toBe(200)
    const afterBody = await listAfter.json()
    expect(afterBody.entries).toHaveLength(1)
    expect(afterBody.entries[0].entryHash).toBe(entry.entryHash)
    expect(afterBody.entries[0].prevEntryHash).toBeNull()
  })

  test('rejects prev_entry_hash_mismatch (chain integrity)', async () => {
    // Chain head is now the first valid entry. Try to append with a wrong prev.
    const wrongPrev = '00'.repeat(32)
    const bad = buildMembershipAddEntry(ctx.hubId, adminSigner, wrongPrev)
    const res = await ctx.adminApi.post(ctx.hubPath('/audit'), bad)
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('prev_entry_hash_mismatch')
    expect(body.details).toBeDefined()
  })

  test('appends second entry and GET /signed?sinceEntryHash returns delta only', async () => {
    // Fetch current head
    const listRes = await ctx.adminApi.get(ctx.hubPath('/audit/signed'))
    const { entries } = await listRes.json()
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const firstHash: string = entries[entries.length - 1].entryHash

    // Append a second entry linked to the current head
    const second = buildMembershipAddEntry(ctx.hubId, adminSigner, firstHash)
    const postRes = await ctx.adminApi.post(ctx.hubPath('/audit'), second)
    expect(postRes.status()).toBe(204)

    // Full list should contain both
    const fullRes = await ctx.adminApi.get(ctx.hubPath('/audit/signed'))
    const full = await fullRes.json()
    expect(full.entries.length).toBeGreaterThanOrEqual(2)

    // Delta from firstHash should contain only the second entry
    const deltaRes = await ctx.adminApi.get(
      ctx.hubPath(`/audit/signed?sinceEntryHash=${firstHash}`)
    )
    expect(deltaRes.status()).toBe(200)
    const delta = await deltaRes.json()
    expect(delta.entries).toHaveLength(1)
    expect(delta.entries[0].entryHash).toBe(second.entryHash)
    expect(delta.entries[0].prevEntryHash).toBe(firstHash)
  })
})
