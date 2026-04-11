# HPKE Migration Notes — Tier 1 PR-A

**Branch:** `feat/sec-tier-1-impl-hpke-pra`
**Baseline:** Tier 0 (Albrecht hardening) on `main`.
**Wire-format break:** envelope v2 (ECIES + XChaCha20-Poly1305) → envelope v3 (HPKE/AES-GCM).
**Migration strategy:** TRUNCATE (pre-production). See `drizzle/migrations/0053_tier1_hpke_envelope_v3.sql`.

## What changed in PR-A

### New modules
- `src/shared/crypto-suite.ts` — Factory for the canonical HPKE suite.
  `DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM`.
- `src/shared/envelope-v3.ts` — `EnvelopeV3 = { v: 3, labelId, enc, ct }` with zod schema.
- `src/shared/hpke-primitives.ts` — `hpkeSeal` / `hpkeOpen` / `buildAad` / `HpkeLabelMismatchError`.
  Never falls back; label ID is cross-checked before AEAD open.
- `src/client/lib/hub-field-crypto-v3.ts` — AES-GCM hub-field field crypto with `hubFieldAad` binding.
- `src/client/lib/key-store-v3.ts` — Multi-factor KEK key store that holds the hub AES-GCM key as a
  non-extractable CryptoKey. Identity X25519 still held as raw bytes in a closure, zeroed on lock, until
  a runtime ships `crypto.subtle.deriveBits` for X25519.
- `src/client/lib/key-store-v3-types.ts` — IDB-backed `KeyStorage` interface + in-memory impl for tests.
- `src/client/lib/native-curves-check.ts` — Probes for native WebCrypto X25519/Ed25519; gates future
  full non-extractability on the runtime.
- `src/server/lib/hpke-service.ts` — Server-side HPKE seal/open for server-held data. Domain label
  `LABEL_SERVER_HPKE_KEY`.

### Modified modules
- `src/client/lib/crypto-worker.ts` — **Additive** HPKE sidecar. New request types:
  `unlockFromKeyStoreV3`, `hpkeSeal`, `hpkeOpen`, `hubFieldEncryptV3`, `hubFieldDecryptV3`,
  `hpkePublicKeyRaw`. The existing ECIES/XChaCha20 surface is preserved until PR-B.
- `src/client/lib/crypto-worker-client.ts` — Client-side RPC wrappers for the new handlers.
- `src/shared/crypto-labels.ts` — Added `LABEL_SERVER_HPKE_KEY` to `LABEL_REGISTRY` (preserving
  wire-format stable `labelId` indices).
- `drizzle/migrations/0053_tier1_hpke_envelope_v3.sql` — TRUNCATE `hubs` + `users` CASCADE with a
  1000-row safety rail. One-way knife — this is a pre-prod wipe, not a data migration.

## Rules until PR-B lands

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

## Deferred to Tier 1 PR-B

These are tracked in the plan and must land before Tier 1 is called done:

- Full removal of the ECIES/XChaCha20 surface from `crypto-worker.ts`.
- `hub-key-manager.ts` HPKE rewrite — hub key distribution wraps via HPKE per member.
- `file-crypto.ts` migration to HPKE single-shot per-file keys.
- Deletion of `key-store-v2.ts`.
- `provisioning.ts` migration — device linking must produce non-extractable CryptoKey handles.
- Server `crypto-service.ts` rewrite — server-held envelope v2 paths converted to v3.
- Full E2E test suite run against the hub-field/notes/files call sites after their migration.
- Items-key indirection (per-record inner key, HPKE-wrapped for readers).

## Verification checklist (PR-A)

- [x] `bun run typecheck` clean on the branch tip.
- [x] Tier 1 unit tests pass (`hpke-primitives`, `crypto-suite`, `envelope-v3`, `hub-field-crypto-v3`,
      `key-store-v3`, `native-curves-check`, `crypto-worker-client` HPKE sidecar).
- [x] Migration 0053 is idempotent; safety rail refuses to run on populated DBs.
- [x] CI grep guardrails pass on the current tree (allowlist matches exactly the set of legacy
      importers).
- [x] `signAuditEntry` still round-trips after `unlockFromKeyStoreV3` (test:
      `Tier 1 HPKE sidecar — unlockFromKeyStoreV3 › populates secretKey + HPKE handles +
      returns schnorr pubkey hex`).
