# HPKE Slice 1: Wire Format & Type Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ECIES-era envelope types (`RecipientEnvelope`, `KeyEnvelope`, `Envelope`, `FileKeyEnvelope`, `EncryptedMetaItem`) and their zod schemas with HPKE v3 equivalents, then TRUNCATE all encrypted data so the DB is clean for the new wire format.

**Architecture:** This is a type-system-first migration. We change the canonical type and schema definitions to the HPKE wire format (`{ v: 3, labelId, enc, ct }` base shape), update all DB schema column generics, and add `@ts-expect-error` annotations to callers that still construct/destructure the old ECIES shape. Subsequent slices (2-7) will fix each `@ts-expect-error` by rewriting the actual encryption/decryption logic. The ECIES functions in `crypto-primitives.ts` are NOT deleted in this slice — they are marked `@deprecated` and remain callable until their callers are migrated.

**Tech Stack:** TypeScript, Zod v4, Drizzle ORM, `@hpke/core` + `@hpke/dhkem-x25519` (existing), `@shared/hpke-envelope` (existing `HpkeEnvelope` type + schema).

---

## Stale Epic Assumptions (Post-MLS Audit)

The epic was written before MLS Tier 6 PRs #164-#208 merged (2026-04-21). Key changes:

1. **`encryptNote` and `encryptMessage` already deleted** from `crypto-envelopes.ts`. The epic lists them for deletion in Slice 1 — no action needed; they're already gone. Only `encryptBlastContent`, `decryptBlastContentWithKey`, `encryptDraft`, `decryptDraft`, `encryptExport` remain.

2. **Hub-key-manager client-side already on HPKE** (`hub-key-manager.ts` wraps via `LABEL_HUB_KEY_WRAP` with AAD). But `hub-key-cache.ts` still calls the ECIES `eciesUnwrapKey` helper (line 87), and server `CryptoService` hub-key methods still use ECIES.

3. **File encryption items-key wrapping is HPKE**, but `file-crypto.ts` still has raw secp256k1 ECDH for metadata encryption and `eciesWrapKey` for per-recipient file key envelopes.

4. **Provisioning** `provisioning.ts` still has raw secp256k1 ECDH calls (3 sites). The "DONE" in migration notes refers to the worker-side `handleProvisionNsec` which now produces CryptoKey handles — the plain-JS provisioning functions are still ECIES.

5. **Epic estimates ~35 files for Slice 1.** Actual count for type/schema changes: ~4 definition files + ~10 DB schema files + ~8 auto-cascading schema importers + TRUNCATE migration. Callers that need `@ts-expect-error` annotations: ~20 source files. Total: ~35 files, estimate is accurate.

## Open Questions — Resolved

1. **Server X25519 key:** `HpkeService` (`src/server/lib/hpke-service.ts`) already derives a deterministic X25519 keypair from `SERVER_SECRET` via HKDF + RFC 9180 `deriveKeyPair`. It already has `generateAndWrapHubKey`, `unwrapHubKey`, `wrapHubKeyForNewMember`. **Decision: use HpkeService for all server-side HPKE operations. CryptoService hub-key methods will delegate to HpkeService in Slice 3.**

2. **Provisioning SAS with X25519:** Current SAS derives from `secp256k1.getSharedSecret`. With X25519, derive SAS from X25519 ECDH shared secret (same HKDF pattern, different curve). **Decision: keep ECDH-based SAS, switch to X25519 in Slice 5.** This is a wire-format break (pre-production, acceptable).

3. **Nonce size for AES-GCM (Slice 7):** 12-byte random nonces. Crisis hotline volumes are nowhere near the ~2^32 birthday bound. **Decision: 12-byte random, standard WebCrypto AES-GCM.**

4. **`@noble/ciphers` package retention:** `utf8ToBytes` is imported from `@noble/ciphers/utils.js` in ~30 source files. `@noble/hashes@2.2.0` exports `utf8ToBytes` from `@noble/hashes/utils`. **Decision: consolidate all `utf8ToBytes` imports to `@noble/hashes/utils.js` in Slice 7, then remove `@noble/ciphers` entirely.** Not in scope for Slice 1.

---

## File Map

### Files to modify (Slice 1 scope)

