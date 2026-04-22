import type { WhatsAppConfig } from '@shared/types'
import { Check, Copy, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { testWhatsAppConnection } from '@/lib/api'
import { useToast } from '@/lib/toast'
import type { SetupData } from './SetupWizard'

interface Props {
  data: SetupData
  onChange: (patch: Partial<SetupData>) => void
}

type IntegrationMode = 'twilio' | 'direct'

export function WhatsAppProviderForm({ data, onChange }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const config = data.whatsappConfig || { integrationMode: 'twilio' as IntegrationMode }
  const mode = config.integrationMode || 'twilio'

  function update(patch: Partial<WhatsAppConfig>) {
    onChange({ whatsappConfig: { ...config, ...patch }, whatsappValidated: false })
    setTestResult(null)
  }

  async function handleTest() {
    setTesting(true)
    try {
      if (mode === 'direct') {
        const result = await testWhatsAppConnection({
          phoneNumberId: config.phoneNumberId || '',
          accessToken: config.accessToken || '',
        })
        setTestResult(result)
        if (result.ok) onChange({ whatsappValidated: true })
      } else {
        // Twilio mode uses existing telephony provider
        setTestResult({ ok: true })
        onChange({ whatsappValidated: true })
      }
    } catch (err) {
      setTestResult({ ok: false, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  function copyWebhookUrl() {
    const url = `${window.location.origin}/telephony/whatsapp`
    navigator.clipboard.writeText(url)
    toast(t('setup.webhookCopied'), 'success')
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{t('setup.whatsappProvider')}</h3>

      {/* Integration mode */}
      <div className="grid grid-cols-2 gap-2">
        {(['twilio', 'direct'] as const).map((m) => (
          <Card
            key={m}
            role="button"
            tabIndex={0}
            onClick={() => update({ integrationMode: m })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                update({ integrationMode: m })
              }
            }}
            className={`cursor-pointer p-3 text-center text-xs transition-all ${
              mode === m ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
            }`}
          >
            <span className="font-medium">
              {t(`setup.whatsapp${m === 'twilio' ? 'Twilio' : 'Direct'}`)}
            </span>
            {mode === m && <Check className="mx-auto mt-1 h-3 w-3 text-primary" />}
          </Card>
        ))}
      </div>

      {mode === 'twilio' && (
        <p className="text-xs text-muted-foreground">{t('setup.whatsappTwilioNote')}</p>
      )}

      {mode === 'direct' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t('setup.whatsappPhoneNumberId')}</Label>
            <Input
              value={config.phoneNumberId || ''}
              onChange={(e) => update({ phoneNumberId: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('setup.whatsappBusinessAccountId')}</Label>
            <Input
              value={config.businessAccountId || ''}
              onChange={(e) => update({ businessAccountId: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('setup.whatsappAccessToken')}</Label>
            <Input
              type="password"
              value={config.accessToken || ''}
              onChange={(e) => update({ accessToken: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('setup.whatsappVerifyToken')}</Label>
              <Input
                value={config.verifyToken || ''}
                onChange={(e) => update({ verifyToken: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('setup.whatsappAppSecret')}</Label>
              <Input
                type="password"
                value={config.appSecret || ''}
                onChange={(e) => update({ appSecret: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}

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

      {/* Webhook URL */}
      {data.whatsappValidated && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
          <div className="flex-1">
            <p className="text-xs font-medium">{t('setup.webhookUrl')}</p>
            <code className="text-xs text-muted-foreground">
              {window.location.origin}/telephony/whatsapp
            </code>
          </div>
          <Button variant="ghost" size="sm" onClick={copyWebhookUrl}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {testing ? t('telephonyProvider.testing') : t('telephonyProvider.testConnection')}
      </Button>
    </div>
  )
}
