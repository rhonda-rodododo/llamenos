import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import type { AuditLogEntry } from './audit'
import {
  API_BASE,
  ApiError,
  fireApiActivity,
  fireAuthExpired,
  getAuthHeaders,
  hp,
  request,
} from './client'
import type { MessageKeyEnvelope } from './conversations'
import type { EncryptedNote } from './notes'

// --- Types ---

export interface ActiveCall {
  id: string
  callerNumber: string
  answeredBy: string | null
  startedAt: string
  status: 'ringing' | 'in-progress' | 'completed' | 'unanswered'
}

export interface CallRecord {
  id: string
  callerLast4?: string
  startedAt: string
  endedAt?: string
  duration?: number
  hasTranscription: boolean
  hasVoicemail: boolean
  hasRecording?: boolean
  recordingSid?: string
  voicemailFileId?: string | null
  status: 'completed' | 'unanswered'

  // Envelope-encrypted metadata (Epic 77)
  encryptedContent?: Ciphertext
  adminEnvelopes?: MessageKeyEnvelope[]

  // Decrypted fields (populated client-side after decryption)
  answeredBy?: string | null
  callerNumber?: string

  // E2EE envelope-encrypted callerLast4 (Phase 2D)
  encryptedCallerLast4?: Ciphertext
  callerLast4Envelopes?: RecipientEnvelope[]
}

export interface CallHourBucket {
  hour: number
  count: number
}

export interface CallVolumeDay {
  date: string
  count: number
  answered: number
  voicemail: number
}

export interface UserStatEntry {
  pubkey: string
  name: string
  callsAnswered: number
  callsHandled: number
  avgDuration: number
  notesCreated: number
}

// --- Active Calls ---

export async function listActiveCalls() {
  return request<{ calls: ActiveCall[] }>(hp('/calls/active'))
}

export async function getCallHistory(params?: {
  page?: number
  limit?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  voicemailOnly?: boolean
}) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.search) qs.set('search', params.search)
  if (params?.dateFrom) qs.set('dateFrom', params.dateFrom)
  if (params?.dateTo) qs.set('dateTo', params.dateTo)
  if (params?.voicemailOnly) qs.set('voicemailOnly', 'true')
  return request<{ calls: CallRecord[]; total: number }>(hp(`/calls/history?${qs}`))
}

// --- Call Actions (REST) ---

export async function answerCall(callId: string, type?: 'phone' | 'browser') {
  return request<{ call: ActiveCall }>(hp(`/calls/${callId}/answer`), {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}

export async function hangupCall(callId: string) {
  return request<{ call: ActiveCall }>(hp(`/calls/${callId}/hangup`), { method: 'POST' })
}

export async function reportCallSpam(callId: string) {
  return request<{ callId: string; callerNumber: string | null; reportedBy: string }>(
    hp(`/calls/${callId}/spam`),
    { method: 'POST' }
  )
}

// --- Calls Today ---

export async function getCallsTodayCount() {
  return request<{ count: number }>(hp('/calls/today-count'))
}

// --- Call Recording ---

export async function getCallRecording(callId: string): Promise<ArrayBuffer> {
  const headers = {
    ...getAuthHeaders(),
  }
  const res = await fetch(`${API_BASE}${hp(`/calls/${callId}/recording`)}`, { headers })
  if (!res.ok) {
    if (res.status === 401) fireAuthExpired()
    throw new ApiError(res.status, await res.text())
  }
  fireApiActivity()
  return res.arrayBuffer()
}

// --- Call Detail ---

export async function getCallDetail(callId: string) {
  return request<{
    call: CallRecord
    notes: EncryptedNote[]
    auditEntries: AuditLogEntry[]
  }>(hp(`/calls/${callId}`))
}

// --- Dashboard Analytics ---

export async function getCallAnalytics(days?: number) {
  const qs = days ? `?days=${days}` : ''
  return request<{ data: CallVolumeDay[] }>(hp(`/analytics/call-volume${qs}`))
}

export async function getCallHoursAnalytics() {
  return request<{ data: CallHourBucket[] }>(hp('/analytics/call-hours'))
}

export async function getUserStats() {
  return request<{ data: UserStatEntry[] }>(hp('/analytics/user-stats'))
}

// --- Platform (global) Analytics — super-admin only ---
//
// The /analytics router is mounted twice in src/server/app.ts:
//   - `/analytics` on `authenticated` (no hubContext → hubId undefined → cross-hub)
//   - `/hubs/:hubId/analytics` on `hubScoped` (hub-scoped)
//
// These `global*` variants always hit the un-prefixed `/analytics` endpoint,
// which aggregates across every hub regardless of which hub is currently
// active in the UI. Super-admin only.

export async function getGlobalCallAnalytics(days?: number) {
  const qs = days ? `?days=${days}` : ''
  return request<{ data: CallVolumeDay[] }>(`/analytics/call-volume${qs}`)
}

export async function getGlobalCallHoursAnalytics() {
  return request<{ data: CallHourBucket[] }>('/analytics/call-hours')
}

export async function getGlobalUserStats() {
  return request<{ data: UserStatEntry[] }>('/analytics/user-stats')
}

// --- WebRTC Token ---

export async function getWebRtcToken() {
  return request<{ token: string; provider: string; identity: string; ttl: number }>(
    '/telephony/webrtc-token'
  )
}

export async function getWebRtcStatus() {
  return request<{ available: boolean; provider: string | null }>('/telephony/webrtc-status')
}
