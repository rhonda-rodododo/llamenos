# Phase 2 P2 — Type-Design Hardening Brainstorm

**Date:** 2026-04-15
**Author:** Security workstream (scoping session)
**Status:** Draft — awaiting human review before implementation slices are dispatched
**Source:** `docs/security/SECURITY_OVERHAUL_COMPLETION_AUDIT_2026-04-14.md` §Phase-2 P2

---

## 1. What are we trying to accomplish?

The security overhaul completion audit (2026-04-14) identified 8 type-design
follow-ups classified as Phase 2 P2 "polish." These are non-exploitable hardening
items: compile-time type invariants that prevent future developer mistakes rather
than fixing current vulnerabilities. They were deferred from Phase 1 because they
have zero runtime security impact today — no attacker can exploit a missing branded
type. But as the codebase grows and new developers contribute, each untyped
boundary is a landmine where a valid-looking `Uint8Array` or `CryptoKey` gets
passed to the wrong function and the error surfaces at runtime (or worse, silently
produces garbage).

**Why type-design matters for security:**

1. **Compile-time invariants > runtime checks.** A branded `VerifiedShare` type
   makes it structurally impossible to pass an unverified Shamir share to the
   reconstruction function. The compiler rejects it — no test needed, no runtime
   guard, no code review to catch it.

2. **Parse-don't-validate eliminates impossible states.** When `UnsignedAuditEntry`
   and `SignedAuditEntry` are distinct types connected only by a signing function,
   it's impossible to write code that treats an unsigned entry as signed. The type
   system encodes the state machine.

3. **Redaction-by-default prevents accidental exposure.** A `DicewarePhrase`
   wrapper that returns `[REDACTED]` from `toJSON()` means `JSON.stringify` on any
   object containing a recovery phrase is safe by default. The developer must
   explicitly call `.reveal()` to get the plaintext — an auditable code pattern.

4. **Registry separation prevents semantic confusion.** When AEAD labels and HKDF
   info strings share the same registry, a developer can accidentally use an
   HKDF-only label as AEAD AAD. Splitting them makes the type system enforce the
   distinction.

**Scope:** 8 topics, each independently shippable. No data migrations, no wire
format changes (except Topic 7 which adjusts a development-only registry — see
§5.7). All changes are code-level type refinements with associated tests.

---

## 2. Who is affected?

### Per-topic impact matrix

| # | Topic | Primary files | Call sites to update | Tests to update |
|---|-------|--------------|---------------------|----------------|
| 1 | Branded `ShamirShare` / `VerifiedShare` | `recovery-group-share.ts` | ~6 (test + unlock-factors) | `recovery-group-share.test.ts` |
| 2 | `DicewarePhrase` wrapper | `recovery-phrase.ts` | ~4 (unlock-factors + tests) | `recovery-phrase.test.ts`, `unlock-factors.test.ts` |
| 3 | `Ed25519SigningKey` / `X25519EncryptionKey` wrappers | `types.ts`, `device-identity.ts`, `cross-signing.ts`, `puk.ts`, `hpke-primitives.ts`, `crypto-worker.ts` | ~40+ function signatures | 7+ test files |
| 4 | Branded `MlsGroupId` / `MlsEpoch` | `mls/conversation.ts` (skeleton), future MLS files | 0 today (skeleton) | `core-crypto-loader.test.ts`, future MLS tests |
| 5 | Branded `SframeFrame` record | `sframe/frame-codec.ts`, `sframe/sframe-types.ts` | ~8 (worker + codec + tests) | `frame-codec.test.ts`, `sframe-types.test.ts` |
| 6 | Parse-don't-validate audit entry | `audit-entries.ts`, `audit-log-client.ts`, `audit-log-service.ts`, `audit-chain-verifier.ts` | ~12 (client + server + tests) | 5 test files |
| 7 | HKDF labels out of `LABEL_REGISTRY` | `crypto-labels.ts` | ~3 (label lookup + tests) | `crypto-labels.test.ts` |
| 8 | AEAD adversarial tests | New test files only | 0 (test-only) | 3 new test files |

**Total estimated call-site changes:** ~75 (dominated by Topic 3).

### Affected modules

- **Client crypto layer:** `src/client/lib/` — Topics 1, 2, 3, 5, 6
- **Shared schemas/types:** `src/shared/` — Topics 3, 4, 6, 7
- **Server services:** `src/server/services/` — Topic 6
- **MLS directory:** `src/client/lib/mls/` — Topic 4
- **SFrame directory:** `src/shared/sframe/`, `src/client/lib/webrtc/` — Topic 5
- **Tests only:** Topics 7, 8

---

## 3. What does "done" look like?

### Per-topic acceptance criteria

