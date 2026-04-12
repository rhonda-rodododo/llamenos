import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { authFacadeClient } from '@/lib/auth-facade-client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  sessionId: string
  onContributed?: () => void
}

export function RecoveryGroupShareContribution({ sessionId, onContributed }: Props) {
  const { t } = useTranslation()
  const [override, setOverride] = useState(false)
  const [justification, setJustification] = useState('')
  const [contributing, setContributing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contributed, setContributed] = useState(false)

  async function handleContribute() {
    setContributing(true)
    setError(null)
    try {
      // In full implementation, the share would be unwrapped from IDB cache
      // and HPKE-encrypted under the coordinator's ephemeral pubkey.
      const encryptedShare = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      await authFacadeClient.recoveryGroupContributeShare({
        sessionId,
        encryptedShare,
      })
      setContributed(true)
      onContributed?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setContributing(false)
    }
  }

  if (contributed) {
    return (
      <Card data-testid="share-contribution">
        <CardContent className="pt-6">
          <p className="text-sm text-green-600" data-testid="contribution-success">
            {t('recovery.shareContribution.success')}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-testid="share-contribution">
      <CardHeader>
        <CardTitle>{t('recovery.shareContribution.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          data-testid="contribute-share-button"
          onClick={handleContribute}
          disabled={contributing}
        >
          {contributing
            ? t('recovery.shareContribution.contributing')
            : t('recovery.shareContribution.contribute')}
        </Button>
        <div className="flex items-center gap-2">
          <Checkbox
            id="override-checkbox"
            data-testid="override-checkbox"
            checked={override}
            onCheckedChange={(v) => setOverride(!!v)}
          />
          <label htmlFor="override-checkbox" className="text-sm">
            {t('recovery.shareContribution.emergencyOverride')}
          </label>
        </div>
        {override && (
          <Input
            data-testid="override-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder={t('recovery.shareContribution.justificationPlaceholder')}
            minLength={16}
          />
        )}
        {error && (
          <div data-testid="contribution-error" className="text-sm text-destructive">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
