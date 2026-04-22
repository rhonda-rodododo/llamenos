import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import type { CallHourBucket } from '@/lib/api'

interface Props {
  data: CallHourBucket[]
  loading: boolean
}

function formatHour(h: number): string {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

export function CallHoursChart({ data, loading }: Props) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="space-y-2" data-testid="call-hours-chart-skeleton">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    )
  }

  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <p
        className="py-8 text-center text-sm text-muted-foreground"
        data-testid="call-hours-no-data"
      >
        {t('dashboard.analytics.noData')}
      </p>
    )
  }

  const chartData = data.map((d) => ({
    hour: formatHour(d.hour),
    count: d.count,
  }))

  return (
    <div data-testid="call-hours-chart">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 8, left: 28, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
          <YAxis type="category" dataKey="hour" tick={{ fontSize: 10 }} width={32} />
          <Tooltip formatter={(value) => [value, t('calls.title', { defaultValue: 'Calls' })]} />
          <Bar dataKey="count" fill="#6366f1" radius={[0, 2, 2, 0]} name="count" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
