# Data Classification Reference

**Version:** 3.0
**Date:** 2026-04-25

This document provides a complete inventory of all data stored and processed by Llamenos, with classification levels for security audits, legal review, and GDPR compliance.

## Classification Levels

| Level | Definition | Examples |
|-------|------------|----------|
| **E2EE (Tier 1)** | End-to-end envelope encrypted (legacy ECIES per-recipient — HPKE migration planned); server stores ciphertext only | Volunteer PII, contact directory PII |
| **E2EE (Tier 2)** | Hub-key encrypted (AES-256-GCM via non-extractable WebCrypto `CryptoKey`, per-record AAD via `buildAad(label, recordId, fieldName)`); hub key HPKE-distributed per device; decrypted client-side | Role names, shift names, report type names, custom field labels, team names, tag names |
| **E2EE (Tier 3 — MLS)** | MLS groupwise encryption via `@wireapp/core-crypto` WASM; each hub has a persistent MLS group; epoch advances on membership change provide forward secrecy | Call notes, transcriptions, messages |
| **IdP-Encrypted** | Encrypted server-side with `IDP_VALUE_ENCRYPTION_KEY` via HKDF + XChaCha20-Poly1305 | IdP nsec_secret values |
| **Hashed** | One-way cryptographic hash; original not recoverable without brute-force | Caller phone numbers |
| **Plaintext** | Stored unencrypted; accessible to operator and under subpoena | Timestamps, call durations |

---

## Data Inventory by Storage Location

### PostgreSQL (Server-Side)

#### `users` Table — Volunteer Records

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `pubkey` | Plaintext | Account lifetime | Nostr public key (correlatable) |
| `encryptedName` | **E2EE (Tier 1)** | Account lifetime | Legacy ECIES envelope-encrypted volunteer display name; server stores ciphertext only |
| `nameEnvelopes` | **E2EE (Tier 1)** | Account lifetime | Legacy ECIES-wrapped keys for each authorized reader (admin + self) |
| `encryptedPhone` | **E2EE (Tier 1)** | Account lifetime | Legacy ECIES envelope-encrypted phone; server stores ciphertext |
| `phoneEnvelopes` | **E2EE (Tier 1)** | Account lifetime | Legacy ECIES-wrapped keys for each authorized reader |
| `encryptedSecretKey` | **E2EE** | Account lifetime | Multi-factor encrypted nsec (PIN + IdP value + optional WebAuthn PRF) |
| `roles` | Plaintext | Account lifetime | Role ID array (e.g., `['role-volunteer']`) |
| `hubRoles` | Plaintext | Account lifetime | Per-hub role assignments |
| `active` | Plaintext | Account lifetime | Account enabled/disabled |
| `createdAt` | Plaintext | Account lifetime | Registration timestamp |

#### `jwtRevocations` Table — Revoked JWT Tokens

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `jti` | Plaintext | Until JWT expiry | JWT ID (unique per token) |
| `pubkey` | Plaintext | Until JWT expiry | Pubkey of the revoked user |
| `expiresAt` | Plaintext | Automatic cleanup | When the JWT would have expired; rows can be pruned after this |

#### `webauthnCredentials` Table — Passkey Credentials

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `id` | Plaintext | Account lifetime | Base64url credential ID |
| `pubkey` | Plaintext | Account lifetime | Owner's Nostr pubkey |
| `publicKey` | Plaintext | Account lifetime | WebAuthn credential public key |
| `encryptedLabel` | **E2EE (Tier 1)** | Account lifetime | User-assigned label for the credential |
| `counter` | Plaintext | Updated on use | Sign count for clone detection |

#### Authentik IdP — User Attributes

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `username` (pubkey) | Plaintext | Account lifetime | Nostr pubkey used as username |
| `nsec_secret` | **IdP-Encrypted** | Account lifetime | Encrypted with `IDP_VALUE_ENCRYPTION_KEY` via HKDF + XChaCha20-Poly1305; one factor of multi-factor KEK |
| `previous_nsec_secret` | **IdP-Encrypted** | During rotation only | Previous encrypted secret; cleared after rotation confirmation |
| `is_active` | Plaintext | Account lifetime | Account enabled/disabled |

