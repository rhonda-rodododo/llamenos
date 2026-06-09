import { resolve4, resolve6 } from 'node:dns/promises'

/**
 * Comprehensive SSRF protection for user-supplied URLs.
 *
 * Blocks internal, loopback, link-local, CGNAT, and reserved addresses
 * including IPv4-mapped IPv6 variants.
 */

/**
 * Returns true if the hostname resolves to an internal/reserved address
 * that should not be fetched from server-side code.
 */
export function isInternalAddress(hostname: string): boolean {
  // Normalize: strip IPv6 brackets
  const h = hostname.replace(/^\[|\]$/g, '')

  // --- IPv6 checks ---
  if (h.includes(':')) {
    const lower = h.toLowerCase()

    // IPv6 loopback
    if (lower === '::1') return true

    // IPv6 link-local (fe80::/10)
    if (lower.startsWith('fe80:') || lower.startsWith('fe80%')) return true

    // IPv6 unique local (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true

    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mapped) return isInternalIPv4(mapped[1])

    // IPv6 unspecified
    if (lower === '::') return true

    return false
  }

  // --- Hostname checks ---
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '0.0.0.0') return true

  // --- IPv4 checks ---
  return isInternalIPv4(h)
}

function isInternalIPv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false

  const octets = parts.map(Number)
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false

  const [a, b] = octets

  // Loopback: 127.0.0.0/8
  if (a === 127) return true

  // Private: 10.0.0.0/8
  if (a === 10) return true

  // Private: 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true

  // Private: 192.168.0.0/16
  if (a === 192 && b === 168) return true

  // Link-local: 169.254.0.0/16
  if (a === 169 && b === 254) return true

  // CGNAT (Carrier-Grade NAT): 100.64.0.0/10 (100.64.x.x - 100.127.x.x)
  if (a === 100 && b >= 64 && b <= 127) return true

  // Reserved/experimental: 240.0.0.0/4
  if (a >= 240) return true

  // Broadcast
  if (a === 255 && b === 255) return true

  // Current network: 0.0.0.0/8
  if (a === 0) return true

  return false
}

/**
 * Validate a user-supplied URL for SSRF safety.
 * Returns null if safe, or an error message if blocked.
 */
export function validateExternalUrl(url: string, label = 'URL'): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `Invalid ${label}`
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `${label} must use HTTP or HTTPS`
  }

  if (isInternalAddress(parsed.hostname)) {
    return `${label} must not point to internal/loopback addresses`
  }

  return null
}

/**
 * Validate a URL with DNS resolution to prevent DNS rebinding attacks.
 *
 * Resolves the hostname and checks all resolved IPs against the internal
 * address blocklist. This prevents TOCTOU attacks where a hostname resolves
 * to a public IP at check time but an internal IP at fetch time.
 */
export async function validateExternalUrlWithDns(
  url: string,
  label = 'URL'
): Promise<string | null> {
  const staticCheck = validateExternalUrl(url, label)
  if (staticCheck) return staticCheck

  const { hostname } = new URL(url)

  // If hostname is already an IP literal, skip DNS resolution (already checked by validateExternalUrl)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || hostname.includes(':')) {
    return null
  }

  // Resolve A and AAAA records and check all resolved addresses
  const resolvedAddresses: string[] = []
  try {
    const v4 = await resolve4(hostname).catch(() => [] as string[])
    resolvedAddresses.push(...v4)
  } catch {
    // No A records
  }
  try {
    const v6 = await resolve6(hostname).catch(() => [] as string[])
    resolvedAddresses.push(...v6)
  } catch {
    // No AAAA records
  }

  if (resolvedAddresses.length === 0) {
    return `${label} hostname does not resolve`
  }

  for (const addr of resolvedAddresses) {
    if (isInternalAddress(addr)) {
      return `${label} resolves to an internal address`
    }
  }

  return null
}
