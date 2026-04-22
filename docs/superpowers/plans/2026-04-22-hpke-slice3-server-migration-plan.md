# HPKE Slice 3: Server-Side ECIES → HPKE Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all server-side ECIES operations to HPKE via `HpkeService`. Remove all `eciesWrapKey`/`eciesUnwrapKey` calls from server code.

**Dependency:** Slice 1 (wire format types) must be merged first. Can run in **parallel** with Slice 2 (crypto worker).

**Architecture:** The server already has `HpkeService` (`src/server/lib/hpke-service.ts`) with a fully functional HPKE X25519 keypair derived from `SERVER_SECRET`, plus `generateAndWrapHubKey`, `unwrapHubKey`, `wrapHubKeyForNewMember`, `sealFor`, and `openForServer`. The migration is: `CryptoService` ECIES methods delegate to `HpkeService`, then the ECIES methods are deleted.

**Key design decisions:**
1. `CryptoService` gains a dependency on `HpkeService` — injected via constructor. The two services coexist: `CryptoService` handles symmetric server-key encryption and HMAC; `HpkeService` handles all asymmetric HPKE operations.
2. The server's ECIES identity (secp256k1 from `LABEL_SERVER_NOSTR_KEY`) is replaced by the server's HPKE identity (X25519 from `LABEL_SERVER_HPKE_KEY`). Hub key envelopes now address the server's HPKE pubkey, not the secp256k1 pubkey. This is a **wire-format break** — hub key envelopes change shape. Pre-production, so acceptable.
3. `envelopeEncrypt`/`envelopeDecrypt` switch from shared-ciphertext + per-recipient ECIES key-wrap to per-recipient HPKE seal. Same rationale as Slice 2: PII fields are short, recipient counts are small.
4. `crypto-envelopes.ts` blast functions (`encryptBlastContent`, `decryptBlastContentWithKey`) switch to per-recipient HPKE seal matching the Slice 2 client-side design.

---

## Files to Modify

| # | File | Change Summary |
|---|------|----------------|
| 1 | `src/server/lib/crypto-service.ts` | Inject `HpkeService`, rewrite `envelopeEncrypt`/`envelopeDecrypt`/`envelopeEncryptBinary`/`envelopeDecryptBinary` to HPKE, delete `unwrapHubKey`/`generateAndWrapHubKey`/`wrapHubKeyForNewMember`/`getServerPubkey` (delegate to HpkeService), remove `secp256k1` import |
| 2 | `src/server/lib/hpke-service.ts` | Add `envelopeEncrypt`/`envelopeDecrypt`/`envelopeEncryptBinary`/`envelopeDecryptBinary` methods (HPKE-based), add `getServerPubkeyHex` convenience method |
| 3 | `src/shared/crypto-envelopes.ts` | Rewrite `encryptBlastContent`/`decryptBlastContentWithKey` to use HPKE seal/open |
| 4 | `src/server/jobs/blast-processor.ts` | Update `_decryptBlastContent` to use HPKE open via HpkeService |
| 5 | `src/server/lib/voicemail-storage.ts` | Update voicemail encryption from `envelopeEncryptBinary` ECIES to HPKE |
| 6 | `src/server/messaging/router.ts` | Update `handleFirehoseMessage` — currently calls `services.crypto.envelopeEncrypt` (ECIES). Switch to HPKE. |
| 7 | `src/server/routes/dev.ts` | Replace `wrapHubKeyForPubkey` ECIES helper with HPKE via HpkeService, remove `xchacha20poly1305`/`secp256k1` imports |
| 8 | `src/server/lib/crypto-service.test.ts` | Rewrite envelope and hub-key tests for HPKE |
| 9 | `src/server/jobs/blast-processor.test.ts` | Update blast decryption mocks/tests |
| 10 | `src/client/lib/crypto-service.ts` | *(Cross-slice discovery)* — `ClientCryptoService` also uses ECIES `eciesWrapKey`/`eciesUnwrapKey` for `envelopeEncrypt`/`envelopeDecrypt`. This is a **client-side** class. **Decision:** Migrate in this slice since it's a direct clone of server `CryptoService` and shares the same ECIES removal scope. |

---

## Cross-Slice Conflict Analysis

