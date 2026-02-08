import { createAuthToken, keyPairFromNsec, getStoredSession } from './crypto'

const API_BASE = '/api'

function getAuthHeaders(): Record<string, string> {
  const nsec = getStoredSession()
  if (!nsec) return {}
  const keyPair = keyPairFromNsec(nsec)
  if (!keyPair) return {}
  const token = createAuthToken(keyPair.secretKey, Date.now())
  return { 'Authorization': `Bearer ${token}` }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...options.headers,
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json()
}

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API error ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

// --- Auth ---

export async function login(pubkey: string, token: string) {
  return request<{ ok: true; role: 'volunteer' | 'admin' }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pubkey, token }),
  })
}

export async function getMe() {
  return request<{ pubkey: string; role: 'volunteer' | 'admin'; name: string; transcriptionEnabled: boolean }>('/auth/me')
}

// --- Volunteers (admin only) ---

export async function listVolunteers() {
  return request<{ volunteers: Volunteer[] }>('/volunteers')
}

export async function createVolunteer(data: { name: string; phone: string; role: 'volunteer' | 'admin'; pubkey: string }) {
  return request<{ volunteer: Volunteer }>('/volunteers', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateVolunteer(pubkey: string, data: Partial<{ name: string; phone: string; role: 'volunteer' | 'admin'; active: boolean }>) {
  return request<{ volunteer: Volunteer }>(`/volunteers/${pubkey}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteVolunteer(pubkey: string) {
  return request<{ ok: true }>(`/volunteers/${pubkey}`, { method: 'DELETE' })
}

// --- Shifts (admin only) ---

export async function listShifts() {
  return request<{ shifts: Shift[] }>('/shifts')
}

export async function createShift(data: Omit<Shift, 'id'>) {
  return request<{ shift: Shift }>('/shifts', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateShift(id: string, data: Partial<Shift>) {
  return request<{ shift: Shift }>(`/shifts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteShift(id: string) {
  return request<{ ok: true }>(`/shifts/${id}`, { method: 'DELETE' })
}

export async function getFallbackGroup() {
  return request<{ volunteers: string[] }>('/shifts/fallback')
}

export async function setFallbackGroup(volunteers: string[]) {
  return request<{ ok: true }>('/shifts/fallback', {
    method: 'PUT',
    body: JSON.stringify({ volunteers }),
  })
}

// --- Ban List ---

export async function listBans() {
  return request<{ bans: BanEntry[] }>('/bans')
}

export async function addBan(data: { phone: string; reason: string }) {
  return request<{ ban: BanEntry }>('/bans', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function removeBan(phone: string) {
  return request<{ ok: true }>(`/bans/${encodeURIComponent(phone)}`, { method: 'DELETE' })
}

export async function bulkAddBans(data: { phones: string[]; reason: string }) {
  return request<{ count: number }>('/bans/bulk', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// --- Notes ---

export async function listNotes(callId?: string) {
  const params = callId ? `?callId=${callId}` : ''
  return request<{ notes: EncryptedNote[] }>(`/notes${params}`)
}

export async function createNote(data: { callId: string; encryptedContent: string }) {
  return request<{ note: EncryptedNote }>('/notes', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateNote(id: string, data: { encryptedContent: string }) {
  return request<{ note: EncryptedNote }>(`/notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Calls ---

export async function listActiveCalls() {
  return request<{ calls: ActiveCall[] }>('/calls/active')
}

export async function getCallHistory(params?: { page?: number; limit?: number }) {
  const search = new URLSearchParams()
  if (params?.page) search.set('page', String(params.page))
  if (params?.limit) search.set('limit', String(params.limit))
  return request<{ calls: CallRecord[]; total: number }>(`/calls/history?${search}`)
}

// --- Audit Log (admin only) ---

export async function listAuditLog(params?: { page?: number; limit?: number }) {
  const search = new URLSearchParams()
  if (params?.page) search.set('page', String(params.page))
  if (params?.limit) search.set('limit', String(params.limit))
  return request<{ entries: AuditLogEntry[]; total: number }>(`/audit?${search}`)
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

// --- Transcription Settings ---

export async function getTranscriptionSettings() {
  return request<{ globalEnabled: boolean }>('/settings/transcription')
}

export async function updateTranscriptionSettings(data: { globalEnabled: boolean }) {
  return request<{ globalEnabled: boolean }>('/settings/transcription', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function updateMyTranscriptionPreference(enabled: boolean) {
  return request<{ ok: true }>('/auth/me/transcription', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

// --- Types ---

export interface Volunteer {
  pubkey: string
  name: string
  phone: string
  role: 'volunteer' | 'admin'
  active: boolean
  createdAt: string
  transcriptionEnabled: boolean
}

export interface Shift {
  id: string
  name: string
  startTime: string   // HH:mm
  endTime: string     // HH:mm
  days: number[]      // 0=Sunday, 1=Monday, ..., 6=Saturday
  volunteerPubkeys: string[]
  createdAt: string
}

export interface BanEntry {
  phone: string
  reason: string
  bannedBy: string
  bannedAt: string
}

export interface EncryptedNote {
  id: string
  callId: string
  authorPubkey: string
  encryptedContent: string
  createdAt: string
  updatedAt: string
}

export interface ActiveCall {
  id: string
  callerNumber: string
  answeredBy: string | null
  startedAt: string
  status: 'ringing' | 'in-progress' | 'completed'
}

export interface CallRecord {
  id: string
  callerNumber: string
  answeredBy: string
  startedAt: string
  endedAt: string
  duration: number
  hasTranscription: boolean
}

export interface AuditLogEntry {
  id: string
  event: string
  actorPubkey: string
  details: Record<string, unknown>
  createdAt: string
}

export interface SpamSettings {
  voiceCaptchaEnabled: boolean
  rateLimitEnabled: boolean
  maxCallsPerMinute: number
  blockDurationMinutes: number
}
