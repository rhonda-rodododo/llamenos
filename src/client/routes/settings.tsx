import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import {
  getSpamSettings,
  updateSpamSettings,
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
  type SpamSettings,
  type IvrAudioRecording,
} from '@/lib/api'
import { getStoredSession, keyPairFromNsec } from '@/lib/crypto'
import { nip19 } from 'nostr-tools'
import { useToast } from '@/lib/toast'
import { Settings2, Mic, ShieldAlert, Bot, Timer, Bell, User, KeyRound, Shield, Globe, Phone, Volume2 } from 'lucide-react'
import { AudioRecorder } from '@/components/audio-recorder'
import { getNotificationPrefs, setNotificationPrefs } from '@/lib/notifications'
import { LANGUAGES, IVR_LANGUAGES, LANGUAGE_MAP, ivrIndexToDigit } from '@shared/languages'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation()
  const { isAdmin, transcriptionEnabled, name: authName, spokenLanguages, refreshProfile } = useAuth()
  const { toast } = useToast()
  const [spam, setSpam] = useState<SpamSettings | null>(null)
  const [globalTranscription, setGlobalTranscription] = useState(false)
  const [myTranscription, setMyTranscription] = useState(transcriptionEnabled)
  const [notifPrefs, setNotifPrefs] = useState(getNotificationPrefs)
  const [ivrEnabled, setIvrEnabled] = useState<string[]>([...IVR_LANGUAGES])
  const [ivrAudio, setIvrAudio] = useState<IvrAudioRecording[]>([])
  const [audioSaving, setAudioSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
    if (isAdmin) {
      Promise.all([
        getSpamSettings().then(setSpam),
        getTranscriptionSettings().then(r => setGlobalTranscription(r.globalEnabled)),
        getIvrLanguages().then(r => setIvrEnabled(r.enabledLanguages)),
        listIvrAudio().then(r => setIvrAudio(r.recordings)),
      ]).catch(() => toast(t('common.error'), 'error'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [isAdmin])

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

  if (loading) {
    return <div className="text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold sm:text-2xl">{t('settings.title')}</h1>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-muted-foreground" />
            {t('profileSettings.profile')}
          </CardTitle>
          <CardDescription>{t('profileSettings.profileDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <Input
                id="profile-phone"
                value={profilePhone}
                onChange={e => setProfilePhone(e.target.value)}
                type="tel"
                placeholder="+12125551234"
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
        </CardContent>
      </Card>

      {/* Key Backup — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
              {t('profileSettings.keyBackup')}
            </CardTitle>
            <CardDescription>{t('profileSettings.keyBackupDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {/* Security Keys (WebAuthn) — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              {t('profileSettings.securityKeys')}
            </CardTitle>
            <CardDescription>{t('profileSettings.securityKeysDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              WebAuthn support coming soon.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Transcription */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-muted-foreground" />
            {t('settings.transcriptionSettings')}
          </CardTitle>
          <CardDescription>{t('settings.transcriptionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label>{t('settings.enableTranscription')}</Label>
                <p className="text-xs text-muted-foreground">{t('transcription.enabledGlobal')}</p>
              </div>
              <Switch
                checked={globalTranscription}
                onCheckedChange={async (checked) => {
                  try {
                    const res = await updateTranscriptionSettings({ globalEnabled: checked })
                    setGlobalTranscription(res.globalEnabled)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
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
        </CardContent>
      </Card>

      {/* Call Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-muted-foreground" />
            {t('settings.notifications')}
          </CardTitle>
          <CardDescription>{t('settings.notificationsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {/* IVR Language Menu */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-muted-foreground" />
              {t('ivr.title')}
            </CardTitle>
            <CardDescription>{t('ivr.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
          </CardContent>
        </Card>
      )}

      {/* Voice Prompts (IVR Audio) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-5 w-5 text-muted-foreground" />
              {t('ivrAudio.title')}
            </CardTitle>
            <CardDescription>{t('ivrAudio.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
      )}

      {/* Spam mitigation */}
      {isAdmin && spam && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              {t('spam.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                onCheckedChange={async (checked) => {
                  try {
                    const res = await updateSpamSettings({ voiceCaptchaEnabled: checked })
                    setSpam(res)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
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
                onCheckedChange={async (checked) => {
                  try {
                    const res = await updateSpamSettings({ rateLimitEnabled: checked })
                    setSpam(res)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}
