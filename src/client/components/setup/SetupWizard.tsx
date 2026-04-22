import type {
  ChannelType,
  SignalConfig,
  TelephonyProviderDraft,
  WhatsAppConfig,
} from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, KeyRound, SkipForward } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogoMark } from '@/components/logo-mark'
import { PinInput } from '@/components/pin-input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { completeSetup, getConfig, seedDemoData, setActiveHub, updateSetupState } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cryptoWorker } from '@/lib/crypto-worker-client'
import { createDebugLog } from '@/lib/debug-log'
import { getDeviceKeypair } from '@/lib/device-identity-store'
import * as keyManager from '@/lib/key-manager'
import { bootstrapMlsForNewHub } from '@/lib/mls/hub-bootstrap'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'
import { AdminBootstrap } from './AdminBootstrap'
import { StepChannels } from './StepChannels'
import { StepIdentity } from './StepIdentity'
import { StepInvite } from './StepInvite'
import { StepProviders } from './StepProviders'
import { StepSettings } from './StepSettings'
import { StepSummary } from './StepSummary'

const TOTAL_STEPS = 6

export interface SetupData {
  hotlineName: string
  organization: string
  language: string
  selectedChannels: ChannelType[]
  telephonyProvider: TelephonyProviderDraft | null
  whatsappConfig: Partial<WhatsAppConfig> | null
  signalConfig: Partial<SignalConfig> | null
  voiceSettings: { queueTimeout: number; voicemailEnabled: boolean; voicemailMaxDuration: number }
  messagingSettings: { autoResponse: string; inactivityTimeout: number; maxConcurrent: number }
  reportCategories: string[]
  providerValidated: boolean
  whatsappValidated: boolean
  signalValidated: boolean
}

const DEFAULT_SETUP_DATA: SetupData = {
  hotlineName: '',
  organization: '',
  language: 'en',
  selectedChannels: [],
  telephonyProvider: null,
  whatsappConfig: null,
  signalConfig: null,
  voiceSettings: { queueTimeout: 60, voicemailEnabled: true, voicemailMaxDuration: 120 },
  messagingSettings: { autoResponse: '', inactivityTimeout: 60, maxConcurrent: 3 },
  reportCategories: [],
  providerValidated: false,
  whatsappValidated: false,
  signalValidated: false,
}

