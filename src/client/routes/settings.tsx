import { PhoneInput } from '@/components/phone-input'
import { SettingsSection, usePersistedExpanded } from '@/components/settings-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  cancelAccountErasure,
  downloadMyData,
  getMyErasureRequest,
  getTranscriptionSettings,
  getWebRtcStatus,
  requestAccountErasure,
  updateMyProfile,
  updateMyTranscriptionPreference,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { authFacadeClient } from '@/lib/auth-facade-client'
import { cryptoWorker } from '@/lib/crypto-worker-client'
import { createDebugLog } from '@/lib/debug-log'
import { getNotificationPrefs, setNotificationPrefs } from '@/lib/notifications'
import { getProvisioningRoom, packProvisionPayload, sendProvisionedKey } from '@/lib/provisioning'
import {
  isPushSubscribed,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push-subscription'
import { useWebAuthnCreds } from '@/lib/queries/settings'
import { useToast } from '@/lib/toast'
import {
  TranscriptionManager,
  type TranscriptionModel,
  getClientTranscriptionSettings,
  setClientTranscriptionSettings,
} from '@/lib/transcription'
import { useNotificationPermission } from '@/lib/use-notification-permission'
import { deleteCredential, isWebAuthnAvailable, registerCredential } from '@/lib/webauthn'
import { LANGUAGES } from '@shared/languages'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import {
  Bell,
  CheckCircle2,
  Fingerprint,
  Globe,
  KeyRound,
  Loader2,
  MessageSquare,
  Mic,
  Monitor,
  Phone,
  PhoneCall,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
} from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const log = createDebugLog('llamenos:settings')

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    section: (search.section as string) || '',
  }),
})

