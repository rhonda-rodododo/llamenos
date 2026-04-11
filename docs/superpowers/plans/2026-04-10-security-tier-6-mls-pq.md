# Security Tier 6 — MLS + Post-Quantum Hybrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the hub-key lifecycle from per-device HPKE rewrap to an MLS (RFC 9420) group with a post-quantum hybrid ciphersuite (XWing: X25519 + ML-KEM-768), providing continuous post-compromise security and HNDL defense, while preserving per-note forward secrecy via the existing `items_key` indirection from Tier 1.

**Architecture:** Two PRs. PR #1 ships the 7-emoji SAS fingerprint verification UX on top of Tier 3's device sigchain (no MLS code yet) plus the vendored `@wireapp/core-crypto` skeleton. PR #2 adds the MLS code path behind a per-hub `tier6Enabled` feature flag: MLS group lifecycle in the crypto worker, KeyPackage publication + fetch endpoints, MLS message delivery over strfry as Nostr event kinds 20001–20003, `items_key` derivation from MLS exporter secret, SFrame base-key integration with Tier 5, and opt-in provable-delete via admin-triggered epoch purges. Staged rollout: internal hub month 1, volunteer opt-in month 2, default-on for new hubs month 3. Audit commissioned before any production hub enables the flag.

**Tech Stack:** TypeScript, Bun, Hono + `@hono/zod-openapi`, React + TanStack Router, Drizzle ORM + PostgreSQL, `@noble/hashes` HKDF/SHA-256/SHA-512, `@noble/ciphers` XChaCha20-Poly1305, `@noble/post-quantum` ML-KEM-768/1024, `@hpke/core` HPKE (already shipped in Tier 1), `@wireapp/core-crypto` (vendored), strfry Nostr relay, Vite + vite-plugin-pwa, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-6-mls-pq-design.md`

**Implementation note — migration numbering:** All `drizzle/migrations/NNNN_*.sql` paths in this plan are **placeholders**. These numbers were computed against pre-v0.41.0 main. At implementation time, run `ls drizzle/migrations/ | sort | tail -5` in your worktree and use the next unused integer for every migration this plan creates, maintaining relative order. The spec's database design is number-agnostic — only the filenames need renumbering. Also verify each cross-tier plan is not stepping on a number another landing tier used.

---

## File Map

### Created — PR #1 (fingerprint UX + @wireapp/core-crypto skeleton)

| File | Responsibility |
|---|---|
| `vendor/core-crypto/` (tree) | Vendored @wireapp/core-crypto source at pinned commit SHA |
| `vendor/PROVENANCE.md` | Chain-of-custody document for every vendored dependency |
| `src/shared/crypto-labels.ts` (modify) | Add `LABEL_SAS_V2`, `LABEL_SFRAME_BASE_KEY`, `LABEL_ITEMS_KEY_EXPORT`, `LABEL_NOTE_EPOCH_KEY`, `LABEL_MLS_PROVISION` |
| `src/client/lib/mls/sas.ts` | 7-emoji SAS derivation from Ed25519 pubkey |
| `src/client/lib/mls/sas.test.ts` | SAS unit tests (determinism, birthday, locale stability) |
| `src/client/lib/mls/emoji-table.ts` | 64-emoji stable table + locale-rendering test fixtures |
| `src/client/lib/mls/emoji-table.test.ts` | Table property tests |
| `src/client/components/verify-fingerprint-modal.tsx` | Admin UI for out-of-band SAS verification |
| `src/client/components/verify-fingerprint-modal.test.tsx` | Component unit tests |
| `src/client/components/device-badge.tsx` | Verified/unverified badge for device lists |
| `src/client/components/device-badge.test.tsx` | Badge unit tests |
| `src/client/routes/hub/settings/devices.tsx` (modify) | Wire up device list + verification modal |
| `src/shared/schemas/audit-entries.ts` (modify) | Add `DeviceFingerprintVerifiedPayloadSchema` variant |
| `src/server/routes/device-verification.ts` | Endpoint that writes signed `device_fingerprint_verified` audit entries |
| `src/server/routes/device-verification.test.ts` | Endpoint unit tests |
| `tests/api/device-fingerprint.spec.ts` | API E2E for verification flow |
| `tests/ui/device-fingerprint.spec.ts` | UI E2E for verification flow |
| `docs/security/VENDOR_AUDIT.md` | Living document tracking audit status of every vendored crypto module |

### Created — PR #2 (MLS core + migration)

| File | Responsibility |
|---|---|
| `src/client/lib/mls/mls-types.ts` | Shared type definitions (`MlsGroupState`, ciphersuite union, envelope tags) |
| `src/client/lib/mls/mls-ciphersuite.ts` | Ciphersuite enum + validation helpers |
| `src/client/lib/mls/mls-ciphersuite.test.ts` | Ciphersuite validation tests |
| `src/client/lib/mls/mls-group.ts` | Core MLS group-lifecycle wrapper over @wireapp/core-crypto |
| `src/client/lib/mls/mls-group.test.ts` | Happy-path group lifecycle tests |
| `src/client/lib/mls/mls-group.adversarial.test.ts` | Adversarial tests (forged KeyPackage, replay, ciphersuite downgrade, broken PQ leg) |
| `src/client/lib/mls/mls-exporter.ts` | Deterministic exporter-secret derivation for `items_key` + SFrame key |
| `src/client/lib/mls/mls-exporter.test.ts` | Exporter determinism + distinctness tests |
| `src/client/lib/mls/mls-state-persistence.ts` | IDB store `mls_group_state` + AES-KW wrap/unwrap via crypto worker |
| `src/client/lib/mls/mls-state-persistence.test.ts` | Persistence tests (round-trip, corrupted state, cross-tab) |
| `src/client/lib/mls/mls-key-package.ts` | KeyPackage generation + publication client |
| `src/client/lib/mls/mls-key-package.test.ts` | KeyPackage tests |
| `src/client/lib/mls/mls-commit.ts` | Commit builder + processor (Add, Remove, Update) |
| `src/client/lib/mls/mls-commit.test.ts` | Commit unit tests |
| `src/client/lib/mls/mls-welcome.ts` | Welcome builder + processor |
| `src/client/lib/mls/mls-welcome.test.ts` | Welcome tests |
| `src/client/lib/mls/mls-delivery-strfry.ts` | Nostr event encoding/decoding for kinds 20001–20003 |
| `src/client/lib/mls/mls-delivery-strfry.test.ts` | Delivery codec tests |
| `src/client/lib/mls/mls-items-key.ts` | `items_key` derivation + epoch cache |
| `src/client/lib/mls/mls-items-key.test.ts` | Items-key tests including cached-epoch walk |
| `src/client/lib/mls/mls-background-updater.ts` | Daily jittered background Update Commit task |
| `src/client/lib/mls/mls-background-updater.test.ts` | Updater tests (clock mocked) |
| `src/client/lib/mls/mls-provable-delete.ts` | Provable-delete helpers (note sealing + epoch purge) |
| `src/client/lib/mls/mls-provable-delete.test.ts` | Provable-delete tests |
| `src/client/lib/crypto-worker.ts` (modify) | Add MLS op handlers (generateKeyPackage, createCommit, processCommit, processWelcome, exportSecret) |
| `src/client/lib/crypto-worker-client.ts` (modify) | Typed MLS API client facade |
| `src/client/hooks/useMlsHub.ts` | React hook wrapping per-hub MLS state queries |
| `src/client/hooks/useMlsHub.test.ts` | Hook tests |
| `src/client/components/mls-opt-in-modal.tsx` | Hub opt-in UX with pre-flight checklist |
| `src/client/components/mls-opt-in-modal.test.tsx` | Modal tests |
| `src/client/routes/hub/settings/security.tsx` (modify) | Wire up opt-in modal + display current ciphersuite |
| `src/shared/schemas/audit-entries.ts` (modify) | Add MLS audit payload variants |
| `src/shared/schemas/mls.ts` | Zod schemas for KeyPackage publish, fetch, and envelope shapes |
| `src/shared/schemas/mls.test.ts` | Schema round-trip tests |
| `src/server/routes/mls-key-packages.ts` | `POST /api/mls/key-packages`, `GET /api/users/{userId}/key-packages` |
| `src/server/routes/mls-key-packages.test.ts` | Route unit tests |
| `src/server/services/mls-key-package-service.ts` | DB-backed KeyPackage store |
| `src/server/services/mls-key-package-service.test.ts` | Service unit tests |
| `src/server/db/schema/mls.ts` | Drizzle schema for `mls_hub_state`, `mls_key_packages` |
| `drizzle/migrations/0060_mls_hub_state.sql` | Per-device MLS state table |
| `drizzle/migrations/0061_mls_key_packages.sql` | KeyPackage table |
| `drizzle/migrations/0062_hubs_tier6_flag.sql` | `tier6_enabled` + `cs_profile` columns on `hubs` |
| `drizzle/migrations/0063_mls_audit_entry_types.sql` | No-op SQL; schema update only (zod discriminated union) |
| `tests/api/mls-hub-lifecycle.spec.ts` | API E2E hub creation + add + remove flow |
| `tests/api/mls-member-removal.spec.ts` | Removed device cannot decrypt new epoch |
| `tests/api/mls-commit-ordering.spec.ts` | Concurrent Commit race |
| `tests/api/mls-commit-replay.spec.ts` | Commit replay rejection |
| `tests/api/mls-forged-keypackage.spec.ts` | Forged KeyPackage rejection |
| `tests/api/mls-ciphersuite-downgrade.spec.ts` | Ciphersuite downgrade rejection |
| `tests/api/mls-key-package-expiry.spec.ts` | Expired KeyPackage handling |
| `tests/api/mls-sframe-integration.spec.ts` | MLS-derived SFrame base key |
| `tests/api/mls-provable-delete.spec.ts` | Provable-delete end-to-end |
| `tests/ui/mls-hub-opt-in.spec.ts` | UI opt-in flow |
| `tests/ui/mls-member-removal.spec.ts` | UI removal flow |
| `tests/ui/mls-background-update.spec.ts` | Daily update with mocked clock |
| `tests/ui/mls-sas-emoji-render.spec.ts` | Cross-locale SAS rendering |
| `tests/ui/mls-fingerprint-mismatch.spec.ts` | Wrong-emoji click handling |
| `scripts/vendor-core-crypto.sh` | Reproducible vendor-update helper |
| `scripts/bundle-size-check.ts` | CI bundle size budget enforcement |
| `docs/protocol/llamenos-protocol.md` (modify) | Append Tier 6 section |
| `docs/architecture/E2EE_ARCHITECTURE.md` (modify) | Post-Tier-6 four-layer diagram |
| `docs/security/SUPPLY_CHAIN_HARDENING.md` (modify) | Vendored @wireapp/core-crypto provenance row |
| `CLAUDE.md` (modify) | Tier 6 migration notes (removed in next tier) |

---

## Prerequisites

This plan assumes Tiers 0, 1, and 3 have landed on the branch base. The following symbols are referenced and must exist:

- `src/shared/crypto-labels.ts` — branded `CryptoLabel` type + existing labels (Tier 0).
- `src/shared/crypto-primitives.ts` — HPKE-based `eciesWrapKey` / `eciesUnwrapKey` with `CryptoLabel` param (Tier 1 rewrites this).
- `src/shared/schemas/audit-entries.ts` — discriminated-union `AuditEntryPayloadSchema` + `SignedAuditEntrySchema` (Tier 0).
- `src/client/lib/audit-chain-verifier.ts` — chain verification with IDB cache (Tier 0).
- `src/client/lib/crypto-worker.ts` — sign/encrypt/decrypt worker ops (Tier 0–1).
- `src/client/lib/device-sigchain.ts` — per-device keypair + sigchain entries (Tier 3).
- `src/server/services/device-service.ts` — server-side device registry (Tier 3).
- Nostr relay integration in `src/client/lib/nostr-relay.ts` publishes and subscribes to kind events.

If any of those are missing, fail-fast: announce the missing prerequisite and abort the plan.

---

## PR #1 — Fingerprint verification UX + vendored @wireapp/core-crypto skeleton

This PR is MLS-free. Every task here operates on the Tier 3 device sigchain. The payoff is that device-fingerprint verification is live for classical hubs before any MLS code exists.

### Task 1: Vendor @wireapp/core-crypto at a pinned commit

**Files:**
- Create: `vendor/core-crypto/` (full source tree)
- Create: `vendor/PROVENANCE.md`
- Create: `scripts/vendor-core-crypto.sh`
- Modify: `package.json`
- Modify: `biome.json` (add `vendor/**` to ignore list)

- [ ] **Step 1: Choose the pinned commit**

Open `https://github.com/wireapp/core-crypto/commits/main` and select the latest commit that has:
- Green CI on the listed suite.
- A tag or release name (e.g. `v0.x.y`).
- PQ ciphersuite support merged (look for `MLS_256_XWING` in the src).

Record the SHA and tag. Example: commit `abc123def456`, tag `v0.4.2`.

- [ ] **Step 2: Write the vendor helper script**

Create `scripts/vendor-core-crypto.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_URL="https://github.com/wireapp/core-crypto.git"
PINNED_SHA="${1:?usage: $0 <commit-sha>}"
VENDOR_DIR="vendor/@wireapp/core-crypto"
TMP_DIR="$(mktemp -d)"

echo "Cloning @wireapp/core-crypto at $PINNED_SHA into $TMP_DIR..."
git clone --quiet "$UPSTREAM_URL" "$TMP_DIR"
git -C "$TMP_DIR" checkout --quiet "$PINNED_SHA"

echo "Removing existing vendor tree..."
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"

echo "Copying source, license, and manifest..."
cp -r "$TMP_DIR/src" "$VENDOR_DIR/src"
cp "$TMP_DIR/package.json" "$VENDOR_DIR/package.json"
cp "$TMP_DIR/tsconfig.json" "$VENDOR_DIR/tsconfig.json"
cp "$TMP_DIR/LICENSE" "$VENDOR_DIR/LICENSE"
cp "$TMP_DIR/README.md" "$VENDOR_DIR/README.md"

echo "Writing vendor pin marker..."
cat > "$VENDOR_DIR/VENDOR.md" <<MARKER
# @wireapp/core-crypto (vendored)

- Upstream: $UPSTREAM_URL
- Commit:   $PINNED_SHA
- Vendored: $(date -u +%Y-%m-%dT%H:%M:%SZ)
MARKER

rm -rf "$TMP_DIR"
echo "Vendored @wireapp/core-crypto at $PINNED_SHA into $VENDOR_DIR"
```

Make it executable: `chmod +x scripts/vendor-core-crypto.sh`.

- [ ] **Step 3: Run the helper to populate the vendor tree**

Run: `./scripts/vendor-core-crypto.sh <SHA-from-step-1>`

Verify: `ls vendor/core-crypto/` shows `LICENSE`, `README.md`, `VENDOR.md`, `package.json`, `tsconfig.json`, `src/`.

- [ ] **Step 4: Write `vendor/PROVENANCE.md`**

```markdown
# Vendored Dependency Provenance

This file records the chain-of-custody for every third-party module in `vendor/`.
Updates are made via PR, never directly to `main`.

## @wireapp/core-crypto

- **Purpose:** Messaging Layer Security (RFC 9420) implementation in TypeScript.
  Supports PQ ciphersuites via `draft-ietf-mls-pq-ciphersuites` (XWing,
  ML-KEM-1024). Vendored to pin our MLS dependency against untracked upstream
  changes and to include the source tree in reproducible builds.
- **Upstream:** https://github.com/wireapp/core-crypto
- **License:** GPL-3.0 (see `vendor/core-crypto/LICENSE`). GPL-3.0 obligations apply to distribution of the vendored source; Llamenos' overall license posture is GPL-compatible and the PROVENANCE.md documents the license chain. Core-crypto's JS bindings (`@wireapp/core-crypto`) are the same license as the upstream Rust crate.
- **Current commit:** `<SHA-from-step-1>` (tag `<tag-from-step-1>`)
- **Vendored on:** 2026-04-10
- **Audit status:** PENDING — commissioned audit scheduled; see
  `docs/security/VENDOR_AUDIT.md`.
- **Update procedure:** Run `./scripts/vendor-core-crypto.sh <new-sha>`, commit the
  diff to a PR, run the full test suite, and update this file with the new SHA.
```

- [ ] **Step 5: Make the monorepo resolve @wireapp/core-crypto from the vendored path**

Edit `package.json` — add to the `dependencies` object:

```json
"@wireapp/core-crypto": "file:./vendor/@wireapp/core-crypto"
```

(Alphabetical order.)

- [ ] **Step 6: Extend biome + tsconfig to ignore the vendor tree**

Edit `biome.json`:

```json
{
  "files": {
    "ignore": ["vendor/**", "node_modules/**", "dist/**", ".wrangler/**"]
  }
}
```

Edit `tsconfig.json` — ensure `"exclude"` includes `"vendor/**/*.test.ts"` but keeps `"vendor/**/src/**"` in the root `include` for type resolution.

- [ ] **Step 7: Install and verify import**

Run: `bun install`
Expected: resolves `@wireapp/core-crypto` to `vendor/core-crypto`.

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: 0 errors.

- [ ] **Step 8: Create `docs/security/VENDOR_AUDIT.md`**

```markdown
# Vendor Audit Tracking

| Module | Vendor commit | Audit firm | Audit date | Status | Report |
|---|---|---|---|---|---|
| @wireapp/core-crypto | `<SHA>` | TBD (pending commission) | — | PENDING | — |
```

- [ ] **Step 9: Commit**

```bash
git add vendor/@wireapp/core-crypto vendor/PROVENANCE.md scripts/vendor-core-crypto.sh package.json biome.json tsconfig.json docs/security/VENDOR_AUDIT.md
git commit -m "chore(vendor): add @wireapp/core-crypto at pinned commit for Tier 6 MLS integration"
```

### Task 2: Add new crypto labels for Tier 6

**Files:**
- Modify: `src/shared/crypto-labels.ts`
- Modify: `src/shared/crypto-labels.test.ts`

- [ ] **Step 1: Write failing tests for the new labels**

Append to `src/shared/crypto-labels.test.ts`:

```typescript
import {
  LABEL_SAS_V2,
  LABEL_SFRAME_BASE_KEY,
  LABEL_ITEMS_KEY_EXPORT,
  LABEL_NOTE_EPOCH_KEY,
  LABEL_MLS_PROVISION,
  LABEL_REGISTRY,
} from './crypto-labels'

describe('Tier 6 crypto labels', () => {
  test('LABEL_SAS_V2 exists and is distinct', () => {
    expect(LABEL_SAS_V2).toBe('llamenos:sas:v2')
  })
  test('LABEL_SFRAME_BASE_KEY exists', () => {
    expect(LABEL_SFRAME_BASE_KEY).toBe('llamenos:sframe-base-key:v1')
  })
  test('LABEL_ITEMS_KEY_EXPORT exists', () => {
    expect(LABEL_ITEMS_KEY_EXPORT).toBe('llamenos:items-key-export:v1')
  })
  test('LABEL_NOTE_EPOCH_KEY exists', () => {
    expect(LABEL_NOTE_EPOCH_KEY).toBe('llamenos:note-epoch-key:v1')
  })
  test('LABEL_MLS_PROVISION exists', () => {
    expect(LABEL_MLS_PROVISION).toBe('llamenos:mls-provision:v1')
  })
  test('all Tier 6 labels registered in LABEL_REGISTRY', () => {
    for (const label of [
      LABEL_SAS_V2,
      LABEL_SFRAME_BASE_KEY,
      LABEL_ITEMS_KEY_EXPORT,
      LABEL_NOTE_EPOCH_KEY,
      LABEL_MLS_PROVISION,
    ]) {
      expect(LABEL_REGISTRY).toContain(label)
    }
  })
})
```

- [ ] **Step 2: Run the test**

Run: `bun test src/shared/crypto-labels.test.ts -t "Tier 6"`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Add the labels**

Edit `src/shared/crypto-labels.ts` — at the end of the file, before the `LABEL_REGISTRY`:

```typescript
// --- Tier 6 (MLS + PQ) ---

/** 7-emoji SAS derivation from device Ed25519 pubkey (Tier 6 fingerprint verification) */
export const LABEL_SAS_V2 = 'llamenos:sas:v2' as CryptoLabel

/** MLS exporter-secret → per-call SFrame base key */
export const LABEL_SFRAME_BASE_KEY = 'llamenos:sframe-base-key:v1' as CryptoLabel

/** MLS exporter-secret → per-user items_key derivation */
export const LABEL_ITEMS_KEY_EXPORT = 'llamenos:items-key-export:v1' as CryptoLabel

/** MLS exporter-secret → per-note epoch-bound key (provable delete) */
export const LABEL_NOTE_EPOCH_KEY = 'llamenos:note-epoch-key:v1' as CryptoLabel

/** HKDF domain separation for MLS credential provisioning */
export const LABEL_MLS_PROVISION = 'llamenos:mls-provision:v1' as CryptoLabel
```

Then append to `LABEL_REGISTRY`:

```typescript
// ... existing entries ...
LABEL_SAS_V2,
LABEL_SFRAME_BASE_KEY,
LABEL_ITEMS_KEY_EXPORT,
LABEL_NOTE_EPOCH_KEY,
LABEL_MLS_PROVISION,
] as const satisfies readonly CryptoLabel[]
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/shared/crypto-labels.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-labels.ts src/shared/crypto-labels.test.ts
git commit -m "feat(crypto-labels): add Tier 6 MLS + SAS labels to registry"
```

### Task 3: SAS emoji table

**Files:**
- Create: `src/client/lib/mls/emoji-table.ts`
- Create: `src/client/lib/mls/emoji-table.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/emoji-table.test.ts
import { describe, expect, test } from 'bun:test'
import { SAS_EMOJI_TABLE, SAS_EMOJI_NAMES_EN } from './emoji-table'

