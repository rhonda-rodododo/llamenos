import { AdvancedReveal } from '@/components/admin-shell/advanced-reveal'
import {
  SectionActions,
  SectionBody,
  SectionDescription,
  SectionField,
  SectionToggleField,
} from '@/components/admin-shell/section-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SLUG = 'rcs'

export function RcsChannelSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.settings.messaging(),
    queryFn: getMessagingConfig,
  })

  const [draft, setDraft] = useState<MessagingConfig['rcs'] | null>(null)
  const [showSaved, setShowSaved] = useState(false)
  const [testResult, setTestResult] = useState<boolean | null>(null)

  useEffect(() => {
    if (config && !draft) {
      setDraft(
        config.rcs || {
          agentId: '',
          serviceAccountKey: '',
          webhookSecret: '',
          fallbackToSms: true,
          autoResponse: '',
          afterHoursResponse: '',
        }
      )
    }
  }, [config, draft])

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!config || !draft) throw new Error('no config')
      return updateMessagingConfig({
        ...config,
        enabledChannels: config.enabledChannels.includes('rcs')
          ? config.enabledChannels
          : [...config.enabledChannels, 'rcs'],
        rcs: draft,
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
    mutationFn: () => testMessagingChannel('rcs'),
    onSuccess: (res) => setTestResult(res.connected),
    onError: () => setTestResult(false),
  })

  if (isLoading || !draft) return null

  const webhookUrl = `${window.location.origin}/api/messaging/rcs/webhook`

  function updateRcs(patch: Partial<NonNullable<MessagingConfig['rcs']>>) {
    if (!draft) return
    setDraft({ ...draft, ...patch })
  }

  return (
    <SectionBody>
      <SectionDescription>
        {t('rcs.description', {
          defaultValue: 'Google RCS Business Messaging for rich messaging experiences.',
        })}
      </SectionDescription>

      <SectionField
        label={t('rcs.agentId', { defaultValue: 'Agent ID' })}
        htmlFor={`${SLUG}-agent-id`}
      >
        <Input
          id={`${SLUG}-agent-id`}
          data-testid={`admin-${SLUG}-agent-id-input`}
          value={draft.agentId}
          onChange={(e) => updateRcs({ agentId: e.target.value })}
          placeholder="brands/BRAND_ID/agents/AGENT_ID"
        />
      </SectionField>

      <SectionField
        label={t('rcs.serviceAccountKey', { defaultValue: 'Service Account Key (JSON)' })}
        htmlFor={`${SLUG}-service-key`}
      >
        <textarea
          id={`${SLUG}-service-key`}
          data-testid={`admin-${SLUG}-service-key-input`}
          value={draft.serviceAccountKey}
          onChange={(e) => updateRcs({ serviceAccountKey: e.target.value })}
          placeholder='{"type": "service_account", ...}'
          className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
        />
      </SectionField>

      <SectionToggleField
        label={t('rcs.fallbackToSms', { defaultValue: 'Fallback to SMS' })}
        htmlFor={`${SLUG}-fallback-sms`}
        help={t('rcs.fallbackToSmsDesc', {
          defaultValue: 'Send via SMS when RCS is unavailable for the recipient.',
        })}
      >
        <Switch
          id={`${SLUG}-fallback-sms`}
          data-testid={`admin-${SLUG}-fallback-sms-switch`}
          checked={draft.fallbackToSms}
          onCheckedChange={(checked) => updateRcs({ fallbackToSms: checked })}
        />
      </SectionToggleField>

      <SectionField
        label={t('rcs.autoResponse', { defaultValue: 'Auto-Response' })}
        htmlFor={`${SLUG}-auto-response`}
      >
        <Input
          id={`${SLUG}-auto-response`}
          data-testid={`admin-${SLUG}-auto-response-input`}
          value={draft.autoResponse || ''}
          onChange={(e) => updateRcs({ autoResponse: e.target.value })}
          placeholder={t('setup.autoResponsePlaceholder')}
        />
      </SectionField>

      <AdvancedReveal sectionSlug={SLUG}>
        <SectionField label={t('rcs.webhookUrl', { defaultValue: 'Webhook URL' })}>
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
          label={t('rcs.webhookSecret', { defaultValue: 'Webhook Secret' })}
          htmlFor={`${SLUG}-webhook-secret`}
        >
          <Input
            id={`${SLUG}-webhook-secret`}
            data-testid={`admin-${SLUG}-webhook-secret-input`}
            type="password"
            value={draft.webhookSecret || ''}
            onChange={(e) => updateRcs({ webhookSecret: e.target.value })}
          />
        </SectionField>
      </AdvancedReveal>

      <SectionActions
        slug={SLUG}
        onSave={() => saveMutation.mutate()}
        saving={saveMutation.isPending}
        disabled={!draft.agentId}
        showSaved={showSaved}
        extraActions={
          <>
            <Button
              variant="outline"
              data-testid={`admin-${SLUG}-test-button`}
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !draft.agentId}
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
