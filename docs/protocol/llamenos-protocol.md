# Llámenos Cryptographic Protocol Specification

**Version:** 4.0
**Date:** 2026-04-25
**Status:** Normative

**Related Documents**:

- [Security Overview](../security/README.md) — Entry point for security auditors
- [Data Classification](../security/DATA_CLASSIFICATION.md) — Complete data inventory
- [Threat Model](../security/THREAT_MODEL.md) — Adversaries and trust boundaries
- [Security Audit R6](../security/SECURITY_AUDIT_2026-02-R6.md) — Latest audit findings

## 1. Overview

Llámenos uses a layered cryptographic architecture designed to protect volunteer and caller identity against well-funded adversaries. The system is built on three principles:

1. **Key material never persists in plaintext** — the identity key (nsec) is always encrypted at rest under a multi-factor KEK (PIN + IdP-bound value + optional WebAuthn PRF output) and held in a Web Worker during use, never in sessionStorage or global scope.
2. **Per-artifact encryption** — notes and messages use **MLS groupwise encryption** via `@wireapp/core-crypto` (forward secrecy via epoch ratchet). Hub metadata uses **HPKE RFC 9180** (`DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM`) with per-record AAD. Remaining envelope PII uses legacy ECIES (migration planned).
3. **Device-centric auth** — the nsec is a recovery-only secret. Day-to-day authentication uses WebAuthn passkeys with JWT session tokens.

## 2. Key Hierarchy

```
Identity Key (nsec / secretKey)
  32-byte secp256k1 scalar
  Generated once during onboarding
  BIP-340 x-only public key (npub)
  └── Multi-Factor Encrypted Local Store (Section 3)
  └── Recovery Key Encryption (Section 9)
  └── BIP-340 Schnorr Signatures (audit log, Nostr NIP-42)
  └── NIP-42 Relay Authentication (Section 4.3)
  └── Legacy ECIES Key Agreement (envelope PII, blasts — migration planned)

X25519 Encryption Key
  Derived from identity key or generated per-device
  Used for HPKE RFC 9180 (DHKEM(X25519, HKDF-SHA256))
  Non-extractable CryptoKey handle held inside crypto-worker closure
  └── HPKE seal/open for hub field encryption (Section 14)
  └── HPKE hub key wrapping (Section 14.1)
  └── HPKE per-device PUK wrapping (LABEL_PUK_WRAP_TO_DEVICE)
  └── HPKE SFrame call secret distribution (LABEL_SFRAME_CALL_SECRET)

Admin Decryption Key
  Separate secp256k1 keypair from identity key
  └── Legacy ECIES note/message admin envelopes (pre-MLS, retained for reference)
  └── Metadata decryption (Section 14)

Hub Key
  32-byte random: crypto.getRandomValues(new Uint8Array(32))
  NOT derived from any identity key
  Non-extractable CryptoKey (AES-GCM) handle held inside crypto-worker closure
  └── Nostr event content encryption (XChaCha20-Poly1305 + HKDF per-event)
  └── Presence encryption (volunteer-tier: boolean only)
  └── Hub-key encrypted org metadata via AES-256-GCM with per-record AAD (role names, shift names, etc.)
  └── Distribution: HPKE-wrapped per device (LABEL_HUB_KEY_WRAP)
       Wire format: HpkeEnvelope { v: 3, labelId, enc, ct }

MLS Group (per hub)
  Group ID: "llamenos:hub:<hubId>" (UTF-8 bytes)
  Ciphersuite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519
  Managed by @wireapp/core-crypto (WASM, v9.3.3)
  └── Note encryption — MLS application messages (Section 5)
  └── Message encryption — MLS application messages (Section 6)
  └── Epoch advances on membership change → forward secrecy
  └── Items-key derivation via MLS exporter secret (LABEL_ITEMS_KEY_EXPORT)
  Source: src/client/lib/mls/conversation.ts, src/client/lib/crypto-worker.ts

Server Nostr Key
  Derived: HKDF-SHA256(SERVER_NOSTR_SECRET, "llamenos:server-nostr-key", "llamenos:server-nostr-key:v1")
  └── Signs server-authoritative Nostr events (call:ring, call:answered)
  └── Clients verify server pubkey for authoritative events
  └── CANNOT decrypt any user content

Per-Note Key (LEGACY — replaced by MLS)
  Was: 32-byte random, ECIES-wrapped per reader
  Now: Notes are MLS application messages inside the hub's MLS group (Section 5)
  Legacy path deleted from src/shared/crypto-envelopes.ts

Per-Message Key (LEGACY — replaced by MLS)
  Was: 32-byte random, ECIES-wrapped per reader
  Now: Messages are MLS application messages inside the hub's MLS group (Section 6)

Per-File Key
  32-byte random
  └── ECIES-wrapped per recipient (LABEL_FILE_KEY) — migration to HPKE planned
  └── File metadata: ECIES-wrapped per recipient (LABEL_FILE_METADATA)

Draft Encryption Key
  Derived: HKDF-SHA256(secretKey, "llamenos:hkdf-salt:v1", "llamenos:drafts")
  └── Deterministic — acceptable since drafts are local-only
```

