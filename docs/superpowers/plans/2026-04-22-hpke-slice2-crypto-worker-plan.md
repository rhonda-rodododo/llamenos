# HPKE Slice 2: Crypto Worker HPKE-Only Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the ECIES `eciesWrap`/`eciesUnwrap` functions from the crypto worker, rewrite `handleEncrypt`/`handleDecrypt` to route through HPKE, rewrite `envelopeEncryptField`/`decryptEnvelopeField` to use HPKE, and update the RPC client types to match.

**Dependency:** Slice 1 (wire format types) must be merged first.

**Architecture:** The worker already holds `hpkePrivateKey` (non-extractable X25519 CryptoKey) from `unlockWithHandles`. The HPKE sidecar handlers (`handleHpkeSeal`, `handleHpkeOpen`) are fully functional. This slice replaces the legacy ECIES code paths with calls to the existing HPKE primitives, then deletes the ECIES functions.

**Key design decisions:**
1. The `encrypt`/`decrypt` RPC message types are **replaced**, not aliased — the request/response shapes change from `{ ephemeralPubkeyHex, wrappedKeyHex }` to `HpkeEnvelope`.
2. The `envelopeEncryptField` message type changes from per-recipient ECIES key-wrap to per-recipient HPKE seal.
3. The `decryptEnvelopeField` message type changes from ECIES unwrap + XChaCha20 field decrypt to HPKE open (the HPKE ciphertext IS the field ciphertext — no separate symmetric layer).
4. `@noble/ciphers/chacha` import is **not** removed in this slice — it's still used by `handleUnlock`, `handleReEncrypt`, `handleExportSession`, `handleImportSession`, `handleProvisionNsec` (symmetric and provisioning paths, migrated in Slices 5 and 7).
5. `secp256k1` import is **not** removed — still used by `handleProvisionNsec` (ECDH) and `schnorr` for signing. Provisioning migrates in Slice 5.

---

## Files to Modify

| # | File | Change Summary |
|---|------|----------------|
| 1 | `src/client/lib/crypto-worker.ts` | Delete `eciesWrap`/`eciesUnwrap`, rewrite `handleEncrypt`→HPKE seal, `handleDecrypt`→HPKE open, rewrite `envelopeEncryptField`/`decryptEnvelopeField` to HPKE, update `WorkerRequest` types |
| 2 | `src/client/lib/crypto-worker-client.ts` | Update `EncryptResult` type, `encrypt()`/`decrypt()` method signatures, `envelopeEncryptField()`/`decryptEnvelopeField()` signatures |
| 3 | `src/client/lib/crypto-worker-helpers.ts` | Rewrite `eciesUnwrapKey` → `hpkeUnwrapKey` using HPKE open, update `decryptNote`, `decryptBlastContent`, `decryptCallRecord`, `decryptTranscription` |
| 4 | `src/client/lib/crypto.test.ts` | Rewrite ECIES round-trip tests to HPKE round-trip tests |
| 5 | `src/client/lib/hub-key-cache.ts` | *(Cross-slice: also touched by Slice 6)* — Remove `@ts-expect-error` from Slice 1, update to use HPKE envelope shape for hub key unwrap |

**Note on Slice 5 overlap:** `crypto-worker.ts` `handleProvisionNsec` uses `secp256k1.getSharedSecret` and `xchacha20poly1305`. This function is **not** modified in Slice 2 — it stays as-is until Slice 5 (provisioning migration).

---

## Task 1: Rewrite Worker Request/Response Types

**File:** `src/client/lib/crypto-worker.ts` lines 52-102

- [ ] **Step 1: Replace `encrypt` request type**

The current `encrypt` request sends `{ plaintextHex, recipientPubkeyHex, label, aadHex }` and returns `{ ephemeralPubkeyHex, wrappedKeyHex }`. Replace with HPKE-style:

