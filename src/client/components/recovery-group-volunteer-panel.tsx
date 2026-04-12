import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { authFacadeClient } from '@/lib/auth-facade-client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  hubId: string
}

export function RecoveryGroupVolunteerPanel({ hubId }: Props) {
  const { t } = useTranslation()
  const [identifier, setIdentifier] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleInitiate() {
    setLoading(true)
    setError(null)
    try {
      // Generate an ephemeral device pubkey for coordinator transport
      const ephemeralPubkey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const res = await authFacadeClient.recoveryGroupInitiate({
        hubId,
        userIdentifier: identifier,
        newDevicePubkey: ephemeralPubkey,
      })
      setSessionId(res.sessionId)
      setExpiresAt(res.expiresAt)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card data-testid="recovery-group-volunteer-panel">
      <CardHeader>
        <CardTitle>{t('recovery.volunteerPanel.title')}</CardTitle>
        <CardDescription>{t('recovery.volunteerPanel.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!sessionId ? (
          <>
            <Input
              data-testid="rg-identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t('recovery.volunteerPanel.identifierPlaceholder')}
            />
            <Button
              data-testid="rg-initiate"
              onClick={handleInitiate}
              disabled={loading || !identifier.trim()}
            >
              {loading
                ? t('recovery.volunteerPanel.initiating')
                : t('recovery.volunteerPanel.initiate')}
            </Button>
          </>
        ) : (
          <div data-testid="rg-session-info" className="space-y-2">
            <p className="text-sm">
              {t('recovery.volunteerPanel.sessionCreated')}: {sessionId}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('recovery.volunteerPanel.availableAfter')}:{' '}
              {expiresAt ? new Date(expiresAt).toLocaleString() : ''}
            </p>
          </div>
        )}
        {error && (
          <div data-testid="rg-volunteer-error" className="text-sm text-destructive">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
