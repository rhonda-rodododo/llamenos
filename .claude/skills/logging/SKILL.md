---
name: logging
description: Use when adding log statements, editing files that log, debugging log output, or reviewing PRs/code that touches logging. Enforces scoped structured logging (no console.*, no PII in logs, namespaces, createLogger/createDebugLog). Also use this when reviewing diffs — check for console.* usage, PII leaks in log extras, wrong logger primitive, or missing namespace conventions.
---

# Logging Rules

## Server — `createLogger`

- **One logger per file** at module top: `import { createLogger } from '../lib/logger'` → `const log = createLogger('domain.file')`
- **Namespaces are dot-separated**: `telephony.twilio`, `routes.bans`, `services.files`, `jobs.retention-purge`
- **Levels**: `debug` (noisy dev), `info` (normal flow), `warn` (degraded but handled), `error` (failures)
- **Error helper**: `log.error(msg, err, extra?)` — pass the `Error` as 2nd arg. Never `{ err }` in extras.
- **Request context auto-attaches** via AsyncLocalStorage (`reqId`, `hubId`, `userId`, `traceId`). Don't re-add these manually.
- **Never use `console.*`.** Biome `noConsole` rule blocks it.

## Client — `createDebugLog`

- **One logger per file**: `import { createDebugLog } from '@/lib/debug-log'` → `const log = createDebugLog('llamenos:area')`
- **Namespace starts with `llamenos:`**: `llamenos:webrtc:quality`, `llamenos:auth`, `llamenos:nostr`
- **Single callable** — no `.info`/`.warn` methods. Just `log(msg, data)`.
- **DEV-only.** Production bundle has zero logs (zero-knowledge). Vite strips everything.
- **Never use `console.*`.** Biome blocks it AND Vite strips it.
- Errors that need user visibility: use error boundary / toasts, not logs.

## PII Rules (critical for zero-knowledge)

**Never log at the call site:**
- Phone numbers, email addresses, names (first/last/full/display)
- Message content/body, ciphertext, nsec, pubkeys, recovery keys, PINs, tokens, passwords

**Instead log safe derivatives:**
- `messageId`, `conversationId`, `hubId` (opaque IDs)
- `contentLength`, `recipientCount`, `hasSender: !!phone` (summaries/booleans)
- `callerLast4` (existing pattern, use sparingly)

The runtime redactor catches keys matching `/phone|email|nsec|secret|token|ciphertext|encrypted|content|recovery|password|credential/i` but do NOT rely on it — avoid logging these fields in the first place.

The `Loggable<T>` type gate blocks branded `Ciphertext`/`HmacHash` types at compile time.

## Code Review Checklist

When reviewing a diff, flag:
1. Any `console.*` call (must be `createLogger` or `createDebugLog`)
2. PII in log extras (phone, name, email, content, ciphertext)
3. Error spread into extras instead of 2nd arg (`{ err }` → `log.error(msg, err)`)
4. Missing or wrong namespace (should match `domain.file` server-side, `llamenos:area` client-side)
5. Client code using `createLogger` (should be `createDebugLog`) or vice versa
6. Manual `reqId`/`hubId` in extras (auto-attaches via ALS)
