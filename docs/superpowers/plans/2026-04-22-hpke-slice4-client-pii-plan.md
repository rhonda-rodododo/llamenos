# HPKE Slice 4: Client PII Decryption & Encryption Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all client-side PII envelope encryption/decryption to HPKE. Remove every remaining ECIES call path in the client PII surface.

**Dependency:** Slice 1 (wire format types) must be merged first. Slice 2 added the HPKE sidecar (`hpkeSeal`/`hpkeOpen`) to the crypto worker but **did not remove the ECIES surface** (`handleEncrypt`/`handleDecrypt`/`envelopeEncryptField`/`decryptEnvelopeField`). This plan includes the remaining Slice 2 worker migration as a prerequisite task because all client PII flows go through the worker.

**Architecture:** Use the **hybrid model** — shared symmetric ciphertext (`encryptedFoo`) + per-recipient HPKE key-wrap (`fooEnvelopes`). This preserves the existing `encryptedFoo` + `fooEnvelopes` field convention, avoids DB schema changes, and matches the server-side design chosen in Slice 3.

**Key design decisions:**
1. **Worker envelope handlers** (`handleEncrypt`/`handleDecrypt`/`envelopeEncryptField`/`decryptEnvelopeField`) switch from ECIES key-wrap to HPKE key-wrap. The symmetric layer (XChaCha20-Poly1305) stays for now — Slice 7 migrates it to AES-256-GCM.
2. **`decryptEnvelopeField` API changes**: Instead of taking `(encryptedHex, ephemeralPubkeyHex, wrappedKeyHex, label, aad)`, it takes `(encryptedHex, envelope: HpkeEnvelope, label, aad)`. The envelope IS the HPKE envelope containing `enc` and `ct`.
3. **`envelopeEncryptField` API changes**: Returns `{ encryptedHex: string; envelopes: Array<{ pubkey: string } & HpkeEnvelope> }`. Each envelope contains the per-recipient HPKE-sealed key.
4. **`encrypt`/`decrypt` (single-recipient direct encryption)** switch from ECIES direct encryption to HPKE direct seal/open. These are used by `decryptTranscription`, `decryptFile` (via `decryptEnvelope`), and `signal-contact-registration`.
5. **`ClientCryptoService`** (main-thread class) is migrated to HPKE using the worker's `hpkeSeal`/`hpkeOpen` RPC methods, or deleted if no callers remain.
6. **All `@ts-expect-error Slice 2` and `@ts-expect-error Slice 3` annotations** in client PII files are removed by the migration.

---

## Files to Modify

| # | File | Change Summary |
|---|------|----------------|
| 1 | `src/client/lib/crypto-worker.ts` | Rewrite `handleEncrypt`→HPKE seal, `handleDecrypt`→HPKE open, `envelopeEncryptField`→HPKE key-wrap, `decryptEnvelopeField`→HPKE key-open. Remove `eciesWrap`/`eciesUnwrap` helpers. |
| 2 | `src/client/lib/crypto-worker-client.ts` | Retype `encrypt`/`decrypt`/`envelopeEncryptField`/`decryptEnvelopeField` to HPKE request/response shapes. |
| 3 | `src/client/lib/crypto-worker-helpers.ts` | Rewrite `eciesUnwrapKey`→`hpkeUnwrapKey`. Rewrite `decryptNote`, `decryptBlastContent`, `decryptCallRecord`, `decryptTranscription` to use HPKE. |
| 4 | `src/client/lib/decrypt-fields.ts` | Update `decryptFieldWithRecovery` to pass `HpkeEnvelope` to worker. Remove `@ts-expect-error Slice 2`. Update `EncryptedFieldRef` comments. |
| 5 | `src/client/lib/crypto-service.ts` | Rewrite `ClientCryptoService` envelope methods to HPKE. Or delete if no callers after audit. |
| 6 | `src/client/components/contacts/create-contact-dialog.tsx` | Update `envelopeEncryptField` call to new HPKE shape. |
| 7 | `src/client/components/contacts/import-contacts-dialog.tsx` | Update bulk import encryption to HPKE shape. |
| 8 | `src/client/routes/settings.tsx` | Update any `envelopeEncryptField` or `encrypt` calls to HPKE. |
| 9 | `src/client/lib/signal-contact-registration.ts` | Update `encrypt`/`decrypt` calls to HPKE. |
| 10 | `src/client/lib/queries/contacts.ts` | Update `decryptObjectFields`/`decryptArrayFields` calls (parameters may change). |
| 11 | `src/client/lib/queries/bans.ts` | Same. |
| 12 | `src/client/lib/queries/calls.ts` | Same + transcription decryption path. |
| 13 | `src/client/lib/queries/conversations.ts` | Same. |
| 14 | `src/client/lib/queries/reports.ts` | Same. |
| 15 | `src/client/lib/queries/notes.ts` | Same (note envelope path if any ECIES remnants). |
| 16 | `src/client/lib/decrypt-fields.test.ts` | Rewrite tests for HPKE envelope shape. |
| 17 | `src/client/lib/crypto-worker-helpers.test.ts` | Rewrite `eciesUnwrapKey` tests for HPKE. |
| 18 | `src/client/lib/crypto.test.ts` | Update any ECIES-based test helpers. |
| 19 | `src/client/lib/crypto-worker.ts` `handleProvisionNsec` | **NOT in this slice** — handled in Slice 5. |