#### JWT Tokens (Memory-Only)

| Data | Classification | Lifetime | Notes |
|------|---------------|----------|-------|
| Access token | Secret (memory-only) | 15 minutes | Short-lived; contains pubkey + permissions; never persisted to storage |
| Refresh token | Secret (httpOnly cookie) | Configurable | httpOnly + Secure + SameSite=Strict; revocable via `jwtRevocations` by jti |

#### Call Records and Notes (PostgreSQL)

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `callId` | Plaintext | Indefinite | Unique call identifier |
| `callSid` | Plaintext | Indefinite | Telephony provider call ID |
| `startedAt` | Plaintext | Indefinite | Call start timestamp |
| `duration` | Plaintext | Indefinite | Call duration in seconds |
| `answeredBy` | Plaintext | Indefinite | Volunteer pubkey who answered |
| `callerHash` | Hashed (HMAC-SHA256) | Indefinite | Caller phone hash (irreversible) |
| `callerLast4` | Plaintext | Indefinite | Last 4 digits of caller number |
| `hasTranscription` | Plaintext | Indefinite | Boolean flag |
| `hasVoicemail` | Plaintext | Indefinite | Boolean flag |
| `notes[].encryptedContent` | **E2EE (Tier 3 — MLS)** | Indefinite | MLS groupwise ciphertext via `@wireapp/core-crypto` |
| `notes[].mlsEpoch` | Plaintext | Indefinite | MLS epoch number (for group state tracking) |
| `notes[].authorPubkey` | Plaintext | Indefinite | Who wrote the note |
| `notes[].createdAt` | Plaintext | Indefinite | Note creation timestamp |
| `transcription.encryptedContent` | **E2EE (Tier 3 — MLS)** | Indefinite | MLS groupwise ciphertext (transcript text) |

#### Shift Schedules (PostgreSQL)

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `shiftId` | Plaintext | Indefinite | Unique shift identifier |
| `volunteerPubkeys` | Plaintext | Indefinite | Who is assigned (routing requires plaintext pubkeys) |
| `encryptedName` | **E2EE (Tier 2)** | Indefinite | Hub-key encrypted shift name |
| `startTime` | Plaintext | Indefinite | Shift start time (HH:MM) — plaintext for routing |
| `endTime` | Plaintext | Indefinite | Shift end time (HH:MM) — plaintext for routing |
| `daysOfWeek` | Plaintext | Indefinite | Recurring days — plaintext for routing |
| `ringGroupId` | Plaintext | Indefinite | Associated ring group |

#### Hub-Key Encrypted Org Metadata (PostgreSQL, Tier 2)

These fields are encrypted with the hub's shared symmetric key. All members who hold the hub key can decrypt them. The server stores ciphertext only.

| Table | Field | Classification | Notes |
|-------|-------|---------------|-------|
| `roles` | `encryptedName`, `encryptedDescription` | **E2EE (Tier 2)** | Custom role names and descriptions |
| `shifts` | `encryptedName` | **E2EE (Tier 2)** | Shift schedule names |
| `ringGroups` | `encryptedName` | **E2EE (Tier 2)** | Ring group names |
| `reportTypes` | `encryptedName`, `encryptedDescription` | **E2EE (Tier 2)** | Report type metadata |
| `customFields` | `encryptedFieldName`, `encryptedLabel`, `encryptedOptions` | **E2EE (Tier 2)** | Custom field definitions |
| `teams` | `encryptedName`, `encryptedDescription` | **E2EE (Tier 2)** | Team names and descriptions |
| `tags` | `encryptedLabel`, `encryptedCategory` | **E2EE (Tier 2)** | Tag labels and categories |
| `blastLists` | `encryptedName` | **E2EE (Tier 2)** | Blast list names |

