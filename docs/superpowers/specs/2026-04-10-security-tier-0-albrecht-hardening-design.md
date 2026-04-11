# Security Tier 0 — Albrecht Hardening

**Date:** 2026-04-10
**Status:** Draft
**Branch:** `feat/sec-tier-0-albrecht-hardening`
**Branch base:** `origin/main @ b730e733` (post-PR #50 merge, release v0.40.0)
**Brief:** [`docs/security/spec-briefs/tier-0-albrecht-hardening.md`](../../security/spec-briefs/tier-0-albrecht-hardening.md)
**Master doc:** [`docs/security/SECURITY_IMPROVEMENTS_MASTER.md`](../../security/SECURITY_IMPROVEMENTS_MASTER.md) §3.3, §3.11, §7 Tier 0, §9

## Problem

Llamenos' hub-key + ECIES-per-reader design is structurally identical to Matrix Megolm-Sender-Keys. That structural identity is validating — Megolm is the most-audited web group-crypto in production — but it also means we inherit Megolm's attack surface. Three of the five attacks published in Albrecht et al. *Practically-exploitable Cryptographic Vulnerabilities in Matrix* (IEEE S&P 2023) could apply to Llamenos today if we are not defensive at the implementation level. The Mega attacks (Backendal/Haller/Paterson *MEGA: Malleable Encryption Goes Awry*, 2022; Albrecht *Caveat Implementor!*, 2023) set the bar for any AEAD and domain-separation hygiene we have slipped on.

Tier 0 is a pure audit-and-tighten pass plus browser-level and build-pipeline hardening. **No primitive swap, no key-model change, no unlock-flow change** — those are Tier 1, Tier 3, and Tier 2 respectively. Every fix in this tier maps to a published real-world exploit.

**Concrete gaps identified during exploration:**

1. **Labels are `string`, not a branded type.** `eciesUnwrapKey(envelope, privateKey, label: string)` threads a label into the KDF (`sha256(label || sharedX)`), which gives implicit Albrecht #3 defense because a wrong label yields a wrong key and AEAD decrypt fails. But `label: string` means any call site can pass a raw literal or the wrong constant, and the type checker will not catch it.
2. **AEAD is called with no AAD anywhere.** `@noble/ciphers` `xchacha20poly1305(key, nonce, AAD?)` supports AAD as the third argument (confirmed via `node_modules/@noble/ciphers/chacha.d.ts` line 48), but every one of the ~45 call sites omits it. There is no cross-record substitution defense at the AEAD layer.
3. **Hub-key symmetric encryption has zero domain separation.** `encryptForHub(plaintext, hubKey)` does bare `xchacha20poly1305(hubKey, nonce).encrypt(plaintext)` with no label and no AAD. Every hub-encrypted field — role names, shift names, team names, custom field labels, tags, report types, call metadata, push subscriptions — shares one untagged symmetric key. This is a textbook cross-context reuse gap.
4. **Audit log has no signatures.** `src/server/lib/audit-hash.ts` is 18 lines — it computes `SHA-256(id:event:actor:createdAt:details:prev)`. The `audit_log` table stores `{id, hub_id, actor_pubkey, previous_entry_hash, entry_hash, encrypted_event, encrypted_details}`. There is **no signer field, no signature, no typed schema for `details`, and no client-side chain verification** before any hub-key operation. Albrecht #1 (server-controlled membership injection) is structurally unfixed in the current codebase.
5. **CSP is strong but sub-L3.** `security-headers.ts` already sets COOP `same-origin`, COEP `require-corp`, CORP `same-origin`, HSTS, Permissions-Policy, and a CSP with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`. Missing: per-response script nonces, `strict-dynamic`, removal of `'unsafe-inline'` on styles, Trusted Types policy, Report-Only rollout telemetry, and the self-hosted Google Fonts that a pending TODO flags as blocking COEP fully.
6. **Build pipeline is at SLSA Build L3 but lacks cosign/SBOM.** `release.yml` runs `actions/attest-build-provenance` (Sigstore-backed, L3) and GPG-signs `CHECKSUMS.txt`. It does not produce a `cosign sign-blob` signature (keyless, OIDC) and does not generate or attest a CycloneDX SBOM. `verify-build.sh` reflects the same gap.

Every item above becomes a workstream in this tier.

## Design

The spec is organized as six workstreams (0.1 through 0.6). They are independent enough to be implemented and tested in parallel, and will be batched into one pull request so the entire hardening pass lands together.

**Guiding principles** (derived from master §9):

- Fail closed on any label or AAD mismatch. Never silently accept "close enough".
- Every KDF and AEAD call consumes a label from `src/shared/crypto-labels.ts`. Raw string literals in crypto paths are compile-time errors.
- AEAD tag is the only integrity mechanism. Never a separate client-side format check.
- Every AEAD call's AAD includes the record identifier where one exists. No cross-record substitution gaps.
- Membership changes are signed into the audit sigchain *before* any crypto rewrap runs.
- No backward-compatibility shims. Pre-production gives us the latitude to drop v1 formats cleanly.

### 0.1. Label enforcement at every decrypt call site

**Threat model:** Albrecht CVE-2022-39251/-39255/-39248 type confusion. matrix-js-sdk accepted `m.room_key` to-device messages encrypted with Megolm instead of Olm. Megolm has no per-sender auth, so forged sessions were treated as fully authenticated. The structural root cause was that the decrypt entry point did not verify the expected envelope type.

Our defense is triple-redundant:

1. **Compile-time:** `CryptoLabel` branded type makes raw string literals in crypto paths impossible.
2. **Derivation-time:** labels feed into HKDF so a wrong label yields a wrong key (already present today).
3. **AEAD-time:** labels enter the AAD of every AEAD encrypt/decrypt so a wrong label fails tag verification.

Any one of the three mechanisms on its own prevents type confusion. Having all three means a single primitive bug does not silently accept a wrong-label envelope.

#### 0.1.1. Branded `CryptoLabel` type

In `src/shared/crypto-labels.ts`:

```typescript
declare const __CryptoLabelBrand: unique symbol
export type CryptoLabel = string & { readonly [__CryptoLabelBrand]: never }

// Brand every existing constant. Existing values are unchanged.
export const LABEL_NOTE_KEY = 'llamenos:note-key' as CryptoLabel
export const LABEL_HUB_KEY_WRAP = 'llamenos:hub-key-wrap' as CryptoLabel
export const LABEL_MESSAGE = 'llamenos:message' as CryptoLabel
// ... all ~45 constants.
```

Every crypto primitive's signature changes `label: string` → `label: CryptoLabel`. Every call site that passes a raw string literal becomes a TypeScript error.

#### 0.1.2. Label registry and envelope format v2

All existing ECIES envelopes use `{wrappedKey: hex, ephemeralPubkey: hex}`. This is envelope format v1. Tier 0 introduces envelope format v2 that carries a `labelId` byte in-band:

```typescript
// src/shared/crypto-labels.ts (extension)
export const LABEL_REGISTRY = [
  LABEL_NOTE_KEY,             // id 0
  LABEL_HUB_KEY_WRAP,         // id 1
  LABEL_MESSAGE,              // id 2
  LABEL_FILE_KEY,             // id 3
  LABEL_FILE_METADATA,        // id 4
  LABEL_BLAST_CONTENT,        // id 5
  LABEL_CALL_META,            // id 6
  LABEL_SHIFT_SCHEDULE,       // id 7
  LABEL_TRANSCRIPTION,        // id 8
  // ... append-only ordering, every label that appears in an envelope gets an id
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

Envelope v2 shape:

```typescript
// src/shared/types.ts
export interface EnvelopeV2 {
  v: 2
  labelId: number  // index into LABEL_REGISTRY
  wrappedKey: Ciphertext  // hex(nonce(24) || ct+tag)
  ephemeralPubkey: string // hex compressed ephemeral pubkey
}
```

The `labelId` is covered by the AEAD AAD (see 0.1.3) so any tampering with it fails tag verification. The `labelId` byte is also the runtime type check — `decryptEnvelope(env, secret, expectedLabel)` rejects if `idToLabel(env.labelId) !== expectedLabel`.

No v1 readers are retained. Pre-production dev DBs are wiped on the migration; production does not yet exist.

#### 0.1.3. AEAD AAD binding for every call site

`@noble/ciphers` exposes `xchacha20poly1305(key, nonce, AAD?)` — confirmed via `node_modules/@noble/ciphers/chacha.d.ts` line 48. We will use the third argument on every call site in the codebase.

Update `src/shared/crypto-primitives.ts`:

```typescript
export function symmetricEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array,  // REQUIRED — no default
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

export function symmetricDecrypt(
  packed: string | Ciphertext,
  key: Uint8Array,
  aad: Uint8Array,  // REQUIRED — no default
): Uint8Array {
  const data = hexToBytes(packed)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(key, nonce, aad)
  return cipher.decrypt(ciphertext)
}
```

AAD is a required parameter — no optional default — so every existing caller becomes a type error and must be audited. This is the point: the compile step enumerates the sites, and the fix is one line per site.

**AAD construction patterns:**

- **ECIES inner encryption (envelope v2):** `aad = concat(utf8ToBytes(label), [labelId])` — label enters the AAD literally; the registry id follows for redundancy against typo attacks.
- **Hub-key symmetric encryption of a single field:** ``aad = utf8ToBytes(`${LABEL_HUB_FIELD}:${recordId}:${fieldName}`)`` — binds the ciphertext to its row AND its column name. Substituting a `roles.encrypted_name` ciphertext into `teams.encrypted_name` fails tag verification.
- **Hub-key symmetric encryption of a JSON blob (e.g. custom-field options):** ``aad = utf8ToBytes(`${LABEL_HUB_FIELD}:${recordId}:${fieldName}`)`` — same pattern.
- **Per-note envelope:** `aad = concat(utf8ToBytes(LABEL_NOTE_KEY), [labelId], utf8ToBytes(noteId))` — AAD includes the note id so a note's ciphertext can't be rewritten into another note row.
- **Per-file envelope:** `aad = concat(utf8ToBytes(LABEL_FILE_KEY), [labelId], utf8ToBytes(fileId))`.
- **Hub-event encryption (Nostr relay):** `aad = concat(utf8ToBytes(LABEL_HUB_EVENT), utf8ToBytes(eventId))` — prevents a relay operator from substituting one hub's cached event into another hub's feed.

Every `ciphertext()` column in the database schema has its AAD construction documented in the audit report (workstream 0.3).

#### 0.1.4. Unified `decryptEnvelope` helper and entry point

A new helper in `src/shared/crypto-primitives.ts`:

```typescript
export async function decryptEnvelopeV2(
  env: EnvelopeV2,
  unwrapSecret: (ephemeralPubkey: string, wrapped: Ciphertext, label: CryptoLabel) => Promise<Uint8Array>,
  expectedLabel: CryptoLabel,
): Promise<Uint8Array> {
  if (env.v !== 2) {
    throw new CryptoLabelMismatchError(`Envelope version ${env.v} not supported`)
  }
  const actualLabel = idToLabel(env.labelId)
  if (actualLabel !== expectedLabel) {
    throw new CryptoLabelMismatchError({
      expected: expectedLabel,
      actual: actualLabel,
    })
  }
  // The `unwrapSecret` callback runs inside the crypto worker (client)
  // or with a raw secret key (server/tests). It performs ECDH + HKDF with
  // `expectedLabel` as HKDF info, then AEAD-decrypts with
  // aad = concat(utf8ToBytes(expectedLabel), [env.labelId]).
  return unwrapSecret(env.ephemeralPubkey, env.wrappedKey, expectedLabel)
}
```

The four existing decrypt entry points are retained — they differ by context (main-thread worker proxy vs worker-internal vs server-side raw-key) — but all four share the same `decryptEnvelopeV2` core with only the secret-source callback differing.

**Error class:**

```typescript
// src/shared/crypto-primitives.ts
export class CryptoLabelMismatchError extends Error {
  constructor(detail: string | { expected: CryptoLabel; actual: CryptoLabel }) {
    const msg = typeof detail === 'string'
      ? detail
      : `Crypto label mismatch: expected ${detail.expected}, got ${detail.actual}`
    super(msg)
    this.name = 'CryptoLabelMismatchError'
  }
}
```

The error name is a stable identifier for telemetry and tests. It is distinct from the existing `CryptoWorkerLockedError` so recovery paths can distinguish "wrong envelope" from "worker locked".

#### 0.1.5. De-duplication of ECIES implementations

Exploration surfaced two parallel ECIES implementations:

- `src/shared/crypto-primitives.ts` — canonical, used by server-side `CryptoService` and `blast-processor`.
- `src/client/lib/crypto.ts` — duplicate, used by client-side code.

The client copy is deleted and its callers are repointed to `@shared/crypto-primitives`. The duplication was a pre-existing hygiene debt that becomes untenable once `CryptoLabel` and AAD are introduced (two places to audit, two places to retype).

### 0.2. Signed typed audit-log entries with client-side chain verification

**Threat model:** Albrecht #1 — homeserver-controlled membership injection. The server silently adds an attacker device. The sending client rotates the group key on any membership change and encrypts it to the attacker. The root cause in Matrix was that matrix-js-sdk blindly trusted the homeserver's device-list response.

Our defense: membership changes are written to a hash-chained, per-entry-signed audit log. Clients verify the chain before doing any hub-key rewrap. A homeserver (or a compromised Llamenos API server) cannot inject a membership change without access to an admin's schnorr signing key, which lives only inside the admin's crypto worker.

#### 0.2.1. Typed audit entry schema

`src/shared/schemas/audit-entries.ts`:

```typescript
import { z } from '@hono/zod-openapi'

export const MembershipAddPayloadSchema = z.object({
  type: z.literal('membership_add'),
  userId: z.string().uuid(),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  role: z.enum(['volunteer', 'admin', 'super_admin']),
})

export const MembershipRemovePayloadSchema = z.object({
  type: z.literal('membership_remove'),
  userId: z.string().uuid(),
})

export const RoleChangePayloadSchema = z.object({
  type: z.literal('role_change'),
  userId: z.string().uuid(),
  oldRole: z.enum(['volunteer', 'admin', 'super_admin']),
  newRole: z.enum(['volunteer', 'admin', 'super_admin']),
})

export const HubKeyRotatePayloadSchema = z.object({
  type: z.literal('hub_key_rotate'),
  keyId: z.string().uuid(),
  memberPubkeys: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
  reason: z.enum(['member_added', 'member_removed', 'role_changed', 'scheduled', 'manual']),
})

export const HubCreatePayloadSchema = z.object({
  type: z.literal('hub_create'),
  hubId: z.string().uuid(),
  founderPubkey: z.string().regex(/^[0-9a-f]{64}$/),
})

export const HubDeletePayloadSchema = z.object({
  type: z.literal('hub_delete'),
  hubId: z.string().uuid(),
})

export const DeviceAddPayloadSchema = z.object({
  type: z.literal('device_add'),
  userId: z.string().uuid(),
  devicePubkey: z.string().regex(/^[0-9a-f]{64}$/),
  label: z.string().optional(),
})

export const DeviceRevokePayloadSchema = z.object({
  type: z.literal('device_revoke'),
  userId: z.string().uuid(),
  devicePubkey: z.string().regex(/^[0-9a-f]{64}$/),
})

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

The `payload` union is the list of entry types whose semantics the chain verifier knows about. Additional types can be appended in future tiers (e.g. Tier 3 adds `cross_sign` entries).

#### 0.2.2. Deterministic canonicalization and entry hashing

Entry hashes must be deterministic across client and server. We adopt a stable canonicalization:

```typescript
// src/shared/lib/canonical-json.ts
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value as object).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  throw new Error(`Cannot canonicalize ${typeof value}`)
}
```

`computeEntryHash`:

```typescript
// src/shared/lib/audit-entry-hash.ts
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { canonicalize } from './canonical-json'
import type { SignedAuditEntry } from '@shared/schemas/audit-entries'