| # | File | Change |
|---|------|--------|
| 1 | `src/shared/types.ts` | Replace `RecipientEnvelope`, `KeyEnvelope`, `Envelope`, `FileKeyEnvelope`, `EncryptedMetaItem` type definitions |
| 2 | `src/shared/schemas/records.ts` | Replace `RecipientEnvelopeSchema`, `KeyEnvelopeSchema` with HPKE shapes |
| 3 | `src/shared/schemas/files.ts` | Replace `FileKeyEnvelopeSchema`, `EncryptedMetaItemSchema` with HPKE shapes |
| 4 | `src/shared/crypto-primitives.ts` | Mark `eciesWrapKey`, `eciesUnwrapKey`, `eciesUnwrapKeyWithSecret`, `KeyEnvelope`, `RecipientKeyEnvelope`, `decryptEnvelope`, `CryptoLabelMismatchError` as `@deprecated` |

### Files that auto-cascade (no code changes, schema shape propagates)

| # | File | Imports |
|---|------|---------|
| 5 | `src/shared/schemas/contacts.ts` | `RecipientEnvelopeSchema` from records |
| 6 | `src/shared/schemas/conversations.ts` | `RecipientEnvelopeSchema` from records |
| 7 | `src/shared/schemas/firehose.ts` | `RecipientEnvelopeSchema` from records |
| 8 | `src/shared/schemas/sessions.ts` | `RecipientEnvelopeSchema` from records |
| 9 | `src/shared/schemas/passkeys.ts` | `RecipientEnvelopeSchema` from records |
| 10 | `src/shared/schemas/signal-contact.ts` | `RecipientEnvelopeSchema` from records |
| 11 | `src/shared/schemas/auth-events.ts` | `RecipientEnvelopeSchema` from records |
| 12 | `src/shared/schemas/intakes.ts` | `RecipientEnvelopeSchema` from records |

### DB schema files (type parameter update — `jsonb<RecipientEnvelope[]>()` stays but the generic resolves to new shape)

| # | File |
|---|------|
| 13 | `src/server/db/schema/contacts.ts` |
| 14 | `src/server/db/schema/blasts.ts` |
| 15 | `src/server/db/schema/conversations.ts` |
| 16 | `src/server/db/schema/signal-contacts.ts` |
| 17 | `src/server/db/schema/records.ts` |
| 18 | `src/server/db/schema/push-subscriptions.ts` |
| 19 | `src/server/db/schema/auth-events.ts` |
| 20 | `src/server/db/schema/identity.ts` |
| 21 | `src/server/db/schema/sessions.ts` |
| 22 | `src/server/db/schema/intakes.ts` |

### Callers that will break (need `@ts-expect-error` — fixed in Slices 2-6)

These files construct or destructure the old `{ wrappedKey, ephemeralPubkey }` shape:

| # | File | Broken Code | Fix Slice |
|---|------|-------------|-----------|
| 23 | `src/shared/crypto-envelopes.ts` | `encryptBlastContent` constructs `RecipientKeyEnvelope` via `eciesWrapKey` | Slice 3 |
| 24 | `src/shared/crypto-primitives.ts` | `eciesWrapKey` return type, `eciesUnwrapKey` parameter type | Slice 7 (delete) |
| 25 | `src/client/lib/crypto-worker.ts` | `eciesWrap`/`eciesUnwrap`, `handleEncrypt`/`handleDecrypt` build ECIES shapes | Slice 2 |
| 26 | `src/client/lib/crypto-worker-helpers.ts` | `eciesUnwrapKey` reads `envelope.ephemeralPubkey`/`.wrappedKey` | Slice 2 |
| 27 | `src/client/lib/hub-key-cache.ts` | Constructs `KeyEnvelope` from `raw.wrappedKey`/`raw.ephemeralPubkey` | Slice 6 |
| 28 | `src/client/lib/file-crypto.ts` | `encryptMetadataForPubkey` builds ECIES shape, `encryptFile` uses `eciesWrapKey` | Slice 5 |
| 29 | `src/client/lib/provisioning.ts` | `decryptProvisionedNsec`/`encryptNsecForDevice` — ECDH-based | Slice 5 |
| 30 | `src/server/lib/crypto-service.ts` | `envelopeEncrypt`/`envelopeDecrypt` build `RecipientEnvelope` via `eciesWrapKey`, hub-key methods | Slice 3 |
| 31 | `src/server/routes/dev.ts` | `wrapHubKeyForPubkey` uses raw secp256k1 ECDH | Slice 3 |
| 32 | `src/client/lib/file-crypto.test.ts` | ECIES test helpers | Slice 5 |
| 33 | `src/client/lib/crypto.test.ts` | ECIES round-trip tests | Slice 2 |

