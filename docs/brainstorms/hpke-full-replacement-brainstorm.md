# HPKE Full Replacement Brainstorm

**Date:** 2026-04-21
**Branch:** `docs/hpke-replacement-epic`
**Goal:** Replace ALL remaining ECIES (secp256k1 ECDH + SHA-256 + XChaCha20-Poly1305) usage with HPKE RFC 9180 (`DHKEM(X25519) + HKDF-SHA256 + AES-256-GCM`), then delete the ECIES sidecar entirely.

**Key assumption:** Pre-production. No data migration needed — TRUNCATE is acceptable.

---

## 1. Complete ECIES Call Site Inventory

### Category A: Envelope-Encrypted PII (per-recipient ECIES key wrapping)

These use the `RecipientEnvelope { pubkey, wrappedKey, ephemeralPubkey }` wire format. A random symmetric key encrypts the field (XChaCha20-Poly1305), then the key is ECIES-wrapped per recipient.

| # | Call Site | Data | Side | Key Material | Label |
|---|-----------|------|------|-------------|-------|
| A1 | `crypto-worker.ts` `envelopeEncryptField` | Generic field plaintext | Client (worker) | Ephemeral secp256k1 → recipient pubkeys | Caller-supplied |
| A2 | `crypto-worker.ts` `decryptEnvelopeField` | Unwrap field key + decrypt | Client (worker) | User's secp256k1 nsec | Caller-supplied |
| A3 | `crypto-worker.ts` `handleEncrypt` / `handleDecrypt` | Generic ECIES wrap/unwrap | Client (worker) | User's secp256k1 nsec / ephemeral | Caller-supplied |
| A4 | `crypto-worker-helpers.ts` `eciesUnwrapKey` → `decryptNote` | Note key unwrap | Client | Worker's nsec | `LABEL_NOTE_KEY` |
| A5 | `crypto-worker-helpers.ts` `eciesUnwrapKey` → `decryptMessage` | Message key unwrap | Client | Worker's nsec | `LABEL_MESSAGE` |
| A6 | `crypto-worker-helpers.ts` `eciesUnwrapKey` → `decryptBlast` | Blast key unwrap | Client | Worker's nsec | `LABEL_BLAST_CONTENT` |
| A7 | `crypto-worker-helpers.ts` `eciesUnwrapKey` → `decryptCallRecord` | Call record key unwrap | Client | Worker's nsec | `LABEL_CALL_META` |
| A8 | `crypto-envelopes.ts` `encryptNote` / `decryptNoteWithKey` | Per-note envelope | Shared (pure) | Author + admin pubkeys | `LABEL_NOTE_KEY` |
| A9 | `crypto-envelopes.ts` `encryptMessage` | Per-message envelope | Shared (pure) | Reader pubkeys | `LABEL_MESSAGE` |
| A10 | `crypto-envelopes.ts` `encryptBlastContent` / `decryptBlastContentWithKey` | Blast content envelope | Shared (pure) | Recipient pubkeys | `LABEL_BLAST_CONTENT` |
| A11 | `decrypt-fields.ts` `resolveEncryptedFields` + `decryptObjectFields` / `decryptArrayFields` | PII fields (contacts, users, bans, calls, sessions, intakes, conversations, signal-contacts) | Client | Worker's nsec | Various (`LABEL_CONTACT_SUMMARY`, `LABEL_CONTACT_PII`, `LABEL_SESSION_META`, etc.) |
| A12 | `server/lib/crypto-service.ts` `encryptAndWrap` / `decryptWithEnvelope` / `encryptForRecipients` / `decryptForRecipient` | Server-side envelope encrypt/decrypt for webhook-inbound messages, call records, transcriptions | Server | Server's derived secp256k1 key | Various |
| A13 | `server/jobs/blast-processor.ts` | Server-side blast content decrypt | Server | Server's derived secp256k1 key | `LABEL_BLAST_CONTENT` |
| A14 | `server/lib/crypto-service.ts` `unwrapHubKey` / `generateAndWrapHubKey` / `wrapHubKeyForNewMember` | Server-side hub key ECIES wrap/unwrap | Server | Server's derived secp256k1 key | `LABEL_HUB_KEY_WRAP` |

### Category B: File Encryption (ECIES key wrapping + ECDH metadata encryption)

