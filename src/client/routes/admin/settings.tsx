import { createFileRoute, useSearch, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  getSpamSettings,
  updateSpamSettings,
  getCallSettings,
  updateCallSettings,
  getTranscriptionSettings,
  updateTranscriptionSettings,
  getIvrLanguages,
  updateIvrLanguages,
  listIvrAudio,
  uploadIvrAudio,
  deleteIvrAudio,
  getIvrAudioUrl,
  getCustomFields,
  updateCustomFields,
  getTelephonyProvider,
  updateTelephonyProvider,
  testTelephonyProvider,
  type SpamSettings,
  type CallSettings,
  type IvrAudioRecording,
  type CustomFieldDefinition,
  type TelephonyProviderConfig,
  type TelephonyProviderType,
} from '@/lib/api'
import { MAX_CUSTOM_FIELDS, TELEPHONY_PROVIDER_LABELS, PROVIDER_REQUIRED_FIELDS } from '@shared/types'
import { useToast } from '@/lib/toast'
import { Settings2, Mic, ShieldAlert, Bot, Timer, Shield, Globe, Phone, Volume2, PhoneForwarded, Fingerprint, Trash2, Plus, StickyNote, ChevronUp, ChevronDown, Save, Radio } from 'lucide-react'
import { getWebAuthnSettings, updateWebAuthnSettings, type WebAuthnSettings } from '@/lib/api'
import { AudioRecorder } from '@/components/audio-recorder'
import { LANGUAGES, IVR_LANGUAGES, LANGUAGE_MAP, ivrIndexToDigit } from '@shared/languages'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SettingsSection } from '@/components/settings-section'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    section: (search.section as string) || '',
  }),
})