**Topic 1 — Branded `ShamirShare` / `VerifiedShare`:**
- `ShamirShare` is a branded `Uint8Array` returned by `splitRecoveryGroupSecret`
- `VerifiedShare` is a branded `Uint8Array` returned only by successful commitment verification
- `combineAndVerifyShares` accepts `VerifiedShare[]`, not raw `Uint8Array[]`
- `combineRecoveryGroupShares` is either unexported or requires `VerifiedShare[]` (eliminates the "unsafe primitive remains exported" audit finding #4)
- Passing a raw `Uint8Array` to `combineAndVerifyShares` is a compile-time error

**Topic 2 — `DicewarePhrase` wrapper:**
- `DicewarePhrase` class wraps the recovery phrase string
- `JSON.stringify(phrase)` returns `"[REDACTED]"`
- `console.log(phrase)` shows `DicewarePhrase [REDACTED]` (via `[Symbol.for('nodejs.util.inspect.custom')]` and `toString()`)
- Explicit `phrase.reveal()` returns the plaintext string
- `generateRecoveryPhrase()` returns `DicewarePhrase`, not `string`
- All downstream callers (`unlock-factors.ts`) use `.reveal()` when they need the raw string for KDF

**Topic 3 — `Ed25519SigningKey` / `X25519EncryptionKey` / `AesGcmKey` wrappers:**
- Three branded wrapper types around `CryptoKey`, each carrying algorithm intent in the type
- `hpkeSeal`/`hpkeOpen` accept `X25519EncryptionKey`, not bare `CryptoKey`
- `crossSignOwnDevice`/`crossSignOtherUser` accept `Ed25519SigningKey`, not bare `CryptoKey`
- `aesGcmEncrypt`/`aesGcmDecrypt` accept `AesGcmKey`, not bare `CryptoKey`
- `DeviceKeypair.signing.privateKey` is `Ed25519SigningKey`, `encryption.privateKey` is `X25519EncryptionKey`
- Passing the wrong key type is a compile-time error

**Topic 4 — Branded `MlsGroupId` / `MlsEpoch`:**
- `MlsGroupId` branded `Uint8Array` type defined in `src/shared/types.ts`
- `MlsEpoch` branded `bigint` type defined in `src/shared/types.ts`
- `MlsConversation` skeleton updated to use these types in its interface (method signatures)
- Future MLS DB schema columns typed accordingly
- Passing a hub UUID where an `MlsGroupId` is expected is a compile-time error

**Topic 5 — Branded `SframeFrame` refinements:**
- `SealedFrame` branded record type wrapping `{ ciphertext: CiphertextBytes; trailer: ParsedTrailer }`
- `open()` in `frame-codec.ts` requires `SealedFrame` (not raw bytes), returns `OpenResult`
- `seal()` returns `SealedFrame`
- An unprocessed frame (raw RTP payload) has a different type than a sealed frame

**Topic 6 — Parse-don't-validate `UnsignedAuditEntry` → `SignedAuditEntry`:**
- `UnsignedAuditEntry` is a named type (not `Omit<...>`)
- `SignedAuditEntry` can only be constructed by `buildSignedAuditEntry()` (client) or `SignedAuditEntrySchema.parse()` (server)
- `appendSigned` accepts `SignedAuditEntry`, never `UnsignedAuditEntry`
- No `as SignedAuditEntry` casts anywhere in the codebase
- The type transition is the signing function itself: `sign(unsigned: UnsignedAuditEntry) → SignedAuditEntry`

**Topic 7 — HKDF labels split from `LABEL_REGISTRY`:**
- `LABEL_REGISTRY` contains only AEAD labels (used as `label` arg in seal/open)
- HKDF-only labels are plain strings (not `CryptoLabel` branded) in a separate `HKDF_LABELS` constant
- `labelToId`/`idToLabel` only work with AEAD labels
- Five flagged labels (`LABEL_ITEMS_KEY_EXPORT`, `LABEL_NOTE_EPOCH_KEY`, `LABEL_MLS_PROVISION`, `LABEL_SAS_MLS_V3`, `LABEL_SFRAME_RATCHET`) removed from `LABEL_REGISTRY`
- No wire-format break (these labels have no production callers)

**Topic 8 — AEAD adversarial tests:**
- PUK interruption test: simulates Promise rejection mid-rotation, asserts detectable half-committed state
- Shamir garbage-combine test: passes N < threshold shares to raw `combine()`, asserts wrong output ≠ original secret, asserts consistent (deterministic) garbage across runs
- OPAQUE timing test: measures server response time for "user not found" vs "wrong password", asserts delta < statistical threshold (constant-time)

---

## 4. Implementation sketch per topic

### 4.1 — Branded `ShamirShare` / `VerifiedShare`

**Current state:** `recovery-group-share.ts` uses raw `Uint8Array` for all share
parameters. `combineRecoveryGroupShares` is publicly exported and does no
verification — it calls `combine(shares)` directly from `@privy-io/shamir`. The
safer `combineAndVerifyShares` exists but nothing forces its use.

**Approach:** Define two branded `Uint8Array` subtypes in `recovery-group-share.ts`:

```typescript
declare const __ShamirShareBrand: unique symbol
declare const __VerifiedShareBrand: unique symbol

export type ShamirShare = Uint8Array & { readonly [__ShamirShareBrand]: never }
export type VerifiedShare = ShamirShare & { readonly [__VerifiedShareBrand]: never }
```

`ShamirShare` is the raw share from `splitRecoveryGroupSecret` (which becomes
`(...) => Promise<ShamirShare[]>`). `VerifiedShare` extends it — a share that has
passed commitment verification via `verifyShareCommitment()`. The verification
function becomes the only way to obtain a `VerifiedShare`:

```typescript
export async function verifyAndBrandShare(
  share: ShamirShare,
  commitment: string
): Promise<VerifiedShare> {
  const ok = await verifyShareCommitment(share, commitment)
  if (!ok) throw new ShareCommitmentError()
  return share as VerifiedShare
}
```

`combineAndVerifyShares` changes signature to accept `VerifiedShare[]`. The unsafe
`combineRecoveryGroupShares` becomes non-exported (module-private), closing audit
finding #4 from the completion audit.

**Files:** `src/client/lib/recovery-group-share.ts`, `src/client/lib/recovery-group-share.test.ts`

### 4.2 — `DicewarePhrase` wrapper class

**Current state:** `recovery-phrase.ts` functions return and accept raw `string`.
The phrase is held in memory in `unlock-factors.ts` as `factor.phrase: string`.
No logging was found, but `JSON.stringify` on any containing object would leak it.

**Approach:** Define a class that wraps the string and redacts on serialization:

```typescript
export class DicewarePhrase {
  readonly #words: string

  private constructor(words: string) {
    this.#words = words
  }

  static create(words: string): DicewarePhrase {
    if (!validateRecoveryPhrase(words)) {
      throw new RecoveryPhraseError('invalid_word')
    }
    return new DicewarePhrase(normalizeRecoveryPhrase(words))
  }

  static generate(wordCount: 12 | 15 | 18 | 24 = 15): DicewarePhrase {
    return new DicewarePhrase(generateRawPhrase(wordCount))
  }

  reveal(): string {
    return this.#words
  }

  toJSON(): string {
    return '[REDACTED]'
  }

  toString(): string {
    return 'DicewarePhrase [REDACTED]'
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'DicewarePhrase [REDACTED]'
  }
}
```

The existing `generateRecoveryPhrase()` returns `DicewarePhrase` instead of
`string`. `deriveRecoveryPhraseKekBytes` accepts `DicewarePhrase` and calls
`.reveal()` internally. The `unlock-factors.ts` call site changes from
`factor.phrase` to `factor.phrase.reveal()` at the single point where the raw
string enters the KDF.

**Files:** `src/client/lib/recovery-phrase.ts`, `src/client/lib/unlock-factors.ts`, `src/client/lib/recovery-phrase.test.ts`, `src/client/lib/unlock-factors.test.ts`

### 4.3 — `Ed25519SigningKey` / `X25519EncryptionKey` / `AesGcmKey` wrappers

**Current state:** 40+ function signatures across the crypto layer accept bare
`CryptoKey` with algorithm intent expressed only in comments. Key confusion is
structurally possible: passing an Ed25519 signing key to `hpkeSeal` (which expects
X25519) would fail at runtime in WebCrypto, but the type system provides no
compile-time guard.

**Approach:** Three branded wrappers using the same phantom-brand pattern as
`CryptoLabel` and `Ciphertext`:

```typescript
// src/shared/types.ts (alongside existing branded types)
declare const __Ed25519SigningKeyBrand: unique symbol
declare const __X25519EncryptionKeyBrand: unique symbol
declare const __AesGcmKeyBrand: unique symbol

export type Ed25519SigningKey = CryptoKey & { readonly [__Ed25519SigningKeyBrand]: never }
export type X25519EncryptionKey = CryptoKey & { readonly [__X25519EncryptionKeyBrand]: never }
export type AesGcmKey = CryptoKey & { readonly [__AesGcmKeyBrand]: never }
```

Brand application happens at the import boundary — where `crypto.subtle.importKey`
or `crypto.subtle.generateKey` returns a `CryptoKey`, the caller casts it to the
appropriate branded type. These are the "parse" points:

- `device-identity.ts: generateDeviceKeypair()` → signing keys get `Ed25519SigningKey`, encryption keys get `X25519EncryptionKey`
- `puk.ts: derivePukSubkeys()` → `signPrivate: Ed25519SigningKey`, `dhPrivate: X25519EncryptionKey`, `secretBoxKey: AesGcmKey`
- `cross-signing.ts: importEd25519FromSeed()` → `Ed25519SigningKey`
- `puk.ts: importX25519FromSeed()` → `X25519EncryptionKey`
- `crypto-worker.ts: unlockWithHandles()` → `hpkePrivateKey: X25519EncryptionKey`, `hubKey: AesGcmKey`

All downstream functions update their parameter types. This is the largest topic
by call-site count (~40 signatures), but each change is mechanical — replace
`CryptoKey` with the appropriate branded type.

**Files:** `src/shared/types.ts`, `src/client/lib/device-identity.ts`, `src/client/lib/cross-signing.ts`, `src/client/lib/puk.ts`, `src/client/lib/paper-key.ts`, `src/shared/hpke-primitives.ts`, `src/client/lib/crypto-worker.ts`, `src/client/lib/crypto-worker-client.ts`, `src/client/lib/hub-key-manager.ts`, `src/client/lib/recovery-group-tier3.ts`, `src/client/lib/webrtc/sframe-key-distribution.ts`, and their test files.

### 4.4 — Branded `MlsGroupId` / `MlsEpoch`

**Current state:** `MlsConversation` is an 11-line empty class. No MLS DB schema
exists. core-crypto's `ConversationId` takes `Uint8Array` in its constructor, and
`conversation_epoch()` returns `bigint`. The brainstorm for MLS PR #2 (§8 Decision 3)
recommends `llamenos:hub:<hubId>` as UTF-8 bytes for group ID.

**Approach:** Define branded types in `src/shared/types.ts` so they're available
before the full MLS implementation lands:

```typescript
declare const __MlsGroupIdBrand: unique symbol
declare const __MlsEpochBrand: unique symbol

export type MlsGroupId = Uint8Array & { readonly [__MlsGroupIdBrand]: never }
export type MlsEpoch = bigint & { readonly [__MlsEpochBrand]: never }

export function hubIdToMlsGroupId(hubId: string): MlsGroupId {
  return new TextEncoder().encode(`llamenos:hub:${hubId}`) as unknown as MlsGroupId
}
```

Update `MlsConversation` skeleton to declare future method signatures using these
types (still unimplemented, but the type contract is set). This way, when MLS PR #2
Slice 1 ships the DB schema, the branded types are already in place.

**Files:** `src/shared/types.ts`, `src/client/lib/mls/conversation.ts`

### 4.5 — Branded `SealedFrame` record

**Current state:** The SFrame codebase already has strong typing with `CiphertextBytes`
and `PlaintextBytes` branded types in `src/shared/sframe/sframe-types.ts`, plus
`SealContext`/`OpenContext`/`OpenResult` interfaces in `frame-codec.ts`. The
frame-codec `seal()` returns raw `Uint8Array` (the full frame bytes including
codec header + ciphertext + trailer). `open()` accepts raw `Uint8Array`.

**Approach:** The existing branded types (`CiphertextBytes`, `PlaintextBytes`) are
already well-structured. The gap is at the seal/open boundary — a sealed frame
(output of `seal()`) should be distinct from raw RTP payload bytes:

```typescript
// src/shared/sframe/sframe-types.ts
declare const __SealedFrameBrand: unique symbol

export type SealedFrame = Uint8Array & { readonly [__SealedFrameBrand]: never }
```

`seal()` returns `SealedFrame`. `open()` accepts `SealedFrame` (not raw bytes).
The RTP transform pipeline in `sframe-worker.ts` becomes: `rawFrame → seal() →
SealedFrame → network → SealedFrame → open() → OpenResult`. Passing a raw RTP
payload directly to `open()` without going through `seal()` or network receipt is
a compile-time error.

**Files:** `src/shared/sframe/sframe-types.ts`, `src/shared/sframe/frame-codec.ts`, `src/client/lib/webrtc/sframe-worker.ts`, and their test files.

### 4.6 — Parse-don't-validate `UnsignedAuditEntry` → `SignedAuditEntry`

**Current state:** No `UnsignedAuditEntry` type exists. The unsigned intermediate
is an inline object literal (`Omit<SignedAuditEntry, 'entryHash' | 'signature'>`)
in `audit-log-client.ts:15-23`. Test helpers in 3 files use the same `Omit<...>`
pattern. The transition from unsigned to signed is `{ ...unsigned, entryHash, signature }`
— a spread that the type system cannot verify enforces the signing invariant.

**Approach:** Define `UnsignedAuditEntry` as a named type in `audit-entries.ts`:

```typescript
export const UnsignedAuditEntrySchema = SignedAuditEntrySchema.omit({
  entryHash: true,
  signature: true,
})
export type UnsignedAuditEntry = z.infer<typeof UnsignedAuditEntrySchema>
```

Then make `SignedAuditEntry` constructible only through a signing function. The key
change is in `audit-log-client.ts`:

```typescript
export async function buildSignedAuditEntry(
  params: { hubId: string; payload: AuditEntryPayload; prevEntryHash: string | null; signerDeviceId: string }
): Promise<SignedAuditEntry> {
  const unsigned: UnsignedAuditEntry = { ... }
  return signAuditEntry(unsigned) // the ONLY way to get a SignedAuditEntry
}

async function signAuditEntry(unsigned: UnsignedAuditEntry): Promise<SignedAuditEntry> {
  const entryHash = computeEntryHash(unsigned)
  const signature = await cryptoWorker.signAuditEntry(entryHash)
  return SignedAuditEntrySchema.parse({ ...unsigned, entryHash, signature })
}
```

The `SignedAuditEntrySchema.parse()` call is the parse-don't-validate boundary —
the zod schema validates the hash format and signature format at runtime, and the
return type is `SignedAuditEntry`. No `as SignedAuditEntry` cast needed.

Server-side `appendSigned` already does `SignedAuditEntrySchema.safeParse()` on
input, so it's already using parse-don't-validate for inbound data. The change is
making `UnsignedAuditEntry` a named type and eliminating `Omit<...>` usage.

**Files:** `src/shared/schemas/audit-entries.ts`, `src/client/lib/audit-log-client.ts`, `src/server/services/audit-log-service.ts`, `src/client/lib/audit-chain-verifier.ts`, test files.

### 4.7 — HKDF labels split from `LABEL_REGISTRY`

**Current state:** `LABEL_REGISTRY` at `crypto-labels.ts:363-413` contains 46
entries. Five of these are HKDF info/salt strings, not AEAD labels:

| Constant | Registry index | Actual usage |
|----------|---------------|-------------|
| `LABEL_SFRAME_RATCHET` | 42 | HKDF salt in `sframe-rotation.ts:6,18` |
| `LABEL_SAS_MLS_V3` | 43 | HKDF info in `sas.ts:117` |
| `LABEL_ITEMS_KEY_EXPORT` | 44 | Unimplemented (future MLS) |
| `LABEL_NOTE_EPOCH_KEY` | 45 | Unimplemented (future MLS) |
| `LABEL_MLS_PROVISION` | 46 | Unimplemented (future MLS) |

The audit (§Invariants verified) flagged: "polluting the wire-format ID space."

**Approach:** Remove the 5 labels from `LABEL_REGISTRY`, keeping their indices
reserved (as comments) to prevent future reuse. Strip the `CryptoLabel` brand
from these 5 — they become plain strings since they're never passed as AEAD
`label` arguments:

```typescript
// Former registry entries 42-46 — reserved, never reuse these indices.
// Moved to plain strings: not AEAD labels, just HKDF info/salt.
export const LABEL_SFRAME_RATCHET = 'llamenos:sframe-ratchet:v1'
export const LABEL_SAS_MLS_V3 = 'llamenos:sas:v3'
export const LABEL_ITEMS_KEY_EXPORT = 'llamenos:items-key-export:v1'
export const LABEL_NOTE_EPOCH_KEY = 'llamenos:note-epoch-key:v1'
export const LABEL_MLS_PROVISION = 'llamenos:mls-provision:v1'
```

**Wire-format impact:** None. All five labels have zero production callers that
serialize via `labelToId()`. The 3 unimplemented labels have no callers at all.
`LABEL_SFRAME_RATCHET` is used as an HKDF salt (not via `labelToId`).
`LABEL_SAS_MLS_V3` is used as HKDF info (not via `labelToId`). No existing
ciphertext references these label IDs.

**Files:** `src/shared/crypto-labels.ts`, `src/shared/crypto-labels.test.ts`

### 4.8 — AEAD adversarial tests

**Test-only additions. No production code changes.**

**a) PUK rotation interruption (`puk.rotation-interrupt.test.ts`):**