| # | Call Site | Data | Side | Key Material | Label |
|---|-----------|------|------|-------------|-------|
| B1 | `file-crypto.ts` `encryptFile` | File key ECIES-wrapped per recipient | Client | Ephemeral secp256k1 | `LABEL_FILE_KEY` |
| B2 | `file-crypto.ts` `decryptFile` | File key unwrap via `decryptEnvelope` | Client | Worker's nsec | `LABEL_FILE_KEY` |
| B3 | `file-crypto.ts` `rewrapFileKey` | Re-wrap file key for new recipient | Client | Worker's nsec → ephemeral | `LABEL_FILE_KEY` |
| B4 | `file-crypto.ts` `encryptMetadataForPubkey` | Raw ECDH + XChaCha20 metadata encryption | Client | Ephemeral secp256k1 | `LABEL_FILE_METADATA` |
| B5 | `file-crypto.ts` `decryptFileMetadata` | Worker ECIES decrypt of metadata | Client | Worker's nsec | `LABEL_FILE_METADATA` |
| B6 | `server/lib/voicemail-storage.ts` | Voicemail file encryption with ECIES envelopes | Server | Admin pubkeys | `LABEL_VOICEMAIL_KEY` |

### Category C: Hub Key Distribution (server-side ECIES)

| # | Call Site | Data | Side | Key Material | Label |
|---|-----------|------|------|-------------|-------|
| C1 | `hub-key-cache.ts` `loadHubKeysForUser` | Hub key ECIES unwrap | Client | Worker's nsec | `LABEL_HUB_KEY_WRAP` |
| C2 | `server/routes/dev.ts` `wrapHubKeyForPubkey` | Test-only hub key ECIES wrap | Server (dev) | Ephemeral secp256k1 | `LABEL_HUB_KEY_WRAP` |

**Note:** The HPKE Migration Notes say hub-key-manager is DONE for HPKE. But `hub-key-cache.ts` line 87 still calls the ECIES `eciesUnwrapKey` helper, and `crypto-service.ts` server-side hub key operations (C14 above) still use `eciesWrapKey`/`eciesUnwrapKey`. These are separate from the client-side `hub-key-manager.ts` which was migrated.

### Category D: Device Provisioning (ECDH + XChaCha20)

| # | Call Site | Data | Side | Key Material | Label |
|---|-----------|------|------|-------------|-------|
| D1 | `crypto-worker.ts` `handleProvisionNsec` | Nsec transfer to new device | Client (worker) | User's secp256k1 + ephemeral ECDH | `LABEL_DEVICE_PROVISION` |
| D2 | `provisioning.ts` `decryptProvisionedNsec` / `encryptNsecForDevice` | ECDH-based nsec encryption between devices | Client | Ephemeral secp256k1 ECDH | HKDF-derived |
| D3 | `provisioning.ts` `computeSharedX` / `computeSASForNewDevice` / `computeSASForPrimaryDevice` | SAS verification via secp256k1 ECDH | Client | Ephemeral/primary secp256k1 | N/A (SAS) |

**Note:** HPKE Migration Notes say provisioning is DONE for HPKE. But `provisioning.ts` still has raw secp256k1 ECDH calls. Need to verify if the worker-based path (D1) supersedes these.

### Category E: Symmetric-only XChaCha20-Poly1305 (no ECIES, just raw symmetric)

These use XChaCha20-Poly1305 directly with derived keys — NOT ECIES. They need to migrate from XChaCha20 to AES-256-GCM (the HPKE AEAD), or remain as-is if they're purely symmetric.

