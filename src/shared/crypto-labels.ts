/**
 * Authoritative domain separation constants for all cryptographic operations.
 *
 * Every ECIES derivation, HKDF context, HMAC key, and Schnorr signature binding
 * uses a unique context string from this file. This prevents cross-context key
 * reuse attacks where a ciphertext from one domain could be valid in another.
 *
 * RULES:
 * 1. NEVER use raw string literals for crypto contexts — import from here
 * 2. Constants passed as the `label` argument of ECIES/AEAD calls, OR enrolled
 *    in LABEL_REGISTRY (wire-format index), MUST carry the `CryptoLabel` brand
 * 3. HKDF salts/info fragments, HMAC key/prefix bytes, SAS salts, auth message
 *    prefixes, and recovery-key salts are NOT crypto-operation labels in the
 *    Tier 0 sense — leave them as plain strings
 * 4. New crypto operations MUST add a new constant before implementation
 * 5. All constants are prefixed with 'llamenos:' for collision avoidance
 */

// --- Branded type for crypto-operation labels ---
// Constants carry the CryptoLabel brand if they are passed as the `label`
// argument of ECIES/AEAD functions (eciesWrapKey, eciesUnwrapKey,
// symmetricEncrypt, symmetricDecrypt, etc.) OR if they are enrolled in
// LABEL_REGISTRY for the stable wire-format index. HKDF salts/info fragments,
// HMAC prefixes, SAS salts, auth prefixes, and recovery-key salts are plain
// strings — they are NOT crypto-operation labels in the Tier 0 sense.

declare const __CryptoLabelBrand: unique symbol
export type CryptoLabel = string & { readonly [__CryptoLabelBrand]: never }

// --- ECIES Key Wrapping ---

/** Per-note symmetric key wrapping (forward secrecy) */
export const LABEL_NOTE_KEY = 'llamenos:note-key' as CryptoLabel

/** Per-file symmetric key wrapping */
export const LABEL_FILE_KEY = 'llamenos:file-key' as CryptoLabel

/** File metadata ECIES wrapping */
export const LABEL_FILE_METADATA = 'llamenos:file-metadata' as CryptoLabel

/** Hub key ECIES distribution wrapping (Epic 76.2) */
export const LABEL_HUB_KEY_WRAP = 'llamenos:hub-key-wrap' as CryptoLabel

// --- ECIES Content Encryption ---

/** Server-side transcription encryption */
export const LABEL_TRANSCRIPTION = 'llamenos:transcription' as CryptoLabel

/** E2EE message encryption (Epic 74) */
export const LABEL_MESSAGE = 'llamenos:message' as CryptoLabel

/** Blast content ECIES envelope encryption */
export const LABEL_BLAST_CONTENT = 'llamenos:blast-content' as CryptoLabel

/** Encrypted call record metadata (Epic 77) — call assignments in history */
export const LABEL_CALL_META = 'llamenos:call-meta' as CryptoLabel

/** Encrypted shift schedule details (Epic 77) — full schedule beyond routing pubkeys */
export const LABEL_SHIFT_SCHEDULE = 'llamenos:shift-schedule' as CryptoLabel

// --- HKDF Derivation ---

/** HKDF salt for symmetric key derivation */
export const HKDF_SALT = 'llamenos:hkdf-salt:v1'

/** HKDF context: draft encryption */
export const HKDF_CONTEXT_DRAFTS = 'llamenos:drafts'

/** HKDF context: export encryption */
export const HKDF_CONTEXT_EXPORT = 'llamenos:export'

/** Hub event HKDF derivation from hub key (Epic 76.2) */
export const LABEL_HUB_EVENT = 'llamenos:hub-event' as CryptoLabel

// --- ECDH Key Agreement ---

/** Device provisioning ECDH shared key derivation */
export const LABEL_DEVICE_PROVISION = 'llamenos:device-provision' as CryptoLabel

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
export const LABEL_BACKUP = 'llamenos:backup' as CryptoLabel

// --- Server Nostr Identity (Epic 76.1) ---

/** HKDF derivation for server Nostr keypair from SERVER_NOSTR_SECRET */
export const LABEL_SERVER_NOSTR_KEY = 'llamenos:server-nostr-key'

