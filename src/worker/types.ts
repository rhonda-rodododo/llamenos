export interface Env {
  CALL_ROUTER: DurableObjectNamespace
  SHIFT_MANAGER: DurableObjectNamespace
  SESSION_MANAGER: DurableObjectNamespace
  AI: Ai
  ASSETS: Fetcher
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  ADMIN_PUBKEY: string
  HOTLINE_NAME: string
  ENVIRONMENT: string
}

export interface Volunteer {
  pubkey: string
  name: string
  phone: string
  role: 'volunteer' | 'admin'
  active: boolean
  createdAt: string
  encryptedSecretKey: string // Admin-encrypted copy of the volunteer's nsec
  transcriptionEnabled: boolean
  spokenLanguages: string[]  // Languages volunteer can take calls in (e.g. ['en', 'es'])
  uiLanguage: string         // Preferred UI language
  profileCompleted: boolean  // Whether first-login setup is done
  onBreak: boolean           // Temporarily unavailable (still on shift)
}

export interface Shift {
  id: string
  name: string
  startTime: string
  endTime: string
  days: number[]
  volunteerPubkeys: string[]
  createdAt: string
}

export interface BanEntry {
  phone: string
  reason: string
  bannedBy: string
  bannedAt: string
}

export interface CallRecord {
  id: string
  callerNumber: string
  callerLast4?: string
  answeredBy: string | null
  startedAt: string
  endedAt?: string
  duration?: number
  status: 'ringing' | 'in-progress' | 'completed' | 'unanswered'
  hasTranscription: boolean
  hasVoicemail: boolean
}

export interface EncryptedNote {
  id: string
  callId: string
  authorPubkey: string
  encryptedContent: string
  createdAt: string
  updatedAt: string
  ephemeralPubkey?: string // hex-encoded, present for server-encrypted transcriptions (ECIES)
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

export interface CallSettings {
  queueTimeoutSeconds: number   // 30-300, default 90
  voicemailMaxSeconds: number   // 30-300, default 120
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
  usedBy?: string
}

export interface WebAuthnCredential {
  id: string              // Base64URL credential ID
  publicKey: string       // Base64URL public key bytes
  counter: number         // Signature counter (clone detection)
  transports: string[]    // ['internal', 'hybrid', etc.]
  backedUp: boolean       // Cloud-synced passkey
  label: string           // User-assigned name ("My Phone")
  createdAt: string
  lastUsedAt: string
}

export interface WebAuthnSettings {
  requireForAdmins: boolean
  requireForVolunteers: boolean
}

export interface ServerSession {
  token: string           // Random 256-bit hex
  pubkey: string          // Which user
  createdAt: string
  expiresAt: string       // 8-hour expiry
}

export interface AuthPayload {
  pubkey: string
  timestamp: number
  token: string
}

// Hono typed context
export type AppEnv = {
  Bindings: Env
  Variables: {
    pubkey: string
    volunteer: Volunteer
    isAdmin: boolean
  }
}
