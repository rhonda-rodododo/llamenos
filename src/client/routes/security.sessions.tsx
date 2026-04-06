import { LockdownModal } from '@/components/LockdownModal'
import { Button } from '@/components/ui/button'
import { SectionBody, SectionDescription } from '@/components/user-shell/section-layout'
import { useRevokeOtherSessions, useRevokeSession, useSessions } from '@/lib/queries/security'
import { createFileRoute } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/security/sessions')({
  component: SessionsPage,
})

function formatRelative(iso: string, t: TFunction): string {
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.round(ms / 1000)
  if (sec < 60) return t('time.justNow', 'just now')
  const min = Math.round(sec / 60)
  if (min < 60) return t('time.minutesAgo', { count: min, defaultValue: '{{count}} minute(s) ago' })
  const hr = Math.round(min / 60)
  if (hr < 24) return t('time.hoursAgo', { count: hr, defaultValue: '{{count}} hour(s) ago' })
  const day = Math.round(hr / 24)
  return t('time.daysAgo', { count: day, defaultValue: '{{count}} day(s) ago' })
}

function SessionsPage() {
  const { t } = useTranslation()
  const { data: sessions, isLoading } = useSessions()
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOtherSessions()
  const [lockdownOpen, setLockdownOpen] = useState(false)

  if (isLoading) return <div>{t('common.loading', 'Loading...')}</div>
  if (!sessions || sessions.length === 0) {
    return (
      <SectionBody data-testid="sessions-page">
        <SectionDescription>
          {t(
            'security.sessions.description',
            'Browsers and devices currently signed in to your account.'
          )}
        </SectionDescription>
        <div className="flex justify-end">
          <Button
            variant="destructive"
            onClick={() => setLockdownOpen(true)}
            data-testid="open-lockdown"
          >
            {t('security.sessions.lockdown', 'Emergency lockdown')}
          </Button>
        </div>
        <p className="text-sm">{t('security.sessions.none', 'No active sessions.')}</p>
        <LockdownModal open={lockdownOpen} onClose={() => setLockdownOpen(false)} />
      </SectionBody>
    )
  }

  const hasOthers = sessions.some((s) => !s.isCurrent)

  return (
    <SectionBody data-testid="sessions-page">
      <SectionDescription>
        {t(
          'security.sessions.description',
          'Browsers and devices currently signed in to your account.'
        )}
      </SectionDescription>
      <div className="flex justify-end gap-2">
        <Button
          variant="destructive"
          disabled={!hasOthers || revokeOthers.isPending}
          onClick={() => revokeOthers.mutate()}
          data-testid="revoke-all-others"
        >
          {t('security.sessions.signOutEverywhere', 'Sign out everywhere else')}
        </Button>
        <Button
          variant="destructive"
          onClick={() => setLockdownOpen(true)}
          data-testid="open-lockdown"
        >
          {t('security.sessions.lockdown', 'Emergency lockdown')}
        </Button>
      </div>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between p-3 border rounded"
            data-testid={`session-row-${s.id}`}
          >
            <div>
              <div className="font-medium">
                {s.meta?.userAgent ?? t('security.sessions.unknownBrowser', 'Unknown browser')}
                {s.isCurrent && (
                  <span className="ml-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                    {t('security.sessions.current', 'Current')}
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {s.meta?.city && s.meta?.country && s.meta.country !== 'unknown'
                  ? `${s.meta.city}, ${s.meta.country}`
                  : t('security.sessions.unknownLocation', 'Unknown location')}
                {' · '}
                {t('security.sessions.lastSeen', 'Last active')}: {formatRelative(s.lastSeenAt, t)}
              </div>
            </div>
            {!s.isCurrent && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => revoke.mutate(s.id)}
                disabled={revoke.isPending}
                data-testid={`revoke-${s.id}`}
              >
                {t('security.sessions.revoke', 'Revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <LockdownModal open={lockdownOpen} onClose={() => setLockdownOpen(false)} />
    </SectionBody>
  )
}
