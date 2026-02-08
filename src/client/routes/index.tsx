import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { useCalls, useCallTimer } from '@/lib/hooks'
import { createNote, addBan, getCallsTodayCount, getVolunteerPresence, listVolunteers, type ActiveCall, type VolunteerPresence, type Volunteer } from '@/lib/api'
import { onMessage } from '@/lib/ws'
import { encryptNote } from '@/lib/crypto'
import { useToast } from '@/lib/toast'
import {
  PhoneIncoming,
  PhoneCall,
  PhoneOff,
  Activity,
  Clock,
  BarChart3,
  Save,
  ShieldBan,
  Lock,
  AlertTriangle,
  Coffee,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { t } = useTranslation()
  const { isAuthenticated, isAdmin, keyPair, onBreak, toggleBreak } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const { calls, currentCall, answerCall, hangupCall, reportSpam, ringingCalls, activeCalls } = useCalls()
  const [callsToday, setCallsToday] = useState<number | null>(null)
  const [presence, setPresence] = useState<VolunteerPresence[]>([])
  const [volunteers, setVolunteers] = useState<Volunteer[]>([])

  useEffect(() => {
    if (!isAuthenticated) {
      navigate({ to: '/login' })
    }
  }, [isAuthenticated, navigate])

  // Fetch calls today count
  useEffect(() => {
    if (!isAuthenticated) return
    getCallsTodayCount().then(r => setCallsToday(r.count)).catch(() => {})
  }, [isAuthenticated, activeCalls.length])

  // Fetch volunteer presence (admin only)
  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return
    getVolunteerPresence().then(r => setPresence(r.volunteers)).catch(() => {})
    listVolunteers().then(r => setVolunteers(r.volunteers)).catch(() => {})
  }, [isAuthenticated, isAdmin])

  // Listen for real-time presence updates
  useEffect(() => {
    const unsub = onMessage('presence:update', (data) => {
      const { volunteers: vols } = data as { volunteers: VolunteerPresence[] }
      setPresence(vols)
    })
    return unsub
  }, [])

  if (!isAuthenticated) return null

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold sm:text-2xl">{t('dashboard.title')}</h1>

      {/* Status cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 py-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
              <Activity className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('dashboard.activeCalls')}</p>
              <p className="text-2xl font-bold">{activeCalls.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className={onBreak ? 'border-yellow-400/30 dark:border-yellow-600/30' : undefined}>
          <CardContent className="flex items-center gap-4 py-0">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              onBreak ? 'bg-yellow-500/10' : 'bg-blue-500/10'
            }`}>
              {onBreak ? <Coffee className="h-5 w-5 text-yellow-500" /> : <Clock className="h-5 w-5 text-blue-500" />}
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{t('dashboard.currentShift')}</p>
              <p className="text-lg font-bold sm:text-2xl">
                {currentCall ? t('dashboard.onCall') : onBreak ? t('dashboard.onBreak') : t('dashboard.ready')}
              </p>
            </div>
            {!currentCall && (
              <Button
                variant={onBreak ? 'default' : 'outline'}
                size="sm"
                onClick={async () => {
                  try {
                    await toggleBreak()
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
                className={onBreak ? 'bg-yellow-600 hover:bg-yellow-700' : ''}
              >
                <Coffee className="h-3.5 w-3.5" />
                {onBreak ? t('dashboard.endBreak') : t('dashboard.goOnBreak')}
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
              <BarChart3 className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('dashboard.callsToday')}</p>
              <p className="text-2xl font-bold">{callsToday ?? '-'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* On break notice */}
      {onBreak && !currentCall && (
        <Card className="border-yellow-400/40 bg-yellow-50 dark:border-yellow-600/40 dark:bg-yellow-950/10">
          <CardContent className="flex items-center gap-3 py-4">
            <Coffee className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
            <p className="text-sm text-yellow-700 dark:text-yellow-300">{t('dashboard.breakDescription')}</p>
          </CardContent>
        </Card>
      )}

      {/* Current active call */}
      {currentCall && keyPair && (
        <ActiveCallPanel
          call={currentCall}
          onHangup={() => hangupCall(currentCall.id)}
          onReportSpam={() => reportSpam(currentCall.id)}
          onBanNumber={async () => {
            if (!currentCall.callerNumber || currentCall.callerNumber === '[redacted]') return
            try {
              await addBan({ phone: currentCall.callerNumber, reason: 'Banned during active call' })
              toast(t('common.success'), 'success')
            } catch {
              toast(t('common.error'), 'error')
            }
          }}
          secretKey={keyPair.secretKey}
        />
      )}

      {/* Incoming calls (ringing) — hidden when on break */}
      {ringingCalls.length > 0 && !currentCall && !onBreak && (
        <Card className="border-green-500 bg-green-50 dark:border-green-600 dark:bg-green-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <PhoneIncoming className="h-5 w-5" />
              {t('calls.incoming')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ringingCalls.map(call => (
              <div key={call.id} className="flex items-center justify-between rounded-lg bg-green-100 px-4 py-3 dark:bg-green-950/30">
                <div>
                  <p className="font-medium">{call.callerNumber || t('calls.unknown')}</p>
                  <p className="text-xs text-muted-foreground">{t('calls.incoming')}</p>
                </div>
                <Button
                  onClick={() => answerCall(call.id)}
                  className="animate-pulse bg-green-600 hover:bg-green-700"
                >
                  <PhoneCall className="h-4 w-4" />
                  {t('calls.answer')}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* All active calls list (admin view) */}
      {/* Volunteer status grid (admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-muted-foreground" />
              {t('dashboard.volunteerStatus')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {presence.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t('dashboard.noVolunteersOnline')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {presence.map(vol => {
                  const volInfo = volunteers.find(v => v.pubkey === vol.pubkey)
                  return (
                    <div key={vol.pubkey} className="flex items-center gap-2 rounded-lg border border-border p-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        vol.status === 'on-call' ? 'bg-blue-500' : 'bg-green-500'
                      }`} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{volInfo?.name || vol.pubkey.slice(0, 8)}</p>
                        <p className="text-xs text-muted-foreground">
                          {vol.status === 'on-call' ? t('dashboard.onCall') : t('dashboard.available')}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              {t('dashboard.activeCalls')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {calls.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('dashboard.noActiveCalls')}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {calls.map(call => (
                  <div key={call.id} className="flex items-center justify-between px-4 py-3 sm:px-6">
                    <div>
                      <p className="text-sm font-medium">{call.callerNumber || t('calls.unknown')}</p>
                      <p className="text-xs text-muted-foreground">
                        {call.status === 'ringing' ? t('calls.incoming') : t('calls.active')}
                        {call.answeredBy && ` — ${call.answeredBy.slice(0, 8)}...`}
                      </p>
                    </div>
                    <Badge
                      variant={call.status === 'ringing' ? 'outline' : 'default'}
                      className={call.status === 'ringing'
                        ? 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400'
                        : 'bg-green-600'
                      }
                    >
                      <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                        call.status === 'ringing' ? 'bg-yellow-500 dark:bg-yellow-400' : 'bg-white'
                      }`} />
                      {call.status === 'ringing' ? t('calls.incoming') : t('calls.active')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ActiveCallPanel({ call, onHangup, onReportSpam, onBanNumber, secretKey }: {
  call: ActiveCall
  onHangup: () => void
  onReportSpam: () => void
  onBanNumber: () => void
  secretKey: Uint8Array
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
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
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-2 border-blue-500 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/20">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-600/20">
              <PhoneCall className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-blue-700 dark:text-blue-300">{t('calls.active')}</CardTitle>
              <p className="text-sm text-muted-foreground">{call.callerNumber || t('calls.unknown')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-bold text-blue-700 dark:text-blue-300">{formatted}</p>
            <p className="text-xs text-muted-foreground">{t('calls.duration')}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Note-taking area */}
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            {t('notes.newNote')}
          </label>
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder={t('notes.notePlaceholder')}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSaveNote}
              disabled={saving || !noteText.trim()}
              size="sm"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? t('common.loading') : t('common.save')}
            </Button>
            {saved && (
              <Badge variant="outline" className="border-green-500/50 text-green-700 dark:text-green-400">
                {t('common.success')}
              </Badge>
            )}
            <p className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              {t('notes.encryptionNote')}
            </p>
          </div>
        </div>

        {/* Call actions */}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="destructive" onClick={onHangup}>
            <PhoneOff className="h-4 w-4" />
            {t('calls.hangUp')}
          </Button>
          <Button
            variant="outline"
            onClick={onReportSpam}
            className="border-yellow-500/50 text-yellow-700 hover:bg-yellow-100 hover:text-yellow-800 dark:border-yellow-600/50 dark:text-yellow-400 dark:hover:bg-yellow-900/20 dark:hover:text-yellow-300"
          >
            <AlertTriangle className="h-4 w-4" />
            {t('calls.reportSpam')}
          </Button>
          <Button
            variant="outline"
            onClick={onBanNumber}
            className="border-red-500/50 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-600/50 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
          >
            <ShieldBan className="h-4 w-4" />
            {t('banList.addNumber')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
