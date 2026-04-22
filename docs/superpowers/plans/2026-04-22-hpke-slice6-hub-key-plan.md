# HPKE Slice 6: Hub Key Cache & Distribution Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure hub key distribution is fully HPKE end-to-end (client cache + server operations).

**Dependency:** Slice 1 (wire format types) + Slice 3 (server-side ECIES → HPKE migration). The server must use `HpkeService` for hub key operations before Slice 6 can switch the routes. **If Slice 3 is not yet complete, this plan includes the necessary server `CryptoService` → `HpkeService` delegation as Task 0.**

**Architecture:**
- **Server**: `HpkeService.generateAndWrapHubKey()` produces `Array<{ pubkeyHex: string; envelope: HpkeEnvelope }>`. `HpkeService.wrapHubKeyForNewMember()` produces a single `{ pubkeyHex; envelope }`. `HpkeService.unwrapHubKey()` opens the server's envelope.
- **Client cache**: `hub-key-cache.ts` receives `HpkeEnvelope` from the server and uses the worker's `hpkeOpen` (via `cryptoWorker.decrypt`) to unwrap the hub key.
- **Envelope shape change**: The old server→client hub key format was `{ wrappedKey, ephemeralPubkey }` (ECIES). The new format is `{ v: 3, labelId, enc, ct }` (HPKE).

**Key design decisions:**
1. **Server routes switch from `services.crypto` to `services.hpke`** for all hub key operations. `CryptoService.generateAndWrapHubKey`/`wrapHubKeyForNewMember`/`unwrapHubKey` are deleted (or already deleted by Slice 3).
2. **Route schemas** update from `z.object({ pubkey, wrappedKey, ephemeralPubkey })` to `z.object({ pubkey, v: z.literal(3), labelId, enc, ct })` (or reuse `RecipientEnvelopeSchema`).
3. **Client cache** no longer needs to normalize `ephemeralPubkey` vs `ephemeralPk` — the envelope is a single `HpkeEnvelope` object.
4. **`hub-key-manager.ts`** is already fully HPKE (verified in audit). No changes needed there.

---

## Files to Modify

| # | File | Change Summary |
|---|------|----------------|
| 0a | `src/server/lib/crypto-service.ts` (if Slice 3 not done) | Delete `unwrapHubKey`/`generateAndWrapHubKey`/`wrapHubKeyForNewMember`/`getServerPubkey` (delegate to HpkeService). |
| 0b | `src/server/lib/hpke-service.ts` (if Slice 3 not done) | Add `getServerPubkeyHex` and `sealForHex` convenience methods. |
| 1 | `src/server/routes/hubs.ts` | Update GET `/key-envelope` to return HPKE envelope shape. Update GET `/key` to return HPKE envelope. Update PUT `/key` schema to accept HPKE envelopes. |
| 2 | `src/server/routes/setup.ts` | Replace `services.crypto.generateAndWrapHubKey` with `services.hpke.generateAndWrapHubKey`. Convert pubkey hex to Uint8Array. |
| 3 | `src/server/routes/invites.ts` | Replace `services.crypto.wrapHubKeyForNewMember` with `services.hpke.wrapHubKeyForNewMember`. Convert pubkey hex to Uint8Array. |
| 4 | `src/client/lib/hub-key-cache.ts` | Replace `eciesUnwrapKey` with HPKE open via worker. Update envelope normalization. Import `HpkeEnvelope` instead of `KeyEnvelope`. |
| 5 | `src/client/lib/hub-key-cache.test.ts` | Rewrite tests for HPKE envelope shape. |
| 6 | `src/server/routes/dev.ts` (if exists) | Replace `wrapHubKeyForPubkey` ECIES helper with HpkeService. |

---

## Cross-Slice Conflict Analysis

