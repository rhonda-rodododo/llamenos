import type {
  KeyEnvelope,
  MessageDeliveryStatus,
  MessagingChannelType,
  RecipientEnvelope,
} from '../shared/types'

/**
 * Storage namespace definitions with default retention policies.
 * Each namespace maps to a per-hub bucket: `{hubId}-{namespace}`.
 */
export const STORAGE_NAMESPACES = {
  voicemails: { defaultRetentionDays: 365 },
  attachments: { defaultRetentionDays: null },
} satisfies Record<string, { defaultRetentionDays: number | null }>

export type StorageNamespace = keyof typeof STORAGE_NAMESPACES

/**
 * Result returned by StorageManager.get().
 */
export interface BlobResult {
  body: ReadableStream
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Per-hub IAM credentials returned by provisionHub when an admin client is available.
 * The caller encrypts the secretAccessKey and stores in hub_storage_credentials.
 */
export interface HubStorageCredentialResult {
  accessKeyId: string
  secretAccessKey: string
  policyName: string
  userName: string
}

/**
 * Hub-aware, namespace-scoped object storage manager.
 * Replaces the flat BlobStorage interface with per-hub bucket isolation.
 */
export interface StorageManager {
  put(
    hubId: string,
    namespace: StorageNamespace,
    key: string,
    body: ReadableStream | ArrayBuffer | Uint8Array | string
  ): Promise<void>
  get(hubId: string, namespace: StorageNamespace, key: string): Promise<BlobResult | null>
  delete(hubId: string, namespace: StorageNamespace, key: string): Promise<void>
  /** Provision hub buckets. Returns IAM credentials if admin client is available. */
  provisionHub(hubId: string): Promise<HubStorageCredentialResult | undefined>
  /** Destroy hub buckets and IAM resources. Pass userName to also delete the IAM user. */
  destroyHub(hubId: string, userName?: string): Promise<void>
  setRetention(hubId: string, namespace: StorageNamespace, days: number | null): Promise<void>
  healthy(): Promise<boolean>
  /** Create a new StorageManager bound to specific credentials (per-hub S3Client). */
  withCredentials(accessKeyId: string, secretAccessKey: string): StorageManager
}

/**
 * Transcription service (self-hosted Whisper).
 */
export interface TranscriptionService {
  run(model: string, input: { audio: number[] }): Promise<{ text: string }>
}
import type { Services } from './services'

/**
 * Environment bindings available on the Hono context (c.env).
 * Injected at startup by server.ts via middleware.
 */

export interface Env {
  // Transcription (self-hosted Whisper HTTP client)
  AI: TranscriptionService

  // Static assets (served by Hono serveStatic)
  ASSETS: { fetch(request: Request): Promise<Response> } | null

  // Hub-aware object storage (RustFS / MinIO S3-compatible)
  STORAGE: StorageManager

  // Plain env vars / secrets (same on both platforms)
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  ADMIN_PUBKEY?: string
  ADMIN_DECRYPTION_PUBKEY?: string // Separate pubkey for note/hub key encryption (falls back to ADMIN_PUBKEY)
  HOTLINE_NAME: string
  ENVIRONMENT: string
  HMAC_SECRET: string
  JWT_SECRET: string
  AUTH_WEBAUTHN_RP_ID: string
  AUTH_WEBAUTHN_RP_NAME: string
  AUTH_WEBAUTHN_ORIGIN: string
  E2E_TEST_SECRET?: string
  DEV_RESET_SECRET?: string

  // Demo mode
  DEMO_MODE?: string // "true" to enable
  DEMO_RESET_CRON?: string // Human-readable schedule label (e.g., "every 4 hours")

  // Server Nostr identity (Epic 76.1) — hex secret for HKDF keypair derivation
  SERVER_NOSTR_SECRET?: string
  // Phase 2.4: Comma-separated list of additional allowed CORS origins
  CORS_ALLOWED_ORIGINS?: string
  // Application URL (used for invite links, webhooks)
  APP_URL?: string
  // Relay URL for Node.js persistent WebSocket (Docker/self-hosted)
  NOSTR_RELAY_URL?: string
  // Public-facing relay URL for client browser connections (e.g., wss://relay.example.com)
  // Falls back to /nostr (reverse-proxied via Caddy) if not set but relay is configured
  NOSTR_RELAY_PUBLIC_URL?: string