### New file

| # | File | Purpose |
|---|------|---------|
| 34 | `drizzle/migrations/0057_hpke_slice1_truncate.sql` | TRUNCATE all tables with encrypted columns |

---

## Task 1: Replace Type Definitions in `src/shared/types.ts`

**Files:**
- Modify: `src/shared/types.ts:89-120` (Envelope, RecipientEnvelope, KeyEnvelope) and `:371-383` (FileKeyEnvelope, EncryptedMetaItem)

- [ ] **Step 1: Replace `Envelope` type**

Change the `Envelope` interface from the ECIES v2 shape to an alias for `HpkeEnvelope`:

```typescript
// In src/shared/types.ts — replace the Envelope block (lines ~89-101)

// Add import at top:
import type { HpkeEnvelope } from './hpke-envelope'

// Replace the Envelope interface:
/**
 * Wire-format envelope for asymmetric encryption.
 * Since the HPKE migration (pre-production), this is an alias for HpkeEnvelope.
 * v3 = HPKE RFC 9180 (DHKEM(X25519) + HKDF-SHA256 + AES-256-GCM).
 */
export type Envelope = HpkeEnvelope
```

- [ ] **Step 2: Replace `RecipientEnvelope` type**

```typescript
// Replace the RecipientEnvelope interface (was lines ~108-116):
/**
 * HPKE-sealed envelope for one recipient.
 * Used everywhere: PII fields, blasts, call records, hub keys.
 * The `pubkey` field identifies the recipient (hex X25519 public key).
 */
export interface RecipientEnvelope extends HpkeEnvelope {
  pubkey: string
}
```

- [ ] **Step 3: Delete `KeyEnvelope` type alias**

```typescript
// Delete the KeyEnvelope alias entirely (was line ~119):
// /** @deprecated Use RecipientEnvelope instead. Kept for gradual migration. */
// export type KeyEnvelope = Omit<RecipientEnvelope, 'pubkey'>
//
// KeyEnvelope is now just HpkeEnvelope — callers that still need the old
// ECIES shape import from @shared/crypto-primitives (deprecated there too).
```

Remove the `KeyEnvelope` export. Any remaining callers use the deprecated type from `crypto-primitives.ts`.

- [ ] **Step 4: Replace `FileKeyEnvelope` type**

```typescript
// Replace the FileKeyEnvelope interface (was lines ~375-377):
/**
 * HPKE-sealed file encryption key for one recipient.
 * Extends HpkeEnvelope with a recipient pubkey tag for multi-recipient selection.
 */
export interface FileKeyEnvelope extends HpkeEnvelope {
  pubkey: string
}
```

Note: `FileKeyEnvelope` and `RecipientEnvelope` now have the same shape. They remain separate types for semantic clarity (file keys vs PII fields).

- [ ] **Step 5: Replace `EncryptedMetaItem` type**

```typescript
// Replace the EncryptedMetaItem interface (was lines ~379-383):
/**
 * HPKE-sealed file metadata for one recipient.
 * The entire EncryptedFileMetadata JSON is sealed inside the HPKE ciphertext.
 */
export interface EncryptedMetaItem extends HpkeEnvelope {
  pubkey: string
}
```

- [ ] **Step 6: Run typecheck to see breakage**

Run: `bun run typecheck 2>&1 | head -80`

Expected: Many type errors in callers that construct `{ wrappedKey, ephemeralPubkey }` shapes. This is expected — we'll annotate them in Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(sec): replace envelope types with HPKE v3 wire format

RecipientEnvelope, FileKeyEnvelope, EncryptedMetaItem now extend
HpkeEnvelope { v: 3, labelId, enc, ct } instead of the ECIES
{ wrappedKey, ephemeralPubkey } shape. Envelope aliases HpkeEnvelope.
KeyEnvelope deleted (callers use crypto-primitives deprecated export).

