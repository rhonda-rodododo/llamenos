# AAD Alignment & Envelope PII Migration

**Date:** 2026-04-25
**Status:** Draft — pending review
**Depends on:** Entity Crypto Engine spec (2026-04-25), HPKE Migration Notes (Tier 1)
**Blocks:** Entity Crypto Engine implementation, Tier 1 P1 completion

---

## 1. Problem

The codebase has **two distinct AAD formulas** that must be clearly delineated:

| Formula | Function | Format | Used By |
|---|---|---|---|
| **Hub-field AAD** | `hubFieldAad(recordId, fieldName)` | `llamenos:hub-field:<recordId>:<fieldName>` | AES-256-GCM hub-key encryption (T2) — role names, shift names, entity labels, non-PII field values |
| **HPKE AAD** | `buildAad(label, recordId, fieldName)` | `<label>:<recordId>:<fieldName>` | HPKE envelope encryption (T4) — hub-key distribution, file key wrapping, per-recipient PII |

Additionally, **envelope-encrypted PII** on contacts, conversations, bans, call_records, and signal-contacts currently uses **label-only AAD** (no `recordId` or `fieldName` binding). This is a known gap tracked as Tier 1 P1 in `HPKE_MIGRATION_NOTES.md`.

The Entity Crypto Engine needs all three states to converge into a clear, per-tier AAD policy.

## 2. AAD Policy Per Tier

| Tier | AAD Formula | Rationale |
|---|---|---|
| **T0 (Plaintext)** | N/A | No encryption |
| **T1 (Server-Secret)** | `CryptoService.serverEncrypt(plaintext, label)` — label-only AAD internally | Server-held secrets don't need per-record binding; the label provides domain separation. No cross-record swap risk because the server is the only reader/writer. |
| **T2 (Hub-Key)** | `hubFieldAad(recordId, fieldName)` → `llamenos:hub-field:<recordId>:<fieldName>` | Per-record, per-column binding prevents ciphertext transplant between rows or columns. Uses the fixed `LABEL_HUB_FIELD` prefix. |
| **T3 (MLS Group)** | MLS provides its own framing (epoch, group ID, sender). No external AAD needed. | MLS `encrypt()` already binds to group ID + epoch + sender + content type. Adding external AAD is not supported by the `@wireapp/core-crypto` API. |
| **T4 (HPKE Envelope)** | `buildAad(label, recordId, fieldName)` → `<label>:<recordId>:<fieldName>` | Per-domain, per-record, per-column binding. The `label` provides domain separation (different labels for file keys vs contact PII vs hub key wrap). |
| **T5 (Blind Index)** | N/A (HMAC, not AEAD) | Blind indexes use HMAC-SHA256, not authenticated encryption. Domain separation is via per-field HKDF key derivation (`LABEL_BLIND_INDEX:<fieldName>` as HKDF info). |

## 3. Envelope PII Migration (Tier 1 P1)

### 3.1 Current State

Envelope-encrypted PII fields (contact display names, full names, phones, conversation metadata, ban reasons) currently use `RecipientEnvelope` with:
- **Key wrap:** ECIES (secp256k1 ECDH + SHA-256 KDF) — legacy, pre-HPKE
- **AAD:** Label-only (`LABEL_CONTACT_SUMMARY`, `LABEL_CONTACT_PII`, etc.) — no `recordId` or `fieldName`
- **Consequence:** A ciphertext from one contact's `encryptedFullName` could be swapped to another contact's `encryptedFullName` column and would decrypt successfully (same label). This is a **ciphertext transplant vulnerability** for same-label, same-column swaps.

### 3.2 Target State

After migration:
- **Key wrap:** HPKE (`hpkeSeal` / `hpkeOpen`) with `buildAad(label, recordId, fieldName)`
- **AAD:** `<label>:<recordId>:<fieldName>` — per-record, per-column binding
- **Consequence:** Ciphertext is bound to its specific row and column. Transplant is detected at AEAD-open time.

### 3.3 Migration Strategy

Since this is **pre-production**, the migration is a **wire-format break** (same as Tier 1 HPKE):

1. **New TRUNCATE migration** — wipe all envelope-encrypted PII columns. Pre-production data is expendable.
2. **Update `decryptObjectFields` / `decryptArrayFields`** — pass `(recordId, fieldName)` to the decrypt function. Currently these functions receive only the object and the reader pubkey; they need the record ID for AAD binding.
3. **Update `envelopeEncryptField`** — accept `(recordId, fieldName)` and use `buildAad(label, recordId, fieldName)` as HPKE AAD.
4. **Update all callers** — every call site that encrypts/decrypts envelope PII must pass the record ID. This is the same pattern as hub-field crypto (client pre-generates UUID for creates).
5. **CI guardrail** — add a grep check that no `envelopeEncryptField` or `decryptEnvelopeField` call passes empty AAD.