  // Push notifications (Epic 86) — APNs (iOS)
  APNS_KEY_P8?: string // Apple Push Notification auth key (PEM format)
  APNS_KEY_ID?: string // Key ID from Apple Developer Portal
  APNS_TEAM_ID?: string // Apple Developer Team ID

  // Push notifications (Epic 86) — FCM (Android)
  FCM_SERVICE_ACCOUNT_KEY?: string // Google Cloud service account JSON

  // Push notifications (Epic 86) — Web Push / VAPID
  VAPID_PUBLIC_KEY?: string // base64url-encoded uncompressed EC public key
  VAPID_PRIVATE_KEY?: string // base64url-encoded EC private key

  // DATABASE_URL for Drizzle connection (Node.js only)
  DATABASE_URL?: string

  // Firehose agent seal key (hex-encoded 32 bytes) — used to encrypt agent nsec at rest
  FIREHOSE_AGENT_SEAL_KEY?: string
}

export interface User {
  pubkey: string
  name: string
  phone: string
  roles: string[] // Global role IDs (e.g., ['role-super-admin', 'role-volunteer'])
  hubRoles?: { hubId: string; roleIds: string[] }[] // Per-hub role assignments
  active: boolean
  createdAt: string
  encryptedSecretKey: string // Admin-encrypted copy of the user's nsec
  transcriptionEnabled: boolean
  spokenLanguages: string[] // Languages user can take calls in (e.g. ['en', 'es'])
  uiLanguage: string // Preferred UI language
  profileCompleted: boolean // Whether first-login setup is done
  onBreak: boolean // Temporarily unavailable (still on shift)
  callPreference: 'phone' | 'browser' | 'both' // How to receive calls (default: 'phone')
  // Messaging channel capabilities (Epic 68)
  supportedMessagingChannels?: MessagingChannelType[] // SMS, WhatsApp, Signal, RCS (empty = all)
  messagingEnabled?: boolean // Whether user can handle messaging conversations
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedName?: string // ECIES ciphertext
  nameEnvelopes?: RecipientEnvelope[] // Per-recipient wrapped keys
  encryptedPhone?: string // ECIES ciphertext (when envelope-encrypted)
  phoneEnvelopes?: RecipientEnvelope[] // Per-recipient wrapped keys for phone
}

export interface Shift {
  id: string
  name: string
  startTime: string
  endTime: string
  days: number[]
  userPubkeys: string[]
  createdAt: string
}

export interface BanEntry {
  phone: string
  reason: string
  bannedBy: string
  bannedAt: string
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedReason?: string
  reasonEnvelopes?: RecipientEnvelope[]
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
  recordingSid?: string
  hasRecording?: boolean
}

/**
 * Encrypted call record for history storage (Epic 77).
 *
 * Active calls remain as plaintext CallRecord (routing necessity).
 * When a call completes, sensitive metadata (answeredBy, full callerNumber)
 * is encrypted into an envelope and stored per-record as `callrecord:${id}`.
 *
 * Plaintext fields: callerLast4, timestamp, duration, status, hasTranscription, hasVoicemail
 * Encrypted fields: answeredBy, callerNumber (original hash), outcome details
 */
export interface EncryptedCallRecord {
  id: string
  callerLast4?: string // '[encrypted]' when E2EE, undefined for legacy
  startedAt: string // Needed for ordering/pagination
  endedAt?: string // Needed for duration display
  duration?: number // Acceptable trade-off (no PII)
  status: 'completed' | 'unanswered'
  hasTranscription: boolean
  hasVoicemail: boolean
  hasRecording?: boolean
  recordingSid?: string // Twilio ID (not PII, server needs to update post-encryption)
  voicemailFileId?: string | null // Object storage file ID for encrypted voicemail audio