| File | Slices | Resolution |
|------|--------|------------|
| `src/shared/crypto-envelopes.ts` | Slice 1 (`@ts-expect-error` annotations), Slice 3 (rewrite blast functions) | No conflict — Slice 1 adds annotations, Slice 3 removes them by rewriting |
| `src/client/lib/hub-key-cache.ts` | Slice 2 (HPKE unwrap), Slice 6 (hub key distribution cleanup) | **Potential conflict.** Slice 2's plan includes updating hub-key-cache. If Slice 2 handles it, Slice 6 skips it. If sequencing is Slice 3 before Slice 2, no conflict since Slice 3 doesn't touch hub-key-cache. |
| `src/server/lib/crypto-service.ts` | Slice 1 (`@ts-expect-error`), Slice 3 (full rewrite) | No conflict — Slice 3 removes the annotations by rewriting the methods |
| `src/server/routes/dev.ts` | Slice 1 (`@ts-expect-error`), Slice 3 (rewrite) | No conflict |
| `src/client/lib/crypto-service.ts` | Slice 3 (rewrite), Slice 4 (client PII paths) | **Potential conflict.** `ClientCryptoService` envelope methods are used by Slice 4 callers. Migrating the class in Slice 3 means Slice 4 callers get the HPKE interface for free. This is correct — Slice 4 should just update how callers invoke the methods, not the class itself. |

---

## Task 1: Inject HpkeService into CryptoService

**File:** `src/server/lib/crypto-service.ts`

- [ ] **Step 1: Add HpkeService as a constructor parameter**

```typescript
import { HpkeService } from './hpke-service'

export class CryptoService {
  private derivedKeys = new Map<string, Uint8Array>()
  private cachedHmacKey: Uint8Array | null = null

  constructor(
    private readonly serverSecret: string,
    private readonly hmacSecret: string,
    private readonly hpke: HpkeService
  ) {}
```

Remove `cachedServerPrivateKey`, `cachedServerPubkey` — these were for the secp256k1 ECIES identity, now replaced by `HpkeService`'s X25519 identity.

- [ ] **Step 2: Delete `getServerPrivateKey()` method**

This method derived the secp256k1 keypair from `SERVER_NOSTR_SECRET`. No longer needed — `HpkeService` owns the HPKE keypair.

- [ ] **Step 3: Replace `getServerPubkey()` with delegation to HpkeService**

```typescript
async getServerPubkey(): Promise<string> {
  const bytes = await this.hpke.getPublicKeyBytes()
  return toHex(bytes)
}
```

Note: This changes from sync to async (HpkeService key derivation is async). Callers need `await`.

Helper `toHex` can be imported from HpkeService or defined locally.

- [ ] **Step 4: Update all callers of `CryptoService` constructor**

Grep for `new CryptoService(` and add the `HpkeService` instance:

```bash
grep -rn 'new CryptoService(' src/server/ --include='*.ts'
```

Expected locations:
- `src/server/app.ts` or `src/server/server.ts` — service initialization
- `src/server/lib/crypto-service.test.ts` — test setup
- `src/server/jobs/blast-processor.test.ts` — test setup

Each must pass an `HpkeService` instance as the third argument.

- [ ] **Step 5: Remove `secp256k1` import**

`secp256k1` was only needed for `getServerPrivateKey()`. After deleting that method, the import is unused. The `@noble/curves/secp256k1` import can be removed.

- [ ] **Step 6: Remove `eciesWrapKey`/`eciesUnwrapKey` imports**

Remove from `import { eciesUnwrapKey, eciesWrapKey, ... } from '@shared/crypto-primitives'`.

- [ ] **Step 7: Commit**

```bash
git add src/server/lib/crypto-service.ts
git commit -m "refactor(sec): inject HpkeService into CryptoService, remove ECIES identity

CryptoService now takes HpkeService as third constructor arg.
Deleted getServerPrivateKey() and secp256k1 import — server's HPKE
X25519 identity (from HpkeService) replaces the secp256k1 identity."
```

---

## Task 2: Rewrite CryptoService Envelope Methods

**File:** `src/server/lib/crypto-service.ts`

- [ ] **Step 1: Rewrite `envelopeEncrypt` to use HPKE**

The old method: generate random message key → symmetric encrypt → ECIES-wrap key per recipient.
The new method: HPKE seal the plaintext directly per recipient.

```typescript
async envelopeEncrypt(
  plaintext: string,
  recipientPubkeys: string[],
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<{ envelopes: Array<{ pubkey: string; envelope: HpkeEnvelope }> }> {
  const pt = new TextEncoder().encode(plaintext)
  const envelopes = await Promise.all(
    recipientPubkeys.map(async (pk) => {
      const pubKeyBytes = hexToBytes(pk)
      const envelope = await this.hpke.sealFor(pt, pubKeyBytes, label, recordId, fieldName)
      return { pubkey: pk, envelope }
    })
  )
  return { envelopes }
}
```