/** HKDF info parameter for server Nostr key (versioned for rotation) */
export const LABEL_SERVER_NOSTR_KEY_INFO = 'llamenos:server-nostr-key:v1'

// --- Server HPKE Identity (Tier 1) ---

/** HKDF derivation for server HPKE X25519 keypair from SERVER_SECRET */
export const LABEL_SERVER_HPKE_KEY = 'llamenos:server-hpke-key'

/** HKDF info parameter for server HPKE key (versioned for rotation) */
export const LABEL_SERVER_HPKE_KEY_INFO = 'llamenos:server-hpke-key:v1'

// --- Push Notification Encryption (Epic 86) ---

/** Wake-tier ECIES push payload — decryptable without PIN (minimal metadata only) */
export const LABEL_PUSH_WAKE = 'llamenos:push-wake' as CryptoLabel

/** Full-tier ECIES push payload — decryptable only with user's nsec */
export const LABEL_PUSH_FULL = 'llamenos:push-full' as CryptoLabel

// --- Contact Identifier Encryption (Epic 255) ---

/** ECIES/AEAD context for contact identifier encryption at rest */
export const LABEL_CONTACT_ID = 'llamenos:contact-identifier' as CryptoLabel

// --- Provider Credential Encryption (Epic 48) ---

/** ECIES wrapping of provider OAuth/API credentials stored in SettingsDO */
export const LABEL_PROVIDER_CREDENTIAL_WRAP = 'llamenos:provider-credential-wrap:v1' as CryptoLabel

// --- Voicemail Encryption ---

/** Voicemail audio symmetric key wrapping (ECIES) */
export const LABEL_VOICEMAIL_WRAP = 'llamenos:voicemail-audio' as CryptoLabel

/** Voicemail transcript encryption (domain-separated from generic LABEL_MESSAGE) */
export const LABEL_VOICEMAIL_TRANSCRIPT = 'llamenos:voicemail-transcript' as CryptoLabel

// --- Contact Intake Encryption ---

/** Contact intake payload — E2EE, enveloped for submitter + triage users. */
export const LABEL_CONTACT_INTAKE = 'llamenos:contact-intake:v1' as CryptoLabel

// --- Contact Directory Encryption ---

/** Contact summary (Tier 1) — display name, notes, languages. Enveloped for contacts:envelope-summary recipients. */
export const LABEL_CONTACT_SUMMARY = 'llamenos:contact-summary' as CryptoLabel

/** Contact PII (Tier 2) — full name, phone, email, address, DOB. Enveloped for contacts:envelope-full recipients. */
export const LABEL_CONTACT_PII = 'llamenos:contact-pii' as CryptoLabel

/** Contact relationship payload — fully E2EE, server sees nothing. Enveloped for contacts:envelope-full recipients. */
export const LABEL_CONTACT_RELATIONSHIP = 'llamenos:contact-relationship' as CryptoLabel

// --- Storage Credential Encryption ---

/** Hub storage credential (IAM secret key) wrapping with hub key */
export const LABEL_STORAGE_CREDENTIAL_WRAP = 'llamenos:storage-credential' as CryptoLabel

// --- Hub Field Encryption ---

/** Hub-key encryption of stored field values (used by hub-field-crypto AAD) */
export const LABEL_HUB_FIELD = 'llamenos:hub-field' as CryptoLabel

// --- IdP Auth Hardening (Epic 99) ---

/** WebAuthn PRF evaluation salt for KEK derivation */
export const LABEL_KEK_PRF = 'llamenos:kek-prf'

/** HKDF info for 3-factor (PIN + PRF + IdP) KEK derivation */
export const LABEL_NSEC_KEK_3F = 'llamenos:nsec-kek:3f'

/** HKDF info for 2-factor (PIN + IdP) KEK derivation */
export const LABEL_NSEC_KEK_2F = 'llamenos:nsec-kek:2f'

/** Envelope encryption of idp_value at rest in the IdP */
export const LABEL_IDP_VALUE_WRAP = 'llamenos:idp-value-wrap' as CryptoLabel

// --- Field-Level Encryption (Phase 2A) ---

/** Server-key encryption of audit log events and details */
export const LABEL_AUDIT_EVENT = 'llamenos:audit-event:v1' as CryptoLabel

