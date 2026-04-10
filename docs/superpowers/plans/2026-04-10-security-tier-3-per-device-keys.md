# Security Tier 3 — Per-Device Keys + PUK + Sigchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for this tier — it is the biggest in the roadmap) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot Llamenos from the single-identity-key model to the Keybase-inspired per-device-key + Per-User Key (PUK) + user sigchain architecture, eliminating the Standard Notes anti-pattern (Gap 2 of the security master doc). Add cross-signing for device trust, Cascading Lazy Key Rotation for O(log gens) historical access, a paper-key recovery mechanism that doubles as a synthetic device, and per-device hub-key envelopes that cryptographically exclude revoked devices.

**Architecture:** Nine workstreams executed in dependency order. Workstreams 3.1–3.3 (device identity + PUK + sigchain) are the foundation; 3.4 (enrollment) + 3.5 (hub-key per device) are the integration; 3.6 (cross-signing + recovery) + 3.7 (CLKR) + 3.8 (paper key) + 3.9 (UX + auth state) land the user-visible surfaces. One PR, one Drizzle migration, one clean-cut database reset.

**Tech Stack:** TypeScript, Bun, Hono + `@hono/zod-openapi`, React + TanStack Router, Drizzle ORM + PostgreSQL, WebCrypto native Ed25519/X25519 (Chrome 137+ / Firefox 135+ / Safari 17.4+), `@hpke/core` + `@hpke/dhkem-x25519` + `@hpke/chacha20poly1305` (Tier 1 dependency), `@noble/hashes` HMAC-SHA256, `@scure/bip39` (English wordlist), `shamir-secret-sharing` (Tier 2 dependency, reused), `@noble/ciphers` AES-GCM.

**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-3-per-device-keys-design.md`

**Assumed prior work landed on this branch base:**
- Tier 0 (`feat/sec-tier-0-albrecht-hardening`): branded `CryptoLabel` type, `LABEL_REGISTRY`, envelope v2 with `labelId` + AAD, `computeEntryHash()`, `SignedAuditEntrySchema`, `AuditLogService.appendSigned`, `verifyAuditChain`, per-hub sigchain cache, `/api/auth/devices` stubs.
- Tier 1 (`feat/sec-tier-1-hpke-primitives`): HPKE sender/recipient contexts, `@hpke/*` dependency, non-extractable `CryptoKey` patterns, native Ed25519 + X25519 usage, `items_key` indirection for hub-scoped content.
- Tier 2 (`feat/sec-tier-2-unlock-recovery`): WebAuthn PRF unlock, OPAQUE login (optional), Recovery Group envelope + Shamir threshold flow, BIP39 recovery phrase as the KEK factor (Tier 3 spec §3.8.3 unifies this with the paper-key mechanism).

---

## File Map

### Created

| File | Responsibility |
|---|---|
| `src/shared/schemas/sigchain.ts` | Tier 3 sigchain payload schemas (user_init, device_add, device_remove, puk_rotate, user_master_signing_update, device_cross_sign, user_cross_sign, hub_ptk_rotate, recovery_initiated, recovery_completed) |
| `src/shared/schemas/sigchain.test.ts` | Payload + canonical-hash tests |
| `src/shared/schemas/devices.ts` | Device enrollment request/response schemas |
| `src/shared/schemas/devices.test.ts` | Schema tests |
| `src/client/lib/device-identity.ts` | Device keypair generation + IDB persistence helpers |
| `src/client/lib/device-identity.test.ts` | Keypair generation + non-extractability tests |
| `src/client/lib/device-identity-store.ts` | IDB wrapper for the `llamenos-device` database |
| `src/client/lib/device-identity-store.test.ts` | Structured-clone round-trip tests |
| `src/client/lib/puk.ts` | PUK seed lifecycle: create, wrap, rotate, derive subkeys |
| `src/client/lib/puk.test.ts` | PUK creation, rotation, generation walk tests |
| `src/client/lib/device-enrollment.ts` | Enrollment state machine, QR, SAS computation, POST flows |
| `src/client/lib/device-enrollment.test.ts` | State-machine + SAS determinism tests |
| `src/client/lib/user-sigchain-verifier.ts` | Typed sigchain verification layered on Tier 0 `audit-chain-verifier` |
| `src/client/lib/user-sigchain-verifier.test.ts` | Adversarial chain tests (A1–A20 matrix from spec) |
| `src/client/lib/cross-signing.ts` | Master / self-signing / user-signing key derivation + `user_cross_sign` flow |
| `src/client/lib/cross-signing.test.ts` | Transitive trust + signature tests |
| `src/client/lib/paper-key.ts` | BIP39 mnemonic generation + paper-key device derivation + recovery |
| `src/client/lib/paper-key.test.ts` | Determinism + validation tests |
| `src/client/lib/recovery-group-tier3.ts` | Tier 2's Recovery Group extended for master + PUK dual-wrapping |
| `src/client/lib/recovery-group-tier3.test.ts` | Recovery flow tests |
| `src/client/lib/client-migration-barrier.tsx` | App-root migration gate that blocks on pre-Tier-3 storage |
| `src/client/routes/settings/devices/index.tsx` | Device list page |
| `src/client/routes/settings/devices/add.tsx` | Add-device wizard |
| `src/client/routes/settings/devices/recovery-phrase.tsx` | Paper-key generation UI |
| `src/client/routes/settings/security/cross-signing.tsx` | Cross-signing status page |
| `src/client/components/settings/DeviceListItem.tsx` | Device row component (with testid) |
| `src/client/components/settings/DeviceAddWizard.tsx` | Enrollment state machine UI |
| `src/client/components/settings/DeviceAddWizard.test.tsx` | Component state-machine tests |
| `src/client/components/settings/RecoveryPhraseDisplay.tsx` | One-shot mnemonic display |
| `src/client/components/settings/CrossSigningStatus.tsx` | Trust status panel |
| `src/server/db/schema/devices.ts` | `user_devices`, `user_puk_envelopes`, `hub_ptk_generations`, `hub_key_envelopes`, `device_enrollment_sessions`, `user_master_wraps` tables |
| `src/server/services/device-service.ts` | Device CRUD + sigchain-verified add/remove |
| `src/server/services/device-service.test.ts` | Service unit tests |
| `src/server/services/hub-key-service.ts` | Hub-key envelope issuance + rotation + cascading batch transaction |
| `src/server/services/hub-key-service.test.ts` | Service unit tests |
| `src/server/services/recovery-service.ts` | Recovery Group initiate + complete flows |
| `src/server/services/recovery-service.test.ts` | Service unit tests |
| `src/server/routes/devices.ts` | `/api/auth/devices/*` endpoints |
| `src/server/routes/devices.test.ts` | Route unit tests |
| `src/server/routes/sigchain.ts` | `/api/auth/sigchain` fetch endpoint |
| `src/server/routes/sigchain.test.ts` | Route unit tests |
| `drizzle/migrations/0060_tier3_per_device_keys.sql` | Tier 3 schema migration (clean cut, pre-production) |
| `tests/api/tier3-device-lifecycle.spec.ts` | API E2E — device add/remove/list |
| `tests/api/tier3-sigchain-verification.spec.ts` | API E2E — adversarial sigchain manipulation |
| `tests/api/tier3-hub-ptk-rotation.spec.ts` | API E2E — CLKR + cascading + commitment check |
| `tests/api/tier3-puk-rotation.spec.ts` | API E2E — PUK generation walk + rotation correctness |
| `tests/api/tier3-cross-signing.spec.ts` | API E2E — master / self-signing / user-signing |
| `tests/api/tier3-recovery-group.spec.ts` | API E2E — Recovery Group initiate + complete |
| `tests/api/tier3-paper-key.spec.ts` | API E2E — paper-key generation + recovery + retirement |
| `tests/api/tier3-label-enforcement.spec.ts` | API E2E — label swap + AAD mismatch |
| `tests/ui/tier3-device-enrollment.spec.ts` | UI E2E — QR + SAS enrollment wizard |
| `tests/ui/tier3-device-list.spec.ts` | UI E2E — device list display + revocation |
| `tests/ui/tier3-recovery-phrase.spec.ts` | UI E2E — recovery phrase UX flow |
| `tests/ui/tier3-hub-rotation-observable.spec.ts` | UI E2E — admin removes member → volunteer loses access |
| `tests/ui/tier3-cross-signing-verification.spec.ts` | UI E2E — SAS ceremony UX |
| `tests/ui/tier3-mitm-enrollment.spec.ts` | UI E2E — adversarial MITM on QR |
| `tests/perf/sigchain-verification.spec.ts` | Perf budget — 500-entry cold-boot verify in < 500ms |
| `tests/helpers/tier3-device-fixture.ts` | Test fixture: generate a device keypair + sigchain bootstrap |
| `docs/security/TIER3_MIGRATION_RUNBOOK.md` | Pre-production cut-over runbook |
| `scripts/verify-tier-3.sh` | CI script chaining all success-criterion checks |

### Modified

| File | Change |
|---|---|
| `src/shared/crypto-labels.ts` | Add `LABEL_PUK_SIGN`, `LABEL_PUK_DH`, `LABEL_PUK_SECRETBOX`, `LABEL_PUK_WRAP_TO_DEVICE`, `LABEL_PUK_PREVIOUS_GEN`, `LABEL_MASTER_KEY_WRAP`, `LABEL_MASTER_SELF_SIGNING`, `LABEL_MASTER_USER_SIGNING`, `LABEL_MASTER_RECOVERY_HANDOFF`, `LABEL_MASTER_RECOVERY_GROUP_WRAP`, `LABEL_PUK_RECOVERY_GROUP_WRAP`, `LABEL_DEVICE_DISPLAY`, `LABEL_DEVICE_ENROLLMENT_SAS`, `LABEL_PAPER_KEY_SIGNING`, `LABEL_PAPER_KEY_ENCRYPTION`, `LABEL_HUB_PTK_PREV_GEN`. Extend `LABEL_REGISTRY` append-only. |
| `src/shared/schemas/audit-entries.ts` | Extend the discriminated union with the Tier 3 payload variants |
| `src/shared/schemas/audit-entries.test.ts` | Add Tier 3 variant tests |
| `src/shared/types.ts` | Add `DeviceKeypair`, `PukState`, `DeviceMetadata`, `SigchainVerifiedState`, `PaperKeyRecoveryPayload` types |
| `src/client/lib/crypto-worker.ts` | Replace `nsec`-centric ops with `deviceSign`, `deviceUnwrap`, `deriveDeviceEnrollmentSas`, `openPukEnvelope`, `wrapPukFromHandle`, `rotatePukFromHandle`, `signUserSigchainEntry`, `verifyDeviceSignature`. Delete `sign`, `decrypt`, `encrypt`, `provisionNsec`, `reEncrypt`, `exportSession`, `importSession`, `computeHmac`, `decryptEnvelopeField`, `envelopeEncryptField`. |
| `src/client/lib/crypto-worker-client.ts` | Retype all public methods to match new worker surface; delete all legacy public methods |
| `src/client/lib/crypto-worker.test.ts` | Rewrite for new worker surface |
| `src/client/lib/hub-key-manager.ts` | Replace user-scoped wrap/unwrap with device-scoped. Add `loadMyHubKeyForHub`, `assertDeviceCommitmentMatches`, lazy-gen walk. Delete `rotateHubKey(memberPubkeys: string[])` in favor of `rotateHubKeyForDeviceSet` used by `hub-key-service` |
| `src/client/lib/hub-key-manager.test.ts` | Rewrite for device-scoped operations |
| `src/client/lib/hub-field-crypto.ts` | Update AAD construction to use the `items_key` indirection from Tier 1 + verify the containing sigchain entry before issuing a key |
| `src/client/lib/auth.tsx` | Extend `AuthState` with `currentDevice`, `pukGeneration`, `knownDevices`, `sigchainHead`. Rewrite unlock flow to load device keypair from IDB instead of decrypting the nsec blob. |
| `src/client/lib/auth.test.tsx` | Update for Tier 3 auth state |
| `src/client/lib/key-store-v2.ts` | **Deleted** — replaced by device-identity-store + PUK. File removal is explicit in the migration task. |
| `src/client/lib/provisioning.ts` | **Deleted** — ephemeral-ECDH provisioning protocol is removed |
| `src/client/lib/provisioning.test.ts` | **Deleted** |
| `src/client/routes/login.tsx` | Redirect unknown devices to "add this as a new device via an existing primary" flow |
| `src/client/routes/onboarding/*` | Rewrite first-device flow to produce `user_init` instead of `encryptedSecretKey` |
| `src/client/routes/invites/accept.tsx` | Rewrite to produce first device + PUK + optional Tier 2 Recovery Group enrollment on accept |
| `src/client/components/settings/settings-layout.tsx` | Add "Devices" and "Recovery phrase" nav items |
| `src/client/main.tsx` | Install `ClientMigrationBarrier` before mounting routes |
| `src/server/db/schema/identity.ts` | Drop `encryptedSecretKey`, `kekProofHash` columns from `users`; drop `provisionRooms` table; schema imports `devices.ts` |
| `src/server/db/schema/records.ts` | No change — Tier 0's audit_log shape stays, but the payload discriminated union (imported from `schemas/audit-entries.ts`) grows |
| `src/server/db/schema/security-prefs.ts` | Add `require_sas_for_cross_signing` column (default true); prepare for `can_grant_trust_without_sas` role permission lookup |
| `src/server/services/audit-log-service.ts` | Add `appendBatch(entries[])` API wrapping a PostgreSQL transaction. Extend `payloadIsAuthorizedFor` to cover the new payload types. |
| `src/server/services/audit-log-service.test.ts` | Extend for Tier 3 payloads + batch append |
| `src/server/services/identity-service.ts` | Remove `nsec`/`encryptedSecretKey` touchpoints; replace with `device-service` calls |
| `src/server/services/identity-service.test.ts` | Update for Tier 3 |
| `src/server/services/settings-service.ts` | Rewrap paths use device pubkeys instead of user pubkeys |
| `src/server/services/records-service.ts` | Same — envelope recipient set is devices, not users |
| `src/server/services/conversation-service.ts` | Same |
| `src/server/services/call-router-service.ts` | Same |
| `src/server/idp/adapter.ts` | Remove `getNsecSecret`, `rotateNsecSecret`, `confirmRotation` methods from the interface |
| `src/server/idp/authentik-adapter.ts` | Remove the three method implementations; clean up IdP attribute management |
| `src/server/routes/auth-facade.ts` | Remove `/api/auth/bootstrap`'s `nsecSecret` response; remove device-linking provisioning endpoints; redirect their callers to `/api/auth/devices` |
| `src/server/routes/provision-rooms.ts` | **Deleted** |
| `src/server/routes/provision-rooms.test.ts` | **Deleted** |
| `src/server/app.ts` | Mount new `/api/auth/devices/*` and `/api/auth/sigchain` routes; unmount `/api/provision/*` |
| `src/server/middleware/*.ts` | No change required |
| `tests/helpers/authed-request.ts` | Replace nsec-based signing with device-key signing for test users |
| `tests/fixtures/auth.ts` | Replace fixture bootstrap to produce device + PUK instead of nsec |
| `tests/fixtures/dev-test-users.ts` | Regenerate dev test users via Tier 3 onboarding |
| `CLAUDE.md` | Add "Tier 3 migration notes" section (one-shot; removed in next tier) |
| `docs/security/THREAT_MODEL.md` | Add device-compromise section; residual risks §"After Tier 3" |
| `docs/architecture/E2EE_ARCHITECTURE.md` | Add "Layer 0: device identity" section; restructure the three-tier model |
| `docs/protocol/llamenos-protocol.md` | Full sigchain payload schemas; PUK lifecycle sequence diagrams; CLKR walkthrough |
| `docs/security/KEY_REVOCATION_RUNBOOK.md` | Rewrite for per-device revocation + cascading rotation |
| `package.json` | Add `@scure/bip39` dependency if not already present (Tier 2 may have added it) |
| `biome.json` | Add lint rule: `encryptedSecretKey` / `nsec` identifiers in `src/client` are warnings then errors after the migration task |
| `.github/workflows/ci.yml` | Add grep guard: no `nsec`, no `provision_rooms`, no `encryptedSecretKey` in `src/client` |

### Deleted

| File | Reason |
|---|---|
| `src/client/lib/key-store-v2.ts` | Replaced by device-identity-store + PUK |
| `src/client/lib/key-store-v2.test.ts` | Deleted with the module |
| `src/client/lib/provisioning.ts` | Ephemeral-ECDH provisioning removed |
| `src/client/lib/provisioning.test.ts` | Deleted with the module |
| `src/server/routes/provision-rooms.ts` | `/api/provision/*` endpoints removed |
| `src/server/routes/provision-rooms.test.ts` | Deleted with the module |

---

## Workstream 3.1 — Device identity layer

### Task 1: Add Tier 3 crypto labels

**Files:**
- Modify: `src/shared/crypto-labels.ts`
- Modify: `src/shared/crypto-labels.test.ts` (Tier 0 file)

- [ ] **Step 1: Write failing tests for new labels**

Append to `src/shared/crypto-labels.test.ts`:

```typescript
describe('Tier 3 labels', () => {
  test('all Tier 3 labels are registered', () => {
    expect(labelToId(LABEL_PUK_SIGN)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_DH)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_SECRETBOX)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_WRAP_TO_DEVICE)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_PREVIOUS_GEN)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_KEY_WRAP)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_SELF_SIGNING)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_USER_SIGNING)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_RECOVERY_HANDOFF)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_MASTER_RECOVERY_GROUP_WRAP)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PUK_RECOVERY_GROUP_WRAP)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_DEVICE_DISPLAY)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_DEVICE_ENROLLMENT_SAS)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PAPER_KEY_SIGNING)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_PAPER_KEY_ENCRYPTION)).toBeGreaterThanOrEqual(0)
    expect(labelToId(LABEL_HUB_PTK_PREV_GEN)).toBeGreaterThanOrEqual(0)
  })

  test('all Tier 3 labels have distinct ids', () => {
    const ids = new Set([
      labelToId(LABEL_PUK_SIGN),
      labelToId(LABEL_PUK_DH),
      labelToId(LABEL_PUK_SECRETBOX),
      labelToId(LABEL_PUK_WRAP_TO_DEVICE),
      labelToId(LABEL_PUK_PREVIOUS_GEN),
      labelToId(LABEL_MASTER_KEY_WRAP),
      labelToId(LABEL_MASTER_SELF_SIGNING),
      labelToId(LABEL_MASTER_USER_SIGNING),
      labelToId(LABEL_MASTER_RECOVERY_HANDOFF),
      labelToId(LABEL_MASTER_RECOVERY_GROUP_WRAP),
      labelToId(LABEL_PUK_RECOVERY_GROUP_WRAP),
      labelToId(LABEL_DEVICE_DISPLAY),
      labelToId(LABEL_DEVICE_ENROLLMENT_SAS),
      labelToId(LABEL_PAPER_KEY_SIGNING),
      labelToId(LABEL_PAPER_KEY_ENCRYPTION),
      labelToId(LABEL_HUB_PTK_PREV_GEN),
    ])
    expect(ids.size).toBe(16)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/shared/crypto-labels.test.ts -t "Tier 3 labels"`
Expected: FAIL — labels not exported.

- [ ] **Step 3: Add labels in `src/shared/crypto-labels.ts`**

Append (after the Tier 0 `LABEL_REGISTRY` declaration — the registry must be extended append-only):

```typescript
// --- Tier 3: Per-Device Keys + PUK + Sigchain ---

/** PUK-derived Ed25519 signing key context */
export const LABEL_PUK_SIGN = 'llamenos:puk:sign:v1' as CryptoLabel

