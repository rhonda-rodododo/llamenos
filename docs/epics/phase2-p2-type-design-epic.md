# Phase 2 P2 — Type-Design Hardening Epic Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 8 type-design gaps identified in the security overhaul completion audit (2026-04-14 §Phase-2 P2) by introducing branded types, parse-don't-validate patterns, and adversarial tests that make invalid states unrepresentable at compile time.

**Architecture:** No new runtime dependencies or data migrations. All changes are TypeScript type refinements (branded intersections, wrapper classes, zod schema splits) plus test-only adversarial coverage. The branded-type pattern follows the existing `CryptoLabel` / `Ciphertext` / `CiphertextBytes` conventions.

**Tech Stack:** TypeScript phantom-symbol brands, `bun:test` (unit tests), existing crypto libraries (`@privy-io/shamir`, `@serenity-kit/opaque`, `@noble/ciphers`).

**Epic name:** `phase2-p2-type-design`
**Branch convention:** `feat/p2-type-slice-N` (e.g., `feat/p2-type-slice-1`)

**Brainstorm doc:** `docs/security/PHASE2_P2_TYPE_DESIGN_BRAINSTORM.md`
**Prerequisite human decisions:** See brainstorm §8 (9 decisions, all with recommendations).

---

## Dependency graph

```
Tier A (all independent, run in parallel):
  Slice 1 (ShamirShare / VerifiedShare)
  Slice 2 (DicewarePhrase wrapper)
  Slice 7 (HKDF label split)
  Slice 8 (AEAD adversarial tests)

Tier B (independent, parallel with Tier A):
  Slice 5 (SealedFrame)
  Slice 6 (UnsignedAuditEntry → SignedAuditEntry)

Tier C (after MLS PR #2 decisions approved):
  Slice 4 (MlsGroupId / MlsEpoch)

Tier D (after Tier A + B):
  Slice 3 (Ed25519SigningKey / X25519EncryptionKey / AesGcmKey)
```

Slices 1, 2, 5, 6, 7, 8 can all run in parallel. Slice 3 depends on 1+2+5
(establishes branded-type patterns first). Slice 4 depends on MLS PR #2 brainstorm
approval (Decision 3: group ID format).

---

## Slice table

| Slice | Topic | Approach | Files to touch | Effort | Group |
|-------|-------|---------|---------------|--------|-------|
| 1 | Branded `ShamirShare` / `VerifiedShare` | Phantom-symbol branded `Uint8Array` subtypes; `combineRecoveryGroupShares` becomes non-exported; `combineAndVerifyShares` requires `VerifiedShare[]` | `recovery-group-share.ts`, `recovery-group-share.test.ts` | **S** (~2h) | A |
| 2 | `DicewarePhrase` wrapper class | Class with `#private` field, `toJSON()`→`[REDACTED]`, `toString()`→`[REDACTED]`, `reveal()`→plaintext; `generateRecoveryPhrase` returns `DicewarePhrase` | `recovery-phrase.ts`, `unlock-factors.ts`, `recovery-phrase.test.ts`, `unlock-factors.test.ts` | **S** (~2h) | A |
| 3 | `Ed25519SigningKey` / `X25519EncryptionKey` / `AesGcmKey` | Three phantom-symbol branded `CryptoKey` types; brand applied at `importKey`/`generateKey` boundaries; ~40 downstream signatures updated | `types.ts`, `device-identity.ts`, `cross-signing.ts`, `puk.ts`, `paper-key.ts`, `hpke-primitives.ts`, `crypto-worker.ts`, `crypto-worker-client.ts`, `hub-key-manager.ts`, `recovery-group-tier3.ts`, `sframe-key-distribution.ts`, + 7 test files | **L** (~8h) | D |
| 4 | Branded `MlsGroupId` / `MlsEpoch` | Phantom-symbol branded `Uint8Array` and `bigint`; `hubIdToMlsGroupId` helper; `MlsConversation` skeleton gets typed method signatures | `types.ts`, `mls/conversation.ts` | **S** (~1h) | C |
| 5 | Branded `SealedFrame` | Phantom-symbol branded `Uint8Array`; `seal()` returns `SealedFrame`; `open()` accepts `SealedFrame` | `sframe-types.ts`, `frame-codec.ts`, `sframe-worker.ts`, `frame-codec.test.ts`, `sframe-types.test.ts` | **S** (~2h) | B |
| 6 | Parse-don't-validate audit entry | Named `UnsignedAuditEntry` type + `UnsignedAuditEntrySchema`; `signAuditEntry()` is the only `Unsigned→Signed` transition; eliminate `Omit<...>` inline usage | `audit-entries.ts`, `audit-log-client.ts`, `audit-log-service.ts`, `audit-chain-verifier.ts`, 5 test files | **M** (~3h) | B |
| 7 | HKDF labels split from `LABEL_REGISTRY` | Remove 5 HKDF-only labels from registry; strip `CryptoLabel` brand; add reserved-index comment; indices 42-46 permanently retired | `crypto-labels.ts`, `crypto-labels.test.ts` | **S** (~1h) | A |
| 8 | AEAD adversarial tests | 3 new test files: PUK interruption (partial-state detection), Shamir garbage-combine (deterministic wrong output), OPAQUE timing oracle (constant-time server response) | `puk.rotation-interrupt.test.ts`, `recovery-group-share.adversarial.test.ts`, `opaque-timing.test.ts` | **M** (~4h) | A |

