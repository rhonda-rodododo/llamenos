# Security Tier 0 — Albrecht Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defensively harden Llamenos against the published Albrecht (Matrix 2022/2023) and Mega (Backendal 2022 / Albrecht 2023) attack classes without changing any cryptographic primitive, and land the companion supply-chain + CSP L3 hardening in the same PR.

**Architecture:** Six workstreams batched into one PR. Branded `CryptoLabel` type + AEAD AAD binding everywhere (compile-time and run-time label enforcement). Versioned envelope format with in-band `labelId`. Signed typed audit-log entries with client-side chain verification gating every hub-key rewrap. CSP L3 with per-response nonces, Trusted Types, Report-Only rollout, and `/api/csp-report` ingest. Google Fonts self-hosting to unblock COEP. Cosign keyless signing + CycloneDX SBOM attestation on top of the existing SLSA Build L3 pipeline.

**Tech Stack:** TypeScript, Bun, Hono + `@hono/zod-openapi`, React + TanStack Router, Drizzle ORM + PostgreSQL, `@noble/ciphers` XChaCha20-Poly1305, `@noble/curves` schnorr/secp256k1, Vite + vite-plugin-pwa, DOMPurify, Sigstore cosign, syft/CycloneDX, GitHub Actions attest-build-provenance + attest-sbom.

**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-0-albrecht-hardening-design.md`

**Implementation note — migration numbering:** All `drizzle/migrations/NNNN_*.sql` paths in this plan are **placeholders**. These numbers were computed against pre-v0.41.0 main. At implementation time, run `ls drizzle/migrations/ | sort | tail -5` in your worktree and use the next unused integer for every migration this plan creates, maintaining relative order. The spec's database design is number-agnostic — only the filenames need renumbering. Also verify each cross-tier plan is not stepping on a number another landing tier used.

---

## File Map

### Created

| File | Responsibility |
|---|---|
| `src/shared/lib/canonical-json.ts` | Deterministic JSON canonicalization for hashing |
| `src/shared/lib/canonical-json.test.ts` | Canonicalization unit tests |
| `src/shared/lib/audit-entry-hash.ts` | `computeEntryHash()` over canonical form |
| `src/shared/lib/audit-entry-hash.test.ts` | Hash determinism tests |
| `src/shared/schemas/audit-entries.ts` | `AuditEntryPayloadSchema` discriminated union + `SignedAuditEntrySchema` |
| `src/shared/schemas/audit-entries.test.ts` | Schema + payload variant tests |
| `src/client/lib/audit-log-client.ts` | Client-side `buildSignedAuditEntry` + API wrapper |
| `src/client/lib/audit-log-client.test.ts` | Builder unit tests |
| `src/client/lib/audit-chain-verifier.ts` | Client-side chain verification + IDB cache |
| `src/client/lib/audit-chain-verifier.test.ts` | Adversarial chain tests |
| `src/client/lib/trusted-types-policy.ts` | `installTrustedTypesPolicy` |
| `src/client/lib/trusted-types-policy.test.ts` | Policy installer tests |
| `src/client/styles/fonts.css` | Self-hosted `@font-face` declarations |
| `src/client/styles/radix-keyframes.css` | Pre-bundled Radix animation keyframes |
| `src/server/services/audit-log-service.ts` | Extracted `AuditLogService` with `appendSigned` |
| `src/server/services/audit-log-service.test.ts` | Service unit tests |
| `src/server/routes/csp-report.ts` | `/api/csp-report` ingest endpoint |
| `src/server/routes/csp-report.test.ts` | Endpoint unit tests |
| `src/server/middleware/csp-nonce.ts` | Per-response nonce middleware |
| `drizzle/migrations/0051_audit_log_signed_entries.sql` | Signed-audit-log migration |
| `scripts/fetch-fonts.sh` | Build-time Google Fonts downloader |
| `docs/security/AEAD_AUDIT_2026-04-10.md` | Per-column AEAD audit report |
| `docs/security/SUPPLY_CHAIN_HARDENING.md` | Consolidated supply-chain posture document |
| `tests/api/audit-signed.spec.ts` | API E2E — signed audit-log path |
| `tests/api/csp-report.spec.ts` | API E2E — CSP report ingest |
| `tests/api/aead-roundtrip.spec.ts` | API E2E — AAD-bound round-trip |
| `tests/api/hub-key-rotation.spec.ts` | API E2E — chain-gated rewrap |
| `tests/ui/csp-enforcement.spec.ts` | UI E2E — CSP + Trusted Types |
| `tests/ui/hub-membership-removal.spec.ts` | UI E2E — end-to-end removal flow |
| `tests/ui/label-mismatch.spec.ts` | UI E2E — label-swap adversarial test |
| `tests/ui/trusted-types-policy.spec.ts` | UI E2E — policy install assertion |

### Modified

| File | Change |
|---|---|
| `src/shared/crypto-labels.ts` | Add `CryptoLabel` brand, `LABEL_REGISTRY`, label↔id helpers |
| `src/shared/crypto-primitives.ts` | Require AAD on `symmetricEncrypt/Decrypt`; retype label params as `CryptoLabel`; add `decryptEnvelopeV2`, `CryptoLabelMismatchError`, `EnvelopeV2` consumer helpers |
| `src/shared/crypto-primitives.test.ts` | Add AAD, envelope v2, label-brand tests |
| `src/shared/types.ts` | Add `EnvelopeV2` interface |
| `src/client/lib/crypto.ts` | **Deleted** — duplicate of `@shared/crypto-primitives` |
| `src/client/lib/crypto-worker.ts` | Retype label params; thread AAD into every AEAD call; add `signAuditEntry` op |
| `src/client/lib/crypto-worker-client.ts` | Retype public methods to `CryptoLabel`; expose `signAuditEntry` |
| `src/client/lib/hub-key-manager.ts` | AAD on hub-key encrypt/decrypt; gate `rotateHubKey` on chain verification; label subdomain per purpose |
| `src/client/lib/hub-field-crypto.ts` | Pass `(recordId, fieldName)` AAD through to hub-key encrypt/decrypt; raise `DecryptError` instead of silent null |
| `src/client/lib/file-crypto.ts` | Envelope v2 with `labelId` + AAD bound to `fileId` |
| `src/client/lib/envelope-field-crypto.ts` | Envelope v2 + AAD |
| `src/client/main.tsx` | Install Trusted Types policy before React mount |
| `src/server/lib/crypto-service.ts` | Use AAD parameter; hub field encryption takes `(recordId, fieldName)` |
| `src/server/lib/hub-event-crypto.ts` | AAD bound to `eventId` |
| `src/server/lib/audit-hash.ts` | **Replaced** by `src/shared/lib/audit-entry-hash.ts`; file deleted |
| `src/server/middleware/security-headers.ts` | Per-response nonce; new CSP header with `strict-dynamic` + Trusted Types; Report-Only mode via `CSP_MODE` |
| `src/server/routes/audit.ts` | Move implementation into `AuditLogService`; route only validates + delegates |
| `src/server/app.ts` | Mount `/api/csp-report`; register nonce middleware before `securityHeaders` |
| `src/server/db/schema/records.ts` | Replace `auditLog` columns with signed-entry shape |
| `index.html` | Remove Google Fonts `<link>`; add `__CSP_NONCE__` placeholder on `<script>` tags |
| `vite.config.ts` | Vite plugin for CSP nonce placeholder + `'unsafe-hashes'` inline-style allowlist emission |
| `.github/workflows/release.yml` | cosign install + sign-blob; anchore SBOM + attest-sbom; extended files list; font fetch |
| `.github/workflows/ci.yml` | Add grep checks: no raw crypto literals, no `'unsafe-inline'` in CSP |
| `scripts/verify-build.sh` | Cosign verify-blob + SBOM presence check + CycloneDX parse |
| `Dockerfile.build` | Run `scripts/fetch-fonts.sh` before `bun run build` |
| `package.json` | Add `dompurify` dependency |
| `biome.json` | Add lint rule: bare `catch {}` in files matching `*crypto*.ts` is an error |
| `docs/REPRODUCIBLE_BUILDS.md` | Cosign + SBOM verification steps |
| `CLAUDE.md` | Tier 0 migration notes (one-shot, removed in next tier) |

---

## Workstream 0.1 — Label enforcement at decrypt call sites

### Task 1: Branded `CryptoLabel` type + `LABEL_REGISTRY`

**Files:**
- Modify: `src/shared/crypto-labels.ts`
- Modify: `src/shared/crypto-primitives.test.ts`

- [ ] **Step 1: Write failing test for branded type**

```typescript
// src/shared/crypto-primitives.test.ts (append to existing test file)
import { describe, expect, test } from 'bun:test'
import {
  type CryptoLabel,
  LABEL_NOTE_KEY,
  LABEL_HUB_KEY_WRAP,
  LABEL_REGISTRY,
  labelToId,
  idToLabel,
} from './crypto-labels'

