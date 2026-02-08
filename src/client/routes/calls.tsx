import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState, useCallback } from 'react'
import { getCallHistory, type CallRecord } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { PhoneIncoming, ChevronLeft, ChevronRight, Clock, Mic, Search, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type CallsSearch = {
  page: number
  q: string
  dateFrom: string
  dateTo: string
}

export const Route = createFileRoute('/calls')({
  validateSearch: (search: Record<string, unknown>): CallsSearch => ({
    page: Number(search?.page ?? 1),
    q: (search?.q as string) || '',
    dateFrom: (search?.dateFrom as string) || '',
    dateTo: (search?.dateTo as string) || '',
  }),
  component: CallHistoryPage,
})

function CallHistoryPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate({ from: '/calls' })
  const { page, q, dateFrom, dateTo } = Route.useSearch()
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // Local input state (synced to URL on submit)
  const [searchInput, setSearchInput] = useState(q)
  const [dateFromInput, setDateFromInput] = useState(dateFrom)
  const [dateToInput, setDateToInput] = useState(dateTo)
  const limit = 50

  const fetchCalls = useCallback(() => {
    setLoading(true)
    getCallHistory({
      page,
      limit,
      search: q || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    })
      .then(r => { setCalls(r.calls); setTotal(r.total) })
      .catch(() => toast(t('common.error'), 'error'))
      .finally(() => setLoading(false))
  }, [page, q, dateFrom, dateTo])

  useEffect(() => {
    fetchCalls()
  }, [fetchCalls])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    navigate({
      search: { page: 1, q: searchInput, dateFrom: dateFromInput, dateTo: dateToInput },
    })
  }

  function clearFilters() {
    setSearchInput('')
    setDateFromInput('')
    setDateToInput('')
    navigate({ search: { page: 1, q: '', dateFrom: '', dateTo: '' } })
  }

  function setPage(newPage: number) {
    navigate({ search: (prev) => ({ ...prev, page: newPage }) })
  }

  const hasFilters = q || dateFrom || dateTo

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

      {/* Search and filter bar */}
      <Card>
        <CardContent className="py-3">
          <form onSubmit={handleSearch} className="flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">{t('common.search')}</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder={t('callHistory.searchPlaceholder')}
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('callHistory.from')}</label>
              <Input
                type="date"
                value={dateFromInput}
                onChange={e => setDateFromInput(e.target.value)}
                className="w-36"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('callHistory.to')}</label>
              <Input
                type="date"
                value={dateToInput}
                onChange={e => setDateToInput(e.target.value)}
                className="w-36"
              />
            </div>
            <Button type="submit" size="sm">
              <Search className="h-4 w-4" />
            </Button>
            {hasFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

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
              {hasFilters ? t('callHistory.noResults') : t('callHistory.noCalls')}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {calls.map(call => (
                <div key={call.id} className="flex items-center gap-4 px-6 py-3">
                  <code className="text-xs font-mono">{call.callerNumber}</code>
                  <span className="text-xs text-muted-foreground">
                    {call.answeredBy ? `${call.answeredBy.slice(0, 12)}...` : '-'}
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            {t('common.back')}
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
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
