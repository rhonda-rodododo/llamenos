import { LABEL_PROVIDER_CREDENTIAL_WRAP } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { eq } from 'drizzle-orm'
import type {
  OAuthState,
  ProviderConfig,
  SignalRegistrationPending,
  TelephonyProviderConfig,
} from '../../../shared/types'
import type { Database } from '../../db'
import {
  oauthState,
  providerConfig,
  signalRegistrationPending,
  telephonyConfig,
} from '../../db/schema'
import type { TtlCache } from '../../lib/cache'
import type { CryptoService } from '../../lib/crypto-service'

/** Caches for provider-related lookups. Shared across all calls within a SettingsService instance. */
export interface ProviderCaches {
  telephonyConfigCache: TtlCache<TelephonyProviderConfig | null>
  phoneToHubCache: TtlCache<string | null>
}

export async function getTelephonyProvider(
  db: Database,
  cryptoService: CryptoService,
  caches: ProviderCaches,
  hubId?: string
): Promise<TelephonyProviderConfig | null> {
  const hId = hubId ?? 'global'
  return caches.telephonyConfigCache.getOrSet(hId, async () => {
    const rows = await db
      .select()
      .from(telephonyConfig)
      .where(eq(telephonyConfig.hubId, hId))
      .limit(1)
    if (!rows[0]) return null
    const configStr = rows[0].config
    if (!configStr) return null
    let json: string
    try {
      json = await cryptoService.serverDecrypt(
        configStr as Ciphertext,
        LABEL_PROVIDER_CREDENTIAL_WRAP
      )
    } catch {
      // Legacy plaintext — re-encrypt and update
      json = configStr
      const encrypted = await cryptoService.serverEncrypt(json, LABEL_PROVIDER_CREDENTIAL_WRAP)
      await db
        .update(telephonyConfig)
        .set({ config: encrypted })
        .where(eq(telephonyConfig.hubId, hId))
    }
    return JSON.parse(json) as TelephonyProviderConfig
  })
}

export async function updateTelephonyProvider(
  db: Database,
  cryptoService: CryptoService,
  caches: ProviderCaches,
  config: TelephonyProviderConfig,
  hubId?: string
): Promise<TelephonyProviderConfig> {
  const hId = hubId ?? 'global'
  caches.telephonyConfigCache.delete(hId)
  caches.phoneToHubCache.clear() // phone mapping may have changed
  const encrypted = await cryptoService.serverEncrypt(
    JSON.stringify(config),
    LABEL_PROVIDER_CREDENTIAL_WRAP
  )
  await db
    .insert(telephonyConfig)
    .values({ hubId: hId, config: encrypted })
    .onConflictDoUpdate({
      target: telephonyConfig.hubId,
      set: { config: encrypted, updatedAt: new Date() },
    })
  return config
}

export async function getHubByPhone(
  db: Database,
  cryptoService: CryptoService,
  caches: ProviderCaches,
  phone: string,
  getHub: (id: string) => Promise<import('../../../shared/types').Hub | null>
): Promise<import('../../../shared/types').Hub | null> {
  const cachedHubId = caches.phoneToHubCache.get(phone)
  if (cachedHubId !== undefined) {
    return cachedHubId ? getHub(cachedHubId) : null
  }

  // Fetch all telephony configs and filter by phone in decrypted config
  const rows = await db.select().from(telephonyConfig)
  for (const row of rows) {
    if (!row.config) continue
    let cfg: Record<string, unknown>
    try {
      cfg = JSON.parse(
        await cryptoService.serverDecrypt(row.config as Ciphertext, LABEL_PROVIDER_CREDENTIAL_WRAP)
      ) as Record<string, unknown>
    } catch {
      try {
        cfg = JSON.parse(row.config) as Record<string, unknown>
      } catch {
        continue
      }
    }
    if (cfg.phoneNumber === phone) {
      caches.phoneToHubCache.set(phone, row.hubId)
      return getHub(row.hubId)
    }
  }
  caches.phoneToHubCache.set(phone, null)
  return null
}

export async function getProviderConfig(
  db: Database,
  cryptoService: CryptoService
): Promise<ProviderConfig | null> {
  const rows = await db.select().from(providerConfig)
  if (!rows[0]) return null
  const r = rows[0]

  const brandSid = r.encryptedBrandSid
    ? await cryptoService.serverDecrypt(
        r.encryptedBrandSid as Ciphertext,
        LABEL_PROVIDER_CREDENTIAL_WRAP
      )
    : undefined
  const campaignSid = r.encryptedCampaignSid
    ? await cryptoService.serverDecrypt(
        r.encryptedCampaignSid as Ciphertext,
        LABEL_PROVIDER_CREDENTIAL_WRAP
      )
    : undefined
  const messagingServiceSid = r.encryptedMessagingServiceSid
    ? await cryptoService.serverDecrypt(
        r.encryptedMessagingServiceSid as Ciphertext,
        LABEL_PROVIDER_CREDENTIAL_WRAP
      )
    : undefined

  return {
    provider: r.provider as ProviderConfig['provider'],
    connected: r.connected,
    phoneNumber: r.phoneNumber ?? undefined,
    webhooksConfigured: r.webhooksConfigured,
    sipConfigured: r.sipConfigured,
    a2pStatus: (r.a2pStatus ?? 'not_started') as ProviderConfig['a2pStatus'],
    brandSid: brandSid ?? undefined,
    campaignSid: campaignSid ?? undefined,
    messagingServiceSid: messagingServiceSid ?? undefined,
  }
}