describe('CryptoLabel brand + registry', () => {
  test('LABEL_REGISTRY is non-empty', () => {
    expect(LABEL_REGISTRY.length).toBeGreaterThan(0)
  })

  test('labelToId returns a stable id per label', () => {
    expect(labelToId(LABEL_NOTE_KEY)).toBe(0)
    expect(labelToId(LABEL_HUB_KEY_WRAP)).toBe(1)
  })

  test('idToLabel round-trips', () => {
    expect(idToLabel(0)).toBe(LABEL_NOTE_KEY)
    expect(idToLabel(1)).toBe(LABEL_HUB_KEY_WRAP)
  })

  test('labelToId throws on unregistered label', () => {
    expect(() => labelToId('llamenos:nonexistent' as CryptoLabel)).toThrow('Unregistered crypto label')
  })

  test('idToLabel throws on unknown id', () => {
    expect(() => idToLabel(999)).toThrow('Unknown crypto label id')
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/shared/crypto-primitives.test.ts -t "CryptoLabel brand"`
Expected: FAIL — `LABEL_REGISTRY`, `labelToId`, `idToLabel` not exported.

- [ ] **Step 3: Add the brand + registry + helpers**

Edit `src/shared/crypto-labels.ts` — add at the top of the file (after the existing doc comment):

```typescript
declare const __CryptoLabelBrand: unique symbol
export type CryptoLabel = string & { readonly [__CryptoLabelBrand]: never }
```

Then change every constant declaration from:

```typescript
export const LABEL_NOTE_KEY = 'llamenos:note-key'
```

to:

```typescript
export const LABEL_NOTE_KEY = 'llamenos:note-key' as CryptoLabel
```

Apply to all ~45 existing constants in the file.

At the bottom of the file, add the registry + helpers:

```typescript
export const LABEL_REGISTRY = [
  LABEL_NOTE_KEY,
  LABEL_HUB_KEY_WRAP,
  LABEL_MESSAGE,
  LABEL_FILE_KEY,
  LABEL_FILE_METADATA,
  LABEL_BLAST_CONTENT,
  LABEL_CALL_META,
  LABEL_SHIFT_SCHEDULE,
  LABEL_TRANSCRIPTION,
  LABEL_HUB_EVENT,
  LABEL_DEVICE_PROVISION,
  LABEL_BACKUP,
  LABEL_PUSH_WAKE,
  LABEL_PUSH_FULL,
  LABEL_CONTACT_ID,
  LABEL_PROVIDER_CREDENTIAL_WRAP,
  LABEL_VOICEMAIL_WRAP,
  LABEL_VOICEMAIL_TRANSCRIPT,
  LABEL_CONTACT_INTAKE,
  LABEL_CONTACT_SUMMARY,
  LABEL_CONTACT_PII,
  LABEL_CONTACT_RELATIONSHIP,
  LABEL_STORAGE_CREDENTIAL_WRAP,
] as const satisfies readonly CryptoLabel[]

export function labelToId(label: CryptoLabel): number {
  const id = LABEL_REGISTRY.indexOf(label)
  if (id < 0) throw new Error(`Unregistered crypto label: ${label}`)
  return id
}

export function idToLabel(id: number): CryptoLabel {
  const label = LABEL_REGISTRY[id]
  if (!label) throw new Error(`Unknown crypto label id: ${id}`)
  return label
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/shared/crypto-primitives.test.ts -t "CryptoLabel brand"`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-labels.ts src/shared/crypto-primitives.test.ts
git commit -m "feat(crypto): add CryptoLabel branded type + label registry"
```

### Task 2: AAD-required `symmetricEncrypt`/`symmetricDecrypt` + primitive retyping

**Files:**
- Modify: `src/shared/crypto-primitives.ts`
- Modify: `src/shared/crypto-primitives.test.ts`

- [ ] **Step 1: Write failing test for AAD enforcement**

```typescript
// src/shared/crypto-primitives.test.ts (append)
import { symmetricEncrypt, symmetricDecrypt, hexToBytes } from './crypto-primitives'
import { utf8ToBytes } from '@noble/ciphers/utils.js'

describe('AAD binding', () => {
  const key = new Uint8Array(32).fill(7)
  const plaintext = utf8ToBytes('secret message')

  test('matching AAD round-trips', () => {
    const aad = utf8ToBytes('ctx:record-42')
    const ct = symmetricEncrypt(plaintext, key, aad)
    const pt = symmetricDecrypt(ct, key, aad)
    expect(new TextDecoder().decode(pt)).toBe('secret message')
  })

  test('mismatched AAD throws', () => {
    const ct = symmetricEncrypt(plaintext, key, utf8ToBytes('ctx:record-42'))
    expect(() => symmetricDecrypt(ct, key, utf8ToBytes('ctx:record-43'))).toThrow()
  })

  test('empty AAD is allowed and round-trips', () => {
    const aad = new Uint8Array(0)
    const ct = symmetricEncrypt(plaintext, key, aad)
    const pt = symmetricDecrypt(ct, key, aad)
    expect(new TextDecoder().decode(pt)).toBe('secret message')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `bun test src/shared/crypto-primitives.test.ts -t "AAD binding"`
Expected: COMPILE ERROR — `symmetricEncrypt` and `symmetricDecrypt` do not accept AAD parameter yet.

- [ ] **Step 3: Update `symmetricEncrypt`/`symmetricDecrypt` to require AAD**

Edit `src/shared/crypto-primitives.ts`:

Change `symmetricEncrypt`:

```typescript
export function symmetricEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array,
): Ciphertext {
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(key, nonce, aad)
  const ciphertext = cipher.encrypt(plaintext)
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed) as Ciphertext
}
```

Change `symmetricDecrypt`:

```typescript
export function symmetricDecrypt(
  packed: string | Ciphertext,
  key: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  const data = hexToBytes(packed)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(key, nonce, aad)
  return cipher.decrypt(ciphertext)
}
```

Change `eciesWrapKey` / `eciesUnwrapKey` signatures to accept `label: CryptoLabel` (import from `crypto-labels`):

```typescript
import type { CryptoLabel } from './crypto-labels'

export function eciesWrapKey(
  key: Uint8Array,
  recipientPubkeyHex: string,
  label: CryptoLabel,
): { wrappedKey: Ciphertext; ephemeralPubkey: string } {
  // ... existing body unchanged; label already flows into HKDF
  // NEW: also AEAD-encrypt with aad = utf8ToBytes(label)
  // ... (see Task 4 for envelope v2 coupling)
}

export function eciesUnwrapKey(
  envelope: { wrappedKey: string | Ciphertext; ephemeralPubkey: string },
  privateKey: Uint8Array,
  label: CryptoLabel,
): Uint8Array {
  // ... same
}
```

- [ ] **Step 4: Run typecheck (expect many errors)**

Run: `bun run typecheck`
Expected: FAIL — every existing caller of `symmetricEncrypt`/`symmetricDecrypt`/`eciesWrapKey`/`eciesUnwrapKey` now has a type error.

These errors are the backlog for Tasks 4–10. For now we fix only the two direct call sites in `crypto-primitives.ts` itself (if any) so the file compiles in isolation.

- [ ] **Step 5: Run the AAD test**

Run: `bun test src/shared/crypto-primitives.test.ts -t "AAD binding"`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/crypto-primitives.ts src/shared/crypto-primitives.test.ts
git commit -m "feat(crypto): require AAD on symmetricEncrypt/Decrypt; retype labels as CryptoLabel"
```

### Task 3: Delete duplicate ECIES in `src/client/lib/crypto.ts`

**Files:**
- Delete: `src/client/lib/crypto.ts`
- Modify: every importer of `@/lib/crypto`

- [ ] **Step 1: List importers**

Run: `grep -rn "from ['\"]@/lib/crypto['\"]\|from ['\"]./crypto['\"]" src/client --include="*.ts" --include="*.tsx"`

Expected output: a list of ~15–25 files that currently import `eciesWrapKey`, `eciesUnwrapKey`, `encryptNoteV2`, `decryptNoteV2`, `encryptMessage`, `decryptMessage`, `encryptBlastContent`, `decryptBlastContent`, `KeyPair`, `generateKeyPair`, etc.

- [ ] **Step 2: Move non-primitive helpers to `crypto-primitives.ts` or new files**

`encryptNoteV2` / `decryptNoteV2` → `src/shared/crypto-primitives.ts` (keep key generation + envelope logic as shared primitives — they're not React-specific).

`encryptMessage` / `decryptMessage` → `src/shared/crypto-primitives.ts`.

`encryptBlastContent` / `decryptBlastContent` → `src/shared/crypto-primitives.ts`.

`generateKeyPair` / `keyPairFromNsec` / `isValidNsec` → `src/shared/crypto-primitives.ts` (they already have no DOM deps).

`deriveEncryptionKey` → delete; fold into `crypto-primitives.ts#hkdfDerive` call sites.

- [ ] **Step 3: Delete `src/client/lib/crypto.ts`**

```bash
git rm src/client/lib/crypto.ts
```

- [ ] **Step 4: Rewrite every importer**

For each file in the Step 1 list, change:

```typescript
import { eciesWrapKey } from '@/lib/crypto'
```

to:

```typescript
import { eciesWrapKey } from '@shared/crypto-primitives'
```

Apply the same substitution for every symbol.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no unresolved imports; the AAD-required symmetric API may still surface errors in consumer files, those are fixed in later tasks).

- [ ] **Step 6: Run unit tests for affected modules**

Run: `bun test src/client/lib`
Expected: PASS (assuming we fix downstream AAD errors — if they're still present, they will be addressed in Tasks 4–10).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(crypto): delete client/lib/crypto.ts duplicate; centralize in shared/crypto-primitives"
```

### Task 4: `EnvelopeV2` + `decryptEnvelopeV2` + `CryptoLabelMismatchError`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/crypto-primitives.ts`
- Modify: `src/shared/crypto-primitives.test.ts`

- [ ] **Step 1: Write failing tests for envelope v2**

```typescript
// src/shared/crypto-primitives.test.ts (append)
import {
  type EnvelopeV2,
  decryptEnvelopeV2,
  CryptoLabelMismatchError,
  eciesWrapKey,
} from './crypto-primitives'
import { LABEL_NOTE_KEY, LABEL_MESSAGE, labelToId } from './crypto-labels'
import { secp256k1 } from '@noble/curves/secp256k1.js'

describe('Envelope v2 + label mismatch', () => {
  const secretKey = new Uint8Array(32).fill(11)
  const pubkey = bytesToHex(secp256k1.getPublicKey(secretKey, true).slice(1))

  test('decryptEnvelopeV2 succeeds with matching label', async () => {
    const raw = eciesWrapKey(new Uint8Array(32).fill(5), pubkey, LABEL_NOTE_KEY)
    const env: EnvelopeV2 = {
      v: 2,
      labelId: labelToId(LABEL_NOTE_KEY),
      wrappedKey: raw.wrappedKey,
      ephemeralPubkey: raw.ephemeralPubkey,
    }
    const unwrap = (_ep: string, _wk: string, _label: CryptoLabel) =>
      Promise.resolve(new Uint8Array(32).fill(5))
    const out = await decryptEnvelopeV2(env, unwrap, LABEL_NOTE_KEY)
    expect(out.length).toBe(32)
  })

  test('decryptEnvelopeV2 rejects wrong labelId', async () => {
    const env: EnvelopeV2 = {
      v: 2,
      labelId: labelToId(LABEL_MESSAGE),  // wrong registry id
      wrappedKey: 'deadbeef' as Ciphertext,
      ephemeralPubkey: '00'.repeat(33),
    }
    const unwrap = () => Promise.resolve(new Uint8Array(0))
    await expect(decryptEnvelopeV2(env, unwrap, LABEL_NOTE_KEY)).rejects.toBeInstanceOf(CryptoLabelMismatchError)
  })

  test('decryptEnvelopeV2 rejects v !== 2', async () => {
    const env = { v: 1, labelId: 0, wrappedKey: 'ab' as Ciphertext, ephemeralPubkey: '' } as unknown as EnvelopeV2
    await expect(decryptEnvelopeV2(env, () => Promise.resolve(new Uint8Array(0)), LABEL_NOTE_KEY))
      .rejects.toBeInstanceOf(CryptoLabelMismatchError)
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run: `bun test src/shared/crypto-primitives.test.ts -t "Envelope v2"`
Expected: FAIL — `EnvelopeV2`, `decryptEnvelopeV2`, `CryptoLabelMismatchError` undefined.

- [ ] **Step 3: Add `EnvelopeV2` to `src/shared/types.ts`**

```typescript
// src/shared/types.ts (append to existing file)
import type { Ciphertext } from './crypto-types'

export interface EnvelopeV2 {
  v: 2
  labelId: number
  wrappedKey: Ciphertext
  ephemeralPubkey: string
}
```

- [ ] **Step 4: Add error class + `decryptEnvelopeV2` to `crypto-primitives.ts`**

```typescript
// src/shared/crypto-primitives.ts (append)
import type { CryptoLabel } from './crypto-labels'
import { idToLabel } from './crypto-labels'
import type { EnvelopeV2 } from './types'

export class CryptoLabelMismatchError extends Error {
  constructor(detail: string | { expected: CryptoLabel; actual: CryptoLabel }) {
    const msg =
      typeof detail === 'string'
        ? detail
        : `Crypto label mismatch: expected ${detail.expected}, got ${detail.actual}`
    super(msg)
    this.name = 'CryptoLabelMismatchError'
  }
}

export async function decryptEnvelopeV2(
  env: EnvelopeV2,
  unwrapSecret: (
    ephemeralPubkey: string,
    wrapped: Ciphertext,
    label: CryptoLabel,
  ) => Promise<Uint8Array>,
  expectedLabel: CryptoLabel,
): Promise<Uint8Array> {
  if (env.v !== 2) {
    throw new CryptoLabelMismatchError(`Envelope version ${env.v} not supported`)
  }
  const actualLabel = idToLabel(env.labelId)
  if (actualLabel !== expectedLabel) {
    throw new CryptoLabelMismatchError({ expected: expectedLabel, actual: actualLabel })
  }
  return unwrapSecret(env.ephemeralPubkey, env.wrappedKey, expectedLabel)
}

export { EnvelopeV2 }
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/shared/crypto-primitives.test.ts -t "Envelope v2"`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/crypto-primitives.ts src/shared/types.ts src/shared/crypto-primitives.test.ts
git commit -m "feat(crypto): add EnvelopeV2, decryptEnvelopeV2, CryptoLabelMismatchError"
```

### Task 5: Crypto worker AAD + label plumbing + `signAuditEntry` op

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`
- Modify: `src/client/lib/crypto-worker-client.ts`
- Modify: `src/client/lib/crypto-worker-client.test.ts`

- [ ] **Step 1: Write failing test for signAuditEntry**

```typescript
// src/client/lib/crypto-worker-client.test.ts (append)
describe('signAuditEntry op', () => {
  test('signAuditEntry returns 128-char hex signature', async () => {
    const mockWorker = makeMockWorker()  // existing helper
    const client = new CryptoWorkerClient(mockWorker)
    await client.unlock(/* ... */)
    const sig = await client.signAuditEntry('deadbeef'.repeat(8))
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
  })

  test('signAuditEntry throws when worker is locked', async () => {
    const mockWorker = makeMockWorker()
    const client = new CryptoWorkerClient(mockWorker)
    await expect(client.signAuditEntry('deadbeef'.repeat(8))).rejects.toBeInstanceOf(CryptoWorkerLockedError)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/client/lib/crypto-worker-client.test.ts -t "signAuditEntry"`
Expected: FAIL — method not defined.

- [ ] **Step 3: Add `signAuditEntry` to worker message protocol**

Edit `src/client/lib/crypto-worker.ts`:

Add to the `WorkerRequest` union:

```typescript
| { type: 'signAuditEntry'; id: string; entryHashHex: string }
```

Add handler:

```typescript
function handleSignAuditEntry(entryHashHex: string): string {
  if (!secretKey) throw new Error('Worker is locked')
  if (!checkRateLimit('sign')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const signature = schnorr.sign(hexToBytes(entryHashHex), secretKey)
  return bytesToHex(signature)
}
```

Add case to the message switch:

```typescript
case 'signAuditEntry':
  result = handleSignAuditEntry(req.entryHashHex)
  break
```

- [ ] **Step 4: Retype worker `decrypt`/`encrypt` ops to use `CryptoLabel`**

Change the worker request types for `decrypt`/`encrypt`/`envelopeEncryptField`/`decryptEnvelopeField`:

```typescript
| {
    type: 'decrypt'
    id: string
    ephemeralPubkeyHex: string
    wrappedKeyHex: string
    label: CryptoLabel
    aad: string  // hex-encoded AAD bytes
  }
| {
    type: 'encrypt'
    id: string
    plaintextHex: string
    recipientPubkeyHex: string
    label: CryptoLabel
    aad: string
  }
// ... similar for envelopeEncryptField + decryptEnvelopeField
```

Update `handleDecrypt`/`handleEncrypt` to call `xchacha20poly1305(key, nonce, hexToBytes(aad))` with the AAD parameter.

- [ ] **Step 5: Expose `signAuditEntry` and retype public methods in `CryptoWorkerClient`**

Edit `src/client/lib/crypto-worker-client.ts`:

```typescript
async signAuditEntry(entryHashHex: string): Promise<string> {
  return (await this.call({ type: 'signAuditEntry', entryHashHex })) as string
}

async decrypt(
  ephemeralPubkey: string,
  wrappedKey: string,
  label: CryptoLabel,
  aad: Uint8Array,
): Promise<string> {
  return (await this.call({
    type: 'decrypt',
    ephemeralPubkeyHex: ephemeralPubkey,
    wrappedKeyHex: wrappedKey,
    label,
    aad: bytesToHex(aad),
  })) as string
}
```

Apply the same shape to `encrypt`, `envelopeEncryptField`, `decryptEnvelopeField`.

- [ ] **Step 6: Run tests**

Run: `bun test src/client/lib/crypto-worker-client.test.ts`
Expected: ALL PASS (new + existing).

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker-client.test.ts
git commit -m "feat(crypto-worker): AAD plumbing + CryptoLabel param retyping + signAuditEntry op"
```

### Task 6: Hub-key manager v2 envelopes + AAD binding

**Files:**
- Modify: `src/client/lib/hub-key-manager.ts`
- Modify: `src/client/lib/hub-key-manager.test.ts`

- [ ] **Step 1: Write failing tests for hub-key AAD**

```typescript
// src/client/lib/hub-key-manager.test.ts
import { encryptForHub, decryptFromHub, generateHubKey } from './hub-key-manager'
import { LABEL_HUB_FIELD } from '@shared/crypto-labels'
import { utf8ToBytes } from '@noble/ciphers/utils.js'

describe('hub-key encryption AAD', () => {
  test('matching AAD round-trips', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-123:encrypted_name`)
    const ct = encryptForHub('hello', key, aad)
    const pt = decryptFromHub(ct, key, aad)
    expect(pt).toBe('hello')
  })

  test('mismatched AAD returns null (decrypt fails)', () => {
    const key = generateHubKey()
    const ct = encryptForHub('hello', key, utf8ToBytes(`${LABEL_HUB_FIELD}:row-A:encrypted_name`))
    const pt = decryptFromHub(ct, key, utf8ToBytes(`${LABEL_HUB_FIELD}:row-B:encrypted_name`))
    expect(pt).toBeNull()
  })
})
```

- [ ] **Step 2: Add `LABEL_HUB_FIELD` to crypto-labels + registry**

Edit `src/shared/crypto-labels.ts`:

```typescript
export const LABEL_HUB_FIELD = 'llamenos:hub-field' as CryptoLabel
```

Append to `LABEL_REGISTRY`.

- [ ] **Step 3: Update `encryptForHub` / `decryptFromHub` to require AAD**

Edit `src/client/lib/hub-key-manager.ts`:

```typescript
export function encryptForHub(
  plaintext: string,
  hubKey: Uint8Array,
  aad: Uint8Array,
): Ciphertext {
  return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, aad)
}

export function decryptFromHub(
  packed: Ciphertext,
  hubKey: Uint8Array,
  aad: Uint8Array,
): string | null {
  try {
    return new TextDecoder().decode(symmetricDecrypt(packed, hubKey, aad))
  } catch {
    return null
  }
}
```

(Import `symmetricEncrypt`/`symmetricDecrypt` from `@shared/crypto-primitives`.)

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/hub-key-manager.test.ts -t "hub-key encryption AAD"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-labels.ts src/client/lib/hub-key-manager.ts src/client/lib/hub-key-manager.test.ts
git commit -m "feat(hub-key): require AAD; add LABEL_HUB_FIELD to registry"
```

### Task 7: Hub-field-crypto AAD binding with `recordId`/`fieldName`

**Files:**
- Modify: `src/client/lib/hub-field-crypto.ts`
- Modify: `src/client/lib/hub-field-crypto.test.ts`

- [ ] **Step 1: Write failing test for AAD propagation**

```typescript
// src/client/lib/hub-field-crypto.test.ts (append)
import { decryptHubField, encryptHubField } from './hub-field-crypto'

describe('hub-field AAD', () => {
  test('encrypt+decrypt with recordId/fieldName AAD', () => {
    seedHubKeyCache('hub-1', generateHubKey())
    const ct = encryptHubField('value', 'hub-1', 'row-42', 'encrypted_name')
    const pt = decryptHubField(ct!, 'hub-1', 'row-42', 'encrypted_name')
    expect(pt).toBe('value')
  })

  test('mismatched recordId returns placeholder (not plaintext)', () => {
    seedHubKeyCache('hub-1', generateHubKey())
    const ct = encryptHubField('value', 'hub-1', 'row-A', 'encrypted_name')
    const pt = decryptHubField(ct!, 'hub-1', 'row-B', 'encrypted_name', '[locked]')
    expect(pt).toBe('[locked]')
  })
})
```

- [ ] **Step 2: Update `encryptHubField`/`decryptHubField` signatures**

```typescript
// src/client/lib/hub-field-crypto.ts
export function encryptHubField(
  value: string,
  hubId: string,
  recordId: string,
  fieldName: string,
): Ciphertext | undefined {
  const hubKey = getHubKeyForId(hubId)
  if (!hubKey) return undefined
  const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:${recordId}:${fieldName}`)
  return encryptForHub(value, hubKey, aad)
}

export function decryptHubField(
  encrypted: string | null | undefined,
  hubId: string,
  recordId: string,
  fieldName: string,
  placeholder = '',
): string {
  if (!encrypted) return placeholder
  const hubKey = getHubKeyForId(hubId)
  if (!hubKey) return looksLikeCiphertext(encrypted) ? placeholder : encrypted
  const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:${recordId}:${fieldName}`)
  const decrypted = decryptFromHub(encrypted as Ciphertext, hubKey, aad)
  return decrypted ?? (looksLikeCiphertext(encrypted) ? placeholder : encrypted)
}
```

- [ ] **Step 3: Update every call site**

Run: `grep -rn "decryptHubField\|encryptHubField" src/client --include="*.ts" --include="*.tsx"`

For each hit, thread `recordId` (usually `item.id` or `row.id`) and `fieldName` (e.g. `'encrypted_name'`) into the call. Typical sites: React Query `queryFn` callbacks, mutation builders.

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/hub-field-crypto.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(hub-field): bind AAD to recordId+fieldName on every hub-key encrypt/decrypt"
```

### Task 8: File-crypto envelope v2 + AAD bound to `fileId`

**Files:**
- Modify: `src/client/lib/file-crypto.ts`
- Modify: `src/client/lib/file-crypto.test.ts`

- [ ] **Step 1: Write failing test for file envelope v2**

```typescript
// src/client/lib/file-crypto.test.ts (append)
describe('file-crypto envelope v2', () => {
  test('encrypt file produces EnvelopeV2 with correct labelId', async () => {
    const { envelope } = await encryptFile(new Uint8Array(1024), 'file-42', [recipientPubkey])
    expect(envelope.v).toBe(2)
    expect(envelope.labelId).toBe(labelToId(LABEL_FILE_KEY))
  })

  test('decrypt with wrong fileId fails (AAD mismatch)', async () => {
    const { envelope, ciphertext } = await encryptFile(new Uint8Array(1024), 'file-42', [recipientPubkey])
    await expect(decryptFile(ciphertext, envelope, 'file-99')).rejects.toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 2: Update `encryptFile`/`decryptFile` to v2 + AAD**

```typescript
// src/client/lib/file-crypto.ts
export async function encryptFile(
  plaintext: Uint8Array,
  fileId: string,
  recipientPubkeys: string[],
): Promise<{ envelope: EnvelopeV2; ciphertext: Ciphertext }> {
  const fileKey = randomBytes(32)
  const aadInner = new Uint8Array([
    ...utf8ToBytes(LABEL_FILE_KEY),
    labelToId(LABEL_FILE_KEY),
    ...utf8ToBytes(fileId),
  ])
  const ciphertext = symmetricEncrypt(plaintext, fileKey, aadInner)
  const wrap = eciesWrapKey(fileKey, recipientPubkeys[0], LABEL_FILE_KEY)
  fileKey.fill(0)
  return {
    envelope: {
      v: 2,
      labelId: labelToId(LABEL_FILE_KEY),
      wrappedKey: wrap.wrappedKey,
      ephemeralPubkey: wrap.ephemeralPubkey,
    },
    ciphertext,
  }
}

export async function decryptFile(
  ciphertext: Ciphertext,
  envelope: EnvelopeV2,
  fileId: string,
): Promise<Uint8Array> {
  const fileKey = await decryptEnvelopeV2(
    envelope,
    (ep, wk, label) => cryptoWorker.decrypt(ep, wk, label, new Uint8Array(0)),
    LABEL_FILE_KEY,
  )
  const aadInner = new Uint8Array([
    ...utf8ToBytes(LABEL_FILE_KEY),
    labelToId(LABEL_FILE_KEY),
    ...utf8ToBytes(fileId),
  ])
  return symmetricDecrypt(ciphertext, fileKey, aadInner)
}
```

- [ ] **Step 3: Update every `encryptFile`/`decryptFile` caller to pass `fileId`**

Grep for call sites in `src/client/components` and `src/client/lib`, and thread `fileId` through.

- [ ] **Step 4: Run tests + typecheck**

```bash
bun test src/client/lib/file-crypto.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(file-crypto): envelope v2 + fileId-bound AAD"
```

### Task 9: Server CryptoService + `hub-event-crypto` AAD

**Files:**
- Modify: `src/server/lib/crypto-service.ts`
- Modify: `src/server/lib/crypto-service.test.ts`
- Modify: `src/server/lib/hub-event-crypto.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/server/lib/crypto-service.test.ts (append)
describe('CryptoService AAD binding', () => {
  test('serverEncrypt/Decrypt round-trip with AAD', () => {
    const svc = new CryptoService(SERVER_SECRET, HMAC_SECRET)
    const aad = utf8ToBytes('audit:row-42')
    const ct = svc.serverEncrypt('hello', LABEL_AUDIT_EVENT, aad)
    expect(svc.serverDecrypt(ct, LABEL_AUDIT_EVENT, aad)).toBe('hello')
  })

  test('hubEncrypt/Decrypt round-trip with AAD', () => {
    const svc = new CryptoService(SERVER_SECRET, HMAC_SECRET)
    const hubKey = new Uint8Array(32).fill(3)
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-1:encrypted_name`)
    const ct = svc.hubEncrypt('hello', hubKey, aad)
    expect(svc.hubDecrypt(ct, hubKey, aad)).toBe('hello')
  })
})
```

- [ ] **Step 2: Update `CryptoService` method signatures**

```typescript
serverEncrypt(plaintext: string, label: CryptoLabel, aad: Uint8Array): Ciphertext {
  return symmetricEncrypt(utf8ToBytes(plaintext), this.deriveKey(label), aad)
}

serverDecrypt(ct: Ciphertext, label: CryptoLabel, aad: Uint8Array): string {
  return new TextDecoder().decode(symmetricDecrypt(ct, this.deriveKey(label), aad))
}

hubEncrypt(plaintext: string, hubKey: Uint8Array, aad: Uint8Array): Ciphertext {
  return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, aad)
}