```typescript
| {
    // HPKE seal for a single recipient — replaces the legacy ECIES wrap.
    // Returns an HpkeEnvelope { v: 3, labelId, enc, ct }.
    type: 'encrypt'
    id: string
    plaintext: string               // UTF-8 string (was plaintextHex)
    recipientPublicKeyRaw: Uint8Array // raw 32-byte X25519 pubkey (was recipientPubkeyHex)
    label: CryptoLabel
    recordId: string
    fieldName: string
  }
```

- [ ] **Step 2: Replace `decrypt` request type**

The current `decrypt` request sends `{ ephemeralPubkeyHex, wrappedKeyHex, label, aadHex }` and returns a hex string. Replace with HPKE-style:

```typescript
| {
    // HPKE open for the worker's own private key — replaces legacy ECIES unwrap.
    // Returns the decrypted plaintext as a UTF-8 string.
    type: 'decrypt'
    id: string
    envelope: HpkeEnvelope
    expectedLabel: CryptoLabel
    recordId: string
    fieldName: string
  }
```

- [ ] **Step 3: Replace `envelopeEncryptField` request type**

The current request generates a random XChaCha20 key, encrypts the plaintext, then ECIES-wraps the key per recipient. With HPKE, each recipient gets a direct HPKE seal of the plaintext (no intermediate symmetric key):

```typescript
| {
    // HPKE multi-recipient seal. Each recipient gets an independent
    // HpkeEnvelope of the same plaintext.
    type: 'envelopeEncryptField'
    id: string
    plaintext: string
    recipientPublicKeysRaw: Array<{ pubkeyHex: string; raw: Uint8Array }>
    label: CryptoLabel
    recordId: string
    fieldName: string
  }
```

Returns: `{ envelopes: Array<{ pubkeyHex: string; envelope: HpkeEnvelope }> }`

**Design note:** The old design used a shared symmetric key + per-recipient key wrap, meaning ciphertext was stored once. The new HPKE design seals the plaintext independently per recipient, which means N ciphertexts for N recipients. For PII fields (short strings, 1-5 recipients), this is negligible. The benefit is simpler code and no intermediate symmetric key to manage.

- [ ] **Step 4: Replace `decryptEnvelopeField` request type**

The current request does ECIES unwrap + XChaCha20 field decrypt. With HPKE, this is just an HPKE open:

```typescript
| {
    // HPKE open for an envelope-encrypted field. The envelope IS the field
    // ciphertext — no separate symmetric layer.
    type: 'decryptEnvelopeField'
    id: string
    envelope: HpkeEnvelope
    expectedLabel: CryptoLabel
    recordId: string
    fieldName: string
  }
```

Returns: `string` (decrypted plaintext).

This is now identical to the `decrypt` message type. **Decision:** Merge `decryptEnvelopeField` into `decrypt`. Both are HPKE open. Keep a single `decrypt` message type.

- [ ] **Step 5: Commit type changes**

```bash
git add src/client/lib/crypto-worker.ts
git commit -m "feat(sec): replace ECIES worker request types with HPKE equivalents"
```

---

## Task 2: Delete ECIES Functions and Rewrite Handlers

**File:** `src/client/lib/crypto-worker.ts`

- [ ] **Step 1: Delete `eciesWrap` function (lines 331-363)**

Remove the entire `eciesWrap` function.

- [ ] **Step 2: Delete `eciesUnwrap` function (lines 370-392)**

Remove the entire `eciesUnwrap` function.

- [ ] **Step 3: Rewrite `handleEncrypt`**

Replace the current `handleEncrypt` (lines 454-472) that calls `eciesWrap` with an async function that calls `handleHpkeSeal`:

```typescript
async function handleEncrypt(
  plaintext: string,
  recipientPublicKeyRaw: Uint8Array,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<HpkeEnvelope> {
  // Reuse the existing HPKE seal handler
  return handleHpkeSeal(plaintext, recipientPublicKeyRaw, label, recordId, fieldName)
}
```

