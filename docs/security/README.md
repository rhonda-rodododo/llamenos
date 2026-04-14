# Llamenos Security Documentation

**Last Updated:** 2026-04-01
**Protocol Version:** 3.0
**Audit Status:** Round 6 complete (2026-02-23)

This directory contains security documentation for Llamenos, a crisis response hotline designed to protect volunteer and caller identity against well-funded adversaries.

## Quick Links for Security Auditors

| Document | Purpose | Audience |
|----------|---------|----------|
| [Data Classification](DATA_CLASSIFICATION.md) | What data exists, where it's stored, what's encrypted | Auditors, operators, legal |
| [Threat Model](THREAT_MODEL.md) | Adversaries, attack surfaces, trust boundaries | Auditors, security engineers |
| [Protocol Specification](../protocol/llamenos-protocol.md) | Cryptographic algorithms, key management, wire formats | Auditors, cryptographers |
| [Security Audit R6](SECURITY_AUDIT_2026-02-R6.md) | Latest audit findings and remediation status | Auditors |
| [Supply Chain Security](SUPPLY_CHAIN.md) | Cosign signing, SBOM, reproducible builds, SLSA provenance, verification | Operators, auditors |
| [Deployment Hardening](DEPLOYMENT_HARDENING.md) | Infrastructure security for operators | Operators, DevOps |

## Security Architecture Summary

### Encryption Tiers

| Tier | Mechanism | Data Protected | Server Access |
|------|-----------|---------------|---------------|
| **Tier 1: E2EE Envelope** | ECIES per-recipient key wrapping | Volunteer PII (name, phone), contact directory PII | None — ciphertext only |
| **Tier 2: Hub-Key** | XChaCha20-Poly1305 with shared hub key | Role names, shift names, report types, custom fields, teams, tags | None — hub key held by members only |
| **Tier 3: Per-Artifact Forward Secrecy** | Unique random key per note/message, ECIES-wrapped per reader | Call notes, transcriptions, messages, reports | None — per-artifact ephemeral keys |
| **IdP-Encrypted** | XChaCha20-Poly1305 with HKDF-derived key | IdP nsec_secret values (one KEK factor) | Accessible only with `IDP_VALUE_ENCRYPTION_KEY` |

### End-to-End Encrypted (Zero-Knowledge)

The server **cannot read** these, even under legal compulsion:

| Data | Encryption | Forward Secrecy |
|------|-----------|-----------------|
| Call notes (text + custom fields) | XChaCha20-Poly1305 + ECIES (Tier 3) | Yes (per-note ephemeral key) |
| Call transcriptions | XChaCha20-Poly1305 + ECIES (Tier 3) | Yes (per-transcription ephemeral key) |
| Encrypted reports | XChaCha20-Poly1305 + ECIES (Tier 3) | Yes (per-report ephemeral key) |
| File attachments | XChaCha20-Poly1305 + ECIES (Tier 3) | Yes (per-file ephemeral key) |
| Volunteer name | ECIES envelope (Tier 1) | No (re-encrypted on key rotation) |
| Volunteer phone | ECIES envelope (Tier 1) | No (re-encrypted on key rotation) |
| Contact directory PII | ECIES envelope (Tier 1) | No (re-encrypted on key rotation) |
| Org metadata (role/shift/team names) | Hub-key XChaCha20 (Tier 2) | No (rotated with hub key) |
| Draft notes | XChaCha20-Poly1305 | No (deterministic key, local-only) |
| Volunteer secret keys (nsec) | Multi-factor KEK (PIN + IdP + optional PRF) | N/A (local storage only) |

### Server-Accessible Under Subpoena

If a hosting provider is legally compelled to provide data, they **can access**:

| Data | Storage | Notes |
|------|---------|-------|
| Call metadata | Plaintext | Timestamps, durations, which volunteer answered, call IDs |
| Caller phone hashes | HMAC-SHA256 | Irreversible without the HMAC secret; last 4 digits stored plaintext |
| Volunteer public keys | Plaintext | Nostr npub format; correlatable with other Nostr activity |
| Shift schedule times | Plaintext | Start/end times, days (names are hub-key encrypted) |
| Audit logs | Plaintext | IP hashes (truncated), timestamps, actions |
| SMS/WhatsApp messages | E2EE at rest | Encrypted on receipt; plaintext only in transit to/from provider (inherent channel limitation) |
| Encrypted blobs | Ciphertext | Notes, transcripts, files, volunteer PII — encrypted but present |