---

## Per-slice task breakdowns

### Slice 1: Branded `ShamirShare` / `VerifiedShare`

**Branch:** `feat/p2-type-slice-1`

- [ ] Define `ShamirShare` and `VerifiedShare` branded types in `recovery-group-share.ts`
- [ ] Update `splitRecoveryGroupSecret` return type to `Promise<ShamirShare[]>`
- [ ] Create `verifyAndBrandShare(share: ShamirShare, commitment: string): Promise<VerifiedShare>`
- [ ] Update `combineAndVerifyShares` to accept `VerifiedShare[]` (or perform internal verification)
- [ ] Make `combineRecoveryGroupShares` non-exported (module-private)
- [ ] Update `commitShare` to accept `ShamirShare`
- [ ] Update all tests in `recovery-group-share.test.ts` to use branded types
- [ ] Add test: passing raw `Uint8Array` to `combineAndVerifyShares` is a type error (compile-time check documented in test comment)
- [ ] Run `bun run typecheck` + `bun run test:unit -- recovery-group-share`

**Acceptance criteria:**
- `combineRecoveryGroupShares` is not importable from outside the module
- `combineAndVerifyShares` requires `VerifiedShare[]` or verifies internally
- All existing tests pass with updated types
- No `as unknown as ShamirShare` casts in production code (only at split boundary)

### Slice 2: `DicewarePhrase` wrapper class

**Branch:** `feat/p2-type-slice-2`

- [ ] Define `DicewarePhrase` class in `recovery-phrase.ts` with `#private` field
- [ ] Implement `toJSON()`, `toString()`, `[Symbol.for('nodejs.util.inspect.custom')]()`, `reveal()`
- [ ] Add `DicewarePhrase.create(words: string)` static constructor (validates + normalizes)
- [ ] Add `DicewarePhrase.generate(wordCount?)` static constructor
- [ ] Rename existing `generateRecoveryPhrase` to `generateRawPhrase` (module-private)
- [ ] Export `generateRecoveryPhrase` as wrapper returning `DicewarePhrase`
- [ ] Update `deriveRecoveryPhraseKekBytes` to accept `DicewarePhrase`
- [ ] Update `unlock-factors.ts:158` to call `.reveal()` at KDF boundary
- [ ] Update `recovery-phrase.test.ts` — add redaction tests (`JSON.stringify`, `toString()`)
- [ ] Update `unlock-factors.test.ts` — mock phrase as `DicewarePhrase` instance
- [ ] Run `bun run typecheck` + `bun run test:unit -- recovery-phrase` + `bun run test:unit -- unlock-factors`

**Acceptance criteria:**
- `JSON.stringify({ phrase: new DicewarePhrase(...) })` contains `[REDACTED]`, never the actual words
- `generateRecoveryPhrase()` returns `DicewarePhrase`, not `string`
- `deriveRecoveryPhraseKekBytes` accepts `DicewarePhrase`
- All existing tests pass

### Slice 3: `Ed25519SigningKey` / `X25519EncryptionKey` / `AesGcmKey`

**Branch:** `feat/p2-type-slice-3`

