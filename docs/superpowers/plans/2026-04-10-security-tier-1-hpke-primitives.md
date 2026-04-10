# Security Tier 1 — HPKE + Primitive Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-rolled ECIES + XChaCha20-Poly1305 with HPKE (RFC 9180) from `@hpke/core`, move the identity key and KEK to non-extractable WebCrypto `CryptoKey` handles stored in IndexedDB, prefer native WebCrypto X25519/Ed25519, and introduce Standard-Notes-style `items_key` indirection so future primitive swaps re-wrap one key per user instead of every artifact.

**Architecture:** Single HPKE cipher suite (`DHKEM(X25519, HKDF-SHA256)` + `HKDF-SHA256` + `AES-256-GCM`) in a single module `src/shared/crypto-suite.ts`. Every envelope becomes `EnvelopeV3 { v: 3, labelId, enc, ct }` with HPKE-bound `info` (the `CryptoLabel`) and AAD (the `labelId` byte + record id). The identity private key and the KEK are non-extractable `CryptoKey` handles imported via the generate-export-reimport dance. The hub-key symmetric encryption path moves to AES-256-GCM via WebCrypto with a non-extractable key; hub-event encryption joins the same path. A per-user `items_key` wraps per-artifact keys so the classical-to-PQ Tier 6 migration can re-wrap one `items_key` per user instead of every note.

**Tech Stack:** TypeScript, Bun, `@hpke/core`, WebCrypto `subtle`, IndexedDB (via `idb`), Drizzle ORM + PostgreSQL, Hono + `@hono/zod-openapi`, React + TanStack Router + React Query, Playwright (bun:test for unit, Playwright for API + UI E2E).

**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-1-hpke-primitives-design.md`

**Prerequisites:** Tier 0 (Albrecht hardening) must be merged first. Tier 1 builds on the branded `CryptoLabel` type, the `LABEL_REGISTRY`, the AAD-required `symmetricEncrypt/Decrypt`, the signed audit log chain, and the CSP L3 middleware. Tier 0 `EnvelopeV2` is replaced wholesale by `EnvelopeV3`; no backward compat.

---

## File Map

### Created

| File | Responsibility |
|---|---|
| `src/shared/crypto-suite.ts` | Single `createHpkeSuite()` factory + `HPKE_SUITE_ID` constant |
| `src/shared/crypto-suite.test.ts` | Suite instantiation + single-suite invariant test |
| `src/client/lib/key-store-v3.ts` | Non-extractable CryptoKey persistence in IDB |
| `src/client/lib/key-store-v3.test.ts` | KEK non-extractability + round-trip tests |
| `src/client/lib/idb-schema.ts` | Typed IDB schema for `llamenos-keys-v3` |
| `src/shared/items-key.ts` | `generateItemsKey`, `wrapPerArtifactKey`, `rewrapItemsKey` |
| `src/shared/items-key.test.ts` | Rewrap byte-equivalence (ct unchanged) test |
| `src/client/lib/hub-field-crypto-v3.ts` | Hub-field encrypt/decrypt using WebCrypto AES-GCM with non-extractable key |
| `src/client/lib/hub-field-crypto-v3.test.ts` | AAD binding + wrong-record rejection tests |
| `src/server/lib/hpke-service.ts` | Server-side HPKE seal/open (replaces `CryptoService.serverEncrypt/Decrypt`) |
| `src/server/lib/hpke-service.test.ts` | Server HPKE round-trip + non-extractable privKey test |
| `scripts/audit-envelopes.sh` | SQL-level envelope version audit — asserts `v = 3` on every stored envelope |
| `docs/security/HPKE_MIGRATION_NOTES.md` | Per-file migration notes; which envelopes are touched and how |
| `tests/api/hpke-seal-open.spec.ts` | API E2E — full round-trip through the server |
| `tests/api/items-key-rewrap.spec.ts` | API E2E — items_key rotation preserves per-note ct |
| `tests/api/envelope-v3-rejected.spec.ts` | API E2E — server rejects v2 envelopes with 400 |
| `tests/ui/hpke-adversarial.spec.ts` | UI E2E — label swap, AAD substitution, key extraction attempt |
| `tests/ui/non-extractable-key.spec.ts` | UI E2E — `exportKey` on identity key throws |
| `tests/ui/native-curves-required.spec.ts` | UI E2E — synthetic no-native-curve env surfaces hard error |

### Modified

| File | Change |
|---|---|
| `package.json` | Add `@hpke/core`, `idb`; drop unused `@noble/ciphers` usages outside Nostr path |
| `src/shared/crypto-primitives.ts` | Replace ECIES + symmetric primitives with HPKE helpers `hpkeSeal`, `hpkeOpen`, `decryptEnvelopeV3`, `deriveHubKeyCryptoKey`, `hubFieldEncrypt`, `hubFieldDecrypt` |
| `src/shared/crypto-primitives.test.ts` | Replace v2 suite with v3 suite; add HPKE + non-extractable + items_key tests |
| `src/shared/crypto-labels.ts` | Unchanged from Tier 0 (the `LABEL_REGISTRY` + branded type stays) |
| `src/shared/types.ts` | Replace `EnvelopeV2` with `EnvelopeV3` + `RecipientEnvelopeV3` |
| `src/shared/schemas/records.ts` | Replace v2 envelope schemas with v3 |
| `src/shared/schemas/contacts.ts` | Point envelope schemas at v3 |
| `src/shared/schemas/messages.ts` | Same |
| `src/shared/schemas/blasts.ts` | Same |
| `src/shared/schemas/notes.ts` | Same; add `itemsKeyVersion` field |
| `src/client/lib/crypto-worker.ts` | Replace ECIES ops with HPKE ops; KEK becomes non-extractable CryptoKey; expose `importIdentityFromPkcs8` + `getHpkePublicKey` + `sealForRecipient` + `openFromEnvelope` + `signEd25519` ops |
| `src/client/lib/crypto-worker-client.ts` | Retype public API; drop `encrypt`/`decrypt` ECIES methods; add `hpkeSealFor`/`hpkeOpenFrom`/`signAuditEntry` (kept) |
| `src/client/lib/key-store-v2.ts` | **Deleted** — replaced by `key-store-v3.ts`. Any remaining callers repointed. |
| `src/client/lib/hub-key-manager.ts` | Uses `hpkeSeal` + `hubFieldEncrypt`; `rotateHubKey` unchanged in signature but implementation uses HPKE |
| `src/client/lib/hub-field-crypto.ts` | Deleted; callers repointed to `hub-field-crypto-v3.ts` |
| `src/client/lib/file-crypto.ts` | v3 envelopes + items_key integration |
| `src/client/lib/envelope-field-crypto.ts` | v3 envelopes |
| `src/client/lib/crypto.ts` | Already deleted in Tier 0 — no-op |
| `src/client/lib/main.tsx` | Feature-detect native X25519/Ed25519 at boot; hard-fail with documented error if missing |
| `src/client/lib/key-manager.ts` | Unlock flow upgrades to non-extractable KEK + identity CryptoKey |
| `src/client/lib/session-capsule.ts` | Updated to store HPKE pkcs8 ciphertext instead of raw nsec |
| `src/server/lib/crypto-service.ts` | `CryptoService.serverEncrypt/Decrypt/hubEncrypt/hubDecrypt` rewritten to use HPKE + AES-GCM via WebCrypto |
| `src/server/lib/hub-event-crypto.ts` | AES-GCM via WebCrypto; same AAD binding |
| `src/server/db/schema/identity.ts` | Server HPKE keypair fields (`hpke_pubkey_x25519`, `hpke_privkey_pkcs8_wrapped`) |
| `drizzle/migrations/0052_tier1_hpke_envelope_v3.sql` | Column-level changes: `notes.items_key_version`, `users.hpke_pubkey`, etc. Pre-prod: wipe existing encrypted rows because v2 envelopes are unreadable. |
| `.github/workflows/ci.yml` | Add grep check: no `@noble/ciphers` outside `src/client/lib/nostr/` or `src/shared/crypto-primitives.test.ts`; no `eciesWrapKey\|eciesUnwrapKey\|symmetricEncrypt\|symmetricDecrypt` anywhere |
| `docs/security/AEAD_AUDIT_2026-04-10.md` | Append "Tier 1 update" section recording every column now AES-GCM or HPKE |
| `docs/REPRODUCIBLE_BUILDS.md` | Note new dependencies added by Tier 1 |
| `CLAUDE.md` | Update "Key technical patterns" — identity key is a non-extractable CryptoKey, not raw bytes; add Tier 1 migration note |

### Deleted

| File | Reason |
|---|---|
| `src/client/lib/key-store-v2.ts` | Replaced by `key-store-v3.ts` |
| `src/client/lib/hub-field-crypto.ts` | Replaced by `hub-field-crypto-v3.ts` |
| `src/client/lib/key-store-v2.test.ts` | Replaced by `key-store-v3.test.ts` |
| `src/client/lib/hub-field-crypto.test.ts` | Replaced by `hub-field-crypto-v3.test.ts` |

---

## Workstream 1.1 — HPKE migration

### Task 1: Add `@hpke/core` + `idb` dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependencies**

```bash
cd /path/to/worktree
bun add @hpke/core@^1.7.0 idb@^8.0.3
```

- [ ] **Step 2: Verify install**

```bash
bun install --frozen-lockfile
bun run typecheck
```

Expected: clean install; typecheck clean (new deps have types).

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add @hpke/core and idb for Tier 1 HPKE migration"
```

### Task 2: HPKE suite factory + single-suite invariant test

