/**
 * Telephony provider setup wizard.
 *
 * Four-step modal flow:
 *   1. Provider selection + credential entry + validation (or OAuth)
 *   2. A2P brand/campaign registration (optional, US/Twilio only) — with skip
 *   3. Phone number selection (existing or search+provision)
 *   4. Webhook URLs — copy/auto-configure, then save
 */

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type TelephonyProviderConfig,
  type TelephonyProviderType,
  updateTelephonyProvider,
} from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import {
  useA2PStatus,
  useConfigureWebhooks,
  useListPhoneNumbers,
  useProvisionNumber,
  useSearchPhoneNumbers,
  useSkipA2P,
  useStartOAuth,
  useSubmitA2PBrand,
  useSubmitA2PCampaign,
  useValidateCredentials,
  useWebhookUrls,
} from '@/lib/queries/provider-setup'
import { useToast } from '@/lib/toast'
import { TELEPHONY_PROVIDER_LABELS, type TelephonyProviderDraft } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  Settings,
  SkipForward,
  XCircle,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = 'credentials' | 'a2p' | 'numbers' | 'webhooks'
const STEPS: WizardStep[] = ['credentials', 'a2p', 'numbers', 'webhooks']

interface WizardState {
  provider: TelephonyProviderType
  accountSid?: string
  authToken?: string
  signalwireSpace?: string
  apiKey?: string
  apiSecret?: string
  applicationId?: string
  authId?: string
  ariUrl?: string
  ariUsername?: string
  ariPassword?: string
  phoneNumber?: string
  validated: boolean
  a2pSkipped: boolean
  webhooksConfigured: boolean
}

const DEFAULT_STATE: WizardState = {
  provider: 'twilio',
  validated: false,
  a2pSkipped: false,
  webhooksConfigured: false,
}

interface ProviderSetupWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete?: () => void
}

// ---------------------------------------------------------------------------
// Helper: provider credential fields
// ---------------------------------------------------------------------------

const A2P_PROVIDERS: TelephonyProviderType[] = ['twilio']
const SUPPORTED_PROVIDERS: TelephonyProviderType[] = [
  'twilio',
  'signalwire',
  'vonage',
  'plivo',
  'asterisk',
]