- [ ] Define 3 branded types in `src/shared/types.ts`
- [ ] Add `asEd25519SigningKey`, `asX25519EncryptionKey`, `asAesGcmKey` cast helpers in `types.ts`
- [ ] Update `DeviceKeypair` interface: `signing.privateKey: Ed25519SigningKey`, `encryption.privateKey: X25519EncryptionKey`
- [ ] Update `PukSubkeys` interface: `signPrivate: Ed25519SigningKey`, `dhPrivate: X25519EncryptionKey`, `secretBoxKey: AesGcmKey`
- [ ] Update `MasterKeyResult` interface: `selfSigningPrivate: Ed25519SigningKey`, `userSigningPrivate: Ed25519SigningKey`
- [ ] Update `DerivedPaperKey` interface with branded types
- [ ] Update `hpkeSeal`/`hpkeOpen`/`decryptHpkeEnvelope` to accept `X25519EncryptionKey`
- [ ] Update `crossSignOwnDevice`/`crossSignOtherUser` to accept `Ed25519SigningKey`
- [ ] Update `aesGcmEncrypt`/`aesGcmDecrypt` in `cross-signing.ts` and `puk.ts` to accept `AesGcmKey`
- [ ] Update `crypto-worker.ts: unlockWithHandles` parameter types
- [ ] Update `crypto-worker-client.ts` RPC interface types
- [ ] Update `hub-key-manager.ts` key handle types
- [ ] Update `recovery-group-tier3.ts` key types
- [ ] Update `sframe-key-distribution.ts` key types
- [ ] Update all 7+ test files — apply brands at key-generation boundaries in test helpers
- [ ] Run `bun run typecheck` + `bun run test:unit` (full suite — many files touched)
- [ ] Run `bun run build` (verify no runtime changes)

**Acceptance criteria:**
- Passing `Ed25519SigningKey` to `hpkeSeal` is a compile-time error
- Passing `X25519EncryptionKey` to `crossSignOwnDevice` is a compile-time error
- No `as CryptoKey` casts in production code (only `asEd25519SigningKey` etc. at import boundaries)
- All tests pass, build succeeds

### Slice 4: Branded `MlsGroupId` / `MlsEpoch`

**Branch:** `feat/p2-type-slice-4`

- [ ] Define `MlsGroupId` (branded `Uint8Array`) and `MlsEpoch` (branded `bigint`) in `src/shared/types.ts`
- [ ] Add `hubIdToMlsGroupId(hubId: string): MlsGroupId` helper
- [ ] Add `asMlsEpoch(epoch: bigint): MlsEpoch` cast helper
- [ ] Update `MlsConversation` skeleton: add typed method stubs (still throw `new Error('not implemented')`)
- [ ] Add unit test for `hubIdToMlsGroupId` determinism
- [ ] Run `bun run typecheck`

**Acceptance criteria:**
- `MlsGroupId` is a branded `Uint8Array` that can't be confused with a hub UUID string
- `MlsEpoch` is a branded `bigint` that can't be confused with arbitrary counters
- `hubIdToMlsGroupId` produces `llamenos:hub:<hubId>` UTF-8 bytes
- `MlsConversation` skeleton has typed method signatures for `createGroup`, `addMembers`, `encrypt`, `decrypt`

### Slice 5: Branded `SealedFrame`

**Branch:** `feat/p2-type-slice-5`

- [ ] Define `SealedFrame` branded `Uint8Array` in `sframe-types.ts`
- [ ] Add `asSealedFrame` cast helper for network-received frames
- [ ] Update `seal()` return type to `SealedFrame`
- [ ] Update `open()` parameter type to accept `SealedFrame`
- [ ] Update `sframe-worker.ts` transform pipeline to use `SealedFrame` at boundaries
- [ ] Update `frame-codec.test.ts` — seal/open round-trip uses branded types
- [ ] Add test in `sframe-types.test.ts` for the new brand
- [ ] Run `bun run typecheck` + `bun run test:unit -- sframe`

**Acceptance criteria:**
- `seal()` returns `SealedFrame`, not raw `Uint8Array`
- `open()` requires `SealedFrame` — passing raw bytes is a compile-time error
- All SFrame tests pass

### Slice 6: Parse-don't-validate audit entry

**Branch:** `feat/p2-type-slice-6`

- [ ] Define `UnsignedAuditEntrySchema` in `audit-entries.ts` (`.omit({ entryHash, signature })`)
- [ ] Export `UnsignedAuditEntry` type
- [ ] Refactor `buildSignedAuditEntry` in `audit-log-client.ts`: construct `UnsignedAuditEntry`, call `signAuditEntry()` as separate function
- [ ] `signAuditEntry(unsigned: UnsignedAuditEntry): Promise<SignedAuditEntry>` — the sole transition function
- [ ] Update test helpers in `audit-log-service.test.ts`, `audit-chain-verifier.test.ts`, `user-sigchain-verifier.test.ts` to use `UnsignedAuditEntry` type
- [ ] Verify server-side `appendSigned` already uses `SignedAuditEntrySchema.safeParse()` (no change needed)
- [ ] Run `bun run typecheck` + `bun run test:unit -- audit` + `bun run test:api -- audit`

