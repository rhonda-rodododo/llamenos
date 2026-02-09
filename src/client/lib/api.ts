import { createAuthToken, keyPairFromNsec, getStoredSession, clearSession } from './crypto'

const API_BASE = '/api'

// Auth expiry callback — set by AuthProvider to handle 401s reactively
let onAuthExpired: (() => void) | null = null
export function setOnAuthExpired(cb: (() => void) | null) { onAuthExpired = cb }

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
    if (res.status === 401 && !path.startsWith('/auth/')) {
      // Session expired — notify auth provider reactively (no hard redirect)
      clearSession()
      onAuthExpired?.()
    }
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

// --- Public config (no auth) ---

export async function getConfig() {
  const res = await fetch(`${API_BASE}/config`)
  if (!res.ok) return { hotlineName: 'Hotline' }
  return res.json() as Promise<{ hotlineName: string }>
}

// --- Auth ---

export async function login(pubkey: string, token: string) {
  return request<{ ok: true; role: 'volunteer' | 'admin' }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pubkey, token }),
  })
}

export async function getMe() {
  return request<{ pubkey: string; role: 'volunteer' | 'admin'; name: string; transcriptionEnabled: boolean; spokenLanguages: string[]; uiLanguage: string; profileCompleted: boolean; onBreak: boolean }>('/auth/me')
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

// --- Shift Status (all users) ---

export interface ShiftStatus {
  onShift: boolean
  currentShift: { name: string; startTime: string; endTime: string } | null
  nextShift: { name: string; startTime: string; endTime: string; day: number } | null
}

export async function getMyShiftStatus() {
  return request<ShiftStatus>('/shifts/my-status')
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

export async function listNotes(params?: { callId?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams()
  if (params?.callId) qs.set('callId', params.callId)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ notes: EncryptedNote[]; total: number }>(`/notes?${qs}`)
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

export async function getCallHistory(params?: { page?: number; limit?: number; search?: string; dateFrom?: string; dateTo?: string }) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.search) qs.set('search', params.search)
  if (params?.dateFrom) qs.set('dateFrom', params.dateFrom)
  if (params?.dateTo) qs.set('dateTo', params.dateTo)
  return request<{ calls: CallRecord[]; total: number }>(`/calls/history?${qs}`)
}

// --- Calls Today ---

export async function getCallsTodayCount() {
  return request<{ count: number }>('/calls/today-count')
}

// --- Volunteer Presence (admin only) ---

export async function getVolunteerPresence() {
  return request<{ volunteers: VolunteerPresence[] }>('/calls/presence')
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

export async function updateMyProfile(data: { name?: string; phone?: string; spokenLanguages?: string[]; uiLanguage?: string; profileCompleted?: boolean }) {
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

// --- Invites ---

export async function listInvites() {
  return request<{ invites: InviteCode[] }>('/invites')
}

export async function createInvite(data: { name: string; phone: string; role: 'volunteer' | 'admin' }) {
  return request<{ invite: InviteCode }>('/invites', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function revokeInvite(code: string) {
  return request<{ ok: true }>(`/invites/${code}`, { method: 'DELETE' })
}

export async function validateInvite(code: string) {
  const res = await fetch(`${API_BASE}/invites/validate/${code}`)
  return res.json() as Promise<{ valid: boolean; name?: string; role?: string; error?: string }>
}

export async function redeemInvite(code: string, pubkey: string) {
  const res = await fetch(`${API_BASE}/invites/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, pubkey }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<{ volunteer: Volunteer }>
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
  onBreak: boolean
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
  ephemeralPubkey?: string
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

export interface VolunteerPresence {
  pubkey: string
  status: 'available' | 'on-call' | 'online'
}

export interface SpamSettings {
  voiceCaptchaEnabled: boolean
  rateLimitEnabled: boolean
  maxCallsPerMinute: number
  blockDurationMinutes: number
}

export interface InviteCode {
  code: string
  name: string
  phone: string
  role: 'volunteer' | 'admin'
  createdBy: string
  createdAt: string
  expiresAt: string
  usedAt?: string
}