`rotatePuk()` at `puk.ts:285-318` performs a multi-step flow: generate seed →
derive subkeys → encrypt old seed under new secretbox → HPKE-seal to all devices.
If step 4 fails partway (e.g., one device's HPKE seal throws), the caller gets a
rejected Promise but may have already persisted partial state.

Test approach: mock the HPKE seal function to succeed for device A and throw for
device B. Assert that `rotatePuk` either (a) rejects entirely with all-or-nothing
semantics, or (b) returns a result that explicitly marks the failed device so the
caller can decide whether to retry or abort. Currently `rotatePuk` uses individual
try/catch per device — the test documents the actual behavior and asserts it's
detectable.

**b) Shamir garbage-combine (`recovery-group-share.adversarial.test.ts`):**

`combineRecoveryGroupShares()` at `recovery-group-share.ts:46-51` calls
`combine(shares)` from `@privy-io/shamir`. With N < threshold shares, it returns
wrong bytes silently. Test approach:

1. Split a known secret into 5 shares with threshold 3
2. Call `combineRecoveryGroupShares` with only 2 shares
3. Assert the result is NOT equal to the original secret (garbage)
4. Repeat with the same 2 shares — assert deterministic (same garbage both times)
5. Assert `combineAndVerifyShares` with 2 shares + valid commitments throws `ShareCommitmentError`

