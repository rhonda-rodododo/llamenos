# Llámenos Cryptographic Protocol Specification

**Version:** 3.0
**Date:** 2026-04-01
**Status:** Normative

**Related Documents**:

- [Security Overview](../security/README.md) — Entry point for security auditors
- [Data Classification](../security/DATA_CLASSIFICATION.md) — Complete data inventory
- [Threat Model](../security/THREAT_MODEL.md) — Adversaries and trust boundaries
- [Security Audit R6](../security/SECURITY_AUDIT_2026-02-R6.md) — Latest audit findings

## 1. Overview

Llámenos uses a layered cryptographic architecture designed to protect volunteer and caller identity against well-funded adversaries. The system is built on three principles:

1. **Key material never persists in plaintext** — the identity key (nsec) is always encrypted at rest under a multi-factor KEK (PIN + IdP-bound value + optional WebAuthn PRF output) and held in a Web Worker during use, never in sessionStorage or global scope.
2. **Per-artifact encryption** — each note, message, and file uses a fresh random key, wrapped per-recipient via ECIES, providing forward secrecy at the data layer.
3. **Device-centric auth** — the nsec is a recovery-only secret. Day-to-day authentication uses WebAuthn passkeys with JWT session tokens.

## 2. Key Hierarchy

```
Identity Key (nsec / secretKey)
  32-byte secp256k1 scalar
  Generated once during onboarding
  BIP-340 x-only public key (npub)
  └── Multi-Factor Encrypted Local Store (Section 3)
  └── Recovery Key Encryption (Section 9)
  └── ECIES Key Agreement (Sections 5-7)
  └── NIP-42 Relay Authentication (Section 4.3)

Admin Decryption Key
  Separate secp256k1 keypair from identity key
  └── Note admin envelope unwrapping (Section 5)
  └── Message admin envelope unwrapping (Section 6)
  └── Metadata decryption (Section 14)

Hub Key
  32-byte random: crypto.getRandomValues(new Uint8Array(32))
  NOT derived from any identity key
  └── Nostr event content encryption (XChaCha20-Poly1305 + HKDF per-event)
  └── Presence encryption (volunteer-tier: boolean only)
  └── Hub-key encrypted org metadata (role names, shift names, etc.)
  └── Distribution: ECIES-wrapped individually per member ("llamenos:hub-key-wrap")

Server Nostr Key
  Derived: HKDF-SHA256(SERVER_NOSTR_SECRET, "llamenos:server-nostr-key", "llamenos:server-nostr-key:v1")
  └── Signs server-authoritative Nostr events (call:ring, call:answered)
  └── Clients verify server pubkey for authoritative events
  └── CANNOT decrypt any user content

Per-Note Key
  32-byte random
  Generated per note creation/edit
  └── ECIES-wrapped for author (Section 5)
  └── ECIES-wrapped for each admin (Section 5)

Per-Message Key
  32-byte random
  Generated per message
  └── ECIES-wrapped for assigned volunteer ("llamenos:message")
  └── ECIES-wrapped for each admin ("llamenos:message")

Per-File Key
  32-byte random (XChaCha20-Poly1305)
  └── ECIES-wrapped per recipient (Section 7)

Draft Encryption Key
  Derived: HKDF-SHA256(secretKey, "llamenos:hkdf-salt:v1", "llamenos:drafts")
  └── Deterministic — acceptable since drafts are local-only
```

### 2.1 Domain Separation Labels

Every cryptographic operation uses a unique domain separation string to prevent cross-context key reuse attacks. The authoritative source is `src/shared/crypto-labels.ts`; this table must match that file exactly (48 constants).

#### ECIES Key Wrapping

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_NOTE_KEY` | `"llamenos:note-key"` | Per-note symmetric key ECIES wrapping | 5.2 |
| `LABEL_FILE_KEY` | `"llamenos:file-key"` | Per-file symmetric key ECIES wrapping | 7 |
| `LABEL_FILE_METADATA` | `"llamenos:file-metadata"` | File metadata ECIES encryption | 7 |
| `LABEL_HUB_KEY_WRAP` | `"llamenos:hub-key-wrap"` | Hub key ECIES distribution to members | 14 |

#### ECIES Content Encryption

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_TRANSCRIPTION` | `"llamenos:transcription"` | Transcription ECIES encryption | 6 |
| `LABEL_MESSAGE` | `"llamenos:message"` | E2EE message envelope encryption | 6 |
| `LABEL_BLAST_CONTENT` | `"llamenos:blast-content"` | Blast content ECIES envelope encryption | — |
| `LABEL_CALL_META` | `"llamenos:call-meta"` | Encrypted call record metadata (assignments) | 14 |
| `LABEL_SHIFT_SCHEDULE` | `"llamenos:shift-schedule"` | Encrypted shift schedule details | 14 |