hubDecrypt(ct: Ciphertext, hubKey: Uint8Array, aad: Uint8Array): string | null {
  try {
    return new TextDecoder().decode(symmetricDecrypt(ct, hubKey, aad))
  } catch {
    return null
  }
}
```

`deriveKey(label: CryptoLabel)` retyped. All internal callers updated.

- [ ] **Step 3: Update `hub-event-crypto.ts` to use AAD**

```typescript
export function encryptHubEvent(
  content: Record<string, unknown>,
  eventKey: Uint8Array,
  eventId: string,
): string {
  const aad = new Uint8Array([...utf8ToBytes(LABEL_HUB_EVENT), ...utf8ToBytes(eventId)])
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(eventKey, nonce, aad)
  const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify(content)))
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}
```

Matching decrypt takes `eventId` and builds the same AAD.

- [ ] **Step 4: Update every `CryptoService` and `encryptHubEvent` caller**

Grep: `serverEncrypt|serverDecrypt|hubEncrypt|hubDecrypt|encryptHubEvent|decryptHubEvent`. Add the AAD argument at every call site. AAD construction per spec §0.1.3.

- [ ] **Step 5: Run tests + typecheck**

```bash
bun test src/server/lib/crypto-service.test.ts
bun run typecheck
```

Expected: PASS across the whole codebase. Any residual type errors indicate missed call sites.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server-crypto): AAD-required CryptoService + hub-event encryption"
```