---

## Cross-Slice Conflict Analysis

| File | Slices | Resolution |
|------|--------|------------|
| `src/client/lib/crypto-worker.ts` | Slice 4 (envelope handlers), Slice 5 (`handleProvisionNsec`) | **No conflict** — different handler functions. Slice 4 migrates `handleEncrypt`/`handleDecrypt`/`envelopeEncryptField`/`decryptEnvelopeField`. Slice 5 migrates `handleProvisionNsec`. |
| `src/client/lib/crypto-worker-client.ts` | Slice 4 (retype envelope methods), Slice 5 (may retype `provisionNsec`) | **No conflict** — different method signatures. Slice 4 changes `encrypt`/`decrypt`/`envelopeEncryptField`/`decryptEnvelopeField`. Slice 5 may change `provisionNsec` return shape. |
| `src/shared/crypto-primitives.ts` | Slice 4, 5, 6 (all import deprecated `eciesWrapKey`/`eciesUnwrapKey`) | **No conflict** — all slices stop importing these; the file itself is deleted in Slice 7. |
| `src/client/lib/crypto-service.ts` | Slice 4 (primary), Slice 5 (may use for file crypto) | **Slice 4 migrates first**. Slice 5 then uses the migrated `ClientCryptoService` if needed. |
| `src/client/lib/file-crypto.ts` | Slice 5 (primary) | **No conflict with Slice 4** — file crypto is not PII encryption; orthogonal paths. |

---

## Task 1: Rewrite Crypto Worker Envelope Handlers to HPKE

**File:** `src/client/lib/crypto-worker.ts`

### Step 1: Rewrite `handleEncrypt` to HPKE direct seal

The old method: `eciesWrap(plaintext, recipientPubkeyHex, label, aad)` → `{ ephemeralPubkeyHex, wrappedKeyHex }`.
The new method: HPKE seal the plaintext directly.

```typescript
async function handleEncrypt(
  plaintext: Uint8Array,
  recipientPubkeyHex: string,
  label: CryptoLabel,
  aad: Uint8Array
): Promise<HpkeEnvelope> {
  if (!secretKey) throw new Error('Worker is locked')
  if (!checkRateLimit('encrypt')) { autoLock(); throw new Error('Rate limit exceeded') }

  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
  const { hpkeSeal } = await import('@shared/hpke-primitives')
  const suite = createHpkeSuite()
  const recipientKey = asX25519(
    (await suite.kem.deserializePublicKey(hexToBytes(recipientPubkeyHex))) as CryptoKey
  )
  return hpkeSeal(plaintext, recipientKey, label, aad)
}
```

**Breaking change:** Return type changes from `{ ephemeralPubkeyHex: string; wrappedKeyHex: string }` to `HpkeEnvelope { v: 3, labelId, enc, ct }`.

### Step 2: Rewrite `handleDecrypt` to HPKE direct open

