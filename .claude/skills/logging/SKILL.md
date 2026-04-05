---
name: logging
description: Use when adding log statements, editing files that log, or debugging log output. Enforces the project's scoped structured logging rules (no console.*, no PII, namespaces, createLogger/createDebugLog).
---

# Logging Rules (llamenos-hotline)

## Server

- **Always use `createLogger('category.subcategory')`** from `@server/lib/logger` at module top. One logger per file.
- **Never use `console.*`.** Biome blocks it via the `noConsole` rule.
- **Namespaces are dot-separated**: `telephony.twilio`, `auth.webauthn`, `services.files`.
- **Levels**: `debug` (noisy, dev), `info` (normal flow), `warn` (degraded but handled), `error` (failures).
- **Error helper**: `log.error(msg, err, extra?)` — pass the `Error` as 2nd arg. Do NOT spread errors into `extra`.
- **Request context (reqId, hubId, userId, traceId) auto-attaches** via AsyncLocalStorage. Don't re-add it to every call.

### Banned in log extras (type-gate enforced)

`Ciphertext`, `HmacHash` branded types. The TS compiler rejects them at the call site via the `Loggable<T>` type.

### Runtime-redacted keys (belt-and-braces)

Any extra-field key matching these patterns is replaced with `"[redacted]"`:
- Case-insensitive partials: `phone`, `email`, `nsec`, `secret`, `token`, `ciphertext`, `encrypted`, `content`, `recovery`, `password`, `credential`
- Exact `pin`
- Name patterns: `name`, `firstName`, `lastName`, `fullName`, `displayName`, `userName`

This is a safety net — DO NOT rely on it. Still avoid logging these fields.

### Config (server env vars)

- `LOG_LEVEL=debug|info|warn|error` (default `info`)
- `LOG_NAMESPACES=telephony.*,auth` (default `*`)
- `LOG_RATE_LIMITS='{"info":500}'` (JSON; defaults: debug 50/s, info 200/s, warn 500/s, error unlimited)
- `LOG_STACKS=true` to include stack traces (default false)

## Client

- **Always use `createDebugLog('llamenos:area')`** from `@/lib/debug-log`.
- **Never use `console.*`.** Biome blocks it AND Vite strips it from the prod bundle.
- **Client logs are DEV-only.** Production bundle contains zero logs (zero-knowledge requirement).
- **Runtime scoping** (DEV): `localStorage.setItem('debug', 'llamenos:crypto,llamenos:webrtc:*')`.
- No level distinction on the client — all logs go through the one `log()` callable.
- Errors that need user-visible surfacing: throw them or use the error boundary / toast. Do not rely on logs.

## When in doubt

- Adding a new module? Use `createLogger('<domain>.<file>')` with dot-separated namespace.
- Logging an error? `log.error(msg, err)`.
- Logging sensitive user data? **Don't.** Log an ID, count, or boolean-presence marker instead.