- [ ] **Step 4: Rewrite `handleDecrypt`**

Replace the current `handleDecrypt` (lines 437-452) that calls `eciesUnwrap` with an async function that calls `handleHpkeOpen`:

```typescript
async function handleDecrypt(
  envelope: HpkeEnvelope,
  expectedLabel: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<string> {
  return handleHpkeOpen(envelope, expectedLabel, recordId, fieldName)
}
```

- [ ] **Step 5: Rewrite `envelopeEncryptField` handler (lines 1186-1214)**

Replace the symmetric key + ECIES key-wrap pattern with per-recipient HPKE seal:

```typescript
case 'envelopeEncryptField': {
  if (!secretKey) throw new Error('Worker is locked')
  if (!checkRateLimit('encrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const envelopes = await Promise.all(
    req.recipientPublicKeysRaw.map(async ({ pubkeyHex, raw }) => {
      const envelope = await handleHpkeSeal(
        req.plaintext,
        raw,
        req.label,
        req.recordId,
        req.fieldName
      )
      return { pubkeyHex, envelope }
    })
  )
  result = { envelopes }
  break
}
```

- [ ] **Step 6: Rewrite `decryptEnvelopeField` handler (lines 1232-1259)**

Replace the ECIES unwrap + XChaCha20 decrypt with HPKE open:

```typescript
case 'decryptEnvelopeField': {
  // Now identical to 'decrypt' — both are HPKE open
  result = await handleDecrypt(req.envelope, req.expectedLabel, req.recordId, req.fieldName)
  break
}
```

- [ ] **Step 7: Update the `switch` statement for `encrypt`/`decrypt` cases**

Update the `case 'encrypt':` and `case 'decrypt':` blocks to pass the new arguments:

```typescript
case 'decrypt':
  result = await handleDecrypt(req.envelope, req.expectedLabel, req.recordId, req.fieldName)
  break
case 'encrypt':
  result = await handleEncrypt(
    req.plaintext,
    req.recipientPublicKeyRaw,
    req.label,
    req.recordId,
    req.fieldName
  )
  break
```

- [ ] **Step 8: Remove `@ts-expect-error` annotations from Slice 1**

Remove the `@ts-expect-error Slice 2` annotations that were placed in Slice 1.

- [ ] **Step 9: Verify `hpkeSeal`/`hpkeOpen` can coexist as aliases**

After this rewrite, `encrypt` and `hpkeSeal` do the same thing (both call `handleHpkeSeal`). Similarly `decrypt` and `hpkeOpen` are the same (both call `handleHpkeOpen`). **Decision:** Keep both message types for now. The `hpkeSeal`/`hpkeOpen` types are used by hub-field-crypto which has different AAD construction. Merging them is a cleanup for Slice 7.

- [ ] **Step 10: Commit**

```bash
git add src/client/lib/crypto-worker.ts
git commit -m "feat(sec): delete ECIES functions, rewrite encrypt/decrypt handlers to HPKE

eciesWrap and eciesUnwrap deleted. handleEncrypt → handleHpkeSeal,
handleDecrypt → handleHpkeOpen. envelopeEncryptField → per-recipient
HPKE seal. decryptEnvelopeField → HPKE open.

XChaCha20 still used by unlock/reEncrypt/exportSession/importSession/
provisionNsec — those migrate in Slices 5 and 7."
```

---

## Task 3: Update CryptoWorkerClient RPC Signatures

**File:** `src/client/lib/crypto-worker-client.ts`

- [ ] **Step 1: Replace `EncryptResult` type**

```typescript
// DELETE:
// interface EncryptResult {
//   ephemeralPubkeyHex: string
//   wrappedKeyHex: string
// }

// The encrypt() method now returns HpkeEnvelope directly
```

- [ ] **Step 2: Rewrite `encrypt()` method**

