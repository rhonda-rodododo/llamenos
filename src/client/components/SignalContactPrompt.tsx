import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerSignalContact } from '@/lib/signal-contact-registration'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function SignalContactPrompt({
  userPubkey,
  onDone,
}: {
  userPubkey: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [identifierType, setIdentifierType] = useState<'phone' | 'username'>('phone')
  const [plaintext, setPlaintext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await registerSignalContact({
        plaintextIdentifier: plaintext,
        identifierType,
        userPubkey,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="signal-contact-prompt">
      <p className="text-sm text-muted-foreground">
        {t(
          'onboarding.signal.description',
          'We send security notifications to your Signal account only. Enter your Signal phone number or username.'
        )}
      </p>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="radio"
            id="type-phone"
            checked={identifierType === 'phone'}
            onChange={() => setIdentifierType('phone')}
            className="h-4 w-4 accent-primary"
          />
          <Label htmlFor="type-phone">{t('onboarding.signal.phone', 'Phone number')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="radio"
            id="type-username"
            checked={identifierType === 'username'}
            onChange={() => setIdentifierType('username')}
            className="h-4 w-4 accent-primary"
          />
          <Label htmlFor="type-username">
            {t('onboarding.signal.username', 'Signal username')}
          </Label>
        </div>
      </div>
      <Input
        value={plaintext}
        onChange={(e) => setPlaintext(e.target.value)}
        placeholder={identifierType === 'phone' ? '+15551234567' : '@handle.01'}
        data-testid="signal-identifier-input"
      />
      {error && (
        <div className="text-sm text-red-600" data-testid="signal-error">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={submitting || !plaintext} data-testid="signal-submit">
          {submitting ? t('common.saving', 'Saving…') : t('onboarding.signal.save', 'Save')}
        </Button>
        <Button variant="ghost" onClick={onDone} data-testid="signal-skip">
          {t('onboarding.signal.skip', 'Skip for now')}
        </Button>
      </div>
    </div>
  )
}
