# Logging Infrastructure Overhaul

**Date:** 2026-04-05
**Status:** Design approved, pending implementation plan

## Problem

The codebase has ~209 raw `console.log/warn/error/info/debug` calls across ~20 files, bypassing the two existing logging primitives (`src/server/lib/logger.ts`, `src/client/lib/debug-log.ts`). This creates several risks:

- **Zero-knowledge violation surface**: raw `console.*` calls can accidentally log PII, `Ciphertext`, `nsec`, or pubkeys. One leaked phone number in a log aggregator is a threat-model failure.
- **Production bundle noise**: `console.*` calls survive into the client bundle, giving adversaries visibility into client internals on volunteer devices which may be on adversary-controlled networks.
- **Log flood / DoS**: a misbehaving job loop or webhook storm can crash the server via unbounded log volume.
- **No enforcement**: nothing prevents new `console.*` from accumulating.

## Goals

1. Replace all 209 raw `console.*` calls with typed, scoped, structured logging.
2. Guarantee zero logs in the production client bundle (Vite strips them).
3. Prevent PII/ciphertext leakage via both compile-time (type gate) and runtime (redactor) mechanisms.
4. Prevent runaway log volume from crashing the server (per-component rate limit).
5. Enforce all of the above via Biome lint, pre-commit hook, and a skill — so regression is hard.

## Non-Goals

- OpenTelemetry integration (deferred; `traceId` placeholder makes it a drop-in later).
- Client-side error telemetry / reporting (incompatible with zero-knowledge).
- Log sampling (rate limiting is sufficient; sampling loses intermittent-bug signal).
- Async log transport (stdout JSON → aggregator is the contract).

## Architecture

### Server logger (`src/server/lib/logger.ts` — rewrite)

Retains structured JSON output and `createLogger(namespace)` signature. Adds:

- **Hierarchical namespaces**: dot-separated (`telephony.twilio`, `auth.webauthn`, `messaging.signal`). Filtered via `LOG_NAMESPACES` env var with glob support (`telephony.*,auth,messaging.signal`). Combined with existing `LOG_LEVEL` filter.
- **AsyncLocalStorage context**: a Hono middleware (`requestContextMiddleware`) populates ALS with `{ reqId, hubId, userId, traceId }` per request. Every `log.*` call within that request chain auto-attaches these fields — no manual threading through services.
  - `reqId`: generated UUID per request.
  - `hubId`: from JWT claims (nullable before auth).
  - `userId`: first 8 chars of SHA-256(pubkey). Correlation-safe, zero-knowledge-compatible.
  - `traceId`: equals `reqId` unless `traceparent` header is present. OTel-ready placeholder.
- **Type gate** (`Loggable<T>`): the `extra` param is `Loggable<Record<string, unknown>>`. Branded `Ciphertext`, `PhoneNumber`, `Nsec`, `Pubkey` types are marked `Unloggable`. Compile error if passed. Defined in `src/shared/logger-types.ts` (new).
- **Runtime redactor**: walks the merged entry before emit; replaces values whose keys match `/phone|name|email|nsec|secret|token|ciphertext|encrypted|content|recovery|pin/i` with `"[redacted]"`. Also redacts string values matching nsec/ciphertext/hex-pubkey patterns. Depth-limited to 2 levels. ~1µs overhead per call.
- **Per-component rate limiter**: token bucket per `{namespace, level}`. Defaults:
  - debug: 50/s
  - info: 200/s
  - warn: 500/s
  - error: unlimited
  - Overflow is counted; a single summary log emits when a 10s window closes: `"Suppressed N {level} logs for {namespace} in last 10s"`.
- **Error helper**: `log.error(msg, err, extra?)` unwraps `Error` into `{ errName, errMsg, stack }`. Stack stripped in prod unless `LOG_STACKS=true`. Never spreads raw error objects (may carry PII).
- **Fail-safe**: the logger itself never throws. Internal failures (redactor crash, circular ref, serialization) fall through to a plain-text `process.stderr.write`.

### Client logger (`src/client/lib/debug-log.ts` — rewrite)

- `createDebugLog(namespace)` returns a callable function; **no-op in production**.
- DEV scoping: `localStorage.setItem('debug', 'llamenos:crypto,llamenos:sip')` filters namespaces at runtime. Zero production effect — function body is dead-code-eliminated.
- No `reportError`, no telemetry, no localStorage writes from logs. Errors surface via the existing React error boundary and toasts.

### Production build configuration

