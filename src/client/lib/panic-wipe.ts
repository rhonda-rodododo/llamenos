/**
 * Panic Wipe — triple-Escape detector and emergency key destruction.
 *
 * For device seizure scenarios: user taps Escape 3 times within 1 second,
 * all cryptographic material is zeroed, storage is cleared, and the app
 * redirects to the login page. No confirmation dialog is shown.
 */

import * as keyManager from './key-manager'
import { SESSION_TOKEN_KEY, clearCapsule } from './session-capsule'

const REQUIRED_TAPS = 3
const WINDOW_MS = 1000
const FLASH_DURATION_MS = 200

let escapeTimes: number[] = []
let panicWipeCallback: (() => void) | null = null

/**
 * Execute the panic wipe: zero keys, clear all storage, redirect.
 */
export function performPanicWipe(): void {
  // 1. Fire the UI flash callback FIRST so the overlay renders
  //    before storage clearing triggers React auth redirect
  panicWipeCallback?.()

  // 2. Clear the session capsule synchronously-ish — fire-and-forget the
  //    IDB delete but remove the sessionStorage token immediately so any
  //    subsequent read can't race a partial state.
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // Storage may be unavailable
  }
  void clearCapsule().catch(() => {
    // IDB may be unavailable — the indexedDB.databases() sweep below will
    // catch it as part of the scorched-earth cleanup.
  })

  // 3. Zero out the cryptographic key in memory immediately
  //    (this also broadcasts a lock message to sibling tabs)
  try {
    keyManager.wipeKey()
  } catch {
    // Key may already be wiped or locked — continue
  }

  // 4. Defer storage clearing and redirect — gives React one frame
  //    to paint the overlay before localStorage.clear() triggers auth changes
  setTimeout(() => {
    try {
      localStorage.clear()
    } catch {
      // Storage may be unavailable
    }
    try {
      sessionStorage.clear()
    } catch {
      // Storage may be unavailable
    }

    // Clear IndexedDB databases
    try {
      if (typeof indexedDB !== 'undefined') {
        indexedDB
          .databases?.()
          .then((dbs) => {
            dbs.forEach((db) => {
              if (db.name) indexedDB.deleteDatabase(db.name)
            })
          })
          .catch(() => {})
      }
    } catch {
      // IndexedDB may be unavailable
    }

    // Unregister service workers
    try {
      navigator.serviceWorker
        ?.getRegistrations()
        .then((registrations) => {
          registrations.forEach((reg) => reg.unregister())
        })
        .catch(() => {})
    } catch {
      // SW API may be unavailable
    }

    // Full-page redirect (destroys all React state)
    window.location.href = '/login'
  }, FLASH_DURATION_MS)
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') {
    escapeTimes = []
    return
  }

  const now = Date.now()
  escapeTimes.push(now)

  // Remove taps outside the window
  escapeTimes = escapeTimes.filter((t) => now - t <= WINDOW_MS)

  if (escapeTimes.length >= REQUIRED_TAPS) {
    escapeTimes = []
    performPanicWipe()
  }
}

/**
 * Initialize the panic wipe keyboard listener.
 * Call once at app startup (root layout).
 */
export function initPanicWipe(onWipe?: () => void): () => void {
  panicWipeCallback = onWipe ?? null
  document.addEventListener('keydown', handleKeyDown)

  return () => {
    document.removeEventListener('keydown', handleKeyDown)
    panicWipeCallback = null
  }
}