### 2.1 Domain Separation Labels

Every cryptographic operation uses a unique domain separation string to prevent cross-context key reuse attacks. The authoritative source is `src/shared/crypto-labels.ts`; this table must match that file exactly (88 constants: 63 branded `CryptoLabel`, 25 plain strings).

**LABEL_REGISTRY**: 42 active wire-indexed entries (indices 0-41) plus 5 permanently retired indices (42-46). The index of each label is its stable on-wire `labelId` byte stored in `HpkeEnvelope.labelId`. Order is a wire format — never reorder, only append.

#### HPKE Envelope Labels (enrolled in LABEL_REGISTRY, wire-indexed)

These labels are stamped into `HpkeEnvelope { v: 3, labelId, enc, ct }` and cross-checked at open time. The `labelId` is the label's index in `LABEL_REGISTRY`.

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_NOTE_KEY` | `"llamenos:note-key"` | Per-note key wrapping (legacy ECIES path deleted; retained in registry for backward compat) | 5 |
| `LABEL_HUB_KEY_WRAP` | `"llamenos:hub-key-wrap"` | Hub key **HPKE** distribution to member devices | 14.1 |
| `LABEL_MESSAGE` | `"llamenos:message"` | Server-side temporary AES-GCM encryption of inbound messages before MLS claim | 6 |
| `LABEL_FILE_KEY` | `"llamenos:file-key"` | Per-file symmetric key wrapping | 7 |
| `LABEL_FILE_METADATA` | `"llamenos:file-metadata"` | File metadata encryption | 7 |
| `LABEL_BLAST_CONTENT` | `"llamenos:blast-content"` | Blast content ECIES envelope encryption (legacy) | — |
| `LABEL_CALL_META` | `"llamenos:call-meta"` | Encrypted call record metadata (assignments) | 14 |
| `LABEL_SHIFT_SCHEDULE` | `"llamenos:shift-schedule"` | Encrypted shift schedule details | 14 |
| `LABEL_TRANSCRIPTION` | `"llamenos:transcription"` | Transcription encryption | 6 |
| `LABEL_HUB_EVENT` | `"llamenos:hub-event"` | Hub event HKDF derivation from hub key | 14 |
| `LABEL_DEVICE_PROVISION` | `"llamenos:device-provision"` | Device provisioning ECDH shared key derivation | 10 |
| `LABEL_BACKUP` | `"llamenos:backup"` | Generic backup encryption | 9 |
| `LABEL_PUSH_WAKE` | `"llamenos:push-wake"` | Wake-tier push payload (minimal metadata) | — |
| `LABEL_PUSH_FULL` | `"llamenos:push-full"` | Full-tier push payload (requires nsec) | — |
| `LABEL_CONTACT_ID` | `"llamenos:contact-identifier"` | Contact identifier encryption at rest | — |
| `LABEL_PROVIDER_CREDENTIAL_WRAP` | `"llamenos:provider-credential-wrap:v1"` | Provider OAuth/API credential wrapping | — |
| `LABEL_VOICEMAIL_WRAP` | `"llamenos:voicemail-audio"` | Voicemail audio symmetric key wrapping | — |
| `LABEL_VOICEMAIL_TRANSCRIPT` | `"llamenos:voicemail-transcript"` | Voicemail transcript encryption | — |
| `LABEL_CONTACT_INTAKE` | `"llamenos:contact-intake:v1"` | Contact intake payload — E2EE | — |
| `LABEL_CONTACT_SUMMARY` | `"llamenos:contact-summary"` | Contact summary (Tier 1) — display name, notes, languages | — |
| `LABEL_CONTACT_PII` | `"llamenos:contact-pii"` | Contact PII (Tier 2) — full name, phone, email, address, DOB | — |
| `LABEL_CONTACT_RELATIONSHIP` | `"llamenos:contact-relationship"` | Contact relationship payload — fully E2EE | — |
| `LABEL_STORAGE_CREDENTIAL_WRAP` | `"llamenos:storage-credential"` | Hub storage credential (IAM secret key) wrapping | — |
| `LABEL_HUB_FIELD` | `"llamenos:hub-field"` | Hub-key AES-256-GCM encryption of stored field values (AAD-bound) | 14 |
| `LABEL_PUK_SIGN` | `"llamenos:puk:sign:v1"` | PUK-derived Ed25519 signing key context | — |
| `LABEL_PUK_DH` | `"llamenos:puk:dh:v1"` | PUK-derived X25519 DH key context | — |
| `LABEL_PUK_SECRETBOX` | `"llamenos:puk:secretbox:v1"` | PUK-derived AES-GCM-256 SecretBox key (wraps previous generations) | — |
| `LABEL_PUK_WRAP_TO_DEVICE` | `"llamenos:puk:wrap:device:v1"` | HPKE info for wrapping PUK seed to a device X25519 pubkey | — |
| `LABEL_PUK_PREVIOUS_GEN` | `"llamenos:puk:prev-gen:v1"` | AAD for encrypting old PUK seed under new PUK SecretBox key | — |
| `LABEL_MASTER_KEY_WRAP` | `"llamenos:master:wrap:v1"` | AAD for wrapping master signing seed under PUK SecretBox key | — |
| `LABEL_MASTER_SELF_SIGNING` | `"llamenos:master:self-signing:v1"` | HMAC label: master seed to self-signing seed | — |
| `LABEL_MASTER_USER_SIGNING` | `"llamenos:master:user-signing:v1"` | HMAC label: master seed to user-signing seed | — |
| `LABEL_MASTER_RECOVERY_HANDOFF` | `"llamenos:master:recovery-handoff:v1"` | HPKE info for one-shot master seed handoff during recovery | — |
| `LABEL_MASTER_RECOVERY_GROUP_WRAP` | `"llamenos:master:recovery-group:v1"` | AAD for wrapping master seed under Recovery Group pubkey | — |
| `LABEL_PUK_RECOVERY_GROUP_WRAP` | `"llamenos:puk:recovery-group:v1"` | AAD for wrapping PUK seed under Recovery Group pubkey | — |
| `LABEL_DEVICE_DISPLAY` | `"llamenos:device:display:v1"` | AAD for encrypting device display_name under PUK SecretBox key | — |
| `LABEL_DEVICE_ENROLLMENT_SAS` | `"llamenos:device:enrollment-sas:v1"` | HKDF salt for device enrollment SAS code derivation | — |
| `LABEL_PAPER_KEY_SIGNING` | `"llamenos:paper-key:sign:v1"` | HMAC label: BIP39 seed to paper-key signing seed | — |
| `LABEL_PAPER_KEY_ENCRYPTION` | `"llamenos:paper-key:encryption:v1"` | HMAC label: BIP39 seed to paper-key encryption seed | — |
| `LABEL_HUB_PTK_PREV_GEN` | `"llamenos:hub-ptk:prev-gen:v1"` | AAD for wrapping old hub PTK under new hub PTK in CLKR chain | — |
| `LABEL_SFRAME_CALL_SECRET` | `"llamenos:sframe-call-secret:v1"` | HPKE-wrapped SFrame call secret for voice E2EE | — |
| `LABEL_SAS_MLS` | `"llamenos:sas:v2"` | 7-emoji SAS derivation from device Ed25519 pubkey | — |

**Retired indices** (42-46): These were HKDF-only labels incorrectly enrolled in the registry. They are permanently retired — the indices must never be reused.

#### MLS Domain Labels

These labels are used as HKDF info/salt parameters within MLS operations. They are plain strings, not enrolled in LABEL_REGISTRY.

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_SAS_MLS_V3` | `"llamenos:sas:v3"` | 7-emoji SAS v3 — binds verifier + target pubkeys + session nonce | — |
| `LABEL_ITEMS_KEY_EXPORT` | `"llamenos:items-key-export:v1"` | MLS exporter-secret to per-user items_key derivation | — |
| `LABEL_NOTE_EPOCH_KEY` | `"llamenos:note-epoch-key:v1"` | MLS exporter-secret to per-note epoch-bound key (provable delete) | — |
| `LABEL_MLS_PROVISION` | `"llamenos:mls-provision:v1"` | HKDF domain separation for MLS credential provisioning | — |