This documents the foot-gun and validates that `combineAndVerifyShares` is the safe
path.

**c) OPAQUE timing oracle (`opaque-timing.test.ts`):**

The OPAQUE protocol is designed to be constant-time against "user not found" vs
"wrong password." The `@serenity-kit/opaque` library handles this via server-side
OPRF blinding. Test approach:

1. Register user A via OPAQUE
2. Time N iterations of `loginStart` with user A's ID + wrong password
3. Time N iterations of `loginStart` with a nonexistent user ID
4. Assert the timing distributions are statistically indistinguishable (Welch's t-test, p > 0.05)

This is a statistical test that may be flaky in CI due to GC pauses / load. Mark it
with a `slow` tag and run it with higher iteration count (N ≥ 100) only in the
security-specific test suite.

**Files:** `src/client/lib/puk.rotation-interrupt.test.ts`, `src/client/lib/recovery-group-share.adversarial.test.ts`, `src/client/lib/opaque-timing.test.ts` (or `src/server/routes/opaque-timing.test.ts` if server-side)

---

## 5. Edge cases and failure modes

### 5.1 — Shamir branded types and existing test helpers

Tests in `recovery-group-share.test.ts` construct shares via `splitRecoveryGroupSecret`
and pass them directly. After branding, these shares are `ShamirShare[]`. Tests that
call `combineAndVerifyShares` must first verify each share to get `VerifiedShare[]`.
This adds a verification step to tests, which is correct — it mirrors production
usage. Tests that intentionally test the unsafe path (Topic 8b) need the non-exported
`combineRecoveryGroupShares` — expose it via a `@internal` export or test-only
re-export.

### 5.2 — DicewarePhrase and serialization in unlock-factors

`unlock-factors.ts:158` dynamically imports `deriveRecoveryPhraseKekBytes` and
calls it with `factor.phrase`. If `factor.phrase` becomes `DicewarePhrase`, the
KDF function must accept it and call `.reveal()`. Edge case: if `DicewarePhrase` is
serialized to `sessionStorage` or `BroadcastChannel` (cross-tab state), the
serialization must preserve the raw phrase — `JSON.stringify` returns `[REDACTED]`.
Solution: `DicewarePhrase` should never be persisted; the raw string enters the
KDF and is discarded. If persistence is needed, use `phrase.reveal()` explicitly
and re-wrap on load. The current codebase does not persist the phrase (it's
transient during unlock), so this is a future concern only.

### 5.3 — CryptoKey wrappers and WebCrypto API boundary

`crypto.subtle.importKey()` and `crypto.subtle.generateKey()` return `CryptoKey`.
The brand must be applied at these boundaries. If a future developer forgets to
brand, they get a bare `CryptoKey` that won't pass to typed functions — the error
is immediately visible. Edge case: `crypto.subtle.deriveBits` returns
`ArrayBuffer`, not `CryptoKey` — X25519 derivation via `deriveBits` followed by
`importKey` needs both steps to happen in the same branding function.

### 5.4 — MLS types and core-crypto interop

core-crypto's `ConversationId` is its own class with a `Uint8Array` constructor.
Our branded `MlsGroupId` must be convertible to `ConversationId` at the boundary
where we call core-crypto methods. This is a one-line adapter:
`new ConversationId(groupId as Uint8Array)`. The cast strips the brand, which is
correct — core-crypto doesn't know about our brands. The brand prevents
*application-level* confusion, not library-level.

### 5.5 — SealedFrame and the Insertable Streams API

The WebRTC Insertable Streams API (`RTCRtpScriptTransform`) provides frames as
`RTCEncodedVideoFrame.data: ArrayBuffer`. The `sframe-worker.ts` transform
pipeline receives these as raw bytes, not `SealedFrame`. For inbound frames
(from the network, already sealed by the remote peer), the raw bytes must be cast
to `SealedFrame` at the network boundary — this is the "parse" point. The cast is
safe because network-received frames are by definition sealed (or garbage that
`open()` will reject). For outbound frames (raw from the encoder), they're
`PlaintextBytes` until `seal()` brands them.

### 5.6 — UnsignedAuditEntry and the existing IDB cache

`audit-chain-verifier.ts:152-154` caches verified entries in IDB. The cache stores
`SignedAuditEntry` objects (already parsed by zod). The type change doesn't affect
the cache — cached entries are already signed. The migration is purely a code-level
type annotation change, not a data format change.

### 5.7 — HKDF label removal and reserved index slots

Removing 5 labels from `LABEL_REGISTRY` changes the array length from 46 to 41.
This shifts indices if done naively. **The correct approach is to replace the 5
entries with sentinel values or leave gaps.** However, since none of the 5 labels
have production callers (verified by grep — all usage is in tests or as HKDF
info/salt, never via `labelToId()`), the simplest approach is to remove them and
append a comment documenting the reserved indices. Any future label additions
continue appending at index 41+, and indices 42-46 are permanently retired.

Alternative: replace with `null` entries and update `labelToId`/`idToLabel` to skip
nulls. This preserves index stability but adds complexity for zero benefit (no
existing ciphertext uses these indices). Decision: remove cleanly; see §8.7.

### 5.8 — OPAQUE timing test flakiness

Statistical timing tests are inherently noisy. Mitigation: use a generous
threshold (p > 0.01 instead of p > 0.05), run 200+ iterations, and use
`performance.now()` with sub-millisecond precision. Mark the test with
`{ timeout: 60_000 }` since OPAQUE operations are cryptographically expensive.
If the test is still flaky in CI, move it to a `security/` test directory that
runs only on demand (not in the default `bun run test:unit` suite).

---

## 6. Operational concerns

### Migration order

All 8 topics are code-level changes with no data migrations. The recommended order
(see §9) is chosen to minimize merge conflicts and maximize parallelism, not for
operational safety — there's nothing to roll back because there's no data change.

### Rollout strategy

Each topic ships as a single PR. No feature flags needed — type changes are
invisible at runtime. The only behavioral change is Topic 2 (DicewarePhrase
redaction), which changes `JSON.stringify` output for objects containing a recovery
phrase. Since the phrase is transient and never serialized to storage, this has no
user-visible effect.

### TypeScript version constraints

All branded type patterns use `unique symbol` + intersection types, which are stable
since TypeScript 2.7. No TS 6-specific features needed. The `#private` class field
syntax (Topic 2) requires ES2022 target, which is already set in `tsconfig.json`.

### @hono/zod-openapi constraints

Topic 6 adds `UnsignedAuditEntrySchema` as a zod schema. This is internal (not
used in route definitions) — `SignedAuditEntrySchema` remains the API-facing
schema. No OpenAPI spec changes.

---

## 7. Interaction with existing systems

### Topic 1 (Shamir) × Recovery group UI

The recovery-group UI (not yet wired — `recovery-group-section.tsx`) will be the
first production consumer of `combineAndVerifyShares`. The branded types ensure
this UI can only pass verified shares to reconstruction. No UI changes needed —
the type constraint is enforced at the function boundary.

### Topic 2 (DicewarePhrase) × Key-store PIN flow

The key-store unlock flow uses `deriveRecoveryPhraseKekBytes` to derive the KEK
factor from the phrase. The `DicewarePhrase` wrapper adds a `.reveal()` call at
the KDF boundary. No key-store structural changes.

### Topic 3 (CryptoKey wrappers) × Crypto worker RPC

The crypto worker communicates with the main thread via structured clone (postMessage).
`CryptoKey` objects are transferable via structured clone. Branded types are
compile-time only — they don't affect serialization. The `crypto-worker-client.ts`
RPC interface updates its type signatures but the runtime behavior is unchanged.

### Topic 4 (MLS types) × MLS PR #2

Topic 4 defines the type scaffolding that MLS PR #2 will use. It should ship
*before* MLS PR #2 Slice 1 so the DB schema and service types are already branded.
If MLS PR #2 ships first, Topic 4 becomes a follow-up refactor (still valuable but
less impactful).

