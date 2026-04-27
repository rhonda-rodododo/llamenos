// Service worker registration with prompt-mode update flow.
// Imported lazily by main.tsx after the boot release verifier passes.
//
// When a new SW version is detected, `onNeedRefresh` fires. The update
// is NOT applied automatically — the user must consent via the
// SwUpdatePrompt component. This prevents a compromised server from
// silently replacing the SW.

import { registerSW } from 'virtual:pwa-register'

export interface SwUpdateState {
  /** True when a new SW is available and waiting for user consent. */
  needRefresh: boolean
  /** True when the current SW is ready for offline use. */
  offlineReady: boolean
  /** The new release tag, if we could parse it from the waiting SW. */
  pendingVersion: string | null
}

type SwUpdateListener = (state: SwUpdateState) => void

let currentState: SwUpdateState = {
  needRefresh: false,
  offlineReady: false,
  pendingVersion: null,
}

const listeners = new Set<SwUpdateListener>()

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined

/**
 * Initialize SW registration. Call once after boot verifier passes.
 */
export function initSwRegistration(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      currentState = { ...currentState, needRefresh: true }
      notifyListeners()
    },
    onOfflineReady() {
      currentState = { ...currentState, offlineReady: true }
      notifyListeners()
    },
    onRegisteredSW(_swScriptUrl: string) {
      // SW registered — no action needed
    },
  })
}

/**
 * Accept the pending SW update and reload the page.
 */
export async function acceptSwUpdate(): Promise<void> {
  if (updateSW) {
    await updateSW(true)
  }
}

/**
 * Dismiss the update prompt without applying.
 */
export function dismissSwUpdate(): void {
  currentState = { ...currentState, needRefresh: false }
  notifyListeners()
}

/**
 * Subscribe to SW update state changes. Returns an unsubscribe function.
 */
export function subscribeSwUpdate(listener: SwUpdateListener): () => void {
  listeners.add(listener)
  // Immediately notify with current state
  listener(currentState)
  return () => {
    listeners.delete(listener)
  }
}

export function getSwUpdateState(): SwUpdateState {
  return currentState
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(currentState)
  }
}