#### Legacy ECIES Labels (still active for envelope PII, blasts, push, provisioning)

These labels use the legacy ECIES wrapping path (`secp256k1.getSharedSecret` + XChaCha20-Poly1305). Migration to HPKE is planned.

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_BLAST_CONTENT` | `"llamenos:blast-content"` | Blast content ECIES envelope encryption | — |
| `LABEL_PUSH_WAKE` | `"llamenos:push-wake"` | Wake-tier ECIES push payload | — |
| `LABEL_PUSH_FULL` | `"llamenos:push-full"` | Full-tier ECIES push payload | — |
| `LABEL_IDP_VALUE_WRAP` | `"llamenos:idp-value-wrap"` | Envelope encryption of IdP-bound value at rest in the IdP | 3.2 |
| `LABEL_PROVIDER_CREDENTIAL_WRAP` | `"llamenos:provider-credential-wrap:v1"` | Provider OAuth/API credential wrapping | — |
| `LABEL_DEVICE_PROVISION` | `"llamenos:device-provision"` | Device provisioning ECDH shared key derivation | 10 |

#### HKDF / HMAC / KDF Labels (unchanged)

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `HKDF_SALT` | `"llamenos:hkdf-salt:v1"` | HKDF salt for legacy symmetric key derivation | 5.4 |
| `HKDF_CONTEXT_DRAFTS` | `"llamenos:drafts"` | HKDF context for draft encryption | 8 |
| `HKDF_CONTEXT_EXPORT` | `"llamenos:export"` | HKDF context for export encryption | — |
| `LABEL_HUB_EVENT` | `"llamenos:hub-event"` | Hub event HKDF derivation from hub key | 14 |
| `SAS_SALT` | `"llamenos:sas"` | SAS HKDF salt for provisioning verification | 10 |
| `SAS_INFO` | `"llamenos:provisioning-sas"` | SAS HKDF info parameter | 10 |
| `AUTH_PREFIX` | `"llamenos:auth:"` | Schnorr auth token message prefix (deprecated) | — |
| `HMAC_PHONE_PREFIX` | `"llamenos:phone:"` | Phone number hashing prefix | — |
| `HMAC_IP_PREFIX` | `"llamenos:ip:"` | IP address hashing prefix | — |
| `HMAC_KEYID_PREFIX` | `"llamenos:keyid:"` | Key identification hash prefix | 3.1 |
| `HMAC_SUBSCRIBER` | `"llamenos:subscriber"` | Subscriber identifier HMAC key | — |
| `HMAC_PREFERENCE_TOKEN` | `"llamenos:preference-token"` | Preference token HMAC key | — |
| `RECOVERY_SALT` | `"llamenos:recovery"` | Recovery key PBKDF2 fallback salt (legacy) | 9 |
| `LABEL_KEK_PRF` | `"llamenos:kek-prf"` | WebAuthn PRF evaluation salt for KEK derivation | 3.1 |
| `LABEL_NSEC_KEK_3F` | `"llamenos:nsec-kek:3f"` | HKDF info for 3-factor KEK derivation | 3.1 |
| `LABEL_NSEC_KEK_2F` | `"llamenos:nsec-kek:2f"` | HKDF info for 2-factor KEK derivation | 3.1 |
| `LABEL_SERVER_NOSTR_KEY` | `"llamenos:server-nostr-key"` | HKDF derivation for server Nostr keypair | 14 |
| `LABEL_SERVER_NOSTR_KEY_INFO` | `"llamenos:server-nostr-key:v1"` | HKDF info for server Nostr key | 14 |
| `LABEL_SERVER_HPKE_KEY` | `"llamenos:server-hpke-key"` | HKDF derivation for server HPKE X25519 keypair | — |
| `LABEL_SERVER_HPKE_KEY_INFO` | `"llamenos:server-hpke-key:v1"` | HKDF info for server HPKE key | — |
| `LABEL_CONTACT_ID` | `"llamenos:contact-identifier"` | HKDF context for contact identifier encryption | — |

#### SFrame Voice E2EE Labels

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_SFRAME_BASE_KEY` | `"llamenos:sframe-base-key:v1"` | HKDF info for per-sender SFrame base key derivation | — |
| `LABEL_SFRAME_RATCHET` | `"llamenos:sframe-ratchet:v1"` | HKDF salt for forward-secret ratchet on device join | — |