### 3.4 Affected Tables/Columns

| Table | Encrypted Columns | Current AAD | Target AAD |
|---|---|---|---|
| `contacts` | `encryptedDisplayName`, `encryptedFullName`, `encryptedPhone`, `encryptedPII` | `LABEL_CONTACT_SUMMARY` / `LABEL_CONTACT_PII` (label-only) | `buildAad(LABEL_CONTACT_SUMMARY, contactId, 'encryptedDisplayName')` etc. |
| `conversations` | `encryptedContactName`, `encryptedPhoneNumber` | `LABEL_CONVERSATION_META` (label-only) | `buildAad(LABEL_CONVERSATION_META, conversationId, 'encryptedContactName')` etc. |
| `bans` | `encryptedReason`, `encryptedNotes` | `LABEL_BAN_CONTENT` (label-only) | `buildAad(LABEL_BAN_CONTENT, banId, 'encryptedReason')` etc. |
| `call_records` | `encryptedCallerInfo` | `LABEL_CALL_META` (label-only) | `buildAad(LABEL_CALL_META, callId, 'encryptedCallerInfo')` |
| `user_sessions` | `encryptedMeta` | `LABEL_SESSION_META` (label-only) | `buildAad(LABEL_SESSION_META, sessionId, 'encryptedMeta')` |

### 3.5 Interface Changes

```typescript
// BEFORE (label-only AAD)
export async function decryptObjectFields<T>(
  obj: T,
  readerPubkey: string,
  label: CryptoLabel,
  fieldNames?: readonly string[]
): Promise<T>

// AFTER (per-record AAD)
export async function decryptObjectFields<T extends { id: string }>(
  obj: T,
  readerPubkey: string,
  label: CryptoLabel,
  fieldNames?: readonly string[]
): Promise<T>
// The function reads `obj.id` internally for AAD binding.
// For objects without an `id` field, a new overload accepts `recordId` explicitly.
```

## 4. Entity Crypto Engine Integration

The Entity Crypto Engine's `resolveFieldTier()` returns a tier, and the engine's encrypt/decrypt functions must use the **correct AAD formula for that tier**:

```typescript
// In entity-crypto-engine.ts
switch (tier.valueTier) {
  case 'hub-key':
    // Uses hubFieldAad(recordId, fieldName)
    await decryptHubField(ct, hubId, recordId, fieldName)
    break
  case 'mls-group':
    // MLS handles its own framing — no external AAD
    await mlsConversation.decrypt(fromBase64(ct))
    break
  case 'hpke-envelope':
    // Uses buildAad(label, recordId, fieldName)
    await hpkeOpen(envelope, label, recordId, fieldName)
    break
}
```

The engine does NOT need to know the AAD bytes — it delegates to the correct primitive, which computes its own AAD internally. The engine only needs to pass `(recordId, fieldName)` to both hub-field and HPKE calls.

## 5. Testing

- **Unit:** Verify AAD mismatch detection — encrypt with one `(recordId, fieldName)`, attempt decrypt with a different tuple. Must fail.
- **Integration:** Verify cross-table transplant detection — take a ciphertext from contacts and attempt to insert it into conversations. Must fail.
- **Migration:** Verify TRUNCATE migration wipes all affected columns. Verify post-migration encrypt/decrypt round-trip with per-record AAD.

## 6. Files to Modify

| File | Change |
|---|---|
| `src/client/lib/decrypt-fields.ts` | Pass `obj.id` to `decryptEnvelopeField` for AAD binding |
| `src/shared/crypto-envelopes.ts` | Update `envelopeEncryptField` to accept and use `(recordId, fieldName)` in AAD |
| `src/client/lib/crypto-worker.ts` | Update `decryptEnvelopeField` handler to use `buildAad(label, recordId, fieldName)` |
| `src/client/lib/queries/contacts.ts` | Ensure record ID flows through to decrypt calls |
| `src/client/lib/queries/conversations.ts` | Same |
| All query files with `decryptObjectFields` / `decryptArrayFields` | Same |
| `drizzle/migrations/NNNN_envelope_pii_aad_wipe.sql` | TRUNCATE affected columns |

---

*End of spec.*
