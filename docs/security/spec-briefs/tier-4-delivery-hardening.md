# Tier 4 — Delivery & Trust Hardening (Spec Brief)

**Date:** 2026-04-10
**Master doc:** [`../SECURITY_IMPROVEMENTS_MASTER.md`](../SECURITY_IMPROVEMENTS_MASTER.md) §5.6, §6.5, §7 Tier 4
**Effort:** Weeks (parallel to Tier 3)
**Depends on:** Tier 0 (CSP/cosign already in Tier 0; Tier 4 builds further structural isolation)
**Status:** Ready for spec authoring

## Goal

Structurally isolate the code-delivery channel from the data channel and build multiple layers of independent tampering detection, so that even a full compromise of Llamenos' API server cannot deliver modified JS to volunteers, and targeted Selective Malicious Code Delivery (SMCD) becomes publicly auditable.

This tier is about the **fundamental trusting-trust problem** every web E2EE app faces: every page load re-downloads JS from the server. If the server is compromised (or coerced by a court order) it can ship modified code to one user. No browser-delivered app can fully eliminate this, but the highest-tier apps (Signal web via Electron fallback, CryptPad, Proton) mitigate it in depth. Tier 4 brings Llamenos to that level.

## Why this matters

Our current code-delivery architecture: the same VPS that hosts the API, the database, and the encrypted data also serves the JS bundle to volunteers' browsers. A compromise of that VPS is a full game-over — the attacker can ship modified JS that exfiltrates keys despite all our careful crypto.

**The mitigations split into three categories:**

1. **Reduce blast radius of origin compromise.** Split the code-delivery origin from the data origin so they can only be compromised independently.
2. **Isolate the crypto core from the UI.** Sandboxed iframe on a distinct origin means even UI-frame XSS can't directly reach the key store.
3. **Detect tampering in public.** Third-party verifiers + gossip attestation + transparency logs make mass SMCD detectable within minutes and targeted SMCD detectable if it ever happens.

Plus transparency: a published security whitepaper + residual-risk statements in user docs are how Signal, Proton, and CryptPad distinguish themselves from snake-oil E2EE. The honest posture about what we can and cannot defend is itself a security feature.

## Current Llamenos state

**Current state:**
- Vite build → `dist/client/` → served by Bun/Hono from the same server that holds the API + DB.
- Docker Compose + Ansible deployment to a VPS.
- Reproducible Docker build via `Dockerfile.build` with `SOURCE_DATE_EPOCH` + content-hashed filenames.
- `CHECKSUMS.txt` in GitHub Releases.
- SLSA provenance (basic).
- `scripts/verify-build.sh` for third-party verification.
- `docs/REPRODUCIBLE_BUILDS.md` documents the build pipeline.

**Files to touch:**
- `src/server/app.ts` + Hono middleware — current HTML+asset serving.
- `vite.config.ts` — build output for the split origin.
- `deploy/ansible/` — deployment topology for two origins.
- `.github/workflows/release.yml` — cosign + SLSA (partly from Tier 0) + transparency log.
- `src/client/lib/crypto-worker.ts` — becomes the UI-side RPC client to a cross-origin sandboxed iframe.
- New: `crypto-sandbox/` — a separate Vite build for the crypto origin's HTML + iframe JS.
- `scripts/verify-build.sh` — extended.
- `docs/security/WHITEPAPER.md` (new) — public security whitepaper.
- `docs/security/RESIDUAL_RISK.md` (new) — plain-language residual-risk statement shown to users at onboarding.
- `src/client/components/onboarding/` — surface the residual-risk statement.

## Proposed approach

### 4.1. Split code-delivery origin from API origin

**The single cheapest structural mitigation.** Currently `hotline.example` serves both `/` (HTML + JS) and `/api/*` (the API). Proposal:

- `app.hotline.example` — static SPA only. Hosted on Cloudflare Pages, Netlify, or a separate static VPS with no database or secrets. Reproducible build output published as-is.
- `api.hotline.example` — API + WebSocket relay + RustFS proxy. Everything the current server does EXCEPT serving the SPA HTML.

**Compromising `api.hotline.example` no longer lets the attacker modify the JS volunteers load.** The static-hosting provider has a separate admin account, separate infrastructure, and in Cloudflare's case a separate legal jurisdiction.

**Implementation details:**
- Vite build output stays the same shape; deployment target changes.
- `api.hotline.example` CORS config allows `app.hotline.example` as the only origin.
- Cookies (session, refresh, session-id) scoped to `api.hotline.example`.
- WebSocket URL becomes `wss://api.hotline.example/ws`.
- CSP `connect-src` on the app origin explicitly allows `api.hotline.example` + `wss://api.hotline.example`.
- COOP/COEP still apply.

**Ansible adjustments:**
- Two targets in the inventory.
- Separate certificates (or two SANs on one cert).
- Separate Caddy configs for each host.
- Independent update cadences.

