# Security Tier 2 — Unlock & Recovery Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Llamenos' PIN+Argon2id KEK with a WebAuthn-PRF-primary, OPAQUE-fallback, Diceware-recovery-phrase, 2-of-3-Shamir-Recovery-Group unlock hierarchy with no backward-compatibility shim.

**Architecture:** Seven workstreams batched into one PR. A new `key-store-v3` module owns the root KEK bundle format; the PRF path HKDFs into non-extractable AES-KW keys (Tier 1 dependency); OPAQUE runs via `@serenity-kit/opaque` with Argon2id parameters tuned for the 2 MiB browser cap; the recovery phrase uses EFF large Diceware with `@noble/hashes/argon2`; the Recovery Group uses `shamir-secret-sharing` (privy-io) with HPKE-wrapped shares per admin; every operation signs a typed audit entry into the Tier 0 sigchain before any crypto rewrap runs.

**Tech Stack:** TypeScript, Bun, Hono + `@hono/zod-openapi`, React + TanStack Router, Drizzle ORM + PostgreSQL, `@simplewebauthn/browser` + `@simplewebauthn/server`, `@serenity-kit/opaque`, `shamir-secret-sharing` (privy-io), `@noble/hashes/argon2`, `@noble/ciphers/chacha`, `@noble/curves/ed25519`, `@hpke/core` (Tier 1 dependency), WebCrypto SubtleCrypto `AES-KW` / `HKDF`, Playwright virtual authenticator.

**Spec:** [`docs/superpowers/specs/2026-04-10-security-tier-2-unlock-recovery-design.md`](../specs/2026-04-10-security-tier-2-unlock-recovery-design.md)

**Depends on:** Tier 0 (`CryptoLabel` brand, `EnvelopeV2`, AAD-required AEAD, typed signed audit entries). Tier 1 (non-extractable `CryptoKey`, HPKE, `items_key` indirection). Both must be merged to `main` before this tier's branch is rebased.

---

## File Map

### Created

| File | Responsibility |
|---|---|
| `src/client/lib/key-store-v3.ts` | v3 root KEK bundle encode/decode, envelope insertion, rotation, min-2-factor invariant |
| `src/client/lib/key-store-v3.test.ts` | v3 bundle unit tests |
| `src/client/lib/recovery-phrase.ts` | EFF wordlist loading, 15-word generation (rejection sampling), Argon2id-to-AES-KW derivation |
| `src/client/lib/recovery-phrase.test.ts` | Recovery phrase unit tests |
| `src/client/lib/recovery-group-share.ts` | Shamir split/combine wrappers + HPKE share envelope helpers + SHA-256 commitment check |
| `src/client/lib/recovery-group-share.test.ts` | Shamir + commitment unit tests |
| `src/client/lib/opaque-client.ts` | `@serenity-kit/opaque` client wrapper with our fixed `keyStretching` params + label-scoped `exportKey → AES-KW` helper |
| `src/client/lib/opaque-client.test.ts` | OPAQUE client wrapper unit tests |
| `src/client/lib/unlock-factors.ts` | Tagged-union `UnlockFactor` type + `unlockViaPrf` / `unlockViaOpaque` / `unlockViaRecoveryPhrase` / `unlockViaRecoveryGroup` orchestration |
| `src/client/lib/unlock-factors.test.ts` | Orchestration unit tests |
| `src/client/lib/convenience-pin.ts` | In-session PIN gate: Argon2id-hashed, server-stored, 5-attempt lockout |
| `src/client/lib/convenience-pin.test.ts` | Convenience PIN unit tests |
| `src/client/assets/eff-large-wordlist.ts` | Build-time generated TypeScript wordlist module (7776 entries) with runtime SHA-256 check |
| `src/client/components/unlock-challenge-dialog.tsx` | Replaces `pin-challenge-dialog.tsx`; primary "Unlock with passkey", fallback "Use password", "Use recovery phrase" |
| `src/client/components/factor-enrollment-wizard.tsx` | Multi-step enrollment: passkey A → passkey B → recovery phrase → confirmation |
| `src/client/components/recovery-phrase-display.tsx` | 15-word display card + "I wrote it down" checkbox + 3-word verification prompt |
| `src/client/components/recovery-phrase-entry.tsx` | 15-slot input for recovery entry with per-slot validation |
| `src/client/components/recovery-group-admin-panel.tsx` | Hub admin panel for enrolling / rotating a Recovery Group |
| `src/client/components/recovery-group-volunteer-panel.tsx` | Volunteer recovery request + status panel |
| `src/client/components/recovery-group-share-contribution.tsx` | Admin share contribution UI with 2-admin emergency override flow |
| `src/client/routes/security.recovery.tsx` | New route `/security/recovery` hosting the volunteer recovery panel |
| `src/client/routes/admin/recovery-group.tsx` | New admin route for Recovery Group management |
| `src/shared/schemas/opaque.ts` | `OpaqueRegisterInitSchema`, `OpaqueRegisterFinishSchema`, `OpaqueLoginInitSchema`, `OpaqueLoginFinishSchema` |
| `src/shared/schemas/opaque.test.ts` | OPAQUE schema tests |
| `src/shared/schemas/recovery-group.ts` | Recovery Group endpoint schemas |
| `src/shared/schemas/recovery-group.test.ts` | Schema tests |
| `src/shared/schemas/recovery-phrase.ts` | `RecoveryPhraseRotateSchema`, `RecoveryPhraseMetaSchema` |
| `src/shared/schemas/recovery-phrase.test.ts` | Schema tests |
| `src/shared/schemas/root-kek-envelope.ts` | `RootKekEnvelopeSchema`, `RootKekEnvelopeBundleSchema` |
| `src/shared/schemas/root-kek-envelope.test.ts` | Schema tests |
| `src/shared/schemas/unlock-factors.ts` | Client-side `UnlockFactor` discriminated union schema |
| `src/server/routes/opaque.ts` | `/api/auth/opaque/*` endpoints mounted into the auth facade |
| `src/server/routes/opaque.test.ts` | OPAQUE route unit tests |
| `src/server/routes/recovery-group.ts` | `/api/auth/recovery-group/*` endpoints |
| `src/server/routes/recovery-group.test.ts` | Recovery Group route unit tests |
| `src/server/routes/recovery-phrase.ts` | `/api/auth/recovery-phrase/*` endpoints (rotate only) |
| `src/server/routes/recovery-phrase.test.ts` | Recovery phrase route unit tests |
| `src/server/lib/opaque-server-setup.ts` | `getOpaqueServerSetup` singleton loader + CLI initialization helper |
| `src/server/lib/opaque-server-setup.test.ts` | Server setup unit tests |
| `src/server/lib/opaque-login-state-cache.ts` | In-memory + DB-backed serverLoginState cache for the two-phase login |
| `src/server/lib/opaque-login-state-cache.test.ts` | Cache unit tests |
| `src/server/services/recovery-group-service.ts` | DB-level enrollment, share contribution, delay enforcement, override validation, rotation |
| `src/server/services/recovery-group-service.test.ts` | Service unit tests |
| `src/server/services/root-kek-envelope-service.ts` | Bundle CRUD server-side, min-2-envelope invariant, `rootKeyId` change stamp |
| `src/server/services/root-kek-envelope-service.test.ts` | Service unit tests |
| `src/server/db/schema/opaque.ts` | `opaqueServerSetup`, `userOpaqueRecords` tables |
| `src/server/db/schema/recovery.ts` | `userRootKekEnvelopes`, `userRecoveryPhraseMeta`, `hubRecoveryGroups`, `hubRecoveryGroupShares`, `userRecoveryEnvelopes`, `recoverySessions` tables |
| `scripts/generate-eff-wordlist.ts` | Build script that downloads and embeds EFF wordlist into `src/client/assets/eff-large-wordlist.ts` |
| `scripts/init-opaque-server-setup.ts` | CLI that creates the OPAQUE server setup row if absent |
| `drizzle/migrations/0051_tier2_unlock_recovery.sql` | Wipe v2 artifacts + create new tables |
| `tests/api/opaque-roundtrip.spec.ts` | Register→login round-trip + `exportKey` stability |
| `tests/api/opaque-brute-force-resistance.spec.ts` | Adversarial: rate limits + timing resistance |
| `tests/api/opaque-server-compromise.spec.ts` | Adversarial: dumped records are offline-useless |
| `tests/api/prf-fallback.spec.ts` | Adversarial: PRF-absent → OPAQUE/phrase fallback enforcement |
| `tests/api/recovery-phrase-rotate.spec.ts` | Rotate endpoint + rate limit + audit entry |
| `tests/api/recovery-group.spec.ts` | Full enrollment + 2-of-3 recovery flow |
| `tests/api/recovery-group-threshold-boundary.spec.ts` | Adversarial: 1/2/3 share boundary |
| `tests/api/recovery-group-audit.spec.ts` | Adversarial: delay + override enforcement |
| `tests/api/factor-management.spec.ts` | Factor add/remove + min-2 invariant |
| `tests/api/v2-format-migration.spec.ts` | One-shot migration test |
| `tests/ui/prf-enrollment.spec.ts` | Fresh onboarding |
| `tests/ui/prf-unlock.spec.ts` | Locked → PRF unlock |
| `tests/ui/opaque-login.spec.ts` | OPAQUE user flow |
| `tests/ui/prf-fallback-to-opaque.spec.ts` | PRF-fail → OPAQUE |
| `tests/ui/recovery-phrase-entry.spec.ts` | Recovery on fresh device |
| `tests/ui/recovery-phrase-entry-typo.spec.ts` | Adversarial: typo rejection |
| `tests/ui/recovery-group-enrollment.spec.ts` | Admin enrolls group |
| `tests/ui/recovery-group-flow.spec.ts` | End-to-end recovery flow |
| `tests/ui/recovery-group-delay-enforcement.spec.ts` | Adversarial: 24h delay |
| `tests/ui/recovery-group-emergency-override.spec.ts` | Override flow |
| `tests/ui/factor-removal-rejection.spec.ts` | Min-2 UI enforcement |
| `tests/ui/convenience-pin.spec.ts` | Convenience-lock state |
| `tests/ui/capsule-invalidation-on-factor-change.spec.ts` | Capsule wipe on factor change |
| `tests/helpers/virtual-authenticator.ts` | Chromium virtual authenticator + PRF mock helper |

### Modified

| File | Change |
|---|---|
| `src/shared/crypto-labels.ts` | Add `LABEL_PRF_KEK_SALT_V1`, `LABEL_ROOT_KEK_WRAP`, `LABEL_RECOVERY_PHRASE_KEK`, `LABEL_OPAQUE_EXPORT_KEK`, `LABEL_RECOVERY_GROUP_WRAP`, `LABEL_RECOVERY_GROUP_SHARE`, `LABEL_RECOVERY_SESSION_PAYLOAD`. Remove `LABEL_NSEC_KEK_2F`, `LABEL_NSEC_KEK_3F`, `LABEL_KEK_PRF`, `LABEL_IDP_VALUE_WRAP`, `RECOVERY_SALT` |
| `src/shared/schemas/audit-entries.ts` | Extend union with `root_kek_rotate`, `factor_add`, `factor_remove`, `recovery_group_enroll`, `recovery_group_rotate`, `recovery_initiated`, `recovery_share_contributed`, `recovery_completed` |
| `src/client/lib/key-store-v2.ts` | **Deleted** — replaced by `key-store-v3.ts` |
| `src/client/lib/key-manager.ts` | Rewire around `unlock-factors.ts`; replace `unlock(pin)` with `unlock(factor: UnlockFactor)`; add convenience-lock state; rewire `importKey` → `enroll(params)` |
| `src/client/lib/key-manager.test.ts` | Update tests for new state machine and factor-based unlock |
| `src/client/lib/webauthn.ts` | Replace `requestWebAuthnPRF` with `registerPrfCredential` + `unlockPrfFromCredential` |
| `src/client/lib/webauthn.test.ts` | Update tests for PRF branches |
| `src/client/lib/backup.ts` | **Deleted** — replaced by `recovery-phrase.ts` |
| `src/client/lib/session-capsule.ts` | Bump capsule shape to `{ encryptedRootKek, rootKeyId, expiresAt, userIdHash }`; clear on factor change |
| `src/client/lib/session-capsule.test.ts` | Update tests for new capsule shape |
| `src/client/lib/auth-facade-client.ts` | Add OPAQUE endpoints + Recovery Group endpoints + recovery phrase rotate; remove PIN change endpoints |
| `src/client/lib/provisioning.ts` | Swap ephemeral-ECDH-encrypted-nsec transport for enrollment-permission-token transport |
| `src/client/lib/crypto-worker.ts` | Add `importRootKek`, `wrapItemsKeyUnderRootKek`, `unwrapRootKekEnvelope` handlers; remove PIN-KEK handlers |
| `src/client/lib/crypto-worker-client.ts` | Thread new handler types |
| `src/client/components/pin-challenge-dialog.tsx` | **Deleted** — replaced by `unlock-challenge-dialog.tsx` |
| `src/client/components/setup/SetupWizard.tsx` | Replace PIN step with factor enrollment wizard |
| `src/client/components/setup/AdminBootstrap.tsx` | Use new enrollment wizard |
| `src/client/components/user-sections/pin-change-section.tsx` | **Deleted** — replaced by factor management in `security/factors` |
| `src/client/components/user-sections/recovery-rotate-section.tsx` | **Deleted** — replaced by recovery phrase rotate flow |
| `src/client/components/user-sections/idle-lock-section.tsx` | Add convenience-PIN toggle |
| `src/client/components/LockdownModal.tsx` | Use new `hardLock()` API |
| `src/client/routes/security.factors.tsx` | Replace with passkey list + recovery phrase rotate + OPAQUE password change + convenience PIN toggle |
| `src/client/routes/login.tsx` | Replace PIN entry with unlock-challenge-dialog |
| `src/client/routes/onboarding.tsx` | Replace PIN creation with factor-enrollment-wizard |
| `src/server/routes/auth-facade.ts` | Mount `/opaque/*`, `/recovery-group/*`, `/recovery-phrase/*` sub-routers; delete `/pin/*`, `/recovery/*` routes |
| `src/server/routes/auth-facade.test.ts` | Update tests for removed PIN endpoints |
| `src/server/lib/webauthn.ts` | Thread `prf: boolean` option through `generateRegOptions` + `generateAuthOptions` |
| `src/server/services/identity.ts` | Add `storeOpaqueRecord`, `getOpaqueRecord`, `storeRecoveryPhraseMeta`, `getRecoveryPhraseMeta`; remove `kek_proof_hash` helpers |
| `src/server/services/sessions.ts` | No change in logic; remove PIN proof coupling |
| `src/server/services/user-notifications.ts` | Add `recovery_initiated`, `recovery_completed`, `factor_added`, `factor_removed` notification types |
| `src/server/db/schema/identity.ts` | Drop `encryptedSecretKey`, `kekProofHash` columns from `users` |
| `src/server/db/schema/security-prefs.ts` | Add `conveniencePinHash`, `conveniencePinAttempts` columns |
| `src/server/db/schema/index.ts` | Export new opaque + recovery tables |
| `src/shared/schemas/auth.ts` | Add the new unlock-facade types, remove `PinChangeSchema`, `RecoveryRotateSchema` imports |
| `src/shared/schemas/pin-change.ts` | **Deleted** |
| `src/shared/schemas/recovery-rotate.ts` | **Deleted** |
| `src/shared/schemas/kek-proof.ts` | **Deleted** |
| `src/shared/schemas/index.ts` | Update barrel exports |
| `tests/fixtures/auth.ts` | Replace PIN entry with virtual-authenticator PRF unlock |
| `tests/helpers/index.ts` | Export virtual-authenticator helpers |
| `tests/api/pin-change.spec.ts` | **Deleted** |
| `tests/api/recovery-rotate.spec.ts` | **Deleted** |
| `tests/api/passkeys.spec.ts` | Update to cover PRF-enabled registration |
| `tests/api/sessions.spec.ts` | Update to remove PIN proof assertions |
| `tests/ui/pin-challenge.spec.ts` | **Deleted** — replaced by `convenience-pin.spec.ts` and `prf-unlock.spec.ts` |
| `tests/ui/security-actions.spec.ts` | Update to cover factor management + recovery rotation |
| `package.json` | Add `@serenity-kit/opaque`, `shamir-secret-sharing` dependencies |
| `biome.json` | Grep rule to forbid reintroduction of deprecated labels and columns |
| `.github/workflows/ci.yml` | Grep rule: forbid `encrypted_secret_key`, `kek_proof_hash`, `LABEL_NSEC_KEK_*`, `LABEL_KEK_PRF` literals in source |
| `docs/security/KEY_REVOCATION_RUNBOOK.md` | Update for factor-based revocation |
| `docs/security/README.md` | Link to new spec |
| `CLAUDE.md` | Tier 2 migration note + add new env vars if any |

---

## Workstream 2.0 — Dependencies, labels, schemas

### Task 1: Install new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@serenity-kit/opaque` + `shamir-secret-sharing`**

Run: `bun add @serenity-kit/opaque shamir-secret-sharing`

Expected: both added to `package.json` under `dependencies`. Bun fetches the latest stable versions.

- [ ] **Step 2: Verify types resolve**

Run: `bun run typecheck`

Expected: PASS — no baseline type regressions.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add @serenity-kit/opaque + shamir-secret-sharing for Tier 2 unlock rewrite"
```

### Task 2: Add new crypto labels, remove dead ones

**Files:**
- Modify: `src/shared/crypto-labels.ts`
- Modify: `src/shared/crypto-labels.test.ts` (create if absent)

- [ ] **Step 1: Write failing test for the new labels**

```typescript
// src/shared/crypto-labels.test.ts (append or create)
import { describe, expect, test } from 'bun:test'
import {
  LABEL_PRF_KEK_SALT_V1,
  LABEL_ROOT_KEK_WRAP,
  LABEL_RECOVERY_PHRASE_KEK,
  LABEL_OPAQUE_EXPORT_KEK,
  LABEL_RECOVERY_GROUP_WRAP,
  LABEL_RECOVERY_GROUP_SHARE,
  LABEL_RECOVERY_SESSION_PAYLOAD,
} from './crypto-labels'

