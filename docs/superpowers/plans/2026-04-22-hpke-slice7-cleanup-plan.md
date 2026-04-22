# HPKE Slice 7: Symmetric XChaCha20 → AES-256-GCM + Full ECIES Cleanup

**Epic:** `docs/epics/hpke-full-replacement-epic.md`  
**Planned Date:** 2026-04-22  
**Status:** Research & Planning Complete — Ready for Implementation  
**Est. Files:** ~25 source + ~15 test + 1 migration + 1 CI update  

---

## 1. Goal

Migrate every remaining symmetric XChaCha20-Poly1305 use to WebCrypto AES-256-GCM, delete ALL ECIES code (secp256k1 ECDH + SHA-256 + XChaCha20 key wrapping), tighten CI guardrails to hard-block any ECIES usage, and remove the `@noble/ciphers` package entirely.

This is the **final slice** of the HPKE epic. All previous slices (1–6) must have landed before this work begins.

---

## 2. Pre-Production Assumption

TRUNCATE migration — no backwards compatibility, no data migration. All encrypted data is wiped and re-seeded.

---

## 3. XChaCha20 → AES-256-GCM Migration

### 3.1 Core Primitive Replacement

**File:** `src/shared/crypto-primitives.ts`

| Function | Current | Target |
|----------|---------|--------|
| `symmetricEncrypt` | XChaCha20-Poly1305, 24-byte nonce | AES-256-GCM via `crypto.subtle.encrypt`, 12-byte nonce |
| `symmetricDecrypt` | XChaCha20-Poly1305, 24-byte nonce | AES-256-GCM via `crypto.subtle.decrypt`, 12-byte nonce |

**Wire format change:**
- Old: `hex(nonce[24] \|\| ciphertext)` — ciphertext includes Poly1305 tag inline
- New: `hex(nonce[12] \|\| ciphertext[+tag16])` — AES-GCM tag is appended by WebCrypto

**Key design:** `symmetricEncrypt`/`symmetricDecrypt` are called from BOTH server (Bun) and client (browser + Web Worker). Both runtimes support `crypto.subtle`. The functions must become `async` because WebCrypto is Promise-based. Every caller must be updated to `await`.

**Cascading async conversion:**
- `CryptoService.serverEncrypt` → async
- `CryptoService.serverDecrypt` → async
- `CryptoService.hubEncryptField` → async
- `CryptoService.hubDecryptField` → async
- `CryptoService.hubEncryptPrimitive` → async
- `CryptoService.hubDecryptPrimitive` → async
- `CryptoService.envelopeEncrypt` → async
- `CryptoService.envelopeDecrypt` → async
- `CryptoService.envelopeEncryptBinary` → async
- `CryptoService.envelopeDecryptBinary` → async
- `hub-field-crypto.ts` already async — no change needed

### 3.2 Client-Side XChaCha20 Call Sites

**File:** `src/client/lib/key-store.ts`
- `encryptNsec()` — replace `xchacha20poly1305(kek, nonce)` with AES-256-GCM via `crypto.subtle.encrypt`
- `decryptNsec()` — replace with `crypto.subtle.decrypt`
- Update `EncryptedKeyData.cipher` from `'xchacha20-poly1305'` to `'aes-256-gcm'`
- Update `EncryptedKeyData.nonce` doc from 24 bytes to 12 bytes

**File:** `src/client/lib/crypto-worker.ts`
- `handleUnlock()` — decrypt nsec blob with AES-256-GCM
- `handleReEncrypt()` — re-encrypt nsec with AES-256-GCM
- `handleExportSession()` — encrypt nsec + KEK with AES-256-GCM
- `handleImportSession()` — decrypt with AES-256-GCM
- `handleProvisionNsec()` — encrypt nsec with AES-256-GCM (provisioning uses ECDH-derived key + symmetric AEAD)
- `envelopeEncryptField` handler — outer field AEAD: replace `xchacha20poly1305(messageKey, fieldNonce, aad)` with AES-256-GCM
- `decryptEnvelopeField` handler — outer field AEAD: same replacement
- Delete `eciesWrap()` and `eciesUnwrap()` helper functions entirely
- Delete `handleEncrypt()` and `handleDecrypt()` handlers entirely (ECIES key wrap/unwrap)