**Self-hosted deployments (primary use case):** Not everyone runs CDN-backed static hosting. For self-hosted Ansible deployments, the spec must provide a way to still split origins (e.g., serve SPA from `app.hotline.example` via a separate Caddy on the same VPS but with separate process + separate service user). This is less strong than true provider separation but still better than shared-process.

### 4.2. Sandboxed-iframe crypto core (CryptPad pattern)

**Move the crypto worker to a distinct origin.** The UI frame (`app.hotline.example`) contains a sandboxed iframe loaded from `crypto.hotline.example`. The iframe is the only code with access to the identity/device keys. UI ↔ iframe communication is strictly via `postMessage` with a zod-validated RPC schema.

**Threat model change:**
- **Before:** XSS in the UI frame → attacker has direct access to `crypto-worker.ts` → can call any crypto op → can exfiltrate plaintext via background fetch.
- **After:** XSS in the UI frame → attacker must go through the `postMessage` RPC → the iframe validates each message, rate-limits, and logs anomalies → attacker still has oracle access but must generate network traffic to exfiltrate, which is more visible.

**Importantly:** the iframe runs JS loaded from a different origin than the UI. An attacker who compromises `app.hotline.example` does NOT get code execution in `crypto.hotline.example`. Compromising the crypto iframe requires either a separate compromise of `crypto.hotline.example`'s static hosting OR successful exploitation of a postMessage message parser vulnerability.

**Scope of the iframe:**
- All `@hpke/*` calls.
- All `key-store-v2` / device-key operations.
- All sigchain signing + verification.
- Decrypt/encrypt of field content.

**Not in the iframe:**
- React UI components.
- React Query cache.
- API fetches (those happen in the UI frame; encrypted content is passed to the iframe for decryption).

**Implementation:**
- New Vite project under `crypto-sandbox/` with its own `index.html` + bundle.
- Built to `dist/crypto-sandbox/`.
- Served from `crypto.hotline.example`.
- The UI frame loads the iframe via `<iframe src="https://crypto.hotline.example/sandbox.html" sandbox="allow-scripts same-origin">`.
- Zod schema in `src/shared/schemas/crypto-rpc.ts` defines the RPC message format.
- The UI frame's `crypto-worker-client.ts` becomes a postMessage client instead of a Web Worker client.
- The iframe itself may internally use a Web Worker for actual crypto ops; that's defense in depth.

**Trade-offs:**
- **Added latency:** postMessage has overhead vs. a same-origin worker. Measure.
- **Complexity:** two build targets, two deploy targets, RPC schema maintenance.
- **Startup:** iframe must load before the UI can operate. Add a loading state.
- **Dev experience:** cross-origin in dev requires hostfile entries or a dev-only proxy. Document.

**Rate limiting in the iframe:** The existing crypto worker rate limiter (100 ops/sec burst, 1000 ops/min sustained) moves into the iframe. Anomalous request patterns (e.g., "decrypt every note in rapid succession" which is indicative of exfiltration) trigger lock.

### 4.3. Third-party bundle-hash verifier