Callers that construct the old shape will fail typecheck — fixed in
subsequent HPKE slices (2-6). This is the foundation slice."
```

---

## Task 2: Replace Zod Schemas in `src/shared/schemas/records.ts`

**Files:**
- Modify: `src/shared/schemas/records.ts:32-76`

- [ ] **Step 1: Replace `RecipientEnvelopeSchema`**

```typescript
// In src/shared/schemas/records.ts — replace the schema (lines ~32-37):

import { HpkeEnvelopeSchema } from '../hpke-envelope'

export const RecipientEnvelopeSchema = HpkeEnvelopeSchema.extend({
  pubkey: z.string(),
})
export type RecipientEnvelope = z.infer<typeof RecipientEnvelopeSchema>
```

- [ ] **Step 2: Replace `KeyEnvelopeSchema`**

```typescript
// Replace the KeyEnvelopeSchema (lines ~72-76):
// KeyEnvelope is now just HpkeEnvelope (no pubkey field).
export const KeyEnvelopeSchema = HpkeEnvelopeSchema
export type KeyEnvelope = z.infer<typeof KeyEnvelopeSchema>
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck 2>&1 | head -80`

Expected: Additional errors from callers that parse/construct the old schema shape.

- [ ] **Step 4: Commit**

```bash
git add src/shared/schemas/records.ts
git commit -m "feat(sec): update RecipientEnvelopeSchema + KeyEnvelopeSchema to HPKE v3"
```

---

## Task 3: Replace Zod Schemas in `src/shared/schemas/files.ts`

**Files:**
- Modify: `src/shared/schemas/files.ts:17-31`

- [ ] **Step 1: Replace `FileKeyEnvelopeSchema`**

```typescript
// In src/shared/schemas/files.ts — replace (lines ~17-24):

import { HpkeEnvelopeSchema } from '../hpke-envelope'

/**
 * HPKE key envelope for a single file recipient.
 * Wire-format: HpkeEnvelope + recipient pubkey tag.
 */
export const FileKeyEnvelopeSchema = HpkeEnvelopeSchema.extend({
  pubkey: z.string(),
})
export type FileKeyEnvelope = z.infer<typeof FileKeyEnvelopeSchema>
```

- [ ] **Step 2: Replace `EncryptedMetaItemSchema`**

```typescript
// Replace (lines ~26-31):
/**
 * HPKE-sealed file metadata for one recipient.
 */
export const EncryptedMetaItemSchema = HpkeEnvelopeSchema.extend({
  pubkey: z.string(),
})
export type EncryptedMetaItem = z.infer<typeof EncryptedMetaItemSchema>
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/schemas/files.ts
git commit -m "feat(sec): update FileKeyEnvelopeSchema + EncryptedMetaItemSchema to HPKE v3"
```

---

## Task 4: Mark ECIES Exports Deprecated in `src/shared/crypto-primitives.ts`

**Files:**
- Modify: `src/shared/crypto-primitives.ts:57-280`

The ECIES functions and types remain callable (callers haven't been rewritten yet) but are marked `@deprecated` with slice references.

- [ ] **Step 1: Add deprecation JSDoc to all ECIES functions and types**

```typescript
// Add @deprecated tags to:

/**
 * @deprecated Slice 7 — will be deleted. Use hpkeSeal from @shared/hpke-primitives.
 */
export function eciesWrapKey(/* ... existing signature */)

/**
 * @deprecated Slice 7 — will be deleted. Use hpkeOpen from @shared/hpke-primitives.
 */
export function eciesUnwrapKey(/* ... existing signature */)

/**
 * @deprecated Slice 7 — will be deleted. Use hpkeOpen from @shared/hpke-primitives.
 */
export function eciesUnwrapKeyWithSecret(/* ... existing signature */)

/**
 * @deprecated Slice 7 — will be deleted. Use HpkeEnvelope from @shared/hpke-envelope.
 * ECIES-specific key envelope shape (wrappedKey + ephemeralPubkey).
 */
export interface KeyEnvelope { /* ... existing */ }

/**
 * @deprecated Slice 7 — will be deleted. Use RecipientEnvelope from @shared/types.
 */
export interface RecipientKeyEnvelope extends KeyEnvelope { /* ... existing */ }

/**
 * @deprecated Slice 7 — will be deleted. Use HpkeLabelMismatchError from @shared/hpke-primitives.
 */
export class CryptoLabelMismatchError extends Error { /* ... existing */ }

/**
 * @deprecated Slice 7 — will be deleted. Use hpkeOpen from @shared/hpke-primitives.
 */
