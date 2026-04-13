import { SectionBody, SectionDescription } from '@/components/section-layout'
import { Button } from '@/components/ui/button'
import { useAuthEvents, useExportAuthEvents, useReportSuspicious } from '@/lib/queries/auth-events'
import { createFileRoute } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/security/history')({
  component: HistoryPage,
})

function eventTypeLabel(t: TFunction, type: string): string {
  return t(`security.history.eventType.${type}`, type.replaceAll('_', ' '))
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function HistoryPage() {
  const { t } = useTranslation()
  const { data: events, isLoading } = useAuthEvents(100)
  const report = useReportSuspicious()
  const exportM = useExportAuthEvents()

  if (isLoading) return <div>{t('common.loading', 'Loading...')}</div>
  if (!events) return null

  const handleExport = async () => {
    const data = await exportM.mutateAsync()
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `auth-history-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <SectionBody surface="user" data-testid="history-page">
      <div className="flex justify-between items-start gap-4">
        <SectionDescription surface="user">
          {t(
            'security.history.description',
            'Security events on your account from the last 90 days.'
          )}
        </SectionDescription>
        <Button
          variant="outline"
          disabled={exportM.isPending}
          onClick={handleExport}
          data-testid="export-history"
        >
          {t('security.history.export', 'Export history')}
        </Button>
      </div>
      {events.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t('security.history.none', 'No events yet.')}
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start justify-between p-3 border rounded"
              data-testid={`event-row-${ev.id}`}
            >
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  <span>{eventTypeLabel(t, ev.eventType)}</span>
                  {ev.reportedSuspiciousAt && (
                    <span
                      className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded"
                      data-testid="suspicious-flag"
                    >
                      {t('security.history.flagged', 'Flagged')}
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {ev.payload?.city && ev.payload?.country ? (
                    <span>
                      {ev.payload.city}, {ev.payload.country} ·{' '}
                    </span>
                  ) : null}
                  {ev.payload?.userAgent ? <span>{ev.payload.userAgent} · </span> : null}
                  <span>{formatTimestamp(ev.createdAt)}</span>
                </div>
              </div>
              {!ev.reportedSuspiciousAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => report.mutate(ev.id)}
                  disabled={report.isPending}
                  data-testid={`report-${ev.id}`}
                >
                  {t('security.history.report', 'Report suspicious')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionBody>
  )
}