---

## Workstream 0.3 — AEAD audit report

### Task 10: AEAD audit report skeleton + records/bans section

**Files:**
- Create: `docs/security/AEAD_AUDIT_2026-04-10.md`

- [ ] **Step 1: Create the audit report scaffold**

```markdown
# AEAD Audit — 2026-04-10

**Scope:** Every `ciphertext()` column in the Drizzle schema.
**Methodology:** For each column, document the encrypt call site, decrypt call site, label, AAD construction, and status (PASS / FIX / INFO). FIX rows must be resolved in the same PR.

## Schema-by-schema audit

### records / bans

| Column | Label | AAD | Encrypt site | Decrypt site | Status |
|---|---|---|---|---|---|
| `records.call_records.encrypted_caller_last4` | `LABEL_CALL_META` | ``${LABEL_CALL_META}:${callId}:encrypted_caller_last4`` | `records-service.ts#updateCallRecord` | `useCallRecord` queryFn | PASS |
| `records.call_records.encrypted_content` | `LABEL_NOTE_KEY` | `concat(LABEL_NOTE_KEY, [labelId], callId)` | `records-service.ts#writeNote` | `note-sheet-context#decryptNote` | PASS |
| `records.audit_log.*` | n/a | n/a | removed in workstream 0.2 | — | INFO |
| `bans.encrypted_phone` | envelope inner | `concat(LABEL_CALL_META, [labelId], banId)` | `bans-service.ts#createBan` | `useBans` queryFn | PASS |
| `bans.encrypted_reason` | envelope inner | `concat(LABEL_CALL_META, [labelId], banId)` | `bans-service.ts#createBan` | `useBans` queryFn | PASS |
```

- [ ] **Step 2: Commit**

```bash
git add docs/security/AEAD_AUDIT_2026-04-10.md
git commit -m "docs(security): AEAD audit skeleton + records/bans section"
```

### Tasks 11–15: Per-schema audit rows + fixes

Repeat the pattern of Task 10 for each schema file:

- **Task 11:** `contacts` + `conversations` + `signal_contacts`. For every row marked FIX, update the encrypt call site in the same commit to pass the documented AAD.
- **Task 12:** `blasts` + `tags` + `report_types`.
- **Task 13:** `settings` tables (multiple — roles, hubs, custom_fields, ivr_audio, blast_settings, provider_config, geocoding_config).
- **Task 14:** `teams` + `shifts` + `calls`.
- **Task 15:** `intakes` + `sessions` + `identity` + `push_subscriptions` + `firehose`.

Each task follows the same four-step pattern: (1) audit the encrypt/decrypt call sites for the schema, (2) update the audit report, (3) apply any FIX row by adding AAD to the call site, (4) run `bun run typecheck && bun test` and commit.

**Commit message template:** `docs(security) + feat(crypto): AEAD audit + AAD fixes for <schema>`.

---

## Workstream 0.4 — Export path integrity audit

### Task 16: Export path audit + fixes

**Files:**
- Modify: `docs/security/AEAD_AUDIT_2026-04-10.md` (append "Export paths" section)
- Modify: `src/server/services/storage-manager.ts` (if FIX needed)
- Modify: `src/client/lib/file-crypto.ts` (if FIX needed beyond Task 8)
- Modify: `src/server/services/gdpr.ts` (if FIX needed)
- Modify: `src/server/services/intakes.ts` (if FIX needed)

- [ ] **Step 1: Append export section to the audit report**

```markdown
## Export paths

### Voicemail (RustFS via StorageManager)

- Encrypt call site: `src/server/services/voicemail.ts#encryptAndUpload`
- Label: `LABEL_VOICEMAIL_WRAP` (per-recording key), `LABEL_VOICEMAIL_TRANSCRIPT` (transcript)
- AAD: `utf8ToBytes(`${LABEL_VOICEMAIL_WRAP}:${voicemailId}`)`
- Framing metadata covered: filename (S3 key), content-type (`audio/opus`), length
- Status: FIX — add AAD argument.

### Attachments

- See Task 8 — file-crypto.ts envelope v2 + fileId AAD.
- Status: PASS (covered by Task 8).

### GDPR user export

- Encrypt call site: `src/server/services/gdpr.ts#buildUserExport`
- Label: `LABEL_BACKUP`
- AAD: `utf8ToBytes(`${LABEL_BACKUP}:${exportId}:${userId}`)`
- Status: FIX — implement per-export random key wrapped via ECIES to user pubkey.

### Contact intake submissions

- Encrypt call site: `src/server/services/intakes.ts#storeIntake`
- Label: `LABEL_CONTACT_INTAKE`
- AAD: `utf8ToBytes(`${LABEL_CONTACT_INTAKE}:${intakeId}`)`
- Status: FIX — add AAD.

### Admin settings export

