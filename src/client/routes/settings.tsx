import { createFileRoute, useSearch } from '@tanstack/react-router'
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
  updateMyTranscriptionPreference,
  updateMyProfile,
  getIvrLanguages,
  updateIvrLanguages,
  listIvrAudio,
  uploadIvrAudio,
  deleteIvrAudio,
  getIvrAudioUrl,
  getCustomFields,
  updateCustomFields,
  type SpamSettings,
  type CallSettings,
  type IvrAudioRecording,
  type CustomFieldDefinition,
} from '@/lib/api'
import { MAX_CUSTOM_FIELDS } from '@shared/types'
import { getStoredSession, keyPairFromNsec } from '@/lib/crypto'
import { nip19 } from 'nostr-tools'
import { useToast } from '@/lib/toast'
import { Settings2, Mic, ShieldAlert, Bot, Timer, Bell, User, KeyRound, Shield, Globe, Phone, Volume2, PhoneForwarded, Fingerprint, Trash2, Plus, StickyNote, ChevronUp, ChevronDown, Save } from 'lucide-react'
import { isWebAuthnAvailable, registerCredential, listCredentials, deleteCredential, type WebAuthnCredentialInfo } from '@/lib/webauthn'
import { getWebAuthnSettings, updateWebAuthnSettings, type WebAuthnSettings } from '@/lib/api'
import { AudioRecorder } from '@/components/audio-recorder'
import { PhoneInput } from '@/components/phone-input'
import { getNotificationPrefs, setNotificationPrefs } from '@/lib/notifications'
import { LANGUAGES, IVR_LANGUAGES, LANGUAGE_MAP, ivrIndexToDigit } from '@shared/languages'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SettingsSection } from '@/components/settings-section'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    section: (search.section as string) || '',
  }),
})

