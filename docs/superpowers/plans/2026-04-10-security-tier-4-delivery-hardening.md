# Security Tier 4 — Delivery Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Llamenos into three origins (`app`, `api`, `crypto`), sandbox the crypto core inside a cross-origin iframe, commission a third-party bundle-hash verifier hosted by an allied org, publish per-client gossip attestations on the Nostr relay so fleet divergence surfaces within 20 s, and ship a consolidated public whitepaper + residual-risk disclosure + warrant canary — all in a single pull request batched as six independent workstreams.

**Architecture:** The SPA moves to `app.llamenos.example`, the Hono API + relay + RustFS stays at `api.llamenos.example`, and a new `crypto-sandbox/` Vite subproject serves from `crypto.llamenos.example`. The crypto worker, key store, envelope decrypt, hub-key rotation, and audit chain verifier all migrate into the crypto iframe; the UI frame talks to it exclusively through a zod-validated `postMessage` RPC. A third-party GitHub Actions verifier hosted by an allied org fetches the served bundles every 15 minutes, compares against the cosign-signed release, and publishes the verdict to the Nostr relay. Clients publish a signed `kind:20002` bundle-attest event on every unlock so other clients detect fleet divergence. A whitepaper, a residual-risk disclosure, and a warrant canary ship as public docs and onboarding UX.

**Tech Stack:** TypeScript, Vite (two subprojects), Caddy (multi-host), Ansible (three systemd units + one frontend), Docker Compose (split-process), Hono + `@hono/zod-openapi`, PostgreSQL + Drizzle, Nostr (strfry relay), `@noble/curves` schnorr, `@hpke/*` (inherited from Tier 0/1), Playwright (unit + API E2E + UI E2E + new Ansible playbook test).

**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-4-delivery-hardening-design.md`

**Prerequisites:** Tier 0 (CSP L3 nonces, Trusted Types, cosign keyless signing, SLSA Build L3, SBOM, signed audit sigchain, `/api/csp-report` ingest) is a hard prerequisite. Tier 4 runs in parallel with Tier 3; no dependency on Tier 1 or Tier 2.

---

## File Map

### Created

| File | Responsibility |
|---|---|
| `crypto-sandbox/` (new Vite subproject root) | Iframe-hosted crypto sandbox |
| `crypto-sandbox/index.html` | Sandbox entry with Trusted Types policy install |
| `crypto-sandbox/sandbox.html` | Actual iframe target (identical to index but explicit) |
| `crypto-sandbox/src/main.ts` | Boot handler: parse `ready` broadcast, install postMessage listener |
| `crypto-sandbox/src/rpc-router.ts` | zod-validated postMessage RPC router |
| `crypto-sandbox/src/rpc-router.test.ts` | RPC schema + rate limit + origin check tests |
| `crypto-sandbox/src/trusted-types-policy.ts` | Iframe-scoped Trusted Types policy (reuses Tier 0 shape) |
| `crypto-sandbox/vite.config.ts` | Separate Vite build emitting to `dist/crypto-sandbox/` |
| `crypto-sandbox/tsconfig.json` | Includes `src/shared/*`, `src/client/lib/crypto-worker.ts`, key store, audit chain verifier |
| `crypto-sandbox/package.json` | Per-subproject deps (minimal — shares lockfile with root) |
| `src/shared/schemas/crypto-rpc.ts` | zod discriminated union for every RPC op |
| `src/shared/schemas/crypto-rpc.test.ts` | Schema validation edge cases |
| `src/shared/schemas/bundle-attest.ts` | zod schema for kind:20002 Nostr event content |
| `src/shared/schemas/bundle-attest.test.ts` | Schema round-trip |
| `src/client/lib/crypto-iframe-client.ts` | RewrittenLayer: was `crypto-worker-client.ts`, now an iframe RPC client |
| `src/client/lib/crypto-iframe-client.test.ts` | Iframe client unit tests with mock iframe |
| `src/client/lib/cross-origin-refresh.ts` | Redirect-flow refresh fallback for ITP / strict cookie blockers |
| `src/client/lib/cross-origin-refresh.test.ts` | Fallback detection tests |
| `src/client/lib/bundle-attest.ts` | Publishes + subscribes to kind:20002 gossip events |
| `src/client/lib/bundle-attest.test.ts` | Happy path + divergence detection |
| `src/client/components/sandbox-loader.tsx` | UX overlay while the iframe boots |
| `src/client/components/fleet-divergence-alert.tsx` | Banner component rendered when gossip detects mismatch |
| `src/client/components/residual-risk-gate.tsx` | Onboarding gate: scroll-to-bottom + audit-log acknowledge |
| `src/client/components/local-verifier-dialog.tsx` | One-click local verifier UI |
| `src/client/lib/local-verifier.ts` | Browser-side bundle hash comparison implementation |
| `src/client/lib/local-verifier.test.ts` | Local verifier tests |
| `scripts/fetch-referenced-assets.sh` | Parses HTML for referenced scripts/styles and fetches each |
| `scripts/compare-served-to-released.sh` | Hashes fetched assets vs CHECKSUMS.txt |
| `scripts/post-nostr-verdict.sh` | Publishes a signed Nostr verdict event |
| `scripts/dev-hosts.sh` | Installs `/etc/hosts` entries for dev subdomains |
| `scripts/check-crypto-isolation.sh` | CI grep guardrail — main SPA must not import crypto-primitives |
| `scripts/migrate-sessions.sh` | Invalidates stale refresh tokens on rollout |
| `docs/security/WHITEPAPER.md` | Consolidated Llamenos security whitepaper |
| `docs/security/RESIDUAL_RISK.md` | Plain-language residual-risk disclosure |
| `docs/security/WARRANT_CANARY.md` | Initial signed warrant canary |
| `docs/security/VERIFIER_MOU.md` | MOU template for allied-org verifier hosts |
| `docs/security/VERIFIER_RUNBOOK.md` | Five-command recipe for standing up a verifier |
| `docs/security/TIER_4_DRILL.md` | Runbook for the simulated-mass-tampering drill |
| `docs/deployment/split-origin-migration.md` | Operator migration guide — DNS, certs, cookie scopes |
| `deploy/ansible/roles/llamenos-static/tasks/main.yml` | Ansible role for static SPA Caddy |
| `deploy/ansible/roles/llamenos-crypto-sandbox/tasks/main.yml` | Ansible role for crypto sandbox Caddy |
| `deploy/ansible/roles/caddy-frontend/tasks/main.yml` | Frontend TLS-terminating Caddy |
| `tests/deploy/test-split-origin.yml` | Ansible playbook asserting the three-user split |
| `tests/api/split-origin-cors.spec.ts` | CORS + cookie + cross-origin refresh tests |
| `tests/api/bundle-attest-publish.spec.ts` | Verify clients publish gossip events |
| `tests/api/releases-manifest.spec.ts` | Verify whitepaper + cosign bundle attached to release |
| `tests/ui/cross-origin-isolation.spec.ts` | `crossOriginIsolated === true`, iframe sandbox attr check |
| `tests/ui/cross-origin-refresh.spec.ts` | Refresh happy path + ITP fallback path |
| `tests/ui/crypto-iframe-rpc.spec.ts` | End-to-end iframe RPC including label mismatch rejection |
| `tests/ui/iframe-postmessage-origin-check.spec.ts` | Adversarial: postMessage from wrong origin is ignored |
| `tests/ui/bundle-attest-healthy.spec.ts` | Clients publish + see their own + match |
| `tests/ui/bundle-attest-mismatch.spec.ts` | Divergence surfaces fleet-divergence alert |
| `tests/ui/whitepaper-render.spec.ts` | Whitepaper renders at the public route |
| `tests/ui/residual-risk-onboarding.spec.ts` | Scroll-to-bottom gate blocks skip |
| `tests/unit/dev-hosts.test.sh` | `scripts/dev-hosts.sh` idempotency |

### Modified

| File | Change |
|---|---|
| `src/server/app.ts` | Remove SPA fallback; API-only Hono app |
| `src/server/server.ts` | Remove `app.route('/', ...)` SPA mount; API-only |
| `src/server/middleware/cors.ts` | Hard-pin to `APP_ORIGIN` env var; no wildcards, no reflection |
| `src/server/middleware/security-headers.ts` | Split into two header sets: API CSP (`script-src 'none'`) and report endpoint receiving from 3 origins |
| `src/server/routes/auth-facade.ts` | Rescope cookies: `Domain=api.llamenos.example`, `SameSite=None`, `Secure`, `Partitioned`, add redirect-flow refresh endpoint |
| `src/server/routes/csp-report.ts` | Log `document-uri` origin alongside the violation |
| `src/client/main.tsx` | Render `SandboxLoader` during iframe boot; render `FleetDivergenceAlert` at top of shell; wire `ResidualRiskGate` at first-login onboarding |
| `src/client/lib/crypto-worker-client.ts` | **Deleted** — replaced by `crypto-iframe-client.ts` |
| `src/client/lib/api.ts` | Base URL reads from `import.meta.env.VITE_API_ORIGIN` |
| `src/client/lib/nostr/*` | Relay URL reads from `import.meta.env.VITE_API_ORIGIN` + `/nostr` path |
| `src/client/lib/auth.tsx` | Detect cookie failure; trigger redirect-flow refresh as fallback |
| `index.html` | Rewritten as the SPA shell on `app.llamenos.example`; no `__CSP_NONCE__` placeholder here (the API delivers the page now via static host, nonce lives in the Caddy header) |
| `vite.config.ts` | Dual-project build: main SPA + crypto-sandbox; per-project env var injection; emits `dist/client/` and `dist/crypto-sandbox/` |
| `deploy/docker/Caddyfile.production` | Three-site Caddyfile with distinct CSP headers per origin |
| `deploy/docker/docker-compose.production.yml` | Split into `app-static`, `crypto-sandbox-static`, `api` services |
| `deploy/ansible/playbooks/deploy.yml` | Includes `llamenos-static` + `llamenos-crypto-sandbox` + `caddy-frontend` roles |
| `deploy/ansible/playbooks/deploy-demo.yml` | Inherits new roles |
| `deploy/ansible/demo_vars.example.yml` | Adds `domain_app`, `domain_api`, `domain_crypto` |
| `deploy/ansible/playbooks/harden.yml` | Enforces three-user split verification |
| `.github/workflows/ci.yml` | Adds `bun run build:crypto-sandbox`, `verify-csp`, `check-crypto-isolation.sh`, `deploy-artefacts` assertion |
| `.github/workflows/release.yml` | Attaches `dist/crypto-sandbox/` to CHECKSUMS.txt; cosign-signs the sandbox bundle; attaches `bundle-manifest.json` |
| `package.json` | `"build:crypto-sandbox": "vite build -c crypto-sandbox/vite.config.ts"` and `"build": "bun run build:main && bun run build:crypto-sandbox"` |
| `CLAUDE.md` | Adds "Tier 4 architecture" section explaining the three origins, iframe boundary, and where each kind of code runs |
| `docs/security/AEAD_AUDIT_2026-04-10.md` | Append "Tier 4 update" noting AEAD call sites now run inside the iframe |
| `DEVELOPMENT.md` | Adds "Split-origin dev setup" instructions with `scripts/dev-hosts.sh` |
| `biome.json` | Lint rule: every `window.addEventListener('message', ...)` handler must call `ev.origin` check in the first 10 lines |

### Deleted

| File | Reason |
|---|---|
| `src/client/lib/crypto-worker-client.ts` | Replaced by `crypto-iframe-client.ts` |
| `src/client/lib/crypto-worker-client.test.ts` | Replaced by `crypto-iframe-client.test.ts` |

---

## Workstream 4.1 — Split code-delivery origin from API origin

### Task 1: Introduce `crypto-sandbox/` Vite subproject

**Files:**
- Create: `crypto-sandbox/package.json`
- Create: `crypto-sandbox/vite.config.ts`
- Create: `crypto-sandbox/tsconfig.json`
- Create: `crypto-sandbox/index.html`
- Create: `crypto-sandbox/sandbox.html`
- Create: `crypto-sandbox/src/main.ts`

- [ ] **Step 1: Scaffold the subproject**

```bash
mkdir -p crypto-sandbox/src
```

```jsonc
// crypto-sandbox/package.json
{
  "name": "@llamenos/crypto-sandbox",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build"
  }
}
```

- [ ] **Step 2: Write the Vite config**

```typescript
// crypto-sandbox/vite.config.ts
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared'),
      '@/crypto': path.resolve(__dirname, '../src/client/lib'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/crypto-sandbox'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sandbox: path.resolve(__dirname, 'sandbox.html'),
      },
    },
  },
})
```

- [ ] **Step 3: Minimal `sandbox.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Llamenos Crypto Sandbox</title>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`crypto-sandbox/index.html` is a copy — it exists so `vite build` with no explicit input has a sane default during dev.

- [ ] **Step 4: Placeholder `main.ts`**

```typescript
// crypto-sandbox/src/main.ts
console.log('[crypto-sandbox] boot placeholder')
window.parent.postMessage({ kind: 'ready' }, '*')  // temporary — hardened in Task 7
```

- [ ] **Step 5: Wire into root `package.json`**

```bash
# Edit package.json scripts:
#   "build:main": "vite build"
#   "build:crypto-sandbox": "vite build -c crypto-sandbox/vite.config.ts"
#   "build": "bun run build:main && bun run build:crypto-sandbox"
```

- [ ] **Step 6: Verify the subproject builds**

Run: `bun run build:crypto-sandbox`
Expected: `dist/crypto-sandbox/sandbox.html` + hashed JS asset created.

- [ ] **Step 7: Commit**

```bash
git add crypto-sandbox/ package.json
git commit -m "feat(crypto-sandbox): scaffold iframe-hosted subproject with Vite build"
```

### Task 2: Vite + env var substitution for `__API_ORIGIN__` and `__CRYPTO_ORIGIN__`

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/client/lib/api.ts`
- Modify: `src/client/lib/nostr/config.ts` (or equivalent)
- Modify: `src/client/lib/config.tsx`
- Create: `src/client/env.d.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/api.test.ts (new)
import { describe, expect, test } from 'bun:test'
import { API_BASE } from './api'

describe('API_BASE', () => {
  test('reads from VITE_API_ORIGIN in env', () => {
    // The test harness sets VITE_API_ORIGIN=http://localhost:3000 in the preload;
    // the import should reflect that.
    expect(API_BASE).toBe(process.env.VITE_API_ORIGIN ?? 'http://localhost:3000')
  })
})
```

- [ ] **Step 2: Update `api.ts`**

```typescript
// src/client/lib/api.ts (top of file)
export const API_BASE = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:3000'
export const CRYPTO_ORIGIN = import.meta.env.VITE_CRYPTO_ORIGIN ?? 'http://localhost:3100'
```

Every `fetch('/api/...')` call in `src/client/**/*.ts[x]` that currently uses a relative URL is rewritten to `fetch(`${API_BASE}/api/...`)`. Typecheck + existing tests surface every call site.

- [ ] **Step 3: Declare Vite env types**

```typescript
// src/client/env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN: string
  readonly VITE_CRYPTO_ORIGIN: string
  readonly VITE_APP_ORIGIN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