| File | Slices | Resolution |
|------|--------|------------|
| `src/server/lib/crypto-service.ts` | Slice 3 (primary), Slice 6 (cleanup) | **Slice 3 deletes the methods; Slice 6 routes call HpkeService directly.** If Slice 3 is done, Slice 6 just updates route callers. |
| `src/server/routes/hubs.ts` | Slice 6 (primary) | **No conflict** — only Slice 6 touches hub key routes. |
| `src/server/routes/setup.ts` | Slice 6 (primary) | **No conflict** — only Slice 6 touches setup hub key generation. |
| `src/server/routes/invites.ts` | Slice 6 (primary) | **No conflict** — only Slice 6 touches invite hub key wrapping. |
| `src/client/lib/hub-key-cache.ts` | Slice 4 (worker ECIES removal), Slice 6 (cache HPKE migration) | **Slice 4 must land first** — the cache uses `cryptoWorker.decrypt` which becomes HPKE-only in Slice 4. Then Slice 6 passes HPKE envelopes to it. |

---

## Task 0: Ensure Server HpkeService is Ready (if Slice 3 Incomplete)

**Skip this task if Slice 3 is already merged.**

**Files:** `src/server/lib/hpke-service.ts`, `src/server/lib/crypto-service.ts`

### Step 0a: Verify HpkeService has required methods

Check that `HpkeService` already has:
- `generateAndWrapHubKey(memberPubkeys: Uint8Array[]): { hubKey; envelopes }`
- `unwrapHubKey(envelopes): Uint8Array`
- `wrapHubKeyForNewMember(existingEnvelopes, newMemberPubkey): { pubkeyHex; envelope }`
- `getPublicKeyBytes(): Promise<Uint8Array>`

These are already present in the current codebase (verified in audit).

### Step 0b: Add convenience methods if missing

```typescript
// Add to HpkeService if not already there:
async getServerPubkeyHex(): Promise<string> {
  return toHex(await this.getPublicKeyBytes())
}

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

### Step 0c: Delete ECIES hub key methods from CryptoService

Remove from `src/server/lib/crypto-service.ts`:
- `unwrapHubKey`
- `generateAndWrapHubKey`
- `wrapHubKeyForNewMember`
- `getServerPubkey`
- `getServerPrivateKey`
- `cachedServerPrivateKey`, `cachedServerPubkey`
- `secp256k1` import (if no longer needed for other methods)

**Note:** `getServerPubkey` may still be used by non-hub-key callers. Check before deleting.

```bash
grep -rn '\.getServerPubkey(' src/server/ --include='*.ts' | grep -v test | grep -v node_modules
grep -rn '\.unwrapHubKey(' src/server/ --include='*.ts' | grep -v test | grep -v node_modules
grep -rn '\.generateAndWrapHubKey(' src/server/ --include='*.ts' | grep -v test | grep -v node_modules
grep -rn '\.wrapHubKeyForNewMember(' src/server/ --include='*.ts' | grep -v test | grep -v node_modules
```

### Step 0d: Commit

```bash
git add src/server/lib/hpke-service.ts src/server/lib/crypto-service.ts
git commit -m "feat(sec): delegate hub key ops from CryptoService to HpkeService

Deleted ECIES hub key methods from CryptoService.
Routes now use HpkeService directly."
```

---

## Task 1: Update Hub Key Routes

**File:** `src/server/routes/hubs.ts`

### Step 1: Update GET `/key-envelope` response

Old response:
```typescript
return c.json({
  wrappedKey: myEnvelope.wrappedKey,
  ephemeralPubkey: myEnvelope.ephemeralPubkey,
  ephemeralPk: myEnvelope.ephemeralPubkey,
}, 200)
```

New response — return the full HPKE envelope:
```typescript
return c.json(myEnvelope, 200)
// myEnvelope is now: { pubkey, v, labelId, enc, ct }
```

### Step 2: Update GET `/key` response

Old:
```typescript
return c.json({ envelope: myEnvelope }, 200)
// myEnvelope was { pubkey, wrappedKey, ephemeralPubkey }
```

New:
```typescript
return c.json({ envelope: myEnvelope }, 200)
// myEnvelope is now { pubkey, v, labelId, enc, ct }
```

The JSON wrapper stays, but the inner envelope shape changes.

### Step 3: Update PUT `/key` request schema

Old schema:
```typescript
z.object({
  envelopes: z.array(
    z.object({
      pubkey: z.string(),
      wrappedKey: z.string(),
      ephemeralPubkey: z.string(),
    })
  ),
})
```

New schema — use `RecipientEnvelopeSchema`:
```typescript
import { RecipientEnvelopeSchema } from '@shared/schemas/records'

