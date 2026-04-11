# Tier 2 — Unlock & Recovery Overhaul (Spec Brief)

**Date:** 2026-04-10
**Master doc:** [`../SECURITY_IMPROVEMENTS_MASTER.md`](../SECURITY_IMPROVEMENTS_MASTER.md) §3.9.2 (PRF), §3.9.4 (OPAQUE), §3.4.2 (1Password Recovery Group), §7 Tier 2
**Effort:** Weeks
**Depends on:** Tier 1 (non-extractable CryptoKey + HPKE are the foundation the new factors wrap)
**Status:** Absorbed into spec
**Spec:** [`../../superpowers/specs/2026-04-10-security-tier-2-unlock-recovery-design.md`](../../superpowers/specs/2026-04-10-security-tier-2-unlock-recovery-design.md)
**Plan:** [`../../superpowers/plans/2026-04-10-security-tier-2-unlock-recovery.md`](../../superpowers/plans/2026-04-10-security-tier-2-unlock-recovery.md)

## Goal

Replace the PIN+Argon2id KEK as the primary unlock mechanism with **WebAuthn PRF** (hardware-rooted, passwordless), add **OPAQUE** login so the server never sees password material, replace the 6-digit PIN recovery path with a **Diceware recovery phrase**, and introduce a **1Password-style Recovery Group** construction for admin-assisted recovery without weakening E2EE.

After this tier, a volunteer's typical unlock flow is: tap the passkey → app unlocked. No typing, no low-entropy secret on disk, no server-side password brute-forcing possible.

## Why this matters

Our current KEK has a fundamental weakness: **Argon2id over a 4–6 digit PIN is ~14–20 bits of real entropy**. If a leaked IDB blob ever reaches an attacker, it's crackable in hours on a single GPU. The multi-factor KEK mitigates this (PIN must be combined with recovery key or WebAuthn blob to unlock), but the PIN is still on the attack surface and it's still the default path volunteers use.

Three independent 2024–2026 improvements eliminate this:

1. **WebAuthn PRF** (`hmac-secret`) — the authenticator holds a 32-byte seed and returns `HMAC(seed, salt)` on request. Seed is hardware-rooted (TPM, Secure Enclave, YubiKey). Output has 256 bits of entropy and can't be brute-forced offline because it depends on hardware interaction. This is what 1Password, Dashlane, and Bitwarden (2026.1) now use for vault unlock.

2. **OPAQUE (RFC 9807)** — asymmetric PAKE published mid-2025. Client proves password knowledge via blind OPRF; server holds an opaque envelope only the right password can unlock. **Both sides derive session keys PLUS the client gets a stable `export_key`** — a deterministic high-entropy secret the server never sees, usable as a KEK. Server-side DB breach = useless for offline password cracking.

3. **1Password Recovery Group** — at vault creation, the user's encryption key is additionally wrapped under a "recovery group" public key. Recovery is: user runs signup flow again with a fresh key; an existing recovery-group member decrypts the old vault key using the group's private key (which they hold because the group-private is wrapped for each group member via the normal chain) and re-wraps under the user's new key. **Server orchestrates but never sees plaintext key material.**

Combined: **no password in the database ever, passkey-primary unlock, admin-assisted recovery without weakening E2EE.** This is the modern best-in-class pattern.

## Current Llamenos state

**Files to explore:**

- `src/client/lib/key-store-v2.ts` — current multi-factor KEK. After Tier 1 it stores non-extractable AES-KW `CryptoKey`s derived from each factor.
- `src/client/lib/webauthn.ts` (or similar) — existing WebAuthn flows (login, likely no PRF yet).
- `src/server/lib/webauthn.ts` — server-side WebAuthn challenge + response handling.
- `src/server/routes/auth-facade.ts` — `/api/auth/*` endpoints; this is where OPAQUE handshake endpoints live.
- `src/server/idp/authentik-adapter.ts` — IdP integration; OPAQUE may coexist with or replace Authentik password flow.
- `src/client/lib/auth.tsx` — auth context provider.
- `src/client/lib/key-manager.ts` — unified auto-lock from PR #43.
- `src/server/db/schema.ts` — `user_sessions`, `user_security_prefs`, plus new tables for OPAQUE envelopes + recovery group shares.
- `src/client/components/unlock-prompt.tsx` (or similar) — PIN prompt UI that needs to become a passkey prompt + Diceware fallback.
- `src/shared/schemas/auth.ts` — zod schemas for auth endpoints.

