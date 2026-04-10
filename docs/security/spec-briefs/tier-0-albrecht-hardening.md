# Tier 0 — Albrecht Hardening (Spec Brief)

**Date:** 2026-04-10
**Master doc:** [`../SECURITY_IMPROVEMENTS_MASTER.md`](../SECURITY_IMPROVEMENTS_MASTER.md) §3.3, §3.11, §5.2, §7 Tier 0
**Effort:** Days
**Depends on:** nothing
**Status:** Ready for spec authoring

## Goal

Defensive hardening of Llamenos' existing cryptographic layer against published attack classes — specifically the Albrecht 2022/2023 attacks on Matrix and the Backendal et al. 2022 / Albrecht et al. 2023 attacks on Mega — without changing any architectural primitive. This is a pure audit-and-tighten pass plus browser-level hardening headers.

**No architecture change. No new dependencies. Drop-in defensive fixes.**

## Why this matters

Our current hub-key + ECIES-per-member design is **structurally identical to Matrix Megolm-Sender-Keys**. That's validating (most-audited web group-crypto in production) but also means we inherit Megolm's attack surface. Three of the five published Albrecht attacks could apply directly to us if we're not defensive at the implementation level, and the Mega attacks set the audit bar for any AEAD/domain-separation hygiene we've slipped on.

Every fix in this tier maps to a published real-world exploit:

| Fix | Attack it prevents | Source |
|---|---|---|
| Strict label enforcement at decrypt call sites | Olm/Megolm type confusion | Albrecht CVE-2022-39251, -39255, -39248 |
| Signed membership into audit sigchain before rewrap | Homeserver-controlled membership injection | Albrecht #1 |
| IV + framing covered by AEAD tag on exports | IND-CCA break in key backup | Albrecht #5 |
| AEAD audit of every ciphertext column | RSA key recovery, plaintext recovery, framing, all-zero-key | Backendal/Haller/Paterson 2022 + Albrecht 2023 |
| Domain-separation audit (no raw string literals in crypto paths) | Mega master-key reuse | Backendal/Haller/Paterson 2022 |
| Strict CSP L3 + Trusted Types + COOP/COEP | Generic DOM XSS → key exfil | (defensive; no single CVE) |

## Current Llamenos state

**Relevant files to explore in the spec session:**

- `src/shared/crypto-labels.ts` — the 25 domain-separation constants. **Every decrypt call site should reference one of these.**
- `src/client/lib/crypto-worker.ts` — main crypto op entry point on the client.
- `src/client/lib/crypto-worker-client.ts` — typed RPC client for the worker.
- `src/client/lib/key-store-v2.ts` — multi-factor KEK key store.
- `src/server/db/crypto-columns.ts` — defines the `ciphertext()` column type. **Audit every use.**
- `src/server/services/audit-service.ts` (or equivalent) — hash-chained audit log implementation (Epic 77).
- `src/client/lib/hub-key-manager.ts` — hub key rotation and distribution logic.
- `src/shared/types.ts` — `Ciphertext` branded type.
- `vite.config.ts` + `src/server/app.ts` + Hono middleware — where CSP / COOP / COEP headers would be set.
- `.github/workflows/release.yml` — where cosign and SLSA provenance would be plumbed.
- `scripts/verify-build.sh` — extended to verify cosign signatures.

**Existing patterns to respect:**

- Biome for linting.
- Bun for tests (`bun:test` for unit, Playwright for API + UI).
- React Query mutations MUST invalidate on success.
- All mutations via React Query hooks, never direct API calls.

## Proposed approach

Six workstreams, each shippable independently but batched into one PR:

### 0.1. Label enforcement at decrypt call sites

**The most important fix.** Albrecht #3 was exactly "matrix-js-sdk accepted the wrong envelope type at a decrypt entry point". We prevent the same by making the label part of the decrypt call signature.

**Sketch:**
```typescript
// Before (vulnerable to type confusion):
async function decryptEnvelope(envelope: Envelope, recipientKey: PrivateKey): Promise<Uint8Array>

// After (type-safe, label-enforced):
async function decryptEnvelope(
  envelope: Envelope,
  recipientKey: PrivateKey,
  expectedLabel: CryptoLabel,  // from crypto-labels.ts
): Promise<Uint8Array> {
  if (envelope.label !== expectedLabel) {
    throw new CryptoLabelMismatchError({ expected: expectedLabel, actual: envelope.label })
  }
  // ... rest of decrypt
}
```

Every call site must pass the expected label. The envelope format must carry the label in a position covered by the AEAD tag (or in the HKDF context — both are acceptable because either way tampering with the label would fail decrypt).

