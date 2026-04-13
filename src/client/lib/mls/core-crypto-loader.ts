/**
 * Lazy loader for @wireapp/core-crypto. Exists as a clean entry point for
 * the forthcoming MLS integration so call sites don't import the WASM
 * module directly.
 */

let _coreCryptoModule: typeof import('@wireapp/core-crypto') | null = null

/**
 * Lazy-load the core-crypto WASM module.
 *
 * @throws {Error} if the WASM module fails to load (network error, CSP
 *   violation, WASM compilation failure, etc.)
 */
export async function loadCoreCrypto(): Promise<typeof import('@wireapp/core-crypto')> {
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