export async function decryptEnvelope(/* ... existing signature */)
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/crypto-primitives.ts
git commit -m "chore(sec): mark ECIES exports @deprecated with slice references"
```

---

## Task 5: Add `@ts-expect-error` Annotations to Broken Callers

**Files:** ~10 source files that construct or destructure the old ECIES envelope shape.

After Tasks 1-3, `bun run typecheck` will report errors in files that create objects with `wrappedKey`/`ephemeralPubkey` fields or read those fields from `RecipientEnvelope`-typed variables. Each error gets a `@ts-expect-error` annotation pointing to the fixing slice.

- [ ] **Step 1: Run typecheck and collect all errors**

Run: `bun run typecheck 2>&1 | grep -E 'TS(2322|2339|2345|2353|2561)' | sort -u`

This will list every type incompatibility. The errors fall into categories:
- Files that construct `{ pubkey, wrappedKey, ephemeralPubkey }` objects
- Files that access `.wrappedKey` or `.ephemeralPubkey` on the new type
- Files that pass old-shape objects where new-shape is expected
- Files that import `KeyEnvelope` from `@shared/types` (deleted)

- [ ] **Step 2: Fix `KeyEnvelope` import errors**

Several files import `KeyEnvelope` from `@shared/types` (which no longer exports it). Update these imports to use the deprecated `KeyEnvelope` from `@shared/crypto-primitives`:

```typescript
// In src/client/lib/crypto-worker-helpers.ts — already imports from @shared/crypto-primitives
// No change needed

// In src/client/lib/hub-key-cache.ts — already imports from @shared/crypto-primitives
// No change needed
```

If any file imported `KeyEnvelope` from `@shared/types`, redirect to `@shared/crypto-primitives`.

- [ ] **Step 3: Annotate `src/shared/crypto-envelopes.ts`**

The `encryptBlastContent` function constructs `RecipientKeyEnvelope` objects via `eciesWrapKey`:

```typescript
// In encryptBlastContent, the return type and construction break.
// Add @ts-expect-error above the line that constructs the envelope:
    contentEnvelopes: recipientPubkeys.map((pk) => ({
      pubkey: pk,
      // @ts-expect-error Slice 3: ECIES → HPKE migration
      ...eciesWrapKey(blastKey, pk, LABEL_BLAST_CONTENT),
    })),
```

And `decryptBlastContentWithKey` destructures `envelope.wrappedKey` / `envelope.ephemeralPubkey`:
```typescript
    // @ts-expect-error Slice 3: ECIES → HPKE migration — envelope shape is now HPKE
    const blastKey = eciesUnwrapKeyWithSecret(envelope, secretKey, LABEL_BLAST_CONTENT)
```

- [ ] **Step 4: Annotate `src/client/lib/crypto-worker.ts`**

The worker's `eciesWrap`/`eciesUnwrap` internal functions construct/destructure ECIES shapes. The `handleEncrypt` handler returns `{ wrappedKey, ephemeralPubkey }`. The `handleDecrypt` handler reads `wrappedKeyHex`/`ephemeralPubkeyHex` from the request.

Add `@ts-expect-error Slice 2: crypto worker ECIES → HPKE migration` to each line that constructs or reads the old shape fields. The worker request/response types are internal (not wire-format) so they can reference the deprecated types.

- [ ] **Step 5: Annotate `src/client/lib/crypto-worker-helpers.ts`**

The `eciesUnwrapKey` helper reads `envelope.ephemeralPubkey` and `envelope.wrappedKey`:

```typescript
  // @ts-expect-error Slice 2: ECIES → HPKE migration
  const resultHex = await cryptoWorker.decrypt(
    envelope.ephemeralPubkey,
    envelope.wrappedKey,
    label,
    new Uint8Array(0)
  )
```

- [ ] **Step 6: Annotate `src/client/lib/hub-key-cache.ts`**

```typescript
        // @ts-expect-error Slice 6: hub key cache ECIES → HPKE migration
        const envelope: KeyEnvelope = {
          wrappedKey: raw.wrappedKey,
          ephemeralPubkey: raw.ephemeralPubkey || raw.ephemeralPk || '',
        }
