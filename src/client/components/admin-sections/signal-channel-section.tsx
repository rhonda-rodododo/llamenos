import { SignalRegistrationFlow } from '@/components/admin-settings/signal-registration-flow'
import { AdvancedReveal } from '@/components/admin-shell/advanced-reveal'
import {
  SectionActions,
  SectionBanner,
  SectionBody,
  SectionDescription,
  SectionField,
} from '@/components/admin-shell/section-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  type MessagingConfig,
  getMessagingConfig,
  testMessagingChannel,
  updateMessagingConfig,
} from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Copy, Loader2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SLUG = 'signal'

export function SignalChannelSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.settings.messaging(),
    queryFn: getMessagingConfig,
  })

  const [draft, setDraft] = useState<MessagingConfig['signal'] | null>(null)
  const [showSaved, setShowSaved] = useState(false)
  const [testResult, setTestResult] = useState<boolean | null>(null)

  useEffect(() => {
    if (config && !draft) {
      setDraft(
        config.signal || {
          bridgeUrl: '',
          bridgeApiKey: '',
          webhookSecret: '',
          registeredNumber: '',
          autoResponse: '',
        }
      )
    }
  }, [config, draft])

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!config || !draft) throw new Error('no config')
      return updateMessagingConfig({
        ...config,
        enabledChannels: config.enabledChannels.includes('signal')
          ? config.enabledChannels
          : [...config.enabledChannels, 'signal'],
        signal: draft,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.messaging() })
      toast(t('common.success'), 'success')
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  const testMutation = useMutation({
    mutationFn: () => testMessagingChannel('signal'),
    onSuccess: (res) => setTestResult(res.connected),
    onError: () => setTestResult(false),
  })

  const handleRegistrationComplete = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.messaging() })
  }, [queryClient])

  if (isLoading || !draft) return null

  const webhookUrl = `${window.location.origin}/api/messaging/signal/webhook`
  const isSignalConfigured = !!draft.registeredNumber && !!draft.bridgeUrl

  function updateSignal(patch: Partial<NonNullable<MessagingConfig['signal']>>) {
    if (!draft) return
    setDraft({ ...draft, ...patch })
  }

  return (
    <SectionBody>
      <SectionDescription>
        {t('signal.description', {
          defaultValue: 'End-to-end encrypted messaging via Signal bridge.',
        })}
      </SectionDescription>

      <SectionBanner data-testid={`admin-${SLUG}-e2ee-banner`}>
        {t('signal.e2eeNote', {
          defaultValue:
            "Signal provides end-to-end encryption to the bridge. Messages are re-encrypted with your hotline's keys before storage.",
        })}
      </SectionBanner>

      <SignalRegistrationFlow
        isConfigured={isSignalConfigured}
        onRegistrationComplete={handleRegistrationComplete}
      />

      <SectionField
        label={t('signal.bridgeUrl', { defaultValue: 'Bridge URL' })}
        htmlFor={`${SLUG}-bridge-url`}
      >
        <Input
          id={`${SLUG}-bridge-url`}
          data-testid={`admin-${SLUG}-bridge-url-input`}
          value={draft.bridgeUrl}
          onChange={(e) => updateSignal({ bridgeUrl: e.target.value })}
          placeholder="https://signal-bridge.internal:8080"
        />
      </SectionField>

      <SectionField
        label={t('signal.registeredNumber', { defaultValue: 'Registered Number' })}
        htmlFor={`${SLUG}-registered-number`}
      >
        <Input
          id={`${SLUG}-registered-number`}
          data-testid={`admin-${SLUG}-registered-number-input`}
          value={draft.registeredNumber}
          onChange={(e) => updateSignal({ registeredNumber: e.target.value })}
          placeholder="+12125551234"
        />
      </SectionField>

      <SectionField
        label={t('signal.autoResponse', { defaultValue: 'Auto-Response' })}
        htmlFor={`${SLUG}-auto-response`}
      >
        <Input
          id={`${SLUG}-auto-response`}
          data-testid={`admin-${SLUG}-auto-response-input`}
          value={draft.autoResponse || ''}
          onChange={(e) => updateSignal({ autoResponse: e.target.value })}
          placeholder={t('setup.autoResponsePlaceholder')}
        />
      </SectionField>

      <AdvancedReveal sectionSlug={SLUG}>
        <SectionField
          label={t('signal.bridgeApiKey', { defaultValue: 'Bridge API Key' })}
          htmlFor={`${SLUG}-api-key`}
        >
          <Input
            id={`${SLUG}-api-key`}
            data-testid={`admin-${SLUG}-api-key-input`}
            type="password"
            value={draft.bridgeApiKey}
            onChange={(e) => updateSignal({ bridgeApiKey: e.target.value })}
          />
        </SectionField>

        <SectionField label={t('signal.webhookUrl', { defaultValue: 'Webhook URL' })}>
          <div className="flex items-center gap-2">
            <code
              data-testid={`admin-${SLUG}-webhook-url-code`}
              className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs"
            >
              {webhookUrl}
            </code>
            <Button
              variant="outline"
              size="icon"
              data-testid={`admin-${SLUG}-webhook-url-copy`}
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl)
                toast(t('common.success'), 'success')
              }}
              aria-label={t('a11y.copyToClipboard')}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SectionField>

        <SectionField
          label={t('signal.webhookSecret', { defaultValue: 'Webhook Secret' })}
          htmlFor={`${SLUG}-webhook-secret`}
        >
          <Input
            id={`${SLUG}-webhook-secret`}
            data-testid={`admin-${SLUG}-webhook-secret-input`}
            type="password"
            value={draft.webhookSecret || ''}
            onChange={(e) => updateSignal({ webhookSecret: e.target.value })}
          />
        </SectionField>
      </AdvancedReveal>

      <SectionActions
        slug={SLUG}
        onSave={() => saveMutation.mutate()}
        saving={saveMutation.isPending}
        disabled={!draft.bridgeUrl}
        showSaved={showSaved}
        extraActions={
          <>
            <Button
              variant="outline"
              data-testid={`admin-${SLUG}-test-button`}
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !draft.bridgeUrl}
            >
              {testMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('telephonyProvider.testing')}
                </>
              ) : (
                t('telephonyProvider.testConnection')
              )}
            </Button>
            {testResult !== null && (
              <Badge
                variant="outline"
                data-testid={`admin-${SLUG}-test-result`}
                className={testResult ? 'text-green-600' : 'text-red-600'}
              >
                {testResult ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" /> {t('telephonyProvider.testSuccess')}
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3" /> {t('telephonyProvider.testFailed')}
                  </>
                )}
              </Badge>
            )}
          </>
        }
      />
    </SectionBody>
  )
}