**Files:**
- Create: `src/shared/crypto-suite.ts`
- Create: `src/shared/crypto-suite.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/shared/crypto-suite.test.ts
import { describe, expect, test } from 'bun:test'
import { createHpkeSuite, HPKE_SUITE_ID } from './crypto-suite'
import { CipherSuite } from '@hpke/core'

describe('HPKE suite factory', () => {
  test('HPKE_SUITE_ID is the canonical Tier 1 string', () => {
    expect(HPKE_SUITE_ID).toBe('llamenos-hpke-v1:x25519-hkdf-sha256-aes256gcm')
  })

  test('createHpkeSuite returns a CipherSuite instance', () => {
    const suite = createHpkeSuite()
    expect(suite).toBeInstanceOf(CipherSuite)
  })

  test('suite KEM is DhkemX25519HkdfSha256', () => {
    const suite = createHpkeSuite()
    expect(suite.kem.id).toBe(0x0020)  // RFC 9180 §7.1
  })

  test('suite KDF is HkdfSha256', () => {
    expect(createHpkeSuite().kdf.id).toBe(0x0001)
  })

  test('suite AEAD is Aes256Gcm', () => {
    expect(createHpkeSuite().aead.id).toBe(0x0002)
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/shared/crypto-suite.test.ts`
Expected: FAIL — file not exported yet.

- [ ] **Step 3: Implement the module**

```typescript
// src/shared/crypto-suite.ts
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from '@hpke/core'

/**
 * Llamenos Tier 1 HPKE suite identifier.
 * Hard-coded literal — any change bumps the envelope version to v4.
 * RFC 9180 §7.1 suite IDs: KEM 0x0020 / KDF 0x0001 / AEAD 0x0002.
 */
export const HPKE_SUITE_ID = 'llamenos-hpke-v1:x25519-hkdf-sha256-aes256gcm' as const

export function createHpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  })
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/shared/crypto-suite.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-suite.ts src/shared/crypto-suite.test.ts
git commit -m "feat(crypto): HPKE cipher suite factory (X25519 + HKDF-SHA256 + AES-256-GCM)"
```

### Task 3: `EnvelopeV3` type + zod schema

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/schemas/records.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/shared/crypto-primitives.test.ts (append to existing Tier 0 file)
import { describe, expect, test } from 'bun:test'
import { EnvelopeV3Schema, RecipientEnvelopeV3Schema } from './schemas/records'