**Acceptance criteria:**
- `UnsignedAuditEntry` is a named type (not `Omit<...>`)
- No `Omit<SignedAuditEntry, ...>` patterns remain in the codebase
- `signAuditEntry` is the only function that produces `SignedAuditEntry` from `UnsignedAuditEntry`
- All audit tests pass

### Slice 7: HKDF labels split from `LABEL_REGISTRY`

**Branch:** `feat/p2-type-slice-7`

- [ ] Remove `LABEL_SFRAME_RATCHET`, `LABEL_SAS_MLS_V3`, `LABEL_ITEMS_KEY_EXPORT`, `LABEL_NOTE_EPOCH_KEY`, `LABEL_MLS_PROVISION` from `LABEL_REGISTRY` array
- [ ] Strip `as CryptoLabel` brand from these 5 constants (make them plain strings)
- [ ] Add comment: `// Indices 42-46 permanently retired (were HKDF-only labels, never used as AEAD)`
- [ ] Update `crypto-labels.test.ts` — adjust registry length assertion, add test that removed labels are NOT in registry
- [ ] Verify `labelToId` throws for removed labels (existing behavior, just add explicit test)
- [ ] Run `bun run typecheck` + `bun run test:unit -- crypto-labels`

**Acceptance criteria:**
- `LABEL_REGISTRY` contains only AEAD labels (41 entries, down from 46)
- 5 removed labels are plain `string`, not `CryptoLabel`
- `labelToId(LABEL_SFRAME_RATCHET)` throws (compile-time error from type mismatch)
- All tests pass

### Slice 8: AEAD adversarial tests

**Branch:** `feat/p2-type-slice-8`

- [ ] **PUK interruption test** (`src/client/lib/puk.rotation-interrupt.test.ts`):
  - Mock HPKE seal to fail for specific device
  - Call `rotatePuk` with 3 devices, middle one fails
  - Assert the function either rejects (all-or-nothing) or returns explicit failure info
  - Document the actual behavior for future hardening
- [ ] **Shamir garbage-combine test** (`src/client/lib/recovery-group-share.adversarial.test.ts`):
  - Split known 32-byte secret into 5 shares, threshold 3
  - Combine only 2 shares via internal `combine()` (needs test-only access)
  - Assert result ≠ original secret
  - Assert result is deterministic (same 2 shares → same wrong output)
  - Assert `combineAndVerifyShares` with 2 shares + valid commitments fails
- [ ] **OPAQUE timing oracle test** (`src/client/lib/opaque-timing.test.ts`):
  - Register user A via OPAQUE
  - Time 100+ iterations of `loginStart` with real user + wrong password
  - Time 100+ iterations of `loginStart` with nonexistent user
  - Welch's t-test: assert p > 0.01 (not statistically distinguishable)
  - Tag: `{ timeout: 60_000 }`
- [ ] Run `bun run typecheck` + `bun run test:unit -- puk.rotation` + `bun run test:unit -- recovery-group-share.adversarial` + `bun run test:unit -- opaque-timing`

**Acceptance criteria:**
- All 3 test files exist and pass
- PUK interruption test documents the half-committed-state behavior
- Shamir test proves garbage-combine produces wrong (not random) output
- OPAQUE timing test passes the constant-time assertion (p > 0.01)

---

## Cross-references

- **Brainstorm:** `docs/security/PHASE2_P2_TYPE_DESIGN_BRAINSTORM.md` — full context for each topic (§4) and all decisions (§8)
- **Source audit:** `docs/security/SECURITY_OVERHAUL_COMPLETION_AUDIT_2026-04-14.md` §Phase-2 P2
- **MLS PR #2 dependency:** Slice 4 (MLS types) should ship before MLS PR #2 Slice 1 (`docs/epics/h4-mls-pr2-epic.md`)
- **Audit finding #4:** Slice 1 closes the `combineRecoveryGroupShares` unsafe-export finding
- **Audit §Invariants ⚠️ NIT:** Slice 7 closes the HKDF-in-registry pollution finding
