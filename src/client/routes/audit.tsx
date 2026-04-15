import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AuditLogEntry } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { useAuditChainIntegrity, useAuditLog } from '@/lib/queries/audit'
import { useUsers } from '@/lib/queries/users'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ScrollText,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/audit')({
  component: AuditPage,
})

const EVENT_CATEGORIES = [
  { value: 'all', labelKey: 'auditLog.allEvents' },
  { value: 'authentication', labelKey: 'auditLog.categoryAuth' },
  { value: 'users', labelKey: 'auditLog.categoryUsers' },
  { value: 'calls', labelKey: 'auditLog.categoryCalls' },
  { value: 'settings', labelKey: 'auditLog.categorySettings' },
  { value: 'shifts', labelKey: 'auditLog.categoryShifts' },
  { value: 'notes', labelKey: 'auditLog.categoryNotes' },
] as const

function getEventCategoryColor(event: string): string {
  const authEvents = [
    'login',
    'logout',
    'sessionCreated',
    'sessionExpired',
    'passkeyRegistered',
    'deviceLinked',
  ]
  const userEvents = [
    'userAdded',
    'userRemoved',
    'userRoleChanged',
    'userActivated',
    'userDeactivated',
    'userOnBreak',
    'userOffBreak',
    'inviteCreated',
    'inviteRedeemed',
  ]
  const callEvents = [
    'callAnswered',
    'callEnded',
    'callMissed',
    'spamReported',
    'voicemailReceived',
  ]
  const settingsEvents = [
    'settingsUpdated',
    'telephonyConfigured',
    'transcriptionToggled',
    'ivrUpdated',
    'customFieldsUpdated',
    'spamSettingsUpdated',
    'callSettingsUpdated',
  ]
  const shiftEvents = ['shiftCreated', 'shiftUpdated', 'shiftDeleted']

  if (authEvents.includes(event))
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
  if (userEvents.includes(event))
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
  if (callEvents.includes(event))
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
  if (settingsEvents.includes(event))
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
  if (shiftEvents.includes(event))
    return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300'
  return 'bg-secondary text-secondary-foreground'
}

const LIMIT = 50

function AuditPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { currentHubId } = useConfig()
  const chainIntegrity = useAuditChainIntegrity(currentHubId)
  const [page, setPage] = useState(1)
  const [searchText, setSearchText] = useState('')
  const [eventType, setEventType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const filters = {
    page,
    limit: LIMIT,
    eventType: eventType !== 'all' ? eventType : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    search: searchText || undefined,
  }

  const { data, isLoading: loading } = useAuditLog(filters)
  const { data: users = [] } = useUsers()

  const entries = data?.entries ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / LIMIT)

  const nameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const v of users) map.set(v.pubkey, v.name)
    return map
  }, [users])

  function clearFilters() {
    setSearchText('')
    setEventType('all')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  function handleEventTypeChange(value: string) {
    setEventType(value)
    setPage(1)
  }

  function handleSearchChange(value: string) {
    setSearchText(value)
    setPage(1)
  }

  function handleDateFromChange(value: string) {
    setDateFrom(value)
    setPage(1)
  }

  function handleDateToChange(value: string) {
    setDateTo(value)
    setPage(1)
  }

  if (!isAdmin) {
    return <div className="text-muted-foreground">{t('common.accessDenied')}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ScrollText className="h-6 w-6 text-primary" />
        <h1 data-testid="audit-log-heading" className="text-xl font-bold sm:text-2xl">
          {t('auditLog.title')}
        </h1>
      </div>

      <ChainIntegrityBanner
        status={
          chainIntegrity.isLoading || chainIntegrity.isFetching
            ? { kind: 'verifying' }
            : chainIntegrity.isError
              ? { kind: 'error', error: chainIntegrity.error as Error }
              : chainIntegrity.data
                ? chainIntegrity.data.state === 'verified'
                  ? { kind: 'verified', head: chainIntegrity.data.head }
                  : { kind: 'tampered', error: chainIntegrity.data.error }
                : { kind: 'verifying' }
        }
      />

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-3">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('common.search', { defaultValue: 'Search' })}
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchText}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t('auditLog.searchPlaceholder', {
                  defaultValue: 'Search actor or event...',
                })}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <div className="min-w-[150px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('auditLog.eventType', { defaultValue: 'Event Type' })}
            </label>
            <Select value={eventType} onValueChange={handleEventTypeChange}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {t(cat.labelKey, {
                      defaultValue:
                        cat.value === 'all'
                          ? 'All Events'
                          : cat.value.charAt(0).toUpperCase() + cat.value.slice(1),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('callHistory.from', { defaultValue: 'From' })}
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => handleDateFromChange(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('callHistory.to', { defaultValue: 'To' })}
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => handleDateToChange(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          {(searchText || eventType !== 'all' || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
              {t('common.clear', { defaultValue: 'Clear' })}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-3">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
                  <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <ScrollText className="mx-auto mb-2 h-8 w-8 opacity-40" />
              {t('auditLog.noEntries')}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {entries.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
                  <span className="w-full text-xs text-muted-foreground whitespace-nowrap sm:w-36 sm:shrink-0">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  <Badge variant="secondary" className={getEventCategoryColor(entry.event)}>
                    {t(`auditLog.events.${entry.event}`, { defaultValue: entry.event })}
                  </Badge>
                  <ActorDisplay pubkey={entry.actorPubkey} nameMap={nameMap} />
                  <AuditDetails entry={entry} />
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
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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

function ActorDisplay({ pubkey, nameMap }: { pubkey: string; nameMap: Map<string, string> }) {
  const name = nameMap.get(pubkey)

  if (pubkey === 'system') {
    return <code className="text-xs text-muted-foreground">system</code>
  }

  if (name) {
    return (
      <Link
        to="/users/$pubkey"
        params={{ pubkey }}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
          {name.charAt(0).toUpperCase()}
        </span>
        {name}
      </Link>
    )
  }

  return <code className="text-xs text-muted-foreground">{pubkey.slice(0, 12)}...</code>
}

type ChainBannerStatus =
  | { kind: 'verifying' }
  | { kind: 'verified'; head: { createdAt: string; entryHash: string } | null }
  | { kind: 'tampered'; error: { code: string; details: Record<string, unknown> } }
  | { kind: 'error'; error: Error }

function ChainIntegrityBanner({ status }: { status: ChainBannerStatus }) {
  const { t } = useTranslation()
  if (status.kind === 'verifying') {
    return (
      <div
        data-testid="audit-chain-status-verifying"
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>
          {t('auditLog.chain.verifying', { defaultValue: 'Verifying audit chain integrity…' })}
        </span>
      </div>
    )
  }
  if (status.kind === 'verified') {
    const when = status.head ? new Date(status.head.createdAt).toLocaleString() : null
    return (
      <div
        data-testid="audit-chain-status-verified"
        className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>
          {when
            ? t('auditLog.chain.verified', {
                defaultValue: 'Chain verified — last entry {{when}}',
                when,
              })
            : t('auditLog.chain.verifiedEmpty', {
                defaultValue: 'Chain verified — no entries yet',
              })}
        </span>
      </div>
    )
  }
  if (status.kind === 'tampered') {
    return (
      <div
        data-testid="audit-chain-status-tampered"
        role="alert"
        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="space-y-0.5">
          <div className="font-semibold">
            {t('auditLog.chain.tampered', {
              defaultValue: 'TAMPERED — chain verification failed',
            })}
          </div>
          <div
            data-testid="audit-chain-status-tampered-code"
            className="font-mono text-[10px] opacity-80"
          >
            {status.error.code}
          </div>
          <div className="font-mono text-[10px] opacity-70 break-all">
            {JSON.stringify(status.error.details)}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div
      data-testid="audit-chain-status-error"
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      <span>
        {t('auditLog.chain.error', {
          defaultValue: 'Could not verify chain: {{message}}',
          message: status.error.message,
        })}
      </span>
    </div>
  )
}

function AuditDetails({ entry }: { entry: AuditLogEntry }) {
  const { t } = useTranslation()
  const details = entry.details || {}

  const callerLast4 = details.callerLast4 as string | undefined
  const duration = details.duration as number | undefined
  const noteId = details.noteId as string | undefined

  const isCallEvent =
    entry.event === 'callAnswered' || entry.event === 'callEnded' || entry.event === 'callMissed'
  const isVoicemail = entry.event === 'voicemailReceived'
  const isNoteEvent =
    entry.event === 'noteCreated' ||
    entry.event === 'noteEdited' ||
    entry.event === 'noteReplyCreated'

  if (isCallEvent) {
    return (
      <span className="flex flex-1 items-center gap-2 truncate text-xs text-muted-foreground">
        {callerLast4 && (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            ***{callerLast4}
          </code>
        )}
        {duration !== undefined && entry.event === 'callEnded' && (
          <span>
            {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
          </span>
        )}
      </span>
    )
  }

  if (isVoicemail) {
    return (
      <span className="flex-1 text-xs text-muted-foreground">{t('callHistory.hasVoicemail')}</span>
    )
  }

  if (isNoteEvent && noteId) {
    return (
      <Link
        to="/notes/$noteId"
        params={{ noteId }}
        search={{ page: 1, callId: '', search: '' }}
        className="flex-1 text-xs text-primary hover:underline"
      >
        {t('notes.viewPermalink')}
      </Link>
    )
  }

  return <span className="flex-1 text-xs text-muted-foreground">—</span>
}