export function computeEntryHash(entry: Omit<SignedAuditEntry, 'entryHash' | 'signature'>): string {
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

The version tag `v: 1` on the canonicalized object is a forward-compatibility hook. Future schema additions that would change the canonical form bump it to `v: 2` so old verifiers reject new entries rather than silently mis-verifying.

#### 0.2.3. Signing in the crypto worker

The private key never leaves the worker. A new worker op:

```typescript
// src/client/lib/crypto-worker.ts (add to WorkerRequest union)
| { type: 'signAuditEntry'; id: string; entryHashHex: string }
```

Handler:

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

Rate limit: use the existing `sign` bucket (10/sec, 100/min). Audit entry signing is not a hot path.

Client-side builder:

```typescript
// src/client/lib/audit-log-client.ts
export async function buildSignedAuditEntry(
  params: {
    hubId: string
    payload: AuditEntryPayload
    prevEntryHash: string | null
    signerDeviceId: string
  }
): Promise<SignedAuditEntry> {
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
```

#### 0.2.4. Server-side append and verification

`src/server/services/audit-log-service.ts` is extracted from `src/server/routes/audit.ts` (currently inline). It exposes:

```typescript
class AuditLogService {
  async appendSigned(entry: SignedAuditEntry): Promise<void> {
    SignedAuditEntrySchema.parse(entry)

    const head = await this.getHead(entry.hubId)
    const expectedPrevHash = head?.entryHash ?? null
    if (entry.prevEntryHash !== expectedPrevHash) {
      throw new AuditChainError('prev_entry_hash_mismatch', {
        expected: expectedPrevHash,
        actual: entry.prevEntryHash,
      })
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
}
```

`payloadIsAuthorizedFor` enforces role requirements: `membership_add` / `membership_remove` / `role_change` / `hub_key_rotate` / `hub_delete` require an `admin` role on `hubId`; `device_add` / `device_revoke` require the signer to be the user being modified; `hub_create` requires super_admin.

The existing unsigned-entry-write path is removed. Every audit log write is now typed and signed.

#### 0.2.5. Database schema changes

New migration `drizzle/migrations/0051_audit_log_signed_entries.sql`:

```sql
-- Drop the unsigned event/details columns and replace with typed signed entries.
-- Pre-production: existing audit_log rows are test data and will be wiped.
DELETE FROM audit_log;

ALTER TABLE audit_log
  DROP COLUMN encrypted_event,
  DROP COLUMN encrypted_details,
  DROP COLUMN actor_pubkey,
  ADD COLUMN type TEXT NOT NULL,
  ADD COLUMN payload JSONB NOT NULL,
  ADD COLUMN signer_device_id TEXT NOT NULL,
  ADD COLUMN signer_pubkey TEXT NOT NULL,
  ADD COLUMN signature TEXT NOT NULL,
  ALTER COLUMN entry_hash SET NOT NULL;

CREATE INDEX audit_log_hub_type_created_idx ON audit_log(hub_id, type, created_at DESC);
CREATE INDEX audit_log_hub_signer_idx ON audit_log(hub_id, signer_pubkey);
```

The `payload` column is server-visible JSON because its fields (user ids, pubkeys, roles) are not themselves sensitive — they are the membership view that admins already see. The payload does not contain names, phone numbers, or notes (those remain in their own encrypted columns). This is a deliberate trade-off: giving the server visibility into payload fields lets it validate authorization and enforce hub-scoped access without needing plaintext access to encrypted content.

The Drizzle schema in `src/server/db/schema/records.ts` is updated in lockstep:

```typescript
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    type: text('type').notNull(),
    payload: jsonb<AuditEntryPayload>()('payload').notNull(),
    previousEntryHash: text('previous_entry_hash'),
    entryHash: text('entry_hash').notNull(),
    signerDeviceId: text('signer_device_id').notNull(),
    signerPubkey: text('signer_pubkey').notNull(),
    signature: text('signature').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_hub_idx').on(table.hubId),
    index('audit_log_hub_created_idx').on(table.hubId, table.createdAt),
    index('audit_log_hub_type_created_idx').on(table.hubId, table.type, table.createdAt.desc()),
    index('audit_log_hub_signer_idx').on(table.hubId, table.signerPubkey),
  ]
)
```

#### 0.2.6. Client-side chain verifier

`src/client/lib/audit-chain-verifier.ts`:

```typescript
interface ChainVerificationCache {
  hubId: string
  lastVerifiedEntryHash: string | null
  lastVerifiedIndex: number
  trustedDevicePubkeys: string[]
}

class ChainVerificationError extends Error {
  constructor(public readonly code: ChainErrorCode, detail?: Record<string, unknown>) {
    super(`Chain verification failed: ${code}`)
    this.name = 'ChainVerificationError'
    if (detail) Object.assign(this, detail)
  }
}

export async function verifyAuditChain(
  hubId: string,
  trustAnchorDevicePubkeys: Set<string>,
): Promise<SignedAuditEntry> {
  const cache = await loadCache(hubId)
  const since = cache?.lastVerifiedEntryHash ?? null
  const entries = await fetchEntriesSince(hubId, since)

  let prev: string | null = since
  const trusted = new Set(cache?.trustedDevicePubkeys ?? [...trustAnchorDevicePubkeys])

  for (const entry of entries) {
    // 1. Schema check
    const parsed = SignedAuditEntrySchema.parse(entry)

    // 2. Chain hash link
    if (parsed.prevEntryHash !== prev) {
      throw new ChainVerificationError('prev_entry_hash_mismatch', { expected: prev, actual: parsed.prevEntryHash })
    }

    // 3. Deterministic hash recomputation
    if (computeEntryHash(parsed) !== parsed.entryHash) {
      throw new ChainVerificationError('entry_hash_mismatch')
    }

    // 4. Signature
    if (!schnorr.verify(hexToBytes(parsed.signature), hexToBytes(parsed.entryHash), hexToBytes(parsed.signerPubkey))) {
      throw new ChainVerificationError('signature_invalid')
    }

    // 5. Signer trust
    if (!trusted.has(parsed.signerPubkey)) {
      throw new ChainVerificationError('signer_not_trusted', { pubkey: parsed.signerPubkey })
    }

    // 6. Apply entry to trust set (device_add adds trust, device_revoke removes it)
    if (parsed.payload.type === 'device_add') {
      trusted.add(parsed.payload.devicePubkey)
    } else if (parsed.payload.type === 'device_revoke') {
      trusted.delete(parsed.payload.devicePubkey)
    }

    prev = parsed.entryHash
  }

  await saveCache(hubId, {
    hubId,
    lastVerifiedEntryHash: prev,
    lastVerifiedIndex: (cache?.lastVerifiedIndex ?? 0) + entries.length,
    trustedDevicePubkeys: [...trusted],
  })

  const head = entries[entries.length - 1] ?? (await fetchEntry(hubId, cache!.lastVerifiedEntryHash!))
  return head
}
```

**Trust anchor bootstrap.** The first time a client verifies a hub's chain, it has no cached trust set. The anchor is seeded from the hub-key envelope response on unlock: the server returns `{ hubKeyEnvelope, trustAnchorDevicePubkeys: string[] }` where `trustAnchorDevicePubkeys` is the list of admin device pubkeys at the time of envelope issuance. This is TOFU — the server is trusted once at first verification — but every subsequent verification cross-checks. Tier 3 replaces TOFU with cross-signed device sigchains.

**Cache storage.** `ChainVerificationCache` is persisted in IDB under object store `llamenos-audit-chain-cache`, one row per `hubId`. The cache is cleared on lock, re-populated on unlock from the hub-key response.

**Incremental verification.** The cache stores `lastVerifiedEntryHash` so subsequent calls only verify new entries. On first load per session, the entire chain is verified. On subsequent calls within the same session, only the delta is verified.

#### 0.2.7. Hub-key rotation gated by chain verification

`src/client/lib/hub-key-manager.ts` `rotateHubKey` is rewritten:

```typescript
export async function rotateHubKey(
  hubId: string,
  expectedTriggerEntryHash: string,  // server provides this with the membership-change response
): Promise<{ newHubKey: Uint8Array; envelopes: RecipientKeyEnvelope[] }> {
  // 1. Fetch + verify the full chain before any crypto action
  const head = await verifyAuditChain(hubId, await loadTrustAnchors(hubId))

  // 2. Assert the head is the membership change that triggered this rotation
  if (head.entryHash !== expectedTriggerEntryHash) {
    throw new ChainVerificationError('rotation_trigger_not_at_head', {
      expected: expectedTriggerEntryHash,
      actual: head.entryHash,
    })
  }
  const triggerType = head.payload.type
  if (!['membership_add', 'membership_remove', 'role_change'].includes(triggerType)) {
    throw new ChainVerificationError('invalid_rotation_trigger_type', { type: triggerType })
  }

  // 3. Derive the new member set from the verified head (not from a server response)
  const memberPubkeys = await deriveVerifiedMemberSet(hubId, head)

  // 4. Only now generate + wrap the new hub key
  const newHubKey = generateHubKey()
  const envelopes = wrapHubKeyForMembers(newHubKey, memberPubkeys)

  // 5. Post a hub_key_rotate entry — this itself gets signed via the same chain
  await appendSignedAuditEntry({
    type: 'hub_key_rotate',
    keyId: crypto.randomUUID(),
    memberPubkeys,
    reason:
      triggerType === 'membership_remove' ? 'member_removed' :
      triggerType === 'membership_add' ? 'member_added' : 'role_changed',
  })

  return { newHubKey, envelopes }
}
```

**This is the Albrecht #1 defense.** A malicious server cannot tamper with the member set without forging an admin's schnorr signature on the triggering audit entry. A malicious server cannot replay an old entry because `expectedTriggerEntryHash` must match the verified head. A malicious server cannot silently reorder because the chain's `prevEntryHash` links are checked.

### 0.3. AEAD audit of every `ciphertext()` column

**Deliverable:** A committed audit report at `docs/security/AEAD_AUDIT_2026-04-10.md` listing every `ciphertext()` column. Each row documents:

| Column | Schema file | Encryption tier | Label | Encrypt call site | AAD construction | Decrypt call site | Status |

Per column statuses:

- **PASS** — XChaCha20-Poly1305 is in place, label is bound via HKDF (for ECIES) or AAD (for hub-key symmetric), and AAD covers the record identifier where applicable.
- **FIX** — currently missing label or AAD binding; the fix is applied in the same PR and documented inline.
- **INFO** — pre-enveloped payload (e.g. nested envelope blobs that the server treats as opaque); the outer container has AEAD coverage, inner semantics audited upstream.

Columns enumerated during exploration (all must appear in the report):

- **records** — `encrypted_phone`, `encrypted_reason`, `encrypted_caller_last4`, `encrypted_content` (envelope), `encrypted_event` *(removed by 0.2)*, `encrypted_details` *(removed by 0.2)*
- **contacts** — `encrypted_display_name`, `encrypted_notes`, `encrypted_full_name`, `encrypted_phone`, `encrypted_pii`, `encrypted_payload`
- **blasts** — `encrypted_name`, `encrypted_double_opt_in_message`, `encrypted_welcome_message`, `encrypted_bye_message`
- **conversations** — `encrypted_contact_last4`
- **signal_contacts** — `identifier_ciphertext`
- **report_types** — `encrypted_name`, `encrypted_description`
- **tags** — `encrypted_label`, `encrypted_category`
- **shifts** — `encrypted_name`
- **calls** — `encrypted_caller_number`, `encrypted_phone`
- **settings** — `encrypted_name`, `encrypted_description` (multiple), `encrypted_field_name`, `encrypted_label`, `encrypted_options`, `encrypted_audio_data`, `encrypted_categories`, `encrypted_api_key`, `encrypted_brand_sid`, `encrypted_campaign_sid`, `encrypted_messaging_service_sid`, `encrypted_credentials`, `encrypted_number`
- **teams** — `encrypted_name`, `encrypted_description`
- **intakes** — `encrypted_payload`
- **sessions** — `encrypted_meta`
- **identity** — `encrypted_name` (x2), `encrypted_phone` (x2), `encrypted_label`
- **push_subscriptions** — `encrypted_endpoint`, `encrypted_auth_key`, `encrypted_p256dh_key`, `encrypted_device_label`
- **firehose** — `encrypted_display_name`
- **bans** — `encrypted_phone`, `encrypted_reason`

Expected FIX rows, from the exploration:

- Every hub-key-encrypted column currently has no AAD — all become FIX rows with ``aad = utf8ToBytes(`${LABEL}:${recordId}:${fieldName}`)``.
- Every ECIES-inner-encrypted column currently has no AAD — all become FIX rows with `aad = concat(utf8ToBytes(label), [labelId], utf8ToBytes(recordId))`.
- Every nested-envelope payload currently has no inner-AAD — the outer envelope's `aad` is the label registry binding; the inner content's AAD is added in the same commit.

The audit report is the PR-visible artifact. If any column ends up as FIX and the fix is not applied in the same PR, the PR is blocked — Tier 0 is not complete until every column is PASS.

### 0.4. Export-path integrity audit

**Threat model:** Albrecht #5 — IND-CCA break in Matrix key backup. The MAC did not cover the IV. We verify that every Llamenos export path uses AEAD end-to-end and that the AEAD tag covers IV + framing metadata.

**In scope:**

1. **Voicemail recordings.** `src/server/services/storage-manager.ts` uploads to RustFS. Audited: key wrapping uses `LABEL_VOICEMAIL_WRAP`; audio payload uses per-recording symmetric key; transcript uses `LABEL_VOICEMAIL_TRANSCRIPT`. FIX rows (if any) add AAD bound to voicemail id.
2. **Attachments.** `src/client/lib/file-crypto.ts` handles per-file envelope encryption. Audited for AAD binding to `fileId`.
3. **GDPR user export.** `src/server/services/gdpr.ts` returns a user-scoped JSON payload. Audited: payload must be encrypted under a per-export random key wrapped to the requesting user's pubkey via `LABEL_BACKUP`. AAD = ``utf8ToBytes(`${LABEL_BACKUP}:${exportId}:${userId}`)``.
4. **Contact intake submissions.** `src/server/services/intakes.ts` stores intake blobs. Audited: already enveloped; AAD binding added per record id.
5. **Admin settings export.** If any endpoint returns a downloadable settings bundle. Search turns up none at the time of writing; the audit report confirms absence or locates the path.

Each export target gets a section in `docs/security/AEAD_AUDIT_2026-04-10.md`. Every framing field (filename, content-type, size, sequence number for chunked uploads) that is transmitted or stored alongside the ciphertext is either covered by AEAD AAD or explicitly documented as not security-sensitive.

### 0.5. CSP L3 + Trusted Types + Report-Only rollout + Font self-hosting

#### 0.5.1. Per-response script nonce

`src/server/middleware/security-headers.ts` generates a per-response nonce:

```typescript
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  // Generate a 128-bit nonce for this response
  const nonceBytes = new Uint8Array(16)
  crypto.getRandomValues(nonceBytes)
  const nonce = btoa(String.fromCharCode(...nonceBytes))
  c.set('cspNonce', nonce)

  await next()
  // ... set headers using `nonce`
})
```

The nonce is stashed in Hono context so the HTML render step can inject it. Vite's `index.html` contains a `__CSP_NONCE__` placeholder that the server substitutes on GET.

A Vite plugin in `vite.config.ts` emits `index.html` with `__CSP_NONCE__` intact during build. At runtime, the server serves `index.html` via a middleware that does a single string replace per response. For non-HTML responses (API, static assets), the middleware is bypassed.

Updated CSP header:

```
default-src 'none';
script-src 'self' 'nonce-{nonce}' 'strict-dynamic';
style-src 'self' 'nonce-{nonce}';
img-src 'self' data: blob:;
font-src 'self';
media-src 'self' blob:;
connect-src 'self' wss://{host}{relayWsOrigin};
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
frame-src 'none';
frame-ancestors 'none';
base-uri 'none';
form-action 'none';
require-trusted-types-for 'script';
trusted-types llamenos;
upgrade-insecure-requests;
```

Notes:

- `default-src 'none'` replaces the current `default-src 'self'` to force every directive to be explicit.
- `script-src 'self' 'nonce-{nonce}' 'strict-dynamic'` — `strict-dynamic` promotes any script loaded by a nonced script to trusted, so dynamic imports in the React bundle work without needing nonces on every downstream chunk.
- `style-src 'self' 'nonce-{nonce}'` — no `'unsafe-inline'`. See 0.5.2.
- `base-uri 'none'` — no `<base>` tag allowed, prevents relative-URL hijack attacks.
- `form-action 'none'` — no form submissions allowed (the SPA uses fetch for all mutations).
- `worker-src 'self' blob:` — the crypto worker and whisper worker must be loadable; `blob:` enables worker construction from `URL.createObjectURL`.

#### 0.5.2. Removing `'unsafe-inline'` from `style-src`

Tailwind's JIT produces static CSS at build time. The current `'unsafe-inline'` was originally added because:

1. shadcn/ui components sometimes use inline `style=` attributes for dynamic values (animation delays, computed colors).
2. The `<style>` element injected by some libraries (e.g. Radix) uses runtime style insertion.

The cleanup:

- **For shadcn/ui inline `style=` attrs:** replace with CSS custom properties set on the element's `style` attribute. CSS custom properties are still inline styles, so `style-src 'self' 'nonce-{nonce}'` still blocks them unless we use `'unsafe-hashes'`. Decision: we use `'unsafe-hashes'` with a short allowlist of known-hash inline styles enumerated at build time. The Vite plugin walks the compiled bundle, hashes every residual `style=` attribute, and emits the hash list into the CSP header.
- **For Radix inline `<style>` injection:** Radix's animation primitives use `@keyframes` injected at runtime. Solution: bundle Radix's keyframes into a static stylesheet at build time. Vite's CSS pipeline already handles this for explicit imports; we add a post-processing step that pre-renders any known Radix keyframes into `@/styles/radix-keyframes.css`.

No fallback. If either cleanup turns out larger than expected during implementation, Tier 0 completes both — shadcn/ui inline `style=` migration to CSS custom properties and Radix keyframes pre-bundling — before shipping. `style-src 'self' 'nonce-{nonce}'` plus a build-time `'unsafe-hashes'` allowlist is the final header. `'unsafe-inline'` is banned across the entire codebase from this tier onward; a CI grep check on the shipped CSP header asserts its absence.

#### 0.5.3. Trusted Types policy

`src/client/lib/trusted-types-policy.ts`:

```typescript
import DOMPurify from 'dompurify'

export function installTrustedTypesPolicy(): void {
  if (typeof window === 'undefined' || !('trustedTypes' in window)) return
  const tt = (window as unknown as { trustedTypes: TrustedTypePolicyFactory }).trustedTypes
  tt.createPolicy('llamenos', {
    createHTML: (input: string) => DOMPurify.sanitize(input, { RETURN_TRUSTED_TYPE: false }),
    createScriptURL: (input: string) => {
      const url = new URL(input, window.location.origin)
      if (url.origin !== window.location.origin) {
        throw new TypeError(`[TrustedTypes] Blocked script URL: ${input}`)
      }
      return input
    },
    createScript: () => {
      throw new TypeError('[TrustedTypes] createScript is never permitted')
    },
  })
}
```

Called from `src/client/main.tsx` before `ReactDOM.createRoot`.

DOMPurify is added as a dependency (it is the reference sanitizer for Trusted Types policies and already audited). Configure it to strip all script and event-handler content and leave rich text intact.

React 18+ interops with Trusted Types: when `require-trusted-types-for 'script'` is in effect, any raw-HTML injection via React's unsafe HTML-setter prop with a plain string throws. The codebase does not currently use that prop, so the policy is defensive against future regressions rather than required for current code.

#### 0.5.4. `/api/csp-report` ingest endpoint and Report-Only rollout

New route `src/server/routes/csp-report.ts`:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import { createLogger } from '../lib/logger'

const log = createLogger('csp-report')

const CspReportBodySchema = z.object({
  'csp-report': z.object({
    'document-uri': z.string().optional(),
    'referrer': z.string().optional(),
    'violated-directive': z.string().optional(),
    'effective-directive': z.string().optional(),
    'original-policy': z.string().optional(),
    'blocked-uri': z.string().optional(),
    'line-number': z.number().optional(),
    'column-number': z.number().optional(),
    'source-file': z.string().optional(),
    'status-code': z.number().optional(),
    'script-sample': z.string().optional(),
  }),
})

const route = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: {
      content: {
        'application/csp-report': { schema: CspReportBodySchema },
        'application/json': { schema: CspReportBodySchema },
      },
    },
  },
  responses: { 204: { description: 'Report accepted' } },
  tags: ['Security'],
})