### Topic 5 (SealedFrame) × Tier 5 voice E2EE

The SFrame codebase is already well-typed with `CiphertextBytes`/`PlaintextBytes`.
Adding `SealedFrame` is an additive refinement, not a restructuring. The
`sframe-worker.ts` transform pipeline is the primary consumer.

### Topic 6 (Audit parse-don't-validate) × Admin audit UI

The admin audit UI at `src/client/components/admin-sections/audit-section.tsx` and
`devices-section.tsx` call `buildSignedAuditEntry`. The type change from inline
object to named `UnsignedAuditEntry` is transparent to these callers — they pass
parameters, not raw objects.

### Topic 7 (HKDF labels) × Future MLS implementation

Three of the removed labels (`LABEL_ITEMS_KEY_EXPORT`, `LABEL_NOTE_EPOCH_KEY`,
`LABEL_MLS_PROVISION`) are reserved for MLS PR #2. After removal from the registry,
they become plain strings. When MLS PR #2 implements them, the implementer decides
whether they need registry enrollment (if used as AEAD labels) or stay as HKDF
info strings. This is a feature of the split — it forces the decision at
implementation time rather than pre-allocating registry slots speculatively.

### Topic 8 (AEAD tests) × Tier 2 + Tier 3

PUK interruption tests exercise `puk.ts` (Tier 3). Shamir garbage-combine tests
exercise `recovery-group-share.ts` (Tier 2). OPAQUE timing tests exercise the
auth-facade (Tier 2). All are test-only additions — no production code interaction.

