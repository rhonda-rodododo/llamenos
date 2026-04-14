/**
 * User sigchain verifier — Tier 3 Tasks 12–14.
 *
 * Walks a user's sigchain entries, verifying:
 *   1. Chain-hash linkage (prevEntryHash)
 *   2. Entry-hash recomputation via computeEntryHash
 *   3. Schnorr signature verification
 *   4. Semantic rules for user identity operations:
 *      - First entry must be user_init
 *      - tier3_device_add must be signed by a verified device
 *      - tier3_device_remove must be signed by a device other than the removed one
 *      - puk_rotate generation must increment by exactly 1
 *      - hub_ptk_rotate device commitments must exist
 *      - user_master_signing_update tracking
 *      - device_cross_sign must be signed by a same-user device
 *      - user_cross_sign tracking
 *      - recovery_completed puk generation validation
 *
 * Builds on the Tier 0 audit-chain-verifier pattern but scoped to a
 * single user's identity chain with device-set management.
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import { type SignedAuditEntry, SignedAuditEntrySchema } from '@shared/schemas/audit-entries'

// ---- error types ----

export type UserSigchainErrorCode =
  | 'chain_must_start_with_user_init'
  | 'signer_not_in_verified_set'
  | 'cannot_remove_self'
  | 'puk_generation_not_sequential'
  | 'invalid_entry_for_user_sigchain'
  | 'empty_chain'
  | 'entry_hash_mismatch'
  | 'prev_entry_hash_mismatch'
  | 'signature_invalid'
  | 'schema_invalid'
  | 'hub_ptk_no_commitments'
  | 'cross_sign_missing_master_signing_key'
  | 'cross_sign_inner_signature_invalid'

export class UserSigchainError extends Error {
  readonly name = 'UserSigchainError'
  constructor(
    readonly code: UserSigchainErrorCode,
    readonly details?: Record<string, unknown>
  ) {
    super(`User sigchain verification failed: ${code}`)
  }
}

// ---- verified state ----

export interface VerifiedDevice {
  deviceId: string
  signingPubkey: string
  encryptionPubkey: string
}

export interface SigchainVerifiedState {
  userId: string
  verifiedDevices: Map<string, VerifiedDevice>
  revokedDevices: Set<string>
  pukGeneration: number
  masterSigningPubkey: string | null
  head: SignedAuditEntry | null
  verifiedCount: number
}

// ---- sigchain entry types that this verifier handles ----

const USER_SIGCHAIN_TYPES = new Set([
  'user_init',
  'tier3_device_add',
  'tier3_device_remove',
  'puk_rotate',
  'hub_ptk_rotate',
  'user_master_signing_update',
  'device_cross_sign',
  'user_cross_sign',
  'recovery_completed',
  'recovery_initiated',
])

// ---- main verifier ----

export interface VerifyUserSigchainOptions {
  /** Optional trust anchor — if provided, the user_init entry's signingPubkey must match. */
  trustAnchor?: { signingPubkey: string } | null
}

