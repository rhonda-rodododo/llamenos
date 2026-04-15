# HPKE Migration Notes — Tier 1

**Branch:** `feat/sec-tier-1-impl-hpke-prb` (merged to `main` via Tier 1 PR).
**Baseline:** Tier 0 (Albrecht hardening) on `main`.
**Wire-format break:** envelope v2 (ECIES + XChaCha20-Poly1305) → envelope v3 (HPKE/AES-GCM),
applied **to hub-field call sites only**. The note/message envelope family (§ "What HPKE does
NOT cover today" below) stays on ECIES + XChaCha20-Poly1305 because its target replacement is
MLS, not a second envelope rewrite.
**Migration strategy:** TRUNCATE (pre-production). See `drizzle/migrations/0053_tier1_hpke_envelope_v3.sql`.

Tier 1 shipped as two logical units on a single branch:
- **PR-A** — HPKE primitives, envelope v3, the PBKDF2-based key store (originally landed as
  `key-store-v3.ts`; after the v2/v3 symbol purge in PR #104 the canonical filename is
  `src/client/lib/key-store.ts`), crypto-worker sidecar, server HpkeService.
- **PR-B** — items_key indirection + migration of hub-field call sites (queries/*.ts + shifts route)
  to the async v3 path.

## What HPKE covers today

As of `main` @ PR #110, the HPKE v3 envelope (`hpkeSeal` / `hpkeOpen` /
`buildAad(label, recordId, fieldName)`, suite `DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 +
AES-256-GCM`) is the wire format for:

- **Hub-field encryption** — every encrypted-hub-metadata column in `queries/*.ts`
  (role names, shift names, report type names, custom field labels, team names, blasts metadata,
  firehose, etc.). Migrated in PR-B.
- **Hub key distribution** (`src/client/lib/hub-key-manager.ts`) — the random 32-byte hub key is
  HPKE-wrapped per-device under `LABEL_HUB_KEY_WRAP` with AAD bound to `(deviceId, hubId)`.
- **Session-capsule wrapping** and related device-scoped envelopes — HPKE wrap against the
  device HPKE public key.
- **Device enrollment / provisioning** — inter-device handoff uses HPKE wrap.
- **File encryption** primitives — the file-body key is HPKE-wrapped (body is AES-GCM under the
  items-key indirection scheme).
- **Server HpkeService** (`src/server/lib/hpke-service.ts`) — server-side HPKE seal/open for
  server-held data under `LABEL_SERVER_HPKE_KEY`.

## What HPKE does NOT cover today

The note and message confidentiality surface is **still** on the legacy ECIES + XChaCha20-Poly1305
envelope family. Specifically:

- `src/shared/crypto-envelopes.ts#encryptNote` / `decryptNoteWithKey` — per-note random
  XChaCha20-Poly1305 key, wrapped via `eciesWrapKey(noteKey, pubkey, LABEL_NOTE_KEY)` for the
  author and every current admin (multi-admin recipient envelopes).
- `src/shared/crypto-envelopes.ts#encryptMessage` — same pattern for inbound SMS / WhatsApp /
  Signal message bodies under `LABEL_MESSAGE`.
- `src/shared/crypto-envelopes.ts#encryptBlastContent` — same pattern under
  `LABEL_BLAST_CONTENT`.
- The legacy ECIES/XChaCha20 sidecar in `src/client/lib/crypto-worker.ts`
  (`encrypt` / `decrypt` / `reEncrypt` / `provisionNsec` / `decryptEnvelopeField` /
  `envelopeEncryptField`) remains reachable for all of the above call sites, plus
  envelope-encrypted PII on contacts / conversations / bans / call_records / signal-contacts.

This is intentional. Per the top-level directive in
`docs/security/POST_OVERHAUL_GAPS_2026-04-13.md`, **MLS replaces HPKE for the note and message
application layer as a clean cut** (Tier 6 PR #2). Rewriting notes/messages onto HPKE as an
intermediate step would be thrown away. The envelope PII columns on contacts/conversations/
bans/call_records have their own migration story (per-record AAD plumbing in `decryptObjectFields`
/ `decryptArrayFields`, tracked as Tier 1 P1).

## What key store v3 did and did not ship

`key-store-v3.ts` was introduced under Tier 1 PR-A as a PIN-only, IDB-backed KEK store using
**PBKDF2-SHA256, 600,000 iterations** (the `v3` suffix disambiguated it from the contemporaneous
`key-store-v2.ts` multi-factor blob). After the MLS enablement + symbol-purge work in PR #104,
`key-store-v2.ts` was deleted and `key-store-v3.ts` was renamed to `key-store.ts` — it is now the
single canonical client key store.

The in-tree `key-store.ts` **already** re-gained a multi-factor shape during the v2→v3 purge:

- PIN → PBKDF2-SHA256 (600k, 32-byte salt) → `pinDerived` (32 bytes).
- Concatenate `[pinDerived ‖ prfOutput? ‖ idpValue]`.
- HKDF-SHA256 with a factor-count-specific `info` label (`LABEL_NSEC_KEK_3F` or
  `LABEL_NSEC_KEK_2F`) → 32-byte KEK.
- XChaCha20-Poly1305 encrypts the `nsec` bytes under the KEK, persisted in `localStorage`.

That is **not** the canonical Tier 2 multi-factor split-share KEK (independent recovery key,
WebAuthn as a primary factor, per-factor HPKE wrap of a KEK share). The Tier 2 root-KEK bundle
(`src/client/lib/root-kek-store.ts`, IDB-backed, AES-KW-wrapped root key) is the correct home
for the split-share design, but it **does not yet wrap the identity bytes or the hub
`CryptoKey`** — that integration is tracked as Tier 3 P1 in
`POST_OVERHAUL_GAPS_2026-04-13.md`. Argon2id (memory-hard) PIN stretching is a separate Tier 2/3
target and has not been wired anywhere.

## What changed in PR-A

### New modules
- `src/shared/crypto-suite.ts` — Factory for the canonical HPKE suite.
  `DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM`.
- `src/shared/hpke-envelope.ts` (originally `envelope-v3.ts`, renamed in PR #104) — `HpkeEnvelope = { v: 3, labelId, enc, ct }` with zod schema.
- `src/shared/hpke-primitives.ts` — `hpkeSeal` / `hpkeOpen` / `buildAad` / `HpkeLabelMismatchError`.
  Never falls back; label ID is cross-checked before AEAD open.
- `src/client/lib/hub-field-crypto.ts` (originally `hub-field-crypto-v3.ts`, renamed in PR #104) — AES-GCM hub-field field crypto with `hubFieldAad` binding.
- `src/client/lib/key-store.ts` (originally landed as `key-store-v3.ts`; renamed in PR #104) —
  PBKDF2-SHA256, 600k iterations. Multi-factor inputs (PIN + IdP-bound value + optional WebAuthn
  PRF output) combined via HKDF-SHA256. Holds the hub AES-GCM key as a non-extractable
  `CryptoKey` and the X25519 identity raw bytes in a closure, zeroed on lock. The full Tier 2
  split-share multi-factor KEK (independent recovery key + WebAuthn as primary factor) is
  deferred and tracked in `root-kek-store.ts`. The X25519-in-closure compromise persists because
  no Tier 1 target runtime ships native X25519 `deriveBits`.
- The IDB-backed `KeyStorage` interface + in-memory test impl that accompanied the `-v3` land has
  been folded into `src/client/lib/root-kek-store.ts` + the crypto-worker boundary; there is no
  standalone types file on `main` today.
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
  because the server HPKE key is not sealed into an on-the-wire `HpkeEnvelope` (which is what
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
   replaced by HPKE. The nsec still backs `sign` and `signAuditEntry` after the crypto-worker
   unlock path (`cryptoWorker.unlock()` or `cryptoWorker.unlockWithHandles()` in
   `src/client/lib/crypto-worker-client.ts`).
4. **Never weaken AAD.** All HPKE seal/open sites pass `buildAad(label, recordId, fieldName)`. The
   hub-field AES-GCM path uses `hubFieldAad(recordId, fieldName)` for parity with v1.
5. **Never skip pre-commit hooks.** The migration was reviewed by lefthook's `pii-check` and biome
   `lint-fix` on every commit.

## Deferred beyond Tier 1 — status as of 2026-04-13

Original deferral list, annotated with current status on `main`:

- **`hub-key-manager.ts` HPKE rewrite** — **DONE.** Hub key distribution wraps via HPKE per
  member under `LABEL_HUB_KEY_WRAP` with AAD bound to `(deviceId, hubId)`.
- **`file-crypto.ts` migration to HPKE single-shot per-file keys** — **DONE** (covered by the
  items-key indirection + HPKE wrap).
- **`provisioning.ts` migration** — device linking produces non-extractable `CryptoKey` handles
  via the HPKE primitive family. **DONE.**
- **Deletion of `key-store-v2.ts`** — **DONE** in PR #104; `key-store-v3.ts` was also renamed to
  `key-store.ts` in the same purge.
- **Full removal of the ECIES/XChaCha20 sidecar from `crypto-worker.ts`** — **NOT DONE.** The
  sidecar still exposes `encrypt` / `decrypt` / `reEncrypt` / `provisionNsec` /
  `decryptEnvelopeField` / `envelopeEncryptField` for the remaining legacy call sites (notes,
  messages, blasts, envelope-PII on contacts / conversations / bans / call_records /
  signal-contacts). Tracked as Tier 1 P0 in `POST_OVERHAUL_GAPS_2026-04-13.md`.
- **Server note/file envelope paths** — **PARTIAL.** Files migrated via the items-key
  indirection. Notes stay on the legacy server-side `CryptoService` XChaCha20-Poly1305 primitive
  and are explicitly **not** being promoted to `HpkeEnvelope` because Tier 6 PR #2 moves them to
  MLS instead (see top-level directive in `POST_OVERHAUL_GAPS_2026-04-13.md`).
- **Multi-factor KEK support in `key-store.ts`** — **PARTIAL.** 2-factor (PIN + IdP-bound
  value) and 3-factor (PIN + IdP-bound value + WebAuthn PRF) are wired. The canonical Tier 2
  split-share multi-factor design (independent recovery key + WebAuthn as a primary factor +
  per-factor HPKE wrap of a KEK share) is still scheduled — the `root-kek-store.ts` bundle is
  the scaffolding target but does not yet wrap identity or hub keys.
- **Full E2E test suite run against the notes/files call sites after their migration** —
  superseded by the Tier 6 PR #2 MLS cutover test plan.

## Verification checklist (Tier 1)

- [x] `bun run typecheck` clean on the branch tip.
- [x] Tier 1 unit tests pass (`hpke-primitives`, `crypto-suite`, `hpke-envelope`, `hub-field-crypto`,
      `key-store` (post-rename), `native-curves-check`, `crypto-worker-client` HPKE sidecar).
- [x] Migration 0053 is idempotent; safety rail refuses to run on populated DBs.
- [x] CI grep guardrails pass on the current tree (allowlist matches exactly the set of legacy
      importers).
- [x] `signAuditEntry` still round-trips after the crypto-worker unlock path
      (`cryptoWorker.unlockWithHandles`). The original Tier 1 PR-A test title was
      `Tier 1 HPKE sidecar — unlockFromKeyStoreV3 › populates secretKey + HPKE handles +
      returns schnorr pubkey hex`; the `V3` in the title reflects the original symbol name and
      was not renamed during the PR #104 purge.