#### Tier 2: Root KEK + Factor Wrapping Labels

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_PRF_KEK_SALT_V1` | `"llamenos:kek-prf-salt:v1"` | WebAuthn PRF salt (Tier 2 root KEK unlock) | — |
| `LABEL_ROOT_KEK_WRAP` | `"llamenos:root-kek-wrap"` | AES-KW wrap of root KEK — HKDF info suffix per factor | — |
| `LABEL_RECOVERY_PHRASE_KEK` | `"llamenos:recovery-phrase-kek"` | HKDF context for BIP-39 recovery phrase wrapping key | — |
| `LABEL_OPAQUE_EXPORT_KEK` | `"llamenos:opaque-export-kek"` | HKDF context for OPAQUE export key wrapping key | — |
| `LABEL_RECOVERY_GROUP_WRAP` | `"llamenos:recovery-group-wrap"` | HKDF context for recovery-group share wrapping key | — |
| `LABEL_RECOVERY_GROUP_SHARE` | `"llamenos:recovery-group-share"` | HKDF context for per-member SSS share derivation | — |
| `LABEL_RECOVERY_SESSION_PAYLOAD` | `"llamenos:recovery-session-payload"` | HKDF context for per-session reconstructed KEK wrapping | — |

#### Field-Level Encryption (Server-Key)

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_AUDIT_EVENT` | `"llamenos:audit-event:v1"` | Server-key encryption of audit log events and details | 15 |
| `LABEL_IVR_AUDIO` | `"llamenos:ivr-audio:v1"` | Server-key encryption of IVR audio prompt data | — |
| `LABEL_BLAST_SETTINGS` | `"llamenos:blast-settings:v1"` | Server-key encryption of blast settings messages | — |
| `LABEL_USER_PII` | `"llamenos:volunteer-pii:v1"` | Server-key encryption of user/invite PII (phone numbers) | — |
| `LABEL_EPHEMERAL_CALL` | `"llamenos:ephemeral-call:v1"` | Server-key encryption of ephemeral call data (caller numbers) | — |
| `LABEL_PUSH_CREDENTIAL` | `"llamenos:push-credential:v1"` | Server-key encryption of push notification credentials | — |
| `LABEL_SESSION_META` | `"llamenos:session-meta:v1"` | Session metadata envelope (IP, UA, location) — user-envelope encrypted | — |

