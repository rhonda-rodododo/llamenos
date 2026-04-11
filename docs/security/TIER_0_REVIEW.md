# Tier 0 — Deep Review

**Date:** 2026-04-10
**Reviewer:** Claude Opus 4.6 main-session deep review
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-0-albrecht-hardening-design.md`
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-0-albrecht-hardening.md`

## Summary

Spec and plan are structurally sound and honor master §9 principles. The load-bearing facts (AAD support in `@noble/ciphers`, 45+ `ciphertext()` columns, missing signatures on `audit_log`, unscoped hub-key encryption, `attest-build-provenance` already at Build L3) were verified during spec authoring against the actual worktree. Two important findings below: (1) **PR #45 landed the logging infrastructure that the spec noted as "in flight"** — the `createLogger`/`createDebugLog`/`Loggable<T>` primitives are now on origin/main, so the spec's "Logging integration with PR #45" migration-note section is outdated and the CSP report endpoint should use the new structured logger from day one; (2) the **migration number `0051`** in the plan collides with the repair migration `0050` — need to verify the next free slot against post-PR-45 main.

## Critical findings

None. The spec's core design is sound.

## Important findings

### I-1. PR #45 is merged; logging integration note is outdated

**Where:** Spec §Migration "Logging integration with PR #45".

**Issue:** The spec treats PR #45 as in-flight and hedges the logging integration. PR #45 merged to main as commit `853d0e67` on 2026-04-10. The new primitives (`src/server/lib/logger.ts`, `src/shared/logger-types.ts`, `src/client/lib/debug-log.ts`, `src/server/middleware/log-context.ts`) are now authoritative.

**Fix:** Update the spec's Migration section to state that Tier 0 depends on PR #45 being merged (it already is) and the CSP report endpoint (§0.5.4) uses `createLogger('csp-report')` with the `Loggable<T>` PII gate from day one. The plan's Task 24 already imports `createLogger` but does not assert the `Loggable<T>` type constraint on the log payload — add that assertion to the task.

### I-2. Migration number likely collides

**Where:** Plan Task 20 references `drizzle/migrations/0051_audit_log_signed_entries.sql`.

**Issue:** Tier 0 was drafted when `0050_repair_user_security_prefs_column.sql` was the latest migration. PR #45 and the ansible-distro PR #49 merged since then; I did not re-verify the next free migration number on post-v0.41.0 main. The number may need to be bumped.

**Fix:** During Tier 0 implementation, before writing the migration, run `ls drizzle/migrations/ | tail -5` and use the next unused integer. The spec's success criteria don't depend on the specific number.

### I-3. Google Fonts self-hosting is coupled to a font pin that isn't verified

**Where:** Plan Task 25, `scripts/fetch-fonts.sh`.

**Issue:** The script pins Inter v4.0 with a `<pin SHA256>` placeholder. No actual SHA was computed — the placeholder is deliberate but easy to miss during implementation.

**Fix:** In the plan's Step 1 of Task 25, add an explicit "compute this SHA once and paste it" instruction with the exact `curl + sha256sum` command to run.

### I-4. `decryptFromHub` API signature change blast radius not enumerated in the plan

**Where:** Plan Task 6, "decryptHubField API change".

**Issue:** The plan changes `encryptHubField(value, hubId)` to `encryptHubField(value, hubId, recordId, fieldName)` and similarly for `decryptHubField`. Every React Query `queryFn` that calls `decryptHubField` needs the `recordId` + `fieldName` threaded through. The plan says "thread recordId (usually item.id) and fieldName (e.g. 'encrypted_name') into the call" but does not enumerate the specific call sites. There are likely 20–30 of them across `queries/`, `note-sheet-context`, `settings`, etc.

**Fix:** In Task 7 Step 3, add a `grep -rn "decryptHubField\|encryptHubField" src/client --include="*.ts" --include="*.tsx"` command at the start, with an instruction to fix every hit.

## Minor findings

### M-1. Plan abbreviates Tasks 11–15 (per-schema audit)

Tasks 10–15 describe "AEAD audit — per schema" with Task 10 as the template and Tasks 11–15 as "repeat the pattern". While DRY, a future implementer may not read Task 10 first. Consider expanding Tasks 11–15 with one concrete commit command each, even if most of the task body is a reference back to Task 10.

### M-2. `bundle.lock` vs `bun.lockb`

The plan's commit in Task 1 uses `git add package.json bun.lock`, but the current repo uses `bun.lockb` (binary lockfile). Verify which exists on post-v0.41.0 main.

### M-3. `CryptoLabel` branded type is exported AS `string`