function SettingsPage() {
  const { t } = useTranslation()
  const { section } = useSearch({ from: '/settings' })
  const { isAdmin, transcriptionEnabled, name: authName, spokenLanguages, refreshProfile } = useAuth()
  const { toast } = useToast()
  const [spam, setSpam] = useState<SpamSettings | null>(null)
  const [callSet, setCallSet] = useState<CallSettings | null>(null)
  const [globalTranscription, setGlobalTranscription] = useState(false)
  const [myTranscription, setMyTranscription] = useState(transcriptionEnabled)
  const [notifPrefs, setNotifPrefs] = useState(getNotificationPrefs)
  const [ivrEnabled, setIvrEnabled] = useState<string[]>([...IVR_LANGUAGES])
  const [ivrAudio, setIvrAudio] = useState<IvrAudioRecording[]>([])
  const [audioSaving, setAudioSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmToggle, setConfirmToggle] = useState<{ key: string; newValue: boolean } | null>(null)
  const [webauthnCreds, setWebauthnCreds] = useState<WebAuthnCredentialInfo[]>([])
  const [webauthnLabel, setWebauthnLabel] = useState('')
  const [webauthnRegistering, setWebauthnRegistering] = useState(false)
  const [webauthnSettings, setWebauthnSettings] = useState<WebAuthnSettings | null>(null)
  const webauthnAvailable = isWebAuthnAvailable()
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([])
  const [editingField, setEditingField] = useState<Partial<CustomFieldDefinition> | null>(null)
  const [fieldSaving, setFieldSaving] = useState(false)

  // Collapsible state — profile expanded by default, plus any deep-linked section
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set(['profile'])
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

  // Profile state
  const [profileName, setProfileName] = useState(authName || '')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileError, setProfileError] = useState('')
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(spokenLanguages || ['en'])

  // Get npub for display
  const nsec = getStoredSession()
  const keyPair = nsec ? keyPairFromNsec(nsec) : null
  const npub = keyPair ? nip19.npubEncode(keyPair.publicKey) : ''

  useEffect(() => {
    const promises: Promise<void>[] = []
    // Load WebAuthn credentials for all users
    if (webauthnAvailable) {
      promises.push(listCredentials().then(setWebauthnCreds).catch(() => {}))
    }
    if (isAdmin) {
      promises.push(
        getSpamSettings().then(setSpam),
        getCallSettings().then(setCallSet),
        getTranscriptionSettings().then(r => setGlobalTranscription(r.globalEnabled)),
        getIvrLanguages().then(r => setIvrEnabled(r.enabledLanguages)),
        listIvrAudio().then(r => setIvrAudio(r.recordings)),
        getWebAuthnSettings().then(setWebauthnSettings).catch(() => {}),
        getCustomFields().then(r => setCustomFieldDefs(r.fields)).catch(() => {}),
      )
    }
    if (promises.length > 0) {
      Promise.all(promises)
        .catch(() => toast(t('common.error'), 'error'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
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

  useEffect(() => {
    setProfileName(authName || '')
  }, [authName])

  useEffect(() => {
    setSelectedLanguages(spokenLanguages || ['en'])
  }, [spokenLanguages])

  async function handleUpdateProfile() {
    setProfileError('')
    if (profilePhone && !/^\+\d{7,15}$/.test(profilePhone)) {
      setProfileError(t('profileSettings.invalidPhone'))
      return
    }
    try {
      await updateMyProfile({
        spokenLanguages: selectedLanguages,
        ...(profileName && { name: profileName }),
        ...(profilePhone && { phone: profilePhone }),
      })
      await refreshProfile()
      toast(t('profileSettings.profileUpdated'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

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

  if (loading) {
    return <div className="text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold sm:text-2xl">{t('settings.title')}</h1>
      </div>

      {/* Profile */}
      <SettingsSection
        id="profile"
        title={t('profileSettings.profile')}
        description={t('profileSettings.profileDescription')}
        icon={<User className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('profile')}
        onToggle={(open) => toggleSection('profile', open)}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="profile-name">{t('profileSettings.displayName')}</Label>
            <Input
              id="profile-name"
              value={profileName}
              onChange={e => setProfileName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-phone">{t('profileSettings.phoneNumber')}</Label>
            <PhoneInput
              id="profile-phone"
              value={profilePhone}
              onChange={setProfilePhone}
            />
          </div>
        </div>

        {npub && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('profileSettings.yourPublicKey')}</p>
            <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">{npub}</code>
          </div>
        )}

        {profileError && (
          <p className="text-sm text-destructive">{profileError}</p>
        )}

        {/* Spoken languages */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Label>{t('profile.spokenLanguages')}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('profile.spokenLanguagesHelp')}</p>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map(lang => {
              const selected = selectedLanguages.includes(lang.code)
              return (
                <button
                  key={lang.code}
                  onClick={() => {
                    setSelectedLanguages(prev =>
                      selected
                        ? prev.filter(c => c !== lang.code)
                        : [...prev, lang.code]
                    )
                  }}
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    selected
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <span>{lang.flag}</span>
                  {lang.label}
                </button>
              )
            })}
          </div>
        </div>

        <Button onClick={handleUpdateProfile}>
          {t('profileSettings.updateProfile')}
        </Button>
      </SettingsSection>

      {/* Key Backup — admin only */}
      {isAdmin && (
        <SettingsSection
          id="key-backup"
          title={t('profileSettings.keyBackup')}
          description={t('profileSettings.keyBackupDescription')}
          icon={<KeyRound className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('key-backup')}
          onToggle={(open) => toggleSection('key-backup', open)}
        >
          <Button variant="outline" onClick={() => {
            if (!nsec || !keyPair) return
            const backup = JSON.stringify({
              version: 1,
              format: 'llamenos-key-backup',
              pubkey: keyPair.publicKey,
              nsec,
              createdAt: new Date().toISOString(),
            }, null, 2)
            const blob = new Blob([backup], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `llamenos-backup-${keyPair.publicKey.slice(0, 8)}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}>
            {t('onboarding.downloadBackup')}
          </Button>
        </SettingsSection>
      )}

      {/* Passkeys (WebAuthn) — all users */}
      {webauthnAvailable && (
        <SettingsSection
          id="passkeys"
          title={t('webauthn.title')}
          description={t('webauthn.description')}
          icon={<Fingerprint className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('passkeys')}
          onToggle={(open) => toggleSection('passkeys', open)}
        >
          {webauthnCreds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('webauthn.noKeys')}</p>
          ) : (
            <div className="space-y-2">
              {webauthnCreds.map(cred => (
                <div key={cred.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{cred.label}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">
                        {cred.backedUp
                          ? t('webauthn.syncedPasskey')
                          : t('webauthn.singleDevice')
                        }
                      </Badge>
                      <span>{t('webauthn.lastUsed')}: {new Date(cred.lastUsedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await deleteCredential(cred.id)
                        setWebauthnCreds(prev => prev.filter(c => c.id !== cred.id))
                        toast(t('common.success'), 'success')
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

          <div className="flex gap-2">
            <Input
              value={webauthnLabel}
              onChange={e => setWebauthnLabel(e.target.value)}
              placeholder={t('webauthn.label')}
              className="flex-1"
            />
            <Button
              onClick={async () => {
                if (!webauthnLabel.trim()) return
                setWebauthnRegistering(true)
                try {
                  await registerCredential(webauthnLabel.trim())
                  const updated = await listCredentials()
                  setWebauthnCreds(updated)
                  setWebauthnLabel('')
                  toast(t('webauthn.registerSuccess'), 'success')
                } catch {
                  toast(t('common.error'), 'error')
                } finally {
                  setWebauthnRegistering(false)
                }
              }}
              disabled={webauthnRegistering || !webauthnLabel.trim()}
            >
              <Plus className="h-4 w-4" />
              {t('webauthn.registerKey')}
            </Button>
          </div>
        </SettingsSection>
      )}

      {/* WebAuthn Policy (admin only) */}
      {isAdmin && webauthnSettings && (
        <SettingsSection
          id="passkey-policy"
          title={t('webauthn.policy')}
          description={t('webauthn.policyDescription')}
          icon={<Shield className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('passkey-policy')}
          onToggle={(open) => toggleSection('passkey-policy', open)}
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

      {/* Transcription */}
      <SettingsSection
        id="transcription"
        title={t('settings.transcriptionSettings')}
        description={t('settings.transcriptionDescription')}
        icon={<Mic className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('transcription')}
        onToggle={(open) => toggleSection('transcription', open)}
      >
        {isAdmin && (
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
        )}

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label>{t('transcription.enableForCalls')}</Label>
          </div>
          <Switch
            checked={myTranscription}
            onCheckedChange={async (checked) => {
              try {
                await updateMyTranscriptionPreference(checked)
                setMyTranscription(checked)
              } catch {
                toast(t('common.error'), 'error')
              }
            }}
          />
        </div>
      </SettingsSection>

      {/* Call Notifications */}
      <SettingsSection
        id="notifications"
        title={t('settings.notifications')}
        description={t('settings.notificationsDescription')}
        icon={<Bell className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('notifications')}
        onToggle={(open) => toggleSection('notifications', open)}
      >
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label>{t('settings.playRingtone')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.playRingtoneDescription')}</p>
          </div>
          <Switch
            checked={notifPrefs.ringtoneEnabled}
            onCheckedChange={(checked) => {
              const updated = setNotificationPrefs({ ringtoneEnabled: checked })
              setNotifPrefs(updated)
            }}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label>{t('settings.browserNotifications')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.browserNotificationsDescription')}</p>
          </div>
          <Switch
            checked={notifPrefs.browserNotificationsEnabled}
            onCheckedChange={(checked) => {
              const updated = setNotificationPrefs({ browserNotificationsEnabled: checked })
              setNotifPrefs(updated)
            }}
          />
        </div>
      </SettingsSection>

      {/* IVR Language Menu */}
      {isAdmin && (
        <SettingsSection
          id="ivr-languages"
          title={t('ivr.title')}
          description={t('ivr.description')}
          icon={<Phone className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('ivr-languages')}
          onToggle={(open) => toggleSection('ivr-languages', open)}
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
      )}

      {/* Call Settings */}
      {isAdmin && callSet && (
        <SettingsSection
          id="call-settings"
          title={t('callSettings.title')}
          description={t('callSettings.description')}
          icon={<PhoneForwarded className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('call-settings')}
          onToggle={(open) => toggleSection('call-settings', open)}
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
      {isAdmin && (
        <SettingsSection
          id="voice-prompts"
          title={t('ivrAudio.title')}
          description={t('ivrAudio.description')}
          icon={<Volume2 className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('voice-prompts')}
          onToggle={(open) => toggleSection('voice-prompts', open)}
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
      )}

      {/* Custom Note Fields (admin only) */}
      {isAdmin && (
        <SettingsSection
          id="custom-fields"
          title={t('customFields.title')}
          description={t('customFields.description')}
          icon={<StickyNote className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('custom-fields')}
          onToggle={(open) => toggleSection('custom-fields', open)}
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
      )}

      {/* Spam mitigation */}
      {isAdmin && spam && (
        <SettingsSection
          id="spam"
          title={t('spam.title')}
          icon={<ShieldAlert className="h-5 w-5 text-muted-foreground" />}
          expanded={expanded.has('spam')}
          onToggle={(open) => toggleSection('spam', open)}
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