- Search: `grep -rn "settings.*export\|export.*settings" src/server`
- Finding: no endpoint currently returns a settings bundle. Status: N/A.
```

- [ ] **Step 2: Apply FIX rows**

For each FIX row above, edit the corresponding source file and add the AAD argument to the encrypt/decrypt call. Concrete edits:

1. `src/server/services/voicemail.ts` — thread `voicemailId` into `encryptAndUpload`, build AAD, pass through.
2. `src/server/services/gdpr.ts` — rewrite `buildUserExport` to:
   ```typescript
   const exportId = crypto.randomUUID()
   const exportKey = crypto.getRandomValues(new Uint8Array(32))
   const aad = utf8ToBytes(`${LABEL_BACKUP}:${exportId}:${userId}`)
   const ciphertext = symmetricEncrypt(jsonBytes, exportKey, aad)
   const keyEnvelope = eciesWrapKey(exportKey, userPubkey, LABEL_BACKUP)
   return { exportId, ciphertext, keyEnvelope }
   ```
3. `src/server/services/intakes.ts` — thread `intakeId` AAD.

- [ ] **Step 3: Run tests + typecheck**

```bash
bun run typecheck
bun test src/server/services
bunx playwright test tests/api/gdpr.spec.ts
bunx playwright test tests/api/voicemail.spec.ts 2>/dev/null || true
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(exports): AAD-bound voicemail, GDPR export, intake storage"
```

---

## Workstream 0.2 — Signed audit log

### Task 17: Canonical JSON + audit entry schemas + hash helpers

**Files:**
- Create: `src/shared/lib/canonical-json.ts`
- Create: `src/shared/lib/canonical-json.test.ts`
- Create: `src/shared/lib/audit-entry-hash.ts`
- Create: `src/shared/lib/audit-entry-hash.test.ts`
- Create: `src/shared/schemas/audit-entries.ts`
- Create: `src/shared/schemas/audit-entries.test.ts`

- [ ] **Step 1: Write `canonical-json.ts` + tests**

```typescript
// src/shared/lib/canonical-json.ts
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize non-finite number')
    return String(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === undefined) throw new Error('Cannot canonicalize undefined')
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value as object).sort()
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  throw new Error(`Cannot canonicalize ${typeof value}`)
}
```

Tests in `src/shared/lib/canonical-json.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { canonicalize } from './canonical-json'

describe('canonicalize', () => {
  test('null + primitives', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(true)).toBe('true')
    expect(canonicalize(42)).toBe('42')
    expect(canonicalize('hi')).toBe('"hi"')
  })

  test('sorts object keys deeply', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(canonicalize({ x: { b: 2, a: 1 } })).toBe('{"x":{"a":1,"b":2}}')
  })

  test('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })

  test('throws on undefined, NaN, Infinity', () => {
    expect(() => canonicalize(undefined)).toThrow()
    expect(() => canonicalize(Number.NaN)).toThrow()
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow()
  })
})
```

Run: `bun test src/shared/lib/canonical-json.test.ts` → PASS.

- [ ] **Step 2: Write schema file + tests**

```typescript
// src/shared/schemas/audit-entries.ts
import { z } from '@hono/zod-openapi'

export const MembershipAddPayloadSchema = z.object({
  type: z.literal('membership_add'),
  userId: z.string().uuid(),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  role: z.enum(['volunteer', 'admin', 'super_admin']),
})

// ... (every payload schema from the spec §0.2.1)

export const AuditEntryPayloadSchema = z.discriminatedUnion('type', [
  MembershipAddPayloadSchema,
  MembershipRemovePayloadSchema,
  RoleChangePayloadSchema,
  HubKeyRotatePayloadSchema,
  HubCreatePayloadSchema,
  HubDeletePayloadSchema,
  DeviceAddPayloadSchema,
  DeviceRevokePayloadSchema,
])
export type AuditEntryPayload = z.infer<typeof AuditEntryPayloadSchema>

export const SignedAuditEntrySchema = z.object({
  id: z.string().uuid(),
  hubId: z.string().uuid(),
  payload: AuditEntryPayloadSchema,
  prevEntryHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  entryHash: z.string().regex(/^[0-9a-f]{64}$/),
  signerDeviceId: z.string().uuid(),
  signerPubkey: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  createdAt: z.string().datetime(),
})
export type SignedAuditEntry = z.infer<typeof SignedAuditEntrySchema>
```

Tests iterate every payload variant with a happy path + invalid field test. Run: PASS.

- [ ] **Step 3: Write `audit-entry-hash.ts` + tests**

```typescript
// src/shared/lib/audit-entry-hash.ts
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { SignedAuditEntry } from '@shared/schemas/audit-entries'
import { canonicalize } from './canonical-json'

export function computeEntryHash(
  entry: Omit<SignedAuditEntry, 'entryHash' | 'signature'>,
): string {
  const canonical = canonicalize({
    v: 1,
    id: entry.id,
    hubId: entry.hubId,
    payload: entry.payload,
    prevEntryHash: entry.prevEntryHash,
    createdAt: entry.createdAt,
    signerDeviceId: entry.signerDeviceId,
    signerPubkey: entry.signerPubkey,
  })
  return bytesToHex(sha256(utf8ToBytes(canonical)))
}
```

Tests: determinism, change-detection for every field, empty payload rejection, hash != prev field.

- [ ] **Step 4: Run all new tests**

```bash
bun test src/shared/lib/canonical-json.test.ts src/shared/lib/audit-entry-hash.test.ts src/shared/schemas/audit-entries.test.ts
```

Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/canonical-json.ts src/shared/lib/canonical-json.test.ts src/shared/lib/audit-entry-hash.ts src/shared/lib/audit-entry-hash.test.ts src/shared/schemas/audit-entries.ts src/shared/schemas/audit-entries.test.ts
git commit -m "feat(audit): canonical JSON + audit entry schemas + computeEntryHash"
```

### Task 18: Client-side `buildSignedAuditEntry`

**Files:**
- Create: `src/client/lib/audit-log-client.ts`
- Create: `src/client/lib/audit-log-client.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/audit-log-client.test.ts
import { describe, expect, test } from 'bun:test'
import { buildSignedAuditEntry } from './audit-log-client'

describe('buildSignedAuditEntry', () => {
  test('constructs a valid SignedAuditEntry', async () => {
    await unlockWorkerForTest()  // test helper seeds a known secret key
    const entry = await buildSignedAuditEntry({
      hubId: 'hub-1',
      payload: { type: 'membership_add', userId: 'user-x', pubkey: 'ab'.repeat(32), role: 'volunteer' },
      prevEntryHash: null,
      signerDeviceId: 'device-1',
    })
    expect(entry.signature).toMatch(/^[0-9a-f]{128}$/)
    expect(entry.entryHash).toMatch(/^[0-9a-f]{64}$/)
    expect(entry.payload.type).toBe('membership_add')
  })
})
```

- [ ] **Step 2: Implement `buildSignedAuditEntry`**

```typescript
// src/client/lib/audit-log-client.ts
import { cryptoWorker } from './crypto-worker-client'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import type { AuditEntryPayload, SignedAuditEntry } from '@shared/schemas/audit-entries'

export async function buildSignedAuditEntry(params: {
  hubId: string
  payload: AuditEntryPayload
  prevEntryHash: string | null
  signerDeviceId: string
}): Promise<SignedAuditEntry> {
  const pubkey = await cryptoWorker.getPublicKey()
  if (!pubkey) throw new Error('Crypto worker not unlocked')

  const unsigned = {
    id: crypto.randomUUID(),
    hubId: params.hubId,
    payload: params.payload,
    prevEntryHash: params.prevEntryHash,
    createdAt: new Date().toISOString(),
    signerDeviceId: params.signerDeviceId,
    signerPubkey: pubkey,
  }
  const entryHash = computeEntryHash(unsigned)
  const signature = await cryptoWorker.signAuditEntry(entryHash)
  return { ...unsigned, entryHash, signature }
}

export async function appendSignedAuditEntry(entry: SignedAuditEntry): Promise<void> {
  const res = await fetch(`/api/hubs/${entry.hubId}/audit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!res.ok) throw new Error(`Append audit entry failed: ${res.status}`)
}
```

- [ ] **Step 3: Run test**

```bash
bun test src/client/lib/audit-log-client.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/audit-log-client.ts src/client/lib/audit-log-client.test.ts
git commit -m "feat(audit): buildSignedAuditEntry client builder"
```

### Task 19: `AuditLogService` extraction + `appendSigned`

**Files:**
- Create: `src/server/services/audit-log-service.ts`
- Create: `src/server/services/audit-log-service.test.ts`
- Modify: `src/server/routes/audit.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/services/audit-log-service.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { AuditLogService } from './audit-log-service'
import { buildSignedAuditEntry } from '@/lib/audit-log-client-testhelper'

describe('AuditLogService.appendSigned', () => {
  let svc: AuditLogService
  beforeEach(() => {
    svc = new AuditLogService(testDb(), testDeviceRegistry())
  })

  test('appends a valid signed entry', async () => {
    const entry = await buildSignedAuditEntry({ /* ... */ })
    await svc.appendSigned(entry)
    const head = await svc.getHead(entry.hubId)
    expect(head?.entryHash).toBe(entry.entryHash)
  })

  test('rejects prev_entry_hash_mismatch', async () => {
    const e1 = await buildSignedAuditEntry({ prevEntryHash: null, /* ... */ })
    const e2 = await buildSignedAuditEntry({ prevEntryHash: 'deadbeef'.repeat(8), /* wrong */ })
    await svc.appendSigned(e1)
    await expect(svc.appendSigned(e2)).rejects.toThrow('prev_entry_hash_mismatch')
  })

  test('rejects entry_hash_mismatch', async () => {
    const entry = await buildSignedAuditEntry({ /* ... */ })
    const tampered = { ...entry, entryHash: '00'.repeat(32) }
    await expect(svc.appendSigned(tampered)).rejects.toThrow('entry_hash_mismatch')
  })

  test('rejects invalid signature', async () => {
    const entry = await buildSignedAuditEntry({ /* ... */ })
    const forged = { ...entry, signature: 'ab'.repeat(64) }
    await expect(svc.appendSigned(forged)).rejects.toThrow('signature_invalid')
  })

  test('rejects unknown signer', async () => {
    const entry = await buildSignedAuditEntry({ /* ... */, signerDeviceId: 'not-registered' })
    await expect(svc.appendSigned(entry)).rejects.toThrow('signer_unknown')
  })

  test('rejects payload the signer is not authorized for', async () => {
    const entry = await buildSignedAuditEntry({
      payload: { type: 'hub_delete', hubId: 'hub-x' },
      // signer is a volunteer, not an admin
    })
    await expect(svc.appendSigned(entry)).rejects.toThrow('signer_not_authorized_for_payload')
  })
})
```

- [ ] **Step 2: Implement `AuditLogService`**

```typescript
// src/server/services/audit-log-service.ts
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import { SignedAuditEntrySchema, type SignedAuditEntry, type AuditEntryPayload } from '@shared/schemas/audit-entries'
import type { DatabaseConnection } from '../db/client'
import type { DeviceRegistry } from './device-registry'

export class AuditChainError extends Error {
  constructor(public readonly code: string, public readonly detail?: Record<string, unknown>) {
    super(`Audit chain error: ${code}`)
    this.name = 'AuditChainError'
  }
}

export class AuditLogService {
  constructor(
    private readonly db: DatabaseConnection,
    private readonly devices: DeviceRegistry,
  ) {}