**External transparency.** A GitHub Action run in **a separate repository owned by an allied organization** (e.g., EDRi, a legal-aid partner, or a friendly journalist's org) periodically:
1. Fetches `https://app.hotline.example/` and `https://crypto.hotline.example/sandbox.html`.
2. Computes SHA-256 of the served HTML + every referenced JS bundle (via SRI-like parsing).
3. Compares hashes to the latest GitHub Release's `CHECKSUMS.txt`.
4. On mismatch: opens a GitHub issue + publishes an alert to a public dashboard + posts to a pre-configured alerting webhook.

**Frequency:** Every 5 minutes during business hours, every 30 minutes off-hours. Cheap to run.

**Why a separate repo in a separate org:** If the attacker compromises Llamenos' org, they can't silence the verifier by modifying the action config. The verifier is a completely independent trust anchor.

**Optional enhancement: multiple verifiers.** Ship a recipe + docs so any allied org can run a verifier. More verifiers = higher probability of detection.

### 4.4. Gossip attestation via the Nostr relay

**We already operate an authenticated Nostr relay.** Use it.

Every client, on successful unlock, signs a commitment to:
- The SHA-256 of the HTML it loaded from `app.hotline.example`.
- The SHA-256 of the crypto-sandbox HTML it loaded from `crypto.hotline.example`.
- The SHA-256 of every `<script>` and `<link>` resource it actually executed.
- A timestamp.
- The device signing key (from Tier 3).

This commitment is published as an ephemeral Nostr event (kind 20002, distinct from the existing kind 20001 event channel). All connected clients can subscribe and compare their own hashes against the fleet.

**Detection logic:**
- If all clients report hash X and one client reports hash Y → that client got a different bundle → either targeted SMCD or client-side cache corruption.
- If the fleet's majority hash disagrees with GitHub Releases CHECKSUMS.txt → mass tampering → alert.

**Trade-offs:**
- **Privacy:** the commitment identifies which devices are currently online. Encrypt under the hub key so only other hub members can see it.
- **False positives:** cached bundles, CDN propagation delays, rolling deployments all cause brief mismatches. Build in a grace period.
- **Responsibility:** who watches the watcher? The verifier action publishes *its* observed hash to Nostr too, giving the clients a reference point.

### 4.5. Public security whitepaper

**The artifact auditors use.** Draft a comprehensive security whitepaper modeled on:
- Tuta's encryption whitepaper.
- Wire's MLS whitepaper.
- 1Password's Security Design.
- Signal's technical docs.

**Contents:**
1. Introduction — what Llamenos is, what it protects.
2. Threat model — who the adversaries are (import from `THREAT_MODEL.md`).
3. Cryptographic primitives — HPKE, XChaCha20-Poly1305, Ed25519, etc.
4. Key hierarchy — per-device, PUK, hub PTK, `items_key`, per-note.
5. Envelope formats — wire diagrams.
6. Sigchain model — entry types, verification, attack resistance.
7. Hub membership + rotation — Cascading Lazy Key Rotation.
8. Voice E2EE — SFrame, DTLS fingerprint binding (Tier 5 forward reference).
9. Multi-device — device enrollment, cross-signing, recovery.
10. Recovery Group — 1Password-style admin-assisted recovery.
11. Delivery channel — split origin, sandboxed iframe, verifier, gossip attestation.
12. Residual risk — the honest list of what we can and cannot defend against.
13. Audit status — which parts have been reviewed by whom.

**Target audience:** security auditors, sophisticated users, journalists. NOT end volunteers (they get `RESIDUAL_RISK.md` instead).

**Format:** Markdown in repo, rendered to HTML, optionally typeset to PDF for print distribution.

### 4.6. Residual risk statement (user-facing)

A plain-language document shown to every volunteer at onboarding (scrollable, with an "I understand" checkbox):

> **What Llamenos protects**
> Your call notes, the identity of callers, your own identity, and your messages are end-to-end encrypted. Our servers cannot read them. If our servers are seized or subpoenaed, your content remains confidential because the keys are on your device.
>
> **What Llamenos cannot technologically prevent**
> Every time you open Llamenos in your browser, it downloads code from our servers. If someone with control over our servers is pressured by a government, court, or attacker to deliver modified code specifically to you, our automated checks may not notice quickly enough. This is a limitation of how browser-based software works, not of Llamenos specifically.
>
> **How we reduce this risk**
> - We use reproducible builds: the code we publish is verifiable by anyone.
> - We use a separate host for code delivery and data — compromising one does not compromise the other.
> - We run independent verifiers (ourselves and allied organizations) that continuously check the code you receive.
> - We run gossip attestation: when you unlock Llamenos, your device publishes a signed record of exactly which code it ran, so targeted attacks show up as anomalies visible to everyone.
> - We publish checksums and cryptographic signatures of every release.
>
> **For volunteers in high-risk situations**
> If your threat model includes targeted legal or technical coercion against our infrastructure (e.g., you are being investigated by a state actor), please use:
> - The Llamenos desktop app (Tauri, code-signed), which updates through a completely different channel, OR
> - The optional Llamenos Verifier browser extension, which checks every page load against a pinned release.
>
> If you are unsure which tier applies to you, ask your hub admin.

**This is load-bearing.** Transparency about residual risk is the single most important thing that distinguishes Signal/Proton/CryptPad from the "trust us" cohort.

## Open design questions

1. **Static hosting for `app.hotline.example`.** Cloudflare Pages (Mullvad/Tuta precedent), Netlify, or self-hosted? For primary Llamenos deployments: recommend Cloudflare Pages for public instances, with a self-hosted Caddy-served separate process for Ansible/VPS deployments. Multi-option.
2. **Sandboxed iframe origin.** Distinct subdomain (`crypto.hotline.example`) or a completely distinct domain (`llamenos-crypto.example`)? Subdomain is simpler. Completely distinct is safer (less shared TLS cert / infrastructure). Recommend subdomain for MVP, upgrade later if needed.
3. **Iframe load strategy.** Eager (before UI renders) or lazy (on first crypto op)? Eager gives predictable startup latency; lazy gives faster time-to-first-paint but crypto ops must wait. Recommend eager with a visible loading state.
4. **postMessage RPC schema.** Request-response only, or support streaming for large operations? Start with request-response; revisit if decrypt batches become slow.
5. **Verifier repo location.** Who hosts it? Identify an allied org for MVP.
6. **Verifier frequency vs. rate limits.** Cloudflare Pages / static hosts rate-limit. 5-minute default probably fine.
7. **Gossip attestation schema.** Nostr kind number? Event schema? Document in protocol spec.
8. **Gossip attestation privacy.** Full hash or HKDF-truncated hash? Full hash is more informative; truncated is more private. Recommend full hash encrypted under hub key.
9. **Whitepaper public location.** `docs/security/WHITEPAPER.md` in the repo is enough, or host at `hotline.example/security`? Both.
10. **Residual risk statement at every onboarding vs once.** Once with a periodic refresh prompt? Once + link from settings.

## Concrete scope

**In scope:**
- Split deployment topology: `app.hotline.example` + `api.hotline.example`.
- Self-hosted Ansible variant with separate Caddy processes.
- Sandboxed crypto iframe at `crypto.hotline.example` + postMessage RPC.
- Vite build target for `crypto-sandbox/`.
- Zod schema for crypto RPC protocol.
- Third-party verifier GitHub Action + recipe docs.
- Gossip attestation Nostr event type + client-side publish + client-side comparison.
- Alert UI for hash mismatches.
- `WHITEPAPER.md` draft.
- `RESIDUAL_RISK.md` draft.
- Onboarding UX integration of `RESIDUAL_RISK.md`.
- Documentation for allied-org verifier deployment.
- CSP updates to allow the new origins.
- Caddy configs for split origin setup.
- Dev-mode hosts file docs.
- Tests for RPC schema validation + rate limiting.

**Out of scope:**
- Tauri desktop build (parallel work, distinct spec).
- Signed WebExtension verifier (parallel work, distinct spec).
- Binary transparency log (cheap follow-up; can be in scope if time permits).
- Commissioned audit (parallel work; whitepaper is the artifact it consumes).

## Success criteria

1. Llamenos is reachable at `app.hotline.example` (SPA only) + `api.hotline.example` (API).
2. Self-hosted Ansible variant with split processes deploys cleanly.
3. Sandboxed crypto iframe loads and performs all crypto ops; UI frame has no direct access to keys.
4. Third-party verifier action running in an allied-org repo reports "match" steady-state.
5. A simulated mass tampering test (manually modified bundle) is detected within 10 minutes.
6. Clients publish gossip attestation events; a simulated targeted SMCD is detectable via fleet divergence.
7. `WHITEPAPER.md` drafted covering all sections.
8. `RESIDUAL_RISK.md` drafted and integrated into onboarding.
9. CSP updated for the new origins; no violations in `-Report-Only` mode.
10. All existing tests pass.
11. Typecheck + build + lint clean.

## Trade-offs and anti-patterns

**Do:**
- Use a separate static-hosting provider for the public deployment if possible.
- Put the crypto core in a distinct-origin sandboxed iframe.
- Run verifiers in a *separate org's* repo, not ours.
- Be honest in the residual-risk statement.
- Publish the whitepaper publicly.

**Don't:**
- Ship the crypto iframe from the same origin as the UI — that defeats the purpose.
- Hide residual risk behind euphemisms. Volunteers deserve clarity.
- Allow the verifier's own source to become a single point of failure — mirror it.
- Skip `-Report-Only` CSP and break production.
- Promise "E2EE" without documenting what that means and doesn't mean.

## Pointers to primary sources

**Must read:**
- CryptPad security docs on the sandboxed iframe pattern: https://docs.cryptpad.org/en/user_guide/security.html
- Matasano 2011 "Javascript Cryptography Considered Harmful" + the ~15 years of community response.
- SLSA framework: https://slsa.dev/
- Sigstore cosign: https://docs.sigstore.dev/cosign/
- SLSA Level 3 requirements: https://slsa.dev/spec/v1.0/levels
- Sigstore Rekor transparency log: https://docs.sigstore.dev/logging/overview/

**Whitepapers to model after:**
- Tuta: https://tuta.com/encryption
- Wire: https://wire.com/en/security/
- 1Password: https://agilebits.github.io/security-design/
- Signal: https://signal.org/docs/

**CSP / Trusted Types:**
- CSP L3 spec: https://www.w3.org/TR/CSP3/
- Trusted Types: https://www.w3.org/TR/trusted-types/
- COOP/COEP: https://web.dev/why-coop-coep/

## Related work in the repo

- Tier 0 — CSP L3 + Trusted Types headers; cosign + SLSA provenance + SBOM.
- `docs/REPRODUCIBLE_BUILDS.md` — current reproducible build pipeline.
- `docs/security/THREAT_MODEL.md` — adversary model; inform the whitepaper.
- `docs/security/DEPLOYMENT_HARDENING.md` — current deployment hardening, expand.
- `deploy/ansible/` — Ansible automation; add split-origin role.
- Nostr relay (strfry) operation — extend with gossip attestation event type.
- Hash-chained audit log (Epic 77) — used by verifier to check release signatures.