/** Server-key encryption of IVR audio prompt data */
export const LABEL_IVR_AUDIO = 'llamenos:ivr-audio:v1' as CryptoLabel

/** Server-key encryption of blast settings messages (welcome, bye, double opt-in) */
export const LABEL_BLAST_SETTINGS = 'llamenos:blast-settings:v1' as CryptoLabel

// --- Field-Level Encryption (Phase 1) ---

/** Server-key encryption of user/invite PII (phone numbers) */
export const LABEL_USER_PII = 'llamenos:volunteer-pii:v1' as CryptoLabel

/** Server-key encryption of ephemeral call data (caller numbers during active calls) */
export const LABEL_EPHEMERAL_CALL = 'llamenos:ephemeral-call:v1' as CryptoLabel

/** Server-key encryption of push notification credentials (endpoints, auth keys) */
export const LABEL_PUSH_CREDENTIAL = 'llamenos:push-credential:v1' as CryptoLabel

/** Session metadata envelope (IP, UA, location) — user-envelope encrypted */
export const LABEL_SESSION_META = 'llamenos:session-meta:v1' as CryptoLabel

// --- Firehose Report Agent ---

/** Firehose agent nsec sealed encryption (per-connection, derived from deploy secret) */
export const LABEL_FIREHOSE_AGENT_SEAL = 'llamenos:firehose:agent-seal' as CryptoLabel

/** Firehose message buffer at-rest encryption (agent-key encrypted) */
export const LABEL_FIREHOSE_BUFFER_ENCRYPT = 'llamenos:firehose:buffer-encrypt' as CryptoLabel

/** Firehose extracted report envelope wrapping */
export const LABEL_FIREHOSE_REPORT_WRAP = 'llamenos:firehose:report-wrap' as CryptoLabel

// --- User Auth Event History (Plan B) ---

/** User-scoped auth event payload envelope */
export const LABEL_AUTH_EVENT = 'llamenos:user-auth-event:v1' as CryptoLabel

// --- Signal Notification Layer (Plan C) ---

/** Signal contact identifier envelope (user-scoped) */
export const LABEL_SIGNAL_CONTACT = 'llamenos:signal-contact:v1' as CryptoLabel

// --- Tier 2: Root KEK + factor wrapping (2026-04) ---
//
// These are HKDF info / AES-KW context strings — they bind a factor-specific
// wrapping key to its purpose so the same raw bytes (e.g. a WebAuthn PRF
// output) can never be reused across factor types. They are NOT enrolled in
// LABEL_REGISTRY: the on-wire ciphertext is an AES-KW blob stored in the
// root-KEK envelope, not in the legacy label-tagged framing.

/** WebAuthn PRF evaluation salt (Tier 2 root KEK unlock, primary factor). */
export const LABEL_PRF_KEK_SALT_V1 = 'llamenos:kek-prf-salt:v1' as CryptoLabel

/** AES-KW wrap of the root KEK — used as HKDF `info` suffix per factor. */
export const LABEL_ROOT_KEK_WRAP = 'llamenos:root-kek-wrap' as CryptoLabel

/** HKDF context for deriving a wrapping key from a BIP-39 recovery phrase. */
export const LABEL_RECOVERY_PHRASE_KEK = 'llamenos:recovery-phrase-kek' as CryptoLabel

/** HKDF context for deriving a wrapping key from the OPAQUE 64-byte export key. */
export const LABEL_OPAQUE_EXPORT_KEK = 'llamenos:opaque-export-kek' as CryptoLabel

/** HKDF context for deriving a wrapping key from a recovery-group share. */
export const LABEL_RECOVERY_GROUP_WRAP = 'llamenos:recovery-group-wrap' as CryptoLabel

/** HKDF context for per-member SSS share derivation in the recovery group. */
export const LABEL_RECOVERY_GROUP_SHARE = 'llamenos:recovery-group-share' as CryptoLabel

/** HKDF context for the per-session payload wrapping the reconstructed KEK. */
export const LABEL_RECOVERY_SESSION_PAYLOAD = 'llamenos:recovery-session-payload' as CryptoLabel

// --- Tier 3: Per-Device Keys + PUK + Sigchain ---

/** PUK-derived Ed25519 signing key context */
export const LABEL_PUK_SIGN = 'llamenos:puk:sign:v1' as CryptoLabel