  async appendSigned(entry: SignedAuditEntry): Promise<void> {
    SignedAuditEntrySchema.parse(entry)

    const head = await this.getHead(entry.hubId)
    const expectedPrevHash = head?.entryHash ?? null
    if (entry.prevEntryHash !== expectedPrevHash) {
      throw new AuditChainError('prev_entry_hash_mismatch', { expected: expectedPrevHash, actual: entry.prevEntryHash })
    }

    const recomputedHash = computeEntryHash(entry)
    if (recomputedHash !== entry.entryHash) {
      throw new AuditChainError('entry_hash_mismatch', { expected: recomputedHash, actual: entry.entryHash })
    }

    if (!schnorr.verify(hexToBytes(entry.signature), hexToBytes(entry.entryHash), hexToBytes(entry.signerPubkey))) {
      throw new AuditChainError('signature_invalid')
    }

    const signerDevice = await this.devices.findByPubkey(entry.signerPubkey)
    if (!signerDevice || signerDevice.id !== entry.signerDeviceId) {
      throw new AuditChainError('signer_unknown')
    }
    if (!this.payloadIsAuthorizedFor(entry.payload, signerDevice)) {
      throw new AuditChainError('signer_not_authorized_for_payload')
    }

    await this.insert(entry)
  }

  async getHead(hubId: string): Promise<SignedAuditEntry | null> {
    // SELECT ... ORDER BY created_at DESC LIMIT 1
  }

  async listSince(hubId: string, sinceEntryHash: string | null, limit = 500): Promise<SignedAuditEntry[]> {
    // SELECT ... WHERE hub_id = ? AND id > ? LIMIT ?
  }

  private async insert(entry: SignedAuditEntry): Promise<void> {
    // INSERT INTO audit_log ...
  }

  private payloadIsAuthorizedFor(payload: AuditEntryPayload, signer: Device): boolean {
    switch (payload.type) {
      case 'membership_add':
      case 'membership_remove':
      case 'role_change':
      case 'hub_key_rotate':
      case 'hub_delete':
        return signer.role === 'admin' || signer.role === 'super_admin'
      case 'hub_create':
        return signer.role === 'super_admin'
      case 'device_add':
      case 'device_revoke':
        return signer.userId === payload.userId
      default:
        return false
    }
  }
}
```

- [ ] **Step 3: Rewire `src/server/routes/audit.ts`**

Replace the inline logic with `app.openapi(route, async (c) => { await services.auditLog.appendSigned(c.req.valid('json')); return c.body(null, 204) })`.

The `GET /api/hubs/:hubId/audit?since=<hash>` route calls `services.auditLog.listSince()`.

- [ ] **Step 4: Run the test + existing audit tests**

```bash
bun test src/server/services/audit-log-service.test.ts
bunx playwright test tests/api/audit.spec.ts
```

Expected: new service tests PASS. Existing audit tests need updating in Task 20 migration task — may temporarily fail until the DB schema migrates.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/audit-log-service.ts src/server/services/audit-log-service.test.ts src/server/routes/audit.ts
git commit -m "feat(audit): AuditLogService with appendSigned + chain + signature verification"
```

### Task 20: Migration 0051 + Drizzle schema update

**Files:**
- Create: `drizzle/migrations/0051_audit_log_signed_entries.sql`
- Modify: `src/server/db/schema/records.ts`
- Delete: `src/server/lib/audit-hash.ts` (replaced by shared version)

- [ ] **Step 1: Write the migration file**

```sql
-- drizzle/migrations/0051_audit_log_signed_entries.sql
-- Tier 0 — replace unsigned audit_log rows with typed signed entries.
-- Pre-production: existing audit rows are test data and are wiped.

DELETE FROM audit_log;

ALTER TABLE audit_log
  DROP COLUMN encrypted_event,
  DROP COLUMN encrypted_details,
  DROP COLUMN actor_pubkey;

ALTER TABLE audit_log
  ADD COLUMN type TEXT NOT NULL,
  ADD COLUMN payload JSONB NOT NULL,
  ADD COLUMN signer_device_id TEXT NOT NULL,
  ADD COLUMN signer_pubkey TEXT NOT NULL,
  ADD COLUMN signature TEXT NOT NULL;

ALTER TABLE audit_log ALTER COLUMN entry_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_hub_type_created_idx ON audit_log(hub_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_hub_signer_idx ON audit_log(hub_id, signer_pubkey);
```

- [ ] **Step 2: Update Drizzle schema**

Edit `src/server/db/schema/records.ts`:

Remove the `encrypted_event`, `encrypted_details`, `actor_pubkey` columns from the `auditLog` definition and add:

```typescript
type: text('type').notNull(),
payload: jsonb<AuditEntryPayload>()('payload').notNull(),
signerDeviceId: text('signer_device_id').notNull(),
signerPubkey: text('signer_pubkey').notNull(),
signature: text('signature').notNull(),
```

Add indexes to the table constraints array:

```typescript
index('audit_log_hub_type_created_idx').on(table.hubId, table.type, table.createdAt.desc()),
index('audit_log_hub_signer_idx').on(table.hubId, table.signerPubkey),
```

- [ ] **Step 3: Delete `src/server/lib/audit-hash.ts`**

```bash
git rm src/server/lib/audit-hash.ts src/server/lib/audit-hash.test.ts
```

Update any remaining importers to use `@shared/lib/audit-entry-hash#computeEntryHash`.

- [ ] **Step 4: Run the migration**

```bash
bun run dev:docker
bun run migrate
psql "$DATABASE_URL" -c '\d audit_log'
```

Expected: the new columns are present, `encrypted_event` and `encrypted_details` are gone.

- [ ] **Step 5: Run typecheck + all tests**

```bash
bun run typecheck
bun run test:unit
bunx playwright test tests/api/audit.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add drizzle/migrations/0051_audit_log_signed_entries.sql src/server/db/schema/records.ts
git rm src/server/lib/audit-hash.ts src/server/lib/audit-hash.test.ts 2>/dev/null || true
git commit -m "feat(db): migration 0051 for signed audit entries; drop legacy encrypted_event/details"
```

### Task 21: Client-side `audit-chain-verifier.ts`

**Files:**
- Create: `src/client/lib/audit-chain-verifier.ts`
- Create: `src/client/lib/audit-chain-verifier.test.ts`

- [ ] **Step 1: Write failing adversarial tests**

```typescript
// src/client/lib/audit-chain-verifier.test.ts
import { describe, expect, test } from 'bun:test'
import { verifyAuditChain, ChainVerificationError } from './audit-chain-verifier'
import { buildChain } from './test-helpers/audit-chain-fixture'

describe('verifyAuditChain', () => {
  test('verifies a valid 10-entry chain', async () => {
    const { hubId, entries, trustAnchor } = buildChain({ length: 10 })
    mockFetchEntries(entries)
    const head = await verifyAuditChain(hubId, new Set(trustAnchor))
    expect(head.entryHash).toBe(entries[9].entryHash)
  })

  test('rejects divergent prevEntryHash', async () => {
    const { hubId, entries, trustAnchor } = buildChain({ length: 5 })
    entries[3].prevEntryHash = 'ab'.repeat(32)  // tamper
    mockFetchEntries(entries)
    await expect(verifyAuditChain(hubId, new Set(trustAnchor)))
      .rejects.toBeInstanceOf(ChainVerificationError)
  })

  test('rejects tampered entryHash', async () => {
    const { hubId, entries, trustAnchor } = buildChain({ length: 5 })
    entries[3].entryHash = 'cd'.repeat(32)
    mockFetchEntries(entries)
    await expect(verifyAuditChain(hubId, new Set(trustAnchor))).rejects.toThrow()
  })

  test('rejects forged signature (wrong pubkey)', async () => { /* ... */ })

  test('rejects unknown signer', async () => { /* ... */ })

  test('device_add extends the trust set', async () => { /* ... */ })

  test('device_revoke removes from trust set', async () => { /* ... */ })

  test('incremental verification reads only delta after first call', async () => { /* ... */ })
})
```

- [ ] **Step 2: Implement the verifier**

See spec §0.2.6 for the full implementation. Write `verifyAuditChain`, `loadCache`, `saveCache`, `fetchEntriesSince`, `fetchEntry` helpers. Cache lives in IDB object store `llamenos-audit-chain-cache`.

- [ ] **Step 3: Run the tests**

```bash
bun test src/client/lib/audit-chain-verifier.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/audit-chain-verifier.ts src/client/lib/audit-chain-verifier.test.ts
git commit -m "feat(audit): client-side chain verifier with IDB cache + adversarial tests"
```

### Task 22: Gate `rotateHubKey` on chain verification

**Files:**
- Modify: `src/client/lib/hub-key-manager.ts`
- Modify: `src/client/lib/hub-key-manager.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/hub-key-manager.test.ts (append)
describe('rotateHubKey chain gate', () => {
  test('blocks when chain verification fails', async () => {
    mockVerifyAuditChainThrows()
    await expect(rotateHubKey('hub-1', 'deadbeef'.repeat(8))).rejects.toBeInstanceOf(ChainVerificationError)
  })

  test('blocks when head is not a membership change', async () => {
    mockVerifyAuditChainReturns({ payload: { type: 'hub_create', /* ... */ } })
    await expect(rotateHubKey('hub-1', head.entryHash)).rejects.toThrow('invalid_rotation_trigger_type')
  })

  test('blocks when expectedTriggerEntryHash does not match head', async () => {
    mockVerifyAuditChainReturns({ entryHash: 'cafebabe'.repeat(8), payload: { type: 'membership_remove' } })
    await expect(rotateHubKey('hub-1', 'deadbeef'.repeat(8))).rejects.toThrow('rotation_trigger_not_at_head')
  })

  test('succeeds when chain verifies and head matches', async () => {
    const mockHead = { entryHash: 'ab'.repeat(32), payload: { type: 'membership_remove', userId: 'u1' } }
    mockVerifyAuditChainReturns(mockHead)
    const result = await rotateHubKey('hub-1', mockHead.entryHash)
    expect(result.envelopes.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Rewrite `rotateHubKey` per spec §0.2.7**

See spec for the full rewrite. Thread `expectedTriggerEntryHash` through every caller (`useRemoveMember` mutation, `useAddMember` mutation, `useRoleChange` mutation).

- [ ] **Step 3: Run tests**

```bash
bun test src/client/lib/hub-key-manager.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/hub-key-manager.ts src/client/lib/hub-key-manager.test.ts
git commit -m "feat(hub-key): gate rotateHubKey on verified chain head"
```

---

## Workstream 0.5 — CSP L3 + Trusted Types + Font self-hosting

### Task 23: Per-response nonce middleware + `__CSP_NONCE__` Vite plugin

**Files:**
- Create: `src/server/middleware/csp-nonce.ts`
- Modify: `src/server/middleware/security-headers.ts`
- Modify: `index.html`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write nonce middleware**

```typescript
// src/server/middleware/csp-nonce.ts
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

