import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { useCalls, useCallTimer } from '@/lib/hooks'
import { createNote, listActiveCalls, type ActiveCall } from '@/lib/api'
import { encryptNote } from '@/lib/crypto'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { t } = useTranslation()
  const { isAuthenticated, isAdmin, keyPair } = useAuth()
  const navigate = useNavigate()
  const { calls, currentCall, answerCall, hangupCall, reportSpam, ringingCalls, activeCalls } = useCalls()

  useEffect(() => {
    if (!isAuthenticated) {
      navigate({ to: '/login' })
    }
  }, [isAuthenticated, navigate])

  if (!isAuthenticated) return null

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
          value={currentCall ? t('dashboard.onCall') : t('dashboard.ready')}
          highlight={!!currentCall}
        />
        <StatusCard
          title={t('dashboard.callsToday')}
          value="-"
        />
      </div>

      {/* Current active call — full call handling UI */}
      {currentCall && keyPair && (
        <ActiveCallPanel
          call={currentCall}
          onHangup={() => hangupCall(currentCall.id)}
          onReportSpam={() => reportSpam(currentCall.id)}
          secretKey={keyPair.secretKey}
        />
      )}

      {/* Incoming calls (ringing) */}
      {ringingCalls.length > 0 && !currentCall && (
        <div className="rounded-lg border-2 border-green-600 bg-green-950/30 p-4">
          <h3 className="mb-3 text-lg font-medium text-green-300">{t('calls.incoming')}</h3>
          <div className="space-y-2">
            {ringingCalls.map(call => (
              <div key={call.id} className="flex items-center justify-between rounded-md bg-green-950/50 px-4 py-3">
                <div>
                  <p className="font-medium">{call.callerNumber || t('calls.unknown')}</p>
                  <p className="text-xs text-muted-foreground">{t('calls.incoming')}</p>
                </div>
                <button
                  onClick={() => answerCall(call.id)}
                  className="animate-pulse rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  {t('calls.answer')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All active calls list (admin view) */}
      {isAdmin && (
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-medium">{t('dashboard.activeCalls')}</h3>
          </div>
          {calls.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t('dashboard.noActiveCalls')}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {calls.map(call => (
                <div key={call.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{call.callerNumber || t('calls.unknown')}</p>
                    <p className="text-xs text-muted-foreground">
                      {call.status === 'ringing' ? t('calls.incoming') : t('calls.active')}
                      {call.answeredBy && ` — ${call.answeredBy.slice(0, 8)}...`}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs ${
                    call.status === 'ringing' ? 'text-yellow-400' : 'text-green-400'
                  }`}>
                    <span className={`h-2 w-2 rounded-full ${
                      call.status === 'ringing' ? 'animate-pulse bg-yellow-400' : 'animate-pulse bg-green-400'
                    }`} />
                    {call.status === 'ringing' ? t('calls.incoming') : t('calls.active')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActiveCallPanel({ call, onHangup, onReportSpam, secretKey }: {
  call: ActiveCall
  onHangup: () => void
  onReportSpam: () => void
  secretKey: Uint8Array
}) {
  const { t } = useTranslation()
  const { formatted } = useCallTimer(call.startedAt)
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSaveNote() {
    if (!noteText.trim()) return
    setSaving(true)
    try {
      const encrypted = encryptNote(noteText, secretKey)
      await createNote({ callId: call.id, encryptedContent: encrypted })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // handle error
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border-2 border-blue-600 bg-blue-950/30 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-blue-300">{t('calls.active')}</h3>
          <p className="text-sm">{call.callerNumber || t('calls.unknown')}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold text-blue-300">{formatted}</p>
          <p className="text-xs text-muted-foreground">{t('calls.duration')}</p>
        </div>
      </div>

      {/* Note-taking area */}
      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-medium">{t('notes.newNote')}</label>
        <textarea
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          placeholder={t('notes.notePlaceholder')}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={handleSaveNote}
            disabled={saving || !noteText.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
          {saved && <span className="text-xs text-green-400">{t('common.success')}</span>}
          <p className="ml-auto text-xs text-muted-foreground">{t('notes.encryptionNote')}</p>
        </div>
      </div>

      {/* Call actions */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={onHangup}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          {t('calls.hangUp')}
        </button>
        <button
          onClick={onReportSpam}
          className="rounded-md border border-yellow-600/50 px-4 py-2 text-sm text-yellow-400 hover:bg-yellow-900/20"
        >
          {t('calls.reportSpam')}
        </button>
      </div>
    </div>
  )
}

function StatusCard({ title, value, highlight }: { title: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-blue-600 bg-blue-950/20' : 'border-border'}`}>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}
