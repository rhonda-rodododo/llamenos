import type { BlastContent, BlastSettings, BlastStats } from '@shared/schemas/blasts'
import type {
  CallPreference,
  ChannelType,
  ContactType,
  CustomFieldContext,
  LocationPrecision,
  MessageDeliveryStatus,
  MessagingChannelType,
  RiskLevel,
} from '@shared/schemas/common'
import type { RetentionSettings } from '@shared/schemas/gdpr'
import type {
  RCSConfig,
  SMSConfig,
  SignalBridgeConfig as SignalConfig,
  TelegramConfig,
  WhatsAppConfig,
} from '@shared/schemas/providers'
import type { EnabledChannels, SetupState } from '@shared/schemas/settings'
import type { Ciphertext } from './crypto-types'

// --- Device Identity (Tier 3) ---

export interface DeviceKeypair {
  deviceId: string
  signing: {
    privateKey: CryptoKey // non-extractable Ed25519
    publicKey: Uint8Array // raw 32 bytes
  }
  encryption: {
    privateKey: CryptoKey // non-extractable X25519
    publicKey: Uint8Array // raw 32 bytes
  }
  createdAt: string // ISO 8601
  isPaperKey: boolean
}

export interface DeviceMetadata {
  deviceId: string
  signingPubkey: string // hex
  encryptionPubkey: string // hex
  encryptedDisplayName: string
  addedByDeviceId: string | null
  revokedAt: string | null
  createdAt: string
  lastSeenAt: string
}

export interface PukState {
  generation: number
  signPubkey: string // hex
  dhPubkey: string // hex
}

// --- Versioned ECIES Key Envelope ---

/**
 * Wire-format versioned ECIES key envelope with embedded label identity.
 * The `labelId` byte is looked up against LABEL_REGISTRY; a receiver that
 * expected a different label will refuse to unwrap (CryptoLabelMismatchError).
 */
export interface EnvelopeV2 {
  v: 2
  labelId: number
  wrappedKey: Ciphertext
  ephemeralPubkey: string
}

// --- ECIES Key Envelopes ---
// These use the branded Ciphertext type for internal type safety.
// The schema equivalents in @shared/schemas/records use plain strings (for zod validation).
// Keep these as the canonical types for app code; schemas are for API validation.

/**
 * Unified ECIES-wrapped symmetric key for one recipient.
 * Used everywhere: notes, messages, call records, hub keys.
 */
export interface RecipientEnvelope {
  pubkey: string
  wrappedKey: Ciphertext
  ephemeralPubkey: string
}

/** @deprecated Use RecipientEnvelope instead. Kept for gradual migration. */
export type KeyEnvelope = Omit<RecipientEnvelope, 'pubkey'>

// --- Telephony Provider Config ---

export type TelephonyProviderType =
  | 'twilio'
  | 'signalwire'
  | 'vonage'
  | 'plivo'
  | 'asterisk'
  | 'telnyx'
  | 'bandwidth'
  | 'freeswitch'

export const TELEPHONY_PROVIDER_LABELS: Record<TelephonyProviderType, string> = {
  twilio: 'Twilio',
  signalwire: 'SignalWire',
  vonage: 'Vonage',
  plivo: 'Plivo',
  asterisk: 'Asterisk (Self-Hosted)',
  telnyx: 'Telnyx',
  bandwidth: 'Bandwidth',
  freeswitch: 'FreeSWITCH (Self-Hosted)',
}

export type { TelephonyProviderConfig } from '@shared/schemas/providers'

/**
 * Flat draft type for form state when editing telephony provider settings.
 * All fields are optional except `type`, making it safe to use as a work-in-progress
 * buffer before assembling a valid discriminated union config for the API.
 */