**Scope of audit:** grep for every `.decrypt(`, `decryptSeal`, `openSealed`, `nacl.box.open`, etc. Every one must pass through a function that takes an `expectedLabel` parameter.

### 0.2. Signed membership into audit sigchain before rewrap

**Albrecht #1 defense.** When admin adds a volunteer, the current flow (presumably) is: admin calls API → server updates membership → client fetches new member list → client rewraps hub key for new list. **The server-returned member list is trusted blindly.**

Fix: admin signs the membership delta (`add(user_id=X, role=volunteer)`) with their device Ed25519 key, submits to the server as a new audit-log entry. The audit-log entry is chained via `previousEntryHash`. Other clients fetch the chain, verify the signature, and ONLY THEN use the new member list for rewrap.

**This requires:**
- Defining a typed schema for audit-log entries (zod schema in `src/shared/schemas/`).
- `membership_add`, `membership_remove`, `role_change`, etc. as distinct entry types with distinct labels.
- Client-side chain verification before any hub-key operation.

**Existing audit-log primitive** (Epic 77) already handles the hash chain — this brief extends it with signed typed entries. Spec author should check whether the existing primitive supports typed payloads or needs extension.

### 0.3. AEAD audit of every ciphertext() column

**Mega lesson.** Every column using `ciphertext()` type must be AEAD (XChaCha20-Poly1305 with authenticated metadata). No CBC without HMAC-covering-IV, no ECB, no bare AES-GCM without AAD covering the record identifier.

**Audit steps:**
1. Grep `ciphertext(` in `src/server/db/schema.ts` and related. List every column.
2. For each, trace the encrypt call site and verify:
   - AEAD primitive (XChaCha20-Poly1305).
   - AAD includes the record identifier (UUID, row PK) to prevent cross-record substitution.
   - Random nonce (192-bit for XChaCha).
   - Label from `crypto-labels.ts`.
3. Produce an audit report as part of the spec.

### 0.4. Export-path integrity (Albrecht #5)

Anywhere we produce an encrypted export or backup (voicemail, attachments, user exports), verify the AEAD tag covers the IV and all framing metadata. If we have an export path that's encrypt-then-MAC on raw ciphertext without IV, fix it.

**Current state check:** Does `src/server/services/storage-manager.ts` (RustFS integration) do any export encryption? If so, audit.

### 0.5. Strict CSP L3 + Trusted Types + COOP/COEP

**Free defense-in-depth.** Production CSPs from Signal web, Proton Mail, CryptPad all ship with:

```
default-src 'none';
script-src 'nonce-{nonce}' 'strict-dynamic';
style-src 'self' 'nonce-{nonce}';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' wss://relay.llamenos.example;
worker-src 'self' blob:;
frame-ancestors 'none';
base-uri 'none';
form-action 'none';
require-trusted-types-for 'script';
trusted-types default llamenos-policy;
```

Plus:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp` (also unlocks `SharedArrayBuffer` for the Whisper worker)
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy: ...` disabling dangerous features per-document

**Practical concerns:**
- React 18+ supports Trusted Types cleanly but needs a policy definition.
- Nonces must be per-response — look at how vite-plugin-pwa interacts with the service worker.
- The Nostr relay WSS connect must be in `connect-src`.
- Inline styles from shadcn/ui components may need nonce propagation.

### 0.6. Cosign + SLSA provenance + SBOM

**Publish-and-verify hardening.** Current state: reproducible builds + CHECKSUMS.txt in GitHub Releases.

Additions:
- `cosign sign-blob` detached signature of CHECKSUMS.txt using Sigstore keyless signing.
- SLSA Level 3 provenance attestation (`.intoto.jsonl`) emitted by GitHub Actions build.
- CycloneDX SBOM generated by `bun pm` or `syft` and attached to each release.
- `scripts/verify-build.sh` extended to verify cosign signatures + provenance.

Optional but cheap: append release hashes to Sigstore Rekor for a public transparency log.

## Open design questions for the spec author

1. **Label-at-decrypt API shape.** Does every decrypt go through a single `decryptEnvelope` helper, or are there multiple (per tier)? Prefer a single entry point.
2. **Envelope format versioning.** Should the label live in the ciphertext framing header or in HKDF context? Both work; ciphertext framing is slightly more robust because mismatch fails AEAD-tag check with no additional code. Pick one and document.
3. **Audit-log entry schema.** What fields does a typed entry need beyond `type`, `payload`, `signer_device_id`, `signature`? Check existing Epic 77 primitive.
4. **Chain verification frequency.** Verify the whole chain on every hub-key op, or cache verification up to a known-good index? Cache is fine for performance but needs cache invalidation on new entry.
5. **CSP migration strategy.** Roll CSP out in `Content-Security-Policy-Report-Only` first to catch violations, then upgrade to enforcement? Recommend yes.
6. **Trusted Types default policy name.** Match React's convention (`default`)? Or a Llamenos-specific policy?
7. **Export path audit scope.** Does "any encrypted export" include things like the admin settings export, the hub membership export, or just voicemail/attachments? Define the scope.
8. **SLSA Level target.** Level 3 requires hermetic builds + provenance signing. We have most of it. Confirm.