const app = new OpenAPIHono()
app.openapi(route, (c) => {
  const report = c.req.valid('json')
  log.warn('csp_violation', {
    directive: report['csp-report']['violated-directive'],
    blockedUri: report['csp-report']['blocked-uri'],
    sourceFile: report['csp-report']['source-file'],
    line: report['csp-report']['line-number'],
    userAgent: c.req.header('user-agent'),
  })
  return c.body(null, 204)
})

export default app
```

The endpoint accepts reports but does not persist them to the DB (CSP reports can be high-volume and are primarily useful for observability, not forensics). Violations land in stdout as structured JSON log lines and are queryable via the existing log aggregator. No auth is required — browsers will not include cookies to a `report-uri` anyway.

**Rollout sequence:**

1. **Phase A — Report-Only (one release).** Ship CSP as `Content-Security-Policy-Report-Only: ...; report-uri /api/csp-report; report-to csp-endpoint`. Also ship a `Report-To: { "group": "csp-endpoint", "max_age": 10886400, "endpoints": [{ "url": "/api/csp-report" }] }` header. Collect violations for one full release cycle. A violations-per-hour metric is exposed via the existing metrics route.
2. **Phase B — Enforcement.** If violations during Phase A are all explained (legitimate edge cases accounted for, no in-app functionality broken), flip the header name to `Content-Security-Policy`. Retain the `Content-Security-Policy-Report-Only` header with the *next* generation policy during every subsequent tightening so every future change has a report-only run before enforcement.

Both phases ship in Tier 0. Phase A is the default in the first release; Phase B is a one-line env-var-driven switch in the middleware (`CSP_MODE=enforcing` vs `CSP_MODE=report-only`).

#### 0.5.5. Self-hosting Google Fonts

Current state: `index.html` references Google Fonts via `<link href="https://fonts.googleapis.com/...">`. The existing COEP `require-corp` comment flags this as a blocker.

Fix:

1. `scripts/fetch-fonts.sh` — new build-time script that downloads the required font files (Inter and any secondary fonts the design uses) into `public/fonts/` at fixed versions. The script is deterministic (pinned version hashes) so reproducible builds remain reproducible.
2. `src/client/styles/fonts.css` — new stylesheet with `@font-face` declarations referencing `/fonts/Inter-*.woff2`.
3. `index.html` — remove the Google Fonts `<link>`; import `fonts.css` via the existing stylesheet import chain.
4. `.gitignore` — exclude `public/fonts/` (fetched at build time, not checked in).
5. `Dockerfile.build` — run `scripts/fetch-fonts.sh` before `bun run build`.
6. `.github/workflows/release.yml` — add the font fetch step; the fetched files are content-hashed into `CHECKSUMS.txt` so any tampering with upstream Google Fonts is detectable.

Self-hosting unblocks `Cross-Origin-Embedder-Policy: require-corp` fully: no cross-origin subresources, no CORP header dependency on third parties.

### 0.6. Cosign signing + CycloneDX SBOM + extended verify-build

#### 0.6.1. Cosign keyless blob signing

`.github/workflows/release.yml`, new step in the `release` job after the existing GPG signing step:

```yaml
- name: Install cosign
  uses: sigstore/cosign-installer@d7d6e079ac29fd41e9a4c81c7a1b6e4e8b7fe1ec  # v3.7.0
  with:
    cosign-release: 'v2.4.1'