#### Firehose / Auth Event / Signal Labels

| Constant | Label | Purpose | Section |
|----------|-------|---------|---------|
| `LABEL_FIREHOSE_AGENT_SEAL` | `"llamenos:firehose:agent-seal"` | Firehose agent nsec sealed encryption | — |
| `LABEL_FIREHOSE_BUFFER_ENCRYPT` | `"llamenos:firehose:buffer-encrypt"` | Firehose message buffer at-rest encryption | — |
| `LABEL_FIREHOSE_REPORT_WRAP` | `"llamenos:firehose:report-wrap"` | Firehose extracted report envelope wrapping | — |
| `LABEL_AUTH_EVENT` | `"llamenos:user-auth-event:v1"` | User-scoped auth event payload envelope | — |
| `LABEL_SIGNAL_CONTACT` | `"llamenos:signal-contact:v1"` | Signal contact identifier envelope | — |

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
5. (Optional) Check `jti` against short-lived in-memory revocation set for immediate access token invalidation

### 4.2 Refresh Tokens (Opaque Session Tokens)

Refresh tokens are opaque 32-byte random values stored as httpOnly cookies, backed by the `user_sessions` PostgreSQL table. They are NOT JWTs.

**Token generation:**
```
token = base64url(crypto.getRandomValues(new Uint8Array(32)))
// 43 characters, URL-safe, no padding
```

**Storage:**
- Token is HMAC-SHA256 hashed before storage in `user_sessions.tokenHash`
- Previous token hash retained in `prevTokenHash` for one-rotation grace window (concurrent tab tolerance)
- Session metadata (IP, UA, geolocation) is user-envelope encrypted via `LABEL_SESSION_META`

**Properties:**
- Token: 32 random bytes, base64url-encoded
- Expiry: configurable (stored in `user_sessions.expiresAt`)
- Cookie name: `llamenos-refresh`
- Cookie attributes: `httpOnly`, `secure`, `sameSite=Strict`, `path=/api/auth`
- Companion cookie: `llamenos-session-id` (used for `isCurrent` marker on session list)

**Refresh flow (`POST /api/auth/token/refresh`):**
1. Server reads the `llamenos-refresh` cookie
2. HMAC-SHA256 hashes the token and looks up the session in `user_sessions`
3. Validates session is not revoked and not expired
4. Validates the user is still active in the IdP via `idpAdapter.refreshSession(pubkey)`
5. Generates a new opaque token, rotates the hash in `user_sessions` (old hash → `prevTokenHash`)
6. Issues a new JWT access token with current permissions
7. Sets the new opaque token in the `llamenos-refresh` cookie
8. If the IdP session is invalid, returns 401 — the user must re-authenticate

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
  |                                          |-- 10. Sign JWT access token (15min)
  |                                          |-- 11. Generate opaque refresh token (32B random)
  |                                          |-- 12. Hash + store in user_sessions; set cookie
  |<-- 13. { accessToken, pubkey } ----------|
