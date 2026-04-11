# Tier 1 Post-Implementation Review

**Date:** 2026-04-11
**Branch:** `feat/sec-tier-1-impl-hpke-prb`
**PR:** #72 (Tier 1 HPKE primitives + items_key + hub-field call-site migration)
**Diff range:** `origin/feat/sec-tier-0-impl-albrecht..HEAD` — 15 commits, 56 files,
`+3252 / −350` lines.

## Summary

Tier 1 shipped in two logical slices on a single branch:

- **PR-A** — HPKE primitives (`@hpke/core` + `@hpke/dhkem-x25519`), envelope v3 wire
  format, `key-store-v3` (PIN-only KEK, non-extractable hub AES-GCM CryptoKey),
  crypto-worker HPKE sidecar, server `HpkeService`, migration `0053` (pre-prod wipe),
  and CI grep guardrails blocking new ECIES callers / silent HPKE→ECIES fallback.
- **PR-B** — `items_key` indirection primitive (`src/shared/items-key.ts` +
  migration `0054`), migration of all hub-field call sites in `src/client/lib/queries/*.ts`
  and `src/client/routes/shifts.tsx` to the async `-v3` path, and carry-forward of
  Tier 0 client-side encrypt + envelope AAD readiness.

Six review agents were dispatched in parallel. Their findings were consolidated,
verified, and prioritised; CRITICAL issues were fixed, IMPORTANT issues that affect
future-proofing and doc accuracy were fixed, and the remainder was deferred with
explicit carry-forward tracking.

## Review agents dispatched

1. `pr-review-toolkit:code-reviewer`
2. `pr-review-toolkit:comment-analyzer`
3. `pr-review-toolkit:silent-failure-hunter`
4. `pr-review-toolkit:type-design-analyzer`
5. `pr-review-toolkit:pr-test-analyzer`
6. `feature-dev:code-reviewer`

## CRITICAL issues resolved

### C1 — Client/server id mismatch for hub-field encrypted records

**Scope:** six services — `tags`, `roles`, `teams`, `report-types`, `shifts` (including
ring groups), and `firehose`.

**Root cause:** the client generates a UUID and uses it as `recordId` when calling
`encryptHubField(value, hubId, newId, 'encrypted_<col>')`, which threads `newId`
through `hubFieldAad(recordId, fieldName)` into the AAD. The server then discarded
the client's id and generated its own, so on refetch the AAD bound to the stored id
no longer matched what the client used at seal time, and the decrypt path silently
rendered placeholder/plaintext fallbacks.

**Fix pattern applied to all six services:**
1. Service layer accepts optional `id?: string` with fallback to server-generated
   UUID: `const id = data.id ?? crypto.randomUUID()`. Comment explains AAD binding.
2. Route schema adds `id: z.string().uuid().optional()` to the create body.
3. Route handler passes `id: body.id` through to the service.
4. Client API signature accepts `id?: string`.
5. Client component pre-generates `newId` before sealing and passes it into the
   create mutation alongside the `encryptedFoo` field.
6. Mutation hook type allows `id?: string`.

Firehose was discovered by grepping `crypto.randomUUID()` across the client —
the reviewer's original count undercounted by one. `custom_field_definitions`
is safe because the client sends the full array to `updateCustomFields`, so
the id it generates is what the server stores.

### C2 — HPKE `info` parameter not threaded through seal/open

The `hpkeSeal` / `hpkeOpen` primitives in `src/shared/hpke-primitives.ts` now pass
`info: new TextEncoder().encode(label)` on both ends (lines 73, 120), giving the
HPKE suite a domain-separated KDF context bound to the `CryptoLabel`. Combined
with the `labelId` wire check, the expected-label check, the `buildAad` record
binding, and the AEAD tag, the envelope has five independent defense layers.

## IMPORTANT issues resolved