---

## 8. Decisions

### Decision 8.1 — Branded type pattern: phantom symbol vs newtype class

**Question:** Should branded types use the phantom-symbol pattern (`Uint8Array & { readonly [__Brand]: never }`) or newtype classes (`class ShamirShare extends Uint8Array { ... }`)?

**Recommendation:** **Phantom-symbol pattern** (branded intersections).

**Rationale:** The codebase already uses phantom-symbol branding consistently:
`CryptoLabel` (`crypto-labels.ts:28`), `Ciphertext` (`types.ts`),
`CiphertextBytes`/`PlaintextBytes` (`sframe-types.ts`). Using the same pattern
keeps the codebase consistent and avoids `instanceof` surprises. Newtype classes
that extend built-in types (`Uint8Array`, `CryptoKey`) have subtle prototype-chain
issues in some bundlers and are not idiomatic in the llamenos codebase.

**Alternatives considered:**
- **Newtype class:** `class ShamirShare extends Uint8Array { ... }`. Pro: runtime
  `instanceof` checks possible. Con: breaks structured clone (relevant for worker
  transfer), prototype chain issues with Vite's esbuild, inconsistent with existing
  patterns.
- **Zod `.brand()`:** `z.instanceof(Uint8Array).brand<'ShamirShare'>()`. Pro:
  runtime + compile-time validation. Con: zod brands are opaque to TypeScript's
  `extends` checks, and these types are internal (not API-facing), so zod validation
  is unnecessary overhead.

**Security implications:** Phantom brands are compile-time only — they prevent
developer mistakes but not runtime attacks. An attacker who can inject arbitrary
values at runtime bypasses TypeScript entirely. This is the correct scope for
these improvements: the threat is developer confusion, not runtime injection.

**Sources:**
- `src/shared/crypto-labels.ts:27-28` — `CryptoLabel` branded type (file:line)
- `src/shared/sframe/sframe-types.ts:1-8` — `CiphertextBytes`/`PlaintextBytes` (file:line)
- TypeScript Handbook §Type Predicates — branded types via intersection

---

### Decision 8.2 — `combineRecoveryGroupShares` export status

**Question:** Should the unsafe `combineRecoveryGroupShares` (no commitment verification) be unexported, deleted, or kept with a required threshold parameter?

**Recommendation:** **Make non-exported (module-private).**

**Rationale:** The function is called only in tests and internally by
`combineAndVerifyShares`. Making it non-exported closes audit finding #4 ("landmine
for the first recovery-UI wiring") without breaking any production code. Tests that
need the unsafe path (Topic 8b adversarial tests) can access it via a test-only
re-export or by testing the internal behavior through `combineAndVerifyShares`
failure cases.

**Alternatives considered:**
- **Delete entirely:** Would require `combineAndVerifyShares` to inline the
  `combine()` call. Slightly less testable (can't unit-test the raw combine
  separately). Pro: eliminates the function. Con: less flexible for future use.
- **Keep exported, add threshold parameter:** `combineRecoveryGroupShares(shares, threshold)` that throws if `shares.length < threshold`. Pro: safe-ish. Con: still allows calling with `threshold=0` or wrong threshold value — the commitment-based path is strictly safer.

**Security implications:** A publicly exported function that returns garbage on
insufficient input (without error) is a latent vulnerability. Even though it's
test-only today, the first production wiring of recovery-group UI could
accidentally use it instead of `combineAndVerifyShares`. Making it non-exported
forces production code through the safe path.

**Sources:**
- `src/client/lib/recovery-group-share.ts:46-51` — current export (file:line)
- `SECURITY_OVERHAUL_COMPLETION_AUDIT_2026-04-14.md` — audit finding #4

---

### Decision 8.3 — DicewarePhrase: class vs branded string

**Question:** Should `DicewarePhrase` be a class (with `toJSON`/`toString` redaction) or a branded string (compile-time only, no redaction)?

**Recommendation:** **Class with redaction.**

**Rationale:** The whole point of wrapping the recovery phrase is preventing
accidental exposure. A branded string (`string & { __DicewarePhraseBrand: never }`)
prevents type confusion but doesn't prevent `JSON.stringify` from leaking the
phrase. The class approach — with `#private` field + `toJSON()` returning
`[REDACTED]` — provides both compile-time type safety AND runtime redaction. The
`reveal()` method is the single auditable code path for accessing the raw string.

**Alternatives considered:**
- **Branded string:** `type DicewarePhrase = string & { ... }`. Pro: lighter
  weight, consistent with other brands. Con: `JSON.stringify` leaks the phrase,
  which is the primary risk this topic addresses.
- **Frozen object wrapper:** `{ reveal(): string; toJSON(): '[REDACTED]' }` as a
  plain object. Pro: no class overhead. Con: no `instanceof` check, no
  `Symbol.for('nodejs.util.inspect.custom')` for Node.js inspect.