**Existing patterns:**
- Dev/test mode uses synthetic IdP values (`AUTH_MODE=synthetic`).
- Opaque server-side session tokens (the *other* "opaque" — unrelated naming collision).
- WebAuthn RP ID / origin / name env vars.
- Authentik is the IdP; auth facade abstracts it.

**Watch-outs:**
- **Naming collision:** "OPAQUE" (the PAKE protocol, RFC 9807) vs "opaque session tokens" (our unrelated server-side rotating tokens). Spec should use "OPAQUE-PAKE" or "RFC 9807" to disambiguate.
- Authentik first-boot takes ~60s to initialize.
- Dev/test synthetic mode must continue to work after this tier lands.

## Proposed approach

### 2.1. WebAuthn PRF as the primary KEK factor

**Pattern (Corbado / Bitwarden 2026 / 1Password):**

```typescript
// At enrollment (either new account or adding a passkey to existing account):
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: randomBytes(32),
    rp: { id: env.AUTH_WEBAUTHN_RP_ID, name: 'Llamenos' },
    user: { id: userId, name: userLabel, displayName: userLabel },
    pubKeyCredParams: [{ type: 'public-key', alg: -8 /* Ed25519 */ }, { type: 'public-key', alg: -7 /* ES256 */ }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    extensions: {
      prf: { eval: { first: utf8Bytes(LABEL_PRF_KEK_SALT_V1) } }
    }
  }
}) as PublicKeyCredential
// Confirm credential.extensionResults.prf.enabled === true

// On unlock:
const assertion = await navigator.credentials.get({
  publicKey: {
    challenge: randomBytes(32),
    allowCredentials: [{ id: storedCredentialId, type: 'public-key' }],
    userVerification: 'required',
    extensions: {
      prf: { eval: { first: utf8Bytes(LABEL_PRF_KEK_SALT_V1) } }
    }
  }
}) as PublicKeyCredential

const prfOutput = (assertion.getClientExtensionResults() as any).prf.results.first  // Uint8Array(32)

// HKDF the PRF output into a KEK, import as non-extractable AES-KW key:
const kekMaterial = hkdfSha256(prfOutput, /* salt */ undefined, utf8Bytes(LABEL_KEK_DERIVE), 32)
const kek = await crypto.subtle.importKey('raw', kekMaterial, 'AES-KW', false, ['unwrapKey'])
// kekMaterial is a Uint8Array; zero it immediately after import
kekMaterial.fill(0)
```

**Minimum credentials at onboarding:** Register **two** PRF-capable credentials. Typical pairs:
- Platform passkey (iCloud Keychain / Windows Hello / Android) + a hardware YubiKey.
- Platform passkey on laptop + platform passkey on phone (synced via provider).
- Platform passkey + recovery phrase (counts as a "credential" cryptographically).

Losing the only credential = losing the data (unless Recovery Group is enabled).

**PRF capability detection:**
- Not all authenticators support PRF (notably Safari + YubiKey combo as of early 2026).
- After `create()`, check `extensionResults.prf.enabled`. If false, this authenticator can't be used as a PRF factor — fall back to registering it for a different purpose or rejecting it.
- UI must handle "your authenticator doesn't support PRF, please use another" gracefully.

**Cross-credential compatibility:**
- Each credential has its own PRF seed. The PRF output for the same salt will be *different* per credential.
- Solution: at enrollment, after deriving the KEK from the first credential, the device generates a random "root KEK" (non-extractable AES-KW) and stores copies wrapped under each credential's PRF-derived KEK in IDB. Unlock with any one credential unwraps the root KEK.
- This is the multi-credential PRF pattern 1Password uses.

### 2.2. OPAQUE (RFC 9807) login

**Replace (or augment) Authentik password login with OPAQUE.** The server no longer sees any password material and the client gets a stable `export_key` for free on every successful login.

**Library:** `@serenity-kit/opaque` — WASM of `facebook/opaque-ke`, audited by OTF Red Team Lab. Alternative: direct use of `opaque-ke` via a Rust/WASM build.