#### HKDF Derivation

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `HKDF_SALT` | `"llamenos:hkdf-salt:v1"` | HKDF salt for legacy symmetric key derivation | 5.4 |
| `HKDF_CONTEXT_DRAFTS` | `"llamenos:drafts"` | HKDF context for draft encryption | 8 |
| `HKDF_CONTEXT_EXPORT` | `"llamenos:export"` | HKDF context for export encryption | — |
| `LABEL_HUB_EVENT` | `"llamenos:hub-event"` | Hub event HKDF derivation from hub key | 14 |

#### ECDH Key Agreement

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_DEVICE_PROVISION` | `"llamenos:device-provision"` | Device provisioning ECDH shared key derivation | 10 |

#### SAS Verification

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `SAS_SALT` | `"llamenos:sas"` | SAS HKDF salt for provisioning verification | 10 |
| `SAS_INFO` | `"llamenos:provisioning-sas"` | SAS HKDF info parameter | 10 |

#### Authentication (Deprecated)

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `AUTH_PREFIX` | `"llamenos:auth:"` | Schnorr auth token message prefix (deprecated; retained for backward compatibility during transition) | — |

#### HMAC Domain Separation

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `HMAC_PHONE_PREFIX` | `"llamenos:phone:"` | Phone number hashing prefix | — |
| `HMAC_IP_PREFIX` | `"llamenos:ip:"` | IP address hashing prefix | — |
| `HMAC_KEYID_PREFIX` | `"llamenos:keyid:"` | Key identification hash prefix | 3.1 |
| `HMAC_SUBSCRIBER` | `"llamenos:subscriber"` | Subscriber identifier HMAC key | — |
| `HMAC_PREFERENCE_TOKEN` | `"llamenos:preference-token"` | Preference token HMAC key | — |

#### Recovery / Backup

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `RECOVERY_SALT` | `"llamenos:recovery"` | Recovery key PBKDF2 fallback salt (legacy) | 9 |
| `LABEL_BACKUP` | `"llamenos:backup"` | Generic backup encryption | 9 |

#### Server Nostr Identity

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_SERVER_NOSTR_KEY` | `"llamenos:server-nostr-key"` | HKDF derivation for server Nostr keypair from `SERVER_NOSTR_SECRET` | 14 |
| `LABEL_SERVER_NOSTR_KEY_INFO` | `"llamenos:server-nostr-key:v1"` | HKDF info parameter for server Nostr key (versioned for rotation) | 14 |

#### Push Notification Encryption

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_PUSH_WAKE` | `"llamenos:push-wake"` | Wake-tier ECIES push payload — decryptable without PIN (minimal metadata only) | — |
| `LABEL_PUSH_FULL` | `"llamenos:push-full"` | Full-tier ECIES push payload — decryptable only with user's nsec | — |

#### Contact Identifier Encryption

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_CONTACT_ID` | `"llamenos:contact-identifier"` | HKDF context for contact identifier encryption at rest | — |

#### Provider Credential Encryption

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_PROVIDER_CREDENTIAL_WRAP` | `"llamenos:provider-credential-wrap:v1"` | ECIES wrapping of provider OAuth/API credentials | — |

#### Voicemail Encryption

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_VOICEMAIL_WRAP` | `"llamenos:voicemail-audio"` | Voicemail audio symmetric key wrapping (ECIES) | — |
| `LABEL_VOICEMAIL_TRANSCRIPT` | `"llamenos:voicemail-transcript"` | Voicemail transcript encryption (domain-separated from generic `LABEL_MESSAGE`) | — |

#### Contact Intake Encryption

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_CONTACT_INTAKE` | `"llamenos:contact-intake:v1"` | Contact intake payload — E2EE, enveloped for submitter + triage users | — |

#### Contact Directory Encryption

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_CONTACT_SUMMARY` | `"llamenos:contact-summary"` | Contact summary (Tier 1) — display name, notes, languages | — |
| `LABEL_CONTACT_PII` | `"llamenos:contact-pii"` | Contact PII (Tier 2) — full name, phone, email, address, DOB | — |
| `LABEL_CONTACT_RELATIONSHIP` | `"llamenos:contact-relationship"` | Contact relationship payload — fully E2EE | — |

#### Storage Credential Encryption

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_STORAGE_CREDENTIAL_WRAP` | `"llamenos:storage-credential"` | Hub storage credential (IAM secret key) wrapping with hub key | — |

#### IdP Auth Hardening (KEK Multi-Factor)

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_KEK_PRF` | `"llamenos:kek-prf"` | WebAuthn PRF evaluation salt for KEK derivation | 3.1 |
| `LABEL_NSEC_KEK_3F` | `"llamenos:nsec-kek:3f"` | HKDF info for 3-factor (PIN + PRF + IdP) KEK derivation | 3.1 |
| `LABEL_NSEC_KEK_2F` | `"llamenos:nsec-kek:2f"` | HKDF info for 2-factor (PIN + IdP) KEK derivation | 3.1 |
| `LABEL_IDP_VALUE_WRAP` | `"llamenos:idp-value-wrap"` | Envelope encryption of IdP-bound value at rest in the IdP | 3.2 |

