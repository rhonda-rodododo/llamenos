# Tier 4 — Deep Review

**Date:** 2026-04-10
**Reviewer:** Claude Opus 4.6 main-session deep review
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-4-delivery-hardening-design.md` (890 lines)
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-4-delivery-hardening.md` (25 TDD tasks — written directly by main session after subagent hit output cap)

## Rhonda decisions received (2026-04-10)

1. **C-1 Opaque-origin iframe CORS → iframe `connect-src 'none'`.** Confirmed. Spec §4.2.6 added — the crypto iframe has ZERO network access at the CSP layer. All ciphertext flows in via postMessage; all plaintext flows out via postMessage. This eliminates the opaque-origin CORS trap (`Origin: null` would have been rejected by the API CORS pin) by making network access structurally impossible from inside the sandbox. New UI E2E test `tests/ui/crypto-iframe-no-network.spec.ts` asserts zero runtime network requests from the iframe.
2. **Compile-time origin config for self-hosters.** Confirmed: "the CORS origin should be configurable at UI compile time, because our main deployment vehicle is self hosted installs." Spec §4.2.7 added — all three origins (`VITE_APP_ORIGIN`, `VITE_API_ORIGIN`, `VITE_CRYPTO_ORIGIN`) plus `VITE_CSP_REPORT_URI` are Vite build-time env vars. Matching server-side `APP_ORIGIN` / `API_ORIGIN` / `CRYPTO_ORIGIN` vars are read by Hono + Caddy at runtime. Reproducible-build implication is acknowledged: bundle SHAs differ per self-hoster, so each deployment needs its own scoped third-party verifier.
3. **I-1 Partitioned cookie fallback, I-2 minimum 2 verifiers, I-3 client-side hash is a participation signal** — all remain as implementation-time guidance (non-blocking for landing the spec).

## Summary

Tier 4 is the tier where "trusting-trust for web apps" is honestly engaged with — split origins, sandbox iframe, third-party verifier, fleet gossip, public whitepaper, residual-risk disclosure, warrant canary. The spec is strong on the "independence of detection layers" principle and honestly marks which attacks it can catch vs contain. Two important findings: **(1) the sandbox iframe communicating with the API via `connect-src https://api.llamenos.example` inside a `sandbox="allow-scripts"` context may be blocked by modern Chromium's opaque-origin CORS behavior** — this needs a live browser smoke-test before shipping; **(2) the plan assumes cross-origin cookies with `SameSite=None; Partitioned` work reliably on all target browsers, but Safari ITP + Brave Shields' behavior on `Partitioned` is still inconsistent as of 2026**.

## Critical findings

### C-1. Opaque-origin iframe + CORS to the API may be blocked

**Where:** Spec §4.2.1 ("Sandbox attribute rationale") + §4.1.3 "app.llamenos.example CSP" with `connect-src 'self' https://api.llamenos.example`.