**Flow:**
```
Registration:
  Client: registrationRequest(password) → registrationRequestBytes
  Server: registrationResponse(registrationRequestBytes, serverSetup, credentialIdentifier) → registrationResponseBytes
  Client: finishRegistration(password, registrationResponseBytes) → { registrationRecord, exportKey }
  Client: store a copy of exportKey (or derive KEK from it); send registrationRecord to server
  Server: persist registrationRecord keyed by credentialIdentifier

Login:
  Client: startLogin(password) → { clientLoginState, startLoginRequest }
  Server: startLogin(serverSetup, registrationRecord, startLoginRequest, credentialIdentifier) → { serverLoginState, loginResponse }
  Client: finishLogin(clientLoginState, loginResponse, password) → { finishLoginRequest, sessionKey, exportKey }
  Server: finishLogin(serverLoginState, finishLoginRequest) → serverSessionKey
  // sessionKey === serverSessionKey on success
  // exportKey is available only on the client
```

**Integration with Llamenos auth facade:**
- `POST /api/auth/opaque/register/init` — client sends registrationRequestBytes
- `POST /api/auth/opaque/register/finish` — client sends registrationRecord
- `POST /api/auth/opaque/login/init` — client sends startLoginRequest
- `POST /api/auth/opaque/login/finish` — client sends finishLoginRequest

Or one pair with phases bundled. Pick zod schemas carefully; the OPAQUE byte blobs are opaque to zod beyond length.

**Authentik coexistence:** Authentik remains the IdP for SSO / OIDC. OPAQUE handles the password path for users who prefer passwords over passkeys (or as a fallback). Spec should document the decision tree:
- Primary path: WebAuthn passkey (PRF-backed).
- Fallback: OPAQUE password login.
- OIDC SSO via Authentik: for org-wide identity providers.
- Legacy: ? (depends on current state)

**`export_key` usage:** Same pattern as PRF — HKDF into a non-extractable AES-KW `CryptoKey` that unwraps the root KEK.

**Tuning:** `@serenity-kit/opaque` caps Argon2id memory at `2^21 - 1` KiB for browser reasons. Document and accept.

### 2.3. Diceware recovery phrase

Replace "6-digit PIN" as the fallback factor with a **Diceware-style recovery phrase** (15+ words). This is a *credential*, not a UX nicety — at 15 words from the EFF large wordlist, entropy is ~194 bits.

- Generated at enrollment with `crypto.getRandomValues()` → index into wordlist.
- Shown to the user ONCE on a "recovery sheet" screen with "I have written this down safely" confirmation.
- On recovery: user types the phrase; client Argon2id-derives a KEK and unwraps the root KEK.
- Storage: NOT stored on the device by default. If the user wants their device to remember it, we can optionally store a non-extractable derived key in IDB (same pattern as PRF KEK).

**Why Diceware over PIN:**
- 6-digit PIN: ~20 bits entropy, crackable offline from a leaked blob in minutes.
- 15-word Diceware: ~194 bits entropy, uncrackable.
- 15 words is long, but it's the *recovery* phrase, not the daily unlock.

**Keep a PIN?** If volunteers insist on a quick unlock, the PIN can still exist as a *session-timeout re-lock* factor — NOT as a KEK factor. The session-timeout lock re-prompts for PIN; the passkey is still the real KEK source. PIN becomes convenience, not security.

### 2.4. 1Password-style Recovery Group

**The admin-assisted recovery path.**

**Construction:**
1. At hub creation, generate a **recovery group X25519 keypair** `(RG_pub, RG_priv)`.
2. Split `RG_priv` via **Shamir's Secret Sharing (2-of-3)** across three designated admins.
3. Each admin holds their share encrypted under their own identity/device key.
4. At each volunteer's enrollment, wrap the volunteer's root KEK under `RG_pub` and store as `recovery_envelope` in IDB + server.

