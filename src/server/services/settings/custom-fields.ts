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

  // Client provides hub-key encrypted values; hub-encrypt fallback for server-initiated ops.
  // Any server fallback AAD must use the final row id + field name so the client can decrypt.
  const hubKey = hId ? await getHubKey(hId) : null

  const encryptOrPassthrough = async (
    encrypted: Ciphertext | undefined,
    plaintext: string,
    recordId: string,
    fieldName: string
  ): Promise<Ciphertext> =>
    encrypted ??
    (hubKey
      ? await cryptoService.hubEncryptField(plaintext, hubKey, recordId, fieldName)
      : (plaintext as Ciphertext))

  const fieldValues = await Promise.all(
    fields.map(async (f, i) => {
      const id = f.id || crypto.randomUUID()
      return {
        id,
        hubId: hId,
        fieldType: f.type,
        required: f.required,
        visibleTo: f.visibleTo ?? 'contacts:envelope-summary',
        order: i,
        encryptedFieldName: await encryptOrPassthrough(
          f.encryptedFieldName,
          f.name,
          id,
          'encrypted_field_name'
        ),
        encryptedLabel: await encryptOrPassthrough(
          f.encryptedLabel,
          f.label,
          id,
          'encrypted_label'
        ),
        encryptedOptions:
          f.encryptedOptions ??
          (f.options && f.options.length > 0
            ? hubKey
              ? await cryptoService.hubEncryptField(
                  JSON.stringify(f.options),
                  hubKey,
                  id,
                  'encrypted_options'
                )
              : (JSON.stringify(f.options) as Ciphertext)
            : null),
      }
    })
  )

  const rows = await db.insert(customFieldDefinitions).values(fieldValues).returning()
  return rows.map((r) => rowToCustomField(r))
}