/** PUK-derived X25519 DH key context */
export const LABEL_PUK_DH = 'llamenos:puk:dh:v1' as CryptoLabel

/** PUK-derived AES-GCM-256 SecretBox key context (wraps previous generations) */
export const LABEL_PUK_SECRETBOX = 'llamenos:puk:secretbox:v1' as CryptoLabel

/** HPKE info for wrapping the PUK seed to a device X25519 pubkey */
export const LABEL_PUK_WRAP_TO_DEVICE = 'llamenos:puk:wrap:device:v1' as CryptoLabel

/** AAD for encrypting old PUK seed under the new PUK SecretBox key */
export const LABEL_PUK_PREVIOUS_GEN = 'llamenos:puk:prev-gen:v1' as CryptoLabel

/** AAD for wrapping the master signing seed under the PUK SecretBox key */
export const LABEL_MASTER_KEY_WRAP = 'llamenos:master:wrap:v1' as CryptoLabel

/** HMAC label: master seed → self-signing seed */
export const LABEL_MASTER_SELF_SIGNING = 'llamenos:master:self-signing:v1' as CryptoLabel

/** HMAC label: master seed → user-signing seed */
export const LABEL_MASTER_USER_SIGNING = 'llamenos:master:user-signing:v1' as CryptoLabel

/** HPKE info for one-shot master seed handoff during recovery */
export const LABEL_MASTER_RECOVERY_HANDOFF = 'llamenos:master:recovery-handoff:v1' as CryptoLabel

/** AAD for wrapping master seed under Recovery Group pubkey */
export const LABEL_MASTER_RECOVERY_GROUP_WRAP = 'llamenos:master:recovery-group:v1' as CryptoLabel

/** AAD for wrapping PUK seed under Recovery Group pubkey */
export const LABEL_PUK_RECOVERY_GROUP_WRAP = 'llamenos:puk:recovery-group:v1' as CryptoLabel

/** AAD for encrypting device display_name under the PUK SecretBox key */
export const LABEL_DEVICE_DISPLAY = 'llamenos:device:display:v1' as CryptoLabel

/** HKDF salt for device enrollment SAS code derivation */
export const LABEL_DEVICE_ENROLLMENT_SAS = 'llamenos:device:enrollment-sas:v1' as CryptoLabel

/** HMAC label: BIP39 seed → paper-key signing seed */
export const LABEL_PAPER_KEY_SIGNING = 'llamenos:paper-key:sign:v1' as CryptoLabel

/** HMAC label: BIP39 seed → paper-key encryption seed */
export const LABEL_PAPER_KEY_ENCRYPTION = 'llamenos:paper-key:encryption:v1' as CryptoLabel

/** AAD for wrapping old hub PTK under new hub PTK in CLKR chain */
export const LABEL_HUB_PTK_PREV_GEN = 'llamenos:hub-ptk:prev-gen:v1' as CryptoLabel

// --- SFrame Voice E2EE (Tier 5) ---

/** HPKE-wrapped SFrame call secret — distributed per-call via Nostr to peer devices */
export const LABEL_SFRAME_CALL_SECRET = 'llamenos:sframe-call-secret:v1' as CryptoLabel

/** HKDF info for per-sender SFrame base key derivation from call secret */
export const LABEL_SFRAME_BASE_KEY = 'llamenos:sframe-base-key:v1' as CryptoLabel

/**
 * HKDF salt for forward-secret ratchet on device join.
 * Plain string — HKDF info/salt only, never used as AEAD `label` argument.
 */
export const LABEL_SFRAME_RATCHET = 'llamenos:sframe-ratchet:v1'

// --- Tier 6 (MLS + PQ) ---

/** 7-emoji SAS derivation from device Ed25519 pubkey (Tier 6 fingerprint verification) */
export const LABEL_SAS_MLS = 'llamenos:sas:v2' as CryptoLabel

/**
 * 7-emoji SAS v3 — binds verifier pubkey + target pubkey + session nonce.
 * Supersedes LABEL_SAS_MLS, which derived from the target pubkey only and was
 * trivially precomputable by any attacker who knew the public key.
 * Plain string — HKDF info only, never used as AEAD `label` argument.
 */
