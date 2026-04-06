/**
 * Authoritative domain separation constants for all cryptographic operations.
 *
 * Every ECIES derivation, HKDF context, HMAC key, and Schnorr signature binding
 * uses a unique context string from this file. This prevents cross-context key
 * reuse attacks where a ciphertext from one domain could be valid in another.
 *
 * RULES:
 * 1. NEVER use raw string literals for crypto contexts — import from here
 * 2. New crypto operations MUST add a new constant before implementation
 * 3. All constants are prefixed with 'llamenos:' for collision avoidance
 */

// --- ECIES Key Wrapping ---

/** Per-note symmetric key wrapping (V2 forward secrecy) */
export const LABEL_NOTE_KEY = 'llamenos:note-key'

/** Per-file symmetric key wrapping */
export const LABEL_FILE_KEY = 'llamenos:file-key'

/** File metadata ECIES wrapping */
export const LABEL_FILE_METADATA = 'llamenos:file-metadata'

/** Hub key ECIES distribution wrapping (Epic 76.2) */
export const LABEL_HUB_KEY_WRAP = 'llamenos:hub-key-wrap'

// --- ECIES Content Encryption ---

/** Server-side transcription encryption */
export const LABEL_TRANSCRIPTION = 'llamenos:transcription'

/** E2EE message encryption (Epic 74) */
export const LABEL_MESSAGE = 'llamenos:message'

/** Blast content ECIES envelope encryption */
export const LABEL_BLAST_CONTENT = 'llamenos:blast-content'

/** Encrypted call record metadata (Epic 77) — call assignments in history */
export const LABEL_CALL_META = 'llamenos:call-meta'

/** Encrypted shift schedule details (Epic 77) — full schedule beyond routing pubkeys */
export const LABEL_SHIFT_SCHEDULE = 'llamenos:shift-schedule'

// --- HKDF Derivation ---

/** HKDF salt for legacy symmetric key derivation */
export const HKDF_SALT = 'llamenos:hkdf-salt:v1'

/** HKDF context: legacy V1 note encryption */
export const HKDF_CONTEXT_NOTES = 'llamenos:notes'

/** HKDF context: draft encryption */
export const HKDF_CONTEXT_DRAFTS = 'llamenos:drafts'

/** HKDF context: export encryption */
export const HKDF_CONTEXT_EXPORT = 'llamenos:export'

/** Hub event HKDF derivation from hub key (Epic 76.2) */
export const LABEL_HUB_EVENT = 'llamenos:hub-event'

// --- ECDH Key Agreement ---

/** Device provisioning ECDH shared key derivation */
export const LABEL_DEVICE_PROVISION = 'llamenos:device-provision'

// --- SAS Verification (Epic 76.0) ---

/** SAS HKDF salt for provisioning verification */
export const SAS_SALT = 'llamenos:sas'

/** SAS HKDF info parameter */
export const SAS_INFO = 'llamenos:provisioning-sas'

// --- Auth Token ---

/** Schnorr auth token message prefix
 * @deprecated Will be removed when Schnorr server auth is deleted in a later task
 */
export const AUTH_PREFIX = 'llamenos:auth:'

// --- HMAC Domain Separation ---

/** Phone number hashing prefix */
export const HMAC_PHONE_PREFIX = 'llamenos:phone:'

/** IP address hashing prefix */
export const HMAC_IP_PREFIX = 'llamenos:ip:'

/** Key identification hashing prefix */
export const HMAC_KEYID_PREFIX = 'llamenos:keyid:'

/** Subscriber identifier HMAC key */
export const HMAC_SUBSCRIBER = 'llamenos:subscriber'

/** Preference token HMAC key */
export const HMAC_PREFERENCE_TOKEN = 'llamenos:preference-token'

// --- Recovery / Backup ---

/** Recovery key PBKDF2 fallback salt (legacy) */
export const RECOVERY_SALT = 'llamenos:recovery'

/** Generic backup encryption (Epic 76.0 — new format) */
export const LABEL_BACKUP = 'llamenos:backup'

// --- Server Nostr Identity (Epic 76.1) ---

/** HKDF derivation for server Nostr keypair from SERVER_NOSTR_SECRET */
export const LABEL_SERVER_NOSTR_KEY = 'llamenos:server-nostr-key'

/** HKDF info parameter for server Nostr key (versioned for rotation) */
export const LABEL_SERVER_NOSTR_KEY_INFO = 'llamenos:server-nostr-key:v1'

// --- Push Notification Encryption (Epic 86) ---

/** Wake-tier ECIES push payload — decryptable without PIN (minimal metadata only) */
export const LABEL_PUSH_WAKE = 'llamenos:push-wake'

/** Full-tier ECIES push payload — decryptable only with user's nsec */
export const LABEL_PUSH_FULL = 'llamenos:push-full'