z.object({
  envelopes: z.array(RecipientEnvelopeSchema),
})
```

Or inline:
```typescript
z.object({
  envelopes: z.array(
    z.object({
      pubkey: z.string(),
      v: z.literal(3),
      labelId: z.number(),
      enc: z.string(),
      ct: z.string(),
    })
  ),
})
```

### Step 4: Commit

```bash
git add src/server/routes/hubs.ts
git commit -m "feat(sec): hub routes return/accept HPKE envelope shape

GET /key-envelope and GET /key return HpkeEnvelope.
PUT /key schema accepts RecipientEnvelopeSchema (v:3)."
```

---

## Task 2: Update Setup Route

**File:** `src/server/routes/setup.ts`

### Step 1: Replace CryptoService with HpkeService

Old:
```typescript
const { envelopes } = services.crypto.generateAndWrapHubKey([pubkey])
```

New:
```typescript
// Convert pubkey hex to Uint8Array for HpkeService
const { envelopes } = await services.hpke.generateAndWrapHubKey([hexToBytes(pubkey)])
```

**Breaking change:** `generateAndWrapHubKey` now returns `Array<{ pubkeyHex: string; envelope: HpkeEnvelope }>` instead of `Array<{ pubkey, wrappedKey, ephemeralPubkey }>`. The `setHubKeyEnvelopes` service method must accept the new shape.

Verify `services.settings.setHubKeyEnvelopes` can store the new shape. If the DB stores JSONB, the new shape serializes directly.

### Step 2: Commit

```bash
git add src/server/routes/setup.ts
git commit -m "feat(sec): setup route uses HpkeService for hub key generation"
```

---

## Task 3: Update Invites Route

**File:** `src/server/routes/invites.ts`

### Step 1: Replace CryptoService with HpkeService

Old:
```typescript
const newEnvelope = services.crypto.wrapHubKeyForNewMember(existingEnvelopes, body.pubkey)
```

New:
```typescript
const newEnvelope = await services.hpke.wrapHubKeyForNewMember(
  existingEnvelopes.map((e) => ({ pubkeyHex: e.pubkey, envelope: e })),
  hexToBytes(body.pubkey)
)
// newEnvelope is { pubkeyHex: string; envelope: HpkeEnvelope }
```

Wait — there's a type mismatch. `existingEnvelopes` from `getHubKeyEnvelopes` may still be the old ECIES shape if the DB hasn't been migrated. After Slice 3 + this slice, they should be HPKE-shaped.

If `existingEnvelopes` is `Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>` (old), we need to convert. But after Slice 3 migrates the server, the DB stores HPKE-shaped envelopes.

Assuming the DB is already migrated (or we do a TRUNCATE migration):

```typescript
const existingEnvelopes = await services.settings.getHubKeyEnvelopes(defaultHub.id)
if (existingEnvelopes.length > 0) {
  // existingEnvelopes is Array<{ pubkey: string; v: 3; labelId; enc; ct }>
  const hpkeEnvelopes = existingEnvelopes.map((e) => ({
    pubkeyHex: e.pubkey,
    envelope: e as HpkeEnvelope,
  }))
  const newEnvelope = await services.hpke.wrapHubKeyForNewMember(
    hpkeEnvelopes,
    hexToBytes(body.pubkey)
  )
  await services.settings.setHubKeyEnvelopes(defaultHub.id, [
    ...existingEnvelopes,
    { pubkey: newEnvelope.pubkeyHex, ...newEnvelope.envelope },
  ])
}
```

### Step 2: Commit

```bash
git add src/server/routes/invites.ts
git commit -m "feat(sec): invites route uses HpkeService for hub key wrapping"
```

---

## Task 4: Update Client Hub Key Cache

**File:** `src/client/lib/hub-key-cache.ts`

### Step 1: Replace ECIES unwrap with HPKE open

Old:
```typescript
import { type KeyEnvelope } from '@shared/crypto-primitives'
import { eciesUnwrapKey } from './crypto-worker-helpers'

