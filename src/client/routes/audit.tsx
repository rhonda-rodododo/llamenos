import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState, useMemo } from 'react'
import { listAuditLog, listVolunteers, type AuditLogEntry, type Volunteer } from '@/lib/api'
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/audit')({
  component: AuditPage,
})

function AuditPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [volunteers, setVolunteers] = useState<Volunteer[]>([])
  const limit = 50

  useEffect(() => {
    listVolunteers().then(r => setVolunteers(r.volunteers)).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    listAuditLog({ page, limit })
      .then(r => { setEntries(r.entries); setTotal(r.total) })
      .finally(() => setLoading(false))
  }, [page])

  const nameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const v of volunteers) {
      map.set(v.pubkey, v.name)
    }
    return map
  }, [volunteers])

  if (!isAdmin) {
    return <div className="text-muted-foreground">Access denied</div>
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ScrollText className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold sm:text-2xl">{t('auditLog.title')}</h1>
      </div>

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
              {entries.map(entry => (
                <div key={entry.id} className="flex flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
                  <span className="w-full text-xs text-muted-foreground whitespace-nowrap sm:w-36 sm:shrink-0">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  <Badge variant="secondary">
                    {t(`auditLog.events.${entry.event}` as any, { defaultValue: entry.event })}
                  </Badge>
                  <ActorDisplay pubkey={entry.actorPubkey} nameMap={nameMap} />
                  <span className="flex-1 truncate text-xs text-muted-foreground">
                    {Object.entries(entry.details || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}
                  </span>
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

function ActorDisplay({ pubkey, nameMap }: { pubkey: string; nameMap: Map<string, string> }) {
  const name = nameMap.get(pubkey)

  if (pubkey === 'system') {
    return <code className="text-xs text-muted-foreground">system</code>
  }

  if (name) {
    return (
      <Link
        to="/volunteers/$pubkey"
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