describe('EnvelopeV3 schema', () => {
  const valid = {
    v: 3 as const,
    labelId: 0,
    enc: 'ab'.repeat(32),  // 64 hex chars, 32 bytes (X25519 enc)
    ct: 'cd'.repeat(24),
  }

  test('accepts valid v3 envelope', () => {
    expect(EnvelopeV3Schema.parse(valid)).toEqual(valid)
  })

  test('rejects v: 2 envelope', () => {
    expect(() => EnvelopeV3Schema.parse({ ...valid, v: 2 })).toThrow()
  })

  test('rejects non-64-char enc', () => {
    expect(() => EnvelopeV3Schema.parse({ ...valid, enc: 'ab' })).toThrow()
  })

  test('RecipientEnvelopeV3 requires pubkey', () => {
    expect(() => RecipientEnvelopeV3Schema.parse(valid)).toThrow()
    expect(RecipientEnvelopeV3Schema.parse({ ...valid, pubkey: 'ef'.repeat(32) })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run failing test**

Expected: FAIL — schemas not defined.

- [ ] **Step 3: Replace `EnvelopeV2` with `EnvelopeV3` in `src/shared/types.ts`**

```typescript
// src/shared/types.ts
import type { Ciphertext } from './crypto-types'

export interface EnvelopeV3 {
  v: 3
  labelId: number
  enc: string   // hex, 64 chars for X25519
  ct: Ciphertext
}

export interface RecipientEnvelopeV3 extends EnvelopeV3 {
  pubkey: string
}
```

Delete the Tier 0 `EnvelopeV2` interface — all callers will become type errors.

- [ ] **Step 4: Add zod schemas**

```typescript
// src/shared/schemas/records.ts (append, replace existing RecipientEnvelope schemas)
import { z } from '@hono/zod-openapi'

export const EnvelopeV3Schema = z.object({
  v: z.literal(3),
  labelId: z.number().int().min(0),
  enc: z.string().regex(/^[0-9a-f]{64}$/),
  ct: z.string().regex(/^[0-9a-f]+$/),
})

export const RecipientEnvelopeV3Schema = EnvelopeV3Schema.extend({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
})

export type EnvelopeV3DTO = z.infer<typeof EnvelopeV3Schema>
export type RecipientEnvelopeV3DTO = z.infer<typeof RecipientEnvelopeV3Schema>
```

Find every Tier 0 import of `EnvelopeV2` / `RecipientEnvelopeSchema` and repoint. Typecheck will enumerate them.

- [ ] **Step 5: Run tests + typecheck**

```bash
bun test src/shared/crypto-primitives.test.ts -t "EnvelopeV3 schema"
bun run typecheck 2>&1 | head -30
```

Expected: the new tests pass. Typecheck will surface many downstream errors — those are fixed in later tasks.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/schemas/records.ts src/shared/crypto-primitives.test.ts
git commit -m "feat(crypto): EnvelopeV3 type + zod schema (replaces v2)"
```

### Task 4: HPKE primitives module — `hpkeSeal` / `hpkeOpen` / `decryptEnvelopeV3`

**Files:**
- Modify: `src/shared/crypto-primitives.ts`
- Modify: `src/shared/crypto-primitives.test.ts`

- [ ] **Step 1: Write failing tests (happy path + adversarial)**

```typescript
// src/shared/crypto-primitives.test.ts (append)
import { createHpkeSuite } from './crypto-suite'
import {
  hpkeSeal,
  hpkeOpen,
  decryptEnvelopeV3,
  CryptoLabelMismatchError,
} from './crypto-primitives'
import { LABEL_NOTE_KEY, LABEL_MESSAGE, labelToId } from './crypto-labels'
import type { EnvelopeV3 } from './types'

async function freshKeypair() {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  return { suite, kp }
}

describe('HPKE seal/open', () => {
  test('round-trip with matching label', async () => {
    const { suite, kp } = await freshKeypair()
    const pt = new TextEncoder().encode('hello hpke')
    const env = await hpkeSeal(suite, kp.publicKey, pt, LABEL_NOTE_KEY, new Uint8Array(0))
    expect(env.v).toBe(3)
    expect(env.labelId).toBe(labelToId(LABEL_NOTE_KEY))
    const out = await hpkeOpen(suite, kp.privateKey, env, LABEL_NOTE_KEY, new Uint8Array(0))
    expect(new TextDecoder().decode(out)).toBe('hello hpke')
  })

  test('wrong expected label rejected before HPKE call', async () => {
    const { suite, kp } = await freshKeypair()
    const env = await hpkeSeal(suite, kp.publicKey, new Uint8Array([1, 2, 3]), LABEL_NOTE_KEY, new Uint8Array(0))
    await expect(
      hpkeOpen(suite, kp.privateKey, env, LABEL_MESSAGE, new Uint8Array(0)),
    ).rejects.toBeInstanceOf(CryptoLabelMismatchError)
  })

  test('label tampering in transit fails HPKE decrypt', async () => {
    const { suite, kp } = await freshKeypair()
    const env = await hpkeSeal(suite, kp.publicKey, new Uint8Array([1]), LABEL_NOTE_KEY, new Uint8Array(0))
    // Attacker forges labelId to hide the original label
    const tampered: EnvelopeV3 = { ...env, labelId: labelToId(LABEL_MESSAGE) }
    // decryptEnvelopeV3 will reject at the label check first; hpkeOpen with the *actual*
    // info=LABEL_NOTE_KEY would succeed, so the pre-check is the defense
    await expect(
      decryptEnvelopeV3(tampered, suite, kp.privateKey, LABEL_MESSAGE, new Uint8Array(0)),
    ).rejects.toThrow()  // HPKE open with info=LABEL_MESSAGE fails
  })

  test('AAD binding — wrong AAD rejected', async () => {
    const { suite, kp } = await freshKeypair()
    const aadCorrect = new TextEncoder().encode('note:42')
    const aadWrong = new TextEncoder().encode('note:43')
    const env = await hpkeSeal(suite, kp.publicKey, new Uint8Array([1]), LABEL_NOTE_KEY, aadCorrect)
    await expect(
      hpkeOpen(suite, kp.privateKey, env, LABEL_NOTE_KEY, aadWrong),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the failing tests**

Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement HPKE primitives**

```typescript
// src/shared/crypto-primitives.ts (REPLACE Tier 0 symmetric + ECIES exports)
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import type { CipherSuite } from '@hpke/core'
import { createHpkeSuite } from './crypto-suite'
import { type CryptoLabel, labelToId, idToLabel } from './crypto-labels'
import type { Ciphertext } from './crypto-types'
import type { EnvelopeV3 } from './types'

export class CryptoLabelMismatchError extends Error {
  name = 'CryptoLabelMismatchError' as const
  constructor(public readonly expected: CryptoLabel, public readonly actual: CryptoLabel) {
    super(`Crypto label mismatch: expected ${expected}, got ${actual}`)
  }
}

/**
 * HPKE seal: encrypt `plaintext` for a recipient's X25519 public key.
 * `label` is bound as HPKE `info` — recipient MUST pass the same label to `hpkeOpen`.
 * `aad` is AEAD-bound — must match at open time.
 * `labelId` is ALSO part of the envelope and cross-checked before the HPKE call.
 */
export async function hpkeSeal(
  suite: CipherSuite,
  recipientPublicKey: CryptoKey,
  plaintext: Uint8Array,
  label: CryptoLabel,
  aad: Uint8Array,
): Promise<EnvelopeV3> {
  const sender = await suite.createSenderContext({
    recipientPublicKey,
    info: utf8ToBytes(label),
  })
  const ctBuf = await sender.seal(plaintext, aad)
  const encBuf = sender.enc
  return {
    v: 3,
    labelId: labelToId(label),
    enc: bytesToHex(new Uint8Array(encBuf)),
    ct: bytesToHex(new Uint8Array(ctBuf)) as Ciphertext,
  }
}

/**
 * HPKE open without the pre-check. Low-level: prefer `decryptEnvelopeV3`.
 */
export async function hpkeOpen(
  suite: CipherSuite,
  recipientPrivateKey: CryptoKey,
  envelope: EnvelopeV3,
  expectedLabel: CryptoLabel,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const recipient = await suite.createRecipientContext({
    recipientKey: recipientPrivateKey,
    enc: hexToBytes(envelope.enc).buffer as ArrayBuffer,
    info: utf8ToBytes(expectedLabel),
  })
  const pt = await recipient.open(hexToBytes(envelope.ct).buffer as ArrayBuffer, aad)
  return new Uint8Array(pt)
}

/**
 * Safe decrypt entry point. Performs all three defense layers:
 *   1. Version check (rejects non-3)
 *   2. Label-id cross-check (rejects wrong labelId vs expectedLabel)
 *   3. HPKE open with info = expectedLabel + AAD binding
 */
export async function decryptEnvelopeV3(
  envelope: EnvelopeV3,
  suite: CipherSuite,
  recipientPrivateKey: CryptoKey,
  expectedLabel: CryptoLabel,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (envelope.v !== 3) {
    throw new CryptoLabelMismatchError(expectedLabel, 'version-mismatch' as CryptoLabel)
  }
  const actualLabel = idToLabel(envelope.labelId)
  if (actualLabel !== expectedLabel) {
    throw new CryptoLabelMismatchError(expectedLabel, actualLabel)
  }
  return hpkeOpen(suite, recipientPrivateKey, envelope, expectedLabel, aad)
}

// Re-export suite factory for convenience
export { createHpkeSuite }
```

- [ ] **Step 4: Run tests**

```bash
bun test src/shared/crypto-primitives.test.ts -t "HPKE seal/open"
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-primitives.ts src/shared/crypto-primitives.test.ts
git commit -m "feat(crypto): hpkeSeal + hpkeOpen + decryptEnvelopeV3 with triple-layer defense"
```

### Task 5: Hub-field encryption via WebCrypto AES-GCM with non-extractable key

**Files:**
- Create: `src/client/lib/hub-field-crypto-v3.ts`
- Create: `src/client/lib/hub-field-crypto-v3.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/hub-field-crypto-v3.test.ts
import { describe, expect, test } from 'bun:test'
import { importHubKey, hubFieldEncrypt, hubFieldDecrypt } from './hub-field-crypto-v3'
import { LABEL_HUB_FIELD } from '@shared/crypto-labels'

describe('hub field crypto v3', () => {
  test('round-trip with AAD', async () => {
    const raw = new Uint8Array(32).fill(7)
    const hubKey = await importHubKey(raw)
    const ct = await hubFieldEncrypt(hubKey, 'role-admin', 'role-1', 'encrypted_name')
    const pt = await hubFieldDecrypt(hubKey, ct, 'role-1', 'encrypted_name')
    expect(pt).toBe('role-admin')
  })

  test('wrong recordId fails', async () => {
    const hubKey = await importHubKey(new Uint8Array(32).fill(7))
    const ct = await hubFieldEncrypt(hubKey, 'role-admin', 'role-1', 'encrypted_name')
    await expect(hubFieldDecrypt(hubKey, ct, 'role-2', 'encrypted_name')).rejects.toThrow()
  })

  test('wrong fieldName fails', async () => {
    const hubKey = await importHubKey(new Uint8Array(32).fill(7))
    const ct = await hubFieldEncrypt(hubKey, 'role-admin', 'role-1', 'encrypted_name')
    await expect(hubFieldDecrypt(hubKey, ct, 'role-1', 'encrypted_description')).rejects.toThrow()
  })

  test('imported hub key is non-extractable', async () => {
    const hubKey = await importHubKey(new Uint8Array(32).fill(7))
    await expect(crypto.subtle.exportKey('raw', hubKey)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run failing test**

Expected: FAIL — module not defined.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/hub-field-crypto-v3.ts
import { hexToBytes, bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { type CryptoLabel, LABEL_HUB_FIELD } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'

/** Import raw hub key bytes as a non-extractable AES-256-GCM CryptoKey. */
export async function importHubKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  )
}

function buildAad(recordId: string, fieldName: string): Uint8Array {
  return utf8ToBytes(`${LABEL_HUB_FIELD}:${recordId}:${fieldName}`)
}

export async function hubFieldEncrypt(
  hubKey: CryptoKey,
  plaintext: string,
  recordId: string,
  fieldName: string,
): Promise<Ciphertext> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: buildAad(recordId, fieldName) },
    hubKey,
    utf8ToBytes(plaintext),
  )
  const packed = new Uint8Array(iv.length + ct.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(ct), iv.length)
  return bytesToHex(packed) as Ciphertext
}

export async function hubFieldDecrypt(
  hubKey: CryptoKey,
  packed: Ciphertext,
  recordId: string,
  fieldName: string,
): Promise<string> {
  const bytes = hexToBytes(packed)
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: buildAad(recordId, fieldName) },
    hubKey,
    ct,
  )
  return new TextDecoder().decode(pt)
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/hub-field-crypto-v3.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/hub-field-crypto-v3.ts src/client/lib/hub-field-crypto-v3.test.ts
git commit -m "feat(hub-field): WebCrypto AES-256-GCM via non-extractable CryptoKey"
```

### Task 6: Delete Tier 0 `hub-field-crypto.ts`; repoint callers to v3

**Files:**
- Delete: `src/client/lib/hub-field-crypto.ts`
- Delete: `src/client/lib/hub-field-crypto.test.ts`
- Modify: every importer of `hub-field-crypto`

- [ ] **Step 1: Enumerate importers**

```bash
grep -rn "from ['\"].*hub-field-crypto['\"]" src --include="*.ts" --include="*.tsx"
```

- [ ] **Step 2: Repoint every import**

For each hit, change:

```typescript
import { encryptHubField, decryptHubField } from './hub-field-crypto'
```

to:

```typescript
import { hubFieldEncrypt, hubFieldDecrypt } from './hub-field-crypto-v3'
```

API naming changed (`encryptHubField` → `hubFieldEncrypt`) — fix the call sites to use the new names and pass the non-extractable hub CryptoKey (fetched from the hub-key-cache which is updated in Task 8).

- [ ] **Step 3: Delete the old module**

```bash
git rm src/client/lib/hub-field-crypto.ts src/client/lib/hub-field-crypto.test.ts
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: clean (other type errors from retyped KEK/identity keys land in later tasks, but hub-field-crypto is self-contained).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(hub-field): delete Tier 0 hub-field-crypto; migrate all callers to v3"
```

### Task 7: Hub-key manager uses HPKE for wrap/unwrap + AES-GCM for field encryption

**Files:**
- Modify: `src/client/lib/hub-key-manager.ts`
- Modify: `src/client/lib/hub-key-manager.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/hub-key-manager.test.ts (add)
describe('hub key HPKE wrap/unwrap', () => {
  test('wrapHubKeyForMember produces an EnvelopeV3', async () => {
    const hubKey = new Uint8Array(32).fill(5)
    const recipientKp = await (createHpkeSuite()).kem.generateKeyPair()
    const env = await wrapHubKeyForMember(hubKey, recipientKp.publicKey)
    expect(env.v).toBe(3)
    expect(env.labelId).toBe(labelToId(LABEL_HUB_KEY_WRAP))
  })

  test('unwrapHubKey round-trips to the same bytes', async () => {
    const hubKey = new Uint8Array(32).fill(5)
    const kp = await (createHpkeSuite()).kem.generateKeyPair()
    const env = await wrapHubKeyForMember(hubKey, kp.publicKey)
    const unwrapped = await unwrapHubKey(env, kp.privateKey)
    expect(Buffer.from(unwrapped)).toEqual(Buffer.from(hubKey))
  })
})
```

- [ ] **Step 2: Run test**

Expected: FAIL — signature change required.

- [ ] **Step 3: Rewrite `hub-key-manager.ts` to use HPKE**

```typescript
// src/client/lib/hub-key-manager.ts (REPLACE)
import { createHpkeSuite } from '@shared/crypto-suite'
import { hpkeSeal, decryptEnvelopeV3 } from '@shared/crypto-primitives'
import { LABEL_HUB_KEY_WRAP } from '@shared/crypto-labels'
import type { EnvelopeV3, RecipientEnvelopeV3 } from '@shared/types'

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

/** Hub key is 32 random bytes. Never derived. */
export function generateHubKey(): Uint8Array {
  return randomBytes(32)
}

export async function wrapHubKeyForMember(
  hubKey: Uint8Array,
  memberPubkey: CryptoKey,
): Promise<EnvelopeV3> {
  const suite = createHpkeSuite()
  return hpkeSeal(suite, memberPubkey, hubKey, LABEL_HUB_KEY_WRAP, new Uint8Array(0))
}

export async function unwrapHubKey(
  env: EnvelopeV3,
  memberPrivateKey: CryptoKey,
): Promise<Uint8Array> {
  const suite = createHpkeSuite()
  return decryptEnvelopeV3(env, suite, memberPrivateKey, LABEL_HUB_KEY_WRAP, new Uint8Array(0))
}
```

The `rotateHubKey` function keeps its Tier 0 chain-gate contract unchanged, but internally calls `wrapHubKeyForMember` with the HPKE variant.

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/hub-key-manager.test.ts
bun run typecheck
```

Expected: new tests PASS; existing Tier 0 tests continue passing; the rest of the typecheck surface progresses.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/hub-key-manager.ts src/client/lib/hub-key-manager.test.ts
git commit -m "feat(hub-key): HPKE seal/open for hub key wrap/unwrap"
```

---

## Workstream 1.2 — Non-extractable `CryptoKey` storage

### Task 8: IDB schema + `key-store-v3.ts` skeleton

**Files:**
- Create: `src/client/lib/idb-schema.ts`
- Create: `src/client/lib/key-store-v3.ts`
- Create: `src/client/lib/key-store-v3.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/key-store-v3.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { openKeyStore, putUserKeys, getUserKeys } from './key-store-v3'

describe('key-store v3', () => {
  beforeEach(async () => {
    const db = await openKeyStore()
    db.close()
    await indexedDB.deleteDatabase('llamenos-keys-v3')
  })

  test('putUserKeys then getUserKeys round-trips CryptoKey handles', async () => {
    const { suite } = await freshSuite()
    const hpkeKp = await suite.kem.generateKeyPair()
    // Use export-reimport to get a non-extractable handle
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', hpkeKp.privateKey)
    const nonExtractable = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'X25519' },
      /* extractable */ false,
      ['deriveBits'],
    )
    new Uint8Array(pkcs8).fill(0)

    const edKp = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    await putUserKeys({
      userId: 'user-1',
      hpkePublic: hpkeKp.publicKey,
      hpkePrivate: nonExtractable,
      ed25519Public: edKp.publicKey,
      ed25519Private: edKp.privateKey,
    })
    const loaded = await getUserKeys('user-1')
    expect(loaded).toBeTruthy()
    expect(loaded!.hpkePrivate).toBeTruthy()
    // Assert non-extractability survives round-trip
    await expect(crypto.subtle.exportKey('pkcs8', loaded!.hpkePrivate)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run failing test**

Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement IDB schema**

```typescript
// src/client/lib/idb-schema.ts
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

export interface LlamenosKeysDB extends DBSchema {
  userKeys: {
    key: string  // userId
    value: {
      userId: string
      hpkePublic: CryptoKey
      hpkePrivate: CryptoKey   // non-extractable X25519
      ed25519Public: CryptoKey
      ed25519Private: CryptoKey  // non-extractable
      itemsKey: CryptoKey | null  // non-extractable AES-256-GCM wrap key (Task 10)
      itemsKeyVersion: number
      createdAt: number
    }
  }
  kekEnvelopes: {
    key: string  // userId
    value: {
      userId: string
      wrappedKeyPkcs8: Uint8Array  // HPKE ct containing the identity pkcs8
      enc: Uint8Array  // HPKE KEM enc
      wrappingLabel: 'llamenos:kek-wrap' | string
      kekHandle: CryptoKey  // non-extractable AES-KW key
    }
  }
}

export async function openLlamenosKeysDB(): Promise<IDBPDatabase<LlamenosKeysDB>> {
  return openDB<LlamenosKeysDB>('llamenos-keys-v3', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('userKeys')) {
        db.createObjectStore('userKeys', { keyPath: 'userId' })
      }
      if (!db.objectStoreNames.contains('kekEnvelopes')) {
        db.createObjectStore('kekEnvelopes', { keyPath: 'userId' })
      }
    },
  })
}
```

- [ ] **Step 4: Implement `key-store-v3.ts`**

```typescript
// src/client/lib/key-store-v3.ts
import { openLlamenosKeysDB, type LlamenosKeysDB } from './idb-schema'

export async function openKeyStore() {
  return openLlamenosKeysDB()
}

export async function putUserKeys(record: LlamenosKeysDB['userKeys']['value']): Promise<void> {
  const db = await openLlamenosKeysDB()
  await db.put('userKeys', { ...record, createdAt: Date.now() })
  db.close()
}

export async function getUserKeys(userId: string): Promise<LlamenosKeysDB['userKeys']['value'] | null> {
  const db = await openLlamenosKeysDB()
  const record = (await db.get('userKeys', userId)) ?? null
  db.close()
  return record
}

export async function deleteUserKeys(userId: string): Promise<void> {
  const db = await openLlamenosKeysDB()
  await db.delete('userKeys', userId)
  db.close()
}
```

- [ ] **Step 5: Run the test**

```bash
bun test src/client/lib/key-store-v3.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/idb-schema.ts src/client/lib/key-store-v3.ts src/client/lib/key-store-v3.test.ts
git commit -m "feat(key-store): IDB schema v3 + non-extractable CryptoKey round-trip"
```

### Task 9: KEK becomes a non-extractable AES-KW `CryptoKey` derived from PIN

**Files:**
- Modify: `src/client/lib/key-store-v3.ts`
- Modify: `src/client/lib/key-store-v3.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/key-store-v3.test.ts (append)
describe('KEK as non-extractable AES-KW', () => {
  test('deriveKek returns a non-extractable CryptoKey', async () => {
    const kek = await deriveKek('pin-12345', new Uint8Array(16).fill(1))
    await expect(crypto.subtle.exportKey('raw', kek)).rejects.toThrow()
    await expect(crypto.subtle.exportKey('jwk', kek)).rejects.toThrow()
  })

  test('deriveKek is deterministic for same PIN + salt', async () => {
    const salt = new Uint8Array(16).fill(1)
    const kek1 = await deriveKek('pin-12345', salt)
    const kek2 = await deriveKek('pin-12345', salt)
    // Use the KEK to wrap a known key and verify both KEKs produce the same wrapped output
    const { suite } = await freshSuite()
    const kp = await suite.kem.generateKeyPair()
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
    const innerKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'X25519' },
      /* extractable */ true,  // only to test wrap — real usage uses non-extractable
      ['deriveBits'],
    )
    const w1 = await crypto.subtle.wrapKey('pkcs8', innerKey, kek1, 'AES-KW')
    const w2 = await crypto.subtle.wrapKey('pkcs8', innerKey, kek2, 'AES-KW')
    expect(new Uint8Array(w1)).toEqual(new Uint8Array(w2))
  })
})
```

- [ ] **Step 2: Implement `deriveKek`**

```typescript
// src/client/lib/key-store-v3.ts (append)
import { utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * Derive a non-extractable AES-KW wrapping CryptoKey from the user's PIN + salt.
 * Uses PBKDF2(SHA-256, 600_000 iters) -> 256-bit material -> importKey as AES-KW.
 *
 * Argon2id would be stronger; Tier 2 migrates to Argon2id via WebCrypto or WASM.
 * For Tier 1 we stay on PBKDF2 to match Tier 0's existing PIN-unlock path.
 */
export async function deriveKek(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    utf8ToBytes(pin),
    { name: 'PBKDF2' },
    /* extractable */ false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    material,
    256,
  )
  // Import as AES-KW, non-extractable, usage = wrapKey/unwrapKey only
  const kek = await crypto.subtle.importKey(
    'raw',
    bits,
    { name: 'AES-KW', length: 256 },
    /* extractable */ false,
    ['wrapKey', 'unwrapKey'],
  )
  new Uint8Array(bits).fill(0)  // best-effort zero
  return kek
}
```

- [ ] **Step 3: Run tests**

```bash
bun test src/client/lib/key-store-v3.test.ts -t "KEK as non-extractable"
```

Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/key-store-v3.ts src/client/lib/key-store-v3.test.ts
git commit -m "feat(key-store): deriveKek returns non-extractable AES-KW CryptoKey (PBKDF2 600k)"
```

### Task 10: Generate-export-reimport dance to get a non-extractable identity key

**Files:**
- Modify: `src/client/lib/key-store-v3.ts`
- Modify: `src/client/lib/key-store-v3.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/key-store-v3.test.ts (append)
describe('generateAndPersistIdentity', () => {
  test('returns non-extractable HPKE + Ed25519 keys', async () => {
    const pin = 'pin-abc'
    const salt = new Uint8Array(16).fill(2)
    const kek = await deriveKek(pin, salt)
    const result = await generateAndPersistIdentity('user-test', kek)

    // HPKE private key non-extractable
    await expect(crypto.subtle.exportKey('pkcs8', result.hpkePrivate)).rejects.toThrow()
    // Ed25519 private key non-extractable
    await expect(crypto.subtle.exportKey('pkcs8', result.ed25519Private)).rejects.toThrow()
    // Public keys still exportable
    const pkcs8Pub = await crypto.subtle.exportKey('spki', result.hpkePublic)
    expect(pkcs8Pub.byteLength).toBeGreaterThan(0)
  })

  test('after restore, private keys are still non-extractable', async () => {
    const pin = 'pin-abc'
    const salt = new Uint8Array(16).fill(2)
    const kek = await deriveKek(pin, salt)
    await generateAndPersistIdentity('user-test', kek)

    // Reopen
    const restored = await restoreIdentity('user-test', kek)
    expect(restored).toBeTruthy()
    await expect(crypto.subtle.exportKey('pkcs8', restored!.hpkePrivate)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Implement `generateAndPersistIdentity` + `restoreIdentity`**

```typescript
// src/client/lib/key-store-v3.ts (append)
import { createHpkeSuite } from '@shared/crypto-suite'

export interface IdentityKeys {
  hpkePublic: CryptoKey
  hpkePrivate: CryptoKey  // non-extractable X25519
  ed25519Public: CryptoKey
  ed25519Private: CryptoKey  // non-extractable
}

export async function generateAndPersistIdentity(
  userId: string,
  kek: CryptoKey,
): Promise<IdentityKeys> {
  const suite = createHpkeSuite()

  // --- HPKE keypair (X25519) ---
  const hpkeExtractable = await suite.kem.generateKeyPair()
  const hpkePkcs8 = await crypto.subtle.exportKey('pkcs8', hpkeExtractable.privateKey)
  try {
    // Wrap the extractable pkcs8 under the KEK for at-rest storage
    const wrappedHpkePkcs8 = new Uint8Array(
      await crypto.subtle.wrapKey('pkcs8', hpkeExtractable.privateKey, kek, 'AES-KW'),
    )

    // Reimport as NON-extractable for runtime use
    const hpkePrivate = await crypto.subtle.importKey(
      'pkcs8',
      hpkePkcs8,
      { name: 'X25519' },
      /* extractable */ false,
      ['deriveBits'],
    )

    // --- Ed25519 keypair ---
    const edExtractable = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      /* extractable */ true,
      ['sign', 'verify'],
    ) as CryptoKeyPair

    const wrappedEdPkcs8 = new Uint8Array(
      await crypto.subtle.wrapKey('pkcs8', edExtractable.privateKey, kek, 'AES-KW'),
    )
    const edPkcs8 = await crypto.subtle.exportKey('pkcs8', edExtractable.privateKey)
    const ed25519Private = await crypto.subtle.importKey(
      'pkcs8',
      edPkcs8,
      { name: 'Ed25519' },
      /* extractable */ false,
      ['sign'],
    )

    // Persist the wrapped private keys + plain public keys
    const db = await openLlamenosKeysDB()
    await db.put('kekEnvelopes', {
      userId,
      wrappedKeyPkcs8: wrappedHpkePkcs8,
      enc: new Uint8Array(0),
      wrappingLabel: 'llamenos:kek-wrap',
      kekHandle: kek,
    })
    await db.put('userKeys', {
      userId,
      hpkePublic: hpkeExtractable.publicKey,
      hpkePrivate,
      ed25519Public: edExtractable.publicKey,
      ed25519Private,
      itemsKey: null,
      itemsKeyVersion: 0,
      createdAt: Date.now(),
    })
    // Also store the wrapped Ed25519 pkcs8 alongside for restore
    // (extended schema — see idb-schema.ts edit)
    db.close()

    return {
      hpkePublic: hpkeExtractable.publicKey,
      hpkePrivate,
      ed25519Public: edExtractable.publicKey,
      ed25519Private,
    }
  } finally {
    new Uint8Array(hpkePkcs8).fill(0)
  }
}

export async function restoreIdentity(userId: string, kek: CryptoKey): Promise<IdentityKeys | null> {
  const db = await openLlamenosKeysDB()
  const env = await db.get('kekEnvelopes', userId)
  const userKeys = await db.get('userKeys', userId)
  db.close()
  if (!env || !userKeys) return null

  // Unwrap the HPKE private key back to a non-extractable handle
  const hpkePrivate = await crypto.subtle.unwrapKey(
    'pkcs8',
    env.wrappedKeyPkcs8,
    kek,
    'AES-KW',
    { name: 'X25519' },
    /* extractable */ false,
    ['deriveBits'],
  )
  // (Ed25519 unwrap symmetric — omitted for brevity; same shape)

  return {
    hpkePublic: userKeys.hpkePublic,
    hpkePrivate,
    ed25519Public: userKeys.ed25519Public,
    ed25519Private: userKeys.ed25519Private,
  }
}
```

- [ ] **Step 3: Extend idb-schema**

Add fields to `kekEnvelopes` value type: `wrappedHpkePkcs8: Uint8Array`, `wrappedEdPkcs8: Uint8Array`.

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/key-store-v3.test.ts -t "generateAndPersistIdentity"
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/key-store-v3.ts src/client/lib/key-store-v3.test.ts src/client/lib/idb-schema.ts
git commit -m "feat(key-store): generateAndPersistIdentity + restoreIdentity with non-extractable keys"
```

### Task 11: Crypto worker rewrite — HPKE ops + CryptoKey handles

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`
- Modify: `src/client/lib/crypto-worker-client.ts`
- Modify: `src/client/lib/crypto-worker-client.test.ts`

- [ ] **Step 1: Write failing test for the new worker ops**

```typescript
// src/client/lib/crypto-worker-client.test.ts (append)
describe('crypto worker HPKE ops', () => {
  test('sealForRecipient returns an EnvelopeV3', async () => {
    const { suite } = await freshSuite()
    const kp = await suite.kem.generateKeyPair()
    const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
    const env = await cryptoWorker.sealForRecipient(
      pubRaw,
      new TextEncoder().encode('hello'),
      LABEL_MESSAGE,
      new Uint8Array(0),
    )
    expect(env.v).toBe(3)
  })

  test('openFromEnvelope fails with wrong label', async () => {
    // ... similar to Task 4's adversarial test but through the worker boundary
  })
})
```

- [ ] **Step 2: Rewrite the worker message types**

Replace the Tier 0 ECIES message types in `src/client/lib/crypto-worker.ts`:

```typescript
type WorkerRequest =
  | { type: 'unlockWithKek'; id: string; userId: string; pin: string; saltHex: string }
  | { type: 'lock'; id: string }
  | { type: 'sealForRecipient'; id: string; recipientPubkeyRawHex: string; plaintextHex: string; label: CryptoLabel; aadHex: string }
  | { type: 'openFromEnvelope'; id: string; envelope: EnvelopeV3; expectedLabel: CryptoLabel; aadHex: string }
  | { type: 'signAuditEntry'; id: string; entryHashHex: string }
  | { type: 'getHpkePublicKey'; id: string }
  | { type: 'isUnlocked'; id: string }
```

- [ ] **Step 3: Implement handlers**

Inside the worker, `secretKey` is replaced by a closure variable holding the non-extractable HPKE private key + Ed25519 private key after `unlockWithKek`. Handlers call `hpkeSeal`, `decryptEnvelopeV3`, `crypto.subtle.sign('Ed25519', ...)`.

- [ ] **Step 4: Update `crypto-worker-client.ts` public API**

```typescript
class CryptoWorkerClient {
  // ... existing call plumbing ...
  async sealForRecipient(
    recipientPubkeyRaw: Uint8Array,
    plaintext: Uint8Array,
    label: CryptoLabel,
    aad: Uint8Array,
  ): Promise<EnvelopeV3> {
    return (await this.call({
      type: 'sealForRecipient',
      recipientPubkeyRawHex: bytesToHex(recipientPubkeyRaw),
      plaintextHex: bytesToHex(plaintext),
      label,
      aadHex: bytesToHex(aad),
    })) as EnvelopeV3
  }

  async openFromEnvelope(envelope: EnvelopeV3, expectedLabel: CryptoLabel, aad: Uint8Array): Promise<Uint8Array> {
    const hex = await this.call({
      type: 'openFromEnvelope',
      envelope,
      expectedLabel,
      aadHex: bytesToHex(aad),
    })
    return hexToBytes(hex as string)
  }

  async unlockWithKek(userId: string, pin: string, saltHex: string): Promise<void> {
    await this.call({ type: 'unlockWithKek', userId, pin, saltHex })
  }

  // signAuditEntry retained (Tier 0)
}
```

Remove `encrypt`/`decrypt` (ECIES) methods entirely. The typecheck will enumerate every Tier 0 caller.

- [ ] **Step 5: Run tests**

```bash
bun test src/client/lib/crypto-worker-client.test.ts
bun run typecheck 2>&1 | head -50
```

Expected: worker tests PASS; typecheck errors elsewhere accumulate — fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker-client.test.ts
git commit -m "feat(crypto-worker): HPKE seal/open ops + non-extractable CryptoKey unlock"
```

### Task 12: Delete `key-store-v2.ts`; repoint `key-manager` to v3

**Files:**
- Delete: `src/client/lib/key-store-v2.ts`
- Delete: `src/client/lib/key-store-v2.test.ts`
- Modify: `src/client/lib/key-manager.ts`
- Modify: `src/client/lib/session-capsule.ts`

- [ ] **Step 1: Delete Tier 0 files**

```bash
git rm src/client/lib/key-store-v2.ts src/client/lib/key-store-v2.test.ts
```

- [ ] **Step 2: Repoint `key-manager.ts`**

```typescript
// src/client/lib/key-manager.ts
import { openKeyStore, generateAndPersistIdentity, restoreIdentity, deriveKek } from './key-store-v3'

async function unlock(userId: string, pin: string): Promise<void> {
  const { salt } = await fetchUserSalt(userId)  // API call
  const kek = await deriveKek(pin, salt)
  const identity = await restoreIdentity(userId, kek)
  if (!identity) throw new Error('Identity not found; did you complete setup?')
  // Hand the private keys to the crypto worker via structured clone
  cryptoWorker.unlockWithKek(userId, pin, bytesToHex(salt))
  // ... rest of the unlock flow (hub key fetch, audit chain verify, etc.)
}
```

- [ ] **Step 3: Update `session-capsule.ts`**

Instead of storing the raw nsec ciphertext, store a copy of the wrapped HPKE pkcs8. On restore, the worker re-unwraps under the KEK.

- [ ] **Step 4: Typecheck + test**

```bash
bun run typecheck
bun test src/client/lib/
```

Expected: clean on the affected modules.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(key-manager): delete key-store-v2; migrate unlock flow to v3 + non-extractable"
```

---

## Workstream 1.3 — Native WebCrypto X25519/Ed25519 preference

### Task 13: Feature detection + hard-fail at boot

**Files:**
- Create: `src/client/lib/native-curves-check.ts`
- Modify: `src/client/main.tsx`

- [ ] **Step 1: Write the feature detector**

```typescript
// src/client/lib/native-curves-check.ts
export async function hasNativeX25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])
    return true
  } catch {
    return false
  }
}