/** PUK-derived X25519 DH key context */
export const LABEL_PUK_DH = 'llamenos:puk:dh:v1' as CryptoLabel

/** PUK-derived AES-GCM-256 SecretBox key context (wraps previous generations) */
export const LABEL_PUK_SECRETBOX = 'llamenos:puk:secretbox:v1' as CryptoLabel

/** HPKE info for wrapping the PUK seed to a device X25519 pubkey */
export const LABEL_PUK_WRAP_TO_DEVICE = 'llamenos:puk:wrap:device:v1' as CryptoLabel

/** AAD for encrypting old PUK seed under the new PUK SecretBox key */
export const LABEL_PUK_PREVIOUS_GEN = 'llamenos:puk:prev-gen:v1' as CryptoLabel

/** AAD for wrapping the master signing seed under the PUK SecretBox key */
export const LABEL_MASTER_KEY_WRAP = 'llamenos:master:wrap:v1' as CryptoLabel

/** HMAC label: master seed → self-signing seed */
export const LABEL_MASTER_SELF_SIGNING = 'llamenos:master:self-signing:v1' as CryptoLabel

/** HMAC label: master seed → user-signing seed */
export const LABEL_MASTER_USER_SIGNING = 'llamenos:master:user-signing:v1' as CryptoLabel

/** HPKE info for one-shot master seed handoff during recovery */
export const LABEL_MASTER_RECOVERY_HANDOFF = 'llamenos:master:recovery-handoff:v1' as CryptoLabel

/** AAD for wrapping master seed under Recovery Group pubkey */
export const LABEL_MASTER_RECOVERY_GROUP_WRAP = 'llamenos:master:recovery-group:v1' as CryptoLabel

/** AAD for wrapping PUK seed under Recovery Group pubkey */
export const LABEL_PUK_RECOVERY_GROUP_WRAP = 'llamenos:puk:recovery-group:v1' as CryptoLabel

/** AAD for encrypting device display_name under the PUK SecretBox key */
export const LABEL_DEVICE_DISPLAY = 'llamenos:device:display:v1' as CryptoLabel

/** HKDF info for device enrollment SAS code derivation */
export const LABEL_DEVICE_ENROLLMENT_SAS = 'llamenos:device:enrollment-sas:v1' as CryptoLabel

/** HMAC label: BIP39 seed → paper-key signing seed */
export const LABEL_PAPER_KEY_SIGNING = 'llamenos:paper-key:sign:v1' as CryptoLabel

/** HMAC label: BIP39 seed → paper-key encryption seed */
export const LABEL_PAPER_KEY_ENCRYPTION = 'llamenos:paper-key:encryption:v1' as CryptoLabel

/** AAD for wrapping old hub PTK under new hub PTK in CLKR chain */
export const LABEL_HUB_PTK_PREV_GEN = 'llamenos:hub-ptk:prev-gen:v1' as CryptoLabel
```

Extend `LABEL_REGISTRY` append-only at the end (DO NOT reorder any existing ids):

```typescript
export const LABEL_REGISTRY = [
  // ... existing Tier 0 registered labels ...
  LABEL_PUK_SIGN,
  LABEL_PUK_DH,
  LABEL_PUK_SECRETBOX,
  LABEL_PUK_WRAP_TO_DEVICE,
  LABEL_PUK_PREVIOUS_GEN,
  LABEL_MASTER_KEY_WRAP,
  LABEL_MASTER_SELF_SIGNING,
  LABEL_MASTER_USER_SIGNING,
  LABEL_MASTER_RECOVERY_HANDOFF,
  LABEL_MASTER_RECOVERY_GROUP_WRAP,
  LABEL_PUK_RECOVERY_GROUP_WRAP,
  LABEL_DEVICE_DISPLAY,
  LABEL_DEVICE_ENROLLMENT_SAS,
  LABEL_PAPER_KEY_SIGNING,
  LABEL_PAPER_KEY_ENCRYPTION,
  LABEL_HUB_PTK_PREV_GEN,
] as const satisfies readonly CryptoLabel[]
```

- [ ] **Step 4: Re-run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-labels.ts src/shared/crypto-labels.test.ts
git commit -m "feat(crypto-labels): add Tier 3 PUK, device, master-key, paper-key labels"
```

### Task 2: Device keypair generation + non-extractability assertion

**Files:**
- Create: `src/client/lib/device-identity.ts`
- Create: `src/client/lib/device-identity.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add types to `src/shared/types.ts`**

```typescript
export interface DeviceKeypair {
  deviceId: string
  signing: {
    privateKey: CryptoKey  // non-extractable Ed25519
    publicKey: Uint8Array   // raw 32 bytes
  }
  encryption: {
    privateKey: CryptoKey  // non-extractable X25519
    publicKey: Uint8Array   // raw 32 bytes
  }
  createdAt: string          // ISO 8601
  isPaperKey: boolean
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/client/lib/device-identity.test.ts
import { describe, expect, test } from 'bun:test'
import { generateDeviceKeypair } from './device-identity'

describe('generateDeviceKeypair', () => {
  test('produces valid Ed25519 + X25519 keypairs', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    expect(kp.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(kp.signing.publicKey).toBeInstanceOf(Uint8Array)
    expect(kp.signing.publicKey.length).toBe(32)
    expect(kp.encryption.publicKey).toBeInstanceOf(Uint8Array)
    expect(kp.encryption.publicKey.length).toBe(32)
    expect(kp.isPaperKey).toBe(false)
  })

  test('signing private key is non-extractable', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await expect(crypto.subtle.exportKey('raw', kp.signing.privateKey)).rejects.toThrow()
    await expect(crypto.subtle.exportKey('pkcs8', kp.signing.privateKey)).rejects.toThrow()
  })

  test('encryption private key is non-extractable', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await expect(crypto.subtle.exportKey('raw', kp.encryption.privateKey)).rejects.toThrow()
  })

