import type { Ciphertext } from '@shared/crypto-types'
import { eq, inArray, sql } from 'drizzle-orm'
import type { Hub } from '../../../shared/types'
import type { Database } from '../../db'
import {
  activeCalls,
  activeShifts,
  auditLog,
  bans,
  blastDeliveries,
  blasts,
  callLegs,
  callRecords,
  callSettings,
  callTokens,
  conversations,
  customFieldDefinitions,
  fallbackGroup,
  fileRecords,
  hubKeys,
  hubStorageCredentials,
  hubStorageSettings,
  hubs,
  ivrAudio,
  ivrLanguages,
  messageEnvelopes,
  messagingConfig,
  noteEnvelopes,
  reportCategories,
  reportTypes,
  ringGroups,
  roles,
  setupState,
  shiftOverrides,
  shiftSchedules,
  spamSettings,
  subscribers,
  telephonyConfig,
  transcriptionSettings,
} from '../../db/schema'
import type { TtlCache } from '../../lib/cache'
import type { CryptoService } from '../../lib/crypto-service'
import { AppError } from '../../lib/errors'
import type { CreateHubData, HubKeyEntry } from '../../types'

/** @knipignore — hub row mapper; exported for use by test utilities and future cross-service hub loading */
export function rowToHub(r: typeof hubs.$inferSelect): Hub {
  return {
    id: r.id,
    name: '', // Client decrypts encryptedName with hub key
    description: undefined, // Client decrypts encryptedDescription with hub key
    encryptedName: r.encryptedName ?? undefined,
    encryptedDescription: r.encryptedDescription ?? undefined,
    status: r.status as Hub['status'],
    phoneNumber: r.phoneNumber ?? undefined,
    createdBy: r.createdBy,
    allowSuperAdminAccess: r.allowSuperAdminAccess,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

export async function getHubs(db: Database): Promise<Hub[]> {
  const rows = await db.select().from(hubs)
  return rows.map((r) => rowToHub(r))
}

export async function getHub(db: Database, id: string): Promise<Hub | null> {
  const rows = await db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
  if (!rows[0]) return null
  return rowToHub(rows[0])
}

export async function createHub(db: Database, data: CreateHubData): Promise<Hub> {
  const now = new Date()
  const hubId = data.id || crypto.randomUUID()

  // Client provides hub-key encrypted name/description
  const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
  const encryptedDescription = (data.encryptedDescription ??
    data.description ??
    null) as Ciphertext | null

  const [row] = await db
    .insert(hubs)
    .values({
      id: hubId,
      encryptedName,
      encryptedDescription,
      status: data.status ?? 'active',
      phoneNumber: data.phoneNumber ?? null,
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return rowToHub(row)
}

export async function updateHub(db: Database, id: string, data: Partial<Hub>): Promise<Hub> {
  const rows = await db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
  if (!rows[0]) throw new AppError(404, 'Hub not found')

  // Client provides hub-key encrypted name/description; fall back to plaintext
  const encFields: Record<string, unknown> = {}
  if (data.encryptedName !== undefined) {
    encFields.encryptedName = data.encryptedName
  } else if (data.name !== undefined) {
    encFields.encryptedName = data.name as Ciphertext
  }
  if (data.encryptedDescription !== undefined) {
    encFields.encryptedDescription = data.encryptedDescription ?? null
  } else if (data.description !== undefined) {
    encFields.encryptedDescription = (data.description as Ciphertext) ?? null
  }

  const [row] = await db
    .update(hubs)
    .set({
      ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.allowSuperAdminAccess !== undefined && {
        allowSuperAdminAccess: data.allowSuperAdminAccess,
      }),
      ...encFields,
      updatedAt: new Date(),
    })
    .where(eq(hubs.id, id))
    .returning()
  return rowToHub(row)
}

export async function archiveHub(db: Database, id: string): Promise<void> {
  const rows = await db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
  if (!rows[0]) throw new AppError(404, 'Hub not found')
  await db.update(hubs).set({ status: 'archived', updatedAt: new Date() }).where(eq(hubs.id, id))
}

/**
 * Cascade-delete a hub and all hub-scoped data.
 *
 * Order matters: delete children before parents to avoid FK violations.
 * Runs inside a single transaction for atomicity.
 */
export async function deleteHub(db: Database, id: string): Promise<void> {
  const rows = await db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
  if (!rows[0]) throw new AppError(404, 'Hub not found')

  await db.transaction(async (tx) => {
    // --- Storage settings + credentials ---
    await tx.delete(hubStorageCredentials).where(eq(hubStorageCredentials.hubId, id))
    await tx.delete(hubStorageSettings).where(eq(hubStorageSettings.hubId, id))

    // --- Settings singletons (hub-scoped) ---
    await tx.delete(spamSettings).where(eq(spamSettings.hubId, id))
    await tx.delete(transcriptionSettings).where(eq(transcriptionSettings.hubId, id))
    await tx.delete(callSettings).where(eq(callSettings.hubId, id))
    await tx.delete(messagingConfig).where(eq(messagingConfig.hubId, id))
    await tx.delete(telephonyConfig).where(eq(telephonyConfig.hubId, id))
    await tx.delete(setupState).where(eq(setupState.hubId, id))
    await tx.delete(fallbackGroup).where(eq(fallbackGroup.hubId, id))
    await tx.delete(customFieldDefinitions).where(eq(customFieldDefinitions.hubId, id))
    await tx.delete(ivrLanguages).where(eq(ivrLanguages.hubId, id))
    await tx.delete(ivrAudio).where(eq(ivrAudio.hubId, id))
    await tx.delete(reportCategories).where(eq(reportCategories.hubId, id))
    await tx.delete(roles).where(eq(roles.hubId, id))
    await tx.delete(hubKeys).where(eq(hubKeys.hubId, id))

    // --- Shift data ---
    await tx.delete(shiftSchedules).where(eq(shiftSchedules.hubId, id))
    await tx.delete(shiftOverrides).where(eq(shiftOverrides.hubId, id))
    await tx.delete(ringGroups).where(eq(ringGroups.hubId, id))
    await tx.delete(activeShifts).where(eq(activeShifts.hubId, id))

    // --- Call data ---
    await tx.delete(callTokens).where(eq(callTokens.hubId, id))
    await tx.delete(callLegs).where(eq(callLegs.hubId, id))
    await tx.delete(activeCalls).where(eq(activeCalls.hubId, id))

    // --- Records data ---
    await tx.delete(bans).where(eq(bans.hubId, id))
    await tx.delete(auditLog).where(eq(auditLog.hubId, id))
    await tx.delete(callRecords).where(eq(callRecords.hubId, id))
    await tx.delete(noteEnvelopes).where(eq(noteEnvelopes.hubId, id))

    // --- Blasts (delete deliveries via blastId before blasts) ---
    const hubBlasts = await tx.select({ id: blasts.id }).from(blasts).where(eq(blasts.hubId, id))
    if (hubBlasts.length > 0) {
      const blastIds = hubBlasts.map((b) => b.id)
      await tx.delete(blastDeliveries).where(inArray(blastDeliveries.blastId, blastIds))
    }
    await tx.delete(subscribers).where(eq(subscribers.hubId, id))
    await tx.delete(blasts).where(eq(blasts.hubId, id))

    // --- Conversations + messages + file records ---
    const hubConvs = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.hubId, id))
    if (hubConvs.length > 0) {
      const convIds = hubConvs.map((c) => c.id)
      await tx.delete(messageEnvelopes).where(inArray(messageEnvelopes.conversationId, convIds))
      await tx.delete(fileRecords).where(inArray(fileRecords.conversationId, convIds))
    }
    await tx.delete(conversations).where(eq(conversations.hubId, id))

    // --- Remove hub from users' hubRoles JSONB arrays ---
    await tx.execute(
      sql`UPDATE users
        SET hub_roles = COALESCE(
          (SELECT jsonb_agg(elem)
           FROM jsonb_array_elements(hub_roles) AS elem
           WHERE elem->>'hubId' != ${id}),
          '[]'::jsonb
        )
        WHERE hub_roles @> ${JSON.stringify([{ hubId: id }])}::jsonb`
    )

    // --- Finally delete the hub record ---
    await tx.delete(hubs).where(eq(hubs.id, id))
  })
}

// ------------------------------------------------------------------ Hub Key Envelopes

export async function getHubKeyEnvelopes(db: Database, hubId: string): Promise<HubKeyEntry[]> {
  const rows = await db.select().from(hubKeys).where(eq(hubKeys.hubId, hubId))
  return rows.map((r) => ({
    pubkey: r.pubkey,
    wrappedKey: r.encryptedKey,
    ephemeralPubkey: r.ephemeralPubkey ?? '',
  }))
}

export async function setHubKeyEnvelopes(
  db: Database,
  hubKeyCache: TtlCache<Uint8Array | null>,
  hubId: string,
  envelopes: HubKeyEntry[]
): Promise<void> {
  hubKeyCache.delete(hubId)
  // Verify hub exists
  const hubRows = await db.select({ id: hubs.id }).from(hubs).where(eq(hubs.id, hubId)).limit(1)
  if (!hubRows[0]) throw new AppError(404, 'Hub not found')

  // Replace all envelopes for this hub
  await db.delete(hubKeys).where(eq(hubKeys.hubId, hubId))
  if (envelopes.length > 0) {
    await db.insert(hubKeys).values(
      envelopes.map((e) => ({
        hubId,
        pubkey: e.pubkey,
        encryptedKey: e.wrappedKey,
        ephemeralPubkey: e.ephemeralPubkey || null,
      }))
    )
  }
}

export async function getHubKeyRaw(
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
      return null // Server not in hub key envelope list
    }
  })
}
