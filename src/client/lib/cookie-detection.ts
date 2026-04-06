/**
 * Detects whether cookies are available in the current browser session.
 *
 * Llámenos uses HttpOnly cookies for refresh tokens + session identifiers.
 * If the user has disabled cookies (or the browser is in a strict privacy
 * mode that blocks first-party cookies), every auth request will silently
 * fail — they'll see a PIN prompt, get "Wrong PIN" after entering it, with
 * no hint that the real problem is cookie blocking.
 *
 * This check runs a probe write/read/clear round-trip and also checks
 * navigator.cookieEnabled (which returns false in some privacy modes).
 * Memoized per page load so repeated calls are cheap.
 */

const PROBE_NAME = '__llamenos_probe'
let cachedResult: boolean | null = null

/**
 * @returns true if cookies are BLOCKED (user needs to enable them).
 *          false if cookies work correctly.
 */
export function areCookiesBlocked(): boolean {
  if (cachedResult !== null) return cachedResult
  cachedResult = detect()
  return cachedResult
}

/** Reset the memoized result — useful for the "Retry" button. */
export function resetCookieDetection(): void {
  cachedResult = null
}

function detect(): boolean {
  // navigator.cookieEnabled is a fast first-pass check but can lie (some
  // browsers return true even when first-party cookies are blocked).
  if (typeof navigator !== 'undefined' && navigator.cookieEnabled === false) {
    return true
  }
  if (typeof document === 'undefined') {
    // SSR or jsdom without cookie support — assume OK, client will re-check.
    return false
  }
  try {
    document.cookie = `${PROBE_NAME}=1; SameSite=Strict; path=/`
    const present = document.cookie.split(';').some((c) => c.trim().startsWith(`${PROBE_NAME}=`))
    // Clean up regardless of result
    document.cookie = `${PROBE_NAME}=; SameSite=Strict; path=/; max-age=0`
    return !present
  } catch {
    return true
  }
}
