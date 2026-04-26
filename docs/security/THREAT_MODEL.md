# Llamenos Threat Model

## Document Purpose

This document defines the threat model for Llamenos, a secure crisis response hotline webapp. It identifies adversaries, attack surfaces, trust boundaries, and the security properties the system must maintain. All architectural decisions and security controls are evaluated against this model.

**Related Documents**:
- [Security Overview](README.md) — Entry point for security auditors
- [Data Classification](DATA_CLASSIFICATION.md) — Complete data inventory with encryption status
- [Protocol Specification](../protocol/llamenos-protocol.md) — Cryptographic algorithms and wire formats
- [Deployment Hardening](DEPLOYMENT_HARDENING.md) — Infrastructure security guidance

## Protected Assets

| Asset | Classification | Storage Location | Protection |
|-------|---------------|-----------------|------------|
| Caller phone numbers | PII / Safety-Critical | Hashed in PostgreSQL | HMAC-SHA256 with operator secret; last 4 digits stored plaintext for display |
| Call note content | Confidential | Encrypted in PostgreSQL | E2EE: MLS groupwise encryption via `@wireapp/core-crypto`; server stores opaque MLS ciphertext |
| Volunteer identity (name) | PII / Safety-Critical | E2EE in PostgreSQL (`users.encryptedName`) | Tier 1 envelope encryption (legacy ECIES per-user — HPKE migration planned); server stores ciphertext only |
| Volunteer identity (phone) | PII / Safety-Critical | E2EE in PostgreSQL (`users.encryptedPhone`) | Tier 1 envelope encryption (legacy ECIES); server needs ciphertext for routing but cannot read plaintext |
| Volunteer private keys (nsec) | Secret | Multi-factor encrypted in browser localStorage | PIN + IdP value + optional WebAuthn PRF; PBKDF2-SHA256 600K iterations, factors combined via HKDF-SHA256 → XChaCha20-Poly1305 encrypts nsec |
| Admin private key (nsec) | Secret | Operator-managed (env var, hardware key) | Never stored server-side |
| IdP value (nsec_secret) | Secret | Authentik user attributes (encrypted) | XChaCha20-Poly1305 with HKDF-derived key from `IDP_VALUE_ENCRYPTION_KEY` |
| JWT access tokens | Secret | Memory-only (client), never persisted | Short-lived (15min TTL), signed with `JWT_SECRET` |
| JWT refresh tokens | Secret | httpOnly secure cookie (client) | Revocable via `user_sessions` table; rotated on every refresh |
| WebAuthn credentials | Secret | PostgreSQL (`webauthnCredentials` table) | Credential public keys stored; private keys never leave authenticator |
| Audit logs | Operational | PostgreSQL | Admin-only access; IP hashes truncated to 96 bits; hash-chained for tamper detection |
| Shift schedules | Operational | PostgreSQL | Hub-key encrypted names; authenticated access only |
| Org metadata (role names, shift names, etc.) | Operational | PostgreSQL | Hub-key encrypted (AES-256-GCM via non-extractable WebCrypto `CryptoKey`, per-record AAD) |
| Contact directory PII | PII / Safety-Critical | E2EE in PostgreSQL | Tier 1 envelope encryption; display name, full name, phone, notes all encrypted |
| Telephony credentials | Secret | Environment variables / `.env` | Never in source control; never sent to client |

## Adversary Profiles

### Tier 1: Nation-State Actor

**Capabilities**: TLS interception via national CA, ISP-level traffic analysis, physical device seizure, legal compulsion of cloud providers, advanced persistent threats against CI/CD, social engineering of developers/operators.

**Goals**: Identify callers (political dissidents, activists). Identify volunteers. Obtain call note content. Disrupt hotline operations.

**Mitigations**:
- E2EE notes with forward secrecy — server compromise reveals nothing
- E2EE for all volunteer PII (name, phone) — server stores only ciphertext
- Multi-factor key encryption — PIN alone insufficient for key recovery; requires IdP value (Authentik) and optionally WebAuthn PRF
- Remote kill-switch via IdP session revocation — admin can immediately lock out any device by revoking Authentik sessions + JWT tokens
- Auto-lock on idle/tab-hide — limits physical access window
- Generic PWA name ("Hotline") — reduces identification on seized devices
- JWT short-lived access tokens (15min) — limits window of stolen token utility
- Domain-separated HPKE (76 `LABEL_*` constants, 42 wire-indexed in `LABEL_REGISTRY`) — no cross-context key reuse
- Certificate pinning NOT implemented (impractical for web apps; rely on HSTS preload)

**Residual risks**:
- Multi-factor key encryption significantly raises the bar vs. PIN-only, but a funded adversary with both the device and access to the Authentik database could reconstruct the KEK
- Caller phone numbers are transiently available to answering volunteers during active calls
- Traffic analysis can reveal call timing, duration, and volunteer activity patterns
- Legal compulsion of VPS/cloud provider can access encrypted blobs (but not decrypt them)

### Tier 2: Private Intelligence / Hacking Firm

**Capabilities**: Targeted phishing, watering-hole attacks, 0-day browser exploits, insider recruitment, social engineering.

**Goals**: Same as Tier 1 but typically contracted by specific interests. May target individual volunteers or admins.

**Mitigations**:
- WebAuthn passkeys — phishing-resistant authentication
- CSP `script-src 'self'` — limits XSS payload injection
- Session revocation on role change/deactivation — compromised accounts can be cut off
- Invite-code system — no open registration; requires admin approval
- Webhook signature validation — prevents telephony API spoofing

### Tier 3: Opportunistic Attacker / Script Kiddie

**Capabilities**: Known CVE exploitation, credential stuffing, automated scanning.

**Goals**: Disruption, data theft, defacement.

**Mitigations**:
- Rate limiting on all auth endpoints
- Voice CAPTCHA for call spam
- SHA-pinned GitHub Actions
- `--frozen-lockfile` dependency installation
- HSTS preload + security headers
- Non-root container execution

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        UNTRUSTED                                │
│  Callers (PSTN)  │  Public Internet  │  Cloud Provider          │
└──────┬───────────┴────────┬──────────┴──────────┬──────────────┘
       │                    │                     │
       │ Telephony          │ HTTPS/WSS           │ Infrastructure
       │ Webhooks           │                     │ Access
       ▼                    ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SEMI-TRUSTED                                   │
│  Bun/Hono Server (Docker/VPS/Kubernetes)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐      │
│  │ Hono API │→│ JWT Auth │→│ PBAC MW  │→│ Route Handler │      │
│  └──────────┘ └──────────┘ └──────────┘ └───────┬───────┘      │
│                                                  │               │
│  ┌─────────────────────────────────────────────┐ │               │
│  │ PostgreSQL (encrypted blobs, hashed IDs)    │←┘               │
│  └─────────────────────────────────────────────┘                 │
│                                                                   │
│  ┌──────────────────────────────────────────────┐                │
│  │ Authentik IdP (self-hosted, operator-controlled)              │
│  │ Stores: encrypted nsec_secret per user                        │
│  │ Provides: one factor for multi-factor KEK derivation          │
│  │ If compromised alone: insufficient — needs PIN + optionally   │
│  │ WebAuthn PRF to reconstruct KEK                               │
│  └──────────────────────────────────────────────┘                │
│                                                                   │
│  Server can see: metadata (who wrote, when, callId)              │
│  Server CANNOT see: note content, volunteer PII, org metadata    │
└──────────────────────────────────────────────────────────────────┘
       │                    │
       │ E2EE payloads      │ Encrypted key blobs
       ▼                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                       TRUSTED                                     │