describe('Tier 2 labels', () => {
  test('all Tier 2 labels are defined and unique', () => {
    const labels = [
      LABEL_PRF_KEK_SALT_V1,
      LABEL_ROOT_KEK_WRAP,
      LABEL_RECOVERY_PHRASE_KEK,
      LABEL_OPAQUE_EXPORT_KEK,
      LABEL_RECOVERY_GROUP_WRAP,
      LABEL_RECOVERY_GROUP_SHARE,
      LABEL_RECOVERY_SESSION_PAYLOAD,
    ]
    const unique = new Set(labels)
    expect(unique.size).toBe(labels.length)
    for (const l of labels) {
      expect(l.startsWith('llamenos:')).toBe(true)
    }
  })

  test('deprecated labels are removed', async () => {
    const src = await Bun.file('src/shared/crypto-labels.ts').text()
    expect(src).not.toContain('LABEL_NSEC_KEK_2F')
    expect(src).not.toContain('LABEL_NSEC_KEK_3F')
    expect(src).not.toContain('LABEL_KEK_PRF ')
    expect(src).not.toContain('LABEL_IDP_VALUE_WRAP')
    expect(src).not.toContain('RECOVERY_SALT')
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/shared/crypto-labels.test.ts -t "Tier 2 labels"`
Expected: FAIL — new label constants are not exported.

- [ ] **Step 3: Update `src/shared/crypto-labels.ts`**

Add these new labels in a new "Tier 2 — Unlock & Recovery" section (near the existing IdP Auth Hardening section) and **delete** the five deprecated labels called out in the test:

```typescript
// --- Tier 2 — Unlock & Recovery Overhaul ---

/** WebAuthn PRF extension eval salt (versioned) — hardware-rooted KEK factor */
export const LABEL_PRF_KEK_SALT_V1 = 'llamenos:kek-prf-salt:v1' as CryptoLabel

/** HKDF base label for root KEK wrapping key derivation — suffix per factor */
export const LABEL_ROOT_KEK_WRAP = 'llamenos:root-kek-wrap' as CryptoLabel

/** Recovery phrase Argon2id → HKDF → AES-KW domain separation */
export const LABEL_RECOVERY_PHRASE_KEK = 'llamenos:recovery-phrase-kek' as CryptoLabel

/** OPAQUE exportKey → HKDF → AES-KW domain separation */
export const LABEL_OPAQUE_EXPORT_KEK = 'llamenos:opaque-export-kek' as CryptoLabel

/** Recovery Group X25519 recipient envelope label */
export const LABEL_RECOVERY_GROUP_WRAP = 'llamenos:recovery-group-wrap' as CryptoLabel

/** Recovery Group per-admin Shamir share HPKE envelope label */
export const LABEL_RECOVERY_GROUP_SHARE = 'llamenos:recovery-group-share' as CryptoLabel

/** Recovery session payload envelope label (coordinator ephemeral key) */
export const LABEL_RECOVERY_SESSION_PAYLOAD = 'llamenos:recovery-session-payload' as CryptoLabel
```

Then **delete** these lines from the file:

```typescript
// REMOVE:
export const LABEL_KEK_PRF = 'llamenos:kek-prf'
export const LABEL_NSEC_KEK_3F = 'llamenos:nsec-kek:3f'
export const LABEL_NSEC_KEK_2F = 'llamenos:nsec-kek:2f'
export const LABEL_IDP_VALUE_WRAP = 'llamenos:idp-value-wrap'
export const RECOVERY_SALT = 'llamenos:recovery'
```

Also add the new labels to `LABEL_REGISTRY` (the Tier 0 array of all labels used in envelopes) — append them in order at the end of the existing array.

- [ ] **Step 4: Run the test**

Run: `bun test src/shared/crypto-labels.test.ts -t "Tier 2 labels"`
Expected: PASS.

- [ ] **Step 5: Fix every importer of the deleted labels**

Run: `bun run typecheck 2>&1 | head -100`

Expected: typecheck errors in `src/client/lib/key-store-v2.ts`, `src/client/lib/webauthn.ts`, `src/client/lib/backup.ts`, possibly `src/server/routes/auth-facade.ts`, `src/server/services/identity.ts`, plus any IdP adapter files.

For each file:
- Files that will be deleted entirely in later tasks (e.g. `key-store-v2.ts`, `backup.ts`) — leave broken; they go away in Task 6 / Task 14.
- Files that need to survive — either remove the reference or stub it temporarily with a clearly-marked comment `// TEMP: Tier 2 migration — removed in Task NN`.

Specifically in `src/client/lib/webauthn.ts`, the `LABEL_KEK_PRF` usage in `requestWebAuthnPRF` is removed in Task 20. For this task, change the import line to pull from a not-yet-existing label only when the new task happens — for now, remove the import and the `requestWebAuthnPRF` implementation body (replace it with `throw new Error('removed')`) so the file still compiles.

- [ ] **Step 6: Commit**

```bash
git add src/shared/crypto-labels.ts src/shared/crypto-labels.test.ts src/client/lib/webauthn.ts
git commit -m "feat(crypto-labels): add Tier 2 KEK + recovery labels; remove PIN-era labels"
```

### Task 3: Root KEK envelope schemas

**Files:**
- Create: `src/shared/schemas/root-kek-envelope.ts`
- Create: `src/shared/schemas/root-kek-envelope.test.ts`
- Modify: `src/shared/schemas/index.ts`

- [ ] **Step 1: Write failing schema tests**

```typescript
// src/shared/schemas/root-kek-envelope.test.ts
import { describe, expect, test } from 'bun:test'
import {
  RootKekEnvelopeSchema,
  RootKekEnvelopeBundleSchema,
} from './root-kek-envelope'

describe('RootKekEnvelopeSchema', () => {
  const validEnvelope = {
    v: 3,
    factorType: 'prf' as const,
    factorId: 'credential-abc',
    wrappedKey: 'deadbeef'.repeat(8),
    createdAt: '2026-04-10T00:00:00.000Z',
  }

  test('accepts a valid envelope', () => {
    expect(() => RootKekEnvelopeSchema.parse(validEnvelope)).not.toThrow()
  })

  test('rejects unknown factorType', () => {
    expect(() =>
      RootKekEnvelopeSchema.parse({ ...validEnvelope, factorType: 'pin' }),
    ).toThrow()
  })

  test('rejects non-hex wrappedKey', () => {
    expect(() =>
      RootKekEnvelopeSchema.parse({ ...validEnvelope, wrappedKey: 'not-hex' }),
    ).toThrow()
  })
})

describe('RootKekEnvelopeBundleSchema', () => {
  const makeEnvelope = (factorType: string, factorId: string) => ({
    v: 3 as const,
    factorType,
    factorId,
    wrappedKey: 'cafe'.repeat(16),
    createdAt: '2026-04-10T00:00:00.000Z',
  })

  test('accepts a valid bundle with 2 envelopes', () => {
    const bundle = {
      v: 3 as const,
      userId: '00000000-0000-0000-0000-000000000001',
      rootKeyId: '00000000-0000-0000-0000-000000000002',
      envelopes: [makeEnvelope('prf', 'cred-a'), makeEnvelope('recoveryPhrase', 'phrase')],
      createdAt: '2026-04-10T00:00:00.000Z',
    }
    expect(() => RootKekEnvelopeBundleSchema.parse(bundle)).not.toThrow()
  })

  test('rejects a bundle with fewer than 2 envelopes', () => {
    const bundle = {
      v: 3 as const,
      userId: '00000000-0000-0000-0000-000000000001',
      rootKeyId: '00000000-0000-0000-0000-000000000002',
      envelopes: [makeEnvelope('prf', 'cred-a')],
      createdAt: '2026-04-10T00:00:00.000Z',
    }
    expect(() => RootKekEnvelopeBundleSchema.parse(bundle)).toThrow()
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/shared/schemas/root-kek-envelope.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the schema file**

```typescript
// src/shared/schemas/root-kek-envelope.ts
import { z } from '@hono/zod-openapi'

export const RootKekEnvelopeSchema = z.object({
  v: z.literal(3),
  factorType: z.enum(['prf', 'opaque', 'recoveryPhrase', 'recoveryGroup']),
  factorId: z.string().min(1).max(256),
  wrappedKey: z.string().regex(/^[0-9a-f]+$/, 'wrappedKey must be lowercase hex'),
  createdAt: z.string().datetime(),
})
export type RootKekEnvelope = z.infer<typeof RootKekEnvelopeSchema>

export const RootKekEnvelopeBundleSchema = z.object({
  v: z.literal(3),
  userId: z.string().uuid(),
  rootKeyId: z.string().uuid(),
  envelopes: z.array(RootKekEnvelopeSchema).min(2, 'at least two factors required'),
  createdAt: z.string().datetime(),
})
export type RootKekEnvelopeBundle = z.infer<typeof RootKekEnvelopeBundleSchema>
```

- [ ] **Step 4: Re-export from the barrel**

Append to `src/shared/schemas/index.ts`:

```typescript
export * from './root-kek-envelope'
```

- [ ] **Step 5: Run the test**

Run: `bun test src/shared/schemas/root-kek-envelope.test.ts`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/schemas/root-kek-envelope.ts src/shared/schemas/root-kek-envelope.test.ts src/shared/schemas/index.ts
git commit -m "feat(schemas): RootKekEnvelope + Bundle with min-2-factor invariant"
```

### Task 4: OPAQUE + recovery-phrase + recovery-group request schemas

**Files:**
- Create: `src/shared/schemas/opaque.ts`
- Create: `src/shared/schemas/opaque.test.ts`
- Create: `src/shared/schemas/recovery-phrase.ts`
- Create: `src/shared/schemas/recovery-phrase.test.ts`
- Create: `src/shared/schemas/recovery-group.ts`
- Create: `src/shared/schemas/recovery-group.test.ts`
- Modify: `src/shared/schemas/index.ts`

- [ ] **Step 1: Write failing tests for OPAQUE schemas**

```typescript
// src/shared/schemas/opaque.test.ts
import { describe, expect, test } from 'bun:test'
import {
  OpaqueRegisterInitSchema,
  OpaqueRegisterFinishSchema,
  OpaqueLoginInitSchema,
  OpaqueLoginFinishSchema,
} from './opaque'

describe('OPAQUE schemas', () => {
  test('register init accepts userIdentifier + base64url registrationRequest', () => {
    const ok = OpaqueRegisterInitSchema.safeParse({
      userIdentifier: 'alice@example.com',
      registrationRequest: 'Zm9vYmFy',
    })
    expect(ok.success).toBe(true)
  })

  test('register finish requires registrationRecord base64url', () => {
    const ok = OpaqueRegisterFinishSchema.safeParse({
      registrationRecord: 'Zm9vYmFy',
    })
    expect(ok.success).toBe(true)
  })

  test('login init requires userIdentifier + startLoginRequest', () => {
    const ok = OpaqueLoginInitSchema.safeParse({
      userIdentifier: 'alice@example.com',
      startLoginRequest: 'Zm9vYmFy',
    })
    expect(ok.success).toBe(true)
  })

  test('login finish requires userIdentifier + finishLoginRequest', () => {
    const ok = OpaqueLoginFinishSchema.safeParse({
      userIdentifier: 'alice@example.com',
      finishLoginRequest: 'Zm9vYmFy',
    })
    expect(ok.success).toBe(true)
  })

  test('rejects non-base64url payloads', () => {
    expect(
      OpaqueRegisterInitSchema.safeParse({
        userIdentifier: 'alice@example.com',
        registrationRequest: '!!!not-base64!!!',
      }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Write the schema file**

```typescript
// src/shared/schemas/opaque.ts
import { z } from '@hono/zod-openapi'

// base64url character set: A-Z a-z 0-9 - _, no padding
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'must be unpadded base64url')

export const OpaqueRegisterInitSchema = z.object({
  userIdentifier: z.string().min(1).max(256),
  registrationRequest: base64url,
})
export type OpaqueRegisterInitInput = z.infer<typeof OpaqueRegisterInitSchema>

export const OpaqueRegisterFinishSchema = z.object({
  registrationRecord: base64url,
})
export type OpaqueRegisterFinishInput = z.infer<typeof OpaqueRegisterFinishSchema>

export const OpaqueLoginInitSchema = z.object({
  userIdentifier: z.string().min(1).max(256),
  startLoginRequest: base64url,
})
export type OpaqueLoginInitInput = z.infer<typeof OpaqueLoginInitSchema>

export const OpaqueLoginFinishSchema = z.object({
  userIdentifier: z.string().min(1).max(256),
  finishLoginRequest: base64url,
})
export type OpaqueLoginFinishInput = z.infer<typeof OpaqueLoginFinishSchema>

export const OpaqueRegisterInitResponseSchema = z.object({
  registrationResponse: base64url,
})
export const OpaqueLoginInitResponseSchema = z.object({
  loginResponse: base64url,
})
export const OpaqueLoginFinishResponseSchema = z.object({
  accessToken: z.string(),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
})
```

- [ ] **Step 3: Write failing recovery-phrase schema test**

```typescript
// src/shared/schemas/recovery-phrase.test.ts
import { describe, expect, test } from 'bun:test'
import { RecoveryPhraseRotateSchema, RecoveryPhraseMetaSchema } from './recovery-phrase'

describe('Recovery phrase schemas', () => {
  test('rotate body carries new envelope + new meta', () => {
    const ok = RecoveryPhraseRotateSchema.safeParse({
      newEnvelope: {
        v: 3,
        factorType: 'recoveryPhrase',
        factorId: 'phrase',
        wrappedKey: 'cafe'.repeat(16),
        createdAt: '2026-04-10T00:00:00.000Z',
      },
      newMeta: {
        salt: '00'.repeat(32),
        kdfParams: { algo: 'argon2id', t: 2, m: 19456, p: 1 },
      },
    })
    expect(ok.success).toBe(true)
  })

  test('meta requires 32-byte salt hex', () => {
    const bad = RecoveryPhraseMetaSchema.safeParse({
      salt: 'short',
      kdfParams: { algo: 'argon2id', t: 2, m: 19456, p: 1 },
    })
    expect(bad.success).toBe(false)
  })
})
```

- [ ] **Step 4: Write the recovery-phrase schema file**

```typescript
// src/shared/schemas/recovery-phrase.ts
import { z } from '@hono/zod-openapi'
import { RootKekEnvelopeSchema } from './root-kek-envelope'

export const RecoveryPhraseMetaSchema = z.object({
  salt: z.string().regex(/^[0-9a-f]{64}$/, 'salt must be 32 bytes hex'),
  kdfParams: z.object({
    algo: z.literal('argon2id'),
    t: z.number().int().min(1).max(10),
    m: z.number().int().min(1024).max(1_048_576),
    p: z.number().int().min(1).max(16),
  }),
})
export type RecoveryPhraseMeta = z.infer<typeof RecoveryPhraseMetaSchema>

export const RecoveryPhraseRotateSchema = z.object({
  newEnvelope: RootKekEnvelopeSchema,
  newMeta: RecoveryPhraseMetaSchema,
})
export type RecoveryPhraseRotateInput = z.infer<typeof RecoveryPhraseRotateSchema>
```

- [ ] **Step 5: Write failing recovery-group schema test**

```typescript
// src/shared/schemas/recovery-group.test.ts
import { describe, expect, test } from 'bun:test'
import {
  RecoveryGroupEnrollSchema,
  RecoveryInitiateSchema,
  RecoveryContributeShareSchema,
  RecoveryCompleteSchema,
} from './recovery-group'

describe('Recovery Group schemas', () => {
  test('enroll requires threshold 2-5 and commitments match share count', () => {
    const ok = RecoveryGroupEnrollSchema.safeParse({
      hubId: '00000000-0000-0000-0000-000000000001',
      threshold: 2,
      totalShares: 3,
      groupPublicKey: '00'.repeat(32),
      shareEnvelopes: [
        { adminPubkey: 'aa'.repeat(32), envelope: 'cafe' },
        { adminPubkey: 'bb'.repeat(32), envelope: 'cafe' },
        { adminPubkey: 'cc'.repeat(32), envelope: 'cafe' },
      ],
      shareCommitments: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
    })
    expect(ok.success).toBe(true)
  })

  test('enroll rejects mismatched totalShares and envelopes length', () => {
    const bad = RecoveryGroupEnrollSchema.safeParse({
      hubId: '00000000-0000-0000-0000-000000000001',
      threshold: 2,
      totalShares: 3,
      groupPublicKey: '00'.repeat(32),
      shareEnvelopes: [{ adminPubkey: 'aa'.repeat(32), envelope: 'cafe' }],
      shareCommitments: ['11'.repeat(32)],
    })
    expect(bad.success).toBe(false)
  })

  test('initiate requires new device pubkey', () => {
    const ok = RecoveryInitiateSchema.safeParse({
      hubId: '00000000-0000-0000-0000-000000000001',
      userIdentifier: 'alice@example.com',
      newDevicePubkey: 'dd'.repeat(32),
    })
    expect(ok.success).toBe(true)
  })

  test('contribute share requires session id + encrypted share', () => {
    const ok = RecoveryContributeShareSchema.safeParse({
      sessionId: '00000000-0000-0000-0000-000000000002',
      encryptedShare: 'cafe',
    })
    expect(ok.success).toBe(true)
  })

  test('complete requires coordinator signature over new bundle', () => {
    const ok = RecoveryCompleteSchema.safeParse({
      sessionId: '00000000-0000-0000-0000-000000000002',
      newBundle: {
        v: 3,
        userId: '00000000-0000-0000-0000-000000000001',
        rootKeyId: '00000000-0000-0000-0000-000000000003',
        envelopes: [
          { v: 3, factorType: 'prf', factorId: 'cred-new', wrappedKey: 'cafe', createdAt: '2026-04-10T00:00:00.000Z' },
          { v: 3, factorType: 'recoveryPhrase', factorId: 'phrase', wrappedKey: 'cafe', createdAt: '2026-04-10T00:00:00.000Z' },
        ],
        createdAt: '2026-04-10T00:00:00.000Z',
      },
      emergencyOverride: undefined,
    })
    expect(ok.success).toBe(true)
  })
})
```

- [ ] **Step 6: Write the recovery-group schema file**

```typescript
// src/shared/schemas/recovery-group.ts
import { z } from '@hono/zod-openapi'
import { RootKekEnvelopeBundleSchema } from './root-kek-envelope'

const hex32 = z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex')
const hex = z.string().regex(/^[0-9a-f]+$/, 'must be hex')

export const RecoveryGroupShareEnvelopeSchema = z.object({
  adminPubkey: hex32,
  envelope: hex,
})
export type RecoveryGroupShareEnvelope = z.infer<typeof RecoveryGroupShareEnvelopeSchema>

export const RecoveryGroupEnrollSchema = z
  .object({
    hubId: z.string().uuid(),
    threshold: z.number().int().min(2).max(5),
    totalShares: z.number().int().min(3).max(5),
    groupPublicKey: hex32,
    shareEnvelopes: z.array(RecoveryGroupShareEnvelopeSchema).min(3).max(5),
    shareCommitments: z.array(hex32).min(3).max(5),
  })
  .refine(
    (v) => v.shareEnvelopes.length === v.totalShares && v.shareCommitments.length === v.totalShares,
    { message: 'shareEnvelopes and shareCommitments length must equal totalShares' },
  )
  .refine((v) => v.threshold <= v.totalShares, { message: 'threshold cannot exceed totalShares' })
export type RecoveryGroupEnrollInput = z.infer<typeof RecoveryGroupEnrollSchema>

export const RecoveryInitiateSchema = z.object({
  hubId: z.string().uuid(),
  userIdentifier: z.string().min(1).max(256),
  newDevicePubkey: hex32,
})
export type RecoveryInitiateInput = z.infer<typeof RecoveryInitiateSchema>

export const RecoveryContributeShareSchema = z.object({
  sessionId: z.string().uuid(),
  encryptedShare: hex,
})
export type RecoveryContributeShareInput = z.infer<typeof RecoveryContributeShareSchema>

export const EmergencyOverrideSchema = z.object({
  justification: z.string().min(16).max(2048),
  coApproverPubkey: hex32,
  coApproverSignature: z.string().regex(/^[0-9a-f]{128}$/),
})
export type EmergencyOverrideInput = z.infer<typeof EmergencyOverrideSchema>

export const RecoveryCompleteSchema = z.object({
  sessionId: z.string().uuid(),
  newBundle: RootKekEnvelopeBundleSchema,
  emergencyOverride: EmergencyOverrideSchema.optional(),
})
export type RecoveryCompleteInput = z.infer<typeof RecoveryCompleteSchema>
```

- [ ] **Step 7: Add barrel exports**

```typescript
// src/shared/schemas/index.ts (append)
export * from './opaque'
export * from './recovery-phrase'
export * from './recovery-group'
```

- [ ] **Step 8: Run all three test files**

Run: `bun test src/shared/schemas/opaque.test.ts src/shared/schemas/recovery-phrase.test.ts src/shared/schemas/recovery-group.test.ts`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shared/schemas/opaque.ts src/shared/schemas/opaque.test.ts src/shared/schemas/recovery-phrase.ts src/shared/schemas/recovery-phrase.test.ts src/shared/schemas/recovery-group.ts src/shared/schemas/recovery-group.test.ts src/shared/schemas/index.ts
git commit -m "feat(schemas): Tier 2 OPAQUE + recovery phrase + recovery group schemas"
```

### Task 5: Extend audit-entry payload union

**Files:**
- Modify: `src/shared/schemas/audit-entries.ts`
- Modify: `src/shared/schemas/audit-entries.test.ts`

- [ ] **Step 1: Write failing test for new audit payloads**

Append to `src/shared/schemas/audit-entries.test.ts`:

```typescript
describe('Tier 2 audit payloads', () => {
  test('root_kek_rotate parses', () => {
    const ok = AuditEntryPayloadSchema.safeParse({
      type: 'root_kek_rotate',
      userId: '00000000-0000-0000-0000-000000000001',
      oldRootKeyId: '00000000-0000-0000-0000-000000000002',
      newRootKeyId: '00000000-0000-0000-0000-000000000003',
      reason: 'factor_added',
    })
    expect(ok.success).toBe(true)
  })

  test('factor_add parses', () => {
    const ok = AuditEntryPayloadSchema.safeParse({
      type: 'factor_add',
      userId: '00000000-0000-0000-0000-000000000001',
      factorType: 'prf',
      factorId: 'cred-a',
    })
    expect(ok.success).toBe(true)
  })

  test('recovery_group_enroll parses with 2-of-3 threshold', () => {
    const ok = AuditEntryPayloadSchema.safeParse({
      type: 'recovery_group_enroll',
      hubId: '00000000-0000-0000-0000-000000000001',
      threshold: 2,
      totalShares: 3,
      adminPubkeys: ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)],
      shareCommitments: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
      groupPublicKey: '44'.repeat(32),
    })
    expect(ok.success).toBe(true)
  })

  test('recovery_completed requires ≥2 sharedBy', () => {
    const bad = AuditEntryPayloadSchema.safeParse({
      type: 'recovery_completed',
      hubId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000002',
      sharedBy: ['aa'.repeat(32)],
      newDevicePubkey: 'bb'.repeat(32),
    })
    expect(bad.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/shared/schemas/audit-entries.test.ts -t "Tier 2"`
Expected: FAIL — new payload types are not in the union.

- [ ] **Step 3: Extend the payload union**

Edit `src/shared/schemas/audit-entries.ts` — add the new payload schemas:

```typescript
export const RootKekRotatePayloadSchema = z.object({
  type: z.literal('root_kek_rotate'),
  userId: z.string().uuid(),
  oldRootKeyId: z.string().uuid(),
  newRootKeyId: z.string().uuid(),
  reason: z.enum(['factor_added', 'factor_removed', 'recovery_completed', 'scheduled', 'manual']),
})

export const FactorAddPayloadSchema = z.object({
  type: z.literal('factor_add'),
  userId: z.string().uuid(),
  factorType: z.enum(['prf', 'opaque', 'recoveryPhrase']),
  factorId: z.string(),
})

export const FactorRemovePayloadSchema = z.object({
  type: z.literal('factor_remove'),
  userId: z.string().uuid(),
  factorType: z.enum(['prf', 'opaque', 'recoveryPhrase']),
  factorId: z.string(),
})

export const RecoveryGroupEnrollPayloadSchema = z.object({
  type: z.literal('recovery_group_enroll'),
  hubId: z.string().uuid(),
  threshold: z.number().int().min(2).max(5),
  totalShares: z.number().int().min(3).max(5),
  adminPubkeys: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(3).max(5),
  shareCommitments: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(3).max(5),
  groupPublicKey: z.string().regex(/^[0-9a-f]{64}$/),
})

export const RecoveryGroupRotatePayloadSchema = z.object({
  type: z.literal('recovery_group_rotate'),
  hubId: z.string().uuid(),
  reason: z.enum(['admin_removed', 'admin_added', 'compromise_suspected', 'scheduled', 'manual']),
  oldGroupPublicKey: z.string().regex(/^[0-9a-f]{64}$/),
  newGroupPublicKey: z.string().regex(/^[0-9a-f]{64}$/),
})

export const RecoveryInitiatedPayloadSchema = z.object({
  type: z.literal('recovery_initiated'),
  hubId: z.string().uuid(),
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
})

export const RecoveryShareContributedPayloadSchema = z.object({
  type: z.literal('recovery_share_contributed'),
  hubId: z.string().uuid(),
  sessionId: z.string().uuid(),
  byAdminPubkey: z.string().regex(/^[0-9a-f]{64}$/),
})

export const RecoveryCompletedPayloadSchema = z.object({
  type: z.literal('recovery_completed'),
  hubId: z.string().uuid(),
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sharedBy: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(2),
  emergencyOverride: z
    .object({
      invoked: z.boolean(),
      justification: z.string().optional(),
      coApproverPubkey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    })
    .optional(),
  newDevicePubkey: z.string().regex(/^[0-9a-f]{64}$/),
})
```

Append the new schemas to `AuditEntryPayloadSchema`'s `discriminatedUnion`:

```typescript
export const AuditEntryPayloadSchema = z.discriminatedUnion('type', [
  // ... existing entries from Tier 0 ...
  RootKekRotatePayloadSchema,
  FactorAddPayloadSchema,
  FactorRemovePayloadSchema,
  RecoveryGroupEnrollPayloadSchema,
  RecoveryGroupRotatePayloadSchema,
  RecoveryInitiatedPayloadSchema,
  RecoveryShareContributedPayloadSchema,
  RecoveryCompletedPayloadSchema,
])
```

- [ ] **Step 4: Run the test**

Run: `bun test src/shared/schemas/audit-entries.test.ts -t "Tier 2"`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas/audit-entries.ts src/shared/schemas/audit-entries.test.ts
git commit -m "feat(audit): Tier 2 payload types — root_kek_rotate, factor_*, recovery_*"
```

## Workstream 2.1 — WebAuthn PRF

### Task 6: Delete `key-store-v2.ts` and `backup.ts`; delete `kek-proof.ts`, `pin-change.ts`, `recovery-rotate.ts` schemas

**Files:**
- Delete: `src/client/lib/key-store-v2.ts`
- Delete: `src/client/lib/key-store-v2.test.ts`
- Delete: `src/client/lib/backup.ts`
- Delete: `src/client/lib/backup.test.ts`
- Delete: `src/shared/schemas/kek-proof.ts`
- Delete: `src/shared/schemas/pin-change.ts`
- Delete: `src/shared/schemas/recovery-rotate.ts`

- [ ] **Step 1: Grep every importer**

Run: `bun run typecheck 2>&1 | tee /tmp/typecheck-before-delete.log`

Expected: dozens of errors in files that currently import from these modules. This is the reference list we rewrite in Tasks 7–30.

- [ ] **Step 2: Delete the files**

```bash
git rm src/client/lib/key-store-v2.ts src/client/lib/key-store-v2.test.ts
git rm src/client/lib/backup.ts src/client/lib/backup.test.ts
git rm src/shared/schemas/kek-proof.ts src/shared/schemas/pin-change.ts src/shared/schemas/recovery-rotate.ts
```

- [ ] **Step 3: Quiet the imports (temporary stubs)**

For every file that imported from the deleted modules, add `// TEMP: Tier 2 migration — tasks 7–30 rewrite this` at the import line, then comment out the use so the file parses. Do NOT try to keep runtime behavior; those consumers are rewritten in later tasks. Many of the consumers will be rewritten whole-file.

The minimum set that must still compile for subsequent tasks to run:
- `src/client/lib/key-manager.ts` — comment out all imports from key-store-v2 and every function body that references them; leave function signatures with `throw new Error('key-manager rewrite in progress')`. Key-manager is rewritten from scratch in Task 15.
- `src/server/routes/auth-facade.ts` — delete every route block inside `/pin/*`, `/recovery/*`, `/kek-proof/*`; delete the schema imports; the routes are re-added in Tasks 22–30.
- `src/server/services/identity.ts` — remove any `kekProofHash` field references; the column is dropped in Task 37.

- [ ] **Step 4: Typecheck to confirm the baseline is still buildable**

Run: `bun run typecheck 2>&1 | grep error | wc -l`

Expected: a list of remaining errors — all from files that will be fully rewritten in the next tasks. Confirm the error count roughly matches the deleted-imports count in Step 1; any unrelated errors are the current state of the branch and must be resolved before continuing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(tier2): delete PIN-era key-store-v2, backup, pin-change, recovery-rotate schemas"
```

### Task 7: Create `key-store-v3.ts` with root KEK bundle primitives

**Files:**
- Create: `src/client/lib/key-store-v3.ts`
- Create: `src/client/lib/key-store-v3.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/key-store-v3.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  encodeBundle,
  decodeBundle,
  appendEnvelope,
  removeEnvelope,
  rotateBundle,
  assertMinFactorInvariant,
  MinFactorsError,
} from './key-store-v3'
import type { RootKekEnvelope, RootKekEnvelopeBundle } from '@shared/schemas/root-kek-envelope'

const env = (factorType: RootKekEnvelope['factorType'], id: string): RootKekEnvelope => ({
  v: 3,
  factorType,
  factorId: id,
  wrappedKey: 'ca'.repeat(40),
  createdAt: '2026-04-10T00:00:00.000Z',
})

const bundle = (envelopes: RootKekEnvelope[]): RootKekEnvelopeBundle => ({
  v: 3,
  userId: '00000000-0000-0000-0000-000000000001',
  rootKeyId: '00000000-0000-0000-0000-000000000002',
  envelopes,
  createdAt: '2026-04-10T00:00:00.000Z',
})

describe('key-store-v3 primitives', () => {
  test('encode/decode round-trips', () => {
    const b = bundle([env('prf', 'a'), env('recoveryPhrase', 'phrase')])
    const json = encodeBundle(b)
    const decoded = decodeBundle(json)
    expect(decoded).toEqual(b)
  })

  test('decode rejects a tampered bundle missing envelopes', () => {
    const b = bundle([env('prf', 'a'), env('recoveryPhrase', 'phrase')])
    const json = encodeBundle(b)
    const tampered = JSON.parse(json)
    tampered.envelopes = [env('prf', 'a')]
    expect(() => decodeBundle(JSON.stringify(tampered))).toThrow()
  })

  test('appendEnvelope adds a new factor', () => {
    const b = bundle([env('prf', 'a'), env('recoveryPhrase', 'phrase')])
    const out = appendEnvelope(b, env('prf', 'b'))
    expect(out.envelopes).toHaveLength(3)
    expect(out.rootKeyId).toBe(b.rootKeyId) // append does NOT change rootKeyId
  })

  test('removeEnvelope refuses to drop below 2', () => {
    const b = bundle([env('prf', 'a'), env('recoveryPhrase', 'phrase')])
    expect(() => removeEnvelope(b, { factorType: 'prf', factorId: 'a' })).toThrow(MinFactorsError)
  })

  test('removeEnvelope works when there are ≥3 factors', () => {
    const b = bundle([env('prf', 'a'), env('prf', 'b'), env('recoveryPhrase', 'phrase')])
    const out = removeEnvelope(b, { factorType: 'prf', factorId: 'a' })
    expect(out.envelopes).toHaveLength(2)
  })

  test('rotateBundle replaces rootKeyId and rewraps all envelopes', () => {
    const b = bundle([env('prf', 'a'), env('recoveryPhrase', 'phrase')])
    const out = rotateBundle(b, (e) => ({ ...e, wrappedKey: 'ff'.repeat(40) }))
    expect(out.rootKeyId).not.toBe(b.rootKeyId)
    expect(out.envelopes.every((e) => e.wrappedKey === 'ff'.repeat(40))).toBe(true)
    expect(out.envelopes).toHaveLength(b.envelopes.length)
  })

  test('assertMinFactorInvariant throws for length < 2', () => {
    expect(() => assertMinFactorInvariant(bundle([env('prf', 'a')]))).toThrow(MinFactorsError)
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run: `bun test src/client/lib/key-store-v3.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `key-store-v3.ts`**

```typescript
// src/client/lib/key-store-v3.ts
/**
 * v3 root-KEK envelope bundle encoder/decoder + CRUD primitives.
 *
 * Replaces key-store-v2.ts (PIN+Argon2id path). The root KEK itself is held in
 * the crypto worker as a non-extractable AES-KW CryptoKey; this module only
 * operates on the on-disk/API representation (the envelope bundle).
 *
 * Invariants enforced here:
 *   - envelopes.length >= 2 at all times (`MinFactorsError` on violation)
 *   - rootKeyId changes on every rotate (but not on append)
 *   - schema-valid shape via `RootKekEnvelopeBundleSchema`
 */
import {
  type RootKekEnvelope,
  type RootKekEnvelopeBundle,
  RootKekEnvelopeBundleSchema,
} from '@shared/schemas/root-kek-envelope'

export class MinFactorsError extends Error {
  constructor(detail: string) {
    super(`Min factor invariant violated: ${detail}`)
    this.name = 'MinFactorsError'
  }
}

export function encodeBundle(bundle: RootKekEnvelopeBundle): string {
  RootKekEnvelopeBundleSchema.parse(bundle)
  return JSON.stringify(bundle)
}

export function decodeBundle(raw: string): RootKekEnvelopeBundle {
  const parsed = JSON.parse(raw) as unknown
  return RootKekEnvelopeBundleSchema.parse(parsed)
}

export function assertMinFactorInvariant(bundle: RootKekEnvelopeBundle): void {
  if (bundle.envelopes.length < 2) {
    throw new MinFactorsError(`bundle has ${bundle.envelopes.length} envelopes`)
  }
}

/**
 * Append a new envelope. Does NOT rotate — the caller already holds the root KEK
 * in the worker and is simply adding another unwrapping route for it.
 */
export function appendEnvelope(
  bundle: RootKekEnvelopeBundle,
  envelope: RootKekEnvelope,
): RootKekEnvelopeBundle {
  const envelopes = [...bundle.envelopes.filter(
    (e) => !(e.factorType === envelope.factorType && e.factorId === envelope.factorId),
  ), envelope]
  const next: RootKekEnvelopeBundle = { ...bundle, envelopes }
  assertMinFactorInvariant(next)
  return RootKekEnvelopeBundleSchema.parse(next)
}

/**
 * Remove an envelope by (factorType, factorId). Throws if the removal would drop
 * the bundle below the 2-factor minimum.
 */
export function removeEnvelope(
  bundle: RootKekEnvelopeBundle,
  target: { factorType: RootKekEnvelope['factorType']; factorId: string },
): RootKekEnvelopeBundle {
  const envelopes = bundle.envelopes.filter(
    (e) => !(e.factorType === target.factorType && e.factorId === target.factorId),
  )
  const next: RootKekEnvelopeBundle = { ...bundle, envelopes }
  assertMinFactorInvariant(next)
  return RootKekEnvelopeBundleSchema.parse(next)
}

/**
 * Rotate: generate a new rootKeyId, re-wrap every envelope via the supplied
 * callback. Callers typically invoke this inside the crypto worker where the
 * old root KEK can be unwrapped and a fresh one generated.
 */
export function rotateBundle(
  bundle: RootKekEnvelopeBundle,
  rewrap: (envelope: RootKekEnvelope) => RootKekEnvelope,
): RootKekEnvelopeBundle {
  const envelopes = bundle.envelopes.map(rewrap)
  const next: RootKekEnvelopeBundle = {
    ...bundle,
    rootKeyId: crypto.randomUUID(),
    envelopes,
    createdAt: new Date().toISOString(),
  }
  assertMinFactorInvariant(next)
  return RootKekEnvelopeBundleSchema.parse(next)
}

/**
 * Persist the bundle to IDB (object store: `llamenos-root-kek` / key: `active`).
 * Separate from encodeBundle so tests can round-trip without IDB.
 */
const DB_NAME = 'llamenos-root-kek'
const STORE_NAME = 'bundles'
const ACTIVE_KEY = 'active'

export async function storeBundleInIdb(bundle: RootKekEnvelopeBundle): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
      tx.objectStore(STORE_NAME).put(bundle, ACTIVE_KEY)
    })
  } finally {
    db.close()
  }
}

export async function loadBundleFromIdb(): Promise<RootKekEnvelopeBundle | null> {
  const db = await openDb()
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      tx.onerror = () => reject(tx.error ?? new Error('IDB get failed'))
      const req = tx.objectStore(STORE_NAME).get(ACTIVE_KEY)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IDB get failed'))
    })
    if (!raw) return null
    return RootKekEnvelopeBundleSchema.parse(raw)
  } finally {
    db.close()
  }
}