**Security implications:** A class with `toJSON` redaction provides defense-in-depth
against log leakage. Recovery phrases are the ultimate fallback for account
recovery — leaking one to a log aggregator (Datadog, CloudWatch, etc.) is a
catastrophic compromise of that user's account. The class approach makes leakage
require explicit `.reveal()` calls, which are auditable via grep.

**Sources:**
- `src/client/lib/recovery-phrase.ts` — current implementation (file)
- MDN — `toJSON()` method, called by `JSON.stringify`

---

### Decision 8.4 — CryptoKey wrapper granularity: 3 types vs 5 types

**Question:** Should there be 3 branded CryptoKey types (Ed25519, X25519, AesGcm) or 5 (adding Ed25519Verify, X25519Public)?

**Recommendation:** **3 types (Ed25519SigningKey, X25519EncryptionKey, AesGcmKey).**

**Rationale:** The primary confusion risk is between algorithm families (signing vs
encryption vs symmetric). Within a family, the `CryptoKey.type` property (`'private'`
vs `'public'`) already provides runtime discrimination that TypeScript can check
via assertion functions. Adding separate brands for public vs private keys within
the same algorithm doubles the type surface without proportional safety gain —
the common mistake is passing a signing key where an encryption key is needed, not
passing a public key where a private key is needed (which WebCrypto rejects at
runtime immediately with a clear `InvalidAccessError`).

**Alternatives considered:**
- **5 types (Ed25519Sign, Ed25519Verify, X25519Private, X25519Public, AesGcm):**
  Maximum type safety. Con: doubles the branding boilerplate, and public-key
  handles (`CryptoKey` with `type: 'public'`) are used in fewer places (most
  callers pass `Uint8Array` raw public keys, not `CryptoKey` handles).
- **1 type (TypedCryptoKey<Algorithm>):** Generic parameter. Pro: one brand, many
  specializations. Con: TypeScript generic phantom types are fragile across module
  boundaries and don't work well with `structuredClone`.

**Security implications:** 3 types catch the most dangerous confusion (algorithm
family mismatch) while keeping the type surface manageable. The 40+ call-site
update is already the largest topic — adding 2 more types would increase the
surface without catching meaningfully different bugs.

**Sources:**
- `src/shared/types.ts` — existing branded types (file)
- WebCrypto API spec — `CryptoKey.type` discriminates public/private

---

### Decision 8.5 — MLS branded types: define now or defer to PR #2

**Question:** Should `MlsGroupId`/`MlsEpoch` be defined now (in this type-design PR) or deferred to MLS PR #2?

**Recommendation:** **Define now.**

**Rationale:** The types are trivial (2 branded type definitions + 1 helper
function, ~15 lines). Defining them now means MLS PR #2 Slice 1 can use them from
day one, avoiding a refactor after the fact. The `MlsConversation` skeleton is
already on main — adding typed method signatures (still unimplemented) documents
the future API contract and gives reviewers something concrete to approve.

**Alternatives considered:**
- **Defer to MLS PR #2:** Pro: keeps this PR smaller. Con: MLS PR #2 is already
  a multi-PR epic; adding type definitions there adds to its scope. Defining types
  separately is cleaner separation of concerns (types vs implementation).

**Security implications:** None directly — these are type definitions with no
runtime behavior. The security benefit materializes when MLS PR #2 uses them to
prevent group-ID/hub-ID confusion.

**Sources:**
- `docs/security/H4_MLS_PR2_BRAINSTORM.md` §8 Decision 3 — group ID format
- `src/client/lib/mls/conversation.ts` — skeleton class (file)

---

### Decision 8.6 — SealedFrame: branded Uint8Array vs branded record

**Question:** Should `SealedFrame` be a branded `Uint8Array` (like `CiphertextBytes`) or a branded record with explicit fields?

**Recommendation:** **Branded `Uint8Array`.**

**Rationale:** The SFrame wire format is a single contiguous byte sequence (codec
header + ciphertext + trailer). The `seal()` function returns these as a single
`Uint8Array` that's handed to the WebRTC Insertable Streams API, which expects
`ArrayBuffer`/`Uint8Array`. A record type (`{ ciphertext, trailer }`) would
require destructuring before network send and re-assembly on receive, adding
complexity to the hot path (real-time audio/video frames at 50fps+). The branded
`Uint8Array` approach is consistent with `CiphertextBytes`/`PlaintextBytes` already
in `sframe-types.ts`.

**Alternatives considered:**
- **Branded record:** `{ ciphertext: CiphertextBytes; trailer: ParsedTrailer }`.
  Pro: structured access, no parsing needed on receive. Con: extra
  serialization/deserialization on every frame, inconsistent with existing
  byte-oriented patterns in the SFrame codebase, and the Insertable Streams API
  needs raw bytes.

**Security implications:** Both approaches prevent passing raw unencrypted frames
to the network send path. The branded `Uint8Array` is simpler and has lower
overhead in the real-time frame pipeline.

**Sources:**
- `src/shared/sframe/sframe-types.ts:1-8` — existing branded byte types
- `src/shared/sframe/frame-codec.ts` — seal/open signatures
- RFC 9605 §4 — SFrame frame format

---

### Decision 8.7 — HKDF label removal: clean remove vs null sentinel

**Question:** When removing 5 HKDF-only labels from `LABEL_REGISTRY`, should the indices be replaced with `null` sentinels (preserving index positions) or removed cleanly (shrinking the array)?

**Recommendation:** **Clean remove with reserved-index comment.**

**Rationale:** None of the 5 labels have production callers via `labelToId()` or
`idToLabel()` (verified by grep — all usage is direct constant reference for HKDF
info/salt, never through the registry lookup functions). No existing ciphertext on
any deployment stores these label IDs in wire format. The `LABEL_REGISTRY` array
is append-only as a wire format — indices 0-41 remain stable for existing AEAD
labels, and the comment documents that indices 42-46 are permanently retired.

Adding `null` sentinels would require changing `LABEL_REGISTRY`'s type from
`readonly CryptoLabel[]` to `readonly (CryptoLabel | null)[]`, which ripples
through `labelToId`/`idToLabel` and the `satisfies` constraint. The complexity
is not justified for zero-caller entries.

**Alternatives considered:**
- **Null sentinels:** `LABEL_REGISTRY[42] = null`. Pro: index positions
  explicitly preserved. Con: type widening, `labelToId`/`idToLabel` must handle
  nulls, all for entries with zero production callers.
- **Keep in registry, add HKDF_LABELS parallel array:** Pro: no removal. Con:
  doesn't fix the semantic confusion (the whole point is that HKDF labels shouldn't
  be in the AEAD registry).