```typescript
async function handleDecrypt(
  envelope: HpkeEnvelope,
  label: CryptoLabel,
  aad: Uint8Array
): Promise<Uint8Array> {
  if (!secretKey || !hpkePrivateKey) throw new Error('Worker is locked')
  if (!checkRateLimit('decrypt')) { autoLock(); throw new Error('Rate limit exceeded') }

  const { hpkeOpen } = await import('@shared/hpke-primitives')
  return hpkeOpen(envelope, hpkePrivateKey, label, aad)
}
```

**Breaking change:** Parameters change from `(ephemeralPubkeyHex, wrappedKeyHex, label, aad)` to `(envelope: HpkeEnvelope, label, aad)`.

### Step 3: Rewrite `envelopeEncryptField` to HPKE key-wrap

The old method: generate message key → symmetric encrypt → ECIES-wrap key per recipient.
The new method: generate message key → symmetric encrypt → **HPKE-seal** key per recipient.

```typescript
case 'envelopeEncryptField': {
  const messageKey = randomBytes(32)
  const fieldNonce = randomBytes(24)
  const fieldCipher = xchacha20poly1305(messageKey, fieldNonce, hexToBytes(req.aadHex))
  const ct = fieldCipher.encrypt(utf8ToBytes(req.plaintext))
  const packed = new Uint8Array(fieldNonce.length + ct.length)
  packed.set(fieldNonce)
  packed.set(ct, fieldNonce.length)

  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
  const { hpkeSeal } = await import('@shared/hpke-primitives')
  const suite = createHpkeSuite()

  const envelopes = await Promise.all(
    req.recipientPubkeysHex.map(async (pub) => {
      const recipientKey = asX25519(
        (await suite.kem.deserializePublicKey(hexToBytes(pub))) as CryptoKey
      )
      const envelope = await hpkeSeal(messageKey, recipientKey, req.label, new Uint8Array(0))
      return { pubkey: pub, ...envelope }
    })
  )
  messageKey.fill(0)
  result = { encryptedHex: bytesToHex(packed), envelopes }
  break
}
```

**Breaking change:** `envelopes` items now contain `v`, `labelId`, `enc`, `ct` (HpkeEnvelope shape) instead of `recipientPubkey`, `ephemeralPubkeyHex`, `wrappedKeyHex`.

### Step 4: Rewrite `decryptEnvelopeField` to HPKE key-open

```typescript
case 'decryptEnvelopeField': {
  if (!secretKey || !hpkePrivateKey) throw new Error('Worker is locked')
  if (!checkRateLimit('decrypt')) { autoLock(); throw new Error('Rate limit exceeded') }

  const { hpkeOpen } = await import('@shared/hpke-primitives')
  // Step 1: HPKE-open the per-field symmetric message key.
  const messageKey = await hpkeOpen(
    req.envelope,
    hpkePrivateKey,
    req.label,
    new Uint8Array(0)
  )
  // Step 2: Symmetric decrypt the field ciphertext.
  const fieldData = hexToBytes(req.encryptedHex)
  const fieldNonce = fieldData.slice(0, 24)
  const fieldCiphertext = fieldData.slice(24)
  const fieldCipher = xchacha20poly1305(messageKey, fieldNonce, hexToBytes(req.aadHex))
  const plaintext = fieldCipher.decrypt(fieldCiphertext)
  result = new TextDecoder().decode(plaintext)
  break
}
```

**Breaking change:** Request changes from `{ encryptedHex, ephemeralPubkeyHex, wrappedKeyHex, label, aadHex }` to `{ encryptedHex, envelope: HpkeEnvelope, label, aadHex }`.

### Step 5: Delete `eciesWrap` and `eciesUnwrap` helpers

These are no longer called from anywhere in the worker after Steps 1–4. Remove them entirely.

### Step 6: Commit

```bash
git add src/client/lib/crypto-worker.ts
git commit -m "feat(sec): crypto worker envelope handlers ECIES → HPKE

handleEncrypt/handleDecrypt now use direct HPKE seal/open.
envelopeEncryptField/decryptEnvelopeField use HPKE key-wrap
instead of ECIES. Deleted eciesWrap/eciesUnwrap helpers."
```

---

## Task 2: Update Crypto Worker Client Types