```typescript
async encrypt(
  plaintext: string,
  recipientPublicKeyRaw: Uint8Array,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<HpkeEnvelope> {
  return this.call<HpkeEnvelope>({
    type: 'encrypt',
    plaintext,
    recipientPublicKeyRaw,
    label,
    recordId,
    fieldName,
  })
}
```

- [ ] **Step 3: Rewrite `decrypt()` method**

```typescript
async decrypt(
  envelope: HpkeEnvelope,
  expectedLabel: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<string> {
  return this.call<string>({
    type: 'decrypt',
    envelope,
    expectedLabel,
    recordId,
    fieldName,
  })
}
```

- [ ] **Step 4: Rewrite `envelopeEncryptField()` method**

```typescript
async envelopeEncryptField(
  plaintext: string,
  recipientPublicKeysRaw: Array<{ pubkeyHex: string; raw: Uint8Array }>,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<{
  envelopes: Array<{ pubkeyHex: string; envelope: HpkeEnvelope }>
}> {
  return this.call<{
    envelopes: Array<{ pubkeyHex: string; envelope: HpkeEnvelope }>
  }>({
    type: 'envelopeEncryptField',
    plaintext,
    recipientPublicKeysRaw,
    label,
    recordId,
    fieldName,
  })
}
```

- [ ] **Step 5: Rewrite `decryptEnvelopeField()` method**

```typescript
async decryptEnvelopeField(
  envelope: HpkeEnvelope,
  expectedLabel: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<string> {
  return this.call<string>({
    type: 'decryptEnvelopeField',
    envelope,
    expectedLabel,
    recordId,
    fieldName,
  })
}
```

- [ ] **Step 6: Update imports**

Add `import type { HpkeEnvelope } from '@shared/hpke-envelope'` (already present). Remove `bytesToHex` import if no longer used by any remaining method signatures.

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/crypto-worker-client.ts
git commit -m "feat(sec): update CryptoWorkerClient RPC types for HPKE

encrypt() returns HpkeEnvelope instead of { ephemeralPubkeyHex, wrappedKeyHex }.
decrypt() takes HpkeEnvelope instead of (ephemeralPubkeyHex, wrappedKeyHex).
envelopeEncryptField/decryptEnvelopeField updated to HPKE shapes."
```

---

## Task 4: Rewrite crypto-worker-helpers.ts

**File:** `src/client/lib/crypto-worker-helpers.ts`

- [ ] **Step 1: Replace `eciesUnwrapKey` with `hpkeUnwrapKey`**

```typescript
import type { HpkeEnvelope } from '@shared/hpke-envelope'

/**
 * Unwrap a value from an HPKE envelope via the crypto worker.
 * The secret key never touches the main thread.
 */