function AdminSettingsPage() {
  const { t } = useTranslation()
  const { section } = useSearch({ from: '/admin/settings' })
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const [spam, setSpam] = useState<SpamSettings | null>(null)
  const [callSet, setCallSet] = useState<CallSettings | null>(null)
  const [globalTranscription, setGlobalTranscription] = useState(false)
  const [allowVolunteerOptOut, setAllowVolunteerOptOut] = useState(false)
  const [ivrEnabled, setIvrEnabled] = useState<string[]>([...IVR_LANGUAGES])
  const [ivrAudio, setIvrAudio] = useState<IvrAudioRecording[]>([])
  const [audioSaving, setAudioSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmToggle, setConfirmToggle] = useState<{ key: string; newValue: boolean } | null>(null)
  const [webauthnSettings, setWebauthnSettings] = useState<WebAuthnSettings | null>(null)
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([])
  const [editingField, setEditingField] = useState<Partial<CustomFieldDefinition> | null>(null)
  const [fieldSaving, setFieldSaving] = useState(false)
  const [providerConfig, setProviderConfig] = useState<TelephonyProviderConfig | null>(null)
  const [providerDraft, setProviderDraft] = useState<Partial<TelephonyProviderConfig>>({ type: 'twilio' })
  const [providerTesting, setProviderTesting] = useState(false)
  const [providerTestResult, setProviderTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [providerSaving, setProviderSaving] = useState(false)

  // Collapsible state — first section expanded by default, plus any deep-linked section
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set(['passkey-policy'])
    if (section) initial.add(section)
    return initial
  })
  const scrolledRef = useRef(false)

  const toggleSection = useCallback((id: string, open: boolean) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (open) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    const promises: Promise<void>[] = [
      getSpamSettings().then(setSpam),
      getCallSettings().then(setCallSet),
      getTranscriptionSettings().then(r => {
        setGlobalTranscription(r.globalEnabled)
        setAllowVolunteerOptOut(r.allowVolunteerOptOut)
      }),
      getIvrLanguages().then(r => setIvrEnabled(r.enabledLanguages)),
      listIvrAudio().then(r => setIvrAudio(r.recordings)),
      getWebAuthnSettings().then(setWebauthnSettings).catch(() => {}),
      getCustomFields().then(r => setCustomFieldDefs(r.fields)).catch(() => {}),
      getTelephonyProvider().then(config => {
        if (config) {
          setProviderConfig(config)
          setProviderDraft(config)
        }
      }).catch(() => {}),
    ]
    Promise.all(promises)
      .catch(() => toast(t('common.error'), 'error'))
      .finally(() => setLoading(false))
  }, [isAdmin])

  // Scroll to deep-linked section after loading
  useEffect(() => {
    if (!loading && section && !scrolledRef.current) {
      scrolledRef.current = true
      requestAnimationFrame(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [loading, section])

  async function handleConfirmToggle() {
    if (!confirmToggle) return
    const { key, newValue } = confirmToggle
    try {
      if (key === 'transcription') {
        const res = await updateTranscriptionSettings({ globalEnabled: newValue })
        setGlobalTranscription(res.globalEnabled)
      } else if (key === 'captcha') {
        const res = await updateSpamSettings({ voiceCaptchaEnabled: newValue })
        setSpam(res)
      } else if (key === 'rateLimit') {
        const res = await updateSpamSettings({ rateLimitEnabled: newValue })
        setSpam(res)
      }
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  const confirmTitles: Record<string, string> = {
    transcription: t('confirm.transcriptionTitle'),
    captcha: t('confirm.captchaTitle'),
    rateLimit: t('confirm.rateLimitTitle'),
  }

  const confirmDescriptions: Record<string, string> = {
    transcription: confirmToggle?.newValue ? t('confirm.transcriptionEnable') : t('confirm.transcriptionDisable'),
    captcha: confirmToggle?.newValue ? t('confirm.captchaEnable') : t('confirm.captchaDisable'),
    rateLimit: confirmToggle?.newValue ? t('confirm.rateLimitEnable') : t('confirm.rateLimitDisable'),
  }

  if (!isAdmin) {
    return <div className="text-muted-foreground">{t('common.error')}</div>
  }

  if (loading) {
    return <div className="text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold sm:text-2xl">{t('settings.adminTitle')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('settings.adminDescription')}</p>

      {/* WebAuthn Policy */}
      {webauthnSettings && (
        <SettingsSection
          id="passkey-policy"
          title={t('webauthn.policy')}
          description={t('webauthn.policyDescription')}
          icon={<Shield className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('passkey-policy')}
          onToggle={(open) => toggleSection('passkey-policy', open)}
          basePath="/admin/settings"
        >
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label>{t('webauthn.requireForAdmins')}</Label>
            </div>
            <Switch
              checked={webauthnSettings.requireForAdmins}
              onCheckedChange={async (checked) => {
                try {
                  const res = await updateWebAuthnSettings({ requireForAdmins: checked })
                  setWebauthnSettings(res)
                } catch {
                  toast(t('common.error'), 'error')
                }
              }}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label>{t('webauthn.requireForVolunteers')}</Label>
            </div>
            <Switch
              checked={webauthnSettings.requireForVolunteers}
              onCheckedChange={async (checked) => {
                try {
                  const res = await updateWebAuthnSettings({ requireForVolunteers: checked })
                  setWebauthnSettings(res)
                } catch {
                  toast(t('common.error'), 'error')
                }
              }}
            />
          </div>
        </SettingsSection>
      )}

      {/* Telephony Provider */}
      <SettingsSection
        id="telephony-provider"
        title={t('telephonyProvider.title')}
        description={t('telephonyProvider.description')}
        icon={<Radio className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('telephony-provider')}
        onToggle={(open) => toggleSection('telephony-provider', open)}
        basePath="/admin/settings"
      >
        {providerConfig && (
          <div className="rounded-lg border border-border bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">
              {t('telephonyProvider.currentProvider')}: <span className="font-medium text-foreground">{TELEPHONY_PROVIDER_LABELS[providerConfig.type]}</span>
            </p>
          </div>
        )}
        {!providerConfig && (
          <div className="rounded-lg border border-border bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">{t('telephonyProvider.envFallback')}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t('telephonyProvider.provider')}</Label>
            <select
              value={providerDraft.type || 'twilio'}
              onChange={e => {
                setProviderDraft({ type: e.target.value as TelephonyProviderType })
                setProviderTestResult(null)
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {(Object.entries(TELEPHONY_PROVIDER_LABELS) as [TelephonyProviderType, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {t(`telephonyProvider.providerDescriptions.${providerDraft.type || 'twilio'}`)}
            </p>
          </div>

          {providerDraft.type === 'asterisk' && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <p className="text-xs text-yellow-700 dark:text-yellow-400">{t('telephonyProvider.notImplemented')}</p>
            </div>
          )}

          {/* Common: Phone Number */}
          <div className="space-y-1">
            <Label>{t('telephonyProvider.phoneNumber')}</Label>
            <p className="text-xs text-muted-foreground">{t('telephonyProvider.phoneNumberHelp')}</p>
            <Input
              value={providerDraft.phoneNumber || ''}
              onChange={e => setProviderDraft(prev => ({ ...prev, phoneNumber: e.target.value }))}
              placeholder="+12125551234"
            />
          </div>

          {/* Twilio / SignalWire fields */}
          {(providerDraft.type === 'twilio' || providerDraft.type === 'signalwire') && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t('telephonyProvider.accountSid')}</Label>
                  <Input
                    value={providerDraft.accountSid || ''}
                    onChange={e => setProviderDraft(prev => ({ ...prev, accountSid: e.target.value }))}
                    placeholder="AC..."
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('telephonyProvider.authToken')}</Label>
                  <Input
                    type="password"
                    value={providerDraft.authToken || ''}
                    onChange={e => setProviderDraft(prev => ({ ...prev, authToken: e.target.value }))}
                  />
                </div>
              </div>
              {providerDraft.type === 'signalwire' && (
                <div className="space-y-1">
                  <Label>{t('telephonyProvider.signalwireSpace')}</Label>
                  <p className="text-xs text-muted-foreground">{t('telephonyProvider.signalwireSpaceHelp')}</p>
                  <Input
                    value={providerDraft.signalwireSpace || ''}
                    onChange={e => setProviderDraft(prev => ({ ...prev, signalwireSpace: e.target.value }))}
                    placeholder="myspace"
                  />
                </div>
              )}
            </>
          )}

          {/* Vonage fields */}
          {providerDraft.type === 'vonage' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('telephonyProvider.apiKey')}</Label>
                <Input
                  value={providerDraft.apiKey || ''}
                  onChange={e => setProviderDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('telephonyProvider.apiSecret')}</Label>
                <Input
                  type="password"
                  value={providerDraft.apiSecret || ''}
                  onChange={e => setProviderDraft(prev => ({ ...prev, apiSecret: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('telephonyProvider.applicationId')}</Label>
                <Input
                  value={providerDraft.applicationId || ''}
                  onChange={e => setProviderDraft(prev => ({ ...prev, applicationId: e.target.value }))}
                />
              </div>
            </div>
          )}

          {/* Plivo fields */}
          {providerDraft.type === 'plivo' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('telephonyProvider.authId')}</Label>
                <Input
                  value={providerDraft.authId || ''}
                  onChange={e => setProviderDraft(prev => ({ ...prev, authId: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('telephonyProvider.authToken')}</Label>
                <Input
                  type="password"
                  value={providerDraft.authToken || ''}
                  onChange={e => setProviderDraft(prev => ({ ...prev, authToken: e.target.value }))}
                />
              </div>
            </div>
          )}

          {/* Asterisk fields */}
          {providerDraft.type === 'asterisk' && (
            <>
              <div className="space-y-1">
                <Label>{t('telephonyProvider.ariUrl')}</Label>
                <p className="text-xs text-muted-foreground">{t('telephonyProvider.ariUrlHelp')}</p>
                <Input
                  value={providerDraft.ariUrl || ''}
                  onChange={e => setProviderDraft(prev => ({ ...prev, ariUrl: e.target.value }))}
                  placeholder="https://asterisk.example.com:8089/ari"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t('telephonyProvider.ariUsername')}</Label>
                  <Input
                    value={providerDraft.ariUsername || ''}
                    onChange={e => setProviderDraft(prev => ({ ...prev, ariUsername: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('telephonyProvider.ariPassword')}</Label>
                  <Input
                    type="password"
                    value={providerDraft.ariPassword || ''}
                    onChange={e => setProviderDraft(prev => ({ ...prev, ariPassword: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>{t('telephonyProvider.bridgeCallbackUrl')}</Label>
                <p className="text-xs text-muted-foreground">{t('telephonyProvider.bridgeCallbackUrlHelp')}</p>
                <Input
                  value={providerDraft.bridgeCallbackUrl || ''}
                  onChange={e => setProviderDraft(prev => ({ ...prev, bridgeCallbackUrl: e.target.value }))}
                />
              </div>
            </>
          )}

          {/* WebRTC Config (not for Asterisk) */}
          {providerDraft.type !== 'asterisk' && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">{t('telephonyProvider.webrtcConfig')}</Label>
                  <p className="text-xs text-muted-foreground">{t('telephonyProvider.webrtcConfigHelp')}</p>
                </div>
                <Switch
                  checked={providerDraft.webrtcEnabled || false}
                  onCheckedChange={checked => setProviderDraft(prev => ({ ...prev, webrtcEnabled: checked }))}
                />
              </div>
              {providerDraft.webrtcEnabled && (providerDraft.type === 'twilio' || providerDraft.type === 'signalwire') && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{t('telephonyProvider.apiKeySid')}</Label>
                    <p className="text-xs text-muted-foreground">{t('telephonyProvider.apiKeySidHelp')}</p>
                    <Input
                      value={providerDraft.apiKeySid || ''}
                      onChange={e => setProviderDraft(prev => ({ ...prev, apiKeySid: e.target.value }))}
                      placeholder="SK..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t('telephonyProvider.apiKeySecret')}</Label>
                    <Input
                      type="password"
                      value={providerDraft.apiKeySecret || ''}
                      onChange={e => setProviderDraft(prev => ({ ...prev, apiKeySecret: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>{t('telephonyProvider.twimlAppSid')}</Label>
                    <p className="text-xs text-muted-foreground">{t('telephonyProvider.twimlAppSidHelp')}</p>
                    <Input
                      value={providerDraft.twimlAppSid || ''}
                      onChange={e => setProviderDraft(prev => ({ ...prev, twimlAppSid: e.target.value }))}
                      placeholder="AP..."
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Test result */}
          {providerTestResult && (
            <div className={`rounded-lg border p-3 ${providerTestResult.ok ? 'border-green-500/30 bg-green-500/10' : 'border-destructive/30 bg-destructive/10'}`}>
              <p className={`text-xs ${providerTestResult.ok ? 'text-green-700 dark:text-green-400' : 'text-destructive'}`}>
                {providerTestResult.ok ? t('telephonyProvider.testSuccess') : `${t('telephonyProvider.testFailed')}: ${providerTestResult.error || ''}`}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={providerTesting}
              onClick={async () => {
                setProviderTesting(true)
                setProviderTestResult(null)
                try {
                  const result = await testTelephonyProvider(providerDraft as TelephonyProviderConfig)
                  setProviderTestResult(result)
                } catch (err) {
                  setProviderTestResult({ ok: false, error: String(err) })
                } finally {
                  setProviderTesting(false)
                }
              }}
            >
              {providerTesting ? t('telephonyProvider.testing') : t('telephonyProvider.testConnection')}
            </Button>
            <Button
              disabled={providerSaving || !providerDraft.phoneNumber}
              onClick={async () => {
                setProviderSaving(true)
                try {
                  const config = providerDraft as TelephonyProviderConfig
                  const saved = await updateTelephonyProvider(config)
                  setProviderConfig(saved)
                  setProviderDraft(saved)
                  toast(t('telephonyProvider.saved'), 'success')
                } catch (err) {
                  toast(String(err), 'error')
                } finally {
                  setProviderSaving(false)
                }
              }}
            >
              <Save className="h-4 w-4" />
              {providerSaving ? t('common.loading') : t('telephonyProvider.saveProvider')}
            </Button>
          </div>
        </div>
      </SettingsSection>

      {/* Transcription (global toggle) */}
      <SettingsSection
        id="transcription"
        title={t('settings.transcriptionSettings')}
        description={t('settings.transcriptionDescription')}
        icon={<Mic className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('transcription')}
        onToggle={(open) => toggleSection('transcription', open)}
        basePath="/admin/settings"
      >
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label>{t('settings.enableTranscription')}</Label>
            <p className="text-xs text-muted-foreground">{t('transcription.enabledGlobal')}</p>
          </div>
          <Switch
            checked={globalTranscription}
            onCheckedChange={(checked) => setConfirmToggle({ key: 'transcription', newValue: checked })}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label>{t('transcription.allowOptOut')}</Label>
            <p className="text-xs text-muted-foreground">{t('transcription.allowOptOutDescription')}</p>
          </div>
          <Switch
            checked={allowVolunteerOptOut}
            onCheckedChange={async (checked) => {
              try {
                const res = await updateTranscriptionSettings({ allowVolunteerOptOut: checked })
                setAllowVolunteerOptOut(res.allowVolunteerOptOut)
              } catch {
                toast(t('common.error'), 'error')
              }
            }}
          />
        </div>
      </SettingsSection>

      {/* IVR Language Menu */}
      <SettingsSection
        id="ivr-languages"
        title={t('ivr.title')}
        description={t('ivr.description')}
        icon={<Phone className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('ivr-languages')}
        onToggle={(open) => toggleSection('ivr-languages', open)}
        basePath="/admin/settings"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {IVR_LANGUAGES.map((code, index) => {
            const lang = LANGUAGE_MAP[code]
            if (!lang) return null
            const enabled = ivrEnabled.includes(code)
            const isLastEnabled = enabled && ivrEnabled.length === 1
            return (
              <div key={code} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-mono">
                    {ivrIndexToDigit(index)}
                  </Badge>
                  <span className="text-sm">{lang.label}</span>
                </div>
                <Switch
                  checked={enabled}
                  disabled={isLastEnabled}
                  onCheckedChange={async (checked) => {
                    const next = checked
                      ? [...ivrEnabled, code]
                      : ivrEnabled.filter(c => c !== code)
                    try {
                      const res = await updateIvrLanguages({ enabledLanguages: next })
                      setIvrEnabled(res.enabledLanguages)
                    } catch {
                      toast(t('common.error'), 'error')
                    }
                  }}
                />
              </div>
            )
          })}
        </div>
        {ivrEnabled.length === 1 && (
          <p className="text-xs text-muted-foreground">{t('ivr.atLeastOne')}</p>
        )}
      </SettingsSection>

      {/* Call Settings */}
      {callSet && (
        <SettingsSection
          id="call-settings"
          title={t('callSettings.title')}
          description={t('callSettings.description')}
          icon={<PhoneForwarded className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('call-settings')}
          onToggle={(open) => toggleSection('call-settings', open)}
          basePath="/admin/settings"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="queue-timeout">{t('callSettings.queueTimeout')}</Label>
              <p className="text-xs text-muted-foreground">{t('callSettings.queueTimeoutDescription')}</p>
              <Input
                id="queue-timeout"
                type="number"
                value={callSet.queueTimeoutSeconds}
                onChange={async (e) => {
                  try {
                    const val = parseInt(e.target.value) || 90
                    const res = await updateCallSettings({ queueTimeoutSeconds: val })
                    setCallSet(res)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
                min={30}
                max={300}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voicemail-max">{t('callSettings.voicemailMax')}</Label>
              <p className="text-xs text-muted-foreground">{t('callSettings.voicemailMaxDescription')}</p>
              <Input
                id="voicemail-max"
                type="number"
                value={callSet.voicemailMaxSeconds}
                onChange={async (e) => {
                  try {
                    const val = parseInt(e.target.value) || 120
                    const res = await updateCallSettings({ voicemailMaxSeconds: val })
                    setCallSet(res)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
                min={30}
                max={300}
              />
            </div>
          </div>
        </SettingsSection>
      )}

      {/* Voice Prompts (IVR Audio) */}
      <SettingsSection
        id="voice-prompts"
        title={t('ivrAudio.title')}
        description={t('ivrAudio.description')}
        icon={<Volume2 className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('voice-prompts')}
        onToggle={(open) => toggleSection('voice-prompts', open)}
        basePath="/admin/settings"
      >
        {(['greeting', 'pleaseHold', 'waitMessage', 'rateLimited', 'captchaPrompt'] as const).map(promptType => (
          <div key={promptType} className="space-y-2">
            <h4 className="text-sm font-medium">{t(`ivrAudio.prompt.${promptType}`)}</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ivrEnabled.map(langCode => {
                const lang = LANGUAGE_MAP[langCode]
                if (!lang) return null
                const existing = ivrAudio.find(r => r.promptType === promptType && r.language === langCode)
                const key = `${promptType}:${langCode}`
                return (
                  <div key={key} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{lang.flag} {lang.label}</span>
                      {existing && (
                        <Badge variant="secondary" className="text-[10px]">{t('ivrAudio.uploaded')}</Badge>
                      )}
                    </div>
                    <AudioRecorder
                      existingUrl={existing ? getIvrAudioUrl(promptType, langCode) : undefined}
                      onRecorded={async (blob) => {
                        setAudioSaving(key)
                        try {
                          await uploadIvrAudio(promptType, langCode, blob)
                          const res = await listIvrAudio()
                          setIvrAudio(res.recordings)
                          toast(t('common.success'), 'success')
                        } catch {
                          toast(t('common.error'), 'error')
                        } finally {
                          setAudioSaving(null)
                        }
                      }}
                      onDelete={existing ? async () => {
                        setAudioSaving(key)
                        try {
                          await deleteIvrAudio(promptType, langCode)
                          setIvrAudio(prev => prev.filter(r => !(r.promptType === promptType && r.language === langCode)))
                          toast(t('common.success'), 'success')
                        } catch {
                          toast(t('common.error'), 'error')
                        } finally {
                          setAudioSaving(null)
                        }
                      } : undefined}
                    />
                    {audioSaving === key && (
                      <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </SettingsSection>

      {/* Custom Note Fields */}
      <SettingsSection
        id="custom-fields"
        title={t('customFields.title')}
        description={t('customFields.description')}
        icon={<StickyNote className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('custom-fields')}
        onToggle={(open) => toggleSection('custom-fields', open)}
        basePath="/admin/settings"
      >
        {customFieldDefs.length === 0 && !editingField ? (
          <p className="text-sm text-muted-foreground">{t('customFields.noFields')}</p>
        ) : (
          <div className="space-y-2">
            {customFieldDefs.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2 rounded-lg border border-border px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === 0}
                    onClick={() => {
                      const next = [...customFieldDefs]
                      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                      next.forEach((f, i) => f.order = i)
                      setCustomFieldDefs(next)
                      updateCustomFields(next).catch(() => toast(t('common.error'), 'error'))
                    }}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === customFieldDefs.length - 1}
                    onClick={() => {
                      const next = [...customFieldDefs]
                      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                      next.forEach((f, i) => f.order = i)
                      setCustomFieldDefs(next)
                      updateCustomFields(next).catch(() => toast(t('common.error'), 'error'))
                    }}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 space-y-0.5">
                  <p className="text-sm font-medium">{field.label}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{t(`customFields.types.${field.type}`)}</Badge>
                    {field.required && <Badge variant="secondary" className="text-[10px]">{t('customFields.required')}</Badge>}
                    {!field.visibleToVolunteers && <Badge variant="secondary" className="text-[10px]">{t('customFields.adminOnly')}</Badge>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingField({ ...field })}
                >
                  {t('common.edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(t('customFields.deleteConfirm'))) return
                    const next = customFieldDefs.filter(f => f.id !== field.id)
                    next.forEach((f, i) => f.order = i)
                    try {
                      const res = await updateCustomFields(next)
                      setCustomFieldDefs(res.fields)
                    } catch {
                      toast(t('common.error'), 'error')
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add/Edit field form */}
        {editingField ? (
          <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h4 className="text-sm font-medium">
              {editingField.id ? t('common.edit') : t('customFields.addField')}
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('customFields.fieldLabel')}</Label>
                <Input
                  value={editingField.label || ''}
                  onChange={e => {
                    const label = e.target.value
                    const autoName = !editingField.id
                    setEditingField(prev => ({
                      ...prev!,
                      label,
                      ...(autoName ? { name: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) } : {}),
                    }))
                  }}
                  placeholder="e.g. Severity Rating"
                />
              </div>
              <div className="space-y-1">
                <Label>{t('customFields.fieldName')}</Label>
                <Input
                  value={editingField.name || ''}
                  onChange={e => setEditingField(prev => ({ ...prev!, name: e.target.value }))}
                  placeholder="e.g. severity"
                  maxLength={50}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('customFields.fieldType')}</Label>
                <select
                  value={editingField.type || 'text'}
                  onChange={e => setEditingField(prev => ({ ...prev!, type: e.target.value as CustomFieldDefinition['type'] }))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="text">{t('customFields.types.text')}</option>
                  <option value="number">{t('customFields.types.number')}</option>
                  <option value="select">{t('customFields.types.select')}</option>
                  <option value="checkbox">{t('customFields.types.checkbox')}</option>
                  <option value="textarea">{t('customFields.types.textarea')}</option>
                </select>
              </div>
              <div className="flex items-end gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editingField.required ?? false}
                    onCheckedChange={checked => setEditingField(prev => ({ ...prev!, required: checked }))}
                  />
                  <Label className="text-sm">{t('customFields.required')}</Label>
                </div>
              </div>
            </div>

            {/* Select options */}
            {editingField.type === 'select' && (
              <div className="space-y-2">
                <Label>{t('customFields.options')}</Label>
                {(editingField.options || []).map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={opt}
                      onChange={e => {
                        const next = [...(editingField.options || [])]
                        next[i] = e.target.value
                        setEditingField(prev => ({ ...prev!, options: next }))
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingField(prev => ({
                          ...prev!,
                          options: prev!.options!.filter((_, j) => j !== i),
                        }))
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingField(prev => ({
                      ...prev!,
                      options: [...(prev!.options || []), ''],
                    }))
                  }}
                >
                  <Plus className="h-3 w-3" />
                  {t('customFields.addOption')}
                </Button>
              </div>
            )}

            {/* Validation */}
            {(editingField.type === 'text' || editingField.type === 'textarea') && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t('customFields.validation.minLength')}</Label>
                  <Input
                    type="number"
                    value={editingField.validation?.minLength ?? ''}
                    onChange={e => setEditingField(prev => ({
                      ...prev!,
                      validation: { ...prev!.validation, minLength: e.target.value ? Number(e.target.value) : undefined },
                    }))}
                    min={0}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('customFields.validation.maxLength')}</Label>
                  <Input
                    type="number"
                    value={editingField.validation?.maxLength ?? ''}
                    onChange={e => setEditingField(prev => ({
                      ...prev!,
                      validation: { ...prev!.validation, maxLength: e.target.value ? Number(e.target.value) : undefined },
                    }))}
                    min={0}
                  />
                </div>
              </div>
            )}
            {editingField.type === 'number' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t('customFields.validation.min')}</Label>
                  <Input
                    type="number"
                    value={editingField.validation?.min ?? ''}
                    onChange={e => setEditingField(prev => ({
                      ...prev!,
                      validation: { ...prev!.validation, min: e.target.value ? Number(e.target.value) : undefined },
                    }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('customFields.validation.max')}</Label>
                  <Input
                    type="number"
                    value={editingField.validation?.max ?? ''}
                    onChange={e => setEditingField(prev => ({
                      ...prev!,
                      validation: { ...prev!.validation, max: e.target.value ? Number(e.target.value) : undefined },
                    }))}
                  />
                </div>
              </div>
            )}

            {/* Visibility */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={editingField.visibleToVolunteers ?? true}
                  onCheckedChange={checked => setEditingField(prev => ({ ...prev!, visibleToVolunteers: checked }))}
                />
                <Label className="text-sm">{t('customFields.visibleToVolunteers')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editingField.editableByVolunteers ?? true}
                  onCheckedChange={checked => setEditingField(prev => ({ ...prev!, editableByVolunteers: checked }))}
                />
                <Label className="text-sm">{t('customFields.editableByVolunteers')}</Label>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                disabled={fieldSaving || !editingField.label?.trim() || !editingField.name?.trim()}
                onClick={async () => {
                  if (!editingField.label?.trim() || !editingField.name?.trim()) return
                  setFieldSaving(true)
                  try {
                    let next: CustomFieldDefinition[]
                    if (editingField.id) {
                      // Edit existing
                      next = customFieldDefs.map(f =>
                        f.id === editingField.id ? { ...f, ...editingField } as CustomFieldDefinition : f
                      )
                    } else {
                      // Add new
                      const newField: CustomFieldDefinition = {
                        id: crypto.randomUUID(),
                        name: editingField.name!,
                        label: editingField.label!,
                        type: editingField.type || 'text',
                        required: editingField.required ?? false,
                        options: editingField.options,
                        validation: editingField.validation,
                        visibleToVolunteers: editingField.visibleToVolunteers ?? true,
                        editableByVolunteers: editingField.editableByVolunteers ?? true,
                        order: customFieldDefs.length,
                        createdAt: new Date().toISOString(),
                      }
                      next = [...customFieldDefs, newField]
                    }
                    const res = await updateCustomFields(next)
                    setCustomFieldDefs(res.fields)
                    setEditingField(null)
                    toast(t('common.success'), 'success')
                  } catch {
                    toast(t('common.error'), 'error')
                  } finally {
                    setFieldSaving(false)
                  }
                }}
              >
                <Save className="h-4 w-4" />
                {fieldSaving ? t('common.loading') : t('common.save')}
              </Button>
              <Button variant="outline" onClick={() => setEditingField(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          customFieldDefs.length < MAX_CUSTOM_FIELDS && (
            <Button
              variant="outline"
              onClick={() => setEditingField({
                type: 'text',
                required: false,
                visibleToVolunteers: true,
                editableByVolunteers: true,
              })}
            >
              <Plus className="h-4 w-4" />
              {t('customFields.addField')}
            </Button>
          )
        )}

        {customFieldDefs.length >= MAX_CUSTOM_FIELDS && (
          <p className="text-xs text-muted-foreground">{t('customFields.maxFields')}</p>
        )}
      </SettingsSection>

      {/* Spam mitigation */}
      {spam && (
        <SettingsSection
          id="spam"
          title={t('spam.title')}
          icon={<ShieldAlert className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('spam')}
          onToggle={(open) => toggleSection('spam', open)}
          basePath="/admin/settings"
        >
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <Bot className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="space-y-0.5">
                <Label>{t('spam.voiceCaptcha')}</Label>
                <p className="text-xs text-muted-foreground">{t('spam.voiceCaptchaDescription')}</p>
              </div>
            </div>
            <Switch
              checked={spam.voiceCaptchaEnabled}
              onCheckedChange={(checked) => setConfirmToggle({ key: 'captcha', newValue: checked })}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <Timer className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="space-y-0.5">
                <Label>{t('spam.rateLimiting')}</Label>
                <p className="text-xs text-muted-foreground">{t('spam.rateLimitingDescription')}</p>
              </div>
            </div>
            <Switch
              checked={spam.rateLimitEnabled}
              onCheckedChange={(checked) => setConfirmToggle({ key: 'rateLimit', newValue: checked })}
            />
          </div>

          {spam.rateLimitEnabled && (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="max-calls">{t('spam.maxCallsPerMinute')}</Label>
                <Input
                  id="max-calls"
                  type="number"
                  value={spam.maxCallsPerMinute}
                  onChange={async (e) => {
                    try {
                      const val = parseInt(e.target.value) || 3
                      const res = await updateSpamSettings({ maxCallsPerMinute: val })
                      setSpam(res)
                    } catch {
                      toast(t('common.error'), 'error')
                    }
                  }}
                  min={1}
                  max={60}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="block-duration">{t('spam.blockDuration')}</Label>
                <Input
                  id="block-duration"
                  type="number"
                  value={spam.blockDurationMinutes}
                  onChange={async (e) => {
                    try {
                      const val = parseInt(e.target.value) || 30
                      const res = await updateSpamSettings({ blockDurationMinutes: val })
                      setSpam(res)
                    } catch {
                      toast(t('common.error'), 'error')
                    }
                  }}
                  min={1}
                  max={1440}
                />
              </div>
            </div>
          )}
        </SettingsSection>
      )}

      {/* Confirmation dialog for settings toggles */}
      <ConfirmDialog
        open={!!confirmToggle}
        onOpenChange={(open) => { if (!open) setConfirmToggle(null) }}
        title={confirmToggle ? confirmTitles[confirmToggle.key] : ''}
        description={confirmToggle ? confirmDescriptions[confirmToggle.key] : ''}
        variant="default"
        onConfirm={handleConfirmToggle}
      />
    </div>
  )
}
