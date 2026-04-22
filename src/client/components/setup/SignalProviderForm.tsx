import type { SignalConfig } from '@shared/types'
import { Copy, Loader2, Shield } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { testSignalBridge } from '@/lib/api'
import { useToast } from '@/lib/toast'
import type { SetupData } from './SetupWizard'
import { WebhookConfirmation } from './WebhookConfirmation'

interface Props {
  data: SetupData
  onChange: (patch: Partial<SetupData>) => void
}

export function SignalProviderForm({ data, onChange }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const config = data.signalConfig || {}

  function update(patch: Partial<SignalConfig>) {
    onChange({ signalConfig: { ...config, ...patch }, signalValidated: false })
    setTestResult(null)
  }

  async function handleTest() {
    setTesting(true)
    try {
      const result = await testSignalBridge({
        bridgeUrl: config.bridgeUrl || '',
        bridgeApiKey: config.bridgeApiKey || '',
      })
      setTestResult(result)
      if (result.ok) onChange({ signalValidated: true })
    } catch (err) {
      setTestResult({ ok: false, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  function _copyWebhookUrl() {
    const url = `${window.location.origin}/api/messaging/signal/webhook`
    navigator.clipboard.writeText(url)
    toast(t('setup.webhookCopied'), 'success')
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const webhookUrls = useMemo(
    () => [
      { label: t('setup.webhooks.signalWebhook'), url: `${origin}/api/messaging/signal/webhook` },
    ],
    [origin, t]
  )

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t('setup.signalProvider')}</h3>
      </div>

      {/* E2EE info note */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
        <p className="text-xs text-blue-700 dark:text-blue-400">{t('setup.signalE2eeNote')}</p>
      </div>

      <p className="text-xs text-muted-foreground">{t('setup.signalDescription')}</p>

      {/* Prerequisites checklist */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
        <p className="text-xs font-medium">{t('setup.signalPrerequisites')}</p>
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          <li>{t('setup.signalPrereq1')}</li>
          <li>{t('setup.signalPrereq2')}</li>
          <li>{t('setup.signalPrereq3')}</li>
        </ul>
      </div>

      {/* Docker command */}
      <div className="space-y-1">
        <p className="text-xs font-medium">{t('setup.signalDockerCommand')}</p>
        <div className="flex items-start gap-2 rounded-md border bg-background p-2">
          <code className="flex-1 text-[11px] break-all font-mono">
            docker run -d --name signal-api -p 8080:8080 -v
            signal-data:/home/.local/share/signal-cli bbernhard/signal-cli-rest-api
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => {
              navigator.clipboard.writeText(
                'docker run -d --name signal-api -p 8080:8080 -v signal-data:/home/.local/share/signal-cli bbernhard/signal-cli-rest-api'
              )
              toast(t('common.copied'), 'success')
            }}
            aria-label={t('a11y.copyToClipboard')}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label>{t('setup.signalBridgeUrl')}</Label>
          <Input
            value={config.bridgeUrl || ''}
            onChange={(e) => update({ bridgeUrl: e.target.value })}
            placeholder="https://signal-bridge.internal:8080"
            data-testid="signal-bridge-url"
          />
        </div>
        <div className="space-y-1">
          <Label>{t('setup.signalApiKey')}</Label>
          <Input
            type="password"
            value={config.bridgeApiKey || ''}
            onChange={(e) => update({ bridgeApiKey: e.target.value })}
            data-testid="signal-api-key"
          />
        </div>
        <div className="space-y-1">
          <Label>{t('setup.signalWebhookSecret')}</Label>
          <Input
            type="password"
            value={config.webhookSecret || ''}
            onChange={(e) => update({ webhookSecret: e.target.value })}
            data-testid="signal-webhook-secret"
          />
        </div>
        <div className="space-y-1">
          <Label>{t('setup.signalRegisteredNumber')}</Label>
          <Input
            value={config.registeredNumber || ''}
            onChange={(e) => update({ registeredNumber: e.target.value })}
            placeholder="+12125551234"
            data-testid="signal-registered-number"
          />
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div
          className={`rounded-lg border p-3 ${testResult.ok ? 'border-green-500/30 bg-green-500/10' : 'border-destructive/30 bg-destructive/10'}`}
        >
          <p
            className={`text-xs ${testResult.ok ? 'text-green-700 dark:text-green-400' : 'text-destructive'}`}
          >
            {testResult.ok
              ? t('telephonyProvider.testSuccess')
              : `${t('telephonyProvider.testFailed')}: ${testResult.error || ''}`}
          </p>
        </div>
      )}

      {/* Webhook URLs */}
      <WebhookConfirmation urls={webhookUrls} visible={data.signalValidated} />

      <Button
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={testing || !config.bridgeUrl}
        data-testid="test-signal-connection"
      >
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {testing ? t('telephonyProvider.testing') : t('telephonyProvider.testConnection')}
      </Button>
    </div>
  )
}