const envelope: KeyEnvelope = {
  wrappedKey: raw.wrappedKey,
  ephemeralPubkey: raw.ephemeralPubkey || raw.ephemeralPk || '',
}
const hubKeyBytes = await eciesUnwrapKey(envelope, LABEL_HUB_KEY_WRAP)
```

New:
```typescript
import type { HpkeEnvelope } from '@shared/hpke-envelope'
import { cryptoWorker } from './crypto-worker-client'

// The server now returns an HpkeEnvelope directly
const envelope = raw as HpkeEnvelope
const hubKeyHex = await cryptoWorker.decrypt(envelope, LABEL_HUB_KEY_WRAP, new Uint8Array(0))
const hubKeyBytes = hexToBytes(hubKeyHex)
```

**Remove `eciesUnwrapKey` import.**

### Step 2: Update `loadHubKeysForUser`

```typescript
export async function loadHubKeysForUser(hubIds: string[]): Promise<void> {
  // ... generation logic unchanged ...

  await Promise.allSettled(
    hubIds.map(async (hubId) => {
      try {
        const raw = await getMyHubKeyEnvelope(hubId)
        if (!raw) return

        // Server now sends HpkeEnvelope shape
        const envelope = raw as unknown as HpkeEnvelope
        const hubKeyHex = await cryptoWorker.decrypt(
          envelope,
          LABEL_HUB_KEY_WRAP,
          new Uint8Array(0)
        )
        const hubKeyBytes = hexToBytes(hubKeyHex)
        const cryptoKey = await importHubKeyCryptoKey(hubKeyBytes)
        // ... rest unchanged
      } catch (err) {
        // ... existing error handling
      }
    })
  )
}
```

### Step 3: Update comment

Update the file header comment to say "distributed as HPKE-wrapped envelopes" instead of "ECIES-wrapped envelopes".

### Step 4: Commit

```bash
git add src/client/lib/hub-key-cache.ts
git commit -m "feat(sec): hub-key-cache ECIES → HPKE unwrap

Uses cryptoWorker.decrypt (HPKE open) instead of eciesUnwrapKey.
Server envelope is now HpkeEnvelope shape."
```

---

## Task 5: Update Hub Key Cache Tests

**File:** `src/client/lib/hub-key-cache.test.ts`

### Step 1: Rewrite test envelope construction

Replace ECIES envelope construction with HPKE envelope construction. Use `@hpke/core` test keypairs.

```typescript
import { createHpkeSuite } from '@shared/crypto-suite'
import { hpkeSeal } from '@shared/hpke-primitives'
import { asX25519EncryptionKey } from '@shared/types'

