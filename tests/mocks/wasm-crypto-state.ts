/**
 * WASM crypto backend for Playwright test builds.
 *
 * Wraps the Rust-compiled WasmCryptoState from packages/crypto/dist/wasm/
 * as the sole crypto implementation for tests. The WASM module provides
 * byte-identical crypto output to the native Rust used in Tauri desktop,
 * ensuring tests exercise the real crypto paths.
 *
 * If the WASM build is not available, initialization fails with a clear
 * error message directing the developer to build it first.
 */

import type {
  WasmCryptoState as WasmCryptoStateType,
} from '../../packages/crypto/dist/wasm/llamenos_core'

// The WASM module and state are loaded once at startup
let wasmModule: typeof import('../../packages/crypto/dist/wasm/llamenos_core') | null = null
let cryptoState: WasmCryptoStateType | null = null
let initPromise: Promise<void> | null = null

/**
 * Initialize the WASM module and create a WasmCryptoState instance.
 * Throws if WASM is not available (no fallback).
 *
 * Uses a module-level promise to guarantee that:
 * 1. Init runs exactly once (dedup via cached promise)
 * 2. All concurrent callers await the same promise
 * 3. On failure, the promise is cleared so the next call retries
 */
export function initWasmCrypto(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ '../../packages/crypto/dist/wasm/llamenos_core')
      await mod.default()
      wasmModule = mod
      cryptoState = new mod.WasmCryptoState()
      console.log('[tauri-mock] WASM crypto initialized successfully')
    } catch (e) {
      // Clear the cached promise so the next call retries instead of
      // returning a permanently rejected promise
      initPromise = null
      const msg = [
        '[tauri-mock] FATAL: WASM crypto module not available.',
        'Playwright tests require the Rust WASM build.',
        'Run: bun run crypto:wasm',
        `Original error: ${e instanceof Error ? e.message : String(e)}`,
      ].join('\n')
      throw new Error(msg)
    }
  })()

  return initPromise
}

/** Returns the initialized WasmCryptoState. Throws if not initialized. */
export function getWasmState(): WasmCryptoStateType {
  if (!cryptoState) throw new Error('WASM crypto not initialized — call initWasmCrypto() first')
  return cryptoState
}

/** Returns the WASM module (stateless functions). Throws if not initialized. */
export function getWasmModule(): typeof import('../../packages/crypto/dist/wasm/llamenos_core') {
  if (!wasmModule) throw new Error('WASM crypto not initialized — call initWasmCrypto() first')
  return wasmModule
}