**File:** `src/client/lib/backup.ts`
- `encrypt()` — AES-256-GCM
- `decrypt()` — AES-256-GCM
- Nonce changes from 24 to 12 bytes

**File:** `src/client/lib/crypto-worker-helpers.ts`
- `decryptNote()` — outer symmetric decrypt: XChaCha20 → AES-256-GCM
- `decryptBlastContent()` — outer symmetric decrypt: XChaCha20 → AES-256-GCM
- `decryptCallRecord()` — outer symmetric decrypt: XChaCha20 → AES-256-GCM
- Delete `eciesUnwrapKey()` — no longer needed (ECIES deleted)
- Delete `decryptTranscription()` — ECIES-based, replaced by HPKE/MLS

**File:** `src/client/lib/provisioning.ts`
- `decryptProvisionedNsec()` — replace XChaCha20 with AES-256-GCM
- `encryptNsecForDevice()` — replace XChaCha20 with AES-256-GCM
- Nonce changes from 24 to 12 bytes
- Keep `secp256k1.getSharedSecret` here ONLY for provisioning ECDH (this is the SAS + key agreement path, NOT ECIES key wrapping). Per the epic, provisioning ECDH stays but the symmetric layer becomes AES-GCM.

**File:** `src/client/lib/file-crypto.ts`
- `encryptMetadataForPubkey()` — replace XChaCha20 with AES-256-GCM for metadata encryption
- `encryptFile()` already uses `symmetricEncrypt` from crypto-primitives — will inherit the AES-GCM change automatically once `symmetricEncrypt` is updated
- `decryptFile()` already uses `symmetricDecrypt` — inherits change automatically

**File:** `src/shared/crypto-envelopes.ts`
- `encryptBlastContent()` — outer symmetric: XChaCha20 → AES-256-GCM. Keep the ECIES key wrap deletion for later (blast content envelope migration is part of ECIES cleanup, Section 4).
- `decryptBlastContentWithKey()` — outer symmetric: XChaCha20 → AES-256-GCM
- `encryptDraft()` — XChaCha20 → AES-256-GCM
- `decryptDraft()` — XChaCha20 → AES-256-GCM
- `encryptExport()` — XChaCha20 → AES-256-GCM

### 3.3 Server-Side XChaCha20 Call Sites

**File:** `src/server/lib/hub-event-crypto.ts`
- `encryptHubEvent()` — XChaCha20 → AES-256-GCM
- `decryptHubEvent()` — XChaCha20 → AES-256-GCM
- Nonce changes from 24 to 12 bytes

**File:** `src/server/lib/agent-identity.ts`
- `generateAgentKeypair()` — seal nsec with AES-256-GCM
- `unsealAgentNsec()` — unseal with AES-256-GCM
- Nonce changes from 24 to 12 bytes

**File:** `src/server/idp/authentik-adapter.ts`
- `encryptSecret()` — XChaCha20 → AES-256-GCM
- `decryptSecret()` — XChaCha20 → AES-256-GCM
- Format stays `"<nonce_hex>:<ciphertext_hex>"` but nonce is 12 bytes (24 hex chars) instead of 24 bytes (48 hex chars)

**File:** `src/server/routes/dev.ts`
- `wrapHubKeyForPubkey()` — this is an ECIES test helper. Delete entirely (Section 4.12).

### 3.4 WebCrypto AES-256-GCM Helper

Create a new shared helper to avoid duplicating WebCrypto boilerplate:

**File:** `src/shared/aes-gcm.ts` (NEW)

```typescript
const NONCE_LEN = 12
const TAG_LEN = 16

export async function aesGcmEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN))
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key.buffer as ArrayBuffer, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  )
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer, additionalData: aad.buffer as ArrayBuffer, tagLength: TAG_LEN * 8 },
      cryptoKey,
      plaintext.buffer as ArrayBuffer
    )
  )
  const packed = new Uint8Array(NONCE_LEN + ct.length)
  packed.set(nonce)
  packed.set(ct, NONCE_LEN)
  return bytesToHex(packed)
}

export async function aesGcmDecrypt(
  packedHex: string,
  key: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const packed = hexToBytes(packedHex)
  const nonce = packed.slice(0, NONCE_LEN)
  const ciphertext = packed.slice(NONCE_LEN)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key.buffer as ArrayBuffer, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  )
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer, additionalData: aad.buffer as ArrayBuffer, tagLength: TAG_LEN * 8 },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer
  )
  return new Uint8Array(pt)
}
```