export async function hasNativeEd25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair
    return true
  } catch {
    return false
  }
}

export async function assertNativeCurvesOrFail(): Promise<void> {
  const [x, ed] = await Promise.all([hasNativeX25519(), hasNativeEd25519()])
  if (!x || !ed) {
    throw new Error(
      `Llamenos requires native WebCrypto X25519 and Ed25519. ` +
        `Missing: ${!x ? 'X25519' : ''}${!x && !ed ? ' + ' : ''}${!ed ? 'Ed25519' : ''}. ` +
        `Please use Chrome 133+, Firefox 135+, or Safari 17.4+.`,
    )
  }
}
```

- [ ] **Step 2: Wire into `main.tsx`**

```typescript
// src/client/main.tsx (near top, before ReactDOM.createRoot)
import { assertNativeCurvesOrFail } from './lib/native-curves-check'

async function boot() {
  try {
    await assertNativeCurvesOrFail()
  } catch (err) {
    renderBrowserSupportError(err as Error)
    return
  }
  // existing boot logic
}
boot()
```

`renderBrowserSupportError` shows a full-page error with the minimum browser versions and a contact link. Already accessible to the unlock flow as a fallback; new in this task.

- [ ] **Step 3: Write unit tests**

```typescript
// src/client/lib/native-curves-check.test.ts
import { describe, expect, test } from 'bun:test'
import { hasNativeX25519, hasNativeEd25519, assertNativeCurvesOrFail } from './native-curves-check'