export async function setProviderConfig(
  db: Database,
  cryptoService: CryptoService,
  config: ProviderConfig,
  encryptedCredentials?: string
): Promise<void> {
  // Encrypt SIDs with server key
  const encryptedBrandSid = config.brandSid
    ? await cryptoService.serverEncrypt(config.brandSid, LABEL_PROVIDER_CREDENTIAL_WRAP)
    : null
  const encryptedCampaignSid = config.campaignSid
    ? await cryptoService.serverEncrypt(config.campaignSid, LABEL_PROVIDER_CREDENTIAL_WRAP)
    : null
  const encryptedMessagingServiceSid = config.messagingServiceSid
    ? await cryptoService.serverEncrypt(config.messagingServiceSid, LABEL_PROVIDER_CREDENTIAL_WRAP)
    : null

  const values = {
    id: 'global' as const,
    provider: config.provider,
    connected: config.connected,
    phoneNumber: config.phoneNumber ?? null,
    webhooksConfigured: config.webhooksConfigured,
    sipConfigured: config.sipConfigured,
    a2pStatus: config.a2pStatus ?? 'not_started',
    encryptedBrandSid,
    encryptedCampaignSid,
    encryptedMessagingServiceSid,
    encryptedCredentials: (encryptedCredentials ?? null) as Ciphertext | null,
    updatedAt: new Date(),
  }
  await db
    .insert(providerConfig)
    .values(values)
    .onConflictDoUpdate({ target: providerConfig.id, set: values })
}

export async function getEncryptedCredentials(db: Database): Promise<string | null> {
  const rows = await db.select({ creds: providerConfig.encryptedCredentials }).from(providerConfig)
  return rows[0]?.creds ?? null
}

// --- OAuth State (Provider Auto-Config) ---

export async function setOAuthState(db: Database, state: OAuthState): Promise<void> {
  await db
    .insert(oauthState)
    .values({
      provider: state.provider,
      state: state.state,
      expiresAt: new Date(state.expiresAt),
    })
    .onConflictDoUpdate({
      target: oauthState.provider,
      set: { state: state.state, expiresAt: new Date(state.expiresAt) },
    })
}

export async function getOAuthState(db: Database, provider: string): Promise<OAuthState | null> {
  const rows = await db.select().from(oauthState).where(eq(oauthState.provider, provider))
  if (!rows[0]) return null
  if (rows[0].expiresAt < new Date()) {
    await db.delete(oauthState).where(eq(oauthState.provider, provider))
    return null
  }
  return {
    state: rows[0].state,
    provider: rows[0].provider as OAuthState['provider'],
    expiresAt: rows[0].expiresAt.getTime(),
  }
}

export async function clearOAuthState(db: Database, provider: string): Promise<void> {
  await db.delete(oauthState).where(eq(oauthState.provider, provider))
}

// --- Signal Registration Pending ---

export async function getSignalRegistrationPending(
  db: Database,
  cryptoService: CryptoService
): Promise<SignalRegistrationPending | null> {
  const rows = await db.select().from(signalRegistrationPending)
  if (!rows[0]) return null
  if (rows[0].expiresAt < new Date()) {
    await db.delete(signalRegistrationPending).where(eq(signalRegistrationPending.id, 'global'))
    return null
  }
  const r = rows[0]

  const number = await cryptoService.serverDecrypt(
    r.encryptedNumber as Ciphertext,
    LABEL_PROVIDER_CREDENTIAL_WRAP
  )

  return {
    number,
    bridgeUrl: r.bridgeUrl,
    method: r.method as SignalRegistrationPending['method'],
    status: r.status as SignalRegistrationPending['status'],
    error: r.error ?? undefined,
    expiresAt: r.expiresAt.toISOString(),
  }
}

export async function setSignalRegistrationPending(
  db: Database,
  cryptoService: CryptoService,
  pending: SignalRegistrationPending
): Promise<void> {
  // Encrypt phone number with server key
  const encryptedNumber = await cryptoService.serverEncrypt(
    pending.number,
    LABEL_PROVIDER_CREDENTIAL_WRAP
  )

  await db
    .insert(signalRegistrationPending)
    .values({
      id: 'global',
      encryptedNumber,
      bridgeUrl: pending.bridgeUrl,
      method: pending.method,
      status: pending.status,
      error: pending.error ?? null,
      expiresAt: new Date(pending.expiresAt),
    })
    .onConflictDoUpdate({
      target: signalRegistrationPending.id,
      set: {
        encryptedNumber,
        bridgeUrl: pending.bridgeUrl,
        method: pending.method,
        status: pending.status,
        error: pending.error ?? null,
        expiresAt: new Date(pending.expiresAt),
      },
    })
}

export async function clearSignalRegistrationPending(db: Database): Promise<void> {
  await db.delete(signalRegistrationPending).where(eq(signalRegistrationPending.id, 'global'))
}
