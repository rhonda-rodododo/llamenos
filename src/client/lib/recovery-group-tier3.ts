/**
 * Recovery Group extension for Tier 3: dual-wraps BOTH the master seed
 * and the PUK seed under a Recovery Group HPKE public key.
 *
 * The Recovery Group is a K-of-N admin quorum whose reconstructed private
 * key can unwrap these envelopes during account recovery. Both seeds are
 * wrapped independently with domain-separated AAD so they cannot be
 * confused or replayed across users or seed types.
 */

import {
  LABEL_MASTER_RECOVERY_GROUP_WRAP,
  LABEL_PUK_RECOVERY_GROUP_WRAP,
} from '@shared/crypto-labels'
import type { EnvelopeV3 } from '@shared/envelope-v3'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'

/** Both seeds HPKE-wrapped for the Recovery Group. */
export interface RecoveryGroupWrappedSecrets {
  masterSeedEnvelope: EnvelopeV3
  pukSeedEnvelope: EnvelopeV3
}

/** Input for wrapping both seeds. */
export interface WrapSecretsInput {
  masterSeed: Uint8Array
  pukSeed: Uint8Array
  recoveryGroupPubkey: CryptoKey
  userId: string
}

/** Input for unwrapping both seeds. */
export interface UnwrapSecretsInput {
  masterSeedEnvelope: EnvelopeV3
  pukSeedEnvelope: EnvelopeV3
  recoveryGroupPrivateKey: CryptoKey
  userId: string
}

/**
 * HPKE-seal both seeds under the Recovery Group public key with
 * domain-separated AAD per seed type.
 */
export async function wrapSecretsForRecoveryGroup(
  input: WrapSecretsInput
): Promise<RecoveryGroupWrappedSecrets> {
  const { masterSeed, pukSeed, recoveryGroupPubkey, userId } = input

  const masterAad = buildAad(LABEL_MASTER_RECOVERY_GROUP_WRAP, userId, 'master-seed')
  const pukAad = buildAad(LABEL_PUK_RECOVERY_GROUP_WRAP, userId, 'puk-seed')

  const [masterSeedEnvelope, pukSeedEnvelope] = await Promise.all([
    hpkeSeal(masterSeed, recoveryGroupPubkey, LABEL_MASTER_RECOVERY_GROUP_WRAP, masterAad),
    hpkeSeal(pukSeed, recoveryGroupPubkey, LABEL_PUK_RECOVERY_GROUP_WRAP, pukAad),
  ])

  return { masterSeedEnvelope, pukSeedEnvelope }
}

/**
 * HPKE-open both envelopes with the reconstructed Recovery Group private key.
 */
export async function unwrapSecretsFromRecoveryGroup(
  input: UnwrapSecretsInput
): Promise<{ masterSeed: Uint8Array; pukSeed: Uint8Array }> {
  const { masterSeedEnvelope, pukSeedEnvelope, recoveryGroupPrivateKey, userId } = input

  const masterAad = buildAad(LABEL_MASTER_RECOVERY_GROUP_WRAP, userId, 'master-seed')
  const pukAad = buildAad(LABEL_PUK_RECOVERY_GROUP_WRAP, userId, 'puk-seed')

  const [masterSeed, pukSeed] = await Promise.all([
    hpkeOpen(
      masterSeedEnvelope,
      recoveryGroupPrivateKey,
      LABEL_MASTER_RECOVERY_GROUP_WRAP,
      masterAad
    ),
    hpkeOpen(pukSeedEnvelope, recoveryGroupPrivateKey, LABEL_PUK_RECOVERY_GROUP_WRAP, pukAad),
  ])

  return { masterSeed, pukSeed }
}
