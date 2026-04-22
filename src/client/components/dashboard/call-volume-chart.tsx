import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { CallVolumeDay } from '@/lib/api'

interface Props {
  data: CallVolumeDay[]
  loading: boolean
  days: 7 | 30
  onDaysChange: (days: 7 | 30) => void
}

export function CallVolumeChart({ data, loading, days, onDaysChange }: Props) {
  const { t } = useTranslation()

  const chartData = data.map((d) => ({
    date: d.date,
    // unanswered = total - answered - voicemail
    unanswered: Math.max(0, d.count - d.answered - d.voicemail),
    voicemail: d.voicemail,
    answered: d.answered,
  }))

  if (loading) {
    return (
      <div className="space-y-2" data-testid="call-volume-chart-skeleton">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-[220px] w-full" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <p
        className="py-8 text-center text-sm text-muted-foreground"
        data-testid="call-volume-no-data"
      >
        {t('dashboard.analytics.noData')}
      </p>
    )
  }

  return (
    <div data-testid="call-volume-chart">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {days === 7
            ? t('dashboard.analytics.callVolume7d')
            : t('dashboard.analytics.callVolume30d')}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={days === 7 ? 'default' : 'outline'}
            onClick={() => onDaysChange(7)}
            className="h-7 px-2 text-xs"
          >
            7d
          </Button>
          <Button
            size="sm"
            variant={days === 30 ? 'default' : 'outline'}
            onClick={() => onDaysChange(30)}
            className="h-7 px-2 text-xs"
          >
            30d
          </Button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickFormatter={(v: string) => {
              const d = new Date(v)
              return `${d.getMonth() + 1}/${d.getDate()}`
            }}
          />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip
            formatter={(value, name) => {
              const label =
                name === 'answered'
                  ? t('dashboard.analytics.answered')
                  : name === 'voicemail'
                    ? t('dashboard.analytics.voicemail')
                    : t('dashboard.analytics.unanswered')
              return [value, label]
            }}
            labelFormatter={(label) => {
              if (typeof label !== 'string') return String(label)
              const d = new Date(label)
              return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            }}
          />
          <Bar
            dataKey="answered"
            stackId="a"
            fill="#22c55e"
            name="answered"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="voicemail"
            stackId="a"
            fill="#eab308"
            name="voicemail"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="unanswered"
            stackId="a"
            fill="#ef4444"
            name="unanswered"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500" />
          {t('dashboard.analytics.answered')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-yellow-500" />
          {t('dashboard.analytics.voicemail')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />
          {t('dashboard.analytics.unanswered')}
        </span>
      </div>
    </div>
  )
}