- name: Cosign sign CHECKSUMS.txt
  env:
    COSIGN_YES: "true"
  run: |
    cosign sign-blob \
      --yes \
      --bundle CHECKSUMS.txt.cosign-bundle \
      CHECKSUMS.txt
```

The `CHECKSUMS.txt.cosign-bundle` contains the signature, certificate, and Rekor transparency-log inclusion proof. No private-key management — the GitHub Actions OIDC token identifies the signer, and Sigstore's Fulcio issues a short-lived certificate. Rekor's transparency log provides an independent public record.

#### 0.6.2. CycloneDX SBOM

Immediately after the Cosign step:

```yaml
- name: Generate CycloneDX SBOM
  uses: anchore/sbom-action@e11c554f704a0b820cbf8c51673f6945e0731532  # v0.17.8
  with:
    path: .
    format: cyclonedx-json
    output-file: sbom.cdx.json
    artifact-name: sbom.cdx.json

- name: Attest SBOM
  uses: actions/attest-sbom@bd218ad0dbcb3e146bd073d1d9c6d78e08aa8a0b  # v2.1.0
  with:
    subject-path: |
      CHECKSUMS.txt
      dist/client/**/*.js
      dist/client/**/*.css
    sbom-path: sbom.cdx.json
```

SBOM generation via `syft` (anchore/sbom-action is a syft wrapper) produces a CycloneDX JSON document listing every dependency with version, license, and package hash. The SBOM itself is attested via `actions/attest-sbom`, which produces an in-toto SBOM attestation tied to the build artifacts.

#### 0.6.3. Release artifact list

The `Create GitHub Release` step is updated to attach the new artifacts:

```yaml
files: |
  CHECKSUMS.txt
  CHECKSUMS.txt.asc
  CHECKSUMS.txt.cosign-bundle
  sbom.cdx.json
  provenance.json
