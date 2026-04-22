/**
 * Prometheus-compatible metrics endpoint.
 *
 * Exposes key operational metrics at /api/metrics for scraping by
 * Prometheus, Grafana Agent, or similar collectors.
 *
 * Metrics are collected in-memory and reset on process restart.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createMiddleware } from 'hono/factory'
import { createRouter } from '../lib/openapi'
import type { AppEnv } from '../types'

const metrics = createRouter()

// In-memory counters and histograms
const counters: Record<string, number> = {}
const histograms: Record<string, number[]> = {}

const startTime = Date.now()

/** Path to the backup status JSON written by the backup cron job */
const BACKUP_STATUS_PATH = '/var/data/backup-status.json'

/**
 * Increment a counter metric.
 *
 * @knipignore — metrics utility; used by future metrics-instrumented route handlers
 */
export function incCounter(name: string, labels?: Record<string, string>): void {
  const key = labels
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')}}`
    : name
  counters[key] = (counters[key] || 0) + 1
}

/**
 * Record a histogram observation (in seconds).
 *
 * @knipignore — metrics utility; used by middleware and future latency-instrumented handlers
 */
export function observeHistogram(
  name: string,
  value: number,
  labels?: Record<string, string>
): void {
  const key = labels
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')}}`
    : name
  if (!histograms[key]) histograms[key] = []
  histograms[key].push(value)
}

/**
 * Read backup status from the JSON file written by the backup cron.
 * Returns null if the file is missing or malformed.
 */
function readBackupStatus(): {
  lastSuccessAt: string
  lastSizeBytes: number
  file: string
} | null {
  try {
    if (!existsSync(BACKUP_STATUS_PATH)) return null
    const raw = readFileSync(BACKUP_STATUS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as {
      lastSuccessAt?: string
      lastSizeBytes?: number
      file?: string
    }
    if (!parsed.lastSuccessAt || typeof parsed.lastSizeBytes !== 'number') return null
    return parsed as { lastSuccessAt: string; lastSizeBytes: number; file: string }
  } catch {
    return null
  }
}

/** Format metrics as Prometheus text exposition */
function formatMetrics(): string {
  const lines: string[] = []

  // Process uptime
  const uptimeSeconds = (Date.now() - startTime) / 1000
  lines.push('# HELP llamenos_uptime_seconds Process uptime in seconds')
  lines.push('# TYPE llamenos_uptime_seconds gauge')
  lines.push(`llamenos_uptime_seconds ${uptimeSeconds.toFixed(1)}`)

  // Backup metrics (read fresh on each scrape)
  const backup = readBackupStatus()
  lines.push(
    '# HELP llamenos_backup_age_seconds Seconds since last successful backup (-1 if unknown)'
  )
  lines.push('# TYPE llamenos_backup_age_seconds gauge')
  if (backup) {
    const ageSeconds = (Date.now() - new Date(backup.lastSuccessAt).getTime()) / 1000
    lines.push(`llamenos_backup_age_seconds ${ageSeconds.toFixed(0)}`)
  } else {
    lines.push('llamenos_backup_age_seconds -1')
  }

  lines.push(
    '# HELP llamenos_backup_size_bytes Size of last successful backup in bytes (-1 if unknown)'
  )
  lines.push('# TYPE llamenos_backup_size_bytes gauge')
  if (backup) {
    lines.push(`llamenos_backup_size_bytes ${backup.lastSizeBytes}`)
  } else {
    lines.push('llamenos_backup_size_bytes -1')
  }

  // Counters
  const emittedCounterTypes = new Set<string>()
  for (const [key, value] of Object.entries(counters)) {
    const name = key.split('{')[0]
    if (!emittedCounterTypes.has(name)) {
      emittedCounterTypes.add(name)
      lines.push(`# HELP ${name} Counter metric`)
      lines.push(`# TYPE ${name} counter`)
    }
    lines.push(`${key} ${value}`)
  }

  // Histograms — emit count and sum
  const histogramNames = new Set<string>()
  for (const [key, values] of Object.entries(histograms)) {
    const name = key.split('{')[0]
    if (!histogramNames.has(name)) {
      histogramNames.add(name)
      lines.push(`# HELP ${name} Summary metric`)
      lines.push(`# TYPE ${name} summary`)
    }
    const count = values.length
    const sum = values.reduce((a, b) => a + b, 0)
    const labelPart = key.includes('{') ? key.slice(key.indexOf('{')) : ''
    lines.push(`${name}_count${labelPart} ${count}`)
    lines.push(`${name}_sum${labelPart} ${sum.toFixed(6)}`)
  }

  return `${lines.join('\n')}\n`
}

// ── GET / — Prometheus metrics endpoint ──
// Note: Returns text/plain (Prometheus exposition format), not JSON.
// Kept as standard Hono route since OpenAPI expects JSON responses.

metrics.get('/', (c) => {
  return new Response(formatMetrics(), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  })
})

/**
 * HTTP request metrics middleware.
 *
 * Tracks llamenos_http_requests_total (counter) and
 * llamenos_http_request_duration_seconds (histogram) for every request
 * that passes through the middleware chain.
 *
 * Mount early in the Hono app — before route handlers — so all
 * requests are measured.
 */
export const httpMetrics = createMiddleware<AppEnv>(async (c, next) => {
  const start = performance.now()
  await next()
  try {
    const durationSeconds = (performance.now() - start) / 1000
    const method = c.req.method
    const status = String(c.res?.status ?? 0)
    incCounter('llamenos_http_requests_total', { method, status })
    observeHistogram('llamenos_http_request_duration_seconds', durationSeconds, { method, status })
  } catch {
    // Metrics collection must never throw
  }
})

export default metrics
