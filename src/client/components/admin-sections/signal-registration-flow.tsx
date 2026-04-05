import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type SignalRegistrationStatus,
  getSignalRegistrationStatus,
  startSignalRegistration,
  verifySignalRegistration,
} from '@/lib/api'
import { useToast } from '@/lib/toast'
import { CheckCircle2, Clock, Loader2, Phone, Shield, XCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SignalRegistrationFlowProps {
  isConfigured: boolean
  onRegistrationComplete: () => void
}

type FlowState = 'idle' | 'form' | 'waiting-sms' | 'voice-entry' | 'complete' | 'failed'

export function SignalRegistrationFlow({
  isConfigured,
  onRegistrationComplete,
}: SignalRegistrationFlowProps) {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [flowState, setFlowState] = useState<FlowState>(isConfigured ? 'complete' : 'idle')
  const [bridgeUrl, setBridgeUrl] = useState('')
  const [registeredNumber, setRegisteredNumber] = useState('')
  const [useVoice, setUseVoice] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<number>(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return
    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setTimeRemaining(remaining)
      if (remaining <= 0) {
        setFlowState('failed')
        setErrorMessage(t('signalRegistration.expired'))
        if (pollRef.current) clearInterval(pollRef.current)
        if (timerRef.current) clearInterval(timerRef.current)
      }
    }
    updateTimer()
    timerRef.current = setInterval(updateTimer, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [expiresAt, t])

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const status: SignalRegistrationStatus = await getSignalRegistrationStatus()
        if (status.status === 'complete') {
          setFlowState('complete')
          if (pollRef.current) clearInterval(pollRef.current)
          onRegistrationComplete()
        } else if (status.status === 'failed') {
          setFlowState('failed')
          setErrorMessage(status.error || t('signalRegistration.verificationFailed'))
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // Polling error — continue trying
      }
    }, 3000)
  }, [onRegistrationComplete, t])

  // Check initial status on mount
  useEffect(() => {
    if (isConfigured) return
    let cancelled = false
    getSignalRegistrationStatus()
      .then((status) => {
        if (cancelled) return
        if (status.status === 'pending') {
          setExpiresAt(status.expiresAt || null)
          if (status.method === 'sms') {
            setFlowState('waiting-sms')
            startPolling()
          } else {
            setFlowState('voice-entry')
          }
        } else if (status.status === 'complete') {
          setFlowState('complete')
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isConfigured, startPolling])

  async function handleRegister() {
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const result = await startSignalRegistration({
        bridgeUrl,
        registeredNumber,
        useVoice,
      })
      setExpiresAt(new Date(Date.now() + 10 * 60 * 1000).toISOString())
      if (result.method === 'sms') {
        setFlowState('waiting-sms')
        startPolling()
      } else {
        setFlowState('voice-entry')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('409')) {
        setErrorMessage(t('signalRegistration.alreadyInProgress'))
      } else {
        setErrorMessage(msg)
      }
      toast(t('common.error'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerify() {
    setVerifying(true)
    setErrorMessage(null)
    try {
      await verifySignalRegistration(verificationCode)
      setFlowState('complete')
      onRegistrationComplete()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
    } finally {
      setVerifying(false)
    }
  }

  function handleReset() {
    setFlowState('form')
    setErrorMessage(null)
    setVerificationCode('')
    setExpiresAt(null)
    if (pollRef.current) clearInterval(pollRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Complete state — Signal is configured
  if (flowState === 'complete') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="text-sm font-medium text-green-700 dark:text-green-400">
            {t('signalRegistration.connected')}
          </span>
        </div>

        {/* Security disclosures */}
        <div className="space-y-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
              {t('signal.security.transportLabel')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('signal.security.bridgeDecryptionNotice')}
          </p>
        </div>
      </div>
    )
  }

  // Idle state — show button to start
  if (flowState === 'idle') {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          {t('signalRegistration.notConfigured')}
        </p>
        <Button variant="outline" size="sm" onClick={() => setFlowState('form')}>
          <Phone className="mr-1.5 h-3.5 w-3.5" />
          {t('signalRegistration.startRegistration')}
        </Button>
      </div>
    )
  }

  // Form state
  if (flowState === 'form') {
    return (
      <div className="space-y-4 rounded-lg border p-4">
        <h4 className="text-sm font-semibold">{t('signalRegistration.title')}</h4>
        <p className="text-xs text-muted-foreground">{t('signalRegistration.description')}</p>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="signal-reg-bridge-url">{t('signalRegistration.bridgeUrl')}</Label>
            <Input
              id="signal-reg-bridge-url"
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
              placeholder="https://signal-bridge.internal:8080"
              data-testid="signal-reg-bridge-url"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="signal-reg-number">{t('signalRegistration.registeredNumber')}</Label>
            <Input
              id="signal-reg-number"
              value={registeredNumber}
              onChange={(e) => setRegisteredNumber(e.target.value)}
              placeholder="+12125551234"
              data-testid="signal-reg-number"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="signal-reg-voice"
              checked={useVoice}
              onCheckedChange={(checked) => setUseVoice(checked === true)}
              data-testid="signal-reg-voice"
            />
            <Label htmlFor="signal-reg-voice" className="text-sm">
              {t('signalRegistration.useVoice')}
            </Label>
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-xs text-destructive">{errorMessage}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleRegister}
            disabled={submitting || !bridgeUrl || !registeredNumber}
            data-testid="signal-reg-submit"
          >
            {submitting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Phone className="mr-1.5 h-3.5 w-3.5" />
            )}
            {submitting ? t('common.loading') : t('signalRegistration.registerButton')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setFlowState('idle')}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  // Waiting for SMS state
  if (flowState === 'waiting-sms') {
    return (
      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">{t('signalRegistration.waitingSms')}</p>
            <p className="text-xs text-muted-foreground">
              {t('signalRegistration.waitingSmsDescription')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <Badge variant="outline">{formatTime(timeRemaining)}</Badge>
        </div>
      </div>
    )
  }

  // Voice entry state
  if (flowState === 'voice-entry') {
    return (
      <div className="space-y-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">{t('signalRegistration.voiceVerification')}</p>
          <p className="text-xs text-muted-foreground">
            {t('signalRegistration.voiceDescription')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <Badge variant="outline">{formatTime(timeRemaining)}</Badge>
        </div>

        <div className="space-y-1">
          <Label htmlFor="signal-verify-code">{t('signalRegistration.verificationCode')}</Label>
          <Input
            id="signal-verify-code"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            maxLength={6}
            data-testid="signal-verify-code"
          />
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-xs text-destructive">{errorMessage}</p>
          </div>
        )}

        <Button
          onClick={handleVerify}
          disabled={verifying || verificationCode.length !== 6}
          data-testid="signal-verify-submit"
        >
          {verifying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {verifying ? t('common.loading') : t('common.submit')}
        </Button>
      </div>
    )
  }

  // Failed state
  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
      <div className="flex items-center gap-2">
        <XCircle className="h-5 w-5 text-destructive" />
        <p className="text-sm font-medium text-destructive">
          {t('signalRegistration.registrationFailed')}
        </p>
      </div>
      {errorMessage && <p className="text-xs text-muted-foreground">{errorMessage}</p>}
      <Button variant="outline" size="sm" onClick={handleReset}>
        {t('signalRegistration.tryAgain')}
      </Button>
    </div>
  )
}