> **Note:** Both Bun and browser support `crypto.subtle`. In Bun, `crypto` is the WebCrypto global. In the Web Worker, `crypto` is also available. No runtime branching needed.

Then update `src/shared/crypto-primitives.ts`:
- Replace `symmetricEncrypt`/`symmetricDecrypt` bodies with calls to `aesGcmEncrypt`/`aesGcmDecrypt`
- Import from `./aes-gcm`

---

## 4. ECIES Deletion

### 4.1 `src/shared/crypto-primitives.ts` — Delete ECIES exports

**Delete:**
- `eciesWrapKey()` function (lines 58–90)
- `eciesUnwrapKey()` function (lines 96–116)
- `eciesUnwrapKeyWithSecret()` function (lines 222–242)
- `KeyEnvelope` interface (lines 204–207)
- `RecipientKeyEnvelope` interface (lines 213–215)
- `decryptEnvelope()` function (lines 274–293)
- `CryptoLabelMismatchError` class (lines 254–263)
- `secp256k1` import from `@noble/curves/secp256k1.js` (line 3) — KEEP `schnorr` if still needed for signing

**Keep:**
- `symmetricEncrypt`/`symmetricDecrypt` (rewritten to AES-GCM)
- `unbiasedSixDigitCode`
- `hmacSha256`
- `hkdfDerive`
- `generateKeyPair`, `keyPairFromNsec`, `isValidNsec`

### 4.2 `src/client/lib/crypto-worker.ts` — Delete ECIES handlers

**Delete:**
- `eciesWrap()` helper (lines 331–363)
- `eciesUnwrap()` helper (lines 370–392)
- `handleEncrypt()` handler (lines 454–472)
- `handleDecrypt()` handler (lines 437–452)
- `handleProvisionNsec()` handler (lines 518–561) — the ECIES-based provisioning path
- `envelopeEncryptField` case in onmessage (lines 1186–1214)
- `decryptEnvelopeField` case in onmessage (lines 1232–1260)
- `encrypt`/`decrypt` cases in onmessage switch
- Remove `secp256k1` import (line 33) — keep `schnorr` for signing

**Keep:**
- `handleUnlock()`, `handleReEncrypt()`, `handleExportSession()`, `handleImportSession()` — rewrite to AES-GCM
- `handleSign()`, `handleSignAuditEntry()` — still need schnorr/secp256k1 signing
- All HPKE sidecar handlers (`handleHpkeSeal`, `handleHpkeOpen`, etc.)
- All MLS handlers
- All root-KEK handlers

### 4.3 `src/client/lib/crypto-worker-helpers.ts` — Delete ECIES helpers

**Delete:**
- `eciesUnwrapKey()` (lines 28–44)
- `decryptNote()` (lines 50–74) — notes are now MLS-encrypted
- `decryptBlastContent()` (lines 80–100) — blast content moves to HPKE in Slice 5/6
- `decryptCallRecord()` (lines 107–126) — call record metadata moves to HPKE
- `decryptTranscription()` (lines 132–151) — transcriptions moved to MLS/HPKE

**Result:** This file may become empty and can be deleted. Any remaining pure helpers move to `crypto-worker-client.ts` or `@shared/hpke-primitives`.

### 4.4 `src/client/lib/crypto-service.ts` — Delete ECIES usage

**File:** `src/client/lib/crypto-service.ts`

**Delete:**
- `eciesWrapKey` / `eciesUnwrapKey` imports
- All functions that use ECIES (these are client-side envelope encryption helpers)
- Replace with HPKE equivalents from `@shared/hpke-primitives`

### 4.5 `src/server/lib/crypto-service.ts` — Delete ECIES usage