#### Field-Level Encryption (Phase 2A — Server-Key)

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_AUDIT_EVENT` | `"llamenos:audit-event:v1"` | Server-key encryption of audit log events and details | 15 |
| `LABEL_IVR_AUDIO` | `"llamenos:ivr-audio:v1"` | Server-key encryption of IVR audio prompt data | — |
| `LABEL_BLAST_SETTINGS` | `"llamenos:blast-settings:v1"` | Server-key encryption of blast settings messages | — |

#### Field-Level Encryption (Phase 1 — Server-Key)

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_USER_PII` | `"llamenos:volunteer-pii:v1"` | Server-key encryption of user/invite PII (phone numbers) | — |
| `LABEL_EPHEMERAL_CALL` | `"llamenos:ephemeral-call:v1"` | Server-key encryption of ephemeral call data (caller numbers) | — |
| `LABEL_PUSH_CREDENTIAL` | `"llamenos:push-credential:v1"` | Server-key encryption of push notification credentials | — |

## 3. Local Key Protection

### 3.1 Multi-Factor Encrypted Key Store

The identity key is stored in `localStorage` encrypted under a multi-factor Key Encryption Key (KEK).

**Key Derivation (Multi-Factor KEK):**

```
Factors:
  PIN (6-8 digits, UTF-8 encoded)
  idpValue (32 bytes — per-user secret stored in IdP, retrieved via /api/auth/userinfo)
  prfOutput (32 bytes — optional WebAuthn PRF evaluation output)

Step 1: PIN → PBKDF2-SHA256(PIN, salt, 600,000 iterations) → 32-byte pinDerived

Step 2: Concatenate available factors:
  2-factor: ikm = pinDerived ‖ idpValue        (64 bytes)
  3-factor: ikm = pinDerived ‖ prfOutput ‖ idpValue  (96 bytes)

Step 3: KEK = HKDF-SHA256(ikm, salt, info, 32)
  where info = "llamenos:nsec-kek:2f" (2-factor) or "llamenos:nsec-kek:3f" (3-factor)
```

The domain separation between 2-factor and 3-factor modes via distinct HKDF info labels ensures that a 2-factor KEK cannot accidentally decrypt a 3-factor blob or vice versa.

**Encryption:**
```
nsec hex string (UTF-8 encoded)
  → XChaCha20-Poly1305(KEK, random_nonce_24)
  → ciphertext
```

**Storage format (localStorage `llamenos-encrypted-key`):**
```json
{
  "version": 2,
  "kdf": "pbkdf2-sha256",
  "cipher": "xchacha20-poly1305",
  "salt": "<hex, 32 bytes>",
  "nonce": "<hex, 24 bytes>",
  "ciphertext": "<hex>",
  "pubkeyHash": "<truncated SHA-256 of HMAC_KEYID_PREFIX + pubkey, 8 bytes hex>",
  "prfUsed": false,
  "idpIssuer": "https://auth.example.com"
}
```

The `pubkeyHash` field is a truncated hash (not the plaintext pubkey) to allow identification of which key is stored without leaking identity. The `prfUsed` flag indicates whether 3-factor mode was used. The `idpIssuer` identifies which IdP session context produced the `idpValue` factor.

**IdP-bound value (`idpValue`):**

Each user has a per-user random 32-byte secret (`nsec_secret`) stored in the IdP (Authentik) as an encrypted user attribute. This value is:

1. Generated on user creation by the IdP adapter (32 random bytes)
2. Encrypted at rest in the IdP using `LABEL_IDP_VALUE_WRAP` domain-separated HKDF + XChaCha20-Poly1305 with the server's `IDP_VALUE_ENCRYPTION_KEY`
3. Retrieved by the client via `GET /api/auth/userinfo` (requires valid JWT)
4. Used as one factor in KEK derivation — if the IdP is offline or the user is deactivated, the key store cannot be unlocked

This binds key store access to an active IdP session: even with the correct PIN, the nsec cannot be decrypted without the IdP-provided value.

**Synthetic IdP values (transitional):**

During device linking and certain fallback flows where no real IdP session exists yet, a deterministic synthetic value is derived: `SHA-256("llamenos:synthetic:{issuer}")`. The key store records the synthetic issuer. On first unlock with a real IdP session available, the key store is automatically re-encrypted with the real IdP value (auto-rotation).

**WebAuthn PRF (optional 3rd factor):**

When the user's WebAuthn credential supports the PRF extension, the browser evaluates `LABEL_KEK_PRF` as the salt during authentication, producing a 32-byte PRF output that serves as an additional KEK factor. This provides hardware-bound key protection even if the PIN and IdP value are compromised.

### 3.2 Key Manager (Runtime)

