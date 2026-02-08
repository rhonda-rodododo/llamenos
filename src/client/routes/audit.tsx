import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { listAuditLog, type AuditLogEntry } from '@/lib/api'

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
  const limit = 50

  useEffect(() => {
    setLoading(true)
    listAuditLog({ page, limit })
      .then(r => { setEntries(r.entries); setTotal(r.total) })
      .finally(() => setLoading(false))
  }, [page])

  if (!isAdmin) {
    return <div className="text-muted-foreground">Access denied</div>
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t('auditLog.title')}</h2>

      <div className="rounded-lg border border-border">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{t('auditLog.noEntries')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium">{t('auditLog.timestamp')}</th>
                <th className="px-4 py-3 font-medium">{t('auditLog.event')}</th>
                <th className="px-4 py-3 font-medium">{t('auditLog.actor')}</th>
                <th className="px-4 py-3 font-medium">{t('auditLog.details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs">
                      {t(`auditLog.events.${entry.event}` as any, { defaultValue: entry.event })}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{entry.actorPubkey.slice(0, 12)}...</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {JSON.stringify(entry.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {t('common.back')}
          </button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  )
}