**File:** `src/client/lib/crypto-worker-client.ts`

### Step 1: Retype `encrypt`/`decrypt`

```typescript
async decrypt(
  envelope: HpkeEnvelope,
  label: CryptoLabel,
  aad: Uint8Array
): Promise<string> {
  return this.call<string>({
    type: 'decrypt',
    envelope,
    label,
    aadHex: bytesToHex(aad),
  })
}

async encrypt(
  plaintextHex: string,
  recipientPubkeyHex: string,
  label: CryptoLabel,
  aad: Uint8Array
): Promise<HpkeEnvelope> {
  return this.call<HpkeEnvelope>({
    type: 'encrypt',
    plaintextHex,
    recipientPubkeyHex,
    label,
    aadHex: bytesToHex(aad),
  })
}
```

### Step 2: Retype `decryptEnvelopeField`/`envelopeEncryptField`

```typescript
async decryptEnvelopeField(
  encryptedHex: string,
  envelope: HpkeEnvelope,
  label: CryptoLabel,
  aad: Uint8Array
): Promise<string> {
  return this.call<string>({
    type: 'decryptEnvelopeField',
    encryptedHex,
    envelope,
    label,
    aadHex: bytesToHex(aad),
  })
}

async envelopeEncryptField(
  plaintext: string,
  recipientPubkeysHex: string[],
  label: CryptoLabel,
  aad: Uint8Array
): Promise<{
  encryptedHex: string
  envelopes: Array<{ pubkey: string } & HpkeEnvelope>
}> {
  return this.call<{
    encryptedHex: string
    envelopes: Array<{ pubkey: string } & HpkeEnvelope>
  }>({
    type: 'envelopeEncryptField',
    plaintext,
    recipientPubkeysHex,
    label,
    aadHex: bytesToHex(aad),
  })
}
```

### Step 3: Commit

```bash
git add src/client/lib/crypto-worker-client.ts
git commit -m "feat(sec): crypto worker client HPKE envelope types

encrypt/decrypt and envelopeEncryptField/decryptEnvelopeField
now use HpkeEnvelope shape instead of ECIES ephemeralPubkey/
wrappedKey pairs."
```

---

## Task 3: Rewrite Crypto Worker Helpers

**File:** `src/client/lib/crypto-worker-helpers.ts`

### Step 1: Replace `eciesUnwrapKey` with `hpkeUnwrapKey`

```typescript
import type { HpkeEnvelope } from '@shared/hpke-envelope'

export async function hpkeUnwrapKey(
  envelope: HpkeEnvelope,
  label: CryptoLabel
): Promise<Uint8Array> {
  const resultHex = await cryptoWorker.decrypt(envelope, label, new Uint8Array(0))
  return hexToBytes(resultHex)
}
```

### Step 2: Rewrite `decryptNote`

```typescript
export async function decryptNote(
  encryptedContent: string,
  envelope: HpkeEnvelope
): Promise<NotePayload | null> {
  try {
    const noteKey = await hpkeUnwrapKey(envelope, LABEL_NOTE_KEY)
    // ... rest unchanged (symmetric decrypt)
  } catch {
    return null
  }
}
```

### Step 3: Rewrite `decryptBlastContent`

Note: `contentEnvelopes` is now `Array<{ pubkey: string } & HpkeEnvelope>`.

```typescript
export async function decryptBlastContent(
  encryptedContent: string,
  contentEnvelopes: Array<{ pubkey: string } & HpkeEnvelope>,
  readerPubkey: string
): Promise<BlastContent | null> {
  try {
    const envelope = contentEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null
    const blastKey = await hpkeUnwrapKey(envelope, LABEL_BLAST_CONTENT)
    // ... rest unchanged
  } catch {
    return null
  }
}
```

### Step 4: Rewrite `decryptCallRecord`

Same pattern — `adminEnvelopes` now contains HPKE envelopes.

### Step 5: Rewrite `decryptTranscription`

```typescript
export async function decryptTranscription(
  packed: string,
  envelope: HpkeEnvelope
): Promise<string | null> {
  try {
    const resultHex = await cryptoWorker.decrypt(envelope, LABEL_TRANSCRIPTION, new Uint8Array(0))
    return new TextDecoder().decode(hexToBytes(resultHex))
  } catch {
    return null
  }
}
```