**Breaking change:** The old return type was `{ encrypted: Ciphertext; envelopes: RecipientEnvelope[] }` with a shared `encrypted` field and per-recipient key-wrap envelopes. The new return type is `{ envelopes: Array<{ pubkey: string; envelope: HpkeEnvelope }> }` — each envelope contains its own ciphertext. The shared `encrypted` field is gone.

All callers of `envelopeEncrypt` must be updated to the new shape.

- [ ] **Step 2: Rewrite `envelopeDecrypt` to use HPKE**

```typescript
async envelopeDecrypt(
  envelope: HpkeEnvelope,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<string> {
  const pt = await this.hpke.openForServer(envelope, label, recordId, fieldName)
  return new TextDecoder().decode(pt)
}
```

The old method took `(ct, envelope, secretKey, label)` — the shared ciphertext, the per-recipient envelope, and an explicit secret key. The new method takes just the HPKE envelope (which IS the ciphertext) and the server opens it using its own key.

**Note:** `envelopeDecrypt` is now server-only (opens with server's HPKE key). Client-side decryption goes through the crypto worker.

- [ ] **Step 3: Rewrite `envelopeEncryptBinary` to use HPKE**

Same pattern as `envelopeEncrypt` but accepts `Uint8Array` instead of string:

```typescript
async envelopeEncryptBinary(
  data: Uint8Array,
  recipientPubkeys: string[],
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<{ envelopes: Array<{ pubkey: string; envelope: HpkeEnvelope }> }> {
  const envelopes = await Promise.all(
    recipientPubkeys.map(async (pk) => {
      const pubKeyBytes = hexToBytes(pk)
      const envelope = await this.hpke.sealFor(data, pubKeyBytes, label, recordId, fieldName)
      return { pubkey: pk, envelope }
    })
  )
  return { envelopes }
}
```

- [ ] **Step 4: Rewrite `envelopeDecryptBinary` to use HPKE**

```typescript
async envelopeDecryptBinary(
  envelope: HpkeEnvelope,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<Uint8Array> {
  return this.hpke.openForServer(envelope, label, recordId, fieldName)
}
```

- [ ] **Step 5: Delete `unwrapHubKey`**

The hub key unwrap is now done by `HpkeService.unwrapHubKey()`. Callers use `hpke.unwrapHubKey()` directly. Remove the `CryptoService.unwrapHubKey` method.

Callers to update:
- `src/server/jobs/blast-processor.ts` `_getHubKey` — calls `this.crypto.unwrapHubKey(envelopes)`
- Any other server code calling `crypto.unwrapHubKey`

```bash
grep -rn '\.unwrapHubKey(' src/server/ --include='*.ts' | grep -v test | grep -v hpke-service
```

- [ ] **Step 6: Delete `generateAndWrapHubKey`**

Callers use `HpkeService.generateAndWrapHubKey()`. Remove from `CryptoService`.

- [ ] **Step 7: Delete `wrapHubKeyForNewMember`**

Callers use `HpkeService.wrapHubKeyForNewMember()`. Remove from `CryptoService`.

- [ ] **Step 8: Remove `@ts-expect-error Slice 3` annotations**

- [ ] **Step 9: Commit**

```bash
git add src/server/lib/crypto-service.ts
git commit -m "feat(sec): rewrite CryptoService envelope methods to HPKE

envelopeEncrypt/Decrypt now produce per-recipient HPKE envelopes
instead of shared ciphertext + ECIES key-wrap. Hub key methods
deleted — callers use HpkeService directly. All eciesWrapKey/
eciesUnwrapKey calls removed from server crypto."
```

---

## Task 3: Add Convenience Methods to HpkeService

**File:** `src/server/lib/hpke-service.ts`

- [ ] **Step 1: Add `getServerPubkeyHex()` method**

```typescript
async getServerPubkeyHex(): Promise<string> {
  const bytes = await this.getPublicKeyBytes()
  return toHex(bytes)
}
```

This is used by callers that need the hex pubkey for DB storage (hub key envelope lists, etc.).

- [ ] **Step 2: Add `sealForHex` convenience overload**

Several server callers have pubkeys as hex strings (from DB). Add a convenience method that accepts hex:

```typescript
async sealForHex(
  plaintext: Uint8Array,
  recipientPubkeyHex: string,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<HpkeEnvelope> {
  const raw = hexToBytes(recipientPubkeyHex)
  return this.sealFor(plaintext, raw, label, recordId, fieldName)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/server/lib/hpke-service.ts
git commit -m "feat(sec): add getServerPubkeyHex and sealForHex to HpkeService"
```

---

## Task 4: Rewrite Blast Encryption (crypto-envelopes.ts)

**File:** `src/shared/crypto-envelopes.ts`

- [ ] **Step 1: Rewrite `encryptBlastContent` to use HPKE**

```typescript
import { hpkeSeal } from './hpke-primitives'
import { buildAad } from './hpke-primitives'
import type { HpkeEnvelope } from './hpke-envelope'
import { createHpkeSuite } from './crypto-suite'
import { asX25519EncryptionKey } from './types'

export interface EncryptedBlastContentPayload {
  contentEnvelopes: Array<{ pubkey: string; envelope: HpkeEnvelope }>
}

export async function encryptBlastContent(
  content: BlastContent,
  recipientPubkeys: string[],
  blastId: string
): Promise<EncryptedBlastContentPayload> {
  const plaintext = new TextEncoder().encode(JSON.stringify(content))
  const suite = createHpkeSuite()
  const contentEnvelopes = await Promise.all(
    recipientPubkeys.map(async (pk) => {
      const raw = hexToBytes(pk)
      const recipientKey = asX25519EncryptionKey(
        (await suite.kem.deserializePublicKey(raw)) as CryptoKey
      )
      const aad = buildAad(LABEL_BLAST_CONTENT, blastId, 'content')
      const envelope = await hpkeSeal(plaintext, recipientKey, LABEL_BLAST_CONTENT, aad)
      return { pubkey: pk, envelope }
    })
  )
  return { contentEnvelopes }
}
```

**Breaking changes:**
- Function is now `async` (was sync — ECIES wrap was synchronous, HPKE seal is async).
- Return type no longer has `encryptedContent: Ciphertext` — each envelope carries its own ciphertext.
- New parameter `blastId` for AAD binding.
- Callers must update.

- [ ] **Step 2: Rewrite `decryptBlastContentWithKey` to use HPKE**

```typescript
export async function decryptBlastContentWithKey(
  contentEnvelopes: Array<{ pubkey: string; envelope: HpkeEnvelope }>,
  privateKey: X25519EncryptionKey,
  readerPubkey: string,
  blastId: string
): Promise<BlastContent | null> {
  try {
    const entry = contentEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!entry) return null
    const aad = buildAad(LABEL_BLAST_CONTENT, blastId, 'content')
    const pt = await hpkeOpen(entry.envelope, privateKey, LABEL_BLAST_CONTENT, aad)
    return JSON.parse(new TextDecoder().decode(pt)) as BlastContent
  } catch {
    return null
  }
}
```

**Breaking changes:**
- Function is now `async`.
- Takes `privateKey: X25519EncryptionKey` instead of `secretKey: Uint8Array` (X25519 CryptoKey vs secp256k1 raw bytes).
- New parameter `blastId` for AAD.
- No longer takes `encryptedContent` (each envelope IS the ciphertext).

- [ ] **Step 3: Remove ECIES imports**

Remove `eciesWrapKey`, `eciesUnwrapKeyWithSecret`, `RecipientKeyEnvelope` imports from `@shared/crypto-primitives`. Remove `xchacha20poly1305` from `@noble/ciphers/chacha.js`.

**Note:** `encryptDraft`/`decryptDraft`/`encryptExport` still use `xchacha20poly1305` — they're symmetric-only paths that migrate in Slice 7. The `@noble/ciphers/chacha.js` import stays for those.

- [ ] **Step 4: Commit**

```bash
git add src/shared/crypto-envelopes.ts
git commit -m "feat(sec): rewrite blast encryption from ECIES to HPKE

encryptBlastContent and decryptBlastContentWithKey now use
per-recipient HPKE seal/open. Shared encryptedContent field
removed — each envelope carries its own ciphertext.
Functions are now async (HPKE operations are async)."
```

---

## Task 5: Update Blast Processor

**File:** `src/server/jobs/blast-processor.ts`

- [ ] **Step 1: Inject HpkeService**

The blast processor needs access to `HpkeService` to decrypt blast content (the server's HPKE private key). Add it to the constructor:

```typescript
export class BlastProcessor {
  constructor(
    private readonly services: Services,
    private readonly crypto: CryptoService,
    private readonly hpke: HpkeService,
    private readonly serverSecret: string
  ) {}
```

Update `scheduleBlastProcessor` signature accordingly.

- [ ] **Step 2: Rewrite `_decryptBlastContent`**

```typescript
async _decryptBlastContent(blast: Blast): Promise<string> {
  const serverPubHex = await this.hpke.getServerPubkeyHex()
  const entry = blast.contentEnvelopes.find((e) => e.pubkey === serverPubHex)
  if (!entry) {
    throw new Error(`No blast content envelope for server pubkey ${serverPubHex}`)
  }
  const pt = await this.hpke.openForServer(
    entry.envelope,
    LABEL_BLAST_CONTENT,
    blast.id,
    'content'
  )
  const payload = JSON.parse(new TextDecoder().decode(pt)) as { text: string }
  return payload.text
}
```

**Breaking change:** Method is now `async` (was sync). The `processBlast` caller already has `try/catch` around it — just add `await`.

- [ ] **Step 3: Update `_getHubKey` to use HpkeService**

```typescript
async _getHubKey(hubId: string): Promise<Uint8Array> {
  const envelopes = await this.services.settings.getHubKeyEnvelopes(hubId)
  return this.hpke.unwrapHubKey(envelopes)
}
```

**Note:** The hub key envelope shape from `getHubKeyEnvelopes` must now return HPKE-shaped envelopes `Array<{ pubkeyHex: string; envelope: HpkeEnvelope }>`. This depends on the DB migration from Slice 1 and the route updates from Slice 6. **If the hub key route hasn't been updated yet**, the blast processor will need a compatibility layer or Slice 3 must sequence after the hub key route update.

**Decision:** The hub key unwrap is already handled by `HpkeService.unwrapHubKey()` which expects `Array<{ pubkeyHex, envelope }>`. The `getHubKeyEnvelopes` service method returns whatever the DB stores. After Slice 1's TRUNCATE migration, the DB will be empty. The first hub created after Slice 1 uses `HpkeService.generateAndWrapHubKey()` which stores the HPKE format. So this works.

- [ ] **Step 4: Remove `eciesUnwrapKey` import and `deriveServerKeypair` import**

Remove: `import { eciesUnwrapKey } from '@shared/crypto-primitives'`
Remove: `import { deriveServerKeypair } from '../lib/nostr-publisher'`

- [ ] **Step 5: Update `processBlast` to await `_decryptBlastContent`**

Change `blastText = this._decryptBlastContent(blast)` to `blastText = await this._decryptBlastContent(blast)`.

- [ ] **Step 6: Commit**

```bash
git add src/server/jobs/blast-processor.ts
git commit -m "feat(sec): blast processor ECIES → HPKE decryption

_decryptBlastContent uses HpkeService.openForServer instead of
ECIES unwrap. _getHubKey delegates to HpkeService.unwrapHubKey.
deriveServerKeypair import removed."
```

---

## Task 6: Update Voicemail Storage

**File:** `src/server/lib/voicemail-storage.ts`

- [ ] **Step 1: Update `storeVoicemailAudio` to use HPKE envelopes**

The current code calls `crypto.envelopeEncryptBinary(audioBytes, adminPubkeys, LABEL_VOICEMAIL_WRAP)` and constructs `FileKeyEnvelope[]` with the ECIES `{ v: 2, labelId, pubkey, wrappedKey, ephemeralPubkey }` shape.

With HPKE, `envelopeEncryptBinary` returns `{ envelopes: Array<{ pubkey, envelope: HpkeEnvelope }> }`. The `FileKeyEnvelope` now extends `HpkeEnvelope` (from Slice 1), so the shape is `{ v: 3, labelId, enc, ct, pubkey }`.

```typescript
const { envelopes } = await crypto.envelopeEncryptBinary(
  audioBytes,
  adminPubkeys,
  LABEL_VOICEMAIL_WRAP,
  fileId,     // recordId for AAD
  'audio'     // fieldName for AAD
)

const recipientEnvelopes: FileKeyEnvelope[] = envelopes.map((env) => ({
  ...env.envelope,
  pubkey: env.pubkey,
}))
```

- [ ] **Step 2: Update `storeVoicemailAudio` params**

Add `HpkeService` to params if needed, or rely on `crypto.envelopeEncryptBinary` which now delegates to `hpke.sealFor` internally.

- [ ] **Step 3: Handle the encrypted data format change**

The old code stored `encrypted` (a hex-encoded shared ciphertext) in object storage. With per-recipient HPKE, there's no shared ciphertext — each recipient's envelope contains the full encrypted audio.

**Design decision:** For voicemail (binary data, potentially large), storing N copies of the encrypted audio is wasteful. **Alternative: use a hybrid approach** — generate a random AES-256-GCM data key, encrypt the audio with it, then HPKE-seal the data key per recipient. This preserves the shared-ciphertext model.

This is the same pattern as `hubEncryptField` (symmetric encrypt + per-recipient key wrap) but with HPKE instead of ECIES for the key wrap.

```typescript
// 3a. Generate random data key
const dataKey = crypto.getRandomValues(new Uint8Array(32))

// 3b. Encrypt audio with AES-256-GCM (server-side symmetric)
const encrypted = crypto.serverEncryptBinary(audioBytes, dataKey, LABEL_VOICEMAIL_WRAP)

// 3c. HPKE-seal the data key per admin
const recipientEnvelopes = await Promise.all(
  adminPubkeys.map(async (pk) => {
    const envelope = await hpke.sealForHex(dataKey, pk, LABEL_VOICEMAIL_WRAP, fileId, 'audio-key')
    return { ...envelope, pubkey: pk } as FileKeyEnvelope
  })
)
```

**Wait — this reintroduces a symmetric layer.** The whole point of Slice 3 is to remove ECIES and use HPKE. The hybrid approach uses HPKE for the key wrap (good) but still has a separate symmetric layer (which is fine — the issue was ECIES, not the symmetric layer).

**Decision:** Keep the hybrid approach for binary data. The `CryptoService.envelopeEncryptBinary` method should HPKE-seal the random data key (not the full data), keeping one shared encrypted blob.

This means `envelopeEncryptBinary` in Task 2 needs a different design from `envelopeEncrypt`. Revising:

```typescript
async envelopeEncryptBinary(
  data: Uint8Array,
  recipientPubkeys: string[],
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<{
  encrypted: Ciphertext
  envelopes: Array<{ pubkey: string; envelope: HpkeEnvelope }>
}> {
  // Random data key, symmetric encrypt, HPKE-seal the key per recipient
  const dataKey = new Uint8Array(32)
  crypto.getRandomValues(dataKey)
  const encrypted = symmetricEncrypt(data, dataKey, utf8ToBytes(label))
  const envelopes = await Promise.all(
    recipientPubkeys.map(async (pk) => {
      const envelope = await this.hpke.sealForHex(dataKey, pk, label, recordId, fieldName)
      return { pubkey: pk, envelope }
    })
  )
  dataKey.fill(0)
  return { encrypted, envelopes }
}
```

This preserves the `{ encrypted, envelopes }` shape — the `encrypted` is the shared ciphertext, each `envelope` wraps the data key. The voicemail code needs minimal changes.

**Also revise `envelopeDecryptBinary`:**
```typescript
async envelopeDecryptBinary(
  ct: Ciphertext,
  envelope: HpkeEnvelope,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<Uint8Array> {
  const dataKeyBytes = await this.hpke.openForServer(envelope, label, recordId, fieldName)
  return symmetricDecrypt(ct, dataKeyBytes, utf8ToBytes(label))
}
```

**Update Task 2 accordingly** — `envelopeEncryptBinary`/`envelopeDecryptBinary` keep the shared-ciphertext model with HPKE key-wrap instead of ECIES.

- [ ] **Step 4: Commit**

```bash
git add src/server/lib/voicemail-storage.ts
git commit -m "feat(sec): voicemail ECIES → HPKE key-wrap envelopes

FileKeyEnvelope now uses HpkeEnvelope shape (v:3, labelId, enc, ct)
instead of ECIES (wrappedKey, ephemeralPubkey). Audio encryption
uses symmetric AES + HPKE key-wrap per admin (shared ciphertext)."
```

---

## Task 7: Update Messaging Router

**File:** `src/server/messaging/router.ts`

- [ ] **Step 1: Update `handleFirehoseMessage`**

The current code calls `services.crypto.envelopeEncrypt(incoming.body, readerPubkeys, LABEL_FIREHOSE_BUFFER_ENCRYPT)`. With the updated `envelopeEncrypt` signature, this becomes:

```typescript
const encrypted = await services.crypto.envelopeEncrypt(
  incoming.body || '',
  readerPubkeys,
  LABEL_FIREHOSE_BUFFER_ENCRYPT,
  connection.id,       // recordId for AAD
  'buffer-message'     // fieldName for AAD
)
```

The return shape changes from `{ encrypted, envelopes }` to `{ envelopes }` (per-recipient seal). The buffer storage format must also update.

- [ ] **Step 2: Update buffer message storage**

The old code stored `{ encrypted: encrypted.encrypted, envelopes: encrypted.envelopes }`. With per-recipient HPKE, store each envelope individually. The buffer fetch path must also update.

```typescript
await services.firehose.addBufferMessage(connection.id, {
  signalTimestamp: new Date(incoming.timestamp),
  encryptedContent: JSON.stringify({
    envelopes: encrypted.envelopes,
  }),
  encryptedSenderInfo: JSON.stringify({
    envelopes: encryptedSender.envelopes,
  }),
  expiresAt: new Date(Date.now() + ttlMs),
})
```

- [ ] **Step 3: Commit**

```bash
git add src/server/messaging/router.ts
git commit -m "feat(sec): messaging router firehose ECIES → HPKE envelope encrypt"
```

---

## Task 8: Rewrite dev.ts Test Helper

**File:** `src/server/routes/dev.ts`

- [ ] **Step 1: Replace `wrapHubKeyForPubkey` with HPKE**

The current helper is a standalone ECIES function (lines 15-37). Replace with HpkeService:

```typescript
// Delete the wrapHubKeyForPubkey function entirely.
// Use HpkeService from the app context instead:

// In the test-reset handler:
const hpke = c.get('hpke') as HpkeService  // or however it's accessed
const { hubKey, envelopes } = await hpke.generateAndWrapHubKey([
  hexToBytes(c.env.ADMIN_PUBKEY)
])
await services.settings.setHubKeyEnvelopes(hub.id, envelopes)
```

- [ ] **Step 2: Remove ECIES imports**

Remove: `import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'`
Remove: `import { secp256k1 } from '@noble/curves/secp256k1.js'`
Remove: `import { sha256 } from '@noble/hashes/sha2.js'`

Keep `bytesToHex`, `hexToBytes`, `utf8ToBytes` if still used.

- [ ] **Step 3: Remove `rand` helper if unused**

The `rand()` helper was used by `wrapHubKeyForPubkey`. If no other code in the file uses it, delete it.

- [ ] **Step 4: Update hub key envelope storage format**

The old code stored `[{ pubkey, wrappedKey, ephemeralPubkey }]`. The new format is `[{ pubkeyHex, envelope: HpkeEnvelope }]` as produced by `HpkeService.generateAndWrapHubKey()`.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/dev.ts
git commit -m "feat(sec): dev test-reset ECIES → HPKE hub key generation

Deleted wrapHubKeyForPubkey ECIES helper. Uses HpkeService.
generateAndWrapHubKey for HPKE-sealed hub key envelopes.
Removed @noble/ciphers/chacha, @noble/curves/secp256k1 imports."
```

---

## Task 9: Update ClientCryptoService

**File:** `src/client/lib/crypto-service.ts`

- [ ] **Step 1: Assess if this class is still needed**

`ClientCryptoService` is a main-thread class that holds the raw secret key. This is the old pre-worker model. Check if any callers still use it:

```bash
grep -rn 'ClientCryptoService\|from.*crypto-service' src/client/ --include='*.ts' | grep -v test | grep -v node_modules
```

If no callers: delete the file. If callers exist: migrate to HPKE.

- [ ] **Step 2: If callers exist — rewrite envelope methods to HPKE**

Same pattern as server CryptoService: HPKE seal per recipient instead of ECIES wrap. Since this is client-side and async HPKE is fine, convert methods to async.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/crypto-service.ts
git commit -m "feat(sec): ClientCryptoService ECIES → HPKE or delete if unused"
```

---

## Task 10: Rewrite Tests

**File:** `src/server/lib/crypto-service.test.ts`

- [ ] **Step 1: Update test setup**

Add HpkeService to CryptoService constructor in tests:

```typescript
const testHpke = new HpkeService(TEST_SERVER_SECRET)
const crypto = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET, testHpke)
```

- [ ] **Step 2: Rewrite `envelopeEncrypt/envelopeDecrypt` tests**

Tests must update to:
- Pass `recordId` and `fieldName` to `envelopeEncrypt`
- Handle the new return shape (no shared `encrypted`, per-recipient HPKE envelopes)
- Use HPKE keypairs instead of secp256k1 for recipient keys

```typescript
import { createHpkeSuite } from '@shared/crypto-suite'

async function randomHpkeKeypair() {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair() as CryptoKeyPair
  const pubBytes = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))
  const pubHex = bytesToHex(pubBytes)
  return { privateKey: asX25519EncryptionKey(kp.privateKey), publicKey: asX25519EncryptionKey(kp.publicKey), pubHex, pubBytes }
}
```

- [ ] **Step 3: Rewrite `unwrapHubKey` tests**

Replace ECIES `eciesWrapKey` test helpers with `HpkeService.generateAndWrapHubKey`.

- [ ] **Step 4: Rewrite `envelopeEncryptBinary/envelopeDecryptBinary` tests**

Same pattern as Step 2 but for binary data.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/crypto-service.test.ts
git commit -m "test(sec): rewrite CryptoService tests for HPKE

All envelope and hub-key tests use HPKE keypairs and HpkeService.
ECIES test helpers (eciesWrapKey, secp256k1 keypairs) removed."
```

**File:** `src/server/jobs/blast-processor.test.ts`

- [ ] **Step 6: Update blast processor test setup**

Add HpkeService mock/instance. Update `_decryptBlastContent` mock (now async).

- [ ] **Step 7: Commit**

```bash
git add src/server/jobs/blast-processor.test.ts
git commit -m "test(sec): update blast processor tests for HPKE"
```

---

## Task 11: Verification

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

Expected: PASS.

- [ ] **Step 4: Verify no remaining ECIES usage in server files**

```bash
grep -rn 'eciesWrapKey\|eciesUnwrapKey\|eciesUnwrapKeyWithSecret' src/server/ --include='*.ts' | grep -v test | grep -v node_modules
```

Expected: Zero matches.

- [ ] **Step 5: Verify no `secp256k1.getSharedSecret` in server files**

```bash
grep -rn 'getSharedSecret' src/server/ --include='*.ts' | grep -v test | grep -v node_modules
```

Expected: Zero matches.

- [ ] **Step 6: Verify `@ts-expect-error Slice 3` annotations are gone**

```bash
grep -rn '@ts-expect-error.*Slice 3' src/
```

Expected: Zero matches.

- [ ] **Step 7: Run E2E tests**

```bash
bun run test:api
```

Expected: PASS.

---

## Appendix A: ECIES Methods Removed in This Slice

| Method | Location | Replacement |
|--------|----------|-------------|
| `CryptoService.envelopeEncrypt` (ECIES) | `crypto-service.ts:166-179` | HPKE per-recipient seal via `HpkeService.sealForHex` |
| `CryptoService.envelopeDecrypt` (ECIES) | `crypto-service.ts:181-189` | HPKE open via `HpkeService.openForServer` |
| `CryptoService.envelopeEncryptBinary` (ECIES) | `crypto-service.ts:191-204` | Hybrid: symmetric AES + HPKE key-wrap |
| `CryptoService.envelopeDecryptBinary` (ECIES) | `crypto-service.ts:206-214` | HPKE open data key + symmetric decrypt |
| `CryptoService.unwrapHubKey` | `crypto-service.ts:216-225` | `HpkeService.unwrapHubKey` |
| `CryptoService.generateAndWrapHubKey` | `crypto-service.ts:237-249` | `HpkeService.generateAndWrapHubKey` |
| `CryptoService.wrapHubKeyForNewMember` | `crypto-service.ts:255-266` | `HpkeService.wrapHubKeyForNewMember` |
| `CryptoService.getServerPubkey` | `crypto-service.ts:228-230` | `HpkeService.getServerPubkeyHex` |
| `CryptoService.getServerPrivateKey` | `crypto-service.ts:72-85` | Deleted — HpkeService owns the keypair |
| `encryptBlastContent` (ECIES) | `crypto-envelopes.ts:44-64` | Per-recipient HPKE seal |
| `decryptBlastContentWithKey` (ECIES) | `crypto-envelopes.ts:70-91` | HPKE open |
| `wrapHubKeyForPubkey` (raw ECIES) | `dev.ts:15-37` | `HpkeService.generateAndWrapHubKey` |
| `BlastProcessor._decryptBlastContent` (ECIES) | `blast-processor.ts:342-361` | `HpkeService.openForServer` |

## Appendix B: Server Identity Transition

| Property | Before (ECIES) | After (HPKE) |
|----------|---------------|--------------|
| Key type | secp256k1 (32-byte secret → 33-byte compressed pubkey → 32-byte x-only) | X25519 (32-byte raw → 32-byte raw) |
| Derivation | `HKDF(SERVER_SECRET, LABEL_SERVER_NOSTR_KEY, LABEL_SERVER_NOSTR_KEY_INFO)` | `HKDF(SERVER_SECRET, LABEL_SERVER_HPKE_KEY, LABEL_SERVER_HPKE_KEY_INFO)` via RFC 9180 `deriveKeyPair` |
| Pubkey format | 64-hex x-only secp256k1 | 64-hex raw X25519 |
| Hub key envelope | `{ pubkey, wrappedKey, ephemeralPubkey }` | `{ pubkeyHex, envelope: HpkeEnvelope }` |

## Appendix C: Design Decision — Per-Recipient Seal vs Shared Ciphertext

| Use Case | Design | Rationale |
|----------|--------|-----------|
| PII text fields (names, phones) | Per-recipient HPKE seal | Short data (< 1KB), 1-5 recipients. Simpler code, no intermediate key. |
| Blast content (text messages) | Per-recipient HPKE seal | Short data (< 2KB), ~3 recipients (server + admins). |
| Voicemail audio (binary, ~1-5MB) | Shared ciphertext + HPKE key-wrap | Large binary data. N copies is wasteful. |
| Firehose buffer messages | Per-recipient HPKE seal | Short text, 2 recipients (agent + admin). |