## Concrete scope

**In scope:**
- Label enforcement refactor across all decrypt call sites.
- Audit of every `ciphertext()` column + encrypt call site for AEAD + AAD.
- Typed signed audit-log entries for hub membership changes.
- Chain verification before hub-key rewrap.
- Export/backup path AEAD audit.
- CSP L3 + Trusted Types + COOP/COEP/CORP headers.
- Cosign signing + SLSA provenance + SBOM publishing.
- `verify-build.sh` extended.

**Out of scope:**
- Changing the underlying primitive (still ECIES + XChaCha20-Poly1305, no HPKE yet — that's Tier 1).
- Changing the key management model (still per-user identity key, no per-device keys — that's Tier 3).
- Changing the unlock flow (still PIN-based, no PRF — that's Tier 2).
- Splitting the delivery origin (that's Tier 4).
- Any voice work (Tier 5).

## Success criteria

The spec is complete when:

1. Every existing decrypt call site is audited and updated to pass an explicit expected label.
2. Every `ciphertext()` column has documented AEAD provenance (which label, which AAD, which call site).
3. A new typed-audit-log-entry schema is defined with client-side chain verification.
4. Hub key rewrap requires a verified chain entry for the membership delta.
5. CSP + Trusted Types + COOP/COEP headers are set in the Hono middleware layer, `-Report-Only` rollout plan documented.
6. Cosign + SLSA provenance + SBOM pipeline documented with example artifacts.
7. `verify-build.sh` updated.
8. All existing tests still pass (this is defensive; no behavior change).
9. New tests: chain verification rejects unsigned/tampered entries; decrypt rejects mismatched labels.

## Trade-offs and anti-patterns

**Do:**
- Fail closed on label mismatch — never silently accept "close enough".
- Make the label part of the ciphertext integrity (AEAD-covered).
- Keep the existing primitive (XChaCha20-Poly1305). Don't "while we're here" upgrade.
- Use `-Report-Only` CSP for at least one release before enforcing.
- Use cosign keyless (OIDC) signing to avoid managing a private signing key.

**Don't:**
- Let this spec grow into Tier 1 territory. HPKE is tempting but out of scope.
- Patch symptoms with format checks (Albrecht-follow-up / Caveat Implementor lesson — sanity checks become oracles).
- Reduce AAD coverage to "look prettier" — every AEAD call must cover the record identifier.
- Bypass hooks (`--no-verify`). If pre-commit fails, fix it.
- Skip the CSP `-Report-Only` phase. Production CSP breakage is ugly.

## Pointers to primary sources

**Must read before writing the spec:**
- Albrecht et al. project site: https://nebuchadnezzar-megolm.github.io/
- Albrecht et al. full paper: https://eprint.iacr.org/2023/485
- Matrix disclosure post: https://matrix.org/blog/2022/09/28/upgrade-now-to-address-encryption-vulns-in-matrix-sdks-and-clients/
- Backendal/Haller/Paterson "Mega Awry": https://eprint.iacr.org/2022/959.pdf
- Albrecht "Caveat Implementor": https://eprint.iacr.org/2023/329
- CSP L3: https://www.w3.org/TR/CSP3/
- Trusted Types: https://www.w3.org/TR/trusted-types/
- SLSA: https://slsa.dev/spec/v1.0/
- Sigstore cosign: https://docs.sigstore.dev/cosign/signing/signing_with_blobs/

**Optional context:**
- Matrix "Reloaded" formal analysis 2024: https://arxiv.org/html/2408.12743v2 — confirms the protocol is sound post-fix; remaining gaps are at the trust-the-server layer.

## Related work in the repo

- Epic 77 hash-chained audit log — the primitive this brief extends.
- PR #48 PIN prompt on locked key + pubkey mismatch — related defensive hardening.
- PR #50 session capsule + E2E test infra hardening — orthogonal but same defensive spirit.
- `docs/REPRODUCIBLE_BUILDS.md` — current build integrity documentation.
- `docs/security/SECURITY_AUDIT_2026-02-R6.md` — the most recent internal audit findings; the spec should close out any P0/P1 items that overlap with this tier.
