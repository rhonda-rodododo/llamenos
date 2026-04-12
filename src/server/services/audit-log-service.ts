/**
 * AuditLogService — signed audit chain (server side).
 *
 * Verifies and appends {@link SignedAuditEntry} records produced by clients:
 *   1. zod validation of the entry shape
 *   2. prevEntryHash matches the current chain head for the hub
 *   3. entryHash matches a server-side recomputation
 *   4. schnorr signature validates against signerPubkey + entryHash
 *   5. signer is a known user or registered device
 *   6. signer's role is authorized for the payload type
 *
 * The service is storage-agnostic — it takes a small port object so the unit
 * tests can run without a live database, and so production wiring can bind
 * it to Drizzle via {@link createDrizzleAuditLogService}.
 *
 * Signer resolution checks the device registry first (per-device signing
 * pubkeys from Tier 3), then falls back to the users.pubkey column for
 * backward compatibility with Tier 0 entries.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import {
  type AuditEntryPayload,
  type SignedAuditEntry,
  SignedAuditEntrySchema,
} from '@shared/schemas/audit-entries'
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import type { Database } from '../db'
import { signedAuditEntries, userDevices } from '../db/schema'
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
    // Admin-level hub management
    case 'membership_add':
    case 'membership_remove':
    case 'role_change':
    case 'hub_key_rotate':
    case 'hub_delete':
    case 'hub_ptk_rotate':
      return role === 'admin' || role === 'super_admin'
    case 'hub_create':
      return role === 'super_admin'
    // Tier 0 device lifecycle (legacy)
    case 'device_add':
    case 'device_revoke':
      return true
    // Tier 2 factor lifecycle — users manage their own factors
    case 'factor_add':
    case 'factor_remove':
    case 'root_kek_rotate':
      return true
    // Tier 3 sigchain identity events — any authenticated user for their own
    case 'user_init':
    case 'tier3_device_add':
    case 'tier3_device_remove':
    case 'puk_rotate':
    case 'user_master_signing_update':
      return true
    // Tier 3 cross-signing — any authenticated signer
    case 'device_cross_sign':
    case 'user_cross_sign':
      return true
    // Tier 3 recovery — any authenticated signer
    case 'recovery_initiated':
    case 'recovery_completed':
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
   * Signer resolution checks the device registry first for per-device
   * signing pubkeys, then falls back to users.pubkey for Tier 0 entries.
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
    // Tier 3: check device registry first
    const deviceRows = await this.db
      .select({ userId: userDevices.userId })
      .from(userDevices)
      .where(and(eq(userDevices.signingPubkey, pubkey), isNull(userDevices.revokedAt)))
      .limit(1)
    if (deviceRows[0]) {
      const userRows = await this.db
        .select({ roles: users.roles })
        .from(users)
        .where(eq(users.pubkey, deviceRows[0].userId))
        .limit(1)
      if (userRows[0]) {
        return {
          id: deviceRows[0].userId,
          role: rolesToCanonical(userRows[0].roles as string[] | undefined),
        }
      }
    }
    // Fallback: Tier 0 users.pubkey lookup
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