bun run typecheck
bun test src/client/lib/api.test.ts
```

Expected: PASS; typecheck will flag every hard-coded fetch URL — fix in the same task.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): API_BASE + CRYPTO_ORIGIN from VITE_* env vars; typed ImportMetaEnv"
```

### Task 3: Strip SPA serving from `src/server/app.ts`

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/server.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/api/split-origin-cors.spec.ts (new, first case)
import { test, expect } from '@playwright/test'

test('GET / on API host returns 404 JSON', async ({ request }) => {
  const res = await request.get('http://localhost:3000/')
  expect(res.status()).toBe(404)
  const body = await res.json()
  expect(body.error).toMatch(/not found/i)
})

test('GET /index.html on API host returns 404 JSON', async ({ request }) => {
  const res = await request.get('http://localhost:3000/index.html')
  expect(res.status()).toBe(404)
})
```

- [ ] **Step 2: Run failing test**

Expected: FAIL — current server still serves SPA fallback.

- [ ] **Step 3: Delete the SPA serving block**

Edit `src/server/server.ts`:

```typescript
// Delete these lines:
app.route('/', serverApp as any)
// ... and the SPA fallback handler that serves dist/client/index.html on unmatched routes.
```

Edit `src/server/app.ts`:

```typescript
// The KNOWN_API_PREFIXES handler already returns 404 JSON for unknown paths
// under /api/*. Extend it to catch any non-/api/* GET as well:
app.notFound((c) => c.json({ error: 'Not Found' }, 404))
```

- [ ] **Step 4: Run the tests**

```bash
bun run dev:docker
bun run dev:server &
bunx playwright test tests/api/split-origin-cors.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/server.ts src/server/app.ts tests/api/split-origin-cors.spec.ts
git commit -m "feat(server): API-only — remove SPA fallback handlers"
```

### Task 4: Cross-site cookies + CORS hardening

**Files:**
- Modify: `src/server/routes/auth-facade.ts`
- Modify: `src/server/middleware/cors.ts`
- Modify: `tests/api/split-origin-cors.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/api/split-origin-cors.spec.ts (append)
test('Set-Cookie on login has SameSite=None, Secure, Partitioned, Domain=api.*', async ({ request }) => {
  const res = await request.post(`${API_BASE}/api/auth/login`, {
    data: { kekHex: '...', userId: 'test' },
  })
  const setCookie = res.headers()['set-cookie']
  expect(setCookie).toContain('SameSite=None')
  expect(setCookie).toContain('Secure')
  expect(setCookie).toContain('Partitioned')
  expect(setCookie).toContain(`Domain=${new URL(API_BASE).hostname}`)
})

test('CORS only allows APP_ORIGIN', async ({ request }) => {
  const res = await request.fetch(`${API_BASE}/api/auth/me`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'GET',
    },
  })
  expect(res.headers()['access-control-allow-origin']).toBeUndefined()
})

test('CORS allows configured APP_ORIGIN with credentials', async ({ request }) => {
  const res = await request.fetch(`${API_BASE}/api/auth/me`, {
    method: 'OPTIONS',
    headers: {
      Origin: process.env.APP_ORIGIN!,
      'Access-Control-Request-Method': 'GET',
    },
  })
  expect(res.headers()['access-control-allow-origin']).toBe(process.env.APP_ORIGIN)
  expect(res.headers()['access-control-allow-credentials']).toBe('true')
})
```

- [ ] **Step 2: Update `cors.ts`**

```typescript
// src/server/middleware/cors.ts
import { cors as honoCors } from 'hono/cors'

const APP_ORIGIN = process.env.APP_ORIGIN ?? ''
if (!APP_ORIGIN) throw new Error('APP_ORIGIN env var not set')

export const cors = honoCors({
  origin: APP_ORIGIN,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-Nostr-Event-Id'],
  maxAge: 600,
})
```

- [ ] **Step 3: Update cookie setters in `auth-facade.ts`**

Every `setCookie(c, 'llamenos-refresh', ...)` and `setCookie(c, 'llamenos-session-id', ...)` gets:

```typescript
setCookie(c, 'llamenos-refresh', refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'None',
  domain: API_COOKIE_DOMAIN,  // from env
  path: '/api/auth',
  maxAge: 60 * 60 * 24 * 30,
  partitioned: true,  // CHIPS
})
```

Add `API_COOKIE_DOMAIN` env var; document in `.env.local.example`.

- [ ] **Step 4: Run tests**

```bash
bunx playwright test tests/api/split-origin-cors.spec.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/cors.ts src/server/routes/auth-facade.ts tests/api/split-origin-cors.spec.ts
git commit -m "feat(api): single-origin CORS + cross-site cookies with CHIPS partitioned attribute"
```

### Task 5: API-host CSP `script-src 'none'`

**Files:**
- Modify: `src/server/middleware/security-headers.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/api/split-origin-cors.spec.ts (append)
test('API host CSP has script-src none', async ({ request }) => {
  const res = await request.get(`${API_BASE}/api/health`)
  const csp = res.headers()['content-security-policy'] ?? res.headers()['content-security-policy-report-only']
  expect(csp).toContain("script-src 'none'")
  expect(csp).toContain("default-src 'none'")
  expect(csp).toContain("frame-ancestors 'none'")
})
```

- [ ] **Step 2: Update `security-headers.ts`**

```typescript
// src/server/middleware/security-headers.ts
function buildApiCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'none'",
    "frame-ancestors 'none'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "report-uri /api/csp-report",
  ].join('; ')
}

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()
  // ... other headers ...
  c.header('Content-Security-Policy', buildApiCsp())
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Resource-Policy', 'cross-origin')
  c.header('Access-Control-Allow-Origin', process.env.APP_ORIGIN ?? '')
})
```

- [ ] **Step 3: Test**

```bash
bunx playwright test tests/api/split-origin-cors.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/middleware/security-headers.ts
git commit -m "feat(api): lock CSP to script-src none; CORP cross-origin for cross-site reads"
```

### Task 6: Caddy multi-host config + `/etc/hosts` dev script

**Files:**
- Modify: `deploy/docker/Caddyfile.production`
- Modify: `deploy/docker/docker-compose.production.yml`
- Create: `scripts/dev-hosts.sh`
- Modify: `DEVELOPMENT.md`

- [ ] **Step 1: Write `scripts/dev-hosts.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