The Key Manager (`key-manager.ts`) delegates all secret key operations to a dedicated Web Worker (`crypto-worker`). The secret key is held inside the worker's scope — never on the main thread, `window`, `sessionStorage`, or any globally accessible object.

**States:**
- **Locked**: Worker holds no key material. Only JWT-authenticated API calls are available. Crypto operations that require the secret key are unavailable.
- **Unlocked**: Worker holds the `secretKey` as a `Uint8Array`. Full crypto operations available.

**Operations:**
- `unlock(pin)` — Derives multi-factor KEK (PIN + IdP value + optional PRF), decrypts nsec from localStorage, sends to worker for validation.
- `lock()` — Instructs the worker to zero and discard the secret key bytes.
- `importKey(nsecHex, pin, pubkey, idpValue, prfOutput?, idpIssuer)` — For onboarding/recovery: encrypts nsec to localStorage, loads into worker.
- `getPublicKeyHex()` — Returns hex pubkey from the worker (available only when unlocked).
- `wipeKey()` — Locks the key manager and removes the encrypted key from localStorage entirely.

**Auto-lock triggers:**
- Configurable idle timeout (default: 5 minutes of no API activity)
- `document.visibilitychange` when `document.hidden === true` (tab backgrounded), with configurable delay
- Explicit `lock()` call

## 4. Authentication and Session Model

### 4.1 JWT Access Tokens

All authenticated API requests use short-lived JWT access tokens.

**Token structure (HS256):**
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
{
  "sub": "<pubkey_hex>",
  "permissions": ["calls:read", "notes:create", ...],
  "jti": "<uuid>",
  "iat": 1711929600,
  "exp": 1711930500,
  "iss": "llamenos"
}
```

**Properties:**
- Algorithm: HS256 (HMAC-SHA256) with `JWT_SECRET` environment variable
- Default expiry: 15 minutes from issuance
- Issuer: `"llamenos"`
- Subject (`sub`): user's Nostr public key (hex)
- Unique ID (`jti`): UUID v4, used for jti-based revocation
- Permissions: resolved from the user's assigned roles at token issuance time

**Wire format:** `Authorization: Bearer <jwt>`

**Server validation:**
1. Verify HS256 signature against `JWT_SECRET`
2. Check `iss === "llamenos"` and `exp > now`
3. Extract `sub` as the authenticated pubkey
4. Extract `permissions` for authorization checks
5. (Optional) Check `jti` against `jwt_revocations` table for revoked tokens

### 4.2 Refresh Tokens

Refresh tokens are long-lived JWTs stored as httpOnly cookies, used to obtain new access tokens without re-authentication.

**Token structure:**
```json
{
  "type": "refresh",
  "sub": "<pubkey_hex>",
  "jti": "<uuid>",
  "iat": 1711929600,
  "exp": 1714521600,
  "iss": "llamenos"
}
```

**Properties:**
- Algorithm: HS256 with `JWT_SECRET`
- Expiry: 30 days
- Cookie name: `llamenos-refresh`
- Cookie attributes: `httpOnly`, `secure`, `sameSite=Strict`, `path=/api/auth/token`
- Contains `type: "refresh"` claim to distinguish from access tokens

**Refresh flow (`POST /api/auth/token/refresh`):**
1. Server reads the `llamenos-refresh` cookie
2. Verifies the refresh JWT (signature, expiry, `type === "refresh"`)
3. Validates the user is still active in the IdP via `idpAdapter.refreshSession(pubkey)`
4. If valid, issues a new access token with current permissions
5. If the IdP session is invalid, returns 401 — the user must re-authenticate

**CSRF protection:** The refresh endpoint requires `Content-Type: application/json`, preventing simple cross-origin form submissions.

### 4.3 WebAuthn Authentication Flow

WebAuthn passkeys are the primary authentication mechanism. The flow issues JWT tokens on successful assertion.

```
Client                                    Server
  |                                          |
  |-- 1. POST /api/auth/webauthn/login-options -->|
  |                                          |-- 2. Generate challenge, store with UUID
  |<-- 3. { options, challengeId } ----------|
  |                                          |
  |-- 4. navigator.credentials.get(options)  |
  |      (user taps authenticator)           |
  |                                          |
  |-- 5. POST /api/auth/webauthn/login-verify -->|
  |      { assertion, challengeId }          |
  |                                          |-- 6. Retrieve stored challenge
  |                                          |-- 7. Verify assertion signature
  |                                          |-- 8. Update credential counter
  |                                          |-- 9. Resolve user permissions
  |                                          |-- 10. Sign access token (15min)
  |                                          |-- 11. Sign refresh token (30d)
  |                                          |-- 12. Set refresh cookie (httpOnly)
  |<-- 13. { accessToken, pubkey } ----------|