**Delete:**
- `eciesWrapKey` / `eciesUnwrapKey` imports (lines 12–13)
- `secp256k1` import (line 2) — server no longer needs secp256k1 for ECIES
- `getServerPrivateKey()` method (lines 72–85) — server secp256k1 keypair was only for ECIES hub key unwrap
- `unwrapHubKey()` method (lines 220–229) — hub key unwrap moves to HPKE via `HpkeService`
- `generateAndWrapHubKey()` method (lines 241–253) — hub key wrapping moves to HPKE
- `wrapHubKeyForNewMember()` method (lines 259–270) — moves to HPKE
- `envelopeEncrypt()` / `envelopeDecrypt()` / `envelopeEncryptBinary()` / `envelopeDecryptBinary()` — replace with HPKE via `HpkeService`

**Replace with:**
- Inject `HpkeService` into `CryptoService`
- Hub key operations use `HpkeService.hpkeSeal` / `hpkeOpen` with `LABEL_HUB_KEY_WRAP`
- Envelope operations use `HpkeService` for per-recipient HPKE seal

### 4.6 `src/shared/crypto-envelopes.ts` — Delete ECIES + XChaCha20

**Delete entire file** if all callers have migrated to HPKE/MLS.

As of the audit:
- `encryptBlastContent` — uses ECIES wrap + XChaCha20. Blast content should migrate to HPKE single-shot (`hpkeSeal` per recipient).
- `decryptBlastContentWithKey` — same
- `encryptDraft` / `decryptDraft` — use HKDF-derived key + XChaCha20. Migrate to AES-256-GCM.
- `encryptExport` — same

**Decision:** Migrate `encryptDraft`/`decryptDraft`/`encryptExport` to AES-256-GCM helpers in a NEW file (e.g., `src/shared/draft-export-crypto.ts`). Migrate blast content to HPKE in `src/shared/blast-crypto.ts`. Then delete `crypto-envelopes.ts`.

### 4.7 `src/client/lib/file-crypto.ts` — Delete ECIES

**Delete:**
- `secp256k1` import
- `eciesWrapKey` import
- `encryptMetadataForPubkey()` — raw ECDH + XChaCha20 path. Replace with HPKE single-shot.
- `rewrapFileKey()` — uses `decryptEnvelope` + `eciesWrapKey`. Replace with HPKE `hpkeOpen` + `hpkeSeal`.
- `encryptFile()` — `eciesWrapKey` for recipient envelopes. Replace with `hpkeSeal`.

### 4.8 `src/client/lib/hub-key-cache.ts` — Delete ECIES unwrap

**Current:** Imports `eciesUnwrapKey` from `crypto-worker-helpers`.
**Replace:** Use HPKE `hpkeOpen` via crypto worker.

### 4.9 `src/client/lib/provisioning.ts` — Remove secp256k1 ECDH

Per the epic open question #2: provisioning SAS stays ECDH-based but switches to **X25519** (or stays with secp256k1 if X25519 provisioning keys are already wired). The symmetric layer becomes AES-GCM.

**Decision:** Keep `secp256k1.getSharedSecret` for provisioning ONLY until a separate provisioning-to-X25519 migration is planned. The ECIES _key wrapping_ functions are deleted, but the raw ECDH for provisioning is NOT ECIES — it's a different construction. The CI guardrail should allow `getSharedSecret` in `provisioning.ts` specifically.

### 4.10 `src/server/routes/dev.ts` — Delete ECIES test helper

**Delete:**
- `wrapHubKeyForPubkey()` function (lines 15–37)
- `xchacha20poly1305` import
- `secp256k1` import
- In `/test-reset` handler, replace ECIES hub key wrap with HPKE wrap via `HpkeService` or `CryptoService`

### 4.11 `src/server/jobs/blast-processor.ts` — Update blast decryption

**Current:** `_decryptBlastContent()` calls `this.crypto.envelopeDecrypt()` which uses ECIES.
**Replace:** Use HPKE open via `HpkeService` or the server-side HPKE key.

### 4.12 `src/client/lib/recovery-group-share.ts` — Check secp256k1 usage

**Current:** Uses `secp256k1.utils.randomSecretKey()` and `secp256k1.getPublicKey()` for recovery group keypairs.
**Analysis:** This is a **keypair generation** use of secp256k1, NOT ECIES. The recovery group uses secp256k1 for Nostr-compatible signing keys. Keep this.

### 4.13 Other secp256k1 usages to KEEP

The following files use `secp256k1` but NOT for ECIES — they are for Nostr identity, Schnorr signing, or pubkey validation:

- `src/server/lib/e2ee-verification.test.ts` — test pubkey generation
- `src/server/lib/agent-identity.test.ts` — `schnorr` import only
- `src/server/services/auth-events.integration.test.ts` — test key generation
- `src/server/services/audit-log-service.ts` — `schnorr` for audit signing
- `src/server/lib/voicemail-storage.test.ts` — `schnorr` import only
- `src/server/lib/agent-identity.ts` — `schnorr` for agent signing
- `src/client/lib/gossip-version.test.ts` — `schnorr` for gossip signing
- `src/server/services/push.ts` — pubkey validation comment only
- `src/server/services/identity.ts` — pubkey validation helper
- `src/server/services/records.ts` — pubkey validation helper
- `src/server/services/audit-log-service.test.ts` — `schnorr` import only
- `src/client/lib/recovery-group-share.ts` — recovery group keypair gen
- `src/client/lib/audit-chain-verifier.ts` — `schnorr` for audit chain
- `src/client/lib/user-sigchain-verifier.ts` — `schnorr` for sigchain
- `src/client/lib/gossip-version.ts` — `schnorr` for gossip signing
- `src/client/lib/audit-chain-verifier.test.ts` — `schnorr` import only
- `src/client/lib/crypto-worker-client.test.ts` — `schnorr` import only
- `src/client/lib/audit-log-client.mls.test.ts` — `schnorr` import only
- `src/client/lib/user-sigchain-verifier.test.ts` — `schnorr` import only
- `src/client/lib/audit-log-client.test.ts` — `schnorr` import only
- `src/server/routes/users.ts` — pubkey validation using `secp256k1.Point.fromHex`

**All of these KEEP their secp256k1 imports.** The CI guardrail must ONLY block `getSharedSecret` (ECDH) and `eciesWrapKey`/`eciesUnwrapKey` calls.

---

## 5. `@noble/ciphers` Removal Assessment

### 5.1 What `@noble/ciphers` provides today

| Import | Used In | Replacement |
|--------|---------|-------------|
| `xchacha20poly1305` from `chacha.js` | 14 files | WebCrypto AES-256-GCM |
| `utf8ToBytes` from `utils.js` | 26 files | `@noble/hashes/utils.js` also exports `utf8ToBytes` |

### 5.2 Consolidation path

1. Replace ALL `import { utf8ToBytes } from '@noble/ciphers/utils.js'` with `import { utf8ToBytes } from '@noble/hashes/utils.js'`
2. Delete ALL `import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'`
3. Remove `@noble/ciphers` from `package.json` dependencies
4. Run `bun install` to update lockfile

### 5.3 Files needing `utf8ToBytes` import migration

- `src/server/lib/nostr-publisher.ts`
- `src/server/lib/crypto-service.test.ts`
- `src/server/lib/hub-event-crypto.ts`
- `src/server/lib/agent-identity.ts`
- `src/server/lib/crypto-service.ts`
- `src/shared/crypto-primitives.ts`
- `src/server/idp/authentik-adapter.ts`
- `src/server/routes/dev.ts`
- `src/shared/lib/hub-field-aad.ts`
- `src/shared/crypto-primitives.test.ts`
- `src/shared/crypto-envelopes.ts`
- `src/client/lib/crypto-service.ts`
- `src/client/lib/mls/sas.ts`
- `src/client/lib/key-store.ts`
- `src/client/lib/decrypt-fields.ts`
- `src/client/lib/file-crypto.test.ts`
- `src/client/lib/signal-contact-registration.ts`
- `src/client/lib/hub-key-manager.ts`
- `src/client/lib/crypto-worker-helpers.ts`
- `src/client/lib/backup.ts`
- `src/client/lib/hub-key-manager.test.ts`
- `src/client/lib/crypto.test.ts`
- `src/client/lib/file-crypto.ts`
- `src/client/lib/crypto-worker.ts`
- `src/client/lib/provisioning.ts`
- `src/client/lib/nostr/relay.ts`

> **Verification:** After migration, `grep -r "@noble/ciphers" src/ --include="*.ts"` should return zero results.

---

## 6. Type Updates

### 6.1 `src/shared/crypto-types.ts`