HOSTS=(
  "app.llamenos.localhost"
  "api.llamenos.localhost"
  "crypto.llamenos.localhost"
)

if ! grep -q "llamenos.localhost" /etc/hosts; then
  echo "Adding Llamenos dev hosts to /etc/hosts (requires sudo):"
  for host in "${HOSTS[@]}"; do
    echo "  127.0.0.1 $host"
  done
  printf "127.0.0.1 %s\n" "${HOSTS[@]}" | sudo tee -a /etc/hosts >/dev/null
fi
```

Make executable: `chmod +x scripts/dev-hosts.sh`.

- [ ] **Step 2: Write `test-dev-hosts.sh`**

```bash
#!/usr/bin/env bash
# tests/unit/dev-hosts.test.sh — idempotency check
set -euo pipefail
./scripts/dev-hosts.sh
./scripts/dev-hosts.sh  # second run must not duplicate entries
COUNT=$(grep -c "llamenos.localhost" /etc/hosts || echo 0)
[ "$COUNT" -eq 3 ] || { echo "Expected 3 entries, got $COUNT"; exit 1; }
```

- [ ] **Step 3: Rewrite `Caddyfile.production`**

```
{$APP_DOMAIN} {
  root * /var/llamenos/static
  file_server
  header Content-Security-Policy "default-src 'none'; script-src 'self' 'nonce-{http.request.header.X-CSP-Nonce}' 'strict-dynamic'; style-src 'self' 'nonce-{http.request.header.X-CSP-Nonce}' 'unsafe-hashes'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://{$API_DOMAIN} wss://{$API_DOMAIN}; worker-src 'self' blob:; manifest-src 'self'; frame-src https://{$CRYPTO_DOMAIN}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types llamenos; report-uri https://{$API_DOMAIN}/api/csp-report; upgrade-insecure-requests;"
  header Cross-Origin-Opener-Policy "same-origin"
  header Cross-Origin-Embedder-Policy "require-corp"
  header Cross-Origin-Resource-Policy "same-origin"
  header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
  header X-Frame-Options "DENY"
}

{$API_DOMAIN} {
  reverse_proxy localhost:3000
  header Cross-Origin-Opener-Policy "same-origin"
  header Cross-Origin-Resource-Policy "cross-origin"
}

{$CRYPTO_DOMAIN} {
  root * /var/llamenos/crypto-sandbox
  file_server
  header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'none'; connect-src 'self' https://{$API_DOMAIN} wss://{$API_DOMAIN}; worker-src 'self' blob:; frame-ancestors https://{$APP_DOMAIN}; base-uri 'none';"
  header Cross-Origin-Opener-Policy "same-origin"
  header Cross-Origin-Embedder-Policy "require-corp"
  header Cross-Origin-Resource-Policy "same-origin"
}
```

- [ ] **Step 4: Update Docker Compose**

```yaml
# deploy/docker/docker-compose.production.yml (additions)
services:
  app-static:
    image: caddy:2-alpine
    volumes:
      - ./Caddyfile.app:/etc/caddy/Caddyfile:ro
      - dist-client:/var/llamenos/static:ro
    ports:
      - "127.0.0.1:3100:80"
    environment:
      APP_DOMAIN: ${APP_DOMAIN}

  crypto-sandbox-static:
    image: caddy:2-alpine
    volumes:
      - ./Caddyfile.crypto:/etc/caddy/Caddyfile:ro
      - dist-crypto-sandbox:/var/llamenos/crypto-sandbox:ro
    ports:
      - "127.0.0.1:3101:80"
    environment:
      CRYPTO_DOMAIN: ${CRYPTO_DOMAIN}

  app:
    # existing Hono API service — unchanged except remove any port 80 mapping
```

- [ ] **Step 5: Commit**

```bash
git add scripts/dev-hosts.sh tests/unit/dev-hosts.test.sh deploy/docker/Caddyfile.production deploy/docker/docker-compose.production.yml DEVELOPMENT.md
git commit -m "feat(deploy): Caddy multi-host split + dev-hosts.sh for local subdomain dev"
```

### Task 7: Ansible split-process roles

**Files:**
- Create: `deploy/ansible/roles/llamenos-static/tasks/main.yml`
- Create: `deploy/ansible/roles/llamenos-crypto-sandbox/tasks/main.yml`
- Create: `deploy/ansible/roles/caddy-frontend/tasks/main.yml`
- Modify: `deploy/ansible/playbooks/deploy.yml`
- Modify: `deploy/ansible/demo_vars.example.yml`
- Modify: `deploy/ansible/playbooks/harden.yml`
- Create: `tests/deploy/test-split-origin.yml`

- [ ] **Step 1: Write `llamenos-static` role**

```yaml
# deploy/ansible/roles/llamenos-static/tasks/main.yml
- name: Create llamenos-static user
  ansible.builtin.user:
    name: llamenos-static
    system: true
    shell: /usr/sbin/nologin
    home: /opt/llamenos/static

- name: Create static directory
  ansible.builtin.file:
    path: /opt/llamenos/static
    state: directory
    owner: llamenos-static
    group: llamenos-static
    mode: '0755'

- name: Install dist/client artefacts
  ansible.builtin.unarchive:
    src: "{{ llamenos_release_tarball }}"
    dest: /opt/llamenos/static
    remote_src: yes
    extra_opts: ['--strip-components=2', '--wildcards', '*/dist/client/*']
    owner: llamenos-static
    group: llamenos-static

- name: Install llamenos-static-caddy systemd unit
  ansible.builtin.template:
    src: llamenos-static-caddy.service.j2
    dest: /etc/systemd/system/llamenos-static-caddy.service
    mode: '0644'
  notify: restart llamenos-static-caddy
```

Mirror pattern for `llamenos-crypto-sandbox` role (user `llamenos-crypto`, dir `/opt/llamenos/crypto-sandbox`, unit `llamenos-crypto-sandbox-caddy`).

- [ ] **Step 2: Write `caddy-frontend` role**

```yaml
# deploy/ansible/roles/caddy-frontend/tasks/main.yml
- name: Install frontend Caddy config
  ansible.builtin.template:
    src: Caddyfile.j2
    dest: /etc/caddy/Caddyfile
    mode: '0644'
    validate: 'caddy validate --config %s'
  notify: reload caddy
```

The Caddyfile template runs the three-site config from Task 6 and terminates TLS via Let's Encrypt.

- [ ] **Step 3: Update `deploy.yml`**

```yaml
# deploy/ansible/playbooks/deploy.yml (additions)
- hosts: llamenos
  roles:
    - llamenos          # existing: API container
    - llamenos-static   # new: SPA static files
    - llamenos-crypto-sandbox  # new: crypto iframe
    - caddy-frontend    # new: TLS terminator for all three
```

- [ ] **Step 4: Update `demo_vars.example.yml`**

```yaml
domain_app: app.demo.llamenos.example
domain_api: api.demo.llamenos.example
domain_crypto: crypto.demo.llamenos.example
```

- [ ] **Step 5: Write the deployment-isolation test**

```yaml
# tests/deploy/test-split-origin.yml
- hosts: llamenos
  gather_facts: false
  tasks:
    - name: Assert llamenos-static user exists and owns /opt/llamenos/static
      ansible.builtin.shell: |
        stat -c '%U' /opt/llamenos/static
      register: static_owner
      failed_when: static_owner.stdout != 'llamenos-static'

    - name: Assert llamenos-crypto user exists and owns /opt/llamenos/crypto-sandbox
      ansible.builtin.shell: |
        stat -c '%U' /opt/llamenos/crypto-sandbox
      register: crypto_owner
      failed_when: crypto_owner.stdout != 'llamenos-crypto'

    - name: Assert API user cannot write to static tree
      ansible.builtin.shell: |
        sudo -u llamenos touch /opt/llamenos/static/tamper && echo FAIL || echo OK
      register: api_tamper
      failed_when: api_tamper.stdout != 'OK'

    - name: Assert three distinct systemd units running
      ansible.builtin.shell: |
        systemctl is-active llamenos.service
        systemctl is-active llamenos-static-caddy.service
        systemctl is-active llamenos-crypto-sandbox-caddy.service
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ansible): split-process roles + three-user isolation + playbook test"
```

---

## Workstream 4.2 — Sandboxed crypto iframe

### Task 8: postMessage RPC zod schema

**Files:**
- Create: `src/shared/schemas/crypto-rpc.ts`
- Create: `src/shared/schemas/crypto-rpc.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/shared/schemas/crypto-rpc.test.ts
import { describe, expect, test } from 'bun:test'
import { CryptoRpcRequestSchema, CryptoRpcResponseSchema } from './crypto-rpc'

describe('CryptoRpcRequestSchema', () => {
  test('accepts a valid decryptEnvelope request', () => {
    const parsed = CryptoRpcRequestSchema.parse({
      op: 'decryptEnvelope',
      id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
      envelope: {
        v: 2,
        labelId: 0,
        wrappedKey: 'deadbeef'.repeat(12),
        ephemeralPubkey: '02' + 'ab'.repeat(32),
      },
      expectedLabel: 'llamenos:note-key',
      recordId: 'note-42',
    })
    expect(parsed.op).toBe('decryptEnvelope')
  })

  test('rejects an unknown op', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({ op: 'nukeEverything', id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' }),
    ).toThrow()
  })

  test('rejects invalid UUID', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({ op: 'lock', id: 'not-a-uuid' }),
    ).toThrow()
  })

  test('error response has coded error enum', () => {
    const parsed = CryptoRpcResponseSchema.parse({
      kind: 'error',
      id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
      code: 'label_mismatch',
      message: 'expected llamenos:note-key, got llamenos:message',
    })
    expect(parsed.kind).toBe('error')
  })
})
```

- [ ] **Step 2: Implement the schema per spec §4.2.3**

Copy the full `CryptoRpcRequestSchema` discriminated union + `CryptoRpcSuccessSchema` + `CryptoRpcErrorSchema` from the spec into `src/shared/schemas/crypto-rpc.ts`. Export types via `z.infer`.

- [ ] **Step 3: Run tests**

```bash
bun test src/shared/schemas/crypto-rpc.test.ts
```

Expected: 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/schemas/crypto-rpc.ts src/shared/schemas/crypto-rpc.test.ts
git commit -m "feat(rpc): zod schema for crypto-iframe postMessage RPC"
```