**Breaking change:** Parameter changes from `(packed, ephemeralPubkeyHex)` to `(packed, envelope: HpkeEnvelope)`.

### Step 6: Commit

```bash
git add src/client/lib/crypto-worker-helpers.ts
git commit -m "feat(sec): crypto worker helpers ECIES → HPKE

eciesUnwrapKey → hpkeUnwrapKey. decryptNote, decryptBlastContent,
decryptCallRecord, decryptTranscription all use HpkeEnvelope."
```

---

## Task 4: Rewrite `decrypt-fields.ts`

**File:** `src/client/lib/decrypt-fields.ts`

### Step 1: Update `decryptFieldWithRecovery`

Replace the ECIES field access with HPKE envelope passing:

```typescript
async function decryptFieldWithRecovery(
  ciphertext: string,
  envelope: RecipientEnvelope,  // Already extends HpkeEnvelope
  label: CryptoLabel,
  aadOverride?: Uint8Array
): Promise<string | null> {
  const worker = cryptoWorker
  const aad = aadOverride ?? utf8ToBytes(label)

  try {
    return await worker.decryptEnvelopeField(ciphertext, envelope, label, aad)
  } catch (firstErr) {
    // ... retry and recovery logic unchanged
    try {
      return await worker.decryptEnvelopeField(ciphertext, envelope, label, aad)
    } catch (secondErr) {
      // ... existing recovery logic unchanged
    }
  }
}
```

**Remove both `@ts-expect-error Slice 2` annotations.**

### Step 2: Update `EncryptedFieldRef` comment

```typescript
interface EncryptedFieldRef {
  plaintextKey: string
  ciphertext: string
  /** The matching HPKE envelope for the reader. */
  envelope: RecipientEnvelope
}
```

### Step 3: Commit

```bash
git add src/client/lib/decrypt-fields.ts
git commit -m "feat(sec): decrypt-fields.ts ECIES → HPKE envelope passing

decryptFieldWithRecovery passes HpkeEnvelope to worker instead of
ephemeralPubkey + wrappedKey. Removed @ts-expect-error Slice 2."
```

---

## Task 5: Migrate `ClientCryptoService`

**File:** `src/client/lib/crypto-service.ts`

### Step 1: Check if any callers exist

```bash
grep -rn 'ClientCryptoService\|new ClientCryptoService' src/client/ --include='*.ts' --include='*.tsx' | grep -v test | grep -v node_modules
```

If **zero callers**: delete the file and skip to Task 6.

If **callers exist**: rewrite to HPKE.

### Step 2: Rewrite envelope methods to HPKE

`ClientCryptoService` holds `secretKey` as raw bytes (main thread). With HPKE, it needs the HPKE private key (X25519 CryptoKey) instead. However, since the worker now supports `hpkeOpen`, we can either:
- Delegate to the worker via `cryptoWorker.hpkeOpen`
- Or keep the class but require `hpkePrivateKey: X25519EncryptionKey` in constructor

Given the worker-is-unlocked invariant, the simplest approach is to delete `ClientCryptoService` and have callers use `cryptoWorker.hpkeSeal` / `cryptoWorker.hpkeOpen` directly.

If callers exist and deletion is too disruptive, rewrite:

```typescript
export class ClientCryptoService {
  constructor(
    private readonly hpkePrivateKey: X25519EncryptionKey,
    private readonly pubkey: string
  ) {}

  async envelopeEncrypt(...): Promise<{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }> {
    // Use cryptoWorker.hpkeSeal for each recipient
  }

  async envelopeDecrypt(...): Promise<string> {
    // Use cryptoWorker.hpkeOpen
  }
}
```

### Step 3: Commit

```bash
git add src/client/lib/crypto-service.ts
git commit -m "feat(sec): ClientCryptoService ECIES → HPKE (or delete if unused)"
```

---

## Task 6: Migrate Component Encryption Callers

**Files:**
- `src/client/components/contacts/create-contact-dialog.tsx`
- `src/client/components/contacts/import-contacts-dialog.tsx`
- `src/client/routes/settings.tsx`
- `src/client/lib/signal-contact-registration.ts`

