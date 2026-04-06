/**
 * Data retention purge job.
 *
 * Run daily (e.g. via setInterval or external cron) to delete records older
 * than the configured retention windows. Logs a gdprRetentionPurge audit entry.
 *
 * Invoke via:
 *   import { runRetentionPurge } from './jobs/retention-purge'
 *   await runRetentionPurge(services)
 */
import { createLogger } from '../lib/logger'
import type { Services } from '../services'

const log = createLogger('jobs.retention-purge')

export async function runRetentionPurge(services: Services): Promise<void> {
  const settings = await services.gdpr.getRetentionSettings()
  const summary = await services.gdpr.purgeExpiredData(settings)

  // Purge auth events older than 90 days (user-scoped security history).
  // Guard: authEvents may not exist in test environments where Services is mocked.
  let authEventsDeleted = 0
  try {
    authEventsDeleted = (await services.authEvents?.purgeOld()) ?? 0
  } catch (err) {
    log.error('Auth events purge failed', err instanceof Error ? err : new Error(String(err)))
  }

  const totalDeleted =
    summary.callRecordsDeleted +
    summary.notesDeleted +
    summary.messagesDeleted +
    summary.auditLogDeleted +
    authEventsDeleted

  log.info('Retention purge complete', { ...summary, authEventsDeleted })

  // Only audit-log if something was deleted (avoid noise on empty runs)
  if (totalDeleted > 0) {
    await services.records.addAuditEntry('global', 'gdprRetentionPurge', 'system', {
      ...summary,
      authEventsDeleted,
      runAt: new Date().toISOString(),
    })
  }
}

/**
 * Schedule the purge job to run daily at 03:00 UTC.
 * Call this once during server startup.
 */
export function scheduleRetentionPurge(services: Services): NodeJS.Timeout {
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  function msUntilNextRun(): number {
    const now = new Date()
    const nextRun = new Date(now)
    nextRun.setUTCHours(3, 0, 0, 0)
    if (nextRun <= now) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1)
    }
    return nextRun.getTime() - now.getTime()
  }

  let intervalId: NodeJS.Timeout

  // First fire at next 03:00 UTC, then every 24h
  const timeoutId = setTimeout(async () => {
    await runRetentionPurge(services).catch((err) => {
      log.error('Retention purge failed', err)
    })
    intervalId = setInterval(async () => {
      await runRetentionPurge(services).catch((err) => {
        log.error('Retention purge failed', err)
      })
    }, MS_PER_DAY)
  }, msUntilNextRun())

  // Return the timeout so server.ts can cancel it on shutdown
  return timeoutId
}