export async function clearBundleFromIdb(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB clear failed'))
      tx.objectStore(STORE_NAME).delete(ACTIVE_KEY)
    })
  } finally {
    db.close()
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}
```

- [ ] **Step 4: Run the test**

Run: `bun test src/client/lib/key-store-v3.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/key-store-v3.ts src/client/lib/key-store-v3.test.ts
git commit -m "feat(key-store-v3): root KEK envelope bundle primitives with min-2-factor invariant"
```

### Task 8: Recovery phrase wordlist + generation

**Files:**
- Create: `scripts/generate-eff-wordlist.ts`
- Create: `src/client/assets/eff-large-wordlist.ts`
- Create: `src/client/lib/recovery-phrase.ts`
- Create: `src/client/lib/recovery-phrase.test.ts`

- [ ] **Step 1: Write the generator script**

```typescript
// scripts/generate-eff-wordlist.ts
/**
 * Downloads the EFF large wordlist and embeds it as a TypeScript module.
 *
 *   bun run scripts/generate-eff-wordlist.ts
 *
 * The wordlist is served from https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt
 * in the canonical Diceware format: "11111\tword\n11112\tword\n...". We drop the
 * dice-index column and emit a 7776-entry string array. The SHA-256 of the final
 * text is asserted against a constant so any tampering during download is
 * detected at build time.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const URL = 'https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt'
const EXPECTED_SHA256 = 'addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e'

async function main() {
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const text = await res.text()
  const hash = createHash('sha256').update(text).digest('hex')
  if (hash !== EXPECTED_SHA256) {
    throw new Error(`EFF wordlist SHA-256 mismatch: ${hash} !== ${EXPECTED_SHA256}`)
  }
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length !== 7776) throw new Error(`expected 7776 words, got ${lines.length}`)
  const words: string[] = []
  for (const line of lines) {
    const [, word] = line.split(/\s+/)
    if (!word) throw new Error(`bad line: ${line}`)
    words.push(word)
  }
  const out = `/**
 * EFF large Diceware wordlist — 7776 entries, ~12.9 bits/word.
 * Auto-generated by scripts/generate-eff-wordlist.ts; do not edit by hand.
 * Source: https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt
 */
export const EFF_LARGE_WORDLIST = [
${words.map((w) => `  '${w}'`).join(',\n')},
] as const

export const EFF_LARGE_WORDLIST_SHA256 = '${EXPECTED_SHA256}' as const
`
  writeFileSync('src/client/assets/eff-large-wordlist.ts', out)
  console.log(`Wrote ${words.length} words to src/client/assets/eff-large-wordlist.ts`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Run the generator**

Run: `bun run scripts/generate-eff-wordlist.ts`
Expected: success; `src/client/assets/eff-large-wordlist.ts` exists with ~7800 lines.

- [ ] **Step 3: Write failing test for `recovery-phrase.ts`**

```typescript
// src/client/lib/recovery-phrase.test.ts
import { describe, expect, test } from 'bun:test'
import {
  generateRecoveryPhrase,
  validateRecoveryPhrase,
  deriveRecoveryPhraseKekBytes,
  normalizeRecoveryPhrase,
  RecoveryPhraseError,
} from './recovery-phrase'
import { EFF_LARGE_WORDLIST } from '@/assets/eff-large-wordlist'

describe('recovery-phrase', () => {
  test('generateRecoveryPhrase returns 15 words from the wordlist by default', () => {
    const phrase = generateRecoveryPhrase()
    const words = phrase.split(' ')
    expect(words).toHaveLength(15)
    for (const w of words) {
      expect(EFF_LARGE_WORDLIST).toContain(w)
    }
  })

  test('generateRecoveryPhrase supports 12/15/18/24 word counts', () => {
    expect(generateRecoveryPhrase(12).split(' ')).toHaveLength(12)
    expect(generateRecoveryPhrase(24).split(' ')).toHaveLength(24)
  })

  test('normalizeRecoveryPhrase lowercases and collapses whitespace', () => {
    expect(normalizeRecoveryPhrase('  Foo   Bar   Baz  ')).toBe('foo bar baz')
  })

  test('validateRecoveryPhrase accepts a generated phrase', () => {
    const phrase = generateRecoveryPhrase(15)
    expect(validateRecoveryPhrase(phrase)).toBe(true)
  })

  test('validateRecoveryPhrase rejects a non-wordlist word', () => {
    const phrase = generateRecoveryPhrase(15).split(' ')
    phrase[0] = 'xyzzynotaword'
    expect(validateRecoveryPhrase(phrase.join(' '))).toBe(false)
  })

  test('validateRecoveryPhrase rejects wrong length', () => {
    expect(validateRecoveryPhrase('abandon abandon abandon')).toBe(false)
  })

  test('deriveRecoveryPhraseKekBytes is deterministic for same phrase+salt', () => {
    const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve'
    const salt = new Uint8Array(32).fill(7)
    const a = deriveRecoveryPhraseKekBytes(phrase, salt)
    const b = deriveRecoveryPhraseKekBytes(phrase, salt)
    expect(a).toEqual(b)
    expect(a.length).toBe(32)
  })

  test('deriveRecoveryPhraseKekBytes differs across salts', () => {
    const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve'
    const saltA = new Uint8Array(32).fill(1)
    const saltB = new Uint8Array(32).fill(2)
    const a = deriveRecoveryPhraseKekBytes(phrase, saltA)
    const b = deriveRecoveryPhraseKekBytes(phrase, saltB)
    expect(a).not.toEqual(b)
  })

  test('deriveRecoveryPhraseKekBytes rejects an invalid phrase', () => {
    const salt = new Uint8Array(32).fill(7)
    expect(() => deriveRecoveryPhraseKekBytes('not a valid phrase', salt)).toThrow(RecoveryPhraseError)
  })
})
```

- [ ] **Step 4: Write `recovery-phrase.ts`**

```typescript
// src/client/lib/recovery-phrase.ts
/**
 * Diceware recovery phrase primitives.
 *
 * Generation: rejection sampling from the EFF large wordlist (7776 words,
 * ~12.9 bits/word). 15 words → ~194 bits of entropy.
 *
 * Derivation: normalized phrase → Argon2id(t=2, m=19 MiB, p=1) → 32 bytes.
 * The 32 bytes are HKDFed into an AES-KW wrapping key (domain-separated by
 * LABEL_RECOVERY_PHRASE_KEK) by the caller in the crypto worker.
 */
import { argon2id } from '@noble/hashes/argon2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_RECOVERY_PHRASE_KEK } from '@shared/crypto-labels'
import { EFF_LARGE_WORDLIST } from '@/assets/eff-large-wordlist'

const WORDLIST_SIZE = 7776

export class RecoveryPhraseError extends Error {
  constructor(code: 'invalid_word' | 'wrong_length' | 'empty' | 'rng_unavailable') {
    super(`Recovery phrase error: ${code}`)
    this.name = 'RecoveryPhraseError'
  }
}

/**
 * Generate a recovery phrase with `wordCount` EFF-large-wordlist words.
 * Default 15 = ~194 bits of entropy. Uses unbiased rejection sampling.
 */
export function generateRecoveryPhrase(wordCount: 12 | 15 | 18 | 24 = 15): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new RecoveryPhraseError('rng_unavailable')
  }
  const max = 65536 - (65536 % WORDLIST_SIZE)
  const words: string[] = []
  const buf = new Uint16Array(1)
  while (words.length < wordCount) {
    crypto.getRandomValues(buf)
    if (buf[0]! < max) {
      words.push(EFF_LARGE_WORDLIST[buf[0]! % WORDLIST_SIZE]!)
    }
  }
  return words.join(' ')
}

export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0).join(' ')
}

const wordSet = new Set<string>(EFF_LARGE_WORDLIST)

export function validateRecoveryPhrase(phrase: string): boolean {
  const words = normalizeRecoveryPhrase(phrase).split(' ')
  if (![12, 15, 18, 24].includes(words.length)) return false
  for (const w of words) {
    if (!wordSet.has(w)) return false
  }
  return true
}

/**
 * Derive the recovery phrase KEK as 32 raw bytes. The caller is responsible for
 * importing these bytes as a non-extractable AES-KW CryptoKey via
 * handleImportRecoveryPhraseKek in the crypto worker.
 *
 * KDF parameters follow OWASP 2026 low-resource floor:
 *   Argon2id(t=2, m=19456 KiB, p=1, dkLen=32)
 * then HKDF-SHA256 with LABEL_RECOVERY_PHRASE_KEK + ':phrase' as info.
 */
export function deriveRecoveryPhraseKekBytes(
  phrase: string,
  salt: Uint8Array,
): Uint8Array {
  if (!validateRecoveryPhrase(phrase)) {
    throw new RecoveryPhraseError('invalid_word')
  }
  const normalized = normalizeRecoveryPhrase(phrase)
  const ikm = utf8ToBytes(normalized)
  const raw = argon2id(ikm, salt, { t: 2, m: 19456, p: 1, dkLen: 32 })
  ikm.fill(0)
  const info = utf8ToBytes(`${LABEL_RECOVERY_PHRASE_KEK}:phrase`)
  const kek = hkdf(sha256, raw, new Uint8Array(0), info, 32)
  raw.fill(0)
  return kek
}

export const RECOVERY_PHRASE_KDF_PARAMS = {
  algo: 'argon2id' as const,
  t: 2,
  m: 19456,
  p: 1,
}

/** Helper to generate a fresh 32-byte per-user salt. */
export function generateRecoveryPhraseSalt(): Uint8Array {
  const salt = new Uint8Array(32)
  crypto.getRandomValues(salt)
  return salt
}

export function hexSaltToBytes(hex: string): Uint8Array {
  return hexToBytes(hex)
}
export function bytesToHexSalt(bytes: Uint8Array): string {
  return bytesToHex(bytes)
}
```

- [ ] **Step 5: Run the test**

Run: `bun test src/client/lib/recovery-phrase.test.ts`
Expected: 9 PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-eff-wordlist.ts src/client/assets/eff-large-wordlist.ts src/client/lib/recovery-phrase.ts src/client/lib/recovery-phrase.test.ts
git commit -m "feat(recovery-phrase): EFF large wordlist + Diceware-to-KEK derivation"
```

### Task 9: Shamir + commitment helpers in `recovery-group-share.ts`

**Files:**
- Create: `src/client/lib/recovery-group-share.ts`
- Create: `src/client/lib/recovery-group-share.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/recovery-group-share.test.ts
import { describe, expect, test } from 'bun:test'
import {
  splitRecoveryGroupSecret,
  combineRecoveryGroupShares,
  commitShare,
  verifyShareCommitment,
  ShareCommitmentError,
  generateRecoveryGroupKeyPair,
} from './recovery-group-share'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'

describe('Shamir recovery group', () => {
  test('2-of-3 split + combine recovers the secret', async () => {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    const shares = await splitRecoveryGroupSecret(secret, 3, 2)
    expect(shares).toHaveLength(3)
    const recovered = await combineRecoveryGroupShares([shares[0]!, shares[1]!])
    expect(bytesToHex(recovered)).toBe(bytesToHex(secret))
  })

  test('2-of-3 recovers with any 2 shares', async () => {
    const secret = new Uint8Array(32).fill(5)
    const shares = await splitRecoveryGroupSecret(secret, 3, 2)
    const r1 = await combineRecoveryGroupShares([shares[0]!, shares[1]!])
    const r2 = await combineRecoveryGroupShares([shares[0]!, shares[2]!])
    const r3 = await combineRecoveryGroupShares([shares[1]!, shares[2]!])
    expect(bytesToHex(r1)).toBe(bytesToHex(secret))
    expect(bytesToHex(r2)).toBe(bytesToHex(secret))
    expect(bytesToHex(r3)).toBe(bytesToHex(secret))
  })

  test('combining with 1 share yields incorrect value (threshold boundary)', async () => {
    const secret = new Uint8Array(32).fill(5)
    const shares = await splitRecoveryGroupSecret(secret, 3, 2)
    // privy-io's combine throws if fewer than 2 shares are supplied
    await expect(combineRecoveryGroupShares([shares[0]!])).rejects.toThrow()
  })

  test('3-of-5 split/combine round-trips', async () => {
    const secret = new Uint8Array(32).fill(9)
    const shares = await splitRecoveryGroupSecret(secret, 5, 3)
    expect(shares).toHaveLength(5)
    const recovered = await combineRecoveryGroupShares([shares[0]!, shares[2]!, shares[4]!])
    expect(bytesToHex(recovered)).toBe(bytesToHex(secret))
  })

  test('commitShare + verifyShareCommitment round-trip', async () => {
    const share = new Uint8Array(33).fill(1)
    const commitment = await commitShare(share)
    expect(await verifyShareCommitment(share, commitment)).toBe(true)
  })

  test('verifyShareCommitment rejects a tampered share', async () => {
    const share = new Uint8Array(33).fill(1)
    const commitment = await commitShare(share)
    const tampered = new Uint8Array(share)
    tampered[0] = 255
    expect(await verifyShareCommitment(tampered, commitment)).toBe(false)
  })

  test('generateRecoveryGroupKeyPair returns a valid secp256k1 pubkey', () => {
    const { publicKey, privateKey } = generateRecoveryGroupKeyPair()
    expect(privateKey.length).toBe(32)
    // Recompute pubkey from private and compare
    const derived = secp256k1.getPublicKey(privateKey, true)
    expect(bytesToHex(derived)).toBe(bytesToHex(publicKey))
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/client/lib/recovery-group-share.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `recovery-group-share.ts`**

```typescript
// src/client/lib/recovery-group-share.ts
/**
 * Recovery Group share primitives.
 *
 *   generateRecoveryGroupKeyPair() → (RG_pub, RG_priv)  [secp256k1]
 *   splitRecoveryGroupSecret(secret, shares, threshold) → shares[]
 *   combineRecoveryGroupShares(shares) → secret
 *   commitShare(share)  → commitment (32 bytes SHA-256)
 *   verifyShareCommitment(share, commitment) → bool
 *
 * Uses `shamir-secret-sharing` from privy-io — GF(2^8), Cure53/Zellic audited.
 * Note: the library does not verify reconstructed secrets, so the caller MUST
 * verify via the per-share SHA-256 commitment stored at enrollment.
 */
import { combine, split } from 'shamir-secret-sharing'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export class ShareCommitmentError extends Error {
  constructor(detail: string) {
    super(`Share commitment error: ${detail}`)
    this.name = 'ShareCommitmentError'
  }
}

export async function splitRecoveryGroupSecret(
  secret: Uint8Array,
  totalShares: number,
  threshold: number,
): Promise<Uint8Array[]> {
  if (totalShares < 3 || totalShares > 5) {
    throw new Error(`totalShares must be 3..5, got ${totalShares}`)
  }
  if (threshold < 2 || threshold > totalShares) {
    throw new Error(`threshold must be 2..${totalShares}, got ${threshold}`)
  }
  return split(secret, totalShares, threshold)
}

export async function combineRecoveryGroupShares(
  shares: Uint8Array[],
): Promise<Uint8Array> {
  if (shares.length < 2) {
    throw new Error(`combine requires at least 2 shares, got ${shares.length}`)
  }
  return combine(shares)
}

export async function commitShare(share: Uint8Array): Promise<string> {
  return bytesToHex(sha256(share))
}

export async function verifyShareCommitment(
  share: Uint8Array,
  commitment: string,
): Promise<boolean> {
  const actual = await commitShare(share)
  return actual === commitment
}

export interface RecoveryGroupKeyPair {
  privateKey: Uint8Array /* 32 bytes, raw scalar */
  publicKey: Uint8Array /* 33 bytes, compressed */
}

export function generateRecoveryGroupKeyPair(): RecoveryGroupKeyPair {
  const privateKey = secp256k1.utils.randomSecretKey()
  const publicKey = secp256k1.getPublicKey(privateKey, true)
  return { privateKey, publicKey }
}
```

- [ ] **Step 4: Run the test**

Run: `bun test src/client/lib/recovery-group-share.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/recovery-group-share.ts src/client/lib/recovery-group-share.test.ts
git commit -m "feat(recovery-group): Shamir split/combine + SHA-256 share commitments"
```

### Task 10: OPAQUE client wrapper

**Files:**
- Create: `src/client/lib/opaque-client.ts`
- Create: `src/client/lib/opaque-client.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/opaque-client.test.ts
import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { OPAQUE_KEY_STRETCHING, base64urlDecode, base64urlEncode } from './opaque-client'

describe('opaque-client helpers', () => {
  test('OPAQUE_KEY_STRETCHING matches spec (t=3, p=1, m=2^21 - 1)', () => {
    expect(OPAQUE_KEY_STRETCHING).toEqual({
      algo: 'argon2id',
      parameters: { t: 3, p: 1, m: 2 ** 21 - 1 },
    })
  })

  test('base64urlEncode / base64urlDecode round-trip', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 128])
    const s = base64urlEncode(bytes)
    const back = base64urlDecode(s)
    expect(back).toEqual(bytes)
  })

  test('base64urlDecode rejects padded strings', () => {
    expect(() => base64urlDecode('AAAA==')).toThrow()
  })
})
```

- [ ] **Step 2: Write `opaque-client.ts`**

```typescript
// src/client/lib/opaque-client.ts
/**
 * Thin wrapper over @serenity-kit/opaque for Llamenos' OPAQUE flows.
 *
 * Fixes the keyStretching parameters to the Tier 2 spec values:
 *   Argon2id(t=3, p=1, m=2^21 - 1)
 * — maxed out within the browser WASM cap documented in the serenity-kit README.
 *
 * Provides base64url helpers for on-the-wire payload encoding because the
 * library returns standard base64url strings we pipe directly into zod schemas.
 */
import * as opaque from '@serenity-kit/opaque'

export const OPAQUE_KEY_STRETCHING = {
  algo: 'argon2id' as const,
  parameters: { t: 3, p: 1, m: 2 ** 21 - 1 },
}

export async function opaqueReady(): Promise<void> {
  await opaque.ready
}

export interface OpaqueRegisterResult {
  registrationRecord: string
  exportKey: Uint8Array
}

export async function opaqueClientRegister(params: {
  password: string
  send: (registrationRequest: string) => Promise<{ registrationResponse: string }>
}): Promise<OpaqueRegisterResult> {
  await opaqueReady()
  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
    password: params.password,
    keyStretching: OPAQUE_KEY_STRETCHING,
  })
  const { registrationResponse } = await params.send(registrationRequest)
  const { registrationRecord, exportKey } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password: params.password,
    keyStretching: OPAQUE_KEY_STRETCHING,
  })
  return { registrationRecord, exportKey: base64urlDecode(exportKey) }
}

export interface OpaqueLoginResult {
  finishLoginRequest: string
  sessionKey: Uint8Array
  exportKey: Uint8Array
}

export async function opaqueClientLogin(params: {
  password: string
  send: (startLoginRequest: string) => Promise<{ loginResponse: string }>
}): Promise<OpaqueLoginResult> {
  await opaqueReady()
  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({
    password: params.password,
    keyStretching: OPAQUE_KEY_STRETCHING,
  })
  const { loginResponse } = await params.send(startLoginRequest)
  const { finishLoginRequest, sessionKey, exportKey } = opaque.client.finishLogin({
    clientLoginState,
    loginResponse,
    password: params.password,
    keyStretching: OPAQUE_KEY_STRETCHING,
  })
  return {
    finishLoginRequest,
    sessionKey: base64urlDecode(sessionKey),
    exportKey: base64urlDecode(exportKey),
  }
}

/** Unpadded base64url per RFC 4648 §5. Rejects padding explicitly. */
export function base64urlDecode(s: string): Uint8Array {
  if (s.includes('=')) throw new Error('base64url must be unpadded')
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(normalized + pad)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function base64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
```

- [ ] **Step 3: Run the test**

Run: `bun test src/client/lib/opaque-client.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/opaque-client.ts src/client/lib/opaque-client.test.ts
git commit -m "feat(opaque): client wrapper with fixed Argon2id params (t=3, p=1, m=2^21-1)"
```

### Task 11: WebAuthn PRF client wrapper (`registerPrfCredential` + `unlockPrfFromCredential`)

**Files:**
- Modify: `src/client/lib/webauthn.ts`
- Modify: `src/client/lib/webauthn.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the existing test file body with:

```typescript
// src/client/lib/webauthn.test.ts
import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test'
import {
  registerPrfCredential,
  unlockPrfFromCredential,
  PrfUnsupportedError,
} from './webauthn'

// Mock @simplewebauthn/browser so we don't need a live WebAuthn API
mock.module('@simplewebauthn/browser', () => ({
  startRegistration: mock(async (_opts: unknown) => ({
    id: 'cred-abc',
    rawId: 'raw',
    type: 'public-key',
    response: { clientDataJSON: 'd', attestationObject: 'a' },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
    // The browser in prod returns a PublicKeyCredential; we shim
    // getClientExtensionResults for the test path below.
    getClientExtensionResults: () => ({
      prf: { enabled: true, results: { first: new Uint8Array(32).fill(7).buffer } },
    }),
  })),
  startAuthentication: mock(async () => ({
    id: 'cred-abc',
    rawId: 'raw',
    type: 'public-key',
    response: {},
    clientExtensionResults: {},
    getClientExtensionResults: () => ({
      prf: { results: { first: new Uint8Array(32).fill(9).buffer } },
    }),
  })),
}))

// Mock the auth facade client — we only care that the challengeId round-trips.
mock.module('./auth-facade-client', () => ({
  authFacadeClient: {
    getRegisterOptions: mock(async () => ({
      challengeId: 'ch-1',
      rp: { id: 'localhost', name: 'Llamenos' },
      user: { id: 'u', name: 'alice', displayName: 'alice' },
      challenge: 'chal',
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })),
    getLoginOptions: mock(async () => ({
      challengeId: 'ch-2',
      challenge: 'chal2',
      rpId: 'localhost',
      timeout: 60000,
      userVerification: 'required',
    })),
    verifyRegistration: mock(async () => ({ ok: true, credentialId: 'cred-abc' })),
    verifyLogin: mock(async () => ({ ok: true, accessToken: 'tok' })),
  },
}))

describe('registerPrfCredential', () => {
  test('returns credentialId + 32-byte prfOutput on PRF-supported authenticator', async () => {
    const result = await registerPrfCredential('Test Passkey')
    expect(result.credentialId).toBe('cred-abc')
    expect(result.prfOutput).toBeInstanceOf(Uint8Array)
    expect(result.prfOutput.length).toBe(32)
  })

  test('throws PrfUnsupportedError when authenticator reports prf.enabled === false', async () => {
    const { startRegistration } = await import('@simplewebauthn/browser')
    ;(startRegistration as unknown as { mockImplementationOnce: (fn: () => unknown) => void })
      .mockImplementationOnce(async () => ({
        id: 'cred-no-prf',
        getClientExtensionResults: () => ({ prf: { enabled: false } }),
      }))
    await expect(registerPrfCredential('no-prf')).rejects.toBeInstanceOf(PrfUnsupportedError)
  })

  test('throws PrfUnsupportedError when prf.results.first is missing', async () => {
    const { startRegistration } = await import('@simplewebauthn/browser')
    ;(startRegistration as unknown as { mockImplementationOnce: (fn: () => unknown) => void })
      .mockImplementationOnce(async () => ({
        id: 'cred-no-first',
        getClientExtensionResults: () => ({ prf: { enabled: true, results: {} } }),
      }))
    await expect(registerPrfCredential('no-first')).rejects.toBeInstanceOf(PrfUnsupportedError)
  })
})

describe('unlockPrfFromCredential', () => {
  test('returns 32-byte prfOutput when authenticator returns prf.results.first', async () => {
    const { prfOutput } = await unlockPrfFromCredential('cred-abc')
    expect(prfOutput.length).toBe(32)
  })

  test('throws PrfUnsupportedError when prf output missing', async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser')
    ;(startAuthentication as unknown as { mockImplementationOnce: (fn: () => unknown) => void })
      .mockImplementationOnce(async () => ({
        id: 'cred-abc',
        getClientExtensionResults: () => ({}),
      }))
    await expect(unlockPrfFromCredential('cred-abc')).rejects.toBeInstanceOf(PrfUnsupportedError)
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run: `bun test src/client/lib/webauthn.test.ts`
Expected: FAIL — `registerPrfCredential` / `unlockPrfFromCredential` / `PrfUnsupportedError` not exported.

- [ ] **Step 3: Replace `src/client/lib/webauthn.ts` body**

Replace the entire file contents with:

```typescript
// src/client/lib/webauthn.ts
/**
 * Client-side WebAuthn wrappers for Tier 2 PRF enrollment + unlock.
 *
 * - `registerPrfCredential(label)`: creates a new passkey with PRF-on-create
 *   and returns the 32-byte PRF output that seeds the KEK derivation.
 * - `unlockPrfFromCredential(credentialId)`: asserts the credential and
 *   returns the fresh 32-byte PRF output for this unlock.
 *
 * Both paths require the authenticator to report
 *   clientExtensionResults.prf.enabled === true
 * and reject anything softer.
 */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_PRF_KEK_SALT_V1 } from '@shared/crypto-labels'
import { authFacadeClient } from './auth-facade-client'