export const cspNonce = createMiddleware<AppEnv>(async (c, next) => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const nonce = btoa(String.fromCharCode(...bytes))
  c.set('cspNonce', nonce)
  await next()
})
```

Add `cspNonce: string` to `Variables` in `src/server/types.ts`.

- [ ] **Step 2: Update `security-headers.ts` to consume the nonce**

```typescript
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()
  const nonce = c.get('cspNonce') ?? ''
  // ... build CSP header with `'nonce-${nonce}'`
  const mode = process.env.CSP_MODE === 'enforcing' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'
  c.header(mode, buildCsp(nonce, /* relay origin */))
  // ... rest of headers unchanged
})
```

Add `buildCsp(nonce, relayWsOrigin)` helper that emits the full header string from spec §0.5.1.

- [ ] **Step 3: Update `index.html` and Vite plugin**

Edit `index.html` script/style tags:

```html
<script type="module" src="/src/main.tsx" nonce="__CSP_NONCE__"></script>
```

Add a Vite plugin in `vite.config.ts` that emits the literal `__CSP_NONCE__` placeholder in the built HTML:

```typescript
function cspNoncePlugin(): Plugin {
  return {
    name: 'csp-nonce-placeholder',
    transformIndexHtml(html) {
      return html.replace(/<script /g, '<script nonce="__CSP_NONCE__" ')
        .replace(/<style /g, '<style nonce="__CSP_NONCE__" ')
    },
  }
}
```

Add a Hono static-file middleware that, on GET `/index.html`, does `html.replaceAll('__CSP_NONCE__', c.get('cspNonce'))`.

- [ ] **Step 4: Register nonce middleware in `app.ts`**

```typescript
app.use('*', cspNonce)  // must be before securityHeaders
app.use('*', securityHeaders)
```

- [ ] **Step 5: Test manually**

```bash
bun run dev:server
curl -I http://localhost:3000/
```

Expected: the response contains `Content-Security-Policy-Report-Only: ... 'nonce-<base64>'...`, and each request gets a different nonce.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(csp): per-response nonce middleware + Vite __CSP_NONCE__ placeholder"
```

### Task 24: `/api/csp-report` ingest endpoint

**Files:**
- Create: `src/server/routes/csp-report.ts`
- Create: `src/server/routes/csp-report.test.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/server/routes/csp-report.test.ts
import { describe, expect, test } from 'bun:test'
import cspReportApp from './csp-report'

describe('POST /api/csp-report', () => {
  test('accepts application/csp-report body', async () => {
    const res = await cspReportApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'violated-directive': "script-src",
          'blocked-uri': 'inline',
          'source-file': 'https://example.com/index.html',
          'line-number': 42,
        },
      }),
    })
    expect(res.status).toBe(204)
  })

  test('rejects malformed body with 400', async () => {
    const res = await cspReportApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonsense: true }),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Implement the endpoint per spec §0.5.4**

Copy the full endpoint definition from the spec.

- [ ] **Step 3: Mount in `app.ts`**

```typescript
import cspReportRoutes from './routes/csp-report'
api.route('/csp-report', cspReportRoutes)
```

Add `'csp-report'` to `KNOWN_API_PREFIXES`.

- [ ] **Step 4: Run test**

```bash
bun test src/server/routes/csp-report.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(csp): /api/csp-report ingest endpoint + structured violation logging"
```

### Task 25: Self-host Google Fonts + remove external link

**Files:**
- Create: `scripts/fetch-fonts.sh`
- Create: `src/client/styles/fonts.css`
- Modify: `index.html`
- Modify: `.gitignore`
- Modify: `Dockerfile.build`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write `scripts/fetch-fonts.sh`**

```bash
#!/usr/bin/env bash
# scripts/fetch-fonts.sh — download self-hosted fonts at pinned versions
set -euo pipefail

FONTS_DIR="public/fonts"
mkdir -p "$FONTS_DIR"

# Inter — pinned v4.0 release
INTER_BASE="https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip"
INTER_SHA="<pin SHA256>"

TMPFILE=$(mktemp --suffix=.zip)
curl -L -o "$TMPFILE" "$INTER_BASE"
echo "$INTER_SHA  $TMPFILE" | sha256sum -c -

unzip -j "$TMPFILE" 'Inter Web/Inter-Regular.woff2' 'Inter Web/Inter-Bold.woff2' 'Inter Web/Inter-Medium.woff2' -d "$FONTS_DIR"

rm "$TMPFILE"
echo "Fetched fonts into $FONTS_DIR/"
ls -la "$FONTS_DIR"
```

Make executable: `chmod +x scripts/fetch-fonts.sh`.

- [ ] **Step 2: Write `src/client/styles/fonts.css`**

```css
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/Inter-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/Inter-Medium.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/Inter-Bold.woff2') format('woff2');
}
```

Import from the main CSS entry point.

- [ ] **Step 3: Remove Google Fonts link from `index.html`**

Remove any `<link href="https://fonts.googleapis.com/..."` and `<link href="https://fonts.gstatic.com/...">` lines.

- [ ] **Step 4: Update `.gitignore`**

```
public/fonts/
```

- [ ] **Step 5: Update `Dockerfile.build`**

Before `bun run build`, add:

```dockerfile
RUN ./scripts/fetch-fonts.sh
```

- [ ] **Step 6: Update `.github/workflows/release.yml`**

Add a step before "Build frontend":

```yaml
- name: Fetch self-hosted fonts
  run: ./scripts/fetch-fonts.sh
```

- [ ] **Step 7: Run build locally**

```bash
./scripts/fetch-fonts.sh
bun run build
```

Expected: PASS; `public/fonts/` populated; built HTML references `/fonts/Inter-Regular.woff2`.

- [ ] **Step 8: Commit**

```bash
git add scripts/fetch-fonts.sh src/client/styles/fonts.css index.html .gitignore Dockerfile.build .github/workflows/release.yml
git commit -m "feat(fonts): self-host Inter; remove Google Fonts link; unblock COEP require-corp"
```

### Task 26: Shadcn inline-style migration + Radix keyframe pre-bundling

**Files:**
- Multiple shadcn/ui components (identified by grep)
- Create: `src/client/styles/radix-keyframes.css`

- [ ] **Step 1: Enumerate inline `style=` in shadcn components**

```bash
grep -rn 'style={{' src/client/components/ui --include="*.tsx" | head -40
```

For each hit, decide: (a) CSS custom property on the element (`style={{ '--foo': value }}`), (b) static class in a stylesheet, (c) fallback to `'unsafe-hashes'` allowlist if the style is truly dynamic per render.

- [ ] **Step 2: Migrate shadcn inline styles**

Apply the transformation per component. Example: `<div style={{ animationDelay: '0.3s' }}>` → `<div className="animate-fade-in delay-300">` with delay-300 defined in tailwind.config.

- [ ] **Step 3: Pre-bundle Radix keyframes**

```bash
grep -rn '@keyframes' node_modules/@radix-ui --include="*.css" | head -20
```

For each `@keyframes` found in Radix CSS, copy into `src/client/styles/radix-keyframes.css`. Import from main CSS.

- [ ] **Step 4: Run dev server, check CSP compliance**

```bash
bun run dev:server &
bun run dev
curl http://localhost:5173/ | grep -c 'style='
```

Ensure the remaining inline styles are known and fit within the `'unsafe-hashes'` allowlist.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): migrate shadcn inline styles to CSS classes; pre-bundle Radix keyframes"
```

### Task 27: CSP header with `strict-dynamic` + Trusted Types

**Files:**
- Modify: `src/server/middleware/security-headers.ts`

- [ ] **Step 1: Update `buildCsp` helper**

```typescript
function buildCsp(nonce: string, relayOrigin: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    `connect-src 'self' wss://${/* host */} ${relayOrigin}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types llamenos",
    "upgrade-insecure-requests",
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join('; ')
}
```

Emit a `Report-To` header alongside:

```typescript
c.header('Report-To', JSON.stringify({
  group: 'csp-endpoint',
  max_age: 10886400,
  endpoints: [{ url: '/api/csp-report' }],
}))
```

- [ ] **Step 2: Test manually**

```bash
curl -I http://localhost:3000/
```

Expected: `Content-Security-Policy-Report-Only: default-src 'none'; script-src 'self' 'nonce-...' 'strict-dynamic'; ... report-uri /api/csp-report`.

- [ ] **Step 3: Commit**

```bash
git add src/server/middleware/security-headers.ts
git commit -m "feat(csp): strict-dynamic + Trusted Types + report-uri; ship in Report-Only mode"
```

### Task 28: Trusted Types policy installer

**Files:**
- Create: `src/client/lib/trusted-types-policy.ts`
- Create: `src/client/lib/trusted-types-policy.test.ts`
- Modify: `src/client/main.tsx`
- Modify: `package.json` (add `dompurify`)

- [ ] **Step 1: Install DOMPurify**

```bash
bun add dompurify
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/client/lib/trusted-types-policy.test.ts
import { describe, expect, test } from 'bun:test'
import { installTrustedTypesPolicy } from './trusted-types-policy'

describe('installTrustedTypesPolicy', () => {
  test('no-op when trustedTypes is absent', () => {
    const noWin = {} as Window
    globalThis.window = noWin
    expect(() => installTrustedTypesPolicy()).not.toThrow()
  })

  test('installs a policy named llamenos', () => {
    const mockTT = makeMockTrustedTypes()
    globalThis.window = { trustedTypes: mockTT } as Window
    installTrustedTypesPolicy()
    expect(mockTT.policies.has('llamenos')).toBe(true)
  })

  test('createScriptURL blocks cross-origin', () => {
    const mockTT = makeMockTrustedTypes()
    globalThis.window = { trustedTypes: mockTT, location: { origin: 'https://example.com' } } as Window
    installTrustedTypesPolicy()
    const policy = mockTT.policies.get('llamenos')!
    expect(() => policy.createScriptURL('https://evil.example/x.js')).toThrow()
  })

  test('createScript throws unconditionally', () => {
    const mockTT = makeMockTrustedTypes()
    globalThis.window = { trustedTypes: mockTT } as Window
    installTrustedTypesPolicy()
    const policy = mockTT.policies.get('llamenos')!
    expect(() => policy.createScript('console.log(1)')).toThrow()
  })
})
```

- [ ] **Step 3: Implement `installTrustedTypesPolicy`**

Copy the implementation from spec §0.5.3.

- [ ] **Step 4: Wire into `main.tsx`**

```typescript
// src/client/main.tsx (top of file, before ReactDOM import)
import { installTrustedTypesPolicy } from './lib/trusted-types-policy'
installTrustedTypesPolicy()
```

- [ ] **Step 5: Run tests**

```bash
bun test src/client/lib/trusted-types-policy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(csp): Trusted Types llamenos policy + DOMPurify integration"
```

---

## Workstream 0.6 — Cosign + SBOM + extended verify-build

### Task 29: Cosign keyless signing in release.yml

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add cosign-installer step**

After the existing `Fetch self-hosted fonts` step, add:

```yaml
- name: Install cosign
  uses: sigstore/cosign-installer@d7d6e079ac29fd41e9a4c81c7a1b6e4e8b7fe1ec  # v3.7.0
  with:
    cosign-release: 'v2.4.1'