**Recovery flow (volunteer Carol lost her passkey and recovery phrase):**
1. Carol signals "I need recovery" via the auth facade.
2. Two admins (Alice and Bob, holding Shamir shares 1 and 2) cooperate:
   - Alice decrypts her Shamir share.
   - Bob decrypts his Shamir share.
   - Both submit to a coordinating client (Alice's or a fresh Carol device).
   - Coordinator combines shares → `RG_priv`.
   - Coordinator fetches Carol's `recovery_envelope` from the server.
   - Coordinator decrypts `recovery_envelope` with `RG_priv` → Carol's root KEK.
3. Carol runs a fresh enrollment (new passkey, new recovery phrase).
4. Coordinator wraps Carol's root KEK under Carol's new passkey-derived KEK and uploads.
5. `RG_priv` is zeroed on the coordinator.
6. Carol's old credentials are revoked via sigchain entry (Tier 3 dependency — in Tier 2, revocation is simpler).

**Threshold choice:** 2-of-3 balances "no single admin can recover Carol alone" with "two admins can always recover even if a third is unavailable". 3-of-5 is the next reasonable option for larger hubs.

**Why Shamir and not "N individual wrappings":** With Shamir, losing any single admin's share does not compromise the recovery. With N individual wrappings, one admin can recover alone (too much power).

**Audit sigchain entries:**
- `recovery_group_enroll(hub_id, threshold, share_commitments[])` — at hub creation.
- `recovery_initiated(user_id, by_admin_id, timestamp)` — when recovery is requested.
- `recovery_completed(user_id, new_device_id, shared_by[])` — when recovery finishes.

**UI affordances:**
- Admins must see clear "you are participating in recovery" UI — never silent.
- Volunteer must see "your account was recovered on {date} by admins {list}" notification.
- Hub audit log surfaces every recovery event.

**Trade-offs:**
- This is cryptographically stronger than Bitwarden's enterprise recovery and comparable to 1Password Business.
- It does mean admins, cooperating in pairs, can theoretically recover any volunteer's data even without their consent. This is the **inherent Recovery Group trade-off** — 1Password explicitly acknowledges it ("Beware of the Leopard" page).
- Recovery Group enrollment must be **explicit at onboarding**, not implicit. Volunteers who don't opt in have no recovery path beyond their passkey + Diceware phrase.
- Spec should explore opt-in UX carefully.

## Open design questions

1. **PRF salt strategy.** One global salt or per-credential salts? Recommend one global salt constant (`LABEL_PRF_KEK_SALT_V1`) with version suffix for future rotation.
2. **Multi-credential root KEK enrollment.** Each new passkey adds a wrapping of the root KEK under that credential's PRF-derived KEK. Does removing a credential re-wrap the root KEK, or just remove that copy? Remove is simpler; rotate is safer. Decide.
3. **OPAQUE vs passkey-only.** If we're shipping PRF, do we even need OPAQUE? Yes — (a) some devices still lack PRF support; (b) OPAQUE's `export_key` gives us a *second* independent factor that can be combined via HKDF; (c) Authentik OIDC integration is a different path. Decide the role OPAQUE plays.
4. **Diceware wordlist.** EFF large (7776 words, 12.9 bits/word) or short (1296 words, 10.3 bits/word)? Recommend EFF large at 15 words for ~194 bits.
5. **Recovery Group threshold.** 2-of-3 default? Hub admin settable? Recommend 2-of-3 default, configurable per-hub with a maximum 3-of-5.
6. **Recovery Group opt-in UX.** Required at onboarding or optional? Recommend required unless volunteer explicitly declines with an "I understand I cannot recover my data if I lose all my credentials" checkbox.
7. **PIN as convenience re-lock factor.** Keep for quick unlock or retire entirely? Recommend keep as optional session-timeout re-prompt, NOT as KEK.
8. **Passkey-only volunteers vs SSO via Authentik.** How do they coexist? Recommend: passkey for volunteers; SSO via Authentik for admins who already have org identity.
9. **Key rotation when a passkey is compromised.** This needs sigchain (Tier 3 dependency). In Tier 2, we can only remove the credential; full rotation waits for Tier 3.
10. **Delay between recovery request and recovery completion.** Immediate or 24h "security delay" to allow the volunteer to see the notification and cancel? Recommend 24h default with admin-emergency-override requiring logged justification.

## Concrete scope

**In scope:**
- WebAuthn PRF enrollment + unlock flow.
- Multi-credential root KEK wrapping.
- OPAQUE (RFC 9807) server-side setup + client-side flow via `@serenity-kit/opaque`.
- OPAQUE `/api/auth/opaque/*` endpoints in the auth facade.
- Diceware recovery phrase generation + Argon2id derivation + unwrap.
- Shamir 2-of-3 secret sharing of the Recovery Group private key.
- Recovery Group enrollment at hub onboarding.
- Recovery flow UI (admin coordination, volunteer notification).
- Sigchain entries for Recovery Group events (depends on Tier 0 typed entries).
- PIN deprecation / conversion to convenience re-lock factor.
- Settings UI for managing credentials, recovery phrase, Recovery Group.
- Unit tests for all crypto paths.
- API tests for OPAQUE flow + Recovery Group flow.
- UI tests for enrollment + recovery.

**Out of scope:**
- Per-device keys (Tier 3 — Tier 2 still has "per-user root KEK").
- User sigchain extension for device add/remove (Tier 3).
- Voice E2EE (Tier 5).
- Delivery hardening (Tier 4).
- Post-quantum recovery paths (Tier 6).

## Success criteria

1. Volunteer can enroll with two passkeys + a recovery phrase and use the app normally.
2. Losing one passkey does not lock the account (the other passkey or recovery phrase still works).
3. Losing all credentials triggers the Recovery Group flow, which successfully recovers the account with participation from ≥2 admins.
4. OPAQUE login works end-to-end against a real backend; server DB contains no recoverable password material.
5. PRF path tested on Chrome desktop, Chrome Android, Safari macOS, Safari iOS (where supported), Firefox.
6. Diceware phrase is shown once, verified via re-entry, and successfully unlocks on a fresh device.
7. Recovery Group threshold-sharing, admin coordination UX, and audit log entries all work.
8. PIN is either retired or clearly relegated to convenience re-lock.
9. Existing users (if any) have a clear migration path from current multi-factor KEK.
10. Typecheck + build + all tests pass.

## Trade-offs and anti-patterns

**Do:**
- Enroll two credentials at onboarding. Refuse to proceed without two.
- HKDF every factor output immediately and import as non-extractable. Never let raw key bytes live in JS.
- Log every Recovery Group operation to the audit sigchain.
- Notify the volunteer of recovery attempts.

**Don't:**
- Ship a single-credential account. Losing one = losing the data.
- Keep "6-digit PIN" as a KEK factor. Move it to convenience re-lock or retire.
- Let recovery happen without volunteer notification + admin audit trail.
- Let a single admin complete Recovery alone. Two minimum.
- Roll your own OPAQUE. Use `@serenity-kit/opaque`.

## Pointers to primary sources

**Must read:**
- Corbado PRF for E2EE guide (2026): https://www.corbado.com/blog/passkeys-prf-webauthn
- Bitwarden on PRF: https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/
- Yubico PRF developers guide: https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html
- RFC 9807 OPAQUE: https://datatracker.ietf.org/doc/rfc9807/
- `@serenity-kit/opaque` README + docs: https://github.com/serenity-kit/opaque
- 1Password Recovery Group ("Restoring Access"): https://agilebits.github.io/security-design/restore.html
- 1Password "Beware of the Leopard": https://agilebits.github.io/security-design/leopard.html
- Shamir's Secret Sharing libs: `@stablelib/shamir` or `secrets.js-grempe`
- EFF large wordlist: https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt

**Optional context:**
- 1Password white paper full: https://agilebits.github.io/security-design/
- WebAuthn L3 PRF: https://w3c.github.io/webauthn/#prf-extension
- Non-extractable CryptoKey from PRF (W3C issue): https://github.com/w3c/webauthn/issues/1895

## Related work in the repo

- Tier 0 (label enforcement) — prerequisite for typed sigchain entries.
- Tier 1 (non-extractable CryptoKey + HPKE) — prerequisite for wrapping the root KEK.
- PR #48 PIN prompt flow — gets replaced/deprecated by this tier.
- PR #43 auto-lock — remains, but the unlock prompt becomes passkey-first.
- `src/server/idp/authentik-adapter.ts` — continues to handle OIDC; OPAQUE is a parallel path.
- Authentik integration — OPAQUE does NOT replace Authentik; they coexist.