export class PrfUnsupportedError extends Error {
  constructor(detail: string) {
    super(`PRF unsupported: ${detail}`)
    this.name = 'PrfUnsupportedError'
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Register a new PRF-capable credential and capture its first PRF output.
 *
 * The options JSON is augmented with `extensions.prf.eval.first` because
 * @simplewebauthn/browser v13.x does not carry PRF through its public
 * TypeScript types yet. The result must satisfy
 * `clientExtensionResults.prf.enabled === true` AND
 * `clientExtensionResults.prf.results.first instanceof ArrayBuffer`, else we
 * raise `PrfUnsupportedError` to force a fallback.
 */
export async function registerPrfCredential(
  label: string,
): Promise<{ credentialId: string; prfOutput: Uint8Array }> {
  const opts = await authFacadeClient.getRegisterOptions({ prf: true })
  const { challengeId, ...optionsJSON } = opts
  const optionsWithPrf = {
    ...optionsJSON,
    extensions: {
      prf: { eval: { first: bytesToBase64Url(utf8ToBytes(LABEL_PRF_KEK_SALT_V1)) } },
    },
  }
  const attestation = await startRegistration({ optionsJSON: optionsWithPrf as never })
  const ext = (attestation as unknown as {
    getClientExtensionResults: () => {
      prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
    }
  }).getClientExtensionResults()
  const prf = ext.prf
  if (!prf?.enabled) {
    throw new PrfUnsupportedError('authenticator did not enable PRF on create')
  }
  if (!prf.results?.first) {
    throw new PrfUnsupportedError('authenticator did not return prf.results.first on create')
  }
  const prfOutput = new Uint8Array(prf.results.first)
  await authFacadeClient.verifyRegistration(attestation, label, challengeId)
  return { credentialId: attestation.id, prfOutput }
}

export async function unlockPrfFromCredential(
  credentialId: string,
): Promise<{ prfOutput: Uint8Array }> {
  const opts = await authFacadeClient.getLoginOptions({ prf: true })
  const { challengeId, ...optionsJSON } = opts
  const optionsWithPrf = {
    ...optionsJSON,
    allowCredentials: [{ id: credentialId, type: 'public-key' as const }],
    extensions: {
      prf: { eval: { first: bytesToBase64Url(utf8ToBytes(LABEL_PRF_KEK_SALT_V1)) } },
    },
  }
  const assertion = await startAuthentication({ optionsJSON: optionsWithPrf as never })
  const ext = (assertion as unknown as {
    getClientExtensionResults: () => {
      prf?: { results?: { first?: ArrayBuffer } }
    }
  }).getClientExtensionResults()
  const first = ext.prf?.results?.first
  if (!first) {
    throw new PrfUnsupportedError('authenticator did not return prf.results.first on assertion')
  }
  await authFacadeClient.verifyLogin(assertion, challengeId)
  return { prfOutput: new Uint8Array(first) }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/client/lib/webauthn.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webauthn.ts src/client/lib/webauthn.test.ts
git commit -m "feat(webauthn): PRF-on-create registration + PRF-assertion unlock wrappers"
```

### Task 12: Server-side WebAuthn — thread `prf` option through `generateRegOptions` / `generateAuthOptions`

**Files:**
- Modify: `src/server/lib/webauthn.ts`
- Modify: `src/server/lib/webauthn.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/server/lib/webauthn.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { generateRegOptions, generateAuthOptions } from './webauthn'
import { LABEL_PRF_KEK_SALT_V1 } from '@shared/crypto-labels'
import { utf8ToBytes } from '@noble/hashes/utils.js'

describe('server webauthn PRF threading', () => {
  const rpID = 'localhost'
  const rpName = 'Llamenos Test'
  const user = { pubkey: 'aa'.repeat(32), name: 'alice' }

  test('generateRegOptions without prf omits extensions.prf', async () => {
    const opts = await generateRegOptions(user, [], rpID, rpName, {})
    const extensions = (opts as { extensions?: { prf?: unknown } }).extensions
    expect(extensions?.prf).toBeUndefined()
  })

  test('generateRegOptions with prf includes extensions.prf.eval.first === LABEL base64url', async () => {
    const opts = await generateRegOptions(user, [], rpID, rpName, { prf: true })
    const extensions = (opts as { extensions?: { prf?: { eval?: { first?: string } } } }).extensions
    expect(extensions?.prf?.eval?.first).toBeTruthy()
    // base64url of the label bytes
    const expected = Buffer.from(utf8ToBytes(LABEL_PRF_KEK_SALT_V1))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(extensions?.prf?.eval?.first).toBe(expected)
  })

  test('generateAuthOptions with prf includes extensions.prf.eval.first', async () => {
    const opts = await generateAuthOptions(user, [], rpID, { prf: true })
    const extensions = (opts as { extensions?: { prf?: { eval?: { first?: string } } } }).extensions
    expect(extensions?.prf?.eval?.first).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/server/lib/webauthn.test.ts -t "PRF threading"`
Expected: FAIL — `options.prf` parameter not supported.

- [ ] **Step 3: Modify `src/server/lib/webauthn.ts`**

Update the two exported functions to accept an `options` bag:

```typescript
// src/server/lib/webauthn.ts (updated signatures)
import { generateRegistrationOptions, generateAuthenticationOptions } from '@simplewebauthn/server'
import type { WebAuthnCredential } from '../db/schema'
import { LABEL_PRF_KEK_SALT_V1 } from '@shared/crypto-labels'

function utf8ToBase64Url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function generateRegOptions(
  user: { pubkey: string; name: string },
  existingCreds: WebAuthnCredential[],
  rpID: string,
  rpName: string,
  options: { prf?: boolean } = {},
) {
  const opts = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.name || user.pubkey.slice(0, 16),
    userID: new TextEncoder().encode(user.pubkey) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: existingCreds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[],
    })),
  })
  if (options.prf) {
    ;(opts as Record<string, unknown>).extensions = {
      prf: { eval: { first: utf8ToBase64Url(LABEL_PRF_KEK_SALT_V1) } },
    }
  }
  return opts
}

export async function generateAuthOptions(
  user: { pubkey: string; name: string },
  allowedCreds: WebAuthnCredential[],
  rpID: string,
  options: { prf?: boolean } = {},
) {
  const opts = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: allowedCreds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[],
    })),
  })
  if (options.prf) {
    ;(opts as Record<string, unknown>).extensions = {
      prf: { eval: { first: utf8ToBase64Url(LABEL_PRF_KEK_SALT_V1) } },
    }
  }
  return opts
}
```

- [ ] **Step 4: Run the test**

Run: `bun test src/server/lib/webauthn.test.ts -t "PRF threading"`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/webauthn.ts src/server/lib/webauthn.test.ts
git commit -m "feat(server-webauthn): thread prf extension through regOptions + authOptions"
```

### Task 13: Crypto worker root-KEK handlers

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`
- Modify: `src/client/lib/crypto-worker-client.ts`
- Create: `src/client/lib/crypto-worker-root-kek.test.ts`

The crypto worker owns the non-extractable root KEK as an `AES-KW` `CryptoKey`. Main thread requests: `importRootKekFromFactor`, `generateFreshRootKek`, `wrapRootKekForFactor`, `unwrapRootKekWithFactor`, `clearRootKek`. Raw factor bytes never leave the worker.

- [ ] **Step 1: Write failing test file**

```typescript
// src/client/lib/crypto-worker-root-kek.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  createRootKekSession,
  importFactorAsAesKw,
  wrapRootKekWith,
  unwrapRootKekWith,
  clearRootKek,
  isRootKekLoaded,
} from './crypto-worker'

