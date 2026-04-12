/**
 * Tier 6 device fingerprint verification — API E2E.
 *
 * Exercises POST /api/hubs/:hubId/devices/:deviceId/verify against a live server.
 *
 * Covers:
 *   1. Happy-path: admin submits a valid device_fingerprint_verified audit entry → 201.
 *   2. Payload type mismatch → 400.
 *   3. hubId mismatch between path and payload → 400.
 *   4. deviceId mismatch between path and payload → 400.
 *   5. signerPubkey mismatch → 403.
 *   6. Malformed body → 400 (validation_failed).
 *   7. Volunteer (non-admin) gets 403 from permission guard.
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

function signerFromUser(u: TestUser): TestSigner {
  return { privkeyHex: bytesToHex(u.sk), pubkeyHex: u.pubkey }
}

function buildDeviceFingerprintEntry(
  hubId: string,
  signer: TestSigner,
  deviceId: string,
  prevEntryHash: string | null
): SignedAuditEntry {
  const base: Omit<SignedAuditEntry, 'entryHash' | 'signature'> = {
    id: crypto.randomUUID(),
    hubId,
    payload: {
      type: 'device_fingerprint_verified',
      hubId,
      verifiedDeviceId: deviceId,
      verifiedDevicePubkey: '00'.repeat(32),
      verifierDeviceId: crypto.randomUUID(),
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

let ctx: TestContext
let adminSigner: TestSigner

test.describe('POST /api/hubs/:hubId/devices/:deviceId/verify', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['super-admin', 'volunteer'],
      hubName: 'Tier6 Fingerprint Hub',
    })
    adminSigner = signerFromUser(ctx.user('super-admin'))
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test('admin submits valid device_fingerprint_verified entry → 201', async () => {
    const deviceId = crypto.randomUUID()
    const entry = buildDeviceFingerprintEntry(ctx.hubId, adminSigner, deviceId, null)
    const res = await ctx
      .user('super-admin')
      .api.post(ctx.hubPath(`/devices/${deviceId}/verify`), { signedEntry: entry })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.entryHash).toBe(entry.entryHash)
    expect(body.appendedAt).toBeDefined()
  })

  test('rejects wrong payload type → 400', async () => {
    const deviceId = crypto.randomUUID()
    // Build a membership_add entry but submit to device verify endpoint
    const base: Omit<SignedAuditEntry, 'entryHash' | 'signature'> = {
      id: crypto.randomUUID(),
      hubId: ctx.hubId,
      payload: {
        type: 'membership_add',
        userId: crypto.randomUUID(),
        pubkey: '00'.repeat(32),
        role: 'volunteer',
      } satisfies AuditEntryPayload,
      prevEntryHash: null,
      createdAt: new Date().toISOString(),
      signerDeviceId: 'device-test',
      signerPubkey: adminSigner.pubkeyHex,
    }
    const entryHash = computeEntryHash(base)
    const signature = bytesToHex(
      schnorr.sign(hexToBytes(entryHash), hexToBytes(adminSigner.privkeyHex))
    )
    const entry: SignedAuditEntry = { ...base, entryHash, signature }

    const res = await ctx
      .user('super-admin')
      .api.post(ctx.hubPath(`/devices/${deviceId}/verify`), { signedEntry: entry })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('device_fingerprint_verified')
  })

  test('rejects hubId mismatch → 400', async () => {
    const deviceId = crypto.randomUUID()
    const wrongHubId = crypto.randomUUID()
    const base: Omit<SignedAuditEntry, 'entryHash' | 'signature'> = {
      id: crypto.randomUUID(),
      hubId: wrongHubId,
      payload: {
        type: 'device_fingerprint_verified',
        hubId: wrongHubId,
        verifiedDeviceId: deviceId,
        verifiedDevicePubkey: '00'.repeat(32),
        verifierDeviceId: crypto.randomUUID(),
      } satisfies AuditEntryPayload,
      prevEntryHash: null,
      createdAt: new Date().toISOString(),
      signerDeviceId: 'device-test',
      signerPubkey: adminSigner.pubkeyHex,
    }
    const entryHash = computeEntryHash(base)
    const signature = bytesToHex(
      schnorr.sign(hexToBytes(entryHash), hexToBytes(adminSigner.privkeyHex))
    )
    const entry: SignedAuditEntry = { ...base, entryHash, signature }

    const res = await ctx
      .user('super-admin')
      .api.post(ctx.hubPath(`/devices/${deviceId}/verify`), { signedEntry: entry })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('hubId')
  })

  test('rejects deviceId mismatch → 400', async () => {
    const pathDeviceId = crypto.randomUUID()
    const payloadDeviceId = crypto.randomUUID()
    const entry = buildDeviceFingerprintEntry(ctx.hubId, adminSigner, payloadDeviceId, null)

    const res = await ctx
      .user('super-admin')
      .api.post(ctx.hubPath(`/devices/${pathDeviceId}/verify`), { signedEntry: entry })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('verifiedDeviceId')
  })

  test('rejects signerPubkey mismatch → 403', async () => {
    const deviceId = crypto.randomUUID()
    // Build entry signed by a stranger key, but submit as admin
    const strangerSk = generateSecretKey()
    const strangerSigner: TestSigner = {
      privkeyHex: bytesToHex(strangerSk),
      pubkeyHex: getPublicKey(strangerSk),
    }
    const entry = buildDeviceFingerprintEntry(ctx.hubId, strangerSigner, deviceId, null)

    const res = await ctx
      .user('super-admin')
      .api.post(ctx.hubPath(`/devices/${deviceId}/verify`), { signedEntry: entry })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('signerPubkey')
  })

  test('rejects malformed body → 400 (validation_failed)', async () => {
    const deviceId = crypto.randomUUID()
    const res = await ctx
      .user('super-admin')
      .api.post(ctx.hubPath(`/devices/${deviceId}/verify`), { garbage: true })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
  })

  test('volunteer gets 403 from permission guard', async () => {
    const deviceId = crypto.randomUUID()
    const volunteerSigner = signerFromUser(ctx.user('volunteer'))
    const entry = buildDeviceFingerprintEntry(ctx.hubId, volunteerSigner, deviceId, null)

    const res = await ctx
      .user('volunteer')
      .api.post(ctx.hubPath(`/devices/${deviceId}/verify`), { signedEntry: entry })
    expect(res.status()).toBe(403)
  })
})