### Step 1: Update each `envelopeEncryptField` call

Old shape:
```typescript
const { encryptedHex, envelopes } = await cryptoWorker.envelopeEncryptField(
  plaintext,
  recipientPubkeys,
  label,
  aad
)
// envelopes: [{ recipientPubkey, ephemeralPubkeyHex, wrappedKeyHex }]
```

New shape:
```typescript
const { encryptedHex, envelopes } = await cryptoWorker.envelopeEncryptField(
  plaintext,
  recipientPubkeys,
  label,
  aad
)
// envelopes: [{ pubkey, v, labelId, enc, ct }]
```

The call syntax is identical — only the returned envelope shape changed. If callers were destructuring `ephemeralPubkeyHex`/`wrappedKeyHex`, they need to stop (those fields no longer exist).

### Step 2: Update each `encrypt` call

Old shape:
```typescript
const { ephemeralPubkeyHex, wrappedKeyHex } = await cryptoWorker.encrypt(
  plaintextHex,
  recipientPubkeyHex,
  label,
  aad
)
```

New shape:
```typescript
const envelope = await cryptoWorker.encrypt(
  plaintextHex,
  recipientPubkeyHex,
  label,
  aad
)
// envelope: { v, labelId, enc, ct }
```

### Step 3: Commit

```bash
git add src/client/components/contacts/create-contact-dialog.tsx \
  src/client/components/contacts/import-contacts-dialog.tsx \
  src/client/routes/settings.tsx \
  src/client/lib/signal-contact-registration.ts
git commit -m "feat(sec): component encryption callers ECIES → HPKE

Updated envelopeEncryptField and encrypt call sites to handle
HpkeEnvelope return shape."
```

---

## Task 7: Migrate Query Decryption Callers

**Files:** `src/client/lib/queries/*.ts` that use `decryptObjectFields`/`decryptArrayFields`.

The `decryptObjectFields`/`decryptArrayFields` signatures do **not** change — they still take `(obj, readerPubkey, label, fieldNames)`. The internal `resolveEncryptedFields` already works with `RecipientEnvelope` (which extends `HpkeEnvelope` since Slice 1). No code changes needed in most query files.

**Verify** by running typecheck after Task 4:
```bash
bun run typecheck
```

If any query file directly accesses `envelope.wrappedKey` or `envelope.ephemeralPubkey`, fix it.

---

## Task 8: Update Tests

**Files:**
- `src/client/lib/decrypt-fields.test.ts`
- `src/client/lib/crypto-worker-helpers.test.ts`
- `src/client/lib/crypto.test.ts`

### Step 1: Rewrite `decrypt-fields.test.ts`

Replace ECIES envelope construction with HPKE envelope construction. Use `@hpke/core` test keypairs.

```typescript
import { createHpkeSuite } from '@shared/crypto-suite'

async function createTestHpkeEnvelope(plaintext: string, recipientPubkeyHex: string) {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  const pubHex = bytesToHex(new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey)))
  // ... create envelope using hpkeSeal
}
```

### Step 2: Rewrite `crypto-worker-helpers.test.ts`

Replace `eciesUnwrapKey` tests with `hpkeUnwrapKey`. Generate test data with HPKE seal.

### Step 3: Update `crypto.test.ts`

Replace any ECIES test helpers.

### Step 4: Commit

```bash
git add src/client/lib/decrypt-fields.test.ts \
  src/client/lib/crypto-worker-helpers.test.ts \
  src/client/lib/crypto.test.ts
git commit -m "test(sec): rewrite client PII tests for HPKE envelopes"
```

---

## Task 9: Verification

- [ ] **Step 1: Run typecheck**
  ```bash
  bun run typecheck
  ```
  Expected: PASS (or only pre-existing errors).

- [ ] **Step 2: Run build**
  ```bash
  bun run build
  ```
  Expected: PASS.

- [ ] **Step 3: Run unit tests**
  ```bash
  bun run test:unit
  ```
  Expected: PASS.

