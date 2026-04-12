/**
 * AuditLogService — Tier 0 signed audit chain (server side).
 *
 * Verifies and appends {@link SignedAuditEntry} records produced by clients:
 *   1. zod validation of the entry shape
 *   2. prevEntryHash matches the current chain head for the hub
 *   3. entryHash matches a server-side recomputation
 *   4. schnorr signature validates against signerPubkey + entryHash
 *   5. signer is a known user
 *   6. signer's role is authorized for the payload type
 *
 * The service is storage-agnostic — it takes a small port object so the unit
 * tests can run without a live database, and so production wiring can bind
 * it to Drizzle via {@link createDrizzleAuditLogService}.
 *
 * TODO(tier-3): Steps 5 and 6 currently fall back to a users-table lookup
 * because DeviceRegistry (plan-required per-device signer registration) is a
 * Tier 3 concern. When the real device registry lands, replace
 * {@link AuditSignerLookup} with a per-device query so signer revocation is
 * finer-grained than "deactivate the user". See PR #68 compromise #7.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import {
  type AuditEntryPayload,
  type SignedAuditEntry,
  SignedAuditEntrySchema,
} from '@shared/schemas/audit-entries'
import { and, asc, desc, eq, gt } from 'drizzle-orm'
import type { Database } from '../db'
import { signedAuditEntries } from '../db/schema'
import { users } from '../db/schema/identity'

// ---- errors ----

export type AuditChainErrorCode =
  | 'prev_entry_hash_mismatch'
  | 'entry_hash_mismatch'
  | 'signature_invalid'
  | 'signer_unknown'
  | 'signer_not_authorized_for_payload'
  | 'chain_conflict'

export class AuditChainError extends Error {
  constructor(
    public readonly code: AuditChainErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(code)
    this.name = 'AuditChainError'
  }
}

// ---- ports ----

export interface AuditSigner {
  id: string
  role: 'volunteer' | 'admin' | 'super_admin' | string
}

export type AuditSignerLookup = (pubkey: string) => Promise<AuditSigner | null>

export interface AuditLogServicePort {
  getHead(hubId: string): Promise<SignedAuditEntry | null>
  insert(entry: SignedAuditEntry): Promise<void>
  findSignerByPubkey: AuditSignerLookup
}

// ---- authorization ----

function payloadIsAuthorizedFor(payload: AuditEntryPayload, role: string): boolean {
  switch (payload.type) {
    case 'membership_add':
    case 'membership_remove':
    case 'role_change':
    case 'hub_key_rotate':
    case 'hub_delete':
      return role === 'admin' || role === 'super_admin'
    case 'hub_create':
      return role === 'super_admin'
    case 'device_fingerprint_verified':
      return role === 'admin' || role === 'super_admin'
    case 'device_add':
    case 'device_revoke':
      // Any authenticated signer may claim device-lifecycle events in Tier 0;
      // Tier 3's DeviceRegistry will tighten this once per-device identity exists.
      return true
    default:
      return false
  }
}

// ---- db error translation ----

/**
 * Detect a postgres unique-violation error (SQLSTATE 23505) from either the
 * bun:sql or postgres.js drivers. Both expose `.code` on the thrown error
 * value. The unique constraints from migration 0052 surface here.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === '23505'
}

// ---- service ----

export class AuditLogService {
  constructor(private readonly port: AuditLogServicePort) {}

  /**
   * Verify and append a signed audit entry.
   *
   * TODO(tier-3): replace users-table signer lookup with a DeviceRegistry
   * per-device check so signer revocation can be granular.
   */
  async appendSigned(entry: SignedAuditEntry): Promise<void> {
    SignedAuditEntrySchema.parse(entry)

    const head = await this.port.getHead(entry.hubId)
    const expectedPrev = head?.entryHash ?? null
    if (entry.prevEntryHash !== expectedPrev) {
      throw new AuditChainError('prev_entry_hash_mismatch', {
        expected: expectedPrev,
        actual: entry.prevEntryHash,
      })
    }

    const recomputed = computeEntryHash({
      id: entry.id,
      hubId: entry.hubId,
      payload: entry.payload,
      prevEntryHash: entry.prevEntryHash,
      createdAt: entry.createdAt,
      signerDeviceId: entry.signerDeviceId,
      signerPubkey: entry.signerPubkey,
    })
    if (recomputed !== entry.entryHash) {
      throw new AuditChainError('entry_hash_mismatch', {
        expected: recomputed,
        actual: entry.entryHash,
      })
    }

    const sigValid = schnorr.verify(
      hexToBytes(entry.signature),
      hexToBytes(entry.entryHash),
      hexToBytes(entry.signerPubkey)
    )
    if (!sigValid) {
      throw new AuditChainError('signature_invalid')
    }

    const signer = await this.port.findSignerByPubkey(entry.signerPubkey)
    if (!signer) {
      throw new AuditChainError('signer_unknown', { pubkey: entry.signerPubkey })
    }
    if (!payloadIsAuthorizedFor(entry.payload, signer.role)) {
      throw new AuditChainError('signer_not_authorized_for_payload', {
        payloadType: entry.payload.type,
        signerRole: signer.role,
      })
    }

    try {
      await this.port.insert(entry)
    } catch (err) {
      // Translate postgres unique-violations raised by migration 0052's
      // UNIQUE(hub_id, prev_entry_hash), UNIQUE(entry_hash), and the partial
      // unique index on genesis entries. A concurrent appender raced us to
      // the head — surface this as a structured chain error instead of a 500.
      if (isUniqueViolation(err)) {
        throw new AuditChainError('chain_conflict', {
          constraint: (err as { constraint_name?: string }).constraint_name,
        })
      }
      throw err
    }
  }
}

