// Tier 4 PR-B — non-blocking eager boot of the crypto sandbox iframe.
//
// When VITE_CRYPTO_ORIGIN is set at build time, this side-effect module
// creates the iframe client singleton and kicks off the boot handshake in
// parallel with the SPA render. The promise is observable via
// `getCryptoSandboxReadyPromise()` so a future blocking-boot mode
// (SandboxLoader) can await it before mounting the app shell.
//
// When VITE_CRYPTO_ORIGIN is NOT set (local dev with the old same-origin
// layout), this module is a no-op — `getCryptoSandboxReadyPromise()`
// resolves immediately and the SPA renders exactly as before. This keeps
// PR-B non-disruptive until call sites migrate to the iframe transport.

import { getCryptoIframeClient } from './crypto-iframe-client'

type BootState =
  | { kind: 'disabled' }
  | { kind: 'pending'; ready: Promise<void> }
  | { kind: 'ready' }
  | { kind: 'failed'; error: Error }

let state: BootState = { kind: 'disabled' }

/**
 * Idempotent. Call once at SPA boot before rendering. Safe to call multiple
 * times — only the first invocation creates the iframe.
 */
export function bootCryptoSandbox(): void {
  if (state.kind !== 'disabled') return
  const origin = import.meta.env.VITE_CRYPTO_ORIGIN ?? ''
  if (!origin) {
    // Same-origin dev/test mode. Nothing to boot. The singleton will not
    // be created until/unless a caller explicitly requests it.
    return
  }
  try {
    const client = getCryptoIframeClient()
    const ready = client.ready.then(
      () => {
        state = { kind: 'ready' }
      },
      (err: unknown) => {
        const wrapped = err instanceof Error ? err : new Error(String(err))
        state = { kind: 'failed', error: wrapped }
        // Hard fail — the SPA should refuse to proceed if the sandbox
        // cannot boot. A follow-up PR surfaces this as a dedicated error
        // screen; for now we rethrow so the promise rejection is observable.
        throw wrapped
      }
    )
    state = { kind: 'pending', ready }
  } catch (err) {
    const wrapped = err instanceof Error ? err : new Error(String(err))
    state = { kind: 'failed', error: wrapped }
  }
}

/**
 * Returns a promise that resolves when the sandbox is ready. If the sandbox
 * is disabled (no VITE_CRYPTO_ORIGIN), resolves immediately. If the sandbox
 * failed to boot, the promise rejects.
 */
export function getCryptoSandboxReadyPromise(): Promise<void> {
  switch (state.kind) {
    case 'disabled':
    case 'ready':
      return Promise.resolve()
    case 'pending':
      return state.ready
    case 'failed':
      return Promise.reject(state.error)
  }
}

/** Test-only: reset internal state so each test starts clean. */
export function _resetBootStateForTests(): void {
  state = { kind: 'disabled' }
}
