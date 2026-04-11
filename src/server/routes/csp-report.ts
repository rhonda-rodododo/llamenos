import { Hono } from 'hono'
import { LegacyCspReportSchema, ReportingApiBatchSchema } from '../../shared/schemas/csp-report'
import { createLogger } from '../lib/logger'

const log = createLogger('csp-report')

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 60
const ipCounts = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = ipCounts.get(ip)
  if (!entry || now >= entry.resetAt) {
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