### Transient Access (During Processing)

| Data | Window | Mitigation |
|------|--------|------------|
| Voice call audio | Duration of call | Provider-dependent (Twilio, etc.); use self-hosted Asterisk for maximum privacy |
| Transcription audio | Recording duration | Audio never leaves device — WASM Whisper processes in-browser (Epic 78) |
| Caller phone number | Active call only | Hashed immediately; only last 4 digits retained |

## Legal Compulsion Scenarios

### Scenario 1: Hosting Provider Subpoena (VPS)

**Which court?** The answer depends entirely on whose courts have jurisdiction over the provider's parent company — not where the datacenter is. US-subject providers (AWS, GCP, Azure, Vultr, Linode, DigitalOcean, Cloudflare paid) are compelled by US legal process via the CLOUD Act regardless of datacenter location. See [THREAT_MODEL.md → Provider Jurisdiction and Deployment Tiers](THREAT_MODEL.md#provider-jurisdiction-and-deployment-tiers) for the full analysis and the recommended provider list.

**What they can provide (assuming the subpoena is honored):**
- Encrypted database blobs (useless without volunteer/admin private keys)
- Plaintext metadata (call times, durations, volunteer assignments)
- Caller phone hashes (irreversible without HMAC secret held by operator)
- Audit logs with truncated IP hashes
- Traffic metadata (request times, sizes, IP addresses)

**What they cannot provide via a data-only subpoena:**
- Note content, transcription text, report bodies (E2EE)
- Volunteer private keys (client-side only)
- Per-note encryption keys (ephemeral, never stored)
- HMAC secret (operator-controlled, not stored with provider)

**What a compelled runtime instrumentation order *could* enable** (court orders forcing the provider to inject code into the hypervisor or modify served JavaScript, possible in jurisdictions with FISA 702–style regimes):
- Anything the volunteer or admin sees in plaintext after client-side decryption
- This is why **FDE alone is not sufficient** — the encryption key lives in kernel memory once unlocked, and a compelled hypervisor-level attacker can capture it. Pairing FDE with a non-US-subject host is the intended defense.

### Scenario 2: Telephony Provider Subpoena (Twilio, etc.)

**What they can provide:**
- Call recordings (if enabled — Llamenos does NOT enable recording by default)
- Call detail records (timestamps, durations, phone numbers)
- SMS/WhatsApp message content (passes through their systems)

**What they cannot provide:**
- Call notes (never sent to telephony provider)
- Volunteer identities beyond phone numbers used for routing

### Scenario 3: Device Seizure

**Without PIN + IdP value:**
- Multi-factor KEK requires PIN + IdP value (from Authentik) + optional WebAuthn PRF
- PIN alone is insufficient — even with brute-force, the IdP factor is missing
- Admin can immediately disable the user in Authentik (prevents IdP value retrieval) and revoke all JWT tokens

**With all factors:**
- Access to that volunteer's notes only (not other volunteers')
- Per-note forward secrecy means compromising identity key doesn't reveal past notes
- JWT access tokens expire in 15 minutes; refresh tokens revocable by admin

### Scenario 4: Admin Key Compromise

**Impact:**
- Admin can decrypt all notes (admin envelope on every note)
- Admin cannot impersonate volunteers (separate keypairs)
- Historical notes remain encrypted until actively decrypted

**Mitigation:**
- Store admin nsec in hardware security module or air-gapped device
- Never use admin keypair on public Nostr relays
- Consider key rotation procedures (documented in [Deployment Hardening](DEPLOYMENT_HARDENING.md))

## Authentication Model

| Layer | Mechanism | Notes |
|-------|-----------|-------|
| **Login** | BIP-340 Schnorr signature challenge | Proves possession of nsec |
| **Session** | JWT access token (15min) + refresh token (httpOnly cookie) | Access token in `Authorization: Bearer`; refresh via `/api/auth/refresh` |
| **Key Unlock** | Multi-factor KEK: PIN + IdP value + optional WebAuthn PRF | KEK decrypts the nsec from localStorage |
| **API Authorization** | PBAC (Permission-Based Access Control) | Permissions embedded in JWT; checked by middleware |
| **Remote Revocation** | IdP disable + JWT jti revocation | Immediate lockout across all devices |

