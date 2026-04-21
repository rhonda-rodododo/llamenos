/**
 * Lazy loader for @wireapp/core-crypto. Exists as a clean entry point for
 * the MLS integration so call sites don't import the WASM module directly.
 *
 * The loader handles WASM initialization: @wireapp/core-crypto ships a
 * `core-crypto-ffi_bg.wasm` binary that must be fetched and compiled before
 * any `CoreCrypto.*` method can execute. The upstream `initWasmModule`
 * helper does this — but its built-in path resolver uses
 * `typeof window !== "undefined"` to choose between browser and Node.js
 * code paths. In a Web Worker `window` is undefined, so it falls through
 * to the Node.js `fs/promises` branch that Vite externalizes (→ runtime
 * crash).
 *
 * Workaround: we temporarily define `self.window` in the Worker scope
 * before calling `initWasmModule()` so the browser branch executes. The
 * browser branch uses `new URL("...wasm", import.meta.url)` which Vite
 * rewrites to `self.location.href`, resolving to the `dist/client/assets/`
 * directory where the Vite `coreCryptoWasmPlugin` copies the WASM file.
 */

let _coreCryptoModule: typeof import('@wireapp/core-crypto') | null = null
let _wasmInitialized = false

/**
 * Lazy-load the core-crypto WASM module and initialize its WASM binary.
 *
 * @throws {Error} if the WASM module fails to load (network error, CSP
 *   violation, WASM compilation failure, etc.)
 */
export async function loadCoreCrypto(): Promise<typeof import('@wireapp/core-crypto')> {
  if (_coreCryptoModule && _wasmInitialized) return _coreCryptoModule
  try {
    _coreCryptoModule = await import('@wireapp/core-crypto')

    if (!_wasmInitialized) {
      // Polyfill `window` in Worker scope so @wireapp/core-crypto's
      // `initWasmModule` uses the browser WASM fetch path instead of
      // the Node.js `fs/promises` path. The polyfill is removed
      // immediately after init to avoid side effects.
      const g = globalThis as Record<string, unknown>
      const hadWindow = 'window' in g
      if (!hadWindow) {
        g.window = g
      }
      try {
        await _coreCryptoModule.initWasmModule()
      } finally {
        if (!hadWindow) {
          g.window = undefined
        }
      }
      _wasmInitialized = true
    }

    return _coreCryptoModule
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: genuine failure in catch — no structured logger available client-side
    console.error('Failed to load @wireapp/core-crypto WASM module:', err)
    throw new Error(
      `core-crypto WASM load failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
