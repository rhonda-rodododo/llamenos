import { SectionBody, SectionDescription } from '@/components/admin-shell/section-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { HealthCheckResult } from '@/lib/api'
import { useProviderHealth, useSystemHealth } from '@/lib/queries/provider'
import { cn } from '@/lib/utils'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Super-admin-only platform Health dashboard. Shows two cards:
 *
 *  1. System Health — DB, storage, Nostr relay checks from `/api/health`
 *     (public endpoint — used by k8s probes).
 *  2. Provider Health — per-telephony/messaging provider status from
 *     `/api/settings/provider-health` (settings:read).
 *
 * Both cards auto-refresh every 15s via React Query `refetchInterval`.
 */

type DependencyStatus = 'ok' | 'failing'
type ProviderStatus = 'healthy' | 'degraded' | 'down'

function StatusDot({
  status,
  className,
}: {
  status: DependencyStatus | ProviderStatus
  className?: string
}) {
  const color =
    status === 'ok' || status === 'healthy'
      ? 'bg-green-500'
      : status === 'degraded'
        ? 'bg-amber-500'
        : 'bg-red-500'
  return (
    <span aria-hidden className={cn('inline-block h-2.5 w-2.5 rounded-full', color, className)} />
  )
}

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

function DependencyRow({
  label,
  status,
  testid,
  detail,
}: {
  label: string
  status: DependencyStatus | undefined
  testid: string
  detail?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2">
        <StatusDot status={status ?? 'failing'} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span
        data-testid={testid}
        className={cn(
          'text-xs font-mono',
          status === 'ok' ? 'text-muted-foreground' : 'text-destructive'
        )}
      >
        {detail ?? status ?? '—'}
      </span>
    </div>
  )
}

function ProviderRow({
  name,
  result,
  t,
}: {
  name: string
  result: HealthCheckResult
  t: (k: string, o?: Record<string, unknown>) => string
}) {
  const slug = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <StatusDot status={result.status} />
          <span className="text-sm font-medium">{name}</span>
          <span
            data-testid={`admin-health-provider-${slug}-status`}
            className="text-xs text-muted-foreground"
          >
            {t(`health.providers.${result.status}`, { defaultValue: result.status })}
          </span>
        </div>
        <span
          data-testid={`admin-health-provider-${slug}-latency`}
          className="text-xs font-mono text-muted-foreground"
        >
          {t('health.providers.latency', { defaultValue: 'Latency' })}: {result.latencyMs}ms
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <span data-testid={`admin-health-provider-${slug}-last-check`}>
          {t('health.providers.lastCheck', { defaultValue: 'Last check' })}:{' '}
          {formatTimestamp(result.lastCheck)}
        </span>
        <span>
          {t('health.providers.failures', { defaultValue: 'Failures' })}:{' '}
          {result.consecutiveFailures}
        </span>
      </div>
      {result.error && (
        <p className="mt-1 text-xs text-destructive font-mono break-all">{result.error}</p>
      )}
    </div>
  )
}

export function HealthSection() {
  const { t } = useTranslation()
  const systemQuery = useSystemHealth()
  const providerQuery = useProviderHealth()

  const system = systemQuery.data
  const provider = providerQuery.data

  const providers: Array<{ name: string; result: HealthCheckResult }> = []
  if (provider?.telephony) {
    providers.push({ name: provider.telephony.provider, result: provider.telephony })
  }
  if (provider?.messaging) {
    for (const [channel, result] of Object.entries(provider.messaging)) {
      providers.push({ name: `${result.provider} (${channel})`, result })
    }
  }

  const handleRefresh = () => {
    void systemQuery.refetch()
    void providerQuery.refetch()
  }

  return (
    <SectionBody className="max-w-4xl">
      <SectionDescription>
        {t('health.description', { defaultValue: 'System and provider health status.' })}
      </SectionDescription>

      <div className="flex items-center justify-end">
        <Button
          data-testid="admin-health-refresh-button"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={systemQuery.isFetching || providerQuery.isFetching}
        >
          <RefreshCw
            className={cn(
              'mr-2 h-4 w-4',
              (systemQuery.isFetching || providerQuery.isFetching) && 'animate-spin'
            )}
          />
          {t('health.providers.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {/* System Health */}
      <Card data-testid="admin-health-system-card">
        <CardHeader>
          <CardTitle>{t('health.system.title', { defaultValue: 'System health' })}</CardTitle>
        </CardHeader>
        <CardContent>
          {systemQuery.isLoading ? (
            <div className="space-y-2">
              <div className="h-8 w-full animate-pulse rounded bg-muted/40" />
              <div className="h-8 w-full animate-pulse rounded bg-muted/40" />
              <div className="h-8 w-full animate-pulse rounded bg-muted/40" />
            </div>
          ) : (
            <div>
              <DependencyRow
                label={t('health.system.database', { defaultValue: 'Database' })}
                status={system?.checks?.postgres}
                testid="admin-health-system-db-status"
                detail={system?.details?.postgres ?? system?.checks?.postgres}
              />
              <DependencyRow
                label={t('health.system.storage', { defaultValue: 'Object storage' })}
                status={system?.checks?.storage}
                testid="admin-health-system-storage-status"
                detail={system?.details?.storage ?? system?.checks?.storage}
              />
              <DependencyRow
                label={t('health.system.relay', { defaultValue: 'Nostr relay' })}
                status={system?.checks?.relay}
                testid="admin-health-system-relay-status"
                detail={system?.details?.relay ?? system?.checks?.relay}
              />
              <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
                <span data-testid="admin-health-system-version">
                  {t('health.system.version', { defaultValue: 'Version' })}:{' '}
                  <span className="font-mono">{system?.version ?? '—'}</span>
                </span>
                <span data-testid="admin-health-system-uptime">
                  {t('health.system.uptime', { defaultValue: 'Uptime' })}:{' '}
                  <span className="font-mono">{formatUptime(system?.uptime ?? null)}</span>
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provider Health */}
      <Card data-testid="admin-health-providers-card">
        <CardHeader>
          <CardTitle>{t('health.providers.title', { defaultValue: 'Provider health' })}</CardTitle>
        </CardHeader>
        <CardContent>
          {providerQuery.isLoading ? (
            <div className="space-y-2">
              <div className="h-12 w-full animate-pulse rounded bg-muted/40" />
              <div className="h-12 w-full animate-pulse rounded bg-muted/40" />
            </div>
          ) : providers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('health.providers.empty', { defaultValue: 'No providers configured.' })}
            </p>
          ) : (
            <div>
              {providers.map((p) => (
                <ProviderRow key={p.name} name={p.name} result={p.result} t={t} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </SectionBody>
  )
}
