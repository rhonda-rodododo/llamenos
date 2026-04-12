import { describe, expect, test } from 'bun:test'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_HUB_FIELD } from '@shared/crypto-labels'
import type { AuditEntryPayload, SignedAuditEntry } from '@shared/schemas/audit-entries'
import { ChainVerificationError } from './audit-chain-verifier'
import { decryptFromHub, encryptForHub, generateHubKey, rotateHubKey } from './hub-key-manager'

describe('hub-key encryption AAD', () => {
  test('matching AAD round-trips', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-123:encrypted_name`)
    const ct = encryptForHub('hello', key, aad)
    const pt = decryptFromHub(ct, key, aad)
    expect(pt).toBe('hello')
  })

  test('mismatched AAD returns null (decrypt fails)', () => {
    const key = generateHubKey()
    const ct = encryptForHub('hello', key, utf8ToBytes(`${LABEL_HUB_FIELD}:row-A:encrypted_name`))
    const pt = decryptFromHub(ct, key, utf8ToBytes(`${LABEL_HUB_FIELD}:row-B:encrypted_name`))
    expect(pt).toBeNull()
  })
})

// ---- rotateHubKey chain gate ----

const HUB_ID = '11111111-1111-4111-8111-111111111111'
const TRIGGER_HASH = 'ab'.repeat(32)
const USER_ID = '22222222-2222-4222-8222-222222222222'
// Real x-only pubkeys — rotateHubKey wraps the new key via ECIES which
// requires memberPubkeys to be valid secp256k1 points.
const ADMIN_PUB = bytesToHex(schnorr.getPublicKey(hexToBytes('a1'.repeat(32))))
const MEMBER_PUB_1 = bytesToHex(schnorr.getPublicKey(hexToBytes('b2'.repeat(32))))
const MEMBER_PUB_2 = bytesToHex(schnorr.getPublicKey(hexToBytes('c3'.repeat(32))))

function makeHeadEntry(entryHash: string, payload: AuditEntryPayload): SignedAuditEntry {
  return {
    id: crypto.randomUUID(),
    hubId: HUB_ID,
    payload,
    prevEntryHash: null,
    entryHash,
    signerDeviceId: 'device-1',
    signerPubkey: ADMIN_PUB,
    signature: '0'.repeat(128),
    createdAt: new Date().toISOString(),
  }
}

describe('rotateHubKey chain gate', () => {
  const memberPubkeys = [MEMBER_PUB_1, MEMBER_PUB_2]
  const trustAnchors = new Set([ADMIN_PUB])

  test('blocks when chain verification fails', async () => {
    const verifyFn = async () => {
      throw new ChainVerificationError('signature_invalid')
    }
    await expect(
      rotateHubKey(HUB_ID, TRIGGER_HASH, {
        trustAnchorDevicePubkeys: trustAnchors,
        memberPubkeys,
        verifyFn,
      })
    ).rejects.toBeInstanceOf(ChainVerificationError)
  })

  test('blocks when head is not a membership change (hub_create)', async () => {
    const head = makeHeadEntry(TRIGGER_HASH, {
      type: 'hub_create',
      hubId: HUB_ID,
      founderPubkey: '00'.repeat(32),
    })
    const verifyFn = async () => head
    await expect(
      rotateHubKey(HUB_ID, TRIGGER_HASH, {
        trustAnchorDevicePubkeys: trustAnchors,
        memberPubkeys,
        verifyFn,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'invalid_rotation_trigger_type',
    })
  })

  test('blocks when expectedTriggerEntryHash does not match head', async () => {
    const head = makeHeadEntry('ef'.repeat(32), {
      type: 'membership_remove',
      userId: USER_ID,
    })
    const verifyFn = async () => head
    await expect(
      rotateHubKey(HUB_ID, TRIGGER_HASH, {
        trustAnchorDevicePubkeys: trustAnchors,
        memberPubkeys,
        verifyFn,
      })
    ).rejects.toMatchObject({
      name: 'ChainVerificationError',
      code: 'rotation_trigger_not_at_head',
    })
  })

  test('succeeds when chain verifies and head matches on membership_remove', async () => {
    const head = makeHeadEntry(TRIGGER_HASH, {
      type: 'membership_remove',
      userId: USER_ID,
    })
    const verifyFn = async () => head
    const result = await rotateHubKey(HUB_ID, TRIGGER_HASH, {
      trustAnchorDevicePubkeys: trustAnchors,
      memberPubkeys,
      verifyFn,
    })
    expect(result.hubKey.length).toBe(32)
    expect(result.envelopes).toHaveLength(memberPubkeys.length)
  })

  test('succeeds on membership_add trigger', async () => {
    const head = makeHeadEntry(TRIGGER_HASH, {
      type: 'membership_add',
      userId: USER_ID,
      pubkey: '00'.repeat(32),
      role: 'volunteer',
    })
    const result = await rotateHubKey(HUB_ID, TRIGGER_HASH, {
      trustAnchorDevicePubkeys: trustAnchors,
      memberPubkeys,
      verifyFn: async () => head,
    })
    expect(result.envelopes).toHaveLength(memberPubkeys.length)
  })

  test('succeeds on role_change trigger', async () => {
    const head = makeHeadEntry(TRIGGER_HASH, {
      type: 'role_change',
      userId: USER_ID,
      oldRole: 'volunteer',
      newRole: 'admin',
    })
    const result = await rotateHubKey(HUB_ID, TRIGGER_HASH, {
      trustAnchorDevicePubkeys: trustAnchors,
      memberPubkeys,
      verifyFn: async () => head,
    })
    expect(result.envelopes).toHaveLength(memberPubkeys.length)
  })
})
