import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { API_BASE, ApiError, request } from './client'

// --- Auth ---

/** @knipignore */
export async function login(pubkey: string, timestamp: number, token: string) {
  return request<{ ok: true; roles: string[] }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pubkey, timestamp, token }),
  })
}

export async function bootstrapAdmin(pubkey: string, timestamp: number, token: string) {
  const res = await fetch(`${API_BASE}/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey, timestamp, token }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<{
    ok: true
    roles: string[]
    nsecSecret: string
    accessToken: string
  }>
}

export async function logout() {
  return request<{ ok: true }>('/auth/me/logout', { method: 'POST' }).catch(() => {})
}

export async function getMe() {
  return request<{
    pubkey: string
    roles: string[]
    hubRoles: { hubId: string; roleIds: string[] }[]
    permissions: string[]
    primaryRole: { id: string; name: string } | null
    name: string
    encryptedName?: Ciphertext
    nameEnvelopes?: RecipientEnvelope[]
    transcriptionEnabled: boolean
    spokenLanguages: string[]
    uiLanguage: string
    profileCompleted: boolean
    onBreak: boolean
    callPreference: 'phone' | 'browser' | 'both'
    webauthnRequired: boolean
    webauthnRegistered: boolean
    adminPubkey: string
    adminDecryptionPubkey: string
  }>('/auth/me')
}

// --- Consent (GDPR) ---

export async function getConsentStatus() {
  return request<{ hasConsented: boolean; consentVersion: string }>('/auth/me/consent')
}

export async function submitConsent(version: string) {
  return request<{ ok: true }>('/auth/me/consent', {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

// --- Profile ---

export async function updateMyTranscriptionPreference(enabled: boolean) {
  return request<{ ok: true }>('/auth/me/transcription', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

export async function updateMyProfile(data: {
  name?: string
  phone?: string
  spokenLanguages?: string[]
  uiLanguage?: string
  profileCompleted?: boolean
  callPreference?: 'phone' | 'browser' | 'both'
}) {
  return request<{ ok: true }>('/auth/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function updateMyAvailability(onBreak: boolean) {
  return request<{ ok: true }>('/auth/me/availability', {
    method: 'PATCH',
    body: JSON.stringify({ onBreak }),
  })
}