export interface TelephonyProviderDraft {
  type: TelephonyProviderType
  phoneNumber?: string
  // Twilio
  accountSid?: string
  authToken?: string
  webrtcEnabled?: boolean
  apiKeySid?: string
  apiKeySecret?: string
  twimlAppSid?: string
  // SignalWire
  signalwireSpace?: string
  // Vonage
  apiKey?: string
  apiSecret?: string
  applicationId?: string
  privateKey?: string
  // Plivo
  authId?: string
  // Asterisk
  ariUrl?: string
  ariUsername?: string
  ariPassword?: string
  bridgeCallbackUrl?: string
  // FreeSWITCH
  eslUrl?: string
  eslPassword?: string
  freeswitchDomain?: string
  vertoWssPort?: number
  // Telnyx
  texmlAppId?: string
  // Bandwidth (accountId, apiSecret, applicationId already defined above)
  apiToken?: string
}

// --- Call Preference (re-exported from schema) ---

export type { CallPreference } from '@shared/schemas/common'

// --- Geocoding / Location Types ---

export type { LocationPrecision } from '@shared/schemas/common'

export type LocationResult = {
  address: string
  displayName?: string
  lat: number
  lon: number
  countryCode?: string
}

export type LocationFieldValue = {
  address: string
  displayName?: string
  lat?: number
  lon?: number
  source: 'geocoded' | 'gps' | 'manual'
}

export type GeocodingProvider = 'opencage' | 'geoapify'

export type GeocodingConfig = {
  provider: GeocodingProvider | null
  countries: string[]
  enabled: boolean
}

export type GeocodingConfigAdmin = GeocodingConfig & { apiKey: string }

export const GEOCODING_PROVIDER_LABELS: Record<GeocodingProvider, string> = {
  opencage: 'OpenCage',
  geoapify: 'Geoapify',
}

export const DEFAULT_GEOCODING_CONFIG: GeocodingConfigAdmin = {
  provider: null,
  apiKey: '',
  countries: [],
  enabled: false,
}

// --- Location Field Settings (for custom field definition) ---

export interface LocationFieldSettings {
  maxPrecision: LocationPrecision
  allowGps: boolean
}

// --- Custom Fields ---

export type { CustomFieldContext } from '@shared/schemas/common'

// --- Contact Directory ---

export type { ContactType, RiskLevel } from '@shared/schemas/common'

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  caller: 'Caller',
  'partner-org': 'Partner Org',
  'referral-resource': 'Referral Resource',
  other: 'Other',
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

/** Decrypted relationship between two contacts (from encrypted payload) */
export interface RelationshipPayload {
  fromContactId: string
  toContactId: string
  relationship: string
  isEmergency: boolean
}

/** Contact summary fields (Tier 1 — all members with contacts:envelope-summary) */
export interface ContactSummary {
  displayName: string
  notes: string
  languages: string[]
}

/** Contact PII fields (Tier 2 — per-field encrypted for contacts:envelope-full) */
export interface ContactPIIBlob {
  emailAddresses: string[]
  address: string
  dateOfBirth: string
  identifiers: { label: string; value: string }[]
}

/** Custom field definition — uses branded Ciphertext for encrypted fields.
 * The schema equivalent in @shared/schemas/settings uses plain strings (for API validation). */
export interface CustomFieldDefinition {
  id: string
  name: string
  label: string
  type:
    | 'text'
    | 'number'
    | 'select'
    | 'checkbox'
    | 'textarea'
    | 'file'
    | 'location'
    | 'contact'
    | 'contacts'
  required: boolean
  options?: string[]
  encryptedFieldName?: Ciphertext
  encryptedLabel?: Ciphertext
  encryptedOptions?: Ciphertext
  validation?: {
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
  }
  visibleTo: string
  context: CustomFieldContext
  reportTypeIds?: string[]
  maxFileSize?: number
  allowedMimeTypes?: string[]
  maxFiles?: number
  locationSettings?: LocationFieldSettings
  order: number
  createdAt: string
}

// --- Report Types ---