**Security implications:** Removing labels from the registry prevents a future
developer from accidentally using `labelToId(LABEL_SFRAME_RATCHET)` to get a
wire-format ID for what should be an HKDF salt. The type system (removing
`CryptoLabel` brand) enforces this — calling `labelToId()` with a plain string
is a compile-time error.

**Sources:**
- `src/shared/crypto-labels.ts:363-413` — current `LABEL_REGISTRY`
- `src/shared/crypto-labels.ts:415-425` — `labelToId`/`idToLabel` functions
- Grep results: zero `labelToId(LABEL_SFRAME_RATCHET)` etc. in production code

---

### Decision 8.8 — OPAQUE timing test: unit test vs integration test

**Question:** Should the OPAQUE timing oracle test be a unit test (mocking the OPAQUE library) or an integration test (hitting the actual server)?

**Recommendation:** **Unit test with real OPAQUE library, mocked network.**

**Rationale:** The timing oracle we're testing is the server's code path
differentiation between "user not found" and "wrong password." The `@serenity-kit/opaque`
library handles the OPRF blinding that makes server responses constant-time.
Testing at the unit level (calling the server handler directly, not through HTTP)
eliminates network jitter as a noise source. The test imports the server route
handler, invokes it with controlled inputs, and measures `performance.now()` deltas.

**Alternatives considered:**
- **Integration test (HTTP):** Pro: tests the full stack including middleware
  timing. Con: network round-trip adds ~1-10ms jitter, requiring many more
  iterations to reach statistical significance. Flaky in CI.
- **Mock OPAQUE library:** Pro: no crypto overhead. Con: defeats the purpose — we
  want to verify the real library's constant-time behavior.

**Security implications:** A unit test catches regressions in the server-side code
path (e.g., an early return on "user not found" before invoking the OPAQUE
computation). It does NOT test network-level timing (TCP, TLS handshake) — that
requires a dedicated security audit with a network-level timing harness, which is
out of scope for this PR.

**Sources:**
- `src/client/lib/opaque-client.ts` — client-side OPAQUE implementation
- `src/server/routes/auth-facade.ts` — server-side auth endpoints
- `@serenity-kit/opaque` — OPAQUE library documentation

---

### Decision 8.9 — Topic 8 test location: colocated vs dedicated directory

**Question:** Should the 3 adversarial tests from Topic 8 be colocated with their source files or placed in a dedicated `tests/security/` directory?

**Recommendation:** **Colocated with source files.**

**Rationale:** The codebase convention is colocated `.test.ts` files for unit tests
(per CLAUDE.md §Testing). The PUK interruption test is a unit test of `puk.ts`.
The Shamir garbage-combine test is a unit test of `recovery-group-share.ts`. The
OPAQUE timing test is a unit test of the auth handler. Placing them alongside
their source files follows existing patterns and makes them discoverable.

**Alternatives considered:**
- **`tests/security/` directory:** Pro: grouped for security-specific CI runs.
  Con: violates the colocated convention, makes it harder to discover related tests
  when reading the source file.

**Security implications:** None — test location doesn't affect security. Colocated
tests are more likely to be maintained when the source changes.

---

## 9. Slice ordering

The 8 topics are grouped into 4 parallelism tiers based on dependencies.

### Dependency graph

```
Tier A (independent, no prerequisites):
  Slice 1: Branded ShamirShare / VerifiedShare
  Slice 2: DicewarePhrase wrapper
  Slice 7: HKDF labels split
  Slice 8: AEAD adversarial tests

Tier B (independent, no prerequisites):
  Slice 5: Branded SealedFrame
  Slice 6: Parse-don't-validate audit entry

Tier C (depends on MLS PR #2 discussion, not on Tier A/B):
  Slice 4: Branded MlsGroupId / MlsEpoch

Tier D (depends on all of Tier A/B):
  Slice 3: Ed25519SigningKey / X25519EncryptionKey / AesGcmKey wrappers
```

### Ordered slice table

| Slice | Topic | Effort | Parallelism | Dependency |
|-------|-------|--------|------------|-----------|
| 1 | Branded `ShamirShare` / `VerifiedShare` | **S** (~2h) | Tier A | None |
| 2 | `DicewarePhrase` wrapper class | **S** (~2h) | Tier A | None |
| 7 | HKDF labels split from `LABEL_REGISTRY` | **S** (~1h) | Tier A | None |
| 8 | AEAD adversarial tests | **M** (~4h) | Tier A | None |
| 5 | Branded `SealedFrame` record | **S** (~2h) | Tier B | None |
| 6 | Parse-don't-validate `UnsignedAuditEntry` → `SignedAuditEntry` | **M** (~3h) | Tier B | None |
| 4 | Branded `MlsGroupId` / `MlsEpoch` | **S** (~1h) | Tier C | MLS PR #2 Slice 1 ships MLS tables |
| 3 | `Ed25519SigningKey` / `X25519EncryptionKey` / `AesGcmKey` wrappers | **L** (~8h) | Tier D | Slices 1, 2, 5 (stabilize branded patterns first) |

### Rationale for ordering

- **Slices 1, 2, 7, 8 (Tier A):** Fully independent, small scope, high value.
  Ship first to build momentum and establish the branded-type patterns that Slice 3
  will replicate at scale.

- **Slices 5, 6 (Tier B):** Independent of Tier A but slightly larger. Can run in
  parallel with Tier A.

- **Slice 4 (Tier C):** Depends on the MLS PR #2 brainstorm decisions being approved
  (specifically Decision 3: group ID format). Can ship before or after MLS PR #2
  Slice 1, but is most valuable if it ships before, so MLS implementation uses
  branded types from day one.

- **Slice 3 (Tier D):** The largest topic (~40 call sites). Ships last so the
  developer has the Tier A branded-type patterns as muscle memory. Also, Slices 1
  and 5 introduce branded `Uint8Array` and branded `CryptoKey` patterns that Slice 3
  extends — reviewing the small cases first makes the large case easier to evaluate.

### Total estimated effort

- **Small (S):** 1-2 hours each × 4 slices = 4-8 hours
- **Medium (M):** 3-4 hours each × 2 slices = 6-8 hours
- **Large (L):** 6-8 hours × 1 slice = 6-8 hours
- **Total:** ~16-24 hours of implementation across 8 PRs

All 8 slices can be completed by a single developer in 3-4 working days, or by
2-3 parallel developers in 1-2 days (Tier A + B run simultaneously).