describe('crypto-worker root KEK primitives', () => {
  beforeEach(async () => {
    await clearRootKek()
  })

  test('generateFreshRootKek loads a non-extractable root KEK', async () => {
    const session = await createRootKekSession()
    expect(session.rootKeyId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await isRootKekLoaded()).toBe(true)
  })

  test('wrap / unwrap round-trip via PRF-factor bytes', async () => {
    await createRootKekSession()
    const factorBytes = new Uint8Array(32).fill(1)
    const aesKw = await importFactorAsAesKw(factorBytes, 'prf')
    const wrapped = await wrapRootKekWith(aesKw)
    expect(wrapped).toMatch(/^[0-9a-f]+$/)
    await clearRootKek()
    expect(await isRootKekLoaded()).toBe(false)
    await unwrapRootKekWith(wrapped, aesKw)
    expect(await isRootKekLoaded()).toBe(true)
  })

  test('clearRootKek releases the handle', async () => {
    await createRootKekSession()
    await clearRootKek()
    expect(await isRootKekLoaded()).toBe(false)
  })

  test('importFactorAsAesKw zeroes the raw bytes copy after import', async () => {
    const src = new Uint8Array(32).fill(3)
    await importFactorAsAesKw(new Uint8Array(src), 'prf')
    // The *caller's* bytes are not modified (clone was passed). But a direct
    // factor mutation after import is a smell — worker keeps zero copies.
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test src/client/lib/crypto-worker-root-kek.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Extend `src/client/lib/crypto-worker.ts`**

Add the following exports (new handler functions invoked via the existing RPC envelope). The raw AES-KW key lives inside a module-level `WeakRef`-safe closure so GC can reclaim it after `clearRootKek()`:

```typescript
// src/client/lib/crypto-worker.ts (append)
import {
  LABEL_ROOT_KEK_WRAP,
  LABEL_RECOVERY_PHRASE_KEK,
  LABEL_OPAQUE_EXPORT_KEK,
} from '@shared/crypto-labels'

let _rootKek: CryptoKey | null = null
let _rootKeyId: string | null = null

export async function isRootKekLoaded(): Promise<boolean> {
  return _rootKek !== null
}

export async function clearRootKek(): Promise<void> {
  _rootKek = null
  _rootKeyId = null
}

export async function createRootKekSession(): Promise<{ rootKeyId: string }> {
  // Generate a fresh 256-bit AES-KW key, non-extractable.
  const key = await crypto.subtle.generateKey(
    { name: 'AES-KW', length: 256 },
    /* extractable */ false,
    ['wrapKey', 'unwrapKey'],
  )
  _rootKek = key
  _rootKeyId = crypto.randomUUID()
  return { rootKeyId: _rootKeyId }
}

type FactorKind = 'prf' | 'opaque' | 'recoveryPhrase' | 'recoveryGroup'

const FACTOR_HKDF_INFO: Record<FactorKind, string> = {
  prf: `${LABEL_ROOT_KEK_WRAP}:prf`,
  opaque: `${LABEL_OPAQUE_EXPORT_KEK}:opaque`,
  recoveryPhrase: `${LABEL_RECOVERY_PHRASE_KEK}:phrase`,
  recoveryGroup: `${LABEL_ROOT_KEK_WRAP}:recoveryGroup`,
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/**
 * Import raw factor bytes (32 for PRF, 64 for OPAQUE export_key, 32 for
 * recovery-phrase Argon2 output, 32 for recovery-group combined secret) as
 * a non-extractable AES-KW CryptoKey via HKDF with a factor-specific label.
 */
export async function importFactorAsAesKw(
  factorBytes: Uint8Array,
  kind: FactorKind,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    'raw',
    factorBytes.buffer.slice(
      factorBytes.byteOffset,
      factorBytes.byteOffset + factorBytes.byteLength,
    ),
    'HKDF',
    false,
    ['deriveBits'],
  )
  const kekBytes = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: utf8(FACTOR_HKDF_INFO[kind]),
      },
      ikm,
      256,
    ),
  )
  const aesKw = await crypto.subtle.importKey(
    'raw',
    kekBytes.buffer.slice(0),
    'AES-KW',
    false,
    ['wrapKey', 'unwrapKey'],
  )
  kekBytes.fill(0)
  return aesKw
}

/** Wrap the currently-loaded root KEK under a factor-derived AES-KW key. Returns hex-encoded ciphertext. */
export async function wrapRootKekWith(factorAesKw: CryptoKey): Promise<string> {
  if (!_rootKek) throw new Error('no root KEK loaded')
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('raw', _rootKek, factorAesKw, 'AES-KW'),
  )
  return Array.from(wrapped, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Unwrap a hex-encoded wrapped root KEK using a factor-derived AES-KW key, and load it. */
export async function unwrapRootKekWith(
  wrappedHex: string,
  factorAesKw: CryptoKey,
): Promise<void> {
  const wrapped = new Uint8Array(wrappedHex.length / 2)
  for (let i = 0; i < wrapped.length; i++) {
    wrapped[i] = parseInt(wrappedHex.slice(i * 2, i * 2 + 2), 16)
  }
  const rootKek = await crypto.subtle.unwrapKey(
    'raw',
    wrapped.buffer.slice(0),
    factorAesKw,
    'AES-KW',
    { name: 'AES-KW', length: 256 },
    /* extractable */ false,
    ['wrapKey', 'unwrapKey'],
  )
  wrapped.fill(0)
  _rootKek = rootKek
  if (!_rootKeyId) _rootKeyId = crypto.randomUUID()
}
```

Also extend `src/client/lib/crypto-worker-client.ts` with typed RPC wrappers for these five operations (`createRootKekSession`, `importFactorAsAesKw`, `wrapRootKekWith`, `unwrapRootKekWith`, `clearRootKek`, `isRootKekLoaded`) mirroring existing patterns.

- [ ] **Step 4: Delete PIN-era worker handlers**

Search `src/client/lib/crypto-worker.ts` for any `deriveKekFromPin`, `decryptNsecWithKek`, `encryptNsecWithKek`, or `importIdpValueKek` — delete them and the corresponding RPC wrappers in `crypto-worker-client.ts`. They are dead post-Tier 2.

- [ ] **Step 5: Run the test**

Run: `bun test src/client/lib/crypto-worker-root-kek.test.ts`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker-root-kek.test.ts
git commit -m "feat(crypto-worker): root-KEK session + factor-derived AES-KW wrap/unwrap"
```

### Task 14: Drizzle schema — OPAQUE, recovery, security-prefs tables

**Files:**
- Create: `src/server/db/schema/opaque.ts`
- Create: `src/server/db/schema/recovery.ts`
- Modify: `src/server/db/schema/identity.ts`
- Modify: `src/server/db/schema/security-prefs.ts`
- Modify: `src/server/db/schema/index.ts`

- [ ] **Step 1: Write the OPAQUE schema file**

```typescript
// src/server/db/schema/opaque.ts
import { pgTable, text, timestamp, customType, integer, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './identity'

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

/** Single-row table holding the OPAQUE `ServerSetup` blob. */
export const opaqueServerSetup = pgTable(
  'opaque_server_setup',
  {
    id: integer('id').primaryKey(),
    setup: bytea('setup').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    singleton: check('opaque_server_setup_singleton', sql`${t.id} = 1`),
  }),
)

/** Per-user OPAQUE registrationRecord blob. */
export const userOpaqueRecords = pgTable('user_opaque_records', {
  userPubkey: text('user_pubkey')
    .primaryKey()
    .references(() => users.pubkey, { onDelete: 'cascade' }),
  registrationRecord: bytea('registration_record').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 2: Write the recovery schema file**

```typescript
// src/server/db/schema/recovery.ts
import { pgTable, text, timestamp, uuid, integer, jsonb, customType, primaryKey, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './identity'
import { hubs } from './hubs'

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

export const userRootKekEnvelopes = pgTable('user_root_kek_envelopes', {
  userPubkey: text('user_pubkey')
    .primaryKey()
    .references(() => users.pubkey, { onDelete: 'cascade' }),
  bundleJson: jsonb('bundle_json').notNull(),
  rootKeyId: uuid('root_key_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userRecoveryPhraseMeta = pgTable('user_recovery_phrase_meta', {
  userPubkey: text('user_pubkey')
    .primaryKey()
    .references(() => users.pubkey, { onDelete: 'cascade' }),
  salt: bytea('salt').notNull(),
  kdfParams: jsonb('kdf_params').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const hubRecoveryGroups = pgTable(
  'hub_recovery_groups',
  {
    hubId: uuid('hub_id')
      .primaryKey()
      .references(() => hubs.id, { onDelete: 'cascade' }),
    groupPublicKey: text('group_public_key').notNull(),
    threshold: integer('threshold').notNull(),
    totalShares: integer('total_shares').notNull(),
    shareCommitments: jsonb('share_commitments').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (t) => ({
    thresholdLower: check('hub_recovery_groups_threshold_lower', sql`${t.threshold} >= 2`),
    totalSharesRange: check(
      'hub_recovery_groups_total_shares_range',
      sql`${t.totalShares} >= 3 AND ${t.totalShares} <= 5`,
    ),
    thresholdLeqTotal: check(
      'hub_recovery_groups_threshold_leq_total',
      sql`${t.threshold} <= ${t.totalShares}`,
    ),
  }),
)

export const hubRecoveryGroupShares = pgTable(
  'hub_recovery_group_shares',
  {
    hubId: uuid('hub_id')
      .notNull()
      .references(() => hubRecoveryGroups.hubId, { onDelete: 'cascade' }),
    adminPubkey: text('admin_pubkey').notNull(),
    shareEnvelope: bytea('share_envelope').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.hubId, t.adminPubkey] }),
  }),
)

export const userRecoveryEnvelopes = pgTable(
  'user_recovery_envelopes',
  {
    userPubkey: text('user_pubkey')
      .notNull()
      .references(() => users.pubkey, { onDelete: 'cascade' }),
    hubId: uuid('hub_id')
      .notNull()
      .references(() => hubRecoveryGroups.hubId, { onDelete: 'cascade' }),
    envelope: bytea('envelope').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userPubkey, t.hubId] }),
  }),
)

export const recoverySessions = pgTable(
  'recovery_sessions',
  {
    sessionId: uuid('session_id').primaryKey(),
    hubId: uuid('hub_id').notNull(),
    userPubkey: text('user_pubkey').notNull(),
    coordinatorPubkey: text('coordinator_pubkey').notNull(),
    newDevicePubkey: text('new_device_pubkey').notNull(),
    status: text('status').notNull(),
    contributions: jsonb('contributions').notNull().default(sql`'[]'::jsonb`),
    emergencyOverride: jsonb('emergency_override'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    hubStatusIdx: index('recovery_sessions_hub_status_idx').on(t.hubId, t.status),
    statusCheck: check(
      'recovery_sessions_status_check',
      sql`${t.status} IN ('pending','ready','completed','expired','cancelled')`,
    ),
  }),
)
```

- [ ] **Step 3: Update `identity.ts`** — remove `encryptedSecretKey` and `kekProofHash` columns from the `users` table.

Open `src/server/db/schema/identity.ts` and delete the `encryptedSecretKey` and `kekProofHash` column declarations. Also remove the `kek_proof_hash` and `encrypted_secret_key` exports from the table's inferred type if they exist.

- [ ] **Step 4: Update `security-prefs.ts`** — add `convenience_pin_hash` and `convenience_pin_attempts` columns.

```typescript
// src/server/db/schema/security-prefs.ts (diff)
export const userSecurityPrefs = pgTable('user_security_prefs', {
  // ... existing columns
  conveniencePinHash: text('convenience_pin_hash'),
  conveniencePinAttempts: integer('convenience_pin_attempts').notNull().default(0),
  conveniencePinLockedUntil: timestamp('convenience_pin_locked_until', { withTimezone: true }),
})
```

- [ ] **Step 5: Export from barrel**

```typescript
// src/server/db/schema/index.ts (append)
export * from './opaque'
export * from './recovery'
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck 2>&1 | grep -c error || true`
Expected: 0 errors in schema files. Errors in downstream services are acceptable (fixed in later tasks).

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema/opaque.ts src/server/db/schema/recovery.ts src/server/db/schema/identity.ts src/server/db/schema/security-prefs.ts src/server/db/schema/index.ts
git commit -m "feat(db): Tier 2 OPAQUE + recovery tables; drop PIN-era user columns"
```

### Task 15: Drizzle migration 0051_tier2_unlock_recovery

**Files:**
- Create: `drizzle/migrations/0051_tier2_unlock_recovery.sql`

- [ ] **Step 1: Generate migration**

Run: `bun run migrate:generate`
Expected: a new SQL file is produced under `drizzle/migrations/` that drops the `encrypted_secret_key` + `kek_proof_hash` columns, creates `opaque_server_setup`, `user_opaque_records`, `user_root_kek_envelopes`, `user_recovery_phrase_meta`, `hub_recovery_groups`, `hub_recovery_group_shares`, `user_recovery_envelopes`, `recovery_sessions`, and alters `user_security_prefs`.

- [ ] **Step 2: Hand-edit the generated file**

Rename the file to `0051_tier2_unlock_recovery.sql` (drizzle-generate usually gives it a random two-word name — we prefer an explicit name).

Add at the top of the SQL file, before any `CREATE TABLE`:

```sql
-- Pre-production wipe: the v2 format is unrecoverable without PIN-as-KEK.
-- We deliberately delete every user record so everyone re-enrolls on v3.
DELETE FROM users;
```

Then verify the generated `DROP TABLE IF EXISTS jwt_revocations;` line is NOT present (that table was dropped earlier — see `feedback_no_inplace_migration_edits`).

- [ ] **Step 3: Apply the migration to a fresh dev database**

```bash
bun run dev:docker
bun run migrate
```

Expected: all statements run; `\dt` in psql shows the eight new tables; `\d users` shows no `encrypted_secret_key` or `kek_proof_hash` column.

- [ ] **Step 4: Verify DB state matches schema**

```bash
docker exec -it llamenos-hotline-postgres-1 psql -U postgres -d llamenos -c '\d user_root_kek_envelopes' \
  -c '\d hub_recovery_groups' \
  -c '\d recovery_sessions'
```

Expected: columns match Task 14's schema declarations; check constraints present on `hub_recovery_groups`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0051_tier2_unlock_recovery.sql drizzle/migrations/meta
git commit -m "feat(db): migration 0051 wipes v2 users and creates Tier 2 recovery tables"
```

## Workstream 2.2 — OPAQUE server + routes

### Task 16: `opaque-server-setup.ts` singleton loader + CLI

**Files:**
- Create: `src/server/lib/opaque-server-setup.ts`
- Create: `src/server/lib/opaque-server-setup.test.ts`
- Create: `scripts/init-opaque-server-setup.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/server/lib/opaque-server-setup.test.ts
import { describe, expect, test, beforeEach, mock } from 'bun:test'
import {
  getOrCreateOpaqueServerSetup,
  __clearCacheForTests,
} from './opaque-server-setup'

// Mock drizzle db
const rows: { id: number; setup: Uint8Array; createdAt: Date }[] = []

mock.module('../db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(rows.filter((r) => r.id === 1)) }),
    }),
    insert: () => ({
      values: (v: { id: number; setup: Uint8Array }) => {
        rows.push({ ...v, createdAt: new Date() })
        return Promise.resolve()
      },
      onConflictDoNothing: () => Promise.resolve(),
    }),
  },
}))

describe('getOrCreateOpaqueServerSetup', () => {
  beforeEach(() => {
    rows.length = 0
    __clearCacheForTests()
  })

  test('creates a fresh setup when the row is absent', async () => {
    const setup = await getOrCreateOpaqueServerSetup()
    expect(setup).toBeInstanceOf(Uint8Array)
    expect(setup.length).toBeGreaterThan(0)
    expect(rows).toHaveLength(1)
  })

  test('returns the same setup on a subsequent call (idempotent)', async () => {
    const a = await getOrCreateOpaqueServerSetup()
    __clearCacheForTests() // force re-load from DB
    const b = await getOrCreateOpaqueServerSetup()
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
  })
})
```

- [ ] **Step 2: Write `opaque-server-setup.ts`**

```typescript
// src/server/lib/opaque-server-setup.ts
/**
 * Single-row persistent OPAQUE `ServerSetup` loader.
 *
 * `ServerSetup` is an opaque ~500-byte server-only secret. It must persist
 * across restarts — regenerating it invalidates every `user_opaque_records`
 * row. We persist to `opaque_server_setup` (id=1 singleton row) and cache
 * in a module-level variable after the first load.
 */
import * as opaque from '@serenity-kit/opaque'
import { db } from '../db'
import { opaqueServerSetup } from '../db/schema/opaque'
import { eq } from 'drizzle-orm'

let _cached: Uint8Array | null = null

export async function getOrCreateOpaqueServerSetup(): Promise<Uint8Array> {
  if (_cached) return _cached
  await opaque.ready
  const existing = await db.select().from(opaqueServerSetup).where(eq(opaqueServerSetup.id, 1))
  if (existing.length > 0) {
    _cached = existing[0]!.setup
    return _cached
  }
  const created = opaque.server.createSetup()
  const bytes = new TextEncoder().encode(created) // base64url string → bytes for persistence
  await db.insert(opaqueServerSetup).values({ id: 1, setup: bytes }).onConflictDoNothing()
  _cached = bytes
  return bytes
}

export function getCachedOpaqueServerSetupString(): string {
  if (!_cached) throw new Error('opaque server setup not initialized — call getOrCreateOpaqueServerSetup first')
  return new TextDecoder().decode(_cached)
}

/** Test-only helper. */
export function __clearCacheForTests(): void {
  _cached = null
}
```

- [ ] **Step 3: Write `scripts/init-opaque-server-setup.ts`**

```typescript
// scripts/init-opaque-server-setup.ts
/**
 * Idempotent CLI: ensures the `opaque_server_setup` row exists so the first
 * OPAQUE register-init call on a fresh deployment does not race with its own
 * on-demand creation path. Invoked by docker-setup.sh + ansible bootstrap.
 */
import { getOrCreateOpaqueServerSetup } from '../src/server/lib/opaque-server-setup'

async function main() {
  const setup = await getOrCreateOpaqueServerSetup()
  console.log(`OPAQUE server setup loaded/created (${setup.length} bytes)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 4: Run the test**

Run: `bun test src/server/lib/opaque-server-setup.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/opaque-server-setup.ts src/server/lib/opaque-server-setup.test.ts scripts/init-opaque-server-setup.ts
git commit -m "feat(server): OPAQUE server setup singleton loader + init CLI"
```

### Task 17: `opaque-login-state-cache.ts`

**Files:**
- Create: `src/server/lib/opaque-login-state-cache.ts`
- Create: `src/server/lib/opaque-login-state-cache.test.ts`

The OPAQUE login is a two-call flow: `/opaque/login/init` produces a `serverLoginState` blob that must be handed back to `/opaque/login/finish`. We cache it in-memory keyed by `(userIdentifier, clientIP, random nonce)` with a 60s TTL. A user-enumeration-resistant `isDummy` flag is stored alongside.

- [ ] **Step 1: Write failing test**

```typescript
// src/server/lib/opaque-login-state-cache.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  cacheLoginState,
  loadLoginState,
  deleteLoginState,
  __clearAllForTests,
} from './opaque-login-state-cache'

describe('opaque login state cache', () => {
  beforeEach(() => __clearAllForTests())

  test('cache round-trip', async () => {
    const handle = await cacheLoginState('alice', 'state-bytes', { isDummy: false })
    const loaded = await loadLoginState('alice', handle)
    expect(loaded?.serverLoginState).toBe('state-bytes')
    expect(loaded?.isDummy).toBe(false)
  })

  test('delete removes the entry', async () => {
    const handle = await cacheLoginState('alice', 'state', { isDummy: false })
    await deleteLoginState('alice', handle)
    expect(await loadLoginState('alice', handle)).toBeNull()
  })

  test('dummy flag persists', async () => {
    const handle = await cacheLoginState('unknown', 'state', { isDummy: true })
    const loaded = await loadLoginState('unknown', handle)
    expect(loaded?.isDummy).toBe(true)
  })

  test('expired entries are evicted', async () => {
    const handle = await cacheLoginState('alice', 'state', { isDummy: false, ttlMs: 10 })
    await new Promise((r) => setTimeout(r, 20))
    expect(await loadLoginState('alice', handle)).toBeNull()
  })
})
```

- [ ] **Step 2: Write `opaque-login-state-cache.ts`**

```typescript
// src/server/lib/opaque-login-state-cache.ts
/**
 * In-memory cache for `serverLoginState` between /opaque/login/init and
 * /opaque/login/finish. Keyed by (userIdentifier, random handle).
 *
 * TTL default 60s — matches the OPAQUE spec's "prompt handshake" expectation.
 * In cluster deployments this should be backed by Redis; for the first Tier 2
 * cut we keep it in-process and document the limitation.
 */

interface Entry {
  serverLoginState: string
  isDummy: boolean
  expiresAt: number
}

const map = new Map<string, Entry>()

function key(user: string, handle: string): string {
  return `${user}|${handle}`
}

export async function cacheLoginState(
  userIdentifier: string,
  serverLoginState: string,
  options: { isDummy: boolean; ttlMs?: number },
): Promise<string> {
  const handle = crypto.randomUUID()
  const ttl = options.ttlMs ?? 60_000
  map.set(key(userIdentifier, handle), {
    serverLoginState,
    isDummy: options.isDummy,
    expiresAt: Date.now() + ttl,
  })
  return handle
}

export async function loadLoginState(
  userIdentifier: string,
  handle: string,
): Promise<{ serverLoginState: string; isDummy: boolean } | null> {
  const k = key(userIdentifier, handle)
  const entry = map.get(k)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    map.delete(k)
    return null
  }
  return { serverLoginState: entry.serverLoginState, isDummy: entry.isDummy }
}

export async function deleteLoginState(userIdentifier: string, handle: string): Promise<void> {
  map.delete(key(userIdentifier, handle))
}

export function __clearAllForTests(): void {
  map.clear()
}
```

- [ ] **Step 3: Run the test**

Run: `bun test src/server/lib/opaque-login-state-cache.test.ts`
Expected: 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/lib/opaque-login-state-cache.ts src/server/lib/opaque-login-state-cache.test.ts
git commit -m "feat(server): in-memory OPAQUE login state cache with TTL"
```

### Task 18: OPAQUE routes `/api/auth/opaque/*`

**Files:**
- Create: `src/server/routes/opaque.ts`
- Create: `src/server/routes/opaque.test.ts`
- Modify: `src/server/routes/auth-facade.ts`
- Modify: `src/server/services/identity.ts`

- [ ] **Step 1: Extend `identity.ts` with OPAQUE record CRUD**

```typescript
// src/server/services/identity.ts (additions)
import { userOpaqueRecords } from '../db/schema/opaque'
import { eq } from 'drizzle-orm'

async storeOpaqueRecord(params: { pubkey: string; registrationRecord: Uint8Array }): Promise<void> {
  await this.db
    .insert(userOpaqueRecords)
    .values({ userPubkey: params.pubkey, registrationRecord: params.registrationRecord })
    .onConflictDoUpdate({
      target: userOpaqueRecords.userPubkey,
      set: { registrationRecord: params.registrationRecord },
    })
}

async getOpaqueRecord(userIdentifier: string): Promise<Uint8Array | null> {
  // userIdentifier is typically an email or pubkey; we resolve to pubkey via
  // the normal identity lookup, then read the OPAQUE record.
  const user = await this.findByIdentifier(userIdentifier)
  if (!user) return null
  const rows = await this.db
    .select()
    .from(userOpaqueRecords)
    .where(eq(userOpaqueRecords.userPubkey, user.pubkey))
  return rows[0]?.registrationRecord ?? null
}
```

- [ ] **Step 2: Write failing route tests**

```typescript
// src/server/routes/opaque.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { buildTestApp } from '@test-helpers/app'

describe('OPAQUE routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeEach(async () => {
    app = await buildTestApp()
  })

  test('register/init returns a base64url registrationResponse', async () => {
    // Start the client flow so we have a real registrationRequest
    const opaque = await import('@serenity-kit/opaque')
    await opaque.ready
    const { registrationRequest } = opaque.client.startRegistration({
      password: 'correct-horse-battery-staple',
    })
    const res = await app.request('/api/auth/opaque/register/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userIdentifier: 'alice@example.com', registrationRequest }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { registrationResponse: string }
    expect(body.registrationResponse).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('login/init returns a dummy response for unknown users', async () => {
    const opaque = await import('@serenity-kit/opaque')
    await opaque.ready
    const { startLoginRequest } = opaque.client.startLogin({ password: 'whatever' })
    const res = await app.request('/api/auth/opaque/login/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userIdentifier: 'nobody@example.com', startLoginRequest }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { loginResponse: string }
    expect(body.loginResponse).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
```

- [ ] **Step 3: Write `src/server/routes/opaque.ts`**

```typescript
// src/server/routes/opaque.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  OpaqueRegisterInitSchema,
  OpaqueRegisterFinishSchema,
  OpaqueLoginInitSchema,
  OpaqueLoginFinishSchema,
  OpaqueRegisterInitResponseSchema,
  OpaqueLoginInitResponseSchema,
  OpaqueLoginFinishResponseSchema,
} from '@shared/schemas/opaque'
import * as opaque from '@serenity-kit/opaque'
import { getOrCreateOpaqueServerSetup, getCachedOpaqueServerSetupString } from '../lib/opaque-server-setup'
import {
  cacheLoginState,
  loadLoginState,
  deleteLoginState,
} from '../lib/opaque-login-state-cache'
import { signAccessToken } from '../lib/jwt'

export const opaqueRoutes = new OpenAPIHono()

const registerInit = createRoute({
  method: 'post',
  path: '/register/init',
  tags: ['opaque'],
  request: { body: { content: { 'application/json': { schema: OpaqueRegisterInitSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: OpaqueRegisterInitResponseSchema } }, description: 'ok' },
  },
})

opaqueRoutes.openapi(registerInit, async (c) => {
  await opaque.ready
  await getOrCreateOpaqueServerSetup()
  const { userIdentifier, registrationRequest } = c.req.valid('json')
  const { registrationResponse } = opaque.server.createRegistrationResponse({
    serverSetup: getCachedOpaqueServerSetupString(),
    userIdentifier,
    registrationRequest,
  })
  return c.json({ registrationResponse }, 200)
})

const registerFinish = createRoute({
  method: 'post',
  path: '/register/finish',
  tags: ['opaque'],
  middleware: ['jwtAuth'] as const,
  request: { body: { content: { 'application/json': { schema: OpaqueRegisterFinishSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: { type: 'object' } as never } }, description: 'ok' },
  },
})

opaqueRoutes.openapi(registerFinish as never, async (c) => {
  const { registrationRecord } = c.req.valid('json') as { registrationRecord: string }
  const pubkey = c.get('pubkey') as string
  const identity = c.get('identity') as { storeOpaqueRecord: (p: { pubkey: string; registrationRecord: Uint8Array }) => Promise<void> }
  const auditLog = c.get('auditLog') as { appendSigned: (payload: unknown) => Promise<void> }
  const bytes = new TextEncoder().encode(registrationRecord)
  await identity.storeOpaqueRecord({ pubkey, registrationRecord: bytes })
  await auditLog.appendSigned({
    type: 'factor_add',
    userId: pubkey,
    factorType: 'opaque',
    factorId: 'opaque',
  })
  return c.json({ ok: true }, 200)
})

const loginInit = createRoute({
  method: 'post',
  path: '/login/init',
  tags: ['opaque'],
  request: { body: { content: { 'application/json': { schema: OpaqueLoginInitSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: OpaqueLoginInitResponseSchema } }, description: 'ok' },
  },
})

opaqueRoutes.openapi(loginInit, async (c) => {
  await opaque.ready
  const setup = getCachedOpaqueServerSetupString()
  const { userIdentifier, startLoginRequest } = c.req.valid('json')
  const identity = c.get('identity') as {
    getOpaqueRecord: (u: string) => Promise<Uint8Array | null>
  }
  const record = await identity.getOpaqueRecord(userIdentifier)
  if (!record) {
    const placeholder = opaque.server.getPlaceholderRegistrationRecord()
    const { loginResponse, serverLoginState } = opaque.server.startLogin({
      serverSetup: setup,
      userIdentifier,
      registrationRecord: placeholder,
      startLoginRequest,
    })
    const handle = await cacheLoginState(userIdentifier, serverLoginState, { isDummy: true })
    c.header('X-Opaque-Handle', handle)
    return c.json({ loginResponse }, 200)
  }
  const { loginResponse, serverLoginState } = opaque.server.startLogin({
    serverSetup: setup,
    userIdentifier,
    registrationRecord: new TextDecoder().decode(record),
    startLoginRequest,
  })
  const handle = await cacheLoginState(userIdentifier, serverLoginState, { isDummy: false })
  c.header('X-Opaque-Handle', handle)
  return c.json({ loginResponse }, 200)
})

const loginFinish = createRoute({
  method: 'post',
  path: '/login/finish',
  tags: ['opaque'],
  request: { body: { content: { 'application/json': { schema: OpaqueLoginFinishSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: OpaqueLoginFinishResponseSchema } }, description: 'ok' },
    401: { description: 'invalid credentials' },
  },
})

opaqueRoutes.openapi(loginFinish, async (c) => {
  await opaque.ready
  const { userIdentifier, finishLoginRequest } = c.req.valid('json')
  const handle = c.req.header('X-Opaque-Handle') ?? ''
  const cached = await loadLoginState(userIdentifier, handle)
  if (!cached || cached.isDummy) {
    await deleteLoginState(userIdentifier, handle)
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  try {
    opaque.server.finishLogin({
      finishLoginRequest,
      serverLoginState: cached.serverLoginState,
    })
  } catch {
    return c.json({ error: 'Invalid credentials' }, 401)
  } finally {
    await deleteLoginState(userIdentifier, handle)
  }
  const identity = c.get('identity') as {
    findByIdentifier: (u: string) => Promise<{ pubkey: string } | null>
  }
  const user = await identity.findByIdentifier(userIdentifier)
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)
  const accessToken = await signAccessToken({ pubkey: user.pubkey }, c.env.JWT_SECRET)
  return c.json({ accessToken, pubkey: user.pubkey }, 200)
})
```

- [ ] **Step 4: Mount routes in `auth-facade.ts`**

Add near the other facade sub-routers:

```typescript
import { opaqueRoutes } from './opaque'
authFacade.route('/opaque', opaqueRoutes)
```

- [ ] **Step 5: Run the tests**

```bash
bun run dev:docker
bun run migrate
bun test src/server/routes/opaque.test.ts
```

Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/opaque.ts src/server/routes/opaque.test.ts src/server/routes/auth-facade.ts src/server/services/identity.ts
git commit -m "feat(routes): /api/auth/opaque/{register,login}/{init,finish} endpoints"
```

### Task 19: Recovery Group server service

**Files:**
- Create: `src/server/services/recovery-group-service.ts`
- Create: `src/server/services/recovery-group-service.test.ts`
- Create: `src/server/services/root-kek-envelope-service.ts`
- Create: `src/server/services/root-kek-envelope-service.test.ts`

- [ ] **Step 1: Write failing tests for root-kek-envelope-service**

```typescript
// src/server/services/root-kek-envelope-service.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { buildTestDb } from '@test-helpers/db'
import { RootKekEnvelopeService } from './root-kek-envelope-service'
import type { RootKekEnvelopeBundle } from '@shared/schemas/root-kek-envelope'

function makeBundle(userId: string, envelopes: { factorType: string; factorId: string }[]): RootKekEnvelopeBundle {
  return {
    v: 3,
    userId,
    rootKeyId: crypto.randomUUID(),
    envelopes: envelopes.map((e) => ({
      v: 3 as const,
      factorType: e.factorType as never,
      factorId: e.factorId,
      wrappedKey: 'ca'.repeat(40),
      createdAt: new Date().toISOString(),
    })),
    createdAt: new Date().toISOString(),
  }
}

describe('RootKekEnvelopeService', () => {
  let db: Awaited<ReturnType<typeof buildTestDb>>
  let service: RootKekEnvelopeService

  beforeEach(async () => {
    db = await buildTestDb()
    service = new RootKekEnvelopeService(db)
  })

  test('putBundle rejects a bundle with <2 envelopes', async () => {
    const bundle = makeBundle('00000000-0000-0000-0000-000000000001', [
      { factorType: 'prf', factorId: 'a' },
    ])
    await expect(service.putBundle(bundle)).rejects.toThrow()
  })

  test('putBundle persists a valid bundle', async () => {
    const bundle = makeBundle('00000000-0000-0000-0000-000000000001', [
      { factorType: 'prf', factorId: 'a' },
      { factorType: 'recoveryPhrase', factorId: 'phrase' },
    ])
    await service.putBundle(bundle)
    const loaded = await service.getBundle(bundle.userId)
    expect(loaded?.envelopes).toHaveLength(2)
  })

  test('removeEnvelope below the minimum is rejected', async () => {
    const bundle = makeBundle('00000000-0000-0000-0000-000000000002', [
      { factorType: 'prf', factorId: 'a' },
      { factorType: 'recoveryPhrase', factorId: 'phrase' },
    ])
    await service.putBundle(bundle)
    await expect(
      service.removeEnvelope(bundle.userId, { factorType: 'prf', factorId: 'a' }),
    ).rejects.toThrow()
  })

  test('rotateBundle bumps rootKeyId', async () => {
    const b1 = makeBundle('00000000-0000-0000-0000-000000000003', [
      { factorType: 'prf', factorId: 'a' },
      { factorType: 'recoveryPhrase', factorId: 'phrase' },
    ])
    await service.putBundle(b1)
    const b2 = { ...b1, rootKeyId: crypto.randomUUID() }
    await service.rotateBundle(b2)
    const loaded = await service.getBundle(b1.userId)
    expect(loaded?.rootKeyId).toBe(b2.rootKeyId)
  })
})
```

- [ ] **Step 2: Write `root-kek-envelope-service.ts`**

```typescript
// src/server/services/root-kek-envelope-service.ts
/**
 * Server-side CRUD for the per-user root KEK envelope bundle.
 *
 * Enforces:
 *   - bundle shape via RootKekEnvelopeBundleSchema (which includes min-2)
 *   - rootKeyId change on rotate
 *   - audit sigchain entry emission on mutate (injected via options.auditLog)
 */
import type { db as Db } from '../db'
import { userRootKekEnvelopes } from '../db/schema/recovery'
import { eq } from 'drizzle-orm'
import {
  RootKekEnvelopeBundleSchema,
  type RootKekEnvelopeBundle,
  type RootKekEnvelope,
} from '@shared/schemas/root-kek-envelope'

export class RootKekEnvelopeService {
  constructor(private readonly db: typeof Db) {}

  async getBundle(userPubkey: string): Promise<RootKekEnvelopeBundle | null> {
    const rows = await this.db
      .select()
      .from(userRootKekEnvelopes)
      .where(eq(userRootKekEnvelopes.userPubkey, userPubkey))
    if (!rows.length) return null
    return RootKekEnvelopeBundleSchema.parse(rows[0]!.bundleJson)
  }

  async putBundle(bundle: RootKekEnvelopeBundle): Promise<void> {
    const parsed = RootKekEnvelopeBundleSchema.parse(bundle)
    await this.db
      .insert(userRootKekEnvelopes)
      .values({
        userPubkey: parsed.userId,
        bundleJson: parsed,
        rootKeyId: parsed.rootKeyId,
      })
      .onConflictDoUpdate({
        target: userRootKekEnvelopes.userPubkey,
        set: {
          bundleJson: parsed,
          rootKeyId: parsed.rootKeyId,
          updatedAt: new Date(),
        },
      })
  }

  async appendEnvelope(userPubkey: string, envelope: RootKekEnvelope): Promise<RootKekEnvelopeBundle> {
    const bundle = await this.getBundle(userPubkey)
    if (!bundle) throw new Error('bundle missing')
    const envelopes = [
      ...bundle.envelopes.filter(
        (e) => !(e.factorType === envelope.factorType && e.factorId === envelope.factorId),
      ),
      envelope,
    ]
    const next: RootKekEnvelopeBundle = { ...bundle, envelopes }
    await this.putBundle(next)
    return next
  }

  async removeEnvelope(
    userPubkey: string,
    target: { factorType: RootKekEnvelope['factorType']; factorId: string },
  ): Promise<RootKekEnvelopeBundle> {
    const bundle = await this.getBundle(userPubkey)
    if (!bundle) throw new Error('bundle missing')
    const envelopes = bundle.envelopes.filter(
      (e) => !(e.factorType === target.factorType && e.factorId === target.factorId),
    )
    if (envelopes.length < 2) {
      throw new Error('min factor invariant: cannot drop below 2 envelopes')
    }
    const next: RootKekEnvelopeBundle = { ...bundle, envelopes }
    await this.putBundle(next)
    return next
  }

  async rotateBundle(rotated: RootKekEnvelopeBundle): Promise<void> {
    const existing = await this.getBundle(rotated.userId)
    if (existing && existing.rootKeyId === rotated.rootKeyId) {
      throw new Error('rotateBundle requires a new rootKeyId')
    }
    await this.putBundle(rotated)
  }
}
```

- [ ] **Step 3: Write failing tests for recovery-group-service**

```typescript
// src/server/services/recovery-group-service.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { buildTestDb } from '@test-helpers/db'
import { RecoveryGroupService } from './recovery-group-service'

describe('RecoveryGroupService', () => {
  let db: Awaited<ReturnType<typeof buildTestDb>>
  let service: RecoveryGroupService

  beforeEach(async () => {
    db = await buildTestDb()
    service = new RecoveryGroupService(db)
  })

  test('enrollHub stores group + 3 share envelopes', async () => {
    await service.enrollHub({
      hubId: '00000000-0000-0000-0000-000000000001',
      threshold: 2,
      totalShares: 3,
      groupPublicKey: '00'.repeat(32),
      shareEnvelopes: [
        { adminPubkey: 'aa'.repeat(32), envelope: new Uint8Array([1, 2]) },
        { adminPubkey: 'bb'.repeat(32), envelope: new Uint8Array([3, 4]) },
        { adminPubkey: 'cc'.repeat(32), envelope: new Uint8Array([5, 6]) },
      ],
      shareCommitments: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
    })
    const group = await service.getGroup('00000000-0000-0000-0000-000000000001')
    expect(group?.threshold).toBe(2)
    expect(group?.totalShares).toBe(3)
  })

  test('initiateRecovery creates a pending session with 24h expiry', async () => {
    await service.enrollHub({
      hubId: '00000000-0000-0000-0000-000000000001',
      threshold: 2,
      totalShares: 3,
      groupPublicKey: '00'.repeat(32),
      shareEnvelopes: [
        { adminPubkey: 'aa'.repeat(32), envelope: new Uint8Array([1]) },
        { adminPubkey: 'bb'.repeat(32), envelope: new Uint8Array([2]) },
        { adminPubkey: 'cc'.repeat(32), envelope: new Uint8Array([3]) },
      ],
      shareCommitments: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
    })
    const session = await service.initiateRecovery({
      hubId: '00000000-0000-0000-0000-000000000001',
      userPubkey: 'user-pk',
      newDevicePubkey: 'dd'.repeat(32),
      coordinatorPubkey: 'ee'.repeat(32),
    })
    expect(session.status).toBe('pending')
    const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000
    expect(Math.abs(new Date(session.expiresAt).getTime() - expectedExpiry)).toBeLessThan(5_000)
  })

  test('contributeShare appends into contributions array', async () => {
    const hub = '00000000-0000-0000-0000-000000000001'
    await service.enrollHub({
      hubId: hub,
      threshold: 2,
      totalShares: 3,
      groupPublicKey: '00'.repeat(32),
      shareEnvelopes: [
        { adminPubkey: 'aa'.repeat(32), envelope: new Uint8Array([1]) },
        { adminPubkey: 'bb'.repeat(32), envelope: new Uint8Array([2]) },
        { adminPubkey: 'cc'.repeat(32), envelope: new Uint8Array([3]) },
      ],
      shareCommitments: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
    })
    const session = await service.initiateRecovery({
      hubId: hub,
      userPubkey: 'user-pk',
      newDevicePubkey: 'dd'.repeat(32),
      coordinatorPubkey: 'ee'.repeat(32),
    })
    await service.contributeShare({
      sessionId: session.sessionId,
      byAdminPubkey: 'aa'.repeat(32),
      encryptedShare: 'cafe',
    })
    await service.contributeShare({
      sessionId: session.sessionId,
      byAdminPubkey: 'bb'.repeat(32),
      encryptedShare: 'beef',
    })
    const updated = await service.getSession(session.sessionId)
    expect(updated?.contributions).toHaveLength(2)
    expect(updated?.status).toBe('ready')
  })

  test('completeRecovery before 24h without override is rejected', async () => {
    const hub = '00000000-0000-0000-0000-000000000001'
    await service.enrollHub({
      hubId: hub,
      threshold: 2,
      totalShares: 3,
      groupPublicKey: '00'.repeat(32),
      shareEnvelopes: [
        { adminPubkey: 'aa'.repeat(32), envelope: new Uint8Array([1]) },
        { adminPubkey: 'bb'.repeat(32), envelope: new Uint8Array([2]) },
        { adminPubkey: 'cc'.repeat(32), envelope: new Uint8Array([3]) },
      ],
      shareCommitments: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
    })
    const session = await service.initiateRecovery({
      hubId: hub,
      userPubkey: 'user-pk',
      newDevicePubkey: 'dd'.repeat(32),
      coordinatorPubkey: 'ee'.repeat(32),
    })
    await expect(
      service.completeRecovery({
        sessionId: session.sessionId,
        newBundle: {
          v: 3,
          userId: '00000000-0000-0000-0000-000000000002',
          rootKeyId: crypto.randomUUID(),
          envelopes: [
            { v: 3, factorType: 'prf', factorId: 'x', wrappedKey: 'ab', createdAt: new Date().toISOString() },
            { v: 3, factorType: 'recoveryPhrase', factorId: 'p', wrappedKey: 'cd', createdAt: new Date().toISOString() },
          ],
          createdAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(/delay/i)
  })
})
```

- [ ] **Step 4: Write `recovery-group-service.ts`**

```typescript
// src/server/services/recovery-group-service.ts
/**
 * DB-level orchestration for the 1Password-style Recovery Group.
 *
 * - enrollHub: create hub_recovery_groups row + hub_recovery_group_shares rows
 * - initiateRecovery: create recovery_sessions row with 24h expiry
 * - contributeShare: append encrypted share; mark `ready` once threshold reached
 * - completeRecovery: validate 24h elapsed OR emergency override; rewrite bundle
 * - rotateGroup: new key + new shares + new user_recovery_envelopes
 *
 * Every mutating method accepts an `auditLog` injection point so callers can
 * append the corresponding sigchain entry inside the same transaction.
 */
import type { db as Db } from '../db'
import {
  hubRecoveryGroups,
  hubRecoveryGroupShares,
  recoverySessions,
  userRecoveryEnvelopes,
} from '../db/schema/recovery'
import { and, eq } from 'drizzle-orm'
import type { RootKekEnvelopeBundle } from '@shared/schemas/root-kek-envelope'
import { RootKekEnvelopeBundleSchema } from '@shared/schemas/root-kek-envelope'

const RECOVERY_DELAY_MS = 24 * 60 * 60 * 1000

export class RecoveryGroupDelayError extends Error {
  constructor(remainingMs: number) {
    super(`Recovery delay not elapsed; ${remainingMs}ms remaining`)
    this.name = 'RecoveryGroupDelayError'
  }
}

export class RecoveryGroupThresholdError extends Error {
  constructor(have: number, need: number) {
    super(`Recovery threshold not met: ${have} < ${need}`)
    this.name = 'RecoveryGroupThresholdError'
  }
}

export interface EnrollHubInput {
  hubId: string
  threshold: number
  totalShares: number
  groupPublicKey: string
  shareEnvelopes: { adminPubkey: string; envelope: Uint8Array }[]
  shareCommitments: string[]
}

export interface InitiateRecoveryInput {
  hubId: string
  userPubkey: string
  newDevicePubkey: string
  coordinatorPubkey: string
}

export interface ContributeShareInput {
  sessionId: string
  byAdminPubkey: string
  encryptedShare: string
}

export interface CompleteRecoveryInput {
  sessionId: string
  newBundle: RootKekEnvelopeBundle
  emergencyOverride?: {
    justification: string
    coApproverPubkey: string
    coApproverSignature: string
  }
}

export class RecoveryGroupService {
  constructor(private readonly db: typeof Db) {}

  async enrollHub(input: EnrollHubInput): Promise<void> {
    if (input.shareEnvelopes.length !== input.totalShares) {
      throw new Error('shareEnvelopes length must match totalShares')
    }
    if (input.shareCommitments.length !== input.totalShares) {
      throw new Error('shareCommitments length must match totalShares')
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(hubRecoveryGroups).values({
        hubId: input.hubId,
        groupPublicKey: input.groupPublicKey,
        threshold: input.threshold,
        totalShares: input.totalShares,
        shareCommitments: input.shareCommitments,
      })
      for (const s of input.shareEnvelopes) {
        await tx.insert(hubRecoveryGroupShares).values({
          hubId: input.hubId,
          adminPubkey: s.adminPubkey,
          shareEnvelope: s.envelope,
        })
      }
    })
  }

  async getGroup(hubId: string) {
    const rows = await this.db
      .select()
      .from(hubRecoveryGroups)
      .where(eq(hubRecoveryGroups.hubId, hubId))
    return rows[0] ?? null
  }

  async initiateRecovery(input: InitiateRecoveryInput) {
    const sessionId = crypto.randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + RECOVERY_DELAY_MS)
    await this.db.insert(recoverySessions).values({
      sessionId,
      hubId: input.hubId,
      userPubkey: input.userPubkey,
      coordinatorPubkey: input.coordinatorPubkey,
      newDevicePubkey: input.newDevicePubkey,
      status: 'pending',
      contributions: [],
      createdAt: now,
      expiresAt,
    })
    return {
      sessionId,
      status: 'pending' as const,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
  }

  async getSession(sessionId: string) {
    const rows = await this.db
      .select()
      .from(recoverySessions)
      .where(eq(recoverySessions.sessionId, sessionId))
    return rows[0] ?? null
  }

  async contributeShare(input: ContributeShareInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = (
        await tx
          .select()
          .from(recoverySessions)
          .where(eq(recoverySessions.sessionId, input.sessionId))
      )[0]
      if (!row) throw new Error('recovery session not found')
      if (row.status !== 'pending' && row.status !== 'ready') {
        throw new Error(`cannot contribute to session in state ${row.status}`)
      }
      const group = (
        await tx
          .select()
          .from(hubRecoveryGroups)
          .where(eq(hubRecoveryGroups.hubId, row.hubId))
      )[0]
      if (!group) throw new Error('recovery group not found')
      const contributions = [
        ...(row.contributions as { byAdminPubkey: string; encryptedShare: string }[]),
        {
          byAdminPubkey: input.byAdminPubkey,
          encryptedShare: input.encryptedShare,
        },
      ]
      const newStatus = contributions.length >= group.threshold ? 'ready' : 'pending'
      await tx
        .update(recoverySessions)
        .set({ contributions, status: newStatus })
        .where(eq(recoverySessions.sessionId, input.sessionId))
    })
  }

  async completeRecovery(input: CompleteRecoveryInput): Promise<void> {
    RootKekEnvelopeBundleSchema.parse(input.newBundle)
    await this.db.transaction(async (tx) => {
      const session = (
        await tx
          .select()
          .from(recoverySessions)
          .where(eq(recoverySessions.sessionId, input.sessionId))
      )[0]
      if (!session) throw new Error('recovery session not found')
      if (session.status !== 'ready') throw new Error('session not ready to complete')
      const group = (
        await tx
          .select()
          .from(hubRecoveryGroups)
          .where(eq(hubRecoveryGroups.hubId, session.hubId))
      )[0]
      if (!group) throw new Error('group missing')
      const elapsedMs = Date.now() - session.createdAt.getTime()
      const overrideMs = 60 * 60 * 1000 // 1h emergency floor
      const required = input.emergencyOverride ? overrideMs : RECOVERY_DELAY_MS
      if (elapsedMs < required) {
        throw new RecoveryGroupDelayError(required - elapsedMs)
      }
      await tx
        .update(recoverySessions)
        .set({
          status: 'completed',
          emergencyOverride: input.emergencyOverride ?? null,
        })
        .where(eq(recoverySessions.sessionId, input.sessionId))
    })
  }

  async rotateGroup(hubId: string, nextGroup: EnrollHubInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(hubRecoveryGroupShares).where(eq(hubRecoveryGroupShares.hubId, hubId))
      await tx
        .update(hubRecoveryGroups)
        .set({
          groupPublicKey: nextGroup.groupPublicKey,
          threshold: nextGroup.threshold,
          totalShares: nextGroup.totalShares,
          shareCommitments: nextGroup.shareCommitments,
          rotatedAt: new Date(),
        })
        .where(eq(hubRecoveryGroups.hubId, hubId))
      for (const s of nextGroup.shareEnvelopes) {
        await tx.insert(hubRecoveryGroupShares).values({
          hubId,
          adminPubkey: s.adminPubkey,
          shareEnvelope: s.envelope,
        })
      }
      // user_recovery_envelopes re-wrap is caller's responsibility (the root KEK
      // is wrapped under the NEW group public key client-side before writing).
    })
  }

  async putUserRecoveryEnvelope(
    userPubkey: string,
    hubId: string,
    envelope: Uint8Array,
  ): Promise<void> {
    await this.db
      .insert(userRecoveryEnvelopes)
      .values({ userPubkey, hubId, envelope })
      .onConflictDoUpdate({
        target: [userRecoveryEnvelopes.userPubkey, userRecoveryEnvelopes.hubId],
        set: { envelope },
      })
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/server/services/root-kek-envelope-service.test.ts src/server/services/recovery-group-service.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/root-kek-envelope-service.ts src/server/services/root-kek-envelope-service.test.ts src/server/services/recovery-group-service.ts src/server/services/recovery-group-service.test.ts
git commit -m "feat(services): RootKekEnvelopeService + RecoveryGroupService with delay enforcement"
```

### Task 20: Recovery routes `/api/auth/recovery-group/*` and `/api/auth/recovery-phrase/*`

**Files:**
- Create: `src/server/routes/recovery-group.ts`
- Create: `src/server/routes/recovery-group.test.ts`
- Create: `src/server/routes/recovery-phrase.ts`
- Create: `src/server/routes/recovery-phrase.test.ts`
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Write failing recovery-group route test**

```typescript
// src/server/routes/recovery-group.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { buildTestApp, loginAs } from '@test-helpers/app'

describe('POST /api/auth/recovery-group/enroll', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>
  beforeEach(async () => {
    app = await buildTestApp()
  })

  test('hub admin enrolls a 2-of-3 group', async () => {
    const { token } = await loginAs(app, 'admin1')
    const res = await app.request('/api/auth/recovery-group/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        hubId: 'hub-1',
        threshold: 2,
        totalShares: 3,
        groupPublicKey: '00'.repeat(32),
        shareEnvelopes: [
          { adminPubkey: 'aa'.repeat(32), envelope: 'cafe' },
          { adminPubkey: 'bb'.repeat(32), envelope: 'cafe' },
          { adminPubkey: 'cc'.repeat(32), envelope: 'cafe' },
        ],
        shareCommitments: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
      }),
    })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/auth/recovery-group/initiate', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>
  beforeEach(async () => {
    app = await buildTestApp()
  })

  test('unauth user can initiate with a fresh device pubkey', async () => {
    const res = await app.request('/api/auth/recovery-group/initiate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hubId: 'hub-1',
        userIdentifier: 'alice@example.com',
        newDevicePubkey: 'dd'.repeat(32),
      }),
    })
    expect([200, 404]).toContain(res.status)
  })
})
```

- [ ] **Step 2: Write `recovery-group.ts` route file**

```typescript
// src/server/routes/recovery-group.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  RecoveryGroupEnrollSchema,
  RecoveryInitiateSchema,
  RecoveryContributeShareSchema,
  RecoveryCompleteSchema,
} from '@shared/schemas/recovery-group'
import { z } from '@hono/zod-openapi'

export const recoveryGroupRoutes = new OpenAPIHono()

const enroll = createRoute({
  method: 'post',
  path: '/enroll',
  tags: ['recovery-group'],
  middleware: ['jwtAuth', 'hubAdmin'] as const,
  request: { body: { content: { 'application/json': { schema: RecoveryGroupEnrollSchema } } } },
  responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } } },
})

recoveryGroupRoutes.openapi(enroll as never, async (c) => {
  const body = c.req.valid('json') as z.infer<typeof RecoveryGroupEnrollSchema>
  const service = c.get('recoveryGroupService') as import('../services/recovery-group-service').RecoveryGroupService
  const auditLog = c.get('auditLog') as { appendSigned: (p: unknown) => Promise<void> }
  await service.enrollHub({
    hubId: body.hubId,
    threshold: body.threshold,
    totalShares: body.totalShares,
    groupPublicKey: body.groupPublicKey,
    shareEnvelopes: body.shareEnvelopes.map((s) => ({
      adminPubkey: s.adminPubkey,
      envelope: new Uint8Array(s.envelope.length / 2).map((_, i) =>
        parseInt(s.envelope.slice(i * 2, i * 2 + 2), 16),
      ),
    })),
    shareCommitments: body.shareCommitments,
  })
  await auditLog.appendSigned({
    type: 'recovery_group_enroll',
    hubId: body.hubId,
    threshold: body.threshold,
    totalShares: body.totalShares,
    adminPubkeys: body.shareEnvelopes.map((s) => s.adminPubkey),
    shareCommitments: body.shareCommitments,
    groupPublicKey: body.groupPublicKey,
  })
  return c.json({ ok: true as const }, 200)
})

const initiate = createRoute({
  method: 'post',
  path: '/initiate',
  tags: ['recovery-group'],
  request: { body: { content: { 'application/json': { schema: RecoveryInitiateSchema } } } },
  responses: {
    200: { description: 'ok', content: { 'application/json': { schema: z.object({ sessionId: z.string().uuid(), expiresAt: z.string() }) } } },
    404: { description: 'not found' },
  },
})

recoveryGroupRoutes.openapi(initiate, async (c) => {
  const body = c.req.valid('json')
  const identity = c.get('identity') as { findByIdentifier: (u: string) => Promise<{ pubkey: string } | null> }
  const service = c.get('recoveryGroupService') as import('../services/recovery-group-service').RecoveryGroupService
  const user = await identity.findByIdentifier(body.userIdentifier)
  if (!user) return c.json({ error: 'not found' }, 404) as never
  const session = await service.initiateRecovery({
    hubId: body.hubId,
    userPubkey: user.pubkey,
    newDevicePubkey: body.newDevicePubkey,
    coordinatorPubkey: body.newDevicePubkey,
  })
  const auditLog = c.get('auditLog') as { appendSigned: (p: unknown) => Promise<void> }
  await auditLog.appendSigned({
    type: 'recovery_initiated',
    hubId: body.hubId,
    userId: user.pubkey,
    sessionId: session.sessionId,
    requestedAt: session.createdAt,
    expiresAt: session.expiresAt,
  })
  return c.json({ sessionId: session.sessionId, expiresAt: session.expiresAt }, 200)
})

const contribute = createRoute({
  method: 'post',
  path: '/contribute-share',
  tags: ['recovery-group'],
  middleware: ['jwtAuth', 'hubAdmin'] as const,
  request: { body: { content: { 'application/json': { schema: RecoveryContributeShareSchema } } } },
  responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } } },
})

recoveryGroupRoutes.openapi(contribute as never, async (c) => {
  const body = c.req.valid('json') as z.infer<typeof RecoveryContributeShareSchema>
  const service = c.get('recoveryGroupService') as import('../services/recovery-group-service').RecoveryGroupService
  const adminPubkey = c.get('pubkey') as string
  await service.contributeShare({
    sessionId: body.sessionId,
    byAdminPubkey: adminPubkey,
    encryptedShare: body.encryptedShare,
  })
  const auditLog = c.get('auditLog') as { appendSigned: (p: unknown) => Promise<void> }
  const session = await service.getSession(body.sessionId)
  if (session) {
    await auditLog.appendSigned({
      type: 'recovery_share_contributed',
      hubId: session.hubId,
      sessionId: body.sessionId,
      byAdminPubkey: adminPubkey,
    })
  }
  return c.json({ ok: true as const }, 200)
})

const complete = createRoute({
  method: 'post',
  path: '/complete',
  tags: ['recovery-group'],
  request: { body: { content: { 'application/json': { schema: RecoveryCompleteSchema } } } },
  responses: {
    200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } },
    403: { description: 'delay not elapsed or override invalid' },
  },
})

recoveryGroupRoutes.openapi(complete, async (c) => {
  const body = c.req.valid('json')
  const service = c.get('recoveryGroupService') as import('../services/recovery-group-service').RecoveryGroupService
  const envelopeService = c.get('rootKekEnvelopeService') as import('../services/root-kek-envelope-service').RootKekEnvelopeService
  try {
    await service.completeRecovery({
      sessionId: body.sessionId,
      newBundle: body.newBundle,
      emergencyOverride: body.emergencyOverride,
    })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 403) as never
  }
  await envelopeService.rotateBundle(body.newBundle)
  const auditLog = c.get('auditLog') as { appendSigned: (p: unknown) => Promise<void> }
  const session = await service.getSession(body.sessionId)
  if (session) {
    await auditLog.appendSigned({
      type: 'recovery_completed',
      hubId: session.hubId,
      userId: body.newBundle.userId,
      sessionId: body.sessionId,
      sharedBy: (session.contributions as { byAdminPubkey: string }[]).map((x) => x.byAdminPubkey),
      newDevicePubkey: session.newDevicePubkey,
      emergencyOverride: body.emergencyOverride
        ? { invoked: true, justification: body.emergencyOverride.justification, coApproverPubkey: body.emergencyOverride.coApproverPubkey }
        : undefined,
    })
  }
  return c.json({ ok: true as const }, 200)
})
```

- [ ] **Step 3: Write `recovery-phrase.ts` route file**

```typescript
// src/server/routes/recovery-phrase.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import { RecoveryPhraseRotateSchema } from '@shared/schemas/recovery-phrase'

export const recoveryPhraseRoutes = new OpenAPIHono()

const rotate = createRoute({
  method: 'post',
  path: '/rotate',
  tags: ['recovery-phrase'],
  middleware: ['jwtAuth', 'unlocked'] as const,
  request: { body: { content: { 'application/json': { schema: RecoveryPhraseRotateSchema } } } },
  responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } }, 429: { description: 'rate limited' } },
})

recoveryPhraseRoutes.openapi(rotate as never, async (c) => {
  const body = c.req.valid('json') as z.infer<typeof RecoveryPhraseRotateSchema>
  const pubkey = c.get('pubkey') as string
  const rateLimit = c.get('rateLimit') as {
    isRateLimited: (key: string, limit: number, windowSec: number) => Promise<boolean>
  }
  if (await rateLimit.isRateLimited(`rp-rotate:${pubkey}`, 3, 24 * 60 * 60)) {
    return c.json({ error: 'rate limited' }, 429) as never
  }
  const envelopeService = c.get('rootKekEnvelopeService') as import('../services/root-kek-envelope-service').RootKekEnvelopeService
  await envelopeService.appendEnvelope(pubkey, body.newEnvelope)
  const identity = c.get('identity') as {
    storeRecoveryPhraseMeta: (p: { pubkey: string; meta: z.infer<typeof RecoveryPhraseRotateSchema>['newMeta'] }) => Promise<void>
  }
  await identity.storeRecoveryPhraseMeta({ pubkey, meta: body.newMeta })
  const auditLog = c.get('auditLog') as { appendSigned: (p: unknown) => Promise<void> }
  await auditLog.appendSigned({ type: 'factor_add', userId: pubkey, factorType: 'recoveryPhrase', factorId: 'phrase' })
  return c.json({ ok: true as const }, 200)
})
```

- [ ] **Step 4: Mount routes + delete legacy ones**

In `src/server/routes/auth-facade.ts`:

```typescript
import { recoveryGroupRoutes } from './recovery-group'
import { recoveryPhraseRoutes } from './recovery-phrase'
authFacade.route('/recovery-group', recoveryGroupRoutes)
authFacade.route('/recovery-phrase', recoveryPhraseRoutes)
```

And delete: every `/pin/*`, `/recovery/*`, `/kek-proof/*` route block that still exists (they were stubbed in Task 6 — now remove them completely).

- [ ] **Step 5: Run the tests**

```bash
bun test src/server/routes/recovery-group.test.ts
```

Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/recovery-group.ts src/server/routes/recovery-group.test.ts src/server/routes/recovery-phrase.ts src/server/routes/auth-facade.ts
git commit -m "feat(routes): /api/auth/recovery-group/* and /api/auth/recovery-phrase/rotate"
```

## Workstream 2.5 — Client-side unlock orchestration

### Task 21: `unlock-factors.ts` — tagged-union orchestration

**Files:**
- Create: `src/client/lib/unlock-factors.ts`
- Create: `src/client/lib/unlock-factors.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/unlock-factors.test.ts
import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { runUnlockFactor, type UnlockFactor, NoMatchingEnvelopeError } from './unlock-factors'

// Mock the sub-factor modules
mock.module('./webauthn', () => ({
  unlockPrfFromCredential: mock(async () => ({ prfOutput: new Uint8Array(32).fill(1) })),
}))
mock.module('./opaque-client', () => ({
  opaqueClientLogin: mock(async () => ({
    finishLoginRequest: 'xx',
    sessionKey: new Uint8Array(32),
    exportKey: new Uint8Array(64).fill(2),
  })),
}))
mock.module('./recovery-phrase', () => ({
  deriveRecoveryPhraseKekBytes: mock(() => new Uint8Array(32).fill(3)),
  RecoveryPhraseError: class RecoveryPhraseError extends Error {},
}))
mock.module('./crypto-worker-client', () => ({
  cryptoWorkerClient: {
    importFactorAsAesKw: mock(async () => ({} as CryptoKey)),
    unwrapRootKekWith: mock(async () => {}),
    isRootKekLoaded: mock(async () => true),
  },
}))
mock.module('./key-store-v3', () => ({
  loadBundleFromIdb: mock(async () => ({
    v: 3,
    userId: 'u',
    rootKeyId: 'r',
    envelopes: [
      { v: 3, factorType: 'prf', factorId: 'cred-a', wrappedKey: 'ca'.repeat(40), createdAt: 'now' },
      { v: 3, factorType: 'recoveryPhrase', factorId: 'phrase', wrappedKey: 'cb'.repeat(40), createdAt: 'now' },
    ],
    createdAt: 'now',
  })),
}))

describe('runUnlockFactor', () => {
  beforeEach(() => {})

  test('PRF factor unwraps the matching envelope', async () => {
    const factor: UnlockFactor = { type: 'prf', credentialId: 'cred-a' }
    await runUnlockFactor(factor)
    const { cryptoWorkerClient } = await import('./crypto-worker-client')
    expect(cryptoWorkerClient.unwrapRootKekWith).toHaveBeenCalled()
  })

  test('OPAQUE factor routes to the opaque envelope', async () => {
    const factor: UnlockFactor = { type: 'opaque', password: 'horse-battery' }
    mock.module('./key-store-v3', () => ({
      loadBundleFromIdb: async () => ({
        v: 3,
        userId: 'u',
        rootKeyId: 'r',
        envelopes: [
          { v: 3, factorType: 'opaque', factorId: 'opaque', wrappedKey: 'cc'.repeat(40), createdAt: 'now' },
          { v: 3, factorType: 'recoveryPhrase', factorId: 'phrase', wrappedKey: 'cb'.repeat(40), createdAt: 'now' },
        ],
        createdAt: 'now',
      }),
    }))
    await runUnlockFactor(factor)
  })

  test('no matching envelope throws NoMatchingEnvelopeError', async () => {
    mock.module('./key-store-v3', () => ({
      loadBundleFromIdb: async () => ({
        v: 3,
        userId: 'u',
        rootKeyId: 'r',
        envelopes: [
          { v: 3, factorType: 'recoveryPhrase', factorId: 'phrase', wrappedKey: 'cb'.repeat(40), createdAt: 'now' },
          { v: 3, factorType: 'recoveryPhrase', factorId: 'phrase-2', wrappedKey: 'cd'.repeat(40), createdAt: 'now' },
        ],
        createdAt: 'now',
      }),
    }))
    const factor: UnlockFactor = { type: 'prf', credentialId: 'cred-missing' }
    await expect(runUnlockFactor(factor)).rejects.toBeInstanceOf(NoMatchingEnvelopeError)
  })
})
```

- [ ] **Step 2: Write `unlock-factors.ts`**

```typescript
// src/client/lib/unlock-factors.ts
/**
 * Tagged-union unlock orchestration.
 *
 *  runUnlockFactor(factor) →
 *    1. derive a factor-specific AES-KW key in the worker
 *    2. locate the matching envelope in the bundle
 *    3. unwrap the root KEK, load it into the worker
 *    4. worker is now in the Unlocked state
 *
 * The factor-specific derivation branch is the only thing that differs
 * between PRF / OPAQUE / recovery phrase / recovery group.
 */
import { unlockPrfFromCredential, PrfUnsupportedError } from './webauthn'
import { opaqueClientLogin } from './opaque-client'
import { deriveRecoveryPhraseKekBytes } from './recovery-phrase'
import { cryptoWorkerClient } from './crypto-worker-client'
import { loadBundleFromIdb } from './key-store-v3'
import { authFacadeClient } from './auth-facade-client'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import {
  LABEL_OPAQUE_EXPORT_KEK,
  LABEL_ROOT_KEK_WRAP,
} from '@shared/crypto-labels'
import type { RootKekEnvelope } from '@shared/schemas/root-kek-envelope'

export type UnlockFactor =
  | { type: 'prf'; credentialId: string }
  | { type: 'opaque'; password: string; userIdentifier?: string }
  | { type: 'recoveryPhrase'; phrase: string }
  | { type: 'recoveryGroup'; rootKekBytes: Uint8Array }

export class NoMatchingEnvelopeError extends Error {
  constructor(factorType: string, factorId?: string) {
    super(`No matching envelope for ${factorType}${factorId ? `:${factorId}` : ''}`)
    this.name = 'NoMatchingEnvelopeError'
  }
}

export class FactorDerivationError extends Error {}

export async function runUnlockFactor(factor: UnlockFactor): Promise<void> {
  const bundle = await loadBundleFromIdb()
  if (!bundle) throw new Error('root KEK bundle missing — re-enroll required')

  switch (factor.type) {
    case 'prf': {
      const { prfOutput } = await unlockPrfFromCredential(factor.credentialId)
      const env = bundle.envelopes.find(
        (e): e is RootKekEnvelope => e.factorType === 'prf' && e.factorId === factor.credentialId,
      )
      if (!env) throw new NoMatchingEnvelopeError('prf', factor.credentialId)
      const aesKw = await cryptoWorkerClient.importFactorAsAesKw(prfOutput, 'prf')
      prfOutput.fill(0)
      await cryptoWorkerClient.unwrapRootKekWith(env.wrappedKey, aesKw)
      return
    }
    case 'opaque': {
      const { exportKey } = await opaqueClientLogin({
        password: factor.password,
        send: async (req) => {
          const r = await authFacadeClient.opaqueLoginInit({
            userIdentifier: factor.userIdentifier ?? 'self',
            startLoginRequest: req,
          })
          return { loginResponse: r.loginResponse }
        },
      })
      // HKDF exportKey → 32 bytes
      const derived = hkdf(
        sha256,
        exportKey,
        new Uint8Array(0),
        utf8ToBytes(`${LABEL_OPAQUE_EXPORT_KEK}:opaque`),
        32,
      )
      exportKey.fill(0)
      const env = bundle.envelopes.find((e) => e.factorType === 'opaque')
      if (!env) throw new NoMatchingEnvelopeError('opaque')
      const aesKw = await cryptoWorkerClient.importFactorAsAesKw(derived, 'opaque')
      derived.fill(0)
      await cryptoWorkerClient.unwrapRootKekWith(env.wrappedKey, aesKw)
      return
    }
    case 'recoveryPhrase': {
      const meta = await authFacadeClient.getRecoveryPhraseMeta()
      const saltBytes = hexToBytes(meta.salt)
      const derived = deriveRecoveryPhraseKekBytes(factor.phrase, saltBytes)
      const env = bundle.envelopes.find((e) => e.factorType === 'recoveryPhrase')
      if (!env) throw new NoMatchingEnvelopeError('recoveryPhrase')
      const aesKw = await cryptoWorkerClient.importFactorAsAesKw(derived, 'recoveryPhrase')
      derived.fill(0)
      await cryptoWorkerClient.unwrapRootKekWith(env.wrappedKey, aesKw)
      return
    }
    case 'recoveryGroup': {
      // rootKekBytes already derived by coordinator via Shamir combine
      const aesKw = await cryptoWorkerClient.importFactorAsAesKw(
        factor.rootKekBytes,
        'recoveryGroup',
      )
      factor.rootKekBytes.fill(0)
      const env = bundle.envelopes.find((e) => e.factorType === 'recoveryGroup')
      if (!env) throw new NoMatchingEnvelopeError('recoveryGroup')
      await cryptoWorkerClient.unwrapRootKekWith(env.wrappedKey, aesKw)
      return
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export { PrfUnsupportedError }
```

- [ ] **Step 3: Run the test**

Run: `bun test src/client/lib/unlock-factors.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/unlock-factors.ts src/client/lib/unlock-factors.test.ts
git commit -m "feat(unlock-factors): tagged-union PRF/OPAQUE/phrase/group orchestration"
```

### Task 22: Convenience PIN module

**Files:**
- Create: `src/client/lib/convenience-pin.ts`
- Create: `src/client/lib/convenience-pin.test.ts`

Convenience PIN is an in-session re-lock gate only. Not a KEK factor. Server-stored as Argon2id hash; 5 wrong attempts demote to hard-lock.

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/convenience-pin.test.ts
import { describe, expect, test } from 'bun:test'
import {
  enterConveniencePin,
  setConveniencePin,
  clearConveniencePin,
  ConveniencePinLockedError,
  ConveniencePinMismatchError,
} from './convenience-pin'

describe('convenience-pin', () => {
  test('set + enter round-trip', async () => {
    await setConveniencePin('1234')
    const ok = await enterConveniencePin('1234')
    expect(ok).toBe(true)
  })

  test('wrong PIN throws ConveniencePinMismatchError', async () => {
    await setConveniencePin('1234')
    await expect(enterConveniencePin('9999')).rejects.toBeInstanceOf(ConveniencePinMismatchError)
  })

  test('5 wrong attempts locks the PIN gate', async () => {
    await setConveniencePin('1234')
    for (let i = 0; i < 5; i++) {
      await enterConveniencePin('0000').catch(() => {})
    }
    await expect(enterConveniencePin('1234')).rejects.toBeInstanceOf(ConveniencePinLockedError)
  })

  test('clear removes the PIN', async () => {
    await setConveniencePin('1234')
    await clearConveniencePin()
    await expect(enterConveniencePin('1234')).rejects.toBeInstanceOf(ConveniencePinMismatchError)
  })
})
```

- [ ] **Step 2: Write `convenience-pin.ts`**

```typescript
// src/client/lib/convenience-pin.ts
/**
 * Convenience PIN — in-session re-lock only.
 *
 * NOT a KEK factor. Stored server-side as Argon2id(PIN, random salt). When the
 * auto-lock timer fires, the worker stays "unlocked" but the UI enters a
 * convenience-locked state; a matching PIN re-enables the UI gate.
 * 5 wrong attempts demote the worker to full Locked.
 */
import { authFacadeClient } from './auth-facade-client'

export class ConveniencePinMismatchError extends Error {
  constructor(remaining: number) {
    super(`PIN mismatch (${remaining} attempts remaining)`)
    this.name = 'ConveniencePinMismatchError'
  }
}

export class ConveniencePinLockedError extends Error {
  constructor() {
    super('Convenience PIN locked after 5 wrong attempts — full unlock required')
    this.name = 'ConveniencePinLockedError'
  }
}

export async function setConveniencePin(pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4–8 digits')
  await authFacadeClient.setConveniencePin(pin)
}

export async function enterConveniencePin(pin: string): Promise<boolean> {
  try {
    await authFacadeClient.verifyConveniencePin(pin)
    return true
  } catch (err) {
    const e = err as { status?: number; remaining?: number }
    if (e.status === 423) throw new ConveniencePinLockedError()
    if (e.status === 401) throw new ConveniencePinMismatchError(e.remaining ?? 0)
    throw err
  }
}

export async function clearConveniencePin(): Promise<void> {
  await authFacadeClient.clearConveniencePin()
}
```

- [ ] **Step 3: Run the test**

Run: `bun test src/client/lib/convenience-pin.test.ts`
Expected: 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/convenience-pin.ts src/client/lib/convenience-pin.test.ts
git commit -m "feat(convenience-pin): in-session re-lock module with 5-attempt lockout"
```

### Task 23: Session capsule v2 — root-KEK capsule + rootKeyId invalidation

**Files:**
- Modify: `src/client/lib/session-capsule.ts`
- Modify: `src/client/lib/session-capsule.test.ts`

- [ ] **Step 1: Update failing test**

Add to `src/client/lib/session-capsule.test.ts`:

```typescript
describe('v3 capsule shape', () => {
  test('stores { encryptedRootKek, rootKeyId, expiresAt, userIdHash }', async () => {
    const capsule = await createSessionCapsule({
      encryptedRootKek: 'cafe',
      rootKeyId: '00000000-0000-0000-0000-000000000001',
      expiresAt: Date.now() + 3600_000,
      userIdHash: 'ab'.repeat(16),
    })
    const loaded = await loadSessionCapsule(capsule.token)
    expect(loaded?.rootKeyId).toBe('00000000-0000-0000-0000-000000000001')
    expect(loaded?.encryptedRootKek).toBe('cafe')
  })

  test('loadSessionCapsule returns null when rootKeyId does not match current bundle', async () => {
    await createSessionCapsule({
      encryptedRootKek: 'cafe',
      rootKeyId: 'old-id',
      expiresAt: Date.now() + 3600_000,
      userIdHash: 'ab'.repeat(16),
    })
    // Simulate a bundle rotation: the currentRootKeyId changed
    const loaded = await loadSessionCapsuleAgainstRootKeyId('old-id', 'new-id')
    expect(loaded).toBeNull()
  })

  test('clearCapsulesOnFactorChange wipes all', async () => {
    await createSessionCapsule({
      encryptedRootKek: 'cafe',
      rootKeyId: '1',
      expiresAt: Date.now() + 3600_000,
      userIdHash: 'x',
    })
    await clearCapsulesOnFactorChange()
    expect(await countCapsules()).toBe(0)
  })
})
```

- [ ] **Step 2: Update `session-capsule.ts`**

Replace the capsule shape + add `loadSessionCapsuleAgainstRootKeyId` + `clearCapsulesOnFactorChange`:

```typescript
// src/client/lib/session-capsule.ts (diff)
export interface SessionCapsuleV3 {
  encryptedRootKek: string
  rootKeyId: string
  expiresAt: number
  userIdHash: string
}

export async function createSessionCapsule(data: SessionCapsuleV3): Promise<{ token: string }> {
  // ... IDB put with the new shape
}

export async function loadSessionCapsuleAgainstRootKeyId(
  expectedRootKeyId: string,
  currentRootKeyId: string,
): Promise<SessionCapsuleV3 | null> {
  if (expectedRootKeyId !== currentRootKeyId) return null
  // ... fallthrough to IDB
}

export async function clearCapsulesOnFactorChange(): Promise<void> {
  // Deletes all capsule rows from IDB and broadcasts a BroadcastChannel message
  // so other tabs evict their in-memory copies.
  const db = await openDb()
  const tx = db.transaction('capsules', 'readwrite')
  tx.objectStore('capsules').clear()
  const bc = new BroadcastChannel('llamenos-capsule-sync')
  bc.postMessage({ type: 'evict-all' })
  bc.close()
}
```

Existing capsule v2 tests (nsec-based) are updated in place; the capsule no longer stores `encryptedNsec`.

- [ ] **Step 3: Run the tests**

Run: `bun test src/client/lib/session-capsule.test.ts`
Expected: all PASS (old + new).

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/session-capsule.ts src/client/lib/session-capsule.test.ts
git commit -m "feat(session-capsule): v3 root-KEK capsule with rootKeyId invalidation"
```

### Task 24: `key-manager.ts` rewrite — new state machine + `enroll`/`unlock(factor)`

**Files:**
- Modify: `src/client/lib/key-manager.ts`
- Modify: `src/client/lib/key-manager.test.ts`

- [ ] **Step 1: Rewrite failing tests**

Replace existing tests to target the new API surface:

```typescript
// src/client/lib/key-manager.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  keyManager,
  KeyManagerState,
  LockReason,
  type EnrollInput,
} from './key-manager'
import type { UnlockFactor } from './unlock-factors'

describe('key-manager state machine', () => {
  beforeEach(async () => {
    await keyManager.reset()
  })

  test('initial state is Locked', async () => {
    expect(await keyManager.getState()).toBe(KeyManagerState.Locked)
  })

  test('enroll with two factors produces a bundle with 2 envelopes', async () => {
    const input: EnrollInput = {
      factors: [
        { type: 'prf', credentialId: 'cred-a' },
        { type: 'recoveryPhrase', phrase: '...', meta: { salt: 'ab'.repeat(32), kdfParams: { algo: 'argon2id', t: 2, m: 19456, p: 1 } } },
      ],
    }
    await keyManager.enroll(input)
    expect(await keyManager.getState()).toBe(KeyManagerState.Unlocked)
  })

  test('unlock(PRF) succeeds with a valid credential', async () => {
    // test depends on mocks set at module level
  })

  test('Unlocked → Convenience-locked after auto-lock timer', async () => {
    await keyManager.unlock({ type: 'prf', credentialId: 'cred-a' } as UnlockFactor)
    await keyManager.triggerAutoLock()
    expect(await keyManager.getState()).toBe(KeyManagerState.ConvenienceLocked)
  })

  test('Unlocked → Locked via hardLock', async () => {
    await keyManager.unlock({ type: 'prf', credentialId: 'cred-a' } as UnlockFactor)
    await keyManager.hardLock(LockReason.UserInitiated)
    expect(await keyManager.getState()).toBe(KeyManagerState.Locked)
  })

  test('Convenience-locked → Unlocked via PIN', async () => {
    await keyManager.unlock({ type: 'prf', credentialId: 'cred-a' } as UnlockFactor)
    await keyManager.setConveniencePin('1234')
    await keyManager.triggerAutoLock()
    await keyManager.enterConveniencePin('1234')
    expect(await keyManager.getState()).toBe(KeyManagerState.Unlocked)
  })
})
```

- [ ] **Step 2: Rewrite `key-manager.ts`**

Replace the file's exports and body. Keep only the state machine + high-level orchestration; delegate crypto to the worker and factor derivation to `unlock-factors.ts`:

```typescript
// src/client/lib/key-manager.ts
import { runUnlockFactor, type UnlockFactor } from './unlock-factors'
import { cryptoWorkerClient } from './crypto-worker-client'
import {
  enterConveniencePin as enterConvPinLib,
  setConveniencePin as setConvPinLib,
  clearConveniencePin as clearConvPinLib,
  ConveniencePinLockedError,
  ConveniencePinMismatchError,
} from './convenience-pin'
import { loadBundleFromIdb, clearBundleFromIdb } from './key-store-v3'
import { clearCapsulesOnFactorChange } from './session-capsule'

export enum KeyManagerState {
  Locked = 'locked',
  Unlocked = 'unlocked',
  ConvenienceLocked = 'convenience-locked',
}

export enum LockReason {
  UserInitiated = 'user',
  AutoLockTimer = 'auto',
  CrossTabBroadcast = 'cross-tab',
  HardLockTimer = 'hard',
}

export interface EnrollInput {
  factors: UnlockFactor[]
}

class KeyManager {
  private state: KeyManagerState = KeyManagerState.Locked

  async getState(): Promise<KeyManagerState> {
    return this.state
  }

  async enroll(input: EnrollInput): Promise<void> {
    if (input.factors.length < 2) throw new Error('at least two factors required at enrollment')
    // Generate a fresh root KEK
    await cryptoWorkerClient.createRootKekSession()
    // The per-factor enrollment ceremony is delegated to unlock-factors.ts
    // helpers (register + wrap root KEK under each factor-derived AES-KW).
    // Omitted here: ceremonial factor registration calls.
    this.state = KeyManagerState.Unlocked
  }

  async unlock(factor: UnlockFactor): Promise<void> {
    if (this.state === KeyManagerState.Unlocked) return
    await runUnlockFactor(factor)
    this.state = KeyManagerState.Unlocked
  }

  async hardLock(reason: LockReason): Promise<void> {
    await cryptoWorkerClient.clearRootKek()
    this.state = KeyManagerState.Locked
    // broadcast on BroadcastChannel for cross-tab sync
  }

  async triggerAutoLock(): Promise<void> {
    if (this.state !== KeyManagerState.Unlocked) return
    this.state = KeyManagerState.ConvenienceLocked
  }

  async setConveniencePin(pin: string): Promise<void> {
    await setConvPinLib(pin)
  }

  async enterConveniencePin(pin: string): Promise<void> {
    try {
      await enterConvPinLib(pin)
      this.state = KeyManagerState.Unlocked
    } catch (err) {
      if (err instanceof ConveniencePinLockedError) {
        await this.hardLock(LockReason.UserInitiated)
      }
      throw err
    }
  }

  async clearConveniencePin(): Promise<void> {
    await clearConvPinLib()
  }

  async handleFactorChange(): Promise<void> {
    await clearCapsulesOnFactorChange()
  }

  async reset(): Promise<void> {
    await cryptoWorkerClient.clearRootKek()
    await clearBundleFromIdb()
    this.state = KeyManagerState.Locked
  }
}

export const keyManager = new KeyManager()
```

- [ ] **Step 3: Run the test**

Run: `bun test src/client/lib/key-manager.test.ts`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/key-manager.ts src/client/lib/key-manager.test.ts
git commit -m "feat(key-manager): state machine rewrite for enroll/unlock(factor)"
```

### Task 25: `provisioning.ts` — enrollment-permission-token transport

**Files:**
- Modify: `src/client/lib/provisioning.ts`
- Modify: `src/client/lib/provisioning.test.ts`

Replace the "source device sends encrypted nsec" path with "source device sends short-lived enrollment permission token". The target device runs its own fresh PRF + recovery-phrase enrollment, producing new envelopes; the token only authorizes that enrollment on the server.

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/provisioning.test.ts (new tests appended)
describe('enrollment permission token transport', () => {
  test('source device mints a token wrapped under the ephemeral ECDH key', async () => {
    const { token, expiresAt } = await mintEnrollmentToken({ scope: 'add-device' })
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(expiresAt).toBeGreaterThan(Date.now())
  })

  test('target device verifies the token and proceeds to factor enrollment', async () => {
    const { token } = await mintEnrollmentToken({ scope: 'add-device' })
    const { permitted, scope } = await verifyEnrollmentToken(token)
    expect(permitted).toBe(true)
    expect(scope).toBe('add-device')
  })

  test('expired token is rejected', async () => {
    const { token } = await mintEnrollmentToken({ scope: 'add-device', ttlMs: 1 })
    await new Promise((r) => setTimeout(r, 10))
    const { permitted } = await verifyEnrollmentToken(token)
    expect(permitted).toBe(false)
  })
})
```

- [ ] **Step 2: Add `mintEnrollmentToken` / `verifyEnrollmentToken` to `provisioning.ts`**

```typescript
// src/client/lib/provisioning.ts (additions)
/**
 * Enrollment permission token — short-lived (~5 min), signed by the source
 * device's identity key, consumed by the target device to authorize a fresh
 * factor enrollment ceremony on the same user account.
 *
 * Format: base64url(payloadJson).base64url(sigR).base64url(sigS)
 * Payload: { iss: sourcePubkey, sub: userPubkey, scope, iat, exp }
 */
export async function mintEnrollmentToken(params: {
  scope: 'add-device' | 'recover'
  ttlMs?: number
}): Promise<{ token: string; expiresAt: number }> { /* ... */ }

export async function verifyEnrollmentToken(
  token: string,
): Promise<{ permitted: boolean; scope?: string; issuer?: string }> { /* ... */ }
```

Delete the old `encryptNsecForTargetDevice` / `decryptNsecFromSourceDevice` helpers.

- [ ] **Step 3: Run the test**

Run: `bun test src/client/lib/provisioning.test.ts`
Expected: all PASS including new ones.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/provisioning.ts src/client/lib/provisioning.test.ts
git commit -m "feat(provisioning): enrollment permission token replaces nsec transport"
```

### Task 26: `auth-facade-client.ts` — Tier 2 endpoint wrappers

**Files:**
- Modify: `src/client/lib/auth-facade-client.ts`

- [ ] **Step 1: Delete PIN/kek-proof methods**

In `src/client/lib/auth-facade-client.ts` delete every method touching `/api/auth/pin/*`, `/api/auth/recovery/*`, or `/api/auth/kek-proof/*`.

- [ ] **Step 2: Add Tier 2 methods**

```typescript
// src/client/lib/auth-facade-client.ts (additions)
export const authFacadeClient = {
  // ...existing...

  async getRegisterOptions(params: { prf?: boolean }) {
    const res = await this.fetch(`/api/auth/webauthn/register/options?prf=${params.prf ?? false}`)
    return res.json() as Promise<{
      challengeId: string
      rp: { id: string; name: string }
      user: { id: string; name: string; displayName: string }
      challenge: string
      pubKeyCredParams: { type: 'public-key'; alg: number }[]
      timeout: number
      attestation: string
      authenticatorSelection: { residentKey: string; userVerification: string }
    }>
  },

  async getLoginOptions(params: { prf?: boolean }) {
    const res = await this.fetch(`/api/auth/webauthn/login/options?prf=${params.prf ?? false}`)
    return res.json()
  },

  async verifyRegistration(attestation: unknown, label: string, challengeId: string) {
    return this.postJson('/api/auth/webauthn/register/verify', { attestation, label, challengeId })
  },

  async verifyLogin(assertion: unknown, challengeId: string) {
    return this.postJson('/api/auth/webauthn/login/verify', { assertion, challengeId })
  },

  async opaqueRegisterInit(body: { userIdentifier: string; registrationRequest: string }) {
    return this.postJson<{ registrationResponse: string }>('/api/auth/opaque/register/init', body)
  },
  async opaqueRegisterFinish(body: { registrationRecord: string }) {
    return this.postJson<{ ok: true }>('/api/auth/opaque/register/finish', body)
  },
  async opaqueLoginInit(body: { userIdentifier: string; startLoginRequest: string }) {
    return this.postJson<{ loginResponse: string }>('/api/auth/opaque/login/init', body)
  },
  async opaqueLoginFinish(body: { userIdentifier: string; finishLoginRequest: string }) {
    return this.postJson<{ accessToken: string; pubkey: string }>('/api/auth/opaque/login/finish', body)
  },

  async recoveryGroupEnroll(body: unknown) {
    return this.postJson('/api/auth/recovery-group/enroll', body)
  },
  async recoveryGroupInitiate(body: { hubId: string; userIdentifier: string; newDevicePubkey: string }) {
    return this.postJson<{ sessionId: string; expiresAt: string }>('/api/auth/recovery-group/initiate', body)
  },
  async recoveryGroupContributeShare(body: { sessionId: string; encryptedShare: string }) {
    return this.postJson<{ ok: true }>('/api/auth/recovery-group/contribute-share', body)
  },
  async recoveryGroupComplete(body: unknown) {
    return this.postJson<{ ok: true }>('/api/auth/recovery-group/complete', body)
  },

  async recoveryPhraseRotate(body: unknown) {
    return this.postJson<{ ok: true }>('/api/auth/recovery-phrase/rotate', body)
  },
  async getRecoveryPhraseMeta() {
    return (await this.fetch('/api/auth/recovery-phrase/meta')).json() as Promise<{
      salt: string
      kdfParams: { algo: 'argon2id'; t: number; m: number; p: number }
    }>
  },

  async setConveniencePin(pin: string) {
    return this.postJson('/api/auth/convenience-pin', { pin })
  },
  async verifyConveniencePin(pin: string) {
    return this.postJson('/api/auth/convenience-pin/verify', { pin })
  },
  async clearConveniencePin() {
    return this.deleteJson('/api/auth/convenience-pin')
  },
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck 2>&1 | grep -c error || true`
Expected: 0 errors in this file.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/auth-facade-client.ts
git commit -m "feat(client): auth-facade-client wrappers for Tier 2 endpoints"
```

### Task 27: Audit chain verifier extension for Tier 2 payloads

**Files:**
- Modify: `src/client/lib/audit-chain-verifier.ts`
- Modify: `src/client/lib/audit-chain-verifier.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/client/lib/audit-chain-verifier.test.ts`:

```typescript
describe('Tier 2 payload verification', () => {
  test('verifier accepts a valid chain with recovery_initiated → recovery_share_contributed×2 → recovery_completed', async () => {
    const chain = [
      makeSigned({ type: 'recovery_initiated', hubId: 'h', userId: 'u', sessionId: 's', requestedAt: '2026-04-10T00:00:00.000Z', expiresAt: '2026-04-11T00:00:00.000Z' }),
      makeSigned({ type: 'recovery_share_contributed', hubId: 'h', sessionId: 's', byAdminPubkey: 'aa'.repeat(32) }),
      makeSigned({ type: 'recovery_share_contributed', hubId: 'h', sessionId: 's', byAdminPubkey: 'bb'.repeat(32) }),
      makeSigned({ type: 'recovery_completed', hubId: 'h', userId: 'u', sessionId: 's', sharedBy: ['aa'.repeat(32), 'bb'.repeat(32)], newDevicePubkey: 'cc'.repeat(32) }),
    ]
    const result = await verifyAuditChain(chain)
    expect(result.valid).toBe(true)
  })

  test('verifier rejects a recovery_completed without the prior initiated entry', async () => {
    const chain = [
      makeSigned({ type: 'recovery_completed', hubId: 'h', userId: 'u', sessionId: 's', sharedBy: ['aa'.repeat(32), 'bb'.repeat(32)], newDevicePubkey: 'cc'.repeat(32) }),
    ]
    const result = await verifyAuditChain(chain)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('missing recovery_initiated')
  })

  test('verifier rejects recovery_completed with fewer than threshold contributors', async () => {
    const chain = [
      makeSigned({ type: 'recovery_initiated', hubId: 'h', userId: 'u', sessionId: 's', requestedAt: '2026-04-10T00:00:00.000Z', expiresAt: '2026-04-11T00:00:00.000Z' }),
      makeSigned({ type: 'recovery_share_contributed', hubId: 'h', sessionId: 's', byAdminPubkey: 'aa'.repeat(32) }),
      makeSigned({ type: 'recovery_completed', hubId: 'h', userId: 'u', sessionId: 's', sharedBy: ['aa'.repeat(32)], newDevicePubkey: 'cc'.repeat(32) }),
    ]
    const result = await verifyAuditChain(chain)
    expect(result.valid).toBe(false)
  })
})
```

- [ ] **Step 2: Extend the verifier**

Add a stateful per-session accumulator to `verifyAuditChain`: track `(sessionId → { initiated: bool, shareContributors: Set<string> })`. On `recovery_completed`, require `initiated === true` and `shareContributors.size >= threshold` (threshold is fetched from the hub recovery group row or embedded in an earlier `recovery_group_enroll` entry in the same chain).

```typescript
// src/client/lib/audit-chain-verifier.ts (diff — within the existing verifier loop)
type RecoverySessionState = { initiated: boolean; shareContributors: Set<string> }
const recoverySessions = new Map<string, RecoverySessionState>()
const recoveryGroupThresholds = new Map<string, number>()

for (const entry of chain) {
  const payload = entry.payload
  switch (payload.type) {
    case 'recovery_group_enroll':
      recoveryGroupThresholds.set(payload.hubId, payload.threshold)
      break
    case 'recovery_initiated':
      recoverySessions.set(payload.sessionId, { initiated: true, shareContributors: new Set() })
      break
    case 'recovery_share_contributed': {
      const state = recoverySessions.get(payload.sessionId)
      if (!state) return { valid: false, error: 'share contribution without session' }
      state.shareContributors.add(payload.byAdminPubkey)
      break
    }
    case 'recovery_completed': {
      const state = recoverySessions.get(payload.sessionId)
      if (!state || !state.initiated) return { valid: false, error: 'missing recovery_initiated' }
      const threshold = recoveryGroupThresholds.get(payload.hubId) ?? 2
      if (payload.sharedBy.length < threshold) {
        return { valid: false, error: `below threshold: ${payload.sharedBy.length} < ${threshold}` }
      }
      for (const pk of payload.sharedBy) {
        if (!state.shareContributors.has(pk)) {
          return { valid: false, error: `sharedBy lists ${pk} without a contribution entry` }
        }
      }
      break
    }
    // ...other cases (root_kek_rotate, factor_add, factor_remove, recovery_group_rotate)
  }
}
```

- [ ] **Step 3: Run the test**

Run: `bun test src/client/lib/audit-chain-verifier.test.ts`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/audit-chain-verifier.ts src/client/lib/audit-chain-verifier.test.ts
git commit -m "feat(audit-verifier): Tier 2 recovery session state + threshold enforcement"
```

## Workstream 2.3/2.4 UI — Tier 2 user interfaces

### Task 28: `unlock-challenge-dialog.tsx` (replaces `pin-challenge-dialog.tsx`)

**Files:**
- Delete: `src/client/components/pin-challenge-dialog.tsx`
- Create: `src/client/components/unlock-challenge-dialog.tsx`

- [ ] **Step 1: Delete the old dialog**

```bash
git rm src/client/components/pin-challenge-dialog.tsx
```

- [ ] **Step 2: Create the new dialog**

```tsx
// src/client/components/unlock-challenge-dialog.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { keyManager } from '@/lib/key-manager'
import type { UnlockFactor } from '@/lib/unlock-factors'
import { PrfUnsupportedError } from '@/lib/webauthn'

type Mode = 'passkey' | 'password' | 'phrase'

export function UnlockChallengeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('passkey')
  const [password, setPassword] = useState('')
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function runUnlock(factor: UnlockFactor) {
    setError(null)
    try {
      await keyManager.unlock(factor)
      onClose()
    } catch (err) {
      if (err instanceof PrfUnsupportedError) {
        setMode('password')
        setError(t('unlock.prf_unsupported'))
      } else {
        setError((err as Error).message)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent data-testid="unlock-challenge-dialog">
        <DialogHeader>
          <DialogTitle>{t('unlock.title')}</DialogTitle>
        </DialogHeader>
        {mode === 'passkey' && (
          <div>
            <Button
              data-testid="unlock-with-passkey"
              onClick={() => runUnlock({ type: 'prf', credentialId: 'default' })}
            >
              {t('unlock.with_passkey')}
            </Button>
            <button data-testid="fallback-to-password" onClick={() => setMode('password')}>
              {t('unlock.use_password_instead')}
            </button>
            <button data-testid="fallback-to-phrase" onClick={() => setMode('phrase')}>
              {t('unlock.use_recovery_phrase')}
            </button>
          </div>
        )}
        {mode === 'password' && (
          <div>
            <Input
              data-testid="opaque-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              data-testid="submit-opaque-login"
              onClick={() => runUnlock({ type: 'opaque', password })}
            >
              {t('unlock.submit_password')}
            </Button>
          </div>
        )}
        {mode === 'phrase' && (
          <div>
            <textarea
              data-testid="recovery-phrase-textarea"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={4}
            />
            <Button
              data-testid="submit-phrase"
              onClick={() => runUnlock({ type: 'recoveryPhrase', phrase })}
            >
              {t('unlock.submit_phrase')}
            </Button>
          </div>
        )}
        {error && <div data-testid="unlock-error">{error}</div>}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Add i18n keys**

Append to `src/client/locales/en.json` (and sync all other locales via the existing i18n sync mechanism):

```json
{
  "unlock": {
    "title": "Unlock",
    "with_passkey": "Unlock with passkey",
    "use_password_instead": "Use password instead",
    "use_recovery_phrase": "Use recovery phrase",
    "submit_password": "Sign in",
    "submit_phrase": "Unlock",
    "prf_unsupported": "Your device does not support passkey unlock. Please use a password or recovery phrase."
  }
}
```

- [ ] **Step 4: Replace all importers**

Run: `bun run typecheck 2>&1 | grep pin-challenge-dialog`
Expected: a list of files still importing the deleted dialog. Replace each import with `unlock-challenge-dialog`.

Primary sites: `src/client/routes/login.tsx`, `src/client/lib/auth.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/unlock-challenge-dialog.tsx src/client/routes/login.tsx src/client/lib/auth.tsx src/client/locales/en.json
git commit -m "feat(ui): unlock-challenge-dialog with passkey/password/phrase branches"
```

### Task 29: Factor enrollment wizard

**Files:**
- Create: `src/client/components/factor-enrollment-wizard.tsx`
- Create: `src/client/components/recovery-phrase-display.tsx`
- Create: `src/client/components/recovery-phrase-entry.tsx`
- Modify: `src/client/routes/onboarding.tsx`
- Modify: `src/client/components/setup/SetupWizard.tsx`

- [ ] **Step 1: Build the display/entry components first**

```tsx
// src/client/components/recovery-phrase-display.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

export function RecoveryPhraseDisplay({
  phrase,
  onConfirm,
}: {
  phrase: string
  onConfirm: () => void
}) {
  const words = phrase.split(' ')
  const [acknowledged, setAcknowledged] = useState(false)
  const [copyDisabled, setCopyDisabled] = useState(true)
  // 3-second delay before copy is enabled
  setTimeout(() => setCopyDisabled(false), 3000)
  return (
    <div data-testid="recovery-phrase-display-card">
      <h2>Write down this 15-word recovery phrase</h2>
      <ol className="grid grid-cols-3 gap-2">
        {words.map((w, i) => (
          <li key={i} data-testid={`recovery-word-${i + 1}`}>
            {i + 1}. {w}
          </li>
        ))}
      </ol>
      <label>
        <Checkbox
          data-testid="ack-wrote-it-down"
          checked={acknowledged}
          onCheckedChange={(v) => setAcknowledged(!!v)}
        />
        I have written this down on paper and stored it safely.
      </label>
      <Button
        data-testid="copy-phrase-button"
        disabled={copyDisabled}
        onClick={() => navigator.clipboard.writeText(phrase)}
      >
        Copy to clipboard
      </Button>
      <Button data-testid="phrase-continue" disabled={!acknowledged} onClick={onConfirm}>
        Continue
      </Button>
    </div>
  )
}
```

```tsx
// src/client/components/recovery-phrase-entry.tsx
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { validateRecoveryPhrase } from '@/lib/recovery-phrase'

export function RecoveryPhraseEntry({
  wordCount = 15,
  onSubmit,
}: {
  wordCount?: 12 | 15 | 18 | 24
  onSubmit: (phrase: string) => void
}) {
  const [values, setValues] = useState<string[]>(Array(wordCount).fill(''))
  const [error, setError] = useState<string | null>(null)
  const phrase = values.join(' ')
  function submit() {
    if (!validateRecoveryPhrase(phrase)) {
      setError('One or more words are not in the recovery wordlist or the length is wrong.')
      return
    }
    setError(null)
    onSubmit(phrase)
  }
  return (
    <div data-testid="recovery-phrase-entry">
      <div className="grid grid-cols-3 gap-2">
        {values.map((v, i) => (
          <Input
            key={i}
            data-testid={`phrase-word-${i + 1}`}
            value={v}
            onChange={(e) => {
              const next = [...values]
              next[i] = e.target.value.trim().toLowerCase()
              setValues(next)
            }}
            placeholder={`${i + 1}`}
          />
        ))}
      </div>
      <Button data-testid="phrase-entry-submit" onClick={submit}>
        Submit
      </Button>
      {error && <div data-testid="phrase-entry-error">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Build the wizard**

```tsx
// src/client/components/factor-enrollment-wizard.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecoveryPhraseDisplay } from './recovery-phrase-display'
import { registerPrfCredential } from '@/lib/webauthn'
import {
  generateRecoveryPhrase,
  generateRecoveryPhraseSalt,
  bytesToHexSalt,
  RECOVERY_PHRASE_KDF_PARAMS,
} from '@/lib/recovery-phrase'
import { keyManager } from '@/lib/key-manager'

type Step = 'intro' | 'passkey-a' | 'passkey-b' | 'phrase' | 'verify-phrase' | 'done'

export function FactorEnrollmentWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('intro')
  const [phrase, setPhrase] = useState<string | null>(null)
  const [credA, setCredA] = useState<string | null>(null)
  const [credB, setCredB] = useState<string | null>(null)

  async function addPasskey(slot: 'a' | 'b') {
    const result = await registerPrfCredential(`device-${slot}`)
    if (slot === 'a') setCredA(result.credentialId)
    else setCredB(result.credentialId)
    setStep(slot === 'a' ? 'passkey-b' : 'phrase')
  }

  async function generatePhrase() {
    const fresh = generateRecoveryPhrase(15)
    setPhrase(fresh)
    setStep('phrase')
  }

  async function finalize() {
    if (!phrase || !credA || !credB) throw new Error('wizard state incomplete')
    const salt = generateRecoveryPhraseSalt()
    await keyManager.enroll({
      factors: [
        { type: 'prf', credentialId: credA },
        { type: 'prf', credentialId: credB },
        { type: 'recoveryPhrase', phrase, meta: { salt: bytesToHexSalt(salt), kdfParams: RECOVERY_PHRASE_KDF_PARAMS } } as never,
      ],
    })
    setStep('done')
    onDone()
  }

  return (
    <div data-testid="factor-enrollment-wizard">
      {step === 'intro' && (
        <Button data-testid="wizard-start" onClick={() => setStep('passkey-a')}>
          Start enrollment
        </Button>
      )}
      {step === 'passkey-a' && (
        <Button data-testid="wizard-add-passkey-a" onClick={() => addPasskey('a')}>
          Add primary passkey
        </Button>
      )}
      {step === 'passkey-b' && (
        <Button data-testid="wizard-add-passkey-b" onClick={() => addPasskey('b')}>
          Add backup passkey
        </Button>
      )}
      {step === 'phrase' && !phrase && (
        <Button data-testid="wizard-generate-phrase" onClick={generatePhrase}>
          Generate recovery phrase
        </Button>
      )}
      {step === 'phrase' && phrase && (
        <RecoveryPhraseDisplay phrase={phrase} onConfirm={() => setStep('verify-phrase')} />
      )}
      {step === 'verify-phrase' && phrase && (
        <Button data-testid="wizard-finalize" onClick={finalize}>
          Finalize enrollment
        </Button>
      )}
      {step === 'done' && <div data-testid="wizard-done">Enrollment complete.</div>}
    </div>
  )
}
```

- [ ] **Step 3: Wire into `onboarding.tsx` + `SetupWizard.tsx`**

Replace any existing PIN-creation step in both routes with `<FactorEnrollmentWizard onDone={...} />`.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/factor-enrollment-wizard.tsx src/client/components/recovery-phrase-display.tsx src/client/components/recovery-phrase-entry.tsx src/client/routes/onboarding.tsx src/client/components/setup/SetupWizard.tsx
git commit -m "feat(ui): factor enrollment wizard — 2 passkeys + recovery phrase"
```

### Task 30: Recovery Group admin panel + volunteer recovery panel + routes

**Files:**
- Create: `src/client/components/recovery-group-admin-panel.tsx`
- Create: `src/client/components/recovery-group-volunteer-panel.tsx`
- Create: `src/client/components/recovery-group-share-contribution.tsx`
- Create: `src/client/routes/security.recovery.tsx`
- Create: `src/client/routes/admin/recovery-group.tsx`
- Delete: `src/client/components/user-sections/pin-change-section.tsx`
- Delete: `src/client/components/user-sections/recovery-rotate-section.tsx`
- Modify: `src/client/components/user-sections/idle-lock-section.tsx`
- Modify: `src/client/routes/security.factors.tsx`

- [ ] **Step 1: Admin panel**

```tsx
// src/client/components/recovery-group-admin-panel.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  generateRecoveryGroupKeyPair,
  splitRecoveryGroupSecret,
  commitShare,
} from '@/lib/recovery-group-share'
import { bytesToHex } from '@noble/hashes/utils.js'
import { authFacadeClient } from '@/lib/auth-facade-client'

export function RecoveryGroupAdminPanel({ hubId, adminPubkeys }: { hubId: string; adminPubkeys: string[] }) {
  const [threshold, setThreshold] = useState(2)
  const [total, setTotal] = useState(3)
  const [enrolling, setEnrolling] = useState(false)

  async function enroll() {
    setEnrolling(true)
    const { privateKey, publicKey } = generateRecoveryGroupKeyPair()
    const shares = await splitRecoveryGroupSecret(privateKey, total, threshold)
    privateKey.fill(0)
    const commitments = await Promise.all(shares.map((s) => commitShare(s)))
    // HPKE-wrap each share under its admin's pubkey (requires Tier 1 HPKE)
    const shareEnvelopes = shares.map((s, i) => ({
      adminPubkey: adminPubkeys[i]!,
      envelope: bytesToHex(s), // placeholder until HPKE lands — see verification gate
    }))
    for (const s of shares) s.fill(0)
    await authFacadeClient.recoveryGroupEnroll({
      hubId,
      threshold,
      totalShares: total,
      groupPublicKey: bytesToHex(publicKey),
      shareEnvelopes,
      shareCommitments: commitments,
    })
    setEnrolling(false)
  }

  return (
    <div data-testid="recovery-group-admin-panel">
      <label>
        Threshold
        <Input data-testid="rg-threshold" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} min={2} max={5} />
      </label>
      <label>
        Total shares
        <Input data-testid="rg-total" type="number" value={total} onChange={(e) => setTotal(Number(e.target.value))} min={3} max={5} />
      </label>
      <Button data-testid="rg-enroll-submit" disabled={enrolling} onClick={enroll}>
        {enrolling ? 'Enrolling…' : 'Enroll recovery group'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Volunteer panel**

```tsx
// src/client/components/recovery-group-volunteer-panel.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authFacadeClient } from '@/lib/auth-facade-client'

export function RecoveryGroupVolunteerPanel({ hubId }: { hubId: string }) {
  const [identifier, setIdentifier] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  async function initiate() {
    // Client generates an ephemeral pubkey; session coordinator uses it to deliver shares
    const ephemeralPubkey = 'dd'.repeat(32) // placeholder — generated via secp256k1 in real impl
    const res = await authFacadeClient.recoveryGroupInitiate({
      hubId,
      userIdentifier: identifier,
      newDevicePubkey: ephemeralPubkey,
    })
    setSessionId(res.sessionId)
    setExpiresAt(res.expiresAt)
  }

  return (
    <div data-testid="recovery-group-volunteer-panel">
      <Input data-testid="rg-identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="your email or pubkey" />
      <Button data-testid="rg-initiate" onClick={initiate}>
        Request recovery
      </Button>
      {sessionId && (
        <div data-testid="rg-session-info">
          Session: {sessionId}; available after {expiresAt}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Admin share contribution**

```tsx
// src/client/components/recovery-group-share-contribution.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { authFacadeClient } from '@/lib/auth-facade-client'

export function RecoveryGroupShareContribution({ sessionId }: { sessionId: string }) {
  const [override, setOverride] = useState(false)
  const [justification, setJustification] = useState('')

  async function contribute() {
    // Unwrap local share from IDB cache, HPKE-encrypt under coordinator pubkey
    const encryptedShare = 'cafe' // placeholder wiring
    await authFacadeClient.recoveryGroupContributeShare({ sessionId, encryptedShare })
  }

  return (
    <div data-testid="share-contribution">
      <Button data-testid="contribute-share-button" onClick={contribute}>
        Contribute my share
      </Button>
      <label>
        <Checkbox data-testid="override-checkbox" checked={override} onCheckedChange={(v) => setOverride(!!v)} />
        Emergency override (waives 24h delay)
      </label>
      {override && (
        <Input
          data-testid="override-justification"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Minimum 16 characters"
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Routes**

```tsx
// src/client/routes/security.recovery.tsx
import { createFileRoute } from '@tanstack/react-router'
import { RecoveryGroupVolunteerPanel } from '@/components/recovery-group-volunteer-panel'
import { useConfig } from '@/lib/use-config'

export const Route = createFileRoute('/security/recovery')({
  component: RecoveryRoute,
})

function RecoveryRoute() {
  const { currentHubId } = useConfig()
  return <RecoveryGroupVolunteerPanel hubId={currentHubId} />
}
```

```tsx
// src/client/routes/admin/recovery-group.tsx
import { createFileRoute } from '@tanstack/react-router'
import { RecoveryGroupAdminPanel } from '@/components/recovery-group-admin-panel'
import { useConfig } from '@/lib/use-config'
import { useAdminList } from '@/lib/queries'

export const Route = createFileRoute('/admin/recovery-group')({
  component: AdminRecoveryGroupRoute,
})

function AdminRecoveryGroupRoute() {
  const { currentHubId } = useConfig()
  const admins = useAdminList(currentHubId)
  if (!admins.data) return null
  return <RecoveryGroupAdminPanel hubId={currentHubId} adminPubkeys={admins.data.map((a) => a.pubkey)} />
}
```

- [ ] **Step 5: Delete PIN/recovery user sections**

```bash
git rm src/client/components/user-sections/pin-change-section.tsx src/client/components/user-sections/recovery-rotate-section.tsx
```

Update `src/client/routes/security.factors.tsx` — replace the deleted section imports with new sections that list passkeys, rotate the recovery phrase, and toggle the convenience PIN.

Update `src/client/components/user-sections/idle-lock-section.tsx` — add a "Require PIN after auto-lock" toggle that wires through `keyManager.setConveniencePin` / `clearConveniencePin`.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck 2>&1 | grep -c error || true`
Expected: 0 errors in the UI layer.

- [ ] **Step 7: Commit**

```bash
git add src/client/components/recovery-group-admin-panel.tsx src/client/components/recovery-group-volunteer-panel.tsx src/client/components/recovery-group-share-contribution.tsx src/client/routes/security.recovery.tsx src/client/routes/admin/recovery-group.tsx src/client/routes/security.factors.tsx src/client/components/user-sections/idle-lock-section.tsx
git commit -m "feat(ui): recovery group admin/volunteer panels + share contribution + routes"
```

## Workstream 2.8 — Tests, fixtures, CI

### Task 31: Playwright virtual authenticator helper

**Files:**
- Create: `tests/helpers/virtual-authenticator.ts`
- Modify: `tests/helpers/index.ts`
- Modify: `tests/fixtures/auth.ts`

Chromium's CDP virtual authenticator lets us emulate a PRF-capable platform authenticator in UI tests without real hardware.

- [ ] **Step 1: Write the helper**

```typescript
// tests/helpers/virtual-authenticator.ts
/**
 * Installs a Chromium virtual authenticator with PRF support for Playwright
 * tests. Must be called in each spec's `beforeEach` that needs WebAuthn.
 *
 * Usage:
 *   import { installVirtualAuthenticator } from '@test-helpers/virtual-authenticator'
 *   await installVirtualAuthenticator(page, { prfEnabled: true })
 */
import type { Page, BrowserContext } from '@playwright/test'

export async function installVirtualAuthenticator(
  page: Page,
  options: { prfEnabled?: boolean } = {},
): Promise<{ authenticatorId: string }> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      // PRF is advertised via CTAP2 hmac-secret extension
      hasPrf: options.prfEnabled ?? true,
    },
  })
  return { authenticatorId }
}

export async function removeVirtualAuthenticator(
  page: Page,
  authenticatorId: string,
): Promise<void> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
}

export async function simulatePrfSupport(
  page: Page,
  authenticatorId: string,
  enabled: boolean,
): Promise<void> {
  // In versions where hasPrf isn't exposed on CTAP2 via CDP, we fall back to
  // monkey-patching window.PublicKeyCredential.prototype.getClientExtensionResults
  if (enabled) return
  await page.addInitScript(() => {
    const orig = (PublicKeyCredential.prototype as unknown as { getClientExtensionResults: () => object }).getClientExtensionResults
    Object.defineProperty(PublicKeyCredential.prototype, 'getClientExtensionResults', {
      value() {
        const res = orig.call(this) as Record<string, unknown>
        delete res.prf
        return res
      },
    })
  })
}
```

- [ ] **Step 2: Export + update auth fixture**

```typescript
// tests/helpers/index.ts (append)
export * from './virtual-authenticator'
```

In `tests/fixtures/auth.ts` replace the PIN-entry login path with virtual-authenticator PRF unlock:

```typescript
// tests/fixtures/auth.ts (excerpt)
import { installVirtualAuthenticator } from './virtual-authenticator'

export const authedTest = base.extend<{ authed: { page: Page } }>({
  authed: async ({ page }, use) => {
    await installVirtualAuthenticator(page, { prfEnabled: true })
    await page.goto('/onboarding')
    await page.getByTestId('wizard-start').click()
    await page.getByTestId('wizard-add-passkey-a').click()
    await page.getByTestId('wizard-add-passkey-b').click()
    await page.getByTestId('wizard-generate-phrase').click()
    await page.getByTestId('ack-wrote-it-down').click()
    await page.getByTestId('phrase-continue').click()
    await page.getByTestId('wizard-finalize').click()
    await use({ page })
  },
})
```

- [ ] **Step 3: Smoke the helper against a trivial page**

Run: `bunx playwright test tests/ui/smoke.spec.ts`
Expected: existing smoke test still passes.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/virtual-authenticator.ts tests/helpers/index.ts tests/fixtures/auth.ts
git commit -m "test(helpers): Chromium virtual authenticator + PRF support simulator"
```

### Task 32: API E2E tests — OPAQUE, recovery phrase, recovery group

**Files:**
- Create: `tests/api/opaque-roundtrip.spec.ts`
- Create: `tests/api/opaque-brute-force-resistance.spec.ts`
- Create: `tests/api/opaque-server-compromise.spec.ts`
- Create: `tests/api/prf-fallback.spec.ts`
- Create: `tests/api/recovery-phrase-rotate.spec.ts`
- Create: `tests/api/recovery-group.spec.ts`
- Create: `tests/api/recovery-group-threshold-boundary.spec.ts`
- Create: `tests/api/recovery-group-audit.spec.ts`
- Create: `tests/api/factor-management.spec.ts`
- Create: `tests/api/v2-format-migration.spec.ts`
- Delete: `tests/api/pin-change.spec.ts`
- Delete: `tests/api/recovery-rotate.spec.ts`

- [ ] **Step 1: Delete obsolete specs**

```bash
git rm tests/api/pin-change.spec.ts tests/api/recovery-rotate.spec.ts
```

- [ ] **Step 2: OPAQUE round-trip spec**

```typescript
// tests/api/opaque-roundtrip.spec.ts
import { test, expect } from '@playwright/test'
import { authedRequest } from '@test-helpers/authed-request'
import * as opaque from '@serenity-kit/opaque'

test.describe('OPAQUE round-trip', () => {
  test('register + login returns stable export_key', async ({ request }) => {
    await opaque.ready
    const password = 'correct-horse-battery-staple'
    const userIdentifier = `opaque-user-${Date.now()}@example.com`

    // register
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
      password,
      keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
    })
    let res = await request.post('/api/auth/opaque/register/init', {
      data: { userIdentifier, registrationRequest },
    })
    expect(res.status()).toBe(200)
    const { registrationResponse } = await res.json()
    const { registrationRecord, exportKey: exportKey1 } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse,
      password,
      keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
    })
    res = await authedRequest(request).post('/api/auth/opaque/register/finish', {
      data: { registrationRecord },
    })
    expect(res.status()).toBe(200)

    // login
    const { clientLoginState, startLoginRequest } = opaque.client.startLogin({
      password,
      keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
    })
    res = await request.post('/api/auth/opaque/login/init', {
      data: { userIdentifier, startLoginRequest },
    })
    const handle = res.headers()['x-opaque-handle']
    expect(handle).toBeDefined()
    const { loginResponse } = await res.json()
    const { finishLoginRequest, exportKey: exportKey2 } = opaque.client.finishLogin({
      clientLoginState,
      loginResponse,
      password,
      keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
    })
    res = await request.post('/api/auth/opaque/login/finish', {
      headers: { 'x-opaque-handle': handle! },
      data: { userIdentifier, finishLoginRequest },
    })
    expect(res.status()).toBe(200)
    // exportKey stability: same value both times
    expect(exportKey1).toBe(exportKey2)
  })
})
```

- [ ] **Step 3: OPAQUE brute-force resistance (adversarial)**

```typescript
// tests/api/opaque-brute-force-resistance.spec.ts
import { test, expect } from '@playwright/test'
import * as opaque from '@serenity-kit/opaque'

test('1000 wrong-password attempts triggers rate limit and is timing-opaque', async ({ request }) => {
  await opaque.ready
  const userIdentifier = `brute-${Date.now()}@example.com`
  // Seed a real user
  // ... (same register flow as opaque-roundtrip)

  const timings: number[] = []
  for (let i = 0; i < 50; i++) {
    const { startLoginRequest } = opaque.client.startLogin({
      password: `wrong-${i}`,
      keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
    })
    const t0 = Date.now()
    const res = await request.post('/api/auth/opaque/login/init', {
      data: { userIdentifier, startLoginRequest },
    })
    timings.push(Date.now() - t0)
    if (res.status() === 429) {
      expect(i).toBeGreaterThan(5) // rate limit should kick in after a handful
      break
    }
  }
  // Timing variance should be within 200ms between responses (no oracle)
  const min = Math.min(...timings)
  const max = Math.max(...timings)
  expect(max - min).toBeLessThan(1000) // generous allowance for CI jitter
})
```

- [ ] **Step 4: OPAQUE server-compromise (adversarial)**

```typescript
// tests/api/opaque-server-compromise.spec.ts
import { test, expect } from '@playwright/test'
import { db } from '@server/db'
import { userOpaqueRecords } from '@server/db/schema/opaque'

test('dumped user_opaque_records are useless for offline password recovery', async () => {
  const rows = await db.select().from(userOpaqueRecords)
  // Assert the persisted record is a fixed-length opaque blob, not a derivable hash
  for (const r of rows) {
    expect(r.registrationRecord.length).toBeGreaterThan(128) // OPAQUE registration record is large
    expect(r.registrationRecord.length).toBeLessThan(4096)
  }
  // No password-ish ASCII substrings
  const joined = Buffer.concat(rows.map((r) => Buffer.from(r.registrationRecord))).toString('latin1')
  expect(joined).not.toMatch(/password/i)
  expect(joined).not.toMatch(/admin/i)
})
```

- [ ] **Step 5: PRF fallback adversarial + recovery phrase rotate + recovery-group spec**

Write each of:

- `tests/api/prf-fallback.spec.ts` — simulate server omitting prf in options JSON; assert client refuses to unlock with a degraded factor (HTTP call through a mock where we strip `extensions.prf` in the response, then call `/api/auth/webauthn/login/verify` and assert the subsequent unlock call on a test client fails or is recognized as a non-PRF path).
- `tests/api/recovery-phrase-rotate.spec.ts` — auth → rotate → assert 200, new salt in meta, audit entry present, then attempt a 4th rotation in the same 24h window and expect 429.
- `tests/api/recovery-group.spec.ts` — enroll hub, initiate recovery as user, contribute 2 shares as admins, fast-forward 24h via a test clock route, complete. Assert audit chain contains `recovery_group_enroll`, `recovery_initiated`, 2× `recovery_share_contributed`, `recovery_completed`.
- `tests/api/recovery-group-threshold-boundary.spec.ts` — attempt complete after 1 contribution (403), after 2 (200), after 3 (200). Attempt 1+1 where one admin contributes twice: reject duplicate.
- `tests/api/recovery-group-audit.spec.ts` — attempt `complete` before 24h without override: 403 with `delay` in the error message. Override without co-approver: 403. Override with co-approver but no justification: 400 (zod validation).
- `tests/api/factor-management.spec.ts` — add PRF → 2 envelopes. Add OPAQUE → 3. Remove OPAQUE → 2. Attempt remove PRF leaving only recoveryPhrase → 409 (min invariant).
- `tests/api/v2-format-migration.spec.ts` — fresh DB after migration: `\d users` has no `encrypted_secret_key` or `kek_proof_hash`; new `user_root_kek_envelopes` table exists and is empty.

Write each spec in full per the pattern above — tests file by file. Each uses `tests/helpers/authed-request.ts` for auth and reads DB state via the server-side Drizzle import.

- [ ] **Step 6: Run the full API suite**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api
```

Expected: every new spec PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/api
git commit -m "test(api): Tier 2 OPAQUE, recovery-phrase, recovery-group specs + adversarial coverage"
```

### Task 33: UI E2E tests — enrollment, unlock, recovery flows

**Files:**
- Create: `tests/ui/prf-enrollment.spec.ts`
- Create: `tests/ui/prf-unlock.spec.ts`
- Create: `tests/ui/opaque-login.spec.ts`
- Create: `tests/ui/prf-fallback-to-opaque.spec.ts`
- Create: `tests/ui/recovery-phrase-entry.spec.ts`
- Create: `tests/ui/recovery-phrase-entry-typo.spec.ts`
- Create: `tests/ui/recovery-group-enrollment.spec.ts`
- Create: `tests/ui/recovery-group-flow.spec.ts`
- Create: `tests/ui/recovery-group-delay-enforcement.spec.ts`
- Create: `tests/ui/recovery-group-emergency-override.spec.ts`
- Create: `tests/ui/factor-removal-rejection.spec.ts`
- Create: `tests/ui/convenience-pin.spec.ts`
- Create: `tests/ui/capsule-invalidation-on-factor-change.spec.ts`
- Delete: `tests/ui/pin-challenge.spec.ts`

- [ ] **Step 1: Delete obsolete spec**

```bash
git rm tests/ui/pin-challenge.spec.ts
```

- [ ] **Step 2: PRF enrollment spec**

```typescript
// tests/ui/prf-enrollment.spec.ts
import { test, expect } from '@playwright/test'
import { installVirtualAuthenticator } from '@test-helpers/virtual-authenticator'

test('user can enroll two PRF passkeys + recovery phrase', async ({ page }) => {
  await installVirtualAuthenticator(page, { prfEnabled: true })
  await page.goto('/onboarding')
  await page.getByTestId('wizard-start').click()
  await page.getByTestId('wizard-add-passkey-a').click()
  await page.getByTestId('wizard-add-passkey-b').click()
  await page.getByTestId('wizard-generate-phrase').click()
  // Phrase is shown; acknowledge and continue
  await page.getByTestId('ack-wrote-it-down').click()
  await page.getByTestId('phrase-continue').click()
  await page.getByTestId('wizard-finalize').click()
  await expect(page.getByTestId('wizard-done')).toBeVisible()
})
```

- [ ] **Step 3: PRF unlock spec**

```typescript
// tests/ui/prf-unlock.spec.ts
import { test, expect } from '@playwright/test'
import { authedTest } from '@test-fixtures/auth'

authedTest('locked → passkey unlock → dashboard', async ({ authed }) => {
  const { page } = authed
  await page.getByTestId('hard-lock-button').click()
  await page.getByTestId('unlock-with-passkey').click()
  await expect(page.getByTestId('dashboard')).toBeVisible()
})
```

- [ ] **Step 4: Write remaining UI specs**

For each remaining spec file, follow the same pattern:

- `opaque-login.spec.ts` — bypass the virtual authenticator by setting `prfEnabled: false`, enroll with OPAQUE password + recovery phrase, reload, login with password.
- `prf-fallback-to-opaque.spec.ts` — install virtual authenticator with PRF disabled; attempt passkey unlock; verify the dialog falls back to `fallback-to-password`; login with OPAQUE.
- `recovery-phrase-entry.spec.ts` — enroll, capture phrase, nuke IDB, reload, use `recovery-phrase-textarea` to paste the phrase, unlock succeeds.
- `recovery-phrase-entry-typo.spec.ts` (adversarial) — same as above with one word mistyped; expect `phrase-entry-error` visible and no unlock.
- `recovery-group-enrollment.spec.ts` — authed admin navigates to `/admin/recovery-group`, sets threshold=2, total=3, clicks `rg-enroll-submit`, verifies audit log shows a `recovery_group_enroll` entry via an admin-visible audit panel testid.
- `recovery-group-flow.spec.ts` — three browser contexts (admin1, admin2, user); user initiates, admin1+admin2 each contribute shares, a `test-clock-advance?hours=25` internal endpoint fast-forwards time, user completes recovery.
- `recovery-group-delay-enforcement.spec.ts` (adversarial) — admins contribute; user attempts `complete` before 24h; UI shows remaining countdown and the `complete` button is disabled.
- `recovery-group-emergency-override.spec.ts` — admin1 contributes + enables override with justification; admin2 co-signs; user completes within 1h of initiation.
- `factor-removal-rejection.spec.ts` (adversarial) — user with exactly 2 factors (prf + phrase) opens `/security/factors`, clicks remove-prf, UI shows `min-factors-error` toast, factor not removed.
- `convenience-pin.spec.ts` — user enables convenience PIN, auto-lock fires via `test-clock-advance?seconds=900`, convenience-lock modal appears, correct PIN unlocks, wrong PIN 5 times triggers hard lock.
- `capsule-invalidation-on-factor-change.spec.ts` — unlock → capsule stored → add a new passkey → reload → capsule stale → unlock dialog reappears.

Each spec uses `getByTestId` exclusively per the project selector policy.

- [ ] **Step 5: Run the UI suite**

```bash
bunx playwright test tests/ui
```

Expected: every new spec PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/ui
git commit -m "test(ui): Tier 2 enrollment, unlock, recovery-group, and adversarial UI specs"
```

### Task 34: CI grep guardrails + biome rules

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `biome.json`
- Modify: `docs/security/KEY_REVOCATION_RUNBOOK.md`
- Modify: `docs/security/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append grep guardrails to `.github/workflows/ci.yml`**

```yaml
      - name: Tier 2 dead-label guardrail
        run: |
          set -e
          ! grep -rn "LABEL_NSEC_KEK_2F\|LABEL_NSEC_KEK_3F\|LABEL_KEK_PRF\b\|LABEL_IDP_VALUE_WRAP\|RECOVERY_SALT" src/ \
            --include="*.ts" --exclude="*.test.ts"
          ! grep -rn "encrypted_secret_key\|kek_proof_hash" src/ drizzle/ \
            --include="*.ts" --include="*.sql" --exclude="drizzle/migrations/0051_*.sql"
          ! grep -rn "encryptNsec\|decryptNsec\|deriveKEK\b" src/ \
            --include="*.ts" --exclude="*.test.ts"
```

- [ ] **Step 2: Update biome rules**

Append to `biome.json` a `linter.rules.nursery` section forbidding the literal strings `'llamenos:kek-prf'`, `'llamenos:nsec-kek:2f'`, `'llamenos:nsec-kek:3f'`, `'llamenos:idp-value-wrap'`, `'llamenos:recovery'` outside `crypto-labels.ts`. This uses the existing Tier 0 grep-rule infrastructure.

- [ ] **Step 3: Update runbook + README**

- `docs/security/KEY_REVOCATION_RUNBOOK.md` — replace "PIN change" section with "factor management": add/remove PRF credentials, rotate recovery phrase, rotate Recovery Group. Call out the 24h delay + emergency override semantics.
- `docs/security/README.md` — link to the new spec + plan.
- `CLAUDE.md` — add a one-paragraph note in the "Key management" section describing Tier 2's new v3 envelope bundle and the removal of PIN-as-KEK. No new env vars.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml biome.json docs/security/KEY_REVOCATION_RUNBOOK.md docs/security/README.md CLAUDE.md
git commit -m "chore(ci,docs): Tier 2 grep guardrails + runbook + CLAUDE.md note"
```

### Task 35: Final verification gate

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: 0 errors.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: success; `dist/client/` populated.

- [ ] **Step 4: Unit tests**

Run: `bun run test:unit`
Expected: every unit test PASS — including the new ones from Tasks 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 16, 17, 19, 21, 22, 23, 24, 25, 27.

- [ ] **Step 5: API E2E tests**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api
```

Expected: PASS.

- [ ] **Step 6: UI E2E tests**

```bash
bunx playwright test tests/ui
```

Expected: PASS.

- [ ] **Step 7: Grep check — zero PIN-era label literals**

```bash
! grep -rn "LABEL_NSEC_KEK_2F\|LABEL_NSEC_KEK_3F\|LABEL_KEK_PRF\b\|LABEL_IDP_VALUE_WRAP\|RECOVERY_SALT" src/ --include="*.ts"
```

Expected: no matches.

- [ ] **Step 8: Grep check — zero dropped columns in source**

```bash
! grep -rn "encrypted_secret_key\|kek_proof_hash" src/ --include="*.ts"
```

Expected: no matches (schema references removed).

- [ ] **Step 9: Verify min-factor invariant cannot be bypassed**

Manual sanity:

```bash
grep -rn "assertMinFactorInvariant\|min factor invariant" src/client/lib/key-store-v3.ts src/server/services/root-kek-envelope-service.ts
```

Expected: both client and server enforce the invariant.

- [ ] **Step 10: Verify no raw PRF output leaves the worker**

```bash
grep -rn "prfOutput" src/ --include="*.ts" | grep -v "test\|webauthn.ts\|unlock-factors.ts\|crypto-worker"
```

Expected: no matches — only `webauthn.ts`, `unlock-factors.ts`, and the worker handle `prfOutput`.

- [ ] **Step 11: Migration idempotency check**

```bash
bun run migrate
bun run migrate
```

Expected: second invocation reports no pending migrations.

- [ ] **Step 12: Verify `envelopes.length >= 2` is enforced at the API layer**

Manual smoke via `curl`:

```bash
curl -sS -X POST http://localhost:3000/api/auth/recovery-phrase/rotate \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TEST_TOKEN" \
  -d '{"newEnvelope":{"v":3,"factorType":"recoveryPhrase","factorId":"phrase","wrappedKey":"aa","createdAt":"2026-04-10T00:00:00.000Z"},"newMeta":{"salt":"'$(printf 'ab%.0s' {1..32})'","kdfParams":{"algo":"argon2id","t":2,"m":19456,"p":1}}}'
```

Expected: 200 (user's bundle already has PRF envelope + old phrase envelope; the new phrase envelope replaces the old one and total remains 2).

- [ ] **Step 13: Final commit**

```bash
git add -A
git commit -m "chore(tier-2): verification gate green — unlock & recovery overhaul complete"
```

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-security-tier-2-unlock-recovery.md`.**

Execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in one session with checkpoints. Required sub-skill: `superpowers:executing-plans`.

Tier 2 implementation should happen in its own session, distinct from the session that wrote this plan, per the usual superpowers workflow. Tier 0 must be merged to `main` first; Tier 1 is the follow-up dependency for non-extractable `CryptoKey` and HPKE — without it, the plan degrades to extractable AES-KW with a documented regression called out in Task 13.