export interface ReportType {
  id: string
  hubId: string
  name: string
  description?: string
  /** Hub-key encrypted name (hex ciphertext). */
  encryptedName?: Ciphertext
  /** Hub-key encrypted description (hex ciphertext). */
  encryptedDescription?: Ciphertext
  isDefault: boolean
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateReportTypeInput {
  /**
   * Client-generated id. Required when `encryptedName` is provided so the
   * server stores the same id the client bound into AAD via buildAad().
   */
  id?: string
  name: string
  description?: string
  isDefault?: boolean
  encryptedName?: Ciphertext
  encryptedDescription?: Ciphertext
}

export interface UpdateReportTypeInput {
  name?: string
  description?: string
  isDefault?: boolean
  encryptedName?: Ciphertext
  encryptedDescription?: Ciphertext
}

// --- Encrypted File Upload Types ---

export interface EncryptedFileMetadata {
  originalName: string
  mimeType: string
  size: number
  dimensions?: { width: number; height: number }
  duration?: number
  checksum: string // SHA-256 of plaintext for integrity verification
}

/**
 * V2 ECIES-wrapped file encryption key for one recipient.
 * Extends EnvelopeV2 with a recipient pubkey tag for multi-recipient selection.
 * This is the canonical type for new file uploads (Task 8+).
 */
export interface FileKeyEnvelopeV2 extends EnvelopeV2 {
  pubkey: string
}

/**
 * @deprecated Legacy ECIES-wrapped file key (pre-Task 8 wire format).
 * Used only for compatibility with old API responses until the server is upgraded.
 * New uploads produce FileKeyEnvelopeV2.
 */
export interface FileKeyEnvelope {
  pubkey: string
  encryptedFileKey: Ciphertext
  ephemeralPubkey: string
}

export interface EncryptedMetaItem {
  pubkey: string
  encryptedContent: Ciphertext
  ephemeralPubkey: string
}

/** Value stored in NotePayload.fields for a file custom field. */
export interface FileFieldValue {
  /** References FileRecord.id — used to fetch envelopes, metadata, and content. */
  fileId: string
}

export interface FileRecord {
  id: string
  hubId: string
  conversationId: string | null
  messageId?: string
  uploadedBy: string // pubkey of uploader
  recipientEnvelopes: FileKeyEnvelope[]
  encryptedMetadata: EncryptedMetaItem[]
  totalSize: number // encrypted size in bytes
  totalChunks: number
  status: 'uploading' | 'complete' | 'failed'
  completedChunks: number
  createdAt: string
  completedAt?: string
  /** Optional context binding — set after the parent record (note, report, etc.) is saved. */
  contextType?: 'conversation' | 'note' | 'report' | 'custom_field' | 'voicemail'
  contextId?: string // noteId or reportId
}

export interface UploadInit {
  totalSize: number
  totalChunks: number
  conversationId: string
  /**
   * New uploads (Task 8+) send FileKeyEnvelopeV2 entries.
   * Typed as FileKeyEnvelope[] for backward compat with server code that stores/reads
   * the old shape; Task 9 will update both the server and this type to FileKeyEnvelopeV2[].
   */
  recipientEnvelopes: FileKeyEnvelope[]
  encryptedMetadata: EncryptedMetaItem[]
  /** Optional context binding — can be provided at init time or later via PATCH /context. */
  contextType?: 'conversation' | 'note' | 'report' | 'custom_field' | 'voicemail'
  contextId?: string
  /**
   * Client-generated UUID used as the AAD file identity during encryption (Task 8+).
   * Server uses this as the canonical fileId so that fileId-bound AAD round-trips on decrypt.
   * Server-side acceptance is implemented in Task 9.
   */
  fileId?: string
}

/** What gets encrypted before storage — replaces plain text */
export interface NotePayload {
  text: string
  fields?: Record<string, string | string[] | number | boolean | FileFieldValue>
}

export const MAX_CUSTOM_FIELDS = 20
export const MAX_SELECT_OPTIONS = 50
export const MAX_FIELD_NAME_LENGTH = 50
export const MAX_FIELD_LABEL_LENGTH = 200
export const MAX_OPTION_LENGTH = 200
export const FIELD_NAME_REGEX = /^[a-zA-Z0-9_]+$/

/** Check if a custom field should appear in a given context */
export function fieldMatchesContext(
  field: CustomFieldDefinition,
  context: CustomFieldContext
): boolean {
  return field.context === context || field.context === 'all'
}

export const CUSTOM_FIELD_CONTEXT_LABELS: Record<CustomFieldContext, string> = {
  'call-notes': 'Call Notes',
  'conversation-notes': 'Conversation Notes',
  reports: 'Reports',
  all: 'All Record Types',
}

// --- Messaging Channel Types (re-exported from schema) ---

export type {
  MessageDeliveryStatus,
  MessagingChannelType,
  ChannelType,
} from '@shared/schemas/common'

/** Transport security level for each channel */
export type TransportSecurity = 'none' | 'provider-encrypted' | 'e2ee-to-bridge' | 'e2ee'

export const CHANNEL_SECURITY: Record<ChannelType, TransportSecurity> = {
  voice: 'provider-encrypted',
  sms: 'none',
  whatsapp: 'provider-encrypted',
  signal: 'e2ee-to-bridge',
  rcs: 'provider-encrypted',
  telegram: 'provider-encrypted',
  reports: 'e2ee',
}

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  voice: 'Voice Calls',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  rcs: 'RCS',
  telegram: 'Telegram',
  reports: 'Reports',
}

