import { AdvancedReveal } from '@/components/admin-shell/advanced-reveal'
import {
  SectionActions,
  SectionBanner,
  SectionBody,
  SectionDescription,
  SectionField,
  SectionToggleField,
} from '@/components/admin-shell/section-layout'
import { PhoneInput } from '@/components/phone-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  type TelephonyProviderConfig,
  type TelephonyProviderType,
  getTelephonyProvider,
  testTelephonyProvider,
  updateTelephonyProvider,
} from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'
import { TELEPHONY_PROVIDER_LABELS, type TelephonyProviderDraft } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SLUG = 'phone-provider'

export function PhoneProviderSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.settings.provider(),
    queryFn: getTelephonyProvider,
  })

  const [draft, setDraft] = useState<TelephonyProviderDraft | null>(null)
  const [showSaved, setShowSaved] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  useEffect(() => {
    if (config && !draft) {
      setDraft(config as TelephonyProviderDraft)
    } else if (!config && !draft) {
      setDraft({ type: 'twilio' })
    }
  }, [config, draft])

  const saveMutation = useMutation({
    mutationFn: (next: TelephonyProviderDraft) =>
      updateTelephonyProvider(next as TelephonyProviderConfig),
    onSuccess: (saved) => {
      setDraft(saved as TelephonyProviderDraft)
      queryClient.setQueryData(queryKeys.settings.provider(), saved)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.provider() })
      toast(t('telephonyProvider.saved'), 'success')
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: (err) => toast(String(err), 'error'),
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('no draft')
      return testTelephonyProvider(draft as TelephonyProviderConfig)
    },
    onSuccess: (res) => setTestResult(res),
    onError: (err) => setTestResult({ ok: false, error: String(err) }),
  })

  if (isLoading || !draft) return null

  function updateDraft(patch: Partial<TelephonyProviderDraft>) {
    if (!draft) return
    setDraft({ ...draft, ...patch } as TelephonyProviderDraft)
  }

  return (
    <SectionBody>
      <SectionDescription>{t('telephonyProvider.description')}</SectionDescription>

      {config ? (
        <SectionBanner data-testid={`admin-${SLUG}-current-provider-banner`}>
          {t('telephonyProvider.currentProvider')}:{' '}
          <span className="font-medium text-foreground">
            {TELEPHONY_PROVIDER_LABELS[config.type]}
          </span>
        </SectionBanner>
      ) : (
        <SectionBanner data-testid={`admin-${SLUG}-env-fallback-banner`}>
          {t('telephonyProvider.envFallback')}
        </SectionBanner>
      )}

      <SectionField label={t('telephonyProvider.provider')} htmlFor={`${SLUG}-select`}>
        <Select
          value={draft.type || 'twilio'}
          onValueChange={(val) => {
            setDraft({ type: val as TelephonyProviderType })
            setTestResult(null)
          }}
        >
          <SelectTrigger id={`${SLUG}-select`} data-testid={`admin-${SLUG}-provider-select`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(TELEPHONY_PROVIDER_LABELS) as [TelephonyProviderType, string][]).map(
              ([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t(`telephonyProvider.providerDescriptions.${draft.type || 'twilio'}`)}
        </p>
      </SectionField>

      <SectionField
        label={t('telephonyProvider.phoneNumber')}
        htmlFor={`${SLUG}-phone`}
        help={t('telephonyProvider.phoneNumberHelp')}
      >
        <PhoneInput
          id={`${SLUG}-phone`}
          value={draft.phoneNumber || ''}
          onChange={(val) => updateDraft({ phoneNumber: val })}
        />
      </SectionField>

      <AdvancedReveal sectionSlug={SLUG}>
        {/* Twilio / SignalWire */}
        {(draft.type === 'twilio' || draft.type === 'signalwire') && (
          <>
            <SectionField label={t('telephonyProvider.accountSid')} htmlFor={`${SLUG}-account-sid`}>
              <Input
                id={`${SLUG}-account-sid`}
                data-testid={`admin-${SLUG}-account-sid-input`}
                value={draft.accountSid || ''}
                onChange={(e) => updateDraft({ accountSid: e.target.value })}
                placeholder="AC..."
              />
            </SectionField>
            <SectionField label={t('telephonyProvider.authToken')} htmlFor={`${SLUG}-auth-token`}>
              <Input
                id={`${SLUG}-auth-token`}
                data-testid={`admin-${SLUG}-auth-token-input`}
                type="password"
                value={draft.authToken || ''}
                onChange={(e) => updateDraft({ authToken: e.target.value })}
              />
            </SectionField>
            {draft.type === 'signalwire' && (
              <SectionField
                label={t('telephonyProvider.signalwireSpace')}
                htmlFor={`${SLUG}-signalwire-space`}
                help={t('telephonyProvider.signalwireSpaceHelp')}
              >
                <Input
                  id={`${SLUG}-signalwire-space`}
                  data-testid={`admin-${SLUG}-signalwire-space-input`}
                  value={draft.signalwireSpace || ''}
                  onChange={(e) => updateDraft({ signalwireSpace: e.target.value })}
                  placeholder="myspace"
                />
              </SectionField>
            )}
          </>
        )}

        {/* Vonage */}
        {draft.type === 'vonage' && (
          <>
            <SectionField label={t('telephonyProvider.apiKey')} htmlFor={`${SLUG}-api-key`}>
              <Input
                id={`${SLUG}-api-key`}
                data-testid={`admin-${SLUG}-api-key-input`}
                value={draft.apiKey || ''}
                onChange={(e) => updateDraft({ apiKey: e.target.value })}
              />
            </SectionField>
            <SectionField label={t('telephonyProvider.apiSecret')} htmlFor={`${SLUG}-api-secret`}>
              <Input
                id={`${SLUG}-api-secret`}
                data-testid={`admin-${SLUG}-api-secret-input`}
                type="password"
                value={draft.apiSecret || ''}
                onChange={(e) => updateDraft({ apiSecret: e.target.value })}
              />
            </SectionField>
            <SectionField
              label={t('telephonyProvider.applicationId')}
              htmlFor={`${SLUG}-application-id`}
            >
              <Input
                id={`${SLUG}-application-id`}
                data-testid={`admin-${SLUG}-application-id-input`}
                value={draft.applicationId || ''}
                onChange={(e) => updateDraft({ applicationId: e.target.value })}
              />
            </SectionField>
          </>
        )}

        {/* Plivo */}
        {draft.type === 'plivo' && (
          <>
            <SectionField label={t('telephonyProvider.authId')} htmlFor={`${SLUG}-auth-id`}>
              <Input
                id={`${SLUG}-auth-id`}
                data-testid={`admin-${SLUG}-auth-id-input`}
                value={draft.authId || ''}
                onChange={(e) => updateDraft({ authId: e.target.value })}
              />
            </SectionField>
            <SectionField
              label={t('telephonyProvider.authToken')}
              htmlFor={`${SLUG}-plivo-auth-token`}
            >
              <Input
                id={`${SLUG}-plivo-auth-token`}
                data-testid={`admin-${SLUG}-plivo-auth-token-input`}
                type="password"
                value={draft.authToken || ''}
                onChange={(e) => updateDraft({ authToken: e.target.value })}
              />
            </SectionField>
          </>
        )}

        {/* Asterisk */}
        {draft.type === 'asterisk' && (
          <>
            <SectionField
              label={t('telephonyProvider.ariUrl')}
              htmlFor={`${SLUG}-ari-url`}
              help={t('telephonyProvider.ariUrlHelp')}
            >
              <Input
                id={`${SLUG}-ari-url`}
                data-testid={`admin-${SLUG}-ari-url-input`}
                value={draft.ariUrl || ''}
                onChange={(e) => updateDraft({ ariUrl: e.target.value })}
                placeholder="https://asterisk.example.com:8089/ari"
              />
            </SectionField>
            <SectionField
              label={t('telephonyProvider.ariUsername')}
              htmlFor={`${SLUG}-ari-username`}
            >
              <Input
                id={`${SLUG}-ari-username`}
                data-testid={`admin-${SLUG}-ari-username-input`}
                value={draft.ariUsername || ''}
                onChange={(e) => updateDraft({ ariUsername: e.target.value })}
              />
            </SectionField>
            <SectionField
              label={t('telephonyProvider.ariPassword')}
              htmlFor={`${SLUG}-ari-password`}
            >
              <Input
                id={`${SLUG}-ari-password`}
                data-testid={`admin-${SLUG}-ari-password-input`}
                type="password"
                value={draft.ariPassword || ''}
                onChange={(e) => updateDraft({ ariPassword: e.target.value })}
              />
            </SectionField>
            <SectionField
              label={t('telephonyProvider.bridgeCallbackUrl')}
              htmlFor={`${SLUG}-bridge-callback-url`}
              help={t('telephonyProvider.bridgeCallbackUrlHelp')}
            >
              <Input
                id={`${SLUG}-bridge-callback-url`}
                data-testid={`admin-${SLUG}-bridge-callback-url-input`}
                value={draft.bridgeCallbackUrl || ''}
                onChange={(e) => updateDraft({ bridgeCallbackUrl: e.target.value })}
              />
            </SectionField>
          </>
        )}

        {/* WebRTC Config (not for Asterisk) */}
        {draft.type !== 'asterisk' && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <SectionToggleField
              label={t('telephonyProvider.webrtcConfig')}
              htmlFor={`${SLUG}-webrtc-enabled`}
              help={t('telephonyProvider.webrtcConfigHelp')}
            >
              <Switch
                id={`${SLUG}-webrtc-enabled`}
                data-testid={`admin-${SLUG}-webrtc-enabled-switch`}
                checked={draft.webrtcEnabled || false}
                onCheckedChange={(checked) => updateDraft({ webrtcEnabled: checked })}
              />
            </SectionToggleField>
            {draft.webrtcEnabled && (draft.type === 'twilio' || draft.type === 'signalwire') && (
              <>
                <SectionField
                  label={t('telephonyProvider.apiKeySid')}
                  htmlFor={`${SLUG}-api-key-sid`}
                  help={t('telephonyProvider.apiKeySidHelp')}
                >
                  <Input
                    id={`${SLUG}-api-key-sid`}
                    data-testid={`admin-${SLUG}-api-key-sid-input`}
                    value={draft.apiKeySid || ''}
                    onChange={(e) => updateDraft({ apiKeySid: e.target.value })}
                    placeholder="SK..."
                  />
                </SectionField>
                <SectionField
                  label={t('telephonyProvider.apiKeySecret')}
                  htmlFor={`${SLUG}-api-key-secret`}
                >
                  <Input
                    id={`${SLUG}-api-key-secret`}
                    data-testid={`admin-${SLUG}-api-key-secret-input`}
                    type="password"
                    value={draft.apiKeySecret || ''}
                    onChange={(e) => updateDraft({ apiKeySecret: e.target.value })}
                  />
                </SectionField>
                <SectionField
                  label={t('telephonyProvider.twimlAppSid')}
                  htmlFor={`${SLUG}-twiml-app-sid`}
                  help={t('telephonyProvider.twimlAppSidHelp')}
                >
                  <Input
                    id={`${SLUG}-twiml-app-sid`}
                    data-testid={`admin-${SLUG}-twiml-app-sid-input`}
                    value={draft.twimlAppSid || ''}
                    onChange={(e) => updateDraft({ twimlAppSid: e.target.value })}
                    placeholder="AP..."
                  />
                </SectionField>
              </>
            )}
          </div>
        )}
      </AdvancedReveal>

      {testResult && (
        <SectionBanner
          tone={testResult.ok ? 'info' : 'danger'}
          data-testid={`admin-${SLUG}-test-result`}
        >
          {testResult.ok
            ? t('telephonyProvider.testSuccess')
            : `${t('telephonyProvider.testFailed')}: ${testResult.error || ''}`}
        </SectionBanner>
      )}

      <SectionActions
        slug={SLUG}
        onSave={() => draft && saveMutation.mutate(draft)}
        saving={saveMutation.isPending}
        disabled={!draft.phoneNumber}
        showSaved={showSaved}
        saveLabel={t('telephonyProvider.saveProvider')}
        extraActions={
          <Button
            variant="outline"
            data-testid={`admin-${SLUG}-test-button`}
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {testMutation.isPending
              ? t('telephonyProvider.testing')
              : t('telephonyProvider.testConnection')}
          </Button>
        }
      />
    </SectionBody>
  )
}
