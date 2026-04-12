/**
 * Hub Key Manager
 *
 * Hub-wide symmetric encryption key management. Each hub has a random 32-byte
 * key that is ECIES-wrapped individually for each member who needs it.
 *
 * Key lifecycle:
 *   1. Admin generates hub key via generateHubKey()
 *   2. Key is wrapped for each member via wrapHubKeyForMember()
 *   3. Members fetch their wrapped key from GET /api/hub/key
 *   4. Members unwrap with their secret key via unwrapHubKey()
 *   5. Hub key encrypts/decrypts hub-scoped data via encryptForHub()/decryptFromHub()
 *   6. On rotation, admin generates new key + re-wraps for all members
 */

import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { LABEL_HUB_KEY_WRAP } from '@shared/crypto-labels'
import {
  type KeyEnvelope,
  type RecipientKeyEnvelope,
  eciesWrapKey,
  symmetricDecrypt,
  symmetricEncrypt,
} from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type { SignedAuditEntry } from '@shared/schemas/audit-entries'
import {
  type ChainCacheStore,
  ChainVerificationError,
  verifyAuditChain,
} from './audit-chain-verifier'
import { eciesUnwrapKey } from './crypto-worker-helpers'

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

/**
 * Generate a random 32-byte hub key.
 * This is NOT derived from any user key — it's pure random.
 */
export function generateHubKey(): Uint8Array {
  return randomBytes(32)
}

/**
 * Wrap a hub key for a specific member using ECIES.
 * Uses LABEL_HUB_KEY_WRAP domain separation to prevent cross-context attacks.
 */
export function wrapHubKeyForMember(
  hubKey: Uint8Array,
  memberPubkeyHex: string
): RecipientKeyEnvelope {
  return {
    pubkey: memberPubkeyHex,
    ...eciesWrapKey(hubKey, memberPubkeyHex, LABEL_HUB_KEY_WRAP),
  }
}

/**
 * Wrap a hub key for multiple members at once.
 * Returns an array of RecipientKeyEnvelopes.
 */
export function wrapHubKeyForMembers(
  hubKey: Uint8Array,
  memberPubkeys: string[]
): RecipientKeyEnvelope[] {
  return memberPubkeys.map((pk) => wrapHubKeyForMember(hubKey, pk))
}

/**
 * Unwrap a hub key from an ECIES envelope.
 * Secret key operations are delegated to the crypto worker.
 */
export async function unwrapHubKey(envelope: KeyEnvelope): Promise<Uint8Array> {
  return eciesUnwrapKey(envelope, LABEL_HUB_KEY_WRAP)
}

/**
 * Encrypt arbitrary data with the hub key using XChaCha20-Poly1305.
 * Returns hex: nonce(24) + ciphertext.
 * The AAD cryptographically binds the ciphertext to a context (e.g. record id + field name).
 */
export function encryptForHub(plaintext: string, hubKey: Uint8Array, aad: Uint8Array): Ciphertext {
  return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, aad)
}

/**
 * Decrypt hub-encrypted data using the hub key.
 * Returns null on decryption failure (wrong key, corrupted data, AAD mismatch, etc.).
 */
export function decryptFromHub(
  packed: Ciphertext,
  hubKey: Uint8Array,
  aad: Uint8Array
): string | null {
  try {
    return new TextDecoder().decode(symmetricDecrypt(packed, hubKey, aad))
  } catch {
    return null
  }
}

/**
 * Rotate the hub key — gated on a verified chain head (Tier 0 Task 22).
 *
 * Before any crypto action we walk the signed audit chain for `hubId`,
 * re-verifying every entry from the last cached checkpoint. After
 * verification we assert that the current head is exactly the entry the
 * caller says triggered this rotation — this is the Albrecht #1 defense
 * against a malicious server silently reordering or replaying membership
 * events. Trigger entries must be one of membership_add, membership_remove,
 * or role_change.
 *
 * The verified member set is passed explicitly by the caller today (Tier 0
 * scope compromise — see TODO below); once Tier 3 introduces
 * `deriveVerifiedMemberSet` the caller will stop passing it.
 *
 * Throws `ChainVerificationError` on any gate failure. Only on success
 * does the new key get generated and wrapped for every member.
 */
export async function rotateHubKey(
  hubId: string,
  expectedTriggerEntryHash: string,
  opts: {
    trustAnchorDevicePubkeys: Set<string>
    memberPubkeys: string[]
    verifyFn?: (
      hubId: string,
      anchors: Set<string>,
      options?: { cacheStore?: ChainCacheStore }
    ) => Promise<SignedAuditEntry>
    cacheStore?: ChainCacheStore
  }
): Promise<{ hubKey: Uint8Array; envelopes: RecipientKeyEnvelope[] }> {
  const verify = opts.verifyFn ?? verifyAuditChain

  // 1. Fetch + verify the full chain before any crypto action.
  const head = await verify(hubId, opts.trustAnchorDevicePubkeys, {
    ...(opts.cacheStore ? { cacheStore: opts.cacheStore } : {}),
  })

  // 2. Assert the head is the membership change that triggered this rotation.
  const validTriggerTypes = ['membership_add', 'membership_remove', 'role_change'] as const
  if (!(validTriggerTypes as readonly string[]).includes(head.payload.type)) {
    throw new ChainVerificationError('invalid_rotation_trigger_type', {
      type: head.payload.type,
    })
  }
  if (head.entryHash !== expectedTriggerEntryHash) {
    throw new ChainVerificationError('rotation_trigger_not_at_head', {
      expected: expectedTriggerEntryHash,
      actual: head.entryHash,
    })
  }

  // 3. TODO(tier-3): Derive memberPubkeys from the verified chain itself
  // (spec §0.2.7 calls this `deriveVerifiedMemberSet`). For Tier 0 the
  // caller passes the set explicitly — the gate above still prevents a
  // malicious server from forging the trigger event, and Tier 3 will
  // close the remaining gap of trusting the caller's member list.
  const hubKey = generateHubKey()
  const envelopes = wrapHubKeyForMembers(hubKey, opts.memberPubkeys)
  return { hubKey, envelopes }
}
