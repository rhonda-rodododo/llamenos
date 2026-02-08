import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { listActiveCalls, type ActiveCall } from '@/lib/api'
import { onMessage } from '@/lib/ws'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { t } = useTranslation()
  const { isAuthenticated, isAdmin, name } = useAuth()
  const navigate = useNavigate()
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([])
  const [status, setStatus] = useState<'ready' | 'on-call' | 'away'>('ready')

  useEffect(() => {
    if (!isAuthenticated) {
      navigate({ to: '/login' })
    }
  }, [isAuthenticated, navigate])

  useEffect(() => {
    listActiveCalls()
      .then(res => setActiveCalls(res.calls))
      .catch(() => {})

    const unsubCall = onMessage('call:update', (data) => {
      const call = data as ActiveCall
      setActiveCalls(prev => {
        const idx = prev.findIndex(c => c.id === call.id)
        if (call.status === 'completed') {
          return prev.filter(c => c.id !== call.id)
        }
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = call
          return next
        }
        return [...prev, call]
      })
    })

    const unsubIncoming = onMessage('call:incoming', (data) => {
      const call = data as ActiveCall
      setActiveCalls(prev => [...prev, call])
    })

    return () => {
      unsubCall()
      unsubIncoming()
    }
  }, [])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t('dashboard.title')}</h2>

      {/* Status cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatusCard
          title={t('dashboard.activeCalls')}
          value={String(activeCalls.length)}
        />
        <StatusCard
          title={t('dashboard.currentShift')}
          value={status === 'ready' ? t('dashboard.ready') : status === 'on-call' ? t('dashboard.onCall') : t('dashboard.away')}
        />
        <StatusCard
          title={t('dashboard.callsToday')}
          value="-"
        />
      </div>

      {/* Active calls list */}
      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-medium">{t('dashboard.activeCalls')}</h3>
        </div>
        {activeCalls.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('dashboard.noActiveCalls')}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activeCalls.map(call => (
              <div key={call.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{call.callerNumber || t('calls.unknown')}</p>
                  <p className="text-xs text-muted-foreground">
                    {call.status === 'ringing' ? t('calls.incoming') : t('calls.active')}
                  </p>
                </div>
                {call.status === 'ringing' && (
                  <button
                    className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                    onClick={() => {/* TODO: answer via WebSocket */}}
                  >
                    {t('calls.answer')}
                  </button>
                )}
                {call.status === 'in-progress' && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-green-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                    {t('calls.active')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}