// --- Messaging Configuration (re-exported from schema) ---
// SignalConfig is SignalBridgeConfig in the schema — re-exported with alias for compatibility

export type {
  SMSConfig,
  WhatsAppConfig,
  RCSConfig,
  TelegramConfig,
} from '@shared/schemas/providers'

export type { SignalBridgeConfig as SignalConfig } from '@shared/schemas/providers'

export interface MessagingConfig {
  enabledChannels: MessagingChannelType[]
  sms: SMSConfig | null
  whatsapp: WhatsAppConfig | null
  signal: SignalConfig | null
  rcs: RCSConfig | null
  telegram: TelegramConfig | null
  autoAssign: boolean // auto-assign to on-shift users
  inactivityTimeout: number // minutes before auto-close
  maxConcurrentPerUser: number // conversation limit per user
}

export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = {
  enabledChannels: [],
  sms: null,
  whatsapp: null,
  signal: null,
  rcs: null,
  telegram: null,
  autoAssign: true,
  inactivityTimeout: 60,
  maxConcurrentPerUser: 3,
}

// --- Message Blasts ---

export interface Subscriber {
  id: string
  identifierHash: string // HMAC hash of phone/identifier
  channels: SubscriberChannel[]
  tags: string[]
  language: string // preferred language code
  subscribedAt: string
  status: 'active' | 'paused' | 'unsubscribed'
  doubleOptInConfirmed: boolean
  preferenceToken: string // HMAC token for self-service preferences
}

export interface SubscriberChannel {
  type: MessagingChannelType
  verified: boolean
}

export interface Blast {
  id: string
  name: string
  /** Hub-key encrypted blast name (hex ciphertext). */
  encryptedName?: Ciphertext
  encryptedContent: Ciphertext
  contentEnvelopes: RecipientEnvelope[]
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
  targetChannels: MessagingChannelType[]
  targetTags: string[] // empty = all subscribers
  targetLanguages: string[] // empty = all languages
  scheduledAt?: string
  sentAt?: string
  cancelledAt?: string
  createdBy: string // pubkey
  createdAt: string
  updatedAt: string
  stats: BlastStats
}

export type { BlastContent, BlastStats, BlastSettings } from '@shared/schemas/blasts'

export const DEFAULT_BLAST_SETTINGS: BlastSettings = {
  subscribeKeyword: 'JOIN',
  unsubscribeKeyword: 'STOP',
  confirmationMessage: 'You have been subscribed. Reply STOP to unsubscribe.',
  unsubscribeMessage: 'You have been unsubscribed. Reply JOIN to resubscribe.',
  doubleOptIn: false,
  optOutFooter: '\nReply STOP to unsubscribe.',
  maxBlastsPerDay: 10,
  rateLimitPerSecond: 10,
}