export function SetupWizard({ needsBootstrap = false }: { needsBootstrap?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { unlockWithPin, isKeyUnlocked } = useAuth()
  const { toast } = useToast()
  const [bootstrapComplete, setBootstrapComplete] = useState(
    !needsBootstrap || sessionStorage.getItem('bootstrapComplete') === '1'
  )
  const [step, setStep] = useState(0)
  const [data, setData] = useState<SetupData>(DEFAULT_SETUP_DATA)
  const [saving, setSaving] = useState(false)
  const [pinValue, setPinValue] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)

  // Sync bootstrapComplete when needsBootstrap prop changes (e.g. after config fetch)
  useEffect(() => {
    if (needsBootstrap && sessionStorage.getItem('bootstrapComplete') !== '1') {
      setBootstrapComplete(false)
    }
  }, [needsBootstrap])

  // Focus step heading on step change
  useEffect(() => {
    // Short delay to let the new step render before focusing
    const timer = setTimeout(() => stepHeadingRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [])

  // Escape key goes back one step
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && step > 0) {
        e.preventDefault()
        setStep((s) => s - 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [step])

  // After hard refresh, key is locked but stored — need PIN to re-authenticate
  const needsPinUnlock = bootstrapComplete && !isKeyUnlocked && keyManager.hasStoredKey()

  async function handlePinUnlock(pin: string) {
    setPinLoading(true)
    setPinError('')
    try {
      const result = await unlockWithPin(pin)
      if (result.ok) return
      switch (result.reason) {
        case 'prf-unavailable':
          setPinError(
            t('lock.prfUnavailable', {
              defaultValue:
                'WebAuthn authenticator unavailable — reconnect your security key or use the recovery phrase.',
            })
          )
          break
        case 'idp-unavailable':
          setPinError(
            t('lock.idpUnavailable', {
              defaultValue: 'Your session expired. Sign in again and retry.',
            })
          )
          break
        case 'no-blob':
          setPinError(
            t('lock.noStoredKey', {
              defaultValue: 'No stored key on this device.',
            })
          )
          break
        default:
          setPinError(t('lock.wrongPin', { defaultValue: 'Wrong PIN' }))
      }
      setPinValue('')
    } catch {
      setPinError(t('lock.wrongPin', { defaultValue: 'Wrong PIN' }))
      setPinValue('')
    } finally {
      setPinLoading(false)
    }
  }

  const updateData = useCallback((patch: Partial<SetupData>) => {
    setData((prev) => ({ ...prev, ...patch }))
  }, [])

  const canProceed = useCallback(() => {
    switch (step) {
      case 0:
        return data.hotlineName.trim().length > 0
      case 1:
        return data.selectedChannels.length > 0
      default:
        return true
    }
  }, [step, data.hotlineName, data.selectedChannels])

  async function handleNext() {
    if (step === TOTAL_STEPS - 1) return
    setSaving(true)
    // Always advance the step — save is best-effort for persistence
    setStep((s) => s + 1)
    try {
      await updateSetupState({
        selectedChannels: data.selectedChannels,
        completedSteps: Array.from({ length: step + 1 }, (_, i) => String(i)),
      })
    } catch {
      toast(t('setup.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1)
  }

  function handleSkip() {
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1)
  }

  async function handleComplete({ demoMode }: { demoMode: boolean }) {
    setSaving(true)
    try {
      await completeSetup(demoMode)
      sessionStorage.removeItem('bootstrapComplete')

      // Re-fetch config to get the default hub ID (created during setup)
      // and bootstrap MLS for it. MLS bootstrap is required for note encryption
      // to work; the server-side hub creation in completeSetup does not trigger
      // MLS auto-bootstrap.
      try {
        const config = await getConfig()
        if (config.hubs?.length && cryptoWorker) {
          const hubId = config.defaultHubId || config.hubs[0].id
          await setActiveHub(hubId)
          const keypair = await getDeviceKeypair()
          if (keypair) {
            await bootstrapMlsForNewHub(hubId, cryptoWorker, keypair.deviceId)
          }
        }
      } catch (err) {
        // Non-fatal: MLS bootstrap failure shouldn't block setup completion
        createDebugLog('setup:mls-bootstrap')('MLS bootstrap failed after setup completion', err)
      }

      if (demoMode) {
        try {
          await seedDemoData()
          // Invalidate users and shifts caches so newly-created demo data
          // is immediately visible when navigating to those pages.
          void queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
          void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
        } catch {
          toast(
            t('setup.demoSeedFailed', { defaultValue: 'Sample data partially created' }),
            'error'
          )
        }
      }
      toast(t('setup.complete'), 'success')
      navigate({ to: '/' })
    } catch {
      toast(t('setup.completeFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const stepLabels = [
    t('setup.stepIdentity'),
    t('setup.stepChannels'),
    t('setup.stepProviders'),
    t('setup.stepSettings'),
    t('setup.stepInvite'),
    t('setup.stepSummary'),
  ]

  // Show bootstrap step if no admin exists
  if (!bootstrapComplete) {
    return (
      <Card className="w-full max-w-2xl">
        <div className="px-6 pt-6">
          <div className="flex items-center gap-2 mb-4">
            <LogoMark size="sm" />
            <h1 className="text-xl font-bold">
              {t('setup.bootstrap.title', { defaultValue: 'Create Admin Account' })}
            </h1>
          </div>
        </div>
        <div className="px-6 py-6">
          <AdminBootstrap onComplete={() => setBootstrapComplete(true)} />
        </div>
      </Card>
    )
  }

  // After hard refresh: key is stored but locked — prompt for PIN
  if (needsPinUnlock) {
    return (
      <Card className="w-full max-w-2xl">
        <div className="px-6 pt-6">
          <div className="flex items-center gap-2 mb-4">
            <LogoMark size="sm" />
            <h1 className="text-xl font-bold">{t('setup.title')}</h1>
          </div>
        </div>
        <div className="px-6 py-6">
          <div className="space-y-6">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-bold">
                {t('pin.unlockTitle', { defaultValue: 'Enter your PIN' })}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t('setup.pinRequired', { defaultValue: 'Enter your PIN to continue setup.' })}
              </p>
            </div>
            <PinInput
              length={6}
              value={pinValue}
              onChange={setPinValue}
              onComplete={handlePinUnlock}
              error={!!pinError}
              autoFocus
            />
            {pinError && (
              <p role="alert" className="text-center text-sm text-destructive">
                {pinError}
              </p>
            )}
            {pinLoading && (
              <p role="status" className="text-center text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            )}
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-2xl">
      {/* Header */}
      <div className="px-6 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <LogoMark size="sm" />
          <h1 className="text-xl font-bold">{t('setup.title')}</h1>
        </div>
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{stepLabels[step]}</span>
            <span>{t('setup.stepOf', { current: step + 1, total: TOTAL_STEPS })}</span>
          </div>
          <div
            className="flex gap-1"
            role="progressbar"
            aria-valuenow={step + 1}
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-label={t('setup.stepOf', { current: step + 1, total: TOTAL_STEPS })}
          >
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={`step-${i}`}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
          {/* Screen reader step announcement */}
          <div className="sr-only" aria-live="polite">
            {t('setup.stepOf', { current: step + 1, total: TOTAL_STEPS })}: {stepLabels[step]}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="px-6 py-6">
        {step === 0 && (
          <StepIdentity data={data} onChange={updateData} headingRef={stepHeadingRef} />
        )}
        {step === 1 && (
          <StepChannels data={data} onChange={updateData} headingRef={stepHeadingRef} />
        )}
        {step === 2 && (
          <StepProviders data={data} onChange={updateData} headingRef={stepHeadingRef} />
        )}
        {step === 3 && (
          <StepSettings data={data} onChange={updateData} headingRef={stepHeadingRef} />
        )}
        {step === 4 && <StepInvite headingRef={stepHeadingRef} />}
        {step === 5 && (
          <StepSummary
            data={data}
            onComplete={handleComplete}
            saving={saving}
            headingRef={stepHeadingRef}
          />
        )}
      </div>

      {/* Navigation */}
      {step < TOTAL_STEPS - 1 && (
        <div className="flex items-center justify-between border-t px-6 py-4">
          <Button variant="ghost" onClick={handleBack} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4" />
            {t('common.back')}
          </Button>
          <div className="flex gap-2">
            {step >= 2 && (
              <Button variant="ghost" size="sm" onClick={handleSkip}>
                <SkipForward className="h-4 w-4" />
                {t('setup.skip')}
              </Button>
            )}
            <Button onClick={handleNext} disabled={!canProceed() || saving}>
              {saving ? t('common.loading') : t('common.next')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
