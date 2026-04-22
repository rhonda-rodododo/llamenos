import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PinInput } from '@/components/pin-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const MAX_ATTEMPTS = 3

type PinChallengeErrorState = null | 'wrong-pin' | 'prf-unavailable' | 'idp-unavailable'

interface PinChallengeDialogProps {
  open: boolean
  attempts: number
  error: PinChallengeErrorState
  onComplete: (pin: string) => Promise<void>
  onCancel: () => void
}

export function PinChallengeDialog({
  open,
  attempts,
  error,
  onComplete,
  onCancel,
}: PinChallengeDialogProps) {
  const { t } = useTranslation()
  const [pin, setPin] = useState('')
  const [verifying, setVerifying] = useState(false)

  // Reset PIN when dialog opens or after failed attempt
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempts triggers reset after each failed PIN attempt
  useEffect(() => {
    if (open) {
      setPin('')
      setVerifying(false)
    }
  }, [open, attempts])

  async function handlePinComplete(value: string) {
    setVerifying(true)
    await onComplete(value)
    setVerifying(false)
  }

  const remainingAttempts = MAX_ATTEMPTS - attempts

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} data-testid="pin-challenge-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <DialogTitle>{t('pinChallenge.title')}</DialogTitle>
          </div>
          <DialogDescription>{t('pinChallenge.description')}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <PinInput
            length={6}
            value={pin}
            onChange={setPin}
            onComplete={handlePinComplete}
            disabled={verifying}
            error={error !== null}
            autoFocus
          />

          {error && (
            <p
              className="mt-3 text-center text-sm text-destructive"
              data-testid="pin-challenge-error"
              data-error-kind={error}
            >
              {error === 'wrong-pin'
                ? t('pinChallenge.wrongPin', { remaining: remainingAttempts })
                : error === 'prf-unavailable'
                  ? t('lock.prfUnavailable', {
                      defaultValue:
                        'WebAuthn authenticator unavailable — reconnect your security key or use the recovery phrase.',
                    })
                  : t('lock.idpUnavailable', {
                      defaultValue: 'Your session expired. Sign in again and retry.',
                    })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={verifying}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