```

**Rate limiting:** Login endpoints are rate-limited per IP hash (10 requests per 5-minute window).

### 4.4 Session Revocation via `user_sessions`

Sessions are revoked by setting `revokedAt` and `revokedReason` on the corresponding `user_sessions` row. The refresh token is an opaque 32-byte random value (not a JWT); the server stores only its HMAC-SHA256 hash.

**Session table structure:**
```sql
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_pubkey TEXT NOT NULL,
  token_hash TEXT NOT NULL,           -- HMAC-SHA256 of opaque 32-byte token
  prev_token_hash TEXT,               -- one-rotation grace for concurrent refreshes
  ip_hash TEXT NOT NULL,
  credential_id TEXT,
  encrypted_meta TEXT NOT NULL,       -- envelope-encrypted IP/UA/location (LABEL_SESSION_META)
  meta_envelope JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,                -- 'user' | 'admin' | 'lockdown_a/b/c' | 'replay' | 'expired'
  expires_at TIMESTAMPTZ NOT NULL
);
```

**Revocation reasons:**
- `user`: Explicit session revocation (`POST /api/auth/sessions/:id/revoke`)
- `admin`: Admin-initiated re-enrollment (`POST /api/auth/admin/re-enroll/:pubkey`)
- `lockdown_a/b/c`: Graduated security lockdown tiers
- `replay`: Stale token detected (possible token theft)
- `expired`: Automatic cleanup of expired sessions

**Token rotation on refresh:** Every successful refresh generates a new opaque token. The old token hash moves to `prevTokenHash` (one-rotation grace window), and the new hash replaces `tokenHash`. This ensures that a stolen refresh token becomes useless after the legitimate client's next refresh.

### 4.5 Session Revocation

`POST /api/auth/session/revoke` performs a full session teardown:
1. Marks the session as revoked in `user_sessions` (sets `revokedAt` + `revokedReason`)
2. Revokes the user's session in the IdP via `idpAdapter.revokeSession(pubkey)`
3. Clears the `llamenos-refresh` cookie (sets `maxAge=0`)
4. The JWT access token naturally expires within 15 minutes

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

## 5. Note Encryption (MLS Groupwise)

Notes are MLS application messages inside the hub's persistent MLS group.

### 5.1 MLS Group

Each hub has exactly one MLS group with a deterministic group ID:

```
groupId = UTF-8("llamenos:hub:<hubId>")
```

**Ciphersuite:** `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`

The group is managed by `@wireapp/core-crypto` (WASM, v9.3.3). The `CoreCrypto` instance and identity key material live in closures inside the crypto Web Worker, zeroed on lock.

Source: `src/client/lib/mls/conversation.ts`, `src/client/lib/crypto-worker.ts`

### 5.2 Encryption

```
plaintext = UTF-8(JSON.stringify({ text, fields }))
ciphertext = MlsConversation.encrypt(plaintext)
// → MLS application message ciphertext stored server-side
```

The MLS protocol handles key scheduling, sender authentication, and AEAD encryption internally. Each message uses the current epoch's application secret — no per-note random key is needed.

### 5.3 Decryption

```
result = MlsConversation.decrypt(ciphertext)
// result.message = plaintext bytes (for application messages)
// result.hasEpochChanged = true (for commit messages that advance the epoch)
payload = JSON.parse(UTF-8(result.message))
```

### 5.4 Forward Secrecy

MLS provides forward secrecy through epoch advancement:
- Each membership change (add/remove member) produces a Commit that advances the epoch
- The new epoch's secrets are derived from the commit's path secrets
- Old epoch secrets are deleted — compromising the current epoch key does not reveal past messages
- This replaces the per-note random key approach used in the legacy ECIES path

### 5.5 Legacy Note Encryption (pre-MLS) — Retained for Reference

> **This section describes the deleted ECIES note envelope path.** The ECIES note encryption code has been removed from `src/shared/crypto-envelopes.ts`. This description is retained for historical reference and for understanding any notes encrypted before the MLS migration.

Each note used a fresh random key, ECIES-wrapped for each authorized reader:

```
noteKey = random(32 bytes)
nonce = random(24 bytes)
payload = JSON.stringify({ text, fields })
encryptedContent = nonce || XChaCha20-Poly1305(noteKey, nonce, payload)