- Update `Ciphertext` doc comment from "nonce(24) || XChaCha20-Poly1305 ciphertext" to "nonce(12) || AES-256-GCM ciphertext+tag"
- Update `CapsuleNonceHex` doc from "24-byte XChaCha20 nonce (48 hex chars)" to "12-byte AES-GCM nonce (24 hex chars)"
- Update `EncryptedNsecHex` doc from "XChaCha20-Poly1305" to "AES-256-GCM"

### 6.2 `src/shared/crypto-labels.ts`

- Update comments that reference "ECIES" to reference "HPKE"
- Update comments that reference "XChaCha20-Poly1305" to reference "AES-256-GCM"

---

## 7. CI Guardrail Updates

### 7.1 Current Guardrails (`.github/workflows/ci.yml`, lines 545–582)

```yaml
- name: Tier 1 — no NEW callers of legacy ECIES/XChaCha20 primitives
  env:
    TIER1_LEGACY_ALLOW: '^(src/client/lib/(crypto-worker|...|hub-key-manager)\.ts|src/shared/(crypto-envelopes|crypto-primitives|crypto-labels)\.ts|src/server/(idp/authentik-adapter|routes/dev|lib/(crypto-service|agent-identity|hub-event-crypto)|jobs/blast-processor)\.ts)$'
```

### 7.2 Target Guardrails (Post-Slice 7)

Replace the two Tier 1 guardrail steps with:

```yaml
- name: Tier 7 — zero @noble/ciphers/chacha imports
  run: |
    HITS=$(grep -rln "from '@noble/ciphers/chacha" src/ --include='*.ts' 2>/dev/null | grep -Ev '\.test\.ts$' || true)
    if [ -n "$HITS" ]; then
      echo "::error::@noble/ciphers/chacha import found — all XChaCha20 must be migrated to AES-256-GCM:"
      echo "$HITS"
      exit 1
    fi

- name: Tier 7 — zero ECIES key wrapping functions
  run: |
    HITS=$(grep -rln -e 'eciesWrapKey' -e 'eciesUnwrapKey' -e 'eciesUnwrapKeyWithSecret' src/ --include='*.ts' 2>/dev/null | grep -Ev '\.test\.ts$' || true)
    if [ -n "$HITS" ]; then
      echo "::error::ECIES key wrapping function found — use HPKE from @shared/hpke-primitives:"
      echo "$HITS"
      exit 1
    fi

- name: Tier 7 — secp256k1.getSharedSecret only in provisioning
  run: |
    HITS=$(grep -rln 'getSharedSecret' src/ --include='*.ts' 2>/dev/null | grep -Ev '\.test\.ts$' | grep -v 'provisioning\.ts' || true)
    if [ -n "$HITS" ]; then
      echo "::error::secp256k1.getSharedSecret found outside provisioning.ts — use HPKE for key agreement:"
      echo "$HITS"
      exit 1
    fi

- name: Tier 7 — no RecipientEnvelope with wrappedKey/ephemeralPubkey
  run: |
    HITS=$(grep -rln 'wrappedKey' src/ --include='*.ts' 2>/dev/null | grep -rln 'ephemeralPubkey' src/ --include='*.ts' 2>/dev/null | grep -Ev '\.test\.ts$' || true)
    if [ -n "$HITS" ]; then
      echo "::error::Legacy ECIES envelope shape found — use HpkeEnvelope { v: 3, labelId, enc, ct }:"
      echo "$HITS"
      exit 1
    fi
```

Keep the existing "HPKE opener never falls back to ECIES" guardrail.

---

## 8. TRUNCATE Migration

**File:** `drizzle/migrations/0069_hpke_slice7_truncate.sql` (NEW)