function SettingsPage() {
  const { t } = useTranslation()
  const { section } = useSearch({ from: '/settings' })
  const {
    transcriptionEnabled,
    name: authName,
    spokenLanguages,
    callPreference,
    refreshProfile,
    publicKey,
  } = useAuth()
  const { toast } = useToast()
  const [myTranscription, setMyTranscription] = useState(transcriptionEnabled)
  const [notifPrefs, setNotifPrefs] = useState(getNotificationPrefs)
  const [loading, setLoading] = useState(true)
  const [canOptOut, setCanOptOut] = useState(true)
  const { data: webAuthnCreds = [], refetch: refetchWebAuthnCreds } = useWebAuthnCreds()
  const [webauthnLabel, setWebauthnLabel] = useState('')
  const [webauthnRegistering, setWebauthnRegistering] = useState(false)
  const webauthnAvailable = isWebAuthnAvailable()
  const [currentCallPref, setCurrentCallPref] = useState<'phone' | 'browser' | 'both'>(
    callPreference
  )
  const [webrtcAvailable, setWebrtcAvailable] = useState(false)
  const pushSupported = isPushSupported()
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushToggling, setPushToggling] = useState(false)

  // Collapsible state — persisted in sessionStorage, profile expanded by default
  const { expanded, toggleSection } = usePersistedExpanded(
    'settings-expanded:/settings',
    ['profile', 'key-backup'],
    section || undefined
  )
  const scrolledRef = useRef(false)

  // Profile state
  const [profileName, setProfileName] = useState(authName || '')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileError, setProfileError] = useState('')
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(spokenLanguages || ['en'])

  // Get npub for display — use publicKey from auth context (already resolved)
  const npub = publicKey ? nip19.npubEncode(publicKey) : ''

  useEffect(() => {
    const promises: Promise<void>[] = [
      getTranscriptionSettings()
        .then((r) => {
          setCanOptOut(r.allowUserOptOut)
        })
        .catch(() => {}),
      getWebRtcStatus()
        .then((r) => {
          setWebrtcAvailable(r.available)
        })
        .catch(() => {}),
      isPushSubscribed()
        .then((subscribed) => setPushSubscribed(subscribed))
        .catch(() => {}),
    ]
    Promise.all(promises)
      .catch(() => toast(t('common.error'), 'error'))
      .finally(() => setLoading(false))
  }, [])

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

  useEffect(() => {
    setCurrentCallPref(callPreference)
  }, [callPreference])

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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-primary" />
        <h1 data-testid="settings-heading" className="text-xl font-bold sm:text-2xl">
          {t('settings.title')}
        </h1>
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
              onChange={(e) => setProfileName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-phone">{t('profileSettings.phoneNumber')}</Label>
            <PhoneInput id="profile-phone" value={profilePhone} onChange={setProfilePhone} />
          </div>
        </div>

        {npub && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('profileSettings.yourPublicKey')}</p>
            <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">{npub}</code>
          </div>
        )}

        {profileError && <p className="text-sm text-destructive">{profileError}</p>}

        {/* Spoken languages */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Label>{t('profile.spokenLanguages')}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('profile.spokenLanguagesHelp')}</p>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((lang) => {
              const selected = selectedLanguages.includes(lang.code)
              return (
                <button
                  key={lang.code}
                  onClick={() => {
                    setSelectedLanguages((prev) =>
                      selected ? prev.filter((c) => c !== lang.code) : [...prev, lang.code]
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

        <Button onClick={handleUpdateProfile}>{t('profileSettings.updateProfile')}</Button>
      </SettingsSection>

      {/* Key Backup */}
      <SettingsSection
        id="key-backup"
        title={t('profileSettings.keyBackup')}
        description={t('profileSettings.keyBackupDescription')}
        icon={<KeyRound className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('key-backup')}
        onToggle={(open) => toggleSection('key-backup', open)}
      >
        <p className="text-sm text-muted-foreground">
          {t('profileSettings.keyBackupNote', {
            defaultValue:
              'Download a backup from the onboarding flow or use your recovery key to restore access on a new device.',
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {npub
            ? `${t('profileSettings.publicKey', { defaultValue: 'Public key' })}: ${npub.slice(0, 16)}...`
            : ''}
        </p>
      </SettingsSection>

      {/* Link Device */}
      <SettingsSection
        id="linked-devices"
        title={t('deviceLink.linkedDevices')}
        description={t('deviceLink.linkedDevicesDesc')}
        icon={<Smartphone className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('linked-devices')}
        onToggle={(open) => toggleSection('linked-devices', open)}
      >
        <LinkDeviceSection />
      </SettingsSection>

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
          {webAuthnCreds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('webauthn.noKeys')}</p>
          ) : (
            <div className="space-y-2">
              {webAuthnCreds.map((cred) => (
                <div
                  key={cred.id}
                  data-testid="passkey-credential-row"
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{cred.label || cred.id.slice(0, 8)}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">
                        {cred.backedUp ? t('webauthn.syncedPasskey') : t('webauthn.singleDevice')}
                      </Badge>
                      <span>
                        {t('webauthn.lastUsed')}: {new Date(cred.lastUsedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="passkey-delete-btn"
                    onClick={async () => {
                      try {
                        await deleteCredential(cred.id)
                        void refetchWebAuthnCreds()
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
              data-testid="passkey-label-input"
              value={webauthnLabel}
              onChange={(e) => setWebauthnLabel(e.target.value)}
              placeholder={t('webauthn.label')}
              className="flex-1"
            />
            <Button
              data-testid="passkey-register-btn"
              onClick={async () => {
                if (!webauthnLabel.trim()) return
                setWebauthnRegistering(true)
                try {
                  await registerCredential(webauthnLabel.trim())
                  void refetchWebAuthnCreds()
                  setWebauthnLabel('')
                  toast(t('webauthn.registerSuccess'), 'success')
                } catch (err) {
                  log('passkey-register failed:', err instanceof Error ? err.message : 'unknown')
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

      {/* Transcription (personal toggle + client-side settings) */}
      <SettingsSection
        id="transcription"
        title={t('settings.transcriptionSettings')}
        description={t('settings.transcriptionDescription')}
        icon={<Mic className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('transcription')}
        onToggle={(open) => toggleSection('transcription', open)}
      >
        {canOptOut ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">{t('transcription.managedByAdmin')}</p>
        )}

        <ClientTranscriptionSettings />
      </SettingsSection>

      {/* Call Preference (WebRTC) */}
      <SettingsSection
        id="call-preference"
        title={t('settings.callPreference')}
        description={t('settings.callPreferenceDescription')}
        icon={<PhoneCall className="h-5 w-5 text-muted-foreground" />}
        expanded={expanded.has('call-preference')}
        onToggle={(open) => toggleSection('call-preference', open)}
      >
        {!webrtcAvailable && (
          <p className="text-sm text-muted-foreground">{t('settings.webrtcNotConfigured')}</p>
        )}
        <div className="space-y-2">
          {[
            {
              value: 'phone' as const,
              icon: Phone,
              label: t('settings.callPrefPhone'),
              desc: t('settings.callPrefPhoneDesc'),
            },
            {
              value: 'browser' as const,
              icon: Monitor,
              label: t('settings.callPrefBrowser'),
              desc: t('settings.callPrefBrowserDesc'),
            },
            {
              value: 'both' as const,
              icon: PhoneCall,
              label: t('settings.callPrefBoth'),
              desc: t('settings.callPrefBothDesc'),
            },
          ].map((option) => (
            <button
              key={option.value}
              disabled={option.value !== 'phone' && !webrtcAvailable}
              onClick={async () => {
                // Request mic permission when switching to browser or both
                if (option.value === 'browser' || option.value === 'both') {
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                    stream.getTracks().forEach((t) => t.stop())
                  } catch {
                    // Still allow the preference change — just-in-time check at answer time will catch it
                    toast(t('settings.micPermissionRequired'), 'info')
                  }
                }
                try {
                  setCurrentCallPref(option.value)
                  await updateMyProfile({ callPreference: option.value })
                  await refreshProfile()
                  toast(t('common.success'), 'success')
                } catch {
                  setCurrentCallPref(callPreference) // revert
                  toast(t('common.error'), 'error')
                }
              }}
              className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                currentCallPref === option.value
                  ? 'border-primary bg-primary/5'
                  : option.value !== 'phone' && !webrtcAvailable
                    ? 'cursor-not-allowed border-border opacity-50'
                    : 'border-border hover:border-primary/50'
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  currentCallPref === option.value
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <option.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${currentCallPref === option.value ? 'text-primary' : ''}`}
                >
                  {option.label}
                </p>
                <p className="text-xs text-muted-foreground">{option.desc}</p>
              </div>
              {currentCallPref === option.value && (
                <div className="h-2.5 w-2.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
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
            <p className="text-xs text-muted-foreground">
              {t('settings.browserNotificationsDescription')}
            </p>
          </div>
          <Switch
            checked={notifPrefs.browserNotificationsEnabled}
            onCheckedChange={(checked) => {
              const updated = setNotificationPrefs({ browserNotificationsEnabled: checked })
              setNotifPrefs(updated)
            }}
          />
        </div>
        <PushNotificationToggle
          supported={pushSupported}
          subscribed={pushSubscribed}
          toggling={pushToggling}
          onToggle={async (enable) => {
            setPushToggling(true)
            try {
              if (enable) {
                const ok = await subscribeToPush()
                if (ok) {
                  setPushSubscribed(true)
                  toast(
                    t('notifications.pushEnabled', { defaultValue: 'Push notifications enabled' }),
                    'success'
                  )
                } else {
                  toast(
                    t('notifications.pushEnableFailed', {
                      defaultValue:
                        'Could not enable push notifications. Grant notification permission first.',
                    }),
                    'error'
                  )
                }
              } else {
                await unsubscribeFromPush()
                setPushSubscribed(false)
                toast(
                  t('notifications.pushDisabled', { defaultValue: 'Push notifications disabled' }),
                  'success'
                )
              }
            } catch {
              toast(t('common.error'), 'error')
            } finally {
              setPushToggling(false)
            }
          }}
        />
        <NotificationPermissionStatus />
      </SettingsSection>

      {/* Signal Contact */}
      <SignalContactSection expanded={expanded} toggleSection={toggleSection} />

      {/* Notification Channel */}
      <NotificationChannelSection expanded={expanded} toggleSection={toggleSection} />

      {/* Privacy & Data */}
      <GdprSection />
    </div>
  )
}

function GdprSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [exportLoading, setExportLoading] = useState(false)
  const [erasureRequest, setErasureRequest] = useState<import('@/lib/api').ErasureRequest | null>(
    null
  )
  const [erasureLoading, setErasureLoading] = useState(false)
  const [erasureChecked, setErasureChecked] = useState(false)
  const { expanded, toggleSection } = usePersistedExpanded('settings-expanded:/settings/gdpr', [])

  useEffect(() => {
    getMyErasureRequest()
      .then((req) => setErasureRequest(req))
      .catch(() => {})
      .finally(() => setErasureChecked(true))
  }, [])

  async function handleExport() {
    setExportLoading(true)
    try {
      await downloadMyData()
    } catch {
      toast(t('gdpr.exportError'), 'error')
    } finally {
      setExportLoading(false)
    }
  }

  async function handleRequestErasure() {
    setErasureLoading(true)
    try {
      const req = await requestAccountErasure()
      setErasureRequest(req)
      toast(t('gdpr.erasureRequested'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setErasureLoading(false)
    }
  }

  async function handleCancelErasure() {
    setErasureLoading(true)
    try {
      await cancelAccountErasure()
      setErasureRequest(null)
      toast(t('gdpr.erasureCancelled'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setErasureLoading(false)
    }
  }

  const hoursUntilErasure = erasureRequest
    ? Math.max(
        0,
        Math.round((new Date(erasureRequest.executeAt).getTime() - Date.now()) / 3_600_000)
      )
    : 0

  return (
    <SettingsSection
      id="privacy"
      title={t('gdpr.title')}
      description={t('gdpr.exportDescription')}
      icon={<ShieldCheck className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded.has('privacy')}
      onToggle={(open) => toggleSection('privacy', open)}
    >
      {/* Data Export */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('gdpr.exportTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('gdpr.exportDescription')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exportLoading}
          data-testid="gdpr-export-button"
        >
          {exportLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('gdpr.exportLoading')}
            </>
          ) : (
            t('gdpr.exportButton')
          )}
        </Button>
      </div>

      <div className="border-t border-border pt-4 space-y-2">
        <h3 className="text-sm font-medium text-destructive">{t('gdpr.erasureTitle')}</h3>
        {erasureChecked && erasureRequest && erasureRequest.status === 'pending' ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
            <p className="text-sm text-destructive">
              {t('gdpr.erasureCountdown', { hours: hoursUntilErasure })}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelErasure}
              disabled={erasureLoading}
              data-testid="gdpr-cancel-erasure-button"
            >
              {t('gdpr.erasureCancelButton')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('gdpr.erasureDescription')}</p>
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">{t('gdpr.erasureWarning')}</p>
              <ul className="list-inside list-disc space-y-0.5 pl-2">
                <li>{t('gdpr.erasureWarningItems.profile')}</li>
                <li>{t('gdpr.erasureWarningItems.sessions')}</li>
                <li>{t('gdpr.erasureWarningItems.notes')}</li>
                <li>{t('gdpr.erasureWarningItems.shifts')}</li>
                <li>{t('gdpr.erasureWarningItems.auditEntries')}</li>
              </ul>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRequestErasure}
              disabled={erasureLoading}
              data-testid="gdpr-request-erasure-button"
            >
              {t('gdpr.erasureButton')}
            </Button>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}

function SignalContactSection({
  expanded,
  toggleSection,
}: {
  expanded: Set<string>
  toggleSection: (id: string, open: boolean) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { publicKey } = useAuth()

  const [contact, setContact] = useState<{
    identifierType: 'phone' | 'username'
    identifierCiphertext: string
    verifiedAt: string | null
  } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [identifierType, setIdentifierType] = useState<'phone' | 'username'>('phone')
  const [identifier, setIdentifier] = useState('')
  const [registering, setRegistering] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    authFacadeClient
      .getSignalContact()
      .then((res) => {
        if (res.contact) {
          setContact({
            identifierType: res.contact.identifierType,
            identifierCiphertext: res.contact.identifierCiphertext,
            verifiedAt: res.contact.verifiedAt,
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  async function handleRegister() {
    if (!identifier.trim() || !publicKey) return
    setRegistering(true)
    try {
      const { normalizeSignalIdentifier } = await import('@shared/signal-identifier-normalize')
      const normalized = normalizeSignalIdentifier(identifier, identifierType)

      // Get HMAC key for hashing
      const { key: hmacKey } = await authFacadeClient.getSignalContactHmacKey()

      // Hash the identifier client-side
      const { hmac } = await import('@noble/hashes/hmac.js')
      const { sha256 } = await import('@noble/hashes/sha2.js')
      const { utf8ToBytes, bytesToHex } = await import('@noble/hashes/utils.js')
      const identifierHash = bytesToHex(hmac(sha256, utf8ToBytes(hmacKey), utf8ToBytes(normalized)))

      // Envelope-encrypt the identifier for self
      const { LABEL_SIGNAL_CONTACT } = await import('@shared/crypto-labels')
      const { encryptedHex, envelopes } = await cryptoWorker.envelopeEncryptField(
        normalized,
        [publicKey],
        LABEL_SIGNAL_CONTACT,
        utf8ToBytes(LABEL_SIGNAL_CONTACT)
      )

      await authFacadeClient.registerSignalContact({
        identifierHash,
        identifierCiphertext: encryptedHex,
        identifierEnvelope: envelopes.map((e) => ({
          pubkey: e.recipientPubkey,
          wrappedKey: e.wrappedKeyHex as import('@shared/crypto-types').Ciphertext,
          ephemeralPubkey: e.ephemeralPubkeyHex,
        })),
        identifierType,
        plaintextIdentifier: normalized,
      })

      setContact({
        identifierType,
        identifierCiphertext: encryptedHex,
        verifiedAt: new Date().toISOString(),
      })
      setIdentifier('')
      toast(t('settings.signalContactRegistered_success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setRegistering(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await authFacadeClient.deleteSignalContact()
      setContact(null)
      toast(t('settings.signalContactDeleted'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <SettingsSection
      id="signal-contact"
      title={t('settings.signalContact')}
      description={t('settings.signalContactDescription')}
      icon={<MessageSquare className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded.has('signal-contact')}
      onToggle={(open) => toggleSection('signal-contact', open)}
    >
      {!loaded ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : contact ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>{t('settings.signalContactRegistered')}</Label>
                {contact.verifiedAt && (
                  <Badge variant="outline" className="text-green-600 border-green-500/30">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    {t('settings.signalContactVerified')}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {contact.identifierType === 'phone'
                  ? t('settings.signalContactPhone')
                  : t('settings.signalContactUsername')}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              data-testid="signal-contact-delete"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('settings.signalContactNone')}</p>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant={identifierType === 'phone' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIdentifierType('phone')}
                data-testid="signal-type-phone"
              >
                {t('settings.signalContactPhone')}
              </Button>
              <Button
                variant={identifierType === 'username' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIdentifierType('username')}
                data-testid="signal-type-username"
              >
                {t('settings.signalContactUsername')}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  identifierType === 'phone'
                    ? t('settings.signalContactIdentifierPhonePlaceholder')
                    : t('settings.signalContactIdentifierUsernamePlaceholder')
                }
                data-testid="signal-identifier-input"
              />
              <Button
                onClick={handleRegister}
                disabled={registering || !identifier.trim()}
                data-testid="signal-register-button"
              >
                {registering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('settings.signalContactRegistering')}
                  </>
                ) : (
                  t('settings.signalContactRegister')
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

function NotificationChannelSection({
  expanded,
  toggleSection,
}: {
  expanded: Set<string>
  toggleSection: (id: string, open: boolean) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [channel, setChannel] = useState<'web_push' | 'signal'>('web_push')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasSignalContact, setHasSignalContact] = useState(false)

  useEffect(() => {
    Promise.all([
      authFacadeClient.getSecurityPrefs().then((prefs) => {
        setChannel(prefs.notificationChannel as 'web_push' | 'signal')
      }),
      authFacadeClient.getSignalContact().then((res) => {
        setHasSignalContact(res.contact !== null)
      }),
    ])
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  async function handleChannelChange(newChannel: 'web_push' | 'signal') {
    if (newChannel === 'signal' && !hasSignalContact) {
      toast(t('settings.notificationChannelSignalNoContact'), 'error')
      return
    }
    setSaving(true)
    try {
      await authFacadeClient.updateSecurityPrefs({ notificationChannel: newChannel })
      setChannel(newChannel)
      toast(t('settings.notificationChannelSaved'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const options = [
    {
      value: 'web_push' as const,
      label: t('settings.notificationChannelWebPush'),
      desc: t('settings.notificationChannelWebPushDesc'),
      icon: Bell,
    },
    {
      value: 'signal' as const,
      label: t('settings.notificationChannelSignal'),
      desc: t('settings.notificationChannelSignalDesc'),
      icon: MessageSquare,
      disabled: !hasSignalContact,
    },
  ]

  return (
    <SettingsSection
      id="notification-channel"
      title={t('settings.notificationChannel')}
      description={t('settings.notificationChannelDescription')}
      icon={<Radio className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded.has('notification-channel')}
      onToggle={(open) => toggleSection('notification-channel', open)}
    >
      {!loaded ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <div className="space-y-2">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={saving || option.disabled}
              data-testid={`notification-channel-${option.value}`}
              onClick={() => handleChannelChange(option.value)}
              className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                channel === option.value
                  ? 'border-primary bg-primary/5'
                  : option.disabled
                    ? 'cursor-not-allowed border-border opacity-50'
                    : 'border-border hover:border-primary/50'
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  channel === option.value
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <option.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${channel === option.value ? 'text-primary' : ''}`}
                >
                  {option.label}
                </p>
                <p className="text-xs text-muted-foreground">{option.desc}</p>
              </div>
              {channel === option.value && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
            </button>
          ))}
          {!hasSignalContact && (
            <p className="text-xs text-muted-foreground">
              {t('settings.notificationChannelSignalNoContact')}
            </p>
          )}
        </div>
      )}
    </SettingsSection>
  )
}

function NotificationPermissionStatus() {
  const { t } = useTranslation()
  const { permission, requestPermission } = useNotificationPermission()

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t('notifications.permissionStatus')}</Label>
          {permission === 'granted' && (
            <p className="text-xs text-muted-foreground">{t('notifications.statusGranted')}</p>
          )}
          {permission === 'default' && (
            <p className="text-xs text-muted-foreground">{t('notifications.statusDefault')}</p>
          )}
          {permission === 'denied' && (
            <p className="text-xs text-muted-foreground">{t('notifications.statusDenied')}</p>
          )}
          {permission === 'unsupported' && (
            <p className="text-xs text-muted-foreground">{t('notifications.statusUnsupported')}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {permission === 'granted' && (
            <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              {t('notifications.granted')}
            </Badge>
          )}
          {permission === 'default' && (
            <>
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
              >
                {t('notifications.default')}
              </Badge>
              <Button size="sm" variant="outline" onClick={() => requestPermission()}>
                {t('notifications.enablePermission')}
              </Button>
            </>
          )}
          {permission === 'denied' && (
            <Badge
              variant="outline"
              className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
            >
              {t('notifications.denied')}
            </Badge>
          )}
          {permission === 'unsupported' && (
            <Badge variant="outline" className="text-muted-foreground">
              {t('notifications.unsupported')}
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}

function PushNotificationToggle({
  supported,
  subscribed,
  toggling,
  onToggle,
}: {
  supported: boolean
  subscribed: boolean
  toggling: boolean
  onToggle: (enable: boolean) => Promise<void>
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-4">
      <div className="space-y-0.5">
        <Label>{t('settings.pushNotifications', { defaultValue: 'Push Notifications' })}</Label>
        {!supported ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.pushNotificationsUnsupported', {
              defaultValue: 'Push notifications are not supported in this browser.',
            })}
          </p>
        ) : subscribed ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.pushNotificationsEnabled', {
              defaultValue: 'Receive notifications even when the app is in the background.',
            })}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('settings.pushNotificationsDisabled', {
              defaultValue:
                'Enable to receive call alerts when the app is closed or in the background.',
            })}
          </p>
        )}
      </div>
      <Switch
        disabled={!supported || toggling}
        checked={subscribed}
        onCheckedChange={(checked) => onToggle(checked)}
        data-testid="push-notifications-toggle"
      />
    </div>
  )
}

function LinkDeviceSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [linkCode, setLinkCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'linking' | 'verify-sas' | 'success' | 'error'>(
    'idle'
  )
  const [statusMessage, setStatusMessage] = useState('')
  const [sasCode, setSasCode] = useState('')

  async function handleLinkDevice() {
    if (!linkCode.trim()) return
    setStatus('linking')
    try {
      // Parse the code — could be JSON from QR or short code (roomId prefix)
      let roomId: string
      let token: string
      try {
        const parsed = JSON.parse(linkCode)
        roomId = parsed.r
        token = parsed.t
      } catch {
        // Treat as short code — but we need the full roomId
        // Short codes aren't enough; user must paste the full QR data or use camera
        setStatus('error')
        setStatusMessage(t('deviceLink.invalidCode'))
        return
      }

      // Fetch room to get ephemeral pubkey
      const room = await getProvisioningRoom(roomId, token)
      if (room.status !== 'waiting') {
        setStatus('error')
        setStatusMessage(t('deviceLink.linkExpired'))
        return
      }

      // Encrypt the nsec inside the worker via ECDH with the new device's ephemeral pubkey.
      // The worker also computes the SAS from the shared secret — both devices derive the
      // same 6-digit code independently, confirming no MITM is present.
      const workerResult = await cryptoWorker.provisionNsec(room.ephemeralPubkey)

      // Pack into wire format and send
      const { encryptedNsec, primaryPubkey } = packProvisionPayload(workerResult)
      const accessToken = authFacadeClient.getAccessToken()
      const authHeaders: Record<string, string> = accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {}
      await sendProvisionedKey(roomId, accessToken ?? '', encryptedNsec, primaryPubkey, authHeaders)

      // Show SAS for user to verify against the new device's display
      setSasCode(workerResult.sas)
      setStatusMessage(t('deviceLink.keySent'))
      setStatus('verify-sas')
    } catch {
      setStatus('error')
      setStatusMessage(t('deviceLink.linkFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('deviceLink.linkFromPrimary')}</p>

      {status === 'idle' || status === 'error' ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="link-code">{t('deviceLink.enterCode')}</Label>
            <div className="flex gap-2">
              <Input
                id="link-code"
                value={linkCode}
                onChange={(e) => setLinkCode(e.target.value)}
                placeholder={t('deviceLink.codePlaceholder')}
                className="font-mono"
                data-testid="link-code-input"
              />
              <Button
                onClick={handleLinkDevice}
                disabled={!linkCode.trim()}
                data-testid="link-device-button"
              >
                <Smartphone className="h-4 w-4" />
                {t('deviceLink.link')}
              </Button>
            </div>
          </div>
          {status === 'error' && <p className="text-sm text-destructive">{statusMessage}</p>}
        </div>
      ) : status === 'linking' ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : status === 'verify-sas' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{statusMessage}</p>
          <div
            className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 text-center"
            data-testid="primary-sas-code"
          >
            <p className="text-xs text-muted-foreground mb-1">{t('deviceLink.securityCode')}</p>
            <p className="text-3xl font-mono font-bold tracking-[0.3em]">{sasCode}</p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setStatus('idle')
              setLinkCode('')
              setSasCode('')
            }}
          >
            {t('common.done')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {statusMessage}
        </div>
      )}
    </div>
  )
}

function ClientTranscriptionSettings() {
  const { t } = useTranslation()
  const isSupported = TranscriptionManager.isSupported()
  const [settings, setSettings] = useState(getClientTranscriptionSettings)

  function update(changes: Partial<typeof settings>) {
    const updated = setClientTranscriptionSettings(changes)
    setSettings(updated)
  }

  const models: { value: TranscriptionModel; label: string }[] = [
    { value: 'tiny.en', label: t('transcription.modelTinyEn') },
    { value: 'tiny', label: t('transcription.modelTiny') },
    { value: 'base.en', label: t('transcription.modelBaseEn') },
    { value: 'base', label: t('transcription.modelBase') },
  ]

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-border p-4">
      <div>
        <h4 className="text-sm font-medium">{t('transcription.clientSide')}</h4>
        <p className="text-xs text-muted-foreground">{t('transcription.clientSideDescription')}</p>
      </div>

      {!isSupported ? (
        <p className="text-sm text-destructive">{t('transcription.notSupported')}</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Label htmlFor="client-transcription-toggle" className="text-sm">
              {t('transcription.enableClientSide')}
            </Label>
            <Switch
              id="client-transcription-toggle"
              data-testid="client-transcription-toggle"
              checked={settings.enabled}
              onCheckedChange={(checked) => update({ enabled: checked })}
            />
          </div>

          {settings.enabled && (
            <>
              <div className="space-y-2">
                <Label className="text-sm">{t('transcription.model')}</Label>
                <div className="space-y-1.5">
                  {models.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => update({ model: m.value })}
                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        settings.model === m.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      {settings.model === m.value && (
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      )}
                      <span className={settings.model !== m.value ? 'ml-4' : ''}>{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2">
                <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('transcription.localMicOnly')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('transcription.localMicOnlyDescription')}
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