```

#### 0.6.4. Extended `verify-build.sh`

After the existing GPG verification block:

```bash
# Verify cosign bundle
if gh release download "$VERSION" --repo "$REPO" --pattern "CHECKSUMS.txt.cosign-bundle" --dir "$WORKDIR" 2>/dev/null; then
  if command -v cosign >/dev/null; then
    cosign verify-blob \
      --bundle "$WORKDIR/CHECKSUMS.txt.cosign-bundle" \
      --certificate-identity-regexp "^https://github\.com/${REPO}/\.github/workflows/release\.yml@refs/tags/" \
      --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
      "$WORKDIR/CHECKSUMS.txt"
    echo "Cosign signature: VERIFIED"
  else
    echo "WARNING: cosign CLI not installed — cosign verification skipped"
    echo "Install: https://docs.sigstore.dev/cosign/installation/"
  fi
else
  echo "WARNING: No cosign bundle attached to release $VERSION"
fi

# Verify SBOM is present and parseable
if gh release download "$VERSION" --repo "$REPO" --pattern "sbom.cdx.json" --dir "$WORKDIR" 2>/dev/null; then
  if jq -e '.bomFormat == "CycloneDX"' "$WORKDIR/sbom.cdx.json" >/dev/null; then
    COMPONENT_COUNT=$(jq '.components | length' "$WORKDIR/sbom.cdx.json")
    echo "SBOM: CycloneDX, $COMPONENT_COUNT components"
  else
    echo "ERROR: sbom.cdx.json is not a valid CycloneDX document"
    exit 1
  fi