### Task 9: Iframe-side RPC router + origin check

**Files:**
- Create: `crypto-sandbox/src/rpc-router.ts`
- Create: `crypto-sandbox/src/rpc-router.test.ts`
- Modify: `crypto-sandbox/src/main.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// crypto-sandbox/src/rpc-router.test.ts
import { describe, expect, test } from 'bun:test'
import { CryptoRpcRouter } from './rpc-router'

describe('CryptoRpcRouter', () => {
  test('handleMessage rejects wrong origin', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: 'https://app.llamenos.example' })
    const postedResponses: unknown[] = []
    const ev = new MessageEvent('message', {
      data: { op: 'isUnlocked', id: crypto.randomUUID() },
      origin: 'https://evil.example',
    })
    await router.handleMessage(ev, (res) => postedResponses.push(res))
    expect(postedResponses.length).toBe(0)
  })

  test('handleMessage rejects malformed payload with schema_invalid error', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: 'https://app.llamenos.example' })
    const responses: Array<{ kind: string; code?: string }> = []
    const ev = new MessageEvent('message', {
      data: { nonsense: true },
      origin: 'https://app.llamenos.example',
    })
    await router.handleMessage(ev, (res) => responses.push(res as typeof responses[number]))
    expect(responses[0]?.kind).toBe('error')
    expect(responses[0]?.code).toBe('schema_invalid')
  })

  test('handleMessage routes isUnlocked op and returns success false when no key', async () => {
    const router = new CryptoRpcRouter({ parentOrigin: 'https://app.llamenos.example' })
    const responses: Array<{ kind: string; result?: unknown }> = []
    await router.handleMessage(
      new MessageEvent('message', {
        data: { op: 'isUnlocked', id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
        origin: 'https://app.llamenos.example',
      }),
      (res) => responses.push(res as typeof responses[number]),
    )
    expect(responses[0]?.kind).toBe('success')
    expect(responses[0]?.result).toBe(false)
  })
})
```

- [ ] **Step 2: Implement the router**

```typescript
// crypto-sandbox/src/rpc-router.ts
import {
  CryptoRpcRequestSchema,
  type CryptoRpcResponse,
  type CryptoRpcRequest,
} from '@shared/schemas/crypto-rpc'

interface RouterConfig {
  parentOrigin: string
}

type ResponseFn = (res: CryptoRpcResponse) => void

export class CryptoRpcRouter {
  constructor(private readonly config: RouterConfig) {}

  async handleMessage(ev: MessageEvent, respond: ResponseFn): Promise<void> {
    // MANDATORY origin check — first thing
    if (ev.origin !== this.config.parentOrigin) return
    const parsed = CryptoRpcRequestSchema.safeParse(ev.data)
    if (!parsed.success) {
      // The id may or may not be present in an invalid payload; best-effort
      const maybeId = typeof (ev.data as { id?: string })?.id === 'string'
        ? (ev.data as { id: string }).id
        : '00000000-0000-0000-0000-000000000000'
      respond({
        kind: 'error',
        id: maybeId,
        code: 'schema_invalid',
        message: parsed.error.issues[0]?.message ?? 'invalid request shape',
      })
      return
    }
    const req = parsed.data
    try {
      const result = await this.dispatch(req)
      respond({ kind: 'success', id: req.id, result })
    } catch (err) {
      respond({
        kind: 'error',
        id: req.id,
        code: this.classifyError(err),
        message: err instanceof Error ? err.message : 'internal error',
      })
    }
  }

  private async dispatch(req: CryptoRpcRequest): Promise<unknown> {
    switch (req.op) {
      case 'isUnlocked':
        return this.isUnlocked()
      case 'getPublicKey':
        return this.getPublicKey()
      case 'unlock':
        return this.unlock(req)
      case 'lock':
        return this.lock()
      case 'decryptEnvelope':
        return this.decryptEnvelope(req)
      case 'decryptHubField':
        return this.decryptHubField(req)
      case 'encryptHubField':
        return this.encryptHubField(req)
      case 'signAuditEntry':
        return this.signAuditEntry(req)
      case 'rotateHubKey':
        return this.rotateHubKey(req)
      case 'reportBundleHash':
        return this.reportBundleHash(req)
    }
  }

  // Method implementations delegate to the crypto worker + key store
  // that live inside the iframe (moved in Task 10).
  // Stubs return sensible defaults so Task 9 tests can focus on plumbing.
  private isUnlocked(): boolean { return false }
  private async getPublicKey(): Promise<string | null> { return null }
  private async unlock(_req: Extract<CryptoRpcRequest, { op: 'unlock' }>): Promise<null> { return null }
  private async lock(): Promise<null> { return null }
  private async decryptEnvelope(_req: Extract<CryptoRpcRequest, { op: 'decryptEnvelope' }>): Promise<string> { throw new Error('not implemented') }
  private async decryptHubField(_req: Extract<CryptoRpcRequest, { op: 'decryptHubField' }>): Promise<string> { throw new Error('not implemented') }
  private async encryptHubField(_req: Extract<CryptoRpcRequest, { op: 'encryptHubField' }>): Promise<string> { throw new Error('not implemented') }
  private async signAuditEntry(_req: Extract<CryptoRpcRequest, { op: 'signAuditEntry' }>): Promise<string> { throw new Error('not implemented') }
  private async rotateHubKey(_req: Extract<CryptoRpcRequest, { op: 'rotateHubKey' }>): Promise<unknown> { throw new Error('not implemented') }
  private async reportBundleHash(_req: Extract<CryptoRpcRequest, { op: 'reportBundleHash' }>): Promise<null> { return null }

  private classifyError(err: unknown): CryptoRpcResponse extends { kind: 'error'; code: infer C } ? C : never {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('label_mismatch')) return 'label_mismatch'
    if (msg.includes('locked')) return 'locked'
    if (msg.includes('rate')) return 'rate_limited'
    return 'internal'
  }
}
```

- [ ] **Step 3: Wire into `main.ts`**

```typescript
// crypto-sandbox/src/main.ts
import { CryptoRpcRouter } from './rpc-router'

const parentOrigin = document.location.ancestorOrigins?.[0] ?? ''
const router = new CryptoRpcRouter({ parentOrigin })

window.addEventListener('message', async (ev) => {
  await router.handleMessage(ev, (res) => window.parent.postMessage(res, parentOrigin))
})

// Broadcast 'ready' after policy install completes
window.parent.postMessage({ kind: 'ready' }, '*')  // note: one-shot; subsequent is strict-origin
```

- [ ] **Step 4: Run tests**

```bash
bun test crypto-sandbox/src/rpc-router.test.ts
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add crypto-sandbox/src/rpc-router.ts crypto-sandbox/src/rpc-router.test.ts crypto-sandbox/src/main.ts
git commit -m "feat(crypto-sandbox): postMessage RPC router with mandatory origin check + schema validation"
```

### Task 10: Move crypto worker code into the iframe

**Files:**
- Move: `src/client/lib/crypto-worker.ts` → `crypto-sandbox/src/crypto-worker.ts`
- Move: `src/client/lib/key-store-v2.ts` → `crypto-sandbox/src/key-store.ts`
- Move: `src/client/lib/envelope-field-crypto.ts` → `crypto-sandbox/src/envelope-field-crypto.ts`
- Move: `src/client/lib/hub-field-crypto.ts` → `crypto-sandbox/src/hub-field-crypto.ts`
- Move: `src/client/lib/audit-log-client.ts` → `crypto-sandbox/src/audit-log.ts`
- Move: `src/client/lib/hub-key-manager.ts` → `crypto-sandbox/src/hub-key-manager.ts`
- Move: `src/client/lib/audit-chain-verifier.ts` → `crypto-sandbox/src/audit-chain-verifier.ts`
- Modify: `crypto-sandbox/src/rpc-router.ts` (wire to the moved modules)

- [ ] **Step 1: Copy files with `git mv`**

```bash
git mv src/client/lib/crypto-worker.ts crypto-sandbox/src/crypto-worker.ts
git mv src/client/lib/key-store-v2.ts crypto-sandbox/src/key-store.ts
git mv src/client/lib/envelope-field-crypto.ts crypto-sandbox/src/envelope-field-crypto.ts
git mv src/client/lib/hub-field-crypto.ts crypto-sandbox/src/hub-field-crypto.ts
git mv src/client/lib/audit-log-client.ts crypto-sandbox/src/audit-log.ts
git mv src/client/lib/hub-key-manager.ts crypto-sandbox/src/hub-key-manager.ts
git mv src/client/lib/audit-chain-verifier.ts crypto-sandbox/src/audit-chain-verifier.ts
git mv src/client/lib/crypto-worker.test.ts crypto-sandbox/src/crypto-worker.test.ts
```

Move all associated `.test.ts` companions too.

- [ ] **Step 2: Update imports inside moved files**

Relative imports `./key-store-v2` → `./key-store`, etc. `@shared/...` imports continue working via `crypto-sandbox/tsconfig.json` path mapping.

- [ ] **Step 3: Rewrite `rpc-router.ts` to delegate to the real modules**

Replace the Task 9 stubs with real method bodies that delegate to the imported key store and crypto worker.

- [ ] **Step 4: Typecheck + test**

```bash
bun run typecheck
bun test crypto-sandbox/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(crypto-sandbox): move crypto worker + key store + rotation + chain verifier into iframe"
```

### Task 11: Rewrite `crypto-worker-client.ts` as `crypto-iframe-client.ts`

**Files:**
- Delete: `src/client/lib/crypto-worker-client.ts`
- Delete: `src/client/lib/crypto-worker-client.test.ts`
- Create: `src/client/lib/crypto-iframe-client.ts`
- Create: `src/client/lib/crypto-iframe-client.test.ts`
- Modify: every file that imports `crypto-worker-client`

- [ ] **Step 1: Write failing tests (mock iframe)**

