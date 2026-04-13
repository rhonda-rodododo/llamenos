import type { Ciphertext } from '@shared/crypto-types'
import type { Permission, PermissionMeta } from '@shared/permissions'
import type { GeocodingConfig, RetentionSettings, TelephonyProviderConfig } from '@shared/schemas'
import type {
  CustomFieldDefinition,
  GeocodingConfigAdmin,
  LocationResult,
  MessagingConfig,
  TelephonyProviderType,
} from '@shared/types'
import {
  API_BASE,
  ApiError,
  fireApiActivity,
  fireAuthExpired,
  getAuthHeaders,
  request,
} from './client'

export type { CustomFieldDefinition } from '@shared/types'
export type { TelephonyProviderConfig } from '@shared/schemas'
export type { TelephonyProviderType } from '@shared/types'
export type { EnabledChannels } from '@shared/schemas'
export type { MessagingConfig } from '@shared/types'
export type { SetupState } from '@shared/schemas'
import type { SetupState } from '@shared/schemas'
export type { GeocodingConfig } from '@shared/schemas'
export type { GeocodingConfigAdmin, LocationResult } from '@shared/types'
export type { RetentionSettings } from '@shared/schemas'

// --- Types ---

export interface SpamSettings {
  voiceCaptchaEnabled: boolean
  rateLimitEnabled: boolean
  maxCallsPerMinute: number
  blockDurationMinutes: number
  captchaMaxAttempts: number
}

export interface CallSettings {
  queueTimeoutSeconds: number
  voicemailMaxSeconds: number
  voicemailMaxBytes: number
  voicemailMode: 'auto' | 'always' | 'never'
  voicemailRetentionDays: number | null
  callRecordingMaxBytes: number
  /**
   * Tier 5 — hub-level policy for WebRTC voice call SFrame E2EE.
   * - `required`  — refuse calls that cannot negotiate SFrame
   * - `preferred` — (default) show active-consent modal on fallback
   * - `off`       — never attempt SFrame (plaintext SRTP only)
   */
  voiceCallE2eePolicy: 'required' | 'preferred' | 'off'
}

export interface WebAuthnSettings {
  requireForAdmins: boolean
  requireForUsers: boolean
}

export interface HealthCheckResult {
  provider: string
  channel?: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  lastCheck: string
  consecutiveFailures: number
  error?: string
}

export interface ProviderHealthStatus {
  telephony: HealthCheckResult | null
  messaging: Record<string, HealthCheckResult>
  lastFullCheck: string
}

export interface IvrAudioRecording {
  promptType: string
  language: string
  size: number
  uploadedAt: string
}

export interface RoleDefinition {
  id: string
  name: string
  permissions: string[]
  isDefault: boolean
  isSystem: boolean
  description: string
  /** Hub-key encrypted name (hex ciphertext). */
  encryptedName?: Ciphertext
  /** Hub-key encrypted description (hex ciphertext). */
  encryptedDescription?: Ciphertext
  createdAt: string
  updatedAt: string
}

// --- Provider OAuth & Phone Numbers ---

export interface OAuthStartResponse {
  stateToken: string
  provider: string
  mode: 'oauth' | 'manual'
  redirectUrl?: string
  message?: string
  signupUrl: string
  docsUrl: string
}

export interface OAuthStatusResponse {
  provider: string
  status: 'pending' | 'connected' | 'error' | 'expired'
  accountSid?: string
  error?: string
  connectedAt?: string
}

export interface ProviderPhoneNumber {
  phoneNumber: string
  friendlyName: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  locality?: string
  region?: string
  country: string
}

export interface AvailablePhoneNumber extends ProviderPhoneNumber {
  monthlyPrice?: string
}

export interface ProviderCredentials {
  provider: TelephonyProviderType
  accountSid?: string
  authToken?: string
  signalwireSpace?: string
  apiKey?: string
  apiSecret?: string
  applicationId?: string
  authId?: string
  ariUrl?: string
  ariUsername?: string
  ariPassword?: string
}

// --- Signal Registration ---

export interface SignalRegistrationResponse {
  ok: boolean
  method: 'sms' | 'voice'
}

export interface SignalRegistrationStatus {
  status: 'idle' | 'pending' | 'complete' | 'failed'
  method?: 'sms' | 'voice'
  expiresAt?: string
  error?: string
}

// --- Spam Mitigation ---

export async function getSpamSettings() {
  return request<SpamSettings>('/settings/spam')
}