- `vite.config.ts`: `esbuild: { drop: ['console', 'debugger'], pure: ['console.log', 'console.debug', 'console.info', 'console.warn', 'console.error'] }` in prod builds.
- `import.meta.env.DEV` guard inside `createDebugLog` for source-level DCE.
- **Build verification step** (new `scripts/verify-no-console.sh`): grep `dist/client/**/*.js` for `console\.` outside allowlisted vendor paths; fail CI if found.
- Server (Bun) doesn't strip — `LOG_LEVEL`/`LOG_NAMESPACES` control verbosity. `process.stdout.write` is used inside the logger itself (no console calls remain even there).

### Enforcement layer

- **Biome lint rule**: `lint.rules.suspicious.noConsole = "error"` in `biome.json`, scoped to `src/**`. Blocks `console.*` at write time.
- **Pre-commit hook**: `bun run lint` + `scripts/check-logger-usage.ts` — ensures no raw `console.*` in staged files, verifies every source file importing logger uses module-level `const log = createLogger(...)` pattern (optional warning, not blocking).
- **Skill** (`skills/logging/SKILL.md`): short guide triggered when editing files that log — rules for namespace naming, PII avoidance, error helper usage, request-context fields.
- **Type-level gate**: `Loggable<T>` and `Unloggable` markers in `src/shared/logger-types.ts`. Branded PII types in `src/shared/types.ts` extend `Unloggable`.

### Sweep strategy

Single PR, per-directory commits for reviewability:

1. `src/server/telephony/*` (31 calls across 6 adapters)
2. `src/server/messaging/*` (17 calls)
3. `src/server/jobs/*` (8 calls)
4. `src/server/lib/*`, `src/server/routes/*`, `src/server/services/*` (remaining server)
5. `src/client/**` (client files using raw console)
6. Enforcement layer activation (Biome rule flipped to `error`, pre-commit hook, build check)

Each file gets a module-level `const log = createLogger('category.subcategory')`. Every `.error` call converted to `log.error(msg, err)` form.

## Data Flow

```
Request enters Hono
  → requestContextMiddleware populates AsyncLocalStorage
    with { reqId, hubId, userId (hashed), traceId }
  → Handler/service calls log.info(msg, extra)
    → logger merges ALS context + call-site extras
    → Type gate enforces Loggable<T> at compile time
    → Runtime redactor walks merged entry (key patterns + value patterns)
    → Namespace filter (LOG_NAMESPACES glob match)
    → Level filter (LOG_LEVEL >= entry level)
    → Rate limiter (token bucket per {namespace, level})
    → JSON.stringify → process.stdout.write (or stderr for error)
```

## Error Handling

- Logger never throws. Any internal failure → best-effort `process.stderr.write` of plain text fallback.
- Circular references in `extra` caught by JSON replacer; replaced with `"[circular]"`.
- Rate limiter state is in-memory per process; lost on restart (acceptable — docker/systemd restarts are rare).
- Redactor failures (e.g. proxy objects throwing on access) caught per-field; field becomes `"[redact-error]"`.

## Testing

- **Unit** (`src/server/lib/logger.test.ts`): namespace glob, level filter, redactor (key patterns, value patterns, depth limit, circular refs), rate limiter (burst + summary), ALS context merge, error unwrapping, fail-safe behavior.
- **Unit** (`src/client/lib/debug-log.test.ts`): DEV namespace filter via localStorage, no-op behavior when `import.meta.env.DEV === false`.
- **Type tests** (`src/shared/logger-types.test-d.ts`): `log.info('msg', { nsec })` must fail compilation; `log.info('msg', { hubId, reqId })` must compile.
- **Build test** (CI): `bun run build` → grep for `console.` in `dist/client/**` → fail if found outside vendor allowlist.
- **Integration** (`tests/api/logging.spec.ts`): hit an endpoint, assert emitted log line contains `reqId`, `hubId` from JWT, does NOT contain phone/name from request body.

## Open Questions

None. All decisions made during brainstorming.

## Risks

- **Sweep size**: ~209 call sites, touching ~20 files across server and client. Mitigated by per-directory commits and type gate catching regressions.
- **Rate limiter false positives**: defaults chosen generously (50/200/500/s); per-component tuning may be needed for high-traffic paths (Twilio webhooks, Nostr relay). Mitigation: defaults are env-configurable via `LOG_RATE_LIMITS` JSON override.
- **Redactor false negatives**: pattern-based key matching can miss new field names. Mitigation: type gate is primary defense; redactor is belt-and-braces.
- **ALS context overhead**: negligible in Bun/Node, but every request carries the context. Already used elsewhere (common Hono pattern).