  // Envelope-pattern encryption for admin(s)
  encryptedContent: string // hex: nonce(24) + ciphertext (XChaCha20-Poly1305)
  adminEnvelopes: RecipientEnvelope[] // Per-record key wrapped for each admin
  // E2EE envelope-encrypted callerLast4 (Phase 2D)
  encryptedCallerLast4?: string
  callerLast4Envelopes?: RecipientEnvelope[]
}

/**
 * Plaintext inside EncryptedCallRecord.encryptedContent.
 * Only visible after admin decryption.
 */
export interface CallRecordMetadata {
  answeredBy: string | null // User pubkey
  callerNumber: string // HMAC-hashed phone number
}

export interface EncryptedNote {
  id: string
  hubId: string
  callId?: string // links to a voice call
  conversationId?: string // links to a conversation (Epic 123)
  contactHash?: string // links to a contact for contact-level view (Epic 123)
  authorPubkey: string
  encryptedContent: string
  createdAt: string
  updatedAt: string
  ephemeralPubkey?: string // hex-encoded, present for server-encrypted transcriptions (ECIES)
  // V2 per-note ECIES envelopes (forward secrecy)
  authorEnvelope?: KeyEnvelope
  adminEnvelopes?: RecipientEnvelope[]
  replyCount?: number // cached count of replies (Epic 123)
}

export interface AuditLogEntry {
  id: string
  event: string
  actorPubkey: string
  details: Record<string, unknown>
  createdAt: string
  // Tamper detection (Epic 77)
  previousEntryHash?: string // SHA-256 of previous entry (chain link)
  entryHash?: string // SHA-256 of this entry's content (for chain verification)
}

export interface SpamSettings {
  voiceCaptchaEnabled: boolean
  rateLimitEnabled: boolean
  maxCallsPerMinute: number
  blockDurationMinutes: number
  captchaMaxAttempts: number
}

export interface CallSettings {
  queueTimeoutSeconds: number // 30-300, default 90
  voicemailMaxSeconds: number // 30-300, default 120
  voicemailMaxBytes: number // 100KB-50MB, default 2MB (2097152)
  voicemailMode: 'auto' | 'always' | 'never' // default 'auto'
  voicemailRetentionDays: number | null // null = no explicit limit
  callRecordingMaxBytes: number // 100KB-50MB, default 20MB (20971520)
}

export interface InviteCode {
  code: string
  name: string
  phone: string
  roleIds: string[] // Role IDs to assign on redemption
  createdBy: string
  createdAt: string
  expiresAt: string
  usedAt?: string
  usedBy?: string
  recipientPhoneHash?: string
  deliveryChannel?: string
  deliverySentAt?: string
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedName?: string
  nameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
}

export interface WebAuthnCredential {
  id: string // Base64URL credential ID
  publicKey: string // Base64URL public key bytes
  counter: number // Signature counter (clone detection)
  transports: string[] // ['internal', 'hybrid', etc.]
  backedUp: boolean // Cloud-synced passkey
  label: string // User-assigned name ("My Phone") — '[encrypted]' when E2EE
  createdAt: string
  lastUsedAt: string
  // E2EE envelope-encrypted label (Phase 2D)
  encryptedLabel?: string
  labelEnvelopes?: RecipientEnvelope[]
}

export interface WebAuthnSettings {
  requireForAdmins: boolean
  requireForUsers: boolean
}

export interface ServerSession {
  token: string // Random 256-bit hex
  pubkey: string // Which user
  createdAt: string
  expiresAt: string // 8-hour expiry
}

export interface AuthPayload {
  pubkey: string
  timestamp: number
  token: string
}

// --- Conversation / Messaging Types ---

export type ConversationStatus = 'active' | 'waiting' | 'closed'

export interface Conversation {
  id: string
  hubId: string
  channelType: string
  contactIdentifierHash: string
  contactLast4?: string | null
  externalId?: string | null
  assignedTo?: string | null
  status: string
  metadata: Record<string, unknown>
  /** FK to report_types — only set on web/report conversations */
  reportTypeId?: string | null
  messageCount: number
  createdAt: Date
  updatedAt: Date
  lastMessageAt: Date
  // E2EE envelope-encrypted contactLast4 (Phase 2D)
  encryptedContactLast4?: string
  contactLast4Envelopes?: RecipientEnvelope[]
}

export type { MessageDeliveryStatus } from '../shared/types'

/**
 * Encrypted message using the envelope pattern (Epic 74).
 *
 * Single ciphertext encrypted with a random per-message symmetric key.
 * The key is ECIES-wrapped separately for each authorized reader.
 * Domain separation label: 'llamenos:message'.
 */
export interface EncryptedMessage {
  id: string
  conversationId: string
  direction: string
  authorPubkey: string
  encryptedContent: string
  readerEnvelopes: RecipientEnvelope[]
  hasAttachments: boolean
  attachmentIds?: string[]
  externalId?: string | null
  status: string
  deliveryStatus: MessageDeliveryStatus
  deliveryStatusUpdatedAt?: Date | null
  providerMessageId?: string | null
  deliveryError?: string | null
  deliveredAt?: Date | null
  readAt?: Date | null
  failureReason?: string | null
  retryCount: number
  createdAt: Date
}

// --- Blast Queue ---

export interface BlastQueueItem {
  subscriberId: string
  channel: MessagingChannelType
  identifier: string // actual phone/contact (server-only, not stored)
  status: 'pending' | 'sent' | 'failed'
  error?: string
  sentAt?: string
}

export interface BlastDeliveryQueue {
  blastId: string
  items: BlastQueueItem[]
  processedCount: number
  totalCount: number
}

// --- Push Notification Types (Epic 86) ---

export interface DeviceRecord {
  platform: 'ios' | 'android'
  pushToken: string
  wakeKeyPublic: string // secp256k1 compressed pubkey (hex) for wake-tier ECIES
  registeredAt: string
  lastSeenAt: string
}

export type PushNotificationType = 'message' | 'voicemail' | 'shift_reminder' | 'assignment'

/** Wake-tier payload — decryptable without PIN (minimal metadata) */
export interface WakePayload {
  type: PushNotificationType
  conversationId?: string
  channelType?: string
  callId?: string
  shiftId?: string
  startsAt?: string
}

/** Full-tier payload — decryptable only with user's nsec */
export interface FullPushPayload extends WakePayload {
  senderLast4?: string
  previewText?: string
  duration?: number
  callerLast4?: string
  shiftName?: string
  role?: string
}

// Hono typed context
export type AppEnv = {
  Bindings: Env
  Variables: {
    pubkey: string
    user: User
    /** Effective permissions resolved from all roles */
    permissions: string[]
    /** All role definitions (loaded once per request) */
    allRoles: import('../shared/permissions').Role[]
    /** Current hub ID (set by hub middleware for hub-scoped routes) */
    hubId?: string
    /** Hub-scoped permissions (resolved for the current hub) */
    hubPermissions?: string[]
    /** Injected service instances */
    services: Services
  }
}

// -------------------------------------------------------------------
// Identity service input types
// -------------------------------------------------------------------

export interface CreateUserData {
  pubkey: string
  name: string
  phone: string
  roleIds?: string[]
  roles?: string[]
  encryptedSecretKey: string
}

export interface UpdateUserData {
  name?: string
  phone?: string
  spokenLanguages?: string[]
  uiLanguage?: string
  profileCompleted?: boolean
  transcriptionEnabled?: boolean
  onBreak?: boolean
  callPreference?: 'phone' | 'browser' | 'both'
  // Admin-only fields
  roles?: string[]
  active?: boolean
  supportedMessagingChannels?: string[]
  messagingEnabled?: boolean
  encryptedSecretKey?: string
}

export interface CreateInviteData {
  name: string
  phone: string
  roleIds: string[]
  createdBy: string
}

export interface RedeemInviteData {
  code: string
  pubkey: string
}

export interface CreateSessionData {
  pubkey: string
}

export interface CreateWebAuthnChallengeData {
  id: string
  challenge: string
  pubkey?: string
}

export interface AddWebAuthnCredentialData {
  pubkey: string
  credential: WebAuthnCredential
}

export interface UpdateWebAuthnCounterData {
  pubkey: string
  credId: string
  counter: number
  lastUsedAt: string
}

export interface CreateProvisionRoomData {
  ephemeralPubkey: string
}

export interface ProvisionRoomStatus {
  status: 'waiting' | 'ready' | 'expired'
  ephemeralPubkey?: string
  encryptedNsec?: string
  primaryPubkey?: string
}

export interface SetProvisionPayloadData {
  token: string
  encryptedNsec: string
  primaryPubkey: string
  senderPubkey: string
}

export interface SetHubRoleData {
  pubkey: string
  hubId: string
  roleIds: string[]
}

// -------------------------------------------------------------------
// Settings service types
// -------------------------------------------------------------------

export interface TranscriptionSettings {
  globalEnabled: boolean
  allowUserOptOut: boolean
}

export interface IvrAudioEntry {
  hubId: string
  promptType: string
  language: string
  audioData: string // base64-encoded
  mimeType: string
}

export interface IvrAudioMeta {
  promptType: string
  language: string
  mimeType: string
}

export interface CreateRoleData {
  name: string
  permissions: string[]
  description: string
  hubId?: string
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
  /** Hub-key encrypted description (client provides). */
  encryptedDescription?: string
}

export interface UpdateRoleData {
  name?: string
  description?: string
  permissions?: string[]
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
  /** Hub-key encrypted description (client provides). */
  encryptedDescription?: string
}

export interface CreateHubData {
  id: string
  /** Plaintext name (legacy / server-side fallback). Prefer encryptedName for new clients. */
  name?: string
  description?: string
  status?: 'active' | 'suspended' | 'archived'
  phoneNumber?: string
  createdBy: string
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
  /** Hub-key encrypted description (client provides). */
  encryptedDescription?: string
}

export interface HubKeyEntry {
  pubkey: string
  wrappedKey: string
  ephemeralPubkey: string
}

export interface CaptchaEntry {
  callSid: string
  expectedDigits: string
}

// -------------------------------------------------------------------
// Records service types
// -------------------------------------------------------------------

export interface CreateBanData {
  phone: string
  reason: string
  bannedBy: string
  hubId?: string
}

export interface BulkBanData {
  phones: string[]
  reason: string
  bannedBy: string
  hubId?: string
}

export interface CreateCallRecordData {
  id: string
  hubId?: string
  callerLast4?: string
  startedAt: Date
  endedAt?: Date
  duration?: number
  status: string
  hasTranscription?: boolean
  hasVoicemail?: boolean
  hasRecording?: boolean
  recordingSid?: string
  voicemailFileId?: string
  encryptedContent?: string
  adminEnvelopes?: RecipientEnvelope[]
}

export interface CallRecordFilters {
  search?: string
  dateFrom?: string
  dateTo?: string
  voicemailOnly?: boolean
}

// Analytics types
export interface CallVolumeDay {
  date: string
  count: number
  answered: number
  voicemail: number
}

export interface CallHourBucket {
  hour: number
  count: number
}

export interface CreateNoteData {
  id?: string
  hubId?: string
  callId?: string
  conversationId?: string
  contactHash?: string
  authorPubkey: string
  encryptedContent: string
  ephemeralPubkey?: string
  authorEnvelope?: { wrappedKey: string; ephemeralPubkey: string }
  adminEnvelopes?: { pubkey: string; wrappedKey: string; ephemeralPubkey: string }[]
}

export interface UpdateNoteData {
  encryptedContent: string
  authorPubkey: string
  authorEnvelope?: { wrappedKey: string; ephemeralPubkey: string }
  adminEnvelopes?: { pubkey: string; wrappedKey: string; ephemeralPubkey: string }[]
}

export interface NoteFilters {
  authorPubkey?: string | null
  callId?: string | null
  conversationId?: string | null
  contactHash?: string | null
  page?: number
  limit?: number
  hubId?: string
}

export interface AuditFilters {
  page?: number
  limit?: number
  actorPubkey?: string
  eventType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  hubId?: string
}

// -------------------------------------------------------------------
// Shift service types
// -------------------------------------------------------------------

export interface ShiftSchedule {
  id: string
  hubId: string
  name: string
  encryptedName?: string
  startTime: string
  endTime: string
  days: number[]
  userPubkeys: string[]
  ringGroupId?: string | null
  createdAt: Date
}

export interface CreateScheduleData {
  hubId?: string
  /** Plaintext name (legacy / server-side fallback). Prefer encryptedName for new clients. */
  name?: string
  startTime: string
  endTime: string
  days: number[]
  userPubkeys: string[]
  ringGroupId?: string
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
}

export interface ShiftOverride {
  id: string
  hubId: string
  scheduleId?: string | null
  date: string
  type: string
  userPubkeys?: string[] | null
  createdAt: Date
}

export interface CreateOverrideData {
  hubId?: string
  scheduleId?: string
  date: string
  type: 'cancel' | 'substitute'
  userPubkeys?: string[]
}

export interface RingGroup {
  id: string
  hubId: string
  name: string
  encryptedName?: string
  userPubkeys: string[]
  createdAt: Date
}

export interface CreateRingGroupData {
  hubId?: string
  name: string
  userPubkeys: string[]
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
}

export interface ActiveShift {
  pubkey: string
  hubId: string
  startedAt: Date
  ringGroupId?: string | null
}

export interface StartShiftData {
  pubkey: string
  hubId?: string
  ringGroupId?: string
}

// -------------------------------------------------------------------
// Call service types
// -------------------------------------------------------------------

export interface ActiveCall {
  callSid: string
  hubId: string
  callerNumber: string
  status: string
  assignedPubkey?: string | null
  startedAt: Date
  metadata: Record<string, unknown>
}

export interface CreateActiveCallData {
  callSid: string
  hubId?: string
  callerNumber: string
  status?: string
  assignedPubkey?: string
}

export interface CallLeg {
  legSid: string
  callSid: string
  hubId: string
  userPubkey: string
  phone?: string | null
  type: 'phone' | 'browser'
  status: string
  createdAt: Date
}

export interface CreateCallLegData {
  legSid: string
  callSid: string
  hubId?: string
  userPubkey: string
  phone?: string
  type?: 'phone' | 'browser'
  status?: string
}

export interface CallTokenPayload {
  token: string
  callSid: string
  hubId: string
  pubkey: string
  expiresAt: Date
  createdAt: Date
}

export interface CreateCallTokenData {
  callSid: string
  hubId?: string
  pubkey: string
  ttlSeconds?: number
}

// -------------------------------------------------------------------
// Conversation service input types
// -------------------------------------------------------------------

export interface ConversationFilters {
  hubId?: string
  status?: string
  assignedTo?: string
  channelType?: string
  page?: number
  limit?: number
}

export interface CreateConversationData {
  hubId?: string
  channelType: string
  contactIdentifierHash: string
  contactLast4?: string
  externalId?: string
  assignedTo?: string
  status?: string
  metadata?: Record<string, unknown>
  /** Optional: bind this conversation to a report type (for web/report channelType) */
  reportTypeId?: string
  /** When true, always INSERT a new row instead of upserting on the unique constraint.
   *  Used by reports where the same contact can have multiple conversations. */
  skipDedup?: boolean
}

export interface CreateMessageData {
  conversationId: string
  direction: 'inbound' | 'outbound'
  authorPubkey: string
  encryptedContent: string
  readerEnvelopes?: RecipientEnvelope[]
  hasAttachments?: boolean
  attachmentIds?: string[]
  externalId?: string
  status?: string
  deliveryStatus?: MessageDeliveryStatus
  providerMessageId?: string
  deliveryError?: string
}

// -------------------------------------------------------------------
// Blast service types
// -------------------------------------------------------------------

export interface BlastStats {
  totalRecipients: number
  sent: number
  delivered: number
  failed: number
  optedOut: number
}

export interface SubscriberChannel {
  type: 'sms' | 'whatsapp' | 'signal' | 'rcs' | 'telegram'
  verified: boolean
}

export interface Blast {
  id: string
  hubId: string
  name: string
  encryptedName?: string
  targetChannels: string[]
  targetTags: string[]
  targetLanguages: string[]
  encryptedContent: string
  contentEnvelopes: RecipientEnvelope[]
  status: string
  stats: BlastStats
  createdAt: Date
  sentAt?: Date | null
  scheduledAt: Date | null
  error: string | null
}

export interface CreateBlastData {
  hubId?: string
  name: string
  targetChannels?: string[]
  targetTags?: string[]
  targetLanguages?: string[]
  encryptedContent?: string
  contentEnvelopes?: RecipientEnvelope[]
  status?: string
  scheduledAt?: Date
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
}

export interface Subscriber {
  id: string
  hubId: string
  identifierHash: string
  encryptedIdentifier: string | null
  channels: SubscriberChannel[]
  tags: string[]
  language?: string | null
  status: string
  doubleOptInConfirmed: boolean
  subscribedAt: Date
  preferenceToken: string
  createdAt: Date
}

export interface CreateSubscriberData {
  hubId?: string
  identifierHash: string
  encryptedIdentifier?: string
  channels?: SubscriberChannel[]
  tags?: string[]
  language?: string
  status?: string
  preferenceToken?: string
}

export interface BlastDelivery {
  id: string
  blastId: string
  subscriberId: string
  channelType: string
  status: string
  error?: string | null
  sentAt?: Date | null
  deliveredAt?: Date | null
}

export interface CreateDeliveryData {
  blastId: string
  subscriberId: string
  channelType?: string
  status?: string
  error?: string
}