│  Volunteer's Browser                                              │
│  ┌───────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │ Key Mgr   │ │ Crypto       │ │ Auth Context │                │
│  │ (closure) │ │ HPKE+MLS+    │ │ JWT + WA     │                │
│  │           │ │ legacy ECIES │ │              │                │
│  └───────────┘ └──────────────┘ └──────────────┘                │
│                                                                   │
│  Decrypted notes exist ONLY here, in memory, while unlocked      │
└──────────────────────────────────────────────────────────────────┘
```

### Boundary Rules

1. **PSTN → Server**: All telephony webhooks MUST be signature-validated (Twilio HMAC-SHA1, Vonage HMAC-SHA256, etc.). Caller numbers are hashed on receipt; only last-4 digits retained in call records.

2. **Internet → Server**: All API requests require JWT Bearer token authentication (except `/api/config`, `/api/auth/*` login/bootstrap/refresh endpoints). CORS restricts to same-origin. Security headers enforced on all responses.

3. **Server → Client**: The server NEVER sends plaintext note content, transcription text, or file data. All sensitive data is encrypted with the recipient's public key before storage.

4. **Client → Server**: The client sends encrypted payloads only. Exception: `plaintextForSending` in messaging (SMS/WhatsApp require server-side plaintext to reach the provider — documented and accepted).

5. **Cloud Provider / VPS Host**: The infrastructure operator can access encrypted blobs, metadata, and traffic patterns. They CANNOT decrypt E2EE content without the volunteer/admin private keys.

6. **Authentik IdP → Server**: Authentik is self-hosted and operator-controlled. It stores an encrypted `nsec_secret` per user (one factor of the multi-factor KEK). If Authentik is compromised alone, the attacker obtains IdP values but NOT PINs or WebAuthn PRF outputs. Multi-factor derivation means compromise of any single factor is insufficient to reconstruct the KEK.

## Attack Surface Inventory

### External Attack Surface

| Surface | Entry Point | Auth Required | Validation |
|---------|------------|---------------|------------|
| Login | `POST /api/auth/login` | No | Schnorr signature + rate limit |
| Bootstrap | `POST /api/auth/bootstrap` | No | Schnorr signature + one-shot guard + rate limit |
| Token refresh | `POST /api/auth/refresh` | httpOnly refresh cookie | JWT signature verification + jti revocation check |
| WebAuthn registration | `POST /api/auth/webauthn/register/*` | JWT | Authenticated users only |
| WebAuthn authentication | `POST /api/auth/webauthn/authenticate/*` | Challenge | Rate-limited challenge-response |
| IdP value fetch | `POST /api/auth/idp-value` | JWT | Returns encrypted nsec_secret from Authentik |
| Config | `GET /api/config` | No | Read-only; exposes `adminPubkey` |
| Telephony webhooks (10 endpoints) | `POST /telephony/*` | Webhook signature | Provider-specific HMAC |
| Messaging webhooks | `POST /messaging/*` | Webhook signature | Provider-specific validation |
| All other API endpoints | `*/api/*` | JWT Bearer token | JWT auth + PBAC permission middleware |
| IVR audio | `GET /api/ivr-audio/*` | No | Strict regex on path params |
| Dev reset | `POST /api/test-reset*` | No (env-gated) | `ENVIRONMENT=development` check |

### Internal Attack Surface (Post-Authentication)

| Surface | Risk | Mitigation |
|---------|------|------------|
| Volunteer → Admin escalation | Role modification | PBAC permission system; safe-fields allowlist on self-update; `users:manage-roles` permission required for role changes |
| Volunteer → Other volunteer's notes | Note content theft | E2EE — server has no plaintext; `notes:read-own` permission scoping |
| Volunteer → Caller identification | PII exposure | Caller numbers hashed; only `callerLast4` sent to answering volunteer; redacted for others |
| Admin → Excessive data access | Insider threat | Audit logging of all admin actions; admin notes are separately encrypted |
| Nostr relay event injection | Fake call events | Server-signed events (clients verify server pubkey) + NIP-42 auth + hub key encryption |

## Cryptographic Properties

### What We Guarantee

| Property | Mechanism | Strength |
|----------|-----------|----------|
| Note/message confidentiality | MLS groupwise encryption (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`) via `@wireapp/core-crypto` | 128-bit AEAD security (AES-128-GCM within MLS) |
| Note/message integrity | MLS authenticated encryption (AEAD) | 128-bit |
| Note/message forward secrecy | MLS epoch ratchet — epoch advances on membership change | X25519 + Ed25519 |
| Hub-field confidentiality | AES-256-GCM via non-extractable WebCrypto `CryptoKey`, per-record AAD | 256-bit symmetric |
| Hub key distribution | HPKE RFC 9180: `DHKEM(X25519, HKDF-SHA256) + AES-256-GCM` | 128-bit KEM security |
| Envelope PII confidentiality | Legacy ECIES (secp256k1 ECDH + XChaCha20-Poly1305) | 128-bit ECDH + 256-bit symmetric |
| Key-at-rest confidentiality | PBKDF2-SHA256 (600K iter) + HKDF-SHA256 → XChaCha20-Poly1305 | ~20 bits PIN + IdP factor + 256-bit key |
| Auth token unforgeability | BIP-340 Schnorr signatures (login) | 128-bit security level |
| JWT access token integrity | HMAC-SHA256 with server `JWT_SECRET` | 256-bit key |
| JWT refresh token revocability | `user_sessions` table with hashed 32-byte tokens; rotated on every refresh | Immediate revocation |
| Multi-factor KEK strength | PIN + IdP value + optional WebAuthn PRF combined via HKDF-SHA256 | Compromise of any single factor insufficient |
| Phone hash preimage resistance | HMAC-SHA256 with operator secret | Infeasible without HMAC secret |
| Domain separation | 76 `LABEL_*` constants (42 wire-indexed in `LABEL_REGISTRY`); HPKE envelopes embed `labelId` cross-checked on open | No cross-context key reuse |

### What We Do NOT Guarantee

| Gap | Reason | Acceptable? |
|-----|--------|------------|
| Traffic analysis resistance | No padding, no dummy traffic | Yes — impractical for a web app |
| Metadata confidentiality | Server needs `callId`, `authorPubkey`, timestamps for routing | Yes — documented trade-off |
| SMS/WhatsApp E2EE | Provider requires plaintext | Yes — documented per-channel |
| PIN brute-force resistance (offline) | 4-6 digit PIN, ~10K-1M possibilities; requires IdP value as co-factor | Marginal PIN alone — multi-factor KEK requires all factors |
| Server-side key deletion verification | Cannot prove hosting provider/operator deleted data | Yes — fundamental cloud trust limitation |

## Legal Compulsion and Subpoena Scenarios

This section documents what data can be obtained through legal process against various parties. Crisis hotlines operating in hostile legal environments should understand these limitations.

### Subpoena of Hosting Provider (VPS / Cloud)

**Which court's subpoena?** The answer to "what can be obtained" depends entirely on who has jurisdiction over the provider's parent company — not just the datacenter location. See [Provider Jurisdiction and Deployment Tiers](#provider-jurisdiction-and-deployment-tiers) below for the full analysis.

**Obtainable (assuming the subpoena is honored):**
- Encrypted database contents (ciphertext for E2EE data)
- Plaintext metadata: call timestamps, durations, volunteer assignments, call IDs
- Caller phone hashes (irreversible without operator's HMAC secret)
- Audit logs with truncated IP hashes
- Traffic metadata (request times, sizes, source IPs)
- Account information for the operator

**Not Obtainable via legal process against the hosting provider alone:**
- Note content, transcription text, report bodies (E2EE — provider has ciphertext only)
- Volunteer private keys (stored client-side, never uploaded)
- Per-note encryption keys (ephemeral, never persisted)
- Operator's HMAC secret (not stored with hosting provider)

**Obtainable via compelled runtime instrumentation** (court order requiring the provider to actively modify the runtime — possible in jurisdictions that compel active assistance, e.g., FISA 702 orders, UK Technical Capability Notices):
- Anything the application sees in plaintext: volunteer names and phones (decrypted client-side), note contents in memory on volunteer devices (requires serving modified JS), admin private keys if the admin uses the web client
- This is why **jurisdiction of the hosting provider matters more than FDE** for the hostile-legal-environment threat model. FDE defeats "image the disk"; it does not defeat "inject code into the running VM."

### Subpoena of Telephony Provider (Twilio, SignalWire, etc.)

**Obtainable:**
- Call detail records (timestamps, phone numbers, durations)
- Call recordings (if recording is enabled — **Llamenos does NOT enable recording by default**)
- SMS message content (passes through provider in plaintext)
- WhatsApp message content (passes through Meta)
- Account and billing information

**Not Obtainable:**
- Call notes (never sent to telephony provider)
- Volunteer identities beyond phone numbers used for call routing
- Any E2EE content

### Device Seizure (Volunteer)

**Without PIN:**
- Encrypted key blob in localStorage requires multi-factor KEK reconstruction
- PIN brute-force alone is now insufficient — the IdP value (from Authentik) is also required
- With WebAuthn PRF enabled: three factors needed (PIN + IdP value + PRF output from authenticator)
- JWT access tokens expire in 15 minutes; refresh tokens are httpOnly cookies (revocable server-side)

**With PIN only (no IdP value):**
- Cannot reconstruct KEK — the IdP value is a separate encryption factor stored server-side in Authentik
- Admin can immediately revoke IdP sessions and JWT tokens, preventing token refresh

**With all factors (PIN + IdP value + optional PRF):**
- Access to that volunteer's decrypted notes
- Cannot decrypt other volunteers' notes (separate keypairs)
- MLS forward secrecy: compromising identity key does not reveal past notes — MLS epoch ratchet ensures forward secrecy on membership change

**Mitigations:**
- Multi-factor KEK makes PIN-only brute-force insufficient
- Admin can remotely revoke sessions via IdP (Authentik user disable) + JWT bulk revocation
- Enable device full-disk encryption
- Use 6-digit PIN (not 4-digit)
- Enable auto-lock on shorter timeout
- Enable WebAuthn PRF for three-factor key protection

### Device Seizure (Admin)

**Impact if admin nsec is obtained:**
- Can decrypt all notes (admin envelope exists on every note)
- Can impersonate admin role
- Cannot impersonate individual volunteers

**Mitigations:**
- Store admin nsec in hardware security module (HSM) or air-gapped device
- Use YubiKey or similar for admin authentication
- Never store admin nsec on internet-connected devices
- Implement admin key rotation procedures

### Insider Threat (Malicious Operator)

A malicious operator with server access can:
- Read all plaintext metadata
- Modify server code to capture data before encryption (requires deployment access)
- Access HMAC secret to reverse phone hashes
- Cannot decrypt E2EE content without volunteer/admin private keys

**Mitigations:**
- Reproducible builds (Epic 79) allow verification of deployed code
- Multi-party deployment approval
- Audit logging of all server access

## JWT Token Threats

The system uses short-lived JWT access tokens (15-minute TTL) and longer-lived refresh tokens (httpOnly cookie). Both are signed with `JWT_SECRET`.

| Threat | Impact | Window | Mitigation |
|--------|--------|--------|------------|
| Access token theft (XSS, memory dump) | Impersonation for API calls | 15 minutes (token TTL) | Short TTL limits window; CSP `script-src 'self'` prevents most XSS; token never persisted to storage |
| Refresh token theft (cookie exfiltration) | Token renewal for extended access | Until revoked | Opaque 32-byte random token; httpOnly + Secure + SameSite=Strict cookie; revocable via `user_sessions` table; rotated on every refresh (stolen token invalidated after next legitimate refresh) |
| Token injection (forged JWT) | Unauthorized API access | N/A if secret is secure | Requires `JWT_SECRET`; use `openssl rand -hex 32` for 256-bit entropy |
| JWT_SECRET compromise | All tokens forgeable | Until secret rotation | Rotate immediately; set `JWT_SECRET_PREVIOUS` for 15-minute transition; revoke all refresh tokens |
| Bulk session hijacking | Mass impersonation | Until detected | Monitor audit logs for anomalous patterns; JWT includes `pubkey` in `sub` claim for attribution |

### JWT Secret Rotation Procedure

1. Generate a new secret: `openssl rand -hex 32`
2. Set `JWT_SECRET_PREVIOUS` to the current `JWT_SECRET` value
3. Set `JWT_SECRET` to the new secret
4. Restart the application — new tokens use the new secret; existing tokens validated against both
5. After 15 minutes (access token TTL), remove `JWT_SECRET_PREVIOUS`
6. Optionally bulk-revoke all refresh tokens for a clean break

---

## Authentik (IdP) Compromise Scenario

Authentik is self-hosted and operator-controlled. It stores an encrypted `nsec_secret` per user — one factor of the multi-factor KEK used to decrypt the volunteer's private key.

### What an Authentik Compromise Reveals

| Data | Classification | Impact |
|------|---------------|--------|
| Encrypted `nsec_secret` values | Ciphertext | Encrypted with `IDP_VALUE_ENCRYPTION_KEY` via XChaCha20-Poly1305; attacker needs the encryption key to decrypt |
| User records (pubkeys, active status) | Pseudonymous | Pubkeys are already semi-public; no PII stored in Authentik |
| Session state | Operational | Can hijack active IdP sessions |

### Attack Scenarios

**Scenario A: Authentik database dump only**
- Attacker obtains encrypted `nsec_secret` values
- Without `IDP_VALUE_ENCRYPTION_KEY` (stored in app `.env`, not in Authentik), these are undecryptable ciphertext
- **Impact**: Low — encrypted blobs without the key

**Scenario B: Authentik database + `IDP_VALUE_ENCRYPTION_KEY`**
- Attacker can decrypt `nsec_secret` values (one KEK factor)
- Still needs the user's PIN (and optionally WebAuthn PRF) to reconstruct the full KEK
- **Impact**: Medium — reduces multi-factor to fewer factors, but does not directly yield private keys

**Scenario C: Authentik admin API access**
- Attacker can disable/enable users, create sessions, modify attributes
- Can perform IdP-level denial of service (disable all users)
- Cannot forge JWTs (JWT_SECRET is separate, held by the app server)
- **Impact**: Medium-High — operational disruption; combined with other factors could enable key recovery

### Mitigations

- Rotate `IDP_VALUE_ENCRYPTION_KEY` periodically (requires re-encrypting all `nsec_secret` values)
- Network-isolate Authentik (accessible only from app server, not from public internet)
- Use a dedicated PostgreSQL instance for Authentik (not shared with app database)
- Monitor Authentik audit logs for unauthorized API access
- Restrict Authentik API token scope to minimum required operations
- Rate-limit Authentik API endpoints

---

## Deployment-Specific Threats

### Authentik IdP Deployment

- **Authentik as operator-controlled party**: Self-hosted; stores encrypted IdP values (one KEK factor). If compromised alone: insufficient for key recovery without PIN + optional WebAuthn PRF.
- **Authentik account/API compromise**: Attacker can disable/enable users, modify attributes, create sessions. Cannot forge JWTs (separate secret). Combined with `IDP_VALUE_ENCRYPTION_KEY` compromise: reduces multi-factor to fewer factors.
- **Network isolation**: Authentik should be accessible only from the app server, not from the public internet. See [Deployment Hardening, Section 3](DEPLOYMENT_HARDENING.md#3-authentik-idp-hardening).

### Docker/Node.js Self-Hosted Deployment

- **Operator as trusted party**: The operator has full access to the server, database, and secrets. They cannot read E2EE content without volunteer private keys.
- **VPS provider access**: The hosting provider can image the VM, access disk, and intercept network traffic. TLS + E2EE provides defense-in-depth.
- **PostgreSQL security**: Database credentials, TLS for connections, encrypted backups are the operator's responsibility.
- **Reverse proxy configuration**: Caddy provides TLS termination and security headers. Misconfiguration (e.g., HTTP without redirect) would expose session tokens.

### Kubernetes Deployment

- **NetworkPolicy enforcement**: Requires a CNI that supports NetworkPolicy (Calico, Cilium). Without enforcement, pod-to-pod traffic is unrestricted.
- **Secret management**: Kubernetes Secrets are base64-encoded, not encrypted, unless etcd encryption is configured. Use External Secrets Operator or Vault for production.
- **Pod security**: `runAsNonRoot`, `readOnlyRootFilesystem`, `drop: ALL` capabilities enforced in the Helm chart.

## Push Notification Infrastructure (APNs/FCM) as Trusted Parties

Mobile push notifications require routing through Apple Push Notification service (APNs) and Google Firebase Cloud Messaging (FCM). These are platform-mandated intermediaries — there is no way to deliver push notifications to iOS or Android devices without them.

### What APNs/FCM Can Observe

| Observable | Detail | Severity |
|-----------|--------|----------|
| Device tokens | Unique per-device identifier registered with the push service; links a specific device to push activity | Medium |
| Push timing | Exact timestamp of every notification delivery — when calls arrive, when messages are sent | High |
| Push metadata | Message size, priority level (`high` for calls, `normal` for messages), collapse keys | Medium |
| Delivery receipts | Whether the notification was delivered, opened, or dismissed | Low |
| Device state | Whether the device is online, battery level (affects delivery strategy) | Low |

### What APNs/FCM Cannot Observe (With Encrypted Payloads)

If push payloads are encrypted before submission to the push service (planned in Epic 75), APNs/FCM **cannot** read:

- Call content, caller identity, or call metadata
- Message text or sender identity
- Note content or any E2EE data
- The specific action the user should take

The push service sees an opaque encrypted blob and a priority level. The client decrypts locally after waking.

### Residual Risk: Activity Pattern Analysis

A sophisticated adversary with access to APNs or FCM infrastructure (e.g., via legal compulsion of Apple/Google, or compromise of their systems) can perform activity pattern analysis:

- **Hotline activity windows**: Determine when the hotline is active by observing push notification bursts to multiple volunteer devices simultaneously
- **Volunteer identification**: Correlate push notification timing with known volunteer device tokens to confirm who is on shift
- **Call volume estimation**: Count high-priority push notifications to estimate call frequency
- **Geographic inference**: If device tokens are correlated with geographic data available to Apple/Google, infer the locations of volunteers receiving calls

**This is an inherent limitation of mobile push infrastructure.** There is no technical mitigation beyond not using push notifications at all (which would severely degrade the volunteer experience for mobile users). Organizations operating under extreme threat models should consider:

- Foreground-only operation (no push notifications; volunteers must keep the app open)
- Nostr relay subscription via persistent connection (battery-intensive, unreliable on mobile)
- Accepting the risk as a necessary trade-off for mobile support

### Assessment

Push notification infrastructure is a **necessary trusted party** for mobile deployments. The trust is limited to metadata and timing — with encrypted payloads, content confidentiality is preserved. Organizations whose threat model includes Apple or Google as adversaries should restrict operations to desktop browsers where Nostr relay subscriptions replace push notifications entirely.

---

## Cloud Provider Trust Boundary (Honest Assessment)

**Note**: The primary deployment model is self-hosted (Docker Compose / Kubernetes). This section documents the general trust analysis for any cloud provider hosting Llamenos, and historically addressed Cloudflare Workers as a deployment target. The zero-knowledge architecture (E2EE notes, encrypted Nostr events) minimizes what any infrastructure provider can access.

### What E2EE Protects Against (Any Provider)

| Threat | Protection Level | Explanation |
|--------|-----------------|-------------|
| Database-only subpoena | **Strong** | If only PostgreSQL data is obtained (e.g., via legal process targeting stored data), the attacker gets encrypted blobs — ciphertext for notes, volunteer PII, org metadata, hashed phone numbers. Without volunteer/admin private keys, this data is useless. |
| Rogue provider employee with DB access | **Strong** | An employee with access to database storage (but not the application runtime) sees only encrypted blobs. This is a realistic scenario — large organizations have many employees with partial infrastructure access. |
| Third-party breach of storage layer | **Strong** | If an attacker compromises the storage layer (RustFS, PostgreSQL backups) without gaining runtime access, all E2EE data is protected. |
| Passive network observer | **Strong** | TLS protects data in transit. An observer on the network path sees encrypted Nostr relay events only. |

### What E2EE Does NOT Protect Against

| Threat | Protection Level | Explanation |
|--------|-----------------|-------------|
| VPS provider as a willing adversary | **None** | The VPS provider can image the VM, access disk, and intercept network traffic. They could modify the served JavaScript to exfiltrate keys. Reproducible builds allow verification of deployed client code — but a compromised server could serve different code selectively. |
| Legal compulsion with runtime access | **None** | A court order compelling the VPS provider to instrument the runtime would defeat E2EE for in-flight data. The provider would not need private keys — they could capture data in transit. |
| Server compromise | **None** | An attacker with root access can modify server code, read secrets (`JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`), and intercept requests. E2EE protects data at rest but not data in transit through a compromised server. |

### What the Infrastructure Provider Can Always Observe

- **HTTP request metadata**: All API request URLs, headers, query parameters, source IPs
- **Nostr relay connections**: IP addresses, connection timing, duration, event frequency and sizes
- **Database contents at rest**: Encrypted blobs are present on disk; provider sees ciphertext
- **DNS and TLS termination**: All domain resolution passes through the provider (unless using custom DNS)
- **Application secrets**: If the provider images the VM disk, `.env` files containing `JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`, etc. are accessible

## Provider Jurisdiction and Deployment Tiers

The cloud provider trust boundary above defines what E2EE does and does not protect against **for a given provider**. This section addresses the orthogonal question of **which provider** to choose. It is a balancing act between legal protection (which jurisdiction can compel the provider?) and physical protection (can the provider's own employees casually access disk, or is data encrypted at rest?). Neither alone is sufficient for the hostile-legal-environment threat model.

### Why jurisdiction is not the same as datacenter location

A provider's corporate jurisdiction determines which courts and law-enforcement agencies can compel it to disclose data or actively instrument running services. This is decided not by where bits are physically stored, but by **which courts have personal jurisdiction over the legal entity** that controls the data.

- **US CLOUD Act (2018)** allows US authorities to compel any US-subject company to produce data in its "possession, custody, or control" regardless of where that data is stored worldwide. The test for "US-subject" is whether the company is subject to US personal jurisdiction. This is created by **any** of: US headquarters, US subsidiary, US datacenter, US office, or US employees. HQ location alone is insufficient — a German parent company with a US cloud subsidiary is still reachable through its US presence for data stored anywhere in its global network.
- **EU / member-state law** typically requires a local court order and is subject to GDPR constraints on cross-border transfers. German (BDSG), French, Dutch, Icelandic, and Swiss providers have meaningfully different compelled-disclosure regimes than US-subject ones, and critically they cannot be reached by US legal process unless they *also* operate in the US.
- **China National Intelligence Law (2017)**, Article 7, compels Chinese citizens and organizations to "support, assist, and cooperate with state intelligence work." Chinese cloud providers (Alibaba Cloud, Tencent Cloud, Huawei Cloud, Baidu Cloud) are therefore disqualified on state-access grounds independent of any CLOUD Act analysis.

**Llamenos policy (strict test):** the operator's hosting provider must operate in exactly one jurisdiction (or only within a small set of aligned jurisdictions, e.g., EU-only). A provider with US operations of any kind is disqualified even if incorporated abroad, because US personal jurisdiction over the US arm creates a compulsion pathway for data in the non-US arm. The test is operationalized as: **does the provider have any of (US datacenter, US subsidiary, US office, US employees)?** If yes, disqualified.

**Currently disqualified under this test** (as of 2026-04):

| Provider | Reason |
|----------|--------|
| AWS, GCP, Azure | US-headquartered |
| Vultr, Linode (Akamai), DigitalOcean | US-headquartered |
| Cloudflare (paid products) | US-headquartered |
| **Hetzner** | German parent, but operates US cloud datacenters in Ashburn VA (since 2021) and Hillsboro OR (since 2023). US operations create personal-jurisdiction reach. |
| **OVHcloud** | French parent, but operates OVHcloud US LLC with ~200 US employees and two US datacenters (Vint Hill VA + Hillsboro OR since 2017). |
| **Alibaba Cloud** | Chinese parent (disqualified on National Intelligence Law grounds) **and** operates Silicon Valley datacenters in Santa Clara CA since 2015 (additionally disqualified on CLOUD Act grounds). Dual-jurisdictional exposure. |
| Other Chinese clouds (Tencent, Huawei, Baidu) | Chinese National Intelligence Law Art. 7 |

**Currently on the clean list** (no US operations, single jurisdiction or aligned EU-only):

| Provider | Jurisdiction | Notes |
|----------|--------------|-------|
| **Scaleway** | France (Iliad Group) | EU-only datacenters: Paris, Amsterdam, Warsaw, Milan. Best candidate for managed instance. |
| **1984 Hosting** | Iceland | Iceland-only. Explicit civil-liberties focus. Custom ISO support via support ticket; status pending confirmation. |
| **FlokiNET** | Iceland / Romania / Netherlands / Finland | Purpose-built for civil society and whistleblower projects. No ID required at signup; accepts crypto. |
| **Infomaniak** | Switzerland | Swiss-only, strong Swiss data protection law, more expensive. |
| **Exoscale** | Switzerland / Germany / Bulgaria / Austria | Swiss-headquartered. |

This list is not exhaustive and is expected to change as providers expand. When evaluating any new provider, **verify current US operations before deploying** — datacenter expansions announced quietly can silently change a provider's jurisdictional status.

### Why FDE is not the same as legal protection

Full-disk encryption (via the custom ISO builder documented in `docs/deployment/iso-install.md`) defeats a specific set of attacks:

- **Disk imaging** by the provider or a third party that obtains decommissioned hardware
- **Snapshot-based exfiltration** when the VM is powered down
- **Cold-boot attacks** on physical machines after they lose power
- **Casual employee access** to shutdown disk images

FDE does **not** defeat:

- **Hypervisor-level RAM capture** on a running VM (the encryption key lives in kernel memory once unlocked)
- **Compelled runtime instrumentation** — a court order forcing the provider to inject code into the hypervisor or swap the served JavaScript
- **Live memory forensics** by an insider with hypervisor access
- **Network-level capture of decrypted data** flowing through the application once unlocked

Legal protection defeats the runtime-compulsion attacks that FDE cannot. FDE defeats the passive and recovered-media attacks that legal protection cannot reach (because they do not require provider cooperation). **The two are complementary**; choosing between them rather than stacking them is a false economy.

### Deployment tiers (ranked by threat model coverage)

The recommended tier for a given deployment depends on the operator's adversary model, budget, and operational capacity.

| Tier | Description | Jurisdiction | Physical | Runtime compulsion | Cost & ops burden |
|------|-------------|--------------|----------|---------------------|-------------------|
| **1. Self-hosted on owned hardware (with FDE)** | Operator owns the physical machine in their jurisdiction, runs Llamenos via the Ansible playbook and the custom FDE ISO | Operator's own | **Strong** (physical access = operator only) | **Strong** (no provider to compel) | Highest — requires hardware, stable power/network, physical security, and ops skill |
| **2. Single-jurisdiction dedicated server + custom FDE ISO** ⭐ **preferred production target** | Provider-owned bare metal from a clean-list provider (FlokiNET Romania/Netherlands via "install my own through iLO/IPMI", Scaleway Dedibox, Infomaniak dedicated, etc.) with custom FDE ISO installed via iLO/IPMI virtual media mount. Operator sets LUKS passphrase that the provider never sees. | Single non-US | **Strong** (dedicated hardware, disk encrypted) | **Strong against runtime compulsion** — no hypervisor, no memory-capture path that doesn't require physical datacenter access | Medium — ~€50–120/mo; longer provisioning |
| **3. Single-jurisdiction cloud VPS + custom FDE ISO** | Virtualized instance from a clean-list provider (1984, Scaleway, FlokiNET VPS, Infomaniak, Exoscale) with custom FDE ISO attached via provider support or installed via rescue-mode qemu passthrough | Single non-US | Medium (disk encrypted, but hypervisor sees RAM) | Weak against hypervisor-level compulsion, strong against disk imaging | Low — ~€5–40/mo; **documented fallback and starting point for cost-sensitive deployments; current managed-instance tier** |
| **4. Single-jurisdiction cloud VPS, stock OS, no FDE** | Standard VPS from a clean-list provider with provider-installed Debian and Ansible hardening | Single non-US | Weak (provider can image disk at will) | Weak | Lowest — minutes to provision, but cedes the most to the provider |
| **5a. Foreign-parent host with US operations** | Hetzner Cloud, OVHcloud, any other provider that operates US datacenters / US subsidiary / US offices regardless of where the parent company is incorporated | **Disqualified** | Provider-dependent | **Disqualified** — CLOUD Act reach via US presence | Not supported for the default threat model |
| **5b. US-headquartered cloud (any configuration)** | AWS, GCP, Azure, Vultr, Linode, DigitalOcean, Cloudflare paid, etc. | **Disqualified** | Provider-dependent | **Disqualified** — CLOUD Act | Not supported for the default threat model |
| **5c. Chinese cloud (any configuration)** | Alibaba Cloud, Tencent Cloud, Huawei Cloud, Baidu Cloud. Note Alibaba additionally has US datacenters, creating dual exposure. | **Disqualified** | Provider-dependent | **Disqualified** — China National Intelligence Law Art. 7 compels cooperation; Alibaba also CLOUD Act subject via US operations | Not supported for any threat model |

**Notes on the tiers:**

- **FDE does real work in tiers 1, 2, and 3.** It makes decommissioned hardware and powered-off snapshots useless, and materially raises the cost of a rogue employee browsing your data. It does not substitute for legal protection and should be combined with it, not traded off against it.
- **Tier 2 is the preferred production default** when the operator can afford the cost and ops overhead. The decisive advantage over Tier 3 is the absence of a hypervisor: there is no runtime-compulsion path that doesn't require physical datacenter access. A provider compelled to image the disk still gets only LUKS ciphertext; a provider compelled to dump running VM memory cannot do so without physically visiting the machine. On cloud VPS (Tier 3), the hypervisor sees the LUKS key in guest memory once the volume is unlocked, and compelled hypervisor instrumentation is a technically straightforward attack for any legal regime that permits it. The most direct concrete realization of Tier 2 today is **FlokiNET Romania dedicated with "install my own via iLO/IPMI"** — operator sets a LUKS passphrase the provider never sees, using the custom FDE ISO mounted as virtual media through iLO.
- **Tier 3 is the documented fallback and the practical starting point for most deployments.** It is the cheapest path that still defeats the disk-imaging, snapshot, and decommissioned-hardware adversary classes, which is the large majority of realistic attacks against a small civil-society operator. For cost-sensitive operators, first-time operators, or early deployments that haven't yet justified dedicated hardware, Tier 3 remains the correct choice. The Llamenos managed instance at `platform.llamenos-hotline.com` starts at Tier 3 for exactly this reason.
- **Tier 2 vs Tier 3 decision rule:** Tier 2 if the operator expects to face adversaries capable of compelling the provider to instrument running services (nation-state, hostile state where their deployment operates, well-resourced private adversaries with legal hooks into the provider's jurisdiction). Tier 3 if the operator's adversary class is primarily passive (disk-reuse, curious employees, snapshot subpoenas, legal process that stops at "hand over what's on disk"). Both are acceptable for the default Llamenos threat model; Tier 2 is strictly stronger but comes with real operational cost.
- **Tier 5 (disqualified hosts) is disqualified even with FDE**, because the adversary that these hosts cannot defend against (federal legal process + runtime compulsion by either US or Chinese authorities) can bypass FDE by instrumenting the live hypervisor. Stacking FDE on top of a disqualified host creates a false sense of security and is actively worse than choosing a weaker tier honestly.
- **The foreign-parent exception does not help** — Tier 5a is as disqualified as 5b. Hetzner is German, OVH is French, but both operate US datacenters and US subsidiaries, which creates US personal-jurisdiction hooks sufficient for US legal process to reach data anywhere in their networks. The only foreign-parent exception is a provider that has operations in exactly one jurisdiction (or a tightly aligned subset, e.g., EU-only).
- **Single-jurisdiction does not mean safe.** Every jurisdiction has some compelled-disclosure regime. France, Iceland, the Netherlands, and Switzerland have historically been meaningfully stronger for civil-society workloads than the US, but none are immune. Operators with local-adversary threat models should prefer a jurisdiction hostile to their adversary.
- **Anonymity vs verification trade-off.** Some providers (Hetzner, major EU clouds) require government ID at signup, which creates a paper trail linking the operator identity to the account. Privacy-focused providers (FlokiNET, Njalla, 1984) typically do not require ID and accept crypto payments. This trade-off is operator-specific and not covered by this threat model.
- **Verify current provider status before deploying.** Provider US operations can change (datacenter openings, acquisitions) without public fanfare. A provider that was on the clean list a year ago may not be today. Before any new deployment, verify the provider still passes the strict test.

### Recommendation for maximum-privacy deployments

Operators whose threat model is dominated by nation-state adversaries with strong legal reach should deploy to **Tier 1 (self-hosted on owned hardware)**, combining:

- Custom FDE ISO (`docs/deployment/iso-install.md`) on operator-owned hardware
- Self-hosted strfry Nostr relay
- Physical security for the machine (locked room, tamper-evident seals, etc.)
- Network path that the operator controls or that routes through Tor / mix networks
- Separate admin devices that never touch internet-facing infrastructure

Operators whose threat model is dominated by lawful-but-adversarial legal process with runtime-compulsion capability (court orders that can force provider instrumentation of running services, as opposed to court orders that can only obtain data at rest) should prefer **Tier 2 — a single-jurisdiction dedicated server in a jurisdiction hostile to their adversary, with self-installed FDE**. The absence of a hypervisor cuts off the most practical attack against an FDE-protected system: compelling the provider to dump guest memory while the volume is unlocked. The operator owns the whole box; the provider's recourse is limited to physical datacenter operations, which require legal process that is usually narrower and slower than runtime-instrumentation orders.

Operators whose threat model is dominated by legal process that stops at "hand over what's on disk" (disk imaging subpoenas, snapshot requests, employee access audits) and who cannot justify the cost and ops overhead of a dedicated server should deploy to **Tier 3 — a single-jurisdiction cloud VPS with the custom FDE ISO installed via custom-ISO attachment or rescue-mode qemu**. This tier defeats the large majority of realistic adversaries against a typical civil-society operator, at a fraction of the cost of Tier 2.

**Llamenos-operated managed instance:** The `platform.llamenos-hotline.com` managed instance starts at **Tier 3** on a 1984 Hosting VPS (Iceland jurisdiction, custom FDE ISO attached via 1984 support), and is planned to migrate to **Tier 2** on a dedicated server in a hostile jurisdiction once deployment experience and load patterns justify the upgrade. Operators whose adversary *is* the state should not rely on a managed instance regardless of jurisdiction — they should self-host at Tier 1, or (distant second) run their own Tier 2 dedicated server under a jurisdiction and an account identity that are hostile to their adversary.

---

## Admin Pubkey Fetch Trust

The client fetches the admin's public key from the server (`GET /api/auth/me` for authenticated users). This pubkey is used to create the admin envelope when encrypting notes — ensuring the admin can decrypt all notes. If an attacker can substitute their own pubkey during this fetch, volunteers would unknowingly encrypt notes for the attacker.

### Attack Scenario

1. Attacker performs MITM on the connection between volunteer client and server (e.g., via compromised CDN, DNS hijack, or rogue TLS certificate)
2. Attacker intercepts the response to `/api/auth/me` and replaces `adminPubkey` with their own pubkey
3. Volunteer's client now encrypts the admin envelope of every note for the attacker's key
4. Attacker collects encrypted notes from the server (or intercepts them in transit)
5. Attacker can decrypt all notes created after the substitution

### Current Mitigation (Post-L-1 Fix)

After the Epic 67 L-1 fix, `adminPubkey` is only returned to authenticated users via `/api/auth/me`. This means the attacker must:
- Compromise the TLS connection to an already-authenticated session
- OR compromise the server itself

This significantly reduces the attack surface compared to the previous `/api/config` endpoint (which was unauthenticated and publicly accessible), but does not eliminate the risk.

### Defense-in-Depth Recommendations

**1. Build-Time Pubkey Pinning (Recommended for Production)**

Include a SHA-256 hash of the expected admin pubkey in the built JavaScript bundle:

```
Build step: ADMIN_PUBKEY_HASH = SHA-256(adminPubkey) → embedded in client bundle
Runtime:    fetchedHash = SHA-256(response.adminPubkey)
            if (fetchedHash !== ADMIN_PUBKEY_HASH) → warn user, refuse to encrypt
```

The attacker would need to modify the served JavaScript bundle (which requires CDN/server compromise) AND substitute the pubkey. This converts a single-point-of-failure (MITM on API response) into a two-point-of-failure (MITM on API response + modification of served JS).

**Trade-off**: Admin key rotation requires a client rebuild and redeployment. This is acceptable for a crisis hotline where admin key rotation is a rare, high-ceremony event.

**2. Out-of-Band Verification**

Display the admin pubkey fingerprint in the admin settings UI. Volunteers can verify the fingerprint via a secure side channel (in-person, encrypted messaging, phone call). This is a manual process and does not scale, but provides a strong verification path for high-security deployments.

**3. Subresource Integrity (SRI) for Client Bundle**

SRI hashes on the HTML that loads the client JavaScript ensure the bundle has not been tampered with in transit. If the bundle includes a pinned pubkey hash, SRI protects both the bundle integrity and the pinned hash.

### Residual Risk

Even with all mitigations, a server compromise can serve modified JavaScript that removes the pinning check entirely. This is the fundamental limitation of web applications — the server controls the code the client executes. Only a native application with code signing can fully address this, and that introduces its own supply chain risks (app store compromise, signing key theft).

---

## Departed Volunteer Key Retirement

When a volunteer departs the organization (whether amicably or under hostile circumstances), they retain their Nostr private key (nsec). There is no technical mechanism to force deletion of a key from a device the organization no longer controls. This section documents the security implications.

### What a Departed Volunteer CAN Do

| Action | Reason | Severity |
|--------|--------|----------|
| Decrypt notes they authored | They hold the author envelope key for their own notes | Low — they wrote these notes; this is expected |
| Prove they were a member | Their pubkey was registered in the system; signed Nostr events may exist | Medium — depending on operational context |
| Attempt to authenticate | Their keypair is still cryptographically valid | None — server-side deactivation blocks authentication |

### What a Departed Volunteer CANNOT Do

| Action | Reason |
|--------|--------|
| Decrypt new hub events | Hub key is rotated on departure (see Key Revocation Runbook Section 3b); new hub key is not distributed to the departed volunteer |
| Decrypt other volunteers' notes | They never had those envelope keys; MLS group membership scoped per hub |
| Decrypt notes created after departure | New notes use new hub key; even if they somehow obtained ciphertext, they lack the decryption key |
| Access the application | Session revocation on deactivation; WebAuthn credentials tied to their account are revoked |
| Decrypt admin-only note envelopes | They never had the admin private key |

### Hub Key Rotation as the Primary Defense

The hub key is a shared symmetric key used to encrypt Nostr events visible to all active members. When a volunteer departs:

1. Admin deactivates the volunteer (existing functionality)
2. All active sessions for the volunteer are revoked (existing)
3. A new hub key is generated and HPKE-distributed to all remaining devices (Epic 76.2)
4. All events published after rotation use the new hub key
5. The departed volunteer retains the old hub key and can decrypt historical hub events they had access to during their tenure

**This means**: A departed volunteer can read historical hub events from their period of membership. They cannot read anything published after the key rotation. This is analogous to an employee who leaves a company — they remember what they saw during their employment, but lose access to future information.

### Hostile Departure Scenario

If a volunteer departs under hostile circumstances (e.g., suspected of being an informant, compromised by an adversary):

1. **Immediate**: Deactivate the volunteer, revoke sessions, rotate hub key
2. **Assessment**: Determine what data the volunteer had access to during their tenure:
   - All hub events from their membership period
   - Their own notes (full content)
   - Caller last-4 digits from calls they answered
   - Shift schedules they could view
   - Other volunteers' display names (not real names, unless admin)
3. **If the volunteer was an admin**: They had access to ALL note content (admin envelope), all volunteer PII, and the hub key. This is the worst case — treat as an admin key compromise (see Key Revocation Runbook Section 3a).
4. **Notification**: Assess GDPR notification obligations based on what data was accessible.

### Residual Risk

Historical access cannot be revoked. Once a volunteer has decrypted a note or hub event, the plaintext existed in their browser memory. Even with perfect forward secrecy and key rotation, we cannot un-reveal information that was legitimately accessible during the volunteer's tenure. This is a fundamental limitation of any system that grants data access to users.

---

## SMS/WhatsApp Outbound Message Limitation

Outbound messages via SMS and WhatsApp are **not zero-knowledge**. The server sees plaintext message content momentarily during the send flow. This is an inherent limitation of these messaging channels, not a bug in the architecture.

### Why Plaintext is Required

SMS and WhatsApp APIs (Twilio, MessageBird, Meta Business API, etc.) accept plaintext message bodies. There is no mechanism to send end-to-end encrypted content through these channels — the provider must read the message to deliver it.

### The Outbound Message Flow

```
1. Volunteer composes message in client UI
2. Client encrypts message with admin pubkey → sends encrypted payload to server
3. Server decrypts message using admin key (server holds admin key for outbound routing)
4. Server forwards PLAINTEXT message body to telephony/messaging provider API
5. Provider delivers message to recipient via SMS/WhatsApp
6. Server discards plaintext from memory (never persisted to storage)
```

### What This Means

- **Step 3**: The server has the plaintext message in memory. A compromised server (or a server operator) can read outbound messages at this point.
- **Step 4**: The telephony provider (Twilio, etc.) receives and processes the plaintext message. They log it, bill for it, and may retain it per their data retention policies.
- **Step 5**: The SMS/WhatsApp network transports the message. SMS is inherently insecure (SS7 interception is well-documented). WhatsApp messages are E2EE between the WhatsApp client endpoints, but the business API is a different trust model — Meta can read messages sent via the Business API.

### Comparison with Other Channels

| Channel | Server Sees Plaintext? | Provider Sees Plaintext? | True E2EE Possible? |
|---------|----------------------|--------------------------|---------------------|
| In-app notes | No | N/A | Yes (current implementation) |
| In-app messaging (Nostr) | No | N/A | Yes (Epic 74) |
| SMS outbound | Yes (momentarily) | Yes (stored by provider) | No |
| WhatsApp outbound (Business API) | Yes (momentarily) | Yes (Meta can read) | No |
| Signal outbound (via signal-cli bridge) | Depends on bridge architecture | No (Signal protocol E2EE) | Yes (if bridge decrypts at final hop) |

### Signal Bridge as an Alternative

A self-hosted signal-cli bridge can achieve true E2EE for outbound messages if the bridge is deployed as a trusted component that:

1. Receives the encrypted message from the server
2. Decrypts it locally (bridge holds necessary key material)
3. Re-encrypts via Signal protocol for the recipient
4. Sends via Signal — the message is E2EE between the bridge and the recipient

In this architecture, the Llamenos server never sees plaintext. The trust is shifted to the signal-cli bridge, which must be self-hosted and operator-controlled. This is a meaningful improvement for organizations that can deploy and maintain the bridge infrastructure.

### Required Documentation for Operators

Operators deploying Llamenos with SMS/WhatsApp messaging must understand:

1. Outbound messages on these channels are NOT zero-knowledge
2. The telephony provider retains message content per their policies
3. A subpoena of the telephony provider can obtain message content
4. SMS is vulnerable to SS7 interception by sophisticated adversaries
5. For maximum message confidentiality, use Signal channel or in-app messaging only

---

## npm Supply Chain Risk

Llamenos depends on npm packages for core cryptographic operations. A compromised dependency — particularly in the cryptographic stack — could undermine every security property in this document. Supply chain attacks on npm are well-documented (event-stream, ua-parser-js, colors.js, etc.) and represent a realistic threat.

### Critical Dependencies

| Package | Purpose | Risk if Compromised | Author |
|---------|---------|-------------------|--------|
| `@noble/curves` | secp256k1 ECDH, Schnorr signatures | Key theft, signature forgery, ECDH backdoor | Paul Miller (single author) |
| `@noble/ciphers` | XChaCha20-Poly1305 encryption | Plaintext recovery, weak encryption | Paul Miller (single author) |
| `@noble/hashes` | SHA-256, HKDF, PBKDF2 | Hash collisions, weak key derivation | Paul Miller (single author) |
| `nostr-tools` | Nostr event creation, NIP compliance | Event forgery, key leakage | Community (multiple contributors) |
| `@simplewebauthn/*` | WebAuthn registration/authentication | Auth bypass, credential theft | Matthew Miller (primary) |

### Attack Vectors

**Build-Time Attacks:**
- Malicious `postinstall` script in a dependency exfiltrates environment variables (including secrets) during `bun install`
- Compromised build tool modifies output bundles to include key exfiltration code
- Typosquatting (e.g., `@noble/curve` instead of `@noble/curves`) — developer installs wrong package

**Runtime Attacks:**
- Compromised crypto library weakens encryption (e.g., uses predictable nonces, leaks key bits in ciphertext)
- Compromised library exfiltrates keys to an attacker-controlled endpoint
- Prototype pollution in a transitive dependency modifies crypto behavior

**Registry/Infrastructure Attacks:**
- npm account takeover of a package maintainer
- npm registry compromise serving modified packages
- GitHub Actions supply chain (compromised action exfiltrates secrets)

### Current Mitigations

| Mitigation | Status | Protection |
|-----------|--------|------------|
| `bun audit` in CI pipeline | Active (Epic 65, M-8) | Detects known vulnerabilities in dependencies |
| `bun.lockb` lockfile | Active | Frozen installs ensure reproducible builds; prevents silent dependency changes |
| SRI hashes for cached assets | Active (Epic 67, L-10) | Detects tampering of served assets in transit |
| SHA-pinned GitHub Actions | Active | Prevents compromised Action versions from running in CI |
| `--ignore-scripts` default in Bun | Active | Bun does not run postinstall scripts by default, blocking the most common supply chain attack vector |

### Recommended Additional Mitigations

**1. Pin Critical Crypto Dependencies to Exact Versions + Integrity Hash**

In `package.json`, pin `@noble/*` packages to exact versions (no `^` or `~` ranges). Verify that `bun.lockb` includes integrity hashes for these packages. On every update, manually review the diff of the new version.

**2. Manual Review of `@noble/*` Releases Before Updating**

The `@noble/*` libraries are written by a single author (Paul Miller) and have been independently audited. This is both a strength (small, auditable codebase, single point of accountability) and a risk (single point of compromise). Before updating any `@noble/*` package:
- Read the changelog and diff
- Verify the published package matches the GitHub repository source
- Check for unexpected new dependencies

**3. Consider Vendoring `@noble/*` Into the Repository**

Copying the `@noble/*` source code directly into the repository eliminates the npm registry as an attack vector. The vendored code can be:
- Verified against the audited release
- Diffed against future releases
- Built without any network dependency

**Trade-off**: Vendoring increases maintenance burden. The vendored code must be manually updated when security patches are released. This is recommended for production deployments where the threat model includes sophisticated supply chain attacks.

**4. Subresource Integrity for Runtime Dependencies**

SRI hashes on script tags ensure that served JavaScript matches expected content. This does not protect against build-time compromise, but prevents runtime tampering by a CDN or MITM.

### Assessment

The `@noble/*` libraries are among the most carefully audited npm packages in the ecosystem — they are used by major cryptocurrency projects with billions of dollars at stake. The single-author model means fewer attack surfaces than large, multi-contributor projects. However, this also means a single compromised npm credential or GitHub account could affect all downstream users.

For Llamenos, the npm supply chain is a **medium-severity, low-probability** risk. The existing mitigations (lockfile, audit, ignore-scripts) address the most common attack vectors. Vendoring and manual review are recommended for production deployments serving populations under active threat.

---

## Nostr Relay Trust Boundary

The Nostr relay (strfry, self-hosted) handles all real-time communication. Understanding what the relay can and cannot observe is critical for threat modeling.

### What the Relay Can Observe

| Observable | Detail | Severity |
|-----------|--------|----------|
| Event metadata | Pubkeys (pseudonymous), timestamps, event kinds | Medium |
| Connection metadata | IP addresses, connection timing, duration, subscription filters | Medium |
| Event sizes | Ciphertext length reveals approximate content size | Low |
| Event frequency | Timing correlation between events (e.g., call ring → call answered) | Medium |
| Generic tags | All events use `["t", "llamenos:event"]` — relay cannot distinguish event types | Low |

### What the Relay Cannot Observe

| Protected | Mechanism |
|-----------|-----------|
| Event content | All event content is encrypted with the hub key (XChaCha20-Poly1305 + HKDF per-event) |
| Event type | Actual event type (call:ring, presence, typing, etc.) is inside the encrypted content |
| Note/message content | Notes and messages are stored via REST API, not through the relay |
| Volunteer identity | Pubkeys are pseudonymous; relay has no mapping to real identities |

### Relay Compromise Scenarios

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Relay database dump | Ephemeral events (kind 20001) are never stored; only persistent events (encrypted) remain | Hub key rotation invalidates access to future events |
| Relay operator monitors connections | Connection metadata visible (IPs, timing) | Use Tor/VPN for relay connections in high-threat scenarios |
| Relay injects events | Clients verify server pubkey for authoritative events; hub key encryption prevents injection of readable content | NIP-42 auth restricts who can publish |
| Relay drops/delays events | Real-time degradation; REST polling fallback for state recovery | Monitor relay health; self-host for maximum control |

---

## Audit Log Tamper Detection

Audit logs (Epic 77) use a hash-chained integrity mechanism to detect tampering.

### Hash Chain Design

Each audit log entry includes:

- `entryHash`: `SHA-256(action + actorPubkey + timestamp + details + previousEntryHash)`
- `previousEntryHash`: The `entryHash` of the preceding entry (empty string for the first entry)

This creates a tamper-evident chain: modifying any historical entry invalidates all subsequent hashes. An admin can verify chain integrity by recomputing hashes from the first entry.

### What This Protects Against

| Threat | Protection |
|--------|-----------|
| Silent entry deletion | Missing entry breaks the hash chain |
| Entry modification | Modified content produces wrong hash; chain verification fails |
| Entry reordering | Hash depends on `previousEntryHash`; reordering breaks chain |

### What This Does NOT Protect Against

| Threat | Reason |
|--------|--------|
| Log truncation from the end | Deleting the latest N entries leaves a valid shorter chain |
| Complete log replacement | An attacker with full DB access could recompute the entire chain with fabricated entries |
| Operator collusion | The operator controls the server; they could disable audit logging entirely |

**Mitigation for advanced threats**: Periodically export and sign audit log checkpoints to an external, append-only store (e.g., signed Git commits, blockchain anchoring). This is outside the scope of Llamenos itself but recommended for high-security deployments.

---

## Admin Key Separation

Epic 76.2 introduced a separation between the admin's identity key and decryption key.

### Design

- **Identity key (nsec)**: Used for Schnorr signature authentication, signing Nostr events, and hub administration (invite/revoke)
- **Decryption key**: A separate keypair used for ECIES envelope unwrapping (legacy PII) and MLS group membership (notes, messages)

### Compromise Scenarios

| Compromised Key | Impact | What Remains Protected |
|----------------|--------|----------------------|
| Identity key only | Attacker can authenticate as admin, sign events | All encrypted content (notes, messages) remains protected — decryption key is separate |
| Decryption key only | Attacker can decrypt all admin-wrapped envelopes | Cannot authenticate or sign events; cannot impersonate admin |
| Both keys | Full admin compromise | Nothing — equivalent to pre-separation admin compromise |

### Hub Key Compromise Analysis

The hub key is a random 32-byte value (`crypto.getRandomValues(new Uint8Array(32))`) — not derived from any identity key. This means:

- Compromising any identity key does NOT reveal the hub key
- Hub key rotation generates a genuinely new random key with no mathematical link to the old one
- The hub key is distributed via HPKE (wrapped per device under `LABEL_HUB_KEY_WRAP` with `HpkeEnvelope { v: 3, labelId, enc, ct }`)
- A compromised hub key reveals only hub-encrypted Nostr event content (presence, call notifications) — NOT individual notes or messages (those use MLS group encryption)

**Rotation procedure**: See [Key Revocation Runbook, Section 4](KEY_REVOCATION_RUNBOOK.md#4-hub-key-rotation-ceremony).

---

## Reproducible Builds as Supply Chain Mitigation

Epic 79 introduced reproducible builds to allow operators and auditors to verify that deployed client code matches public source.

### Trust Model

| Verification | What It Proves | What It Does NOT Prove |
|-------------|---------------|----------------------|
| `scripts/verify-build.sh [version]` passes | The client JS/CSS bundles in a GitHub Release match what the source code produces | That the deployed server is actually serving those bundles |
| `CHECKSUMS.txt` matches | File integrity between build and release | That the release was built from unmodified source |
| SLSA provenance attestation | The build ran in a specific GitHub Actions workflow from a specific commit | That the GitHub Actions environment was not compromised |

### Trust Anchor

The trust anchor is the **GitHub Release** (not the running application). The application itself does NOT serve verification endpoints — an attacker who controls the server could serve fake checksums. Verification must be performed against the release artifacts on GitHub.

### Scope

- **Verified**: Client JavaScript and CSS bundles (deterministic output via `SOURCE_DATE_EPOCH`, content-hashed filenames)
- **NOT verified**: Server runtime (server integrity depends on operator trust and host security)

---

## Client-Side Transcription Trust Model

Transcription runs entirely in-browser via WASM (Whisper via `@huggingface/transformers`).

### Security Properties

| Property | Before (CF Workers AI) | After (Client-Side WASM) |
|----------|----------------------|--------------------------|
| Audio leaves device? | Yes — sent to CF Workers AI API | **No** — processed entirely in-browser |
| Transcription provider sees audio? | Yes — Cloudflare | **No provider involved** |
| Transcription text E2EE? | Yes (encrypted after server returns text) | Yes (encrypted immediately after local transcription) |
| Network required? | Yes (API call to CF) | **No** — works offline after model download |

### What This Means

- Audio from the volunteer's microphone is captured via `MediaRecorder`, processed in a Web Worker using Whisper WASM, and the resulting transcript text is encrypted immediately with the note's E2EE key
- No audio data ever leaves the browser — not to the server, not to any transcription provider, not to any third party
- The WASM model is downloaded once and cached locally
- **Limitation**: Only the volunteer's local microphone audio is transcribed. The remote party's audio is not accessible via the Twilio SDK (it requires raw WebRTC access, deferred to post-MVP)

---

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-04-13 | 2.3 | Tier 2 promoted to preferred production default | Moved the preferred production recommendation from Tier 3 (single-jurisdiction cloud VPS + FDE) to Tier 2 (single-jurisdiction dedicated + self-installed FDE). The previous Tier 3 default was partly a consequence of Hetzner being wrongly on the clean list, which made Tier 3 look cheap and frictionless; with Hetzner correctly removed, the cost/complexity delta between Tier 2 and Tier 3 on the actual clean-list providers is small enough that the runtime-compulsion protection gap dominates the calculus for production deployments. Added "Tier 2 vs Tier 3 decision rule" note. Documented `platform.llamenos-hotline.com` as starting at Tier 3 on 1984 VPS with a planned Tier 2 migration. Marked Tier 2 in the deployment table as preferred production target. FlokiNET Romania dedicated with "install my own via iLO/IPMI" documented as the current best-known concrete Tier 2 path (operator sets LUKS passphrase the provider never sees). 1984 Hosting confirmed on 2026-04-13 that they will attach custom ISOs to user accounts via support ticket, making 1984 VPS the fastest Tier 3 path. |
| 2026-04-12 | 2.2 | Strict jurisdictional test | Tightened the provider disqualification test from "US-subject (headquartered)" to "any US operations including foreign-parent companies with US datacenters, US subsidiaries, US offices, or US employees." Explicitly disqualified Hetzner (Ashburn VA + Hillsboro OR datacenters), OVHcloud (Vint Hill VA + Hillsboro OR + OVHcloud US LLC subsidiary), and Alibaba Cloud (Santa Clara CA + Chinese National Intelligence Law dual exposure). Split tier 5 into 5a (foreign-parent with US operations), 5b (US headquartered), and 5c (Chinese cloud). Added the clean-list provider table (Scaleway, FlokiNET, 1984, Infomaniak, Exoscale). Added a "verify current provider status before deploying" note since provider US operations can change silently. |
| 2026-04-12 | 2.1 | Jurisdiction & deployment tiers | Added "Provider Jurisdiction and Deployment Tiers" section with 5-tier deployment table (self-hosted, non-US dedicated, non-US cloud + FDE, non-US cloud stock, US-subject disqualified); clarified FDE vs legal-protection trade-off; extended "Subpoena of Hosting Provider" with runtime-compulsion analysis and jurisdiction dependency; US-subject providers (Vultr, AWS, GCP, Azure, Linode, DO, Cloudflare paid) explicitly disqualified for the default threat model; managed instance at platform.llamenos-hotline.com documented as Tier 3 |
| 2026-04-01 | 2.0 | IdP + JWT Auth Overhaul | Added IdP trust boundary (Authentik), multi-factor KEK analysis for device seizure, JWT token threats table with rotation procedure, Authentik compromise scenarios, updated attack surface for auth facade endpoints, updated protected assets for E2EE volunteer PII / hub-key org metadata / contact directory, replaced Durable Objects with PostgreSQL throughout, updated PBAC permission references |
| 2026-02-25 | 1.3 | ZK Architecture Overhaul | Removed WebSocket references (replaced with Nostr relay); added Nostr relay trust boundary, audit log tamper detection, admin key separation, hub key compromise analysis, reproducible builds, client-side transcription trust model |
| 2026-02-25 | 1.2 | Epic 76.0 Phase 4 | Added threat model gap sections: APNs/FCM trust, Cloudflare trust boundary, admin pubkey fetch trust, departed volunteer key retirement, SMS/WhatsApp outbound limitation, npm supply chain risk |
| 2026-02-25 | 1.1 | Documentation overhaul | Added legal compulsion section; fixed phone hashing to HMAC-SHA256; fixed caller number broadcast status; added cross-references |
| 2026-02-23 | 1.0 | Security Audit R6 | Initial threat model document |
