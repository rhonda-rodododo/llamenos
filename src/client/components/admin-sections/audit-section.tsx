import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionBody, SectionDescription, SectionField } from '@/components/section-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGlobalAuditLog } from '@/lib/queries/audit'

/**
 * Super-admin-only section for the GLOBAL (platform-wide) audit log.
 *
 * The `/audit` endpoint is mounted twice in src/server/app.ts:
 *   - on `authenticated` (no hubContext → `c.get('hubId')` is undefined → rows
 *     with `hub_id = 'global'`),
 *   - on `hubScoped` (the active hub's entries).
 *
 * This section talks exclusively to the un-prefixed `/audit` endpoint via
 * `useGlobalAuditLog`, which bypasses `hp()` and ignores the active hub.
 * A dedicated `queryKeys.audit.globalList()` cache scope keeps these rows
 * out of the hub-scoped audit cache.
 */

const PAGE_SIZE = 50

const EVENT_TYPES = [
  'authentication',
  'users',
  'calls',
  'settings',
  'shifts',
  'notes',
  'messaging',
] as const

type EventType = (typeof EVENT_TYPES)[number] | ''

interface AuditFiltersState {
  eventType: EventType
  dateFrom: string
  dateTo: string
  search: string
}

const EMPTY_FILTERS: AuditFiltersState = {
  eventType: '',
  dateFrom: '',
  dateTo: '',
  search: '',
}

export function AuditSection() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<AuditFiltersState>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  // Build the query params — strip empty strings so the server doesn't get
  // meaningless filter keys.
  const queryFilters = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
      ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
      ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    }),
    [page, filters]
  )

  const { data, isLoading } = useGlobalAuditLog(queryFilters)
  const entries = data?.entries ?? []
  const total = data?.total ?? 0

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)
  const rangeText = t('audit.pagination.rangeOf', {
    defaultValue: '{{start}}-{{end}} of {{total}}',
    start: rangeStart,
    end: rangeEnd,
    total,
  })

  const hasPrev = page > 1
  const hasNext = page * PAGE_SIZE < total

  function updateFilter<K extends keyof AuditFiltersState>(key: K, value: AuditFiltersState[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  return (
    <SectionBody className="max-w-6xl">
      <SectionDescription>
        {t('audit.description', {
          defaultValue: 'Review every administrative action across all hubs.',
        })}
      </SectionDescription>

      {/* Filter bar */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SectionField
          label={t('audit.filters.eventType', { defaultValue: 'Event type' })}
          htmlFor="admin-audit-filter-event-type"
        >
          <select
            id="admin-audit-filter-event-type"
            data-testid="admin-audit-filter-event-type"
            value={filters.eventType}
            onChange={(e) => updateFilter('eventType', e.target.value as EventType)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">{t('common.all', { defaultValue: 'All' })}</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`audit.eventTypes.${type}`, { defaultValue: type })}
              </option>
            ))}
          </select>
        </SectionField>

        <SectionField
          label={t('audit.filters.dateFrom', { defaultValue: 'From' })}
          htmlFor="admin-audit-filter-date-from"
        >
          <Input
            id="admin-audit-filter-date-from"
            data-testid="admin-audit-filter-date-from"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
          />
        </SectionField>

        <SectionField
          label={t('audit.filters.dateTo', { defaultValue: 'To' })}
          htmlFor="admin-audit-filter-date-to"
        >
          <Input
            id="admin-audit-filter-date-to"
            data-testid="admin-audit-filter-date-to"
            type="date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
          />
        </SectionField>

        <SectionField
          label={t('audit.filters.search', { defaultValue: 'Search' })}
          htmlFor="admin-audit-search-input"
        >
          <Input
            id="admin-audit-search-input"
            data-testid="admin-audit-search-input"
            type="search"
            placeholder={t('audit.filters.searchPlaceholder', {
              defaultValue: 'Event, actor, details…',
            })}
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
          />
        </SectionField>
      </div>

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={clearFilters}
          data-testid="admin-audit-clear-filters"
        >
          {t('audit.filters.clear', { defaultValue: 'Clear filters' })}
        </Button>
      </div>

      {/* Results table */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t('common.loading', { defaultValue: 'Loading...' })}
        </div>
      ) : entries.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
          data-testid="admin-audit-empty"
        >
          {t('audit.empty', { defaultValue: 'No audit entries match these filters.' })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm" data-testid="admin-audit-table">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">
                  {t('audit.columns.timestamp', { defaultValue: 'Timestamp' })}
                </th>
                <th className="px-4 py-2">{t('audit.columns.actor', { defaultValue: 'Actor' })}</th>
                <th className="px-4 py-2">{t('audit.columns.event', { defaultValue: 'Event' })}</th>
                <th className="px-4 py-2">
                  {t('audit.columns.details', { defaultValue: 'Details' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const when = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—'
                const actor = entry.actorPubkey ? `${entry.actorPubkey.slice(0, 10)}…` : '—'
                const details = JSON.stringify(entry.details ?? {})
                return (
                  <tr
                    key={entry.id}
                    data-testid={`admin-audit-row-${entry.id}`}
                    className="border-t border-border align-top"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{when}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{actor}</td>
                    <td className="whitespace-nowrap px-4 py-3">{entry.event}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="line-clamp-2 break-all font-mono text-xs">{details}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span data-testid="admin-audit-page-info" className="text-xs text-muted-foreground">
          {rangeText}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            data-testid="admin-audit-prev-page"
          >
            {t('audit.pagination.prev', { defaultValue: 'Prev' })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
            data-testid="admin-audit-next-page"
          >
            {t('audit.pagination.next', { defaultValue: 'Next' })}
          </Button>
        </div>
      </div>
    </SectionBody>
  )
}
