import type { Ciphertext } from '@shared/crypto-types'
import { eq, inArray, sql } from 'drizzle-orm'
import { DEFAULT_ROLES } from '../../../shared/permissions'
import type { Role } from '../../../shared/permissions'
import type { Database } from '../../db'
import { hubKeys, roles } from '../../db/schema'
import type { TtlCache } from '../../lib/cache'
import type { CryptoService } from '../../lib/crypto-service'
import { AppError } from '../../lib/errors'
import type { CreateRoleData, UpdateRoleData } from '../../types'

function rowToRole(r: typeof roles.$inferSelect): Role {
  return {
    id: r.id,
    name: '', // Client decrypts encryptedName with hub key
    permissions: r.permissions as string[],
    isDefault: r.isDefault,
    isSystem: r.id === 'role-super-admin',
    description: '', // Client decrypts encryptedDescription with hub key
    encryptedName: r.encryptedName ?? undefined,
    encryptedDescription: r.encryptedDescription ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.createdAt.toISOString(),
  }
}

function mapRoleRows(rows: (typeof roles.$inferSelect)[]): Role[] {
  return rows.map((r) => rowToRole(r))
}

export async function listRoles(
  db: Database,
  cryptoService: CryptoService,
  roleCache: TtlCache<Role[]>,
  hubKeyCache: TtlCache<Uint8Array | null>,
  hubId?: string
): Promise<Role[]> {
  const cacheKey = hubId ?? '__global__'
  const cached = roleCache.get(cacheKey)
  if (cached) return cached

  const hId = hubId ?? null
  const rows = hId
    ? await db.select().from(roles).where(eq(roles.hubId, hId))
    : await db.select().from(roles).where(sql`${roles.hubId} IS NULL`)

  if (rows.length === 0) {
    // Seed default roles on first call — use onConflictDoNothing to make concurrent first-calls idempotent
    const now = new Date()
    // Encrypt default role names with hub key (server-initiated seeding)
    const hubKey = hId ? await getHubKeyForRoles(db, cryptoService, hubKeyCache, hId) : null
    const seeded = await db
      .insert(roles)
      .values(
        DEFAULT_ROLES.map((r) => ({
          id: r.id,
          hubId: hId,
          // AAD must match the client's `(row.id, fieldName)` formula so
          // hub-field-crypto.ts can decrypt the seeded row.
          encryptedName: hubKey
            ? cryptoService.hubEncryptField(r.name, hubKey, r.id, 'encrypted_name')
            : (r.name as Ciphertext), // Plaintext until hub key available (pre-production)
          encryptedDescription: r.description
            ? hubKey
              ? cryptoService.hubEncryptField(r.description, hubKey, r.id, 'encrypted_description')
              : (r.description as Ciphertext)
            : null,
          permissions: r.permissions,
          isDefault: r.isDefault,
          createdAt: now,
        }))
      )
      .onConflictDoNothing()
      .returning()
    // Re-fetch in case another concurrent request already seeded (returning() may be empty)
    if (seeded.length === 0) {
      const refetched = hId
        ? await db.select().from(roles).where(eq(roles.hubId, hId))
        : await db.select().from(roles).where(sql`${roles.hubId} IS NULL`)
      const result = mapRoleRows(refetched)
      roleCache.set(cacheKey, result)
      return result
    }
    const result = seeded.map((r) => rowToRole(r))
    roleCache.set(cacheKey, result)
    return result
  }
  const result = mapRoleRows(rows)
  roleCache.set(cacheKey, result)
  return result
}

export async function createRole(
  db: Database,
  roleCache: TtlCache<Role[]>,
  data: CreateRoleData
): Promise<Role> {
  roleCache.clear()
  const hubId = data.hubId ?? null

  // Client provides hub-key encrypted name/description
  const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
  const encryptedDescription = (data.encryptedDescription ??
    data.description ??
    null) as Ciphertext | null

  // Client-provided id is required for AAD binding: the client seals the
  // ciphertext with buildAad(label, id, fieldName) before POST. Accept it
  // verbatim so decrypt on refetch matches. Legacy callers that omit id
  // fall back to a server-generated UUID.
  const id = data.id ?? `role-${crypto.randomUUID()}`
  const [row] = await db
    .insert(roles)
    .values({
      id,
      hubId,
      encryptedName,
      encryptedDescription,
      permissions: data.permissions,
      isDefault: false,
      createdAt: new Date(),
    })
    .returning()
  // Clear cache AFTER insert — a concurrent listRoles() may have re-populated
  // the cache between the pre-insert clear and the DB insert completing
  roleCache.clear()
  return rowToRole(row)
}

export async function updateRole(
  db: Database,
  roleCache: TtlCache<Role[]>,
  id: string,
  data: UpdateRoleData
): Promise<Role> {
  roleCache.clear()
  const rows = await db.select().from(roles).where(eq(roles.id, id)).limit(1)
  const role = rows[0]
  if (!role) throw new AppError(404, 'Role not found')
  // Super-admin role cannot be modified
  if (role.id === 'role-super-admin') {
    throw new AppError(403, 'Cannot modify the super-admin role')
  }

  // Client provides hub-key encrypted name/description; fall back to plaintext
  const encFields: Record<string, unknown> = {}
  if (data.encryptedName) {
    encFields.encryptedName = data.encryptedName
  } else if (data.name !== undefined) {
    encFields.encryptedName = data.name as Ciphertext
  }
  if (data.encryptedDescription !== undefined) {
    encFields.encryptedDescription = data.encryptedDescription ?? null
  } else if (data.description !== undefined) {
    encFields.encryptedDescription = (data.description as Ciphertext) ?? null
  }

  const [updated] = await db
    .update(roles)
    .set({
      ...(data.permissions ? { permissions: data.permissions } : {}),
      ...encFields,
    })
    .where(eq(roles.id, id))
    .returning()
  roleCache.clear()
  return rowToRole(updated)
}

export async function deleteRole(
  db: Database,
  roleCache: TtlCache<Role[]>,
  id: string
): Promise<void> {
  roleCache.clear()
  const rows = await db.select().from(roles).where(eq(roles.id, id)).limit(1)
  const role = rows[0]
  if (!role) throw new AppError(404, 'Role not found')
  if (role.isDefault) throw new AppError(403, 'Cannot delete default roles')
  await db.delete(roles).where(eq(roles.id, id))
  roleCache.clear()
}

/**
 * Fetch specific roles by ID directly from DB (bypasses cache).
 * Used when the cached role list is missing roles that a user references.
 */
export async function getRolesByIds(db: Database, ids: string[]): Promise<Role[]> {
  if (ids.length === 0) return []
  const rows = await db.select().from(roles).where(inArray(roles.id, ids))
  return mapRoleRows(rows)
}

/** Internal helper — resolves hub key for role seeding. */
async function getHubKeyForRoles(
  db: Database,
  cryptoService: CryptoService,
  hubKeyCache: TtlCache<Uint8Array | null>,
  hubId: string
): Promise<Uint8Array | null> {
  if (!hubId || hubId === 'global') return null
  return hubKeyCache.getOrSet(hubId, async () => {
    const envelopes = await db.select().from(hubKeys).where(eq(hubKeys.hubId, hubId))
    if (envelopes.length === 0) return null
    try {
      return cryptoService.unwrapHubKey(
        envelopes.map((r) => ({
          pubkey: r.pubkey,
          wrappedKey: r.encryptedKey,
          ephemeralPubkey: r.ephemeralPubkey ?? '',
        }))
      )
    } catch {
      return null
    }
  })
}