```sql
-- 0069_hpke_slice7_truncate.sql
--
-- HPKE Slice 7: XChaCha20 → AES-256-GCM + ECIES deletion.
--
-- All encrypted data is wiped because:
--   1. Wire format changed (nonce 24→12 bytes, cipher XChaCha20→AES-GCM)
--   2. ECIES envelopes deleted (KeyEnvelope/RecipientKeyEnvelope shape gone)
--   3. Pre-production — no data migration needed.
--
-- Safety rail: abort if any table has > 1000 rows.

DO $$
DECLARE
  row_count bigint;
BEGIN
  SELECT count(*) INTO row_count FROM users;
  IF row_count > 1000 THEN
    RAISE EXCEPTION 'Safety rail: users table has % rows — this migration is pre-production only', row_count;
  END IF;
END
$$;

TRUNCATE
  users,
  hub_key_envelopes,
  hub_ptk_generations,
  user_devices,
  invite_codes,
  call_records,
  notes,
  note_replies,
  conversations,
  messages,
  contacts,
  contact_relationships,
  contact_intakes,
  bans,
  blasts,
  subscribers,
  push_subscriptions,
  webauthn_credentials,
  user_sessions,
  files,
  file_chunks,
  signal_contacts,
  auth_events,
  audit_log,
  active_calls,
  call_legs
CASCADE;

UPDATE hubs SET setup_state = '{"setupCompleted":false,"completedSteps":[],"pendingChannels":[],"selectedChannels":[],"demoMode":false}'::jsonb;
```

---

## 9. Test File Updates

### 9.1 Unit tests to update

| Test File | Changes |
|-----------|---------|
| `src/shared/crypto-primitives.test.ts` | Update `symmetricEncrypt`/`symmetricDecrypt` tests for AES-GCM wire format (12-byte nonce). Delete `eciesWrapKey`/`eciesUnwrapKey` tests. Delete `decryptEnvelope` tests. |
| `src/client/lib/crypto.test.ts` | Remove all XChaCha20 test vectors. Remove ECIES test vectors. Add AES-GCM round-trip tests. |
| `src/client/lib/key-store.test.ts` | Update for AES-GCM cipher label. Update nonce length assertions (24→12 bytes). |
| `src/client/lib/backup.test.ts` | Update for AES-GCM wire format. |
| `src/client/lib/file-crypto.test.ts` | Remove XChaCha20 imports. Update test helpers for AES-GCM. Remove ECIES unwrap tests. |
| `src/client/lib/crypto-worker.test.ts` | Remove ECIES encrypt/decrypt test cases. Update session export/import for AES-GCM. Update provisioning tests for AES-GCM. |
| `src/server/lib/crypto-service.test.ts` | Remove ECIES hub key wrap/unwrap tests. Remove `eciesWrapKey` imports. Update `serverEncrypt`/`serverDecrypt` for async AES-GCM. |
| `src/server/lib/agent-identity.test.ts` | Update for AES-GCM wire format (12-byte nonce). |
| `src/server/lib/hub-event-crypto.test.ts` | Update for AES-GCM wire format. |
| `src/server/idp/authentik-adapter.test.ts` | Update secret encrypt/decrypt for AES-GCM format (nonce 12 bytes = 24 hex chars). |
| `src/client/lib/hub-key-manager.test.ts` | Remove XChaCha20 imports if any. |
| `src/client/lib/provisioning.test.ts` | Update for AES-GCM symmetric layer. |

### 9.2 Integration / API tests

- Any test that seeds encrypted data must use the new AES-GCM wire format.
- E2E tests that create blasts, notes, contacts, etc. will naturally exercise the new paths after TRUNCATE + re-seed.
- The `/test-reset` endpoint in dev.ts must re-seed with HPKE-wrapped hub keys (not ECIES).

---

## 10. Implementation Order

Recommended sequence to minimize breakage:

```
Step 1: Create src/shared/aes-gcm.ts (NEW)
Step 2: Rewrite symmetricEncrypt/symmetricDecrypt in crypto-primitives.ts
Step 3: Update all XChaCha20 call sites (Section 3.2 + 3.3) — keep ECIES imports for now
Step 4: Migrate @noble/ciphers/utils.js → @noble/hashes/utils.js everywhere
Step 5: Delete ECIES code (Section 4) — one file at a time
Step 6: Update types (crypto-types.ts, crypto-labels.ts)
Step 7: Update CI guardrails
Step 8: Write TRUNCATE migration
Step 9: Update all test files
Step 10: Delete @noble/ciphers from package.json
Step 11: Run typecheck, build, tests
```

---

## 11. Verification Checklist

