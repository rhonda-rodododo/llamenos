import { Hono } from 'hono'
import { LegacyCspReportSchema, ReportingApiBatchSchema } from '../../shared/schemas/csp-report'
import { createLogger } from '../lib/logger'

const log = createLogger('csp-report')

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 60
// Hard ceiling on the rate-limit table size. At 60 reports/min an attacker
// spraying one new source IP per request across 10k distinct IPs would still
// only occupy ~500KB of RSS. Beyond this we evict the least-recently-inserted
// entries, which is sufficient because window entries are short-lived anyway.
const MAX_IP_ENTRIES = 10_000
// A Map preserves insertion order, so iterating keys gives us FIFO eviction.
const ipCounts = new Map<string, { count: number; resetAt: number }>()

function pruneExpired(now: number): void {
  for (const [ip, entry] of ipCounts) {
    if (now >= entry.resetAt) ipCounts.delete(ip)
  }
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = ipCounts.get(ip)
  if (!entry || now >= entry.resetAt) {
    if (ipCounts.size >= MAX_IP_ENTRIES) {
      // Expired entries are the cheapest to drop — prefer them over live ones.
      pruneExpired(now)
      // If the table is still at capacity, evict the oldest live entry
      // (insertion order) to make room. This bounds memory at the cost of
      // briefly forgetting that IP's window — acceptable since CSP reporting
      // is best-effort diagnostic data, not an auth/audit path.
      if (ipCounts.size >= MAX_IP_ENTRIES) {
        const oldest = ipCounts.keys().next().value
        if (oldest !== undefined) ipCounts.delete(oldest)
      }
    }
    ipCounts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > MAX_PER_WINDOW
}

const app = new Hono()

app.post('/', async (c) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown'

  if (isRateLimited(ip)) {
    return c.body(null, 429)
  }

  const contentType = c.req.header('content-type') ?? ''
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  if (contentType.includes('application/csp-report') || contentType.includes('application/json')) {
    const legacy = LegacyCspReportSchema.safeParse(body)
    if (legacy.success) {
      const r = legacy.data['csp-report']
      log.info('CSP violation', {
        directive: r['violated-directive'],
        blocked: r['blocked-uri'],
        source: r['source-file'],
        line: r['line-number'],
      })
      return c.body(null, 204)
    }
  }

  if (contentType.includes('application/reports+json')) {
    const batch = ReportingApiBatchSchema.safeParse(body)
    if (batch.success) {
      for (const report of batch.data) {
        log.info('CSP violation (Reporting API)', {
          directive: report.body.violatedDirective ?? report.body.effectiveDirective,
          blocked: report.body.blockedURL,
          source: report.body.sourceFile,
          line: report.body.lineNumber,
        })
      }
      return c.body(null, 204)
    }
  }

  // Try legacy parse as fallback (some browsers send application/json with legacy format)
  const fallback = LegacyCspReportSchema.safeParse(body)
  if (fallback.success) {
    const r = fallback.data['csp-report']
    log.info('CSP violation', {
      directive: r['violated-directive'],
      blocked: r['blocked-uri'],
      source: r['source-file'],
      line: r['line-number'],
    })
    return c.body(null, 204)
  }

  return c.json({ error: 'Unrecognized CSP report format' }, 400)
})

export default app
