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
  void clearCapsule().catch((err) => {
    console.error('[panic-wipe] clearCapsule failed, relying on IDB sweep fallback:', err)
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

    // Clear IndexedDB databases.
    //
    // Firefox does NOT implement `indexedDB.databases()`, so the enumeration
    // path below silently no-ops there. To guarantee scorched-earth on every
    // browser we unconditionally delete every database this app is known to
    // create FIRST, then attempt the enumeration sweep as belt-and-braces for
    // any unknown DB (e.g. SW caches, future features) on Chromium.
    //
    // Keep this list in sync with any new openDb() callsites.
    const KNOWN_DB_NAMES = ['llamenos-session']
    try {
      if (typeof indexedDB !== 'undefined') {
        for (const name of KNOWN_DB_NAMES) {
          try {
            indexedDB.deleteDatabase(name)
          } catch (err) {
            console.error(`[panic-wipe] deleteDatabase(${name}) failed:`, err)
          }
        }
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
