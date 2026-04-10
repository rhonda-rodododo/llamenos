# Security Tier 4 — Delivery Hardening

**Date:** 2026-04-10
**Status:** Draft
**Branch:** `feat/sec-tier-4-delivery-hardening`
**Branch base:** `feat/sec-tier-0-albrecht-hardening` (assumes Tier 0 landed)
**Depends on:** Tier 0 (CSP L3 nonces, Trusted Types, cosign, SLSA Build L3, SBOM, signed audit sigchain). Runs parallel to Tier 3; no dependency on Tier 1 or Tier 2.
**Brief:** [`docs/security/spec-briefs/tier-4-delivery-hardening.md`](../../security/spec-briefs/tier-4-delivery-hardening.md)
**Master doc:** [`docs/security/SECURITY_IMPROVEMENTS_MASTER.md`](../../security/SECURITY_IMPROVEMENTS_MASTER.md) §1.2 Gap 3, §3.1, §3.12, §5, §6.5, §7 Tier 4, §8.1, §8.5, §9

## Problem

Every Llamenos page load re-downloads the SPA bundle from the server. The same VPS that holds the API, the PostgreSQL database, and every encrypted field also serves the JavaScript that volunteers' browsers execute. A single root-level compromise of that VPS — via stolen SSH key, exploited Hono route, coerced sysadmin, or lawful-but-secret court order — is full game-over: the attacker ships modified JavaScript to one volunteer on their next page load, and that JavaScript calls into the unlocked crypto worker via the exposed helpers and exfiltrates plaintext notes, caller phone numbers, and volunteer identity.

This is the **trusting-trust problem for browser-delivered apps**. It is the residual risk every published web-E2EE whitepaper acknowledges (CryptPad, Proton, Signal Desktop, Tuta, Bitwarden) and the one gap that every single one of them addresses in depth with multiple independent defences rather than a single fix. There is no browser-based architecture that can fully eliminate it; there are well-understood architectures that reduce the blast radius, force any attacker into publicly-observable actions, and make targeted Selective Malicious Code Delivery (SMCD) detectable within minutes.

Tier 4 is that work. It is the next structural hardening step beyond Tier 0 — Tier 0 made the delivered bundle tamper-evident at the repository level (reproducible builds + CHECKSUMS + cosign + SLSA + SBOM), but it did not change the fact that *the same box* that holds the data is the only box ever asked whether the delivered bundle is tamper-free. Tier 4 separates those concerns and introduces three independent detection layers.

**Concrete gaps to close:**

1. **Single delivery origin.** `src/server/app.ts` mounts `securityHeaders` on `app.use('*', ...)` and serves the SPA + API from one Hono app. `deploy/docker/Caddyfile.production` has one `{$DOMAIN}` block that routes `/api/*`, `/telephony/*`, `/messaging/*`, and `/` (SPA static) through one reverse proxy to one app container. A root compromise of that container can modify any of those handlers.
2. **Crypto worker lives on the UI origin.** `src/client/lib/crypto-worker-client.ts` constructs `new Worker(new URL('./crypto-worker.ts', import.meta.url))` from the same origin as `main.tsx`. XSS in any React component reaches the worker's `postMessage` surface directly; there is no cross-origin trust boundary.
3. **No third-party bundle verification.** `scripts/verify-build.sh` is run by humans against GitHub Releases. It does not run continuously, does not compare *the bundle actually served to a browser* against the signed release, and is not hosted outside Llamenos' own org. A silent malicious-swap attack on `app:3000` is invisible to every external observer until a user manually runs the script.
4. **No fleet gossip.** Clients have no mechanism to publish what bundle they ran so the rest of the fleet can notice divergence. Targeted SMCD against one volunteer would be invisible to all other volunteers even if they use the same infrastructure.
5. **No public whitepaper.** The most important structural security work Llamenos has done (per-note forward secrecy, hub-key rotation on departure, multi-factor KEK, hash-chained audit log) lives in `docs/security/*.md` inside the repository. A security auditor, journalist, or high-risk volunteer has no single consolidated document to read. Tuta, Wire, 1Password, Signal, and CryptPad all publish consolidated whitepapers; that is the artefact auditors consume.
6. **No residual-risk disclosure to users.** Volunteers are told "the app is end-to-end encrypted" and onboarded. They are not told, in plain language, that the browser delivery channel is the one attack vector the app cannot fully close on its own and that they should use a hardened alternative in the highest-risk scenarios. That non-disclosure is an integrity problem, not just an ethics problem — it is the single biggest thing that distinguishes "honest E2EE" from "snake-oil E2EE" per Signal/Proton's published posture.

Every item above becomes a workstream in this tier.

## Design

The spec is organised as six workstreams (4.1 through 4.6). They are **independent enough to be implemented and reviewed in parallel**, and will be batched into one pull request so the entire delivery-hardening pass lands together. Workstreams 4.1, 4.2, and 4.5 are the three load-bearing structural changes; 4.3 and 4.4 are the two independent detection layers; 4.6 is the public-artefacts workstream that Tier 4 is visibly judged on.

**Guiding principles** (derived from master §9 and §5):

- **Independence.** No detection layer or mitigation shares a compromise mode with another. Splitting the origin, sandboxing the crypto core, running a third-party verifier, and publishing fleet gossip must each fail differently so that a single attack cannot silence all alarms simultaneously.
- **Public observability.** Every detection mechanism produces output that is visible to at least one party outside Llamenos' organisational control (GitHub issues in an allied org, ephemeral Nostr events subscribable by anyone with a client, public transparency logs). Private alerting is additional, not primary.
- **Fail closed on structural boundaries.** The sandboxed iframe must never reach the UI code. The UI code must never be able to invoke the crypto core without going through the postMessage RPC. A broken origin split must be a hard error, not a fall-through.
- **Honest residual-risk disclosure.** The `RESIDUAL_RISK.md` and onboarding UX must state plainly what the browser delivery channel can and cannot defend against and must point volunteers at the hardened fallbacks (Tauri desktop, signed WebExtension verifier) when their threat model exceeds the web tier.
- **No backward-compatibility shims.** Pre-production gives us the latitude to change origins cleanly. Anything built on top of single-origin assumptions (legacy cookie scopes, same-origin worker construction, inline CSP tolerances) is deleted, not wrapped.

### 4.1. Split code-delivery origin from API origin

**Threat model.** A full compromise of the API host — stolen SSH key, exploited Hono route, live-exfiltration via the app container's process memory, court-ordered administrative access — must not let the attacker modify the JavaScript that volunteers load. The current topology treats "the VPS" as one unit of compromise; this workstream splits it into two.

#### 4.1.1. Two origins, three deployment modes

Llamenos runs in three deployment modes after Tier 4:

- **Primary (public demo + reference instances).** `app.llamenos.example` → static SPA hosted on a separate provider (Cloudflare Pages for Llamenos' own reference hosts; ticker for self-hosters). `api.llamenos.example` → API + WebSocket relay + RustFS proxy, same VPS as today minus the SPA static serving. `crypto.llamenos.example` → sandboxed crypto iframe (4.2).
- **Self-hosted VPS, split processes.** Ansible-deployed hosts that cannot use a separate static-hosting provider get two separate Caddy frontends on the same VPS, each binding a different subdomain, running as a different systemd service, serving files owned by a different Unix user. Not as strong as provider separation — one root-level compromise still compromises both — but structurally different from a single-process compromise, and it is enforced by Ansible-managed systemd units that the API service cannot modify.
- **Developer dev.** `bun run dev` continues to run on a single localhost port but the Vite dev server mounts the crypto iframe content under a *different hostname* via `/etc/hosts` entries that Ansible-generated `scripts/dev-hosts.sh` installs on first run. Documented in `DEVELOPMENT.md`. Cross-origin isolation and COEP are tested in dev by default; Tier 4 refuses to regress that in the name of developer ergonomics.

The three modes share *exactly the same origin split*; only the hosting substrate differs. The client has one code path.

#### 4.1.2. `api.llamenos.example` topology

`src/server/app.ts` stops serving the SPA. The SPA-serving branches in `server.ts` (the `app.route('/', serverApp as any)` mount and its associated `// SPA fallback — serve index.html for all unmatched routes` block) are deleted. The Hono app serves `/api/*`, `/telephony/*`, and `/messaging/*` only. Any `GET /` on `api.llamenos.example` returns a JSON `404` from the existing `KNOWN_API_PREFIXES` miss handler.

**Cookies.** `llamenos-refresh` and `llamenos-session-id` (set by the auth facade) are rescoped:

- `domain=api.llamenos.example` — no parent-domain cookies. A cookie scoped to `llamenos.example` would leak to the static host.
- `SameSite=None; Secure` — required because the SPA origin (`app.llamenos.example`) is different from the API origin and must be allowed to carry refresh cookies on the cross-site refresh call.
- `HttpOnly` and `Path=/api/auth` — unchanged.
- `Partitioned` attribute added (CHIPS) per Chrome's 2026 default third-party cookie partitioning — required for the cross-site refresh to survive third-party cookie restrictions.

**CORS.** `src/server/middleware/cors.ts` hardens to a single allowed origin read from `APP_ORIGIN` env var. No wildcards, no reflection, no dev-mode list. `Access-Control-Allow-Credentials: true` is required for the refresh cookie.

**Content type lockdown.** The API middleware already refuses non-JSON POST bodies in most places; workstream 4.1 extends that to every route and adds an explicit `X-Frame-Options: DENY` + `frame-ancestors 'none'` on API responses so the API host cannot be iframed.

**WebSocket.** The Nostr relay WS URL becomes `wss://api.llamenos.example/nostr`. `src/client/lib/nostr/*` reads the base URL from the already-existing `NOSTR_RELAY_PUBLIC_URL` config which flows through `src/client/lib/config.tsx`.

**Known limitation.** Cross-site cookies are now load-bearing. If a volunteer's browser has aggressive third-party cookie blocking (Firefox Strict mode, Safari ITP, Brave shields) the refresh flow breaks. Tier 4 addresses this in two layers:
  1. `Partitioned` attribute (CHIPS) — the refresh cookie partitions correctly on Chrome/Edge.
  2. Fallback to refresh-via-redirect. When the client detects a refresh failure attributable to cookie policy, it performs a one-hop navigation to `api.llamenos.example/api/auth/refresh?return_to=...` which is a first-party context on the API origin. The API host issues a short-lived opaque refresh grant bound to the `app.llamenos.example` origin via `Origin` check, then redirects back. The grant is in-URL but never reused and never logged. Tested by `tests/ui/cross-origin-refresh.spec.ts`.

#### 4.1.3. `app.llamenos.example` topology

The Vite build output (`dist/client/`) moves wholesale to the static-hosting target. The build itself does not change except that `vite.config.ts` learns two additional substitutions:

- `__API_ORIGIN__` — injected as `https://api.llamenos.example` (or dev-mode localhost equivalent) at build time and read from `import.meta.env.VITE_API_ORIGIN`.
- `__CRYPTO_ORIGIN__` — injected as `https://crypto.llamenos.example` (same pattern) and read from `import.meta.env.VITE_CRYPTO_ORIGIN`.

`src/client/lib/api.ts` already uses a single `API_BASE` constant; it is updated to read from `import.meta.env.VITE_API_ORIGIN` with a localhost dev default.

**CSP on `app.llamenos.example`:**

```
default-src 'none';
script-src 'self' 'nonce-{nonce}' 'strict-dynamic';
style-src 'self' 'nonce-{nonce}' 'unsafe-hashes' '{tailwind-hash-allowlist}';
img-src 'self' data: blob:;
font-src 'self';
media-src 'self' blob:;
connect-src 'self' https://api.llamenos.example wss://api.llamenos.example;
worker-src 'self' blob:;
manifest-src 'self';
frame-src https://crypto.llamenos.example;
object-src 'none';
frame-ancestors 'none';
base-uri 'none';
form-action 'none';
require-trusted-types-for 'script';
trusted-types llamenos;
report-uri https://api.llamenos.example/api/csp-report;
report-to csp-endpoint;
upgrade-insecure-requests;
```

The new lines versus Tier 0's enforcement CSP: `connect-src` now includes a different host, `frame-src` permits exactly one origin (the crypto iframe), `report-uri` and `report-to` point at the API host (CSP violations are still collected centrally). The SPA host has no access to secrets of any kind — it serves static files only, so the threat of its own compromise is an **XSS against a volunteer**, which is exactly the attack the crypto-iframe split (4.2) is designed to contain.

**CSP on `api.llamenos.example`:**

```
default-src 'none';
script-src 'none';
style-src 'none';
frame-ancestors 'none';
connect-src 'self';
base-uri 'none';
form-action 'none';
report-uri /api/csp-report;
```

The API origin never serves HTML (beyond `/api/docs` for Scalar, which is documented as the one explicit exception carrying its own nonce + script allowance on a subroute) and has the strictest CSP possible.

**COOP / COEP.** Both `app.llamenos.example` and `crypto.llamenos.example` ship:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

`api.llamenos.example` ships:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: cross-origin
Access-Control-Allow-Origin: https://app.llamenos.example
```

CORP `cross-origin` is required so that `connect-src` from the SPA host succeeds without tripping COEP on the SPA host's end. Verified in `tests/ui/cross-origin-isolation.spec.ts`.

#### 4.1.4. Ansible split-process deployment

For self-hosted mode, `deploy/ansible/roles/llamenos/` grows two new sub-roles:

- `deploy/ansible/roles/llamenos-static/` — serves `dist/client/` from `/opt/llamenos/static/` as user `llamenos-static`, via its own Caddy systemd unit `llamenos-static-caddy.service`. Cannot read the app's database, cannot read the app's env file, cannot exec into the app container. Binds to `127.0.0.1:3100`.
- `deploy/ansible/roles/llamenos-crypto-sandbox/` — serves `dist/crypto-sandbox/` from `/opt/llamenos/crypto-sandbox/` as user `llamenos-crypto` with a third Caddy unit. Binds to `127.0.0.1:3101`.

A single public Caddy (`deploy/ansible/roles/caddy-frontend/`) terminates TLS and reverse-proxies:

- `app.{{ root_domain }}` → `127.0.0.1:3100`
- `api.{{ root_domain }}` → `127.0.0.1:3000` (the existing Hono app)
- `crypto.{{ root_domain }}` → `127.0.0.1:3101`

Caddy's own automatic certificate management issues three certificates (or one wildcard). The frontend Caddy, not the app, holds the TLS private keys — a compromise of the app container does not give access to certificate material.

The Ansible `harden.yml` playbook is extended to enforce that the three services run as distinct users with distinct file ownership. `tests/deploy/test-split-origin.yml` (a new Ansible-playbook-driven test) asserts the isolation.

`deploy/docker/docker-compose.production.yml` is updated in parallel so Docker-Compose-first deployments also split. The three Caddy blocks collapse into one multi-site Caddyfile with three `handle_path` directives on three hostnames.

### 4.2. Sandboxed crypto iframe (CryptPad pattern)

**Threat model.** Workstream 4.1 assumes that an XSS on the UI origin is a *possible* failure mode even after all of Tier 0's hardening. 4.2 contains that failure: XSS on `app.llamenos.example` must not let the attacker read the plaintext nsec, forge audit-log signatures, or decrypt arbitrary envelopes. The structural device is cross-origin iframe isolation: the crypto core runs inside a frame served from `crypto.llamenos.example`, and the UI frame's only channel into it is a strictly-schema-validated postMessage RPC.

#### 4.2.1. Iframe topology

A new Vite project lives under `crypto-sandbox/` with its own `index.html` and entry file. Its build output lands at `dist/crypto-sandbox/` and is served by `crypto.llamenos.example`.

The iframe is loaded from the UI page exactly once, at app boot, via:

```tsx
<iframe
  src="https://crypto.llamenos.example/sandbox.html"
  sandbox="allow-scripts"
  allow="cross-origin-isolated"
  referrerPolicy="no-referrer"
  data-testid="crypto-sandbox-iframe"
  style={{ display: 'none' }}
  title="Llamenos crypto sandbox"
/>
```

**Sandbox attribute rationale.** `sandbox="allow-scripts"` without `allow-same-origin` forces the iframe into an *opaque origin*. The iframe's document has its own origin, distinct from `crypto.llamenos.example` for the purpose of same-origin-policy reads from within the iframe — but the postMessage channel still works, and the iframe can still load its own scripts via `script-src 'self'` in its own CSP because the iframe's *loading* is governed by the sandbox's loader, which resolves relative to the iframe src origin. This is the CryptPad pattern and the reason CryptPad uses two domains.

Adding `allow-same-origin` to the sandbox would restore same-origin to the hosting origin, which would let the parent frame's DOM access the iframe's DOM and therefore read keys via `iframe.contentWindow.<whatever>`. The combination of `allow-scripts` + `allow-same-origin` is explicitly flagged as a security regression by Chrome and Firefox (see [WICG credentialless iframes](https://wicg.github.io/anonymous-iframe/)). We must not use both. The iframe is cross-origin to the parent by virtue of living at `crypto.llamenos.example`, and `allow-scripts` alone is sufficient for it to run its own bundle.

**`allow="cross-origin-isolated"`** is required so the iframe inherits the parent's cross-origin-isolated status. Without it the iframe cannot use `SharedArrayBuffer` (not used today, but required by `@hpke/*` on some platforms once Tier 1 lands) and is restricted in its use of high-resolution timers. Both the parent and the iframe must also ship matching COOP `same-origin` + COEP `require-corp`, which 4.1.3 already configures.

#### 4.2.2. Scope of code that lives in the iframe

In the iframe (`crypto-sandbox/`):

- `src/shared/crypto-primitives.ts` and everything it transitively imports from `@noble/*`.
- `src/shared/crypto-labels.ts` (Tier 0's branded `CryptoLabel` + `LABEL_REGISTRY`).
- `src/client/lib/crypto-worker.ts` (now re-homed) and its Web Worker that the iframe spawns internally for CPU-bound ops — the iframe itself is a defence layer, the inner worker is an additional defence layer for memory isolation.
- `src/client/lib/key-store-v2.ts` (the multi-factor KEK key store).
- `src/client/lib/envelope-field-crypto.ts` and `src/client/lib/hub-field-crypto.ts`.
- `src/client/lib/audit-log-client.ts#buildSignedAuditEntry` (Tier 0) — building and signing audit entries must happen where the key lives.
- `src/client/lib/hub-key-manager.ts#rotateHubKey` (Tier 0) — chain-verified rewrap must happen where the key lives.
- `src/client/lib/audit-chain-verifier.ts` (Tier 0) — chain verification runs in the iframe so the trust anchor lives with the keys.

Not in the iframe:

- React, TanStack Router, TanStack Query. The UI frame keeps all of React.
- API fetches. Encrypted blobs are fetched from `api.llamenos.example` by the UI frame and passed to the iframe via postMessage for decryption.
- IndexedDB for non-crypto caches (query cache, UI state). The iframe has its own origin's IDB and stores only the multi-factor key store blob + audit chain cache there.

#### 4.2.3. postMessage RPC protocol

A new zod schema module at `src/shared/schemas/crypto-rpc.ts` defines the request/response protocol. The schema is the contract: every message entering the iframe is `zod.parse()`'d before any handler runs; any schema violation throws and logs to the rate-limiter's anomaly counter.

```typescript
// src/shared/schemas/crypto-rpc.ts
import { z } from '@hono/zod-openapi'

// --- Request types ---
export const CryptoRpcRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('unlock'),
    id: z.string().uuid(),
    kekHex: z.string().regex(/^[0-9a-f]{64}$/),
    nonceHex: z.string().regex(/^[0-9a-f]{48}$/),
    ciphertextHex: z.string().regex(/^[0-9a-f]+$/),
  }),
  z.object({
    op: z.literal('lock'),
    id: z.string().uuid(),
  }),
  z.object({
    op: z.literal('decryptEnvelope'),
    id: z.string().uuid(),
    envelope: z.object({
      v: z.literal(2),
      labelId: z.number().int().min(0).max(255),
      wrappedKey: z.string().regex(/^[0-9a-f]+$/),
      ephemeralPubkey: z.string().regex(/^[0-9a-f]{66}$/),
      payload: z.string().regex(/^[0-9a-f]+$/).optional(),
    }),
    expectedLabel: z.string(),  // validated against LABEL_REGISTRY inside the iframe
    recordId: z.string().optional(),  // for AAD binding
  }),
  z.object({
    op: z.literal('decryptHubField'),
    id: z.string().uuid(),
    hubId: z.string().uuid(),
    ciphertextHex: z.string().regex(/^[0-9a-f]+$/),
    recordId: z.string(),
    fieldName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  }),
  z.object({
    op: z.literal('encryptHubField'),
    id: z.string().uuid(),
    hubId: z.string().uuid(),
    plaintext: z.string(),  // bounded length enforced at runtime (max 64 KiB)
    recordId: z.string(),
    fieldName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  }),
  z.object({
    op: z.literal('signAuditEntry'),
    id: z.string().uuid(),
    entryHashHex: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({
    op: z.literal('rotateHubKey'),
    id: z.string().uuid(),
    hubId: z.string().uuid(),
    expectedTriggerEntryHash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({
    op: z.literal('getPublicKey'),
    id: z.string().uuid(),
  }),
  z.object({
    op: z.literal('isUnlocked'),
    id: z.string().uuid(),
  }),
  z.object({
    op: z.literal('reportBundleHash'),  // 4.4 client publishes its loaded-bundle hash via the iframe so the signing key lives in the iframe
    id: z.string().uuid(),
    hashHex: z.string().regex(/^[0-9a-f]{64}$/),
    timestamp: z.number().int(),
  }),
])
export type CryptoRpcRequest = z.infer<typeof CryptoRpcRequestSchema>

// --- Response types ---
export const CryptoRpcSuccessSchema = z.object({
  kind: z.literal('success'),
  id: z.string().uuid(),
  result: z.unknown(),
})
export const CryptoRpcErrorSchema = z.object({
  kind: z.literal('error'),
  id: z.string().uuid(),
  code: z.enum([
    'schema_invalid',
    'locked',
    'label_mismatch',
    'aad_mismatch',
    'rate_limited',
    'chain_unverified',
    'unknown_hub',
    'internal',
  ]),
  message: z.string(),
})
export const CryptoRpcResponseSchema = z.union([CryptoRpcSuccessSchema, CryptoRpcErrorSchema])
export type CryptoRpcResponse = z.infer<typeof CryptoRpcResponseSchema>
```

`encryptHubField.plaintext` is bounded at 64 KiB at runtime to prevent a runaway decrypt loop from DoSing the iframe. Arrays of fields are batched via repeated RPC calls, not a single unbounded request.

#### 4.2.4. `crypto-worker-client.ts` becomes an iframe RPC client

The existing `src/client/lib/crypto-worker-client.ts` is rewritten as a postMessage client. The public surface (`cryptoWorker.decrypt(...)`, `cryptoWorker.sign(...)`) is unchanged — it is the transport that moves from `new Worker(...)` to iframe `postMessage`. Every React caller keeps working without modification.

```typescript
// src/client/lib/crypto-worker-client.ts (rewritten sketch)
class CryptoIframeClient {
  private iframe: HTMLIFrameElement | null = null
  private ready: Promise<void>
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timeoutId: ReturnType<typeof setTimeout> }>()
  private readonly cryptoOrigin: string

  constructor() {
    this.cryptoOrigin = import.meta.env.VITE_CRYPTO_ORIGIN
    if (!this.cryptoOrigin) throw new Error('VITE_CRYPTO_ORIGIN not configured')
    this.ready = this.boot()
  }

  private async boot(): Promise<void> {
    const iframe = document.createElement('iframe')
    iframe.src = `${this.cryptoOrigin}/sandbox.html`
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('allow', 'cross-origin-isolated')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.dataset.testid = 'crypto-sandbox-iframe'
    iframe.style.display = 'none'
    iframe.title = 'Llamenos crypto sandbox'
    document.body.appendChild(iframe)
    this.iframe = iframe

    window.addEventListener('message', this.handleMessage)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Crypto sandbox iframe failed to boot within 10s')),
        10_000
      )
      iframe.addEventListener(
        'load',
        () => {
          // The iframe posts a 'ready' broadcast on its own load + one-shot postMessage.
          window.addEventListener('message', function onReady(ev: MessageEvent) {
            if (ev.origin !== new URL(ev.origin).origin) return
            if ((ev.data as { kind?: string }).kind === 'ready') {
              window.removeEventListener('message', onReady)
              clearTimeout(timeout)
              resolve()
            }
          })
        },
        { once: true }
      )
    })
  }

  private handleMessage = (ev: MessageEvent): void => {
    // Origin check is mandatory. See feedback_cross_tab_sessionstorage_gotcha: we never trust
    // the source of a postMessage event without checking ev.origin.
    if (ev.origin !== this.cryptoOrigin) return
    const parsed = CryptoRpcResponseSchema.safeParse(ev.data)
    if (!parsed.success) return  // drop silently — not addressed to us
    const pending = this.pending.get(parsed.data.id)
    if (!pending) return
    this.pending.delete(parsed.data.id)
    clearTimeout(pending.timeoutId)
    if (parsed.data.kind === 'error') {
      pending.reject(this.mapError(parsed.data))
    } else {
      pending.resolve(parsed.data.result)
    }
  }

  private async call(req: CryptoRpcRequest): Promise<unknown> {
    await this.ready
    const id = req.id
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Crypto iframe RPC timed out'))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timeoutId })
      this.iframe!.contentWindow!.postMessage(req, this.cryptoOrigin)
    })
  }

  // ... public methods: unlock(), decryptEnvelope(), signAuditEntry(), rotateHubKey(), ...
}
```

**Origin checks.** Every `window.addEventListener('message', ...)` handler on either side must start with `if (ev.origin !== expectedOrigin) return`. A compile-time biome rule (added in workstream 4.1 of *this* tier, extending Tier 0's crypto-literal rule) flags any postMessage handler that does not check `ev.origin` in its first 10 lines.

**Rate limiting moves into the iframe.** The per-op rate buckets from `src/client/lib/crypto-worker.ts` are carried across into the iframe's internal worker unchanged. An additional iframe-level rate bucket tracks *total RPC volume across all ops* with a threshold of 200 ops/sec burst — any genuine UI flow stays well under; a rapid decrypt-all exfiltration attempt trips the bucket and auto-locks the iframe.

#### 4.2.5. Iframe lifecycle + UX

**Boot.** The iframe is created eagerly at app boot, before the React router renders. A `LoadingSandbox` component shows during the < 1 s boot window. Measured TTFB for the sandbox HTML (< 10 KiB after compression) on 3G: < 300 ms. On broadband: < 50 ms. The user-visible startup cost is negligible.

**Locking.** Global "lock" action posts `{ op: 'lock' }` to the iframe. The iframe wipes its state and the UI clears its React Query cache (Tier 0 has `ENCRYPTED_QUERY_KEYS`). Cross-tab locking via BroadcastChannel continues to work — each tab has its own iframe, and each iframe listens on its own origin's BroadcastChannel with a message-protocol version header.

**Unlock.** The PIN/recovery/WebAuthn flow runs on the UI origin because it involves DOM (form input, WebAuthn credential request). The UI collects the unlock material and forwards it to the iframe via `{ op: 'unlock', ... }`. The unlock material is wiped from the UI frame's memory as soon as the postMessage returns.

**WebAuthn consideration.** WebAuthn credentials are scoped to an origin (`rpId`). Tier 0 set `AUTH_WEBAUTHN_RP_ID` to the app host. For Tier 4 the rpId remains `llamenos.example` (the root domain) so that credentials created on `app.llamenos.example` are also valid for any subdomain. This is a specific WebAuthn affordance: `rpId` can be a parent domain of the actual origin.

The WebAuthn ceremony runs in the UI frame because the user-gesture requirement fires there. The resulting PRF output is passed to the iframe via postMessage for HKDF derivation. The PRF bytes exist in the UI frame's memory for exactly the duration of the ceremony, then get wiped.

**Iframe reload / orphan recovery.** If the iframe errors out (onerror, load failure, navigation abort), the client destroys it and reboots. An iframe boot retry budget of 3 attempts with exponential backoff is wired into `crypto-worker-client.ts`; if all three fail the UI surfaces a hard error screen and refuses to proceed.

### 4.3. Third-party bundle-hash verifier

**Threat model.** Even with origin split and sandbox iframe, a root compromise of the static host (the state-of-the-art adversary we explicitly worry about) can still ship a modified `dist/client/` or `dist/crypto-sandbox/` bundle. The compromise cannot reach the crypto keys directly, but it can (a) exfiltrate the ciphertext the API returns by rewriting the fetch pipeline, (b) render user input to the DOM before encryption for UI-layer keyloggers, or (c) degrade the postMessage RPC in subtle ways that weaken tag verification. Structural containment (4.2) is not sufficient without continuous verification.

The third-party verifier is a continuously-running watcher that fetches the served bundles and compares them against the signed GitHub Release.

#### 4.3.1. Verifier GitHub Action — allied-org hosted

A new public repository, **hosted by an allied organisation and not by Llamenos**, contains a GitHub Actions workflow (`verify-llamenos.yml`) that runs on a schedule:

```yaml
name: Verify Llamenos bundle
on:
  schedule:
    - cron: '*/15 * * * *'  # every 15 minutes
  workflow_dispatch: {}

jobs:
  verify:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
    steps:
      - uses: actions/checkout@...
      - name: Fetch served bundles
        run: |
          mkdir -p served
          curl -fsSL https://app.llamenos.example/ -o served/index.html
          curl -fsSL https://crypto.llamenos.example/sandbox.html -o served/sandbox.html
          # Parse <script src="..."> and <link href="..."> from both HTMLs; fetch each
          ./scripts/fetch-referenced-assets.sh served/index.html app.llamenos.example served/
          ./scripts/fetch-referenced-assets.sh served/sandbox.html crypto.llamenos.example served/
      - name: Fetch latest release checksums
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
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
      - name: Compare hashes
        id: compare
        run: |
          bash scripts/compare-served-to-released.sh served/ released/CHECKSUMS.txt
      - name: Post result to Nostr
        if: always()
        env:
          VERIFIER_NSEC: ${{ secrets.VERIFIER_NSEC }}
        run: |
          bash scripts/post-nostr-verdict.sh ${{ steps.compare.outcome }} served/
      - name: Open issue on mismatch
        if: steps.compare.outcome == 'failure'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh issue create \
            --title "MISMATCH: bundle served by app.llamenos.example does not match latest release" \
            --body-file mismatch-report.md \
            --label "bundle-mismatch,urgent"
```

**Why an allied org.** If the verifier lives in Llamenos' own GitHub org, compromising Llamenos' GitHub org silences the verifier. The workstream deliverable includes a short MOU template (`docs/security/VERIFIER_MOU.md`) that allied orgs sign off on and a runbook that explains the operational cost (a handful of minutes of Actions time per day, cheap) and how to rotate the verifier's Nostr signing key.

**Multiple verifiers.** A recipe in `docs/security/VERIFIER_RUNBOOK.md` lets any allied org stand up its own verifier with five commands. More verifiers = more independent attestations. The recipe covers repo setup, cron frequency, Nostr key generation, secret rotation.

**Scripts shipped in the main repo** (for verifiers to copy):

- `scripts/fetch-referenced-assets.sh` — parses HTML, fetches every `<script src>`, `<link href>`, and `<img src>` (filter to local origin), stores under `served/`.
- `scripts/compare-served-to-released.sh` — hashes each file under `served/` and compares against the line in `released/CHECKSUMS.txt`. Exits 0 on complete match, 1 on any mismatch. Emits `mismatch-report.md` listing the diverging files.
- `scripts/post-nostr-verdict.sh` — publishes a signed Nostr event of the verdict to the relay (see 4.4.3).

#### 4.3.2. Local verifier — one-click from the app

A UI affordance in the Llamenos SPA (Settings → Security → Verify this bundle) runs a *local* verifier on the volunteer's machine:

1. Fetches `https://api.llamenos.example/api/releases/latest/manifest.json` — a new API endpoint that returns `{ version, checksumsTxt, cosignBundle }` from the latest GitHub Release cached server-side.
2. Fetches `https://app.llamenos.example/` and every script referenced by its HTML.
3. Hashes each served asset against the server-returned checksums.
4. Shows a clear pass/fail: "This browser is running the exact code that was published and signed by llamenos/llamenos-hotline release v0.41.0 on 2026-04-15. Cosign certificate identity verified." On fail: "MISMATCH — please report this to your hub admin and the verifier dashboard."

The in-browser verifier is inherently weaker than the third-party verifier (it runs inside the potentially-compromised bundle) but is a **signal for the median user** — it is the artefact they can show to a journalist or a legal defence team if they believe they were targeted.

### 4.4. Gossip attestation via the Nostr relay

**Threat model.** The third-party verifier (4.3) catches mass SMCD within minutes. It does not catch *targeted* SMCD where one volunteer gets a modified bundle while everyone else gets the canonical one. Targeted SMCD is the most feared attack in the master doc's threat model (state actor coercing the hosting provider to serve a modified bundle to one IP address).

The defence: every client, on every successful unlock, signs a commitment to the hash of the code it ran and publishes that commitment to the existing strfry Nostr relay as an ephemeral event. All clients subscribe; any divergence from the fleet majority is a visible anomaly.

#### 4.4.1. Nostr event schema

Ephemeral event kind **20002** (distinct from the existing kind 20001 used for llamenos:event traffic). Kinds 20000–29999 are ephemeral in NIP-01 and strfry defaults `ephemeralEventsLifetimeSeconds` to 300 seconds — ample for fleet consensus windows.

```json
{
  "kind": 20002,
  "pubkey": "<device pubkey>",
  "created_at": <unix>,
  "tags": [
    ["t", "llamenos:bundle-attest"],
    ["h", "<hub_id>"]
  ],
  "content": "<AEAD-encrypted under hub key — see schema below>",
  "sig": "<schnorr>"
}
```

**`content` plaintext, before hub-key AEAD encryption:**

```json
{
  "appBundleSha256": "<64 hex>",
  "cryptoBundleSha256": "<64 hex>",
  "appAssetHashes": [["<relative path>", "<64 hex>"], ...],
  "cryptoAssetHashes": [["<relative path>", "<64 hex>"], ...],
  "releaseVersion": "0.41.0",
  "expectedReleaseVersion": "0.41.0",
  "verifier": "device",
  "reportedAt": 1712710000000
}
```

**Hub-key encryption.** The `content` field is encrypted under the current hub key using the existing `LABEL_HUB_EVENT` (Tier 0). Non-members cannot correlate bundle-attest events to hubs. The encryption wraps the plaintext JSON with the usual AAD `LABEL_HUB_EVENT:<eventId>` (Tier 0). The `tags` field uses `["t", "llamenos:bundle-attest"]` as a subscription filter but does not reveal more than "some Llamenos client is reporting".

**Privacy.** Hub members who subscribe to the relay see each other's bundle hashes; non-members see only that *some* Llamenos user is publishing events at *some* rate. Rate-limiting the publish frequency to one event per unlock + one every 30 minutes thereafter prevents frequency fingerprinting.

#### 4.4.2. Client publish + subscribe

**Publish.** On successful unlock and then on a 30-minute interval, the UI frame:

1. Fetches every script tag and the main HTML via `fetch(location.href)` — limited to same-origin and `crypto.llamenos.example` assets.
2. Hashes each via `crypto.subtle.digest('SHA-256', ...)`.
3. Posts a `reportBundleHash` RPC to the sandbox iframe so the signing key stays in the iframe.
4. The iframe constructs the event, encrypts the `content` under the hub key, schnorr-signs, and returns the signed event to the UI.
5. The UI publishes the signed event to the Nostr relay via the existing `src/client/lib/nostr/*` module.

**Subscribe.** The existing Nostr relay subscription subscribes to `kind: 20002, tags: [["t", "llamenos:bundle-attest"], ["h", currentHubId]]`. Each incoming event is decrypted (hub key), schema-validated, and aggregated into a `BundleAttestAggregate` state: `{ appBundleSha256 → count, divergentReporters → [...] }`.

**Consensus window.** After a 15-second settling period following a new event, if:

- A single `appBundleSha256` accounts for > 80% of the last 50 attestations → healthy.
- Two or more hashes tie within 20% → alert state "possible rolling deployment".
- Any single reporter's hash diverges from the fleet majority → alert state "divergent reporter: <device pubkey>".

Alert states surface in the Settings → Security panel and (for admins only) in an optional toast.

#### 4.4.3. Verifier-to-Nostr cross-check

The third-party verifier (4.3.1) also publishes to the same relay under its own pubkey. The client's local aggregation cross-checks: if the verifier's reported hash agrees with the fleet majority → double-confirmation healthy; if the verifier agrees with a minority → strong signal of mass tampering; if the verifier reports MISMATCH → strongest signal, immediate red banner.

The verifier's Nostr pubkey is seeded from a static allowlist in `src/shared/config/verifiers.ts` (checked into the repo). Adding a new verifier requires a repo PR — a gate that makes it hard for an attacker to swap the verifier silently.

#### 4.4.4. Alert UI + testability

`src/client/components/security/BundleAttestPanel.tsx` (new component) shows the latest fleet state, the individual verifier attestations, and the current client's own hash. The panel is always accessible via Settings → Security → Bundle Attestation.

A synthetic mass-tampering test — `tests/ui/bundle-attest-mismatch.spec.ts` — uses Playwright to:

1. Spin up the test backend with a static server that serves a *known-modified* `dist/client/` bundle (asset hashes deliberately different from the released `CHECKSUMS.txt`).
2. Launch two browser sessions that both unlock and publish attestations.
3. Inject a third synthetic attestation with a canonical hash via the Nostr relay directly.
4. Assert that the UI alert state goes to "possible rolling deployment" within 20 seconds.
5. Assert that injecting a verifier event with MISMATCH flips the alert to "MISMATCH — verifier flagged".

### 4.5. Public security whitepaper

**Artefact:** `docs/security/WHITEPAPER.md` — a single consolidated document modelled on Tuta's encryption whitepaper, Wire's MLS whitepaper, 1Password's Security Design, and Signal's technical docs.

**Sections:**

1. **Introduction.** What Llamenos is. What it protects. Who it is for.
2. **Threat model.** Imported from `docs/security/THREAT_MODEL.md` and consolidated. Explicitly names state actors, private hacking firms, and right-wing groups as relevant adversaries.
3. **Cryptographic primitives.** XChaCha20-Poly1305, schnorr/secp256k1 (pending Tier 1's HPKE migration), HKDF-SHA-256, Argon2id. Citation of RFC 9180 (HPKE, Tier 1 target) and RFC 9420 (MLS, Tier 6 target) as the formal footing of future work.
4. **Key hierarchy.** Identity key, hub key (per-member ECIES-wrap), per-note content keys (forward-secure), `items_key` indirection (Tier 1 target).
5. **Envelope formats.** Wire diagrams for envelope v2 (Tier 0), hub-key symmetric (Tier 0), per-note (Tier 0).
6. **Label domain separation.** The 25 `LABEL_*` constants as branded `CryptoLabel` types; table of labels and their uses.
7. **Audit sigchain.** Signed typed entries (Tier 0), client-side chain verification, hub-key rewrap gating.
8. **Hub membership + rotation.** Current (ECIES-per-reader) and target (Cascading Lazy Key Rotation, Tier 3).
9. **Delivery channel.** This Tier 4's workstreams 4.1–4.4 written as load-bearing mitigations of the trusting-trust problem. The current state of the art (CryptPad split origin + sandboxed iframe, Signal Desktop signing + auto-update, Proton split origin + separate CDN) is cited with links.
10. **Multi-device.** Current (shared identity key) and target (per-device keys + PUK, Tier 3).
11. **Recovery.** Current (PIN + optional recovery key + optional WebAuthn blob) and target (Recovery Group, Tier 2).
12. **Voice E2EE (forward reference).** Current (DTLS-SRTP hop-by-hop) and target (SFrame, Tier 5). Explicit "not yet shipped" caveat.
13. **Post-quantum (forward reference).** Tier 6 target (X25519+ML-KEM-1024 hybrid, Tuta pattern).
14. **Residual risk.** Plain language, same text as `RESIDUAL_RISK.md` but expanded with a technical appendix.
15. **Audit status.** Who has reviewed which sections, when, and what findings were addressed. Commissioned audit row reserved for post-Tier-4 engagement.
16. **Appendix A — tier roadmap.** Links to every tier spec as an SDLC trail.
17. **Appendix B — bibliography.** Same sources as the master doc §11.

**Target audience.** Security auditors, sophisticated users, journalists, partner orgs. Not end volunteers (they get `RESIDUAL_RISK.md` instead).

**Format.** Markdown in repo at `docs/security/WHITEPAPER.md`. Rendered to static HTML via `site/` Astro build and published at `https://llamenos.example/security/whitepaper`. PDF is generated via the existing GitHub Action that builds the marketing site, using a pinned Pandoc container so the PDF hash is reproducible. The PDF's SHA-256 lands in `CHECKSUMS.txt` at release time and is cosign-signed (Tier 0 coverage extended).

**Change log.** Every whitepaper revision is committed via a PR that cites the tier spec it reflects. Changelog at the end of the document lists every amendment with date, revision number, and the PR.

### 4.6. Residual risk statement + onboarding UX

**Artefact:** `docs/security/RESIDUAL_RISK.md` — a plain-language document shown to every volunteer at onboarding.

**Full text** (the load-bearing honesty — this is what `docs/security/RESIDUAL_RISK.md` will contain verbatim):

> **What Llamenos protects**
>
> Your call notes, the names and phone numbers of callers, your own identity as a volunteer, and the messages you send between volunteers and callers are end-to-end encrypted. Our servers cannot read any of this. If our servers are seized, subpoenaed, or stolen, this content stays confidential because the decryption keys exist only on your device and the devices of people you've explicitly shared with.
>
> **What Llamenos cannot technologically prevent**
>
> Every time you open Llamenos in your browser, it downloads the JavaScript code from our servers. **If someone who controls our servers is pressured by a government, court order, or attacker to deliver modified code specifically to you, our automated checks are designed to catch it quickly — but they cannot prevent it from happening for a brief window.** This is a limitation of how browser-based software works. It is not unique to Llamenos; every browser-delivered end-to-end encrypted app faces the same challenge (including Signal's web app, Proton Mail, Standard Notes, and CryptPad).
>
> **How we reduce this risk**
>
> - **Reproducible builds.** The code we publish is verifiable by anyone. Running `./scripts/verify-build.sh` against our releases confirms that the published JavaScript was built from the public source code.
> - **Separate hosts for code and data.** The server that holds your encrypted call notes is different from the server that delivers the JavaScript. Compromising one does not compromise the other.
> - **Sandboxed crypto core.** The part of Llamenos that holds your keys runs in a browser sandbox that is isolated from the rest of the app. Even if a bug were introduced into the user interface, it could not directly read your keys.
> - **Independent verifiers.** We operate an automated verifier ourselves, and we encourage allied organisations (digital-rights groups, legal-aid partners) to run their own verifiers against our published bundles. These verifiers publish their findings to a public feed. If the code served by our servers ever diverges from the signed release, multiple independent parties will notice within minutes.
> - **Fleet gossip.** When you unlock Llamenos, your device publishes a signed record of exactly which code version it is running. Other volunteers on the same hotline see this record. If one device reports a different code version than the rest of the fleet, that is a public anomaly that we and other volunteers can investigate.
> - **Published signatures.** Every release is signed by Sigstore's keyless signing (cosign) and recorded in the public Rekor transparency log. The signature cannot be forged without breaking GitHub's OIDC identity.
>
> **For volunteers in the highest-risk situations**
>
> If your threat model includes a state actor, a legal investigation targeting you personally, or a well-funded adversary actively attempting to compromise Llamenos' infrastructure, **the browser is not the right tool for you**. Use one of the hardened alternatives:
>
> - **The Llamenos desktop app (Tauri).** Updates through a separate code-signed channel. Keys live in the OS keychain. Recommended for state-actor threat models.
> - **The Llamenos Verifier browser extension.** A signed WebExtension that checks every page load against a pinned release. If your browser disagrees with the fleet's consensus, the extension alerts you immediately.
>
> If you are unsure which tier applies to you, talk to your hub admin. Your admin is the first point of contact; the Llamenos project maintainers are the second.
>
> **What we commit to**
>
> - We will never weaken the cryptographic design in response to government pressure. If we are ever legally prevented from operating with our current architecture, we will shut down the service rather than continue with a weakened version. This is a "warrant canary" commitment: the existence of this document, and the ongoing publication of our audit sigchain's most recent entry hash, is evidence that we have not been compromised in this way.
> - We publish our security whitepaper, our audit reports (when commissioned), and our residual-risk statement in the same repository where our code lives. We commit to keeping this document up to date as our architecture evolves.
>
> Last updated: 2026-04-10. See `docs/security/WHITEPAPER.md` for the full technical details.

**Onboarding UX.** A new component `src/client/components/onboarding/ResidualRiskAcknowledgement.tsx` renders the document in a scrollable panel with an "I understand" checkbox. The checkbox enables a "Continue" button only after the user has scrolled to the bottom (scroll position measured via intersection observer, not the raw event). The acknowledgement is recorded server-side in an audit-log entry `residual_risk_acknowledged` (added to Tier 0's discriminated union) so admins can see which volunteers have acknowledged the current version. New versions of the document (change of version hash stored client-side) trigger a re-acknowledgement flow on next unlock.

The `residual_risk_acknowledged` payload is:

```typescript
{
  type: 'residual_risk_acknowledged',
  userId: string,  // the acknowledger
  documentSha256: string,  // of the residual-risk doc text
  version: string,  // semver-like, bumped on every substantive change
}
```

Signed + hash-chained per Tier 0. The `documentSha256` is checked client-side against the currently-rendered text so a server cannot substitute a weaker version.

**Settings panel access.** Settings → Security → "View residual risk" opens the same document at any time. A link in the footer of every page — `About → Security → Residual risk` — provides a second access path.

**Warrant canary.** A separate file `docs/security/WARRANT_CANARY.md` ships alongside the whitepaper. It is updated monthly with a fresh statement and signed via `scripts/sign-canary.sh`. The absence of a fresh canary is a signal. Tier 4 ships the initial canary; the operational cadence is codified in `deploy/ansible/playbooks/update-canary.yml` for admins of self-hosted instances.

## Resolved open questions

Decisions made during brainstorming and baked into the design above. Captured here for traceability; each item corresponds to a numbered question in the brief.

1. **Static hosting for `app.llamenos.example`.** **Primary**: Cloudflare Pages for public reference instances (matches Mullvad/Tuta precedent, separate jurisdiction, independent infrastructure). **Self-hosted**: split-Caddy + separate systemd units + separate file ownership via Ansible roles. Documented in both `docs/deployment/` and the whitepaper. Dev mode uses hostfile entries per the brief's guidance.
2. **Sandboxed iframe origin.** Distinct subdomain `crypto.llamenos.example`. Completely-distinct root domain was considered and deferred — the additional shared TLS cert concern is minor compared to the operational complexity of a separate DNS zone, and we get the Tier 6 option to upgrade later if and when MLS lands.
3. **Iframe load strategy.** **Eager.** Iframe boots during app initialisation before React router renders, with a `<LoadingSandbox>` component shown for the ~200ms boot window. Lazy loading was considered and rejected because it creates a measurable window where UI code runs without a crypto-core trust boundary.
4. **postMessage RPC schema.** **Request-response only** via `CryptoRpcRequest` / `CryptoRpcResponse` discriminated unions. No streaming. Large operations (batch decrypt) fan out via repeated RPC calls. Revisit in Tier 1 if HPKE migration shows measurable latency overhead.
5. **Verifier repo location.** Allied-org hosted. Initial launch partner TBD but the MOU template ships in Tier 4 (`docs/security/VERIFIER_MOU.md`) so outreach can start the moment the code lands.
6. **Verifier frequency vs. rate limits.** 15 minutes by default (balances rate limits of Cloudflare Pages + GitHub Actions minute budgets). Configurable per verifier via workflow inputs.
7. **Gossip attestation Nostr event schema.** Ephemeral kind 20002. Tags `["t", "llamenos:bundle-attest"]` + `["h", hubId]`. Content AEAD-encrypted under hub key with `LABEL_HUB_EVENT` binding.
8. **Gossip attestation privacy.** Full hash, encrypted under hub key. HKDF-truncated was considered and rejected — the privacy benefit is marginal and the diagnostic value of the full hash at divergence time is large.
9. **Whitepaper public location.** Both: `docs/security/WHITEPAPER.md` in the repo AND published at `https://llamenos.example/security/whitepaper` via the Astro site build. PDF rendered via pinned Pandoc container, hash in `CHECKSUMS.txt`.
10. **Residual risk statement cadence.** Once at onboarding, re-acknowledgement on any substantive change to `docs/security/RESIDUAL_RISK.md` (version hash comparison client-side). Accessible from Settings → Security any time.
11. **Warrant canary cadence.** Monthly. Signed via cosign (keyless OIDC) by the release maintainer's GitHub account at release time; a separate cron workflow reminds the maintainer if the canary is more than 35 days old.
12. **SLSA level.** Tier 0 already ships SLSA Build L3 via `actions/attest-build-provenance`. Tier 4 does not attempt SLSA L4 (hermetic builds + two-person review) — it is tracked as an aspirational target in the master doc but is a separate, larger workstream. Current L3 + cosign + SBOM already dominates the industry baseline.
13. **Browser-as-renderer mode (Threema Web pattern).** Deferred to a separate spec. The master doc §8.5 describes the idea. Tauri desktop mode (see workstream 4.6's residual risk statement) is the better first step for highest-threat users; Tauri ships in parallel to Tier 4 as a distinct effort and is documented in `docs/plans/tauri-desktop.md` (out of scope for this spec).
14. **Signed WebExtension verifier.** Deferred to a separate spec, same reasoning as Tauri. Referenced in `RESIDUAL_RISK.md` as a forward-looking hardened option. Initial release of Tier 4 ships without it; the slot in the residual-risk statement makes the commitment public.

## Testing

**Guiding principle:** every workstream lands with unit + API E2E + UI E2E coverage proportional to its blast radius. No workstream ships without adversarial test cases that assert the *negative* path (modified bundle rejected, iframe boot failure caught, cross-origin cookie refused, RPC schema mismatch rejected, fleet divergence alerted).

### New unit tests

- `src/shared/schemas/crypto-rpc.test.ts`
  - Every op variant round-trips through zod.
  - Malformed `envelope.wrappedKey` (non-hex) rejected with `schema_invalid`.
  - `decryptEnvelope` op with out-of-range `labelId` rejected.
  - `encryptHubField.plaintext` over 64 KiB rejected.
  - Discriminated union default case unreachable (exhaustiveness check).
- `src/client/lib/crypto-worker-client.test.ts` (rewritten for iframe)
  - `CryptoIframeClient` boots within 10 s on a fake iframe mock.
  - `handleMessage` drops events with wrong origin.
  - `handleMessage` drops events with wrong `CryptoRpcResponse` schema.
  - `handleMessage` resolves/rejects pending request based on `kind`.
  - Boot retry budget: 3 attempts, then hard failure.
  - Rate-limit error from the iframe surfaces as `CryptoRateLimitError`.
- `crypto-sandbox/src/rpc-handler.test.ts` (new test file in the sandbox project)
  - Every op maps to the right primitive.
  - Schema validation runs on every incoming message.
  - `unlock` op with wrong KEK produces `locked` error, not stack trace.
  - `decryptEnvelope` with `labelId` mismatch produces `label_mismatch` error.
  - `rotateHubKey` with unverified chain produces `chain_unverified` error.
- `scripts/compare-served-to-released.test.sh` (bats or bun:test with child_process)
  - Exact match → exit 0.
  - One file differs → exit 1, report names the file.
  - Missing file → exit 1.
  - Extra file not in checksums → exit 1.
- `src/client/lib/bundle-attest/aggregate.test.ts`
  - 100% agreement → state `healthy`.
  - 80/20 split → state `possible_rolling_deployment`.
  - One divergent reporter → state `divergent_reporter` with pubkey populated.
  - Verifier MISMATCH takes precedence over fleet state.

### New API E2E tests

- `tests/api/cross-origin-cookies.spec.ts`
  - Login sets `llamenos-refresh` with `SameSite=None; Secure; Partitioned; Domain=api.llamenos.example`.
  - Refresh from `Origin: https://app.llamenos.example` succeeds.
  - Refresh from `Origin: https://evil.example` fails with CORS rejection.
  - Refresh with missing `Origin` header (null origin) rejected.
- `tests/api/split-origin-cors.spec.ts`
  - `Access-Control-Allow-Origin` reflects only the configured `APP_ORIGIN`.
  - Preflight to a state-changing endpoint passes only when origin matches.
- `tests/api/releases-manifest.spec.ts`
  - `GET /api/releases/latest/manifest.json` returns the expected shape.
  - Response is cacheable (short TTL, server respects `If-None-Match`).
  - Manifest checksum matches the artefact downloaded via `gh release`.
- `tests/api/bundle-attest-publish.spec.ts`
  - Well-formed kind-20002 event is accepted by the relay.
  - Malformed event (missing `h` tag, wrong kind) rejected.
  - Rate-limit: second event within 1s from same pubkey rejected.

### New UI E2E tests

- `tests/ui/cross-origin-isolation.spec.ts`
  - `app.llamenos.example` page loads with `window.crossOriginIsolated === true`.
  - `crypto.llamenos.example` page loads with `window.crossOriginIsolated === true`.
  - Iframe is present, `data-testid="crypto-sandbox-iframe"` resolves.
  - `iframe.sandbox` list includes `allow-scripts` and does NOT include `allow-same-origin`.
- `tests/ui/crypto-sandbox-rpc.spec.ts`
  - Unlock flow: UI collects PIN, posts `{ op: 'unlock' }` to iframe, iframe returns success, React tree renders authenticated state.
  - Decrypt a hub-encrypted field via the iframe RPC: matches the plaintext.
  - Decrypt with tampered ciphertext surfaces `label_mismatch` in the UI toast.
  - Lock action posts `{ op: 'lock' }` — subsequent decrypt call produces `locked`.
- `tests/ui/crypto-sandbox-lifecycle.spec.ts`
  - Iframe boot failure (blocked by `sandbox.html` returning 500) triggers the retry path.
  - After 3 failures, the UI shows a fatal error screen with testid `sandbox-fatal`.
  - Iframe reload mid-session drops all pending RPCs with a clear error.
- `tests/ui/cross-origin-refresh.spec.ts`
  - Normal third-party cookie refresh succeeds.
  - With Playwright emulating third-party cookie blocking, the redirect fallback activates and restores the session.
- `tests/ui/bundle-attest-mismatch.spec.ts` (mentioned in 4.4.4)
  - Mass-tampering simulation alerts within 20 s.
  - Verifier MISMATCH flips alert to highest severity.
- `tests/ui/bundle-attest-healthy.spec.ts`
  - Normal operation produces no alert; `BundleAttestPanel` shows healthy state.
- `tests/ui/residual-risk-onboarding.spec.ts`
  - First unlock triggers `ResidualRiskAcknowledgement` modal.
  - "Continue" button disabled until scroll-to-bottom.
  - Acknowledgement posts signed audit entry.
  - Subsequent unlock skips the modal until document hash changes.
- `tests/ui/whitepaper-render.spec.ts`
  - `GET /security/whitepaper` on the static site serves the HTML-rendered document.
  - All internal anchors resolve.
  - PDF artefact hash matches `CHECKSUMS.txt`.
- `tests/ui/local-verifier.spec.ts`
  - Settings → Security → "Verify this bundle" runs the local verifier.
  - Match: shows success panel with version + cosign certificate identity.
  - Tampered bundle (Playwright intercepts `app.llamenos.example/*` responses): shows MISMATCH.

### New Ansible / deploy tests

- `tests/deploy/test-split-origin.yml`
  - Asserts three systemd units exist (`llamenos-app`, `llamenos-static-caddy`, `llamenos-crypto-sandbox-caddy`).
  - Asserts each runs as a distinct Unix user.
  - Asserts the frontend Caddy cannot read `/opt/llamenos/app/.env`.
  - Asserts HTTPS responses on all three subdomains.
- `tests/deploy/test-cors-headers.yml`
  - `curl -H 'Origin: https://app...'` to the API host returns the expected CORS headers.
  - `curl` to the SPA host does not set `Access-Control-Allow-Origin` (static host has no CORS surface).

### Existing test suites — regression gate

All existing tests must continue to pass. Tier 4 changes the transport for crypto ops but not the semantics:

- `bun run typecheck` — clean.
- `bun run lint` — clean.
- `bun run build` — clean; both `dist/client/` and `dist/crypto-sandbox/` populated.
- `bun run test:unit` — all existing + new unit tests pass.
- `bunx playwright test tests/api` — all existing + new API tests pass.
- `bunx playwright test tests/ui` — all existing + new UI tests pass.
- `./scripts/verify-build.sh` — passes on a synthetic release with the split-origin artefacts.
- `ansible-playbook -i tests/deploy/inventory.yml tests/deploy/test-split-origin.yml` — passes on a synthetic target.

### Adversarial test design notes

- **Cross-origin steal.** A fixture UI page on a third origin loads `<iframe src="https://crypto.llamenos.example/sandbox.html">` and attempts postMessage. Assert that the iframe ignores the message (origin mismatch).
- **XSS containment.** A deliberate test-only XSS sink on `app.llamenos.example` (behind a dev-only feature flag) attempts to reach into the sandbox iframe via `iframe.contentWindow` and via cross-origin `fetch` to `crypto.llamenos.example/sandbox.html`. Assert that (a) `contentWindow` access throws SecurityError by the same-origin policy, (b) the cross-origin fetch either fails or returns an opaque response, and (c) the injected script cannot cause the iframe RPC to return key material without first going through the validated `CryptoRpcRequestSchema` path — which, at worst, gives the attacker oracle-level decrypt-one-field access per allowed RPC op while triggering rate-limit auto-lock.
- **RPC schema fuzz.** `tests/unit/crypto-rpc-fuzz.test.ts` feeds 1 000 random JSON payloads into the schema parser and asserts they all reject cleanly (no panics, no handler invocation).
- **Race between unlock and decrypt.** Posting a `decryptEnvelope` RPC before `unlock` completes returns `locked`, not a silent failure.
- **Fleet divergence.** See 4.4.4.

## Migration

**DNS.** Three new subdomains: `app.llamenos.example`, `api.llamenos.example`, `crypto.llamenos.example`. All three get TLS certs (Let's Encrypt via Caddy). Migration doc: `docs/deployment/split-origin-migration.md` walks operators through the DNS + certificate issuance.

**Cookies.** Existing `llamenos-*` cookies are invalidated on rollout (pre-production, no user impact). New cookies are issued with the new domain scope on first login after the rollout. The rollout scripts include a `scripts/migrate-sessions.sh` that runs `UPDATE user_sessions SET refresh_token_hash = NULL` so stale refresh tokens are rejected — every session starts fresh with the new cookie scope.

**Caddy.** Production and Ansible Caddy configurations are rewritten to the three-subdomain layout. The old single-host Caddyfile is deleted (not kept as a fallback). Rollbacks are performed via git revert + redeploy, not by keeping legacy configs around.

**Ansible.** Two new roles (`llamenos-static`, `llamenos-crypto-sandbox`) added to the default deploy playbook. `deploy/ansible/playbooks/deploy.yml` runs all three roles; `deploy/ansible/playbooks/deploy-demo.yml` inherits. The `demo_vars.example.yml` sample gains `domain_app`, `domain_api`, `domain_crypto` entries. Existing deploys are brought up the new way on the first redeploy after Tier 4 lands.

**Docker Compose.** `deploy/docker/docker-compose.production.yml` gains two new static-serving services (`app-static`, `crypto-sandbox-static`), each using a minimal `caddy:2-alpine` image pointed at a dist volume populated by the build. The single `app` service continues to run the Hono API on port 3000.

**Developer dev.** `scripts/dev-hosts.sh` (new) installs `/etc/hosts` entries for `app.llamenos.localhost`, `api.llamenos.localhost`, and `crypto.llamenos.localhost`, pointing at `127.0.0.1`. `bun run dev` spins up three Vite servers on ports 5173 / 5174 / 5175 (matching the three origins) behind a single dev-only proxy that terminates HTTP (not TLS — dev stays simple) on each subdomain. `bun run dev:server` continues to be a single Bun process for the API. `DEVELOPMENT.md` gains a "Split-origin dev setup" section.

**CI.** `.github/workflows/ci.yml` adds:
- `bun run build:crypto-sandbox` to build the sandbox alongside the main SPA.
- A new `deploy-artefacts` step that asserts both `dist/client/` and `dist/crypto-sandbox/` populate.
- A `verify-csp` step that asserts `app.llamenos.example`'s CSP contains `frame-src https://crypto.llamenos.example` and that `api.llamenos.example`'s CSP contains `default-src 'none'`.

**GitHub Release.** `release.yml` is extended to attach `dist/crypto-sandbox/` checksums to `CHECKSUMS.txt` and to include the sandbox bundle in the cosign-signed bundle. A new artefact `bundle-manifest.json` (machine-readable per-asset checksum list) is attached to the release and is what the local verifier + third-party verifier consume.

**Logging integration.** CSP report endpoint now receives reports from three hosts; each report's `document-uri` identifies which origin produced it. The ingest endpoint (Tier 0) is updated to log the origin and tag violations accordingly.

**No backward-compatibility shims.** Pre-production gives us the latitude for a clean cut. V1 single-origin deployments are deleted, not kept behind a flag. Any follow-up tier that relaxes the origin split must explicitly overwrite this work.

## Out of scope

Explicitly deferred to later tiers. Every item below is tracked in the master doc and will get its own spec in its own session.

- **HPKE primitive migration** (Tier 1). This tier keeps the hand-rolled ECIES over secp256k1 inherited from Tier 0; the cross-origin trust boundary does not depend on the inner primitive.
- **Non-extractable `CryptoKey` in IndexedDB** (Tier 1). This tier assumes the key store remains a multi-factor-KEK-wrapped blob. Moving it to a non-extractable `CryptoKey` moves state to the iframe's IDB but is otherwise orthogonal.
- **WebAuthn PRF primary KEK** (Tier 2). WebAuthn stays as an optional factor. The Tier 4 iframe split does not block the Tier 2 upgrade.
- **OPAQUE login** (Tier 2). Auth facade remains opaque session tokens.
- **Per-device keys + Per-User Key + sigchain** (Tier 3). Runs in parallel; no dependency either direction.
- **Cross-signing** (Tier 3).
- **Cascading Lazy Key Rotation** (Tier 3).
- **Voice E2EE via SFrame / RTCRtpScriptTransform** (Tier 5). The crypto iframe is not in the RTP pipeline — SFrame lives in a dedicated Web Worker inserted into `RTCRtpScriptTransform`. Tier 4 is the correct foundation for Tier 5 because Tier 5 must also trust the iframe for key generation.
- **MLS group keying** (Tier 6).
- **ML-KEM-1024 hybrid post-quantum** (Tier 6).
- **Tauri desktop build.** Referenced in the residual-risk statement as the hardened-alternative recommendation. Tauri gets its own spec in a separate session; Tier 4 ships without it, and the residual-risk statement says so plainly.
- **Signed WebExtension verifier.** Same treatment as Tauri — named in the residual-risk statement, deferred to a separate spec.
- **Browser-as-renderer mode (Threema Web pattern).** Master doc §8.5. Not in Tier 4.
- **Commissioned public audit.** The whitepaper is the artefact an auditor consumes. Tier 4 delivers the whitepaper; engaging an auditor is a non-technical follow-up.
- **SLSA L4.** Tier 4 ships cosign + SBOM + SLSA L3. L4 requires hermetic builds + two-party review, which are separate workstreams and are tracked as aspirational in the master doc.
- **Certificate transparency monitoring for the three subdomains.** Considered; superseded in practice by the gossip attestation (4.4) and the third-party verifier (4.3), which together catch any CT-monitorable attack class. Revisit if a spec lands that explicitly needs CT monitoring (e.g. impersonation-of-subdomain attacks).
- **Service-worker-based origin lock.** Considered — a service worker on `app.llamenos.example` could pin the expected bundle hashes and refuse to let the page load anything else — but would duplicate the verifier's work and create a separate update-in-place vector. Deferred.

## Success criteria

The spec is complete when the implementation of the accompanying plan achieves all of the following:

1. **`app.llamenos.example` serves only `dist/client/`** and has no database, no secrets, and no writeable filesystem state. `api.llamenos.example` serves only `/api/*`, `/telephony/*`, and `/messaging/*`. `crypto.llamenos.example` serves only `dist/crypto-sandbox/`. Verified by `tests/deploy/test-split-origin.yml` and `tests/api/split-origin-cors.spec.ts`.
2. **Cross-origin isolation active on both SPA and crypto origins.** `window.crossOriginIsolated === true`. Verified by `tests/ui/cross-origin-isolation.spec.ts`.
3. **Iframe sandbox attribute is `allow-scripts` only** (no `allow-same-origin`). Verified by `tests/ui/cross-origin-isolation.spec.ts`.
4. **Every crypto operation reachable from the UI goes through the postMessage RPC.** A CI grep check asserts that `src/client/lib/crypto-worker.ts` and `src/shared/crypto-primitives.ts` are NOT imported anywhere in `src/client/` except from inside `crypto-sandbox/`. Verified by `scripts/check-crypto-isolation.sh` in CI.
5. **Cross-origin cookies succeed** (normal path) and **cross-origin cookies fall back to redirect flow** (ITP path). Verified by `tests/ui/cross-origin-refresh.spec.ts`.
6. **Allied-org verifier repository exists** with a working GitHub Action that publishes verdicts to Nostr. Verified by a manual smoke check at release time (the verifier's most recent run is `success`).
7. **Simulated mass tampering is detected within 10 minutes** by the third-party verifier. Verified by a manual drill documented in `docs/security/TIER_4_DRILL.md`.
8. **Clients publish kind-20002 bundle-attest events on every unlock.** Verified by `tests/api/bundle-attest-publish.spec.ts` and `tests/ui/bundle-attest-healthy.spec.ts`.
9. **Simulated fleet divergence surfaces an alert within 20 s** in the UI. Verified by `tests/ui/bundle-attest-mismatch.spec.ts`.
10. **`docs/security/WHITEPAPER.md` exists, covers all sections, renders on the public site**, and is cosign-signed + hash-present in `CHECKSUMS.txt`. Verified by `tests/api/releases-manifest.spec.ts` and `tests/ui/whitepaper-render.spec.ts`.
11. **`docs/security/RESIDUAL_RISK.md` exists and is shown at onboarding** with scroll-to-bottom gate and audit-log acknowledgement. Verified by `tests/ui/residual-risk-onboarding.spec.ts`.
12. **`docs/security/WARRANT_CANARY.md` exists** with an initial signed statement.
13. **All existing tests** (`bun run test:unit`, `tests/api`, `tests/ui`) pass alongside the new coverage.
14. **Typecheck + lint + build clean** on both main SPA and `crypto-sandbox/` projects.
15. **`./scripts/verify-build.sh` verifies the split-origin artefacts** against the signed release and the local-verifier UI affordance works end-to-end.

Every success-criteria item has a corresponding test, grep check, or drill and is verifiable by an independent reviewer.