| # | Call Site | Data | Side | Key Material | Label |
|---|-----------|------|------|-------------|-------|
| E1 | `key-store.ts` | Nsec encryption under PIN-derived KEK | Client | PBKDF2 → HKDF KEK | `LABEL_NSEC_KEK_*` |
| E2 | `crypto-worker.ts` `handleUnlock` / `handleReEncrypt` | Nsec decrypt/re-encrypt under KEK | Client (worker) | KEK from key-store | N/A |
| E3 | `crypto-worker.ts` `handleExportSession` / `handleImportSession` | Session capsule XChaCha20 | Client (worker) | Random 32-byte token | N/A |
| E4 | `backup.ts` | Backup file encryption (PIN + recovery key) | Client | PBKDF2-derived KEK | `RECOVERY_SALT` |
| E5 | `crypto-envelopes.ts` `encryptDraft` / `decryptDraft` | Local draft auto-save | Shared | HKDF-derived from nsec | `HKDF_CONTEXT_DRAFTS` |
| E6 | `crypto-envelopes.ts` `encryptExport` | JSON export encryption | Shared | HKDF-derived from nsec | `HKDF_CONTEXT_EXPORT` |
| E7 | `server/lib/hub-event-crypto.ts` | Nostr relay event encryption | Server | HKDF-derived from SERVER_NOSTR_SECRET | `LABEL_HUB_EVENT` |
| E8 | `server/lib/agent-identity.ts` | Agent nsec seal/unseal | Server | HKDF-derived from deploy secret | Domain-separated |
| E9 | `server/idp/authentik-adapter.ts` `encryptSecret` / `decryptSecret` | IdP value encryption | Server | Static server key | `IDP_VALUE_ENCRYPTION_KEY` |
| E10 | `crypto-primitives.ts` `symmetricEncrypt` / `symmetricDecrypt` | Generic symmetric primitive | Shared | Caller-supplied key | Caller-supplied AAD |

### Category F: Server-side Symmetric (uses `symmetricEncrypt`/`symmetricDecrypt` via CryptoService)

| # | Call Site | Data | Side | Key Material | Label |
|---|-----------|------|------|-------------|-------|
| F1 | `crypto-service.ts` `serverEncrypt` / `serverDecrypt` | Provider creds, IVR audio, push subs, etc. | Server | HKDF-derived from server secret | Various `LABEL_*` |

### Category G: Shared Primitive Modules (to be deleted/rewritten)

| # | Module | Exports Used By |
|---|--------|----------------|
| G1 | `crypto-primitives.ts` — `eciesWrapKey`, `eciesUnwrapKey`, `eciesUnwrapKeyWithSecret` | Categories A, B, C, A12-14 |
| G2 | `crypto-primitives.ts` — `symmetricEncrypt`, `symmetricDecrypt` | Categories E10, F1 |
| G3 | `crypto-envelopes.ts` — `encryptNote`, `encryptMessage`, `encryptBlastContent`, etc. | Category A8-10 |
| G4 | `crypto-worker.ts` — `eciesWrap`, `eciesUnwrap` functions | Worker-internal, Categories A1-3, D1 |

---

## 2. Replacement Strategy Per Category

### Categories A + B + C: ECIES → HPKE Seal/Open

**Wire format change:** `RecipientEnvelope { pubkey, wrappedKey, ephemeralPubkey }` → `HpkeRecipientEnvelope { pubkey, v: 3, labelId, enc, ct }` (uses `HpkeEnvelope` base).

**Approach:**
- Replace `eciesWrapKey(key, pubkey, label)` with `hpkeSeal(key, pubkeyHex, label, aad)` everywhere
- Replace `eciesUnwrapKey(envelope, sk, label)` with `hpkeOpen(envelope, skHex, label, aad)` everywhere
- The HPKE primitives already exist and are proven in the hub-field path
- **AAD binding**: All new HPKE envelopes MUST use `buildAad(label, recordId, fieldName)` — the old ECIES envelopes used empty AAD for key wraps (a known gap tracked as Tier 1 P1)
- **Multi-recipient**: The pattern stays the same — seal once per recipient. HPKE single-shot mode handles this naturally
- **Server-side**: `CryptoService` hub key methods switch from secp256k1 ECDH to X25519 HPKE. Server needs the X25519 private key derived from `SERVER_NOSTR_SECRET` (or a new `SERVER_HPKE_SECRET`)

**Key material change:** Identity keys move from secp256k1 (nsec) to X25519 for encryption. The secp256k1 nsec is RETAINED for Schnorr signing (audit log, Nostr events). This is already the design — the worker holds both `secretKey` (secp256k1 for signing) and `hpkePrivateKey` (X25519 CryptoKey for HPKE).

### Category D: Provisioning — X25519 ECDH

**Current:** secp256k1 ECDH + SHA-256(label || sharedX) + XChaCha20-Poly1305.
**Target:** X25519 ECDH via WebCrypto `deriveBits` (if native support available) or `@noble/curves/ed25519` X25519, + HKDF-SHA256 + AES-256-GCM. Or simply use HPKE single-shot seal/open between ephemeral X25519 keys.

