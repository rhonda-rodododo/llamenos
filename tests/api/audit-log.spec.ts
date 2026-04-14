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
 *   4. signerPubkey-mismatch rejection (authz: route-level identity binding).
 *   5. Role authorization (signer_not_authorized_for_payload).
 *   6. Zod validation failure (validation_failed).
 *   7. GET /signed returns the full chain.
 *   8. GET /signed?sinceEntryHash= returns only the delta.
 *
 * Note: signer_unknown is now unreachable from the route layer because
 * authenticated callers must already exist in the users table and the
 * route enforces signerPubkey === caller. It remains as defense-in-depth
 * inside audit-log-service and is covered by unit tests there.
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

  test('rejects signer_mismatch when body signerPubkey differs from caller', async () => {
    // Caller authenticates as super-admin but signs with a fresh stranger key.
    // Route-level guard rejects before the service is touched.
    const sk = generateSecretKey()
    const stranger = signerFromBytes(sk)
    const entry = buildMembershipAddEntry(ctx.hubId, stranger, null)
    const res = await ctx.user('super-admin').api.post(ctx.hubPath('/audit'), entry)
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('signer_mismatch')
  })

  test('rejects unauthorized payload type for signer role (signer_not_authorized_for_payload)', async () => {
    // Volunteer tries to append hub_create (super_admin only). Must POST as
    // the volunteer so the new signer-mismatch guard doesn't short-circuit.
    const entry = buildHubCreateEntry(ctx.hubId, volunteerSigner, null)
    const res = await ctx.user('volunteer').api.post(ctx.hubPath('/audit'), entry)
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
    const res = await ctx.user('super-admin').api.post(ctx.hubPath('/audit'), tampered)
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('signature_invalid')
  })

  test('appends a valid signed entry (204) and GET /signed returns it', async () => {
    // Chain should be empty at this point — previous tests all failed to append.
    const listBefore = await ctx.user('super-admin').api.get(ctx.hubPath('/audit/signed'))
    expect(listBefore.status()).toBe(200)
    const beforeBody = await listBefore.json()
    expect(beforeBody.entries).toEqual([])

    const entry = buildMembershipAddEntry(ctx.hubId, adminSigner, null)
    const res = await ctx.user('super-admin').api.post(ctx.hubPath('/audit'), entry)
    expect(res.status()).toBe(204)

    const listAfter = await ctx.user('super-admin').api.get(ctx.hubPath('/audit/signed'))
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
    const res = await ctx.user('super-admin').api.post(ctx.hubPath('/audit'), bad)
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('prev_entry_hash_mismatch')
    expect(body.details).toBeDefined()
  })

  test('appends second entry and GET /signed?sinceEntryHash returns delta only', async () => {
    // Fetch current head
    const listRes = await ctx.user('super-admin').api.get(ctx.hubPath('/audit/signed'))
    const { entries } = await listRes.json()
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const firstHash: string = entries[entries.length - 1].entryHash

    // Append a second entry linked to the current head
    const second = buildMembershipAddEntry(ctx.hubId, adminSigner, firstHash)
    const postRes = await ctx.user('super-admin').api.post(ctx.hubPath('/audit'), second)
    expect(postRes.status()).toBe(204)

    // Full list should contain both
    const fullRes = await ctx.user('super-admin').api.get(ctx.hubPath('/audit/signed'))
    const full = await fullRes.json()
    expect(full.entries.length).toBeGreaterThanOrEqual(2)

    // Delta from firstHash should contain only the second entry
    const deltaRes = await ctx
      .user('super-admin')
      .api.get(ctx.hubPath(`/audit/signed?sinceEntryHash=${firstHash}`))
    expect(deltaRes.status()).toBe(200)
    const delta = await deltaRes.json()
    expect(delta.entries).toHaveLength(1)
    expect(delta.entries[0].entryHash).toBe(second.entryHash)
    expect(delta.entries[0].prevEntryHash).toBe(firstHash)
  })

  test('rejects hub_mismatch when body hubId differs from path', async () => {
    // Sign an entry for a non-existent hub and POST it on the real hub's path.
    const wrongHubId = crypto.randomUUID()
    const adminSignerLocal = adminSigner
    const base = {
      id: crypto.randomUUID(),
      hubId: wrongHubId,
      payload: {
        type: 'membership_add' as const,
        userId: crypto.randomUUID(),
        pubkey: '00'.repeat(32),
        role: 'volunteer' as const,
      },
      prevEntryHash: null,
      createdAt: new Date().toISOString(),
      signerDeviceId: 'device-test',
      signerPubkey: adminSignerLocal.pubkeyHex,
    }
    const entryHash = computeEntryHash(base)
    const signature = bytesToHex(
      schnorr.sign(hexToBytes(entryHash), hexToBytes(adminSignerLocal.privkeyHex))
    )
    const crossHub: SignedAuditEntry = { ...base, entryHash, signature }

    const res = await ctx.user('super-admin').api.post(ctx.hubPath('/audit'), crossHub)
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('hub_mismatch')
  })

  test('GET /audit/head returns the current chain head entryHash', async () => {
    // Fetch via the dedicated head endpoint used by admin audit-log-client.
    const headRes = await ctx.user('super-admin').api.get(ctx.hubPath('/audit/head'))
    expect(headRes.status()).toBe(200)
    const headBody = (await headRes.json()) as { entryHash: string | null }
    expect(headBody.entryHash).toMatch(/^[0-9a-f]{64}$/)

    // Cross-check against the full /signed list — head must equal the final
    // entry's hash.
    const listRes = await ctx.user('super-admin').api.get(ctx.hubPath('/audit/signed'))
    const { entries } = await listRes.json()
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const expectedHead: string = entries[entries.length - 1].entryHash
    expect(headBody.entryHash).toBe(expectedHead)
  })
})
