/**
 * Probes the browser for SFrame support. Returns true iff:
 *   - RTCRtpScriptTransform is available (Chrome 2025+, Firefox 117+, Safari 15.4+)
 *   - Worker is available
 *   - crypto.subtle.importKey is a function (WebCrypto baseline)
 */
export function isSFrameSupported(): boolean {
  if (typeof globalThis === 'undefined') return false
  // biome-ignore lint/suspicious/noExplicitAny: runtime feature probe
  const g = globalThis as any
  if (typeof g.RTCRtpScriptTransform === 'undefined') return false
  if (typeof g.Worker === 'undefined') return false
  if (typeof g.crypto?.subtle?.importKey !== 'function') return false
  return true
}
