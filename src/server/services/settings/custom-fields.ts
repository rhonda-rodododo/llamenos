import { LABEL_HUB_FIELD } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { eq, sql } from 'drizzle-orm'
import type { CustomFieldDefinition } from '../../../shared/types'
import type { Database } from '../../db'
import { customFieldDefinitions } from '../../db/schema'
import type { CryptoService } from '../../lib/crypto-service'

function rowToCustomField(r: typeof customFieldDefinitions.$inferSelect): CustomFieldDefinition {
  return {
    id: r.id,
    name: '', // Client decrypts encryptedFieldName with hub key
    label: '', // Client decrypts encryptedLabel with hub key
    type: r.fieldType as CustomFieldDefinition['type'],
    required: r.required,
    options: [], // Client decrypts encryptedOptions with hub key
    encryptedFieldName: r.encryptedFieldName ?? undefined,
    encryptedLabel: r.encryptedLabel ?? undefined,
    encryptedOptions: r.encryptedOptions ?? undefined,
    visibleTo: r.visibleTo,
    context: 'all',
    order: r.order,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function getCustomFields(
  db: Database,
  role: string,
  hubId?: string
): Promise<CustomFieldDefinition[]> {
  const hId = hubId ?? null
  const rows = hId
    ? await db.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.hubId, hId))
    : await db
        .select()
        .from(customFieldDefinitions)
        .where(sql`${customFieldDefinitions.hubId} IS NULL`)

  // Client decrypts with hub key — server returns ciphertext pass-through
  const sorted = rows.sort((a, b) => a.order - b.order)
  const fields = sorted.map((r) => rowToCustomField(r))

  return role !== 'admin'
    ? fields.filter((f) => f.visibleTo === 'contacts:envelope-summary')
    : fields
}

export async function updateCustomFields(
  db: Database,
  cryptoService: CryptoService,
  getHubKey: (hubId: string) => Promise<Uint8Array | null>,
  fields: CustomFieldDefinition[],
  hubId?: string
): Promise<CustomFieldDefinition[]> {
  const hId = hubId ?? null

  // Delete existing
  if (hId) {
    await db.delete(customFieldDefinitions).where(eq(customFieldDefinitions.hubId, hId))
  } else {
    await db.delete(customFieldDefinitions).where(sql`${customFieldDefinitions.hubId} IS NULL`)
  }

  if (fields.length === 0) return []

  // Client provides hub-key encrypted values; hub-encrypt fallback for server-initiated ops
  const hubKey = hId ? await getHubKey(hId) : null

  const encryptOrPassthrough = (encrypted: Ciphertext | undefined, plaintext: string): Ciphertext =>
    encrypted ??
    (hubKey
      ? cryptoService.hubEncrypt(plaintext, hubKey, LABEL_HUB_FIELD)
      : (plaintext as Ciphertext))

  const rows = await db
    .insert(customFieldDefinitions)
    .values(
      fields.map((f, i) => ({
        id: f.id || crypto.randomUUID(),
        hubId: hId,
        fieldType: f.type,
        required: f.required,
        visibleTo: f.visibleTo ?? 'contacts:envelope-summary',
        order: i,
        encryptedFieldName: encryptOrPassthrough(f.encryptedFieldName, f.name),
        encryptedLabel: encryptOrPassthrough(f.encryptedLabel, f.label),
        encryptedOptions:
          f.encryptedOptions ??
          (f.options && f.options.length > 0
            ? hubKey
              ? cryptoService.hubEncrypt(JSON.stringify(f.options), hubKey, LABEL_HUB_FIELD)
              : (JSON.stringify(f.options) as Ciphertext)
            : null),
      }))
    )
    .returning()
  return rows.map((r) => rowToCustomField(r))
}
