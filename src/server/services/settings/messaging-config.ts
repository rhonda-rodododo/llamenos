import { LABEL_PROVIDER_CREDENTIAL_WRAP } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { eq } from 'drizzle-orm'
import type { EnabledChannels, MessagingConfig, SetupState } from '../../../shared/types'
import { DEFAULT_MESSAGING_CONFIG, DEFAULT_SETUP_STATE } from '../../../shared/types'
import type { Database } from '../../db'
import { messagingConfig, reportCategories, setupState } from '../../db/schema'
import type { CryptoService } from '../../lib/crypto-service'

export async function getMessagingConfig(
  db: Database,
  cryptoService: CryptoService,
  hubId?: string
): Promise<MessagingConfig> {
  const hId = hubId ?? 'global'
  const rows = await db
    .select()
    .from(messagingConfig)
    .where(eq(messagingConfig.hubId, hId))
    .limit(1)
  if (!rows[0]?.config) return { ...DEFAULT_MESSAGING_CONFIG }
  const configStr = rows[0].config
  let json: string
  try {
    json = cryptoService.serverDecrypt(configStr as Ciphertext, LABEL_PROVIDER_CREDENTIAL_WRAP)
  } catch {
    // Legacy plaintext — re-encrypt and update
    json = configStr
    const encrypted = cryptoService.serverEncrypt(json, LABEL_PROVIDER_CREDENTIAL_WRAP)
    await db
      .update(messagingConfig)
      .set({ config: encrypted })
      .where(eq(messagingConfig.hubId, hId))
  }
  return JSON.parse(json) as MessagingConfig
}

export async function updateMessagingConfig(
  db: Database,
  cryptoService: CryptoService,
  data: Partial<MessagingConfig>,
  hubId?: string
): Promise<MessagingConfig> {
  const hId = hubId ?? 'global'
  const current = await getMessagingConfig(db, cryptoService, hId)
  const updated = { ...current, ...data }
  const encrypted = cryptoService.serverEncrypt(
    JSON.stringify(updated),
    LABEL_PROVIDER_CREDENTIAL_WRAP
  )
  await db
    .insert(messagingConfig)
    .values({ hubId: hId, config: encrypted })
    .onConflictDoUpdate({
      target: messagingConfig.hubId,
      set: { config: encrypted, updatedAt: new Date() },
    })
  return updated
}

export async function getSetupState(db: Database, hubId?: string): Promise<SetupState> {
  const hId = hubId ?? 'global'
  const rows = await db.select().from(setupState).where(eq(setupState.hubId, hId)).limit(1)
  if (!rows[0]) return { ...DEFAULT_SETUP_STATE }
  return rows[0].state as unknown as SetupState
}

export async function updateSetupState(
  db: Database,
  data: Partial<SetupState>,
  hubId?: string
): Promise<SetupState> {
  const hId = hubId ?? 'global'
  const current = await getSetupState(db, hId)
  const updated = { ...current, ...data }
  const updatedRecord = updated as unknown as Record<string, unknown>
  await db
    .insert(setupState)
    .values({ hubId: hId, state: updatedRecord })
    .onConflictDoUpdate({
      target: setupState.hubId,
      set: { state: updatedRecord, updatedAt: new Date() },
    })
  return updated
}

export async function getEnabledChannels(
  db: Database,
  cryptoService: CryptoService,
  getTelephonyProviderFn: (
    hubId?: string
  ) => Promise<import('../../../shared/types').TelephonyProviderConfig | null>,
  hubId?: string
): Promise<EnabledChannels> {
  const hId = hubId ?? 'global'
  const [tConfig, mConfig, sState] = await Promise.all([
    getTelephonyProviderFn(hId),
    getMessagingConfig(db, cryptoService, hId),
    getSetupState(db, hId),
  ])
  const voiceEnabled = !!tConfig
  return {
    voice: voiceEnabled,
    sms: mConfig.enabledChannels.includes('sms'),
    whatsapp: mConfig.enabledChannels.includes('whatsapp'),
    signal: mConfig.enabledChannels.includes('signal'),
    rcs: mConfig.enabledChannels.includes('rcs'),
    telegram: mConfig.enabledChannels.includes('telegram'),
    reports: sState.selectedChannels.includes('reports'),
  }
}

export async function getReportCategories(
  db: Database,
  hubId?: string
): Promise<{ categories: string[]; encryptedCategories?: string }> {
  const hId = hubId ?? 'global'
  const defaults = ['Incident Report', 'Field Observation', 'Evidence', 'Other']
  const rows = await db
    .select()
    .from(reportCategories)
    .where(eq(reportCategories.hubId, hId))
    .limit(1)
  const row = rows[0]
  if (!row?.encryptedCategories) return { categories: defaults }

  // Client decrypts encryptedCategories with hub key
  return { categories: defaults, encryptedCategories: row.encryptedCategories }
}

export async function updateReportCategories(
  db: Database,
  encryptedCategoriesBlob: Ciphertext,
  hubId?: string
): Promise<void> {
  const hId = hubId ?? 'global'

  // Client provides hub-key encrypted categories blob — store as-is
  await db
    .insert(reportCategories)
    .values({ hubId: hId, encryptedCategories: encryptedCategoriesBlob })
    .onConflictDoUpdate({
      target: reportCategories.hubId,
      set: { encryptedCategories: encryptedCategoriesBlob, updatedAt: new Date() },
    })
}