- [ ] `grep -r "@noble/ciphers/chacha" src/ --include="*.ts"` returns zero results
- [ ] `grep -r "eciesWrapKey\|eciesUnwrapKey\|eciesUnwrapKeyWithSecret" src/ --include="*.ts"` returns zero results
- [ ] `grep -r "getSharedSecret" src/ --include="*.ts" | grep -v provisioning.ts | grep -v test.ts` returns zero results
- [ ] `grep -r "xchacha20poly1305" src/ --include="*.ts"` returns zero results
- [ ] `bun run typecheck` clean
- [ ] `bun run build` passes
- [ ] `bun run test:unit` passes
- [ ] `bun run test:integration` passes
- [ ] `bun run test:api` passes
- [ ] CI guardrail step passes on the PR
- [ ] `@noble/ciphers` removed from package.json and bun.lock

---

## 12. Risk Assessment

| Risk | Mitigation |
|------|------------|
| `crypto.subtle` unavailable in test environment | Bun supports WebCrypto natively. Browser tests run in Chromium which has WebCrypto. |
| Async conversion cascade | Every `symmetricEncrypt`/`symmetricDecrypt` caller becomes async. TypeScript will catch all missing `await`s. |
| Wire format incompatibility | TRUNCATE migration wipes all data — no backwards compatibility needed. |
| Provisioning SAS with secp256k1 ECDH | **Accepted risk.** Provisioning keeps secp256k1 ECDH for now (not ECIES key wrapping). A future slice can migrate provisioning to X25519 ECDH. |
| `@noble/hashes/utils.js` utf8ToBytes differs from `@noble/ciphers/utils.js` | Both are from the same `@noble` family and use identical implementations. Verified by inspection. |

---

## 13. Files Changed Summary

### New files (1)
- `src/shared/aes-gcm.ts`

### Modified source files (~16)
- `src/shared/crypto-primitives.ts`
- `src/shared/crypto-envelopes.ts` (or delete + replace)
- `src/shared/crypto-types.ts`
- `src/shared/crypto-labels.ts`
- `src/client/lib/key-store.ts`
- `src/client/lib/crypto-worker.ts`
- `src/client/lib/crypto-worker-helpers.ts`
- `src/client/lib/backup.ts`
- `src/client/lib/provisioning.ts`
- `src/client/lib/file-crypto.ts`
- `src/client/lib/hub-key-cache.ts`
- `src/client/lib/crypto-service.ts`
- `src/server/lib/crypto-service.ts`
- `src/server/lib/hub-event-crypto.ts`
- `src/server/lib/agent-identity.ts`
- `src/server/idp/authentik-adapter.ts`
- `src/server/routes/dev.ts`
- `src/server/jobs/blast-processor.ts`

### Modified test files (~12)
- `src/shared/crypto-primitives.test.ts`
- `src/client/lib/crypto.test.ts`
- `src/client/lib/key-store.test.ts`
- `src/client/lib/backup.test.ts`
- `src/client/lib/file-crypto.test.ts`
- `src/client/lib/crypto-worker.test.ts`
- `src/server/lib/crypto-service.test.ts`
- `src/server/lib/agent-identity.test.ts`
- `src/server/lib/hub-event-crypto.test.ts`
- `src/server/idp/authentik-adapter.test.ts`
- `src/client/lib/hub-key-manager.test.ts`
- `src/client/lib/provisioning.test.ts`

### Modified config files (2)
- `.github/workflows/ci.yml`
- `package.json`

### New migration (1)
- `drizzle/migrations/0069_hpke_slice7_truncate.sql`

---

## 14. Open Questions / Decisions

1. **Blast content ECIES → HPKE:** Should blast content use HPKE single-shot (`hpkeSeal` per recipient) or keep a symmetric-then-wrap pattern with AES-GCM? **Recommendation:** HPKE single-shot per recipient — simpler, no inner symmetric key.

2. **Draft/export encryption:** `encryptDraft`/`decryptDraft`/`encryptExport` use HKDF-derived keys from the user's secret key. Should they use raw WebCrypto AES-GCM or the `aesGcmEncrypt` helper? **Recommendation:** Use the `aesGcmEncrypt` helper for consistency.

3. **Server `CryptoService` async conversion:** Many server routes call `crypto.serverEncrypt()` / `serverDecrypt()` synchronously today. Making them async requires adding `await` at every call site. **Recommendation:** This is mechanical — TypeScript will guide every change.

4. **Provisioning X25519 migration:** Out of scope for Slice 7. Provisioning keeps secp256k1 ECDH + AES-GCM. Future work can migrate to X25519 ECDH.