```

- [ ] **Step 7: Annotate `src/client/lib/file-crypto.ts`**

Multiple ECIES construction sites:
- `encryptMetadataForPubkey` builds `{ pubkey, encryptedContent, ephemeralPubkey }`
- `encryptFile` calls `eciesWrapKey` and builds `FileKeyEnvelope`
- `rewrapFileKey` calls `decryptEnvelope`

Add `@ts-expect-error Slice 5: file crypto ECIES → HPKE migration` to each.

- [ ] **Step 8: Annotate `src/client/lib/provisioning.ts`**

Not directly affected by the envelope type changes (provisioning doesn't use `RecipientEnvelope`). Skip unless typecheck reports errors.

- [ ] **Step 9: Annotate `src/server/lib/crypto-service.ts`**

Multiple sites:
- `envelopeEncrypt` constructs `RecipientEnvelope[]` via `eciesWrapKey`
- `envelopeDecrypt` calls `eciesUnwrapKey`
- `envelopeEncryptBinary`/`envelopeDecryptBinary` same pattern
- `unwrapHubKey` destructures `{ pubkey, wrappedKey, ephemeralPubkey }`
- `generateAndWrapHubKey` constructs via `eciesWrapKey`
- `wrapHubKeyForNewMember` constructs via `eciesWrapKey`

Add `@ts-expect-error Slice 3: server crypto ECIES → HPKE migration` to each.

- [ ] **Step 10: Annotate `src/server/routes/dev.ts`**

The `wrapHubKeyForPubkey` helper uses raw secp256k1 ECDH:

```typescript
  // @ts-expect-error Slice 3: dev route ECIES → HPKE migration
  const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
```

- [ ] **Step 11: Annotate test files**

- `src/client/lib/file-crypto.test.ts` — ECIES helpers in tests
- `src/client/lib/crypto.test.ts` — ECIES round-trip tests

Add `@ts-expect-error Slice N` to broken lines.

- [ ] **Step 12: Run typecheck — must pass**

Run: `bun run typecheck`

Expected: PASS (zero errors). Every type error should be annotated.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore(sec): add @ts-expect-error annotations for ECIES callers

Every caller that constructs or destructures the old ECIES envelope
shape is annotated with the slice that will fix it:
- Slice 2: crypto worker
- Slice 3: server crypto + blast envelopes
- Slice 5: file crypto + provisioning
- Slice 6: hub key cache

typecheck passes with all annotations in place."
```

---

## Task 6: TRUNCATE Migration

**Files:**
- Create: `drizzle/migrations/0057_hpke_slice1_truncate.sql`

- [ ] **Step 1: Check current migration number**

Run: `ls drizzle/migrations/ | tail -5`

Use the next available number. The plan uses `0057` — adjust if needed.

- [ ] **Step 2: Write the TRUNCATE migration**

```sql
-- 0057_hpke_slice1_truncate.sql
--
-- HPKE Slice 1: Wire format migration (pre-production TRUNCATE).
--
-- All encrypted columns switch from ECIES wire format
--   { pubkey, wrappedKey, ephemeralPubkey }
-- to HPKE v3 wire format
--   { pubkey, v: 3, labelId, enc, ct }
--
-- Pre-production: TRUNCATE is acceptable. No data migration needed.
-- Safety rail: abort if any table has > 1000 rows (catches accidental
-- runs against a populated staging/production DB).

DO $$
DECLARE
  row_count bigint;
BEGIN
  -- Safety rail: refuse to run on populated databases
  SELECT count(*) INTO row_count FROM users;
  IF row_count > 1000 THEN
    RAISE EXCEPTION 'Safety rail: users table has % rows — this migration is pre-production only', row_count;
  END IF;
END
$$;

-- TRUNCATE all tables that store RecipientEnvelope[] or KeyEnvelope JSONB columns.
-- CASCADE handles foreign key dependencies.
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
  auth_events
CASCADE;

-- Reset all hub setup state so the next login triggers fresh hub key generation
-- with the new HPKE envelope format.
UPDATE hubs SET setup_state = '{"setupCompleted":false,"completedSteps":[],"pendingChannels":[],"selectedChannels":[],"demoMode":false}'::jsonb;
```

- [ ] **Step 3: Verify migration file is in the right directory**

Run: `ls drizzle/migrations/0057*`

Expected: The new migration file exists.

- [ ] **Step 4: Commit**