**Issue:** `sandbox="allow-scripts"` (without `allow-same-origin`) forces the iframe into an **opaque origin**. When an opaque-origin iframe issues a cross-origin `fetch()` to `https://api.llamenos.example`, the `Origin` header is `null` (not the iframe's URL-derived origin). The API server's CORS middleware will reject `Origin: null` because the spec's Task 4 pins CORS to `APP_ORIGIN` with no wildcards, no reflection. **Result: the iframe cannot talk to the API directly.**

**Consequence for the design:** The iframe either (a) must NOT fetch from the API directly, and instead only receive ciphertext via postMessage from the UI frame (which is what the spec implies in §4.2.2 "API fetches" bullet — "Encrypted blobs are fetched from api.llamenos.example by the UI frame and passed to the iframe via postMessage"). This is the intended design but is not enforced by CSP — the spec grants `connect-src https://api.llamenos.example` to the iframe origin (see the crypto sandbox CSP in Plan Task 6). OR (b) the iframe must NOT carry the opaque-origin attribute, which breaks the CryptPad isolation guarantee.

**Fix:** Tighten the iframe's CSP to `connect-src 'none'` (or only `self` for same-origin asset fetches). The iframe never initiates network requests; it receives all ciphertext via postMessage from the parent. Add an explicit `tests/ui/crypto-iframe-no-network.spec.ts` that asserts the iframe cannot make any fetch to `api.llamenos.example`.

## Important findings

### I-1. Partitioned cookies + Safari ITP consistency not verified

**Where:** Plan Task 4 "Cross-site cookies + CORS hardening".

**Issue:** The plan sets `SameSite=None; Secure; Partitioned` (CHIPS) on refresh cookies. Chrome 123+ supports this. Safari's position on Partitioned cookies is complicated — Safari 17.x has partial support, Safari 18 expanded it, but ITP (Intelligent Tracking Prevention) may still block third-party cookies aggressively. Firefox Strict mode also blocks third-party cookies. The plan has a fallback "refresh-via-redirect" path but does not explicitly enumerate which browsers hit which path.

**Fix:** During implementation, create a browser support matrix table in `docs/security/COOKIE_COMPAT_MATRIX.md` mapping each target browser + privacy mode to which refresh path it uses (direct Partitioned fetch vs redirect-flow). Run the UI E2E tests with Firefox Strict and Safari ITP simulated.

### I-2. Allied-org verifier key material single-point-of-failure

**Where:** Spec §4.3.1 "Why an allied org" + plan Task 16 (workflow template).

**Issue:** The spec recommends multiple verifiers but the initial setup has one. A single allied org's GitHub account compromise = no verdicts published to Nostr, silent failure. The spec addresses this with "more verifiers = more attestations" but does not mandate a minimum.

**Fix:** Success criterion #6 currently requires "Allied-org verifier repository exists with a working GitHub Action" — raise the bar to "at least 2 allied-org verifiers, with different Nostr signing keys, documented in `docs/security/VERIFIERS.md`". Even if one is abandoned or compromised, the second's divergent verdict triggers investigation.

### I-3. Bundle hash computation is client-side and vulnerable to silent lies

**Where:** Plan Task 18 `computeBundleHash()`.

**Issue:** The client-side bundle hash computation works by fetching every referenced asset and hashing. If the attacker has already silently swapped the bundle, they can also swap `computeBundleHash()` itself (it lives in the SPA bundle) to return the expected hash regardless. The function cannot self-verify.

**Fix:** The spec acknowledges this structurally — the detection layer is NOT client-side, it's the third-party verifier (§4.3) + fleet gossip (§4.4). But the plan could make this explicit: `computeBundleHash` is a **participation** signal ("this client reports what it thinks it's running"), not a **verification** signal. The fleet divergence alert catches attackers who don't bother to lie in `computeBundleHash`; the third-party verifier catches attackers who do.

## Minor findings

### M-1. File line counts

- `src/server/app.ts`: 353 lines (spec describes a "mounts SPA fallback" shape — confirmed the file has routing that would need to be stripped).
- `src/server/server.ts`: 324 lines.
- `src/server/middleware/security-headers.ts`: 53 lines (confirmed the Tier-0-expected CSP lives here; Tier 4 extends it).
- `src/server/middleware/cors.ts`: 51 lines.

All consistent with the plan's file map.

### M-2. Plan uses `lefthook` git hook binary

The earlier commits show `Can't find lefthook in PATH` — a warning from the repo's git hooks setup. Not a review issue but the Tier 4 plan should verify the deploy scripts don't regress the lefthook setup.

### M-3. `crypto-sandbox/vite.config.ts` and `package.json` dual-build

The plan adds a separate Vite subproject at `crypto-sandbox/`. This is the standard pattern but adds maintenance cost — the subproject's `package.json` can drift from the main one. Add a CI check that the subproject's deps are a strict subset of the main `package.json` deps.

### M-4. Warrant canary signing key rotation

The plan adds `docs/security/WARRANT_CANARY.md` but does not specify who signs it or how the signing key is rotated if that person is compromised. Add a `docs/security/WARRANT_CANARY_RUNBOOK.md` with the key rotation procedure.

## Strengths

- **"Independence of detection layers"** is a genuine security property. Sandbox iframe + third-party verifier + fleet gossip + public whitepaper + residual risk disclosure fail differently — no single attack silences them all.
- **CryptPad pattern for the sandbox iframe** (opaque origin via sandbox=allow-scripts, CSP on both sides, COOP+COEP isolation) is the correct blueprint. Spec cites WICG credentialless iframes appropriately.
- **Third-party verifier** hosted by an allied org is the "public observability" principle from master §9.10.
- **Residual risk disclosure** is the "honest E2EE" posture that distinguishes Llamenos from snake-oil web-E2EE apps. Scroll-to-bottom gate + signed audit entry is the right UX.
- **Warrant canary** is a defensive tripwire against secret-court-ordered modifications. Low cost, high value.
- **Plan (written by main session) has unusually detailed Ansible role tasks** for split-process deployment, including a `tests/deploy/test-split-origin.yml` playbook that asserts the three-user isolation post-deploy.

## Verification log

- ✓ `src/server/app.ts` confirmed (353 lines, has mixed API + SPA routing today).
- ✓ `src/server/middleware/security-headers.ts` has the Tier 0 CSP (53 lines).
- ✓ `src/server/middleware/cors.ts` has the CORS config (51 lines).
- ✓ `src/server/routes/auth-facade.ts` (1372 lines, matches Tier 2's independent check).
- ✓ Plan has exactly the 25 tasks the main session wrote.
- ✗ Opaque-origin iframe + CORS behavior NOT independently verified via live browser — flagged as C-1.
- ✗ CHIPS `Partitioned` cookie browser support matrix NOT verified — flagged as I-1.
- ✗ Caddy v2 multi-host config syntax NOT verified against current Caddy docs.
- ✗ strfry ephemeral event kind 20002 range NOT verified against strfry or NIP docs.

## Open questions for Rhonda

1. **Iframe CSP `connect-src 'none'` vs `self`** — tighten the sandbox iframe so it makes zero network requests (all ciphertext arrives via postMessage), mitigating C-1?
2. **Minimum verifier count** — require ≥ 2 allied-org verifiers at launch, or accept 1 for v1 and raise to 2 after the first outside audit?
3. **Partitioned cookie fallback behavior** — redirect-flow refresh happens transparently OR with an explicit user-visible "your browser blocks cross-site cookies, click here to continue" affordance?
4. **Warrant canary signer** — who holds the signing key and who rotates if compromised?
5. **Deferred Tauri + WebExtension verifier** — the spec names these as hardened alternatives but defers them to separate specs. Confirm this is intentional (they are genuinely separate workstreams, not Tier 4 scope).