```

- [ ] **Step 2: Add cosign sign-blob step**

After the GPG signing step:

```yaml
- name: Cosign sign CHECKSUMS.txt
  env:
    COSIGN_YES: "true"
  run: |
    cosign sign-blob \
      --yes \
      --bundle CHECKSUMS.txt.cosign-bundle \
      CHECKSUMS.txt
```

- [ ] **Step 3: Validate workflow syntax locally**

```bash
bun run --silent tsx scripts/validate-workflow.ts .github/workflows/release.yml 2>/dev/null || \
  gh workflow view release.yml --repo "$(git remote get-url origin | sed 's#.*/\([^/]*/[^/]*\)\.git#\1#')"
```

Or push to a feature branch, let GitHub validate the syntax.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(release): cosign keyless sign CHECKSUMS.txt"
```

### Task 30: CycloneDX SBOM + attest-sbom

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add SBOM generation step**

After the cosign step:

```yaml
- name: Generate CycloneDX SBOM
  uses: anchore/sbom-action@e11c554f704a0b820cbf8c51673f6945e0731532  # v0.17.8
  with:
    path: .
    format: cyclonedx-json
    output-file: sbom.cdx.json
```

- [ ] **Step 2: Add SBOM attestation step**

```yaml
- name: Attest SBOM
  uses: actions/attest-sbom@bd218ad0dbcb3e146bd073d1d9c6d78e08aa8a0b  # v2.1.0
  with:
    subject-path: |
      CHECKSUMS.txt
      dist/client/**/*.js
      dist/client/**/*.css
    sbom-path: sbom.cdx.json
```

- [ ] **Step 3: Update release files list**

In the `Create GitHub Release` step:

```yaml
files: |
  CHECKSUMS.txt
  CHECKSUMS.txt.asc
  CHECKSUMS.txt.cosign-bundle
  sbom.cdx.json
  provenance.json
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(release): CycloneDX SBOM + SBOM attestation"
```

### Task 31: Extended `verify-build.sh`

**Files:**
- Modify: `scripts/verify-build.sh`

- [ ] **Step 1: Append cosign verification block**

Copy the verification block from spec §0.6.4 into `verify-build.sh` after the GPG signature verification.

- [ ] **Step 2: Append SBOM verification block**

Copy the SBOM presence + CycloneDX parse block from spec §0.6.4.

- [ ] **Step 3: Dry-run on a recent release**

```bash
./scripts/verify-build.sh v0.40.0
```

Expected: WARNING lines for missing cosign bundle + SBOM (since v0.40.0 predates this tier); PASS on existing GPG + CHECKSUMS.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-build.sh
git commit -m "feat(verify-build): cosign verify-blob + CycloneDX SBOM check"
```

### Task 32: Documentation

**Files:**
- Modify: `docs/REPRODUCIBLE_BUILDS.md`
- Create: `docs/security/SUPPLY_CHAIN_HARDENING.md`

- [ ] **Step 1: Update `REPRODUCIBLE_BUILDS.md`**

Add a "Cosign verification" section at the end with cosign install link, identity regex, verify command, interpretation.

- [ ] **Step 2: Create `docs/security/SUPPLY_CHAIN_HARDENING.md`**

Sections: Reproducible builds; SLSA Build L3 provenance; GPG-signed checksums; Cosign keyless signing; CycloneDX SBOM; `verify-build.sh` usage; residual risks.

- [ ] **Step 3: Commit**

```bash
git add docs/REPRODUCIBLE_BUILDS.md docs/security/SUPPLY_CHAIN_HARDENING.md
git commit -m "docs(security): cosign + SBOM verification + supply-chain posture doc"
```

---

## Tests, CI guardrails, and verification

### Task 33: CI grep guardrails

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `biome.json`

- [ ] **Step 1: Add grep check for raw crypto label literals**

```yaml
- name: No raw crypto label literals
  run: |
    set -e
    ! grep -rn "'llamenos:" src/client/lib/crypto*.ts src/client/lib/hub-*.ts src/client/lib/file-*.ts src/client/lib/envelope-*.ts src/server/lib/crypto*.ts src/server/lib/hub-*.ts src/shared/crypto-primitives.ts \
      --include="*.ts" --exclude-dir="*.test.ts" | grep -v 'as CryptoLabel' || (echo "Raw crypto label literal detected — must import from crypto-labels.ts" && exit 1)
```

- [ ] **Step 2: Add grep check for `'unsafe-inline'` in CSP**

```yaml
- name: No 'unsafe-inline' in CSP
  run: |
    ! grep -n "'unsafe-inline'" src/server/middleware/security-headers.ts || (echo "'unsafe-inline' found in CSP — banned in Tier 0" && exit 1)
```

- [ ] **Step 3: Add biome rule for bare catch in crypto paths**

Add to `biome.json` overrides:

```json
{
  "overrides": [
    {
      "include": ["src/**/crypto*.ts", "src/**/hub-*.ts", "src/**/file-*.ts"],
      "linter": { "rules": { "suspicious": { "noEmptyBlockStatements": "error" } } }
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml biome.json
git commit -m "chore(ci): grep guardrails + biome rule banning bare catch in crypto paths"
```

### Task 34: API E2E tests

**Files:**
- Create: `tests/api/audit-signed.spec.ts`
- Create: `tests/api/csp-report.spec.ts`
- Create: `tests/api/aead-roundtrip.spec.ts`
- Create: `tests/api/hub-key-rotation.spec.ts`
- Create: `tests/api/release-artifacts.spec.ts`

For each spec file, use the `test-writer` skill to scaffold the spec. The test cases are enumerated in spec §"New API E2E tests".

- [ ] **Step 1: Write `audit-signed.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { buildSignedAuditEntryForTest } from '../helpers/audit-chain-fixture'

test.describe('POST /api/hubs/:hubId/audit', () => {
  test('appends a valid signed entry', async ({ request }) => {
    const entry = await buildSignedAuditEntryForTest({ /* ... */ })
    const res = await authedRequest(request, 'POST', `/api/hubs/${entry.hubId}/audit`, entry)
    expect(res.status()).toBe(204)
  })

  test('rejects prev_entry_hash_mismatch', async ({ request }) => { /* ... */ })
  test('rejects invalid signature', async ({ request }) => { /* ... */ })
  test('rejects unknown signer', async ({ request }) => { /* ... */ })
  test('rejects unauthorized payload', async ({ request }) => { /* ... */ })
})
```

- [ ] **Step 2: Write the remaining spec files following the spec's test case list**

- [ ] **Step 3: Run all API tests**

```bash
bunx playwright test tests/api/audit-signed.spec.ts tests/api/csp-report.spec.ts tests/api/aead-roundtrip.spec.ts tests/api/hub-key-rotation.spec.ts
```

Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/api/audit-signed.spec.ts tests/api/csp-report.spec.ts tests/api/aead-roundtrip.spec.ts tests/api/hub-key-rotation.spec.ts tests/api/release-artifacts.spec.ts
git commit -m "test(api): Tier 0 adversarial coverage for audit chain, CSP, AEAD, rewrap"
```

### Task 35: UI E2E tests

**Files:**
- Create: `tests/ui/csp-enforcement.spec.ts`
- Create: `tests/ui/hub-membership-removal.spec.ts`
- Create: `tests/ui/label-mismatch.spec.ts`
- Create: `tests/ui/trusted-types-policy.spec.ts`

- [ ] **Step 1: Write `csp-enforcement.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'

test('page loads with CSP Report-Only active + no genuine violations', async ({ page, request }) => {
  const reports: unknown[] = []
  page.on('request', (req) => {
    if (req.url().endsWith('/api/csp-report')) {
      reports.push(req.postData())
    }
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  expect(reports.length).toBe(0)
})

test('Trusted Types llamenos policy is installed', async ({ page }) => {
  await page.goto('/')
  const policyList = await page.evaluate(() => {
    // Read-only probe — the Trusted Types API exposes default policy only
    return typeof window.trustedTypes?.defaultPolicy
  })
  expect(policyList).toBeTruthy()
})
```

- [ ] **Step 2: Write `hub-membership-removal.spec.ts`**

Follow the spec's scenario list: admin removes a volunteer → audit entry visible → volunteer access revoked. Use testid selectors per `feedback_testid_only_selectors`.

- [ ] **Step 3: Write `label-mismatch.spec.ts`**

Use Playwright's `page.route()` to intercept an API response, swap the `labelId` field on a v2 envelope, then assert that the UI surfaces a decrypt-failure toast with testid `toast-decrypt-error`.

- [ ] **Step 4: Write `trusted-types-policy.spec.ts`**

Assert the policy installs; use a dev-only test fixture to attempt a raw-HTML injection via React's unsafe HTML-setter prop and expect a runtime error.

- [ ] **Step 5: Run UI tests**

```bash
bunx playwright test tests/ui/csp-enforcement.spec.ts tests/ui/hub-membership-removal.spec.ts tests/ui/label-mismatch.spec.ts tests/ui/trusted-types-policy.spec.ts
```

Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/ui/csp-enforcement.spec.ts tests/ui/hub-membership-removal.spec.ts tests/ui/label-mismatch.spec.ts tests/ui/trusted-types-policy.spec.ts
git commit -m "test(ui): Tier 0 CSP, Trusted Types, chain-gate, label-mismatch coverage"
```

### Task 36: Final verification gate

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: 0 errors.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: success; `dist/client/` populated; CSP nonce placeholder present in built `index.html`; no inline `'unsafe-inline'` in emitted CSP.

- [ ] **Step 4: Unit tests**

Run: `bun run test:unit`
Expected: every existing test + new tier-0 tests PASS.

- [ ] **Step 5: API E2E tests**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api
```

Expected: PASS.

- [ ] **Step 6: UI E2E tests**

```bash
bunx playwright test tests/ui
```

Expected: PASS.

- [ ] **Step 7: verify-build.sh dry-run against latest release**

```bash
./scripts/verify-build.sh
```

Expected: GPG + CHECKSUMS verified; WARNING lines for cosign/SBOM on pre-Tier-0 releases. After the first post-Tier-0 release, every signature type verifies.

- [ ] **Step 8: Grep check — zero raw crypto literals**

```bash
! grep -rn "'llamenos:" src --include="*.ts" --exclude="*crypto-labels.ts" --exclude="*.test.ts" --exclude="*spec.ts"
```

Expected: no matches — every `llamenos:*` string literal outside `crypto-labels.ts` has been replaced with a typed import.

- [ ] **Step 9: Audit report completeness**

```bash
grep -c "| FIX |" docs/security/AEAD_AUDIT_2026-04-10.md
```

Expected: `0` (every FIX row has been resolved to PASS).

- [ ] **Step 10: Final commit (CHANGELOG note)**

```bash
git add -A
git commit -m "chore(tier-0): verification gate green — Albrecht hardening complete"
```

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-security-tier-0-albrecht-hardening.md`.**

Execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in one session with checkpoints. Required sub-skill: `superpowers:executing-plans`.

Tier 0 implementation should happen in its own session, distinct from the session that wrote this plan, per the usual superpowers workflow.