async function createTestHubKeyEnvelope(hubKey: Uint8Array, recipientPubkeyHex: string) {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  const pubHex = bytesToHex(new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey)))
  // Return envelope sealed for the test recipient
  const envelope = await hpkeSeal(
    hubKey,
    asX25519EncryptionKey(kp.publicKey),
    LABEL_HUB_KEY_WRAP,
    new Uint8Array(0)
  )
  return { envelope, recipientPrivKey: kp.privateKey, recipientPubHex: pubHex }
}
```

### Step 2: Update test assertions

Ensure tests verify that the cached `raw` bytes match the original hub key after HPKE open.

### Step 3: Commit

```bash
git add src/client/lib/hub-key-cache.test.ts
git commit -m "test(sec): rewrite hub-key-cache tests for HPKE envelopes"
```

---

## Task 6: Update Dev Test Helper (if applicable)

**File:** `src/server/routes/dev.ts`

If this file has a `wrapHubKeyForPubkey` ECIES helper, replace it with `HpkeService`:

```typescript
// Old: standalone ECIES helper
// New: use HpkeService from app context
const hpke = c.get('hpke') as HpkeService
const { hubKey, envelopes } = await hpke.generateAndWrapHubKey([
  hexToBytes(c.env.ADMIN_PUBKEY),
])
await services.settings.setHubKeyEnvelopes(hub.id, envelopes.map((e) => ({
  pubkey: e.pubkeyHex,
  ...e.envelope,
})))
```

---

## Task 7: Verification

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

- [ ] **Step 4: Verify no remaining ECIES in hub key files**
  ```bash
  grep -rn 'eciesWrapKey\|eciesUnwrapKey\|wrappedKey\|ephemeralPubkey' src/server/routes/hubs.ts src/server/routes/setup.ts src/server/routes/invites.ts src/client/lib/hub-key-cache.ts | grep -v 'HpkeEnvelope\|RecipientEnvelope'
  ```
  Expected: Zero matches (except in comments).

- [ ] **Step 5: Run API E2E tests**
  ```bash
  bun run test:api
  ```
  Expected: PASS.

- [ ] **Step 6: Verify hub key round-trip**
  Manually test (or add an API test):
  1. Create a hub
  2. Get hub key envelope
  3. Verify the envelope has `v: 3`, `enc`, `ct`
  4. Verify client cache can decrypt it

---

## Appendix A: ECIES Methods Removed in This Slice

| Method | Location | Replacement |
|--------|----------|-------------|
| `CryptoService.unwrapHubKey` | `crypto-service.ts:220-229` | `HpkeService.unwrapHubKey` |
| `CryptoService.generateAndWrapHubKey` | `crypto-service.ts:241-253` | `HpkeService.generateAndWrapHubKey` |
| `CryptoService.wrapHubKeyForNewMember` | `crypto-service.ts:259-270` | `HpkeService.wrapHubKeyForNewMember` |
| `CryptoService.getServerPubkey` | `crypto-service.ts:232-234` | `HpkeService.getServerPubkeyHex` |
| `hub-key-cache` ECIES unwrap | `hub-key-cache.ts:83-87` | `cryptoWorker.decrypt` (HPKE open) |
| `hubs.ts` ECIES response shape | `hubs.ts:665-670` | Return `HpkeEnvelope` directly |

## Appendix B: Envelope Shape Transition

| Context | Before (ECIES) | After (HPKE) |
|---------|---------------|--------------|
| Server generateAndWrapHubKey | `[{ pubkey, wrappedKey, ephemeralPubkey }]` | `[{ pubkeyHex, envelope: { v:3, labelId, enc, ct } }]` |
| Server wrapHubKeyForNewMember | `{ pubkey, wrappedKey, ephemeralPubkey }` | `{ pubkeyHex, envelope: { v:3, labelId, enc, ct } }` |
| Client cache receives | `{ wrappedKey, ephemeralPubkey }` | `{ v:3, labelId, enc, ct }` |
| DB stores (JSONB) | `{ pubkey, wrappedKey, ephemeralPubkey }` | `{ pubkey, v:3, labelId, enc, ct }` |

## Appendix C: Server Identity Transition

| Property | Before (ECIES) | After (HPKE) |
|----------|---------------|--------------|
| Key type | secp256k1 | X25519 |
| Pubkey format | 64-hex x-only secp256k1 | 64-hex raw X25519 |
| Hub key envelope | `{ pubkey, wrappedKey, ephemeralPubkey }` | `{ pubkeyHex, envelope: HpkeEnvelope }` |