// --- Contact Identifier Encryption (Epic 255) ---

/** HKDF context for contact identifier encryption at rest */
export const LABEL_CONTACT_ID = 'llamenos:contact-identifier'

// --- Provider Credential Encryption (Epic 48) ---

/** ECIES wrapping of provider OAuth/API credentials stored in SettingsDO */
export const LABEL_PROVIDER_CREDENTIAL_WRAP = 'llamenos:provider-credential-wrap:v1'

// --- Voicemail Encryption ---

/** Voicemail audio symmetric key wrapping (ECIES) */
export const LABEL_VOICEMAIL_WRAP = 'llamenos:voicemail-audio'

/** Voicemail transcript encryption (domain-separated from generic LABEL_MESSAGE) */
export const LABEL_VOICEMAIL_TRANSCRIPT = 'llamenos:voicemail-transcript'

// --- Contact Intake Encryption ---

/** Contact intake payload — E2EE, enveloped for submitter + triage users. */
export const LABEL_CONTACT_INTAKE = 'llamenos:contact-intake:v1'

// --- Contact Directory Encryption ---

/** Contact summary (Tier 1) — display name, notes, languages. Enveloped for contacts:envelope-summary recipients. */
export const LABEL_CONTACT_SUMMARY = 'llamenos:contact-summary'

/** Contact PII (Tier 2) — full name, phone, email, address, DOB. Enveloped for contacts:envelope-full recipients. */
export const LABEL_CONTACT_PII = 'llamenos:contact-pii'

/** Contact relationship payload — fully E2EE, server sees nothing. Enveloped for contacts:envelope-full recipients. */
export const LABEL_CONTACT_RELATIONSHIP = 'llamenos:contact-relationship'

// --- Storage Credential Encryption ---

/** Hub storage credential (IAM secret key) wrapping with hub key */
export const LABEL_STORAGE_CREDENTIAL_WRAP = 'llamenos:storage-credential'

// --- IdP Auth Hardening (Epic 99) ---

/** WebAuthn PRF evaluation salt for KEK derivation */
export const LABEL_KEK_PRF = 'llamenos:kek-prf'

/** HKDF info for 3-factor (PIN + PRF + IdP) KEK derivation */
export const LABEL_NSEC_KEK_3F = 'llamenos:nsec-kek:3f'

/** HKDF info for 2-factor (PIN + IdP) KEK derivation */
export const LABEL_NSEC_KEK_2F = 'llamenos:nsec-kek:2f'

/** Envelope encryption of idp_value at rest in the IdP */
export const LABEL_IDP_VALUE_WRAP = 'llamenos:idp-value-wrap'

// --- Field-Level Encryption (Phase 2A) ---

/** Server-key encryption of audit log events and details */
export const LABEL_AUDIT_EVENT = 'llamenos:audit-event:v1'

/** Server-key encryption of IVR audio prompt data */
export const LABEL_IVR_AUDIO = 'llamenos:ivr-audio:v1'

/** Server-key encryption of blast settings messages (welcome, bye, double opt-in) */
export const LABEL_BLAST_SETTINGS = 'llamenos:blast-settings:v1'

// --- Field-Level Encryption (Phase 1) ---

/** Server-key encryption of user/invite PII (phone numbers) */
export const LABEL_USER_PII = 'llamenos:volunteer-pii:v1'

/** Server-key encryption of ephemeral call data (caller numbers during active calls) */
export const LABEL_EPHEMERAL_CALL = 'llamenos:ephemeral-call:v1'

/** Server-key encryption of push notification credentials (endpoints, auth keys) */
export const LABEL_PUSH_CREDENTIAL = 'llamenos:push-credential:v1'

/** Session metadata envelope (IP, UA, location) — user-envelope encrypted */
export const LABEL_SESSION_META = 'llamenos:session-meta:v1'

// --- Firehose Report Agent ---

/** Firehose agent nsec sealed encryption (per-connection, derived from deploy secret) */
export const LABEL_FIREHOSE_AGENT_SEAL = 'llamenos:firehose:agent-seal'

/** Firehose message buffer at-rest encryption (agent-key encrypted) */
export const LABEL_FIREHOSE_BUFFER_ENCRYPT = 'llamenos:firehose:buffer-encrypt'

/** Firehose extracted report envelope wrapping */
export const LABEL_FIREHOSE_REPORT_WRAP = 'llamenos:firehose:report-wrap'

// --- User Auth Event History (Plan B) ---

/** User-scoped auth event payload envelope */
export const LABEL_AUTH_EVENT = 'llamenos:user-auth-event:v1'

// --- Signal Notification Layer (Plan C) ---

/** Signal contact identifier envelope (user-scoped) */
export const LABEL_SIGNAL_CONTACT = 'llamenos:signal-contact:v1'
