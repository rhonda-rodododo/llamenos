import { existsSync } from 'node:fs'
import maxmind, { type CityResponse, type Reader } from 'maxmind'

export interface GeoLookupResult {
  city: string
  region: string
  country: string // ISO 3166-1 alpha-2 code or 'unknown'
  lat: number | null
  lon: number | null
}

const UNKNOWN: GeoLookupResult = {
  city: 'unknown',
  region: 'unknown',
  country: 'unknown',
  lat: null,
  lon: null,
}

// Cache the reader — MMDB files are memory-mapped and expensive to open repeatedly.
let cachedReader: Reader<CityResponse> | null = null
let cachedPath: string | null = null

async function getReader(dbPath: string): Promise<Reader<CityResponse> | null> {
  if (!existsSync(dbPath)) return null
  if (cachedReader && cachedPath === dbPath) return cachedReader
  try {
    cachedReader = await maxmind.open<CityResponse>(dbPath)
    cachedPath = dbPath
    return cachedReader
  } catch (err) {
    console.error('[geoip] failed to open database:', err)
    return null
  }
}

function isPublicIp(ip: string): boolean {
  // Simple check: reject obvious private/localhost ranges. DB-IP will return null for them anyway,
  // but early-exit avoids a lookup.
  if (ip === 'unknown') return false
  if (/^(10|127)\./.test(ip)) return false
  if (/^192\.168\./.test(ip)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false
  if (ip === '::1' || ip.startsWith('fe80')) return false
  return true
}

export async function lookupIp(ip: string, dbPath: string): Promise<GeoLookupResult> {
  if (!isPublicIp(ip)) return UNKNOWN
  const reader = await getReader(dbPath)
  if (!reader) return UNKNOWN
  try {
    const resp = reader.get(ip)
    if (!resp) return UNKNOWN
    return {
      city: resp.city?.names?.en ?? 'unknown',
      region: resp.subdivisions?.[0]?.names?.en ?? 'unknown',
      country: resp.country?.iso_code ?? 'unknown',
      lat: resp.location?.latitude ?? null,
      lon: resp.location?.longitude ?? null,
    }
  } catch (err) {
    console.error('[geoip] lookup failed for IP:', err)
    return UNKNOWN
  }
}