#### Contact Directory (PostgreSQL, Tier 1 E2EE)

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `encryptedDisplayName` | **E2EE (Tier 1)** | Indefinite | Contact display name (legacy ECIES envelope — HPKE migration planned) |
| `encryptedFullName` | **E2EE (Tier 1)** | Indefinite | Contact legal name |
| `encryptedPhone` | **E2EE (Tier 1)** | Indefinite | Contact phone number |
| `encryptedNotes` | **E2EE (Tier 1)** | Indefinite | Freeform contact notes |
| `encryptedPII` | **E2EE (Tier 1)** | Indefinite | Additional PII (address, channels, etc.) |
| `riskLevel` | Plaintext | Indefinite | Risk assessment level (routing metadata) |
| `tags` | Plaintext (tag IDs) | Indefinite | Tag associations (tag names are hub-key encrypted) |

#### Active Call State (PostgreSQL, in-memory)

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `activeCallSid` | Plaintext | Call duration | Current call identifier |
| `ringingVolunteers` | Plaintext | Call duration | Who is currently ringing |
| `callState` | Plaintext | Call duration | `ringing`, `connected`, `completed` |
| `callerHash` | Hashed (HMAC-SHA256) | Call duration | For ban list checking |

#### Messaging Threads (PostgreSQL)

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `conversationId` | Plaintext | Indefinite | Unique conversation identifier |
| `channel` | Plaintext | Indefinite | `sms`, `whatsapp`, `signal` |
| `participantHash` | Hashed (HMAC-SHA256) | Indefinite | Hashed phone/identifier |
| `assignedVolunteer` | Plaintext | Indefinite | Volunteer pubkey |
| `messages[].encryptedContent` | **E2EE (Tier 3 — MLS)** | Indefinite | MLS groupwise ciphertext; server-side AES-GCM ingest at webhook, then MLS-encrypted by first client |
| `messages[].direction` | Plaintext | Indefinite | `inbound` or `outbound` |
| `messages[].timestamp` | Plaintext | Indefinite | Message timestamp |
| `messages[].status` | Plaintext | Indefinite | `sent`, `delivered`, `failed` |