```

**Rate limiting:** Login endpoints are rate-limited per IP hash (10 requests per 5-minute window).

### 4.4 Token Revocation

Tokens can be revoked by inserting their `jti` into the `jwt_revocations` PostgreSQL table:

```sql
CREATE TABLE jwt_revocations (
  jti TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

The `expires_at` column matches the token's `exp` claim, allowing periodic cleanup of expired revocation rows. Revocations are used for:
- Explicit session revocation (`POST /api/auth/session/revoke`)
- Admin-initiated re-enrollment (`POST /api/auth/admin/re-enroll/:pubkey`)
- GDPR erasure (all user tokens revoked)

### 4.5 Session Revocation

`POST /api/auth/session/revoke` performs a full session teardown:
1. Revokes the user's session in the IdP via `idpAdapter.revokeSession(pubkey)`
2. Clears the `llamenos-refresh` cookie (sets `maxAge=0`)
3. The access token naturally expires within 15 minutes (or can be jti-revoked for immediate invalidation)

### 4.6 Nostr Relay Authentication (NIP-42)

Clients authenticate to the Nostr relay using the NIP-42 protocol:

1. Client connects to the relay via WebSocket (`wss://domain/nostr`)
2. Relay sends `["AUTH", <challenge_string>]`
3. Client signs the challenge using its Nostr identity key (BIP-340 Schnorr)
4. Client sends the signed NIP-42 auth event back to the relay
5. Relay verifies the signature and grants access to publish/subscribe

Only authenticated clients can publish events or subscribe to hub-scoped events. The relay enforces a write policy that restricts publishing to known server and member pubkeys.

### 4.7 Relationship Between Auth and Key Manager

JWT authentication and key manager unlock are independent tiers:

- **Authenticated but locked**: User has a valid JWT (via WebAuthn login). Can see call events, shift status, presence. Cannot read encrypted content. The client can call `GET /api/auth/userinfo` to retrieve the `nsecSecret` for KEK derivation, but the key store remains locked until the user enters their PIN.
- **Authenticated and unlocked**: User has a valid JWT AND has entered their PIN to unlock the key manager. Full access to all encrypted content.

This separation ensures that a compromised JWT cannot access encrypted data without also knowing the PIN (and having the IdP-bound value).

## 5. Note Encryption (Per-Note Forward Secrecy)

### 5.1 Encryption

Each note uses a fresh random key, ECIES-wrapped for each authorized reader:

```
noteKey = random(32 bytes)
nonce = random(24 bytes)
payload = JSON.stringify({ text, fields })
encryptedContent = nonce || XChaCha20-Poly1305(noteKey, nonce, payload)

authorEnvelope = wrapKeyForPubkey(noteKey, authorPubkey)
adminEnvelope = wrapKeyForPubkey(noteKey, adminPubkey)
```

### 5.2 Key Wrapping (ECIES)

```
wrapKeyForPubkey(plainKey, recipientPubkeyHex):
  ephemeralSecret = random(32 bytes)
  ephemeralPub = secp256k1.getPublicKey(ephemeralSecret, compressed=true)
  recipientCompressed = "02" || recipientPubkeyHex  // x-only → compressed
  shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  sharedX = shared[1..33]  // strip prefix byte
  symmetricKey = SHA-256("llamenos:note-key" || sharedX)
  nonce = random(24 bytes)
  wrappedKey = nonce || XChaCha20-Poly1305(symmetricKey, nonce, plainKey)
  return { encryptedFileKey: hex(wrappedKey), ephemeralPubkey: hex(ephemeralPub) }
```

### 5.3 Decryption

```
decryptNote(encryptedContent, envelope, secretKey):
  noteKey = unwrapKey(envelope, secretKey)
  nonce = encryptedContent[0..24]
  ciphertext = encryptedContent[24..]
  payload = XChaCha20-Poly1305.decrypt(noteKey, nonce, ciphertext)
  return JSON.parse(payload)
```

### 5.4 Legacy Note Decryption

Notes created before per-note keys use a deterministic key:
```
legacyKey = HKDF-SHA256(secretKey, "llamenos:hkdf-salt:v1", "llamenos:notes", 32)
```

Legacy notes are identified by the absence of `authorEnvelope`/`adminEnvelope` fields.

## 6. Message Encryption (Envelope Pattern)

Messages (SMS, WhatsApp, Signal conversations) use per-message envelope encryption, matching the note encryption pattern from Section 5.

### 6.1 Encryption

Each message uses a fresh random key, ECIES-wrapped for each authorized reader:

```
messageKey = random(32 bytes)
nonce = random(24 bytes)
encryptedContent = nonce || XChaCha20-Poly1305(messageKey, nonce, messageText)

// Wrap the message key for each reader
authorEnvelope = wrapKeyForPubkey(messageKey, volunteerPubkey, "llamenos:message")
adminEnvelopes = [
  wrapKeyForPubkey(messageKey, admin1Pubkey, "llamenos:message"),
  wrapKeyForPubkey(messageKey, admin2Pubkey, "llamenos:message"),
  ...  // one envelope per admin
]
```

### 6.2 Key Wrapping (ECIES)

```
wrapKeyForPubkey(plainKey, recipientPubkeyHex, label):
  ephemeralSecret = random(32 bytes)
  ephemeralPub = secp256k1.getPublicKey(ephemeralSecret, compressed=true)
  recipientCompressed = "02" || recipientPubkeyHex  // x-only → compressed
  shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  sharedX = shared[1..33]  // strip prefix byte
  symmetricKey = SHA-256(label || sharedX)
  nonce = random(24 bytes)
  wrappedKey = nonce || XChaCha20-Poly1305(symmetricKey, nonce, plainKey)
  return { encryptedFileKey: hex(wrappedKey), ephemeralPubkey: hex(ephemeralPub) }
```

### 6.3 Inbound Message Flow

For inbound messages (SMS/WhatsApp webhook -> server):

1. Server receives plaintext from telephony provider (inherent limitation)
2. Server encrypts immediately using the assigned volunteer's pubkey and all admin pubkeys
3. Server stores ONLY the encrypted fields (`encryptedContent`, `authorEnvelope`, `adminEnvelopes[]`, `nonce`)
4. Server discards the plaintext from memory

### 6.4 Outbound Message Flow

For outbound messages (volunteer -> SMS/WhatsApp):

1. Client encrypts the message and creates all envelopes
2. Client sends both `plaintextForSending` (for the provider) and encrypted fields to the server
3. Server forwards the plaintext to the telephony provider (inherent limitation)
4. Server stores ONLY the encrypted fields; discards `plaintextForSending` immediately

**Important**: The server momentarily sees outbound message plaintext — this is an inherent limitation of SMS/WhatsApp channels, not a bug. See [Threat Model: SMS/WhatsApp Outbound Message Limitation](../security/THREAT_MODEL.md#smswhatsapp-outbound-message-limitation).

## 7. File Encryption

Files use a two-layer scheme:

1. **File Key**: Random 32-byte key encrypts the file content
2. **Envelopes**: File key is ECIES-wrapped per recipient (same as Section 5.2)
3. **Metadata**: File metadata (name, type, size, checksum) encrypted separately per recipient

Chunked upload: file is encrypted client-side, split into chunks, uploaded, and reassembled server-side. The server never sees plaintext.

## 8. Draft Encryption

Local drafts use deterministic key derivation (acceptable since drafts are device-local):

```
draftKey = HKDF-SHA256(secretKey, "llamenos:hkdf-salt:v1", "llamenos:drafts", 32)
nonce = random(24 bytes)
encrypted = nonce || XChaCha20-Poly1305(draftKey, nonce, draft_json)
```

Stored in `localStorage` with prefix `llamenos-draft:{callId}`. Cleared on logout.

## 9. Recovery & Backup

### 9.1 Recovery Key

128-bit random value, Base32-encoded, formatted as `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.

The recovery key encrypts the nsec in the backup file:
```
recoveryKEK = PBKDF2-SHA256(Base32(recoveryKey), random_salt_16, 100,000 iterations)
encrypted_nsec = XChaCha20-Poly1305(recoveryKEK, random_nonce_24, nsec_bytes)
```

100,000 iterations (vs 600,000 for PIN) because the recovery key has 128 bits of entropy.

### 9.2 Backup File Format

```json
{
  "version": 1,
  "format": "llamenos-key-backup",
  "pubkey": "<hex pubkey>",
  "createdAt": "<ISO 8601>",
  "encrypted": {
    "salt": "<hex, 16 bytes>",
    "iterations": 600000,
    "nonce": "<hex, 24 bytes>",
    "ciphertext": "<hex>"
  },
  "recoveryKey": {
    "salt": "<hex, 16 bytes>",
    "iterations": 100000,
    "nonce": "<hex, 24 bytes>",
    "ciphertext": "<hex>"
  }
}
```

The `encrypted` section is decryptable with the user's PIN. The `recoveryKey` section is decryptable with the recovery key. Both contain the same nsec.

## 10. Device Linking Protocol

New devices receive the nsec from an already-provisioned device via an ephemeral encrypted channel.

### 10.1 Protocol Flow

```
New Device (N)                         Primary Device (P)
  |                                      |
  |-- 1. Generate ephemeral keypair:     |
  |      eSK, ePK = secp256k1.gen()     |
  |                                      |
  |-- 2. POST /provisioning/room ------->|
  |      Response: { roomId }            |
  |                                      |
  |-- 3. Display QR / alphanumeric:      |
  |      { roomId, ePK_hex }            |
  |                                      |
  |-- 4. Connect WS: /provisioning/ws    |
  |      ?room={roomId}&role=new         |
  |                                      |
  |                                      |-- 5. Scan QR or enter code
  |                                      |
  |                                      |-- 6. Connect WS:
  |                                      |      /provisioning/ws?room={roomId}&role=primary
  |                                      |
  |                                      |-- 7. ECDH(primarySK, ePK) → shared
  |                                      |-- 8. WS send: {
  |                                      |        type: "provision",
  |                                      |        encrypted: XChaCha20(shared, nonce, nsec),
  |                                      |        nonce: hex,
  |                                      |        primaryPK: hex  // for verification
  |                                      |      }
  |                                      |
  |<- 9. Receive provision message -------|
  |                                      |
  |-- 10. ECDH(eSK, primaryPK) → shared  |
  |-- 11. Decrypt nsec                   |
  |-- 12. Verify: getPublicKey(nsec)     |
  |        matches primaryPK             |
  |                                      |
  |-- 13. Prompt for PIN                 |
  |-- 14. importKey(nsec, pin,           |
  |        syntheticIdpValue)            |
  |        (synthetic issuer             |
  |         "device-link")               |
  |                                      |
  |-- 15. WS send: { type: "ack" }      |
  |                                      |
  |                                      |<- 16. Receive ack, show success
```

The new device stores the nsec using a synthetic IdP value (see Section 3.1). On first unlock with a real IdP session, the key store auto-rotates to the real IdP-bound value.

### 10.2 Security Properties

- **Ephemeral channel**: The ECDH shared secret is derived from a fresh keypair on the new device, so even if the QR code is photographed, the attacker cannot decrypt without the ephemeral private key.
- **Server-blind**: The provisioning relay only sees encrypted bytes — never the nsec.
- **Room TTL**: Provisioning rooms expire after 5 minutes.
- **Verification**: The new device verifies that the decrypted nsec's public key matches the primary device's advertised pubkey.

### 10.3 Fallback

For devices without cameras, the new device displays a short alphanumeric code (derived from `roomId + ePK` truncated) that can be manually entered on the primary device.

## 11. Session Management

### 11.1 JWT Session Lifecycle

```
WebAuthn Login
  → Server verifies assertion
  → Server signs access token (15min, HS256)
  → Server signs refresh token (30d, HS256)
  → Refresh token set as httpOnly cookie (path=/api/auth/token)
  → Access token returned in response body
  └── On each API request: Authorization: Bearer <jwt>
  └── On token expiry: POST /api/auth/token/refresh → new access token
  └── On refresh: server checks IdP session is still valid
  └── On logout: POST /api/auth/session/revoke → IdP session revoked, cookie cleared
  └── On IdP deactivation: next refresh fails → user forced to re-authenticate
```

### 11.2 Idle and Visibility Locking

The key manager (not the JWT session) implements auto-locking:

- **Idle timeout**: After configurable period (default 5 minutes) of no API activity, the key manager locks. The JWT session remains valid — the user stays authenticated but cannot access encrypted content until they re-enter their PIN.
- **Visibility lock**: When the tab is backgrounded (`document.hidden === true`), the key manager locks after a configurable delay (default: immediate). Returning to the tab prompts for PIN.

These auto-lock behaviors apply only to the key manager. The JWT access token and refresh cookie are unaffected — they expire on their own schedules.

### 11.3 Multi-Device Sessions

Each device maintains its own:
- WebAuthn credential (passkey)
- JWT access + refresh token pair
- Encrypted key store (localStorage blob)
- Key manager state (locked/unlocked)

Sessions are independent across devices. Revoking a session on one device does not affect others unless an admin performs a full re-enrollment (`POST /api/auth/admin/re-enroll/:pubkey`), which revokes all IdP sessions and deletes all WebAuthn credentials.

## 12. Cryptographic Library Dependencies

| Library | Version | Usage |
|---------|---------|-------|
| `@noble/curves` | ^1.x | secp256k1 ECDH, BIP-340 Schnorr signatures |
| `@noble/ciphers` | ^1.x | XChaCha20-Poly1305 symmetric encryption |
| `@noble/hashes` | ^1.x | SHA-256, HKDF-SHA256, PBKDF2-SHA256, hex/utf8 encoding |
| `nostr-tools` | ^2.x | Key generation, bech32 nsec/npub encoding |
| `jose` | ^6.x | JWT signing (HS256), verification, claims parsing |
| Web Crypto API | — | Random bytes generation |

All cryptographic operations use audited, constant-time implementations. No custom crypto primitives.

## 13. Threat Model

| Threat | Mitigation |
|--------|-----------|
| XSS stealing nsec | Key Manager holds secretKey in Web Worker, not main thread. Auto-lock on tab hide. |
| Browser extension reading storage | localStorage contains only multi-factor encrypted ciphertext. PIN brute-force mitigated by 600k PBKDF2 iterations + IdP-bound value requirement. |
| Server compromise | Server never sees plaintext notes/messages/files. ECIES ensures server can't decrypt. IdP-bound value is encrypted at rest in IdP. |
| Device seizure | Multi-factor encrypted key in localStorage. Requires PIN + IdP value (+ optional PRF) to decrypt. Offline brute-force of PIN alone is insufficient. |
| Network MITM | HTTPS/WSS. JWT access tokens expire in 15 minutes. Refresh tokens are httpOnly/secure/sameSite=Strict. |
| Compromised identity key | Per-note/per-message ephemeral keys provide forward secrecy — compromising the identity key doesn't reveal past content without also obtaining the per-artifact envelopes. |
| Lost device | Recovery key + backup file restores access on new device. Old device's encrypted store is useless without PIN + IdP value. |
| Stolen JWT | Access tokens expire in 15 minutes. Refresh tokens are httpOnly (not accessible to JS). jti-based revocation available for immediate invalidation. |
| IdP compromise | IdP stores only envelope-encrypted `nsec_secret` values (encrypted with server's `IDP_VALUE_ENCRYPTION_KEY`). The IdP cannot derive KEKs or decrypt key stores. |
| CSRF on refresh | Refresh cookie is `sameSite=Strict` and endpoint requires `Content-Type: application/json`. |

## 14. Hub Event Encryption

### 14.1 Hub Key Distribution

The hub key is a shared 32-byte symmetric key used to encrypt Nostr relay events visible to all hub members.

```
hubKey = crypto.getRandomValues(new Uint8Array(32))

// Wrap for each member via ECIES
for each memberPubkey in activeMembers:
  wrappedHubKey = wrapKeyForPubkey(hubKey, memberPubkey, "llamenos:hub-key-wrap")
  // Publish wrapped key to relay or store server-side
```

The hub key is **random** (not derived from any identity key). This ensures:
- Compromising any identity key does not reveal the hub key
- Key rotation produces a genuinely new key with no mathematical link to the old one

### 14.2 Event Encryption

Each Nostr event's content is encrypted with a per-event derived key:

```
// Derive per-event encryption key
eventKey = HKDF-SHA256(hubKey, "llamenos:hub-event", eventNonce)

// Encrypt event content
nonce = random(24 bytes)
encryptedContent = XChaCha20-Poly1305(eventKey, nonce, JSON.stringify({
  type: "call:ring",  // Actual event type is INSIDE encrypted content
  callId: "...",
  callerLast4: "1234",
  ...
}))

// Publish to relay
Event {
  kind: 20001,  // Ephemeral — relay forwards, never stores
  tags: [["d", hubId], ["t", "llamenos:event"]],  // Generic tag only
  content: hex(nonce || encryptedContent),
  pubkey: serverPubkey
}
```

### 14.3 Server Nostr Identity

The server derives its Nostr keypair from the `SERVER_NOSTR_SECRET` environment variable:

```
ikm = hex_decode(SERVER_NOSTR_SECRET)
serverSecretKey = HKDF-SHA256(ikm, "llamenos:server-nostr-key", "llamenos:server-nostr-key:v1", 32)
serverPubkey = secp256k1.getPublicKey(serverSecretKey)
```

Clients learn the server pubkey during authentication and verify it on all server-signed events. This prevents event injection by unauthorized parties.

### 14.4 Encrypted Metadata

Call record metadata and shift schedule details are encrypted using their respective domain labels:

```
// Call metadata encryption
callMetaKey = random(32 bytes)
encryptedCallMeta = XChaCha20-Poly1305(callMetaKey, nonce, JSON.stringify({
  answeredBy: volunteerPubkey,
  duration: 300,
  ...
}))
adminEnvelopes = [wrapKeyForPubkey(callMetaKey, adminPubkey, "llamenos:call-meta") for each admin]

// Shift schedule detail encryption
scheduleKey = random(32 bytes)
encryptedSchedule = XChaCha20-Poly1305(scheduleKey, nonce, JSON.stringify({
  label: "Evening Shift",
  description: "...",
  ...
}))
adminEnvelopes = [wrapKeyForPubkey(scheduleKey, adminPubkey, "llamenos:shift-schedule") for each admin]
```

## 15. Audit Log Integrity

Audit logs use a hash-chained integrity mechanism for tamper detection.

### 15.1 Hash Chain Construction

Each audit entry includes a forward hash link:

```
entryHash = SHA-256(
  action + "|" +
  actorPubkey + "|" +
  timestamp + "|" +
  JSON.stringify(details) + "|" +
  previousEntryHash
)
```

The first entry uses an empty string as `previousEntryHash`.

### 15.2 Verification

An admin can verify chain integrity by iterating from the first entry:

```
computedHash = ""
for each entry in chronological order:
  expectedHash = SHA-256(entry.action + "|" + entry.actorPubkey + "|" + ...)
  if expectedHash !== entry.entryHash:
    TAMPER DETECTED at entry
  computedHash = entry.entryHash
```

### 15.3 Limitations

- Chain truncation from the end leaves a valid shorter chain
- An attacker with full DB access could recompute the entire chain
- For advanced protection, periodically export and sign checkpoints to an external append-only store
