import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Disc,
  Mic,
  PhoneIncoming,
  PhoneMissed,
  Search,
  StickyNote,
  Voicemail,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RecordingPlayer } from '@/components/recording-player'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { VoicemailPlayer } from '@/components/voicemail-player'
import { useAuth } from '@/lib/auth'
import { useCallHistory } from '@/lib/queries/calls'
import { useUsers } from '@/lib/queries/users'

type CallsSearch = {
  page: number
  q: string
  dateFrom: string
  dateTo: string
  voicemailOnly: boolean
}

export const Route = createFileRoute('/calls')({
  validateSearch: (search: Record<string, unknown>): CallsSearch => ({
    page: Number(search?.page ?? 1),
    q: (search?.q as string) || '',
    dateFrom: (search?.dateFrom as string) || '',
    dateTo: (search?.dateTo as string) || '',
    voicemailOnly: search?.voicemailOnly === true || search?.voicemailOnly === 'true',
  }),
  component: CallHistoryPage,
})

function CallHistoryPage() {
  const { t } = useTranslation()
  const { isAdmin, hasPermission } = useAuth()
  const navigate = useNavigate({ from: '/calls' })
  const { page, q, dateFrom, dateTo, voicemailOnly } = Route.useSearch()
  // Local input state (synced to URL on submit)
  const [searchInput, setSearchInput] = useState(q)
  const [dateFromInput, setDateFromInput] = useState(dateFrom)
  const [dateToInput, setDateToInput] = useState(dateTo)
  const limit = 50

  const { data, isLoading } = useCallHistory({
    page,
    limit,
    search: q || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    voicemailOnly: voicemailOnly || undefined,
  })

  const { data: users = [] } = useUsers()

  const calls = data?.calls ?? []
  const total = data?.total ?? 0

  const nameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const v of users) map.set(v.pubkey, v.name)
    return map
  }, [users])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    navigate({
      search: {
        page: 1,
        q: searchInput,
        dateFrom: dateFromInput,
        dateTo: dateToInput,
        voicemailOnly,
      },
    })
  }

  function clearFilters() {
    setSearchInput('')
    setDateFromInput('')
    setDateToInput('')
    navigate({ search: { page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false } })
  }

  function toggleVoicemailOnly() {
    navigate({ search: (prev) => ({ ...prev, page: 1, voicemailOnly: !voicemailOnly }) })
  }

  function setPage(newPage: number) {
    navigate({ search: (prev) => ({ ...prev, page: newPage }) })
  }

  const hasFilters = q || dateFrom || dateTo || voicemailOnly

  if (!isAdmin) {
    return <div className="text-muted-foreground">{t('common.accessDenied')}</div>
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
        <PhoneIncoming className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold sm:text-2xl">{t('callHistory.title')}</h1>
      </div>

      {/* Search and filter bar */}
      <Card>
        <CardContent className="py-3">
          <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('common.search')}
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="call-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('callHistory.searchPlaceholder')}
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('callHistory.from')}
              </label>
              <Input
                type="date"
                value={dateFromInput}
                onChange={(e) => setDateFromInput(e.target.value)}
                className="w-full sm:w-36"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('callHistory.to')}
              </label>
              <Input
                type="date"
                value={dateToInput}
                onChange={(e) => setDateToInput(e.target.value)}
                className="w-full sm:w-36"
              />
            </div>
            <div className="flex gap-2">
              <Button
                data-testid="call-search-btn"
                type="submit"
                size="sm"
                aria-label={t('a11y.searchButton')}
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button
                data-testid="call-voicemail-filter"
                type="button"
                variant={voicemailOnly ? 'default' : 'outline'}
                size="sm"
                onClick={toggleVoicemailOnly}
                aria-pressed={voicemailOnly}
                title={t('callHistory.voicemailsOnly', { defaultValue: 'Voicemails only' })}
              >
                <Voicemail className="h-4 w-4" />
              </Button>
              {hasFilters && (
                <Button
                  data-testid="call-clear-filters"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  aria-label={t('a11y.clearFilters')}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
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
              {calls.map((call) => (
                <div
                  key={call.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 hover:bg-muted/30 transition-colors"
                  data-testid="call-history-row"
                >
                  <Link
                    to="/calls/$callId"
                    params={{ callId: call.id }}
                    search={{ page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false }}
                    className="min-w-0 flex-1 sm:flex-none sm:w-48 block"
                    data-testid="call-detail-link"
                  >
                    {call.status === 'unanswered' ? (
                      <div className="flex items-center gap-1.5">
                        <PhoneMissed className="h-3.5 w-3.5 shrink-0 text-destructive" />
                        <span className="text-sm font-medium text-destructive">
                          {t('callHistory.unanswered')}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <PhoneIncoming className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {call.answeredBy ? nameMap.get(call.answeredBy) || t('users.title') : '-'}
                        </span>
                      </div>
                    )}
                    {(() => {
                      const cl4 = call.callerLast4 ?? ''
                      return cl4 && cl4 !== '[encrypted]' ? (
                        <code className="text-[10px] text-muted-foreground font-mono">
                          ***{cl4}
                        </code>
                      ) : cl4 === '[encrypted]' ? (
                        <code className="text-[10px] text-muted-foreground font-mono">{cl4}</code>
                      ) : null
                    })()}
                  </Link>
                  {call.duration !== undefined && (
                    <Badge variant="outline" className="gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(call.duration)}
                    </Badge>
                  )}
                  <div className="flex items-center gap-1.5">
                    {call.hasVoicemail && (
                      <VoicemailPlayer
                        fileId={call.voicemailFileId}
                        callId={call.id}
                        canListen={hasPermission('voicemail:listen')}
                      />
                    )}
                    {call.hasTranscription && (
                      <Link to="/notes" search={{ page: 1, callId: call.id, search: '' }}>
                        <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-muted">
                          <Mic className="h-3 w-3" />
                        </Badge>
                      </Link>
                    )}
                    {call.hasRecording && (
                      <Badge variant="secondary" className="gap-1" data-testid="recording-badge">
                        <Disc className="h-3 w-3" />
                        {t('recording.title')}
                      </Badge>
                    )}
                  </div>
                  {call.hasRecording && <RecordingPlayer callId={call.id} />}
                  <span className="flex-1 text-right text-xs text-muted-foreground">
                    {new Date(call.startedAt).toLocaleString()}
                  </span>
                  <Link
                    to="/notes"
                    search={{ page: 1, callId: call.id, search: '' }}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <StickyNote className="h-3 w-3" />
                    {t('notes.viewNotes')}
                  </Link>
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
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
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
