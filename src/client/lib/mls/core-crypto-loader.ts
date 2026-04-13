/**
 * Lazy loader for @wireapp/core-crypto behind the MLS feature flag.
 * Disabled by default; controlled by `VITE_LLAMENOS_MLS_ENABLED`.
 * The loader exists so MLS integration has a clean entry point.
 */

export function isMlsEnabled(): boolean {
  if (typeof import.meta.env === 'undefined') return false
  return import.meta.env.VITE_LLAMENOS_MLS_ENABLED === 'true'
}

let _coreCryptoModule: typeof import('@wireapp/core-crypto') | null = null

/**
 * Lazy-load the core-crypto WASM module. Returns null when the MLS
 * feature flag is off.
 *
 * @throws {Error} if the flag is on but the WASM module fails to load
 *   (network error, CSP violation, WASM compilation failure, etc.)
 */
export async function loadCoreCrypto(): Promise<typeof import('@wireapp/core-crypto') | null> {
  if (!isMlsEnabled()) return null
  if (_coreCryptoModule) return _coreCryptoModule
  try {
    _coreCryptoModule = await import('@wireapp/core-crypto')
    return _coreCryptoModule
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: genuine failure in catch — no structured logger available client-side
    console.error('Failed to load @wireapp/core-crypto WASM module:', err)
    throw new Error(
      `core-crypto WASM load failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
