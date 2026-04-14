/**
 * Tests for user-sigchain-verifier — Tier 3 Tasks 12–14.
 *
 * Verifies semantic rules for user identity sigchain entries:
 * user_init bootstrapping, device add/remove, PUK rotation,
 * master signing key tracking, and adversarial mutations.
 *
 * Uses the same schnorr secp256k1 signing pattern as audit-chain-verifier.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import type { AuditEntryPayload, SignedAuditEntry } from '@shared/schemas/audit-entries'
import { verifyUserSigchain } from './user-sigchain-verifier'

// ---- fixtures ----

const HUB_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

function makeKeypair(seed: string) {
  const priv = seed.repeat(32).slice(0, 64)
  const pub = bytesToHex(schnorr.getPublicKey(hexToBytes(priv)))
  return { priv, pub }
}

const DEVICE_A = makeKeypair('a1')
const DEVICE_B = makeKeypair('b2')
const DEVICE_C = makeKeypair('c3')
const STRANGER = makeKeypair('ee')

// ---- synthetic sigchain builder ----

function signEntry(
  privHex: string,
  base: Omit<SignedAuditEntry, 'entryHash' | 'signature'>
): SignedAuditEntry {
  const entryHash = computeEntryHash(base)
  const signature = bytesToHex(schnorr.sign(hexToBytes(entryHash), hexToBytes(privHex)))
  return { ...base, entryHash, signature }
}

interface BuilderState {
  entries: SignedAuditEntry[]
  prev: string | null
  time: number
}

function createBuilder(): BuilderState {
  return {
    entries: [],
    prev: null,
    time: Date.parse('2026-04-12T00:00:00.000Z'),
  }
}

function appendEntry(
  state: BuilderState,
  privHex: string,
  pubHex: string,
  payload: AuditEntryPayload,
  overrides?: Partial<Omit<SignedAuditEntry, 'entryHash' | 'signature'>>
): SignedAuditEntry {
  const entry = signEntry(privHex, {
    id: crypto.randomUUID(),
    hubId: HUB_ID,
    payload,
    prevEntryHash: state.prev,
    createdAt: new Date(state.time).toISOString(),
    signerDeviceId: 'device-a',
    signerPubkey: pubHex,
    ...overrides,
  })
  state.entries.push(entry)
  state.prev = entry.entryHash
  state.time += 1000
  return entry
}

function buildUserInitPayload(deviceId = 'device-a'): AuditEntryPayload {
  return {
    type: 'user_init',
    userId: USER_ID,
    deviceId,
    signingPubkey: DEVICE_A.pub,
    encryptionPubkey: 'ff'.repeat(32),
    pukGeneration: 1,
    pukSignPubkey: 'aa'.repeat(32),
    pukDhPubkey: 'bb'.repeat(32),
  }
}

// ---- tests ----

describe('verifyUserSigchain', () => {
  test('verifies user_init → tier3_device_add → puk_rotate → tier3_device_remove (happy path)', async () => {
    const b = createBuilder()

    // 1. user_init
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // 2. tier3_device_add — device B added by device A
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    // 3. puk_rotate — from gen 1 to gen 2
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'puk_rotate',
      userId: USER_ID,
      oldGeneration: 1,
      newGeneration: 2,
      newPukSignPubkey: 'cc'.repeat(32),
      newPukDhPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
    })

    // 4. tier3_device_remove — device A removes device B
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_remove',
      userId: USER_ID,
      removedDeviceId: 'device-b',
      removedSigningPubkey: DEVICE_B.pub,
      signedByDeviceId: 'device-a',
      reason: 'user_revoked',
      pukGeneration: 2,
    })

    const result = await verifyUserSigchain(b.entries)

    expect(result.userId).toBe(USER_ID)
    expect(result.verifiedDevices.size).toBe(1)
    expect(result.verifiedDevices.has('device-a')).toBe(true)
    expect(result.verifiedDevices.has('device-b')).toBe(false)
    expect(result.revokedDevices.has('device-b')).toBe(true)
    expect(result.pukGeneration).toBe(2)
    expect(result.verifiedCount).toBe(4)
    expect(result.head).toBeTruthy()
  })

  test('rejects chain not starting with user_init', async () => {
    const b = createBuilder()

    // Start with a device_add instead of user_init
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'chain_must_start_with_user_init',
    })
  })

  test('rejects tier3_device_add signed by unknown device', async () => {
    const b = createBuilder()

    // user_init with device A
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // tier3_device_add signed by STRANGER (not in verified set)
    appendEntry(b, STRANGER.priv, STRANGER.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-c',
      newDeviceSigningPubkey: DEVICE_C.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'stranger-device',
      newDeviceDisplayName: 'Evil',
      pukGeneration: 1,
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'signer_not_in_verified_set',
    })
  })

  test('rejects tier3_device_remove where signer == removed device', async () => {
    const b = createBuilder()

    // user_init
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Add device B
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    // Device B tries to remove itself
    appendEntry(
      b,
      DEVICE_B.priv,
      DEVICE_B.pub,
      {
        type: 'tier3_device_remove',
        userId: USER_ID,
        removedDeviceId: 'device-b',
        removedSigningPubkey: DEVICE_B.pub,
        signedByDeviceId: 'device-b',
        reason: 'user_revoked',
        pukGeneration: 1,
      },
      { signerDeviceId: 'device-b' }
    )

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'cannot_remove_self',
    })
  })

  test('rejects puk_rotate with non-sequential generation', async () => {
    const b = createBuilder()

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Skip generation — go from 1 to 3
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'puk_rotate',
      userId: USER_ID,
      oldGeneration: 1,
      newGeneration: 3,
      newPukSignPubkey: 'cc'.repeat(32),
      newPukDhPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'puk_generation_not_sequential',
    })
  })

  test('user_master_signing_update tracks the pubkey', async () => {
    const b = createBuilder()

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    const newMasterPubkey = 'ab'.repeat(32)
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'user_master_signing_update',
      userId: USER_ID,
      newMasterSigningPubkey: newMasterPubkey,
      signedByDeviceId: 'device-a',
    })

    const result = await verifyUserSigchain(b.entries)
    expect(result.masterSigningPubkey).toBe(newMasterPubkey)
  })

  test('empty chain throws', async () => {
    await expect(verifyUserSigchain([])).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'empty_chain',
    })
  })

  test('rejects tampered entry hash', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Tamper the entry hash
    b.entries[0] = { ...b.entries[0], entryHash: 'cd'.repeat(32) }

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'entry_hash_mismatch',
    })
  })

  test('rejects broken chain link (prevEntryHash mismatch)', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Build second entry with wrong prev hash
    const badEntry = signEntry(DEVICE_A.priv, {
      id: crypto.randomUUID(),
      hubId: HUB_ID,
      payload: {
        type: 'puk_rotate',
        userId: USER_ID,
        oldGeneration: 1,
        newGeneration: 2,
        newPukSignPubkey: 'cc'.repeat(32),
        newPukDhPubkey: 'dd'.repeat(32),
        signedByDeviceId: 'device-a',
      },
      prevEntryHash: 'ab'.repeat(32), // wrong
      createdAt: new Date().toISOString(),
      signerDeviceId: 'device-a',
      signerPubkey: DEVICE_A.pub,
    })
    b.entries.push(badEntry)

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'prev_entry_hash_mismatch',
    })
  })

  test('rejects forged signature', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Re-sign the entry with stranger's key but keep device A's pubkey
    const forged = { ...b.entries[0] }
    forged.signature = bytesToHex(
      schnorr.sign(hexToBytes(forged.entryHash), hexToBytes(STRANGER.priv))
    )
    b.entries[0] = forged

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'signature_invalid',
    })
  })

  test('trust anchor mismatch rejects', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    await expect(
      verifyUserSigchain(b.entries, { trustAnchor: { signingPubkey: STRANGER.pub } })
    ).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'signer_not_in_verified_set',
    })
  })

  test('trust anchor match succeeds', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    const result = await verifyUserSigchain(b.entries, {
      trustAnchor: { signingPubkey: DEVICE_A.pub },
    })
    expect(result.userId).toBe(USER_ID)
    expect(result.verifiedCount).toBe(1)
  })

  test('device_cross_sign accepted when inner Ed25519 signature verifies under published master signing key', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Add device B
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    // Publish the user's master (self-)signing pubkey. The verifier uses this
    // to validate the inner signature on subsequent device_cross_sign entries.
    const masterSeed = new Uint8Array(32).fill(0x42)
    const masterSigningPub = ed25519.getPublicKey(masterSeed)
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'user_master_signing_update',
      userId: USER_ID,
      newMasterSigningPubkey: bytesToHex(masterSigningPub),
      signedByDeviceId: 'device-a',
    })

    // Produce a genuine Ed25519 signature over the target device's signing
    // pubkey under the published master signing key.
    const targetSigningPubkeyBytes = hexToBytes(DEVICE_B.pub)
    const innerSig = ed25519.sign(targetSigningPubkeyBytes, masterSeed)

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'device_cross_sign',
      signerDeviceId: 'device-a',
      targetDeviceId: 'device-b',
      targetSigningPubkey: DEVICE_B.pub,
      signature: bytesToHex(innerSig),
    })

    const result = await verifyUserSigchain(b.entries)
    expect(result.verifiedCount).toBe(4)
    expect(result.masterSigningPubkey).toBe(bytesToHex(masterSigningPub))
  })

  // Gap 1 regression: outer entry is signed by a verified device, but the
  // INNER Ed25519 payload signature is forged/tampered. Without the inner
  // signature check, an attacker controlling any valid device could record
  // arbitrary `device_cross_sign` claims.
  test('rejects device_cross_sign with tampered inner signature', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    // Publish the legitimate master signing pubkey.
    const masterSeed = new Uint8Array(32).fill(0x11)
    const masterSigningPub = ed25519.getPublicKey(masterSeed)
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'user_master_signing_update',
      userId: USER_ID,
      newMasterSigningPubkey: bytesToHex(masterSigningPub),
      signedByDeviceId: 'device-a',
    })

    // Produce a real signature, then flip a byte in the middle.
    const realSig = ed25519.sign(hexToBytes(DEVICE_B.pub), masterSeed)
    const tamperedSig = new Uint8Array(realSig)
    tamperedSig[10] = (tamperedSig[10] as number) ^ 0xff

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'device_cross_sign',
      signerDeviceId: 'device-a',
      targetDeviceId: 'device-b',
      targetSigningPubkey: DEVICE_B.pub,
      signature: bytesToHex(tamperedSig),
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'cross_sign_inner_signature_invalid',
    })
  })

  test('rejects device_cross_sign signed by key from a different master', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    // Publish user's legitimate master signing pubkey.
    const legitSeed = new Uint8Array(32).fill(0x22)
    const legitPub = ed25519.getPublicKey(legitSeed)
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'user_master_signing_update',
      userId: USER_ID,
      newMasterSigningPubkey: bytesToHex(legitPub),
      signedByDeviceId: 'device-a',
    })

    // Attacker signs with a different key — signature is valid Ed25519 but
    // not under the published master key.
    const attackerSeed = new Uint8Array(32).fill(0x99)
    const attackerSig = ed25519.sign(hexToBytes(DEVICE_B.pub), attackerSeed)

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'device_cross_sign',
      signerDeviceId: 'device-a',
      targetDeviceId: 'device-b',
      targetSigningPubkey: DEVICE_B.pub,
      signature: bytesToHex(attackerSig),
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'cross_sign_inner_signature_invalid',
    })
  })

  test('rejects device_cross_sign before any user_master_signing_update', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    // Device_cross_sign without a preceding user_master_signing_update — there
    // is no published key to verify the inner signature against, so the
    // verifier has nothing to anchor trust on and must reject.
    const orphanSeed = new Uint8Array(32).fill(0x33)
    const orphanSig = ed25519.sign(hexToBytes(DEVICE_B.pub), orphanSeed)
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'device_cross_sign',
      signerDeviceId: 'device-a',
      targetDeviceId: 'device-b',
      targetSigningPubkey: DEVICE_B.pub,
      signature: bytesToHex(orphanSig),
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'cross_sign_missing_master_signing_key',
    })
  })

  test('hub_ptk_rotate accepted with device commitments', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'hub_ptk_rotate',
      hubId: HUB_ID,
      oldGeneration: 0,
      newGeneration: 1,
      deviceCommitments: [{ deviceId: 'device-a', commitmentHash: 'aa'.repeat(32) }],
      signedByDeviceId: 'device-a',
    })

    const result = await verifyUserSigchain(b.entries)
    expect(result.verifiedCount).toBe(2)
  })

  test('hub_ptk_rotate rejected with empty commitments', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'hub_ptk_rotate',
      hubId: HUB_ID,
      oldGeneration: 0,
      newGeneration: 1,
      deviceCommitments: [],
      signedByDeviceId: 'device-a',
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'hub_ptk_no_commitments',
    })
  })

  test('recovery_completed with current puk generation accepted', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'recovery_completed',
      userId: USER_ID,
      newDeviceId: 'recovery-device',
      recoveryType: 'paper_key',
      pukGeneration: 1,
    })

    const result = await verifyUserSigchain(b.entries)
    expect(result.verifiedCount).toBe(2)
    expect(result.pukGeneration).toBe(1)
  })

  test('recovery_completed with stale puk generation rejected', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Rotate to gen 2
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'puk_rotate',
      userId: USER_ID,
      oldGeneration: 1,
      newGeneration: 2,
      newPukSignPubkey: 'cc'.repeat(32),
      newPukDhPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
    })

    // Recovery with stale gen 1
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'recovery_completed',
      userId: USER_ID,
      newDeviceId: 'recovery-device',
      recoveryType: 'paper_key',
      pukGeneration: 1,
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'puk_generation_not_sequential',
    })
  })

  test('newly added device can sign subsequent entries', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Add device B
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    // Device B signs a puk_rotate
    appendEntry(
      b,
      DEVICE_B.priv,
      DEVICE_B.pub,
      {
        type: 'puk_rotate',
        userId: USER_ID,
        oldGeneration: 1,
        newGeneration: 2,
        newPukSignPubkey: 'cc'.repeat(32),
        newPukDhPubkey: 'dd'.repeat(32),
        signedByDeviceId: 'device-b',
      },
      { signerDeviceId: 'device-b' }
    )

    const result = await verifyUserSigchain(b.entries)
    expect(result.verifiedCount).toBe(3)
    expect(result.pukGeneration).toBe(2)
  })

  test('revoked device cannot sign subsequent entries', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // Add device B
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_add',
      userId: USER_ID,
      newDeviceId: 'device-b',
      newDeviceSigningPubkey: DEVICE_B.pub,
      newDeviceEncryptionPubkey: 'dd'.repeat(32),
      signedByDeviceId: 'device-a',
      newDeviceDisplayName: 'Phone',
      pukGeneration: 1,
    })

    // Remove device B
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'tier3_device_remove',
      userId: USER_ID,
      removedDeviceId: 'device-b',
      removedSigningPubkey: DEVICE_B.pub,
      signedByDeviceId: 'device-a',
      reason: 'user_revoked',
      pukGeneration: 1,
    })

    // Revoked device B tries to sign
    appendEntry(
      b,
      DEVICE_B.priv,
      DEVICE_B.pub,
      {
        type: 'puk_rotate',
        userId: USER_ID,
        oldGeneration: 1,
        newGeneration: 2,
        newPukSignPubkey: 'cc'.repeat(32),
        newPukDhPubkey: 'dd'.repeat(32),
        signedByDeviceId: 'device-b',
      },
      { signerDeviceId: 'device-b' }
    )

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'signer_not_in_verified_set',
    })
  })

  test('rejects invalid entry type in user sigchain', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    // membership_add is a hub entry, not valid in user sigchain
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'membership_add',
      userId: USER_ID,
      pubkey: '00'.repeat(32),
      role: 'volunteer',
    })

    await expect(verifyUserSigchain(b.entries)).rejects.toMatchObject({
      name: 'UserSigchainError',
      code: 'invalid_entry_for_user_sigchain',
    })
  })

  test('user_cross_sign accepted and does not mutate state', async () => {
    const b = createBuilder()
    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, buildUserInitPayload())

    appendEntry(b, DEVICE_A.priv, DEVICE_A.pub, {
      type: 'user_cross_sign',
      signerUserId: USER_ID,
      targetUserId: '33333333-3333-4333-8333-333333333333',
      targetMasterPubkey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
    })

    const result = await verifyUserSigchain(b.entries)
    expect(result.verifiedCount).toBe(2)
    // State unchanged from init
    expect(result.pukGeneration).toBe(1)
    expect(result.masterSigningPubkey).toBeNull()
  })
})