```typescript
// src/client/lib/crypto-iframe-client.test.ts
import { describe, expect, test } from 'bun:test'
import { CryptoIframeClient } from './crypto-iframe-client'

function makeFakeIframe() {
  const listeners: Array<(ev: MessageEvent) => void> = []
  return {
    iframe: {
      contentWindow: {
        postMessage: (req: unknown, _origin: string) => {
          // Simulate the sandbox responding
          setTimeout(() => {
            const ev = new MessageEvent('message', {
              data: { kind: 'success', id: (req as { id: string }).id, result: false },
              origin: 'https://crypto.llamenos.example',
            })
            listeners.forEach((l) => l(ev))
          }, 0)
        },
      },
    },
    onMessage: (l: (ev: MessageEvent) => void) => listeners.push(l),
  }
}

describe('CryptoIframeClient', () => {
  test('isUnlocked returns false via mock iframe', async () => {
    const fake = makeFakeIframe()
    const client = new CryptoIframeClient({
      cryptoOrigin: 'https://crypto.llamenos.example',
      _fakeIframeForTests: fake,
    })
    await client.ready
    expect(await client.isUnlocked()).toBe(false)
  })

  test('ignores messages from wrong origin', async () => {
    const fake = makeFakeIframe()
    const client = new CryptoIframeClient({
      cryptoOrigin: 'https://crypto.llamenos.example',
      _fakeIframeForTests: fake,
    })
    // Simulate a hostile postMessage; should be dropped
    fake.onMessage(() => {})
    window.postMessage(
      { kind: 'success', id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab', result: 'evil' },
      'https://evil.example',
    )
    // The client should still respond to a real message normally
    expect(await client.isUnlocked()).toBe(false)
  })
})
```

- [ ] **Step 2: Implement the client per spec §4.2.4**

Copy the `CryptoIframeClient` skeleton from the spec. Add `_fakeIframeForTests` injection hook for unit testing.

- [ ] **Step 3: Delete old worker client**

```bash
git rm src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker-client.test.ts
```

- [ ] **Step 4: Repoint every importer**

```bash
grep -rn "crypto-worker-client" src/client --include="*.ts" --include="*.tsx"
```

Change each import:

```typescript
// before
import { cryptoWorker } from './crypto-worker-client'
// after
import { cryptoIframe as cryptoWorker } from './crypto-iframe-client'
```

The singleton name `cryptoWorker` is kept locally so call sites compile unchanged; the actual exported singleton is `cryptoIframe`.

- [ ] **Step 5: Tests + typecheck**

```bash
bun run typecheck
bun test src/client/lib/crypto-iframe-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): CryptoIframeClient replaces CryptoWorkerClient as postMessage RPC transport"
```

### Task 12: Iframe boot + lifecycle + `SandboxLoader` UX

**Files:**
- Create: `src/client/components/sandbox-loader.tsx`
- Modify: `src/client/main.tsx`
- Modify: `src/client/lib/crypto-iframe-client.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/ui/crypto-iframe-rpc.spec.ts
import { test, expect } from '@playwright/test'

test('sandbox iframe boots and main app renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('crypto-sandbox-iframe')).toBeAttached()
  // iframe is hidden by design
  await expect(page.getByTestId('crypto-sandbox-iframe')).toBeHidden()
  // Main shell renders after iframe reports ready
  await expect(page.getByTestId('app-shell')).toBeVisible()
})

test('iframe has sandbox="allow-scripts" only (no allow-same-origin)', async ({ page }) => {
  await page.goto('/')
  const sandboxAttr = await page.getByTestId('crypto-sandbox-iframe').getAttribute('sandbox')
  expect(sandboxAttr).toBe('allow-scripts')
  expect(sandboxAttr).not.toContain('allow-same-origin')
})
```

- [ ] **Step 2: Implement `SandboxLoader`**

```tsx
// src/client/components/sandbox-loader.tsx
export function SandboxLoader({ children, ready }: { children: React.ReactNode; ready: boolean }) {
  if (!ready) {
    return (
      <div data-testid="sandbox-loader" className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading secure sandbox…</div>
      </div>
    )
  }
  return <>{children}</>
}
```

- [ ] **Step 3: Wire into `main.tsx`**

```tsx
// src/client/main.tsx (near root)
function Boot() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    cryptoIframe.ready.then(() => setReady(true))
  }, [])
  return (
    <SandboxLoader ready={ready}>
      <AppShell />
    </SandboxLoader>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
bunx playwright test tests/ui/crypto-iframe-rpc.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): SandboxLoader UX + iframe boot wiring in main.tsx"
```

### Task 13: Cross-origin isolation tests

**Files:**
- Create: `tests/ui/cross-origin-isolation.spec.ts`
- Create: `tests/ui/iframe-postmessage-origin-check.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/ui/cross-origin-isolation.spec.ts
import { test, expect } from '@playwright/test'

test('window.crossOriginIsolated === true on SPA origin', async ({ page }) => {
  await page.goto('/')
  const isolated = await page.evaluate(() => window.crossOriginIsolated)
  expect(isolated).toBe(true)
})

test('crypto iframe inherits cross-origin isolation', async ({ page }) => {
  await page.goto('/')
  const frame = page.frameLocator('[data-testid="crypto-sandbox-iframe"]')
  const isolated = await frame.locator('body').evaluate(() => window.crossOriginIsolated)
  expect(isolated).toBe(true)
})

test('no allow-same-origin token in sandbox attribute', async ({ page }) => {
  await page.goto('/')
  const sandbox = await page.getByTestId('crypto-sandbox-iframe').getAttribute('sandbox')
  expect(sandbox?.split(' ')).not.toContain('allow-same-origin')
})
```

```typescript
// tests/ui/iframe-postmessage-origin-check.spec.ts
test('postMessage from wrong origin is silently dropped', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('[data-testid="app-shell"]')

  // Inject a listener to verify no successful responses come from evil origins
  const result = await page.evaluate(() => {
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('no-response'), 500)
      window.addEventListener('message', (ev) => {
        if ((ev.data as { kind?: string }).kind === 'success') {
          clearTimeout(timer)
          resolve('success-received')
        }
      })
      // Attempt to inject a fake response claiming to be from the iframe
      window.postMessage(
        { kind: 'success', id: 'fake-id', result: 'pwned' },
        window.location.origin,
      )
    })
  })

  expect(result).toBe('no-response')
})
```

- [ ] **Step 2: Run**

```bash
bunx playwright test tests/ui/cross-origin-isolation.spec.ts tests/ui/iframe-postmessage-origin-check.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/ui/cross-origin-isolation.spec.ts tests/ui/iframe-postmessage-origin-check.spec.ts
git commit -m "test(ui): cross-origin isolation + postMessage origin check adversarial tests"
```

### Task 14: Cross-origin refresh fallback (ITP / strict cookie path)

**Files:**
- Create: `src/client/lib/cross-origin-refresh.ts`
- Modify: `src/client/lib/auth.tsx`
- Modify: `src/server/routes/auth-facade.ts`
- Create: `tests/ui/cross-origin-refresh.spec.ts`

- [ ] **Step 1: Write test**

```typescript
// tests/ui/cross-origin-refresh.spec.ts
import { test, expect } from '@playwright/test'

test('refresh succeeds in normal cookie path', async ({ page, context }) => {
  await loginAs(page, 'volunteer-1')
  await page.waitForSelector('[data-testid="app-shell"]')
  // Wait past the refresh window
  await page.clock.fastForward('00:20:00')
  await expect(page.getByTestId('app-shell')).toBeVisible()
})

test('refresh falls back to redirect when cross-site cookies blocked', async ({ page, context }) => {
  await context.clearCookies()
  // Simulate ITP by blocking third-party cookies entirely
  await context.addInitScript(() => {
    Object.defineProperty(document, 'cookie', {
      get: () => '',
      set: () => undefined,
    })
  })
  await loginAs(page, 'volunteer-1')
  await page.clock.fastForward('00:20:00')
  await expect(page).toHaveURL(/api\.llamenos/)  // hopped to API host for first-party refresh
  await page.waitForURL(/app\.llamenos/)  // hopped back
})
```

- [ ] **Step 2: Implement `cross-origin-refresh.ts`**

```typescript
// src/client/lib/cross-origin-refresh.ts
export async function attemptCrossOriginRefresh(returnTo: string): Promise<void> {
  const url = new URL(`${import.meta.env.VITE_API_ORIGIN}/api/auth/refresh`)
  url.searchParams.set('return_to', returnTo)
  window.location.assign(url.toString())
}

export function isCookieBlockedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('401') ||
    err.message.includes('cookie') ||
    err.message.includes('blocked')
  )
}
```

- [ ] **Step 3: Hook into `auth.tsx`**

```typescript
// src/client/lib/auth.tsx (inside the refresh handler)
try {
  await refreshToken()
} catch (err) {
  if (isCookieBlockedError(err)) {
    await attemptCrossOriginRefresh(window.location.pathname)
    return
  }
  throw err
}
```

- [ ] **Step 4: Implement the `/api/auth/refresh?return_to=...` redirect endpoint**

```typescript
// src/server/routes/auth-facade.ts (new route)
const refreshRedirectRoute = createRoute({
  method: 'get',
  path: '/auth/refresh',
  request: {
    query: z.object({ return_to: z.string().url() }),
  },
  responses: { 302: { description: 'Redirect back to app origin' } },
})

authFacade.openapi(refreshRedirectRoute, async (c) => {
  const { return_to } = c.req.valid('query')
  const returnUrl = new URL(return_to)
  if (returnUrl.origin !== process.env.APP_ORIGIN) {
    return c.json({ error: 'invalid return_to' }, 400)
  }
  // Read the refresh cookie (first-party to api.llamenos.example)
  const cookie = getCookie(c, 'llamenos-refresh')
  if (!cookie) return c.json({ error: 'no session' }, 401)
  // Rotate the refresh token, issue a short-lived grant bound to the app origin
  const newSession = await rotateRefreshToken(cookie, { appOrigin: returnUrl.origin })
  const grantUrl = new URL(returnUrl.toString())
  grantUrl.searchParams.set('grant', newSession.shortGrant)
  return c.redirect(grantUrl.toString(), 302)
})
```

- [ ] **Step 5: Run tests**

```bash
bunx playwright test tests/ui/cross-origin-refresh.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): cross-origin refresh fallback via first-party redirect when ITP blocks cookies"
```

---

## Workstream 4.3 — Third-party bundle-hash verifier

### Task 15: Verifier scripts in the main repo

**Files:**
- Create: `scripts/fetch-referenced-assets.sh`
- Create: `scripts/compare-served-to-released.sh`
- Create: `scripts/post-nostr-verdict.sh`
- Create: `docs/security/VERIFIER_RUNBOOK.md`
- Create: `docs/security/VERIFIER_MOU.md`

- [ ] **Step 1: Implement `fetch-referenced-assets.sh`**