**Consideration:** The SAS verification (Short Authentication String) currently derives from the secp256k1 shared secret. With X25519, the SAS derives from the X25519 shared secret instead. This is a wire-format break but pre-production so no issue.

**Simplest approach:** Use `hpkeSeal`/`hpkeOpen` with `LABEL_DEVICE_PROVISION` for the nsec transfer. SAS derived from the HPKE `enc` (encapsulated key) bytes — both sides see `enc` so SAS computation works. Or keep ECDH-based SAS with X25519 directly.

### Category E: Symmetric XChaCha20 → AES-256-GCM

These are symmetric-only (no ECIES/ECDH). The question is whether to migrate them from XChaCha20-Poly1305 to AES-256-GCM.

**Arguments for migration:**
- Consistency: one AEAD primitive in the entire codebase
- Fewer dependencies: can drop `@noble/ciphers/chacha` entirely
- AES-256-GCM has hardware acceleration (AES-NI) on all modern CPUs

**Arguments against:**
- XChaCha20 with 24-byte nonces is safer for random-nonce usage (no birthday collision concern at 2^48)
- AES-256-GCM with 12-byte nonces has a ~2^32 message limit before birthday risk
- These are low-volume uses (key store: 1 op per unlock; backup: 1 op per backup; drafts: 1 per save)
- Symmetric-only uses are not "ECIES" — they're a separate concern

**Decision: Defer E-category migration.** The epic's goal is to eliminate ECIES (secp256k1 + XChaCha20 envelope pattern). Pure symmetric XChaCha20 can be migrated separately. The only hard dependency is: after removing `@noble/ciphers/chacha` imports from the ECIES-using modules, check if any symmetric-only modules still need it. If they do, the import stays but isolated to those files.

**Revised decision:** Actually, for a clean cut, we SHOULD migrate these too. The goal is to fully remove `@noble/ciphers/chacha` as a dependency. These are all low-volume, simple conversions. The nonce-collision risk for AES-GCM doesn't apply here because:
- Key-store: 1 encryption per PIN change (nowhere near 2^32)
- Backup: 1 encryption per backup creation
- Session capsule: 1 per session export
- Drafts/exports: low volume
- Hub events: one key per hub, limited messages
- Agent identity: one seal per agent

**Final decision:** Include in the epic but as the LAST slice (cleanup). This gives maximum flexibility — if time is tight, the XChaCha20 symmetric uses can ship in a follow-up without blocking the ECIES removal.

### Category F: Server Symmetric — No Change Needed

`CryptoService.serverEncrypt`/`serverDecrypt` use `symmetricEncrypt`/`symmetricDecrypt` from `crypto-primitives.ts`. These use XChaCha20 but through the generic symmetric helpers, not ECIES. When category E migrates the symmetric helpers to AES-GCM, these come along for free.

---

## 3. Risks & Edge Cases

### Wire Format Break
- All `RecipientEnvelope` columns in the DB switch from `{ pubkey, wrappedKey, ephemeralPubkey }` to `{ pubkey, v: 3, labelId, enc, ct }`. This is a TRUNCATE migration (pre-production).
- `FileKeyEnvelope` (already uses `v: 2` with `labelId`) switches to `v: 3` HPKE format.
- The `Envelope` type (`{ v: 2, labelId, wrappedKey, ephemeralPubkey }`) becomes `HpkeEnvelope` (`{ v: 3, labelId, enc, ct }`).

### Key Type Change (secp256k1 → X25519)
- User identity keys are currently secp256k1 nsec/npub pairs. For ECIES encryption, the secp256k1 key does ECDH. For HPKE, we need X25519 keys.
- The crypto-worker already holds BOTH: `secretKey` (secp256k1 for signing) and `hpkePrivateKey` (X25519 CryptoKey for HPKE). This dual-key design was set up in Tier 1.
- The server also needs an X25519 key pair for hub key wrapping. The `HpkeService` already exists (`server/lib/hpke-service.ts`).
- **All pubkey fields in `RecipientEnvelope` and DB schemas currently store secp256k1 x-only pubkeys. These must switch to X25519 pubkeys for HPKE recipients.** This is a significant schema-level change.

