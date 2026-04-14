import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { RootKekEnvelopeBundle } from '../../../shared/schemas/root-kek-envelope'
import { jsonb } from '../bun-jsonb'

/**
 * Tier 2 OPAQUE server-side state.
 *
 * `opaqueServerSetup` holds the single RFC-9807 ServerSetup blob per purpose.
 * A Llamenos hub runs independent OPAQUE instances for the three unlock
 * modes the Tier 2 architecture admits — `root-kek`, `recovery-phrase` and
 * `recovery-group`. Each row is rotated only by explicit admin action; the
 * blob is opaque base64url bytes produced by the vendored WASM wrapper.
 *
 * `userOpaqueRecords` stores the per-user password file produced by a
 * successful OPAQUE registration. The password file is not a password hash;
 * it is the wire artifact that lets the server participate in later login
 * flows without ever seeing the password. Composite primary key
 * `(userPubkey, purpose)` matches the CipherSuite: a user may have a
 * record for each OPAQUE purpose at once.
 *
 * `userRootKekEnvelopes` is the server's mirror of the Tier 2 IDB bundle so
 * a recovering device can repopulate its root-KEK store from authenticated
 * API state. The server cannot unwrap any envelope — the HKDF salts and
 * wrapped bytes are opaque — but persisting them here means losing local
 * IDB is no longer catastrophic if the user still remembers their factors.
 */
export const opaqueServerSetup = pgTable('opaque_server_setup', {
  purpose: text('purpose').primaryKey(),
  setup: text('setup').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userOpaqueRecords = pgTable(
  'user_opaque_records',
  {
    userPubkey: text('user_pubkey').notNull(),
    purpose: text('purpose').notNull(),
    credentialIdentifier: text('credential_identifier').notNull(),
    passwordFile: text('password_file').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userPubkey, t.purpose] }),
    userIdx: index('user_opaque_records_user_idx').on(t.userPubkey),
  })
)

export const userRootKekEnvelopes = pgTable(
  'user_root_kek_envelopes',
  {
    userPubkey: text('user_pubkey').primaryKey(),
    rootKeyId: text('root_key_id').notNull(),
    version: integer('version').notNull().default(3),
    bundle: jsonb<RootKekEnvelopeBundle>()('bundle').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    rootKeyIdx: index('user_root_kek_envelopes_root_key_idx').on(t.rootKeyId),
  })
)