**Important**: Messages are now E2EE at rest (Epic 74). The server encrypts inbound messages on webhook receipt and immediately discards the plaintext. Outbound SMS/WhatsApp messages are momentarily visible to the server during the send flow (inherent provider limitation) but are stored only in encrypted form. See [Threat Model: SMS/WhatsApp Outbound Message Limitation](THREAT_MODEL.md#smswhatsapp-outbound-message-limitation).

#### Application Configuration (PostgreSQL)

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `telephonyProviders` | **E2EE (Tier 1)** | Indefinite | Provider API credentials (encrypted credentials column) |
| `messagingProviders` | **E2EE (Tier 1)** | Indefinite | Provider API credentials |
| `customFieldDefinitions` | **E2EE (Tier 2)** | Indefinite | Field names, labels, options — all hub-key encrypted |
| `banList` | Hashed (HMAC-SHA256) | Indefinite | Banned phone hashes |
| `spamMitigation` | Plaintext | Indefinite | CAPTCHA settings, rate limits |

#### Audit Logs (PostgreSQL)

Audit logs use a hash-chained integrity mechanism to detect tampering.

| Field | Classification | Retention | Notes |
|-------|---------------|-----------|-------|
| `timestamp` | Plaintext | Configurable | Event timestamp |
| `action` | Plaintext | Configurable | What happened |
| `actorPubkey` | Plaintext | Configurable | Who did it |
| `ipHash` | Hashed (truncated) | Configurable | 96-bit truncated IP hash |
| `details` | Plaintext | Configurable | Action-specific metadata |
| `entryHash` | Plaintext | Configurable | SHA-256 of (action + actorPubkey + timestamp + details + previousEntryHash) |
| `previousEntryHash` | Plaintext | Configurable | Hash chain link to previous entry |

---

### Client-Side Storage (localStorage)

| Key | Classification | Retention | Notes |
|-----|---------------|-----------|-------|
| `llamenos-encrypted-key` | **E2EE** (multi-factor encrypted) | Until logout | Contains encrypted nsec; requires PIN + IdP value + optional WebAuthn PRF to decrypt |
| `llamenos-draft:{callId}` | **E2EE** | Until submitted | Encrypted draft note |
| `llamenos-settings` | Plaintext | Indefinite | UI preferences |

**Important**: The volunteer's secret key (nsec) is NEVER stored in plaintext. It exists only:
1. Multi-factor encrypted in localStorage (PIN + IdP value + optional WebAuthn PRF)
2. In a JavaScript closure variable during an unlocked session
3. Zeroed from memory on lock/logout

The IdP value (one encryption factor) is fetched from Authentik on unlock and held in memory only — it is never persisted client-side.

---

### Memory-Only (Never Persisted)

| Data | Lifetime | Notes |
|------|----------|-------|
| Decrypted nsec | Unlocked session | Zeroed on lock |
| Decrypted note content | Page lifetime | React component state |
| Per-note encryption keys | Encryption operation | Generated fresh, never stored |
| ECDH ephemeral keys | Encryption operation | Used once, discarded |
| Hub key | Unlocked session | Stored in hub-key-manager closure; zeroed on lock |
| Transcription audio (microphone) | Recording duration | Captured via AudioWorklet, processed in Web Worker, never persisted |
| Transcription text (pre-encryption) | Seconds | Encrypted immediately after WASM Whisper processing |

---

### Third-Party Systems

#### Telephony Providers (Twilio, SignalWire, Vonage, Plivo)

| Data | Classification | Retention | Notes |
|------|---------------|-----------|-------|
| Call audio | Transient | Provider-controlled | Not recorded by default |
| Call detail records | Plaintext | Provider-controlled | Timestamps, numbers, durations |
| Webhook payloads | Transient | Request duration | Validated via HMAC signature |

#### RustFS (Self-Hosted S3-Compatible Storage)

| Data | Classification | Notes |
|------|---------------|-------|
| Voicemail recordings | Ciphertext | Encrypted client-side before upload |
| File attachments | Ciphertext | Encrypted client-side before upload |
| Encrypted exports | Ciphertext | E2EE export bundles |

#### Transcription (Client-Side WASM Whisper)

| Data | Classification | Retention |
|------|---------------|-----------|
| Audio input | Memory-only | Duration of transcription processing (in-browser) |
| Transcript output | Encrypted immediately | Stored as E2EE |

**Note**: As of Epic 78, transcription is performed entirely in the browser using WASM Whisper (`@huggingface/transformers`). Audio never leaves the device — no data is sent to any external transcription service.

---

## Data Flow Diagrams

### Note Encryption Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ VOLUNTEER'S BROWSER                                             │
│ ┌─────────────┐    ┌──────────────┐    ┌──────────────────────┐ │
│ │ Note Text   │───▶│ Generate     │───▶│ XChaCha20-Poly1305   │ │
│ │ + Fields    │    │ noteKey (32B)│    │ encrypt(noteKey,     │ │
│ └─────────────┘    └──────────────┘    │ nonce, plaintext)    │ │
│                           │            └──────────┬───────────┘ │
│                           │                       │             │
│                           ▼                       ▼             │
│              ┌────────────────────┐    ┌──────────────────────┐ │
│              │ ECIES wrap for     │    │ encryptedContent     │ │
│              │ volunteer pubkey   │    │ (ciphertext)         │ │
│              └────────┬───────────┘    └──────────────────────┘ │
│                       │                           │             │
│              ┌────────┴───────────┐               │             │
│              │ ECIES wrap for     │               │             │
│              │ admin pubkey       │               │             │
│              └────────┬───────────┘               │             │
│                       │                           │             │
│                       ▼                           ▼             │
│              ┌────────────────────────────────────────────────┐ │
│              │ { encryptedContent, authorEnvelope,           │ │
│              │   adminEnvelope, authorPubkey, createdAt }    │ │
│              └──────────────────────┬─────────────────────────┘ │
└─────────────────────────────────────┼───────────────────────────┘
                                      │ HTTPS
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ SERVER (no access to plaintext)                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ PostgreSQL stores encrypted note as-is                      │ │
│ │ Server can see: authorPubkey, createdAt, callId            │ │
│ │ Server cannot see: note text, custom field values          │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Caller Phone Number Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐
│ PSTN Call   │────▶│ Telephony   │────▶│ SERVER                  │
│ from Caller │     │ Provider    │     │                         │
└─────────────┘     └─────────────┘     │ 1. Webhook received     │
                                        │    (full phone in body) │
                                        │                         │
                                        │ 2. Extract last 4 digits│
                                        │    callerLast4 = "1234" │
                                        │                         │
                                        │ 3. Hash full number     │
                                        │    HMAC-SHA256(secret,  │
                                        │    "llamenos:phone:" +  │
                                        │    fullPhone)           │
                                        │                         │
                                        │ 4. Check ban list       │
                                        │    (hash comparison)    │
                                        │                         │
                                        │ 5. Store: hash + last4  │
                                        │    Discard: full number │
                                        │                         │
                                        │ 6. Nostr relay event:   │
                                        │    callerLast4 only     │
                                        │    (hub-key encrypted)  │
                                        └─────────────────────────┘
```

---

## GDPR Data Subject Rights

| Right | Implementation |
|-------|----------------|
| **Access** | Volunteers can export their notes (decrypted client-side). Admins can export all metadata. |
| **Rectification** | Volunteers can edit their notes. Admins can update volunteer profiles. |
| **Erasure** | Admin can delete volunteer accounts and notes. E2EE content is cryptographically inaccessible if keys are deleted. |
| **Portability** | Backup export includes encrypted nsec and can be restored on any instance. |
| **Restriction** | Admin can deactivate accounts (revokes sessions, prevents login). |

---

## Retention Recommendations

| Data Type | Recommended Retention | Rationale |
|-----------|----------------------|-----------|
| Call notes | 7 years or legal requirement | Crisis documentation |
| Call metadata | 2 years | Operational analysis |
| Audit logs | 1 year | Security review |
| JWT access tokens | 15 minutes (automatic) | Short-lived, non-revocable |
| JWT refresh tokens | Configurable (revocable) | Revoked via `jwtRevocations` table |
| Messaging content | 1 year | Follow-up reference |
| Volunteer records | Account lifetime + 90 days | Post-departure access |

Note: Llamenos does not currently enforce automated retention policies. Operators should implement retention schedules appropriate to their jurisdiction.

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-04-01 | 2.0 | IdP + JWT Auth Overhaul: Replaced IdentityDO with PostgreSQL `users` table; updated volunteer name/phone from Encrypted-at-Rest to E2EE Tier 1 envelope encryption; added `jwtRevocations`, `webauthnCredentials` tables, Authentik IdP data store, JWT tokens (memory-only), hub-key encrypted org metadata (Tier 2), contact directory (Tier 1 E2EE); replaced Cloudflare/R2 with RustFS; updated client-side key storage to multi-factor; updated session retention for JWT tokens |
| 2026-02-25 | 1.1 | ZK Architecture Overhaul: Updated ConversationDO to E2EE envelope encryption, ShiftManagerDO encrypted details, AuditDO hash chain fields, RecordsDO callrecord: prefix, client-side transcription, hub key in memory-only section, replaced WebSocket broadcast with Nostr relay event |
| 2026-02-25 | 1.0 | Initial data classification document |
