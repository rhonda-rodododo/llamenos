# HPKE Migration Notes — Tier 1

**Branch:** `feat/sec-tier-1-impl-hpke-prb`
**Baseline:** Tier 0 (Albrecht hardening) on `main`.
**Wire-format break:** envelope v2 (ECIES + XChaCha20-Poly1305) → envelope v3 (HPKE/AES-GCM).
**Migration strategy:** TRUNCATE (pre-production). See `drizzle/migrations/0053_tier1_hpke_envelope_v3.sql`.

Tier 1 shipped as two logical units on a single branch:
- **PR-A** — HPKE primitives, envelope v3, key-store-v3, crypto-worker sidecar, server HpkeService.
- **PR-B** — items_key indirection + migration of hub-field call sites (queries/*.ts + shifts route)
  to the async v3 path.

## What changed in PR-A

### New modules
- `src/shared/crypto-suite.ts` — Factory for the canonical HPKE suite.
  `DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM`.
- `src/shared/envelope-v3.ts` — `EnvelopeV3 = { v: 3, labelId, enc, ct }` with zod schema.
- `src/shared/hpke-primitives.ts` — `hpkeSeal` / `hpkeOpen` / `buildAad` / `HpkeLabelMismatchError`.
  Never falls back; label ID is cross-checked before AEAD open.
- `src/client/lib/hub-field-crypto-v3.ts` — AES-GCM hub-field field crypto with `hubFieldAad` binding.
- `src/client/lib/key-store-v3.ts` — PIN-only KEK key store (PBKDF2-SHA256, 600k iterations) that
  holds the hub AES-GCM key as a non-extractable CryptoKey and the X25519 identity raw bytes in a
  closure, zeroed on lock. Multi-factor KEK (recovery key + WebAuthn) is deferred — tracked for a
  later tier. The X25519-in-closure compromise persists because no Tier 1 target runtime ships
  native X25519 `deriveBits`.
- `src/client/lib/key-store-v3-types.ts` — IDB-backed `KeyStorage` interface + in-memory impl for tests.
- `src/client/lib/native-curves-check.ts` — Async probe for native WebCrypto X25519/Ed25519. It is
  a **telemetry/diagnostic hook**, not a runtime switch: the suite never branches on the probe
  result, because branching crypto paths on runtime feature detection would make the wire format
  depend on the client's WebCrypto feature set.
- `src/server/lib/hpke-service.ts` — Server-side HPKE seal/open for server-held data. Domain label
  `LABEL_SERVER_HPKE_KEY`.

### Modified modules
- `src/client/lib/crypto-worker.ts` — **Additive** HPKE sidecar. New request types:
  `unlockWithHandles`, `hpkeSeal`, `hpkeOpen`, `hpkePublicKeyRaw`. Hub-field encryption uses
  `encryptHubField` / `decryptHubField` in `src/client/lib/hub-field-crypto.ts`. The existing
  ECIES/XChaCha20 surface is preserved for callers that have not yet migrated.
- `src/client/lib/crypto-worker-client.ts` — Client-side RPC wrappers for the new handlers.
- `src/shared/crypto-labels.ts` — Added `LABEL_SERVER_HPKE_KEY` + `LABEL_SERVER_HPKE_KEY_INFO`.
  These are domain labels used by `HpkeService`; they are intentionally **not** in `LABEL_REGISTRY`
  because the server HPKE key is not sealed into an on-the-wire `EnvelopeV3` (which is what
  `LABEL_REGISTRY` indexes for the `labelId` wire field).
- `drizzle/migrations/0053_tier1_hpke_envelope_v3.sql` — TRUNCATE `hubs` + `users` CASCADE with a
  1000-row safety rail. One-way knife — this is a pre-prod wipe, not a data migration.

## What changed in PR-B

### New modules
- `src/shared/items-key.ts` — Items-key indirection primitive. Each record holds an inner
  per-artifact AES-256 key wrapped under a per-record HPKE items-key. `unwrapPerArtifactKey` and
  `rewrapItemsKey` enable byte-equivalent Tier 6 primitive rotation without re-encrypting
  artifacts.
- `drizzle/migrations/0054_tier1_items_key_columns.sql` — Adds `items_key` + `items_key_label`
  columns to the encrypted-record tables.

### Migrated call sites (hub-field async v3 path)
- `src/client/lib/queries/*.ts` — `notes`, `blasts`, `firehose`, `hubs`, `reports`, `roles`,
  `settings`, `shifts`, `tags`, `teams` all switched from the legacy sync `decryptHubField`/
  `encryptHubField` to the async `-v3` variants that bind `buildAad(label, recordId, fieldName)`.
- `src/client/routes/shifts.tsx` — form `handleSubmit` now pre-generates a client UUID and passes
  it to the create mutation so the server stores the same id the client used as AAD `recordId`.

## Rules for the rest of Tier 1

1. **No new ECIES callers.** CI grep guardrail (`Tier 1 — no NEW callers of legacy ECIES/XChaCha20 primitives`)
   blocks any file outside `TIER1_LEGACY_ALLOW` from importing `@noble/ciphers/chacha` or calling
   `getSharedSecret`. Any new encryption path must use `@shared/hpke-primitives`.
2. **No silent HPKE→ECIES fallback.** CI grep guardrail (`Tier 1 — HPKE opener never falls back to ECIES`)
   blocks catch blocks that retry HPKE failures with legacy decrypt paths. Open failure is fatal.
3. **`signAuditEntry` still uses the schnorr/secp256k1 identity nsec.** Tier 0's hash-chained signed
   audit log (`src/client/lib/audit-log-client.ts`, `src/client/lib/audit-chain-verifier.ts`) is not
   replaced by HPKE. The nsec still backs `sign` and `signAuditEntry` after `unlockFromKeyStoreV3`.
4. **Never weaken AAD.** All HPKE seal/open sites pass `buildAad(label, recordId, fieldName)`. The
   hub-field AES-GCM path uses `hubFieldAad(recordId, fieldName)` for parity with v1.
5. **Never skip pre-commit hooks.** The migration was reviewed by lefthook's `pii-check` and biome
   `lint-fix` on every commit.

## Deferred beyond Tier 1

These were scoped out of Tier 1 and carry forward to Tier 2+:

- Full removal of the ECIES/XChaCha20 sidecar from `crypto-worker.ts`.
- `hub-key-manager.ts` HPKE rewrite — hub key distribution wraps via HPKE per member.
- `file-crypto.ts` migration to HPKE single-shot per-file keys.
- Deletion of `key-store-v2.ts`.
- `provisioning.ts` migration — device linking must produce non-extractable CryptoKey handles.
- Server note/file envelope paths still use the legacy primitives — converted when those call
  sites migrate.
- Full E2E test suite run against the notes/files call sites after their migration.
- Multi-factor KEK (recovery key + WebAuthn) support in `key-store-v3`.

## Verification checklist (Tier 1)

- [x] `bun run typecheck` clean on the branch tip.
- [x] Tier 1 unit tests pass (`hpke-primitives`, `crypto-suite`, `envelope-v3`, `hub-field-crypto-v3`,
      `key-store-v3`, `native-curves-check`, `crypto-worker-client` HPKE sidecar).
- [x] Migration 0053 is idempotent; safety rail refuses to run on populated DBs.
- [x] CI grep guardrails pass on the current tree (allowlist matches exactly the set of legacy
      importers).
- [x] `signAuditEntry` still round-trips after `unlockFromKeyStoreV3` (test:
      `Tier 1 HPKE sidecar — unlockFromKeyStoreV3 › populates secretKey + HPKE handles +
      returns schnorr pubkey hex`).