export async function verifyUserSigchain(
  entries: SignedAuditEntry[],
  opts: VerifyUserSigchainOptions = {}
): Promise<SigchainVerifiedState> {
  if (entries.length === 0) {
    throw new UserSigchainError('empty_chain')
  }

  // State tracking
  const verifiedDevices = new Map<string, VerifiedDevice>()
  const revokedDevices = new Set<string>()
  let pukGeneration = 0
  let masterSigningPubkey: string | null = null
  let userId: string | null = null
  let head: SignedAuditEntry | null = null
  let prev: string | null = null

  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i]

    // 1. Schema validation
    const parseResult = SignedAuditEntrySchema.safeParse(raw)
    if (!parseResult.success) {
      throw new UserSigchainError('schema_invalid', {
        issues: parseResult.error.issues,
        index: i,
      })
    }
    const entry = parseResult.data

    // 2. Chain-hash linkage
    if (entry.prevEntryHash !== prev) {
      throw new UserSigchainError('prev_entry_hash_mismatch', {
        expected: prev,
        actual: entry.prevEntryHash,
        entryId: entry.id,
        index: i,
      })
    }

    // 3. Entry-hash recomputation
    const recomputed = computeEntryHash(entry)
    if (recomputed !== entry.entryHash) {
      throw new UserSigchainError('entry_hash_mismatch', {
        entryId: entry.id,
        index: i,
      })
    }

    // 4. Schnorr signature verification
    const sigOk = schnorr.verify(
      hexToBytes(entry.signature),
      hexToBytes(entry.entryHash),
      hexToBytes(entry.signerPubkey)
    )
    if (!sigOk) {
      throw new UserSigchainError('signature_invalid', {
        entryId: entry.id,
        index: i,
      })
    }

    const { payload } = entry

    // 5. First entry must be user_init
    if (i === 0) {
      if (payload.type !== 'user_init') {
        throw new UserSigchainError('chain_must_start_with_user_init', {
          actualType: payload.type,
          entryId: entry.id,
        })
      }

      // Bootstrap from user_init
      userId = payload.userId
      pukGeneration = payload.pukGeneration

      // If trust anchor provided, verify the init entry's signing key matches
      if (opts.trustAnchor && entry.signerPubkey !== opts.trustAnchor.signingPubkey) {
        throw new UserSigchainError('signer_not_in_verified_set', {
          pubkey: entry.signerPubkey,
          entryId: entry.id,
          reason: 'trust_anchor_mismatch',
        })
      }

      verifiedDevices.set(payload.deviceId, {
        deviceId: payload.deviceId,
        signingPubkey: payload.signingPubkey,
        encryptionPubkey: payload.encryptionPubkey,
      })

      prev = entry.entryHash
      head = entry
      continue
    }

    // For all entries after user_init, validate the entry type is relevant
    if (!USER_SIGCHAIN_TYPES.has(payload.type)) {
      throw new UserSigchainError('invalid_entry_for_user_sigchain', {
        type: payload.type,
        entryId: entry.id,
        index: i,
      })
    }

    // Signer must be in the verified device set (by pubkey)
    const signerInSet = Array.from(verifiedDevices.values()).some(
      (d) => d.signingPubkey === entry.signerPubkey
    )
    if (!signerInSet) {
      throw new UserSigchainError('signer_not_in_verified_set', {
        pubkey: entry.signerPubkey,
        entryId: entry.id,
        index: i,
      })
    }

    // 6. Apply semantic rules per entry type
    switch (payload.type) {
      case 'tier3_device_add': {
        verifiedDevices.set(payload.newDeviceId, {
          deviceId: payload.newDeviceId,
          signingPubkey: payload.newDeviceSigningPubkey,
          encryptionPubkey: payload.newDeviceEncryptionPubkey,
        })
        break
      }

      case 'tier3_device_remove': {
        // The signer must not be the device being removed
        const signerDevice = Array.from(verifiedDevices.values()).find(
          (d) => d.signingPubkey === entry.signerPubkey
        )
        if (signerDevice && signerDevice.deviceId === payload.removedDeviceId) {
          throw new UserSigchainError('cannot_remove_self', {
            deviceId: payload.removedDeviceId,
            entryId: entry.id,
            index: i,
          })
        }

        verifiedDevices.delete(payload.removedDeviceId)
        revokedDevices.add(payload.removedDeviceId)
        break
      }

      case 'puk_rotate': {
        const expectedGeneration = pukGeneration + 1
        if (payload.newGeneration !== expectedGeneration) {
          throw new UserSigchainError('puk_generation_not_sequential', {
            expected: expectedGeneration,
            actual: payload.newGeneration,
            entryId: entry.id,
            index: i,
          })
        }
        pukGeneration = payload.newGeneration
        break
      }

      case 'hub_ptk_rotate': {
        if (!payload.deviceCommitments || payload.deviceCommitments.length === 0) {
          throw new UserSigchainError('hub_ptk_no_commitments', {
            entryId: entry.id,
            index: i,
          })
        }
        // Verifier does not check hub admin role — that's server-side
        break
      }

      case 'user_master_signing_update': {
        masterSigningPubkey = payload.newMasterSigningPubkey
        break
      }

      case 'device_cross_sign': {
        // Outer Schnorr check already passed (entry signed by a verified device).
        // Now verify the INNER Ed25519 cross-signature: the user's self-signing
        // key (tracked on state as `masterSigningPubkey`, published via
        // `user_master_signing_update`) must have signed `targetSigningPubkey`.
        //
        // Without this, an attacker who compromises any one device can forge
        // `device_cross_sign` entries claiming arbitrary keys belong to the
        // user, because the outer signature only proves the device exists.
        if (!masterSigningPubkey) {
          throw new UserSigchainError('cross_sign_missing_master_signing_key', {
            entryId: entry.id,
            index: i,
            reason: 'device_cross_sign requires a prior user_master_signing_update',
          })
        }

        let innerOk = false
        try {
          innerOk = ed25519.verify(
            hexToBytes(payload.signature),
            hexToBytes(payload.targetSigningPubkey),
            hexToBytes(masterSigningPubkey)
          )
        } catch {
          innerOk = false
        }

        if (!innerOk) {
          throw new UserSigchainError('cross_sign_inner_signature_invalid', {
            entryId: entry.id,
            index: i,
            targetDeviceId: payload.targetDeviceId,
          })
        }
        break
      }

      case 'user_cross_sign': {
        // Track cross-signing state — just recording, no additional constraints
        break
      }

      case 'recovery_completed': {
        // Validate puk generation is current or future
        if (payload.pukGeneration < pukGeneration) {
          throw new UserSigchainError('puk_generation_not_sequential', {
            expected: pukGeneration,
            actual: payload.pukGeneration,
            entryId: entry.id,
            index: i,
            reason: 'recovery_completed_stale_generation',
          })
        }
        pukGeneration = payload.pukGeneration
        break
      }

      case 'recovery_initiated': {
        // Informational — no state mutation needed
        break
      }

      default:
        // Already checked via USER_SIGCHAIN_TYPES set above
        break
    }

    prev = entry.entryHash
    head = entry
  }

  return {
    userId: userId!,
    verifiedDevices,
    revokedDevices,
    pukGeneration,
    masterSigningPubkey,
    head,
    verifiedCount: entries.length,
  }
}