```bash
git add drizzle/migrations/0057_hpke_slice1_truncate.sql
git commit -m "feat(sec): add TRUNCATE migration for HPKE Slice 1 wire format change

Pre-production wipe of all encrypted data. Safety rail prevents
accidental execution on databases with >1000 users.

Resets hub setup state so next login generates fresh HPKE envelopes."
```

---

## Task 7: Verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`

Expected: PASS (zero errors).

- [ ] **Step 2: Run build**

Run: `bun run build`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `bun run lint`

Expected: PASS (or only pre-existing warnings).

- [ ] **Step 4: Verify @ts-expect-error count**

Run: `grep -r '@ts-expect-error.*Slice' src/ | wc -l`

This is the "debt counter" — each annotation represents work for a subsequent slice. Document the count.

- [ ] **Step 5: Verify no ECIES imports in new code**

Run: `grep -r 'eciesWrapKey\|eciesUnwrapKey\|eciesUnwrapKeyWithSecret' src/ --include='*.ts' | grep -v '@deprecated\|@ts-expect-error\|crypto-primitives.ts' | wc -l`

Expected: 0 (all callers are annotated or in the deprecated source file).

- [ ] **Step 6: Verify HpkeEnvelope schema is the source of truth**

Run: `grep -r 'HpkeEnvelopeSchema' src/shared/schemas/ --include='*.ts'`

Expected: `records.ts` and `files.ts` both extend `HpkeEnvelopeSchema`.

- [ ] **Step 7: Final commit with verification notes**

```bash
git add -A
git commit -m "chore(sec): HPKE Slice 1 verification pass

typecheck: PASS
build: PASS
lint: PASS
@ts-expect-error count: N annotations across M files
ECIES callers outside deprecated source: 0"
```

---

## Task 8: Push and Create PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin lh-hpke-slice1-plan
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "docs(sec): HPKE Slice 1 implementation plan" --body "$(cat <<'EOF'
## Summary
- Full implementation plan for HPKE Slice 1 (wire format & type foundation)
- Audited epic assumptions against post-MLS codebase state
- Resolved all 4 open questions from the epic
- Identified stale assumptions (notes/messages already on MLS, hub-key-manager already HPKE)

## Plan scope
- Replace `RecipientEnvelope`, `KeyEnvelope`, `Envelope`, `FileKeyEnvelope`, `EncryptedMetaItem` types with HPKE v3 equivalents
- Replace zod schemas in `records.ts` and `files.ts`
- Mark ECIES exports `@deprecated` in `crypto-primitives.ts`
- Add `@ts-expect-error` annotations to ~20 caller files
- TRUNCATE migration for wire format change
- Verification steps (typecheck, build, lint, debt counter)

## Key findings
1. `encryptNote`/`encryptMessage` already deleted by MLS Tier 6 — no Slice 1 action needed
2. `hub-key-cache.ts` + server `CryptoService` hub-key methods still use ECIES (despite migration notes saying "DONE")
3. `file-crypto.ts` still has raw secp256k1 ECDH for metadata encryption
4. `@noble/hashes/utils` exports `utf8ToBytes` — `@noble/ciphers` can be fully removed in Slice 7

## Test plan
- [ ] Verify `bun run typecheck` passes with all `@ts-expect-error` annotations
- [ ] Verify `bun run build` succeeds
- [ ] Verify `bun run lint` passes
- [ ] Review `@ts-expect-error` count matches expected caller set

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Appendix A: Type Transformation Reference

### Before (ECIES v2)

```typescript
// RecipientEnvelope
{ pubkey: string; wrappedKey: Ciphertext; ephemeralPubkey: string }

// KeyEnvelope
{ wrappedKey: Ciphertext; ephemeralPubkey: string }

// Envelope
{ v: 2; labelId: number; wrappedKey: Ciphertext; ephemeralPubkey: string }

// FileKeyEnvelope (extends Envelope)
{ v: 2; labelId: number; pubkey: string; wrappedKey: Ciphertext; ephemeralPubkey: string }

// EncryptedMetaItem
{ pubkey: string; encryptedContent: Ciphertext; ephemeralPubkey: string }
```

### After (HPKE v3)

