import { LABEL_PROVIDER_CREDENTIAL_WRAP } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import type { GeocodingConfigAdmin } from '../../../shared/types'
import type { Database } from '../../db'
import { geocodingConfig } from '../../db/schema'
import type { CryptoService } from '../../lib/crypto-service'

export async function getGeocodingConfig(
  db: Database,
  cryptoService: CryptoService
): Promise<GeocodingConfigAdmin> {
  const rows = await db.select().from(geocodingConfig)
  if (!rows[0]) return { provider: null, apiKey: '', countries: [], enabled: false }
  const r = rows[0]

  const apiKey = await cryptoService.serverDecrypt(
    r.encryptedApiKey as Ciphertext,
    LABEL_PROVIDER_CREDENTIAL_WRAP
  )

  return {
    provider: r.provider as GeocodingConfigAdmin['provider'],
    apiKey,
    countries: r.countries,
    enabled: r.enabled,
  }
}

export async function updateGeocodingConfig(
  db: Database,
  cryptoService: CryptoService,
  data: Partial<GeocodingConfigAdmin>
): Promise<GeocodingConfigAdmin> {
  const current = await getGeocodingConfig(db, cryptoService)
  const updated = { ...current, ...data }

  // Encrypt API key with server key
  const encryptedApiKey = await cryptoService.serverEncrypt(
    updated.apiKey ?? '',
    LABEL_PROVIDER_CREDENTIAL_WRAP
  )

  await db
    .insert(geocodingConfig)
    .values({
      id: 'global',
      provider: updated.provider,
      encryptedApiKey,
      countries: updated.countries,
      enabled: updated.enabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: geocodingConfig.id,
      set: {
        provider: updated.provider,
        encryptedApiKey,
        countries: updated.countries,
        enabled: updated.enabled,
        updatedAt: new Date(),
      },
    })
  return updated
}
