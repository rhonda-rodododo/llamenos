import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PinInput } from './pin-input'
import { Lock, AlertTriangle } from 'lucide-react'
import { useConfig } from '@/lib/config'

interface LockScreenProps {
  onUnlock: (pin: string) => Promise<boolean>
  onWipe: () => void
  maxAttempts: number
}

const COOLDOWN_THRESHOLDS = [
  { attempts: 3, cooldownMs: 30_000 },
  { attempts: 5, cooldownMs: 300_000 },
]

export function LockScreen({ onUnlock, onWipe, maxAttempts }: LockScreenProps) {
  const { t } = useTranslation()
  const { hotlineName } = useConfig()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const [cooldownDisplay, setCooldownDisplay] = useState('')

  // Cooldown timer display
  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownDisplay('')
      return
    }
    const interval = setInterval(() => {
      const remaining = cooldownUntil - Date.now()
      if (remaining <= 0) {
        setCooldownUntil(null)
        setCooldownDisplay('')
      } else {
        const seconds = Math.ceil(remaining / 1000)
        if (seconds >= 60) {
          setCooldownDisplay(`${Math.ceil(seconds / 60)}m`)
        } else {
          setCooldownDisplay(`${seconds}s`)
        }
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [cooldownUntil])

  async function handleComplete(enteredPin: string) {
    if (checking || cooldownUntil) return
    setChecking(true)
    setError(false)

    const success = await onUnlock(enteredPin)
    if (success) return // Component will unmount

    const newAttempts = failedAttempts + 1
    setFailedAttempts(newAttempts)
    setError(true)
    setPin('')
    setChecking(false)

    // Check for wipe threshold
    if (newAttempts >= maxAttempts) {
      onWipe()
      return
    }

    // Check for cooldown
    for (const { attempts, cooldownMs } of COOLDOWN_THRESHOLDS) {
      if (newAttempts === attempts) {
        setCooldownUntil(Date.now() + cooldownMs)
        break
      }
    }
  }

  const isCoolingDown = cooldownUntil !== null && cooldownUntil > Date.now()
  const remainingAttempts = maxAttempts - failedAttempts

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-8 w-8 text-primary" />
        </div>

        <div>
          <h2 className="text-xl font-bold">{hotlineName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('lock.enterPin')}</p>
        </div>

        <PinInput
          length={6}
          value={pin}
          onChange={setPin}
          onComplete={handleComplete}
          disabled={checking || isCoolingDown}
          error={error}
          autoFocus
        />

        {error && !isCoolingDown && (
          <p className="text-sm text-destructive">{t('lock.wrongPin')}</p>
        )}

        {isCoolingDown && (
          <div className="flex items-center justify-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {t('lock.cooldown', { time: cooldownDisplay })}
          </div>
        )}

        {failedAttempts > 0 && remainingAttempts <= 5 && !isCoolingDown && (
          <p className="text-xs text-muted-foreground">
            {t('lock.attemptsRemaining', { count: remainingAttempts })}
          </p>
        )}

        <p className="text-xs text-muted-foreground">{t('lock.forgotPin')}</p>
      </div>
    </div>
  )
}