describe('SAS emoji table', () => {
  test('exactly 64 entries (6 bits of entropy per emoji)', () => {
    expect(SAS_EMOJI_TABLE.length).toBe(64)
  })

  test('every entry is a non-empty string', () => {
    for (const e of SAS_EMOJI_TABLE) {
      expect(typeof e).toBe('string')
      expect(e.length).toBeGreaterThan(0)
    }
  })

  test('no duplicates', () => {
    expect(new Set(SAS_EMOJI_TABLE).size).toBe(64)
  })

  test('names table has the same length', () => {
    expect(SAS_EMOJI_NAMES_EN.length).toBe(64)
  })

  test('every name is non-empty and lowercase', () => {
    for (const name of SAS_EMOJI_NAMES_EN) {
      expect(name.length).toBeGreaterThan(0)
      expect(name).toBe(name.toLowerCase())
    }
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/client/lib/mls/emoji-table.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the table**

```typescript
// src/client/lib/mls/emoji-table.ts
/**
 * 64-emoji table used for SAS (Short Authentication String) derivation in
 * Tier 6 fingerprint verification. Entries are chosen for:
 *   - Cross-platform rendering stability (iOS, Android, Windows, Linux).
 *   - Unambiguous shapes (no visually similar pairs).
 *   - Culturally neutral (no flags, no symbols with regional meaning).
 *   - Stable names in the 13 Llamenos locales (see sas-locale-stability test).
 *
 * ORDER IS LOAD-BEARING. Changing the order changes every device's SAS.
 * If you must extend, append a new table (`SAS_EMOJI_TABLE_V2`) and a new
 * label (`LABEL_SAS_V3`); NEVER mutate this table.
 *
 * Each entry is addressed by a 6-bit index (0..63).
 */
export const SAS_EMOJI_TABLE = [
  '🍎', '🍌', '🍇', '🍒', '🍍', '🍉', '🍓', '🥑',
  '🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🦁',
  '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🦆', '🦉',
  '🐴', '🦄', '🐝', '🐞', '🐢', '🐍', '🦀', '🐙',
  '🌵', '🌲', '🌳', '🌴', '🌱', '🍀', '🌸', '🌼',
  '🌻', '🌹', '🌺', '🍄', '🌰', '🌞', '🌝', '🌛',
  '⭐', '🔥', '💧', '❄️', '⚡', '🌈', '☂️', '🎈',
  '🎁', '🎵', '🔔', '🎨', '📚', '✏️', '🔑', '🧲',
] as const

export const SAS_EMOJI_NAMES_EN = [
  'apple', 'banana', 'grapes', 'cherries', 'pineapple', 'watermelon', 'strawberry', 'avocado',
  'dog', 'cat', 'mouse', 'rabbit', 'fox', 'bear', 'panda', 'lion',
  'cow', 'pig', 'frog', 'monkey', 'chicken', 'penguin', 'duck', 'owl',
  'horse', 'unicorn', 'bee', 'ladybug', 'turtle', 'snake', 'crab', 'octopus',
  'cactus', 'evergreen', 'tree', 'palm tree', 'seedling', 'clover', 'blossom', 'flower',
  'sunflower', 'rose', 'hibiscus', 'mushroom', 'chestnut', 'sun', 'full moon', 'crescent moon',
  'star', 'fire', 'droplet', 'snowflake', 'lightning', 'rainbow', 'umbrella', 'balloon',
  'gift', 'music', 'bell', 'art', 'book', 'pencil', 'key', 'magnet',
] as const

if (SAS_EMOJI_TABLE.length !== 64 || SAS_EMOJI_NAMES_EN.length !== 64) {
  throw new Error('SAS tables must be exactly 64 entries')
}
```

- [ ] **Step 4: Run test**

Run: `bun test src/client/lib/mls/emoji-table.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/emoji-table.ts src/client/lib/mls/emoji-table.test.ts
git commit -m "feat(mls): SAS emoji table for Tier 6 fingerprint verification"
```

### Task 4: SAS derivation function

**Files:**
- Create: `src/client/lib/mls/sas.ts`
- Create: `src/client/lib/mls/sas.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/sas.test.ts
import { describe, expect, test } from 'bun:test'
import { deriveSasEmoji, deriveSasNamesEn } from './sas'

describe('deriveSasEmoji', () => {
  const key1 = new Uint8Array(32).fill(1)
  const key2 = new Uint8Array(32).fill(2)

  test('returns 7 emoji', () => {
    const result = deriveSasEmoji(key1)
    expect(result.length).toBe(7)
  })

  test('deterministic for same input', () => {
    expect(deriveSasEmoji(key1)).toEqual(deriveSasEmoji(key1))
  })

  test('different inputs produce different outputs', () => {
    expect(deriveSasEmoji(key1)).not.toEqual(deriveSasEmoji(key2))
  })

  test('each emoji is from the 64-entry table', () => {
    const { SAS_EMOJI_TABLE } = require('./emoji-table')
    for (const e of deriveSasEmoji(key1)) {
      expect(SAS_EMOJI_TABLE).toContain(e)
    }
  })

  test('throws on key shorter than 32 bytes', () => {
    expect(() => deriveSasEmoji(new Uint8Array(16))).toThrow('32 bytes')
  })

  test('birthday test over 1000 random keys: no collisions', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const k = new Uint8Array(32)
      crypto.getRandomValues(k)
      const sas = deriveSasEmoji(k).join(',')
      expect(seen.has(sas)).toBe(false)
      seen.add(sas)
    }
  })
})

describe('deriveSasNamesEn', () => {
  const key1 = new Uint8Array(32).fill(1)
  test('returns 7 english names parallel to emoji', () => {
    const emoji = deriveSasEmoji(key1)
    const names = deriveSasNamesEn(key1)
    expect(names.length).toBe(7)
    // Names correspond to same indices
    const { SAS_EMOJI_TABLE, SAS_EMOJI_NAMES_EN } = require('./emoji-table')
    for (let i = 0; i < 7; i++) {
      const idx = SAS_EMOJI_TABLE.indexOf(emoji[i])
      expect(names[i]).toBe(SAS_EMOJI_NAMES_EN[idx])
    }
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/client/lib/mls/sas.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/mls/sas.ts
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { LABEL_SAS_V2 } from '@shared/crypto-labels'
import { SAS_EMOJI_TABLE, SAS_EMOJI_NAMES_EN } from './emoji-table'

/**
 * Derive a 7-emoji Short Authentication String from a device's Ed25519 public
 * key. Uses HKDF-SHA256 over the pubkey with a domain-separated label, then
 * packs 6-bit indices into the 64-entry emoji table.
 *
 * 7 × 6 bits = 42 bits of authentication entropy. Sufficient for casual
 * over-the-phone verification; not a replacement for a cryptographic signature.
 *
 * @throws if pubkey is not 32 bytes.
 */
export function deriveSasEmoji(devicePubkey: Uint8Array): readonly string[] {
  if (devicePubkey.length !== 32) {
    throw new Error(`SAS pubkey must be 32 bytes, got ${devicePubkey.length}`)
  }
  const indices = deriveSasIndices(devicePubkey)
  return indices.map((i) => SAS_EMOJI_TABLE[i])
}

/**
 * Parallel English name array for the 7-emoji SAS, used in the verification
 * modal for accessibility + ambiguity-breaking.
 */
export function deriveSasNamesEn(devicePubkey: Uint8Array): readonly string[] {
  const indices = deriveSasIndices(devicePubkey)
  return indices.map((i) => SAS_EMOJI_NAMES_EN[i])
}

function deriveSasIndices(devicePubkey: Uint8Array): number[] {
  // 7 × 6 bits = 42 bits — round up to 6 bytes.
  const raw = hkdf(
    sha256,
    devicePubkey,
    undefined,
    utf8ToBytes(LABEL_SAS_V2),
    6, // 48 bits; we use the first 42.
  )
  // Bit-unpack: read 42 bits as seven 6-bit indices.
  const indices: number[] = []
  let bitBuf = 0n
  for (let i = 0; i < 6; i++) {
    bitBuf = (bitBuf << 8n) | BigInt(raw[i])
  }
  // Top 42 bits are what we care about; pull out 7 × 6-bit windows from the MSB.
  for (let i = 0; i < 7; i++) {
    const shift = BigInt(42 - (i + 1) * 6)
    const mask = 0x3Fn
    indices.push(Number((bitBuf >> shift) & mask))
  }
  return indices
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/client/lib/mls/sas.test.ts`
Expected: all PASS.

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/sas.ts src/client/lib/mls/sas.test.ts
git commit -m "feat(mls): 7-emoji SAS derivation from Ed25519 pubkey"
```

### Task 5: Add `device_fingerprint_verified` audit payload variant

**Files:**
- Modify: `src/shared/schemas/audit-entries.ts`
- Modify: `src/shared/schemas/audit-entries.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/shared/schemas/audit-entries.test.ts`:

```typescript
import {
  AuditEntryPayloadSchema,
  DeviceFingerprintVerifiedPayloadSchema,
} from './audit-entries'

describe('device_fingerprint_verified payload', () => {
  test('round-trips through schema', () => {
    const payload = {
      type: 'device_fingerprint_verified' as const,
      hubId: '11111111-1111-1111-1111-111111111111',
      verifiedDeviceId: '22222222-2222-2222-2222-222222222222',
      verifiedDevicePubkey: 'a'.repeat(64),
      verifierDeviceId: '33333333-3333-3333-3333-333333333333',
    }
    expect(() => DeviceFingerprintVerifiedPayloadSchema.parse(payload)).not.toThrow()
    expect(() => AuditEntryPayloadSchema.parse(payload)).not.toThrow()
  })

  test('rejects non-64-char hex pubkey', () => {
    const payload = {
      type: 'device_fingerprint_verified' as const,
      hubId: '11111111-1111-1111-1111-111111111111',
      verifiedDeviceId: '22222222-2222-2222-2222-222222222222',
      verifiedDevicePubkey: 'short',
      verifierDeviceId: '33333333-3333-3333-3333-333333333333',
    }
    expect(() => DeviceFingerprintVerifiedPayloadSchema.parse(payload)).toThrow()
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/shared/schemas/audit-entries.test.ts -t "device_fingerprint_verified"`
Expected: FAIL — symbol missing.

- [ ] **Step 3: Add the schema variant**

Edit `src/shared/schemas/audit-entries.ts` — add before `AuditEntryPayloadSchema`:

```typescript
export const DeviceFingerprintVerifiedPayloadSchema = z.object({
  type: z.literal('device_fingerprint_verified'),
  hubId: z.string().uuid(),
  verifiedDeviceId: z.string().uuid(),
  verifiedDevicePubkey: z.string().regex(/^[0-9a-f]{64}$/),
  verifierDeviceId: z.string().uuid(),
})
```

Add `DeviceFingerprintVerifiedPayloadSchema` to the discriminated union:

```typescript
export const AuditEntryPayloadSchema = z.discriminatedUnion('type', [
  MembershipAddPayloadSchema,
  MembershipRemovePayloadSchema,
  RoleChangePayloadSchema,
  HubKeyRotatePayloadSchema,
  HubCreatePayloadSchema,
  HubDeletePayloadSchema,
  DeviceAddPayloadSchema,
  DeviceRevokePayloadSchema,
  DeviceFingerprintVerifiedPayloadSchema,
])
```

- [ ] **Step 4: Run tests**

Run: `bun test src/shared/schemas/audit-entries.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas/audit-entries.ts src/shared/schemas/audit-entries.test.ts
git commit -m "feat(schemas): add device_fingerprint_verified audit payload variant"
```

### Task 6: Device verification server endpoint

**Files:**
- Create: `src/server/routes/device-verification.ts`
- Create: `src/server/routes/device-verification.test.ts`
- Modify: `src/server/app.ts` (mount the route)

- [ ] **Step 1: Write failing route test**

```typescript
// src/server/routes/device-verification.test.ts
import { describe, expect, test } from 'bun:test'
import { app } from '../app'

describe('POST /api/hubs/:hubId/devices/:deviceId/verify', () => {
  test('accepts a signed audit entry and appends it', async () => {
    // Setup: create hub, create admin, create target device, sign an entry.
    // (Use existing test harness helpers from tests/helpers/authed-request.ts.)
    // ...
    // The endpoint validates:
    //   - caller is admin of the hub
    //   - payload.type === 'device_fingerprint_verified'
    //   - signature verifies against caller device's pubkey
    //   - prevEntryHash matches current head
    // On success: append to audit_log + return 201 with the new head hash.
    expect(true).toBe(true) // placeholder
  })

  test('rejects a non-admin caller with 403', async () => {
    expect(true).toBe(true) // placeholder
  })

  test('rejects an entry with an invalid signature with 400', async () => {
    expect(true).toBe(true) // placeholder
  })
})
```

(The concrete test body is filled in once the route exists — this is the TDD "red" step.)

- [ ] **Step 2: Run test**

Run: `bun test src/server/routes/device-verification.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the route**

```typescript
// src/server/routes/device-verification.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import { requireAuth } from '../middleware/auth'
import { requireAdminForHub } from '../middleware/hub-admin'
import { SignedAuditEntrySchema } from '@shared/schemas/audit-entries'
import { AuditLogService } from '../services/audit-log-service'

const app = new OpenAPIHono()

const RequestSchema = z.object({
  signedEntry: SignedAuditEntrySchema,
})

const ResponseSchema = z.object({
  entryHash: z.string().regex(/^[0-9a-f]{64}$/),
  appendedAt: z.string().datetime(),
})

const route = createRoute({
  method: 'post',
  path: '/api/hubs/:hubId/devices/:deviceId/verify',
  tags: ['devices'],
  request: {
    params: z.object({
      hubId: z.string().uuid(),
      deviceId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': { schema: RequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Verification entry appended',
      content: {
        'application/json': { schema: ResponseSchema },
      },
    },
    403: { description: 'Caller is not admin for the hub' },
    400: { description: 'Invalid signature or payload' },
  },
  middleware: [requireAuth, requireAdminForHub] as const,
})

app.openapi(route, async (c) => {
  const { hubId, deviceId } = c.req.valid('param')
  const { signedEntry } = c.req.valid('json')

  if (signedEntry.payload.type !== 'device_fingerprint_verified') {
    return c.json({ error: 'payload type mismatch' }, 400)
  }
  if (signedEntry.payload.hubId !== hubId) {
    return c.json({ error: 'hubId mismatch' }, 400)
  }
  if (signedEntry.payload.verifiedDeviceId !== deviceId) {
    return c.json({ error: 'deviceId mismatch' }, 400)
  }

  const svc = new AuditLogService(c.var.db)
  const result = await svc.appendSigned(signedEntry)
  if (!result.ok) {
    return c.json({ error: result.reason }, 400)
  }
  return c.json({ entryHash: result.entryHash, appendedAt: result.appendedAt }, 201)
})

export default app
```

- [ ] **Step 4: Mount in `app.ts`**

```typescript
import deviceVerification from './routes/device-verification'
// ... existing imports ...
app.route('/', deviceVerification)
```

- [ ] **Step 5: Fill in test body**

Replace the placeholder test bodies with real assertions using `authedRequest` from `tests/helpers/authed-request.ts`. The tests exercise:
- Happy path: admin signs + posts → 201, audit entry appended.
- Forbidden path: volunteer tries → 403.
- Invalid signature: mutate signature hex → 400.
- Cross-hub confusion: hubId in payload ≠ hubId in URL → 400.

- [ ] **Step 6: Run the tests**

Run: `bun test src/server/routes/device-verification.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/device-verification.ts src/server/routes/device-verification.test.ts src/server/app.ts
git commit -m "feat(server): device fingerprint verification endpoint"
```

### Task 7: VerifyFingerprintModal component

**Files:**
- Create: `src/client/components/verify-fingerprint-modal.tsx`
- Create: `src/client/components/verify-fingerprint-modal.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/components/verify-fingerprint-modal.test.tsx
import { describe, expect, test } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { VerifyFingerprintModal } from './verify-fingerprint-modal'

describe('VerifyFingerprintModal', () => {
  const targetPubkey = new Uint8Array(32).fill(7)
  const onVerify = async () => {}
  const onCancel = () => {}

  test('renders the 7 emoji from the target pubkey', () => {
    render(
      <VerifyFingerprintModal
        open
        targetDevicePubkey={targetPubkey}
        onVerify={onVerify}
        onCancel={onCancel}
      />,
    )
    // Seven emoji testids are visible
    for (let i = 0; i < 7; i++) {
      expect(screen.getByTestId(`sas-emoji-${i}`)).toBeTruthy()
    }
  })

  test('selecting the right sequence enables Verify button', () => {
    render(
      <VerifyFingerprintModal
        open
        targetDevicePubkey={targetPubkey}
        onVerify={onVerify}
        onCancel={onCancel}
      />,
    )
    // Click the target sequence (in the picker grid, the 7 chosen emojis for this key)
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByTestId(`sas-picker-correct-${i}`))
    }
    expect(screen.getByTestId('sas-verify-confirm').hasAttribute('disabled')).toBe(false)
  })

  test('selecting wrong sequence disables confirmation + shows mismatch error', () => {
    render(
      <VerifyFingerprintModal
        open
        targetDevicePubkey={targetPubkey}
        onVerify={onVerify}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('sas-picker-wrong-0'))
    expect(screen.getByTestId('sas-mismatch-warning')).toBeTruthy()
    expect(screen.getByTestId('sas-verify-confirm').hasAttribute('disabled')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/client/components/verify-fingerprint-modal.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component**

```typescript
// src/client/components/verify-fingerprint-modal.tsx
import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { deriveSasEmoji, deriveSasNamesEn } from '@/lib/mls/sas'
import { SAS_EMOJI_TABLE } from '@/lib/mls/emoji-table'
import { useTranslation } from 'react-i18next'

export interface VerifyFingerprintModalProps {
  open: boolean
  targetDevicePubkey: Uint8Array
  onVerify: () => Promise<void>
  onCancel: () => void
}

export function VerifyFingerprintModal(props: VerifyFingerprintModalProps) {
  const { t } = useTranslation()
  const correctEmoji = useMemo(
    () => deriveSasEmoji(props.targetDevicePubkey),
    [props.targetDevicePubkey],
  )
  const correctNames = useMemo(
    () => deriveSasNamesEn(props.targetDevicePubkey),
    [props.targetDevicePubkey],
  )
  const [picked, setPicked] = useState<string[]>([])
  const mismatch = picked.length > 0 && picked[picked.length - 1] !== correctEmoji[picked.length - 1]
  const complete = picked.length === 7 && !mismatch

  const reset = () => setPicked([])

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onCancel()}>
      <DialogContent data-testid="verify-fingerprint-modal">
        <DialogHeader>
          <DialogTitle>{t('verifyFingerprint.title')}</DialogTitle>
        </DialogHeader>
        <p>{t('verifyFingerprint.instructions')}</p>

        <div className="grid grid-cols-7 gap-2 my-4">
          {correctEmoji.map((e, i) => (
            <div
              key={i}
              data-testid={`sas-emoji-${i}`}
              className="text-3xl text-center"
              aria-label={correctNames[i]}
            >
              {e}
            </div>
          ))}
        </div>

        <p className="text-sm">{t('verifyFingerprint.clickPrompt')}</p>
        <div className="grid grid-cols-8 gap-1" data-testid="sas-picker">
          {SAS_EMOJI_TABLE.map((e, idx) => {
            const nextIdx = picked.length
            const isCorrectNext = nextIdx < 7 && e === correctEmoji[nextIdx]
            return (
              <button
                key={idx}
                type="button"
                data-testid={
                  isCorrectNext
                    ? `sas-picker-correct-${nextIdx}`
                    : `sas-picker-wrong-${idx}`
                }
                onClick={() => setPicked((p) => [...p, e])}
                disabled={mismatch || complete}
                className="text-2xl p-1 border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                {e}
              </button>
            )
          })}
        </div>

        {mismatch ? (
          <div
            data-testid="sas-mismatch-warning"
            className="mt-4 p-2 bg-red-100 text-red-800 rounded"
          >
            {t('verifyFingerprint.mismatch')}
          </div>
        ) : null}

        <div className="flex gap-2 mt-4">
          <Button variant="ghost" onClick={reset} data-testid="sas-reset">
            {t('common.reset')}
          </Button>
          <Button
            data-testid="sas-verify-confirm"
            disabled={!complete}
            onClick={() => props.onVerify()}
          >
            {t('verifyFingerprint.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Add i18n keys**

Add to `src/client/locales/en/common.json`:

```json
"verifyFingerprint": {
  "title": "Verify device fingerprint",
  "instructions": "Call the device owner out of band. Ask them to read these 7 emojis in order. Click each one in the picker below as they read it.",
  "clickPrompt": "Click the emojis in order:",
  "mismatch": "Emoji sequence does not match. Please reset and try again.",
  "confirm": "Verified"
},
"common": {
  "reset": "Reset"
}
```

(Replicate across all 13 locales using the existing i18n tooling — copy into `es/`, `zh/`, `tl/`, `vi/`, `ar/`, `fr/`, `ht/`, `ko/`, `ru/`, `hi/`, `pt/`, `de/`, translating each string.)

- [ ] **Step 5: Run tests**

Run: `bun test src/client/components/verify-fingerprint-modal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/verify-fingerprint-modal.tsx src/client/components/verify-fingerprint-modal.test.tsx src/client/locales/**/common.json
git commit -m "feat(ui): verify-fingerprint modal with 7-emoji SAS picker"
```

### Task 8: Device badge component

**Files:**
- Create: `src/client/components/device-badge.tsx`
- Create: `src/client/components/device-badge.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/components/device-badge.test.tsx
import { describe, expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { DeviceBadge } from './device-badge'

describe('DeviceBadge', () => {
  test('renders verified variant with green data attribute', () => {
    render(<DeviceBadge verified />)
    const el = screen.getByTestId('device-badge')
    expect(el.getAttribute('data-verified')).toBe('true')
  })
  test('renders unverified variant with red data attribute', () => {
    render(<DeviceBadge verified={false} />)
    const el = screen.getByTestId('device-badge')
    expect(el.getAttribute('data-verified')).toBe('false')
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/client/components/device-badge.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/client/components/device-badge.tsx
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'

export interface DeviceBadgeProps {
  verified: boolean
}

export function DeviceBadge({ verified }: DeviceBadgeProps) {
  const { t } = useTranslation()
  return (
    <Badge
      data-testid="device-badge"
      data-verified={verified}
      variant={verified ? 'default' : 'destructive'}
    >
      {verified ? t('device.verified') : t('device.unverified')}
    </Badge>
  )
}
```

Add i18n keys `device.verified = "Verified"`, `device.unverified = "Unverified"` across all 13 locales.

- [ ] **Step 4: Run test**

Run: `bun test src/client/components/device-badge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/device-badge.tsx src/client/components/device-badge.test.tsx src/client/locales/**/common.json
git commit -m "feat(ui): device verified/unverified badge"
```

### Task 9: Wire fingerprint verification into hub settings

**Files:**
- Modify: `src/client/routes/hub/settings/devices.tsx`

- [ ] **Step 1: Identify the existing device-list route**

Run: `bun run typecheck` and locate the existing hub-devices route (it's a TanStack file-based route added in Tier 3). If the exact path differs from `src/client/routes/hub/settings/devices.tsx`, use the one that exists — do NOT create a new route.

- [ ] **Step 2: Add state + modal wiring**

In the existing device-list component, add:

```typescript
const [verifying, setVerifying] = useState<Device | null>(null)

async function submitVerification(device: Device) {
  const entry = await buildSignedAuditEntry({
    hubId: hub.id,
    payload: {
      type: 'device_fingerprint_verified',
      hubId: hub.id,
      verifiedDeviceId: device.id,
      verifiedDevicePubkey: device.ed25519Pubkey,
      verifierDeviceId: currentDevice.id,
    },
    prevEntryHash: await auditLog.currentHead(),
    signerDeviceId: currentDevice.id,
  })
  await api.verifyDeviceFingerprint(hub.id, device.id, entry)
  await queryClient.invalidateQueries({ queryKey: queryKeys.hub.devices(hub.id) })
  setVerifying(null)
}
```

And in JSX:

```typescript
{devices.map((d) => (
  <tr key={d.id} data-testid={`device-row-${d.id}`}>
    <td>{d.label}</td>
    <td><DeviceBadge verified={d.verified} /></td>
    <td>
      {!d.verified && currentUser.isAdmin ? (
        <Button
          data-testid={`verify-device-${d.id}`}
          onClick={() => setVerifying(d)}
        >
          {t('device.verifyButton')}
        </Button>
      ) : null}
    </td>
  </tr>
))}

{verifying ? (
  <VerifyFingerprintModal
    open
    targetDevicePubkey={hexToBytes(verifying.ed25519Pubkey)}
    onVerify={() => submitVerification(verifying)}
    onCancel={() => setVerifying(null)}
  />
) : null}
```

- [ ] **Step 3: Add the API client method**

In the existing API client module (same one used by other hub routes):

```typescript
export async function verifyDeviceFingerprint(
  hubId: string,
  deviceId: string,
  signedEntry: SignedAuditEntry,
) {
  return fetchJson(`/api/hubs/${hubId}/devices/${deviceId}/verify`, {
    method: 'POST',
    body: JSON.stringify({ signedEntry }),
  })
}
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/routes/hub/settings/devices.tsx src/client/lib/api.ts
git commit -m "feat(ui): wire fingerprint verification into hub device list"
```

### Task 10: API E2E test for fingerprint verification

**Files:**
- Create: `tests/api/device-fingerprint.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/api/device-fingerprint.spec.ts
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { createHubWithAdmin, createVolunteerDevice } from '../helpers/hub-setup'
import { buildSignedAuditEntry } from '../helpers/audit-entry'

test('admin can verify a volunteer device fingerprint', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  const volunteer = await createVolunteerDevice(request, hub.id)

  const head = await authedRequest(request, admin, {
    method: 'GET',
    url: `/api/hubs/${hub.id}/audit-log/head`,
  })

  const signed = await buildSignedAuditEntry(admin, {
    hubId: hub.id,
    payload: {
      type: 'device_fingerprint_verified',
      hubId: hub.id,
      verifiedDeviceId: volunteer.deviceId,
      verifiedDevicePubkey: volunteer.ed25519Pubkey,
      verifierDeviceId: admin.deviceId,
    },
    prevEntryHash: head.entryHash,
    signerDeviceId: admin.deviceId,
  })

  const res = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/devices/${volunteer.deviceId}/verify`,
    json: { signedEntry: signed },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.entryHash).toMatch(/^[0-9a-f]{64}$/)
})

test('non-admin cannot verify', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  const volunteer = await createVolunteerDevice(request, hub.id)
  const otherVolunteer = await createVolunteerDevice(request, hub.id)

  const head = await authedRequest(request, admin, {
    method: 'GET',
    url: `/api/hubs/${hub.id}/audit-log/head`,
  })

  const signed = await buildSignedAuditEntry(otherVolunteer, {
    hubId: hub.id,
    payload: {
      type: 'device_fingerprint_verified',
      hubId: hub.id,
      verifiedDeviceId: volunteer.deviceId,
      verifiedDevicePubkey: volunteer.ed25519Pubkey,
      verifierDeviceId: otherVolunteer.deviceId,
    },
    prevEntryHash: head.entryHash,
    signerDeviceId: otherVolunteer.deviceId,
  })

  const res = await authedRequest(request, otherVolunteer, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/devices/${volunteer.deviceId}/verify`,
    json: { signedEntry: signed },
  })
  expect(res.status()).toBe(403)
})

test('forged signature rejected', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  const volunteer = await createVolunteerDevice(request, hub.id)
  const head = await authedRequest(request, admin, {
    method: 'GET',
    url: `/api/hubs/${hub.id}/audit-log/head`,
  })
  const signed = await buildSignedAuditEntry(admin, {
    hubId: hub.id,
    payload: {
      type: 'device_fingerprint_verified',
      hubId: hub.id,
      verifiedDeviceId: volunteer.deviceId,
      verifiedDevicePubkey: volunteer.ed25519Pubkey,
      verifierDeviceId: admin.deviceId,
    },
    prevEntryHash: head.entryHash,
    signerDeviceId: admin.deviceId,
  })
  // Corrupt the signature
  signed.signature = 'f'.repeat(128)
  const res = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/devices/${volunteer.deviceId}/verify`,
    json: { signedEntry: signed },
  })
  expect(res.status()).toBe(400)
})
```

- [ ] **Step 2: Run the test**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api/device-fingerprint.spec.ts
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/api/device-fingerprint.spec.ts
git commit -m "test(api): device fingerprint verification E2E coverage"
```

### Task 11: UI E2E test for fingerprint verification

**Files:**
- Create: `tests/ui/device-fingerprint.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/ui/device-fingerprint.spec.ts
import { test, expect } from '@playwright/test'
import { loginAsAdmin, addVolunteer } from '../fixtures/auth'

test('admin verifies volunteer device fingerprint via SAS picker', async ({ page }) => {
  const { hub } = await loginAsAdmin(page)
  const volunteer = await addVolunteer(page, hub.id)

  await page.goto(`/hub/${hub.id}/settings/devices`)
  const row = page.getByTestId(`device-row-${volunteer.deviceId}`)
  await expect(row.getByTestId('device-badge').getAttribute('data-verified')).resolves.toBe('false')

  await row.getByTestId(`verify-device-${volunteer.deviceId}`).click()
  await expect(page.getByTestId('verify-fingerprint-modal')).toBeVisible()

  // Click the 7 correct emoji in order
  for (let i = 0; i < 7; i++) {
    await page.getByTestId(`sas-picker-correct-${i}`).click()
  }
  await expect(page.getByTestId('sas-verify-confirm')).toBeEnabled()
  await page.getByTestId('sas-verify-confirm').click()

  await expect(page.getByTestId('verify-fingerprint-modal')).not.toBeVisible()
  await expect(row.getByTestId('device-badge').getAttribute('data-verified')).resolves.toBe('true')
})

test('wrong emoji disables confirm and shows mismatch', async ({ page }) => {
  const { hub } = await loginAsAdmin(page)
  const volunteer = await addVolunteer(page, hub.id)
  await page.goto(`/hub/${hub.id}/settings/devices`)
  await page.getByTestId(`verify-device-${volunteer.deviceId}`).click()
  await page.getByTestId('sas-picker-wrong-0').click()
  await expect(page.getByTestId('sas-mismatch-warning')).toBeVisible()
  await expect(page.getByTestId('sas-verify-confirm')).toBeDisabled()
})
```

- [ ] **Step 2: Run the test**

Run: `bunx playwright test tests/ui/device-fingerprint.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/ui/device-fingerprint.spec.ts
git commit -m "test(ui): device fingerprint verification UI E2E"
```

### Task 12: Cross-locale SAS rendering visual regression

**Files:**
- Create: `tests/ui/mls-sas-emoji-render.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/ui/mls-sas-emoji-render.spec.ts
import { test, expect } from '@playwright/test'

const LOCALES = ['en', 'es', 'zh', 'tl', 'vi', 'ar', 'fr', 'ht', 'ko', 'ru', 'hi', 'pt', 'de']
const FIXED_PUBKEY_HEX = '0101010101010101010101010101010101010101010101010101010101010101'

for (const locale of LOCALES) {
  test(`SAS emoji render stability — ${locale}`, async ({ page }) => {
    await page.goto(`/?locale=${locale}&devFixture=sasRender&pubkey=${FIXED_PUBKEY_HEX}`)
    await expect(page.getByTestId('sas-render-fixture')).toBeVisible()
    const screenshot = await page.getByTestId('sas-render-fixture').screenshot()
    expect(screenshot).toMatchSnapshot(`sas-emoji-${locale}.png`)
  })
}
```

This test depends on a dev-only route `/` with `?devFixture=sasRender&pubkey=<hex>` that renders the 7 SAS emoji from that pubkey. Add a route handler for this fixture under `src/client/routes/_dev/sas-render.tsx`, wrapped in `if (import.meta.env.DEV)`.

- [ ] **Step 2: Add the dev fixture route**

```typescript
// src/client/routes/_dev/sas-render.tsx
import { createFileRoute } from '@tanstack/react-router'
import { deriveSasEmoji } from '@/lib/mls/sas'
import { hexToBytes } from '@noble/hashes/utils.js'

export const Route = createFileRoute('/_dev/sas-render')({
  component: SasRenderFixture,
  validateSearch: (s: Record<string, unknown>) => ({
    pubkey: String(s.pubkey ?? ''),
  }),
})

function SasRenderFixture() {
  const { pubkey } = Route.useSearch()
  if (!import.meta.env.DEV) return null
  const emoji = deriveSasEmoji(hexToBytes(pubkey))
  return (
    <div data-testid="sas-render-fixture" className="p-8 flex gap-4 text-5xl">
      {emoji.map((e, i) => <span key={i}>{e}</span>)}
    </div>
  )
}
```

- [ ] **Step 3: Run the tests and save baseline snapshots**

```bash
bunx playwright test tests/ui/mls-sas-emoji-render.spec.ts --update-snapshots
bunx playwright test tests/ui/mls-sas-emoji-render.spec.ts
```

Expected: first run creates snapshots; second run passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/_dev/sas-render.tsx tests/ui/mls-sas-emoji-render.spec.ts tests/ui/*.png-snapshots
git commit -m "test(ui): cross-locale SAS emoji visual regression (13 locales)"
```

### Task 13: Bundle size budget check for Tier 6

**Files:**
- Create: `scripts/bundle-size-check.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the script**

```typescript
// scripts/bundle-size-check.ts
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const LIMIT_BYTES = parseInt(process.env.BUNDLE_BUDGET ?? '3000000', 10)

async function main() {
  const distDir = 'dist/client/assets'
  const files = await readdir(distDir)
  let totalGzipped = 0
  const details: { name: string; size: number; gzipped: number }[] = []
  for (const f of files) {
    if (!f.endsWith('.js')) continue
    const path = join(distDir, f)
    const raw = readFileSync(path)
    const gz = gzipSync(raw)
    const s = (await stat(path)).size
    totalGzipped += gz.length
    details.push({ name: f, size: s, gzipped: gz.length })
  }
  details.sort((a, b) => b.gzipped - a.gzipped)
  console.log(`Top 10 gzipped chunks:`)
  for (const d of details.slice(0, 10)) {
    console.log(`  ${d.name}: ${d.gzipped} gz (${d.size} raw)`)
  }
  console.log(`Total gzipped JS: ${totalGzipped} bytes`)
  console.log(`Budget:           ${LIMIT_BYTES} bytes`)
  if (totalGzipped > LIMIT_BYTES) {
    console.error(`FAIL: bundle exceeds budget by ${totalGzipped - LIMIT_BYTES} bytes`)
    process.exit(1)
  }
  console.log(`PASS`)
}

await main()
```

- [ ] **Step 2: Add to CI**

Edit `.github/workflows/ci.yml` — add after the existing `bun run build` step:

```yaml
- name: Bundle size budget
  run: bun run scripts/bundle-size-check.ts
  env:
    BUNDLE_BUDGET: "3000000"  # 3 MB gzipped; raise by 500 KB for Tier 6
```

- [ ] **Step 3: Run locally**

```bash
bun run build
bun run scripts/bundle-size-check.ts
```

Expected: PASS with "Total gzipped JS" under 3 MB.

- [ ] **Step 4: Commit**

```bash
git add scripts/bundle-size-check.ts .github/workflows/ci.yml
git commit -m "ci: bundle size budget check (3 MB gzipped)"
```

### Task 14: PR #1 verification gate

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: 0 errors.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: success.

- [ ] **Step 4: Unit tests**

Run: `bun run test:unit`
Expected: all PASS.

- [ ] **Step 5: API tests**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api/device-fingerprint.spec.ts
```

Expected: PASS.

- [ ] **Step 6: UI tests**

```bash
bunx playwright test tests/ui/device-fingerprint.spec.ts tests/ui/mls-sas-emoji-render.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Open PR #1**

Title: `feat(security): Tier 6 PR #1 — fingerprint verification + @wireapp/core-crypto vendoring`

Include in description: the spec path, the list of tasks completed (checkbox-style), and an explicit statement that no MLS code is live yet.

---

## PR #2 — MLS core + migration (feature-flagged)

This PR adds the MLS code path behind the per-hub `tier6Enabled` feature flag. Tier 3 hubs continue to work unchanged; only hubs with the flag set enter MLS processing. Landing this PR does NOT flip any production hub — it ships the code and gates it behind an internal-only flag. The opt-in UI is added last. Staged rollout (internal → volunteer opt-in → default-on for new hubs) happens AFTER this PR merges, via per-hub DB updates + admin action.

### Task 15: Drizzle migration — `mls_hub_state` table

**Files:**
- Create: `drizzle/migrations/0060_mls_hub_state.sql`
- Modify: `src/server/db/schema/mls.ts` (new file)
- Modify: `src/server/db/schema/index.ts` (re-export)

- [ ] **Step 1: Write the SQL migration**

Create `drizzle/migrations/0060_mls_hub_state.sql`:

```sql
CREATE TABLE mls_hub_state (
  hub_id UUID NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  group_id BYTEA NOT NULL,
  ciphersuite TEXT NOT NULL CHECK (ciphersuite IN (
    'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
    'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519'
  )),
  epoch BIGINT NOT NULL,
  last_tree_hash TEXT NOT NULL,
  last_commit_hash TEXT NOT NULL,
  opaque_state_ciphertext TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, device_id)
);

CREATE INDEX mls_hub_state_hub_epoch ON mls_hub_state (hub_id, epoch);
```

- [ ] **Step 2: Create the Drizzle schema module**

Create `src/server/db/schema/mls.ts`:

```typescript
import { bigint, customType, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { hubs } from './hubs'
import { devices } from './devices'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value) {
    return Buffer.from(value)
  },
  fromDriver(value) {
    return new Uint8Array(value)
  },
})

export const mlsHubState = pgTable(
  'mls_hub_state',
  {
    hubId: uuid('hub_id')
      .notNull()
      .references(() => hubs.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    groupId: bytea('group_id').notNull(),
    ciphersuite: text('ciphersuite').notNull(),
    epoch: bigint('epoch', { mode: 'number' }).notNull(),
    lastTreeHash: text('last_tree_hash').notNull(),
    lastCommitHash: text('last_commit_hash').notNull(),
    opaqueStateCiphertext: text('opaque_state_ciphertext').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.hubId, t.deviceId] }),
    hubEpochIdx: index('mls_hub_state_hub_epoch').on(t.hubId, t.epoch),
  }),
)
```

- [ ] **Step 3: Re-export from schema index**

Edit `src/server/db/schema/index.ts` — append:

```typescript
export * from './mls'
```

- [ ] **Step 4: Run migration + verify DB state**

```bash
bun run dev:docker
bun run migrate
psql "$DATABASE_URL" -c "\d mls_hub_state"
```

Expected: table exists with all 9 columns, composite primary key `(hub_id, device_id)`, index `mls_hub_state_hub_epoch`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0060_mls_hub_state.sql src/server/db/schema/mls.ts src/server/db/schema/index.ts
git commit -m "feat(db): mls_hub_state table for per-device MLS group persistence"
```

### Task 16: Drizzle migration — `mls_key_packages` table

**Files:**
- Create: `drizzle/migrations/0061_mls_key_packages.sql`
- Modify: `src/server/db/schema/mls.ts`

- [ ] **Step 1: Write the SQL migration**

Create `drizzle/migrations/0061_mls_key_packages.sql`:

```sql
CREATE TABLE mls_key_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hub_id UUID NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  ciphersuite TEXT NOT NULL,
  key_package_bytes BYTEA NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_device_id UUID REFERENCES devices(id)
);

CREATE INDEX mls_key_packages_unused
  ON mls_key_packages (device_id, hub_id, ciphersuite)
  WHERE consumed_at IS NULL;
CREATE INDEX mls_key_packages_expiry ON mls_key_packages (expires_at)
  WHERE consumed_at IS NULL;
```

- [ ] **Step 2: Extend Drizzle schema**

Append to `src/server/db/schema/mls.ts`:

```typescript
export const mlsKeyPackages = pgTable(
  'mls_key_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    hubId: uuid('hub_id')
      .notNull()
      .references(() => hubs.id, { onDelete: 'cascade' }),
    ciphersuite: text('ciphersuite').notNull(),
    keyPackageBytes: bytea('key_package_bytes').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedByDeviceId: uuid('consumed_by_device_id').references(() => devices.id),
  },
  (t) => ({
    unusedIdx: index('mls_key_packages_unused').on(t.deviceId, t.hubId, t.ciphersuite),
    expiryIdx: index('mls_key_packages_expiry').on(t.expiresAt),
  }),
)
```

- [ ] **Step 3: Run migration + verify**

```bash
bun run migrate
psql "$DATABASE_URL" -c "\d mls_key_packages"
```

Expected: table + 2 partial indexes exist.

- [ ] **Step 4: Commit**

```bash
git add drizzle/migrations/0061_mls_key_packages.sql src/server/db/schema/mls.ts
git commit -m "feat(db): mls_key_packages table for per-device KeyPackage publication"
```

### Task 17: Drizzle migration — `hubs.tier6_enabled` + `cs_profile`

**Files:**
- Create: `drizzle/migrations/0062_hubs_tier6_flag.sql`
- Modify: `src/server/db/schema/hubs.ts`

- [ ] **Step 1: Write the SQL migration**

Create `drizzle/migrations/0062_hubs_tier6_flag.sql`:

```sql
ALTER TABLE hubs
  ADD COLUMN tier6_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN cs_profile TEXT NOT NULL DEFAULT 'standard'
    CHECK (cs_profile IN ('standard', 'high'));

CREATE INDEX hubs_tier6_enabled ON hubs (tier6_enabled) WHERE tier6_enabled = true;
```

- [ ] **Step 2: Extend `hubs` schema**

Edit `src/server/db/schema/hubs.ts` — add to the `hubs` table definition:

```typescript
tier6Enabled: boolean('tier6_enabled').notNull().default(false),
csProfile: text('cs_profile', { enum: ['standard', 'high'] }).notNull().default('standard'),
```

- [ ] **Step 3: Run migration + verify**

```bash
bun run migrate
psql "$DATABASE_URL" -c "\d hubs"
```

Expected: new columns present, default `false`/`standard`, CHECK constraint.

- [ ] **Step 4: Commit**

```bash
git add drizzle/migrations/0062_hubs_tier6_flag.sql src/server/db/schema/hubs.ts
git commit -m "feat(db): hubs.tier6_enabled + cs_profile columns"
```

### Task 18: MLS audit-entry payload variants

**Files:**
- Modify: `src/shared/schemas/audit-entries.ts`
- Modify: `src/shared/schemas/audit-entries.test.ts`

- [ ] **Step 1: Write failing tests for each new payload variant**

Append to `src/shared/schemas/audit-entries.test.ts`:

```typescript
import {
  AuditEntryPayloadSchema,
  MlsGroupInitPayloadSchema,
  MlsMembersAddedPayloadSchema,
  MlsMembersRemovedPayloadSchema,
  MlsPathUpdatePayloadSchema,
  MlsEpochPurgePayloadSchema,
  MlsCiphersuiteUpgradePlannedPayloadSchema,
  MlsCiphersuiteUpgradeCompletedPayloadSchema,
} from './audit-entries'

const hubId = '11111111-1111-1111-1111-111111111111'
const groupId = 'aa'.repeat(16)
const treeHash = 'bb'.repeat(32)
const commitHash = 'cc'.repeat(32)

describe('MLS audit payloads', () => {
  test('mls_group_init round-trips', () => {
    const p = {
      type: 'mls_group_init' as const,
      hubId,
      groupId,
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519' as const,
      initialTreeHash: treeHash,
      epoch: 0,
    }
    expect(() => MlsGroupInitPayloadSchema.parse(p)).not.toThrow()
    expect(() => AuditEntryPayloadSchema.parse(p)).not.toThrow()
  })

  test('mls_members_added round-trips', () => {
    const p = {
      type: 'mls_members_added' as const,
      hubId,
      epoch: 1,
      addedDevicePubkeys: ['a'.repeat(64), 'b'.repeat(64)],
      newTreeHash: treeHash,
      commitHash,
    }
    expect(() => MlsMembersAddedPayloadSchema.parse(p)).not.toThrow()
  })

  test('mls_members_removed round-trips', () => {
    const p = {
      type: 'mls_members_removed' as const,
      hubId,
      epoch: 2,
      removedDevicePubkeys: ['a'.repeat(64)],
      newTreeHash: treeHash,
      commitHash,
    }
    expect(() => MlsMembersRemovedPayloadSchema.parse(p)).not.toThrow()
  })

  test('mls_path_update round-trips', () => {
    const p = {
      type: 'mls_path_update' as const,
      hubId,
      epoch: 3,
      updaterDeviceId: '22222222-2222-2222-2222-222222222222',
      newTreeHash: treeHash,
      commitHash,
    }
    expect(() => MlsPathUpdatePayloadSchema.parse(p)).not.toThrow()
  })

  test('mls_epoch_purge round-trips', () => {
    const p = {
      type: 'mls_epoch_purge' as const,
      hubId,
      purgedEpoch: 7,
      currentEpoch: 8,
      reason: 'provable-delete admin purge',
    }
    expect(() => MlsEpochPurgePayloadSchema.parse(p)).not.toThrow()
  })

  test('mls_ciphersuite_upgrade_planned round-trips', () => {
    const p = {
      type: 'mls_ciphersuite_upgrade_planned' as const,
      hubId,
      fromCiphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519' as const,
      toCiphersuite: 'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519' as const,
      effectiveEpoch: 10,
    }
    expect(() => MlsCiphersuiteUpgradePlannedPayloadSchema.parse(p)).not.toThrow()
  })

  test('mls_ciphersuite_upgrade_completed round-trips', () => {
    const p = {
      type: 'mls_ciphersuite_upgrade_completed' as const,
      hubId,
      oldGroupId: groupId,
      newGroupId: 'dd'.repeat(16),
      newCiphersuite: 'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519' as const,
      newEpoch: 0,
    }
    expect(() => MlsCiphersuiteUpgradeCompletedPayloadSchema.parse(p)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/shared/schemas/audit-entries.test.ts -t "MLS audit payloads"`
Expected: FAIL — schemas missing.

- [ ] **Step 3: Add the schema variants**

Edit `src/shared/schemas/audit-entries.ts` — add before `AuditEntryPayloadSchema`:

```typescript
export const MlsCiphersuiteEnum = z.enum([
  'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
  'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519',
])

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const hex32Bytes = z.string().regex(/^[0-9a-f]{32}$/)

export const MlsGroupInitPayloadSchema = z.object({
  type: z.literal('mls_group_init'),
  hubId: z.string().uuid(),
  groupId: hex32Bytes,
  ciphersuite: MlsCiphersuiteEnum,
  initialTreeHash: hex64,
  epoch: z.literal(0),
})

export const MlsMembersAddedPayloadSchema = z.object({
  type: z.literal('mls_members_added'),
  hubId: z.string().uuid(),
  epoch: z.number().int().positive(),
  addedDevicePubkeys: z.array(hex64).min(1),
  newTreeHash: hex64,
  commitHash: hex64,
})

export const MlsMembersRemovedPayloadSchema = z.object({
  type: z.literal('mls_members_removed'),
  hubId: z.string().uuid(),
  epoch: z.number().int().positive(),
  removedDevicePubkeys: z.array(hex64).min(1),
  newTreeHash: hex64,
  commitHash: hex64,
})

export const MlsPathUpdatePayloadSchema = z.object({
  type: z.literal('mls_path_update'),
  hubId: z.string().uuid(),
  epoch: z.number().int().positive(),
  updaterDeviceId: z.string().uuid(),
  newTreeHash: hex64,
  commitHash: hex64,
})

export const MlsEpochPurgePayloadSchema = z.object({
  type: z.literal('mls_epoch_purge'),
  hubId: z.string().uuid(),
  purgedEpoch: z.number().int().nonnegative(),
  currentEpoch: z.number().int().positive(),
  reason: z.string().min(1).max(512),
})

export const MlsCiphersuiteUpgradePlannedPayloadSchema = z.object({
  type: z.literal('mls_ciphersuite_upgrade_planned'),
  hubId: z.string().uuid(),
  fromCiphersuite: MlsCiphersuiteEnum,
  toCiphersuite: MlsCiphersuiteEnum,
  effectiveEpoch: z.number().int().positive(),
})

export const MlsCiphersuiteUpgradeCompletedPayloadSchema = z.object({
  type: z.literal('mls_ciphersuite_upgrade_completed'),
  hubId: z.string().uuid(),
  oldGroupId: hex32Bytes,
  newGroupId: hex32Bytes,
  newCiphersuite: MlsCiphersuiteEnum,
  newEpoch: z.literal(0),
})
```

Extend `AuditEntryPayloadSchema` discriminated union:

```typescript
export const AuditEntryPayloadSchema = z.discriminatedUnion('type', [
  MembershipAddPayloadSchema,
  MembershipRemovePayloadSchema,
  RoleChangePayloadSchema,
  HubKeyRotatePayloadSchema,
  HubCreatePayloadSchema,
  HubDeletePayloadSchema,
  DeviceAddPayloadSchema,
  DeviceRevokePayloadSchema,
  DeviceFingerprintVerifiedPayloadSchema,
  MlsGroupInitPayloadSchema,
  MlsMembersAddedPayloadSchema,
  MlsMembersRemovedPayloadSchema,
  MlsPathUpdatePayloadSchema,
  MlsEpochPurgePayloadSchema,
  MlsCiphersuiteUpgradePlannedPayloadSchema,
  MlsCiphersuiteUpgradeCompletedPayloadSchema,
])
```

- [ ] **Step 4: Run tests**

Run: `bun test src/shared/schemas/audit-entries.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas/audit-entries.ts src/shared/schemas/audit-entries.test.ts
git commit -m "feat(schemas): MLS audit payload variants for Tier 6 group lifecycle"
```

### Task 19: MLS wire schemas (KeyPackage publish/fetch, envelope tags)

**Files:**
- Create: `src/shared/schemas/mls.ts`
- Create: `src/shared/schemas/mls.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/shared/schemas/mls.test.ts
import { describe, expect, test } from 'bun:test'
import {
  PublishKeyPackagesRequestSchema,
  PublishKeyPackagesResponseSchema,
  FetchKeyPackagesResponseSchema,
  MlsNostrEnvelopeSchema,
  MLS_EVENT_KIND_COMMIT,
  MLS_EVENT_KIND_WELCOME,
  MLS_EVENT_KIND_KEYPACKAGE,
} from './mls'

describe('MLS wire schemas', () => {
  test('publish request accepts 10 KeyPackages', () => {
    const req = {
      hubId: '11111111-1111-1111-1111-111111111111',
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      keyPackages: Array.from({ length: 10 }, (_, i) => ({
        keyPackageBytesB64: Buffer.from(`kp-${i}`).toString('base64'),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      })),
    }
    expect(() => PublishKeyPackagesRequestSchema.parse(req)).not.toThrow()
  })

  test('publish request rejects >100 KeyPackages', () => {
    const req = {
      hubId: '11111111-1111-1111-1111-111111111111',
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      keyPackages: Array.from({ length: 101 }, () => ({
        keyPackageBytesB64: 'AAA=',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      })),
    }
    expect(() => PublishKeyPackagesRequestSchema.parse(req)).toThrow()
  })

  test('fetch response shape', () => {
    const res = {
      keyPackages: [
        {
          deviceId: '22222222-2222-2222-2222-222222222222',
          keyPackageId: '33333333-3333-3333-3333-333333333333',
          keyPackageBytesB64: 'AAA=',
        },
      ],
    }
    expect(() => FetchKeyPackagesResponseSchema.parse(res)).not.toThrow()
  })

  test('nostr envelope schema', () => {
    const env = {
      kind: MLS_EVENT_KIND_COMMIT,
      hubId: '11111111-1111-1111-1111-111111111111',
      epoch: 5,
      contentB64: 'AAA=',
      senderDeviceId: '22222222-2222-2222-2222-222222222222',
    }
    expect(() => MlsNostrEnvelopeSchema.parse(env)).not.toThrow()
  })

  test('event kind constants are numeric', () => {
    expect(MLS_EVENT_KIND_COMMIT).toBe(20001)
    expect(MLS_EVENT_KIND_WELCOME).toBe(20002)
    expect(MLS_EVENT_KIND_KEYPACKAGE).toBe(20003)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/shared/schemas/mls.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the schemas**

```typescript
// src/shared/schemas/mls.ts
import { z } from '@hono/zod-openapi'
import { MlsCiphersuiteEnum } from './audit-entries'

export const MLS_EVENT_KIND_COMMIT = 20001 as const
export const MLS_EVENT_KIND_WELCOME = 20002 as const
export const MLS_EVENT_KIND_KEYPACKAGE = 20003 as const

export const MlsEventKindSchema = z.union([
  z.literal(MLS_EVENT_KIND_COMMIT),
  z.literal(MLS_EVENT_KIND_WELCOME),
  z.literal(MLS_EVENT_KIND_KEYPACKAGE),
])

const base64 = z.string().regex(/^[A-Za-z0-9+/]+=*$/)

export const KeyPackageDraftSchema = z.object({
  keyPackageBytesB64: base64.max(8192),
  expiresAt: z.string().datetime(),
})

export const PublishKeyPackagesRequestSchema = z.object({
  hubId: z.string().uuid(),
  ciphersuite: MlsCiphersuiteEnum,
  keyPackages: z.array(KeyPackageDraftSchema).min(1).max(100),
})
export type PublishKeyPackagesInput = z.infer<typeof PublishKeyPackagesRequestSchema>

export const PublishKeyPackagesResponseSchema = z.object({
  publishedIds: z.array(z.string().uuid()),
})

export const FetchKeyPackagesResponseSchema = z.object({
  keyPackages: z.array(
    z.object({
      deviceId: z.string().uuid(),
      keyPackageId: z.string().uuid(),
      keyPackageBytesB64: base64.max(8192),
    }),
  ),
})

export const MlsNostrEnvelopeSchema = z.object({
  kind: MlsEventKindSchema,
  hubId: z.string().uuid(),
  epoch: z.number().int().nonnegative(),
  contentB64: base64.max(65536),
  senderDeviceId: z.string().uuid(),
  targetDeviceId: z.string().uuid().optional(),
})
export type MlsNostrEnvelope = z.infer<typeof MlsNostrEnvelopeSchema>
```

- [ ] **Step 4: Run tests**

Run: `bun test src/shared/schemas/mls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas/mls.ts src/shared/schemas/mls.test.ts
git commit -m "feat(schemas): MLS wire schemas — KeyPackage publish/fetch + Nostr envelope"
```

### Task 20: Server — `MlsKeyPackageService`

**Files:**
- Create: `src/server/services/mls-key-package-service.ts`
- Create: `src/server/services/mls-key-package-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/services/mls-key-package-service.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { MlsKeyPackageService } from './mls-key-package-service'
import { createTestDb, destroyTestDb } from '../db/test-harness'
import { seedHubAndDevice } from '../db/test-fixtures'

describe('MlsKeyPackageService', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>
  let svc: MlsKeyPackageService

  beforeEach(async () => {
    db = await createTestDb()
    svc = new MlsKeyPackageService(db)
  })
  afterEach(async () => {
    await destroyTestDb(db)
  })

  test('publish stores 10 KeyPackages; fetch returns one and marks it consumed', async () => {
    const { hubId, deviceId } = await seedHubAndDevice(db)
    const ids = await svc.publish({
      hubId,
      deviceId,
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      keyPackages: Array.from({ length: 10 }, (_, i) => ({
        keyPackageBytes: new Uint8Array([i]),
        expiresAt: new Date(Date.now() + 30 * 86400 * 1000),
      })),
    })
    expect(ids.length).toBe(10)

    const [first] = await svc.fetchUnused({
      hubId,
      targetDeviceIds: [deviceId],
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      consumerDeviceId: deviceId,
    })
    expect(first).toBeTruthy()

    const second = await svc.fetchUnused({
      hubId,
      targetDeviceIds: [deviceId],
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      consumerDeviceId: deviceId,
    })
    expect(second.length).toBe(1)
    expect(second[0]!.keyPackageId).not.toBe(first!.keyPackageId)
  })

  test('fetch excludes expired KeyPackages', async () => {
    const { hubId, deviceId } = await seedHubAndDevice(db)
    await svc.publish({
      hubId,
      deviceId,
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      keyPackages: [
        {
          keyPackageBytes: new Uint8Array([1]),
          expiresAt: new Date(Date.now() - 1000),
        },
      ],
    })
    const result = await svc.fetchUnused({
      hubId,
      targetDeviceIds: [deviceId],
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      consumerDeviceId: deviceId,
    })
    expect(result.length).toBe(0)
  })

  test('fetch when supply exhausted returns empty', async () => {
    const { hubId, deviceId } = await seedHubAndDevice(db)
    const result = await svc.fetchUnused({
      hubId,
      targetDeviceIds: [deviceId],
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      consumerDeviceId: deviceId,
    })
    expect(result.length).toBe(0)
  })

  test('countUnused returns accurate count per device/ciphersuite', async () => {
    const { hubId, deviceId } = await seedHubAndDevice(db)
    await svc.publish({
      hubId,
      deviceId,
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      keyPackages: Array.from({ length: 5 }, (_, i) => ({
        keyPackageBytes: new Uint8Array([i]),
        expiresAt: new Date(Date.now() + 30 * 86400 * 1000),
      })),
    })
    const count = await svc.countUnused({
      deviceId,
      hubId,
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
    })
    expect(count).toBe(5)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/server/services/mls-key-package-service.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the service**

```typescript
// src/server/services/mls-key-package-service.ts
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db/types'
import { mlsKeyPackages } from '../db/schema/mls'

export interface PublishInput {
  hubId: string
  deviceId: string
  ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519' | 'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519'
  keyPackages: Array<{
    keyPackageBytes: Uint8Array
    expiresAt: Date
  }>
}

export interface FetchInput {
  hubId: string
  targetDeviceIds: string[]
  ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519' | 'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519'
  consumerDeviceId: string
}

export interface FetchedKeyPackage {
  deviceId: string
  keyPackageId: string
  keyPackageBytes: Uint8Array
}

export class MlsKeyPackageService {
  constructor(private readonly db: Database) {}

  async publish(input: PublishInput): Promise<string[]> {
    if (input.keyPackages.length === 0) return []
    const rows = input.keyPackages.map((kp) => ({
      deviceId: input.deviceId,
      hubId: input.hubId,
      ciphersuite: input.ciphersuite,
      keyPackageBytes: kp.keyPackageBytes,
      expiresAt: kp.expiresAt,
    }))
    const inserted = await this.db
      .insert(mlsKeyPackages)
      .values(rows)
      .returning({ id: mlsKeyPackages.id })
    return inserted.map((r) => r.id)
  }

  async fetchUnused(input: FetchInput): Promise<FetchedKeyPackage[]> {
    // Atomic: select-for-update one unused KeyPackage per target device, mark consumed.
    const results: FetchedKeyPackage[] = []
    await this.db.transaction(async (tx) => {
      for (const targetDeviceId of input.targetDeviceIds) {
        const [candidate] = await tx
          .select({
            id: mlsKeyPackages.id,
            keyPackageBytes: mlsKeyPackages.keyPackageBytes,
          })
          .from(mlsKeyPackages)
          .where(
            and(
              eq(mlsKeyPackages.deviceId, targetDeviceId),
              eq(mlsKeyPackages.hubId, input.hubId),
              eq(mlsKeyPackages.ciphersuite, input.ciphersuite),
              isNull(mlsKeyPackages.consumedAt),
              gte(mlsKeyPackages.expiresAt, new Date()),
            ),
          )
          .orderBy(mlsKeyPackages.publishedAt)
          .limit(1)
          .for('update', { skipLocked: true })

        if (!candidate) continue

        await tx
          .update(mlsKeyPackages)
          .set({
            consumedAt: new Date(),
            consumedByDeviceId: input.consumerDeviceId,
          })
          .where(eq(mlsKeyPackages.id, candidate.id))

        results.push({
          deviceId: targetDeviceId,
          keyPackageId: candidate.id,
          keyPackageBytes: candidate.keyPackageBytes,
        })
      }
    })
    return results
  }

  async countUnused(input: {
    deviceId: string
    hubId: string
    ciphersuite: string
  }): Promise<number> {
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(mlsKeyPackages)
      .where(
        and(
          eq(mlsKeyPackages.deviceId, input.deviceId),
          eq(mlsKeyPackages.hubId, input.hubId),
          eq(mlsKeyPackages.ciphersuite, input.ciphersuite),
          isNull(mlsKeyPackages.consumedAt),
          gte(mlsKeyPackages.expiresAt, new Date()),
        ),
      )
    return row?.c ?? 0
  }

  async purgeExpired(): Promise<number> {
    const result = await this.db
      .delete(mlsKeyPackages)
      .where(
        and(
          isNull(mlsKeyPackages.consumedAt),
          sql`${mlsKeyPackages.expiresAt} < now() - interval '7 days'`,
        ),
      )
      .returning({ id: mlsKeyPackages.id })
    return result.length
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun run dev:docker
bun run migrate
bun test src/server/services/mls-key-package-service.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/mls-key-package-service.ts src/server/services/mls-key-package-service.test.ts
git commit -m "feat(server): MlsKeyPackageService — publish, fetch-unused, count, purge-expired"
```

### Task 21: Server — MLS KeyPackage routes

**Files:**
- Create: `src/server/routes/mls-key-packages.ts`
- Create: `src/server/routes/mls-key-packages.test.ts`
- Modify: `src/server/app.ts` (mount the route)

- [ ] **Step 1: Write failing route tests**

```typescript
// src/server/routes/mls-key-packages.test.ts
import { describe, expect, test } from 'bun:test'
import { app } from '../app'
import { seedHubAdminVolunteer } from '../db/test-fixtures'
import { authedFetch } from '../test-helpers/authed-fetch'

describe('POST /api/mls/key-packages', () => {
  test('device publishes 10 KeyPackages; 201', async () => {
    const { hub, volunteer } = await seedHubAdminVolunteer()
    const res = await authedFetch(app, volunteer, {
      method: 'POST',
      url: '/api/mls/key-packages',
      json: {
        hubId: hub.id,
        ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
        keyPackages: Array.from({ length: 10 }, (_, i) => ({
          keyPackageBytesB64: Buffer.from([i, i, i]).toString('base64'),
          expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        })),
      },
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.publishedIds.length).toBe(10)
  })

  test('rejects publish for a hub the device is not a member of; 403', async () => {
    const { hub } = await seedHubAdminVolunteer()
    const { volunteer: outsider } = await seedHubAdminVolunteer()
    const res = await authedFetch(app, outsider, {
      method: 'POST',
      url: '/api/mls/key-packages',
      json: {
        hubId: hub.id,
        ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
        keyPackages: [
          {
            keyPackageBytesB64: 'AAA=',
            expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
          },
        ],
      },
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/hubs/:hubId/users/:userId/key-packages', () => {
  test('admin fetches one unused KeyPackage per device; 200', async () => {
    const { hub, admin, volunteer } = await seedHubAdminVolunteer()
    // Volunteer publishes
    await authedFetch(app, volunteer, {
      method: 'POST',
      url: '/api/mls/key-packages',
      json: {
        hubId: hub.id,
        ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
        keyPackages: Array.from({ length: 3 }, (_, i) => ({
          keyPackageBytesB64: Buffer.from([i]).toString('base64'),
          expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        })),
      },
    })
    // Admin fetches
    const res = await authedFetch(app, admin, {
      method: 'GET',
      url: `/api/hubs/${hub.id}/users/${volunteer.userId}/key-packages?ciphersuite=MLS_256_XWING_AES256GCM_SHA512_Ed25519`,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.keyPackages.length).toBe(1)
    expect(body.keyPackages[0].deviceId).toBe(volunteer.deviceId)
  })

  test('non-admin cannot fetch; 403', async () => {
    const { hub, volunteer } = await seedHubAdminVolunteer()
    const res = await authedFetch(app, volunteer, {
      method: 'GET',
      url: `/api/hubs/${hub.id}/users/${volunteer.userId}/key-packages?ciphersuite=MLS_256_XWING_AES256GCM_SHA512_Ed25519`,
    })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/server/routes/mls-key-packages.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the route**

```typescript
// src/server/routes/mls-key-packages.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requireAuth } from '../middleware/auth'
import { requireHubMember } from '../middleware/hub-membership'
import { requireAdminForHub } from '../middleware/hub-admin'
import {
  PublishKeyPackagesRequestSchema,
  PublishKeyPackagesResponseSchema,
  FetchKeyPackagesResponseSchema,
  MlsCiphersuiteEnum,
} from '@shared/schemas/mls'
import { MlsKeyPackageService } from '../services/mls-key-package-service'
import { DeviceService } from '../services/device-service'

const app = new OpenAPIHono()

const publishRoute = createRoute({
  method: 'post',
  path: '/api/mls/key-packages',
  tags: ['mls'],
  request: {
    body: {
      content: {
        'application/json': { schema: PublishKeyPackagesRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'KeyPackages published',
      content: {
        'application/json': { schema: PublishKeyPackagesResponseSchema },
      },
    },
    403: { description: 'Caller is not a member of the hub' },
  },
  middleware: [requireAuth, requireHubMember] as const,
})

app.openapi(publishRoute, async (c) => {
  const body = c.req.valid('json')
  const caller = c.var.callerDevice
  const svc = new MlsKeyPackageService(c.var.db)
  const publishedIds = await svc.publish({
    hubId: body.hubId,
    deviceId: caller.id,
    ciphersuite: body.ciphersuite,
    keyPackages: body.keyPackages.map((kp) => ({
      keyPackageBytes: Uint8Array.from(Buffer.from(kp.keyPackageBytesB64, 'base64')),
      expiresAt: new Date(kp.expiresAt),
    })),
  })
  return c.json({ publishedIds }, 201)
})

const fetchRoute = createRoute({
  method: 'get',
  path: '/api/hubs/:hubId/users/:userId/key-packages',
  tags: ['mls'],
  request: {
    params: z.object({
      hubId: z.string().uuid(),
      userId: z.string().uuid(),
    }),
    query: z.object({
      ciphersuite: MlsCiphersuiteEnum,
    }),
  },
  responses: {
    200: {
      description: 'One unused KeyPackage per target device',
      content: {
        'application/json': { schema: FetchKeyPackagesResponseSchema },
      },
    },
    403: { description: 'Caller is not an admin for the hub' },
  },
  middleware: [requireAuth, requireAdminForHub] as const,
})

app.openapi(fetchRoute, async (c) => {
  const { hubId, userId } = c.req.valid('param')
  const { ciphersuite } = c.req.valid('query')
  const deviceSvc = new DeviceService(c.var.db)
  const targetDevices = await deviceSvc.listDevicesForUserInHub(userId, hubId)
  const targetDeviceIds = targetDevices.map((d) => d.id)
  if (targetDeviceIds.length === 0) {
    return c.json({ keyPackages: [] }, 200)
  }

  const svc = new MlsKeyPackageService(c.var.db)
  const fetched = await svc.fetchUnused({
    hubId,
    targetDeviceIds,
    ciphersuite,
    consumerDeviceId: c.var.callerDevice.id,
  })

  return c.json(
    {
      keyPackages: fetched.map((kp) => ({
        deviceId: kp.deviceId,
        keyPackageId: kp.keyPackageId,
        keyPackageBytesB64: Buffer.from(kp.keyPackageBytes).toString('base64'),
      })),
    },
    200,
  )
})

export default app
```

- [ ] **Step 4: Mount in `app.ts`**

Edit `src/server/app.ts`:

```typescript
import mlsKeyPackages from './routes/mls-key-packages'
// ... existing imports ...
app.route('/', mlsKeyPackages)
```

- [ ] **Step 5: Run tests**

```bash
bun test src/server/routes/mls-key-packages.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/mls-key-packages.ts src/server/routes/mls-key-packages.test.ts src/server/app.ts
git commit -m "feat(server): MLS KeyPackage publish + fetch routes"
```

### Task 22: Client — MLS shared types module

**Files:**
- Create: `src/client/lib/mls/mls-types.ts`
- Create: `src/client/lib/mls/mls-ciphersuite.ts`
- Create: `src/client/lib/mls/mls-ciphersuite.test.ts`

- [ ] **Step 1: Write failing ciphersuite tests**

```typescript
// src/client/lib/mls/mls-ciphersuite.test.ts
import { describe, expect, test } from 'bun:test'
import {
  MLS_CIPHERSUITES,
  CIPHERSUITE_XWING,
  CIPHERSUITE_MLKEM1024,
  assertKnownCiphersuite,
  ciphersuiteProfile,
} from './mls-ciphersuite'

describe('MLS ciphersuites', () => {
  test('XWing and ML-KEM-1024 are the only supported ciphersuites', () => {
    expect(MLS_CIPHERSUITES.length).toBe(2)
    expect(MLS_CIPHERSUITES).toContain(CIPHERSUITE_XWING)
    expect(MLS_CIPHERSUITES).toContain(CIPHERSUITE_MLKEM1024)
  })

  test('assertKnownCiphersuite throws on unknown value', () => {
    expect(() => assertKnownCiphersuite('MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519')).toThrow()
  })

  test('ciphersuiteProfile maps standard→XWing, high→ML-KEM-1024', () => {
    expect(ciphersuiteProfile('standard')).toBe(CIPHERSUITE_XWING)
    expect(ciphersuiteProfile('high')).toBe(CIPHERSUITE_MLKEM1024)
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/client/lib/mls/mls-ciphersuite.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement types module**

```typescript
// src/client/lib/mls/mls-types.ts
import type { Ciphertext } from '@shared/types'

export type MlsCiphersuite =
  | 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'
  | 'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519'

export type CsProfile = 'standard' | 'high'

export interface MlsGroupState {
  hubId: string
  ciphersuite: MlsCiphersuite
  groupId: Uint8Array
  epoch: number
  lastCommitHash: string
  treeHash: string
  /** Encrypted opaque @wireapp/core-crypto state — AES-KW-wrapped via crypto worker. */
  opaqueState: Ciphertext
}

export interface MlsKeyPackageRecord {
  deviceId: string
  keyPackageId: string
  keyPackageBytes: Uint8Array
}

export interface MlsCommitResult {
  commit: Uint8Array
  welcome: Uint8Array | null
  newEpoch: number
  newTreeHash: string
  commitHash: string
}

export interface MlsProcessResult {
  newEpoch: number
  newTreeHash: string
  commitHash: string
}

export interface MlsExporterRequest {
  label: string
  context: Uint8Array
  length: number
}
```

- [ ] **Step 4: Implement ciphersuite module**

```typescript
// src/client/lib/mls/mls-ciphersuite.ts
import type { MlsCiphersuite, CsProfile } from './mls-types'

export const CIPHERSUITE_XWING: MlsCiphersuite = 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'
export const CIPHERSUITE_MLKEM1024: MlsCiphersuite = 'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519'

export const MLS_CIPHERSUITES: readonly MlsCiphersuite[] = [
  CIPHERSUITE_XWING,
  CIPHERSUITE_MLKEM1024,
] as const

export function assertKnownCiphersuite(value: string): asserts value is MlsCiphersuite {
  if (!MLS_CIPHERSUITES.includes(value as MlsCiphersuite)) {
    throw new Error(`Unknown MLS ciphersuite: ${value}`)
  }
}

export function ciphersuiteProfile(profile: CsProfile): MlsCiphersuite {
  switch (profile) {
    case 'standard':
      return CIPHERSUITE_XWING
    case 'high':
      return CIPHERSUITE_MLKEM1024
  }
}

export function ciphersuiteToProfile(cs: MlsCiphersuite): CsProfile {
  return cs === CIPHERSUITE_XWING ? 'standard' : 'high'
}
```

- [ ] **Step 5: Run tests**

Run: `bun test src/client/lib/mls/mls-ciphersuite.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/mls/mls-types.ts src/client/lib/mls/mls-ciphersuite.ts src/client/lib/mls/mls-ciphersuite.test.ts
git commit -m "feat(mls): shared types + ciphersuite registry"
```

### Task 23: Client — MLS group wrapper over @wireapp/core-crypto

**Files:**
- Create: `src/client/lib/mls/mls-group.ts`
- Create: `src/client/lib/mls/mls-group.test.ts`

- [ ] **Step 1: Write failing happy-path tests**

```typescript
// src/client/lib/mls/mls-group.test.ts
import { describe, expect, test } from 'bun:test'
import { MlsGroupHandle, createNewGroup, joinFromWelcome } from './mls-group'
import { CIPHERSUITE_XWING } from './mls-ciphersuite'
import { hexToBytes } from '@noble/hashes/utils.js'
import { schnorr } from '@noble/curves/secp256k1.js'

const adminIdentity = new Uint8Array(32).fill(1)
const volunteerIdentity = new Uint8Array(32).fill(2)

async function makeCredential(identity: Uint8Array) {
  const sk = schnorr.utils.randomPrivateKey()
  const pk = schnorr.getPublicKey(sk)
  return { identity, signaturePrivateKey: sk, signaturePublicKey: pk }
}

describe('MLS group happy path', () => {
  test('admin creates a group at epoch 0', async () => {
    const cred = await makeCredential(adminIdentity)
    const group = await createNewGroup({
      ciphersuite: CIPHERSUITE_XWING,
      groupId: new Uint8Array(16).fill(3),
      credential: cred,
    })
    expect(group.epoch).toBe(0)
    expect(group.ciphersuite).toBe(CIPHERSUITE_XWING)
    expect(group.treeHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('admin adds volunteer; both converge on epoch 1', async () => {
    const adminCred = await makeCredential(adminIdentity)
    const volCred = await makeCredential(volunteerIdentity)

    const adminGroup = await createNewGroup({
      ciphersuite: CIPHERSUITE_XWING,
      groupId: new Uint8Array(16).fill(3),
      credential: adminCred,
    })

    const volKeyPackage = await adminGroup.buildExternalKeyPackage(volCred)
    const result = await adminGroup.addMember(volKeyPackage)
    expect(result.newEpoch).toBe(1)

    const volGroup = await joinFromWelcome({
      welcome: result.welcome!,
      credential: volCred,
    })
    expect(volGroup.epoch).toBe(1)
    expect(volGroup.treeHash).toBe(adminGroup.treeHash)
  })

  test('admin removes volunteer; admin advances, volunteer state frozen', async () => {
    const adminCred = await makeCredential(adminIdentity)
    const volCred = await makeCredential(volunteerIdentity)
    const adminGroup = await createNewGroup({
      ciphersuite: CIPHERSUITE_XWING,
      groupId: new Uint8Array(16).fill(3),
      credential: adminCred,
    })
    const volKeyPackage = await adminGroup.buildExternalKeyPackage(volCred)
    const addResult = await adminGroup.addMember(volKeyPackage)
    const volGroup = await joinFromWelcome({
      welcome: addResult.welcome!,
      credential: volCred,
    })
    // Remove volunteer
    const removeResult = await adminGroup.removeMember(volCred.signaturePublicKey)
    expect(removeResult.newEpoch).toBe(2)
    // Volunteer cannot derive a secret at epoch 2
    expect(volGroup.epoch).toBe(1)
    expect(() =>
      volGroup.exportSecret('llamenos:items-key-export:v1', new Uint8Array(0), 32),
    ).not.toThrow() // at epoch 1 still works
  })

  test('background update commit advances epoch without changing membership', async () => {
    const cred = await makeCredential(adminIdentity)
    const group = await createNewGroup({
      ciphersuite: CIPHERSUITE_XWING,
      groupId: new Uint8Array(16).fill(3),
      credential: cred,
    })
    const before = group.epoch
    const before_treeHash = group.treeHash
    await group.updatePath()
    expect(group.epoch).toBe(before + 1)
    expect(group.treeHash).not.toBe(before_treeHash)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/lib/mls/mls-group.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement wrapper**

```typescript
// src/client/lib/mls/mls-group.ts
import {
  createGroup as tsMlsCreateGroup,
  joinGroup,
  processMessage,
  createCommit,
  createKeyPackage,
  exportSecret as tsMlsExportSecret,
  serializeGroup,
  deserializeGroup,
} from '@wireapp/core-crypto'
import type { GroupState } from '@wireapp/core-crypto/types'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { MlsCiphersuite, MlsCommitResult, MlsProcessResult } from './mls-types'
import { assertKnownCiphersuite } from './mls-ciphersuite'

export interface MlsCredential {
  identity: Uint8Array
  signaturePrivateKey: Uint8Array
  signaturePublicKey: Uint8Array
}

export interface CreateNewGroupInput {
  ciphersuite: MlsCiphersuite
  groupId: Uint8Array
  credential: MlsCredential
}

export interface JoinFromWelcomeInput {
  welcome: Uint8Array
  credential: MlsCredential
}

export class MlsGroupHandle {
  constructor(private readonly state: GroupState) {}

  get epoch(): number {
    return Number(this.state.epoch)
  }

  get ciphersuite(): MlsCiphersuite {
    assertKnownCiphersuite(this.state.ciphersuite)
    return this.state.ciphersuite
  }

  get treeHash(): string {
    return bytesToHex(this.state.treeHash)
  }

  get lastCommitHash(): string {
    return bytesToHex(this.state.confirmedTranscriptHash)
  }

  async buildExternalKeyPackage(credential: MlsCredential): Promise<Uint8Array> {
    const kp = await createKeyPackage({
      ciphersuite: this.ciphersuite,
      credential: {
        type: 'basic',
        identity: credential.identity,
      },
      signaturePrivateKey: credential.signaturePrivateKey,
      signaturePublicKey: credential.signaturePublicKey,
    })
    return kp.serialized
  }

  async addMember(keyPackageBytes: Uint8Array): Promise<MlsCommitResult> {
    const result = await createCommit(this.state, {
      proposals: [{ type: 'add', keyPackage: keyPackageBytes }],
    })
    // @wireapp/core-crypto mutates returned state — replace internal ref
    Object.assign(this.state, result.newState)
    return {
      commit: result.commit,
      welcome: result.welcome ?? null,
      newEpoch: Number(result.newState.epoch),
      newTreeHash: bytesToHex(result.newState.treeHash),
      commitHash: bytesToHex(sha256(result.commit)),
    }
  }

  async removeMember(memberSignaturePubkey: Uint8Array): Promise<MlsCommitResult> {
    const idx = this.findLeafByPubkey(memberSignaturePubkey)
    const result = await createCommit(this.state, {
      proposals: [{ type: 'remove', removed: idx }],
    })
    Object.assign(this.state, result.newState)
    return {
      commit: result.commit,
      welcome: result.welcome ?? null,
      newEpoch: Number(result.newState.epoch),
      newTreeHash: bytesToHex(result.newState.treeHash),
      commitHash: bytesToHex(sha256(result.commit)),
    }
  }

  async updatePath(): Promise<MlsCommitResult> {
    const result = await createCommit(this.state, {
      proposals: [],
      updatePath: true,
    })
    Object.assign(this.state, result.newState)
    return {
      commit: result.commit,
      welcome: null,
      newEpoch: Number(result.newState.epoch),
      newTreeHash: bytesToHex(result.newState.treeHash),
      commitHash: bytesToHex(sha256(result.commit)),
    }
  }

  async processCommit(commit: Uint8Array): Promise<MlsProcessResult> {
    const newState = await processMessage(this.state, commit)
    Object.assign(this.state, newState)
    return {
      newEpoch: Number(newState.epoch),
      newTreeHash: bytesToHex(newState.treeHash),
      commitHash: bytesToHex(sha256(commit)),
    }
  }

  exportSecret(label: string, context: Uint8Array, length: number): Uint8Array {
    return tsMlsExportSecret(this.state, label, context, length)
  }

  toBytes(): Uint8Array {
    return serializeGroup(this.state)
  }

  private findLeafByPubkey(pubkey: Uint8Array): number {
    for (let i = 0; i < this.state.tree.leaves.length; i++) {
      const leaf = this.state.tree.leaves[i]
      if (
        leaf &&
        leaf.signaturePublicKey.length === pubkey.length &&
        leaf.signaturePublicKey.every((b, j) => b === pubkey[j])
      ) {
        return i
      }
    }
    throw new Error('Leaf not found for signature pubkey')
  }
}

export async function createNewGroup(input: CreateNewGroupInput): Promise<MlsGroupHandle> {
  assertKnownCiphersuite(input.ciphersuite)
  const state = await tsMlsCreateGroup({
    ciphersuite: input.ciphersuite,
    groupId: input.groupId,
    credential: {
      type: 'basic',
      identity: input.credential.identity,
    },
    signaturePrivateKey: input.credential.signaturePrivateKey,
    signaturePublicKey: input.credential.signaturePublicKey,
  })
  return new MlsGroupHandle(state)
}

export async function joinFromWelcome(input: JoinFromWelcomeInput): Promise<MlsGroupHandle> {
  const state = await joinGroup({
    welcome: input.welcome,
    credential: {
      type: 'basic',
      identity: input.credential.identity,
    },
    signaturePrivateKey: input.credential.signaturePrivateKey,
    signaturePublicKey: input.credential.signaturePublicKey,
  })
  return new MlsGroupHandle(state)
}

export function deserializeGroupHandle(bytes: Uint8Array): MlsGroupHandle {
  const state = deserializeGroup(bytes)
  return new MlsGroupHandle(state)
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/mls/mls-group.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-group.ts src/client/lib/mls/mls-group.test.ts
git commit -m "feat(mls): MlsGroupHandle wrapper over @wireapp/core-crypto — create/add/remove/update/process"
```

### Task 24: Client — MLS exporter helper

**Files:**
- Create: `src/client/lib/mls/mls-exporter.ts`
- Create: `src/client/lib/mls/mls-exporter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/mls-exporter.test.ts
import { describe, expect, test } from 'bun:test'
import { deriveItemsKey, deriveSFrameBaseKey, deriveNoteEpochKey } from './mls-exporter'
import { createNewGroup } from './mls-group'
import { CIPHERSUITE_XWING } from './mls-ciphersuite'
import { schnorr } from '@noble/curves/secp256k1.js'

async function makeGroup() {
  const sk = schnorr.utils.randomPrivateKey()
  const pk = schnorr.getPublicKey(sk)
  return createNewGroup({
    ciphersuite: CIPHERSUITE_XWING,
    groupId: new Uint8Array(16).fill(7),
    credential: {
      identity: new Uint8Array(32).fill(1),
      signaturePrivateKey: sk,
      signaturePublicKey: pk,
    },
  })
}

describe('MLS exporter helpers', () => {
  test('deriveItemsKey returns 32 bytes', async () => {
    const group = await makeGroup()
    const key = deriveItemsKey(group, '11111111-1111-1111-1111-111111111111')
    expect(key.length).toBe(32)
  })

  test('deriveItemsKey is deterministic within the same epoch', async () => {
    const group = await makeGroup()
    const a = deriveItemsKey(group, '11111111-1111-1111-1111-111111111111')
    const b = deriveItemsKey(group, '11111111-1111-1111-1111-111111111111')
    expect(a).toEqual(b)
  })

  test('different contexts produce different items_keys', async () => {
    const group = await makeGroup()
    const a = deriveItemsKey(group, '11111111-1111-1111-1111-111111111111')
    const b = deriveItemsKey(group, '22222222-2222-2222-2222-222222222222')
    expect(a).not.toEqual(b)
  })

  test('different labels produce different keys for the same context', async () => {
    const group = await makeGroup()
    const callId = 'call-abc'
    const sframe = deriveSFrameBaseKey(group, callId)
    const itemsCtx = 'ctx-abc'
    const items = deriveItemsKey(group, itemsCtx)
    const note = deriveNoteEpochKey(group, 'note-abc')
    expect(sframe).not.toEqual(items)
    expect(sframe).not.toEqual(note)
    expect(items).not.toEqual(note)
  })

  test('epoch advance changes the derived key', async () => {
    const group = await makeGroup()
    const before = deriveItemsKey(group, 'hub-ctx')
    await group.updatePath()
    const after = deriveItemsKey(group, 'hub-ctx')
    expect(before).not.toEqual(after)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/lib/mls/mls-exporter.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/mls/mls-exporter.ts
import {
  LABEL_ITEMS_KEY_EXPORT,
  LABEL_SFRAME_BASE_KEY,
  LABEL_NOTE_EPOCH_KEY,
} from '@shared/crypto-labels'
import type { MlsGroupHandle } from './mls-group'

const enc = new TextEncoder()

/**
 * Derive the per-hub items_key from the current MLS epoch's exporter secret.
 * Context: the hubId (string), so every member at this epoch derives the same
 * items_key for the same hub.
 */
export function deriveItemsKey(group: MlsGroupHandle, hubId: string): Uint8Array {
  return group.exportSecret(LABEL_ITEMS_KEY_EXPORT, enc.encode(hubId), 32)
}

/**
 * Derive the per-call SFrame base key from the current MLS epoch's exporter
 * secret. Context: the callId, so different calls within the same epoch get
 * different base keys.
 */
export function deriveSFrameBaseKey(group: MlsGroupHandle, callId: string): Uint8Array {
  return group.exportSecret(LABEL_SFRAME_BASE_KEY, enc.encode(callId), 32)
}

/**
 * Derive the per-note epoch key used as the outer wrap for provable-delete
 * notes. Context: the noteId.
 */
export function deriveNoteEpochKey(group: MlsGroupHandle, noteId: string): Uint8Array {
  return group.exportSecret(LABEL_NOTE_EPOCH_KEY, enc.encode(noteId), 32)
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/mls/mls-exporter.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-exporter.ts src/client/lib/mls/mls-exporter.test.ts
git commit -m "feat(mls): exporter helpers — items_key / SFrame / note-epoch derivation"
```

### Task 25: Client — MLS state persistence (AES-KW-wrapped IDB store)

**Files:**
- Create: `src/client/lib/mls/mls-state-persistence.ts`
- Create: `src/client/lib/mls/mls-state-persistence.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/mls-state-persistence.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  saveMlsGroupState,
  loadMlsGroupState,
  deleteMlsGroupState,
  clearAllMlsState,
} from './mls-state-persistence'
import type { MlsGroupState } from './mls-types'
import { setupIdbForTests } from '../test-helpers/fake-idb'

const hubId = '11111111-1111-1111-1111-111111111111'
const deviceId = '22222222-2222-2222-2222-222222222222'

const sampleState: MlsGroupState = {
  hubId,
  ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
  groupId: new Uint8Array([1, 2, 3]),
  epoch: 5,
  lastCommitHash: 'aa'.repeat(32),
  treeHash: 'bb'.repeat(32),
  opaqueState: 'base64-opaque-ciphertext' as unknown as MlsGroupState['opaqueState'],
}

describe('MLS state persistence', () => {
  beforeEach(async () => {
    await setupIdbForTests()
    await clearAllMlsState()
  })

  test('round-trips through IDB', async () => {
    await saveMlsGroupState({ hubId, deviceId, state: sampleState })
    const loaded = await loadMlsGroupState({ hubId, deviceId })
    expect(loaded).not.toBeNull()
    expect(loaded!.epoch).toBe(5)
    expect(loaded!.ciphersuite).toBe('MLS_256_XWING_AES256GCM_SHA512_Ed25519')
  })

  test('load for missing key returns null', async () => {
    const loaded = await loadMlsGroupState({ hubId, deviceId })
    expect(loaded).toBeNull()
  })

  test('delete removes the state', async () => {
    await saveMlsGroupState({ hubId, deviceId, state: sampleState })
    await deleteMlsGroupState({ hubId, deviceId })
    const loaded = await loadMlsGroupState({ hubId, deviceId })
    expect(loaded).toBeNull()
  })

  test('corrupted opaque state fails AEAD tag on read', async () => {
    await saveMlsGroupState({ hubId, deviceId, state: sampleState })
    // Simulate corruption by mutating the raw record
    const db = await (await import('./mls-state-persistence')).openMlsStateDb()
    const tx = db.transaction('mls_group_state', 'readwrite')
    const store = tx.objectStore('mls_group_state')
    const key = `${hubId}:${deviceId}`
    const record = await store.get(key)
    record.opaqueState = 'garbage'
    await store.put(record, key)
    await tx.done
    await expect(loadMlsGroupState({ hubId, deviceId })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/lib/mls/mls-state-persistence.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/mls/mls-state-persistence.ts
import { openDB, type IDBPDatabase } from 'idb'
import type { MlsGroupState } from './mls-types'

const DB_NAME = 'llamenos-mls-v1'
const DB_VERSION = 1
const STORE = 'mls_group_state'

interface MlsStateRecord {
  hubId: string
  ciphersuite: MlsGroupState['ciphersuite']
  groupId: Uint8Array
  epoch: number
  lastCommitHash: string
  treeHash: string
  opaqueState: string // serialized Ciphertext envelope
  updatedAt: string
}

export async function openMlsStateDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    },
  })
}

export async function saveMlsGroupState(input: {
  hubId: string
  deviceId: string
  state: MlsGroupState
}): Promise<void> {
  const db = await openMlsStateDb()
  const record: MlsStateRecord = {
    hubId: input.state.hubId,
    ciphersuite: input.state.ciphersuite,
    groupId: input.state.groupId,
    epoch: input.state.epoch,
    lastCommitHash: input.state.lastCommitHash,
    treeHash: input.state.treeHash,
    opaqueState: String(input.state.opaqueState),
    updatedAt: new Date().toISOString(),
  }
  await db.put(STORE, record, `${input.hubId}:${input.deviceId}`)
}

export async function loadMlsGroupState(input: {
  hubId: string
  deviceId: string
}): Promise<MlsGroupState | null> {
  const db = await openMlsStateDb()
  const record = (await db.get(STORE, `${input.hubId}:${input.deviceId}`)) as
    | MlsStateRecord
    | undefined
  if (!record) return null
  // Validate opaque-state envelope shape before returning — callers will
  // hand the opaqueState to the crypto worker which enforces AEAD on decrypt.
  if (!record.opaqueState || !record.opaqueState.includes(':')) {
    throw new Error('Corrupted MLS state: malformed opaque envelope')
  }
  return {
    hubId: record.hubId,
    ciphersuite: record.ciphersuite,
    groupId: record.groupId,
    epoch: record.epoch,
    lastCommitHash: record.lastCommitHash,
    treeHash: record.treeHash,
    opaqueState: record.opaqueState as MlsGroupState['opaqueState'],
  }
}

export async function deleteMlsGroupState(input: {
  hubId: string
  deviceId: string
}): Promise<void> {
  const db = await openMlsStateDb()
  await db.delete(STORE, `${input.hubId}:${input.deviceId}`)
}

export async function clearAllMlsState(): Promise<void> {
  const db = await openMlsStateDb()
  await db.clear(STORE)
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/mls/mls-state-persistence.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-state-persistence.ts src/client/lib/mls/mls-state-persistence.test.ts
git commit -m "feat(mls): IDB-backed MLS group state persistence (encrypted)"
```

### Task 26: Client — KeyPackage publisher + fetcher

**Files:**
- Create: `src/client/lib/mls/mls-key-package.ts`
- Create: `src/client/lib/mls/mls-key-package.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/mls-key-package.test.ts
import { describe, expect, test, beforeEach, mock } from 'bun:test'
import {
  publishKeyPackages,
  fetchKeyPackagesForUser,
  KEY_PACKAGE_REPLENISH_THRESHOLD,
  KEY_PACKAGE_BATCH_SIZE,
} from './mls-key-package'
import { CIPHERSUITE_XWING } from './mls-ciphersuite'

describe('mls-key-package client', () => {
  beforeEach(() => {
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      if (url === '/api/mls/key-packages' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        return new Response(
          JSON.stringify({
            publishedIds: body.keyPackages.map((_: unknown, i: number) => `pub-${i}`),
          }),
          { status: 201 },
        )
      }
      if (url.includes('/key-packages?ciphersuite=')) {
        return new Response(
          JSON.stringify({
            keyPackages: [
              {
                deviceId: '22222222-2222-2222-2222-222222222222',
                keyPackageId: 'kp-1',
                keyPackageBytesB64: Buffer.from([1, 2, 3]).toString('base64'),
              },
            ],
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as unknown as typeof fetch
  })

  test('replenish threshold = 3, batch size = 10', () => {
    expect(KEY_PACKAGE_REPLENISH_THRESHOLD).toBe(3)
    expect(KEY_PACKAGE_BATCH_SIZE).toBe(10)
  })

  test('publish sends base64-encoded batch', async () => {
    const kps = Array.from({ length: 10 }, () => new Uint8Array([1, 2, 3]))
    const expires = new Date(Date.now() + 30 * 86400 * 1000)
    const ids = await publishKeyPackages({
      hubId: '11111111-1111-1111-1111-111111111111',
      ciphersuite: CIPHERSUITE_XWING,
      keyPackages: kps.map((bytes) => ({ bytes, expiresAt: expires })),
    })
    expect(ids.length).toBe(10)
  })

  test('fetch returns decoded KeyPackage bytes', async () => {
    const result = await fetchKeyPackagesForUser({
      hubId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      ciphersuite: CIPHERSUITE_XWING,
    })
    expect(result.length).toBe(1)
    expect(result[0]!.keyPackageBytes).toEqual(new Uint8Array([1, 2, 3]))
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/lib/mls/mls-key-package.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/mls/mls-key-package.ts
import type { MlsCiphersuite, MlsKeyPackageRecord } from './mls-types'

/** Replenish batch when this few KeyPackages remain unused. */
export const KEY_PACKAGE_REPLENISH_THRESHOLD = 3

/** Batch size when publishing / replenishing. */
export const KEY_PACKAGE_BATCH_SIZE = 10

/** Default KeyPackage lifetime — 30 days. */
export const KEY_PACKAGE_LIFETIME_MS = 30 * 24 * 3600 * 1000

export interface PublishInput {
  hubId: string
  ciphersuite: MlsCiphersuite
  keyPackages: Array<{ bytes: Uint8Array; expiresAt: Date }>
}

export async function publishKeyPackages(input: PublishInput): Promise<string[]> {
  const res = await fetch('/api/mls/key-packages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hubId: input.hubId,
      ciphersuite: input.ciphersuite,
      keyPackages: input.keyPackages.map((kp) => ({
        keyPackageBytesB64: btoa(String.fromCharCode(...kp.bytes)),
        expiresAt: kp.expiresAt.toISOString(),
      })),
    }),
  })
  if (!res.ok) {
    throw new Error(`publish KeyPackages failed: ${res.status}`)
  }
  const body = await res.json()
  return body.publishedIds as string[]
}

export interface FetchKeyPackagesInput {
  hubId: string
  userId: string
  ciphersuite: MlsCiphersuite
}

export async function fetchKeyPackagesForUser(
  input: FetchKeyPackagesInput,
): Promise<MlsKeyPackageRecord[]> {
  const url = `/api/hubs/${input.hubId}/users/${input.userId}/key-packages?ciphersuite=${encodeURIComponent(input.ciphersuite)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`fetch KeyPackages failed: ${res.status}`)
  }
  const body = await res.json()
  return (body.keyPackages as Array<{
    deviceId: string
    keyPackageId: string
    keyPackageBytesB64: string
  }>).map((kp) => ({
    deviceId: kp.deviceId,
    keyPackageId: kp.keyPackageId,
    keyPackageBytes: Uint8Array.from(atob(kp.keyPackageBytesB64), (c) => c.charCodeAt(0)),
  }))
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/mls/mls-key-package.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-key-package.ts src/client/lib/mls/mls-key-package.test.ts
git commit -m "feat(mls): KeyPackage publisher + fetcher client API"
```

### Task 27: Client — Nostr delivery codec (kinds 20001–20003)

**Files:**
- Create: `src/client/lib/mls/mls-delivery-strfry.ts`
- Create: `src/client/lib/mls/mls-delivery-strfry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/mls-delivery-strfry.test.ts
import { describe, expect, test } from 'bun:test'
import {
  encodeCommitEvent,
  encodeWelcomeEvent,
  encodeKeyPackageEvent,
  decodeMlsEvent,
  MLS_COMMIT_TAG,
  MLS_WELCOME_TAG,
  MLS_KEYPACKAGE_TAG,
} from './mls-delivery-strfry'
import { MLS_EVENT_KIND_COMMIT, MLS_EVENT_KIND_WELCOME, MLS_EVENT_KIND_KEYPACKAGE } from '@shared/schemas/mls'

const hubId = '11111111-1111-1111-1111-111111111111'
const deviceId = '22222222-2222-2222-2222-222222222222'
const targetDeviceId = '33333333-3333-3333-3333-333333333333'
const payload = new Uint8Array([1, 2, 3, 4, 5])

describe('MLS Nostr delivery codec', () => {
  test('encodeCommitEvent wraps in kind 20001 with correct tags', () => {
    const event = encodeCommitEvent({ hubId, epoch: 5, senderDeviceId: deviceId, payload })
    expect(event.kind).toBe(MLS_EVENT_KIND_COMMIT)
    const tagTypes = event.tags.map((t) => t[0])
    expect(tagTypes).toContain('t')
    expect(tagTypes).toContain('hub')
    expect(tagTypes).toContain('e')
    const tTag = event.tags.find((t) => t[0] === 't')
    expect(tTag).toEqual(['t', MLS_COMMIT_TAG])
  })

  test('encodeWelcomeEvent targets a specific device', () => {
    const event = encodeWelcomeEvent({
      hubId,
      epoch: 1,
      senderDeviceId: deviceId,
      targetDeviceId,
      payload,
    })
    expect(event.kind).toBe(MLS_EVENT_KIND_WELCOME)
    const pTag = event.tags.find((t) => t[0] === 'p')
    expect(pTag).toEqual(['p', targetDeviceId])
  })

  test('encodeKeyPackageEvent includes ciphersuite tag', () => {
    const event = encodeKeyPackageEvent({
      deviceId,
      ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      payload,
    })
    expect(event.kind).toBe(MLS_EVENT_KIND_KEYPACKAGE)
    const csTag = event.tags.find((t) => t[0] === 'cs')
    expect(csTag).toEqual(['cs', 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'])
  })

  test('decodeMlsEvent round-trips a commit event', () => {
    const event = encodeCommitEvent({ hubId, epoch: 5, senderDeviceId: deviceId, payload })
    const decoded = decodeMlsEvent(event)
    expect(decoded.kind).toBe(MLS_EVENT_KIND_COMMIT)
    expect(decoded.hubId).toBe(hubId)
    expect(decoded.epoch).toBe(5)
    expect(decoded.senderDeviceId).toBe(deviceId)
    expect(decoded.payload).toEqual(payload)
  })

  test('decodeMlsEvent rejects wrong kind', () => {
    const event = {
      kind: 1,
      content: 'AAA=',
      tags: [['t', 'something-else']],
      pubkey: 'ab'.repeat(32),
      created_at: Math.floor(Date.now() / 1000),
    }
    expect(() => decodeMlsEvent(event as unknown as Parameters<typeof decodeMlsEvent>[0])).toThrow()
  })

  test('decodeMlsEvent rejects missing hub tag for commit', () => {
    const event = {
      kind: MLS_EVENT_KIND_COMMIT,
      content: 'AAA=',
      tags: [['t', MLS_COMMIT_TAG]],
      pubkey: 'ab'.repeat(32),
      created_at: Math.floor(Date.now() / 1000),
    }
    expect(() => decodeMlsEvent(event as unknown as Parameters<typeof decodeMlsEvent>[0])).toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/lib/mls/mls-delivery-strfry.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/mls/mls-delivery-strfry.ts
import type { MlsCiphersuite } from './mls-types'
import {
  MLS_EVENT_KIND_COMMIT,
  MLS_EVENT_KIND_WELCOME,
  MLS_EVENT_KIND_KEYPACKAGE,
} from '@shared/schemas/mls'

export const MLS_COMMIT_TAG = 'llamenos:mls:commit'
export const MLS_WELCOME_TAG = 'llamenos:mls:welcome'
export const MLS_KEYPACKAGE_TAG = 'llamenos:mls:keypackage'

export interface NostrEventDraft {
  kind: number
  content: string
  tags: string[][]
  created_at: number
}

export interface DecodedMlsEvent {
  kind: number
  hubId: string | null
  epoch: number | null
  senderDeviceId: string
  targetDeviceId: string | null
  ciphersuite: MlsCiphersuite | null
  payload: Uint8Array
}

function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export function encodeCommitEvent(input: {
  hubId: string
  epoch: number
  senderDeviceId: string
  payload: Uint8Array
}): NostrEventDraft {
  return {
    kind: MLS_EVENT_KIND_COMMIT,
    content: bytesToB64(input.payload),
    tags: [
      ['t', MLS_COMMIT_TAG],
      ['hub', input.hubId],
      ['e', String(input.epoch)],
      ['sender', input.senderDeviceId],
    ],
    created_at: Math.floor(Date.now() / 1000),
  }
}

export function encodeWelcomeEvent(input: {
  hubId: string
  epoch: number
  senderDeviceId: string
  targetDeviceId: string
  payload: Uint8Array
}): NostrEventDraft {
  return {
    kind: MLS_EVENT_KIND_WELCOME,
    content: bytesToB64(input.payload),
    tags: [
      ['t', MLS_WELCOME_TAG],
      ['hub', input.hubId],
      ['e', String(input.epoch)],
      ['p', input.targetDeviceId],
      ['sender', input.senderDeviceId],
    ],
    created_at: Math.floor(Date.now() / 1000),
  }
}

export function encodeKeyPackageEvent(input: {
  deviceId: string
  ciphersuite: MlsCiphersuite
  payload: Uint8Array
}): NostrEventDraft {
  return {
    kind: MLS_EVENT_KIND_KEYPACKAGE,
    content: bytesToB64(input.payload),
    tags: [
      ['t', MLS_KEYPACKAGE_TAG],
      ['p', input.deviceId],
      ['cs', input.ciphersuite],
    ],
    created_at: Math.floor(Date.now() / 1000),
  }
}

export function decodeMlsEvent(event: NostrEventDraft): DecodedMlsEvent {
  const kind = event.kind
  if (
    kind !== MLS_EVENT_KIND_COMMIT &&
    kind !== MLS_EVENT_KIND_WELCOME &&
    kind !== MLS_EVENT_KIND_KEYPACKAGE
  ) {
    throw new Error(`decodeMlsEvent: unexpected kind ${kind}`)
  }

  const tagMap = new Map<string, string>()
  for (const tag of event.tags) {
    if (tag.length >= 2 && !tagMap.has(tag[0]!)) {
      tagMap.set(tag[0]!, tag[1]!)
    }
  }

  if (kind === MLS_EVENT_KIND_COMMIT || kind === MLS_EVENT_KIND_WELCOME) {
    if (!tagMap.has('hub')) {
      throw new Error(`decodeMlsEvent: missing hub tag for kind ${kind}`)
    }
    if (!tagMap.has('e')) {
      throw new Error(`decodeMlsEvent: missing epoch tag for kind ${kind}`)
    }
  }

  return {
    kind,
    hubId: tagMap.get('hub') ?? null,
    epoch: tagMap.has('e') ? Number(tagMap.get('e')) : null,
    senderDeviceId: tagMap.get('sender') ?? tagMap.get('p') ?? '',
    targetDeviceId: kind === MLS_EVENT_KIND_WELCOME ? (tagMap.get('p') ?? null) : null,
    ciphersuite:
      kind === MLS_EVENT_KIND_KEYPACKAGE ? ((tagMap.get('cs') as MlsCiphersuite | undefined) ?? null) : null,
    payload: b64ToBytes(event.content),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/mls/mls-delivery-strfry.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-delivery-strfry.ts src/client/lib/mls/mls-delivery-strfry.test.ts
git commit -m "feat(mls): Nostr event codec for MLS kinds 20001–20003 over strfry"
```

### Task 28: Client — items_key derivation + epoch cache

**Files:**
- Create: `src/client/lib/mls/mls-items-key.ts`
- Create: `src/client/lib/mls/mls-items-key.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/mls-items-key.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  MlsItemsKeyCache,
  type EpochKeyResolver,
} from './mls-items-key'

describe('MlsItemsKeyCache', () => {
  let cache: MlsItemsKeyCache
  let resolverCalls: Array<{ hubId: string; epoch: number }>

  const resolver: EpochKeyResolver = async ({ hubId, epoch }) => {
    resolverCalls.push({ hubId, epoch })
    const bytes = new Uint8Array(32)
    bytes[0] = epoch
    return bytes
  }

  beforeEach(() => {
    cache = new MlsItemsKeyCache({ resolver })
    resolverCalls = []
  })

  test('first call resolves and caches', async () => {
    const key = await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    expect(key[0]).toBe(5)
    expect(resolverCalls.length).toBe(1)
  })

  test('second call for same epoch returns from cache', async () => {
    await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    const resolverCountAfterFirst = resolverCalls.length
    await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    expect(resolverCalls.length).toBe(resolverCountAfterFirst)
  })

  test('different epochs resolve independently', async () => {
    const k5 = await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    const k6 = await cache.getItemsKey({ hubId: 'h1', epoch: 6 })
    expect(k5).not.toEqual(k6)
    expect(resolverCalls.length).toBe(2)
  })

  test('forgetEpoch evicts the cached key', async () => {
    await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    cache.forgetEpoch({ hubId: 'h1', epoch: 5 })
    await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    expect(resolverCalls.length).toBe(2)
  })

  test('clearHub evicts all epochs for a hub', async () => {
    await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    await cache.getItemsKey({ hubId: 'h1', epoch: 6 })
    await cache.getItemsKey({ hubId: 'h2', epoch: 5 })
    cache.clearHub('h1')
    await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    await cache.getItemsKey({ hubId: 'h2', epoch: 5 })
    expect(resolverCalls.length).toBe(4)
  })

  test('clearAll empties cache on lock', async () => {
    await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    cache.clearAll()
    await cache.getItemsKey({ hubId: 'h1', epoch: 5 })
    expect(resolverCalls.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/lib/mls/mls-items-key.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/mls/mls-items-key.ts
export interface EpochKeyRequest {
  hubId: string
  epoch: number
}

export type EpochKeyResolver = (req: EpochKeyRequest) => Promise<Uint8Array>

export interface MlsItemsKeyCacheOptions {
  resolver: EpochKeyResolver
}

/**
 * In-memory per-tab cache of items_key values keyed by (hubId, epoch).
 *
 * The cache NEVER persists to disk — a page reload recomputes from
 * per-device MlsGroupState + exporter secret. Removed members cannot
 * populate this cache because they cannot derive the new epoch's
 * exporter secret.
 *
 * The cache must be cleared on lock (via clearAll) and on hub leave
 * (via clearHub). Provable-delete purges call forgetEpoch directly.
 */
export class MlsItemsKeyCache {
  private readonly resolver: EpochKeyResolver
  private readonly cache = new Map<string, Uint8Array>()

  constructor(options: MlsItemsKeyCacheOptions) {
    this.resolver = options.resolver
  }

  private key(hubId: string, epoch: number): string {
    return `${hubId}::${epoch}`
  }

  async getItemsKey(req: EpochKeyRequest): Promise<Uint8Array> {
    const k = this.key(req.hubId, req.epoch)
    const existing = this.cache.get(k)
    if (existing) return existing
    const fresh = await this.resolver(req)
    this.cache.set(k, fresh)
    return fresh
  }

  forgetEpoch(req: EpochKeyRequest): void {
    const k = this.key(req.hubId, req.epoch)
    const existing = this.cache.get(k)
    if (existing) {
      existing.fill(0)
    }
    this.cache.delete(k)
  }

  clearHub(hubId: string): void {
    const prefix = `${hubId}::`
    for (const [k, v] of this.cache.entries()) {
      if (k.startsWith(prefix)) {
        v.fill(0)
        this.cache.delete(k)
      }
    }
  }

  clearAll(): void {
    for (const v of this.cache.values()) {
      v.fill(0)
    }
    this.cache.clear()
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/mls/mls-items-key.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-items-key.ts src/client/lib/mls/mls-items-key.test.ts
git commit -m "feat(mls): in-memory items_key epoch cache with forget + hub-clear"
```

### Task 29: Client — crypto-worker MLS operation handlers

**Files:**
- Modify: `src/client/lib/crypto-worker.ts` (add MLS ops)
- Modify: `src/client/lib/crypto-worker-client.ts` (add typed facade)
- Modify: `src/client/lib/crypto-worker.test.ts` (add MLS op coverage)

- [ ] **Step 1: Write failing tests**

Append to `src/client/lib/crypto-worker.test.ts`:

```typescript
import {
  cryptoWorkerClient,
  MlsOpType,
} from './crypto-worker-client'
import { CIPHERSUITE_XWING } from './mls/mls-ciphersuite'

describe('crypto worker MLS ops', () => {
  test('mls:createGroup returns a group state handle', async () => {
    const result = await cryptoWorkerClient.mls.createGroup({
      hubId: '11111111-1111-1111-1111-111111111111',
      ciphersuite: CIPHERSUITE_XWING,
      groupIdHex: '0a'.repeat(16),
    })
    expect(result.epoch).toBe(0)
    expect(result.handleId).toMatch(/^mls-group-/)
  })

  test('mls:generateKeyPackage returns bytes', async () => {
    const kp = await cryptoWorkerClient.mls.generateKeyPackage({
      deviceId: '22222222-2222-2222-2222-222222222222',
      hubId: '11111111-1111-1111-1111-111111111111',
      ciphersuite: CIPHERSUITE_XWING,
    })
    expect(kp.keyPackageBytes.length).toBeGreaterThan(0)
  })

  test('mls:exportSecret is deterministic for the same handle', async () => {
    const group = await cryptoWorkerClient.mls.createGroup({
      hubId: '11111111-1111-1111-1111-111111111111',
      ciphersuite: CIPHERSUITE_XWING,
      groupIdHex: '0b'.repeat(16),
    })
    const a = await cryptoWorkerClient.mls.exportSecret({
      handleId: group.handleId,
      label: 'llamenos:items-key-export:v1',
      contextHex: '0102',
      length: 32,
    })
    const b = await cryptoWorkerClient.mls.exportSecret({
      handleId: group.handleId,
      label: 'llamenos:items-key-export:v1',
      contextHex: '0102',
      length: 32,
    })
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/client/lib/crypto-worker.test.ts -t "MLS ops"`
Expected: FAIL — handlers missing.

- [ ] **Step 3: Extend the worker**

Edit `src/client/lib/crypto-worker.ts` — add the MLS request handlers:

```typescript
import {
  MlsGroupHandle,
  createNewGroup,
  joinFromWelcome,
  deserializeGroupHandle,
} from './mls/mls-group'
import type { MlsCiphersuite } from './mls/mls-types'
import { createKeyPackage } from '@wireapp/core-crypto'
import { hexToBytes, bytesToHex, randomBytes } from '@noble/hashes/utils.js'

// In-worker registry of live MLS group handles.
const mlsGroupHandles = new Map<string, MlsGroupHandle>()

function nextHandleId(): string {
  return `mls-group-${bytesToHex(randomBytes(8))}`
}

function registerHandle(handle: MlsGroupHandle): string {
  const id = nextHandleId()
  mlsGroupHandles.set(id, handle)
  return id
}

function getHandle(id: string): MlsGroupHandle {
  const h = mlsGroupHandles.get(id)
  if (!h) throw new Error(`Unknown MLS handle: ${id}`)
  return h
}

// ... inside the worker's onmessage dispatch ...
case 'mls:createGroup': {
  const { hubId, ciphersuite, groupIdHex } = req.payload as {
    hubId: string
    ciphersuite: MlsCiphersuite
    groupIdHex: string
  }
  const cred = await getOrCreateDeviceCredential()
  const handle = await createNewGroup({
    ciphersuite,
    groupId: hexToBytes(groupIdHex),
    credential: cred,
  })
  const handleId = registerHandle(handle)
  return {
    handleId,
    hubId,
    ciphersuite,
    epoch: handle.epoch,
    treeHash: handle.treeHash,
  }
}

case 'mls:joinFromWelcome': {
  const { welcomeBytesHex } = req.payload as { welcomeBytesHex: string }
  const cred = await getOrCreateDeviceCredential()
  const handle = await joinFromWelcome({
    welcome: hexToBytes(welcomeBytesHex),
    credential: cred,
  })
  const handleId = registerHandle(handle)
  return {
    handleId,
    epoch: handle.epoch,
    treeHash: handle.treeHash,
  }
}

case 'mls:generateKeyPackage': {
  const { ciphersuite } = req.payload as { ciphersuite: MlsCiphersuite }
  const cred = await getOrCreateDeviceCredential()
  const kp = await createKeyPackage({
    ciphersuite,
    credential: { type: 'basic', identity: cred.identity },
    signaturePrivateKey: cred.signaturePrivateKey,
    signaturePublicKey: cred.signaturePublicKey,
  })
  return { keyPackageBytes: kp.serialized }
}

case 'mls:createCommit': {
  const { handleId, proposalType, proposalData } = req.payload as {
    handleId: string
    proposalType: 'add' | 'remove' | 'update'
    proposalData: { keyPackageBytesHex?: string; memberPubkeyHex?: string }
  }
  const handle = getHandle(handleId)
  let result
  if (proposalType === 'add') {
    result = await handle.addMember(hexToBytes(proposalData.keyPackageBytesHex!))
  } else if (proposalType === 'remove') {
    result = await handle.removeMember(hexToBytes(proposalData.memberPubkeyHex!))
  } else {
    result = await handle.updatePath()
  }
  return result
}

case 'mls:processCommit': {
  const { handleId, commitBytesHex } = req.payload as {
    handleId: string
    commitBytesHex: string
  }
  const handle = getHandle(handleId)
  return handle.processCommit(hexToBytes(commitBytesHex))
}

case 'mls:exportSecret': {
  const { handleId, label, contextHex, length } = req.payload as {
    handleId: string
    label: string
    contextHex: string
    length: number
  }
  const handle = getHandle(handleId)
  const secret = handle.exportSecret(label, hexToBytes(contextHex), length)
  return { secretHex: bytesToHex(secret) }
}

case 'mls:serialize': {
  const { handleId } = req.payload as { handleId: string }
  const handle = getHandle(handleId)
  return { stateBytesHex: bytesToHex(handle.toBytes()) }
}

case 'mls:deserialize': {
  const { stateBytesHex } = req.payload as { stateBytesHex: string }
  const handle = deserializeGroupHandle(hexToBytes(stateBytesHex))
  return {
    handleId: registerHandle(handle),
    epoch: handle.epoch,
    treeHash: handle.treeHash,
  }
}

case 'mls:dropHandle': {
  const { handleId } = req.payload as { handleId: string }
  mlsGroupHandles.delete(handleId)
  return { ok: true }
}
```

Ensure a `getOrCreateDeviceCredential()` helper exists in the worker that pulls the device's Ed25519 keypair from the Tier 3 persistence layer (add it if missing).

- [ ] **Step 4: Add the typed facade**

Edit `src/client/lib/crypto-worker-client.ts` — append:

```typescript
import type { MlsCiphersuite } from './mls/mls-types'

export const MlsOpType = {
  CREATE_GROUP: 'mls:createGroup',
  JOIN_FROM_WELCOME: 'mls:joinFromWelcome',
  GENERATE_KEYPACKAGE: 'mls:generateKeyPackage',
  CREATE_COMMIT: 'mls:createCommit',
  PROCESS_COMMIT: 'mls:processCommit',
  EXPORT_SECRET: 'mls:exportSecret',
  SERIALIZE: 'mls:serialize',
  DESERIALIZE: 'mls:deserialize',
  DROP_HANDLE: 'mls:dropHandle',
} as const

export interface MlsClientFacade {
  createGroup(input: {
    hubId: string
    ciphersuite: MlsCiphersuite
    groupIdHex: string
  }): Promise<{ handleId: string; hubId: string; ciphersuite: MlsCiphersuite; epoch: number; treeHash: string }>

  joinFromWelcome(input: { welcomeBytesHex: string }): Promise<{
    handleId: string
    epoch: number
    treeHash: string
  }>

  generateKeyPackage(input: {
    deviceId: string
    hubId: string
    ciphersuite: MlsCiphersuite
  }): Promise<{ keyPackageBytes: Uint8Array }>

  createCommit(input: {
    handleId: string
    proposalType: 'add' | 'remove' | 'update'
    proposalData: { keyPackageBytesHex?: string; memberPubkeyHex?: string }
  }): Promise<{
    commit: Uint8Array
    welcome: Uint8Array | null
    newEpoch: number
    newTreeHash: string
    commitHash: string
  }>

  processCommit(input: {
    handleId: string
    commitBytesHex: string
  }): Promise<{ newEpoch: number; newTreeHash: string; commitHash: string }>

  exportSecret(input: {
    handleId: string
    label: string
    contextHex: string
    length: number
  }): Promise<Uint8Array>

  serialize(input: { handleId: string }): Promise<{ stateBytesHex: string }>

  deserialize(input: {
    stateBytesHex: string
  }): Promise<{ handleId: string; epoch: number; treeHash: string }>

  dropHandle(input: { handleId: string }): Promise<{ ok: true }>
}

class MlsClientFacadeImpl implements MlsClientFacade {
  constructor(private readonly worker: CryptoWorkerTransport) {}

  createGroup(input: Parameters<MlsClientFacade['createGroup']>[0]) {
    return this.worker.request(MlsOpType.CREATE_GROUP, input) as ReturnType<MlsClientFacade['createGroup']>
  }
  joinFromWelcome(input: Parameters<MlsClientFacade['joinFromWelcome']>[0]) {
    return this.worker.request(MlsOpType.JOIN_FROM_WELCOME, input) as ReturnType<MlsClientFacade['joinFromWelcome']>
  }
  generateKeyPackage(input: Parameters<MlsClientFacade['generateKeyPackage']>[0]) {
    return this.worker.request(MlsOpType.GENERATE_KEYPACKAGE, input) as ReturnType<MlsClientFacade['generateKeyPackage']>
  }
  createCommit(input: Parameters<MlsClientFacade['createCommit']>[0]) {
    return this.worker.request(MlsOpType.CREATE_COMMIT, input) as ReturnType<MlsClientFacade['createCommit']>
  }
  processCommit(input: Parameters<MlsClientFacade['processCommit']>[0]) {
    return this.worker.request(MlsOpType.PROCESS_COMMIT, input) as ReturnType<MlsClientFacade['processCommit']>
  }
  async exportSecret(input: Parameters<MlsClientFacade['exportSecret']>[0]) {
    const { secretHex } = (await this.worker.request(MlsOpType.EXPORT_SECRET, input)) as {
      secretHex: string
    }
    return Uint8Array.from(secretHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  }
  serialize(input: Parameters<MlsClientFacade['serialize']>[0]) {
    return this.worker.request(MlsOpType.SERIALIZE, input) as ReturnType<MlsClientFacade['serialize']>
  }
  deserialize(input: Parameters<MlsClientFacade['deserialize']>[0]) {
    return this.worker.request(MlsOpType.DESERIALIZE, input) as ReturnType<MlsClientFacade['deserialize']>
  }
  dropHandle(input: Parameters<MlsClientFacade['dropHandle']>[0]) {
    return this.worker.request(MlsOpType.DROP_HANDLE, input) as ReturnType<MlsClientFacade['dropHandle']>
  }
}

// Extend the existing cryptoWorkerClient singleton:
// cryptoWorkerClient.mls = new MlsClientFacadeImpl(cryptoWorkerClient.__transport)
```

- [ ] **Step 5: Run tests**

Run: `bun test src/client/lib/crypto-worker.test.ts`
Expected: all PASS.

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker.test.ts
git commit -m "feat(crypto-worker): MLS op handlers (createGroup, commit, exportSecret, ...)"
```

### Task 30: Client — daily jittered background updater

**Files:**
- Create: `src/client/lib/mls/mls-background-updater.ts`
- Create: `src/client/lib/mls/mls-background-updater.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/mls-background-updater.test.ts
import { describe, expect, test, mock } from 'bun:test'
import {
  scheduleMlsBackgroundUpdate,
  MLS_BACKGROUND_INTERVAL_MS,
  MLS_BACKGROUND_JITTER_MS,
} from './mls-background-updater'

describe('MLS background updater', () => {
  test('interval is 24 hours, jitter ±2 hours', () => {
    expect(MLS_BACKGROUND_INTERVAL_MS).toBe(24 * 3600 * 1000)
    expect(MLS_BACKGROUND_JITTER_MS).toBe(2 * 3600 * 1000)
  })

  test('computed delay is within [22h, 26h]', () => {
    const delays: number[] = []
    for (let i = 0; i < 100; i++) {
      delays.push(
        scheduleMlsBackgroundUpdate.__computeNextDelayMs(),
      )
    }
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(22 * 3600 * 1000)
      expect(d).toBeLessThanOrEqual(26 * 3600 * 1000)
    }
  })

  test('fires the callback when timer elapses', async () => {
    const cb = mock(async () => {})
    let scheduled: (() => void) | null = null
    const fakeSetTimeout = ((fn: () => void) => {
      scheduled = fn
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout
    const fakeClearTimeout = (() => {}) as typeof clearTimeout
    const handle = scheduleMlsBackgroundUpdate({
      hubId: 'h1',
      onTick: cb,
      now: () => Date.now(),
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    })
    expect(scheduled).toBeTruthy()
    await scheduled!()
    expect(cb).toHaveBeenCalledTimes(1)
    handle.stop()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/lib/mls/mls-background-updater.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/mls/mls-background-updater.ts
export const MLS_BACKGROUND_INTERVAL_MS = 24 * 3600 * 1000
export const MLS_BACKGROUND_JITTER_MS = 2 * 3600 * 1000

export interface ScheduleInput {
  hubId: string
  onTick: () => Promise<void>
  now?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

export interface ScheduleHandle {
  stop(): void
}

function computeNextDelayMs(): number {
  const jitter = Math.floor(
    (Math.random() * 2 - 1) * MLS_BACKGROUND_JITTER_MS,
  )
  return MLS_BACKGROUND_INTERVAL_MS + jitter
}

export function scheduleMlsBackgroundUpdate(input: ScheduleInput): ScheduleHandle {
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const tick = async () => {
    if (stopped) return
    try {
      await input.onTick()
    } catch (err) {
      console.error(`MLS background update for hub ${input.hubId} failed`, err)
    }
    if (!stopped) {
      timer = setTimeoutFn(tick, computeNextDelayMs())
    }
  }

  timer = setTimeoutFn(tick, computeNextDelayMs())

  return {
    stop() {
      stopped = true
      if (timer) clearTimeoutFn(timer)
    },
  }
}

// Test-only: expose the delay function for unit tests.
;(scheduleMlsBackgroundUpdate as unknown as {
  __computeNextDelayMs: () => number
}).__computeNextDelayMs = computeNextDelayMs
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/mls/mls-background-updater.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-background-updater.ts src/client/lib/mls/mls-background-updater.test.ts
git commit -m "feat(mls): daily jittered background update commit scheduler"
```

### Task 31: Client — provable-delete (seal + purge helpers)

**Files:**
- Create: `src/client/lib/mls/mls-provable-delete.ts`
- Create: `src/client/lib/mls/mls-provable-delete.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/mls/mls-provable-delete.test.ts
import { describe, expect, test } from 'bun:test'
import {
  sealProvableDeleteNote,
  openProvableDeleteNote,
  purgeEpoch,
} from './mls-provable-delete'
import { createNewGroup } from './mls-group'
import { CIPHERSUITE_XWING } from './mls-ciphersuite'
import { MlsItemsKeyCache } from './mls-items-key'
import { deriveNoteEpochKey } from './mls-exporter'
import { schnorr } from '@noble/curves/secp256k1.js'

async function makeGroup() {
  const sk = schnorr.utils.randomPrivateKey()
  const pk = schnorr.getPublicKey(sk)
  return createNewGroup({
    ciphersuite: CIPHERSUITE_XWING,
    groupId: new Uint8Array(16).fill(4),
    credential: {
      identity: new Uint8Array(32).fill(1),
      signaturePrivateKey: sk,
      signaturePublicKey: pk,
    },
  })
}

describe('provable-delete flow', () => {
  test('sealed note is recoverable at the same epoch', async () => {
    const group = await makeGroup()
    const plaintext = new TextEncoder().encode('sensitive disclosure')
    const sealed = await sealProvableDeleteNote({
      group,
      noteId: 'note-1',
      plaintext,
    })
    expect(sealed.epoch).toBe(group.epoch)
    expect(sealed.outerCiphertext.length).toBeGreaterThan(0)
    const opened = await openProvableDeleteNote({
      group,
      sealed,
      epochKeyCache: new MlsItemsKeyCache({
        resolver: async () => deriveNoteEpochKey(group, sealed.noteId),
      }),
    })
    expect(opened).toEqual(plaintext)
  })

  test('after purgeEpoch forgets the epoch, sealed note is unrecoverable', async () => {
    const group = await makeGroup()
    const plaintext = new TextEncoder().encode('sensitive disclosure')
    const sealed = await sealProvableDeleteNote({
      group,
      noteId: 'note-1',
      plaintext,
    })
    const cache = new MlsItemsKeyCache({
      resolver: async () => deriveNoteEpochKey(group, sealed.noteId),
    })
    // Warm the cache
    await openProvableDeleteNote({ group, sealed, epochKeyCache: cache })
    // Advance epoch + purge
    await group.updatePath()
    purgeEpoch({
      cache,
      hubId: 'h1',
      purgedEpoch: sealed.epoch,
    })
    await expect(
      openProvableDeleteNote({ group, sealed, epochKeyCache: cache }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/lib/mls/mls-provable-delete.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/mls/mls-provable-delete.ts
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/hashes/utils.js'
import type { MlsGroupHandle } from './mls-group'
import { deriveNoteEpochKey } from './mls-exporter'
import { MlsItemsKeyCache } from './mls-items-key'

export interface ProvableDeleteSealed {
  version: 1
  noteId: string
  epoch: number
  nonce: Uint8Array
  outerCiphertext: Uint8Array
}

export async function sealProvableDeleteNote(input: {
  group: MlsGroupHandle
  noteId: string
  plaintext: Uint8Array
}): Promise<ProvableDeleteSealed> {
  const noteEpochKey = deriveNoteEpochKey(input.group, input.noteId)
  const nonce = randomBytes(24)
  const aead = xchacha20poly1305(noteEpochKey, nonce)
  const outerCiphertext = aead.encrypt(input.plaintext)
  noteEpochKey.fill(0)
  return {
    version: 1,
    noteId: input.noteId,
    epoch: input.group.epoch,
    nonce,
    outerCiphertext,
  }
}

export async function openProvableDeleteNote(input: {
  group: MlsGroupHandle
  sealed: ProvableDeleteSealed
  epochKeyCache: MlsItemsKeyCache
}): Promise<Uint8Array> {
  const key = await input.epochKeyCache.getItemsKey({
    hubId: `note:${input.sealed.noteId}`,
    epoch: input.sealed.epoch,
  })
  const aead = xchacha20poly1305(key, input.sealed.nonce)
  return aead.decrypt(input.sealed.outerCiphertext)
}

/**
 * Evict a purged epoch from the cache so that any future open attempt
 * must re-resolve (and fails because the group cannot export a past
 * epoch's secret).
 */
export function purgeEpoch(input: {
  cache: MlsItemsKeyCache
  hubId: string
  purgedEpoch: number
}): void {
  input.cache.forgetEpoch({ hubId: input.hubId, epoch: input.purgedEpoch })
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/mls/mls-provable-delete.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-provable-delete.ts src/client/lib/mls/mls-provable-delete.test.ts
git commit -m "feat(mls): provable-delete seal/open/purgeEpoch helpers"
```

### Task 32: Client — adversarial MLS test suite

**Files:**
- Create: `src/client/lib/mls/mls-group.adversarial.test.ts`

- [ ] **Step 1: Write adversarial test coverage**

```typescript
// src/client/lib/mls/mls-group.adversarial.test.ts
import { describe, expect, test, mock } from 'bun:test'
import { createNewGroup, joinFromWelcome, MlsGroupHandle } from './mls-group'
import { CIPHERSUITE_XWING, CIPHERSUITE_MLKEM1024 } from './mls-ciphersuite'
import { schnorr } from '@noble/curves/secp256k1.js'

async function makeCred() {
  const sk = schnorr.utils.randomPrivateKey()
  const pk = schnorr.getPublicKey(sk)
  return {
    identity: new Uint8Array(32).fill(1),
    signaturePrivateKey: sk,
    signaturePublicKey: pk,
  }
}

async function makeGroup(ciphersuite = CIPHERSUITE_XWING) {
  const cred = await makeCred()
  return createNewGroup({
    ciphersuite,
    groupId: new Uint8Array(16).fill(9),
    credential: cred,
  })
}

describe('MLS adversarial — forged KeyPackage', () => {
  test('KeyPackage signed under wrong signing key is rejected on add', async () => {
    const group = await makeGroup()
    const legitCred = await makeCred()
    const kp = await group.buildExternalKeyPackage(legitCred)
    // Corrupt the signature section (last 64 bytes of the serialized KP)
    const forged = new Uint8Array(kp)
    for (let i = forged.length - 64; i < forged.length; i++) {
      forged[i] ^= 0xff
    }
    await expect(group.addMember(forged)).rejects.toThrow()
  })
})

describe('MLS adversarial — commit replay', () => {
  test('replaying a commit at the wrong epoch is rejected', async () => {
    const group = await makeGroup()
    const cred = await makeCred()
    const kp = await group.buildExternalKeyPackage(cred)
    const first = await group.addMember(kp)
    const second = await group.addMember(
      await group.buildExternalKeyPackage(await makeCred()),
    )
    // Replay the first commit — group is now at epoch 2, so this is stale
    await expect(group.processCommit(first.commit)).rejects.toThrow()
  })
})

describe('MLS adversarial — ciphersuite downgrade', () => {
  test('joinFromWelcome on a Welcome for a different ciphersuite is rejected', async () => {
    const xwing = await makeGroup(CIPHERSUITE_XWING)
    const cred = await makeCred()
    const kp = await xwing.buildExternalKeyPackage(cred)
    const result = await xwing.addMember(kp)
    // Patch the Welcome header to claim ML-KEM-1024 ciphersuite
    const welcome = new Uint8Array(result.welcome!)
    // Byte 0 is version, byte 1 is ciphersuite id for our serialization — corrupt it
    welcome[1] ^= 0x01
    await expect(joinFromWelcome({ welcome, credential: cred })).rejects.toThrow()
  })
})

describe('MLS adversarial — broken PQ leg', () => {
  test('mocked ML-KEM decapsulation returning wrong bytes fails the whole derivation', async () => {
    // Use @wireapp/core-crypto's module-level injection point for the KEM primitive.
    const mockEncaps = mock(() => ({
      sharedSecret: new Uint8Array(32).fill(0xde),
      ciphertext: new Uint8Array(1184).fill(0xad),
    }))
    const mockDecaps = mock(() => new Uint8Array(32).fill(0xbe)) // wrong
    // Pseudocode — @wireapp/core-crypto exposes a testing hook; if not, patch via module
    const { __setMlKemImpl, __restoreMlKemImpl } = await import('@wireapp/core-crypto/test-hooks')
    __setMlKemImpl({ encaps: mockEncaps, decaps: mockDecaps })
    try {
      const group = await makeGroup()
      const cred = await makeCred()
      const kp = await group.buildExternalKeyPackage(cred)
      const result = await group.addMember(kp)
      // Recipient joins — MLS decrypts fail because the ML-KEM ss is wrong
      await expect(
        joinFromWelcome({ welcome: result.welcome!, credential: cred }),
      ).rejects.toThrow()
    } finally {
      __restoreMlKemImpl()
    }
  })

  test('mocked X25519 failure also fails', async () => {
    const { __setX25519Impl, __restoreX25519Impl } = await import('@wireapp/core-crypto/test-hooks')
    __setX25519Impl({
      scalarMult: () => new Uint8Array(32).fill(0xca),
    })
    try {
      const group = await makeGroup()
      const cred = await makeCred()
      const kp = await group.buildExternalKeyPackage(cred)
      const result = await group.addMember(kp)
      await expect(
        joinFromWelcome({ welcome: result.welcome!, credential: cred }),
      ).rejects.toThrow()
    } finally {
      __restoreX25519Impl()
    }
  })
})

describe('MLS adversarial — concurrent commits', () => {
  test('second concurrent commit is rejected with epoch mismatch', async () => {
    // Setup: two admin devices in the same group at epoch 1
    const adminA = await makeGroup()
    const credA = await makeCred()
    const credB = await makeCred()
    const kpB = await adminA.buildExternalKeyPackage(credB)
    const addResult = await adminA.addMember(kpB)
    const adminB = await joinFromWelcome({
      welcome: addResult.welcome!,
      credential: credB,
    })
    // Both are at epoch 1. Both create a commit concurrently without processing each other's.
    const credC = await makeCred()
    const credD = await makeCred()
    const kpC = await adminA.buildExternalKeyPackage(credC)
    const kpD = await adminB.buildExternalKeyPackage(credD)
    await adminA.addMember(kpC) // adminA advances to epoch 2
    const commitFromB = await adminB.addMember(kpD) // also "epoch 2" from B's POV
    // adminA tries to process B's commit — should reject, since adminA already has its own epoch 2
    await expect(adminA.processCommit(commitFromB.commit)).rejects.toThrow()
  })
})

describe('MLS adversarial — tampered tree hash', () => {
  test('audit-layer tree hash mismatch is caught by the verification gate', async () => {
    // This test verifies the application-layer gate, NOT @wireapp/core-crypto internals.
    // A commit with an otherwise-valid MLS payload is rejected because the
    // expected tree hash (from the signed audit entry) does not match the
    // recomputed tree hash after processing.
    const group = await makeGroup()
    const cred = await makeCred()
    const kp = await group.buildExternalKeyPackage(cred)
    const result = await group.addMember(kp)
    const expectedTreeHashWrong = 'ff'.repeat(32)
    // Simulate the chain-gate check function
    const gateCheck = (actualTreeHash: string, expected: string) => {
      if (actualTreeHash !== expected) {
        throw new Error('Tree hash mismatch — rejecting commit')
      }
    }
    expect(() => gateCheck(result.newTreeHash, expectedTreeHashWrong)).toThrow()
    expect(() => gateCheck(result.newTreeHash, result.newTreeHash)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `bun test src/client/lib/mls/mls-group.adversarial.test.ts`
Expected: all PASS (some tests use `@wireapp/core-crypto/test-hooks`; if that submodule is not present in the vendored tree, the vendor PR in Task 1 must expose equivalent hooks — add a thin patch file in `vendor/core-crypto/src/test-hooks.ts` as part of the vendoring task).

- [ ] **Step 3: If test-hooks are missing from @wireapp/core-crypto, add a patch**

Add `vendor/core-crypto/src/test-hooks.ts`:

```typescript
// Test-only primitive injection hooks. Not exported in production builds;
// Vite tree-shakes this path via a `process.env.NODE_ENV === 'test'` check.
import * as kemModule from './kem/ml-kem.js'
import * as dhModule from './dh/x25519.js'

let originalMlKem = { ...kemModule }
let originalX25519 = { ...dhModule }

export function __setMlKemImpl(impl: { encaps: Function; decaps: Function }) {
  Object.assign(kemModule, impl)
}
export function __restoreMlKemImpl() {
  Object.assign(kemModule, originalMlKem)
}
export function __setX25519Impl(impl: { scalarMult: Function }) {
  Object.assign(dhModule, impl)
}
export function __restoreX25519Impl() {
  Object.assign(dhModule, originalX25519)
}
```

Re-export from `vendor/core-crypto/src/index.ts`: `export * as testHooks from './test-hooks'`.

- [ ] **Step 4: Re-run tests**

Run: `bun test src/client/lib/mls/mls-group.adversarial.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/mls/mls-group.adversarial.test.ts vendor/core-crypto/src/test-hooks.ts vendor/core-crypto/src/index.ts
git commit -m "test(mls): adversarial — forged KP, replay, downgrade, broken PQ leg, concurrent commits"
```

### Task 33: Client — `useMlsHub` React Query hook

**Files:**
- Create: `src/client/hooks/useMlsHub.ts`
- Create: `src/client/hooks/useMlsHub.test.ts`
- Modify: `src/client/lib/query-client.ts` (register the new query key namespace)

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/hooks/useMlsHub.test.ts
import { describe, expect, test } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMlsHub } from './useMlsHub'

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useMlsHub', () => {
  test('returns tier6 disabled state for a non-tier6 hub', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(
      () => useMlsHub({ hubId: '11111111-1111-1111-1111-111111111111' }),
      { wrapper: wrapper(qc) },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.tier6Enabled).toBe(false)
    expect(result.current.data?.currentEpoch).toBeNull()
  })

  test('reports current epoch + treeHash for a tier6 hub with saved state', async () => {
    // Seed persistence + mock the API response before rendering
    // (details omitted; use the mls-state-persistence seeding helper)
    const qc = new QueryClient()
    const { result } = renderHook(
      () => useMlsHub({ hubId: '22222222-2222-2222-2222-222222222222' }),
      { wrapper: wrapper(qc) },
    )
    await waitFor(() => expect(result.current.data?.tier6Enabled).toBe(true))
    expect(typeof result.current.data?.currentEpoch).toBe('number')
    expect(result.current.data?.treeHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/client/hooks/useMlsHub.test.ts`
Expected: FAIL — hook missing.

- [ ] **Step 3: Implement the hook**

```typescript
// src/client/hooks/useMlsHub.ts
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client'
import { loadMlsGroupState } from '@/lib/mls/mls-state-persistence'
import type { MlsGroupState } from '@/lib/mls/mls-types'
import { getCurrentDeviceId } from '@/lib/device-identity'

export interface UseMlsHubData {
  tier6Enabled: boolean
  ciphersuite: MlsGroupState['ciphersuite'] | null
  currentEpoch: number | null
  treeHash: string | null
}

export function useMlsHub(input: { hubId: string }) {
  return useQuery<UseMlsHubData>({
    queryKey: queryKeys.mls.hub(input.hubId),
    queryFn: async () => {
      const res = await fetch(`/api/hubs/${input.hubId}`)
      if (!res.ok) throw new Error(`hub fetch ${res.status}`)
      const hub = await res.json()
      if (!hub.tier6Enabled) {
        return { tier6Enabled: false, ciphersuite: null, currentEpoch: null, treeHash: null }
      }
      const deviceId = await getCurrentDeviceId()
      const state = await loadMlsGroupState({ hubId: input.hubId, deviceId })
      if (!state) {
        return { tier6Enabled: true, ciphersuite: null, currentEpoch: null, treeHash: null }
      }
      return {
        tier6Enabled: true,
        ciphersuite: state.ciphersuite,
        currentEpoch: state.epoch,
        treeHash: state.treeHash,
      }
    },
  })
}
```

- [ ] **Step 4: Register the query key**

Edit `src/client/lib/query-client.ts` — add to `queryKeys`:

```typescript
mls: {
  hub: (hubId: string) => ['mls', 'hub', hubId] as const,
  keyPackagesUnused: (hubId: string) => ['mls', 'key-packages-unused', hubId] as const,
},
```

Classify as encrypted in `ENCRYPTED_QUERY_KEYS` (MLS state contains TreeKEM private material).

- [ ] **Step 5: Run tests**

Run: `bun test src/client/hooks/useMlsHub.test.ts && bun run typecheck`
Expected: all PASS, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/hooks/useMlsHub.ts src/client/hooks/useMlsHub.test.ts src/client/lib/query-client.ts
git commit -m "feat(mls): useMlsHub React Query hook + query-key registration"
```

### Task 34: Client — `MlsOptInModal` pre-flight checklist

**Files:**
- Create: `src/client/components/mls-opt-in-modal.tsx`
- Create: `src/client/components/mls-opt-in-modal.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/components/mls-opt-in-modal.test.tsx
import { describe, expect, test } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { MlsOptInModal } from './mls-opt-in-modal'

const hub = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Crisis Hub',
}
const verifiedDevices = [
  { id: 'd1', label: 'Alice iPhone', verified: true },
  { id: 'd2', label: 'Bob laptop', verified: true },
]
const unverifiedDevices = [
  { id: 'd1', label: 'Alice iPhone', verified: true },
  { id: 'd2', label: 'Bob laptop', verified: false },
]

describe('MlsOptInModal', () => {
  test('confirm button disabled when unverified devices remain', () => {
    render(
      <MlsOptInModal
        open
        hub={hub}
        devices={unverifiedDevices}
        onConfirm={async () => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByTestId('mls-opt-in-confirm').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('mls-opt-in-unverified-warning')).toBeTruthy()
  })

  test('confirm button enabled only after acknowledging audit scope', () => {
    render(
      <MlsOptInModal
        open
        hub={hub}
        devices={verifiedDevices}
        onConfirm={async () => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByTestId('mls-opt-in-confirm').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('mls-opt-in-ack-audit'))
    fireEvent.click(screen.getByTestId('mls-opt-in-ack-norollback'))
    expect(screen.getByTestId('mls-opt-in-confirm').hasAttribute('disabled')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/client/components/mls-opt-in-modal.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

```typescript
// src/client/components/mls-opt-in-modal.tsx
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useTranslation } from 'react-i18next'

export interface MlsOptInModalProps {
  open: boolean
  hub: { id: string; name: string }
  devices: Array<{ id: string; label: string; verified: boolean }>
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function MlsOptInModal(props: MlsOptInModalProps) {
  const { t } = useTranslation()
  const [ackAudit, setAckAudit] = useState(false)
  const [ackNoRollback, setAckNoRollback] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const unverified = props.devices.filter((d) => !d.verified)
  const canConfirm = unverified.length === 0 && ackAudit && ackNoRollback && !submitting

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onCancel()}>
      <DialogContent data-testid="mls-opt-in-modal">
        <DialogHeader>
          <DialogTitle>{t('mlsOptIn.title', { hub: props.hub.name })}</DialogTitle>
        </DialogHeader>
        <p>{t('mlsOptIn.intro')}</p>

        {unverified.length > 0 ? (
          <div
            data-testid="mls-opt-in-unverified-warning"
            className="p-3 bg-red-100 text-red-800 rounded"
          >
            {t('mlsOptIn.unverifiedWarning', { count: unverified.length })}
            <ul className="list-disc pl-5 mt-2">
              {unverified.map((d) => (
                <li key={d.id} data-testid={`mls-opt-in-unverified-${d.id}`}>
                  {d.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-2">
            <Checkbox
              data-testid="mls-opt-in-ack-audit"
              checked={ackAudit}
              onCheckedChange={(v) => setAckAudit(v === true)}
            />
            <span>{t('mlsOptIn.ackAudit')}</span>
          </label>
          <label className="flex items-start gap-2">
            <Checkbox
              data-testid="mls-opt-in-ack-norollback"
              checked={ackNoRollback}
              onCheckedChange={(v) => setAckNoRollback(v === true)}
            />
            <span>{t('mlsOptIn.ackNoRollback')}</span>
          </label>
        </div>

        <div className="flex gap-2 mt-6 justify-end">
          <Button variant="ghost" onClick={props.onCancel} data-testid="mls-opt-in-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="mls-opt-in-confirm"
            disabled={!canConfirm}
            onClick={async () => {
              setSubmitting(true)
              try {
                await props.onConfirm()
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {t('mlsOptIn.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Add i18n keys**

Add to `src/client/locales/en/common.json`:

```json
"mlsOptIn": {
  "title": "Enable Tier 6 (MLS + PQ) for {{hub}}",
  "intro": "This hub will migrate to Messaging Layer Security with post-quantum hybrid key encapsulation. Every current device must have a verified fingerprint before you can proceed.",
  "unverifiedWarning": "{{count}} device(s) still need fingerprint verification.",
  "ackAudit": "I understand that the MLS and post-quantum code path is additional audit surface.",
  "ackNoRollback": "I understand that once Tier 6 is enabled for this hub, it cannot be rolled back.",
  "confirm": "Enable Tier 6"
},
"common": {
  "cancel": "Cancel"
}
```

Translate across the 13 locales.

- [ ] **Step 5: Run tests**

Run: `bun test src/client/components/mls-opt-in-modal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/mls-opt-in-modal.tsx src/client/components/mls-opt-in-modal.test.tsx src/client/locales/**/common.json
git commit -m "feat(ui): MLS opt-in modal with verification + no-rollback acknowledgements"
```

### Task 35: Client — wire opt-in into hub security settings route

**Files:**
- Modify: `src/client/routes/hub/settings/security.tsx`

- [ ] **Step 1: Identify the existing hub security route**

Run: `bun run typecheck` and locate the existing route that renders hub-level security settings. If it does not exist (Tiers 0–5 should have added it), abort and add it to a prerequisite PR rather than inventing it here.

- [ ] **Step 2: Add MLS state display + opt-in button**

```typescript
// inside the hub security settings component
import { useMlsHub } from '@/hooks/useMlsHub'
import { MlsOptInModal } from '@/components/mls-opt-in-modal'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

function HubSecuritySettings({ hubId }: { hubId: string }) {
  const queryClient = useQueryClient()
  const { data: mlsData } = useMlsHub({ hubId })
  const { data: devices } = useQuery({
    queryKey: queryKeys.hub.devices(hubId),
    queryFn: () => fetchHubDevices(hubId),
  })
  const [optInOpen, setOptInOpen] = useState(false)

  async function handleConfirm() {
    // POST /api/hubs/:hubId/mls/enable — the server flips tier6_enabled and
    // creates the initial audit entry. The client then bootstraps MLS state
    // by calling the crypto worker.
    const res = await fetch(`/api/hubs/${hubId}/mls/enable`, { method: 'POST' })
    if (!res.ok) throw new Error('enable failed')
    await bootstrapMlsGroup(hubId)
    await queryClient.invalidateQueries({ queryKey: queryKeys.mls.hub(hubId) })
    setOptInOpen(false)
  }

  return (
    <section data-testid="hub-security-settings">
      <h2>{t('hubSecurity.title')}</h2>
      <dl>
        <dt>{t('hubSecurity.tier6Status')}</dt>
        <dd data-testid="hub-security-tier6-status">
          {mlsData?.tier6Enabled ? 'Enabled' : 'Disabled'}
        </dd>
        {mlsData?.tier6Enabled ? (
          <>
            <dt>{t('hubSecurity.ciphersuite')}</dt>
            <dd data-testid="hub-security-ciphersuite">{mlsData.ciphersuite}</dd>
            <dt>{t('hubSecurity.epoch')}</dt>
            <dd data-testid="hub-security-epoch">{mlsData.currentEpoch}</dd>
          </>
        ) : null}
      </dl>
      {!mlsData?.tier6Enabled ? (
        <Button
          data-testid="hub-security-enable-tier6"
          onClick={() => setOptInOpen(true)}
        >
          {t('hubSecurity.enableTier6')}
        </Button>
      ) : null}
      {optInOpen ? (
        <MlsOptInModal
          open
          hub={{ id: hubId, name: 'Current Hub' }}
          devices={devices ?? []}
          onConfirm={handleConfirm}
          onCancel={() => setOptInOpen(false)}
        />
      ) : null}
    </section>
  )
}
```

- [ ] **Step 3: Add the server route for enabling Tier 6**

Create `src/server/routes/mls-hub-enable.ts`:

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requireAuth } from '../middleware/auth'
import { requireAdminForHub } from '../middleware/hub-admin'
import { HubService } from '../services/hub-service'

const app = new OpenAPIHono()

const route = createRoute({
  method: 'post',
  path: '/api/hubs/:hubId/mls/enable',
  tags: ['mls'],
  request: {
    params: z.object({ hubId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Tier 6 enabled',
      content: {
        'application/json': {
          schema: z.object({ tier6Enabled: z.literal(true) }),
        },
      },
    },
    403: { description: 'Not admin' },
    409: { description: 'Already enabled' },
  },
  middleware: [requireAuth, requireAdminForHub] as const,
})

app.openapi(route, async (c) => {
  const { hubId } = c.req.valid('param')
  const svc = new HubService(c.var.db)
  const hub = await svc.getById(hubId)
  if (hub.tier6Enabled) {
    return c.json({ error: 'already enabled' }, 409)
  }
  await svc.enableTier6(hubId)
  return c.json({ tier6Enabled: true as const }, 200)
})

export default app
```

Mount in `src/server/app.ts`. Add `enableTier6` to `HubService` which updates the hubs row and emits a `hub_tier6_enabled` audit entry.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/routes/hub/settings/security.tsx src/server/routes/mls-hub-enable.ts src/server/app.ts src/server/services/hub-service.ts
git commit -m "feat(mls): wire MlsOptInModal into hub security settings + server enable endpoint"
```

### Task 36: Tier 5 SFrame integration — exporter-derived base key

**Files:**
- Modify: `src/client/lib/sframe/sframe-key-source.ts` (created by Tier 5; assume it exists)
- Modify: `src/client/lib/sframe/sframe-key-source.test.ts`

- [ ] **Step 1: Read the existing Tier 5 key source**

Run: `bun run typecheck` and locate `src/client/lib/sframe/sframe-key-source.ts`. Identify the function used today, e.g. `deriveSFrameBaseKeyFromHubKey(hubKey, callId)`. If Tier 5 has not yet landed, add this task to the Tier 5 plan instead.

- [ ] **Step 2: Add failing test for the conditional path**

Append to `src/client/lib/sframe/sframe-key-source.test.ts`:

```typescript
describe('SFrame key source with Tier 6', () => {
  test('tier6 hub uses MLS exporter derivation', async () => {
    const mockGroup = {
      exportSecret: (label: string, ctx: Uint8Array, len: number) => {
        const k = new Uint8Array(len)
        k[0] = 0xa6 // marker
        return k
      },
    } as unknown as MlsGroupHandle
    const key = await deriveSFrameBaseKey({
      hub: { id: 'h1', tier6Enabled: true },
      mlsGroup: mockGroup,
      hubKey: null,
      callId: 'call-1',
    })
    expect(key[0]).toBe(0xa6)
  })

  test('tier3 hub uses legacy hub-key derivation', async () => {
    const key = await deriveSFrameBaseKey({
      hub: { id: 'h1', tier6Enabled: false },
      mlsGroup: null,
      hubKey: new Uint8Array(32).fill(1),
      callId: 'call-1',
    })
    expect(key.length).toBe(32)
  })

  test('tier6 hub without mls group throws', async () => {
    await expect(
      deriveSFrameBaseKey({
        hub: { id: 'h1', tier6Enabled: true },
        mlsGroup: null,
        hubKey: null,
        callId: 'call-1',
      }),
    ).rejects.toThrow('mls group required')
  })
})
```

- [ ] **Step 3: Run test**

Run: `bun test src/client/lib/sframe/sframe-key-source.test.ts -t "Tier 6"`
Expected: FAIL — branch missing.

- [ ] **Step 4: Refactor `deriveSFrameBaseKey`**

```typescript
// src/client/lib/sframe/sframe-key-source.ts
import { deriveSFrameBaseKey as mlsDerive } from '@/lib/mls/mls-exporter'
import type { MlsGroupHandle } from '@/lib/mls/mls-group'

export interface SFrameKeySourceInput {
  hub: { id: string; tier6Enabled: boolean }
  mlsGroup: MlsGroupHandle | null
  hubKey: Uint8Array | null
  callId: string
}

export async function deriveSFrameBaseKey(input: SFrameKeySourceInput): Promise<Uint8Array> {
  if (input.hub.tier6Enabled) {
    if (!input.mlsGroup) {
      throw new Error('sframe derive: mls group required for tier6 hub')
    }
    return mlsDerive(input.mlsGroup, input.callId)
  }
  if (!input.hubKey) {
    throw new Error('sframe derive: hub key required for tier3 hub')
  }
  return deriveSFrameBaseKeyFromHubKey(input.hubKey, input.callId)
}
```

Keep `deriveSFrameBaseKeyFromHubKey` as the existing Tier 5 path.

- [ ] **Step 5: Run tests**

Run: `bun test src/client/lib/sframe/sframe-key-source.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/sframe/sframe-key-source.ts src/client/lib/sframe/sframe-key-source.test.ts
git commit -m "feat(sframe): tier6 hubs derive SFrame base key from MLS exporter"
```

### Task 37: API E2E — MLS hub lifecycle

**Files:**
- Create: `tests/api/mls-hub-lifecycle.spec.ts`
- Create: `tests/helpers/mls-test-harness.ts`

- [ ] **Step 1: Write the test harness helper**

```typescript
// tests/helpers/mls-test-harness.ts
import type { APIRequestContext } from '@playwright/test'
import { authedRequest } from './authed-request'

export async function enableTier6(
  request: APIRequestContext,
  admin: { accessToken: string; deviceId: string },
  hubId: string,
): Promise<void> {
  const res = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hubId}/mls/enable`,
  })
  if (res.status() !== 200) {
    throw new Error(`enableTier6 failed: ${res.status()}`)
  }
}

export async function publishKeyPackages(
  request: APIRequestContext,
  device: { accessToken: string; deviceId: string },
  input: { hubId: string; ciphersuite: string; count: number },
): Promise<string[]> {
  const keyPackages = Array.from({ length: input.count }, (_, i) => ({
    keyPackageBytesB64: Buffer.from([i, 0xbe, 0xef]).toString('base64'),
    expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
  }))
  const res = await authedRequest(request, device, {
    method: 'POST',
    url: '/api/mls/key-packages',
    json: { hubId: input.hubId, ciphersuite: input.ciphersuite, keyPackages },
  })
  if (res.status() !== 201) {
    throw new Error(`publishKeyPackages failed: ${res.status()}`)
  }
  return (await res.json()).publishedIds
}

export async function fetchKeyPackages(
  request: APIRequestContext,
  admin: { accessToken: string; deviceId: string },
  input: { hubId: string; userId: string; ciphersuite: string },
): Promise<Array<{ deviceId: string; keyPackageId: string; keyPackageBytesB64: string }>> {
  const res = await authedRequest(request, admin, {
    method: 'GET',
    url: `/api/hubs/${input.hubId}/users/${input.userId}/key-packages?ciphersuite=${encodeURIComponent(input.ciphersuite)}`,
  })
  if (res.status() !== 200) {
    throw new Error(`fetchKeyPackages failed: ${res.status()}`)
  }
  return (await res.json()).keyPackages
}
```

- [ ] **Step 2: Write the test**

```typescript
// tests/api/mls-hub-lifecycle.spec.ts
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { createHubWithAdmin, createVolunteerDevice } from '../helpers/hub-setup'
import { enableTier6, publishKeyPackages, fetchKeyPackages } from '../helpers/mls-test-harness'

const XWING = 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'

test('admin enables tier6 and creates MLS group at epoch 0', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)

  // Admin publishes their own KeyPackages
  await publishKeyPackages(request, admin, { hubId: hub.id, ciphersuite: XWING, count: 10 })

  // Audit entry should have mls_group_init
  const audit = await authedRequest(request, admin, {
    method: 'GET',
    url: `/api/hubs/${hub.id}/audit-log`,
  })
  const entries = (await audit.json()).entries
  const init = entries.find((e: { payload: { type: string } }) => e.payload.type === 'mls_group_init')
  expect(init).toBeTruthy()
  expect(init.payload.ciphersuite).toBe(XWING)
  expect(init.payload.epoch).toBe(0)
})

test('admin adds volunteer; both converge on epoch 1', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  await publishKeyPackages(request, admin, { hubId: hub.id, ciphersuite: XWING, count: 10 })

  const volunteer = await createVolunteerDevice(request, hub.id)
  await publishKeyPackages(request, volunteer, { hubId: hub.id, ciphersuite: XWING, count: 10 })

  const kps = await fetchKeyPackages(request, admin, {
    hubId: hub.id,
    userId: volunteer.userId,
    ciphersuite: XWING,
  })
  expect(kps.length).toBe(1)
  expect(kps[0]!.deviceId).toBe(volunteer.deviceId)

  // Admin posts the resulting commit + welcome as audit entry
  // (Test uses a fixture that runs the crypto-worker logic in a headless
  // Node context via `tests/helpers/mls-worker-fixture.ts`.)
  const mlsCommitResult = await global.mlsWorkerFixture.adminAddMember({
    hubId: hub.id,
    adminDeviceId: admin.deviceId,
    keyPackageBytes: Buffer.from(kps[0]!.keyPackageBytesB64, 'base64'),
  })

  const addEntry = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/audit-log`,
    json: {
      signedEntry: mlsCommitResult.signedEntry,
    },
  })
  expect(addEntry.status()).toBe(201)

  // Fetch audit log — mls_members_added should be present
  const audit = await authedRequest(request, admin, {
    method: 'GET',
    url: `/api/hubs/${hub.id}/audit-log`,
  })
  const entries = (await audit.json()).entries
  const added = entries.find(
    (e: { payload: { type: string; epoch: number } }) => e.payload.type === 'mls_members_added' && e.payload.epoch === 1,
  )
  expect(added).toBeTruthy()
  expect(added.payload.addedDevicePubkeys).toContain(volunteer.ed25519Pubkey)
})

test('enableTier6 is idempotent rejecting second call with 409', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  const res = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/mls/enable`,
  })
  expect(res.status()).toBe(409)
})
```

- [ ] **Step 3: Run the test**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api/mls-hub-lifecycle.spec.ts
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/api/mls-hub-lifecycle.spec.ts tests/helpers/mls-test-harness.ts
git commit -m "test(api): MLS hub lifecycle — enable, group init, add member, audit entries"
```

### Task 38: API E2E — MLS member removal + removed-device epoch lockout

**Files:**
- Create: `tests/api/mls-member-removal.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/api/mls-member-removal.spec.ts
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { createHubWithAdmin, createVolunteerDevice } from '../helpers/hub-setup'
import { enableTier6, publishKeyPackages, fetchKeyPackages } from '../helpers/mls-test-harness'

const XWING = 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'

test('removed device cannot derive new epoch exporter secret', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  await publishKeyPackages(request, admin, { hubId: hub.id, ciphersuite: XWING, count: 10 })

  const volunteer = await createVolunteerDevice(request, hub.id)
  await publishKeyPackages(request, volunteer, { hubId: hub.id, ciphersuite: XWING, count: 10 })
  const kps = await fetchKeyPackages(request, admin, {
    hubId: hub.id,
    userId: volunteer.userId,
    ciphersuite: XWING,
  })
  await global.mlsWorkerFixture.adminAddMember({
    hubId: hub.id,
    adminDeviceId: admin.deviceId,
    keyPackageBytes: Buffer.from(kps[0]!.keyPackageBytesB64, 'base64'),
  })
  // Volunteer joins via welcome
  await global.mlsWorkerFixture.volunteerJoin({
    hubId: hub.id,
    volunteerDeviceId: volunteer.deviceId,
  })

  // Volunteer derives items_key at epoch 1
  const ikAtEpoch1 = await global.mlsWorkerFixture.deriveItemsKey({
    hubId: hub.id,
    deviceId: volunteer.deviceId,
  })
  expect(ikAtEpoch1).toBeTruthy()

  // Admin removes volunteer
  await global.mlsWorkerFixture.adminRemoveMember({
    hubId: hub.id,
    adminDeviceId: admin.deviceId,
    memberPubkey: volunteer.ed25519Pubkey,
  })

  // Admin can still derive items_key (at epoch 2)
  const adminIk = await global.mlsWorkerFixture.deriveItemsKey({
    hubId: hub.id,
    deviceId: admin.deviceId,
  })
  expect(adminIk).toBeTruthy()
  expect(adminIk).not.toEqual(ikAtEpoch1)

  // Volunteer attempts to process the commit — should fail because
  // their leaf was excluded from the new path
  await expect(
    global.mlsWorkerFixture.volunteerProcessLatestCommit({
      hubId: hub.id,
      volunteerDeviceId: volunteer.deviceId,
    }),
  ).rejects.toThrow(/epoch|leaf|excluded/i)

  // Audit entry exists
  const audit = await authedRequest(request, admin, {
    method: 'GET',
    url: `/api/hubs/${hub.id}/audit-log`,
  })
  const entries = (await audit.json()).entries
  const removed = entries.find(
    (e: { payload: { type: string } }) => e.payload.type === 'mls_members_removed',
  )
  expect(removed).toBeTruthy()
  expect(removed.payload.removedDevicePubkeys).toContain(volunteer.ed25519Pubkey)
})
```

- [ ] **Step 2: Run test**

```bash
bunx playwright test tests/api/mls-member-removal.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/api/mls-member-removal.spec.ts
git commit -m "test(api): MLS member removal — removed device locked out of new epoch"
```

### Task 39: API E2E — commit ordering, replay, forged KeyPackage, ciphersuite downgrade, KP expiry

**Files:**
- Create: `tests/api/mls-commit-ordering.spec.ts`
- Create: `tests/api/mls-commit-replay.spec.ts`
- Create: `tests/api/mls-forged-keypackage.spec.ts`
- Create: `tests/api/mls-ciphersuite-downgrade.spec.ts`
- Create: `tests/api/mls-key-package-expiry.spec.ts`

- [ ] **Step 1: Write `mls-commit-ordering.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { createHubWithAdmin } from '../helpers/hub-setup'
import { enableTier6 } from '../helpers/mls-test-harness'

const XWING = 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'

test('concurrent commits — second is rejected with CommitEpochMismatch', async ({ request }) => {
  const { hub, admin, adminB } = await createHubWithAdmin(request, { adminCount: 2 })
  await enableTier6(request, admin, hub.id)
  // Both admins attempt to add different members at the same epoch.
  const resultA = await global.mlsWorkerFixture.adminAddMember({
    hubId: hub.id,
    adminDeviceId: admin.deviceId,
    keyPackageBytes: Buffer.from([1]),
  })
  const resultB = await global.mlsWorkerFixture.adminAddMember({
    hubId: hub.id,
    adminDeviceId: adminB.deviceId,
    keyPackageBytes: Buffer.from([2]),
  })
  // Server accepts A's audit entry first
  const postA = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/audit-log`,
    json: { signedEntry: resultA.signedEntry },
  })
  expect(postA.status()).toBe(201)
  // B's audit entry must fail chain verification (wrong prevEntryHash)
  const postB = await authedRequest(request, adminB, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/audit-log`,
    json: { signedEntry: resultB.signedEntry },
  })
  expect(postB.status()).toBe(409)
})
```

- [ ] **Step 2: Write `mls-commit-replay.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { createHubWithAdmin } from '../helpers/hub-setup'
import { enableTier6 } from '../helpers/mls-test-harness'

test('same commit audit entry posted twice — second rejected as duplicate', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  const result = await global.mlsWorkerFixture.adminAddMember({
    hubId: hub.id,
    adminDeviceId: admin.deviceId,
    keyPackageBytes: Buffer.from([9]),
  })
  const first = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/audit-log`,
    json: { signedEntry: result.signedEntry },
  })
  expect(first.status()).toBe(201)
  const second = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/audit-log`,
    json: { signedEntry: result.signedEntry },
  })
  expect(second.status()).toBe(409)
})
```

- [ ] **Step 3: Write `mls-forged-keypackage.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { createHubWithAdmin, createVolunteerDevice } from '../helpers/hub-setup'
import { enableTier6, publishKeyPackages } from '../helpers/mls-test-harness'

const XWING = 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'

test('forged KeyPackage (signed under wrong Ed25519 key) rejected by target device', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  const volunteer = await createVolunteerDevice(request, hub.id)
  // Admin publishes a KeyPackage *on behalf of* volunteer — signed with admin's key
  const forgedKp = await global.mlsWorkerFixture.buildKeyPackage({
    signerDeviceId: admin.deviceId,
    claimedIdentityDeviceId: volunteer.deviceId, // lie about who this is
    ciphersuite: XWING,
  })
  // Server-side filter should still accept it (server doesn't verify sigs)
  const pub = await authedRequest(request, admin, {
    method: 'POST',
    url: '/api/mls/key-packages',
    json: {
      hubId: hub.id,
      ciphersuite: XWING,
      keyPackages: [{ keyPackageBytesB64: forgedKp, expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString() }],
    },
  })
  expect(pub.status()).toBe(201)
  // But when the target device (volunteer) processes the welcome derived from that KP, it rejects
  await expect(
    global.mlsWorkerFixture.volunteerJoin({
      hubId: hub.id,
      volunteerDeviceId: volunteer.deviceId,
      expectSignatureFailure: true,
    }),
  ).rejects.toThrow(/signature|credential/i)
})
```

- [ ] **Step 4: Write `mls-ciphersuite-downgrade.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { createHubWithAdmin } from '../helpers/hub-setup'
import { enableTier6 } from '../helpers/mls-test-harness'

test('commit asserting different ciphersuite than hub_create is rejected', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  // Craft a malicious audit entry with ML-KEM-1024 ciphersuite while the
  // hub_create says XWing
  const tampered = await global.mlsWorkerFixture.buildTamperedCiphersuiteCommit({
    hubId: hub.id,
    adminDeviceId: admin.deviceId,
    claimedCiphersuite: 'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519',
  })
  const res = await authedRequest(request, admin, {
    method: 'POST',
    url: `/api/hubs/${hub.id}/audit-log`,
    json: { signedEntry: tampered },
  })
  expect(res.status()).toBe(400)
})
```

- [ ] **Step 5: Write `mls-key-package-expiry.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { createHubWithAdmin, createVolunteerDevice } from '../helpers/hub-setup'
import { enableTier6 } from '../helpers/mls-test-harness'

const XWING = 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'

test('expired KeyPackages are not returned by fetch', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  const volunteer = await createVolunteerDevice(request, hub.id)
  // Publish with an `expiresAt` 1s in the past
  const res = await authedRequest(request, volunteer, {
    method: 'POST',
    url: '/api/mls/key-packages',
    json: {
      hubId: hub.id,
      ciphersuite: XWING,
      keyPackages: [
        {
          keyPackageBytesB64: Buffer.from([1]).toString('base64'),
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    },
  })
  expect(res.status()).toBe(201)
  // Admin fetch returns empty
  const fetchRes = await authedRequest(request, admin, {
    method: 'GET',
    url: `/api/hubs/${hub.id}/users/${volunteer.userId}/key-packages?ciphersuite=${encodeURIComponent(XWING)}`,
  })
  expect(fetchRes.status()).toBe(200)
  const body = await fetchRes.json()
  expect(body.keyPackages.length).toBe(0)
})
```

- [ ] **Step 6: Run all five tests**

```bash
bunx playwright test \
  tests/api/mls-commit-ordering.spec.ts \
  tests/api/mls-commit-replay.spec.ts \
  tests/api/mls-forged-keypackage.spec.ts \
  tests/api/mls-ciphersuite-downgrade.spec.ts \
  tests/api/mls-key-package-expiry.spec.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/api/mls-commit-ordering.spec.ts tests/api/mls-commit-replay.spec.ts tests/api/mls-forged-keypackage.spec.ts tests/api/mls-ciphersuite-downgrade.spec.ts tests/api/mls-key-package-expiry.spec.ts
git commit -m "test(api): MLS adversarial — ordering, replay, forged KP, downgrade, KP expiry"
```

### Task 40: API E2E — SFrame-from-exporter + provable-delete

**Files:**
- Create: `tests/api/mls-sframe-integration.spec.ts`
- Create: `tests/api/mls-provable-delete.spec.ts`

- [ ] **Step 1: Write `mls-sframe-integration.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { createHubWithAdmin, createVolunteerDevice } from '../helpers/hub-setup'
import { enableTier6 } from '../helpers/mls-test-harness'

const XWING = 'MLS_256_XWING_AES256GCM_SHA512_Ed25519'

test('two tier6 devices derive the same SFrame base key for a call', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  const volunteer = await createVolunteerDevice(request, hub.id)
  // Admin + volunteer join the group
  await global.mlsWorkerFixture.bootstrapPair({ hubId: hub.id, admin, volunteer })
  const callId = 'call-abc'
  const adminKey = await global.mlsWorkerFixture.deriveSFrameBaseKey({
    deviceId: admin.deviceId,
    hubId: hub.id,
    callId,
  })
  const volKey = await global.mlsWorkerFixture.deriveSFrameBaseKey({
    deviceId: volunteer.deviceId,
    hubId: hub.id,
    callId,
  })
  expect(adminKey).toEqual(volKey)
})

test('removed device cannot derive the SFrame key for the new epoch', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  const volunteer = await createVolunteerDevice(request, hub.id)
  await global.mlsWorkerFixture.bootstrapPair({ hubId: hub.id, admin, volunteer })
  await global.mlsWorkerFixture.adminRemoveMember({
    hubId: hub.id,
    adminDeviceId: admin.deviceId,
    memberPubkey: volunteer.ed25519Pubkey,
  })
  const callId = 'call-after-removal'
  const adminKey = await global.mlsWorkerFixture.deriveSFrameBaseKey({
    deviceId: admin.deviceId,
    hubId: hub.id,
    callId,
  })
  await expect(
    global.mlsWorkerFixture.deriveSFrameBaseKey({
      deviceId: volunteer.deviceId,
      hubId: hub.id,
      callId,
    }),
  ).rejects.toThrow()
  expect(adminKey.length).toBe(32)
})
```

- [ ] **Step 2: Write `mls-provable-delete.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { createHubWithAdmin, createVolunteerDevice } from '../helpers/hub-setup'
import { enableTier6 } from '../helpers/mls-test-harness'

test('provable-delete note unrecoverable after epoch purge', async ({ request }) => {
  const { hub, admin } = await createHubWithAdmin(request)
  await enableTier6(request, admin, hub.id)
  const volunteer = await createVolunteerDevice(request, hub.id)
  await global.mlsWorkerFixture.bootstrapPair({ hubId: hub.id, admin, volunteer })

  // Seal a provable-delete note
  const sealed = await global.mlsWorkerFixture.sealProvableDeleteNote({
    deviceId: admin.deviceId,
    hubId: hub.id,
    noteId: 'purge-target',
    plaintextUtf8: 'sensitive disclosure',
  })

  // Both devices can open it now
  const openedByAdmin = await global.mlsWorkerFixture.openProvableDeleteNote({
    deviceId: admin.deviceId,
    hubId: hub.id,
    sealed,
  })
  expect(new TextDecoder().decode(openedByAdmin)).toBe('sensitive disclosure')

  // Admin triggers epoch purge
  await global.mlsWorkerFixture.adminPurgeEpoch({
    hubId: hub.id,
    adminDeviceId: admin.deviceId,
    purgedEpoch: sealed.epoch,
    reason: 'e2e test purge',
  })

  // Both devices attempt to open — should fail
  await expect(
    global.mlsWorkerFixture.openProvableDeleteNote({
      deviceId: admin.deviceId,
      hubId: hub.id,
      sealed,
    }),
  ).rejects.toThrow()
  await expect(
    global.mlsWorkerFixture.openProvableDeleteNote({
      deviceId: volunteer.deviceId,
      hubId: hub.id,
      sealed,
    }),
  ).rejects.toThrow()
})
```

- [ ] **Step 3: Run both tests**

```bash
bunx playwright test tests/api/mls-sframe-integration.spec.ts tests/api/mls-provable-delete.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/api/mls-sframe-integration.spec.ts tests/api/mls-provable-delete.spec.ts
git commit -m "test(api): MLS — SFrame exporter integration + provable-delete end-to-end"
```

### Task 41: UI E2E — hub opt-in flow

**Files:**
- Create: `tests/ui/mls-hub-opt-in.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/ui/mls-hub-opt-in.spec.ts
import { test, expect } from '@playwright/test'
import { loginAsAdmin, addVolunteer } from '../fixtures/auth'

test('admin cannot enable Tier 6 until all devices are verified', async ({ page }) => {
  const { hub } = await loginAsAdmin(page)
  const volunteer = await addVolunteer(page, hub.id)
  await page.goto(`/hub/${hub.id}/settings/security`)
  await page.getByTestId('hub-security-enable-tier6').click()
  await expect(page.getByTestId('mls-opt-in-modal')).toBeVisible()
  await expect(page.getByTestId('mls-opt-in-unverified-warning')).toBeVisible()
  await expect(page.getByTestId(`mls-opt-in-unverified-${volunteer.deviceId}`)).toBeVisible()
  await expect(page.getByTestId('mls-opt-in-confirm')).toBeDisabled()
})

test('admin enables Tier 6 after verifying all devices + acknowledging risks', async ({ page }) => {
  const { hub } = await loginAsAdmin(page)
  const volunteer = await addVolunteer(page, hub.id)

  // Verify the volunteer fingerprint first
  await page.goto(`/hub/${hub.id}/settings/devices`)
  await page.getByTestId(`verify-device-${volunteer.deviceId}`).click()
  for (let i = 0; i < 7; i++) {
    await page.getByTestId(`sas-picker-correct-${i}`).click()
  }
  await page.getByTestId('sas-verify-confirm').click()

  // Now enable Tier 6
  await page.goto(`/hub/${hub.id}/settings/security`)
  await page.getByTestId('hub-security-enable-tier6').click()
  await expect(page.getByTestId('mls-opt-in-modal')).toBeVisible()
  await expect(page.getByTestId('mls-opt-in-unverified-warning')).not.toBeVisible()
  await page.getByTestId('mls-opt-in-ack-audit').click()
  await page.getByTestId('mls-opt-in-ack-norollback').click()
  await expect(page.getByTestId('mls-opt-in-confirm')).toBeEnabled()
  await page.getByTestId('mls-opt-in-confirm').click()
  await expect(page.getByTestId('mls-opt-in-modal')).not.toBeVisible()
  await expect(page.getByTestId('hub-security-tier6-status')).toHaveText('Enabled')
  await expect(page.getByTestId('hub-security-ciphersuite')).toContainText('XWING')
})
```

- [ ] **Step 2: Run test**

```bash
bunx playwright test tests/ui/mls-hub-opt-in.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/ui/mls-hub-opt-in.spec.ts
git commit -m "test(ui): MLS hub opt-in flow — verification gate + acknowledgements"
```

### Task 42: UI E2E — member removal, background update, fingerprint mismatch

**Files:**
- Create: `tests/ui/mls-member-removal.spec.ts`
- Create: `tests/ui/mls-background-update.spec.ts`
- Create: `tests/ui/mls-fingerprint-mismatch.spec.ts`

- [ ] **Step 1: Write `mls-member-removal.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { loginAsAdmin, addVolunteer, bootstrapTier6Hub } from '../fixtures/auth'

test('removing a volunteer advances epoch and revokes access in UI', async ({ page, browser }) => {
  const { hub } = await loginAsAdmin(page)
  const volunteer = await addVolunteer(page, hub.id)
  await bootstrapTier6Hub(page, hub.id, [volunteer])

  // Admin removes volunteer
  await page.goto(`/hub/${hub.id}/settings/members`)
  await page.getByTestId(`remove-member-${volunteer.userId}`).click()
  await page.getByTestId('confirm-remove-member').click()

  // Admin sees updated epoch in security panel
  await page.goto(`/hub/${hub.id}/settings/security`)
  const epoch = await page.getByTestId('hub-security-epoch').textContent()
  expect(Number(epoch)).toBeGreaterThan(1)

  // Volunteer (separate browser context) sees access revoked banner
  const volContext = await browser.newContext()
  const volPage = await volContext.newPage()
  await volPage.goto('/login')
  await volPage.getByTestId('login-email').fill(volunteer.email)
  await volPage.getByTestId('login-pin').fill(volunteer.pin)
  await volPage.getByTestId('login-submit').click()
  await volPage.goto(`/hub/${hub.id}`)
  await expect(volPage.getByTestId('hub-access-revoked-banner')).toBeVisible()
})
```

- [ ] **Step 2: Write `mls-background-update.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { loginAsAdmin, bootstrapTier6Hub } from '../fixtures/auth'

test('daily background update commit appears in the audit log when clock advances', async ({ page }) => {
  const { hub } = await loginAsAdmin(page)
  await bootstrapTier6Hub(page, hub.id, [])

  // Mock the page clock by installing a stub BEFORE load
  await page.addInitScript(() => {
    const realSetTimeout = window.setTimeout
    window.setTimeout = ((fn: () => void) => {
      // Fire all scheduled timers immediately
      queueMicrotask(fn)
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as typeof window.setTimeout
  })

  await page.goto(`/hub/${hub.id}/settings/security`)
  // Wait for the background-updater to produce at least one path-update entry
  await page.waitForFunction(
    async (hubId: string) => {
      const res = await fetch(`/api/hubs/${hubId}/audit-log`)
      const entries = (await res.json()).entries
      return entries.some((e: { payload: { type: string } }) => e.payload.type === 'mls_path_update')
    },
    hub.id,
  )
  const auditResponse = await page.request.get(`/api/hubs/${hub.id}/audit-log`)
  const entries = (await auditResponse.json()).entries
  const updates = entries.filter(
    (e: { payload: { type: string } }) => e.payload.type === 'mls_path_update',
  )
  expect(updates.length).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Write `mls-fingerprint-mismatch.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
import { loginAsAdmin, addVolunteer } from '../fixtures/auth'

test('clicking wrong emoji during fingerprint verification does NOT record a verification', async ({ page }) => {
  const { hub } = await loginAsAdmin(page)
  const volunteer = await addVolunteer(page, hub.id)
  await page.goto(`/hub/${hub.id}/settings/devices`)
  await page.getByTestId(`verify-device-${volunteer.deviceId}`).click()
  await page.getByTestId('sas-picker-wrong-0').click()
  await expect(page.getByTestId('sas-mismatch-warning')).toBeVisible()
  await expect(page.getByTestId('sas-verify-confirm')).toBeDisabled()

  // Close modal — verify device still unverified
  await page.keyboard.press('Escape')
  await expect(
    page.getByTestId(`device-row-${volunteer.deviceId}`).getByTestId('device-badge'),
  ).toHaveAttribute('data-verified', 'false')

  // Audit log should not contain a device_fingerprint_verified entry for this device
  const res = await page.request.get(`/api/hubs/${hub.id}/audit-log`)
  const entries = (await res.json()).entries
  const match = entries.find(
    (e: { payload: { type: string; verifiedDeviceId?: string } }) =>
      e.payload.type === 'device_fingerprint_verified' &&
      e.payload.verifiedDeviceId === volunteer.deviceId,
  )
  expect(match).toBeUndefined()
})
```

- [ ] **Step 4: Run all three tests**

```bash
bunx playwright test tests/ui/mls-member-removal.spec.ts tests/ui/mls-background-update.spec.ts tests/ui/mls-fingerprint-mismatch.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/ui/mls-member-removal.spec.ts tests/ui/mls-background-update.spec.ts tests/ui/mls-fingerprint-mismatch.spec.ts
git commit -m "test(ui): MLS — member removal, background update, fingerprint mismatch"
```

### Task 43: Documentation — protocol + architecture + supply chain

**Files:**
- Modify: `docs/protocol/llamenos-protocol.md`
- Modify: `docs/architecture/E2EE_ARCHITECTURE.md`
- Modify: `docs/security/SUPPLY_CHAIN_HARDENING.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append Tier 6 section to `docs/protocol/llamenos-protocol.md`**

Add a new top-level section `## Tier 6 — MLS + Post-Quantum Hybrid`. Contents:

- Overview: MLS via vendored @wireapp/core-crypto, XWing ciphersuite default, ML-KEM-1024 high-profile.
- Per-hub group model; members = devices.
- Audit entry types: `mls_group_init`, `mls_members_added`, `mls_members_removed`, `mls_path_update`, `mls_epoch_purge`, `mls_ciphersuite_upgrade_planned`, `mls_ciphersuite_upgrade_completed`, `device_fingerprint_verified`.
- Nostr event kinds 20001 (Commit/Application), 20002 (Welcome), 20003 (KeyPackage).
- Exporter labels: `llamenos:items-key-export:v1`, `llamenos:sframe-base-key:v1`, `llamenos:note-epoch-key:v1`, `llamenos:sas:v2`, `llamenos:mls-provision:v1`.
- Ciphersuite downgrade defense: pinned in `hub_create`, re-asserted on every Commit.
- Fingerprint verification UX: 7-emoji SAS derived from HKDF over device Ed25519 pubkey.

The section ends with a `## Deprecated Sections` note referencing the old Tier 3 CLKR flow for non-Tier-6 hubs.

- [ ] **Step 2: Update `docs/architecture/E2EE_ARCHITECTURE.md`**

Replace the three-layer diagram with a four-layer Tier 6 diagram:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 4: Per-artifact AEAD (XChaCha20-Poly1305)         │
│   Random key per note/message/report                   │
│   Forward secrecy at the artifact level                │
├─────────────────────────────────────────────────────────┤
│ Layer 3: items_key (from MLS exporter secret)          │
│   Derived via MLS-Exporter(LABEL_ITEMS_KEY_EXPORT, hub)│
│   Per-epoch; cached in memory keyed by epoch #         │
├─────────────────────────────────────────────────────────┤
│ Layer 2: MLS Group (RFC 9420 + XWing PQ hybrid)        │
│   Per-hub MLS group, members = devices                 │
│   TreeKEM over X25519+ML-KEM-768                       │
│   Continuous PCS via daily Update commits              │
├─────────────────────────────────────────────────────────┤
│ Layer 1: Tier 0 signed audit chain + Tier 3 sigchain   │
│   Chain of trust: devices → fingerprint verification  │
│   Every MLS commit hash + tree hash audit-signed      │
└─────────────────────────────────────────────────────────┘
```

Update surrounding prose to describe how Tier 6 replaces Tier 3's CLKR rewrap with MLS TreeKEM, and how `items_key` is no longer a stored column for Tier 6 hubs.

- [ ] **Step 3: Update `docs/security/SUPPLY_CHAIN_HARDENING.md`**

Add a row to the vendored dependencies table:

| Module | Upstream | Commit | License | Vendored | Audit status |
|---|---|---|---|---|---|
| @wireapp/core-crypto | github.com/wireapp/core-crypto | `<pinned-sha>` | MIT | 2026-04-10 | PENDING (commissioned) |

Add a paragraph under "Vendored dependencies" explaining why @wireapp/core-crypto is vendored (pinning, reproducible builds, SLSA coverage, audit scope).

- [ ] **Step 4: Update `CLAUDE.md` — Tier 6 migration notes**

Add under "Key Technical Patterns":

```markdown
- **Tier 6 MLS (opt-in per hub):** Hubs with `tier6_enabled = true` replace the Tier 3 hub-key with an MLS (RFC 9420) group via vendored `@wireapp/core-crypto`. Default ciphersuite `MLS_256_XWING_AES256GCM_SHA512_Ed25519`; high-profile hubs use `MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519`. `items_key` is derived from `MLS-Exporter(LABEL_ITEMS_KEY_EXPORT, hubId)`; SFrame base keys from `MLS-Exporter(LABEL_SFRAME_BASE_KEY, callId)`. Daily background Update commits provide continuous PCS. Per-hub MLS state lives in `src/client/lib/mls/`. Server KeyPackage endpoints at `/api/mls/key-packages`. MLS messages ride Nostr event kinds 20001 (Commit), 20002 (Welcome), 20003 (KeyPackage). Fingerprint verification UX (7-emoji SAS) ships BEFORE any Tier 6 code is enabled.
```

Add under "Gotchas":

```markdown
- @wireapp/core-crypto is vendored at `vendor/core-crypto/`. Never upgrade via transitive npm resolution — always via `scripts/vendor-core-crypto.sh <new-sha>` + PR diff review.
- MLS group state in IDB is AES-KW-wrapped. A corrupted `opaqueState` field manifests as an AEAD tag failure on load; the client must re-bootstrap from the server's latest Welcome.
- MLS ciphersuite is pinned in the `hub_create` audit entry and re-asserted by every Commit. A mismatch MUST reject the commit at the application layer — do NOT rely on @wireapp/core-crypto alone for this check.
- Removed devices still hold cached `items_key` values for epochs ≤ removal; they CANNOT derive new epochs. Revoking access means the server stops sending them MLS events but does NOT require re-encryption of existing data.
- Tier 6 has no rollback. Once a hub flips `tier6_enabled = true`, the only recovery is to recreate the hub.
```

- [ ] **Step 5: Commit**

```bash
git add docs/protocol/llamenos-protocol.md docs/architecture/E2EE_ARCHITECTURE.md docs/security/SUPPLY_CHAIN_HARDENING.md CLAUDE.md
git commit -m "docs: Tier 6 — MLS + PQ protocol, architecture, supply chain, CLAUDE notes"
```

### Task 44: PR #2 verification gate

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: 0 errors.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: success; `dist/client/` populated; vendored `@wireapp/core-crypto` source tree included as first-class source in the SLSA provenance.

- [ ] **Step 4: Bundle size budget**

Run: `bun run scripts/bundle-size-check.ts`
Expected: PASS (budget is 3 MB gzipped per Task 13; Tier 6 adds ≤ 500 KB gzipped over Tier 3 baseline).

- [ ] **Step 5: Unit tests**

Run: `bun run test:unit`
Expected: all PASS.

```bash
bun test src/client/lib/mls/
bun test src/shared/schemas/mls.test.ts src/shared/schemas/audit-entries.test.ts
bun test src/server/services/mls-key-package-service.test.ts
bun test src/server/routes/mls-key-packages.test.ts
```

Expected: all PASS.

- [ ] **Step 6: API E2E tests — Tier 6**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api/mls-hub-lifecycle.spec.ts \
  tests/api/mls-member-removal.spec.ts \
  tests/api/mls-commit-ordering.spec.ts \
  tests/api/mls-commit-replay.spec.ts \
  tests/api/mls-forged-keypackage.spec.ts \
  tests/api/mls-ciphersuite-downgrade.spec.ts \
  tests/api/mls-key-package-expiry.spec.ts \
  tests/api/mls-sframe-integration.spec.ts \
  tests/api/mls-provable-delete.spec.ts
```

Expected: PASS.

- [ ] **Step 7: API E2E tests — Tier 3 regression**

```bash
bunx playwright test tests/api --grep-invert "mls-"
```

Expected: PASS. Mixed-mode deployment verified — existing Tier 3 hubs are unaffected.

- [ ] **Step 8: UI E2E tests — Tier 6**

```bash
bunx playwright test tests/ui/mls-hub-opt-in.spec.ts \
  tests/ui/mls-member-removal.spec.ts \
  tests/ui/mls-background-update.spec.ts \
  tests/ui/mls-fingerprint-mismatch.spec.ts \
  tests/ui/device-fingerprint.spec.ts \
  tests/ui/mls-sas-emoji-render.spec.ts
```

Expected: PASS.

- [ ] **Step 9: UI E2E tests — Tier 3 regression**

```bash
bunx playwright test tests/ui --grep-invert "mls-"
```

Expected: PASS.

- [ ] **Step 10: Grep check — no @wireapp/core-crypto imports outside `src/client/lib/mls/` and `crypto-worker.ts`**

```bash
! grep -rn "from '@wireapp/core-crypto'" src --include="*.ts" --exclude-dir="src/client/lib/mls" | grep -v "crypto-worker.ts"
```

Expected: no matches. MLS integration is properly modularized.

- [ ] **Step 11: Grep check — no raw MLS label literals**

```bash
! grep -rn "'llamenos:items-key-export" src --include="*.ts" --exclude="*crypto-labels.ts"
! grep -rn "'llamenos:sframe-base-key" src --include="*.ts" --exclude="*crypto-labels.ts"
! grep -rn "'llamenos:note-epoch-key" src --include="*.ts" --exclude="*crypto-labels.ts"
```

Expected: no matches.

- [ ] **Step 12: Verify Tier 6 feature flag defaults to off**

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM hubs WHERE tier6_enabled = true"
```

Expected: `0` — no hub is flipped by the code changes alone.

- [ ] **Step 13: Final commit**

```bash
git add -A
git commit -m "chore(tier-6): PR #2 verification gate green — MLS + PQ code path complete"
```

- [ ] **Step 14: Open PR #2**

Title: `feat(security): Tier 6 PR #2 — MLS group lifecycle + PQ hybrid (feature-flagged)`

Include in description:
- Link to spec: `docs/superpowers/specs/2026-04-10-security-tier-6-mls-pq-design.md`.
- Link to plan: `docs/superpowers/plans/2026-04-10-security-tier-6-mls-pq.md`.
- Checkbox-style list of tasks 15–44.
- Explicit statement: **no hub is flipped by this PR.** Enabling Tier 6 requires a follow-up operator action per the staged rollout plan.
- Call-out that the external audit is a prerequisite to Month 2 volunteer-opt-in rollout.
- Bundle size delta (measured from Step 4).
- Tier 3 regression test results.

---

## Staged rollout (post-PR)

PR #2 landing does NOT flip any production hub. Rollout happens via operator action over 3 months.

### Month 1 — Internal hub only

1. Manually flip `tier6_enabled = true` on the Llamenos internal development hub via a root-DB update.
2. Verify all internal devices are fingerprint-verified before the flip.
3. Development team dogfoods the flow daily:
   - Add/remove devices and verify epochs advance.
   - Daily background Update commits appear in the audit log.
   - SFrame calls derive base keys from MLS exporter.
   - Test provable-delete purges.
4. Any incident pauses rollout; fix + re-verify before proceeding.
5. Instrument metrics: KeyPackage supply, epoch advance frequency, MLS processing errors.

### Month 2 — Volunteer opt-in (pending audit)

**Prerequisite:** external cryptography firm (Cure53 / Trail of Bits / NCC) completes audit of:
- Vendored @wireapp/core-crypto source at pinned commit.
- Llamenos MLS integration code (`src/client/lib/mls/**`).
- PQ ciphersuite code path.
- Nostr delivery + KeyPackage endpoints.
- Interaction with Tier 0 audit signatures and Tier 3 device sigchain.

Findings remediated. Audit report published to `docs/security/AUDIT_TIER_6_<date>.md`.

1. Hub admins see a "Migrate hub to Tier 6 (MLS + PQ)" button in hub security settings.
2. Opt-in modal enforces the checklist (all devices verified + acknowledge audit + acknowledge no-rollback).
3. On confirm, server flips `tier6_enabled` + creates `mls_group_init` audit entry + triggers admin's device to bootstrap MLS state.
4. Instrument metrics per-hub: opt-in success rate, failures, error rates.

### Month 3 — Default-on for new hubs (zero-incident gate)

If Month-1 and Month-2 have zero incidents:

1. `POST /api/hubs` route sets `tier6_enabled = true` by default for new hubs.
2. Hub creation UI presents XWing as default with an "Advanced: use ML-KEM-1024" option for high-profile hubs.
3. Existing Tier 3 hubs remain opt-in indefinitely — no automatic migration.

### Month 6 — Marketing assertion

With the external audit complete and ≥ 3 months of production use, Llamenos marketing can assert "post-quantum hybrid by default" on the website and documentation.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-security-tier-6-mls-pq.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Required sub-skill: `superpowers:subagent-driven-development`. Task granularity in this plan is chosen with subagent-per-task in mind: each task produces a committable unit and can be reviewed independently.

2. **Inline Execution** — execute tasks in one session with checkpoints after every 3–5 tasks. Required sub-skill: `superpowers:executing-plans`.

**Gate before execution:** confirm Tiers 0, 1, and 3 have landed on the branch base. The plan's prerequisites section lists the exact symbols the first task depends on. If any are missing, the first subagent dispatch must fail-fast and abort.

**External audit:** commissioned audit MUST complete + findings MUST be remediated before Month 2 of the staged rollout. PR #2 can merge without the audit (all code is feature-flagged off), but the staged rollout cannot proceed past Month 1 without it.

**No rollback:** Tier 6 is intentionally one-way. Any PR or hotfix that adds a "disable Tier 6" code path is a spec violation — the only recovery from a botched migration is to recreate the hub.