export async function hpkeUnwrapKey(
  envelope: HpkeEnvelope,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<string> {
  return cryptoWorker.decrypt(envelope, label, recordId, fieldName)
}
```

The old `eciesUnwrapKey` returned raw bytes (`Uint8Array`). The new `hpkeUnwrapKey` returns a UTF-8 string (matching `hpkeOpen`'s return type). Callers that need bytes will use `hexToBytes` or `new TextEncoder().encode()`.

- [ ] **Step 2: Rewrite `decryptNote`**

Notes are now MLS-encrypted (Tier 6), so the ECIES note decryption path is legacy-only. **Decision:** If any remaining callers still use this function (check grep), rewrite to HPKE open. If no callers remain, delete the function.

Check: `grep -r 'decryptNote' src/client/ --include='*.ts' | grep -v test | grep -v helpers`

If callers exist, rewrite:
```typescript
export async function decryptNote(
  encryptedContent: string,
  envelope: HpkeEnvelope,
  recordId: string
): Promise<NotePayload | null> {
  try {
    const plaintext = await hpkeUnwrapKey(envelope, LABEL_NOTE_KEY, recordId, 'content')
    // ... parse JSON ...
  } catch { return null }
}
```

- [ ] **Step 3: Rewrite `decryptBlastContent`**

```typescript
export async function decryptBlastContent(
  encryptedContent: string,
  contentEnvelopes: Array<{ pubkey: string } & HpkeEnvelope>,
  readerPubkey: string,
  blastId: string
): Promise<BlastContent | null> {
  try {
    const envelope = contentEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null
    // The HPKE envelope IS the encrypted blast key. Open it.
    const plaintext = await cryptoWorker.decrypt(
      envelope, LABEL_BLAST_CONTENT, blastId, 'content'
    )
    return JSON.parse(plaintext) as BlastContent
  } catch { return null }
}
```

**Design change:** The old blast encryption had a two-layer design: ECIES-wrap a blast key, then XChaCha20-encrypt the content with that key. With HPKE, the content is sealed directly per recipient. This eliminates the shared `encryptedContent` hex blob — each recipient's `HpkeEnvelope.ct` contains the encrypted content.

This is a cross-slice consideration: the **server-side** blast encryption path (Slice 3, `crypto-envelopes.ts`) must produce the same structure. Both slices must agree on whether blasts use shared-ciphertext + per-recipient key-wrap, or per-recipient direct seal. **Decision:** Switch to per-recipient direct seal for blasts too. The blast content is typically short text (< 1KB), and recipient count per blast is small (admins only need to read, not all subscribers). The subscriber delivery path reads plaintext from the decrypted blast, not from individual envelopes.

- [ ] **Step 4: Rewrite `decryptCallRecord`**

```typescript
export async function decryptCallRecord(
  adminEnvelopes: Array<{ pubkey: string } & HpkeEnvelope>,
  readerPubkey: string,
  callId: string
): Promise<{ answeredBy: string | null; callerNumber: string } | null> {
  try {
    const envelope = adminEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null
    const plaintext = await cryptoWorker.decrypt(
      envelope, LABEL_CALL_META, callId, 'metadata'
    )
    return JSON.parse(plaintext)
  } catch { return null }
}
```

- [ ] **Step 5: Rewrite `decryptTranscription`**

```typescript
export async function decryptTranscription(
  envelope: HpkeEnvelope,
  callId: string
): Promise<string | null> {
  try {
    return await cryptoWorker.decrypt(
      envelope, LABEL_TRANSCRIPTION, callId, 'transcript'
    )
  } catch { return null }
}
```

- [ ] **Step 6: Remove `@noble/ciphers/chacha` and `@noble/ciphers/utils` imports**

The helpers file currently imports `xchacha20poly1305` and `utf8ToBytes` from `@noble/ciphers/*`. After rewriting, these should no longer be needed (all symmetric crypto is inside the HPKE envelope). Remove them.

- [ ] **Step 7: Remove `@ts-expect-error` annotations from Slice 1**

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/crypto-worker-helpers.ts
git commit -m "feat(sec): rewrite crypto-worker-helpers from ECIES to HPKE

eciesUnwrapKey → hpkeUnwrapKey (HPKE open via worker).
decryptNote, decryptBlastContent, decryptCallRecord, decryptTranscription
all rewritten to use HPKE open. XChaCha20 symmetric layer removed —
HPKE envelope IS the ciphertext."
```

---

## Task 5: Update hub-key-cache.ts

**File:** `src/client/lib/hub-key-cache.ts`

- [ ] **Step 1: Replace ECIES unwrap with HPKE open**

The current code (line 83-87) constructs a `KeyEnvelope` from `raw.wrappedKey`/`raw.ephemeralPubkey` and calls `eciesUnwrapKey`. Replace with HPKE:

```typescript
import type { HpkeEnvelope } from '@shared/hpke-envelope'

// In loadHubKeysForUser:
const raw = await getMyHubKeyEnvelope(hubId)
if (!raw) return
// The server now returns an HpkeEnvelope shape
const envelope = raw as HpkeEnvelope
const serverPubkeyHex = /* get from hub membership or envelope metadata */
const plaintextHex = await cryptoWorker.decrypt(
  envelope, LABEL_HUB_KEY_WRAP, serverPubkeyHex, 'hub-key-wrap'
)
const hubKeyBytes = hexToBytes(plaintextHex)
```

**Cross-slice note:** This file is also listed in Slice 6 scope. **If Slice 2 handles the hub-key-cache ECIES → HPKE conversion here, Slice 6 should skip this file.** The Slice 6 plan should focus on server-side hub key endpoints and `hubs.ts`/`setup.ts`/`invites.ts` routes instead.

- [ ] **Step 2: Remove `KeyEnvelope` import from `@shared/crypto-primitives`**

Replace with `HpkeEnvelope` import from `@shared/hpke-envelope`.

- [ ] **Step 3: Remove `eciesUnwrapKey` import from `./crypto-worker-helpers`**

Replace with direct `cryptoWorker.decrypt()` call, or import the new `hpkeUnwrapKey` helper.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/hub-key-cache.ts
git commit -m "feat(sec): hub-key-cache ECIES → HPKE unwrap

Uses HPKE open via crypto worker instead of eciesUnwrapKey.
Removes KeyEnvelope type dependency on crypto-primitives."
```

---

## Task 6: Update Tests

**File:** `src/client/lib/crypto.test.ts`

- [ ] **Step 1: Identify ECIES round-trip tests**

Check what the test file contains and which tests use ECIES functions.

- [ ] **Step 2: Rewrite to HPKE round-trip tests**

Replace `eciesWrapKey`/`eciesUnwrapKey` test patterns with `hpkeSeal`/`hpkeOpen` round-trip tests that exercise the worker's HPKE handlers.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/crypto.test.ts
git commit -m "test(sec): rewrite crypto worker tests from ECIES to HPKE round-trips"
```

---

## Task 7: Update Callers of crypto-worker-client

After changing the `encrypt()`/`decrypt()`/`envelopeEncryptField()`/`decryptEnvelopeField()` signatures, all callers must be updated.

- [ ] **Step 1: Find all callers**

```bash
grep -rn 'cryptoWorker\.encrypt\|cryptoWorker\.decrypt\|cryptoWorker\.envelopeEncryptField\|cryptoWorker\.decryptEnvelopeField' src/client/ --include='*.ts' | grep -v test | grep -v crypto-worker
```

Expected callers:
- `src/client/lib/decrypt-fields.ts` — calls `decryptEnvelopeField`
- `src/client/lib/crypto-worker-helpers.ts` — calls `decrypt` (already handled in Task 4)
- Various query files that call helpers

- [ ] **Step 2: Update `decrypt-fields.ts`**

`decryptObjectFields`/`decryptArrayFields` currently pass `(encryptedHex, ephemeralPubkeyHex, wrappedKeyHex, label, aad)` to `decryptEnvelopeField`. Update to pass `(envelope, label, recordId, fieldName)`.

- [ ] **Step 3: Update any remaining callers**

Follow the grep results and update each caller to use the new HPKE-shaped arguments.

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

All errors from changed signatures must be fixed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sec): update all crypto worker callers for HPKE signatures"
```

---

## Task 8: Verification

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run build**

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 3: Run unit tests**

```bash
bun run test:unit
```

Expected: PASS (crypto worker tests rewritten in Task 6).

- [ ] **Step 4: Verify no remaining ECIES usage in worker files**

```bash
grep -n 'eciesWrap\|eciesUnwrap\|ephemeralPubkeyHex\|wrappedKeyHex' src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker-helpers.ts
```

Expected: Zero matches (except possibly `handleProvisionNsec` which still uses secp256k1 ECDH — not ECIES envelope functions, but raw ECDH, which is Slice 5).

- [ ] **Step 5: Verify `@ts-expect-error Slice 2` annotations are gone**

```bash
grep -rn '@ts-expect-error.*Slice 2' src/
```

Expected: Zero matches.

- [ ] **Step 6: Run E2E tests**

```bash
bun run test:api
bun run test:e2e
```

Expected: PASS — but many tests may not exercise the HPKE path yet (they use mock/synthetic crypto). At minimum, no regressions.

---

## Appendix A: ECIES Functions Removed in This Slice

| Function | Location | Replacement |
|----------|----------|-------------|
| `eciesWrap()` | `crypto-worker.ts:331-363` | `handleHpkeSeal()` (already exists) |
| `eciesUnwrap()` | `crypto-worker.ts:370-392` | `handleHpkeOpen()` (already exists) |
| `handleEncrypt()` (old) | `crypto-worker.ts:454-472` | Delegates to `handleHpkeSeal()` |
| `handleDecrypt()` (old) | `crypto-worker.ts:437-452` | Delegates to `handleHpkeOpen()` |
| `eciesUnwrapKey()` | `crypto-worker-helpers.ts:28-44` | `hpkeUnwrapKey()` using `cryptoWorker.decrypt()` |

## Appendix B: ECIES Functions NOT Removed (Stay Until Later Slices)

| Function/Import | Location | Reason | Migrated In |
|-----------------|----------|--------|-------------|
| `xchacha20poly1305` | `crypto-worker.ts:31` | Used by `handleUnlock`, `handleReEncrypt`, `handleExportSession`, `handleImportSession`, `handleProvisionNsec`, `envelopeEncryptField` (outer AEAD) | Slice 7 |
| `secp256k1` | `crypto-worker.ts:33` | Used by `handleProvisionNsec` (raw ECDH) | Slice 5 |
| `utf8ToBytes` from `@noble/ciphers/utils` | `crypto-worker.ts:32` | Used by `handleProvisionNsec` | Slice 5/7 |

## Appendix C: RPC Message Type Transformation

### `encrypt` — Before vs After

**Before:**
```typescript
Request: { type: 'encrypt', plaintextHex: string, recipientPubkeyHex: string, label, aadHex: string }
Response: { ephemeralPubkeyHex: string, wrappedKeyHex: string }
```

**After:**
```typescript
Request: { type: 'encrypt', plaintext: string, recipientPublicKeyRaw: Uint8Array, label, recordId: string, fieldName: string }
Response: HpkeEnvelope
```

### `decrypt` — Before vs After

**Before:**
```typescript
Request: { type: 'decrypt', ephemeralPubkeyHex: string, wrappedKeyHex: string, label, aadHex: string }
Response: string (hex-encoded decrypted bytes)
```

**After:**
```typescript
Request: { type: 'decrypt', envelope: HpkeEnvelope, expectedLabel, recordId: string, fieldName: string }
Response: string (UTF-8 plaintext)
```

### `envelopeEncryptField` — Before vs After

**Before:**
```typescript
Request: { plaintext: string, recipientPubkeysHex: string[], label, aadHex: string }
Response: { encryptedHex: string, envelopes: [{ recipientPubkey, ephemeralPubkeyHex, wrappedKeyHex }] }
```

**After:**
```typescript
Request: { plaintext: string, recipientPublicKeysRaw: [{ pubkeyHex, raw }], label, recordId, fieldName }
Response: { envelopes: [{ pubkeyHex: string, envelope: HpkeEnvelope }] }
```

### `decryptEnvelopeField` — Before vs After

**Before:**
```typescript
Request: { encryptedHex, ephemeralPubkeyHex, wrappedKeyHex, label, aadHex }
Response: string (plaintext)
```

**After:**
```typescript
Request: { envelope: HpkeEnvelope, expectedLabel, recordId, fieldName }
Response: string (plaintext)
```