  test('multiple calls produce distinct keypairs', async () => {
    const a = await generateDeviceKeypair({ isPaperKey: false })
    const b = await generateDeviceKeypair({ isPaperKey: false })
    expect(a.deviceId).not.toBe(b.deviceId)
    expect(a.signing.publicKey).not.toEqual(b.signing.publicKey)
    expect(a.encryption.publicKey).not.toEqual(b.encryption.publicKey)
  })
})
```

- [ ] **Step 3: Run failing test** — FAIL (module not found)

- [ ] **Step 4: Implement `src/client/lib/device-identity.ts`**

```typescript
import type { DeviceKeypair } from '@shared/types'

interface GenerateOptions {
  isPaperKey: boolean
}

export async function generateDeviceKeypair(opts: GenerateOptions): Promise<DeviceKeypair> {
  const signingPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    /* extractable */ false,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const encryptionPair = (await crypto.subtle.generateKey(
    { name: 'X25519' },
    /* extractable */ false,
    ['deriveBits'],
  )) as CryptoKeyPair

  const signingPub = new Uint8Array(await crypto.subtle.exportKey('raw', signingPair.publicKey))
  const encryptionPub = new Uint8Array(await crypto.subtle.exportKey('raw', encryptionPair.publicKey))

  return {
    deviceId: crypto.randomUUID(),
    signing: { privateKey: signingPair.privateKey, publicKey: signingPub },
    encryption: { privateKey: encryptionPair.privateKey, publicKey: encryptionPub },
    createdAt: new Date().toISOString(),
    isPaperKey: opts.isPaperKey,
  }
}
```

- [ ] **Step 5: Re-run test — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/device-identity.ts src/client/lib/device-identity.test.ts src/shared/types.ts
git commit -m "feat(device-identity): non-extractable Ed25519 + X25519 device keypair generation"
```

### Task 3: IDB persistence for the device keypair

**Files:**
- Create: `src/client/lib/device-identity-store.ts`
- Create: `src/client/lib/device-identity-store.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test'
import 'fake-indexeddb/auto'  // existing dev dep
import { generateDeviceKeypair } from './device-identity'
import {
  putDeviceKeypair,
  getDeviceKeypair,
  clearDeviceKeypairStore,
  MultipleDeviceKeypairsError,
} from './device-identity-store'

describe('device-identity-store', () => {
  beforeEach(async () => {
    await clearDeviceKeypairStore()
  })

  test('put then get round-trips', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(kp)
    const loaded = await getDeviceKeypair()
    expect(loaded).not.toBeNull()
    expect(loaded!.deviceId).toBe(kp.deviceId)
    expect(loaded!.signing.publicKey).toEqual(kp.signing.publicKey)
    expect(loaded!.encryption.publicKey).toEqual(kp.encryption.publicKey)
  })

  test('loaded signing private key still works non-extractably', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(kp)
    const loaded = await getDeviceKeypair()
    const msg = new TextEncoder().encode('hello')
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, loaded!.signing.privateKey, msg)
    expect(sig.byteLength).toBe(64)  // Ed25519 signature is 64 bytes
    await expect(crypto.subtle.exportKey('raw', loaded!.signing.privateKey)).rejects.toThrow()
  })

  test('empty store returns null', async () => {
    const loaded = await getDeviceKeypair()
    expect(loaded).toBeNull()
  })

  test('multiple keypairs in store throws', async () => {
    const a = await generateDeviceKeypair({ isPaperKey: false })
    const b = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(a)
    // Simulate a second keypair slipping in through a bug — use raw IDB
    await forceInsertRawDeviceKeypair(b)
    await expect(getDeviceKeypair()).rejects.toThrow(MultipleDeviceKeypairsError)
  })
})
```

- [ ] **Step 2: Run failing test** — FAIL

- [ ] **Step 3: Implement the store in `src/client/lib/device-identity-store.ts`** (see spec §3.1.2 for the shape)

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/device-identity-store.ts src/client/lib/device-identity-store.test.ts
git commit -m "feat(device-identity): IDB persistence with structured-clone CryptoKey round-trip"
```

### Task 4: Crypto worker — device key loading

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`
- Modify: `src/client/lib/crypto-worker-client.ts`
- Modify: `src/client/lib/crypto-worker.test.ts`

- [ ] **Step 1: Delete legacy worker ops**

Remove from `WorkerRequest`: `sign`, `decrypt`, `encrypt`, `provisionNsec`, `reEncrypt`, `exportSession`, `importSession`, `computeHmac`, `decryptEnvelopeField`, `envelopeEncryptField`. Delete their handlers and any closure state related to the `nsec` (`let secretKey`, `let publicKeyHex`).

- [ ] **Step 2: Add new worker state**

```typescript
// Closure state
let currentDeviceKeypair: DeviceKeypair | null = null
const pukHandles = new Map<string, Uint8Array>()  // opaque handle → transient seed
```

- [ ] **Step 3: Write failing tests for `loadDeviceKeypair` + `deviceSign`**

```typescript
test('loadDeviceKeypair + deviceSign produces a valid signature', async () => {
  const kp = await generateDeviceKeypair({ isPaperKey: false })
  await putDeviceKeypair(kp)
  await cryptoWorker.loadDeviceKeypair()
  const msg = hexFromString('test message')
  const sigHex = await cryptoWorker.deviceSign(msg)
  const sig = hexToBytes(sigHex)
  const ok = await crypto.subtle.verify(
    { name: 'Ed25519' }, await importRawEd25519Pub(kp.signing.publicKey), sig, hexToBytes(msg),
  )
  expect(ok).toBe(true)
})

test('deviceSign before loadDeviceKeypair throws', async () => {
  await expect(cryptoWorker.deviceSign('deadbeef')).rejects.toThrow('worker locked')
})
```

- [ ] **Step 4: Implement `loadDeviceKeypair` + `deviceSign` handlers**

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker.test.ts
git commit -m "feat(crypto-worker): load device keypair from IDB + deviceSign Ed25519 op"
```

### Task 5: Crypto worker — `deviceUnwrap` (HPKE) + label verification

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`
- Modify: `src/client/lib/crypto-worker-client.ts`
- Modify: `src/client/lib/crypto-worker.test.ts`

- [ ] **Step 1: Write failing test — happy path**

```typescript
test('deviceUnwrap opens a valid HPKE envelope with correct label', async () => {
  const kp = await generateDeviceKeypair({ isPaperKey: false })
  await putDeviceKeypair(kp)
  await cryptoWorker.loadDeviceKeypair()
  const plaintext = new TextEncoder().encode('secret payload')
  const envelope = await hpkeSealToDevice(plaintext, kp.encryption.publicKey, LABEL_PUK_WRAP_TO_DEVICE)
  const opened = await cryptoWorker.deviceUnwrap(envelope, LABEL_PUK_WRAP_TO_DEVICE)
  expect(new TextDecoder().decode(opened)).toBe('secret payload')
})
```

- [ ] **Step 2: Write failing test — wrong label**

```typescript
test('deviceUnwrap rejects envelope with wrong labelId', async () => {
  const kp = await generateDeviceKeypair({ isPaperKey: false })
  await putDeviceKeypair(kp)
  await cryptoWorker.loadDeviceKeypair()
  const envelope = await hpkeSealToDevice(new Uint8Array([1]), kp.encryption.publicKey, LABEL_PUK_WRAP_TO_DEVICE)
  await expect(cryptoWorker.deviceUnwrap(envelope, LABEL_HUB_KEY_WRAP)).rejects.toThrow('CryptoLabelMismatch')
})
```

- [ ] **Step 3: Implement handler using `@hpke/core`**

```typescript
async function handleDeviceUnwrap(envelope: EnvelopeV2, expectedLabel: CryptoLabel): Promise<Uint8Array> {
  if (!currentDeviceKeypair) throw new Error('Worker locked')
  checkRateLimit('deviceUnwrap')
  const actualLabel = idToLabel(envelope.labelId)
  if (actualLabel !== expectedLabel) {
    throw new CryptoLabelMismatchError({ expected: expectedLabel, actual: actualLabel })
  }
  // Construct HPKE recipient context using the device's X25519 private key.
  const recipient = await hpkeSuite.createRecipientContext({
    recipientKey: currentDeviceKeypair.encryption.privateKey,
    enc: hexToBytes(envelope.ephemeralPubkey),
    info: utf8ToBytes(expectedLabel),
  })
  const aad = concat(utf8ToBytes(expectedLabel), new Uint8Array([envelope.labelId]))
  const plaintext = await recipient.open(hexToBytes(envelope.wrappedKey), aad)
  return new Uint8Array(plaintext)
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker.test.ts
git commit -m "feat(crypto-worker): deviceUnwrap via HPKE with label-id verification"
```

### Task 6: Crypto worker — `deriveDeviceEnrollmentSas`

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`
- Modify: `src/client/lib/crypto-worker-client.ts`
- Modify: `src/client/lib/crypto-worker.test.ts`

- [ ] **Step 1: Write failing test — SAS symmetry**

```typescript
test('both sides compute the same SAS for matching pubkeys', async () => {
  const aliceKp = await generateDeviceKeypair({ isPaperKey: false })
  const bobKp = await generateDeviceKeypair({ isPaperKey: false })
  const nonce = crypto.getRandomValues(new Uint8Array(16))

  // Load alice's keypair into worker, compute SAS using bob's pubkey
  await putDeviceKeypair(aliceKp)
  await cryptoWorker.loadDeviceKeypair()
  const aliceSas = await cryptoWorker.deriveDeviceEnrollmentSas(bobKp.encryption.publicKey, nonce)

  // Swap to bob's keypair, compute SAS using alice's pubkey
  await clearDeviceKeypairStore()
  await putDeviceKeypair(bobKp)
  await cryptoWorker.loadDeviceKeypair()
  const bobSas = await cryptoWorker.deriveDeviceEnrollmentSas(aliceKp.encryption.publicKey, nonce)

  expect(aliceSas).toBe(bobSas)
  expect(aliceSas).toMatch(/^\d{6}$/)
})
```

- [ ] **Step 2: Write failing test — different inputs → different SAS**

```typescript
test('different enrollment nonces → different SAS', async () => {
  const aliceKp = await generateDeviceKeypair({ isPaperKey: false })
  const bobPub = (await generateDeviceKeypair({ isPaperKey: false })).encryption.publicKey
  await putDeviceKeypair(aliceKp)
  await cryptoWorker.loadDeviceKeypair()
  const nonce1 = new Uint8Array(16).fill(1)
  const nonce2 = new Uint8Array(16).fill(2)
  const sas1 = await cryptoWorker.deriveDeviceEnrollmentSas(bobPub, nonce1)
  const sas2 = await cryptoWorker.deriveDeviceEnrollmentSas(bobPub, nonce2)
  expect(sas1).not.toBe(sas2)
})
```

- [ ] **Step 3: Implement handler**

Use `crypto.subtle.deriveBits({ name: 'X25519', public: peerPub }, devicePriv, 256)` → HKDF-SHA256 with `info = concat(utf8(LABEL_DEVICE_ENROLLMENT_SAS), sortedPubkeyPair(myPub, peerPub), nonce)` → 4 bytes → `unbiasedSixDigitCode` (existing helper from `@shared/crypto-primitives`).

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker.test.ts
git commit -m "feat(crypto-worker): deriveDeviceEnrollmentSas with canonical pubkey pair"
```

---

## Workstream 3.2 — Per-User Key (PUK)

### Task 7: PUK module — createInitialPuk + derivePukSubkeys

**Files:**
- Create: `src/client/lib/puk.ts`
- Create: `src/client/lib/puk.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from 'bun:test'
import { generateDeviceKeypair } from './device-identity'
import { createInitialPuk, derivePukSubkeys } from './puk'

describe('PUK', () => {
  test('createInitialPuk produces generation 1 + one envelope', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    const result = await createInitialPuk(kp)
    expect(result.generation).toBe(1)
    expect(result.envelopes).toHaveLength(1)
    expect(result.envelopes[0].deviceId).toBe(kp.deviceId)
    expect(result.pukSignPubRaw.length).toBe(32)
    expect(result.pukDhPubRaw.length).toBe(32)
  })

  test('derivePukSubkeys produces distinct keys per generation', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const gen1 = await derivePukSubkeys(seed, 1)
    const gen2 = await derivePukSubkeys(seed, 2)
    const sign1Raw = await crypto.subtle.exportKey('raw', gen1.signPublic)
    const sign2Raw = await crypto.subtle.exportKey('raw', gen2.signPublic)
    expect(sign1Raw).not.toEqual(sign2Raw)
  })

  test('derived sign private key is non-extractable', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const derived = await derivePukSubkeys(seed, 1)
    await expect(crypto.subtle.exportKey('raw', derived.signPrivate)).rejects.toThrow()
  })

  test('cross-label subkey derivation is distinct', async () => {
    const seed = new Uint8Array(32).fill(42)
    const derived = await derivePukSubkeys(seed, 1)
    const signRaw = await crypto.subtle.exportKey('raw', derived.signPublic)
    const dhRaw = await crypto.subtle.exportKey('raw', derived.dhPublic)
    expect(signRaw).not.toEqual(dhRaw)
  })
})
```