```bash
#!/usr/bin/env bash
# scripts/fetch-referenced-assets.sh
# Usage: fetch-referenced-assets.sh <html-file> <host> <out-dir>
set -euo pipefail
HTML="$1"
HOST="$2"
OUT="$3"
mkdir -p "$OUT"

# Parse <script src="...">, <link href="...">, <img src="..."> — filter to same-host paths
grep -oE '(src|href)="[^"]+"' "$HTML" \
  | sed 's/.*="\([^"]*\)"/\1/' \
  | while read -r path; do
      case "$path" in
        /*) url="https://$HOST$path" ;;
        http*) url="$path" ;;
        *) url="https://$HOST/$path" ;;
      esac
      # Only fetch if same host
      if echo "$url" | grep -q "https://$HOST/"; then
        relative="${url#https://$HOST/}"
        mkdir -p "$OUT/$(dirname "$relative")"
        curl -fsSL "$url" -o "$OUT/$relative"
      fi
    done
```

- [ ] **Step 2: Implement `compare-served-to-released.sh`**

```bash
#!/usr/bin/env bash
# scripts/compare-served-to-released.sh
# Usage: compare-served-to-released.sh <served-dir> <checksums-file>
set -euo pipefail
SERVED="$1"
CHECKSUMS="$2"
FAIL=0
> mismatch-report.md

while read -r hash path; do
  # Strip "./dist/client/" prefix if present; try to find the matching file under served/
  clean="${path#./dist/client/}"
  local_path="$SERVED/$clean"
  if [ ! -f "$local_path" ]; then
    echo "- Missing on served: $clean" >> mismatch-report.md
    FAIL=1
    continue
  fi
  local_hash=$(sha256sum "$local_path" | awk '{print $1}')
  if [ "$local_hash" != "$hash" ]; then
    echo "- MISMATCH: $clean" >> mismatch-report.md
    echo "  - Released: $hash" >> mismatch-report.md
    echo "  - Served:   $local_hash" >> mismatch-report.md
    FAIL=1
  fi
done < "$CHECKSUMS"

exit "$FAIL"
```

- [ ] **Step 3: Implement `post-nostr-verdict.sh`**

```bash
#!/usr/bin/env bash
# scripts/post-nostr-verdict.sh <outcome> <served-dir>
set -euo pipefail
OUTCOME="$1"
RELAY="${NOSTR_RELAY_URL:-wss://api.llamenos.example/nostr}"

if [ -z "${VERIFIER_NSEC:-}" ]; then
  echo "VERIFIER_NSEC not set" >&2
  exit 2
fi

NOW=$(date +%s)
CONTENT=$(printf '{"kind":"verify-verdict","outcome":"%s","timestamp":%d}' "$OUTCOME" "$NOW")
# Use a minimal Bun script to sign + publish (vendored alongside the runbook)
bun run "$(dirname "$0")/verifier-publish.ts" --content "$CONTENT" --relay "$RELAY"
```

Ship `scripts/verifier-publish.ts` as the Bun-based Nostr publisher using `nostr-tools`.

- [ ] **Step 4: Write `VERIFIER_RUNBOOK.md`**

Sections: "Why host a verifier", "Five-command setup", "Rotate keys", "What to do on mismatch", "Operational cost".

Five-command setup:
```bash
gh repo create my-org/verify-llamenos --public --clone
cp -r .github/workflow-templates/verify-llamenos.yml .github/workflows/
./scripts/generate-verifier-nostr-key.sh | tee verifier.nsec  # offline machine!
gh secret set VERIFIER_NSEC --body-file verifier.nsec
git add . && git commit -m "setup: verify-llamenos workflow" && git push
```

- [ ] **Step 5: Write `VERIFIER_MOU.md`**

One-page template the allied organisation signs off on: what we're asking of them, what Llamenos commits to in return (advance notice of key rotations), what their liability is (none), how to resign, how to contact Llamenos security.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-referenced-assets.sh scripts/compare-served-to-released.sh scripts/post-nostr-verdict.sh docs/security/VERIFIER_RUNBOOK.md docs/security/VERIFIER_MOU.md
git commit -m "feat(verifier): scripts + runbook + MOU for allied-org bundle verifier"
```

### Task 16: Verifier GitHub Action workflow template

**Files:**
- Create: `.github/workflow-templates/verify-llamenos.yml`
- Create: `.github/workflow-templates/verify-llamenos.properties.json`

- [ ] **Step 1: Write the workflow template**

Copy the full workflow from spec §4.3.1, parameterising the repo and domain.

```yaml
# .github/workflow-templates/verify-llamenos.yml
name: Verify Llamenos bundle
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch: {}

jobs:
  verify:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      id-token: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - uses: sigstore/cosign-installer@d7d6e079ac29fd41e9a4c81c7a1b6e4e8b7fe1ec  # v3.7.0
      - uses: oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76  # v1.2.0
      - run: mkdir -p served released
      - run: curl -fsSL https://app.llamenos.example/ -o served/index.html
      - run: curl -fsSL https://crypto.llamenos.example/sandbox.html -o served/sandbox.html
      - run: ./scripts/fetch-referenced-assets.sh served/index.html app.llamenos.example served/
      - run: ./scripts/fetch-referenced-assets.sh served/sandbox.html crypto.llamenos.example served/
      - name: Fetch latest release
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: |
          gh release download --repo llamenos/llamenos-hotline --pattern 'CHECKSUMS.txt' --dir released/
          gh release download --repo llamenos/llamenos-hotline --pattern 'CHECKSUMS.txt.cosign-bundle' --dir released/
      - name: Verify cosign bundle
        run: |
          cosign verify-blob \
            --bundle released/CHECKSUMS.txt.cosign-bundle \
            --certificate-identity-regexp "^https://github\.com/llamenos/llamenos-hotline/\.github/workflows/release\.yml@refs/tags/" \
            --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
            released/CHECKSUMS.txt
      - name: Compare
        id: compare
        run: ./scripts/compare-served-to-released.sh served/ released/CHECKSUMS.txt
      - name: Post Nostr verdict
        if: always()
        env: { VERIFIER_NSEC: ${{ secrets.VERIFIER_NSEC }} }
        run: ./scripts/post-nostr-verdict.sh ${{ steps.compare.outcome }} served/
      - name: Open issue on mismatch
        if: steps.compare.outcome == 'failure'
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: gh issue create --title "MISMATCH on $(date -u)" --body-file mismatch-report.md --label "urgent,bundle-mismatch"
```

- [ ] **Step 2: Add `verify-llamenos.properties.json`**

```json
{
  "name": "Verify Llamenos bundle",
  "description": "Runs every 15 minutes; fetches app.llamenos.example + crypto.llamenos.example bundles, verifies cosign signature on CHECKSUMS, compares hashes, publishes verdict to Nostr, opens issue on mismatch.",
  "iconName": "octicon verified",
  "categories": ["Security"],
  "filePatterns": []
}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflow-templates/verify-llamenos.yml .github/workflow-templates/verify-llamenos.properties.json
git commit -m "feat(verifier): GitHub Actions workflow template for allied-org bundle verification"
```

### Task 17: Local verifier — browser-side one-click check

**Files:**
- Create: `src/client/lib/local-verifier.ts`
- Create: `src/client/lib/local-verifier.test.ts`
- Create: `src/client/components/local-verifier-dialog.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/local-verifier.test.ts
import { describe, expect, test } from 'bun:test'
import { runLocalVerifier } from './local-verifier'

describe('local verifier', () => {
  test('returns `match` when served hash matches release hash', async () => {
    const fakeReleaseManifest = JSON.stringify({
      'index.html': 'a'.repeat(64),
      'assets/main.js': 'b'.repeat(64),
    })
    const fetchMock = async (url: string) => {
      if (url.includes('bundle-manifest.json')) return new Response(fakeReleaseManifest)
      if (url.includes('index.html')) return new Response('fake content')
      return new Response('other')
    }
    // ... mock crypto.subtle.digest to return expected hashes
    const result = await runLocalVerifier({ fetchFn: fetchMock as typeof fetch })
    expect(result.status).toBe('match')
  })

  test('returns `mismatch` when any file differs', async () => {
    // ... similar but with a divergent hash
  })
})
```

- [ ] **Step 2: Implement `local-verifier.ts`**

```typescript
// src/client/lib/local-verifier.ts
export interface LocalVerifierResult {
  status: 'match' | 'mismatch' | 'error'
  checkedFiles: number
  mismatches: Array<{ path: string; expected: string; actual: string }>
  releaseTag: string
}