else
  echo "WARNING: No SBOM attached to release $VERSION"
fi
```

The script exits non-zero on any FAILED check and zero with a WARNING on any SKIPPED check (for gradual rollout — first release with cosign will not have a bundle on pre-cosign releases).

#### 0.6.5. Documentation

- `docs/REPRODUCIBLE_BUILDS.md` — updated with cosign + SBOM verification steps, Sigstore certificate identity format, how to install cosign locally.
- `docs/security/SUPPLY_CHAIN_HARDENING.md` — new document consolidating the build-pipeline security posture: reproducible builds, SLSA Build L3 provenance, GPG-signed checksums, cosign keyless signing, CycloneDX SBOM, `verify-build.sh` usage.

## Resolved open questions (from the brief)

Decisions made during brainstorming and baked into the design above. Captured here for traceability.

1. **Single vs multiple decrypt entry points.** Multiple entry points retained. Safety is enforced by a compile-time branded `CryptoLabel` type plus runtime AEAD AAD binding. Both mechanisms are independent — either alone prevents type confusion, and they combine for defense in depth.
2. **Label location — framing vs HKDF.** Both. HKDF path (existing `sha256(label || sharedX)`) is unchanged. Envelope v2 adds `labelId` in AEAD AAD. Either mechanism alone prevents Albrecht #3; having both means a single primitive bug does not silently accept a wrong-label envelope.
3. **Audit entry schema fields.** Discriminated zod union for `payload`; `SignedAuditEntrySchema` envelope includes `signerDeviceId`, `signerPubkey`, and `signature` (schnorr over `entryHash`); `entryHash` is SHA-256 over a deterministic canonicalized form that pins a `v: 1` version tag for forward compatibility.
4. **Chain verification frequency.** Incremental. The first verification per session walks the full chain from TOFU anchor; subsequent verifications within the session walk only the delta since `lastVerifiedEntryHash`. Cache lives in IDB keyed per hub; cleared on lock; rebuilt on unlock.
5. **CSP migration strategy.** Report-Only for one release with `/api/csp-report` ingest and structured log collection; flipped to enforcement in the next release. Both modes are env-var-driven.
6. **Trusted Types policy name.** `llamenos` (project-specific, distinct from React defaults).
7. **Export path audit scope.** Everything written to `StorageManager` plus every endpoint that returns a file: voicemail, attachments, GDPR export, contact/intake blobs, any future admin settings export.
8. **SLSA level.** Already at Build L3 via `actions/attest-build-provenance`. Materials coverage is extended by adding SBOM attestation via `actions/attest-sbom`. No workflow structural changes.

## Testing

**Guiding principle:** every workstream lands with unit + API E2E + UI E2E coverage proportional to its blast radius. No workstream ships without adversarial test cases that assert the *negative* path (wrong label rejected, tampered chain rejected, forged signature rejected, CSP violation reported, AAD mismatch rejected).

### New unit tests

- `src/shared/crypto-primitives.test.ts`
  - `symmetricEncrypt`/`symmetricDecrypt` with matching AAD succeeds
  - `symmetricDecrypt` with wrong AAD throws
  - `decryptEnvelopeV2` rejects envelope with wrong `labelId`
  - `decryptEnvelopeV2` rejects envelope with wrong `v` field
  - `eciesWrapKey`/`eciesUnwrapKey` with mismatched label throws (was already passing, now documented)
  - `CryptoLabel` branded type test (tsd-style compile-only assertion)
- `src/shared/schemas/audit-entries.test.ts`
  - Every payload variant round-trips through zod
  - `computeEntryHash` is deterministic for the same input
  - `computeEntryHash` differs when any field changes (all fields are hashed)
  - Canonicalization sorts keys deeply
  - Schnorr signature over `entryHash` verifies
- `src/shared/lib/canonical-json.test.ts`
  - Nested objects canonicalize with sorted keys at every level
  - Arrays preserve order
  - `null`, booleans, numbers, strings all round-trip
  - `NaN` / `Infinity` / `undefined` throw
- `src/client/lib/audit-chain-verifier.test.ts`
  - Happy path: chain of 10 entries verifies end-to-end
  - Divergent `prevEntryHash` rejected
  - Tampered `entryHash` rejected
  - Forged signature (valid-looking hex, wrong key) rejected
  - Unknown signer rejected unless introduced by a prior `device_add`
  - Incremental verification after first full walk reads only the delta
  - Cache invalidation on divergence
- `src/client/lib/hub-key-manager.test.ts`
  - `rotateHubKey` blocks on unverified chain
  - `rotateHubKey` blocks when head is not a membership-change entry
  - `rotateHubKey` blocks when `expectedTriggerEntryHash` does not match head
- `src/client/lib/trusted-types-policy.test.ts`
  - `installTrustedTypesPolicy` is a no-op when `trustedTypes` is absent
  - `createHTML` sanitizes XSS vectors
  - `createScriptURL` blocks cross-origin
  - `createScript` throws unconditionally
- `src/server/routes/csp-report.test.ts`
  - Accepts `application/csp-report` and `application/json` bodies
  - Logs violation via server logger
  - Returns 204 on success
  - Rejects malformed bodies with 400

### New API E2E tests

- `tests/api/audit-signed.spec.ts`
  - Append a signed membership entry → fetch chain → verify client-side
  - Reject an entry whose `prevEntryHash` does not match the current head
  - Reject an entry with an invalid schnorr signature
  - Reject an entry whose `signerPubkey` does not match a registered device
  - Reject a payload type the signer is not authorized for
- `tests/api/csp-report.spec.ts`
  - POST a synthetic CSP violation → 204 → log line visible in stdout buffer
  - Reject unknown body shape with 400
- `tests/api/aead-roundtrip.spec.ts`
  - Create a hub-key-encrypted field, decrypt it with matching AAD
  - Attempt to decrypt one row's ciphertext in another row's position → AAD mismatch throws
  - Attempt to decrypt a v1 envelope → rejected
- `tests/api/hub-key-rotation.spec.ts`
  - Admin removes a member → audit entry signed and appended → client verifies chain → rewrap succeeds → new envelopes returned
  - Server tampers with the removed member's identity in the audit-log response → client verification fails → rewrap blocked
- `tests/api/release-artifacts.spec.ts` *(ops-level, smoke)*
  - `CHECKSUMS.txt.cosign-bundle` attached to latest release
  - `sbom.cdx.json` attached, parseable CycloneDX

### New UI E2E tests

- `tests/ui/csp-enforcement.spec.ts`
  - Load the app → assert no CSP violations in Report-Only mode (report endpoint received zero genuine violations during the load)
  - Assert Trusted Types `llamenos` policy is installed via `window.trustedTypes`
  - Inject a synthetic violation (e.g. a dynamically inserted inline script tag without a valid nonce) → report endpoint receives the violation
- `tests/ui/hub-membership-removal.spec.ts`
  - Admin removes a volunteer → audit entry visible in UI → volunteer's access to hub data removed on their next reload
  - Client logs `rotateHubKey` chain verification success
- `tests/ui/label-mismatch.spec.ts`
  - Surgery on API response (via Playwright route intercept) swaps an envelope's `labelId` → client rejects with `CryptoLabelMismatchError` → error surfaces as a decrypt-failure toast, not a blank field
- `tests/ui/trusted-types-policy.spec.ts`
  - Page loads with Trusted Types policy installed
  - A raw-HTML injection attempt via React's unsafe HTML-setter prop in a dev-only test fixture throws

### Existing test suites — regression gate

All existing tests must continue to pass. Tier 0 is defensive; no behavior change is intended for happy-path flows:

- `bun run typecheck` — clean (the branded `CryptoLabel` type will flush out any raw-string-literal usages in crypto paths; all must be fixed in the same PR)
- `bun run lint` — clean
- `bun run build` — clean
- `bun run test:unit` — all existing + new unit tests pass
- `bunx playwright test tests/api` — all existing + new API tests pass
- `bunx playwright test tests/ui` — all existing + new UI tests pass
- `./scripts/verify-build.sh` — on a synthetic release, verifies CHECKSUMS + GPG + cosign bundle + SBOM

### Adversarial test design notes

The unit tests for chain verification and label enforcement intentionally construct attack inputs:

- **Forged signature.** Generate a valid schnorr signature under the wrong private key, then verify with the wrong pubkey. Assert the verification fails.
- **Tampered hash.** Mutate a byte in `entryHash` after signing. Assert recomputation catches the mismatch before signature verification runs.
- **Replay.** Attempt to post the same signed entry twice. Assert the second rejection cites `prev_entry_hash_mismatch`.
- **Cross-hub confusion.** Post an entry with `hubId` set to a hub the signer is not an admin of. Assert rejection cites `signer_not_authorized_for_payload`.
- **Label swap.** Build an envelope v2 with valid ECIES under `LABEL_NOTE_KEY` but `labelId` set to `LABEL_MESSAGE`'s id. Assert `decryptEnvelopeV2` rejects with `CryptoLabelMismatchError`.
- **AAD swap.** Encrypt a field with one AAD, attempt to decrypt with another. Assert `symmetricDecrypt` throws.

## Migration

**Database.** One new migration: `drizzle/migrations/0051_audit_log_signed_entries.sql` (see 0.2.5). It wipes the existing test-data audit rows (pre-production) and restructures the columns. This is a forward-only migration; no down-migration since pre-production allows clean cuts.

**Envelope format.** V1 envelopes are dropped entirely. Pre-production dev DBs contain only test data; a fresh `bun run dev:docker:down && bun run dev:docker` plus `bun run migrate` resets the state. The migration instructions are documented in `CLAUDE.md` under a new "Tier 0 migration notes" section (removed after first post-Tier-0 release).

**CSP.** Ships in Report-Only mode first. No client-facing change beyond the report endpoint being populated. One release later, enforcement mode is enabled via `CSP_MODE=enforcing`.

**Fonts.** Build-time script fetches Google Fonts to `public/fonts/`. Production builds have no network dependency on Google. Dev mode runs the same script (one-time on first `bun run dev`).

**Build pipeline.** Cosign + SBOM are additive. Existing releases remain verifiable via GPG. New releases add two additional verification layers; `verify-build.sh` emits WARNING (not ERROR) on missing cosign/SBOM for backfill compatibility with pre-Tier-0 releases. First post-Tier-0 release gets full coverage.

**Logging integration with PR #45.** PR #45 (`feat/logging-infrastructure`) is in flight and reworks both `createLogger` (server) and `createDebugLog` (client). Tier 0 is compatible with either pre- or post-#45 primitives: the current `createLogger` already supports `info/warn/error` with structured extras, which is all Tier 0 needs. If #45 lands first, Tier 0 inherits the `Loggable<T>` compile-time PII gate automatically, which is a strict improvement.

## Out of scope

Explicitly deferred to later tiers. Every item below is tracked in the master doc and will get its own spec in its own session.

- **Primitive swap** to HPKE (Tier 1). Still using hand-rolled ECIES over secp256k1 with SHA-256 `label || sharedX` as a lightweight KDF. HPKE (RFC 9180) is the formally-analyzed standard, and our 25 labels map 1:1 to HPKE `info` strings, but the migration is a weeks-of-work primitive swap.
- **Non-extractable `CryptoKey`** in IndexedDB (Tier 1). The nsec still lives as raw bytes in the Web Worker closure, zeroed on lock. PR #50's session capsule reduces the re-unlock cost but does not move to non-extractable keys.
- **Native WebCrypto X25519 / Ed25519** (Tier 1). Still using `@noble/curves` secp256k1.
- **`items_key` indirection** (Tier 1). Still per-recipient ECIES rewrap on every membership change.
- **WebAuthn PRF primary KEK** (Tier 2). Still PIN + optional recovery key + optional WebAuthn blob.
- **OPAQUE login** (Tier 2). Still opaque session tokens via the auth facade.
- **Diceware recovery phrase** (Tier 2). Still the existing recovery-key format.
- **1Password-style Recovery Group** (Tier 2). No admin-assisted recovery.
- **Per-device keys + Per-User Key + sigchain** (Tier 3). Still one identity key per user; device linking via ephemeral ECDH provisioning rooms.
- **Cross-signing** (Tier 3). TOFU at the first chain verification is the current ceiling.
- **Cascading Lazy Key Rotation** (Tier 3). Still full hub-key rotation on every membership change.
- **Split code/data origins + sandboxed crypto iframe** (Tier 4). Single VPS delivery.
- **Third-party verifier + gossip-signed bundle hashes** (Tier 4).
- **Voice E2EE via SFrame / RTCRtpScriptTransform** (Tier 5). No media-layer encryption above DTLS-SRTP.
- **MLS group keying** (Tier 6).
- **ML-KEM-1024 hybrid post-quantum** (Tier 6).
- **Commissioned public audit**. Tier 0 is internal hardening.
- **Subresource Integrity (SRI) hashes for script tags.** Considered; superseded by `strict-dynamic` + nonces for our threat model. Revisit if Tier 4 split-origin delivery reintroduces third-party script loading.

## Success criteria

The spec is complete when the implementation of the accompanying plan achieves all of the following:

1. **Zero raw-string literals** in any file matching `src/**/*crypto*.ts`, `src/**/*decrypt*.ts`, `src/**/*encrypt*.ts`, `src/client/lib/*envelope*.ts`, `src/server/lib/crypto*.ts`. `grep` check enforced in CI.
2. **Every `ciphertext()` column** has a row in `docs/security/AEAD_AUDIT_2026-04-10.md` with status PASS, and the row's documented AAD construction matches the encrypt call site's actual AAD argument.
3. **Client-side chain verification** runs before every `rotateHubKey` call, and `rotateHubKey` throws `ChainVerificationError` when the chain is tampered (verified by API test that mutates the server response).
4. **CSP ships in Report-Only mode** in the first release under this tier; enforcement mode lands in the second release and is verified by UI test that asserts `Content-Security-Policy` (not -Report-Only) is the active header.
5. **Trusted Types policy `llamenos` is installed** on every page load, verified by UI test.
6. **`/api/csp-report` logs** at least one synthetic violation during the CI UI suite, verified by API test.
7. **Cosign signature, CycloneDX SBOM, SLSA build provenance** are all attached to the next release, and `./scripts/verify-build.sh` verifies them all.
8. **All existing tests** (`bun run test:unit`, `tests/api`, `tests/ui`) pass alongside the new coverage.
9. **`docs/REPRODUCIBLE_BUILDS.md` and `docs/security/SUPPLY_CHAIN_HARDENING.md`** document the new verification steps with worked examples.
10. **The pre-existing silent-failure pattern** in `hub-field-crypto.ts#decryptHubField` and `hub-key-manager.ts#decryptFromHub` is replaced with structured error propagation — decrypt failures raise `DecryptError` subclasses (`CryptoLabelMismatchError`, `AadMismatchError`, `UnregisteredLabelError`) and callers handle them explicitly. Bare `catch` blocks in crypto paths become compile-time lint errors via a new biome rule.

Every success-criteria item has a corresponding test or grep check and is verifiable by an independent reviewer.