- [ ] **Step 4: Verify no remaining ECIES in client PII files**
  ```bash
  grep -rn 'eciesWrapKey\|eciesUnwrapKey\|eciesUnwrapKeyWithSecret' src/client/lib/decrypt-fields.ts src/client/lib/crypto-worker-helpers.ts src/client/lib/crypto-service.ts src/client/components/contacts/ src/client/routes/settings.tsx
  ```
  Expected: Zero matches.

- [ ] **Step 5: Verify `@ts-expect-error Slice 2` annotations are gone from client PII files**
  ```bash
  grep -rn '@ts-expect-error.*Slice 2' src/client/lib/decrypt-fields.ts src/client/lib/crypto-service.ts src/client/lib/file-crypto.ts
  ```
  Expected: Only `file-crypto.ts` should still have them (Slice 5 handles that file).

- [ ] **Step 6: Run API E2E tests**
  ```bash
  bun run test:api
  ```
  Expected: PASS.

---

## Appendix A: ECIES Methods Removed in This Slice

| Method | Location | Replacement |
|--------|----------|-------------|
| `cryptoWorker.handleEncrypt` (ECIES) | `crypto-worker.ts:454-472` | HPKE direct seal |
| `cryptoWorker.handleDecrypt` (ECIES) | `crypto-worker.ts:437-452` | HPKE direct open |
| `cryptoWorker.handleEnvelopeEncryptField` (ECIES) | `crypto-worker.ts:1186-1214` | HPKE key-wrap |
| `cryptoWorker.handleDecryptEnvelopeField` (ECIES) | `crypto-worker.ts:1232-1260` | HPKE key-open |
| `eciesWrap` helper | `crypto-worker.ts:331-363` | Deleted |
| `eciesUnwrap` helper | `crypto-worker.ts:370-392` | Deleted |
| `eciesUnwrapKey` | `crypto-worker-helpers.ts:28-44` | `hpkeUnwrapKey` |
| `ClientCryptoService.envelopeEncrypt` (ECIES) | `crypto-service.ts:19-33` | HPKE key-wrap |
| `ClientCryptoService.envelopeDecrypt` (ECIES) | `crypto-service.ts:35-41` | HPKE key-open |

## Appendix B: API Shape Changes

| Call | Before (ECIES) | After (HPKE) |
|------|---------------|--------------|
| `cryptoWorker.encrypt()` | Returns `{ ephemeralPubkeyHex, wrappedKeyHex }` | Returns `HpkeEnvelope` |
| `cryptoWorker.decrypt()` | Takes `(ephemeralPubkeyHex, wrappedKeyHex, label, aad)` | Takes `(envelope: HpkeEnvelope, label, aad)` |
| `cryptoWorker.envelopeEncryptField()` | Returns `envelopes: [{ recipientPubkey, ephemeralPubkeyHex, wrappedKeyHex }]` | Returns `envelopes: [{ pubkey, v, labelId, enc, ct }]` |
| `cryptoWorker.decryptEnvelopeField()` | Takes `(encryptedHex, ephemeralPubkeyHex, wrappedKeyHex, label, aad)` | Takes `(encryptedHex, envelope: HpkeEnvelope, label, aad)` |
| `decryptTranscription()` | Takes `(packed, ephemeralPubkeyHex)` | Takes `(packed, envelope: HpkeEnvelope)` |

## Appendix C: Design Decision — Hybrid Model vs Per-Recipient Seal

| Use Case | Chosen Design | Rationale |
|----------|--------------|-----------|
| PII text fields (names, phones, notes) | Hybrid: shared ciphertext + HPKE key-wrap | Preserves `encryptedFoo` + `fooEnvelopes` convention. No DB migration. Matches server Slice 3 design. |
| Single-recipient direct encrypt (transcriptions, signal contacts) | Direct HPKE seal | Simpler. No intermediate symmetric key. |
| File key wrapping (Slice 5) | Hybrid: shared ciphertext + HPKE key-wrap | Same rationale — large binary data, one copy. |

The alternative (per-recipient HPKE seal) would eliminate the shared `encrypted` field but require:
- DB schema changes to every table with envelope-encrypted fields
- Server route changes to store/return per-recipient ciphertext
- Query cache invalidation logic changes

Given pre-production status, either would work, but the hybrid model is less disruptive and keeps the three slices decoupled from DB changes.