export async function runLocalVerifier(
  opts: { fetchFn?: typeof fetch } = {},
): Promise<LocalVerifierResult> {
  const f = opts.fetchFn ?? fetch
  // 1. Fetch the released bundle manifest from the API origin (served from GitHub Release by the API proxy)
  const manifestRes = await f(`${import.meta.env.VITE_API_ORIGIN}/api/releases/latest/bundle-manifest`)
  if (!manifestRes.ok) return { status: 'error', checkedFiles: 0, mismatches: [], releaseTag: '' }
  const manifest = (await manifestRes.json()) as { releaseTag: string; files: Record<string, string> }

  // 2. For each file, fetch it from the app host and compute its hash
  const mismatches: LocalVerifierResult['mismatches'] = []
  let checked = 0
  for (const [path, expected] of Object.entries(manifest.files)) {
    const url = `${import.meta.env.VITE_APP_ORIGIN ?? window.location.origin}/${path}`
    const res = await f(url, { cache: 'no-store' })
    if (!res.ok) {
      mismatches.push({ path, expected, actual: 'fetch-failed' })
      continue
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const actual = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    if (actual !== expected) mismatches.push({ path, expected, actual })
    checked++
  }

  return {
    status: mismatches.length === 0 ? 'match' : 'mismatch',
    checkedFiles: checked,
    mismatches,
    releaseTag: manifest.releaseTag,
  }
}
```

- [ ] **Step 3: Implement the UI dialog**

```tsx
// src/client/components/local-verifier-dialog.tsx
export function LocalVerifierDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<LocalVerifierResult | null>(null)
  const [running, setRunning] = useState(false)
  async function run() {
    setRunning(true)
    try {
      setResult(await runLocalVerifier())
    } finally {
      setRunning(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} data-testid="local-verifier-dialog">
      <DialogTitle>Verify the running bundle</DialogTitle>
      <DialogContent>
        {result && result.status === 'match' && (
          <p data-testid="verifier-match">
            ✓ All {result.checkedFiles} files match release {result.releaseTag}.
          </p>
        )}
        {result && result.status === 'mismatch' && (
          <div data-testid="verifier-mismatch">
            <p>⚠️ {result.mismatches.length} file(s) do not match release {result.releaseTag}.</p>
            <ul>
              {result.mismatches.map((m) => (
                <li key={m.path}>
                  <code>{m.path}</code>: expected <code>{m.expected.slice(0, 16)}…</code>, got <code>{m.actual.slice(0, 16)}…</code>
                </li>
              ))}
            </ul>
            <p>Do not enter your PIN until the mismatch is resolved.</p>
          </div>
        )}
        <Button onClick={run} disabled={running} data-testid="verifier-run-button">
          {running ? 'Verifying…' : 'Verify bundle'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Add the `/api/releases/latest/bundle-manifest` endpoint**

Server proxies GitHub Releases to return the `bundle-manifest.json` attached to the latest release. Simple caching via `Cache-Control`.

- [ ] **Step 5: Run tests**

```bash
bun test src/client/lib/local-verifier.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(verifier): local one-click verifier + API proxy for bundle-manifest.json"
```

---

## Workstream 4.4 — Gossip attestation

### Task 18: `bundle-attest.ts` — client publish + subscribe

**Files:**
- Create: `src/shared/schemas/bundle-attest.ts`
- Create: `src/shared/schemas/bundle-attest.test.ts`
- Create: `src/client/lib/bundle-attest.ts`
- Create: `src/client/lib/bundle-attest.test.ts`

- [ ] **Step 1: Write the Nostr event content schema**

```typescript
// src/shared/schemas/bundle-attest.ts
import { z } from '@hono/zod-openapi'

export const BundleAttestContentSchema = z.object({
  version: z.literal(1),
  bundleHash: z.string().regex(/^[0-9a-f]{64}$/),
  bundleVersion: z.string(),
  releaseTag: z.string(),
  timestamp: z.number().int(),
  userAgent: z.string().max(256),
})
export type BundleAttestContent = z.infer<typeof BundleAttestContentSchema>

export const BUNDLE_ATTEST_KIND = 20002 as const  // strfry ephemeral range
```

- [ ] **Step 2: Write failing test**

```typescript
// src/client/lib/bundle-attest.test.ts
import { describe, expect, test } from 'bun:test'
import { computeBundleHash, publishBundleAttest, subscribeFleetAttests } from './bundle-attest'

describe('bundle-attest', () => {
  test('computeBundleHash is deterministic', async () => {
    const h1 = await computeBundleHash()
    const h2 = await computeBundleHash()
    expect(h1).toBe(h2)
  })

  test('publishBundleAttest publishes a kind 20002 event via the crypto iframe', async () => {
    const sent: unknown[] = []
    mockCryptoIframe({ reportBundleHash: (req) => sent.push(req) })
    await publishBundleAttest()
    expect(sent.length).toBe(1)
    expect((sent[0] as { hashHex: string }).hashHex).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 3: Implement `bundle-attest.ts`**

```typescript
// src/client/lib/bundle-attest.ts
import { cryptoIframe } from './crypto-iframe-client'
import { BUNDLE_ATTEST_KIND, type BundleAttestContent } from '@shared/schemas/bundle-attest'
import { subscribeEvents } from './nostr/relay'

export async function computeBundleHash(): Promise<string> {
  // Fetch every script/style/html reference in the current document and hash them
  const urls = Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'))
    .map((el) => (el as HTMLScriptElement).src || (el as HTMLLinkElement).href)
    .filter((u) => u.startsWith(window.location.origin))
  urls.push(window.location.origin + '/')  // index.html itself
  const bytes: Uint8Array[] = []
  for (const u of urls.sort()) {
    const res = await fetch(u, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Failed to fetch ${u}`)
    bytes.push(new Uint8Array(await res.arrayBuffer()))
  }
  const totalLen = bytes.reduce((a, b) => a + b.length, 0)
  const merged = new Uint8Array(totalLen)
  let off = 0
  for (const b of bytes) {
    merged.set(b, off)
    off += b.length
  }
  const digest = await crypto.subtle.digest('SHA-256', merged)
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

export async function publishBundleAttest(): Promise<void> {
  const hashHex = await computeBundleHash()
  const content: BundleAttestContent = {
    version: 1,
    bundleHash: hashHex,
    bundleVersion: (window as unknown as { LLAMENOS_VERSION?: string }).LLAMENOS_VERSION ?? 'dev',
    releaseTag: (window as unknown as { LLAMENOS_RELEASE_TAG?: string }).LLAMENOS_RELEASE_TAG ?? 'dev',
    timestamp: Math.floor(Date.now() / 1000),
    userAgent: navigator.userAgent.slice(0, 256),
  }
  // The signing key lives inside the iframe — forward hash + content to it
  await cryptoIframe.reportBundleHash(hashHex, content.timestamp)
}

export function subscribeFleetAttests(cb: (attest: BundleAttestContent) => void): () => void {
  return subscribeEvents([BUNDLE_ATTEST_KIND], (ev) => {
    const parsed = BundleAttestContentSchema.safeParse(JSON.parse(ev.content))
    if (parsed.success) cb(parsed.data)
  })
}
```

The iframe-side `reportBundleHash` op (already in the RPC schema from Task 8) signs and publishes the event via its own Nostr client.

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/bundle-attest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(gossip): bundle-attest publish + subscribe via Nostr relay"
```

### Task 19: Fleet divergence alert UI + test

**Files:**
- Create: `src/client/components/fleet-divergence-alert.tsx`
- Create: `tests/ui/bundle-attest-healthy.spec.ts`
- Create: `tests/ui/bundle-attest-mismatch.spec.ts`

- [ ] **Step 1: Implement the alert component**

```tsx
// src/client/components/fleet-divergence-alert.tsx
export function FleetDivergenceAlert() {
  const [divergent, setDivergent] = useState<BundleAttestContent[]>([])
  const ownHash = useBundleHash()

  useEffect(() => {
    const unsub = subscribeFleetAttests((attest) => {
      if (ownHash && attest.bundleHash !== ownHash) {
        setDivergent((prev) => [...prev, attest])
      }
    })
    return unsub
  }, [ownHash])

  if (divergent.length === 0) return null
  return (
    <div data-testid="fleet-divergence-alert" className="bg-destructive text-destructive-foreground p-4">
      <strong>Fleet divergence detected.</strong> {divergent.length} other client(s) are running a
      bundle with a different hash. Contact security before entering your PIN.
    </div>
  )
}
```

- [ ] **Step 2: Write UI tests**

```typescript
// tests/ui/bundle-attest-healthy.spec.ts
test('clients publish + see their own attest', async ({ page, request }) => {
  await page.goto('/')
  await loginAs(page, 'volunteer-1')
  await page.waitForSelector('[data-testid="app-shell"]')
  // Query the relay via the API for the latest attest
  const attests = await request.get(`${API_BASE}/api/nostr/events?kinds=20002&limit=1`).then((r) => r.json())
  expect(attests.length).toBeGreaterThan(0)
  expect(attests[0].content.bundleHash).toMatch(/^[0-9a-f]{64}$/)
})

// tests/ui/bundle-attest-mismatch.spec.ts
test('divergent attest surfaces fleet-divergence alert within 20s', async ({ page, request }) => {
  await page.goto('/')
  await loginAs(page, 'volunteer-1')
  // Publish a fake divergent attest via the API relay directly
  await request.post(`${API_BASE}/api/nostr/publish-test`, {
    data: { kind: 20002, content: { version: 1, bundleHash: 'f'.repeat(64), bundleVersion: 'fake', releaseTag: 'fake', timestamp: Date.now() / 1000, userAgent: 'fake' } },
  })
  await expect(page.getByTestId('fleet-divergence-alert')).toBeVisible({ timeout: 20_000 })
})
```

- [ ] **Step 3: Run tests**

```bash
bunx playwright test tests/ui/bundle-attest-healthy.spec.ts tests/ui/bundle-attest-mismatch.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/fleet-divergence-alert.tsx tests/ui/bundle-attest-healthy.spec.ts tests/ui/bundle-attest-mismatch.spec.ts
git commit -m "feat(gossip): FleetDivergenceAlert component + UI tests (healthy + mismatch)"
```

---

## Workstream 4.5 — Public whitepaper

### Task 20: Write `docs/security/WHITEPAPER.md`

**Files:**
- Create: `docs/security/WHITEPAPER.md`
- Modify: `site/` (public marketing site) — add whitepaper route
- Create: `tests/ui/whitepaper-render.spec.ts`

- [ ] **Step 1: Write the whitepaper**

Sections (adopt Signal / Proton / 1Password / Tuta whitepaper structure):

1. Executive summary
2. Threat model (link to `docs/security/THREAT_MODEL.md`)
3. Cryptographic architecture
   - Per-note forward secrecy
   - Hub key + rotation
   - Multi-factor KEK
   - HPKE (Tier 1) + signed audit chain (Tier 0)
4. Delivery integrity (Tier 4 topics)
5. Residual risks (summary, full detail in `RESIDUAL_RISK.md`)
6. Audit history (Tier 0 GPG + cosign + SBOM, Tier 4 allied-org verifier)
7. How to verify this release yourself (`verify-build.sh` walkthrough)
8. Contact + reporting vulnerabilities
9. Change log (per-release diff)

Target length: 8–12 pages when rendered.

- [ ] **Step 2: Add whitepaper render route to the site**

```tsx
// site/src/pages/security/whitepaper.astro (or equivalent)
---
import Layout from '../../layouts/Layout.astro'
import Whitepaper from '../../../../docs/security/WHITEPAPER.md'
---
<Layout title="Llamenos Security Whitepaper">
  <article data-testid="whitepaper-article"><Whitepaper /></article>
</Layout>
```

- [ ] **Step 3: Write the render test**

```typescript
// tests/ui/whitepaper-render.spec.ts
test('whitepaper renders at /security/whitepaper', async ({ page }) => {
  await page.goto('/security/whitepaper')
  await expect(page.getByTestId('whitepaper-article')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Executive summary/i })).toBeVisible()
})
```

- [ ] **Step 4: Run**

```bash
bunx playwright test tests/ui/whitepaper-render.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add docs/security/WHITEPAPER.md site/src/pages/security/whitepaper.astro tests/ui/whitepaper-render.spec.ts
git commit -m "docs(security): consolidated whitepaper + public site render"
```

---

## Workstream 4.6 — Residual-risk disclosure + warrant canary

### Task 21: `RESIDUAL_RISK.md` + onboarding gate

**Files:**
- Create: `docs/security/RESIDUAL_RISK.md`
- Create: `src/client/components/residual-risk-gate.tsx`
- Create: `tests/ui/residual-risk-onboarding.spec.ts`
- Modify: `src/client/main.tsx` (mount the gate on first login)
- Modify: `src/shared/schemas/audit-entries.ts` (add `residual_risk_acknowledged` payload type)
- Modify: `src/server/services/audit-log-service.ts` (authorization for the new payload)

- [ ] **Step 1: Write `RESIDUAL_RISK.md`**

Honest sections:
- What Llamenos E2EE can protect against (server compromise, passive interception, lost device)
- What it cannot protect against (malicious code delivery, compromised browser, compromised OS)
- Specific examples (forced build injection, browser extension keylogger, social engineering)
- Hardened alternatives (Tauri desktop build — deferred to separate spec; signed WebExtension — deferred; Threema Web mode — deferred)
- When to use the hardened alternative (threat model = nation-state, right-wing extremist group, hacker-for-hire)
- How the third-party verifier + fleet gossip + whitepaper + warrant canary each contribute to catching attacks
- How volunteers can help (share your verifier output, watch for divergence alerts, report suspicious behavior)

- [ ] **Step 2: Implement `ResidualRiskGate`**

```tsx
// src/client/components/residual-risk-gate.tsx
export function ResidualRiskGate({ onAccept }: { onAccept: () => void }) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    function onScroll() {
      if (el.scrollHeight - el.scrollTop <= el.clientHeight + 20) setScrolledToBottom(true)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  async function handleAccept() {
    // Emit a signed audit entry — volunteer's acknowledgement is part of the tamper-evident log
    await appendSignedAuditEntry({
      type: 'residual_risk_acknowledged',
      userId: currentUserId,
      version: RESIDUAL_RISK_VERSION,
    })
    onAccept()
  }

  return (
    <Dialog open data-testid="residual-risk-gate">
      <DialogTitle>Before you start</DialogTitle>
      <DialogContent>
        <div ref={ref} className="max-h-96 overflow-y-auto" data-testid="residual-risk-body">
          <ResidualRiskBody />
        </div>
        <Button
          onClick={handleAccept}
          disabled={!scrolledToBottom}
          data-testid="residual-risk-accept"
        >
          I understand the residual risks
        </Button>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Write UI test**

```typescript
// tests/ui/residual-risk-onboarding.spec.ts
test('onboarding blocks until residual risk is scrolled and acknowledged', async ({ page }) => {
  await signupAndLogin(page)
  await expect(page.getByTestId('residual-risk-gate')).toBeVisible()
  await expect(page.getByTestId('residual-risk-accept')).toBeDisabled()
  await page.getByTestId('residual-risk-body').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(page.getByTestId('residual-risk-accept')).toBeEnabled()
  await page.getByTestId('residual-risk-accept').click()
  await expect(page.getByTestId('residual-risk-gate')).toBeHidden()
  await expect(page.getByTestId('app-shell')).toBeVisible()
})
```

- [ ] **Step 4: Run**

```bash
bunx playwright test tests/ui/residual-risk-onboarding.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(onboarding): residual-risk disclosure + scroll-to-bottom gate + audit entry"
```

### Task 22: Warrant canary

**Files:**
- Create: `docs/security/WARRANT_CANARY.md`
- Modify: `site/src/pages/security/` (add canary render route)

- [ ] **Step 1: Write the initial warrant canary**

```markdown
# Llamenos Warrant Canary

**Date issued:** 2026-04-10
**Next refresh:** 2026-05-10

As of the date above, Llamenos has:

- Not received any National Security Letters
- Not received any gag orders
- Not received any FISA court orders
- Not been compelled to disclose any user data

This document is signed with the Llamenos release signing key. If this statement
changes, or if this document is not refreshed on schedule, assume the worst and
treat the hosted instance as potentially compromised.

---

-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA256

<statement body>

-----BEGIN PGP SIGNATURE-----
<signature>
-----END PGP SIGNATURE-----
```

The signing process is documented in `docs/security/WARRANT_CANARY_RUNBOOK.md`.

- [ ] **Step 2: Add render route**

Same pattern as the whitepaper — `site/src/pages/security/warrant-canary.astro`.

- [ ] **Step 3: Commit**

```bash
git add docs/security/WARRANT_CANARY.md docs/security/WARRANT_CANARY_RUNBOOK.md site/src/pages/security/warrant-canary.astro
git commit -m "docs(security): initial warrant canary + render route"
```

---

## Workstream 4.7 — CI guardrails + release manifest

### Task 23: CI checks

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/check-crypto-isolation.sh`

- [ ] **Step 1: Write the isolation check script**

```bash
#!/usr/bin/env bash
# scripts/check-crypto-isolation.sh
# Fails if any file in src/client/ (NOT in crypto-sandbox/) imports crypto primitives directly.
set -euo pipefail

VIOLATIONS=$(grep -rn \
  -E "from ['\"](\\.\\./)*shared/crypto-primitives['\"]|from ['\"](\\.\\./)*client/lib/crypto-worker['\"]" \
  src/client --include="*.ts" --include="*.tsx" 2>/dev/null || true)

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: crypto primitives imported from main SPA (must go through iframe):"
  echo "$VIOLATIONS"
  exit 1
fi
echo "PASS: crypto isolation boundary"
```

- [ ] **Step 2: Wire into CI**

```yaml
# .github/workflows/ci.yml (additions)
- name: Build crypto sandbox
  run: bun run build:crypto-sandbox

- name: Verify dist artefacts
  run: |
    [ -d dist/client ] || (echo "dist/client missing" && exit 1)
    [ -d dist/crypto-sandbox ] || (echo "dist/crypto-sandbox missing" && exit 1)

- name: Check crypto isolation boundary
  run: ./scripts/check-crypto-isolation.sh

- name: Verify CSP frame-src on app host
  run: |
    grep "frame-src https://" deploy/docker/Caddyfile.production || \
      (echo "app host CSP missing frame-src crypto" && exit 1)

- name: Verify API CSP script-src none
  run: |
    grep "script-src 'none'" src/server/middleware/security-headers.ts || \
      (echo "API CSP missing script-src 'none'" && exit 1)
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml scripts/check-crypto-isolation.sh
git commit -m "chore(ci): crypto isolation + dual-build + CSP grep guardrails"
```

### Task 24: Release manifest + extended release.yml

**Files:**
- Modify: `.github/workflows/release.yml`
- Create: `tests/api/releases-manifest.spec.ts`

- [ ] **Step 1: Extend `release.yml`**

Add steps to build the crypto sandbox, compute its checksums, append to `CHECKSUMS.txt`, generate a `bundle-manifest.json` mapping relative paths to hashes, sign the manifest via cosign, and attach both to the release.

```yaml
- name: Build crypto sandbox
  run: bun run build:crypto-sandbox

- name: Append crypto sandbox to CHECKSUMS
  run: |
    (cd dist/crypto-sandbox && find . -type f -exec sha256sum {} \; | sort) >> CHECKSUMS.txt

- name: Build bundle manifest
  run: |
    bun run scripts/build-bundle-manifest.ts > bundle-manifest.json

- name: Cosign sign bundle manifest
  run: |
    cosign sign-blob --yes --bundle bundle-manifest.json.cosign-bundle bundle-manifest.json

- name: Attach artefacts
  uses: softprops/action-gh-release@...
  with:
    files: |
      CHECKSUMS.txt
      CHECKSUMS.txt.asc
      CHECKSUMS.txt.cosign-bundle
      bundle-manifest.json
      bundle-manifest.json.cosign-bundle
      sbom.cdx.json
      provenance.json
```

- [ ] **Step 2: Write the manifest test**

```typescript
// tests/api/releases-manifest.spec.ts
test('latest release has bundle-manifest.json, cosign bundle, whitepaper link', async ({ request }) => {
  const latest = await request.get('https://api.github.com/repos/llamenos/llamenos-hotline/releases/latest').then((r) => r.json())
  const assetNames = latest.assets.map((a: { name: string }) => a.name)
  expect(assetNames).toContain('bundle-manifest.json')
  expect(assetNames).toContain('bundle-manifest.json.cosign-bundle')
  expect(assetNames).toContain('CHECKSUMS.txt.cosign-bundle')
})
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml tests/api/releases-manifest.spec.ts scripts/build-bundle-manifest.ts
git commit -m "feat(release): bundle-manifest.json + cosign-signed; attach crypto sandbox artefacts"
```

---

## Final verification gate

### Task 25: Full regression + drills

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 2: Lint**

```bash
bun run lint
```

- [ ] **Step 3: Build both SPA + crypto sandbox**

```bash
bun run build
ls dist/client/ dist/crypto-sandbox/
```

Expected: both directories populated.

- [ ] **Step 4: Unit tests**

```bash
bun run test:unit
bun test crypto-sandbox/
```

Expected: PASS.

- [ ] **Step 5: API E2E**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api
```

Expected: PASS, including new split-origin-cors + bundle-attest-publish + releases-manifest tests.

- [ ] **Step 6: UI E2E**

```bash
bunx playwright test tests/ui
```

Expected: PASS, including cross-origin-isolation + cross-origin-refresh + crypto-iframe-rpc + bundle-attest-healthy + bundle-attest-mismatch + residual-risk-onboarding + whitepaper-render + iframe-postmessage-origin-check.

- [ ] **Step 7: Grep guardrails**

```bash
./scripts/check-crypto-isolation.sh
```

Expected: PASS.

- [ ] **Step 8: Ansible playbook test**

```bash
cd deploy/ansible && ansible-playbook tests/deploy/test-split-origin.yml -i inventory/ci
```

Expected: PASS.

- [ ] **Step 9: Simulated mass-tampering drill**

Manual drill per `docs/security/TIER_4_DRILL.md`. Expected: verifier issue opens within 15 minutes; Nostr gossip alert surfaces within 20 s; local verifier dialog shows mismatch.

- [ ] **Step 10: verify-build.sh**

```bash
./scripts/verify-build.sh
```

Expected: all signature types verify, including cosign bundle + bundle-manifest cosign bundle + SBOM.

- [ ] **Step 11: Final commit**

```bash
git add -A
git commit -m "chore(tier-4): verification gate green — delivery hardening complete"
```

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-security-tier-4-delivery-hardening.md`.**

Execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in one session with checkpoints. Required sub-skill: `superpowers:executing-plans`.

Tier 4 implementation should happen in its own session, distinct from the session that wrote this plan. Tier 0 must be merged before Tier 4 implementation begins. Tier 4 is independent of Tiers 1, 2, 3 and can ship in parallel with any of them. The sandbox iframe boundary lets Tiers 1 and 3 migrate the worker internals without affecting the iframe's external contract.
