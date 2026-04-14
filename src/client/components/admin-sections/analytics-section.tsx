import { SectionBody, SectionDescription } from '@/components/section-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useGlobalCallAnalytics,
  useGlobalCallHoursAnalytics,
  useGlobalUserStatsAnalytics,
} from '@/lib/queries/analytics'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * Super-admin-only section for cross-hub analytics.
 *
 * The `/analytics` endpoint is mounted twice in src/server/app.ts:
 *   - on `authenticated` (no hubContext → hubId undefined → cross-hub),
 *   - on `hubScoped` (active hub's data).
 *
 * This section talks exclusively to the un-prefixed `/analytics` endpoints via
 * `useGlobalCallAnalytics`, `useGlobalCallHoursAnalytics`,
 * `useGlobalUserStatsAnalytics`, which bypass `hp()` and ignore the active hub.
 * Dedicated `queryKeys.analytics.global*` cache scopes keep these rows out of
 * the hub-scoped analytics cache.
 */

function formatHour(h: number): string {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function AnalyticsSection() {
  const { t } = useTranslation()
  const [range, setRange] = useState<7 | 30>(7)

  const { data: callVolume, isLoading: loadingVolume } = useGlobalCallAnalytics(range)
  const { data: callHours, isLoading: loadingHours } = useGlobalCallHoursAnalytics()
  const { data: userStats, isLoading: loadingUsers } = useGlobalUserStatsAnalytics()

  const volumeData = (callVolume ?? []).map((d) => ({
    date: d.date,
    count: d.count,
    answered: d.answered,
    voicemail: d.voicemail,
  }))

  const hoursData = (callHours ?? []).map((d) => ({
    hour: formatHour(d.hour),
    count: d.count,
  }))

  const userRows = [...(userStats ?? [])].sort((a, b) => b.callsAnswered - a.callsAnswered)

  return (
    <SectionBody className="max-w-6xl">
      <SectionDescription>
        {t('analytics.description', {
          defaultValue: 'Cross-hub call activity and user engagement.',
        })}
      </SectionDescription>

      {/* Range toggle */}
      <div className="flex items-center gap-2">
        <Button
          data-testid="admin-analytics-range-7"
          variant={range === 7 ? 'default' : 'outline'}
          size="sm"
          onClick={() => setRange(7)}
        >
          {t('analytics.range.days7', { defaultValue: '7 days' })}
        </Button>
        <Button
          data-testid="admin-analytics-range-30"
          variant={range === 30 ? 'default' : 'outline'}
          size="sm"
          onClick={() => setRange(30)}
        >
          {t('analytics.range.days30', { defaultValue: '30 days' })}
        </Button>
      </div>

      {/* Call volume */}
      <Card>
        <CardHeader>
          <CardTitle>{t('analytics.callVolume.title', { defaultValue: 'Call volume' })}</CardTitle>
        </CardHeader>
        <CardContent data-testid="admin-analytics-call-volume-chart">
          {loadingVolume ? (
            <div className="h-[300px] animate-pulse rounded-md bg-muted/40" />
          ) : volumeData.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t('analytics.callVolume.noData', { defaultValue: 'No call data for this range.' })}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={volumeData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: string) => {
                    const d = new Date(v)
                    return `${d.getMonth() + 1}/${d.getDate()}`
                  }}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(label) => {
                    if (typeof label !== 'string') return String(label)
                    const d = new Date(label)
                    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                  name="count"
                />
                <Line
                  type="monotone"
                  dataKey="answered"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  name="answered"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Hour-of-day */}
      <Card>
        <CardHeader>
          <CardTitle>{t('analytics.hours.title', { defaultValue: 'Hour of day' })}</CardTitle>
        </CardHeader>
        <CardContent data-testid="admin-analytics-hours-chart">
          {loadingHours ? (
            <div className="h-[300px] animate-pulse rounded-md bg-muted/40" />
          ) : hoursData.length === 0 || hoursData.every((d) => d.count === 0) ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t('analytics.hours.noData', { defaultValue: 'No hourly data available.' })}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hoursData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[2, 2, 0, 0]} name="count" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* User stats */}
      <Card>
        <CardHeader>
          <CardTitle>{t('analytics.users.title', { defaultValue: 'Per-user activity' })}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <div className="space-y-2">
              <div className="h-8 w-full animate-pulse rounded bg-muted/40" />
              <div className="h-8 w-full animate-pulse rounded bg-muted/40" />
              <div className="h-8 w-full animate-pulse rounded bg-muted/40" />
            </div>
          ) : userRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('analytics.users.noData', { defaultValue: 'No user activity recorded.' })}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="admin-analytics-users-table">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2">
                      {t('analytics.users.columns.name', { defaultValue: 'User' })}
                    </th>
                    <th className="px-4 py-2 text-right">
                      {t('analytics.users.columns.calls', { defaultValue: 'Calls' })}
                    </th>
                    <th className="px-4 py-2 text-right">
                      {t('analytics.users.columns.avgDuration', { defaultValue: 'Avg duration' })}
                    </th>
                    <th className="px-4 py-2">
                      {t('analytics.users.columns.notes', { defaultValue: 'Notes' })}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {userRows.map((row) => {
                    const displayName =
                      row.name && row.name.trim().length > 0
                        ? row.name
                        : `${row.pubkey.slice(0, 10)}…`
                    return (
                      <tr
                        key={row.pubkey}
                        data-testid={`admin-analytics-user-row-${row.pubkey}`}
                        className="align-top"
                      >
                        <td className="px-4 py-2 font-mono text-xs">{displayName}</td>
                        <td className="px-4 py-2 text-right font-medium">{row.callsAnswered}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {formatDuration(row.avgDuration)}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{row.notesCreated}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </SectionBody>
  )
}