| # | Location | Issue | Fix |
|---|---|---|---|
| I-1 | `docs/security/HPKE_MIGRATION_NOTES.md` | Title `Tier 1 PR-A`, claimed `LABEL_SERVER_HPKE_KEY` was added to `LABEL_REGISTRY` (false), claimed `key-store-v3` is "multi-factor KEK" (is PIN-only), claimed `native-curves-check` "gates" runtime (it is telemetry only). `Deferred` list included items-key which PR-B delivered. | Retitled to `Tier 1`, split into PR-A / PR-B sections, corrected registry claim, clarified PIN-only-with-deferred-multi-factor, clarified native-curves-check as telemetry-not-switch, removed items-key from deferred, reframed remaining deferrals as Tier 2+ carry-forward. |
| I-2 | `src/shared/envelope-v3.ts:24` | Doc-ref points at non-existent `crypto-primitives.ts` | Corrected to `hpke-primitives.ts`. |
| I-3 | `CLAUDE.md:106` | `**Tier 1 HPKE (PR-A, in progress)**` tag with stale "20+ unmigrated call sites" | Removed in-progress tag, documented client-pre-generated-id requirement for hub-field creates, listed remaining carry-forward call sites (notes/files/hub-key-manager/provisioning). |
| I-4 | `src/client/lib/hub-field-crypto-v3.ts:17–20` | NOTE claimed module is not wired to call sites | Replaced with the concrete list of wired call sites (queries/*.ts + routes/shifts.tsx) and pointer to `items-key.ts`. |
| I-5 | `src/client/lib/crypto-worker.ts` | Header comment said "Tier 1 transition state (PR-A)" and conflated schnorr signing with HPKE KEM. AAD comment on the ECIES `decrypt` RPC was ambiguous about whether the warning applied to the legacy v2 path. | Retitled to "Tier 1 transition state", split responsibilities, clarified that `schnorr`/`secp256k1` signing is independent of the X25519 HPKE KEM, scoped the AAD warning explicitly to the legacy v2 path. |
| I-6 | `src/shared/crypto-suite.ts` | Comment claimed `HPKE_SUITE_ID` was "persisted alongside envelopes" | Corrected — `HPKE_SUITE_ID` is a code-level constant, `EnvelopeV3` carries `v: 3` + `labelId`, not a suite id. |
| I-7 | `src/server/lib/hpke-service.ts` | Responsibilities section claimed `HpkeService` "acts as a recipient in hub-key-wrap envelopes" (aspirational — the class is only exercised by its own tests in Tier 1). | Reframed as "Responsibilities in Tier 1" with an explicit note that hub-key-manager integration is deferred. |
| I-8 | `docs/security/AEAD_AUDIT_2026-04-10.md` | PR-B section referenced `src/client/lib/items-key.ts` + `unwrapItemsKey`/`rewrapItemsKeyForNewMaster` + `tests/unit/items-key.test.ts` — all wrong. | Corrected to `src/shared/items-key.ts` + `unwrapPerArtifactKey` + `rewrapItemsKey` + `src/shared/items-key.test.ts`. |

## Deferred to Tier 2+

Tracked in `~/tier-carry-forward/tier-2-notes.md`. Highlights:

- Full removal of the ECIES/XChaCha20 sidecar from `crypto-worker.ts`
  (`file-crypto.ts`, `hub-key-manager.ts`, `signal-contact`, device
  provisioning, `key-store-v2` KEK rotation).
- `hub-key-manager.ts` HPKE rewrite — hub key wrap via HPKE per member,
  wiring the server `HpkeService` in as a recipient.
- `file-crypto.ts` migration to HPKE single-shot per-file keys.
- Deletion of `key-store-v2.ts`.
- `provisioning.ts` migration — device linking must produce non-extractable
  CryptoKey handles.
- Server note/file envelope paths still use legacy primitives.
- Multi-factor KEK (recovery key + WebAuthn) on top of `key-store-v3`.
- Per-record AAD migration for envelope-encrypted PII columns on `contacts`,
  `user_signal_contacts`, `conversations`, `call_records`, `bans` (API surface
  landed in PR-B via `decryptFieldWithRecovery(aadOverride)`).

## Verification

- `bun run typecheck` — clean.
- `bun run lint` — 0 errors.
- `bun run build` — clean.
- `bun run test:unit` — all pass.

(Exact counts recorded in `~/tier-overnight-status/review-tier1.status`.)

## Files touched by this review

- `src/server/services/firehose.ts` — C1 (accept client id).
- `src/server/routes/firehose.ts` — C1 (forward client id).
- `src/client/components/admin-sections/firehose-section.tsx` — C1 (pass pre-generated id).
- `src/shared/schemas/firehose.ts` — C1 (schema accepts id).
- `docs/security/HPKE_MIGRATION_NOTES.md` — I-1.
- `src/shared/envelope-v3.ts` — I-2.
- `CLAUDE.md` — I-3.
- `src/client/lib/hub-field-crypto-v3.ts` — I-4.
- `src/client/lib/crypto-worker.ts` — I-5.
- `src/shared/crypto-suite.ts` — I-6.
- `src/server/lib/hpke-service.ts` — I-7.
- `docs/security/AEAD_AUDIT_2026-04-10.md` — I-8 + Tier 1 post-review append.

Plus the C1 fixes previously landed on this branch across
`tags`, `roles`, `teams`, `report-types`, `shifts` (+ ring groups).

## Cross-references

- `docs/security/HPKE_MIGRATION_NOTES.md` — authoritative Tier 1 changelog.
- `docs/security/AEAD_AUDIT_2026-04-10.md` — original audit + Tier 1 PR-A/B addenda
  + this post-review.
- `~/tier-carry-forward/tier-2-notes.md` — Tier 2+ carry-forward list.
