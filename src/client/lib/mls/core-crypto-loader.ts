/**
 * Lazy loader for @wireapp/core-crypto behind the LLAMENOS_MLS_ENABLED
 * feature flag. In PR #1, this is always disabled — no MLS code path
 * is active. The loader exists so PR #2 has a clean integration point.
 */

export function isMlsEnabled(): boolean {
  if (typeof import.meta.env === 'undefined') return false
  return import.meta.env.VITE_LLAMENOS_MLS_ENABLED === 'true'
}

let _coreCryptoModule: typeof import('@wireapp/core-crypto') | null = null

/**
 * Lazy-load the core-crypto WASM module. Returns null when the MLS
 * feature flag is off (the default in PR #1).
 */
export async function loadCoreCrypto(): Promise<typeof import('@wireapp/core-crypto') | null> {
  if (!isMlsEnabled()) return null
  if (_coreCryptoModule) return _coreCryptoModule
  _coreCryptoModule = await import('@wireapp/core-crypto')
  return _coreCryptoModule
}