authorEnvelope = wrapKeyForPubkey(noteKey, authorPubkey)
adminEnvelope = wrapKeyForPubkey(noteKey, adminPubkey)
```

**Key Wrapping (ECIES):**

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

### 5.6 Legacy Deterministic Note Decryption

Notes created before per-note keys use a deterministic key:
```
legacyKey = HKDF-SHA256(secretKey, "llamenos:hkdf-salt:v1", "llamenos:notes", 32)
```

Legacy notes are identified by the absence of `authorEnvelope`/`adminEnvelope` fields.

## 6. Message Encryption (MLS Groupwise)

Messages (SMS, WhatsApp, Signal conversations) use MLS groupwise encryption via the same hub MLS group as notes (Section 5).

### 6.1 Encryption

Messages are MLS application messages inside the hub's MLS group, identical to the note encryption path:

```
plaintext = UTF-8(messageText)
ciphertext = MlsConversation.encrypt(plaintext)
// → MLS application message stored server-side
```

Decryption:
```
result = MlsConversation.decrypt(ciphertext)
messageText = UTF-8(result.message)
```

### 6.2 Inbound Message Flow (Webhook Claim Pattern)

For inbound messages (SMS/WhatsApp webhook -> server):

1. Server receives plaintext from telephony provider (inherent limitation of SMS/WhatsApp)
2. Server encrypts with AES-GCM under `LABEL_MESSAGE` (server-side temporary encryption)
3. Server stores the server-encrypted copy; discards the plaintext from memory
4. First client to fetch claims the message, decrypts the server-encrypted copy, MLS-encrypts it via the hub group, and uploads the MLS ciphertext
5. Server discards the server-encrypted copy, retaining only the MLS ciphertext

This "claim" pattern ensures:
- The server holds plaintext for the minimum possible duration (webhook boundary only)
- Once MLS-encrypted, the server cannot read the message
- All hub members can decrypt via the MLS group (not just the assigned volunteer)

### 6.3 Outbound Message Flow

For outbound messages (volunteer -> SMS/WhatsApp):

1. Client MLS-encrypts the message and uploads the ciphertext
2. Client sends `plaintextForSending` (for the provider) alongside the MLS ciphertext
3. Server forwards the plaintext to the telephony provider (inherent limitation)
4. Server stores ONLY the MLS ciphertext; discards `plaintextForSending` immediately

**Important**: The server momentarily sees outbound message plaintext — this is an inherent limitation of SMS/WhatsApp channels, not a bug. See [Threat Model: SMS/WhatsApp Outbound Message Limitation](../security/THREAT_MODEL.md#smswhatsapp-outbound-message-limitation).

## 7. File Encryption

Files use a two-layer scheme:

1. **File Key**: Random 32-byte key encrypts the file content (XChaCha20-Poly1305)
2. **Key Wrapping**: File key is ECIES-wrapped per recipient (`LABEL_FILE_KEY`) — migration to HPKE is planned but not yet implemented
3. **Metadata**: File metadata (name, type, size, checksum) ECIES-encrypted separately per recipient (`LABEL_FILE_METADATA`)

Chunked upload: file is encrypted client-side, split into chunks, uploaded, and reassembled server-side. The server never sees plaintext.

**Note**: The items-key indirection design (MLS exporter secret → per-user `items_key` via `LABEL_ITEMS_KEY_EXPORT` → file key wrap) is specified but not yet implemented. File crypto currently uses direct ECIES wrapping per recipient.

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
  → Server signs JWT access token (15min, HS256)
  → Server generates opaque refresh token (32 random bytes, hashed in user_sessions)
  → Refresh token set as httpOnly cookie (path=/api/auth)
  → Access token returned in response body
  └── On each API request: Authorization: Bearer <jwt>
  └── On token expiry: POST /api/auth/token/refresh → new access token + rotated refresh token
  └── On refresh: server checks IdP session is still valid; rotates opaque token
  └── On logout: POST /api/auth/session/revoke → session revoked in DB, IdP revoked, cookie cleared
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
| `@hpke/core` | ^1.x | HPKE RFC 9180 base mode — `CipherSuite`, `HkdfSha256`, `Aes256Gcm` |
| `@hpke/dhkem-x25519` | ^1.x | `DhkemX25519HkdfSha256` KEM (uses `@noble/curves` internally; avoids `crypto.subtle.deriveBits('X25519')` which Bun does not yet implement) |
| `@wireapp/core-crypto` | v9.3.3 (vendored) | MLS 1.0 protocol implementation (WASM). Manages MLS group state, epoch advancement, encrypt/decrypt, KeyPackage generation. Runs inside the crypto Web Worker. |
| `@noble/curves` | ^1.x | BIP-340 Schnorr signatures (audit log, Nostr events). **No longer used for ECDH key agreement** — HPKE uses X25519 via the HPKE suite. Retained for legacy ECIES paths (envelope PII, blasts). |
| `@noble/ciphers` | ^1.x | XChaCha20-Poly1305 for KEK encryption, drafts, hub event encryption, and legacy envelope PII (migration to HPKE planned) |
| `@noble/hashes` | ^1.x | SHA-256, HKDF-SHA256, PBKDF2-SHA256, hex/utf8 encoding |
| `nostr-tools` | ^2.x | Key generation, bech32 nsec/npub encoding |
| `jose` | ^6.x | JWT signing (HS256), verification, claims parsing |
| Web Crypto API | — | Random bytes generation, AES-256-GCM (hub fields via non-extractable `CryptoKey`), HKDF, PBKDF2, X25519 key import/export |

All cryptographic operations use audited, constant-time implementations. No custom crypto primitives.

**HPKE suite configuration** (source: `src/shared/crypto-suite.ts`):
```
KEM:  0x0020 — DHKEM(X25519, HKDF-SHA256)
KDF:  0x0001 — HKDF-SHA256
AEAD: 0x0002 — AES-256-GCM
```
Suite ID (code constant, not on wire): `llamenos-hpke-v1:x25519-hkdf-sha256-aes256gcm`

## 13. Threat Model

| Threat | Mitigation |
|--------|-----------|
| XSS stealing nsec | Key Manager holds secretKey in Web Worker, not main thread. Auto-lock on tab hide. |
| Browser extension reading storage | localStorage contains only multi-factor encrypted ciphertext. PIN brute-force mitigated by 600k PBKDF2 iterations + IdP-bound value requirement. |
| Server compromise | Server never sees plaintext notes/messages/files. MLS groupwise encryption (notes, messages) and HPKE (hub fields) ensure the server cannot decrypt. Legacy ECIES protects remaining envelope PII. IdP-bound value is encrypted at rest in IdP. |
| Device seizure | Multi-factor encrypted key in localStorage. Requires PIN + IdP value (+ optional PRF) to decrypt. Offline brute-force of PIN alone is insufficient. |
| Network MITM | HTTPS/WSS. JWT access tokens expire in 15 minutes. Refresh tokens are httpOnly/secure/sameSite=Strict. |
| Compromised identity key | MLS epoch ratchet provides forward secrecy — compromising the current epoch key does not reveal past messages. For hub field data (HPKE), compromising the X25519 private key reveals only data encrypted to that key, not hub key material from prior rotations. |
| Lost device | Recovery key + backup file restores access on new device. Old device's encrypted store is useless without PIN + IdP value. |
| Stolen JWT | Access tokens expire in 15 minutes. Refresh tokens are opaque (not JWTs), httpOnly (not accessible to JS), and rotated on every refresh — a stolen token is invalidated after the legitimate client's next refresh. Sessions revocable via `user_sessions` table. |
| IdP compromise | IdP stores only envelope-encrypted `nsec_secret` values (encrypted with server's `IDP_VALUE_ENCRYPTION_KEY`). The IdP cannot derive KEKs or decrypt key stores. |
| CSRF on refresh | Refresh cookie is `sameSite=Strict` and endpoint requires `Content-Type: application/json`. |

## 14. Hub Event Encryption

### 14.1 Hub Key Distribution

The hub key is a shared 32-byte symmetric key used to encrypt Nostr relay events and hub metadata visible to all hub members. It is imported as a non-extractable `CryptoKey` (AES-GCM) handle inside the crypto-worker closure.

```
hubKey = crypto.getRandomValues(new Uint8Array(32))

// Wrap for each member via HPKE
for each memberPubkey in activeMembers:
  aad = buildAad(LABEL_HUB_KEY_WRAP, memberPubkey, "hub-key-wrap")
  envelope = hpkeSeal(hubKey, memberX25519PublicKey, LABEL_HUB_KEY_WRAP, aad)
  // envelope: HpkeEnvelope { v: 3, labelId: 1, enc: <base64url>, ct: <base64url> }
  // Store server-side or publish to relay
```

**Unwrapping:**
```
aad = buildAad(LABEL_HUB_KEY_WRAP, myPubkey, "hub-key-wrap")
hubKeyBytes = hpkeOpen(envelope, myX25519PrivateKey, LABEL_HUB_KEY_WRAP, aad)
hubCryptoKey = crypto.subtle.importKey("raw", hubKeyBytes, "AES-GCM", false, ["encrypt", "decrypt"])
```

The hub key is **random** (not derived from any identity key). This ensures:
- Compromising any identity key does not reveal the hub key
- Key rotation produces a genuinely new key with no mathematical link to the old one
- Rotation on member departure excludes the departed member (they never receive the new HPKE-wrapped key)

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
