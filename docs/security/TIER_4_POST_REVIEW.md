# Tier 4 — Post-Implementation Review (2026-04-12)

Scope: commits `d6f84b06..HEAD` (PR-A origin split, PR-B crypto sandbox
iframe, PR-C binary verifier + gossip protocol + whitepaper + canary).
PR: [#75](https://github.com/rhonda-rodododo/llamenos-hotline/pull/75).

Six reviewers ran in parallel: `pr-review-toolkit:code-reviewer`,
`pr-review-toolkit:silent-failure-hunter`,
`pr-review-toolkit:type-design-analyzer`,
`pr-review-toolkit:pr-test-analyzer`,
`pr-review-toolkit:comment-analyzer`, and `superpowers:code-reviewer`.

This document records the findings, what was fixed in the post-review
session, and what was deferred to Tier 5.

---

## Critical findings

### C-1. `securityHeaders` middleware was registered AFTER the `/api` and `/telephony` mounts — FIXED

File: `src/server/app.ts`

Hono middleware registration is positional: `app.use('*', mw)` only
applies to routes mounted *after* it. PR-A moved `securityHeaders` to
the bottom of `app.ts` and mounted the entire API with `app.route('/api',
api)` first, which meant every /api/* and /telephony/* response was
shipping with **zero** of the headers PR-A was supposed to add:

- `Content-Security-Policy: default-src 'none'; script-src 'none'; …`
- `Strict-Transport-Security`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Embedder-Policy`
- `Cross-Origin-Resource-Policy`
- `X-Frame-Options: DENY`
- `Referrer-Policy`
- `Permissions-Policy`
- `Report-To`

I reproduced this with a minimal two-line Hono test (see reviewer
transcript for details). The unit test in
`src/server/middleware/security-headers.test.ts` did not catch it
because it spins up a fresh `new Hono()` and registers the middleware
before the route — the exact pre-condition that was broken in the real
`app.ts`.

**Fix applied:** hoisted `app.use('*', securityHeaders)` to the first
middleware position, immediately after `logContextMiddleware` and
before any route mount, and deleted the stale duplicate registration
that was still sitting after `app.route('/api', api)`.

### C-2. API CSP defaulted to `Content-Security-Policy-Report-Only` — FIXED

File: `src/server/middleware/security-headers.ts`

The CSP default was Report-Only unless an operator knew to set
`CSP_MODE=enforcing`. The Ansible `env.j2` does not pass `CSP_MODE`, so
`just deploy` would have silently shipped an observational CSP. An API
host shipping Report-Only in production is indistinguishable from no
CSP at all for browsers that honour the header — a MIME-confused script
execution would be caught *after* it runs, which defeats the entire
Tier 4 API-host CSP rationale.

**Fix applied:** inverted the default. `CSP_MODE` unset → enforcing.
`CSP_MODE=report-only` → explicit opt-out, logged at startup.
Added three unit tests covering the unset / report-only / enforcing
cases.

### C-3. Sandbox iframe postMessage channel is broken in production (opaque origin) — DEFERRED TO TIER 5

Files: `crypto-sandbox/src/main.ts`, `src/client/lib/crypto-iframe-client.ts`.

`bootRealIframe()` sets `sandbox="allow-scripts"` with no
`allow-same-origin`. Sandboxed-without-allow-same-origin iframes have
an **opaque origin**: when the iframe calls
`window.parent.postMessage(res, parentOrigin)`, the `MessageEvent`
delivered to the parent has `ev.origin === "null"`. The parent's
hot-path check `if (ev.origin !== this.cryptoOrigin) return` drops
every response and every `ready` broadcast.

Conversely, when the parent calls
`iframe.contentWindow.postMessage(req, this.cryptoOrigin)`, the
browser compares `targetOrigin === "https://crypto.example"` against
the target window's opaque origin (serialized as `"null"`) — the
message is discarded.

Because PR-C wires nothing into the SPA boot (C-6 below), the crypto
sandbox is not actually on the critical path today; unlock still goes
through the legacy worker. The broken channel is not causing user-
visible regression. But PR-B is cosmetically-only landed until this
is resolved.

Fix requires an architectural decision: accept opaque origin and use
`ev.origin === 'null'` on both sides with an in-payload nonce/HMAC for
replay protection, OR drop `sandbox="allow-scripts"` and rely on CSP +
`frame-ancestors` only. Deferred to Tier 5 — see
`~/tier-carry-forward/tier-5-notes.md` for the full decision tree and
required browser regression test.

### C-4. Crypto host CSP disagreed between Caddy header and `sandbox.html` meta — FIXED

Files:
- `crypto-sandbox/sandbox.html:41` (meta CSP)
- `deploy/docker/Caddyfile.production:81`
- `deploy/ansible/roles/llamenos/templates/caddy.j2:105`

The meta tag says `connect-src 'none'` (with a long comment: "HARD
INVARIANT … NEVER change this to 'self'"). The Caddy headers said
`connect-src 'self' https://api.* wss://api.*`. Browsers intersect
multiple CSPs, so the strictest — `'none'` — wins at runtime today,
but the contract was visibly broken: any future edit that removed the
meta tag ("it's redundant, the real one is on Caddy") would silently
grant the iframe network access, defeating the entire zero-network
design. `script-src` and `style-src` also disagreed.

**Fix applied:** aligned Caddy crypto-host CSP with the meta tag
exactly — `connect-src 'none'`, `script-src 'self' 'wasm-unsafe-eval'`,
`style-src 'self'`, `worker-src 'self'`, `frame-ancestors
https://{APP_DOMAIN}`, `trusted-types llamenos-sandbox default`. Both
`Caddyfile.production` and `caddy.j2` updated with a load-bearing
comment spelling out the hard invariant.

### C-5. Trusted Types policy-name mismatch (Caddy vs `main.ts`) — FIXED

Files: `crypto-sandbox/src/main.ts`, `crypto-sandbox/sandbox.html`, both Caddy configs.

Caddy CSP declared `trusted-types llamenos-sandbox default`. `main.ts`
called `trustedTypes.createPolicy('llamenos', ...)`. Chromium throws
`TypeError: Policy "llamenos" disallowed` when a createPolicy name is
not in the CSP allowlist — which would abort the module. The existing
`try/catch` around the createPolicy call swallowed the TypeError and
then the module continued to post `ready` to the parent, unlocking
boot against a sandbox where Trusted Types enforcement was not
actually installed.

**Fix applied:**
1. Renamed `createPolicy('llamenos', ...)` → `createPolicy('llamenos-sandbox', ...)`.
2. Removed the `try/catch` swallow. If policy install fails now, the
   exception propagates out of the module before `postMessage(ready)`
   runs, so the SPA's `bootTimeoutMs` trips cleanly instead of
   unlocking against a half-configured sandbox.
3. Updated `sandbox.html` meta `trusted-types` directive to match.

### C-6. PR-C is dead code — binary verifier + gossip protocol never wired to SPA boot — DEFERRED TO TIER 5

Files: `src/client/lib/binary-verifier.ts`, `src/client/lib/gossip-version.ts`, `src/client/main.tsx`, `src/server/routes/` (no manifest route).

Both reviewers (`superpowers:code-reviewer` and
`silent-failure-hunter`) flagged this as critical:

1. **`verifyOrThrow` has no caller.** `grep -r verifyOrThrow src/client`
   returns only the module itself and its tests. The SPA boot in
   `src/client/main.tsx` does not call it. A user who ships a
   compromised bundle today boots and unlocks normally — PR-C's
   fail-closed guarantees never execute.

2. **`/api/releases/latest/manifest` endpoint does not exist.** Even
   if the verifier were wired up, it would hit a 404 on the very first
   fetch, return `fetch-error`, throw `VerifierFailure`, and brick
   every browser. No server route file references the manifest.

3. **`GossipVersionClient` has no callers.** Publish + fleet-consensus
   is never invoked. The SPA ships without any divergence detection.

4. **The release-manifest build step does not cover the iframe
   bundle.** Even after wiring, `listLoadedResources` enumerates only
   the SPA's same-origin scripts + stylesheets — the iframe is on a
   different origin and isn't listed. The verifier would happily
   confirm the SPA while a modified sandbox ships unnoticed.

Tier 4 PR-C delivers the building blocks but none of the wiring.
Tier 5 must complete this chain before PR-C offers any guarantees to
users. Deferred items tracked in Tier 5 notes.

---

## Important findings

### I-1. `cookies.ts` helper is not adopted by `auth.ts` / `invites.ts` — DEFERRED

File: `src/server/lib/cookies.ts`, `src/server/routes/auth.ts`, `src/server/routes/invites.ts`.

The helper correctly sets `SameSite: Strict`, `Secure: true`, and
optional `API_COOKIE_DOMAIN` scoping. But login + invite accept flows
still hand-build their cookie options inline, so:

1. `API_COOKIE_DOMAIN` applies to refresh/session cookies but not to
   login/invite cookies → two cookies with the same name, different
   `Domain` attribute, silent session confusion.
2. `secure: env !== 'development'` exists in inline paths but not in
   `cookies.ts` (hardcoded `secure: true`) → HTTP dev loses the
   session-id cookie entirely.

Non-blocking for Tier 4 merge. Tracked as Tier 5 follow-up: delete the
inline option blocks and route everything through
`refreshCookieOptions()` / `sessionIdCookieOptions()`, threading the
environment through `baseOptions()`.

### I-2. CORS middleware reads `process.env.APP_ORIGIN` directly — DEFERRED

File: `src/server/middleware/cors.ts:24`.

`if (process.env.APP_ORIGIN) allowed.add(process.env.APP_ORIGIN)` — the
correct read is `c.env.APP_ORIGIN` via the env-loading middleware.
Works in production today because `process.env` is live, but breaks
any test that shims `env` without touching the process. Deferred as a
small cleanup.

### I-3. Ansible role legacy vars are still unprefixed — DEFERRED

Files: `deploy/ansible/roles/llamenos/vars/main.yml` (correctly
prefixes new vars) + templates that still reference `domain`, `app_dir`,
`deploy_user`, `app_environment`, `pg_password`, etc.

`ansible-lint roles/llamenos/` reports 7 `var-naming[no-role-prefix]`
failures on `register:` variables (not in Tier 4 changes) and 3
`no-changed-when` failures in `luks.yml` (also pre-existing). Tier 4
did not introduce these, but extended the surface area. The production
profile of the CI `just validate` path is clean. Cleanup work tracked
for a future Ansible-focused pass.

### I-4. Ansible `Debian.yml` override file is empty scaffold — DEFERRED

File: `deploy/ansible/roles/llamenos/vars/Debian.yml` — placeholder
only. The `first_found` task loader silently falls back to `main.yml`
on any unknown OS, which obscures the single-distro support. Either
delete or add an explicit `fail:` on unrecognized family.

### I-5. RPC correlation id is a UUID but replay protection is absent — DEFERRED

File: `src/shared/schemas/crypto-rpc.ts`, `crypto-sandbox/src/rpc-router.ts`.

Non-blocking until C-3 is resolved, but a same-origin attacker that
can smuggle messages into the parent could replay a recorded
`decryptEnvelope` request and observe the plaintext a second time.
Fold a short-lived nonce ring into the C-3 redesign.

### I-6. `bootCryptoSandbox()` rejection is an unobserved promise — DEFERRED

Flagged by silent-failure-hunter. `boot-crypto-sandbox.ts` throws on
sandbox boot failure, but the SPA boot wrapper doesn't `await` the
rejection in a way that propagates to the error boundary. A sandbox
failure today is a dangling unhandled rejection in the console — no
user-visible error, no fail-closed behavior. Non-blocking because the
sandbox is non-load-bearing today (C-6), but must be correct before
Tier 5 wiring turns sandbox boot into a gate.

### I-7. Verifier `fetch-error` swallows root cause — MINOR

File: `src/client/lib/binary-verifier.ts:306-315`.

Network exception paths populate `detail: err.message` only for
`Error` instances; other throw shapes become `'unknown'`. Not a
security bug but makes production debugging harder.

---

## Minor findings (no action required this tier)

- **M-1:** `Permissions-Policy` allows `microphone=(self)` on SPA host — correct for WebRTC, no action.
- **M-2:** `iframe.setAttribute('allow', 'cross-origin-isolated')` in `crypto-iframe-client.ts` — `cross-origin-isolated` isn't a valid feature token for the `allow` attribute (it's Permissions-Policy). Silently ignored by browsers. Remove in Tier 5.
- **M-3:** `gossip-version.ts` `destroy()` should `secretKey.fill(0)` before releasing the reference. Defense-in-depth; won't leak in practice because GC.
- **M-4:** `sanitizeId` in the RPC router allows caller-chosen ids and echoes them back; not a vulnerability but limits the router's ability to correlate against a server-side nonce.
- **M-5:** `canonicalizeJson` doesn't handle `NaN`/`Infinity`/`bigint`. Today the manifest schema rejects these at parse time, so the gap is contained.
- **M-6:** `verifyGossipEvent` recomputes the event id before signature verify — intentional (matches NIP-01), but deserves a comment.
- **M-7:** `WARRANT_CANARY.md` is unsigned. Tier 5 should add an Ed25519 detached signature and publish the pubkey alongside the release manifest pubkey.

---

## What reviewers checked and did not find issues in

- `src/shared/schemas/crypto-rpc.ts` — tight discriminated-union design with closed error-code enum.
- `src/server/lib/cookies.ts` — Strict + HttpOnly + Secure, refresh scoped to `/api/auth/token`, session-id scoped to `/`. Correct except for non-adoption (I-1).
- `src/server/server.ts` — API-only, no lingering `serveStatic`/catch-all.
- `src/client/lib/binary-verifier.ts` — fail-closed via `verifyOrThrow`, build-time-pinned key, canonical-JSON hashing, no-store fetch, no telemetry. Just not wired (C-6).
- `crypto-sandbox/src/main.ts` — parent-origin pin via `VITE_CRYPTO_PARENT_ORIGIN`, `postMessage` never uses `'*'`, `ancestorOrigins` fallback only for dev.
- `crypto-sandbox/src/rpc-router.ts` — zod-validated dispatch, closed error code classification.

---

## Fixes applied in this session

| ID | Description | Files |
|---|---|---|
| C-1 | Hoisted `securityHeaders` before route mounts; removed duplicate registration | `src/server/app.ts` |
| C-2 | Flipped CSP_MODE default to enforcing; added 3 unit tests | `src/server/middleware/security-headers.ts`, `src/server/middleware/security-headers.test.ts` |
| C-4 | Aligned Caddy crypto-host CSP with `sandbox.html` meta (`connect-src 'none'`) | `deploy/docker/Caddyfile.production`, `deploy/ansible/roles/llamenos/templates/caddy.j2` |
| C-5 | Renamed TT policy `llamenos` → `llamenos-sandbox`; removed try/catch swallow; updated meta | `crypto-sandbox/src/main.ts`, `crypto-sandbox/sandbox.html` |
| Test | Added `verifyOrThrow` tests for `signature-invalid`, `key-not-pinned`, `manifest-unparseable`, `fetch-error` statuses | `src/client/lib/binary-verifier.test.ts` |

## Deferred to Tier 5

See `~/tier-carry-forward/tier-5-notes.md` for the full list.

Highest-priority items:

1. **C-3** — resolve sandbox opaque-origin postMessage breakage; add Playwright browser regression test.
2. **C-6** — wire `verifyOrThrow` into SPA boot and ship the `/api/releases/latest/manifest` server route.
3. **C-6** — extend release manifest to cover the crypto-sandbox bundle.
4. **C-6** — wire `GossipVersionClient` to SPA boot for fleet divergence detection.
5. **I-1** — migrate `auth.ts`/`invites.ts` to `cookies.ts` helpers.
6. **I-6** — make `bootCryptoSandbox()` rejection fail-closed once it's load-bearing.
7. **M-7** — sign the warrant canary with the release pubkey.
8. **Whitepaper accuracy rewrite** — comment-analyzer found multiple critical discrepancies between `WHITEPAPER.md` and the code (HPKE vs ECIES, Argon2id vs PBKDF2, "all crypto in iframe" vs stubs, nonexistent file paths). Needs a full accuracy pass.

---

## Verification

Run in `~/projects/llamenos-hotline-impl-tier-4-gossip-prc`:

```
bun run typecheck                   # clean
bun run lint                        # 266 warnings (pre-existing baseline), 0 errors
bun run build                       # SPA + crypto-sandbox build clean
bun run test:unit                   # 1574 pass, 1 skip, 0 fail
cd deploy/ansible && ansible-lint roles/llamenos/ --profile production  # 0 failure, 0 warning
```

CI on push is expected to match — all Tier 4 code checks are green. If
there are failures on the PR, they are matching the known test-infra
breakage pattern (`global-setup.ts` bootstrap admin `locator.waitFor`
timeout), deferred to the test-infra-fix session.