- [ ] **Step 2: Run failing tests** — FAIL

- [ ] **Step 3: Implement `src/client/lib/puk.ts`**

See spec §3.2 for the exact HMAC-based derivation pattern and the `finally` zero-fill invariant. The `createInitialPuk` function must:

1. Generate a 32-byte seed.
2. Derive subkeys for generation 1.
3. Export the public halves.
4. HPKE-seal the seed to the device pubkey.
5. Zero the seed in a `finally` block.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/puk.ts src/client/lib/puk.test.ts
git commit -m "feat(puk): createInitialPuk + HMAC-based derivation of sign/dh/secretbox subkeys"
```

### Task 8: PUK rotation and old-gen wrap chain

**Files:**
- Modify: `src/client/lib/puk.ts`
- Modify: `src/client/lib/puk.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
test('rotatePuk to new gen wraps old seed under new SecretBox key', async () => {
  const devices = await Promise.all([
    generateDeviceKeypair({ isPaperKey: false }),
    generateDeviceKeypair({ isPaperKey: false }),
    generateDeviceKeypair({ isPaperKey: false }),
  ])
  const init = await createInitialPuk(devices[0])  // gen 1 wraps to device 0
  // Simulate that devices[0] has opened its envelope + holds the seed
  const gen1Seed = await openPukEnvelope(init.envelopes[0].envelope, devices[0].encryption.privateKey)

  const rotation = await rotatePuk({
    oldSeed: gen1Seed,
    oldGen: 1,
    remainingDevices: [devices[1], devices[2]],  // devices[0] is being removed
  })

  expect(rotation.newGen).toBe(2)
  expect(rotation.newEnvelopes).toHaveLength(2)
  expect(rotation.newEnvelopes.map((e) => e.deviceId)).toEqual([devices[1].deviceId, devices[2].deviceId])

  // Decrypt old gen 1 seed from new gen 2 wrap
  const recovered = await decryptOldGenWrap(rotation.oldGenWrappedUnderNew, rotation.newSecretBoxKey, 2)
  expect(recovered).toEqual(gen1Seed)
})

test('rotatePuk excludes the removed device from new envelopes', async () => {
  // 4 devices start, rotation removes device 2.
  const devices = await Promise.all([1, 2, 3, 4].map(() => generateDeviceKeypair({ isPaperKey: false })))
  const init = await createInitialPuk(devices[0])
  const seed = await openPukEnvelope(init.envelopes[0].envelope, devices[0].encryption.privateKey)
  const rotation = await rotatePuk({
    oldSeed: seed,
    oldGen: 1,
    remainingDevices: [devices[0], devices[1], devices[3]],  // device 2 excluded
  })
  const includedIds = rotation.newEnvelopes.map((e) => e.deviceId)
  expect(includedIds).toContain(devices[0].deviceId)
  expect(includedIds).toContain(devices[1].deviceId)
  expect(includedIds).not.toContain(devices[2].deviceId)
  expect(includedIds).toContain(devices[3].deviceId)
})
```

- [ ] **Step 2: Implement `rotatePuk` and `decryptOldGenWrap`**

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/puk.ts src/client/lib/puk.test.ts
git commit -m "feat(puk): rotatePuk with old-gen wrap chain for CLKR-style historical read"
```

### Task 9: PUK-generation walk for historical content

**Files:**
- Modify: `src/client/lib/puk.ts`
- Modify: `src/client/lib/puk.test.ts`

- [ ] **Step 1: Write failing test — content encrypted under gen 2 is decryptable from gen 5**

```typescript
test('getPukSeedForGeneration walks the wrap chain backwards', async () => {
  // Set up a chain: gen 1, gen 2, gen 3, gen 4, gen 5
  const devices = await Promise.all([1, 2].map(() => generateDeviceKeypair({ isPaperKey: false })))
  const init = await createInitialPuk(devices[0])
  let currentSeed = await openPukEnvelope(init.envelopes[0].envelope, devices[0].encryption.privateKey)
  const wrapChain: string[] = []  // index = gen, value = oldGenWrappedUnderNew hex (for gen - 1)
  wrapChain[1] = ''  // gen 1 has no previous

  for (let g = 2; g <= 5; g++) {
    const rot = await rotatePuk({ oldSeed: currentSeed, oldGen: g - 1, remainingDevices: devices })
    wrapChain[g] = rot.oldGenWrappedUnderNew
    currentSeed = rot.newSeed  // test-only extraction
  }
  // currentSeed is now gen 5 seed. Walk back to gen 2.
  const gen2Seed = await getPukSeedForGeneration({
    currentSeed,
    currentGen: 5,
    targetGen: 2,
    wrapChain,
  })
  // Cross-check: derive subkeys from gen2Seed and confirm the public sign key
  // matches what rotatePuk emitted at gen 2.
  const gen2Derived = await derivePukSubkeys(gen2Seed, 2)
  // ... assertions
})
```

- [ ] **Step 2: Implement `getPukSeedForGeneration`**

Walk from `currentGen` down to `targetGen`, each step AES-GCM-decrypting `wrapChain[current]` under the current generation's SecretBox key, yielding the previous generation's seed. Cache results per (userId, pukGen) with an LRU (max 5 entries).

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/puk.ts src/client/lib/puk.test.ts
git commit -m "feat(puk): walk generation chain backwards for historical content decryption"
```

### Task 10: Crypto worker — PUK handle operations

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`
- Modify: `src/client/lib/crypto-worker-client.ts`
- Modify: `src/client/lib/crypto-worker.test.ts`

- [ ] **Step 1: Write failing tests**

Test `openPukEnvelope` returns an opaque handle (a UUID string), not bytes. Test `wrapPukFromHandle` succeeds and then that the original handle is consumed (subsequent call throws "handle expired"). Test `rotatePukFromHandle` performs the full rotation + consumes the old handle.

- [ ] **Step 2: Implement handlers**

```typescript
// Worker-internal closure state from Task 4
const pukHandles = new Map<string, Uint8Array>()

async function handleOpenPukEnvelope(envelopeHex: string, labelId: number): Promise<{ handle: string; gen: number }> {
  // ... label check, HPKE open yielding seed bytes, store in pukHandles map ...
  const handle = crypto.randomUUID()
  pukHandles.set(handle, seedBytes)
  // Auto-expire the handle after 60 seconds
  setTimeout(() => {
    const s = pukHandles.get(handle)
    if (s) { s.fill(0); pukHandles.delete(handle) }
  }, 60_000)
  return { handle, gen: /* from context */ 1 }
}

async function handleWrapPukFromHandle(
  handle: string,
  newDeviceEncPubRaw: Uint8Array,
  aadUserId: string,
  aadNewDeviceId: string,
  aadGen: number,
): Promise<EnvelopeV2> {
  const seed = pukHandles.get(handle)
  if (!seed) throw new Error('PUK handle not found or expired')
  try {
    return await hpkeSealToDevice(seed, newDeviceEncPubRaw, LABEL_PUK_WRAP_TO_DEVICE, {
      aadSuffix: `${aadUserId}:${aadNewDeviceId}:${aadGen}`,
    })
  } finally {
    // Handle is single-use — zero + delete after wrap
    seed.fill(0)
    pukHandles.delete(handle)
  }
}
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker.test.ts
git commit -m "feat(crypto-worker): PUK handle operations (open, wrap, rotate) with single-use semantics"
```

---

## Workstream 3.3 — User sigchain

### Task 11: Tier 3 sigchain payload schemas

**Files:**
- Create: `src/shared/schemas/sigchain.ts`
- Create: `src/shared/schemas/sigchain.test.ts`
- Modify: `src/shared/schemas/audit-entries.ts`

- [ ] **Step 1: Write failing schema tests for all Tier 3 payload variants**

One test per variant round-tripping `SignedAuditEntrySchema.parse(computeEntryHash(...))`.