export const LABEL_SAS_MLS_V3 = 'llamenos:sas:v3'

/**
 * MLS exporter-secret → per-user items_key derivation.
 * Plain string — HKDF info only, never used as AEAD `label` argument.
 */
export const LABEL_ITEMS_KEY_EXPORT = 'llamenos:items-key-export:v1'

/**
 * MLS exporter-secret → per-note epoch-bound key (provable delete).
 * Plain string — HKDF info only, never used as AEAD `label` argument.
 */
export const LABEL_NOTE_EPOCH_KEY = 'llamenos:note-epoch-key:v1'

/**
 * HKDF domain separation for MLS credential provisioning.
 * Plain string — HKDF info only, never used as AEAD `label` argument.
 */
export const LABEL_MLS_PROVISION = 'llamenos:mls-provision:v1'

// --- Label Registry ---
// The index of each label is its stable on-wire `labelId` byte.
// ORDER IS A WIRE FORMAT — never reorder, only append.

export const LABEL_REGISTRY = [
  LABEL_NOTE_KEY,
  LABEL_HUB_KEY_WRAP,
  LABEL_MESSAGE,
  LABEL_FILE_KEY,
  LABEL_FILE_METADATA,
  LABEL_BLAST_CONTENT,
  LABEL_CALL_META,
  LABEL_SHIFT_SCHEDULE,
  LABEL_TRANSCRIPTION,
  LABEL_HUB_EVENT,
  LABEL_DEVICE_PROVISION,
  LABEL_BACKUP,
  LABEL_PUSH_WAKE,
  LABEL_PUSH_FULL,
  LABEL_CONTACT_ID,
  LABEL_PROVIDER_CREDENTIAL_WRAP,
  LABEL_VOICEMAIL_WRAP,
  LABEL_VOICEMAIL_TRANSCRIPT,
  LABEL_CONTACT_INTAKE,
  LABEL_CONTACT_SUMMARY,
  LABEL_CONTACT_PII,
  LABEL_CONTACT_RELATIONSHIP,
  LABEL_STORAGE_CREDENTIAL_WRAP,
  LABEL_HUB_FIELD,
  // Tier 3: Per-Device Keys + PUK + Sigchain
  LABEL_PUK_SIGN,
  LABEL_PUK_DH,
  LABEL_PUK_SECRETBOX,
  LABEL_PUK_WRAP_TO_DEVICE,
  LABEL_PUK_PREVIOUS_GEN,
  LABEL_MASTER_KEY_WRAP,
  LABEL_MASTER_SELF_SIGNING,
  LABEL_MASTER_USER_SIGNING,
  LABEL_MASTER_RECOVERY_HANDOFF,
  LABEL_MASTER_RECOVERY_GROUP_WRAP,
  LABEL_PUK_RECOVERY_GROUP_WRAP,
  LABEL_DEVICE_DISPLAY,
  LABEL_DEVICE_ENROLLMENT_SAS,
  LABEL_PAPER_KEY_SIGNING,
  LABEL_PAPER_KEY_ENCRYPTION,
  LABEL_HUB_PTK_PREV_GEN,
  // Tier 5: SFrame Voice E2EE
  LABEL_SFRAME_CALL_SECRET, // 40
  LABEL_SAS_MLS, // 41
  // Indices 42-46 permanently retired — were HKDF-only labels, never used as AEAD:
  //   42: LABEL_SFRAME_RATCHET  (llamenos:sframe-ratchet:v1)
  //   43: LABEL_SAS_MLS_V3      (llamenos:sas:v3)
  //   44: LABEL_ITEMS_KEY_EXPORT (llamenos:items-key-export:v1)
  //   45: LABEL_NOTE_EPOCH_KEY   (llamenos:note-epoch-key:v1)
  //   46: LABEL_MLS_PROVISION    (llamenos:mls-provision:v1)
] as const satisfies readonly CryptoLabel[]

export function labelToId(label: CryptoLabel): number {
  const id = LABEL_REGISTRY.indexOf(label)
  if (id < 0) throw new Error(`Unregistered crypto label: ${label}`)
  return id
}

export function idToLabel(id: number): CryptoLabel {
  const label = LABEL_REGISTRY[id]
  if (!label) throw new Error(`Unknown crypto label id: ${id}`)
  return label
}