function credentialsFor(state: WizardState) {
  return {
    provider: state.provider,
    accountSid: state.accountSid,
    authToken: state.authToken,
    signalwireSpace: state.signalwireSpace,
    apiKey: state.apiKey,
    apiSecret: state.apiSecret,
    applicationId: state.applicationId,
    authId: state.authId,
    ariUrl: state.ariUrl,
    ariUsername: state.ariUsername,
    ariPassword: state.ariPassword,
  }
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepDots({ step }: { step: WizardStep }) {
  const { t } = useTranslation()
  const labels: Record<WizardStep, string> = {
    credentials: t('providerWizard.steps.credentials'),
    a2p: t('providerWizard.steps.a2p'),
    numbers: t('providerWizard.steps.numbers'),
    webhooks: t('providerWizard.steps.webhooks'),
  }
  const current = STEPS.indexOf(step)
  return (
    <ol className="flex items-center gap-1.5 mb-6" aria-label={t('providerWizard.stepsLabel')}>
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full transition-colors ${
              i < current
                ? 'bg-primary'
                : i === current
                  ? 'bg-primary ring-2 ring-primary/30'
                  : 'bg-muted-foreground/30'
            }`}
            title={labels[s]}
          />
          {i < STEPS.length - 1 && (
            <div
              className={`h-px w-6 transition-colors ${i < current ? 'bg-primary' : 'bg-muted-foreground/20'}`}
            />
          )}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Step 1: Credentials
// ---------------------------------------------------------------------------

interface CredentialsStepProps {
  state: WizardState
  onChange: (patch: Partial<WizardState>) => void
  onNext: () => void
}

function CredentialsStep({ state, onChange, onNext }: CredentialsStepProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const validateMutation = useValidateCredentials()
  const startOAuthMutation = useStartOAuth()
  const [validationStatus, setValidationStatus] = useState<'idle' | 'ok' | 'error'>(
    state.validated ? 'ok' : 'idle'
  )
  const [validationError, setValidationError] = useState<string | null>(null)

  function update(patch: Partial<WizardState>) {
    onChange({ ...patch, validated: false })
    setValidationStatus('idle')
  }

  async function handleValidate() {
    setValidationStatus('idle')
    setValidationError(null)
    try {
      const result = await validateMutation.mutateAsync(credentialsFor(state))
      if (result.ok) {
        setValidationStatus('ok')
        onChange({ validated: true })
        toast(
          t('providerWizard.credentials.validSuccess', {
            provider: TELEPHONY_PROVIDER_LABELS[state.provider],
          }),
          'success'
        )
      } else {
        setValidationStatus('error')
        setValidationError(result.error ?? t('providerWizard.credentials.validFailed'))
        onChange({ validated: false })
      }
    } catch (err) {
      setValidationStatus('error')
      const msg = err instanceof Error ? err.message : t('providerWizard.credentials.validFailed')
      setValidationError(msg)
      onChange({ validated: false })
    }
  }

  async function handleOAuth() {
    try {
      const result = await startOAuthMutation.mutateAsync(state.provider as 'twilio' | 'telnyx')
      if (result.mode === 'oauth' && result.redirectUrl) {
        window.open(result.redirectUrl, '_blank', 'noopener,noreferrer')
        toast(t('providerWizard.credentials.oauthOpened'), 'info')
      } else {
        // Manual mode — fall through to credential validation
        await handleValidate()
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : t('providerWizard.credentials.validFailed'),
        'error'
      )
    }
  }

  const supportsOAuth = state.provider === 'twilio' || state.provider === 'telnyx'

  return (
    <div className="space-y-5">
      {/* Provider grid */}
      <div>
        <Label className="mb-2 block text-sm">{t('telephonyProvider.provider')}</Label>
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label={t('telephonyProvider.provider')}
        >
          {SUPPORTED_PROVIDERS.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={state.provider === type}
              data-testid={`provider-wizard-provider-${type}`}
              onClick={() => update({ provider: type })}
              className={`rounded-lg border p-2.5 text-center text-xs font-medium transition-all hover:border-primary/50 ${
                state.provider === type
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border'
              }`}
            >
              {TELEPHONY_PROVIDER_LABELS[type]}
              {state.provider === type && <Check className="mx-auto mt-1 h-3 w-3 text-primary" />}
            </button>
          ))}
        </div>
      </div>

      {/* Credential fields */}
      <div className="space-y-3">
        {(state.provider === 'twilio' || state.provider === 'signalwire') && (
          <>
            <div className="space-y-1">
              <Label htmlFor="wizard-account-sid">{t('telephonyProvider.accountSid')}</Label>
              <Input
                id="wizard-account-sid"
                data-testid="provider-wizard-account-sid"
                placeholder="AC..."
                value={state.accountSid ?? ''}
                onChange={(e) => update({ accountSid: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wizard-auth-token">{t('telephonyProvider.authToken')}</Label>
              <Input
                id="wizard-auth-token"
                data-testid="provider-wizard-auth-token"
                type="password"
                value={state.authToken ?? ''}
                onChange={(e) => update({ authToken: e.target.value })}
                autoComplete="off"
              />
            </div>
            {state.provider === 'signalwire' && (
              <div className="space-y-1">
                <Label htmlFor="wizard-signalwire-space">
                  {t('telephonyProvider.signalwireSpace')}
                </Label>
                <Input
                  id="wizard-signalwire-space"
                  data-testid="provider-wizard-signalwire-space"
                  placeholder="myspace"
                  value={state.signalwireSpace ?? ''}
                  onChange={(e) => update({ signalwireSpace: e.target.value })}
                />
              </div>
            )}
          </>
        )}
        {state.provider === 'vonage' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="wizard-api-key">{t('telephonyProvider.apiKey')}</Label>
              <Input
                id="wizard-api-key"
                data-testid="provider-wizard-api-key"
                value={state.apiKey ?? ''}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wizard-api-secret">{t('telephonyProvider.apiSecret')}</Label>
              <Input
                id="wizard-api-secret"
                data-testid="provider-wizard-api-secret"
                type="password"
                value={state.apiSecret ?? ''}
                onChange={(e) => update({ apiSecret: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wizard-application-id">{t('telephonyProvider.applicationId')}</Label>
              <Input
                id="wizard-application-id"
                data-testid="provider-wizard-application-id"
                value={state.applicationId ?? ''}
                onChange={(e) => update({ applicationId: e.target.value })}
              />
            </div>
          </>
        )}
        {state.provider === 'plivo' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="wizard-auth-id">{t('telephonyProvider.authId')}</Label>
              <Input
                id="wizard-auth-id"
                data-testid="provider-wizard-auth-id"
                value={state.authId ?? ''}
                onChange={(e) => update({ authId: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wizard-plivo-auth-token">{t('telephonyProvider.authToken')}</Label>
              <Input
                id="wizard-plivo-auth-token"
                data-testid="provider-wizard-plivo-auth-token"
                type="password"
                value={state.authToken ?? ''}
                onChange={(e) => update({ authToken: e.target.value })}
              />
            </div>
          </>
        )}
        {state.provider === 'asterisk' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="wizard-ari-url">{t('telephonyProvider.ariUrl')}</Label>
              <Input
                id="wizard-ari-url"
                data-testid="provider-wizard-ari-url"
                placeholder="https://asterisk.example.com:8089/ari"
                value={state.ariUrl ?? ''}
                onChange={(e) => update({ ariUrl: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="wizard-ari-username">{t('telephonyProvider.ariUsername')}</Label>
                <Input
                  id="wizard-ari-username"
                  data-testid="provider-wizard-ari-username"
                  value={state.ariUsername ?? ''}
                  onChange={(e) => update({ ariUsername: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wizard-ari-password">{t('telephonyProvider.ariPassword')}</Label>
                <Input
                  id="wizard-ari-password"
                  data-testid="provider-wizard-ari-password"
                  type="password"
                  value={state.ariPassword ?? ''}
                  onChange={(e) => update({ ariPassword: e.target.value })}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Validation status */}
      {validationStatus === 'ok' && (
        <div
          className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3"
          data-testid="provider-wizard-validation-ok"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          <p className="text-xs text-green-700 dark:text-green-400">
            {t('providerWizard.credentials.validSuccess', {
              provider: TELEPHONY_PROVIDER_LABELS[state.provider],
            })}
          </p>
        </div>
      )}
      {validationStatus === 'error' && validationError && (
        <div
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3"
          data-testid="provider-wizard-validation-error"
        >
          <XCircle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">{validationError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {supportsOAuth ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="provider-wizard-oauth-button"
            onClick={handleOAuth}
            disabled={startOAuthMutation.isPending || validateMutation.isPending}
          >
            {startOAuthMutation.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {t('providerWizard.credentials.connectOAuth', {
              provider: TELEPHONY_PROVIDER_LABELS[state.provider],
            })}
          </Button>
        ) : null}
        <Button
          variant={supportsOAuth ? 'ghost' : 'outline'}
          size="sm"
          data-testid="provider-wizard-validate-button"
          onClick={handleValidate}
          disabled={validateMutation.isPending || startOAuthMutation.isPending}
        >
          {validateMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {t('providerWizard.credentials.validate')}
        </Button>
        <div className="ml-auto">
          <Button
            data-testid="provider-wizard-next-credentials"
            onClick={onNext}
            disabled={!state.validated}
          >
            {t('common.next')}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2: A2P brand/campaign (Twilio US only)
// ---------------------------------------------------------------------------

interface A2PStepProps {
  state: WizardState
  onChange: (patch: Partial<WizardState>) => void
  onNext: () => void
  onBack: () => void
}

function A2PStep({ state, onChange, onNext, onBack }: A2PStepProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const skipMutation = useSkipA2P()
  const submitBrandMutation = useSubmitA2PBrand()
  const submitCampaignMutation = useSubmitA2PCampaign()
  const { data: a2pStatus } = useA2PStatus()

  // Brand form fields
  const [companyName, setCompanyName] = useState('')
  const [ein, setEin] = useState('')
  const [website, setWebsite] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [campaignDescription, setCampaignDescription] = useState('')
  const [brandSid, setBrandSid] = useState(a2pStatus?.brandSid ?? '')

  const isApproved = a2pStatus?.status === 'approved' || a2pStatus?.status === 'skipped'

  async function handleSkip() {
    try {
      await skipMutation.mutateAsync()
      onChange({ a2pSkipped: true })
      toast(t('providerWizard.a2p.skipped'), 'info')
      onNext()
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error')
    }
  }

  async function handleSubmitBrand() {
    try {
      const result = await submitBrandMutation.mutateAsync({
        companyName,
        ein,
        website,
        vertical: 'SOCIAL',
        address: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'US',
        contactEmail,
        contactPhone: '',
      })
      if (result.brandSid) setBrandSid(result.brandSid)
      toast(t('providerWizard.a2p.brandSubmitted'), 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error')
    }
  }

  async function handleSubmitCampaign() {
    if (!brandSid) return
    try {
      await submitCampaignMutation.mutateAsync({
        brandSid,
        description: campaignDescription,
        messageFlow: campaignDescription,
        useCaseCategories: ['CRISIS_SUPPORT'],
        sampleMessages: [t('providerWizard.a2p.sampleMessage')],
      })
      toast(t('providerWizard.a2p.campaignSubmitted'), 'success')
      onNext()
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error')
    }
  }

  // Only relevant for Twilio US
  if (!A2P_PROVIDERS.includes(state.provider)) {
    return (
      <div className="space-y-5">
        <div
          className="rounded-lg border border-muted bg-muted/30 p-4 text-sm text-muted-foreground"
          data-testid="provider-wizard-a2p-not-applicable"
        >
          {t('providerWizard.a2p.notApplicable', {
            provider: TELEPHONY_PROVIDER_LABELS[state.provider],
          })}
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack} data-testid="provider-wizard-a2p-back">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t('common.back')}
          </Button>
          <Button onClick={onNext} data-testid="provider-wizard-a2p-skip-next">
            {t('common.next')}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  if (isApproved) {
    return (
      <div className="space-y-5">
        <div
          className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3"
          data-testid="provider-wizard-a2p-approved"
        >
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <p className="text-sm text-green-700 dark:text-green-400">
            {t('providerWizard.a2p.approved')}
          </p>
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack} data-testid="provider-wizard-a2p-approved-back">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t('common.back')}
          </Button>
          <Button onClick={onNext} data-testid="provider-wizard-a2p-approved-next">
            {t('common.next')}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('providerWizard.a2p.description')}</p>

      {/* Brand section */}
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{t('providerWizard.a2p.brandTitle')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="wizard-a2p-company">{t('providerWizard.a2p.companyName')}</Label>
            <Input
              id="wizard-a2p-company"
              data-testid="provider-wizard-a2p-company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wizard-a2p-ein">{t('providerWizard.a2p.ein')}</Label>
            <Input
              id="wizard-a2p-ein"
              data-testid="provider-wizard-a2p-ein"
              placeholder="12-3456789"
              value={ein}
              onChange={(e) => setEin(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wizard-a2p-website">{t('providerWizard.a2p.website')}</Label>
            <Input
              id="wizard-a2p-website"
              data-testid="provider-wizard-a2p-website"
              placeholder="https://..."
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wizard-a2p-email">{t('providerWizard.a2p.contactEmail')}</Label>
            <Input
              id="wizard-a2p-email"
              data-testid="provider-wizard-a2p-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          data-testid="provider-wizard-a2p-submit-brand"
          onClick={handleSubmitBrand}
          disabled={submitBrandMutation.isPending || !companyName || !ein}
        >
          {submitBrandMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {brandSid ? t('providerWizard.a2p.brandResubmit') : t('providerWizard.a2p.brandSubmit')}
        </Button>
        {brandSid && (
          <p className="text-xs text-muted-foreground" data-testid="provider-wizard-a2p-brand-sid">
            {t('providerWizard.a2p.brandSid')}: <code>{brandSid}</code>
          </p>
        )}
      </div>

      {/* Campaign section */}
      {brandSid && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{t('providerWizard.a2p.campaignTitle')}</h3>
          <div className="space-y-1">
            <Label htmlFor="wizard-a2p-campaign-desc">
              {t('providerWizard.a2p.campaignDescription')}
            </Label>
            <Input
              id="wizard-a2p-campaign-desc"
              data-testid="provider-wizard-a2p-campaign-desc"
              value={campaignDescription}
              onChange={(e) => setCampaignDescription(e.target.value)}
              placeholder={t('providerWizard.a2p.campaignDescriptionPlaceholder')}
            />
          </div>
          <Button
            size="sm"
            data-testid="provider-wizard-a2p-submit-campaign"
            onClick={handleSubmitCampaign}
            disabled={submitCampaignMutation.isPending || !campaignDescription}
          >
            {submitCampaignMutation.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            {t('providerWizard.a2p.campaignSubmit')}
          </Button>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="provider-wizard-a2p-back">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('common.back')}
        </Button>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            data-testid="provider-wizard-a2p-skip"
            onClick={handleSkip}
            disabled={skipMutation.isPending}
          >
            {skipMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            <SkipForward className="mr-1.5 h-3.5 w-3.5" />
            {t('providerWizard.a2p.skip')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3: Phone number
// ---------------------------------------------------------------------------

interface NumbersStepProps {
  state: WizardState
  onChange: (patch: Partial<WizardState>) => void
  onNext: () => void
  onBack: () => void
}

type NumberTab = 'existing' | 'search' | 'manual'

function NumbersStep({ state, onChange, onNext, onBack }: NumbersStepProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [tab, setTab] = useState<NumberTab>('existing')
  const [searchCountry, setSearchCountry] = useState('US')
  const [searchAreaCode, setSearchAreaCode] = useState('')
  const [searchEnabled, setSearchEnabled] = useState(false)
  const [manualNumber, setManualNumber] = useState(state.phoneNumber ?? '')
  const [provisioning, setProvisioning] = useState<string | null>(null)

  const credentials = credentialsFor(state)

  const {
    data: ownedData,
    isLoading: ownedLoading,
    refetch: refetchOwned,
  } = useListPhoneNumbers(credentials)
  const { data: searchData, isLoading: searchLoading } = useSearchPhoneNumbers(
    credentials,
    { country: searchCountry, areaCode: searchAreaCode || undefined },
    searchEnabled
  )
  const provisionMutation = useProvisionNumber()

  async function handleProvision(phoneNumber: string) {
    setProvisioning(phoneNumber)
    try {
      const result = await provisionMutation.mutateAsync({ ...credentials, phoneNumber })
      if (result.ok) {
        onChange({ phoneNumber: result.phoneNumber || phoneNumber })
        toast(t('setup.phoneNumbers.provisioned'), 'success')
      } else {
        toast(result.error ?? t('setup.phoneNumbers.provisionFailed'), 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t('setup.phoneNumbers.provisionFailed'), 'error')
    } finally {
      setProvisioning(null)
    }
  }

  function handleSelectExisting(phoneNumber: string) {
    onChange({ phoneNumber })
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1" role="tablist">
        {(['existing', 'search', 'manual'] as NumberTab[]).map((t_) => (
          <button
            key={t_}
            type="button"
            role="tab"
            aria-selected={tab === t_}
            data-testid={`provider-wizard-numbers-tab-${t_}`}
            onClick={() => setTab(t_)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t_
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`providerWizard.numbers.tab.${t_}`)}
          </button>
        ))}
      </div>

      {/* Tab: Existing */}
      {tab === 'existing' && (
        <div className="space-y-2" role="tabpanel">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{t('setup.phoneNumbers.existing')}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              data-testid="provider-wizard-numbers-refresh"
              onClick={() => refetchOwned()}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              {t('setup.phoneNumbers.refresh')}
            </Button>
          </div>
          {ownedLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (ownedData?.numbers ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              {t('setup.phoneNumbers.noExisting')}
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {ownedData?.numbers.map((num) => (
                <button
                  key={num.phoneNumber}
                  type="button"
                  data-testid={`provider-wizard-existing-number-${num.phoneNumber}`}
                  onClick={() => handleSelectExisting(num.phoneNumber)}
                  className={`w-full flex items-center gap-3 rounded-lg border p-2.5 text-left text-sm transition-colors hover:bg-accent ${
                    state.phoneNumber === num.phoneNumber
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  }`}
                >
                  <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs">{num.phoneNumber}</p>
                    {num.friendlyName && (
                      <p className="text-xs text-muted-foreground truncate">{num.friendlyName}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {num.capabilities.voice && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        {t('setup.phoneNumbers.voice')}
                      </span>
                    )}
                    {num.capabilities.sms && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        {t('setup.phoneNumbers.sms')}
                      </span>
                    )}
                  </div>
                  {state.phoneNumber === num.phoneNumber && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Search */}
      {tab === 'search' && (
        <div className="space-y-3" role="tabpanel">
          <div className="flex gap-2">
            <div className="space-y-1 w-24">
              <Label htmlFor="wizard-search-country" className="text-xs">
                {t('setup.phoneNumbers.countryCode')}
              </Label>
              <Input
                id="wizard-search-country"
                data-testid="provider-wizard-search-country"
                value={searchCountry}
                onChange={(e) => setSearchCountry(e.target.value.toUpperCase())}
                maxLength={2}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1 flex-1">
              <Label htmlFor="wizard-search-area-code" className="text-xs">
                {t('setup.phoneNumbers.areaCode')}
              </Label>
              <Input
                id="wizard-search-area-code"
                data-testid="provider-wizard-search-area-code"
                value={searchAreaCode}
                onChange={(e) => setSearchAreaCode(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="self-end">
              <Button
                size="sm"
                data-testid="provider-wizard-search-numbers-button"
                onClick={() => setSearchEnabled(true)}
                className="h-8"
              >
                <Search className="h-3.5 w-3.5" />
                {t('setup.phoneNumbers.search')}
              </Button>
            </div>
          </div>
          {searchLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(searchData?.numbers ?? []).map((num) => (
                <div
                  key={num.phoneNumber}
                  className="flex items-center gap-3 rounded-lg border p-2.5"
                  data-testid={`provider-wizard-search-result-${num.phoneNumber}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{num.phoneNumber}</p>
                    {num.locality && (
                      <p className="text-xs text-muted-foreground">
                        {num.locality}, {num.region}
                      </p>
                    )}
                    {num.monthlyPrice && (
                      <p className="text-[10px] text-muted-foreground">{num.monthlyPrice}/mo</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    data-testid={`provider-wizard-provision-${num.phoneNumber}`}
                    onClick={() => handleProvision(num.phoneNumber)}
                    disabled={provisioning === num.phoneNumber}
                  >
                    {provisioning === num.phoneNumber ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      t('setup.phoneNumbers.provision')
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Manual */}
      {tab === 'manual' && (
        <div className="space-y-3" role="tabpanel">
          <div className="space-y-1">
            <Label htmlFor="wizard-manual-number">{t('telephonyProvider.phoneNumber')}</Label>
            <Input
              id="wizard-manual-number"
              data-testid="provider-wizard-manual-number"
              placeholder="+1..."
              value={manualNumber}
              onChange={(e) => setManualNumber(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('telephonyProvider.phoneNumberHelp')}
            </p>
          </div>
          <Button
            size="sm"
            data-testid="provider-wizard-manual-use-number"
            onClick={() => onChange({ phoneNumber: manualNumber })}
            disabled={!manualNumber}
          >
            {t('providerWizard.numbers.useNumber')}
          </Button>
        </div>
      )}

      {state.phoneNumber && (
        <div
          className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-2.5"
          data-testid="provider-wizard-selected-number"
        >
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <p className="text-xs text-green-700 dark:text-green-400">
            {t('providerWizard.numbers.selected')}: <strong>{state.phoneNumber}</strong>
          </p>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="provider-wizard-numbers-back">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('common.back')}
        </Button>
        <Button
          data-testid="provider-wizard-numbers-next"
          onClick={onNext}
          disabled={!state.phoneNumber}
        >
          {t('common.next')}
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4: Webhooks
// ---------------------------------------------------------------------------

interface WebhooksStepProps {
  state: WizardState
  onChange: (patch: Partial<WizardState>) => void
  onSave: () => void
  onBack: () => void
  saving: boolean
}

function WebhooksStep({ state, onChange, onSave, onBack, saving }: WebhooksStepProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { data: webhooks, isLoading: webhooksLoading } = useWebhookUrls()
  const configureWebhooksMutation = useConfigureWebhooks()
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  const webhookList = useMemo(() => {
    if (!webhooks) return []
    return [
      { label: t('setup.webhooks.voiceIncoming'), key: 'voice', url: webhooks.voice },
      { label: t('setup.webhooks.voiceStatus'), key: 'voiceStatus', url: webhooks.voiceStatus },
      { label: t('setup.webhooks.smsWebhook'), key: 'sms', url: webhooks.sms },
    ]
  }, [webhooks, t])

  function handleCopy(url: string) {
    navigator.clipboard.writeText(url)
    setCopiedUrl(url)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  function handleCopyAll() {
    if (!webhookList.length) return
    const text = webhookList.map((w) => `${w.label}: ${w.url}`).join('\n')
    navigator.clipboard.writeText(text)
    toast(t('setup.webhookCopied'), 'success')
  }

  async function handleAutoConfigure() {
    if (!state.phoneNumber) return
    try {
      const result = await configureWebhooksMutation.mutateAsync({
        ...credentialsFor(state),
        phoneNumber: state.phoneNumber,
      })
      if (result.ok) {
        onChange({ webhooksConfigured: true })
        toast(t('providerWizard.webhooks.autoConfigured'), 'success')
      } else {
        toast(result.error ?? t('providerWizard.webhooks.autoConfigFailed'), 'error')
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : t('providerWizard.webhooks.autoConfigFailed'),
        'error'
      )
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('setup.webhooks.description')}</p>

      {webhooksLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold">{t('setup.webhooks.title')}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              data-testid="provider-wizard-webhooks-copy-all"
              onClick={handleCopyAll}
            >
              <Copy className="mr-1 h-3 w-3" />
              {t('setup.webhooks.copyAll')}
            </Button>
          </div>
          {webhookList.map((w) => (
            <div
              key={w.key}
              className="flex items-center gap-2 rounded-md border bg-background p-2"
              data-testid={`provider-wizard-webhook-${w.key}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {w.label}
                </p>
                <code className="text-xs break-all">{w.url}</code>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                data-testid={`provider-wizard-webhook-copy-${w.key}`}
                onClick={() => handleCopy(w.url)}
              >
                {copiedUrl === w.url ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Auto-configure if supported */}
      <Button
        variant="outline"
        size="sm"
        data-testid="provider-wizard-webhooks-auto-configure"
        onClick={handleAutoConfigure}
        disabled={configureWebhooksMutation.isPending || !state.phoneNumber}
      >
        {configureWebhooksMutation.isPending ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Settings className="mr-1.5 h-3.5 w-3.5" />
        )}
        {t('providerWizard.webhooks.autoConfigure')}
      </Button>

      {state.webhooksConfigured && (
        <div
          className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-2.5"
          data-testid="provider-wizard-webhooks-configured"
        >
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <p className="text-xs text-green-700 dark:text-green-400">
            {t('providerWizard.webhooks.configured')}
          </p>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="provider-wizard-webhooks-back">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('common.back')}
        </Button>
        <Button
          data-testid="provider-wizard-save"
          onClick={onSave}
          disabled={saving || !state.phoneNumber}
        >
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {t('providerWizard.webhooks.saveAndFinish')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export function ProviderSetupWizard({ open, onOpenChange, onComplete }: ProviderSetupWizardProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<WizardStep>('credentials')
  const [state, setState] = useState<WizardState>(DEFAULT_STATE)
  const [saving, setSaving] = useState(false)

  function update(patch: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...patch }))
  }

  function next() {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  function back() {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  async function handleSave() {
    if (!state.phoneNumber) return
    setSaving(true)
    try {
      const config: TelephonyProviderDraft = {
        type: state.provider,
        phoneNumber: state.phoneNumber,
        accountSid: state.accountSid,
        authToken: state.authToken,
        signalwireSpace: state.signalwireSpace,
        apiKey: state.apiKey,
        apiSecret: state.apiSecret,
        applicationId: state.applicationId,
        authId: state.authId,
        ariUrl: state.ariUrl,
        ariUsername: state.ariUsername,
        ariPassword: state.ariPassword,
      }
      await updateTelephonyProvider(config as TelephonyProviderConfig)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.provider() })
      toast(t('telephonyProvider.saved'), 'success')
      onOpenChange(false)
      onComplete?.()
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const stepTitles: Record<WizardStep, string> = {
    credentials: t('providerWizard.steps.credentials'),
    a2p: t('providerWizard.steps.a2p'),
    numbers: t('providerWizard.steps.numbers'),
    webhooks: t('providerWizard.steps.webhooks'),
  }
  const stepDescriptions: Record<WizardStep, string> = {
    credentials: t('providerWizard.steps.credentialsDesc'),
    a2p: t('providerWizard.steps.a2pDesc'),
    numbers: t('providerWizard.steps.numbersDesc'),
    webhooks: t('providerWizard.steps.webhooksDesc'),
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!saving) onOpenChange(v)
      }}
    >
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        data-testid="provider-setup-wizard-dialog"
      >
        <DialogHeader>
          <DialogTitle data-testid="provider-setup-wizard-title">{stepTitles[step]}</DialogTitle>
          <DialogDescription>{stepDescriptions[step]}</DialogDescription>
        </DialogHeader>

        <StepDots step={step} />

        {step === 'credentials' && (
          <CredentialsStep state={state} onChange={update} onNext={next} />
        )}
        {step === 'a2p' && <A2PStep state={state} onChange={update} onNext={next} onBack={back} />}
        {step === 'numbers' && (
          <NumbersStep state={state} onChange={update} onNext={next} onBack={back} />
        )}
        {step === 'webhooks' && (
          <WebhooksStep
            state={state}
            onChange={update}
            onSave={handleSave}
            onBack={back}
            saving={saving}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