## Cryptographic Primitives

| Primitive | Library | Usage |
|-----------|---------|-------|
| secp256k1 ECDH | @noble/curves | Key agreement for ECIES |
| BIP-340 Schnorr | @noble/curves | Login authentication signatures |
| XChaCha20-Poly1305 | @noble/ciphers | Symmetric encryption (256-bit) — notes, hub key, IdP values |
| SHA-256 | @noble/hashes | HKDF, domain separation, audit log hash chain |
| PBKDF2-SHA256 | Web Crypto API | PIN key derivation (600K iterations) |
| HMAC-SHA256 | @noble/hashes | Phone/IP hashing, JWT signing |

All cryptographic code uses audited, constant-time implementations from the `@noble` family. No custom cryptographic constructions.

## Additional Security Features

| Feature | Mechanism | Status |
|---------|-----------|--------|
| Multi-factor key encryption | PIN + IdP value (Authentik) + optional WebAuthn PRF for KEK derivation | Shipped |
| JWT session management | Short-lived access tokens (15min) + revocable refresh tokens (httpOnly) | Shipped |
| IdP remote kill-switch | Disable user in Authentik = immediate lockout across all devices | Shipped |
| PBAC permission system | Colon-separated permissions (`domain:action`), role bundles, hub-scoped | Shipped |
| Real-time event encryption | Hub key (random 32 bytes) encrypts all Nostr relay events; generic tags prevent event-type analysis | Shipped |
| Hub key distribution | ECIES-wrapped individually per member; rotation excludes departed members | Shipped |
| E2EE volunteer PII | Tier 1 envelope encryption for name, phone (server stores ciphertext only) | Shipped |
| Hub-key org metadata | Tier 2 encryption for role names, shift names, report types, custom fields, teams, tags | Shipped |
| E2EE contact directory | Tier 1 envelope encryption for all contact PII (display name, legal name, phone, notes) | Shipped |
| Envelope encryption (messages) | Per-message random key, ECIES-wrapped for volunteer + each admin | Shipped |
| Hash-chained audit log | SHA-256 chain with `previousEntryHash` + `entryHash` for tamper detection | Shipped |
| Client-side transcription | WASM Whisper in-browser; audio never leaves device | Shipped |
| Reproducible builds | `SOURCE_DATE_EPOCH`, `CHECKSUMS.txt` in GitHub Releases, SLSA provenance | Shipped |
| Supply chain signing | Cosign keyless signatures, CycloneDX SBOM attestation, GPG signatures | Shipped |
| Admin key separation | Identity key (signing) separate from decryption key (envelope unwrap) | Shipped |

## What We Do NOT Claim

- **Traffic analysis resistance**: No padding, no dummy traffic. An observer can see call timing patterns.
- **Metadata confidentiality**: The server needs timestamps and routing data to function.
- **SMS/WhatsApp transport E2EE**: These channels require provider-side plaintext during transit. Messages are E2EE at rest on the server, but the provider sees plaintext.
- **Nostr relay metadata privacy**: The relay can observe event metadata (pubkeys, timestamps, sizes, frequency) — only content is encrypted.
- **Authentik compromise immunity**: If both Authentik and `IDP_VALUE_ENCRYPTION_KEY` are compromised, the IdP factor of multi-factor key encryption is defeated. PIN (and optionally WebAuthn PRF) remain as the remaining factors. Network-isolate Authentik and protect the encryption key.
- **Deletion verification**: We cannot cryptographically prove that VPS providers deleted data when requested.

## Audit History

| Date | Round | Findings | Status |
|------|-------|----------|--------|
| 2026-02-23 | R6 | 3 critical, 6 high, 10 medium, 8 low | See [audit report](SECURITY_AUDIT_2026-02-R6.md) |
| 2026-02-15 | R5 | 3 critical, 7 high, 8 medium, 4 low | Fully remediated |

## For Website Visitors

See [llamenos.org/security](https://llamenos.org/security) for a user-friendly explanation of our security model.

## Reporting Security Issues

Security vulnerabilities should be reported via email to security@llamenos.org. We follow a 90-day disclosure policy.