### Server-Side secp256k1 Identity
- `CryptoService` derives a secp256k1 keypair from `SERVER_NOSTR_SECRET` for signing Nostr events and for ECIES hub key operations.
- Hub key operations migrate to `HpkeService` (X25519). Signing stays secp256k1.
- The server's hub-key-related endpoints that currently pass secp256k1 pubkeys must pass X25519 pubkeys.

### Multi-Recipient Patterns
- Notes: author envelope + admin envelopes. Same pattern with HPKE, just different seal function.
- Messages: reader envelopes. Same.
- Contacts: per-field envelopes (displayName, phone, fullName, pii, notes). Same.
- Files: per-recipient file key envelopes. Same.
- No special multi-recipient HPKE mode needed — single-shot per recipient is correct.

### MLS Interaction
- Notes and messages are NOW on MLS (Tier 6 PR #2 merged). The ECIES paths for notes/messages (`crypto-envelopes.ts encryptNote/encryptMessage`, `crypto-worker-helpers.ts decryptNote/decryptMessage`) are technically dead code for the MLS path.
- BUT: server-side message encryption for webhook-inbound messages (`CryptoService.encryptAndWrap`) still uses ECIES until the first client claims the message and MLS-encrypts it. This path needs to stay or be replaced with HPKE.
- Blast content is NOT on MLS — it still uses the ECIES envelope pattern.
- Voicemail notes still use per-note ECIES envelopes.

### Test Surface
- `crypto-primitives.test.ts`: Tests for `eciesWrapKey`/`eciesUnwrapKey` — rewrite to HPKE.
- `crypto.test.ts`: Tests for envelope encrypt/decrypt — rewrite to HPKE.
- `file-crypto.test.ts`: Tests for file encryption — rewrite to HPKE.
- `crypto-service.test.ts`: Server-side crypto tests — rewrite hub key tests to HPKE.
- `blast-processor.test.ts`: Blast decryption test — rewrite to HPKE.

---

## 4. Ordering & Parallelism

### Sequential Dependencies (must be in order):
1. **Types + primitives first**: `RecipientEnvelope` → `HpkeRecipientEnvelope` type change, `crypto-primitives.ts` ECIES export removal
2. **Crypto-worker sidecar**: Remove `eciesWrap`/`eciesUnwrap` from worker, migrate `envelopeEncryptField`/`decryptEnvelopeField` to HPKE
3. **Server CryptoService**: Migrate hub key operations from secp256k1 ECIES to X25519 HPKE
4. **Client call sites**: Migrate all callers of the ECIES worker helpers
5. **Cleanup**: Remove `crypto-envelopes.ts` ECIES helpers, update CI guardrails

### Parallelizable within each step:
- Client PII decrypt (`decrypt-fields.ts`) and file-crypto can be migrated in parallel
- Server-side blast processor and voicemail storage can be migrated in parallel
- Contact encryption and call record encryption can be migrated in parallel

### Estimated Complexity Per Category:
- **A (Envelope PII)**: High — touches ~30 files (types, schemas, routes, services, DB schema, client queries, components). The wire format change cascades everywhere.
- **B (File encryption)**: Medium — 3 files (`file-crypto.ts`, `file-upload.ts`, `voicemail-storage.ts`) + server routes
- **C (Hub key)**: Low — already partially done; hub-key-cache needs one-line change; server CryptoService needs ~20 lines
- **D (Provisioning)**: Medium — 2 files but complex ECDH/SAS logic to rewrite
- **E (Symmetric XChaCha20)**: Low — mechanical replacements, ~8 files
- **G (Cleanup)**: Low — delete functions, update exports, tighten CI guardrails

---

## 5. What NOT to Change

- **Schnorr signing** (`schnorr.sign` / `signAuditEntry`): secp256k1 identity stays for audit log signing and Nostr event signing. HPKE does not replace signing.
- **MLS encryption**: Notes and messages already use MLS. The HPKE migration only touches the ECIES sidecar paths (blasts, webhook-inbound messages, voicemail, PII envelopes).
- **Hub-field AES-GCM**: Already on HPKE/AES-GCM via `hub-field-crypto.ts`. No change needed.
- **HPKE primitives themselves**: `hpke-primitives.ts`, `hpke-envelope.ts`, `crypto-suite.ts` are stable and proven.
