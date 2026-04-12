import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'

/**
 * Tier 2 PR-C — Recovery Group tables.
 *
 * `hubRecoveryGroups`: One row per hub's active Recovery Group. Stores the
 * group public key, Shamir threshold/total, and per-share SHA-256 commitments
 * for tamper detection during recovery ceremonies.
 *
 * `hubRecoveryGroupShares`: Per-admin HPKE-wrapped Shamir shares. Each admin
 * holds exactly one share; the server stores the ciphertext envelope.
 *
 * `userRecoveryEnvelopes`: Per-(user, hub) envelope wrapping the user's root
 * KEK under the hub's Recovery Group public key. Enables admin-assisted
 * recovery when the user loses all enrolled factors.
 *
 * `recoverySessions`: Transient recovery ceremony state. Created when a user
 * initiates recovery; tracks admin share contributions, threshold readiness,
 * the 24h delay, and optional emergency override.
 *
 * Tier 3 PR-C — Recovery Request table.
 *
 * `recoveryRequests`: Admin-initiated recovery request tracking with Shamir
 * threshold enforcement. Tracks participant count, recovery type, associated
 * device and sigchain entry, and expiry for stale request cleanup.
 */

export const hubRecoveryGroups = pgTable('hub_recovery_groups', {
  hubId: uuid('hub_id').primaryKey(),
  groupPublicKey: text('group_public_key').notNull(),
  threshold: integer('threshold').notNull(),
  totalShares: integer('total_shares').notNull(),
  shareCommitments: jsonb<string[]>()('share_commitments').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
})

export const hubRecoveryGroupShares = pgTable(
  'hub_recovery_group_shares',
  {
    hubId: uuid('hub_id').notNull(),
    adminPubkey: text('admin_pubkey').notNull(),
    shareEnvelope: text('share_envelope').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.hubId, t.adminPubkey] }),
    hubIdx: index('hub_recovery_group_shares_hub_idx').on(t.hubId),
  })
)

export const userRecoveryEnvelopes = pgTable(
  'user_recovery_envelopes',
  {
    userPubkey: text('user_pubkey').notNull(),
    hubId: uuid('hub_id').notNull(),
    envelope: text('envelope').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userPubkey, t.hubId] }),
    hubIdx: index('user_recovery_envelopes_hub_idx').on(t.hubId),
  })
)

export interface RecoveryContribution {
  byAdminPubkey: string
  encryptedShare: string
}

export const recoverySessions = pgTable(
  'recovery_sessions',
  {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    hubId: uuid('hub_id').notNull(),
    userPubkey: text('user_pubkey').notNull(),
    coordinatorPubkey: text('coordinator_pubkey').notNull(),
    newDevicePubkey: text('new_device_pubkey').notNull(),
    status: text('status', { enum: ['pending', 'ready', 'completed', 'expired', 'cancelled'] })
      .notNull()
      .default('pending'),
    contributions: jsonb<RecoveryContribution[]>()('contributions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    emergencyOverride: jsonb<{
      justification: string
      coApproverPubkey: string
      coApproverSignature: string
    } | null>()('emergency_override'),
  },
  (t) => ({
    hubIdx: index('recovery_sessions_hub_idx').on(t.hubId),
    userIdx: index('recovery_sessions_user_idx').on(t.userPubkey),
    statusIdx: index('recovery_sessions_status_idx').on(t.status),
  })
)

/**
 * `recoveryRequests`: Admin-initiated recovery request tracking.
 *
 * Tracks Shamir threshold enforcement, participant count, recovery type
 * (paper_key | recovery_group | admin_reset), associated new device and
 * sigchain entry, and expiry timestamp for stale request cleanup.
 *
 * Lifecycle: pending → completed (threshold met + device enrolled)
 *                    → expired  (stale after maxAgeMs)
 */
export const recoveryRequests = pgTable('recovery_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  initiatedByUserId: text('initiated_by_user_id').notNull(),
  recoveryType: text('recovery_type').notNull().default('admin_reset'),
  status: text('status').notNull().default('pending'),
  threshold: integer('threshold').notNull().default(2),
  participantsCount: integer('participants_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  newDeviceId: text('new_device_id'),
  sigchainEntryId: text('sigchain_entry_id'),
})