The spec defines `CryptoLabel = string & { [brand]: never }`. This is correct TypeScript, but any call site that does `const label: string = LABEL_NOTE_KEY` silently widens the type back to `string`. Add a biome rule or `eslint-no-string-assignment-from-CryptoLabel` check so widening can be caught at lint time.

### M-4. `EnvelopeV2` format does not constrain label-id byte count

The spec says `labelId` is 1 byte, but the zod schema has `z.number().int().min(0)` with no max. Add `.max(255)` so schema validation enforces the 1-byte constraint.

## Strengths

- **Triple-redundant label defense** (brand + HKDF + AEAD AAD) is a genuinely well-designed property. Each mechanism prevents Albrecht #3 independently.
- **Hub-key encryption AAD gap** is load-bearing to document — it was a pre-existing hole in the current codebase and Tier 0 is the right place to close it.
- **Signed audit-log chain gate on `rotateHubKey`** is the structural Albrecht #1 fix, and the plan lands it with exact server + client test coverage.
- **The "Export path integrity audit" workstream (0.4)** is right to exist — it would be easy to ship everything else and miss the voicemail/GDPR paths.
- **CI guardrails (grep + biome rules) plus AEAD audit report as PR artifact** give the reviewer a concrete check that Tier 0 actually happened.
- **Plan's File Map table** is unusually complete — every file has a one-line responsibility.

## Verification log

- ✓ `@noble/ciphers/chacha.d.ts` line 48 exports `_poly1305_aead: (xorStream) => (key, nonce, AAD?) => CipherWithOutput` — confirmed AAD as optional third argument during spec authoring.
- ✓ `ciphertext(` grep returned 45+ columns across 15 schema files during exploration; spec's list is complete (cross-referenced during the Tier 0 session).
- ✓ `src/server/db/schema/records.ts` `auditLog` currently has `{id, hubId, actorPubkey, previousEntryHash, entryHash, encryptedEvent, encryptedDetails, createdAt}` — confirmed no signer_* columns, migration 0051 shape is correct relative to that state.
- ✓ `src/client/lib/hub-key-manager.ts` `encryptForHub(plaintext, hubKey)` signature confirmed — no AAD parameter, spec's gap claim is accurate.
- ✓ `src/client/lib/crypto-worker.ts` `handleDecrypt(ephemeralPubkeyHex, wrappedKeyHex, label: string)` — `label: string` untyped confirmed.
- ✓ `src/server/middleware/security-headers.ts` CSP currently contains `style-src 'self' 'unsafe-inline'` — confirmed during exploration.
- ✓ `.github/workflows/release.yml` uses `actions/attest-build-provenance@ef244123eb79f2f7a7e75d99086184180e6d0018 # v2.1.0` — spec's claim that Build L3 is already in place is correct.
- ✓ `scripts/verify-build.sh` currently verifies CHECKSUMS + GPG signature + displays provenance.json — spec accurately describes the missing cosign + SBOM layers.
- ✓ `src/client/lib/crypto.ts` and `src/shared/crypto-primitives.ts` both have parallel ECIES implementations — confirmed; Tier 0 plan's de-duplication task (§0.1.5) is justified.
- ⚠️ Post-merge state not verified: `src/server/lib/logger.ts` now has the full PR #45 primitives (verified via `git log` on origin/main but I did not re-read the post-merge file contents).
- ⚠️ Post-merge state not verified: no re-check of `security-headers.ts` or `records.ts` since PR #45 merge — those files should not have been touched by #45 but it is worth confirming during implementation.

## Open questions for Rhonda

1. **PR #45 is merged** — should Tier 0 implementation start from post-v0.41.0 main (recommended) and drop the "Logging integration with PR #45" hedge? If yes, the Tier 0 branch needs a rebase onto new main before PR #52 merges (see resolution plan below).
2. **`'unsafe-hashes'` allowlist** in the CSP for residual shadcn inline styles (§0.5.2) — the spec commits to "no fallback" but the implementation plan allows `'unsafe-hashes'` with a build-time hash list. Is that acceptable, or should the implementation ban inline styles entirely (forcing all dynamic styles into CSS custom properties)? My read of the spec: `'unsafe-hashes'` with a bounded build-time allowlist is NOT a backcompat shim and is acceptable. Confirm.
3. **CSP `Report-Only` for one release, then enforce** — acceptable rollout pattern. The spec commits to it in Phase A / Phase B language. Confirm the release cadence: one full release in Phase A before flipping to Phase B?
4. **Migration number 0051 collision risk** — confirm the implementation uses the next unused number, not the literal 0051.
