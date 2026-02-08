import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { getCallHistory, type CallRecord } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { PhoneIncoming, ChevronLeft, ChevronRight, Clock, Mic } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/calls')({
  component: CallHistoryPage,
})

function CallHistoryPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const limit = 50

  useEffect(() => {
    setLoading(true)
    getCallHistory({ page, limit })
      .then(r => { setCalls(r.calls); setTotal(r.total) })
      .catch(() => toast(t('common.error'), 'error'))
      .finally(() => setLoading(false))
  }, [page])

  if (!isAdmin) {
    return <div className="text-muted-foreground">Access denied</div>
  }

  const totalPages = Math.ceil(total / limit)

  function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <PhoneIncoming className="h-6 w-6 text-muted-foreground" />
        <h2 className="text-2xl font-bold">{t('callHistory.title')}</h2>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-3">
                  <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                  <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : calls.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <PhoneIncoming className="mx-auto mb-2 h-8 w-8 opacity-40" />
              {t('callHistory.noCalls')}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {calls.map(call => (
                <div key={call.id} className="flex items-center gap-4 px-6 py-3">
                  <code className="text-xs font-mono">{call.callerNumber}</code>
                  <span className="text-xs text-muted-foreground">
                    {call.answeredBy.slice(0, 12)}...
                  </span>
                  <Badge variant="outline" className="gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(call.duration)}
                  </Badge>
                  <span className="flex-1 text-right text-xs text-muted-foreground">
                    {new Date(call.startedAt).toLocaleString()}
                  </span>
                  {call.hasTranscription && (
                    <Badge variant="secondary">
                      <Mic className="h-3 w-3" />
                      {t('callHistory.hasTranscription')}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            {t('common.back')}
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            {t('common.next')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
