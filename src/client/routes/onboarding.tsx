import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { validateInvite, redeemInvite } from '@/lib/api'
import { generateKeyPair } from '@/lib/crypto'
import { isValidPin, storeEncryptedKey } from '@/lib/key-store'
import { useToast } from '@/lib/toast'
import { setLanguage } from '@/lib/i18n'
import { LANGUAGES } from '@shared/languages'
import { PinInput } from '@/components/pin-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Phone, Globe, KeyRound, ShieldCheck, ArrowRight, ArrowLeft, Check, Copy, Download } from 'lucide-react'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
})

type Step = 'loading' | 'error' | 'welcome' | 'pin' | 'keypair' | 'backup' | 'done'

function OnboardingPage() {
  const { t, i18n } = useTranslation()
  const { signIn } = useAuth()
  const { hotlineName } = useConfig()
  const { toast } = useToast()
  const navigate = useNavigate()

  // Get invite code from URL
  const params = new URLSearchParams(window.location.search)
  const inviteCode = params.get('code') || ''

  const [step, setStep] = useState<Step>('loading')
  const [inviteData, setInviteData] = useState<{ name: string; role: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [uiLang, setUiLang] = useState(i18n.language || 'en')

  // PIN state
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinStep, setPinStep] = useState<'create' | 'confirm'>('create')
  const [pinError, setPinError] = useState('')

  // Keypair state
  const [nsec, setNsec] = useState('')
  const [npub, setNpub] = useState('')
  const [pubkey, setPubkey] = useState('')

  // Backup verification
  const [verifyChars, setVerifyChars] = useState<{ index: number; char: string }[]>([])
  const [verifyInputs, setVerifyInputs] = useState<string[]>([])
  const [backupVerified, setBackupVerified] = useState(false)

  // Validate invite on initial mount only (ref survives re-renders but not re-mounts)
  const validatingRef = useRef(false)
  useEffect(() => {
    // Skip if already validated or currently validating
    if (validatingRef.current || step !== 'loading') return
    validatingRef.current = true

    if (!inviteCode) {
      setStep('error')
      setErrorMsg(t('onboarding.noCode'))
      return
    }
    validateInvite(inviteCode).then(result => {
      if (result.valid) {
        setInviteData({ name: result.name!, role: result.role! })
        setStep('welcome')
      } else {
        setStep('error')
        setErrorMsg(
          result.error === 'expired' ? t('onboarding.expired') :
          result.error === 'already_used' ? t('onboarding.alreadyUsed') :
          t('onboarding.invalidCode')
        )
      }
    }).catch(() => {
      setStep('error')
      setErrorMsg(t('onboarding.invalidCode'))
    })
  }, [inviteCode])

  function handlePinComplete(enteredPin: string) {
    if (pinStep === 'create') {
      if (!isValidPin(enteredPin)) {
        setPinError(t('pin.tooShort'))
        return
      }
      setPin1(enteredPin)
      setPinStep('confirm')
      setPin2('')
      setPinError('')
    } else {
      if (enteredPin !== pin1) {
        setPinError(t('pin.mismatch'))
        setPin2('')
        return
      }
      // PIN confirmed, generate keypair
      generateKeypairAndRedeem(enteredPin)
    }
  }

  // Store confirmed PIN for use during completion
  const [confirmedPin, setConfirmedPin] = useState('')

  async function generateKeypairAndRedeem(pin: string) {
    setStep('keypair')
    try {
      const kp = generateKeyPair()
      setNsec(kp.nsec)
      setNpub(kp.npub)
      setPubkey(kp.publicKey)
      setConfirmedPin(pin)

      // Redeem invite on server
      await redeemInvite(inviteCode, kp.publicKey)

      // Set up backup verification (4 random chars from nsec)
      const nsecStr = kp.nsec
      const indices: number[] = []
      while (indices.length < 4) {
        const idx = Math.floor(Math.random() * (nsecStr.length - 5)) + 5 // Skip "nsec1" prefix
        if (!indices.includes(idx)) indices.push(idx)
      }
      indices.sort((a, b) => a - b)
      setVerifyChars(indices.map(i => ({ index: i, char: nsecStr[i] })))
      setVerifyInputs(Array(4).fill(''))
      setStep('backup')
    } catch (err) {
      setStep('error')
      setErrorMsg(err instanceof Error ? err.message : t('onboarding.redeemFailed'))
    }
  }

  function checkBackupVerification() {
    const correct = verifyChars.every((vc, i) => verifyInputs[i].toLowerCase() === vc.char.toLowerCase())
    if (correct) {
      setBackupVerified(true)
    } else {
      toast(t('onboarding.verifyFailed'), 'error')
    }
  }

  function downloadBackup() {
    const backup = JSON.stringify({
      version: 1,
      format: 'llamenos-key-backup',
      pubkey,
      nsec,
      createdAt: new Date().toISOString(),
    }, null, 2)
    const blob = new Blob([backup], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `llamenos-backup-${pubkey.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleComplete() {
    try {
      // Store encrypted key with PIN and sign in
      await storeEncryptedKey(nsec, confirmedPin, pubkey)
      await signIn(nsec)
      navigate({ to: '/profile-setup' })
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  if (step === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Phone className="h-5 w-5 animate-pulse" />
          {t('common.loading')}
        </div>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-destructive">{t('onboarding.errorTitle')}</CardTitle>
            <CardDescription>{errorMsg}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button variant="outline" onClick={() => navigate({ to: '/login' })}>
              {t('onboarding.goToLogin')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        {step === 'welcome' && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Phone className="h-7 w-7 text-primary" />
              </div>
              <CardTitle className="text-2xl">
                {t('onboarding.welcomeTitle', { name: hotlineName })}
              </CardTitle>
              <CardDescription>
                {t('onboarding.welcomeDescription', { volunteerName: inviteData?.name })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Language selection */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  {t('profile.uiLanguage')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => { setUiLang(lang.code); setLanguage(lang.code) }}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        uiLang === lang.code
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <span>{lang.flag}</span>
                      {lang.label}
                      {uiLang === lang.code && <Check className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={() => setStep('pin')} className="w-full" size="lg">
                {t('onboarding.getStarted')}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </>
        )}

        {step === 'pin' && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="h-7 w-7 text-primary" />
              </div>
              <CardTitle>
                {pinStep === 'create' ? t('pin.createTitle') : t('pin.confirmTitle')}
              </CardTitle>
              <CardDescription>
                {pinStep === 'create' ? t('pin.createDescription') : t('pin.confirmDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <PinInput
                length={6}
                value={pinStep === 'create' ? pin1 : pin2}
                onChange={pinStep === 'create' ? setPin1 : setPin2}
                onComplete={handlePinComplete}
                error={!!pinError}
                autoFocus
              />
              {pinError && (
                <p className="text-center text-sm text-destructive">{pinError}</p>
              )}
              {pinStep === 'confirm' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setPinStep('create'); setPin1(''); setPin2(''); setPinError('') }}
                  className="w-full"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('common.back')}
                </Button>
              )}
            </CardContent>
          </>
        )}

        {step === 'keypair' && (
          <CardContent className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-5 w-5 animate-pulse" />
              {t('onboarding.generatingKeys')}
            </div>
          </CardContent>
        )}

        {step === 'backup' && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="h-7 w-7 text-primary" />
              </div>
              <CardTitle>{t('onboarding.backupTitle')}</CardTitle>
              <CardDescription>{t('onboarding.backupDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Show nsec */}
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('onboarding.yourSecretKey')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">
                    {nsec}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => { navigator.clipboard.writeText(nsec); toast(t('common.success'), 'success'); setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000) }}
                    aria-label={t('a11y.copyToClipboard')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-destructive">{t('onboarding.secretKeyWarning')}</p>
              </div>

              {/* Download backup */}
              <Button variant="outline" onClick={downloadBackup} className="w-full">
                <Download className="h-4 w-4" />
                {t('onboarding.downloadBackup')}
              </Button>

              {/* Verification */}
              {!backupVerified && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">{t('onboarding.verifyTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('onboarding.verifyDescription')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    {verifyChars.map((vc, i) => (
                      <div key={vc.index} className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          {t('onboarding.charAtPosition', { position: vc.index + 1 })}
                        </label>
                        <input
                          type="text"
                          maxLength={1}
                          value={verifyInputs[i]}
                          onChange={e => {
                            const newInputs = [...verifyInputs]
                            newInputs[i] = e.target.value
                            setVerifyInputs(newInputs)
                          }}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-center font-mono text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={checkBackupVerification}
                    disabled={verifyInputs.some(v => !v)}
                    className="w-full"
                  >
                    {t('onboarding.verifyButton')}
                  </Button>
                </div>
              )}

              {backupVerified && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/20 dark:text-green-300">
                    <Check className="h-4 w-4" />
                    {t('onboarding.verifySuccess')}
                  </div>
                  <Button onClick={handleComplete} className="w-full" size="lg">
                    {t('onboarding.continue')}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}