export async function updateSpamSettings(data: Partial<SpamSettings>) {
  return request<SpamSettings>('/settings/spam', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Call Settings ---

export async function getCallSettings() {
  return request<CallSettings>('/settings/call')
}

export async function updateCallSettings(data: Partial<CallSettings>) {
  return request<CallSettings>('/settings/call', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- IVR Language Settings ---

export async function getIvrLanguages() {
  return request<{ enabledLanguages: string[] }>('/settings/ivr-languages')
}

export async function updateIvrLanguages(data: { enabledLanguages: string[] }) {
  return request<{ enabledLanguages: string[] }>('/settings/ivr-languages', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Transcription Settings ---

export async function getTranscriptionSettings() {
  return request<{ globalEnabled: boolean; allowUserOptOut: boolean }>('/settings/transcription')
}

export async function updateTranscriptionSettings(data: {
  globalEnabled?: boolean
  allowUserOptOut?: boolean
}) {
  return request<{ globalEnabled: boolean; allowUserOptOut: boolean }>('/settings/transcription', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- IVR Audio ---

export async function listIvrAudio() {
  return request<{ recordings: IvrAudioRecording[] }>('/settings/ivr-audio')
}

export async function uploadIvrAudio(promptType: string, language: string, audioBlob: Blob) {
  const res = await fetch(`${API_BASE}/settings/ivr-audio/${promptType}/${language}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': audioBlob.type || 'audio/webm',
    },
    body: audioBlob,
  })
  if (!res.ok) {
    if (res.status === 401) {
      fireAuthExpired()
    }
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<{ ok: true }>
}

export async function deleteIvrAudio(promptType: string, language: string) {
  return request<{ ok: true }>(`/settings/ivr-audio/${promptType}/${language}`, {
    method: 'DELETE',
  })
}

export function getIvrAudioUrl(promptType: string, language: string) {
  return `${API_BASE}/ivr-audio/${promptType}/${language}`
}

// --- Custom Fields ---

export async function getCustomFields() {
  return request<{ fields: CustomFieldDefinition[] }>('/settings/custom-fields')
}

export async function updateCustomFields(fields: CustomFieldDefinition[]) {
  return request<{ fields: CustomFieldDefinition[] }>('/settings/custom-fields', {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  })
}

// --- Provider Health Status ---

export async function getProviderHealth() {
  return request<ProviderHealthStatus>('/settings/provider-health')
}

// --- System Health (public, no auth required) ---

export interface SystemHealthStatus {
  status: 'ok' | 'degraded'
  checks: Record<string, 'ok' | 'failing'>
  details?: Record<string, string>
  version: string
  uptime: number | null
  backup?: {
    lastSuccessAt: string
    lastSizeBytes: number
    file: string
  }
}

export async function getSystemHealth(): Promise<SystemHealthStatus> {
  // `/api/health` is public (used by k8s probes) — not auth-gated.
  const res = await fetch(`${API_BASE}/health`)
  // 503 is still a valid JSON response (degraded state) — parse it either way.
  if (res.status !== 200 && res.status !== 503) {
    throw new ApiError(res.status, await res.text())
  }
  return res.json() as Promise<SystemHealthStatus>
}

// --- Telephony Provider Settings ---

export async function getTelephonyProvider() {
  return request<TelephonyProviderConfig | null>('/settings/telephony-provider')
}

export async function updateTelephonyProvider(config: TelephonyProviderConfig) {
  return request<TelephonyProviderConfig>('/settings/telephony-provider', {
    method: 'PATCH',
    body: JSON.stringify(config),
  })
}

export async function testTelephonyProvider(
  config: Partial<TelephonyProviderConfig> & { type: string }
) {
  return request<{ ok: boolean; error?: string }>('/settings/telephony-provider/test', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

// --- WebAuthn Settings ---

export async function getWebAuthnSettings() {
  return request<WebAuthnSettings>('/settings/webauthn')
}

export async function updateWebAuthnSettings(data: Partial<WebAuthnSettings>) {
  return request<WebAuthnSettings>('/settings/webauthn', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Roles (PBAC) ---

export async function listRoles() {
  return request<{ roles: RoleDefinition[] }>('/settings/roles')
}

export async function createRole(data: {
  id?: string
  name: string
  permissions: string[]
  description: string
  encryptedName?: Ciphertext
  encryptedDescription?: Ciphertext
}) {
  return request<{ role: RoleDefinition }>('/settings/roles', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateRole(
  id: string,
  data: Partial<{
    name: string
    permissions: string[]
    description: string
    encryptedName: Ciphertext
    encryptedDescription: Ciphertext
  }>
) {
  return request<{ role: RoleDefinition }>(`/settings/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteRole(id: string) {
  return request<{ ok: true }>(`/settings/roles/${id}`, { method: 'DELETE' })
}

export async function getPermissionsCatalog() {
  return request<{
    permissions: Record<Permission, PermissionMeta>
    byDomain: Record<string, { key: Permission; meta: PermissionMeta }[]>
  }>('/settings/permissions')
}

// --- Messaging Config ---

export async function getMessagingConfig() {
  return request<MessagingConfig>('/settings/messaging')
}

export async function updateMessagingConfig(data: Partial<MessagingConfig>) {
  return request<MessagingConfig>('/settings/messaging', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function testMessagingChannel(channel: string) {
  return request<{ connected: boolean }>('/settings/messaging/test', {
    method: 'POST',
    body: JSON.stringify({ channel }),
  })
}

// --- Setup State ---

export async function getSetupState() {
  return request<SetupState>('/setup/state')
}

export async function updateSetupState(data: Partial<SetupState>) {
  return request<SetupState>('/setup/state', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function completeSetup(demoMode = false) {
  return request<SetupState>('/setup/complete', {
    method: 'POST',
    body: JSON.stringify({ demoMode }),
  })
}

export async function testSignalBridge(data: { bridgeUrl: string; bridgeApiKey: string }) {
  return request<{ ok: boolean; error?: string }>('/setup/test/signal', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function testWhatsAppConnection(data: { phoneNumberId: string; accessToken: string }) {
  return request<{ ok: boolean; error?: string }>('/setup/test/whatsapp', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// --- Provider OAuth & Phone Numbers ---

export async function startProviderOAuth(provider: TelephonyProviderType) {
  return request<OAuthStartResponse>('/setup/provider/oauth/start', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  })
}

export async function getProviderOAuthStatus(stateToken: string) {
  return request<OAuthStatusResponse>(`/setup/provider/oauth/status/${stateToken}`)
}

export async function validateProviderCredentials(credentials: ProviderCredentials) {
  return request<{ ok: boolean; error?: string; accountName?: string }>(
    '/setup/provider/validate',
    {
      method: 'POST',
      body: JSON.stringify(credentials),
    }
  )
}

export async function listProviderPhoneNumbers(credentials: ProviderCredentials) {
  return request<{ numbers: ProviderPhoneNumber[] }>('/setup/provider/phone-numbers', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

export async function searchAvailablePhoneNumbers(
  credentials: ProviderCredentials & { country: string; areaCode?: string; contains?: string }
) {
  return request<{ numbers: AvailablePhoneNumber[] }>('/setup/provider/phone-numbers/search', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

export async function provisionPhoneNumber(
  credentials: ProviderCredentials & { phoneNumber: string }
) {
  return request<{ ok: boolean; phoneNumber: string; error?: string }>(
    '/setup/provider/phone-numbers/provision',
    {
      method: 'POST',
      body: JSON.stringify(credentials),
    }
  )
}

export async function getWebhookUrls() {
  return request<{
    voice: string
    voiceStatus: string
    sms: string
    whatsapp: string
    signal: string
  }>('/setup/provider/webhooks')
}

// --- Signal Registration ---

export async function startSignalRegistration(data: {
  bridgeUrl: string
  registeredNumber: string
  useVoice?: boolean
}) {
  return request<SignalRegistrationResponse>('/messaging/signal/register', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getSignalRegistrationStatus() {
  return request<SignalRegistrationStatus>('/messaging/signal/registration-status')
}

export async function verifySignalRegistration(code: string) {
  return request<{ ok: boolean }>('/messaging/signal/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

// --- Geocoding ---

export async function geocodingAutocomplete(query: string, limit = 5) {
  return request<LocationResult[]>('/geocoding/autocomplete', {
    method: 'POST',
    body: JSON.stringify({ query, limit }),
  })
}

export async function geocodingGeocode(address: string) {
  return request<LocationResult | null>('/geocoding/geocode', {
    method: 'POST',
    body: JSON.stringify({ address }),
  })
}

export async function geocodingReverse(lat: number, lon: number) {
  return request<LocationResult | null>('/geocoding/reverse', {
    method: 'POST',
    body: JSON.stringify({ lat, lon }),
  })
}

export async function getGeocodingConfig() {
  return request<GeocodingConfig>('/geocoding/config')
}

export async function getGeocodingSettings() {
  return request<GeocodingConfigAdmin>('/geocoding/settings')
}

export async function updateGeocodingSettings(config: Partial<GeocodingConfigAdmin>) {
  return request<GeocodingConfigAdmin>('/geocoding/settings', {
    method: 'PATCH',
    body: JSON.stringify(config),
  })
}

export async function testGeocodingProvider() {
  return request<{ ok: boolean; latency: number; error?: string }>('/geocoding/test')
}

// --- Retention Settings (GDPR) ---

export async function getRetentionSettings() {
  return request<RetentionSettings>('/settings/retention')
}

export async function updateRetentionSettings(data: Partial<RetentionSettings>) {
  return request<RetentionSettings>('/settings/retention', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}
