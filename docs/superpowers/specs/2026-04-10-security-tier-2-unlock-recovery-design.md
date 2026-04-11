# Security Tier 2 — Unlock & Recovery Overhaul

**Date:** 2026-04-10
**Status:** Draft
**Branch:** `feat/sec-tier-2-unlock-recovery`
**Branch base:** `feat/sec-tier-0-albrecht-hardening` (which is itself based on post-PR #50 `main`)
**Brief:** [`docs/security/spec-briefs/tier-2-unlock-recovery.md`](../../security/spec-briefs/tier-2-unlock-recovery.md)
**Master doc:** [`docs/security/SECURITY_IMPROVEMENTS_MASTER.md`](../../security/SECURITY_IMPROVEMENTS_MASTER.md) §1.2 Gap 2, §3.4 (Bitwarden/1Password), §3.9.2 (PRF), §3.9.4 (OPAQUE), §6.2 (sigchain), §6.5 (KEK hierarchy), §7 Tier 2, §9 cross-cutting principles
**Depends on:** Tier 0 (Albrecht Hardening) lands first — provides `CryptoLabel` brand, `EnvelopeV2`, AAD-required AEAD, and typed signed audit entries. Tier 1 (HPKE + Primitives) lands next — provides non-extractable `CryptoKey` handles, native X25519/Ed25519, HPKE suites, and the Standard Notes `items_key` indirection.

## Problem

The current Llamenos KEK derivation, implemented in `src/client/lib/key-store-v2.ts` (v2 format), has a fundamental design weakness that no amount of factor-stacking can fix: **the primary user input is a 6–8 digit PIN, and the rest of the KEK stack cannot stop an adversary from brute-forcing that PIN offline once they have the encrypted blob**. The in-file comment documents the chain: `PIN → PBKDF2-SHA256 (600k iterations, 32-byte salt) → 32-byte pin-derived; [pin-derived ‖ prfOutput? ‖ idpValue] → HKDF-SHA256 → 32-byte KEK → XChaCha20-Poly1305(nsec)`. On paper it looks layered. In practice:

1. **The PIN is ~14–20 bits of real entropy.** At 6 decimal digits, that is 10^6 ≈ 20 bits; at 8 digits, 10^8 ≈ 26.6 bits; with realistic PIN-choice bias (birthdays, repeats), effective entropy collapses to ~14–17 bits. 600k PBKDF2-SHA256 iterations costs roughly one millisecond per guess on a single modern GPU. A 6-digit PIN is exhaustively searchable in minutes.
2. **The 2-factor fallback runs if WebAuthn PRF is not present.** In `deriveKEK()` (line 81 of key-store-v2.ts), the ternary `factors.prfOutput ? ... : ...` falls through to PIN + IdP-value only. The IdP value is deterministic per user account and — under the current auth facade — reachable by any actor that controls the server or intercepts a session, because it is fetched on unlock via `authFacadeClient.getUserInfo()` (key-manager.ts line 371). A server compromise that also leaks the stored IDB blob recovers the nsec in minutes.
3. **The 3-factor mode is not the default everyone runs.** Users with iOS Safari + YubiKey, Firefox pre-148, Safari-on-mac without iCloud-Passkey-PRF, and many Linux+FIDO2 combinations never enter the 3-factor branch because `navigator.credentials.get({extensions:{prf:…}})` returns without a PRF output. `requestWebAuthnPRF()` catches the failure silently and returns `null`, and `deriveKEK` then runs the 2-factor branch.
4. **The IdP value is itself brittle.** It is pulled from Authentik through `auth-facade.ts` and envelope-wrapped with `LABEL_IDP_VALUE_WRAP`. A rotation of the IdP value (which happens after certain reset flows) requires re-wrapping the blob; the rotation handshake is implemented in `key-manager.ts#handleRotation`, but the underlying primitive — "the server hands you your IdP value if you ask nicely with a valid session" — cannot be tightened to passwordless strength.
5. **OPAQUE is absent.** Authentik's password flow is used behind the auth facade for non-passkey users, which means the server has the opportunity to observe password material during login. Under the current design, a server compromise can mount an offline dictionary attack against the user's master secret. RFC 9807 OPAQUE was designed exactly to remove this capability.
6. **Recovery is a single-user-held secret.** Today's "recovery key" is a Base32 128-bit token generated and shown once in `src/client/lib/backup.ts`. Losing it without losing the PIN means the user can still unlock; losing the PIN without losing the recovery key means the user can unwrap with the recovery key. Losing both means data loss. There is **no admin-assisted recovery** pathway that preserves E2EE — if all factors are lost, the data is gone forever. For a crisis hotline with volunteer turnover and lost devices, this is a known operational pain point.
7. **Cross-device linking uses an ephemeral ECDH provisioning room.** That is fine as a one-shot transport, but it routes device linking through a centrally-hosted Nostr relay; it does not give us a durable "Carol lost her phone, Alice and Bob can coordinate a new device" recovery path.

**The overhaul.** Tier 2 replaces every component above with a modern, passwordless-first KEK hierarchy:

1. **WebAuthn PRF (RFC / WebAuthn L3 §10.1.4 `prf` extension)** becomes the *primary* KEK source. The PIN stops being a KEK factor. The authenticator holds a per-credential 32-byte seed (CTAP2 `hmac-secret`), returns `HMAC(seed, LABEL_PRF_KEK_SALT_V1)` on assertion, and we HKDF that into a non-extractable AES-KW key (Tier 1 prerequisite) that unwraps the at-rest root KEK envelope.
2. **OPAQUE (RFC 9807)**, via the `@serenity-kit/opaque` WASM build of `facebook/opaque-ke`, provides the password-login path for devices that cannot use PRF. The server never sees password material; the client gets a stable `export_key` that becomes a second KEK-unwrapping route.
3. **Diceware recovery phrase** replaces the one-shot 128-bit recovery Base32 and the 6-digit PIN in their KEK roles. At enrollment the client generates a 15-word phrase from the EFF large wordlist (≈194 bits of entropy), runs Argon2id(m=47 MiB, t=1, p=1) over it, and HKDFs into a second unwrapping key. This is the "type it on a new device" fallback.
4. **1Password-style Recovery Group** with 2-of-3 Shamir-shared private key provides the admin-assisted recovery pathway. The server orchestrates but never sees plaintext key material, and every recovery operation is signed into the Tier 0 audit sigchain with audit entries the volunteer can see after the fact.
5. **PIN is either retired or demoted** to a convenience re-lock factor that re-prompts after auto-lock within the same unlocked session. It is no longer part of the KEK chain. A compromised PIN cannot decrypt the at-rest blob because the KEK is no longer derived from it.
6. **Session capsule (PR #50) and the lock/unlock state machine** continue to own "fast-path restore within a session" — the capsule stores a worker-encrypted nsec blob keyed by a sessionStorage token, decrypted on reload without re-running any of the unlock factors. This is an orthogonal cache layer and does not change in Tier 2 except for the added restriction that capsules are wiped on a credential-set change (adding or removing a passkey, rotating OPAQUE password, rotating the recovery phrase).

**No backward-compatibility shim.** Pre-production gives us the freedom to wipe all existing v2 encrypted-key blobs on migration. The v2 format is deleted, a new `v3` format is introduced, and the migration path for development / test environments is: log out, re-enroll. No code reads the v2 format after this tier lands.

### Concrete gaps identified during exploration

During exploration of the current worktree I identified the following specific artifacts that must change:

1. **`src/client/lib/key-store-v2.ts` (303 lines)** — the entire file is replaced by `key-store-v3.ts` with a new on-disk shape. `deriveKEK`, `encryptNsec`, `decryptNsec`, `EncryptedKeyDataV2`, `rewrapWithNewPin`, `rewrapWithNewRecoveryKey` all go away. The new primitives derive per-credential wrapping keys from PRF outputs, OPAQUE export keys, and Argon2id(recovery phrase), then unwrap a **root-KEK envelope** under any one of them.
2. **`src/client/lib/key-manager.ts` (582 lines)** — `unlock(pin)` becomes `unlock(factor)` where `factor` is a tagged union `{ type: 'prf'; credentialId: string } | { type: 'opaque'; password: string } | { type: 'recoveryPhrase'; phrase: string } | { type: 'recoveryGroup'; sharedSecretHex: string }`. `importKey(nsecHex, pin, ...)` becomes `enroll({ nsecHex, factors })` where `factors` is a `NewFactorsInput` describing which credentials to register at onboarding (minimum two). `handleRotation` and `rotateSyntheticToReal` are replaced by `handleFactorChange` which re-wraps the root KEK under the new factor set.
3. **`src/client/lib/backup.ts` (252 lines)** — replaced by `recovery-phrase.ts` + `recovery-group-share.ts`. The old Base32 recovery key format is deleted. The new backup file exports a *signed* recovery envelope for emergency off-device storage but does not require any PIN/Base32 input.
4. **`src/client/lib/webauthn.ts` (109 lines)** — `requestWebAuthnPRF()` is replaced by `requestPrfFromCredential(credentialId)` which runs `navigator.credentials.get` with PRF enabled and returns the raw 32-byte output. New `registerPrfCredential(label)` wraps `navigator.credentials.create` with PRF enabled on-create and verifies `extensionResults.prf.enabled === true`. Credentials where PRF is not enabled are refused.
5. **`src/server/routes/auth-facade.ts` (1372 lines)** — adds a new set of `/api/auth/opaque/*` endpoints (register-init, register-finish, login-init, login-finish), a new `/api/auth/recovery-group/*` endpoint family (enroll, initiate, complete), a new `/api/auth/recovery-phrase/rotate` endpoint, and deletes the `/api/auth/pin/*`, `/api/auth/recovery/*` endpoints (all of which assume PIN-as-KEK-factor).
6. **`src/server/lib/webauthn.ts` (94 lines)** — `generateRegOptions` and `generateAuthOptions` need the `prf` extension threaded through them. Because SimpleWebAuthn server handles the top-level WebAuthn verification but does not interpret PRF, the PRF extension output stays in `clientExtensionResults` on the client side and is never sent to the server — this is *by design*: the server must not see PRF outputs.
7. **`src/server/idp/authentik-adapter.ts`** — continues to handle OIDC SSO, which is orthogonal. OPAQUE does **not** replace Authentik: it replaces the *local password* path for org users who log in directly to Llamenos with a password instead of SSO. The auth facade's decision tree picks between OPAQUE (local password), Authentik (OIDC), and WebAuthn (passkey).
8. **`src/server/db/schema/identity.ts` (82 lines)** — needs new tables `user_opaque_records` (per-user OPAQUE registration envelope), `user_recovery_phrase_meta` (per-user salt + KDF params for the recovery phrase wrapping factor), `hub_recovery_groups` (per-hub Recovery Group public key + Shamir share commitments), `user_recovery_envelopes` (per-user root KEK envelope wrapped under a hub's Recovery Group public key), `recovery_sessions` (active recovery flows with their 24-hour delay window). Existing `users.kekProofHash` and `users.encryptedSecretKey` columns are dropped — the root KEK is no longer per-user-PIN-derived, and its envelopes live in a new table.
9. **`src/shared/crypto-labels.ts`** — adds `LABEL_PRF_KEK_SALT_V1`, `LABEL_ROOT_KEK_WRAP`, `LABEL_RECOVERY_PHRASE_KEK`, `LABEL_OPAQUE_EXPORT_KEK`, `LABEL_RECOVERY_GROUP_WRAP`, `LABEL_RECOVERY_GROUP_SHARE`, `LABEL_RECOVERY_SESSION_PAYLOAD`. Removes `LABEL_NSEC_KEK_2F`, `LABEL_NSEC_KEK_3F`, `LABEL_KEK_PRF`, `LABEL_IDP_VALUE_WRAP`, `RECOVERY_SALT` (no callers remain after this tier).
10. **`src/shared/schemas/auth.ts`** — adds zod schemas for the new endpoint bodies: `OpaqueRegisterInitSchema`, `OpaqueRegisterFinishSchema`, `OpaqueLoginInitSchema`, `OpaqueLoginFinishSchema`, `RecoveryGroupEnrollSchema`, `RecoveryInitiateSchema`, `RecoveryCompleteSchema`, `RecoveryPhraseRotateSchema`. Removes `PinChangeSchema`, `RecoveryRotateSchema` (and the files holding them).
11. **`src/client/components/pin-challenge-dialog.tsx`** — demoted to `unlock-challenge-dialog.tsx` and generalized. Primary button is "Unlock with passkey", secondary is "Enter password" (OPAQUE), tertiary is "Use recovery phrase". The PIN input is only shown in the optional "convenience re-lock" flow during an already-unlocked session.
12. **`tests/api/pin-change.spec.ts` and `tests/api/recovery-rotate.spec.ts`** — replaced by `tests/api/opaque-roundtrip.spec.ts`, `tests/api/recovery-phrase-rotate.spec.ts`, `tests/api/recovery-group.spec.ts`. The PIN-change concept no longer exists at the API layer.

Every item above becomes a workstream in this tier.

### Threats this tier addresses

| Threat | Mitigation |
|---|---|
| Offline brute-force of a leaked IDB blob | PRF + Argon2id(15-word phrase) each push effective entropy well above offline-crackable thresholds. PIN is no longer a KEK factor so leaked blobs have no low-entropy search space. |
| Server-compromise → offline password cracking | OPAQUE removes password from the wire. Server-side compromise (including full DB exfiltration) cannot mount an offline attack on the user's password. |
| PRF absent on user's device | OPAQUE provides an equivalent-strength fallback via `export_key`; recovery phrase provides a third fallback; recovery group provides a fourth (admin-assisted). |
| Single credential loss = total data loss | Minimum two credentials at enrollment, plus the recovery phrase, plus the Recovery Group. Data loss now requires losing every factor *and* losing the Recovery Group quorum. |
| Admin recovers user data unilaterally | 2-of-3 Shamir sharing of the Recovery Group private key prevents any single admin from recovering a user's data. Audit sigchain captures every recovery operation so silent abuse is detectable. |
| Volunteer does not notice admin recovery | 24-hour mandatory delay between recovery request and recovery completion, during which the volunteer receives notifications on every enrolled device. Admin-emergency-override requires a logged justification and a second admin's consent. |
| Replay of an intercepted OPAQUE login | OPAQUE session keys are derived per-run from ephemeral material. Both sides verify session-key equality before proceeding. The client also binds the session cookie to the current opaque session key so replay against a stale cookie fails. |
| Replay of a WebAuthn PRF assertion | WebAuthn's challenge-response is single-use. The PRF eval salt is a stable domain-separation constant but the authenticator's returned signature binds the evaluator salt to the fresh challenge. |
| Compromised authenticator (e.g. malicious YubiKey firmware) | PRF + OPAQUE + recovery phrase + Recovery Group all run in parallel; a single compromised factor is insufficient (you need at least the threshold set of factors to unwrap the root KEK). Additionally, we document a "rotate credentials" flow for the user to scrub a compromised credential. |
| Shamir share compromise at one admin's device | 2-of-3 means a single admin's compromised share is not enough. Shares are HPKE-encrypted under each admin's identity key (Tier 1 dependency) so a filesystem grab on one admin's device yields nothing without also compromising that admin's identity key. |

## Design

The spec is organized as seven workstreams (2.1 through 2.7), batched into one pull request so the entire overhaul lands atomically. Pre-production — no backward-compatibility bridge — means every call site that referenced the v2 key-store is rewritten.

**Guiding principles** (master doc §9):

- PRF primary, OPAQUE fallback, recovery phrase and Recovery Group as tertiary — not as "optional extras."
- The server never sees any password material, any PRF output, any recovery phrase, or any root KEK byte.
- Every factor HKDFs through a unique `CryptoLabel` (Tier 0 brand) into a non-extractable AES-KW `CryptoKey` (Tier 1 dependency). Raw key bytes from factors are zeroed immediately after the non-extractable import.
- Every recovery-group or recovery-phrase operation is signed into the Tier 0 audit sigchain *before* any crypto rewrap runs. This is the Albrecht #1 defense for the recovery path.
- The root KEK is envelope-wrapped under each registered factor. Adding a factor appends a new envelope; removing a factor deletes its envelope and rotates the root KEK.
- The migration is one-shot: all v2 encrypted-key blobs are wiped on migration, every user re-enrolls. There is no coexistence window.

### 2.1. WebAuthn PRF as the primary KEK factor

#### 2.1.1. Threat model and design choice

WebAuthn Level 3 §10.1.4 defines the `prf` extension, which instructs a CTAP2 authenticator to return `HMAC(credential_prf_seed, evalSalt)` as 32 bytes. The seed is provisioned at credential creation, stored inside the authenticator, and never extractable. On Chrome / Edge / Android Chrome the extension has been stable since 116 for platform authenticators; PRF-on-create (the ability to evaluate PRF during `navigator.credentials.create`) shipped in Chrome 147 (late 2025). Firefox 148 (Jan 2026) ships Windows Hello PRF-on-create support via Windows 11 25H2 KB5077181 (cumulative update Feb 2026). Safari 18 / iOS 18 / macOS 15 supports PRF for iCloud Keychain passkeys but **does not forward PRF extension data to external roaming authenticators** — YubiKey on Safari iOS cannot return PRF output. (Verified via MDN `Web_Authentication_API/WebAuthn_extensions`, Corbado 2026 guide, Yubico Developer Guide to PRF, Chrome Status 5138422207348736.)

The practical implication for Llamenos: **assume PRF is available on ≥90% of desktop and mobile devices in 2026**, but plan for the ≤10% tail (Safari+YubiKey, Linux+FIDO2 stacks pre-2025, older Android WebView) via OPAQUE and the recovery phrase.

**Design choice.** PRF is the *primary* KEK factor when available. Enrollment *requires* a PRF-capable credential. Users whose primary device cannot produce a PRF output enroll via OPAQUE and a recovery phrase as the two mandatory factors — PRF is registered later when they move to a PRF-capable device.

#### 2.1.2. PRF salt strategy

One global salt constant, versioned for future rotation:

```typescript
// Added to src/shared/crypto-labels.ts in this tier
export const LABEL_PRF_KEK_SALT_V1 = 'llamenos:kek-prf-salt:v1' as CryptoLabel
```

Each credential is evaluated against the same salt so the PRF output for the "KEK unwrap" purpose is stable per credential. If we later need to rotate (e.g. a cryptographic weakness is discovered in the eval construction), we define `LABEL_PRF_KEK_SALT_V2` and run a one-shot re-enrollment; both salts coexist during the rotation window.

#### 2.1.3. Enrollment flow

Two code paths depending on whether the credential is created fresh or added to an existing account.

**Fresh account — first passkey**:

```typescript
// src/client/lib/webauthn.ts (new implementation in this tier)
import { startRegistration } from '@simplewebauthn/browser'

export async function registerPrfCredential(
  label: string,
): Promise<{ credentialId: string; prfOutput: Uint8Array }> {
  const optionsResponse = await authFacadeClient.getRegisterOptions({ prf: true })
  const { challengeId, ...optionsJSON } = optionsResponse

  // SimpleWebAuthn doesn't propagate extensions on its PublicKeyCredentialCreationOptionsJSON
  // types in versions <13.4 — we add them manually.
  const optionsWithPrf = {
    ...optionsJSON,
    extensions: {
      prf: { eval: { first: base64url(utf8ToBytes(LABEL_PRF_KEK_SALT_V1)) } },
    },
  }

  const attestation = await startRegistration({ optionsJSON: optionsWithPrf })

  // The browser returns a PublicKeyCredential whose clientExtensionResults.prf should
  // contain { enabled: true, results: { first: ArrayBuffer } } if the authenticator
  // supports PRF-on-create.
  const extResults = (attestation as unknown as PublicKeyCredential).getClientExtensionResults()
  const prfResult = (extResults as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } }).prf
  if (!prfResult?.enabled) {
    throw new PrfUnsupportedError('Authenticator does not support PRF on create')
  }
  if (!prfResult.results?.first) {
    throw new PrfUnsupportedError('Authenticator did not return a PRF output during create — please use assertion to derive the KEK')
  }
  const prfOutput = new Uint8Array(prfResult.results.first)

  // Server-side verification of the credential (no PRF material sent)
  await authFacadeClient.verifyRegistration(attestation, label, challengeId)

  return { credentialId: attestation.id, prfOutput }
}
```

**Adding a credential to an existing unlocked account**: identical flow. Each new credential contributes a new PRF-derived KEK envelope in IDB + server (see 2.1.4).

**Unlocking with an existing credential**:

```typescript
// src/client/lib/webauthn.ts
export async function unlockPrfFromCredential(
  credentialId: string,
): Promise<{ prfOutput: Uint8Array }> {
  const optionsResponse = await authFacadeClient.getLoginOptions({ prf: true })
  const { challengeId, ...optionsJSON } = optionsResponse
  const optionsWithPrf = {
    ...optionsJSON,
    allowCredentials: [{ id: credentialId, type: 'public-key' }],
    extensions: {
      prf: { eval: { first: base64url(utf8ToBytes(LABEL_PRF_KEK_SALT_V1)) } },
    },
  }
  const assertion = await startAuthentication({ optionsJSON: optionsWithPrf })
  const extResults = (assertion as unknown as PublicKeyCredential).getClientExtensionResults()
  const prfResult = (extResults as { prf?: { results?: { first?: ArrayBuffer } } }).prf
  if (!prfResult?.results?.first) {
    throw new PrfUnsupportedError('Authenticator did not return a PRF output')
  }
  await authFacadeClient.verifyLogin(assertion, challengeId)
  return { prfOutput: new Uint8Array(prfResult.results.first) }
}
```

The server still verifies the WebAuthn assertion for authentication (access token issuance). The PRF output stays entirely on the client. The two verifications (server auth + client KEK unwrap) share the same `navigator.credentials.get` call.

#### 2.1.4. PRF output to non-extractable KEK

```typescript
// src/client/lib/crypto-worker.ts (new handler)
async function handleImportPrfKek(prfOutputHex: string): Promise<CryptoKey> {
  const prfOutput = hexToBytes(prfOutputHex)
  // HKDF into 32 bytes of AES-KW material with a distinct label
  const prfKeyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput.buffer as ArrayBuffer,
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
        info: utf8ToBytes(LABEL_ROOT_KEK_WRAP + ':prf'),
      },
      prfKeyMaterial,
      256,
    ),
  )
  // Import as non-extractable AES-KW (Tier 1 dependency)
  const aesKwKey = await crypto.subtle.importKey(
    'raw',
    kekBytes.buffer as ArrayBuffer,
    'AES-KW',
    false,
    ['unwrapKey', 'wrapKey'],
  )
  kekBytes.fill(0)
  prfOutput.fill(0)
  return aesKwKey
}
```

This runs inside the crypto Web Worker. The raw PRF output bytes are zeroed the instant the non-extractable `CryptoKey` is imported. The `AES-KW` `unwrapKey` / `wrapKey` usages allow this key to unwrap the root KEK envelope without ever extracting the root KEK as raw bytes either.

#### 2.1.5. Root KEK envelope under multiple credentials

Each credential registered on a device contributes one envelope in a per-user structure:

```typescript
// src/shared/schemas/root-kek-envelope.ts
export const RootKekEnvelopeSchema = z.object({
  v: z.literal(3),
  factorType: z.enum(['prf', 'opaque', 'recoveryPhrase', 'recoveryGroup']),
  factorId: z.string(), // credential id for prf, 'opaque' for opaque, 'recoveryPhrase' for phrase, hub id for recovery group
  wrappedKey: z.string().regex(/^[0-9a-f]+$/), // hex-encoded AES-KW-wrapped root KEK
  createdAt: z.string().datetime(),
})
export type RootKekEnvelope = z.infer<typeof RootKekEnvelopeSchema>

export const RootKekEnvelopeBundleSchema = z.object({
  v: z.literal(3),
  userId: z.string().uuid(),
  rootKeyId: z.string().uuid(), // changes on every rotation
  envelopes: z.array(RootKekEnvelopeSchema).min(2), // at least two factors at all times
  createdAt: z.string().datetime(),
})
export type RootKekEnvelopeBundle = z.infer<typeof RootKekEnvelopeBundleSchema>
```

The bundle is persisted on both client (IDB) and server (`user_root_kek_envelopes` table). Client persistence lets a passkey unlock work offline after the first fetch; server persistence lets a newly-provisioned device pull the latest bundle. Both copies are identical — the envelopes are ciphertext-only, the server has no decryption capability.

**Multi-credential invariant:** `envelopes.length >= 2`. Enrollment ships ≥2 envelopes. Removing a credential that would drop `envelopes.length` below 2 is rejected at the API layer.

**Rotation on removal.** The brief calls out the open question of remove-vs-rotate for multi-credential. I adopt **rotate on remove**: generate a new random root KEK, re-wrap under every remaining factor, atomically swap the bundle (new `rootKeyId`), atomically append a `kek_rotate` entry to the audit sigchain, and — because the root KEK wraps the `items_key` from the Standard Notes indirection (Tier 1 dependency) — the `items_key` is re-wrapped in the same transaction. This is slightly more expensive than "remove envelope", but it matches the 1Password / Bitwarden rotation semantics and it ensures that a previously-compromised credential cannot resurrect itself from an old backup.

#### 2.1.6. Server-side changes for PRF

The server does not see PRF outputs. It only needs to thread the `prf` option through `generateRegistrationOptions` and `generateAuthenticationOptions` from `@simplewebauthn/server` so the client can request it:

```typescript
// src/server/lib/webauthn.ts (updated signature)
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
  // SimpleWebAuthn @13 does not emit extensions in its output type, so we mutate
  // the JSON object directly before sending to the client.
  if (options.prf) {
    ;(opts as Record<string, unknown>).extensions = {
      prf: { eval: { first: bytesToBase64Url(utf8ToBytes(LABEL_PRF_KEK_SALT_V1)) } },
    }
  }
  return opts
}
```

`generateAuthOptions` receives the same treatment. The `credentialId: z.string()`, `challengeId: z.string()` shape of the return value is unchanged.

Note that `@simplewebauthn/server` never validates PRF — PRF assertion material is in `clientExtensionResults` on the client side, which is intentionally not sent to the server. The server's only job is to produce the right options JSON and verify the rest of the WebAuthn assertion.

#### 2.1.7. Cross-device compatibility

**Passkey synchronization** (iCloud Keychain, Google Password Manager, 1Password as passkey provider) means a passkey created on device A can be used on device B. **The PRF seed does not sync.** Each provider handles PRF differently:

- **iCloud Keychain**: PRF seed is synced along with the credential in iOS 18 / macOS 15+. A PRF output from the same salt is *identical* across devices on the same iCloud account. This is a recent change — earlier iOS versions generated a new seed per device on sync.
- **Google Password Manager**: PRF seed synced across Android + Chrome since Android 15. Same stability property as iCloud.
- **1Password / Bitwarden as passkey provider**: Depends on provider version — most modern versions sync PRF material in their encrypted vault.

**Implication for Llamenos.** We cannot assume PRF stability across devices. Our design treats each device's PRF output as a *separate factor*: enrolling on device A registers one envelope (`factorType='prf', factorId=credentialIdA`); syncing to device B and running first-time setup registers a second envelope (`factorType='prf', factorId=credentialIdB`). The fact that credentials A and B might happen to share a PRF seed is a performance optimization we do not rely on for correctness.

This is the multi-credential PRF pattern 1Password uses and it maps cleanly onto our `RootKekEnvelopeBundle.envelopes[]`.

### 2.2. OPAQUE (RFC 9807) login

#### 2.2.1. Library choice

**`@serenity-kit/opaque`** (latest stable at time of spec authoring, WASM build of `facebook/opaque-ke`). Ciphersuite: ristretto255 + SHA-512 + Argon2id (OPRF). Independently reviewed by OTF Red Team Lab. (Verified via npm package readme, GitHub `serenity-kit/opaque` 2026.)

**Decision 2026-04-10: ship a thin Llamenos-owned Rust→WASM wrapper over `facebook/opaque-ke` directly, loaded into the client bundle via Vite's WASM loader.** Rhonda's call: *"lets go with option B for OPAQUE, make our own thin wrapper for OPAQUE-ke and load it with vite wasm"*. The earlier draft deferred the library choice; this is now a concrete commitment.

**Wrapper scope.** The wrapper is a ~300-line Rust crate that re-exports the `opaque-ke` client + server types over a minimal TypeScript-facing API:

```rust
// vendor/opaque-wrapper/src/lib.rs — sketch
use wasm_bindgen::prelude::*;
use opaque_ke::{
  ClientLogin, ClientLoginFinishParameters, ClientLoginStartParameters,
  ClientRegistration, ClientRegistrationFinishParameters,
  CredentialFinalization, CredentialRequest, CredentialResponse,
  RegistrationRequest, RegistrationResponse, RegistrationUpload,
  ciphersuite::CipherSuite,
  errors::ProtocolError,
};

// Pin exactly one ciphersuite. No runtime switching, no negotiation.
#[derive(Default)]
pub struct LlamenosOpaqueCipher;
impl CipherSuite for LlamenosOpaqueCipher {
    type OprfCs = voprf::Ristretto255;
    type KeGroup = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::key_exchange::tripledh::TripleDh;
    type Ksf = argon2::Argon2<'static>;  // Argon2id with m=47 MiB, t=1, p=1
}

#[wasm_bindgen]
pub fn client_registration_start(password: &[u8]) -> Result<Vec<u8>, JsError> { /* ... */ }

#[wasm_bindgen]
pub fn client_registration_finish(
    state: &[u8],
    registration_response: &[u8],
    password: &[u8],
) -> Result<Vec<u8>, JsError> { /* ... */ }

#[wasm_bindgen]
pub fn client_login_start(password: &[u8]) -> Result<Vec<u8>, JsError> { /* ... */ }

#[wasm_bindgen]
pub fn client_login_finish(
    state: &[u8],
    credential_response: &[u8],
    password: &[u8],
) -> Result<ClientLoginFinishOutput, JsError> { /* ... */ }

// Server-side: same small set of exports for the Hono route handlers.
```

The wrapper is **not** an `npm` package. It is a first-party Rust crate living in `vendor/opaque-wrapper/` in the monorepo. The build pipeline runs `wasm-pack build --target web --out-dir pkg` as a Tier 2 plan task, and Vite's native `?url` / `?init` imports load the resulting `.wasm` into both the client (unlock flow) and the server (OPAQUE handler routes; Bun handles WASM the same way Vite does on the browser side).

**Why write our own wrapper.**

1. **Owned ciphersuite choice.** The wrapper pins exactly one ciphersuite (Ristretto255 + TripleDH + Argon2id with our chosen parameters from §2.3.3). Runtime negotiation is impossible by construction — the binary only knows one suite. This closes the entire class of OPAQUE downgrade attacks.
2. **Audited Rust core, thin binding.** The `facebook/opaque-ke` Rust crate is Cure53-audited (2022) and actively maintained by Meta's crypto team. Our wrapper is ~300 lines of boilerplate around the audited core; the auditable surface is tiny compared to a full JS implementation.
3. **No floating upstream.** `@serenity-kit/opaque` (the rejected alternative) is a third-party JS package whose maintenance posture we do not control. Owning the wrapper means we pin the `opaque-ke` crate version ourselves and every bump is a PR with a diff review.
4. **Vite WASM loading is solved.** Tier 6's `@wireapp/core-crypto` adoption already commits Llamenos to Vite's WASM pipeline. Loading a second WASM module (the OPAQUE wrapper) reuses the exact same toolchain — no new infrastructure. Bundle size is acceptable per Rhonda's 2026-04-10 directive ("bundle size is not a problem").
5. **Argon2id parameter control.** The wrapper's `Ksf` type is our own Argon2id configuration. Llamenos's Tier 2 parameter choice (`m=47 MiB, t=1, p=1`) is compiled into the WASM at build time. No runtime configuration, no risk of a misconfigured `@serenity-kit/opaque` deployment running with weaker defaults.
6. **Integration with the crypto iframe / worker.** The WASM module is loaded inside the same crypto worker (Tier 0) or crypto sandbox iframe (Tier 4) where the non-extractable KEK lives. The OPAQUE `export_key` never leaves the isolation boundary — the wrapper returns it directly to the KEK-derivation path without main-thread exposure.

**Vendoring layout:**

```
vendor/
  opaque-wrapper/
    Cargo.toml               # pins opaque-ke + voprf + argon2 at exact versions
    Cargo.lock               # committed
    src/
      lib.rs                 # the ~300 lines of wasm-bindgen exports
    pkg/                     # wasm-pack build output (generated, committed for reproducibility)
      opaque_wrapper_bg.wasm
      opaque_wrapper.js
      opaque_wrapper.d.ts
    README.md                # vendor notes + build instructions
  PROVENANCE.md              # per-dep license chain (opaque-ke: MIT, voprf: MIT, argon2: MIT)
```

The vendored `pkg/` output is checked into git so `bun install` does not require a Rust toolchain on contributor machines. Contributors who want to modify the wrapper install `rustup` + `wasm-pack` and rebuild. CI verifies the committed `pkg/` matches a fresh `wasm-pack build` output (reproducible-build guarantee).

**Build-time dependencies (developer machines only):** `rustup` (stable toolchain), `wasm-pack`. Not required on contributor machines unless they are editing the wrapper.

**API consumption from TypeScript:**

```typescript
// src/client/lib/opaque-client.ts (after Tier 2 Task X lands)
import init, * as opaque from '@llamenos/opaque-wrapper'
import wasmUrl from '@llamenos/opaque-wrapper/pkg/opaque_wrapper_bg.wasm?url'

let ready: Promise<void> | null = null
async function ensureReady() {
  if (!ready) ready = init({ module_or_path: wasmUrl }).then(() => undefined)
  return ready
}

export async function startClientRegistration(password: string): Promise<{ state: Uint8Array; request: Uint8Array }> {
  await ensureReady()
  const combined = opaque.client_registration_start(new TextEncoder().encode(password))
  // ...parse state + request from the combined bytes returned by the wrapper
}
```

The wrapper is imported like any other npm package via a `file:` dependency (`"@llamenos/opaque-wrapper": "file:./vendor/opaque-wrapper/pkg"`) pointing at the `pkg/` directory. SLSA provenance (Tier 0) covers the entire `vendor/` subtree.

**Server-side.** The Hono `/api/auth/opaque/*` routes load the same WASM via Bun's `WebAssembly.instantiate()` + the wrapper's Node target. Bun handles the same wasm-bindgen output as the browser target with a different entry point; the wrapper's `Cargo.toml` lists both `wasm32-unknown-unknown` (browser) and a Node-compatible feature in the `[features]` section. Build produces two `pkg/` directories: `pkg-web/` (browser) and `pkg-node/` (Bun server). Both live under `vendor/opaque-wrapper/` and are loaded from the appropriate path.

**Rejected alternative — `@serenity-kit/opaque`.** Third-party maintenance posture, uncontrolled ciphersuite + parameters, no direct audit trail, upstream can change JS API between versions without our knowledge. We pay a ~1 engineer-week cost for the wrapper in exchange for control.

**Rejected alternative — drop OPAQUE entirely.** PRF + Diceware phrase + Recovery Group would still be a stronger unlock matrix than the current key-store-v2 PIN-based design, but we lose the password-login convenience for the "typing a password is familiar" cohort. Rhonda's Tier 2 design ordering (PRF primary → OPAQUE fallback → Diceware → Recovery Group) depends on OPAQUE being present; dropping it would change the UX contract.

The P-256 variant `@serenity-kit/opaque-p256` exists for environments where ristretto255 is unavailable — we do not use it because WebCrypto-native AES-GCM is on P-256 territory already and we prefer ristretto255 for its simpler modular structure.

Known constraint: **Argon2id memory is capped at 2^21 - 1 KiB** (~2 MiB) in the browser WASM build because larger values crashed browsers in testing. This is documented in the serenity-kit README. We accept this cap and compensate via iterations: `t=3, p=1, m=2^21-1`. On a 2024-era phone this produces ~400ms of hash time, which is acceptable for a login operation.

#### 2.2.2. Flow

```typescript
// Client registration (enrollment path)
import * as opaque from '@serenity-kit/opaque'

await opaque.ready

async function opaqueRegister(password: string): Promise<Uint8Array /* export_key */> {
  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
    password,
    keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
  })
  const { registrationResponse } = await authFacadeClient.opaqueRegisterInit({ registrationRequest })
  const { registrationRecord, exportKey } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
  })
  await authFacadeClient.opaqueRegisterFinish({ registrationRecord })
  return base64urlDecode(exportKey)
}

async function opaqueLogin(password: string): Promise<{ sessionKey: Uint8Array; exportKey: Uint8Array }> {
  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({
    password,
    keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
  })
  const { loginResponse } = await authFacadeClient.opaqueLoginInit({ startLoginRequest })
  const { finishLoginRequest, sessionKey, exportKey } = opaque.client.finishLogin({
    clientLoginState,
    loginResponse,
    password,
    keyStretching: { algo: 'argon2id', parameters: { t: 3, p: 1, m: 2 ** 21 - 1 } },
  })
  const { accessToken, pubkey } = await authFacadeClient.opaqueLoginFinish({ finishLoginRequest })
  return { sessionKey: base64urlDecode(sessionKey), exportKey: base64urlDecode(exportKey) }
}
```

Argon2id parameters are fed through `keyStretching`. Per OWASP Password Storage Cheat Sheet (verified April 2026): `m=19456 (19 MiB), t=2, p=1` is the low-resource floor; `m=47104 (46 MiB), t=1, p=1` is the standard floor. **Decision 2026-04-10 — bump to the standard floor `m=47104, t=1, p=1`** across every unlock derivation path (Diceware phrase, OPAQUE `keyStretching`, any future password-derived factor). Rationale: unlock is a rare event (at most a few times per session per user, typically once per device), so the extra memory cost is a rare occurrence and the stronger-derivation floor is worth it. Wall-clock on a 2026 mid-range phone: ~600–900 ms (measured reference devices listed in `docs/security/UNLOCK_BENCHMARKS.md`); on desktop: ~200–300 ms. Both remain under the 2 s "noticeable but not frustrating" UX threshold.

#### 2.2.3. Server integration

```typescript
// src/server/routes/auth-facade.ts additions
import * as opaque from '@serenity-kit/opaque/server' // node path

const SERVER_SETUP = opaque.server.createSetup() // one-time operation, persisted

authFacade.post(
  '/opaque/register/init',
  zValidator('json', OpaqueRegisterInitSchema),
  async (c) => {
    const { registrationRequest, userIdentifier } = c.req.valid('json')
    const { registrationResponse } = opaque.server.createRegistrationResponse({
      serverSetup: SERVER_SETUP,
      userIdentifier,
      registrationRequest,
    })
    return c.json({ registrationResponse })
  },
)

authFacade.post(
  '/opaque/register/finish',
  jwtAuth, // user must be already enrolled via WebAuthn before adding an OPAQUE factor
  zValidator('json', OpaqueRegisterFinishSchema),
  async (c) => {
    const { registrationRecord } = c.req.valid('json')
    const pubkey = c.get('pubkey')
    await c.get('identity').storeOpaqueRecord({ pubkey, registrationRecord })
    // Emit audit entry
    await c.get('auditLog').appendSigned(/* opaque_credential_added */)
    return c.json({ ok: true })
  },
)

authFacade.post(
  '/opaque/login/init',
  zValidator('json', OpaqueLoginInitSchema),
  async (c) => {
    const { userIdentifier, startLoginRequest } = c.req.valid('json')
    const registrationRecord = await c.get('identity').getOpaqueRecord(userIdentifier)
    if (!registrationRecord) {
      // Simulate a realistic response to prevent user-enumeration (serenity-kit
      // provides a "dummy" record helper for this purpose).
      const { loginResponse, serverLoginState } = opaque.server.startLogin({
        serverSetup: SERVER_SETUP,
        userIdentifier,
        registrationRecord: opaque.server.getPlaceholderRegistrationRecord(),
        startLoginRequest,
      })
      // Cache serverLoginState under a per-IP key so the finish call can reject it.
      await cacheLoginState(c, userIdentifier, serverLoginState, { isDummy: true })
      return c.json({ loginResponse })
    }
    const { loginResponse, serverLoginState } = opaque.server.startLogin({
      serverSetup: SERVER_SETUP,
      userIdentifier,
      registrationRecord,
      startLoginRequest,
    })
    await cacheLoginState(c, userIdentifier, serverLoginState, { isDummy: false })
    return c.json({ loginResponse })
  },
)

authFacade.post(
  '/opaque/login/finish',
  zValidator('json', OpaqueLoginFinishSchema),
  async (c) => {
    const { userIdentifier, finishLoginRequest } = c.req.valid('json')
    const cached = await loadLoginState(c, userIdentifier)
    if (!cached) return c.json({ error: 'Invalid session' }, 401)
    if (cached.isDummy) return c.json({ error: 'Invalid credentials' }, 401)
    const { sessionKey } = opaque.server.finishLogin({
      finishLoginRequest,
      serverLoginState: cached.serverLoginState,
    })
    // Server-side sessionKey matches client-side sessionKey if login succeeded.
    // Issue access token + session cookie.
    // ...
    const accessToken = await signAccessToken(/* ... */, c.env.JWT_SECRET)
    return c.json({ accessToken, pubkey })
  },
)
```

**User enumeration.** The placeholder-registration-record pattern above is the OPAQUE-approved way to return a plausible-looking response for unknown users so an attacker cannot enumerate. This is documented in the `@serenity-kit/opaque` README (`getPlaceholderRegistrationRecord`). The "finish" step will fail regardless; the important point is that timing and response shape are indistinguishable from a real user.

**Server setup persistence.** `SERVER_SETUP` is a ~500-byte byte-string produced by `opaque.server.createSetup()`. It must be persisted across restarts — regenerating it invalidates every registered user's OPAQUE record. We store it in a new `opaque_server_setup` table (single row) created by the migration, and cache it in a module-level constant on boot. It's initialized in `scripts/init-opaque-server-setup.ts`, which is idempotent.

#### 2.2.4. OPAQUE `export_key` → root KEK envelope

On successful login:

```typescript
// src/client/lib/key-manager.ts
async function unlockViaOpaque(password: string): Promise<void> {
  const { exportKey } = await opaqueLogin(password)
  // exportKey is 64 bytes (SHA-512 output of OPAQUE KE). HKDF-split it:
  const kekBytes = hkdfSha256(exportKey, /* salt */ new Uint8Array(0), utf8ToBytes(LABEL_ROOT_KEK_WRAP + ':opaque'), 32)
  exportKey.fill(0)
  const aesKwKey = await crypto.subtle.importKey('raw', kekBytes.buffer as ArrayBuffer, 'AES-KW', false, ['unwrapKey'])
  kekBytes.fill(0)
  // Find the envelope whose factorType='opaque'
  const bundle = await loadRootKekBundle()
  const envelope = bundle.envelopes.find((e) => e.factorType === 'opaque')
  if (!envelope) throw new NoMatchingEnvelopeError('opaque')
  const rootKek = await crypto.subtle.unwrapKey(
    'raw',
    hexToBytes(envelope.wrappedKey).buffer as ArrayBuffer,
    aesKwKey,
    'AES-KW',
    'AES-KW',
    false,
    ['unwrapKey'],
  )
  await cryptoWorker.importRootKek(rootKek /* non-extractable handle */)
}
```

Same pattern for PRF, recovery phrase, and recovery group. The unwrap is symmetric; the differences are in how the AES-KW unwrapping key is produced.

#### 2.2.5. OPAQUE and Authentik coexistence

The auth facade's login decision tree after Tier 2:

```
User arrives at /login

├── If they have a WebAuthn credential registered → offer passkey (PRF primary)
│     Fallback: "Use password instead" → OPAQUE or OIDC
├── If admin-configured SSO (Authentik OIDC) → redirect to Authentik
│     Fallback: "Use password instead" → OPAQUE (if they also have one)
├── If they have an OPAQUE record → offer password (OPAQUE)
│     Fallback: "Can't access any device?" → Recovery phrase → Recovery Group
└── First-time arrival (invite code) → WebAuthn + OPAQUE dual enrollment
```

The user always has at least two enrollment options; the operator chooses which are offered via the existing auth-facade configuration. Authentik remains the IdP for org-wide identity providers; OPAQUE fills the "local password, no SSO" slot. Passkey is preferred, OPAQUE is the fallback, SSO is a parallel path.

### 2.3. Diceware recovery phrase

#### 2.3.1. Wordlist and entropy

**EFF large wordlist** (7776 words, verified via eff.org/files/2016/07/18/eff_large_wordlist.txt as of April 2026): log₂(7776) ≈ 12.9 bits per word. **15 words = 194 bits of effective entropy**. A 15-word phrase is uncrackable against any offline attack; it is also annoying to type, which is the correct friction for a recovery path.

We commit the wordlist as a build artifact at `src/client/assets/eff-large-wordlist.txt` (hashed at build time, verified at runtime against a known SHA-256). Same pattern as our existing GeoIP DB download.

#### 2.3.2. Generation

```typescript
// src/client/lib/recovery-phrase.ts
export function generateRecoveryPhrase(wordCount = 15): string {
  const words = EFF_LARGE_WORDLIST // 7776 entries
  const rng = new Uint16Array(wordCount)
  // Rejection sampling so we don't introduce bias from 2^16 mod 7776
  for (let i = 0; i < wordCount; ) {
    crypto.getRandomValues(rng.subarray(i, i + 1))
    if (rng[i]! < 65536 - (65536 % 7776)) {
      rng[i] = rng[i]! % 7776
      i++
    }
  }
  return Array.from(rng, (idx) => words[idx]).join(' ')
}
```

Rejection sampling ensures an unbiased uniform distribution.

#### 2.3.3. Phrase-to-KEK derivation

```typescript
// src/client/lib/recovery-phrase.ts
import { argon2id } from '@noble/hashes/argon2.js'

export async function deriveRecoveryPhraseKek(
  phrase: string,
  salt: Uint8Array, // per-user, 32 bytes, persisted server-side + IDB
): Promise<CryptoKey> {
  const normalized = phrase.trim().toLowerCase().split(/\s+/).join(' ')
  const ikm = utf8ToBytes(normalized)
  // OWASP low-resource floor — browser-friendly
  const raw = argon2id(ikm, salt, { t: 2, m: 19456, p: 1, dkLen: 32 })
  ikm.fill(0)
  const kekBytes = hkdfSha256(raw, new Uint8Array(0), utf8ToBytes(LABEL_ROOT_KEK_WRAP + ':phrase'), 32)
  raw.fill(0)
  const aesKw = await crypto.subtle.importKey('raw', kekBytes.buffer as ArrayBuffer, 'AES-KW', false, ['unwrapKey', 'wrapKey'])
  kekBytes.fill(0)
  return aesKw
}
```

Argon2id parameters `t=1, m=47104 KiB (46 MiB), p=1`: OWASP-recommended standard baseline verified via OWASP Password Storage Cheat Sheet (April 2026). The stronger-cost choice is documented in §2.2.3 rationale — unlock is rare, the 46 MiB memory cost is acceptable. `@noble/hashes/argon2.js` is already in our dependency set (we use it elsewhere), so no new dependency is required for the phrase path.

#### 2.3.4. Storage and UX

The phrase is shown **once** during enrollment, on a dedicated screen with:

- Visual: all 15 words, clearly spaced, in a boxed "write this down" card.
- Interaction: a checkbox "I have written this down on paper and stored it safely" (required before proceeding).
- A "copy to clipboard" button that is disabled for 3 seconds (long enough for the user to read the words and decide not to copy — we want to nudge against screenshot/clipboard habits but not prohibit them).
- A "re-enter to verify" step: the user types a random subset (3 of the 15 words, positions randomized) to prove they wrote it down.

The phrase is **never stored on the device** in plaintext or any recoverable form. Only the per-user Argon2id salt is persisted; the phrase itself lives only in the user's memory / paper copy. On recovery, the user types the phrase → `deriveRecoveryPhraseKek(phrase, storedSalt)` → unwraps the recovery-phrase envelope → unwraps the root KEK.

#### 2.3.5. Rotation

`POST /api/auth/recovery-phrase/rotate` — requires an already-unlocked session. Generates a new phrase, a new salt, re-wraps the root KEK under the new phrase-derived AES-KW key, appends a new `recoveryPhrase` envelope to the bundle (replacing the old one atomically), signs a `recovery_phrase_rotate` audit entry. Returns the new phrase to the client; the client displays it once and discards it after the user confirms.

Rate limit: 3 rotations per 24 hours per user. This is enforced server-side via the existing `isRateLimited` helper in `auth-facade.ts`.

### 2.4. 1Password-style Recovery Group with 2-of-3 Shamir

#### 2.4.1. Library choice

**`shamir-secret-sharing`** from privy-io (verified via GitHub `privy-io/shamir-secret-sharing` and npm, April 2026). Simple zero-dependency TypeScript, GF(2^8), independently audited by Cure53 and Zellic. API:

```typescript
import { split, combine } from 'shamir-secret-sharing'

// secret: Uint8Array, shares: number (total), threshold: number
const [share1, share2, share3] = await split(secret, 3, 2)

// Reconstruct from any 2 of 3
const recovered = await combine([share1, share2])
```

We verify the hash of the published package at dependency-install time via `package.json` integrity and the Tier 0 SBOM check.

#### 2.4.2. Hub-level Recovery Group

**At hub creation**:

1. Generate a **Recovery Group X25519 keypair** `(RG_pub, RG_priv)` using `@noble/curves/ed25519` (or WebCrypto X25519 — Tier 1 dependency makes this a non-extractable `CryptoKey`).
2. Split `RG_priv` into 3 Shamir shares with threshold 2: `[share1, share2, share3]`.
3. Each share is **HPKE-wrapped** (Tier 1 dependency on `@hpke/core`) under one designated admin's device identity key. The result is three envelopes, one per admin, each stored server-side in `hub_recovery_group_shares`.
4. Each admin's client fetches their share envelope on next unlock; the share is decrypted locally (in the crypto worker) and cached in IDB under a non-extractable AES-KW wrap. The raw share bytes never touch the main thread.
5. `RG_pub` is stored in `hub_recovery_groups` alongside a SHA-256 commitment to each share (used for tamper detection during recovery).
6. A `recovery_group_enroll` audit entry is written to the hub's sigchain with the commitments and the participating admin pubkeys.

**Threshold**: default 2-of-3. Hub admin-settable between 2-of-3 and 3-of-5. Maximum 5 total admins in the group, minimum 3 (must support at least 2-of-3). The configuration is locked at creation time — changing the threshold later requires a full Recovery Group re-enrollment.

**At volunteer enrollment**:

1. During onboarding, after the user has run the dual-factor enrollment (PRF + recovery phrase, or OPAQUE + recovery phrase), the client generates an additional envelope: HPKE-wrap the root KEK under `RG_pub`.
2. This envelope is stored in `user_recovery_envelopes` server-side, keyed by `(userId, hubId)`.
3. The volunteer is shown a confirmation UX: "This hub has a Recovery Group. You can use it to recover your account if you lose all your credentials. [Enable] [Skip]". Skipping is allowed but strongly discouraged; if skipped, the `user_recovery_envelopes` row is not written and the volunteer has no Recovery Group recourse.

**Multi-hub** (the existing hub model supports multi-hub membership): the volunteer has one `user_recovery_envelopes` row per hub they are enrolled in. Each row wraps the *same* root KEK under a *different* Recovery Group public key. Removing the volunteer from a hub deletes that row. Adding them to a new hub, *after* they are already enrolled, requires a Recovery Group enrollment step on that new hub.

**Multi-hub recovery semantics — resolved 2026-04-10: per-hub, not cascading.** Each recovery ceremony runs against exactly one hub's Recovery Group. Carol initiates recovery via hub A → hub A's admins approve → Carol's client reconstructs `RG_priv_A` → HPKE-decrypts `user_recovery_envelopes[Carol, hub-A]` → gets her root KEK back. Because the *same* root KEK is wrapped under every hub's Recovery Group (by construction), one successful recovery ceremony is sufficient to restore Carol's access across every hub where she has data — the subsequent hubs' envelopes are redundant safety nets, not separate unlock gates. The per-hub ceremony model is the right choice because:

- **Audit clarity.** Every recovery operation is signed into *that* hub's sigchain. An admin audit log shows exactly which admins approved which recovery, under which hub's authority. A cascading design would smear one recovery across N sigchains and make accountability harder.
- **Partial recovery is allowed.** If Carol only wants to recover hub A access for a specific incident review but does not need hubs B and C right now, she runs exactly one ceremony and gets exactly one set of audit entries. The alternative — a global "unlock everything" ceremony — would be overkill for routine recovery.
- **No cross-hub authority needed.** A cascading design would require some "coordinator" role that has authority across multiple hubs, which Llamenos explicitly does NOT have. Hub admins are scoped to their hub. The per-hub ceremony respects that boundary.
- **Hubs without a Recovery Group remain reachable.** If Carol skipped Recovery Group enrollment in hub B (the UX allows opting out), she can still recover her root KEK through hub A's ceremony. Once she has her root KEK back, her identity is re-bootstrapped and she can re-enroll a Recovery Group in hub B later if she chooses.

The cascading design is explicitly rejected. Every `POST /api/auth/recovery-group/initiate` request carries exactly one `hubId`.

#### 2.4.3. Recovery flow

**Stage 1 — Carol initiates recovery**:

1. Carol (who has lost all her enrolled credentials) visits `/login` on a fresh device and clicks "I can't access my account".
2. She enters her user identifier (email or pubkey) and clicks "Request recovery from my hub admins".
3. Server creates a `recovery_sessions` row with status `pending`, ttl=24h, and `Carol_userId`, `Carol_hubId`, `newDevicePubkey` (a fresh ephemeral X25519 pubkey Carol's client generates for this purpose).
4. Server sends notifications to all hub admins via their existing notification channels.
5. Carol waits. The UI shows "Recovery request submitted. Hub admins have been notified. You will need at least 2 admins to approve within 24 hours."

**Stage 2 — Admins approve**:

1. Alice (admin, holding share1) sees the notification and navigates to the hub recovery panel.
2. She sees the pending recovery request with Carol's identifier, timestamp, and new-device ephemeral pubkey.
3. She clicks "Approve my share". Her client:
   - Unwraps her Shamir share from the locally-cached envelope.
   - HPKE-encrypts the share under `recovery_sessions.coordinator_pubkey` (a coordinator ephemeral pubkey generated server-side per session).
   - Posts it to `POST /api/auth/recovery-group/contribute-share`.
   - A `recovery_share_contributed(hubId, userId, byAdminId)` audit entry is signed and appended.
4. Bob (admin, holding share2) does the same. Now `recovery_sessions` has two encrypted share contributions.
5. After 2 contributions (the threshold), the server marks the session `ready-to-complete` and sends a notification to Carol's new device.

**Stage 3 — Coordinator completes recovery**:

The "coordinator" is Carol's new device. The coordinator:

1. Fetches the two encrypted share contributions from `recovery_sessions`.
2. Uses the session's coordinator ephemeral X25519 private key (held in Carol's crypto worker, never sent to the server) to decrypt the contributions → two Shamir shares in plaintext in the worker.
3. `combine([share1, share2])` → `RG_priv`.
4. Fetches `user_recovery_envelopes[{Carol_userId, Carol_hubId}]`.
5. HPKE-decrypts with `RG_priv` → Carol's root KEK (as a non-extractable AES-KW handle after import).
6. `RG_priv` is zeroed in the worker.

**Stage 4 — Carol re-enrolls**:

1. Carol runs fresh enrollment: creates a new PRF passkey, generates a new recovery phrase, and (if the hub still has a Recovery Group) re-enrolls her recovery envelope.
2. The recovered root KEK is re-wrapped under the new factors, producing a new `RootKekEnvelopeBundle`.
3. The old `RootKekEnvelopeBundle` is atomically replaced server-side.
4. A `recovery_completed(hubId, userId, sharedBy[], newDevicePubkey)` audit entry is signed and appended.

**Stage 5 — Audit exposure**:

Carol sees the completed recovery in her account activity panel: "Your account was recovered on 2026-04-12 by admins Alice and Bob." If she did not initiate the recovery, she knows her account was abused.

#### 2.4.4. 24-hour mandatory delay

Between Stage 1 and Stage 3, a **24-hour minimum wait** enforces that Carol has a chance to notice a recovery she did not initiate. Admins can contribute shares at any time, but the coordinator cannot complete the recovery until 24h after `recovery_sessions.createdAt`.

**Admin emergency override**: an admin can reduce the delay to 1 hour with:

- A written justification (stored in the audit sigchain).
- A second admin's explicit approval (a separate signed audit entry).
- Both signatures captured in the `recovery_completed` entry.

This balances "security delay" with "real emergency" (e.g. a volunteer has a live caller on the line and needs their account back immediately). The justification is visible in the audit log forever.

#### 2.4.5. Recovery Group rotation

A Recovery Group is rotated when:

- An admin leaves the hub.
- An admin's device is lost or compromised.
- The hub admin explicitly rotates the group.

Rotation:

1. Generate new `(RG_pub', RG_priv')`.
2. Split `RG_priv'` via Shamir and HPKE-wrap under the new admin set.
3. Generate new `user_recovery_envelopes` for every volunteer in the hub (re-wrapping the root KEK under `RG_pub'`). Note that this is safe because each user's root KEK is non-extractable — we can `wrapKey` it directly.
4. Sign a `recovery_group_rotate` audit entry listing the reason, the new share commitments, and the old (now-invalid) group hash.
5. Atomically replace the server-side state.

This is O(users_in_hub) asymmetric operations but happens rarely. On a hub of 100 volunteers it takes a few seconds.

### 2.5. KEK hierarchy diagram

The full post-Tier-2 hierarchy with Tier 1 (HPKE + non-extractable CryptoKey) assumed:

```
                                 root_kek (32 bytes, non-extractable AES-KW CryptoKey)
                                 │
                                 │ (wraps)
                                 ▼
                                 items_key (Tier 1 Standard Notes indirection)
                                 │
                                 │ (wraps)
                                 ▼
                  per-note content keys, per-file keys, hub key envelopes
                                 │
                                 │ (wraps)
                                 ▼
                  XChaCha20-Poly1305 AEAD ciphertext on disk

Unwrap paths to root_kek (any one is sufficient):

  ┌─────────── Credential A (platform passkey) ──────────────┐
  │  navigator.credentials.get({prf: {...LABEL_PRF_KEK_SALT_V1}})│
  │  → 32 bytes PRF output (hardware-rooted)                    │
  │  → HKDF(LABEL_ROOT_KEK_WRAP+':prf')                         │
  │  → non-extractable AES-KW key                                │
  │  → unwrap root_kek envelope[factorType='prf', factorId=A]   │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────── Credential B (hardware YubiKey or 2nd platform passkey) ───┐
  │  Same path as A with a different credentialId                         │
  │  → unwrap root_kek envelope[factorType='prf', factorId=B]              │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─────────── OPAQUE password ──────────────────────────────┐
  │  opaque.client.finishLogin(password) → export_key (64 B) │
  │  → HKDF(LABEL_ROOT_KEK_WRAP+':opaque')                    │
  │  → non-extractable AES-KW key                             │
  │  → unwrap root_kek envelope[factorType='opaque']          │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────── Recovery phrase (15 EFF words) ───────────────┐
  │  phrase → Argon2id(t=2, m=19MiB, p=1, salt=stored)       │
  │  → HKDF(LABEL_ROOT_KEK_WRAP+':phrase')                    │
  │  → non-extractable AES-KW key                             │
  │  → unwrap root_kek envelope[factorType='recoveryPhrase']  │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────── Recovery Group (admin-assisted) ──────────────┐
  │  ≥2 admins contribute Shamir shares                       │
  │  combine(shares) → RG_priv                                │
  │  HPKE-decrypt(user_recovery_envelopes[userId, hubId])     │
  │  → root_kek (imported as non-extractable AES-KW handle)    │
  │  → re-wrap under fresh PRF + phrase factors                │
  └─────────────────────────────────────────────────────────────┘
```

PIN is absent from this diagram. PIN becomes an *optional* "convenience re-lock" input that re-challenges during an already-unlocked session after the auto-lock timer fires (see 2.6).

**Why the root KEK is the pivot:** Tier 1 introduces the Standard Notes `items_key` indirection, which decouples "data encryption keys" from "user unlocking factors". The root KEK wraps `items_key`, which wraps every other key. Adding or removing a factor only re-wraps the root KEK, not `items_key` and certainly not the per-note keys. This is the architectural payoff for the one-shot v3 migration.

### 2.6. Device linking, session capsule, and the lock/unlock state machine

#### 2.6.1. Device linking

Tier 2 does **not** redesign device linking. The existing `src/client/lib/provisioning.ts` ephemeral ECDH provisioning room flow remains; Tier 3 (per-device keys + sigchain) is the proper replacement and is out of scope.

However, Tier 2 *uses* device linking differently: when a user provisions a new device via the existing flow, the "device gets the user's nsec" step is replaced by "device gets a temporary enrollment token that lets it run its own fresh PRF + OPAQUE + recovery-phrase registration, producing a new set of envelopes in the user's `RootKekEnvelopeBundle`". The target device never receives the raw root KEK from the source device — it derives its own factor keys and submits new envelopes.

This is a one-file change in `provisioning.ts`: the ephemeral ECDH room now transports a short-lived "enrollment permission token" instead of an encrypted nsec. The source device uses its unlocked root KEK to wrap that token; the target device's fresh factors unwrap it and then run the enrollment ceremony.

#### 2.6.2. Session capsule (PR #50) interaction

The session capsule from PR #50 stores a Worker-encrypted nsec blob in IDB keyed by a random sessionStorage token, so page reloads skip the factor-derivation step entirely. Tier 2 touches the capsule in exactly three ways:

1. **Capsule format version bump.** The capsule now stores `{ encryptedRootKek, rootKeyId, expiresAt, userIdHash }` instead of `{ encryptedNsec, pubkeyHash }`. `rootKeyId` pins the capsule to a specific `RootKekEnvelopeBundle` version so a factor-rotation (e.g. the user added a new passkey) automatically invalidates stale capsules.
2. **Capsule wipe on factor change.** Any operation that mutates the `RootKekEnvelopeBundle` (enrollment, rotation, removal, recovery) bumps `rootKeyId` and calls `clearCapsule()`. The next tab open re-derives via PRF.
3. **Capsule wipe on OPAQUE login.** A fresh OPAQUE login event (as opposed to a tab-restore session) wipes existing capsules so a user who switches from "passkey unlock" to "password unlock" gets a clean capsule with the new unlock path recorded.

Everything else about the capsule — the BroadcastChannel cross-tab sync, the IDB storage, the sessionStorage token, the cross-tab lock propagation — is unchanged from PR #50.

#### 2.6.3. Lock / unlock state machine

The state machine from `src/client/lib/key-manager.ts` generalizes from "locked | unlocked" to:

- **Locked** — worker holds no root KEK. No crypto available. Session token alone provides session-validity (server-side auth), but decryption of any content requires unlock.
- **Unlocked** — worker holds the root KEK as a non-extractable AES-KW handle. Full crypto available.
- **Convenience-locked** (new) — optional state where worker holds the root KEK but a UI gate requires PIN re-entry before certain sensitive operations. This is the demoted role for PIN: it is a soft UX gate, not a KEK factor.

Transitions:

```
Locked → Unlocked
  via: unlockViaPrf(credentialId)
       unlockViaOpaque(password)
       unlockViaRecoveryPhrase(phrase)
       unlockViaRecoveryGroup(sharedSecretHex)  // only used during recovery completion
       trySessionRestore()  // capsule-based, skips factor derivation

Unlocked → Convenience-locked
  via: auto-lock timer fire (configurable 1–60 min, default 15)
  via: explicit lockConvenient() (e.g. user pressed the "lock" button)
  via: document.hidden === true for > threshold (optional)

Convenience-locked → Unlocked
  via: enterPin(pin)  // PIN match against stored hash, unlocks UI gate only

Unlocked → Locked
  via: hardLock()  // explicit full lock
  via: auto-hard-lock timer fire (configurable, default 2 hours)
  via: cross-tab lock broadcast

Convenience-locked → Locked
  via: same as Unlocked → Locked
```

The **PIN hash** lives server-side in `user_security_prefs.convenience_pin_hash` (an Argon2id hash of the PIN, nothing to do with KEK derivation). A matched PIN unlocks the convenience gate; a wrong PIN increments a per-session counter; 5 wrong entries demotes to full Locked state.

This gives users the 6-digit-PIN UX they're accustomed to without the 6-digit-PIN security weakness. The root KEK is only derivable via the strong factors; the PIN is merely a cheap in-session re-auth.

### 2.7. Audit integration and sigchain entries

Tier 0 provides `SignedAuditEntrySchema` with a discriminated union. Tier 2 extends the union with six new payload types:

```typescript
// src/shared/schemas/audit-entries.ts (extension)
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
  adminPubkeys: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
  shareCommitments: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
  groupPublicKey: z.string().regex(/^[0-9a-f]{64}$/),
})

export const RecoveryInitiatedPayloadSchema = z.object({
  type: z.literal('recovery_initiated'),
  hubId: z.string().uuid(),
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
})

export const RecoveryCompletedPayloadSchema = z.object({
  type: z.literal('recovery_completed'),
  hubId: z.string().uuid(),
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sharedBy: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(2),
  emergencyOverride: z.object({
    invoked: z.boolean(),
    justification: z.string().optional(),
    coApproverPubkey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }).optional(),
  newDevicePubkey: z.string().regex(/^[0-9a-f]{64}$/),
})
```

Each entry is signed by the **user or admin device key** that performed the operation (Tier 0 signing flow). The chain verifier in `src/client/lib/audit-chain-verifier.ts` is extended to handle the new payload types: `factor_add` and `factor_remove` must be signed by the affected user; `recovery_group_enroll` and `recovery_group_rotate` must be signed by a super-admin; `recovery_completed` must be signed by the coordinator and verified against the Shamir threshold.

**Crucial invariant:** `root_kek_rotate` entries are always append-only and the server-side code refuses to process a factor change unless the matching sigchain entry has been successfully committed first. This is the Albrecht #1 defense applied to the unlock/recovery path: a compromised server cannot inject a fake `factor_remove` without forging an admin's schnorr signature.

## Resolved open questions

The spec brief posed ten open questions. I resolve each below:

1. **PRF salt strategy.** One global salt: `LABEL_PRF_KEK_SALT_V1`. Versioned for future rotation.
2. **Multi-credential root KEK on credential removal.** Rotate (not just remove). The root KEK is re-generated, the `items_key` is re-wrapped, the old envelopes are atomically replaced. Audit entry `root_kek_rotate(reason: 'factor_removed')`.
3. **OPAQUE vs passkey-only.** Both. PRF is primary; OPAQUE is the login fallback for devices without PRF support *and* the password path for users who prefer passwords. Both paths populate envelopes in the same `RootKekEnvelopeBundle`.
4. **Diceware wordlist.** EFF large (7776 words, 12.9 bits/word). 15 words = ~194 bits. Verified against eff.org, April 2026.
5. **Recovery Group threshold.** Default 2-of-3; hub-admin settable between 2-of-3 and 3-of-5. Maximum 5 admins in the group; minimum 3.
6. **Recovery Group opt-in UX.** Explicit at volunteer onboarding with an "I understand" acknowledgement if declined. Hub admins can configure whether skipping is *allowed* (default: allowed but discouraged).
7. **PIN as convenience re-lock.** Keep as an *optional* session-lock re-gate, not as a KEK factor. Users can disable it entirely in security preferences.
8. **Passkey-only volunteers vs Authentik SSO.** Coexist. Passkey is preferred; OIDC via Authentik is a parallel entry; OPAQUE is the local-password fallback. All three populate envelopes or a `RootKekEnvelopeBundle` equivalent.
9. **Compromised passkey rotation.** In Tier 2 we can only *remove* the compromised credential (`factor_remove` sigchain entry + root KEK rotation). Full cryptographic rotation of affected content waits for Tier 3's per-device keys.
10. **Recovery completion delay.** 24-hour mandatory default, with admin emergency override requiring a second admin's co-signature and a logged justification.

## Testing

Every workstream ships with unit, API E2E, and UI E2E coverage. Where adversarial tests are explicitly mentioned in the user directives, those are called out.

### Unit tests (bun:test, colocated)

- `src/client/lib/recovery-phrase.test.ts` — phrase generation distribution, rejection sampling correctness, Argon2id parameter acceptance, derivation determinism for a given phrase+salt, mismatch rejection.
- `src/client/lib/key-store-v3.test.ts` — root KEK bundle encode/decode, envelope ordering independence, envelope.length >= 2 invariant, rotation atomicity under concurrent access, `rootKeyId` change on every mutation.
- `src/client/lib/webauthn.test.ts` — `registerPrfCredential` branches: PRF enabled, PRF not enabled (should raise `PrfUnsupportedError`), PRF results missing, options injection correctness. Mocks `startRegistration` from `@simplewebauthn/browser`.
- `src/client/lib/recovery-group-share.test.ts` — Shamir share splitting, threshold boundary (1 share insufficient, 2 sufficient, 3 redundant), share tampering detection via SHA-256 commitment mismatch, HPKE wrap/unwrap round-trip.
- `src/client/lib/key-manager.test.ts` (extended) — the new unlock tagged-union, `Locked → Unlocked → Convenience-locked → Unlocked → Locked` transition machine, cross-tab lock broadcast interaction with the new states.
- `src/server/routes/auth-facade.opaque.test.ts` — OPAQUE register-init/finish/login-init/login-finish endpoint handlers with mocked `@serenity-kit/opaque/server`. Dummy-record user enumeration branch. Server setup persistence.
- `src/server/services/recovery-group-service.test.ts` — Recovery Group enrollment (writes `hub_recovery_groups` + `hub_recovery_group_shares`), rotation, share fetch authorization (admins only), contribution appending, threshold check on completion, 24-hour delay enforcement, emergency override auth check.
- `src/server/lib/opaque-server-setup.test.ts` — setup creation, persistence, cache loading.
- `src/shared/schemas/auth.test.ts` (extended) — all new zod schemas parse valid fixtures and reject malformed inputs.
- `src/shared/schemas/audit-entries.test.ts` (extended) — new payload variants discriminated-union parse correctly, old v2 PIN/recovery payloads removed.

### API E2E tests (tests/api/, Playwright, no browser)

- `tests/api/opaque-roundtrip.spec.ts` — full register→login round-trip against a live server. Asserts `export_key` stability across two logins with the same password. Asserts server-side `registrationRecord` is persisted. Asserts user-enumeration resistance (timing + response shape identical for known and unknown users within measurement tolerance).
- `tests/api/opaque-brute-force-resistance.spec.ts` — **adversarial**. Attempts 1000 logins with wrong passwords and asserts server-side rate limits kick in; asserts no timing signal that distinguishes correct password attempts from wrong password attempts after rate limit has been applied; asserts no information leak via error messages.
- `tests/api/opaque-server-compromise.spec.ts` — **adversarial**. Dumps the server's `user_opaque_records` table, asserts that the dumped material is useless for offline password recovery (the OPAQUE `registrationRecord` is construction-ally opaque; we verify by attempting to "decrypt" with 10 known wrong passwords and asserting each fails with the same error shape — the same shape as the correct password in an incomplete handshake — so there is no oracle).
- `tests/api/prf-fallback.spec.ts` — **adversarial**. Simulates a client that requests WebAuthn with PRF extension but the server responds without it; asserts the client falls back cleanly to OPAQUE or recovery phrase rather than silently succeeding with an insecure factor.
- `tests/api/recovery-phrase-rotate.spec.ts` — rotation endpoint happy path + rate limit (3/24h) + unauthorized (locked) rejection + audit entry verification.
- `tests/api/recovery-group.spec.ts` — full enrollment flow: hub create → group enroll → volunteer enrollment with envelope → full 2-of-3 recovery flow → completion with new device enrollment. Asserts audit entries at every step.
- `tests/api/recovery-group-threshold-boundary.spec.ts` — **adversarial**. Attempts to complete recovery with only 1 share contribution (rejected); attempts with 2 (succeeds); attempts with 3 (succeeds, extra share ignored); attempts with 2 shares after 24h delay (succeeds); attempts with 2 shares before delay (rejected unless emergency override + co-approval).
- `tests/api/recovery-group-audit.spec.ts` — **adversarial**. Attempts to skip the 24h delay without an emergency override and asserts the session is refused. Attempts to submit a `recovery_completed` sigchain entry without the required prior `recovery_initiated` and `recovery_share_contributed` entries, asserts rejected.
- `tests/api/factor-management.spec.ts` — adding and removing PRF / OPAQUE / recovery-phrase factors, `envelopes.length >= 2` invariant enforcement, multi-credential PRF envelope fanout.
- `tests/api/v2-format-migration.spec.ts` — fresh DB migration wipes any v2 `encrypted_secret_key` + `kek_proof_hash` columns and drops them; a fresh install post-migration uses only v3 factors. (This is the one-shot migration test.)

### UI E2E tests (tests/ui/, Playwright, Chromium)

- `tests/ui/prf-enrollment.spec.ts` — fresh onboarding flow: register PRF passkey → register second PRF passkey → generate recovery phrase → verify phrase re-entry → land on dashboard.
- `tests/ui/prf-unlock.spec.ts` — locked app → click "Unlock with passkey" → WebAuthn prompt (mocked via virtual authenticator) → worker unlocked → dashboard visible.
- `tests/ui/opaque-login.spec.ts` — a user who enrolled with OPAQUE logs in via password, unlocks, sees their notes decrypted.
- `tests/ui/prf-fallback-to-opaque.spec.ts` — locked app, PRF attempt fails (virtual authenticator returns no PRF), user clicks "Use password instead", OPAQUE flow runs, unlock succeeds.
- `tests/ui/recovery-phrase-entry.spec.ts` — user has lost their device, has their recovery phrase on paper, opens the app on a new device, clicks "Use recovery phrase", types 15 words, unlocks, dashboard visible.
- `tests/ui/recovery-phrase-entry-typo.spec.ts` — **adversarial**. Typing the phrase with one wrong word fails with a clear error and does not unlock.
- `tests/ui/recovery-group-enrollment.spec.ts` — hub admin enrolls a Recovery Group with 2-of-3 threshold, 3 admins selected. Volunteer enrollment ships a recovery envelope to the new group.
- `tests/ui/recovery-group-flow.spec.ts` — end-to-end: volunteer initiates recovery, two admins contribute shares, 24h delay (mocked via a test hook that advances the clock), volunteer completes recovery on a new device.
- `tests/ui/recovery-group-delay-enforcement.spec.ts` — **adversarial**. Volunteer attempts to complete recovery before 24h elapse. UI shows the remaining delay; completion button is disabled.
- `tests/ui/recovery-group-emergency-override.spec.ts` — admin triggers the emergency override, provides justification, gets a second admin's co-approval, completes recovery before 24h. The audit log shows both signatures.
- `tests/ui/factor-removal-rejection.spec.ts` — user tries to remove their only PRF credential while their only other factor is the recovery phrase; if `envelopes.length` would drop below 2, the API rejects; UI surfaces the error.
- `tests/ui/convenience-pin.spec.ts` — user unlocks with PRF, auto-lock fires (mocked timer), convenience-lock gate appears with PIN input, PIN entered correctly, back to unlocked state. A different PIN fails; 5 wrong attempts demote to full Locked.
- `tests/ui/capsule-invalidation-on-factor-change.spec.ts` — user is unlocked with an active capsule, adds a new PRF credential, opens a new tab, the new tab does *not* restore via the old capsule (because `rootKeyId` bumped), prompts for unlock again.

### Adversarial test coverage summary

| Attack | Test |
|---|---|
| Replay of OPAQUE login | `tests/api/opaque-brute-force-resistance.spec.ts` |
| Offline brute-force of leaked OPAQUE record | `tests/api/opaque-server-compromise.spec.ts` |
| PRF silent absence (dangerous fallback) | `tests/api/prf-fallback.spec.ts` |
| Shamir threshold boundary | `tests/api/recovery-group-threshold-boundary.spec.ts` |
| 24h delay bypass / audit gap | `tests/api/recovery-group-audit.spec.ts` |
| Factor removal that would drop below minimum | `tests/ui/factor-removal-rejection.spec.ts` |
| Recovery phrase typo | `tests/ui/recovery-phrase-entry-typo.spec.ts` |
| Unauthorized recovery completion | `tests/ui/recovery-group-delay-enforcement.spec.ts` |

Every adversarial test exercises a scenario the brief specifically called out. No test uses `getByText` or `getByRole({ name })` for interactive elements — all target stable `data-testid` attributes per the repo selector policy.

## Migration

Tier 2 is a one-shot migration. No backward-compatibility shim.

1. **`drizzle/migrations/XXXX_tier2_unlock_recovery.sql`** — generated via `bun run migrate:generate` after the schema changes land. Contents:
   - `DROP TABLE user_security_prefs.convenience_pin_hash` column (add it, actually — this is a new column for the demoted PIN).
   - `DELETE FROM users;` **(pre-prod wipe, followed by `ALTER TABLE users DROP COLUMN encrypted_secret_key`, `DROP COLUMN kek_proof_hash`)**. This is intentional: we are wiping all users because the v2 format is unrecoverable without a PIN that is no longer a KEK factor. In pre-prod environments (dev, test, demo), users re-enroll from scratch.
   - `CREATE TABLE opaque_server_setup (id int primary key check (id=1), setup bytea not null, created_at timestamptz not null default now());`
   - `CREATE TABLE user_opaque_records (user_pubkey text primary key references users(pubkey) on delete cascade, registration_record bytea not null, created_at timestamptz not null default now());`
   - `CREATE TABLE user_root_kek_envelopes (user_pubkey text primary key references users(pubkey) on delete cascade, bundle_json jsonb not null, root_key_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());`
   - `CREATE TABLE user_recovery_phrase_meta (user_pubkey text primary key references users(pubkey) on delete cascade, salt bytea not null, kdf_params jsonb not null, created_at timestamptz not null default now());`
   - `CREATE TABLE hub_recovery_groups (hub_id uuid primary key, group_public_key text not null, threshold int not null check (threshold >= 2), total_shares int not null check (total_shares >= 3 and total_shares <= 5), share_commitments jsonb not null, created_at timestamptz not null default now(), rotated_at timestamptz);`
   - `CREATE TABLE hub_recovery_group_shares (hub_id uuid references hub_recovery_groups(hub_id) on delete cascade, admin_pubkey text not null, share_envelope bytea not null, primary key (hub_id, admin_pubkey));`
   - `CREATE TABLE user_recovery_envelopes (user_pubkey text references users(pubkey) on delete cascade, hub_id uuid references hub_recovery_groups(hub_id) on delete cascade, envelope bytea not null, primary key (user_pubkey, hub_id));`
   - `CREATE TABLE recovery_sessions (session_id uuid primary key, hub_id uuid not null, user_pubkey text not null, coordinator_pubkey text not null, new_device_pubkey text not null, status text not null check (status in ('pending','ready','completed','expired','cancelled')), contributions jsonb not null default '[]'::jsonb, emergency_override jsonb, created_at timestamptz not null default now(), expires_at timestamptz not null);`
   - `CREATE INDEX recovery_sessions_hub_status_idx ON recovery_sessions(hub_id, status);`
2. **Drop obsolete tables and columns**. Deleted by the same migration:
   - `users.encrypted_secret_key` — no longer relevant.
   - `users.kek_proof_hash` — replaced by `user_security_prefs.convenience_pin_hash`.
3. **Client-side storage wipe**. The app's first-boot path after Tier 2 deletes any pre-existing `llamenos-encrypted-key-v2` localStorage entry and any stale session capsule. Users see the onboarding flow fresh.
4. **No data migration script**. The brief is explicit that pre-production lets us wipe; there is no production data to migrate.
5. **CI check.** A grep check in `biome.json` / `.github/workflows/ci.yml` rejects any reintroduction of `LABEL_NSEC_KEK_2F`, `LABEL_NSEC_KEK_3F`, `LABEL_KEK_PRF`, `LABEL_IDP_VALUE_WRAP`, `encrypted_secret_key`, or `kek_proof_hash`. These are dead names post-Tier-2.

## Out of scope

The following are deferred to later tiers and intentionally not addressed in Tier 2:

- **Per-device keys** — Tier 3. Tier 2 has one root KEK per user; Tier 3 splits this into per-device keys wrapped under a Per-User Key (PUK) with a user sigchain.
- **HPKE and non-extractable `CryptoKey`** — Tier 1. Tier 2 assumes Tier 1 is landed and uses non-extractable AES-KW keys throughout; if Tier 1 is delayed, Tier 2 falls back to extractable keys with a documented regression (covered in the plan's dependency gates).
- **Standard Notes `items_key` indirection** — Tier 1.
- **Voice E2EE** — Tier 5.
- **Delivery channel split, sandboxed crypto iframe** — Tier 4.
- **Post-quantum hybrid (ML-KEM-1024 + X25519)** — Tier 6.
- **User sigchain for device add/remove** — Tier 3.
- **MLS group state for hubs** — Tier 6.
- **Full public whitepaper / third-party audit** — parallel workstream, not blocked on Tier 2.
- **Device-linking redesign** — Tier 3. Tier 2 uses the existing provisioning room unchanged except for the enrollment-token transport.

## Success criteria

1. **PRF-primary unlock works end-to-end.** A volunteer who has registered two PRF-capable passkeys can open the app, tap their passkey, and land on the dashboard with all encrypted data decrypted — no PIN, no password, no recovery phrase involved.
2. **OPAQUE fallback works end-to-end.** A volunteer whose device does not support PRF can enroll via OPAQUE + recovery phrase and subsequently log in via OPAQUE. The server-side `user_opaque_records` table contains no recoverable password material (verified by `tests/api/opaque-server-compromise.spec.ts`).
3. **Recovery phrase entry unlocks on a fresh device.** A volunteer who has lost every enrolled device can type their 15-word recovery phrase on a new device and unlock.
4. **Recovery Group completes the 2-of-3 flow.** Two admins contribute Shamir shares → coordinator combines → the volunteer's root KEK is recovered → the volunteer completes fresh re-enrollment → audit sigchain shows the full flow.
5. **24-hour delay is enforced.** A volunteer who initiates a recovery cannot complete it in under 24 hours without an admin emergency override. The override requires two admins' signatures.
6. **`envelopes.length >= 2` is a hard invariant.** A user attempting to remove their last-but-one factor is rejected with a clear error. Every enrollment produces at least two envelopes.
7. **Factor rotation rotates the root KEK.** Removing a credential produces a `root_kek_rotate` audit entry and a new `rootKeyId`; the `items_key` is re-wrapped under the new root KEK.
8. **Audit sigchain verifies against Albrecht #1.** A compromised server that tries to silently inject a fake `recovery_completed` entry without the corresponding prior `recovery_initiated` + `recovery_share_contributed` entries is rejected by the client-side chain verifier.
9. **No PIN-bits of entropy in the KEK.** Static code analysis (grep) confirms that no KEK derivation path calls the PIN except in the convenience-lock gate (which is not a KEK derivation).
10. **One-shot migration succeeds.** The migration wipes v2 artifacts and onboards users fresh with no backward-compatibility surface. CI blocks any reintroduction of deprecated labels.
11. **All tests pass.** Unit + API E2E + UI E2E suites green on CI.
12. **Typecheck + build + lint pass.** `bun run typecheck && bun run lint && bun run build` produces no errors.

## Verified external surfaces

Per the user's directive, every third-party library and API referenced in this spec was verified against current documentation via context7 and web search during authoring (April 2026):

| Surface | Source | Verified fact |
|---|---|---|
| WebAuthn PRF extension (L3 §10.1.4 `prf`) | MDN `Web_Authentication_API/WebAuthn_extensions`; W3C `TR/webauthn-3`; Chrome Status 5138422207348736; Yubico Developers Guide to PRF; Corbado 2026 guide; Bitwarden PRF blog | Stable in Chrome since 116 for platform auth; PRF-on-create in Chrome 147; Firefox 148+; Windows Hello PRF via Windows 11 25H2 KB5077181 (Feb 2026); Safari 18 iCloud Keychain only (not YubiKey-on-Safari-iOS). `clientExtensionResults.prf.{enabled, results: {first: ArrayBuffer}}` shape. |
| `@simplewebauthn/browser` `startRegistration` / `startAuthentication` | context7 `/websites/simplewebauthn_dev` (v13.x) | `optionsJSON` accepts PRF via a top-level `extensions` object we add manually — SimpleWebAuthn <13.4 types do not carry PRF through. Shape is `{ prf: { eval: { first: base64url } } }`. |
| `@serenity-kit/opaque` | npm + GitHub `serenity-kit/opaque` (April 2026); context7 `/theuntraceable/better-auth-opaque` (example integration) | Client: `opaque.client.startRegistration/finishRegistration/startLogin/finishLogin`. Server: `opaque.server.createSetup/createRegistrationResponse/startLogin/finishLogin`. Argon2id capped at m=2^21-1 KiB in browser WASM. `@serenity-kit/opaque` ristretto255 + SHA-512 + Argon2id. `keyStretching` parameter on client-side calls. `getPlaceholderRegistrationRecord` for user enumeration resistance. OTF Red Team Lab audited. `exportKey` is 64 bytes (SHA-512 output). |
| OPAQUE protocol (RFC 9807) | docs.rs `opaque-ke` 4.0.0-pre; RFC 9807 | 4-message registration + 3-message login. Client computes `export_key` after `finishRegistration` (registration path) or `finishLogin` (login path), same value in both. Server's `ServerSetup` must be persisted across restarts — regenerating invalidates all records. |
| Argon2id parameters (OWASP Cheat Sheet) | OWASP `Password_Storage_Cheat_Sheet` (April 2026 revision) | Recommended floors: `m=47104 (46 MiB), t=1, p=1` or `m=19456 (19 MiB), t=2, p=1`. Use Argon2id variant (balanced side-channel + GPU resistance). |
| `@noble/hashes/argon2.js` | @noble/hashes in our lockfile | Already a direct dependency. API: `argon2id(ikm, salt, { t, m, p, dkLen })`. In-process, no WASM needed. |
| EFF large wordlist | eff.org `files/2016/07/18/eff_large_wordlist.txt` | 7776 words, 6^5 combinations, ~12.9 bits/word. Published July 2016. 15 words ≈ 194 bits of entropy. |
| `shamir-secret-sharing` (privy-io) | npm + GitHub `privy-io/shamir-secret-sharing` (April 2026) | Zero-dependency TypeScript, GF(2^8). API: `split(secret: Uint8Array, shares: number, threshold: number): Promise<Uint8Array[]>` and `combine(shares: Uint8Array[]): Promise<Uint8Array>`. Independently audited by Cure53 and Zellic. Does **not** verify the reconstructed secret — we must add a separate integrity check (SHA-256 commitment). |
| WebCrypto `AES-KW` | MDN `SubtleCrypto.wrapKey/unwrapKey`; W3C WebCrypto L2 | Supports both `wrapKey` and `unwrapKey` usages for a non-extractable key. Required for the `items_key` / root KEK wrapping pattern without extracting bytes. |
| `@hpke/core` (Tier 1 dependency) | `github.com/dajiaji/hpke-js` | Assumed already imported by Tier 1. Used here for share envelope wrapping and for `user_recovery_envelopes` payload encryption. |

Any future deviation from the above (e.g. the `@serenity-kit/opaque` API changes, Chrome removes PRF-on-create) invalidates parts of the spec and requires re-verification before implementation.