// --- Setup State (re-exported from schema) ---

export type { SetupState, EnabledChannels } from '@shared/schemas/settings'

export const DEFAULT_SETUP_STATE: SetupState = {
  setupCompleted: false,
  completedSteps: [],
  pendingChannels: [],
  selectedChannels: [],
  demoMode: false,
}

// --- GDPR ---

/** The current platform consent version string. Bump this date to require re-consent. */
export const CONSENT_VERSION = '2026-03-22'

export type { RetentionSettings } from '@shared/schemas/gdpr'

export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  callRecordsDays: 365,
  notesDays: 365,
  messagesDays: 180,
  auditLogDays: 1825,
}

export interface GdprConsentStatus {
  hasConsented: boolean
  consentVersion: string | null
  consentedAt: string | null
  currentPlatformVersion: string
}

export interface GdprErasureRequest {
  pubkey: string
  requestedAt: string
  executeAt: string
  status: 'pending' | 'cancelled' | 'executed'
}

// --- Hub Types (re-exported from schema) ---

export type { Hub } from '@shared/schemas/settings'

export interface HubRoleAssignment {
  hubId: string
  roleIds: string[]
}

// --- Provider OAuth Auto-Config Types (Epic 48) ---

export interface OAuthState {
  state: string // 32-byte hex CSRF token
  provider: 'twilio' | 'telnyx'
  expiresAt: number // Unix ms — 10-minute TTL
}

export interface NumberInfo {
  phoneNumber: string // E.164
  friendlyName: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  sid?: string // provider-specific ID (Twilio SID, Telnyx ID, etc.)
}

export type SupportedProvider = 'twilio' | 'telnyx' | 'signalwire' | 'vonage' | 'plivo'

export interface ProviderConfig {
  provider: SupportedProvider
  connected: boolean
  phoneNumber?: string
  webhooksConfigured: boolean
  sipConfigured: boolean
  a2pStatus?: 'not_started' | 'pending' | 'approved' | 'failed' | 'skipped'
  brandSid?: string
  campaignSid?: string
  messagingServiceSid?: string
  // Encrypted credential fields are stored in SettingsDO, not in this type
}

export interface SipTrunkConfig {
  sipProvider: string // e.g. 'sip.twilio.com'
  sipUsername: string
  sipPassword: string
  trunkSid?: string // Twilio Trunk SID
  connectionId?: string // Telnyx Connection ID
}

// --- Signal Registration ---

export interface SignalRegistrationPending {
  number: string
  bridgeUrl: string
  method: 'sms' | 'voice'
  expiresAt: string // ISO 8601
  status: 'pending' | 'complete' | 'failed'
  error?: string
}

// ── Provider capability result types ──

export interface ConnectionTestResult {
  connected: boolean
  latencyMs: number
  accountName?: string
  error?: string
  errorType?:
    | 'invalid_credentials'
    | 'network_error'
    | 'rate_limited'
    | 'account_suspended'
    | 'unknown'
}

export interface WebhookUrlSet {
  voiceIncoming?: string
  voiceStatus?: string
  voiceFallback?: string
  smsIncoming?: string
  smsStatus?: string
  whatsappIncoming?: string
  signalIncoming?: string
  rcsIncoming?: string
  telegramIncoming?: string
}

export interface PhoneNumberInfo {
  number: string
  country: string
  locality?: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  monthlyFee?: string
  owned: boolean
}

export interface NumberSearchQuery {
  country: string
  areaCode?: string
  contains?: string
  limit?: number
}

export interface ProvisionResult {
  ok: boolean
  number?: string
  error?: string
}

export interface AutoConfigResult {
  ok: boolean
  error?: string
  details?: Record<string, unknown>
}

export interface SipTrunkOptions {
  domain?: string
  username?: string
  password?: string
}