```typescript
// HpkeEnvelope (base, from @shared/hpke-envelope — already exists)
{ v: 3; labelId: number; enc: string; ct: string }

// RecipientEnvelope (extends HpkeEnvelope)
{ pubkey: string; v: 3; labelId: number; enc: string; ct: string }

// Envelope (alias)
HpkeEnvelope

// KeyEnvelope — DELETED from types.ts, deprecated in crypto-primitives.ts

// FileKeyEnvelope (extends HpkeEnvelope)
{ pubkey: string; v: 3; labelId: number; enc: string; ct: string }

// EncryptedMetaItem (extends HpkeEnvelope)
{ pubkey: string; v: 3; labelId: number; enc: string; ct: string }
```

## Appendix B: ECIES Exports Disposition

| Export | Location | Slice 1 Action | Delete In |
|--------|----------|---------------|-----------|
| `eciesWrapKey` | `crypto-primitives.ts` | `@deprecated` | Slice 7 |
| `eciesUnwrapKey` | `crypto-primitives.ts` | `@deprecated` | Slice 7 |
| `eciesUnwrapKeyWithSecret` | `crypto-primitives.ts` | `@deprecated` | Slice 7 |
| `KeyEnvelope` (type) | `crypto-primitives.ts` | `@deprecated` | Slice 7 |
| `RecipientKeyEnvelope` (type) | `crypto-primitives.ts` | `@deprecated` | Slice 7 |
| `CryptoLabelMismatchError` | `crypto-primitives.ts` | `@deprecated` | Slice 7 |
| `decryptEnvelope` | `crypto-primitives.ts` | `@deprecated` | Slice 7 |
| `symmetricEncrypt` | `crypto-primitives.ts` | **Keep** | Slice 7 (convert XChaCha20 → AES-GCM) |
| `symmetricDecrypt` | `crypto-primitives.ts` | **Keep** | Slice 7 (convert XChaCha20 → AES-GCM) |
| `hkdfDerive` | `crypto-primitives.ts` | **Keep** | — (permanent) |
| `hmacSha256` | `crypto-primitives.ts` | **Keep** | — (permanent) |
| `generateKeyPair` | `crypto-primitives.ts` | **Keep** | — (permanent) |
| `keyPairFromNsec` | `crypto-primitives.ts` | **Keep** | — (permanent) |
| `isValidNsec` | `crypto-primitives.ts` | **Keep** | — (permanent) |
| `unbiasedSixDigitCode` | `crypto-primitives.ts` | **Keep** | — (permanent) |
| `encryptBlastContent` | `crypto-envelopes.ts` | `@ts-expect-error` | Slice 3 |
| `decryptBlastContentWithKey` | `crypto-envelopes.ts` | `@ts-expect-error` | Slice 3 |
| `encryptDraft` / `decryptDraft` | `crypto-envelopes.ts` | **Keep** | Slice 7 (XChaCha20 → AES-GCM) |
| `encryptExport` | `crypto-envelopes.ts` | **Keep** | Slice 7 (XChaCha20 → AES-GCM) |

## Appendix C: Domain Separation Labels Referenced

All labels from `src/shared/crypto-labels.ts` that appear in ECIES code paths being migrated:

| Label | Index | Usage |
|-------|-------|-------|
| `LABEL_NOTE_KEY` | 0 | Per-note key wrapping (now MLS — legacy only) |
| `LABEL_HUB_KEY_WRAP` | 1 | Hub key distribution |
| `LABEL_MESSAGE` | 2 | Message key wrapping (now MLS — legacy only) |
| `LABEL_FILE_KEY` | 3 | Per-file key wrapping |
| `LABEL_FILE_METADATA` | 4 | File metadata ECIES |
| `LABEL_BLAST_CONTENT` | 5 | Blast content envelope |
| `LABEL_CALL_META` | 6 | Call record metadata |
| `LABEL_TRANSCRIPTION` | 8 | Server transcription |
| `LABEL_DEVICE_PROVISION` | 10 | Device provisioning ECDH |
| `LABEL_VOICEMAIL_WRAP` | 16 | Voicemail audio key |
| `LABEL_CONTACT_SUMMARY` | 19 | Contact summary PII |
| `LABEL_CONTACT_PII` | 20 | Contact full PII |
| `LABEL_CONTACT_RELATIONSHIP` | 21 | Contact relationships |
| `LABEL_SESSION_META` | (not in registry) | Session metadata |
| `LABEL_AUTH_EVENT` | (not in registry) | Auth event history |
| `LABEL_SIGNAL_CONTACT` | (not in registry) | Signal contact ID |
