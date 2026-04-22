import { TELEPHONY_PROVIDER_LABELS, type TelephonyProviderDraft } from '@shared/types'
import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type TelephonyProviderConfig,
  type TelephonyProviderType,
  updateTelephonyProvider,
} from '@/lib/api'
import { useToast } from '@/lib/toast'
import { OAuthConnectButton } from './OAuthConnectButton'
import { PhoneNumberSelector } from './PhoneNumberSelector'
import type { SetupData } from './SetupWizard'
import { WebhookConfirmation } from './WebhookConfirmation'

interface Props {
  data: SetupData
  onChange: (patch: Partial<SetupData>) => void
}

const PROVIDERS: TelephonyProviderType[] = ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk']

export function VoiceSmsProviderForm({ data, onChange }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const provider: TelephonyProviderDraft = data.telephonyProvider || {
    type: 'twilio' as TelephonyProviderType,
  }
  const selectedType = provider.type

  function update(patch: Partial<TelephonyProviderDraft>) {
    onChange({
      telephonyProvider: { ...provider, ...patch } as TelephonyProviderDraft,
      providerValidated: false,
    })
  }

  const credentials = useMemo(
    () => ({
      provider: selectedType,
      accountSid: provider.accountSid,
      authToken: provider.authToken,
      signalwireSpace: provider.signalwireSpace,
      apiKey: provider.apiKey,
      apiSecret: provider.apiSecret,
      applicationId: provider.applicationId,
      authId: provider.authId,
      ariUrl: provider.ariUrl,
      ariUsername: provider.ariUsername,
      ariPassword: provider.ariPassword,
    }),
    [
      selectedType,
      provider.accountSid,
      provider.authToken,
      provider.signalwireSpace,
      provider.apiKey,
      provider.apiSecret,
      provider.applicationId,
      provider.authId,
      provider.ariUrl,
      provider.ariUsername,
      provider.ariPassword,
    ]
  )

  async function handleSave() {
    setSaving(true)
    try {
      await updateTelephonyProvider(provider as TelephonyProviderConfig)
      toast(t('telephonyProvider.saved'), 'success')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const webhookUrls = useMemo(() => {
    const urls = [
      { label: t('setup.webhooks.voiceIncoming'), url: `${origin}/telephony/incoming` },
      { label: t('setup.webhooks.voiceStatus'), url: `${origin}/telephony/status` },
    ]
    if (data.selectedChannels.includes('sms')) {
      urls.push({
        label: t('setup.webhooks.smsWebhook'),
        url: `${origin}/api/messaging/sms/webhook`,
      })
    }
    return urls
  }, [origin, data.selectedChannels, t])

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{t('setup.voiceSmsProvider')}</h3>

      {/* Provider select */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROVIDERS.map((type) => (
          <Card
            key={type}
            role="button"
            tabIndex={0}
            onClick={() => update({ type })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                update({ type })
              }
            }}
            className={`cursor-pointer p-3 text-center text-xs transition-all ${
              selectedType === type
                ? 'border-primary ring-2 ring-primary/20'
                : 'hover:border-primary/50'
            }`}
          >
            <span className="font-medium">{TELEPHONY_PROVIDER_LABELS[type]}</span>
            {selectedType === type && <Check className="mx-auto mt-1 h-3 w-3 text-primary" />}
          </Card>
        ))}
      </div>

      {/* Credential fields */}
      <div className="space-y-3">
        {(selectedType === 'twilio' || selectedType === 'signalwire') && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('telephonyProvider.accountSid')}</Label>
              <Input
                value={provider.accountSid || ''}
                onChange={(e) => update({ accountSid: e.target.value })}
                placeholder="AC..."
                data-testid="account-sid"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('telephonyProvider.authToken')}</Label>
              <Input
                type="password"
                value={provider.authToken || ''}
                onChange={(e) => update({ authToken: e.target.value })}
                data-testid="auth-token"
              />
            </div>
            {selectedType === 'signalwire' && (
              <div className="space-y-1 sm:col-span-2">
                <Label>{t('telephonyProvider.signalwireSpace')}</Label>
                <Input
                  value={provider.signalwireSpace || ''}
                  onChange={(e) => update({ signalwireSpace: e.target.value })}
                  placeholder="myspace"
                />
              </div>
            )}
          </div>
        )}

        {selectedType === 'vonage' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('telephonyProvider.apiKey')}</Label>
              <Input
                value={provider.apiKey || ''}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('telephonyProvider.apiSecret')}</Label>
              <Input
                type="password"
                value={provider.apiSecret || ''}
                onChange={(e) => update({ apiSecret: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('telephonyProvider.applicationId')}</Label>
              <Input
                value={provider.applicationId || ''}
                onChange={(e) => update({ applicationId: e.target.value })}
              />
            </div>
          </div>
        )}

        {selectedType === 'plivo' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('telephonyProvider.authId')}</Label>
              <Input
                value={provider.authId || ''}
                onChange={(e) => update({ authId: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('telephonyProvider.authToken')}</Label>
              <Input
                type="password"
                value={provider.authToken || ''}
                onChange={(e) => update({ authToken: e.target.value })}
              />
            </div>
          </div>
        )}

        {selectedType === 'asterisk' && (
          <>
            <div className="space-y-1">
              <Label>{t('telephonyProvider.ariUrl')}</Label>
              <Input
                value={provider.ariUrl || ''}
                onChange={(e) => update({ ariUrl: e.target.value })}
                placeholder="https://asterisk.example.com:8089/ari"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('telephonyProvider.ariUsername')}</Label>
                <Input
                  value={provider.ariUsername || ''}
                  onChange={(e) => update({ ariUsername: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('telephonyProvider.ariPassword')}</Label>
                <Input
                  type="password"
                  value={provider.ariPassword || ''}
                  onChange={(e) => update({ ariPassword: e.target.value })}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* OAuth Connect / Validate Button */}
      <OAuthConnectButton
        provider={selectedType}
        credentials={credentials}
        validated={data.providerValidated}
        onConnected={() => {
          onChange({ providerValidated: true })
        }}
        onError={() => {
          onChange({ providerValidated: false })
        }}
      />

      {/* Phone Number Selector */}
      <PhoneNumberSelector
        credentials={credentials}
        selectedNumber={provider.phoneNumber || ''}
        onSelect={(phoneNumber) => update({ phoneNumber })}
        credentialsValid={data.providerValidated}
      />

      {/* Webhook URLs */}
      <WebhookConfirmation urls={webhookUrls} visible={data.providerValidated} />

      {/* Save button */}
      {data.providerValidated && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !provider.phoneNumber}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="save-provider-button"
        >
          {saving ? t('common.loading') : t('telephonyProvider.saveProvider')}
        </button>
      )}
    </div>
  )
}