// ---- Drizzle wiring ----

/**
 * Role strings used by {@link payloadIsAuthorizedFor}. The stored
 * `users.roles` column is a jsonb string array of IdP-level role IDs
 * (`role-super-admin`, `role-admin`, `role-volunteer`). Map to the canonical
 * role name used in the authorization check.
 */
function rolesToCanonical(roleIds: string[] | undefined): string {
  const r = roleIds ?? []
  if (r.includes('role-super-admin') || r.includes('super_admin')) return 'super_admin'
  if (r.includes('role-admin') || r.includes('admin')) return 'admin'
  return 'volunteer'
}

function rowToEntry(row: typeof signedAuditEntries.$inferSelect): SignedAuditEntry {
  return {
    id: row.id,
    hubId: row.hubId,
    payload: row.payload as AuditEntryPayload,
    prevEntryHash: row.prevEntryHash,
    entryHash: row.entryHash,
    signerDeviceId: row.signerDeviceId,
    signerPubkey: row.signerPubkey,
    signature: row.signature,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Build an {@link AuditLogService} bound to a Drizzle database. The returned
 * service exposes the verification path plus read helpers used by the audit
 * routes.
 */
export function createDrizzleAuditLogService(db: Database): DrizzleAuditLogService {
  return new DrizzleAuditLogService(db)
}

export class DrizzleAuditLogService {
  private readonly service: AuditLogService

  constructor(private readonly db: Database) {
    this.service = new AuditLogService({
      getHead: (hubId) => this.getHead(hubId),
      insert: (entry) => this.insertRow(entry),
      findSignerByPubkey: (pubkey) => this.findSignerByPubkey(pubkey),
    })
  }

  appendSigned(entry: SignedAuditEntry): Promise<void> {
    return this.service.appendSigned(entry)
  }

  async getHead(hubId: string): Promise<SignedAuditEntry | null> {
    const rows = await this.db
      .select()
      .from(signedAuditEntries)
      .where(eq(signedAuditEntries.hubId, hubId))
      .orderBy(desc(signedAuditEntries.createdAt))
      .limit(1)
    return rows[0] ? rowToEntry(rows[0]) : null
  }

  async list(hubId: string, opts: { sinceEntryHash?: string } = {}): Promise<SignedAuditEntry[]> {
    if (opts.sinceEntryHash) {
      const anchor = await this.db
        .select({ createdAt: signedAuditEntries.createdAt })
        .from(signedAuditEntries)
        .where(
          and(
            eq(signedAuditEntries.hubId, hubId),
            eq(signedAuditEntries.entryHash, opts.sinceEntryHash)
          )
        )
        .limit(1)
      if (anchor[0]) {
        const rows = await this.db
          .select()
          .from(signedAuditEntries)
          .where(
            and(
              eq(signedAuditEntries.hubId, hubId),
              gt(signedAuditEntries.createdAt, anchor[0].createdAt)
            )
          )
          .orderBy(asc(signedAuditEntries.createdAt))
        return rows.map(rowToEntry)
      }
    }
    const rows = await this.db
      .select()
      .from(signedAuditEntries)
      .where(eq(signedAuditEntries.hubId, hubId))
      .orderBy(asc(signedAuditEntries.createdAt))
    return rows.map(rowToEntry)
  }

  private async insertRow(entry: SignedAuditEntry): Promise<void> {
    await this.db.insert(signedAuditEntries).values({
      id: entry.id,
      hubId: entry.hubId,
      type: entry.payload.type,
      payload: entry.payload,
      prevEntryHash: entry.prevEntryHash,
      entryHash: entry.entryHash,
      signerDeviceId: entry.signerDeviceId,
      signerPubkey: entry.signerPubkey,
      signature: entry.signature,
      createdAt: new Date(entry.createdAt),
    })
  }

  private async findSignerByPubkey(pubkey: string): Promise<AuditSigner | null> {
    const rows = await this.db
      .select({ id: users.pubkey, roles: users.roles })
      .from(users)
      .where(eq(users.pubkey, pubkey))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return { id: row.id, role: rolesToCanonical(row.roles as string[] | undefined) }
  }
}