- [ ] **Step 2: Run failing tests** — FAIL (schemas don't exist)

- [ ] **Step 3: Implement `src/shared/schemas/sigchain.ts`** per spec §3.3.1

- [ ] **Step 4: Extend `audit-entries.ts` discriminated union**

```typescript
import {
  UserInitPayloadSchema,
  DeviceAddPayloadSchema,
  DeviceRemovePayloadSchema,
  PukRotatePayloadSchema,
  UserMasterSigningPayloadSchema,
  DeviceCrossSignPayloadSchema,
  UserCrossSignPayloadSchema,
  HubPtkRotatePayloadSchema,
  RecoveryInitiatedPayloadSchema,
  RecoveryCompletedPayloadSchema,
} from './sigchain'

export const AuditEntryPayloadSchema = z.discriminatedUnion('type', [
  // ... existing Tier 0 variants ...
  UserInitPayloadSchema,
  DeviceAddPayloadSchema,
  DeviceRemovePayloadSchema,
  PukRotatePayloadSchema,
  UserMasterSigningPayloadSchema,
  DeviceCrossSignPayloadSchema,
  UserCrossSignPayloadSchema,
  HubPtkRotatePayloadSchema,
  RecoveryInitiatedPayloadSchema,
  RecoveryCompletedPayloadSchema,
])
```

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/shared/schemas/sigchain.ts src/shared/schemas/sigchain.test.ts src/shared/schemas/audit-entries.ts
git commit -m "feat(schemas): Tier 3 sigchain payload variants (device_add, puk_rotate, cross_sign, etc.)"
```

### Task 12: User sigchain verifier — base chain rules

**Files:**
- Create: `src/client/lib/user-sigchain-verifier.ts`
- Create: `src/client/lib/user-sigchain-verifier.test.ts`

- [ ] **Step 1: Write failing tests — happy path**

```typescript
test('verifies a user_init → device_add → puk_rotate → device_remove chain', async () => {
  const chain = await buildSyntheticUserSigchain({ entries: [
    { type: 'user_init' },
    { type: 'device_add' },
    { type: 'device_add' },
    { type: 'puk_rotate' },
    { type: 'device_remove', removedIndex: 1 },
    { type: 'puk_rotate' },
  ]})
  const state = await verifyUserSigchain(chain.entries, { trustAnchor: chain.trustAnchor })
  expect(state.verifiedDevices.size).toBe(2)  // user_init device + remaining device_add
  expect(state.pukGeneration).toBe(3)
  expect(state.head).toBe(chain.entries[chain.entries.length - 1])
})
```

- [ ] **Step 2: Write failing test — first entry must be user_init**

```typescript
test('rejects a chain whose first entry is not user_init', async () => {
  const chain = await buildSyntheticUserSigchain({ entries: [
    { type: 'device_add' },  // invalid start
  ]})
  await expect(verifyUserSigchain(chain.entries, { trustAnchor: null }))
    .rejects.toThrow('chain_must_start_with_user_init')
})
```

- [ ] **Step 3: Write failing test — device_add signed by non-existent device**

```typescript
test('rejects device_add signed by a device not yet in the verified set', async () => {
  const chain = await buildSyntheticUserSigchain({ entries: [
    { type: 'user_init' },
    { type: 'device_add', signedByRandomKeyNotInChain: true },
  ]})
  await expect(verifyUserSigchain(chain.entries, { trustAnchor: chain.trustAnchor }))
    .rejects.toThrow('signer_not_in_verified_set')
})
```

- [ ] **Step 4: Write failing test — device_remove cannot remove self**

- [ ] **Step 5: Write failing test — puk_rotate generation must increment by 1**

- [ ] **Step 6: Write failing test — fork detection**

- [ ] **Step 7: Run failing tests** — FAIL

- [ ] **Step 8: Implement `verifyUserSigchain`** per spec §3.3.2 rules 1–7

- [ ] **Step 9: Run tests — expect PASS**

- [ ] **Step 10: Commit**

```bash
git add src/client/lib/user-sigchain-verifier.ts src/client/lib/user-sigchain-verifier.test.ts
git commit -m "feat(sigchain): user sigchain verifier with 7 semantic rules + fork detection"
```

### Task 13: User sigchain verifier — hub entries + cross-signing rules

**Files:**
- Modify: `src/client/lib/user-sigchain-verifier.ts`
- Modify: `src/client/lib/user-sigchain-verifier.test.ts`

- [ ] **Step 1: Write failing tests for rules 5 (hub_ptk_rotate admin signer + commitments), 6 (master_signing update), 7 (device_cross_sign), 8 (user_cross_sign verification)**

- [ ] **Step 2: Implement rules 5–8** — extend the verifier

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/user-sigchain-verifier.ts src/client/lib/user-sigchain-verifier.test.ts
git commit -m "feat(sigchain): extend verifier with hub_ptk_rotate, cross-signing, and master-key rules"
```

### Task 14: Incremental verification + IDB cache

**Files:**
- Modify: `src/client/lib/user-sigchain-verifier.ts`
- Modify: `src/client/lib/user-sigchain-verifier.test.ts`

- [ ] **Step 1: Write failing test — second verification reads only delta**

```typescript
test('incremental verification after first full walk reads only new entries', async () => {
  const chain = await buildSyntheticUserSigchain({ length: 100 })
  const state1 = await verifyUserSigchain(chain.entries, { trustAnchor: chain.trustAnchor })
  const newEntries = await buildSyntheticUserSigchain({ prefix: chain, length: 5 })

  const spy = jest.fn()
  const state2 = await verifyUserSigchain(newEntries.entries, {
    trustAnchor: chain.trustAnchor,
    cacheRead: spy,
  })
  // Only the 5 new entries should have been walked
  expect(state2.verifiedCount).toBe(5)
  expect(spy).toHaveBeenCalledWith('lastVerifiedEntryHash', chain.entries[99].entryHash)
})
```

- [ ] **Step 2: Implement per-user cache partition in the existing Tier 0 `audit-chain-cache` IDB store**

```typescript
interface UserSigchainCacheRow {
  userId: string
  lastVerifiedEntryHash: string | null
  lastVerifiedIndex: number
  verifiedState: {
    devices: Array<{ deviceId: string; signingPubkey: string; encryptionPubkey: string }>
    pukGeneration: number
    masterPubkey: string | null
    selfSigningPubkey: string | null
    userSigningPubkey: string | null
  }
}
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/user-sigchain-verifier.ts src/client/lib/user-sigchain-verifier.test.ts
git commit -m "feat(sigchain): incremental verification with per-user IDB cache"
```

### Task 15: Sigchain perf budget test

**Files:**
- Create: `tests/perf/sigchain-verification.spec.ts`

- [ ] **Step 1: Write the perf test**

```typescript
test('cold-boot verification of 500-entry chain < 500ms', async () => {
  const chain = await buildSyntheticUserSigchain({ length: 500 })
  const start = performance.now()
  await verifyUserSigchain(chain.entries, { trustAnchor: chain.trustAnchor })
  const elapsed = performance.now() - start
  expect(elapsed).toBeLessThan(500)
})

test('incremental verification of 5 new entries < 50ms', async () => {
  const chain = await buildSyntheticUserSigchain({ length: 500 })
  await verifyUserSigchain(chain.entries, { trustAnchor: chain.trustAnchor })
  const newEntries = await buildSyntheticUserSigchain({ prefix: chain, length: 5 })
  const start = performance.now()
  await verifyUserSigchain(newEntries.entries, { trustAnchor: chain.trustAnchor })
  const elapsed = performance.now() - start
  expect(elapsed).toBeLessThan(50)
})
```

- [ ] **Step 2: Run the perf test** — should PASS if the implementation is reasonable

- [ ] **Step 3: If the perf budget is exceeded,** investigate: is it HMAC-SHA256 in a loop? Is the cache being rebuilt on each call? Fix the root cause; do NOT relax the budget.

- [ ] **Step 4: Commit**

```bash
git add tests/perf/sigchain-verification.spec.ts
git commit -m "test(perf): sigchain verification cold-boot and incremental budgets"
```

---

## Workstream 3.4 — Device enrollment flow

### Task 16: Device enrollment state machine

**Files:**
- Create: `src/client/lib/device-enrollment.ts`
- Create: `src/client/lib/device-enrollment.test.ts`

- [ ] **Step 1: Write failing test for state machine transitions**

```typescript
test('new device side transitions idle → generating → awaiting_qr → sas_compare', async () => {
  const machine = createNewDeviceEnrollmentMachine()
  expect(machine.state).toBe('idle')
  await machine.start()
  expect(machine.state).toBe('generating_keypair')
  await machine.waitForKeypair()
  expect(machine.state).toBe('awaiting_qr')
  machine.receivePrimaryPubkey(primaryKp.encryption.publicKey, primaryKp.signing.publicKey)
  expect(machine.state).toBe('sas_compare')
})
```

- [ ] **Step 2: Write failing test for invalid transitions (e.g., can't go from `idle` to `enrolled` directly)**

- [ ] **Step 3: Write failing test for session expiry**

- [ ] **Step 4: Implement the state machine** as a class with methods that throw on invalid transitions

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/device-enrollment.ts src/client/lib/device-enrollment.test.ts
git commit -m "feat(device-enrollment): state machine for new-device and primary-device sides"
```

### Task 17: QR encoding/decoding with enrollment nonce

**Files:**
- Modify: `src/client/lib/device-enrollment.ts`
- Modify: `src/client/lib/device-enrollment.test.ts`

- [ ] **Step 1: Write failing tests for QR encode/decode**

```typescript
test('encodeEnrollmentQr round-trips', () => {
  const payload = {
    newDeviceSigningPubkey: 'aabb...',
    newDeviceEncryptionPubkey: 'ccdd...',
    enrollmentNonce: 'eeff...',
    sessionId: 'sess_123',
  }
  const qr = encodeEnrollmentQr(payload)
  const decoded = decodeEnrollmentQr(qr)
  expect(decoded).toEqual(payload)
})

test('decodeEnrollmentQr rejects tampered payload', () => {
  expect(() => decodeEnrollmentQr('{"bogus":1}')).toThrow()
})
```

- [ ] **Step 2: Implement** using JSON + `@scure/base` base64url for the enrollment nonce

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/device-enrollment.ts src/client/lib/device-enrollment.test.ts
git commit -m "feat(device-enrollment): QR payload encoding with enrollment nonce"
```

### Task 18: Server endpoint — start enrollment session

**Files:**
- Create: `src/server/routes/devices.ts`
- Create: `src/server/routes/devices.test.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Write failing API test**

```typescript
// tests/api/tier3-device-lifecycle.spec.ts (task will continue to expand this)
test('POST /api/auth/devices/enrollment creates a pending session', async ({ request }) => {
  const res = await authedRequest(request, 'POST', '/api/auth/devices/enrollment', {
    enrollmentNonce: '00'.repeat(16),
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body).toHaveProperty('sessionId')
  expect(body).toHaveProperty('expiresAt')
})
```

- [ ] **Step 2: Implement route handler** using `OpenAPIHono` + `createRoute` + zod schema

- [ ] **Step 3: Mount route in `app.ts`**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/devices.ts src/server/routes/devices.test.ts src/server/app.ts
git commit -m "feat(api): POST /api/auth/devices/enrollment — start an enrollment session"
```

### Task 19: Server endpoint — finalize enrollment with signed `device_add`

**Files:**
- Modify: `src/server/routes/devices.ts`
- Modify: `src/server/services/device-service.ts` (create if absent)
- Modify: `src/server/services/audit-log-service.ts` (add `appendBatch`)

- [ ] **Step 1: Write failing API test — happy path**

```typescript
test('POST /api/auth/devices finalizes enrollment with signed device_add', async ({ request }) => {
  const { sessionId } = await startEnrollment(request)
  const deviceAddEntry = await buildTier3DeviceAddFixture({ sessionId })
  const pukEnvelope = await buildTier3PukEnvelopeFixture({ sessionId })
  const res = await authedRequest(request, 'POST', '/api/auth/devices', {
    sessionId,
    deviceAddEntry,
    pukEnvelope,
  })
  expect(res.status()).toBe(201)
})
```

- [ ] **Step 2: Write failing API test — invalid signature rejected**

- [ ] **Step 3: Write failing API test — expired session rejected**

- [ ] **Step 4: Write failing API test — session from different primary device rejected**

- [ ] **Step 5: Implement `device-service.appendDeviceAdd` + route handler**

```typescript
async appendDeviceAdd(params: {
  sessionId: string
  deviceAddEntry: SignedAuditEntry
  pukEnvelope: string
}): Promise<void> {
  const session = await this.db.select().from(deviceEnrollmentSessions).where(eq(deviceEnrollmentSessions.sessionId, params.sessionId)).limit(1)
  if (!session[0]) throw new HTTPException(404, { message: 'session_not_found' })
  if (session[0].expiresAt < new Date()) throw new HTTPException(410, { message: 'session_expired' })
  if (session[0].candidateSigningPubkey !== params.deviceAddEntry.payload.newDeviceSigningPubkey) {
    throw new HTTPException(400, { message: 'candidate_pubkey_mismatch' })
  }

  // Run Tier 0's signed-chain append path + Tier 3's semantic rules.
  await this.auditLogService.appendBatch([params.deviceAddEntry])

  // Insert into user_devices + user_puk_envelopes atomically.
  await this.db.transaction(async (tx) => {
    await tx.insert(userDevices).values({
      deviceId: params.deviceAddEntry.payload.newDeviceId,
      userId: params.deviceAddEntry.payload.userId,
      signingPubkey: params.deviceAddEntry.payload.newDeviceSigningPubkey,
      encryptionPubkey: params.deviceAddEntry.payload.newDeviceEncryptionPubkey,
      encryptedDisplayName: params.deviceAddEntry.payload.newDeviceDisplayName,
      addedByDeviceId: params.deviceAddEntry.payload.signedByDeviceId,
      addedSigchainEntryId: params.deviceAddEntry.id,
    })
    await tx.insert(userPukEnvelopes).values({
      id: crypto.randomUUID(),
      userId: params.deviceAddEntry.payload.userId,
      deviceId: params.deviceAddEntry.payload.newDeviceId,
      generation: /* current gen from sigchain */,
      envelope: params.pukEnvelope,
      sigchainEntryId: params.deviceAddEntry.id,
    })
    await tx.update(deviceEnrollmentSessions)
      .set({ status: 'paired' })
      .where(eq(deviceEnrollmentSessions.sessionId, params.sessionId))
  })
}
```

- [ ] **Step 6: Run tests — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/devices.ts src/server/services/device-service.ts src/server/services/audit-log-service.ts
git commit -m "feat(api): POST /api/auth/devices finalizes enrollment with sigchain append"
```

### Task 20: Server endpoint — list devices

**Files:**
- Modify: `src/server/routes/devices.ts`
- Modify: `src/server/services/device-service.ts`

- [ ] **Step 1: Write failing test**

```typescript
test('GET /api/auth/devices lists all devices with encrypted display names', async ({ request }) => {
  await enrollTwoDevices(request)
  const res = await authedRequest(request, 'GET', '/api/auth/devices')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.devices).toHaveLength(2)
  expect(body.devices[0]).toHaveProperty('encryptedDisplayName')
  expect(body.devices[0]).not.toHaveProperty('displayName')  // never plaintext
})
```

- [ ] **Step 2: Implement handler** returning only non-revoked + ciphertext-only fields

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/devices.ts src/server/services/device-service.ts
git commit -m "feat(api): GET /api/auth/devices returns encrypted display names"
```

### Task 21: Server endpoint — revoke device + cascading rotation

**Files:**
- Modify: `src/server/routes/devices.ts`
- Modify: `src/server/services/device-service.ts`
- Modify: `src/server/services/hub-key-service.ts` (create)

- [ ] **Step 1: Write failing API test — single-hub revoke**

- [ ] **Step 2: Write failing API test — multi-hub atomic revoke**

```typescript
test('DELETE /api/auth/devices/:deviceId rotates all affected hubs atomically', async ({ request }) => {
  const userA = await createUserInNHubs(3, request)
  const secondDevice = await enrollSecondDevice(userA, request)
  const rotationBundle = await buildRevokeRotationBundle({ userId: userA.userId, removedDeviceId: secondDevice.deviceId })
  const res = await authedRequest(request, 'DELETE', `/api/auth/devices/${secondDevice.deviceId}`, rotationBundle)
  expect(res.status()).toBe(200)
  // Assert: 1 device_remove + 3 hub_ptk_rotate entries appended in one transaction
  const chain = await fetchUserSigchain(userA.userId, request)
  const tail = chain.slice(-4)
  expect(tail[0].payload.type).toBe('device_remove')
  expect(tail.slice(1).every((e) => e.payload.type === 'hub_ptk_rotate')).toBe(true)
})
```

- [ ] **Step 3: Write failing API test — partial failure rolls back**

```typescript
test('if any hub rotation fails, the whole revoke transaction rolls back', async ({ request }) => {
  // Inject a crafted commitment mismatch on hub 2 of 3
  // ... assert: device_remove NOT persisted, hub rotations NOT persisted
})
```

- [ ] **Step 4: Write failing API test — cannot revoke self**

- [ ] **Step 5: Implement `device-service.revokeDevice`** that calls `audit-log-service.appendBatch` with all entries in one transaction

- [ ] **Step 6: Run tests — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/devices.ts src/server/services/device-service.ts src/server/services/hub-key-service.ts
git commit -m "feat(api): DELETE /api/auth/devices/:deviceId with atomic cascading revocation"
```

---

## Workstream 3.5 — Hub key per device + schema + CLKR

### Task 22: Drizzle schema — devices + PUK envelopes + hub key envelopes

**Files:**
- Create: `src/server/db/schema/devices.ts`
- Modify: `src/server/db/schema/index.ts`

- [ ] **Step 1: Define all Tier 3 tables** per spec §3.5.1

- [ ] **Step 2: Export from `schema/index.ts`**

- [ ] **Step 3: Generate migration** via `bun run migrate:generate`

- [ ] **Step 4: Inspect generated SQL** — verify it matches the expected DROP TABLE / CREATE TABLE / ALTER TABLE sequence

- [ ] **Step 5: Manually craft `drizzle/migrations/0060_tier3_per_device_keys.sql`** — combining the generated DDL with the clean-cut `DELETE FROM` and `DROP` operations per spec §"Migration":

```sql
-- Tier 3: Per-Device Keys + PUK + Sigchain
-- Pre-production clean cut. Safety interlock below.

-- Safety: refuse to run against a DB that has any users with an encrypted_secret_key.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE encrypted_secret_key <> '') THEN
    RAISE EXCEPTION 'Tier 3 migration blocked: users with encrypted_secret_key exist. This is a pre-production-only migration.';
  END IF;
END $$;

DROP TABLE IF EXISTS provision_rooms;
DROP TABLE IF EXISTS hub_keys;

ALTER TABLE users DROP COLUMN IF EXISTS encrypted_secret_key;
ALTER TABLE users DROP COLUMN IF EXISTS kek_proof_hash;

DELETE FROM audit_log;
DELETE FROM user_security_prefs;

CREATE TABLE user_devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  signing_pubkey TEXT NOT NULL,
  encryption_pubkey TEXT NOT NULL,
  encrypted_display_name TEXT NOT NULL,
  added_by_device_id TEXT,
  added_sigchain_entry_id TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_sigchain_entry_id TEXT,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX user_devices_signing_pubkey_unique ON user_devices(signing_pubkey);
CREATE UNIQUE INDEX user_devices_encryption_pubkey_unique ON user_devices(encryption_pubkey);
CREATE INDEX user_devices_user_active_idx ON user_devices(user_id, revoked_at);

CREATE TABLE user_puk_envelopes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  envelope TEXT NOT NULL,
  sigchain_entry_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX user_puk_envelopes_unique ON user_puk_envelopes(user_id, device_id, generation);
CREATE INDEX user_puk_envelopes_user_gen_idx ON user_puk_envelopes(user_id, generation);

CREATE TABLE hub_ptk_generations (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  old_gen_wrapped_under_new TEXT,
  rotated_by_sigchain_entry_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX hub_ptk_generations_unique ON hub_ptk_generations(hub_id, generation);

CREATE TABLE hub_key_envelopes (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  envelope TEXT NOT NULL,
  sigchain_entry_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX hub_key_envelopes_unique ON hub_key_envelopes(hub_id, generation, device_id);
CREATE INDEX hub_key_envelopes_lookup_idx ON hub_key_envelopes(device_id, hub_id, generation DESC);

CREATE TABLE device_enrollment_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  primary_device_id TEXT NOT NULL,
  candidate_signing_pubkey TEXT NOT NULL,
  candidate_encryption_pubkey TEXT NOT NULL,
  enrollment_nonce TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX enrollment_sessions_user_idx ON device_enrollment_sessions(user_id);

CREATE TABLE user_master_wraps (
  user_id TEXT PRIMARY KEY,
  master_seed_under_puk_secretbox TEXT NOT NULL,
  master_seed_under_recovery_group TEXT,
  puk_seed_under_recovery_group TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 6: Run migration against dev DB** — `bun run migrate`
- [ ] **Step 7: Verify migration applied** — `psql` query to confirm tables exist
- [ ] **Step 8: Commit**

```bash
git add src/server/db/schema/devices.ts src/server/db/schema/index.ts drizzle/migrations/0060_tier3_per_device_keys.sql
git commit -m "feat(db): Tier 3 schema — devices, PUK envelopes, hub PTK generations, enrollment sessions"
```

### Task 23: Hub key service — initial envelope issuance

**Files:**
- Create: `src/server/services/hub-key-service.ts`
- Create: `src/server/services/hub-key-service.test.ts`

- [ ] **Step 1: Write failing test**

Test `issueInitialHubKeyEnvelopes` creates one envelope per device for each hub member. Test `getHubKeyEnvelopeForDevice` returns the current-gen envelope.

- [ ] **Step 2: Implement** using the `hub_key_envelopes` table

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/server/services/hub-key-service.ts src/server/services/hub-key-service.test.ts
git commit -m "feat(hub-key-service): per-device envelope issuance + fetch"
```

### Task 24: Hub key manager (client) — rewrite for per-device model

**Files:**
- Modify: `src/client/lib/hub-key-manager.ts`
- Modify: `src/client/lib/hub-key-manager.test.ts`

- [ ] **Step 1: Delete old `rotateHubKey(memberPubkeys: string[])`**

- [ ] **Step 2: Write failing test for `loadMyHubKeyForHub`**

```typescript
test('loadMyHubKeyForHub verifies sigchain commitment before unwrap', async () => {
  const setup = await bootstrapSingleDeviceUserInHub('hub-a')
  const hubKey = await loadMyHubKeyForHub('hub-a', setup.deviceId)
  expect(hubKey).toBeInstanceOf(Uint8Array)
  expect(hubKey.length).toBe(32)
})

test('loadMyHubKeyForHub rejects on commitment hash mismatch', async () => {
  const setup = await bootstrapSingleDeviceUserInHub('hub-a')
  // Tamper with the server response: change the envelope bytes
  mockApi.rewriteEnvelope('hub-a', setup.deviceId, tamperedEnvelope)
  await expect(loadMyHubKeyForHub('hub-a', setup.deviceId)).rejects.toThrow('commitment_mismatch')
})
```

- [ ] **Step 3: Implement `loadMyHubKeyForHub` and `assertDeviceCommitmentMatches`** per spec §3.5.3

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/hub-key-manager.ts src/client/lib/hub-key-manager.test.ts
git commit -m "feat(hub-key-manager): per-device fetch + sigchain commitment verification"
```

### Task 25: CLKR — hub-key rotation with old-gen wrap

**Files:**
- Modify: `src/client/lib/hub-key-manager.ts`
- Modify: `src/client/lib/hub-key-manager.test.ts`
- Modify: `src/server/services/hub-key-service.ts`
- Modify: `src/server/services/hub-key-service.test.ts`

- [ ] **Step 1: Write failing test — rotation excludes removed device**

- [ ] **Step 2: Write failing test — old content readable via wrap chain**

```typescript
test('content encrypted at gen 1 is readable after 4 rotations', async () => {
  const setup = await bootstrapSingleDeviceUserInHub('hub-a')
  const ciphertext = await encryptFieldUnderHub(setup.deviceId, 'hub-a', 'hello', /* gen */ 1)

  for (let i = 2; i <= 5; i++) {
    await rotateHubKey({ hubId: 'hub-a', reason: 'scheduled' })
  }

  // Now at gen 5, walk backwards to gen 1 to read the original content.
  const plaintext = await decryptFieldUnderHub(setup.deviceId, 'hub-a', ciphertext)
  expect(plaintext).toBe('hello')
})
```

- [ ] **Step 3: Implement `rotateHubKey` (client) + `hub-key-service.rotateHub` (server)**

The client:
1. Calls `user-sigchain-verifier.verifyCurrent()`.
2. Generates new 32-byte random hub key.
3. Fetches the current hub key.
4. AES-GCM-encrypts current hub key under the new hub key with AAD `LABEL_HUB_PTK_PREV_GEN:hubId:newGen`.
5. HPKE-wraps new hub key to every remaining device.
6. Builds the `hub_ptk_rotate` sigchain entry with commitments.
7. POSTs to `/api/hubs/:hubId/rotate`.

The server validates the entry, persists the new generation, stores the envelopes, and commits atomically.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/hub-key-manager.ts src/client/lib/hub-key-manager.test.ts src/server/services/hub-key-service.ts src/server/services/hub-key-service.test.ts
git commit -m "feat(clkr): hub-key rotation with old-gen wrap chain + commitment-signed sigchain entry"
```

### Task 26: Cascading rotation plan (placeholder)

**Files:**
- Modify: `src/client/lib/hub-key-manager.ts`
- Modify: `src/server/services/hub-key-service.ts`

- [ ] **Step 1: Add `planRotationCascade()` as an identity function** returning `{ triggerHub, affectedHubs: [triggerHub] }`. Document: future tiers extend this.

- [ ] **Step 2: Every rotation call goes through `planRotationCascade`** — grep-assert that no call site bypasses it

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/hub-key-manager.ts src/server/services/hub-key-service.ts
git commit -m "feat(clkr): planRotationCascade identity stub for future hub-hierarchy support"
```

---

## Workstream 3.6 — Cross-signing + master key + Recovery Group

### Task 27: Master key creation + PUK SecretBox wrap

**Files:**
- Create: `src/client/lib/cross-signing.ts`
- Create: `src/client/lib/cross-signing.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
test('createMasterKey produces master, self-signing, user-signing from one seed', async () => {
  const result = await createMasterKey({ pukSecretBoxKey: mockSecretBoxKey })
  expect(result.masterPubkey.length).toBe(32)
  expect(result.selfSigningPubkey.length).toBe(32)
  expect(result.userSigningPubkey.length).toBe(32)
  expect(result.masterSeedWrappedUnderPuk).toBeTruthy()
})

test('deriveMasterFromWrapped roundtrips', async () => {
  const created = await createMasterKey({ pukSecretBoxKey: mockSecretBoxKey })
  const rederived = await deriveMasterFromWrapped({
    wrapped: created.masterSeedWrappedUnderPuk,
    pukSecretBoxKey: mockSecretBoxKey,
  })
  expect(rederived.masterPubkey).toEqual(created.masterPubkey)
  expect(rederived.selfSigningPubkey).toEqual(created.selfSigningPubkey)
})
```

- [ ] **Step 2: Implement** per spec §3.6.2

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/cross-signing.ts src/client/lib/cross-signing.test.ts
git commit -m "feat(cross-signing): master key + self-signing + user-signing from PUK-wrapped seed"
```

### Task 28: Device cross-signing (self-signing key signs own devices)

**Files:**
- Modify: `src/client/lib/cross-signing.ts`
- Modify: `src/client/lib/cross-signing.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
test('crossSignOwnDevice produces valid device_cross_sign entry', async () => {
  const master = await createMasterKey({ pukSecretBoxKey: mockSecretBoxKey })
  const device = await generateDeviceKeypair({ isPaperKey: false })
  const entry = await crossSignOwnDevice({
    device,
    master,
    pukSecretBoxKey: mockSecretBoxKey,
  })
  expect(entry.payload.type).toBe('device_cross_sign')
  // Verify the self-signing signature over the device signing pubkey
  const ok = await crypto.subtle.verify(
    { name: 'Ed25519' },
    await importRawEd25519Pub(master.selfSigningPubkey),
    hexToBytes(entry.payload.selfSigningSignature),
    device.signing.publicKey,
  )
  expect(ok).toBe(true)
})
```

- [ ] **Step 2: Implement** transient derivation + sign + zero pattern

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/cross-signing.ts src/client/lib/cross-signing.test.ts
git commit -m "feat(cross-signing): crossSignOwnDevice with transient self-signing key"
```

### Task 29: User-to-user cross-signing

**Files:**
- Modify: `src/client/lib/cross-signing.ts`
- Modify: `src/client/lib/cross-signing.test.ts`

- [ ] **Step 1: Write failing tests for `crossSignOtherUser` + `verifyTransitiveTrust`**

```typescript
test('alice cross-signs bob → bob device trusted transitively', async () => {
  const alice = await setUpTestUser()
  const bob = await setUpTestUser()
  const bobDevice2 = await addSecondDeviceToTestUser(bob)
  // bobDevice2 is signed by bob's self-signing key (via crossSignOwnDevice inside enrollment)

  // alice cross-signs bob's master key
  const crossSignEntry = await crossSignOtherUser({
    signingUser: alice,
    signedMasterPubkey: bob.master.masterPubkey,
    mode: 'sas',
  })

  // alice verifies bob's new device via transitive trust
  const trusted = await verifyTransitiveTrust({
    trustingUser: alice,
    candidateDevice: bobDevice2,
    candidateUserMaster: bob.master.masterPubkey,
    targetSigchainState: { ... },
  })
  expect(trusted).toBe(true)
})
```

- [ ] **Step 2: Implement**

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/cross-signing.ts src/client/lib/cross-signing.test.ts
git commit -m "feat(cross-signing): user-to-user cross-sign + transitive trust verification"
```

### Task 30: Recovery Group extension (master + PUK dual-wrap)

**Files:**
- Create: `src/client/lib/recovery-group-tier3.ts`
- Create: `src/client/lib/recovery-group-tier3.test.ts`

- [ ] **Step 1: Write failing tests**

Recovery Group wraps BOTH the master seed and the PUK seed. Reconstructed Recovery Group private key opens both wraps.

- [ ] **Step 2: Implement** on top of Tier 2's Recovery Group module

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/recovery-group-tier3.ts src/client/lib/recovery-group-tier3.test.ts
git commit -m "feat(recovery-group): dual-wrap master seed + PUK seed under Recovery Group"
```

### Task 31: Server recovery service

**Files:**
- Create: `src/server/services/recovery-service.ts`
- Create: `src/server/services/recovery-service.test.ts`
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Write failing tests for initiate + complete**

```typescript
test('recovery initiated by admin creates a request', async ({ request }) => {
  const admin = await loginAsAdmin()
  const res = await authedRequest(request, 'POST', '/api/auth/recovery/initiate', {
    targetUserId: 'user-xyz',
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.recoveryRequestId).toBeTruthy()
})

test('recovery completed with threshold participants', async ({ request }) => {
  const { requestId } = await initiateRecovery(request)
  const recoveryEntry = await buildRecoveryCompletedFixture({ requestId, numAdmins: 2 })
  const res = await authedRequest(request, 'POST', `/api/auth/recovery/${requestId}/complete`, recoveryEntry)
  expect(res.status()).toBe(200)
})

test('recovery completed below threshold rejected', async ({ request }) => {
  // ... same setup but with numAdmins: 1
  expect(res.status()).toBe(400)
})
```

- [ ] **Step 2: Implement `recovery-service.initiate`, `recovery-service.complete`**

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/server/services/recovery-service.ts src/server/services/recovery-service.test.ts src/server/routes/auth-facade.ts
git commit -m "feat(api): recovery initiate + complete with Shamir threshold enforcement"
```

---

## Workstream 3.7 — Paper key

### Task 32: Paper key generation

**Files:**
- Create: `src/client/lib/paper-key.ts`
- Create: `src/client/lib/paper-key.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
test('generatePaperRecoveryKey produces a valid BIP39 mnemonic', async () => {
  const result = await generatePaperRecoveryKey({ primaryDevice: kp, pukGen: 1 })
  const words = result.mnemonic.split(' ')
  expect(words.length).toBe(24)
  expect(validateMnemonic(result.mnemonic, wordlist)).toBe(true)
  expect(result.deviceAddEntry.payload.type).toBe('device_add')
  expect(result.deviceAddEntry.payload.signedByDeviceId).toBe(kp.deviceId)
})

test('deterministic derivation — same mnemonic → same keypair', async () => {
  const result = await generatePaperRecoveryKey({ primaryDevice: kp, pukGen: 1 })
  const derived1 = await derivePaperKeyFromMnemonic(result.mnemonic)
  const derived2 = await derivePaperKeyFromMnemonic(result.mnemonic)
  expect(derived1.signingPublicKey).toEqual(derived2.signingPublicKey)
  expect(derived1.encryptionPublicKey).toEqual(derived2.encryptionPublicKey)
})

test('invalid mnemonic rejected', async () => {
  await expect(derivePaperKeyFromMnemonic('not a valid mnemonic')).rejects.toThrow()
})
```

- [ ] **Step 2: Implement** per spec §3.8.1

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/paper-key.ts src/client/lib/paper-key.test.ts
git commit -m "feat(paper-key): BIP39 24-word paper recovery key with device_add sigchain entry"
```

### Task 33: Paper key recovery flow

**Files:**
- Modify: `src/client/lib/paper-key.ts`
- Modify: `src/client/lib/paper-key.test.ts`

- [ ] **Step 1: Write failing test — full recovery flow**

```typescript
test('recoverFromPaperKey produces a new device keypair + retires paper key', async () => {
  // Setup: a user with a primary device and a paper key
  const primary = await setupPrimaryDeviceWithPaperKey()
  const { mnemonic } = primary.paperKey

  // Simulate: primary is lost. Recover using the paper key on a fresh browser.
  await clearDeviceKeypairStore()  // fresh browser state

  const recovery = await recoverFromPaperKey({ mnemonic, userId: primary.userId })

  // 1. A new device keypair is in IDB
  const newKp = await getDeviceKeypair()
  expect(newKp).not.toBeNull()
  expect(newKp!.deviceId).not.toBe(primary.deviceId)
  expect(newKp!.deviceId).not.toBe(primary.paperKey.deviceId)

  // 2. The paper key is retired (device_remove entry for paperKey.deviceId)
  const sigchain = await fetchUserSigchain(primary.userId)
  const removeEntry = sigchain.find((e) =>
    e.payload.type === 'device_remove' && e.payload.removedDeviceId === primary.paperKey.deviceId,
  )
  expect(removeEntry).toBeTruthy()
})
```

- [ ] **Step 2: Implement** per spec §3.8.2

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/paper-key.ts src/client/lib/paper-key.test.ts
git commit -m "feat(paper-key): recovery flow retires paper key after single use"
```

---

## Workstream 3.8 — Client auth state + migration barrier

### Task 34: Client migration barrier

**Files:**
- Create: `src/client/lib/client-migration-barrier.tsx`
- Modify: `src/client/main.tsx`

- [ ] **Step 1: Write failing test**

```typescript
test('barrier detects legacy localStorage key + redirects to re-onboarding', async () => {
  localStorage.setItem('llamenos-encrypted-key-v2', JSON.stringify({ version: 2 }))
  await clearDeviceKeypairStore()
  const { result } = renderHook(() => useMigrationCheck())
  await waitFor(() => expect(result.current.status).toBe('legacy_detected'))
})

test('barrier passes when only fresh device IDB is present', async () => {
  localStorage.clear()
  await putDeviceKeypair(await generateDeviceKeypair({ isPaperKey: false }))
  const { result } = renderHook(() => useMigrationCheck())
  await waitFor(() => expect(result.current.status).toBe('ready'))
})
```

- [ ] **Step 2: Implement `ClientMigrationBarrier`** that blocks router render until migration check completes

- [ ] **Step 3: Wire into `main.tsx`** above `RouterProvider`

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/client-migration-barrier.tsx src/client/main.tsx
git commit -m "feat(migration): client migration barrier detects legacy storage + forces re-onboarding"
```

### Task 35: Rewrite auth.tsx for Tier 3

**Files:**
- Modify: `src/client/lib/auth.tsx`
- Modify: `src/client/lib/auth.test.tsx`

- [ ] **Step 1: Extend `AuthState`** per spec §3.9.1

- [ ] **Step 2: Rewrite unlock flow:**
  1. Load device keypair from IDB via `getDeviceKeypair`.
  2. If null → redirect to onboarding/pairing.
  3. Call `cryptoWorker.loadDeviceKeypair()`.
  4. Fetch user sigchain via `GET /api/auth/sigchain` and verify via `verifyUserSigchain`.
  5. Fetch PUK envelope for the current device; open via crypto worker handle.
  6. Populate `AuthState.knownDevices`, `pukGeneration`, `sigchainHead`.
  7. Mark `isUnlocked: true`.

- [ ] **Step 3: Write tests**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/auth.tsx src/client/lib/auth.test.tsx
git commit -m "feat(auth): Tier 3 unlock flow via device keypair + sigchain verification"
```

### Task 36: Delete legacy modules

**Files:**
- Delete: `src/client/lib/key-store-v2.ts`
- Delete: `src/client/lib/key-store-v2.test.ts`
- Delete: `src/client/lib/provisioning.ts`
- Delete: `src/client/lib/provisioning.test.ts`
- Delete: `src/server/routes/provision-rooms.ts`
- Delete: `src/server/routes/provision-rooms.test.ts`

- [ ] **Step 1: `git rm` each file**

- [ ] **Step 2: Grep for imports of the deleted symbols** — every call site must be repointed to Tier 3 replacements

- [ ] **Step 3: Run `bun run typecheck`** — expect zero errors

- [ ] **Step 4: Run all existing tests** — expect PASS

- [ ] **Step 5: Commit**

```bash
git rm src/client/lib/key-store-v2.ts src/client/lib/key-store-v2.test.ts src/client/lib/provisioning.ts src/client/lib/provisioning.test.ts src/server/routes/provision-rooms.ts src/server/routes/provision-rooms.test.ts
git commit -m "chore: delete legacy single-nsec and ephemeral-ECDH provisioning modules"
```

### Task 37: IdP adapter cleanup

**Files:**
- Modify: `src/server/idp/adapter.ts`
- Modify: `src/server/idp/authentik-adapter.ts`
- Modify: `src/server/idp/synthetic-adapter.ts` (if exists)

- [ ] **Step 1: Remove `getNsecSecret`, `rotateNsecSecret`, `confirmRotation` from the interface**

- [ ] **Step 2: Remove the implementations in `authentik-adapter.ts`** — also remove Authentik user attribute management for nsec secrets

- [ ] **Step 3: Grep for remaining call sites + delete their usages**

- [ ] **Step 4: Run typecheck** — expect PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/idp/adapter.ts src/server/idp/authentik-adapter.ts
git commit -m "chore(idp): remove nsec-secret methods from IdpAdapter interface"
```

---

## Workstream 3.9 — UI surfaces

### Task 38: Device list page

**Files:**
- Create: `src/client/routes/settings/devices/index.tsx`
- Create: `src/client/components/settings/DeviceListItem.tsx`

- [ ] **Step 1: Write failing UI test**

```typescript
// tests/ui/tier3-device-list.spec.ts — stub
test('device list shows all enrolled devices with decrypted display names', async ({ page }) => {
  await loginAsUserWithNDevices(3, page)
  await page.goto('/settings/devices')
  await expect(page.getByTestId('devices-list')).toBeVisible()
  const rows = page.getByTestId(/^device-row-/)
  await expect(rows).toHaveCount(3)
  await expect(page.getByTestId('device-row-0').getByTestId('device-is-current')).toBeVisible()
})
```

- [ ] **Step 2: Implement the page + components**

Every interactive/locatable element has a `data-testid`:
- `devices-list` on the list root
- `device-row-{index}` on each row
- `device-is-current` badge
- `device-display-name`, `device-added-at`, `device-revoke-button`

- [ ] **Step 3: Run UI test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/settings/devices/index.tsx src/client/components/settings/DeviceListItem.tsx tests/ui/tier3-device-list.spec.ts
git commit -m "feat(ui): device list page with decrypted display names + testid selectors"
```

### Task 39: Device add wizard

**Files:**
- Create: `src/client/routes/settings/devices/add.tsx`
- Create: `src/client/components/settings/DeviceAddWizard.tsx`
- Create: `src/client/components/settings/DeviceAddWizard.test.tsx`

- [ ] **Step 1: Write failing UI test for the wizard**

```typescript
// tests/ui/tier3-device-enrollment.spec.ts
test('device add wizard walks through all states', async ({ page, context }) => {
  await loginAsPrimary(page)
  await page.goto('/settings/devices/add')

  await expect(page.getByTestId('wizard-step-scan-qr')).toBeVisible()
  // Mock the QR scanner with a known candidate
  await page.getByTestId('wizard-paste-qr-button').click()
  await page.getByTestId('wizard-paste-qr-input').fill(mockCandidateQr)
  await page.getByTestId('wizard-paste-qr-submit').click()

  await expect(page.getByTestId('wizard-step-sas-compare')).toBeVisible()
  const primarySas = await page.getByTestId('wizard-sas-code').textContent()
  expect(primarySas).toMatch(/^\d{3} \d{3}$/)

  await page.getByTestId('wizard-sas-confirm-match').click()
  await expect(page.getByTestId('wizard-step-paired')).toBeVisible()
})
```

- [ ] **Step 2: Implement the wizard** with every UI element having a stable testid

- [ ] **Step 3: Run UI test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/settings/devices/add.tsx src/client/components/settings/DeviceAddWizard.tsx tests/ui/tier3-device-enrollment.spec.ts
git commit -m "feat(ui): device add wizard (scan QR → SAS compare → paired)"
```

### Task 40: Recovery phrase display

**Files:**
- Create: `src/client/routes/settings/devices/recovery-phrase.tsx`
- Create: `src/client/components/settings/RecoveryPhraseDisplay.tsx`

- [ ] **Step 1: Write failing UI test**

```typescript
test('recovery phrase is shown once + cleared on confirmation', async ({ page }) => {
  await loginAsPrimary(page)
  await page.goto('/settings/devices/recovery-phrase')
  await page.getByTestId('generate-recovery-phrase-button').click()
  await expect(page.getByTestId('recovery-phrase-display')).toBeVisible()
  const phraseText = await page.getByTestId('recovery-phrase-display').textContent()
  expect(phraseText!.split(/\s+/).filter(Boolean).length).toBe(24)

  await page.getByTestId('recovery-phrase-confirmed-checkbox').check()
  await page.getByTestId('recovery-phrase-continue-button').click()
  // After confirmation, phrase is cleared
  await expect(page.getByTestId('recovery-phrase-display')).not.toBeVisible()
})

test('copy is disabled on recovery phrase display', async ({ page }) => {
  await loginAsPrimary(page)
  await page.goto('/settings/devices/recovery-phrase')
  await page.getByTestId('generate-recovery-phrase-button').click()
  // Simulate Ctrl+C → nothing on clipboard
  await page.keyboard.press('Control+C')
  const clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  expect(clipboard).toBe('')
})
```

- [ ] **Step 2: Implement the component** with user-select: none on the phrase container, oncontextmenu disabled, no copy shortcut handling

- [ ] **Step 3: Run UI test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/settings/devices/recovery-phrase.tsx src/client/components/settings/RecoveryPhraseDisplay.tsx tests/ui/tier3-recovery-phrase.spec.ts
git commit -m "feat(ui): one-shot recovery phrase display with copy-disabled + confirmation gate"
```

### Task 41: Cross-signing status page

**Files:**
- Create: `src/client/routes/settings/security/cross-signing.tsx`
- Create: `src/client/components/settings/CrossSigningStatus.tsx`

- [ ] **Step 1: Write failing UI test**

```typescript
test('cross-signing page shows master fingerprint + verified users', async ({ page }) => {
  await loginAsUserWithCrossSigning(page)
  await page.goto('/settings/security/cross-signing')
  await expect(page.getByTestId('master-pubkey-fingerprint')).toBeVisible()
  await expect(page.getByTestId('verified-users-list')).toBeVisible()
})
```

- [ ] **Step 2: Implement**

- [ ] **Step 3: Run UI test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/settings/security/cross-signing.tsx src/client/components/settings/CrossSigningStatus.tsx tests/ui/tier3-cross-signing-verification.spec.ts
git commit -m "feat(ui): cross-signing status page with master fingerprint + verified users"
```

### Task 42: Onboarding + invite-accept flows

**Files:**
- Modify: `src/client/routes/invites/accept.tsx`
- Modify: `src/client/routes/onboarding/*.tsx`
- Modify: `src/client/routes/login.tsx`

- [ ] **Step 1: Write failing UI test for onboarding flow**

```typescript
test('new user onboarding creates device keypair + user_init sigchain entry', async ({ page }) => {
  await page.goto('/invites/accept?code=abc123')
  await page.getByTestId('onboarding-name-input').fill('Test User')
  await page.getByTestId('onboarding-continue-button').click()
  // PIN step (Tier 2)
  await page.getByTestId('onboarding-pin-input').fill('123456')
  await page.getByTestId('onboarding-pin-confirm').fill('123456')
  await page.getByTestId('onboarding-submit-pin').click()
  // Expect dashboard
  await expect(page.getByTestId('app-shell')).toBeVisible()
  // Expect user_init entry in sigchain
  const sigchain = await fetchUserSigchainViaPage(page)
  expect(sigchain[0].payload.type).toBe('user_init')
})
```

- [ ] **Step 2: Rewrite onboarding** to call `generateDeviceKeypair → putDeviceKeypair → createInitialPuk → createMasterKey → emit user_init sigchain entry → POST to server`

- [ ] **Step 3: Run UI test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/invites/accept.tsx src/client/routes/onboarding src/client/routes/login.tsx tests/ui/tier3-onboarding.spec.ts
git commit -m "feat(ui): onboarding + invite-accept flows emit user_init + create device keypair"
```

---

## Workstream 3.10 — Adversarial API tests + cleanup + docs

### Task 43: API adversarial test battery (A1–A10)

**Files:**
- Create: `tests/api/tier3-sigchain-verification.spec.ts`
- Create: `tests/api/tier3-label-enforcement.spec.ts`

- [ ] **Step 1: Write all A1–A10 test cases** from spec §Testing

For each test, use a fixture helper (`tests/helpers/tier3-device-fixture.ts`) to construct the adversarial scenario — forged entries, replayed entries, tampered commitments, label swaps.

- [ ] **Step 2: Run tests — expect PASS**

- [ ] **Step 3: Commit**

```bash
git add tests/api/tier3-sigchain-verification.spec.ts tests/api/tier3-label-enforcement.spec.ts tests/helpers/tier3-device-fixture.ts
git commit -m "test(api): Tier 3 adversarial battery A1-A10 (sigchain, labels, commitments)"
```

### Task 44: API adversarial test battery (A11–A20)

**Files:**
- Create: `tests/api/tier3-hub-ptk-rotation.spec.ts`
- Create: `tests/api/tier3-puk-rotation.spec.ts`
- Create: `tests/api/tier3-cross-signing.spec.ts`
- Create: `tests/api/tier3-recovery-group.spec.ts`
- Create: `tests/api/tier3-paper-key.spec.ts`
- Create: `tests/api/tier3-device-lifecycle.spec.ts` (full)

- [ ] **Step 1: Write all A11–A20 test cases** from spec §Testing

- [ ] **Step 2: Run tests — expect PASS**

- [ ] **Step 3: Commit**

```bash
git add tests/api/tier3-hub-ptk-rotation.spec.ts tests/api/tier3-puk-rotation.spec.ts tests/api/tier3-cross-signing.spec.ts tests/api/tier3-recovery-group.spec.ts tests/api/tier3-paper-key.spec.ts tests/api/tier3-device-lifecycle.spec.ts
git commit -m "test(api): Tier 3 adversarial battery A11-A20 (CLKR, cross-sign, recovery, paper key)"
```

### Task 45: UI adversarial tests

**Files:**
- Create: `tests/ui/tier3-mitm-enrollment.spec.ts`
- Create: `tests/ui/tier3-hub-rotation-observable.spec.ts`

- [ ] **Step 1: Write MITM enrollment test** using `page.route` to rewrite the QR payload mid-transit

- [ ] **Step 2: Write hub-rotation-observable test** using two browser contexts (admin + volunteer)

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add tests/ui/tier3-mitm-enrollment.spec.ts tests/ui/tier3-hub-rotation-observable.spec.ts
git commit -m "test(ui): Tier 3 MITM-on-enrollment and cross-browser hub rotation observability"
```

### Task 46: CI grep guardrails

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `biome.json`
- Create: `scripts/verify-tier-3.sh`

- [ ] **Step 1: Add CI grep check — no `nsec` in `src/client`**

```yaml
- name: No `nsec` identifiers in src/client
  run: |
    ! grep -rn "\\bnsec\\b" src/client --include="*.ts" --exclude-dir=lib/deprecated || (echo "nsec reference found in src/client" && exit 1)
```

- [ ] **Step 2: Add CI grep check — no `provision_rooms` or `provisioning.ts`**

- [ ] **Step 3: Add CI grep check — no `encryptedSecretKey`**

- [ ] **Step 4: Add CI grep check — no `extractable: true` in `src/client/lib/device-*.ts`**

- [ ] **Step 5: Create `scripts/verify-tier-3.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Tier 3 verification suite"
echo "========================="

echo "1. Typecheck..."
bun run typecheck
echo "2. Lint..."
bun run lint
echo "3. Build..."
bun run build
echo "4. Unit tests..."
bun run test:unit

echo "5. Grep guardrails..."
! grep -rn "\\bnsec\\b" src/client --include="*.ts"
! grep -rn "provision_rooms" src/server --include="*.ts"
! grep -rn "provisioning\\.ts" src --include="*.ts"
! grep -rn "encryptedSecretKey" src --include="*.ts"
! grep -rn "extractable: true" src/client/lib/device-*.ts
! grep -rn "extractable: true" src/client/lib/puk.ts

echo "6. API E2E tests..."
bunx playwright test tests/api/tier3-*

echo "7. UI E2E tests..."
bunx playwright test tests/ui/tier3-*

echo "8. Perf tests..."
bunx playwright test tests/perf/sigchain-verification.spec.ts

echo "9. Audit migration ran successfully..."
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM user_devices;" > /dev/null

echo ""
echo "Tier 3 verification PASSED"
```

- [ ] **Step 6: Make executable + run against dev DB**

```bash
chmod +x scripts/verify-tier-3.sh
./scripts/verify-tier-3.sh
```

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml biome.json scripts/verify-tier-3.sh
git commit -m "chore(ci): Tier 3 grep guardrails + verify-tier-3.sh verification script"
```

### Task 47: Documentation updates

**Files:**
- Modify: `docs/security/THREAT_MODEL.md`
- Modify: `docs/architecture/E2EE_ARCHITECTURE.md`
- Modify: `docs/protocol/llamenos-protocol.md`
- Modify: `docs/security/KEY_REVOCATION_RUNBOOK.md`
- Modify: `CLAUDE.md`
- Create: `docs/security/TIER3_MIGRATION_RUNBOOK.md`

- [ ] **Step 1: Add "Device compromise" section to `THREAT_MODEL.md`**

Content: what a compromised device can and cannot do before/after revocation, how the sigchain + commitments close the Albrecht #1 class.

- [ ] **Step 2: Add "Layer 0: Device identity" section to `E2EE_ARCHITECTURE.md`**

Restructure the three-tier encryption model to a four-tier (Layer 0: device identity → Layer 1: user identity (PUK) → Layer 2: hub PTK → Layer 3: per-artifact keys).

- [ ] **Step 3: Rewrite `llamenos-protocol.md`**

Full Tier 3 protocol: sigchain payload schemas, device enrollment sequence diagram, PUK rotation sequence, CLKR walkthrough, recovery group flow.

- [ ] **Step 4: Rewrite `KEY_REVOCATION_RUNBOOK.md`**

Operators' procedure: how to revoke a lost device, how to verify the revocation took effect, what to do if an admin's own device is compromised.

- [ ] **Step 5: Add "Tier 3 migration notes" section to `CLAUDE.md`**

One-shot section documenting: dev DB wipe required, all test accounts re-onboarded, legacy `llamenos-encrypted-key-v2` localStorage key cleared on first load. This section is removed in the next tier's spec.

- [ ] **Step 6: Create `TIER3_MIGRATION_RUNBOOK.md`**

Pre-production cut-over steps for staging and demo environments.

- [ ] **Step 7: Commit**

```bash
git add docs/security/THREAT_MODEL.md docs/architecture/E2EE_ARCHITECTURE.md docs/protocol/llamenos-protocol.md docs/security/KEY_REVOCATION_RUNBOOK.md CLAUDE.md docs/security/TIER3_MIGRATION_RUNBOOK.md
git commit -m "docs: Tier 3 protocol, threat model, E2EE architecture, migration runbook"
```

### Task 48: Final verification gate

**Files:** none — verification only.

- [ ] **Step 1: Run `./scripts/verify-tier-3.sh`** — all checks must pass

- [ ] **Step 2: Run full test suite at default concurrency**

```bash
bun run test:unit
bunx playwright test tests/api
bunx playwright test tests/ui
```

- [ ] **Step 3: Run UI E2E tests at parallelism**

```bash
PLAYWRIGHT_WORKERS=3 bunx playwright test tests/ui
```

Expected: no test isolation issues (hub tenancy keeps tests isolated).

- [ ] **Step 4: Confirm no legacy identifiers via grep guardrails**

- [ ] **Step 5: Manual smoke test**

1. Fresh browser (clear IDB + localStorage).
2. Accept an invite → onboard as a new user → see empty device list in settings/devices.
3. Add a second device via QR → confirm SAS → see both devices in the list.
4. Revoke the second device → confirm the list shows it as revoked + the revoked device's browser (same profile, different tab) shows "access denied" on next reload.
5. Generate a paper key → write it down → clear the IDB in the primary browser → restore from paper key → full access restored.
6. Run through Recovery Group flow with 2-of-3 admins.

- [ ] **Step 6: Commit the final verification marker**

```bash
git commit --allow-empty -m "chore(tier-3): verification gate green — per-device keys + sigchain complete"
```

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-security-tier-3-per-device-keys.md`.**

Execution options:

1. **Subagent-Driven (strongly recommended for this tier — it is the largest in the roadmap)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in one session with checkpoints. Only recommended if the operator can dedicate a long block of time. Required sub-skill: `superpowers:executing-plans`.

Tier 3 implementation should happen in its own session, distinct from the session that wrote this plan, per the usual superpowers workflow.

**Sequencing notes:**

- Workstreams 3.1–3.3 (Tasks 1–15) are the foundation and must land first. Within them, some tasks can be parallelized by sub-agent (e.g., sigchain verifier tests can be written while the PUK module is being implemented), but no workstream can skip ahead.
- Workstream 3.4 (device enrollment, Tasks 16–21) depends on 3.1–3.3 and the new server schema (Task 22). Task 22 should actually be scheduled AS A PREREQUISITE for Task 18+, not after it — reorder if executing linearly.
- Workstreams 3.5–3.7 can proceed mostly in parallel after the foundation lands.
- Workstream 3.8 (migration barrier + auth rewrite) is gating for end-to-end testability of the rest.
- Workstream 3.9 (UI) depends on 3.4–3.8.
- Workstream 3.10 (adversarial tests + docs + verification) is the closing gate.

**Estimated effort:** ~48 tasks × ~15–30 min each = 12–24 hours of focused work across all tasks. Real-world calendar time for Tier 3 is ~1 month assuming standard review cycles, task handoffs, and debugging time for the crypto-level interactions.

**Branch strategy:** one branch (`feat/sec-tier-3-per-device-keys`) → one PR. Clean cut; no feature flags.