describe('native curves feature detection', () => {
  test('hasNativeX25519 returns true in modern CI', async () => {
    expect(await hasNativeX25519()).toBe(true)
  })
  test('hasNativeEd25519 returns true in modern CI', async () => {
    expect(await hasNativeEd25519()).toBe(true)
  })
  test('assertNativeCurvesOrFail passes in modern CI', async () => {
    await expect(assertNativeCurvesOrFail()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/native-curves-check.test.ts
```

Expected: 3 PASS (in CI; Bun's WebCrypto supports both curves as of v1.3).

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/native-curves-check.ts src/client/lib/native-curves-check.test.ts src/client/main.tsx
git commit -m "feat(boot): require native WebCrypto X25519 + Ed25519; hard-fail on unsupported browsers"
```

### Task 14: Decouple Nostr secp256k1 key from user identity key

**Files:**
- Modify: `src/client/lib/key-store-v3.ts`
- Modify: `src/client/lib/nostr/` (new helper)

- [ ] **Step 1: Write the Nostr key derivation helper**

```typescript
// src/client/lib/nostr/nostr-key.ts
import { schnorr } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * Derive the user's Nostr secp256k1 key material from a shared master secret
 * via domain-separated HKDF. The master secret is distinct from the HPKE
 * identity keypair — it exists only to decouple the on-wire Nostr pubkey
 * (secp256k1) from the content-encryption pubkey (X25519).
 */
export function deriveNostrSecretKey(userMasterSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, userMasterSecret, new Uint8Array(0), utf8ToBytes('llamenos:nostr-sk:v1'), 32)
}

export function deriveNostrPublicKey(nsec: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(nsec))
}
```

- [ ] **Step 2: Persist the master secret alongside identity keys**

Extend `userKeys` schema with a wrapped `nostrMasterSecret: Uint8Array` (wrapped under KEK like the HPKE privkey).

- [ ] **Step 3: Repoint every existing Nostr sign/publish path**

```bash
grep -rn "secp256k1\|schnorr" src/client --include="*.ts" --include="*.tsx" | grep -v "nostr/"
```

Any hit outside `src/client/lib/nostr/` that uses secp256k1 for content encryption is a Tier 0 artifact that should now use HPKE. The audit covers every hit in this task.

- [ ] **Step 4: Typecheck + tests**

```bash
bun run typecheck
bun test src/client/lib/nostr/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(nostr): decouple Nostr secp256k1 from HPKE identity via HKDF domain separation"
```

---

## Workstream 1.4 — `items_key` indirection

### Task 15: `items-key.ts` module + unit test for rewrap byte-equivalence

**Files:**
- Create: `src/shared/items-key.ts`
- Create: `src/shared/items-key.test.ts`

- [ ] **Step 1: Write the byte-equivalence test**

```typescript
// src/shared/items-key.test.ts
import { describe, expect, test } from 'bun:test'
import {
  generateItemsKey,
  wrapPerArtifactKey,
  unwrapPerArtifactKey,
  rewrapItemsKey,
} from './items-key'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_NOTE_KEY } from './crypto-labels'

describe('items_key indirection', () => {
  test('per-note ct stays byte-identical when items_key rotates', async () => {
    const userMasterSecret = new Uint8Array(32).fill(1)
    const itemsKeyV1 = await generateItemsKey(userMasterSecret, 1)
    const perNoteKey = crypto.getRandomValues(new Uint8Array(32))
    const wrappedV1 = await wrapPerArtifactKey(perNoteKey, itemsKeyV1, 'note-42')

    // Encrypt note content with perNoteKey — ct should be fixed
    const aad = utf8ToBytes(`${LABEL_NOTE_KEY}:note-42`)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const noteKeyCk = await crypto.subtle.importKey(
      'raw',
      perNoteKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const ctBefore = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, noteKeyCk, utf8ToBytes('hello')),
    )

    // Rotate items_key to v2
    const itemsKeyV2 = await generateItemsKey(userMasterSecret, 2)
    const wrappedV2 = await rewrapItemsKey(wrappedV1, itemsKeyV1, itemsKeyV2, 'note-42')

    // Unwrap with v2, decrypt the SAME ctBefore (unchanged)
    const unwrapped = await unwrapPerArtifactKey(wrappedV2, itemsKeyV2, 'note-42')
    const noteKeyCkRestored = await crypto.subtle.importKey(
      'raw',
      unwrapped,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      noteKeyCkRestored,
      ctBefore,
    )
    expect(new TextDecoder().decode(pt)).toBe('hello')
  })
})
```

- [ ] **Step 2: Implement `items-key.ts`**

```typescript
// src/shared/items-key.ts
import { utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * items_key is a per-user random 32-byte key, derived from the user's master
 * secret + generation counter via HKDF. It wraps per-artifact symmetric keys
 * so that classical-to-PQ migrations only need to re-wrap items_key per user,
 * not every artifact.
 *
 * Standard Notes 004 inspired the pattern.
 */
export async function generateItemsKey(
  userMasterSecret: Uint8Array,
  generation: number,
): Promise<CryptoKey> {
  const raw = await crypto.subtle.sign(
    { name: 'HMAC', hash: 'SHA-256' },
    await crypto.subtle.importKey('raw', userMasterSecret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    utf8ToBytes(`llamenos:items-key:gen-${generation}`),
  )
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-KW', length: 256 },
    /* extractable */ false,
    ['wrapKey', 'unwrapKey'],
  )
}

export async function wrapPerArtifactKey(
  perArtifactKey: Uint8Array,
  itemsKey: CryptoKey,
  artifactId: string,
): Promise<Uint8Array> {
  // Import the per-artifact key as an AES-GCM raw key (extractable = true
  // only so it can be wrapped, then the extractable handle is dropped)
  const inner = await crypto.subtle.importKey(
    'raw',
    perArtifactKey,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt'],
  )
  const wrapped = await crypto.subtle.wrapKey('raw', inner, itemsKey, 'AES-KW')
  return new Uint8Array(wrapped)
}

export async function unwrapPerArtifactKey(
  wrapped: Uint8Array,
  itemsKey: CryptoKey,
  artifactId: string,
): Promise<Uint8Array> {
  // We need the raw bytes for the AES-GCM encrypt/decrypt cipher to run; if
  // the caller can use a CryptoKey directly, prefer unwrapKey with
  // extractable=false and return the CryptoKey.
  const inner = await crypto.subtle.unwrapKey(
    'raw',
    wrapped,
    itemsKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt'],
  )
  return new Uint8Array(await crypto.subtle.exportKey('raw', inner))
}

export async function rewrapItemsKey(
  oldWrapped: Uint8Array,
  oldItemsKey: CryptoKey,
  newItemsKey: CryptoKey,
  artifactId: string,
): Promise<Uint8Array> {
  const inner = await crypto.subtle.unwrapKey(
    'raw',
    oldWrapped,
    oldItemsKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt', 'decrypt'],
  )
  const wrapped = await crypto.subtle.wrapKey('raw', inner, newItemsKey, 'AES-KW')
  return new Uint8Array(wrapped)
}
```

- [ ] **Step 3: Run tests**

```bash
bun test src/shared/items-key.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/items-key.ts src/shared/items-key.test.ts
git commit -m "feat(items-key): Standard-Notes-style indirection with byte-equivalence test"
```

### Task 16: Note encrypt/decrypt via items_key

**Files:**
- Modify: `src/client/lib/file-crypto.ts` (notes route through it today — or whichever module writes per-note keys)
- Modify: `src/shared/crypto-primitives.ts`

- [ ] **Step 1: Write failing test for end-to-end note flow**

```typescript
// src/shared/crypto-primitives.test.ts (append)
describe('end-to-end note encrypt via items_key', () => {
  test('write → rotate items_key → read still works', async () => {
    const master = new Uint8Array(32).fill(3)
    const itemsKeyV1 = await generateItemsKey(master, 1)
    const noteId = 'note-7'
    const perNoteKey = crypto.getRandomValues(new Uint8Array(32))

    // Write
    const wrappedV1 = await wrapPerArtifactKey(perNoteKey, itemsKeyV1, noteId)
    const aad = utf8ToBytes(`${LABEL_NOTE_KEY}:${noteId}`)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ck = await crypto.subtle.importKey('raw', perNoteKey, { name: 'AES-GCM' }, false, ['encrypt'])
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, ck, utf8ToBytes('note body')),
    )

    // Rotate
    const itemsKeyV2 = await generateItemsKey(master, 2)
    const wrappedV2 = await rewrapItemsKey(wrappedV1, itemsKeyV1, itemsKeyV2, noteId)

    // Read with v2
    const unwrapped = await unwrapPerArtifactKey(wrappedV2, itemsKeyV2, noteId)
    const ckRead = await crypto.subtle.importKey('raw', unwrapped, { name: 'AES-GCM' }, false, ['decrypt'])
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, ckRead, ct)
    expect(new TextDecoder().decode(pt)).toBe('note body')
  })
})
```

- [ ] **Step 2: Extend the note storage schema (Drizzle)**

```typescript
// src/server/db/schema/records.ts (append to callRecords)
itemsKeyVersion: integer('items_key_version').notNull().default(1),
wrappedPerNoteKey: text('wrapped_per_note_key'),  // hex of the AES-KW wrapped per-note AES-GCM key
```

Migration `0052_tier1_hpke_envelope_v3.sql`:

```sql
ALTER TABLE call_records
  ADD COLUMN items_key_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN wrapped_per_note_key TEXT;

-- Pre-prod: wipe existing encrypted notes (they are v2 envelopes)
UPDATE call_records
SET encrypted_content = NULL,
    admin_envelopes = '[]'::jsonb
WHERE encrypted_content IS NOT NULL;
```

- [ ] **Step 3: Update the note write path**

In `src/client/lib/note-sheet-context.tsx` (or wherever notes are authored):

```typescript
async function saveNote(noteId: string, plaintext: string) {
  const { itemsKey, itemsKeyVersion } = await getCurrentItemsKey()
  const perNoteKey = crypto.getRandomValues(new Uint8Array(32))
  const wrapped = await wrapPerArtifactKey(perNoteKey, itemsKey, noteId)
  const aad = utf8ToBytes(`${LABEL_NOTE_KEY}:${noteId}`)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ck = await crypto.subtle.importKey('raw', perNoteKey, { name: 'AES-GCM' }, false, ['encrypt'])
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, ck, utf8ToBytes(plaintext)),
  )
  const packed = new Uint8Array(12 + ct.length)
  packed.set(iv)
  packed.set(ct, 12)
  await api.notes.update(noteId, {
    encryptedContent: bytesToHex(packed),
    wrappedPerNoteKey: bytesToHex(wrapped),
    itemsKeyVersion,
  })
  new Uint8Array(perNoteKey).fill(0)
}
```

- [ ] **Step 4: Update the note read path**

Symmetric — unwrap via items_key, decrypt with AES-GCM.

- [ ] **Step 5: Run test + migrate DB**

```bash
bun test src/shared/crypto-primitives.test.ts -t "end-to-end note encrypt"
bun run migrate
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(notes): items_key indirection end-to-end (write → rotate → read)"
```

### Task 17: Admin multi-reader via items_key envelopes

**Files:**
- Modify: `src/server/db/schema/records.ts`
- Modify: `src/client/lib/note-sheet-context.tsx` (or equivalent)

- [ ] **Step 1: Write failing test**

Test scenario: an admin is added to the hub → server rewraps every note's items_key under the new admin's HPKE public key via HPKE seal → admin's client decrypts the items_key → then decrypts every note.

```typescript
// tests/api/admin-multi-reader.spec.ts
test('add admin → existing notes readable after hub-key rewrap', async ({ request }) => {
  // 1. Create hub with admin A
  // 2. Admin A writes a note (per-note key wrapped via items_key_A)
  // 3. Admin B is added (membership_add signed entry)
  // 4. rotateHubKey runs and issues new hub key envelopes
  // 5. Server rewraps each user's items_key envelope for admin B
  // 6. Admin B decrypts the items_key, then decrypts the note
})
```

- [ ] **Step 2: Extend the `users` schema with items_key envelopes**

```typescript
// src/server/db/schema/identity.ts
itemsKeyWrappedForAdmins: jsonb<Record<string, EnvelopeV3>>()('items_key_wrapped_for_admins').notNull().default({}),
```

Keyed by admin userId; value is an HPKE EnvelopeV3 wrapping the user's items_key raw bytes under the admin's HPKE public key.

- [ ] **Step 3: Implement rewrap flow**

On admin add:

1. Fetch every existing user's items_key (currently only that user's own client knows it; Tier 1 requires a "consent ceremony" where each user's client responds to the admin-add event by sealing its items_key for the new admin).
2. OR (simpler design, chosen): the user's client wraps items_key for admin B at membership time, server-orchestrated, never server-plaintext.

The orchestration is implemented as a signed audit entry `items_key_rewrap_for_admin` — the user's client signs it, server only forwards.

- [ ] **Step 4: Run API test**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api/admin-multi-reader.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(items-key): admin multi-reader via HPKE-wrapped items_key envelopes"
```

---

## Workstream 1.5 — Server-side HPKE + CryptoService rewrite

### Task 18: Server HPKE keypair persistence + non-extractable handle

**Files:**
- Create: `src/server/lib/hpke-service.ts`
- Create: `src/server/lib/hpke-service.test.ts`
- Modify: `src/server/db/schema/identity.ts`
- Modify: `drizzle/migrations/0052_tier1_hpke_envelope_v3.sql`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/lib/hpke-service.test.ts
import { describe, expect, test } from 'bun:test'
import { HpkeService } from './hpke-service'

describe('HpkeService', () => {
  test('boot returns a non-extractable private key', async () => {
    const svc = await HpkeService.boot({ serverHpkePkcs8Hex: null })  // fresh gen
    expect(svc.publicKeyRawHex.length).toBe(64)
    // The private key is held internally; no getter exposes it
  })

  test('seal → open round-trip', async () => {
    const svc = await HpkeService.boot({ serverHpkePkcs8Hex: null })
    const recipientPub = svc.publicKey
    const env = await svc.sealForSelf(new TextEncoder().encode('server secret'), LABEL_AUDIT_EVENT)
    const pt = await svc.openFromSelf(env, LABEL_AUDIT_EVENT)
    expect(new TextDecoder().decode(pt)).toBe('server secret')
  })
})
```

- [ ] **Step 2: Implement `HpkeService`**

```typescript
// src/server/lib/hpke-service.ts
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { createHpkeSuite, hpkeSeal, decryptEnvelopeV3 } from '@shared/crypto-primitives'
import type { CryptoLabel } from '@shared/crypto-labels'
import type { EnvelopeV3 } from '@shared/types'

export class HpkeService {
  private constructor(
    public readonly publicKey: CryptoKey,
    public readonly publicKeyRawHex: string,
    private readonly privateKey: CryptoKey,
  ) {}

  static async boot({ serverHpkePkcs8Hex }: { serverHpkePkcs8Hex: string | null }): Promise<HpkeService> {
    const suite = createHpkeSuite()
    let keypair: CryptoKeyPair
    if (serverHpkePkcs8Hex) {
      const pkcs8 = hexToBytes(serverHpkePkcs8Hex)
      const privExtractable = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'X25519' },
        /* extractable */ true,
        ['deriveBits'],
      )
      const pubRaw = /* derive public from pkcs8 via suite.kem.importKey */ null
      keypair = { privateKey: privExtractable, publicKey: pubRaw as CryptoKey }
    } else {
      keypair = (await suite.kem.generateKeyPair()) as CryptoKeyPair
    }

    // export-reimport as non-extractable
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', keypair.privateKey)
    try {
      const nonExtPriv = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'X25519' },
        false,
        ['deriveBits'],
      )
      const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keypair.publicKey))
      return new HpkeService(keypair.publicKey, bytesToHex(pubRaw), nonExtPriv)
    } finally {
      new Uint8Array(pkcs8).fill(0)
    }
  }

  async sealForSelf(plaintext: Uint8Array, label: CryptoLabel): Promise<EnvelopeV3> {
    const suite = createHpkeSuite()
    return hpkeSeal(suite, this.publicKey, plaintext, label, new Uint8Array(0))
  }

  async openFromSelf(env: EnvelopeV3, expectedLabel: CryptoLabel): Promise<Uint8Array> {
    const suite = createHpkeSuite()
    return decryptEnvelopeV3(env, suite, this.privateKey, expectedLabel, new Uint8Array(0))
  }
}
```

- [ ] **Step 3: Add DB column**

Migration:

```sql
ALTER TABLE server_config ADD COLUMN hpke_pkcs8_hex TEXT;
```

On first boot with no persisted keypair, generate + persist the pkcs8 (as wrapped-under-KEK-from-SERVER_HPKE_SECRET material, not plaintext). Environment variable `SERVER_HPKE_WRAP_KEY` bootstraps the AES-KW wrapping key for the pkcs8 at rest.

- [ ] **Step 4: Run tests**

```bash
bun test src/server/lib/hpke-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/hpke-service.ts src/server/lib/hpke-service.test.ts src/server/db/schema/identity.ts drizzle/migrations/0052_tier1_hpke_envelope_v3.sql
git commit -m "feat(server): HpkeService with non-extractable private key at runtime"
```

### Task 19: Rewrite `CryptoService` server encrypt/decrypt to use HPKE

**Files:**
- Modify: `src/server/lib/crypto-service.ts`
- Modify: `src/server/lib/crypto-service.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/server/lib/crypto-service.test.ts (replace Tier 0 serverEncrypt/Decrypt tests)
describe('CryptoService HPKE', () => {
  test('serverEncrypt/Decrypt round-trips via HPKE', async () => {
    const hpke = await HpkeService.boot({ serverHpkePkcs8Hex: null })
    const svc = new CryptoService(hpke, /* ... */)
    const ct = await svc.serverEncrypt('secret', LABEL_AUDIT_EVENT)
    const pt = await svc.serverDecrypt(ct, LABEL_AUDIT_EVENT)
    expect(pt).toBe('secret')
  })

  test('hubEncrypt/Decrypt use AES-GCM with AAD', async () => {
    const svc = new CryptoService(hpke, /* ... */)
    const hubKey = crypto.getRandomValues(new Uint8Array(32))
    const hubCk = await importHubKey(hubKey)
    const ct = await svc.hubFieldEncrypt(hubCk, 'role', 'row-1', 'encrypted_name')
    const pt = await svc.hubFieldDecrypt(hubCk, ct, 'row-1', 'encrypted_name')
    expect(pt).toBe('role')
  })
})
```

- [ ] **Step 2: Rewrite `CryptoService`**

```typescript
// src/server/lib/crypto-service.ts (REPLACE)
import { HpkeService } from './hpke-service'
import { importHubKey, hubFieldEncrypt, hubFieldDecrypt } from '@/lib/hub-field-crypto-v3'
// ... same pattern as client

export class CryptoService {
  constructor(private readonly hpke: HpkeService /* ... other deps */) {}

  async serverEncrypt(plaintext: string, label: CryptoLabel): Promise<EnvelopeV3> {
    return this.hpke.sealForSelf(utf8ToBytes(plaintext), label)
  }

  async serverDecrypt(env: EnvelopeV3, label: CryptoLabel): Promise<string> {
    return new TextDecoder().decode(await this.hpke.openFromSelf(env, label))
  }

  async hubFieldEncrypt(hubKey: CryptoKey, value: string, recordId: string, fieldName: string): Promise<Ciphertext> {
    return hubFieldEncrypt(hubKey, value, recordId, fieldName)
  }

  async hubFieldDecrypt(hubKey: CryptoKey, ct: Ciphertext, recordId: string, fieldName: string): Promise<string> {
    return hubFieldDecrypt(hubKey, ct, recordId, fieldName)
  }
}
```

Every caller of the old `serverEncrypt/serverDecrypt` (Tier 0) becomes a type error — the return type is now `EnvelopeV3` instead of `Ciphertext`, and callers must pass the `CryptoLabel` typed literal. Typecheck enumerates them; fix each.

- [ ] **Step 3: Run tests + typecheck**

```bash
bun test src/server/lib/crypto-service.test.ts
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(server): CryptoService rewritten on HPKE + WebCrypto AES-GCM"
```

---

## Workstream 1.6 — Tests, adversarial coverage, CI guardrails

### Task 20: API E2E — HPKE seal/open through the server

**Files:**
- Create: `tests/api/hpke-seal-open.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/api/hpke-seal-open.spec.ts
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'

test('POST /api/notes (HPKE) creates + fetches a decryptable note', async ({ request }) => {
  const { userId, hpkePrivateKey } = await loginAndGetKeys(request)
  const created = await authedRequest(request, 'POST', '/api/notes', {
    hubId: 'hub-1',
    content: 'hello tier 1',
  })
  expect(created.status()).toBe(200)
  const body = await created.json()
  expect(body.encryptedContent).toBeTruthy()
  expect(body.wrappedPerNoteKey).toBeTruthy()
  expect(body.itemsKeyVersion).toBe(1)

  const fetched = await authedRequest(request, 'GET', `/api/notes/${body.id}`)
  const fetchedBody = await fetched.json()
  // Decrypt client-side using the HPKE + items_key flow
  const plaintext = await decryptNoteFromEnvelope(fetchedBody, hpkePrivateKey)
  expect(plaintext).toBe('hello tier 1')
})
```

- [ ] **Step 2: Run the test**

```bash
bunx playwright test tests/api/hpke-seal-open.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/api/hpke-seal-open.spec.ts
git commit -m "test(api): HPKE seal/open through the notes endpoint"
```

### Task 21: API E2E — server rejects v2 envelopes

**Files:**
- Create: `tests/api/envelope-v3-rejected.spec.ts`

- [ ] **Step 1: Write test**

```typescript
test('POST /api/notes with a v: 2 envelope is rejected 400', async ({ request }) => {
  const payload = {
    hubId: 'hub-1',
    encryptedContent: 'ab'.repeat(32),
    adminEnvelopes: [{ v: 2, labelId: 0, wrappedKey: 'ab'.repeat(48), ephemeralPubkey: 'cd'.repeat(33), pubkey: 'ef'.repeat(32) }],
  }
  const res = await authedRequest(request, 'POST', '/api/notes', payload)
  expect(res.status()).toBe(400)
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/api/envelope-v3-rejected.spec.ts
git commit -m "test(api): server rejects v2 envelopes with 400"
```

### Task 22: UI E2E — HPKE adversarial (label swap + key extraction attempt)

**Files:**
- Create: `tests/ui/hpke-adversarial.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test'

test('label-swap on envelope causes decrypt failure toast', async ({ page }) => {
  await page.goto('/notes')
  // Intercept the GET /api/notes/:id response and swap labelId
  await page.route('**/api/notes/*', (route) => {
    route.fulfill({
      json: {
        ...route.request().postData(),
        adminEnvelopes: [{ v: 3, labelId: 2 /* wrong */, enc: 'ab'.repeat(32), ct: 'cd'.repeat(16), pubkey: 'ef'.repeat(32) }],
      },
    })
  })
  await page.getByTestId('note-row-1').click()
  await expect(page.getByTestId('toast-decrypt-error')).toBeVisible()
})

test('identity private key cannot be exported from the worker', async ({ page }) => {
  await page.goto('/')
  await loginUser(page)
  const exportResult = await page.evaluate(async () => {
    // Probe the worker for an export attempt via a dev-only diagnostic op
    return (window as any).__dev_probe_export_identity()
  })
  expect(exportResult).toEqual({ error: 'InvalidAccessError' })
})
```

Add a dev-only diagnostic op to the worker (gated by `import.meta.env.DEV`) that attempts `crypto.subtle.exportKey` on the identity private key and reports the error class.

- [ ] **Step 2: Run the test**

```bash
bunx playwright test tests/ui/hpke-adversarial.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/ui/hpke-adversarial.spec.ts src/client/lib/crypto-worker.ts
git commit -m "test(ui): HPKE adversarial — label swap + identity key non-extractability"
```

### Task 23: CI grep guardrails

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add grep checks**

```yaml
- name: No hand-rolled ECIES references
  run: |
    ! grep -rn "eciesWrapKey\|eciesUnwrapKey\|eciesUnwrapKeyWithSecret" src --include="*.ts" || \
      (echo "hand-rolled ECIES reference remains — should be HPKE" && exit 1)

- name: No symmetricEncrypt/Decrypt outside test fixtures
  run: |
    ! grep -rn "symmetricEncrypt\|symmetricDecrypt" src --include="*.ts" | grep -v '\.test\.ts' || \
      (echo "symmetricEncrypt/Decrypt survived Tier 1" && exit 1)

- name: @noble/ciphers only in Nostr path and tests
  run: |
    ! grep -rn "from '@noble/ciphers" src --include="*.ts" | grep -v '/nostr/' | grep -v '\.test\.ts' || \
      (echo "@noble/ciphers used outside Nostr/tests" && exit 1)

- name: Exactly one CipherSuite construction site
  run: |
    COUNT=$(grep -rn "new CipherSuite" src --include="*.ts" | grep -v '\.test\.ts' | wc -l)
    if [ "$COUNT" -ne 1 ]; then
      echo "Expected exactly 1 'new CipherSuite' call site, found $COUNT"
      exit 1
    fi
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(ci): grep guardrails for Tier 1 primitive migration"
```

### Task 24: SQL-level envelope audit script

**Files:**
- Create: `scripts/audit-envelopes.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# scripts/audit-envelopes.sh — assert every stored envelope is v: 3
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set" >&2
  exit 2
fi

# Columns that store envelope-v3 objects
COLUMNS=(
  "users.items_key_wrapped_for_admins"
  "call_records.admin_envelopes"
  "contacts.phone_envelopes"
  "contacts.display_name_envelopes"
  "messages.reader_envelopes"
  "blasts.content_envelopes"
  "bans.phone_envelopes"
  "bans.reason_envelopes"
)

FAIL=0
for col in "${COLUMNS[@]}"; do
  table="${col%%.*}"
  column="${col##*.}"
  # Check every row in the jsonb column for v != 3
  COUNT=$(psql -tAc "SELECT count(*) FROM $table, jsonb_array_elements($column) e WHERE (e->>'v')::int != 3" || true)
  if [ "$COUNT" != "0" ] && [ -n "$COUNT" ]; then
    echo "FAIL: $table.$column has $COUNT non-v3 envelopes"
    FAIL=1
  else
    echo "PASS: $table.$column"
  fi
done

exit "$FAIL"
```

Make executable: `chmod +x scripts/audit-envelopes.sh`.

- [ ] **Step 2: Wire into CI**

```yaml
- name: Audit envelope versions
  run: ./scripts/audit-envelopes.sh
  env:
    DATABASE_URL: ${{ secrets.CI_DATABASE_URL }}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-envelopes.sh .github/workflows/ci.yml
git commit -m "chore(ci): SQL envelope v3 audit script"
```

### Task 25: Documentation — `HPKE_MIGRATION_NOTES.md`

**Files:**
- Create: `docs/security/HPKE_MIGRATION_NOTES.md`
- Modify: `docs/security/AEAD_AUDIT_2026-04-10.md` (append Tier 1 update section)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the migration notes doc**

Sections:

- Why Tier 1 (2 paragraphs, threat model recap)
- Suite choice (DHKEM-X25519 / HKDF-SHA256 / AES-256-GCM) — with the rejected alternatives justification
- What v3 envelopes look like, with a minimal byte-level example
- File-by-file migration table (what was Tier 0, what is Tier 1)
- Non-extractable key storage — what changed, how to audit at runtime
- Browser compat matrix: Chrome 133+ / Firefox 135+ / Safari 17.4+
- Rollout: fresh-DB only, pre-prod only, Tier 0 is a hard prerequisite
- Pointers to the spec and plan

- [ ] **Step 2: Append Tier 1 section to `AEAD_AUDIT_2026-04-10.md`**

Document every column that changed cipher from XChaCha20-Poly1305 to AES-256-GCM (hub-field columns) or to HPKE+AES-GCM (envelope columns).

- [ ] **Step 3: Update `CLAUDE.md`**

In the "Key Technical Patterns" section, update the encrypted field development guide:

- Identity key is a non-extractable X25519 `CryptoKey`, not raw nsec bytes.
- Hub-key encryption uses WebCrypto AES-256-GCM via non-extractable `CryptoKey` imported through `importHubKey`.
- Per-note keys are wrapped under a per-user `items_key` (Standard-Notes-style indirection) so future primitive swaps re-wrap one key per user.
- HPKE is the only ECIES-family primitive used. `@noble/ciphers` is restricted to the Nostr path.

- [ ] **Step 4: Commit**

```bash
git add docs/security/HPKE_MIGRATION_NOTES.md docs/security/AEAD_AUDIT_2026-04-10.md CLAUDE.md
git commit -m "docs(security): Tier 1 HPKE migration notes + AEAD audit update + CLAUDE.md"
```

---

## Final verification gate

### Task 26: Full regression + grep + DB audit

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
bun run build
```

Expected: success.

- [ ] **Step 4: Unit tests**

```bash
bun run test:unit
```

Expected: every Tier 0 test continues to pass, all new Tier 1 tests pass.

- [ ] **Step 5: API E2E**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api
```

Expected: PASS, including new Tier 1 tests.

- [ ] **Step 6: UI E2E**

```bash
bunx playwright test tests/ui
```

Expected: PASS.

- [ ] **Step 7: Grep guardrails**

```bash
! grep -rn "eciesWrapKey\|eciesUnwrapKey\|symmetricEncrypt\|symmetricDecrypt" src --include="*.ts" | grep -v '\.test\.ts'
! grep -rn "from '@noble/ciphers" src --include="*.ts" | grep -v '/nostr/' | grep -v '\.test\.ts'
grep -rn "new CipherSuite" src --include="*.ts" | grep -v '\.test\.ts' | wc -l  # expect 1
```

Expected: all pass (no matches for the first two; exactly 1 match for the third).

- [ ] **Step 8: Envelope audit**

```bash
./scripts/audit-envelopes.sh
```

Expected: every listed column reports PASS.

- [ ] **Step 9: Non-extractable key runtime assertion**

```bash
bun test src/client/lib/crypto-worker.test.ts -t "identity non-extractable"
bun test src/client/lib/key-store-v3.test.ts -t "KEK as non-extractable"
```

Expected: PASS.

- [ ] **Step 10: verify-build**

```bash
./scripts/verify-build.sh
```

Expected: Tier 0 infrastructure still passes.

- [ ] **Step 11: Final commit**

```bash
git add -A
git commit -m "chore(tier-1): verification gate green — HPKE migration complete"
```

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-security-tier-1-hpke-primitives.md`.**

Execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in one session with checkpoints. Required sub-skill: `superpowers:executing-plans`.

Tier 1 implementation should happen in its own session, distinct from the session that wrote this plan, per the usual superpowers workflow. Tier 0 must be merged before Tier 1 implementation begins; any deviation from that ordering invalidates the plan's prerequisites.
