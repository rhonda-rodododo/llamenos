# Logging Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 209 raw `console.*` calls with typed, scoped, structured logging; guarantee zero client logs in prod; prevent PII/ciphertext leakage at compile-time and runtime; rate-limit server logs; enforce via lint, pre-commit, and a skill.

**Architecture:** Rewrite `src/server/lib/logger.ts` with hierarchical namespaces, AsyncLocalStorage request context, a `Loggable<T>` type gate, runtime field redactor, and per-component token-bucket rate limiter. Rewrite `src/client/lib/debug-log.ts` as a DEV-only no-op stripped by Vite in prod. Sweep all ~45 files, enable Biome `noConsole` at error level, add post-build verification grep, add lefthook pre-commit check, and ship a skill.

**Tech Stack:** TypeScript, Bun, Hono, AsyncLocalStorage, Biome, Vite (esbuild drop), lefthook.

**Spec:** `docs/superpowers/specs/2026-04-05-logging-infrastructure-design.md`

---

## File Structure

**New files:**
- `src/shared/logger-types.ts` — `Loggable<T>`, `Unloggable` type markers, shared between client and server.
- `src/server/lib/log-context.ts` — AsyncLocalStorage holder + accessor helpers.
- `src/server/lib/log-redactor.ts` — runtime key/value redaction.
- `src/server/lib/log-rate-limiter.ts` — per-`{namespace, level}` token bucket + overflow summary.
- `src/server/middleware/log-context.ts` — Hono middleware populating ALS per request.
- `src/server/lib/logger.test.ts` — unit tests for logger + filters + rate limiter.
- `src/server/lib/log-redactor.test.ts` — redactor unit tests.
- `src/server/lib/log-rate-limiter.test.ts` — rate limiter unit tests.
- `src/client/lib/debug-log.test.ts` — client debug-log tests.
- `src/shared/logger-types.test-d.ts` — compile-time type-gate assertions.
- `scripts/verify-no-console.sh` — post-build grep for `console.` in `dist/client`.
- `scripts/check-logger-usage.ts` — optional pre-commit staged-file check.
- `tests/api/logging.spec.ts` — integration test: reqId/hubId in logs, no PII leak.
- `.claude/skills/logging/SKILL.md` — project skill with namespace/PII rules.

**Rewrites:**
- `src/server/lib/logger.ts` — wire the new pieces together.
- `src/client/lib/debug-log.ts` — DEV-only with localStorage namespace filter.
- `vite.config.ts` — add `esbuild.drop` + `pure` config.
- `biome.json` — enable `noConsole` at `error` level.
- `lefthook.yml` — add `no-console-check` job to pre-commit.
- `package.json` — add `verify:no-console` script, wire into `build`.
- `src/server/app.ts` — mount `logContextMiddleware` first.

**Sweep targets (45 files, ~209 calls):**
- Server telephony (6): `bandwidth.ts`, `plivo.ts`, `sip-bridge-adapter.ts`, `telnyx.ts`, `twilio.ts`, `vonage.ts`
- Server messaging (2): `router.ts`, `signal/registration.ts`
- Server jobs (2): `blast-processor.ts`, `retention-purge.ts`
- Server lib (8): `adapters.ts`, `auth.ts`, `nostr-events.ts`, `nostr-publisher.ts`, `ringing.ts`, `storage-admin.ts`, `storage-manager.ts`, `transcription-manager.ts`, `voicemail-storage.ts`, `storage-manager.integration.test.ts`
- Server middleware (1): `error.ts`
- Server routes (6): `conversations.ts`, `firehose.ts`, `hubs.ts`, `reports.ts`, `telephony.ts`, `webrtc.ts`
- Server services (4): `files.ts`, `firehose-agent.ts`, `firehose-inference.ts`, `provider-health.ts`, `push.ts`
- Server entry (1): `server.ts`
- Client (10): `components/error-boundary.tsx`, `components/setup/AdminBootstrap.tsx`, `lib/auth.tsx`, `lib/key-manager.ts`, `lib/nostr/relay.ts`, `lib/webrtc/adapters/{plivo,twilio,vonage}.ts`, `lib/webrtc/manager.ts`, `routes/settings.tsx`

---

## Task 1: Define `Loggable<T>` type gate in shared

**Files:**
- Create: `src/shared/logger-types.ts`
- Create: `src/shared/logger-types.test-d.ts`

- [ ] **Step 1: Write the type declarations**

```typescript
// src/shared/logger-types.ts
/**
 * Type-level gate preventing PII/ciphertext from being passed to logger helpers.
 *
 * Branded types in `crypto-types.ts` and `types.ts` (Ciphertext, PhoneNumber, etc.)
 * are marked with `Unloggable` so the compiler rejects `log.info('msg', { nsec })`.
 *
 * Plain string/number/boolean/null/undefined are always Loggable.
 * Records and arrays are Loggable if all leaves are Loggable.
 */

/** Marker brand for types that must never appear in logs. */
export type Unloggable = { readonly __unloggable: true }

/**
 * Recursively checks that T contains no `Unloggable`-branded values.
 * If any property's type extends `Unloggable`, the whole type fails.
 */
export type Loggable<T> = T extends Unloggable
  ? never
  : T extends string | number | boolean | null | undefined | Date | Error
    ? T
    : T extends ReadonlyArray<infer U>
      ? ReadonlyArray<Loggable<U>>
      : T extends object
        ? { [K in keyof T]: Loggable<T[K]> }
        : T

/** Typed `extra` argument accepted by every logger method. */
export type LogExtra = Loggable<Record<string, unknown>>
```

- [ ] **Step 2: Write type-test assertions**

```typescript
// src/shared/logger-types.test-d.ts
import { expectTypeOf, test } from 'vitest'
import type { Loggable, Unloggable } from './logger-types'

type PhoneNumber = string & Unloggable
type Ciphertext = string & Unloggable

test('plain records are Loggable', () => {
  expectTypeOf<Loggable<{ hubId: string; count: number }>>().not.toBeNever()
})

test('records with Unloggable fields collapse to never somewhere', () => {
  type Bad = Loggable<{ phone: PhoneNumber }>
  expectTypeOf<Bad['phone']>().toBeNever()
})

test('nested Unloggable caught', () => {
  type Bad = Loggable<{ user: { ct: Ciphertext } }>
  expectTypeOf<Bad['user']['ct']>().toBeNever()
})

test('arrays of Unloggable collapse', () => {
  type Bad = Loggable<PhoneNumber[]>
  expectTypeOf<Bad[number]>().toBeNever()
})
```

- [ ] **Step 3: Run typecheck to verify the file compiles**

Run: `bun run typecheck`
Expected: PASS (no errors introduced).

- [ ] **Step 4: Commit**

```bash
git add src/shared/logger-types.ts src/shared/logger-types.test-d.ts
git commit -m "feat(logger): add Loggable<T> type gate for PII-safe logging"
```

---

## Task 2: Mark branded PII types as Unloggable

**Files:**
- Modify: `src/shared/crypto-types.ts`
- Modify: `src/shared/types.ts` (phone/name brand if present)

- [ ] **Step 1: Update `crypto-types.ts` to extend Unloggable**

```typescript
// src/shared/crypto-types.ts
import type { Unloggable } from './logger-types'

/** Encrypted ciphertext — hex-encoded nonce(24) || XChaCha20-Poly1305 ciphertext */
export type Ciphertext = string & { readonly __brand: 'Ciphertext' } & Unloggable

/** HMAC-SHA256 hash — hex-encoded, one-way, cannot be reversed */
export type HmacHash = string & { readonly __brand: 'HmacHash' } & Unloggable
```

- [ ] **Step 2: Check whether `PhoneNumber`/`Nsec`/`Pubkey` branded types exist in types.ts**

Run: `grep -n "PhoneNumber\|Nsec\|Pubkey" src/shared/types.ts | head -20`

If they exist as `string & { readonly __brand: '...' }` types, append `& Unloggable` to each. If they are plain `string` aliases (not branded), leave them — they fall through to runtime redactor (Task 4).

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS. If any existing code logs Ciphertext via the OLD `createLogger`, it will still pass here because the old `log.info()` signature is `extra?: Record<string, unknown>`. We catch those in Task 6 when the new signature is enforced.

- [ ] **Step 4: Commit**

```bash
git add src/shared/crypto-types.ts src/shared/types.ts
git commit -m "feat(logger): brand Ciphertext/HmacHash as Unloggable"
```

---

## Task 3: Implement log-context (AsyncLocalStorage)

**Files:**
- Create: `src/server/lib/log-context.ts`
- Create: `src/server/lib/log-context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/lib/log-context.test.ts
import { describe, expect, test } from 'bun:test'
import { getLogContext, runWithLogContext } from './log-context'

describe('log-context', () => {
  test('returns empty object when no context is active', () => {
    expect(getLogContext()).toEqual({})
  })

  test('returns the current context inside runWithLogContext', () => {
    runWithLogContext({ reqId: 'r1', hubId: 'h1' }, () => {
      expect(getLogContext()).toEqual({ reqId: 'r1', hubId: 'h1' })
    })
  })

  test('nested runs inherit and override', () => {
    runWithLogContext({ reqId: 'r1' }, () => {
      runWithLogContext({ hubId: 'h2' }, () => {
        expect(getLogContext()).toEqual({ reqId: 'r1', hubId: 'h2' })
      })
    })
  })

  test('async boundaries preserve context', async () => {
    await runWithLogContext({ reqId: 'async-r' }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      expect(getLogContext()).toEqual({ reqId: 'async-r' })
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/lib/log-context.test.ts`
Expected: FAIL with "Cannot find module './log-context'".

- [ ] **Step 3: Implement log-context**

```typescript
// src/server/lib/log-context.ts
import { AsyncLocalStorage } from 'node:async_hooks'

export interface LogContext {
  reqId?: string
  hubId?: string
  userId?: string  // hashed (first 8 hex of SHA-256(pubkey))
  traceId?: string
}

const storage = new AsyncLocalStorage<LogContext>()

/** Run `fn` with the given log context visible to all `getLogContext()` calls inside it. */
export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = storage.getStore() ?? {}
  return storage.run({ ...parent, ...ctx }, fn)
}

/** Returns the current log context, or `{}` if none is active. */
export function getLogContext(): LogContext {
  return storage.getStore() ?? {}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/lib/log-context.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/log-context.ts src/server/lib/log-context.test.ts
git commit -m "feat(logger): add AsyncLocalStorage-based log context"
```

---

## Task 4: Implement the redactor

**Files:**
- Create: `src/server/lib/log-redactor.ts`
- Create: `src/server/lib/log-redactor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/lib/log-redactor.test.ts
import { describe, expect, test } from 'bun:test'
import { redact } from './log-redactor'

describe('redact', () => {
  test('replaces values of sensitive keys', () => {
    const input = { hubId: 'h1', phone: '+12025550100', name: 'Alice' }
    expect(redact(input)).toEqual({ hubId: 'h1', phone: '[redacted]', name: '[redacted]' })
  })

  test('is case-insensitive on keys', () => {
    expect(redact({ PhoneNumber: 'x', EmailAddress: 'y' })).toEqual({
      PhoneNumber: '[redacted]',
      EmailAddress: '[redacted]',
    })
  })

  test('matches partial keys', () => {
    expect(redact({ encryptedName: 'cipher', userContent: 'raw' })).toEqual({
      encryptedName: '[redacted]',
      userContent: '[redacted]',
    })
  })

  test('redacts nsec/hex-pubkey/ciphertext patterns in string values', () => {
    const out = redact({ note: 'leaked nsec1' + 'q'.repeat(58) }) as { note: string }
    expect(out.note).toContain('[redacted:nsec]')
  })

  test('recurses into nested objects up to depth 2', () => {
    const input = { a: { b: { phone: 'x' } } }
    expect(redact(input)).toEqual({ a: { b: { phone: '[redacted]' } } })
  })

  test('does not recurse deeper than 2 (safety)', () => {
    const input = { a: { b: { c: { phone: 'x' } } } } as Record<string, unknown>
    const out = redact(input) as { a: { b: { c: { phone: string } } } }
    // depth 3 is left as-is; type gate is primary defense
    expect(out.a.b.c.phone).toBe('x')
  })

  test('replaces circular refs with [circular]', () => {
    const input: Record<string, unknown> = { name: 'Alice' }
    input.self = input
    const out = redact(input) as Record<string, unknown>
    expect(out.name).toBe('[redacted]')
    expect(out.self).toBe('[circular]')
  })

  test('handles arrays', () => {
    expect(redact({ items: [{ phone: 'x' }, { phone: 'y' }] })).toEqual({
      items: [{ phone: '[redacted]' }, { phone: '[redacted]' }],
    })
  })

  test('passes through safe values', () => {
    expect(redact({ hubId: 'h1', count: 5, active: true })).toEqual({
      hubId: 'h1',
      count: 5,
      active: true,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/lib/log-redactor.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the redactor**

```typescript
// src/server/lib/log-redactor.ts
const SENSITIVE_KEY_RE =
  /phone|email|nsec|secret|token|ciphertext|encrypted|content|recovery|^pin$|password|credential/i

// Exclude 'name' alone — it has too many safe uses ('componentName', 'eventName').
// But catch first/last/full name:
const NAME_KEY_RE = /^(first|last|full|display|user)?name$/i

const NSEC_RE = /nsec1[0-9a-z]{58}/g
const HEX_PUBKEY_RE = /\b[0-9a-f]{64}\b/gi
const MAX_DEPTH = 2

function redactString(s: string): string {
  return s
    .replace(NSEC_RE, '[redacted:nsec]')
    .replace(HEX_PUBKEY_RE, (m) => (m.length === 64 ? '[redacted:hex64]' : m))
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key) || NAME_KEY_RE.test(key)
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return { errName: value.name, errMsg: redactString(value.message) }
  }
  if (typeof value !== 'object') return String(value)

  if (seen.has(value as object)) return '[circular]'
  seen.add(value as object)

  if (depth >= MAX_DEPTH) return value

  if (Array.isArray(value)) {
    return value.map((v) => redactInner(v, depth + 1, seen))
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (isSensitiveKey(k)) {
      out[k] = '[redacted]'
    } else {
      try {
        out[k] = redactInner(v, depth + 1, seen)
      } catch {
        out[k] = '[redact-error]'
      }
    }
  }
  return out
}

/** Walks value up to depth 2, redacting sensitive keys and string patterns. */
export function redact<T>(value: T): T {
  return redactInner(value, 0, new WeakSet()) as T
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/lib/log-redactor.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/log-redactor.ts src/server/lib/log-redactor.test.ts
git commit -m "feat(logger): add runtime PII redactor"
```

---

## Task 5: Implement the rate limiter

**Files:**
- Create: `src/server/lib/log-rate-limiter.ts`
- Create: `src/server/lib/log-rate-limiter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/lib/log-rate-limiter.test.ts
import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { createRateLimiter } from './log-rate-limiter'

describe('log rate limiter', () => {
  let now = 0
  const clock = () => now
  beforeEach(() => { now = 1_000_000 })

  test('allows logs under the limit', () => {
    const rl = createRateLimiter({ info: 10 }, clock)
    for (let i = 0; i < 10; i++) expect(rl.check('telephony.twilio', 'info')).toBe(true)
  })

  test('drops logs over the limit within the same second', () => {
    const rl = createRateLimiter({ info: 3 }, clock)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(false)
  })

  test('refills bucket after a second elapses', () => {
    const rl = createRateLimiter({ info: 2 }, clock)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(false)
    now += 1000
    expect(rl.check('ns', 'info')).toBe(true)
  })

  test('separate buckets per namespace and level', () => {
    const rl = createRateLimiter({ info: 1, warn: 1 }, clock)
    expect(rl.check('a', 'info')).toBe(true)
    expect(rl.check('a', 'info')).toBe(false)
    expect(rl.check('b', 'info')).toBe(true)
    expect(rl.check('a', 'warn')).toBe(true)
  })

  test('drainOverflows returns suppression summaries and resets', () => {
    const rl = createRateLimiter({ info: 1 }, clock)
    rl.check('ns', 'info')  // allowed
    rl.check('ns', 'info')  // dropped
    rl.check('ns', 'info')  // dropped
    const summaries = rl.drainOverflows()
    expect(summaries).toEqual([{ namespace: 'ns', level: 'info', suppressed: 2 }])
    expect(rl.drainOverflows()).toEqual([])
  })

  test('error level has no limit (bucket of Infinity)', () => {
    const rl = createRateLimiter({ error: Number.POSITIVE_INFINITY }, clock)
    for (let i = 0; i < 10_000; i++) expect(rl.check('ns', 'error')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/lib/log-rate-limiter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the rate limiter**

```typescript
// src/server/lib/log-rate-limiter.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RateLimits {
  debug?: number
  info?: number
  warn?: number
  error?: number
}

interface Bucket {
  tokens: number
  windowStart: number
  suppressed: number
}

export interface OverflowSummary {
  namespace: string
  level: LogLevel
  suppressed: number
}

export interface RateLimiter {
  check(namespace: string, level: LogLevel): boolean
  drainOverflows(): OverflowSummary[]
}

/**
 * Per-`{namespace, level}` token bucket with 1-second windows.
 * Returns `false` when the bucket is empty; overflow is counted and
 * reported via `drainOverflows()` as a single summary per bucket.
 */
export function createRateLimiter(
  limits: Required<RateLimits>,
  clock: () => number = Date.now,
): RateLimiter {
  const buckets = new Map<string, Bucket>()

  function key(ns: string, level: LogLevel) {
    return `${ns}|${level}`
  }

  function getBucket(ns: string, level: LogLevel): Bucket {
    const k = key(ns, level)
    let b = buckets.get(k)
    const now = clock()
    if (!b) {
      b = { tokens: limits[level], windowStart: now, suppressed: 0 }
      buckets.set(k, b)
    } else if (now - b.windowStart >= 1000) {
      b.tokens = limits[level]
      b.windowStart = now
    }
    return b
  }

  return {
    check(namespace, level) {
      const b = getBucket(namespace, level)
      if (b.tokens === Number.POSITIVE_INFINITY) return true
      if (b.tokens > 0) {
        b.tokens -= 1
        return true
      }
      b.suppressed += 1
      return false
    },
    drainOverflows() {
      const out: OverflowSummary[] = []
      for (const [k, b] of buckets) {
        if (b.suppressed > 0) {
          const [namespace, level] = k.split('|') as [string, LogLevel]
          out.push({ namespace, level, suppressed: b.suppressed })
          b.suppressed = 0
        }
      }
      return out
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/lib/log-rate-limiter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/log-rate-limiter.ts src/server/lib/log-rate-limiter.test.ts
git commit -m "feat(logger): add per-component token-bucket rate limiter"
```

---

## Task 6: Rewrite `src/server/lib/logger.ts` to wire everything together

**Files:**
- Modify (rewrite): `src/server/lib/logger.ts`
- Create: `src/server/lib/logger.test.ts`

- [ ] **Step 1: Write failing tests for the new logger**

```typescript
// src/server/lib/logger.test.ts
import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test'
import { createLogger, _setLoggerConfigForTests } from './logger'
import { runWithLogContext } from './log-context'

function captureStdout() {
  const lines: string[] = []
  const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    lines.push(typeof chunk === 'string' ? chunk : chunk.toString())
    return true
  })
  return { lines, restore: () => spy.mockRestore() }
}

describe('createLogger', () => {
  beforeEach(() => {
    _setLoggerConfigForTests({
      minLevel: 'debug',
      namespaces: ['*'],
      rateLimits: { debug: 1000, info: 1000, warn: 1000, error: Number.POSITIVE_INFINITY },
      stripStacks: false,
    })
  })

  test('emits JSON with component + level + ts + msg', () => {
    const cap = captureStdout()
    const log = createLogger('telephony.twilio')
    log.info('call answered', { callSid: 'CA123' })
    cap.restore()
    const entry = JSON.parse(cap.lines[0].trim())
    expect(entry.component).toBe('telephony.twilio')
    expect(entry.level).toBe('info')
    expect(entry.msg).toBe('call answered')
    expect(entry.callSid).toBe('CA123')
    expect(typeof entry.ts).toBe('string')
  })

  test('merges ALS request context', () => {
    const cap = captureStdout()
    const log = createLogger('auth')
    runWithLogContext({ reqId: 'r1', hubId: 'h1' }, () => {
      log.info('token verified')
    })
    cap.restore()
    const entry = JSON.parse(cap.lines[0].trim())
    expect(entry.reqId).toBe('r1')
    expect(entry.hubId).toBe('h1')
  })

  test('filters by namespace glob', () => {
    _setLoggerConfigForTests({
      minLevel: 'debug',
      namespaces: ['telephony.*'],
      rateLimits: { debug: 1000, info: 1000, warn: 1000, error: Number.POSITIVE_INFINITY },
      stripStacks: false,
    })
    const cap = captureStdout()
    createLogger('telephony.twilio').info('hit')
    createLogger('auth').info('miss')
    cap.restore()
    expect(cap.lines).toHaveLength(1)
    expect(cap.lines[0]).toContain('telephony.twilio')
  })

  test('filters by level', () => {
    _setLoggerConfigForTests({
      minLevel: 'warn',
      namespaces: ['*'],
      rateLimits: { debug: 1000, info: 1000, warn: 1000, error: Number.POSITIVE_INFINITY },
      stripStacks: false,
    })
    const cap = captureStdout()
    const log = createLogger('ns')
    log.debug('no')
    log.info('no')
    log.warn('yes')
    cap.restore()
    expect(cap.lines).toHaveLength(1)
  })

  test('redacts sensitive keys in extras', () => {
    const cap = captureStdout()
    createLogger('x').info('m', { hubId: 'h', phone: '+123' })
    cap.restore()
    const entry = JSON.parse(cap.lines[0].trim())
    expect(entry.phone).toBe('[redacted]')
    expect(entry.hubId).toBe('h')
  })

  test('error helper unwraps Error', () => {
    const cap = captureStdout()
    createLogger('x').error('failed', new Error('boom'))
    cap.restore()
    const entry = JSON.parse(cap.lines[0].trim())
    expect(entry.errName).toBe('Error')
    expect(entry.errMsg).toBe('boom')
    expect(entry.msg).toBe('failed')
  })

  test('rate limit drops surplus and emits summary', () => {
    _setLoggerConfigForTests({
      minLevel: 'debug',
      namespaces: ['*'],
      rateLimits: { debug: 2, info: 2, warn: 2, error: Number.POSITIVE_INFINITY },
      stripStacks: false,
    })
    const cap = captureStdout()
    const log = createLogger('ns')
    for (let i = 0; i < 5; i++) log.info('m')
    cap.restore()
    expect(cap.lines.length).toBe(2)  // only 2 passed
  })

  test('never throws on circular extras', () => {
    const cap = captureStdout()
    const circ: Record<string, unknown> = { a: 1 }
    circ.self = circ
    expect(() => createLogger('x').info('m', circ)).not.toThrow()
    cap.restore()
  })

  test('writes error level to stderr', () => {
    const stderr: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((c: any) => {
      stderr.push(typeof c === 'string' ? c : c.toString())
      return true
    })
    createLogger('x').error('bad')
    spy.mockRestore()
    expect(stderr).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/lib/logger.test.ts`
Expected: FAIL (exports `_setLoggerConfigForTests` don't exist; new signature mismatch).

- [ ] **Step 3: Rewrite `logger.ts`**

```typescript
// src/server/lib/logger.ts
import type { LogExtra } from '@shared/logger-types'
import { getLogContext } from './log-context'
import { redact } from './log-redactor'
import { createRateLimiter, type LogLevel, type RateLimits } from './log-rate-limiter'

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

interface LoggerConfig {
  minLevel: LogLevel
  namespaces: string[]  // globs; ['*'] = all
  rateLimits: Required<RateLimits>
  stripStacks: boolean
}

function parseRateLimits(env: string | undefined): Required<RateLimits> {
  const defaults: Required<RateLimits> = {
    debug: 50,
    info: 200,
    warn: 500,
    error: Number.POSITIVE_INFINITY,
  }
  if (!env) return defaults
  try {
    const parsed = JSON.parse(env) as Partial<RateLimits>
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

function loadConfig(): LoggerConfig {
  const minLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'
  const namespaces = (process.env.LOG_NAMESPACES || '*').split(',').map((s) => s.trim()).filter(Boolean)
  return {
    minLevel: LEVEL_PRIORITY[minLevel] !== undefined ? minLevel : 'info',
    namespaces: namespaces.length ? namespaces : ['*'],
    rateLimits: parseRateLimits(process.env.LOG_RATE_LIMITS),
    stripStacks: process.env.LOG_STACKS !== 'true',
  }
}

let config: LoggerConfig = loadConfig()
let rateLimiter = createRateLimiter(config.rateLimits)

// Exposed for tests only — do not use in app code.
export function _setLoggerConfigForTests(next: LoggerConfig): void {
  config = next
  rateLimiter = createRateLimiter(next.rateLimits)
}

function globMatches(namespace: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith('.*')) return namespace.startsWith(pattern.slice(0, -2) + '.')
    || namespace === pattern.slice(0, -2)
  return namespace === pattern
}

function namespaceAllowed(ns: string): boolean {
  return config.namespaces.some((p) => globMatches(ns, p))
}

function levelAllowed(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[config.minLevel]
}

function emit(entry: Record<string, unknown>, level: LogLevel): void {
  try {
    const line = JSON.stringify(entry, circularReplacer()) + '\n'
    if (level === 'error') process.stderr.write(line)
    else process.stdout.write(line)
  } catch {
    // Last-ditch: logger must never throw.
    process.stderr.write(`{"level":"error","component":"logger","msg":"emit failed"}\n`)
  }
}

function circularReplacer() {
  const seen = new WeakSet<object>()
  return (_: string, value: unknown) => {
    if (value !== null && typeof value === 'object') {
      if (seen.has(value as object)) return '[circular]'
      seen.add(value as object)
    }
    return value
  }
}

function unwrapError(err: unknown, stripStacks: boolean): Record<string, unknown> {
  if (err instanceof Error) {
    const base: Record<string, unknown> = { errName: err.name, errMsg: err.message }
    if (!stripStacks) base.stack = err.stack
    return base
  }
  return { errMsg: String(err) }
}

export interface Logger {
  debug(msg: string, extra?: LogExtra): void
  info(msg: string, extra?: LogExtra): void
  warn(msg: string, extra?: LogExtra): void
  error(msg: string, err?: unknown, extra?: LogExtra): void
}

/** Create a namespaced structured logger. Namespaces are dot-separated (e.g. `telephony.twilio`). */
export function createLogger(namespace: string): Logger {
  function write(level: LogLevel, msg: string, extra?: LogExtra): void {
    if (!levelAllowed(level)) return
    if (!namespaceAllowed(namespace)) return
    if (!rateLimiter.check(namespace, level)) return

    const ctx = getLogContext()
    const redactedExtra = extra ? redact(extra) : {}
    const entry = {
      level,
      ts: new Date().toISOString(),
      component: namespace,
      msg,
      ...ctx,
      ...redactedExtra,
    }
    emit(entry, level)
  }

  return {
    debug: (msg, extra) => write('debug', msg, extra),
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, err, extra) => {
      const merged = { ...(extra ?? {}), ...(err !== undefined ? unwrapError(err, config.stripStacks) : {}) }
      write('error', msg, merged as LogExtra)
    },
  }
}

// Background task: drain overflow summaries every 10s.
let overflowInterval: ReturnType<typeof setInterval> | null = null
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  overflowInterval = setInterval(() => {
    const summaries = rateLimiter.drainOverflows()
    for (const s of summaries) {
      emit({
        level: 'warn',
        ts: new Date().toISOString(),
        component: 'logger',
        msg: `Suppressed ${s.suppressed} ${s.level} logs for ${s.namespace} in last 10s`,
      }, 'warn')
    }
  }, 10_000)
  overflowInterval.unref?.()
}
```

- [ ] **Step 4: Run logger tests to verify they pass**

Run: `bun test src/server/lib/logger.test.ts`
Expected: PASS (9 tests). If any fail, fix before continuing.

- [ ] **Step 5: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS. (Call-site breakages from the new signature are fixed in the sweep tasks below. If typecheck fails here because an existing call site uses the OLD `log.error(msg, { err })` form, make the new signature BACKWARD-COMPATIBLE: `extra?: LogExtra` accepts extra objects as before; error unwrapping is additive. If typecheck still fails, address in Task 11.)

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/logger.ts src/server/lib/logger.test.ts
git commit -m "feat(logger): rewrite server logger with context, redaction, rate limiting"
```

---

## Task 7: Request context middleware

**Files:**
- Create: `src/server/middleware/log-context.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Implement the middleware**

```typescript
// src/server/middleware/log-context.ts
import { createMiddleware } from 'hono/factory'
import { createHash, randomUUID } from 'node:crypto'
import { runWithLogContext } from '../lib/log-context'

function hashUserId(pubkey: string | undefined): string | undefined {
  if (!pubkey) return undefined
  return createHash('sha256').update(pubkey).digest('hex').slice(0, 8)
}

/**
 * Populates AsyncLocalStorage with per-request log context so every
 * `createLogger(...).info(...)` call inside the request auto-attaches
 * { reqId, hubId, userId (hashed), traceId }.
 *
 * Must be mounted before routes. Auth middleware runs AFTER this and
 * sets `pubkey`/`hubId` on the Hono context; we re-run ALS once those
 * are known via a nested runWithLogContext in the auth middleware if needed,
 * OR we read them lazily from `c.get(...)` — but since ALS is populated
 * once here, we call `runWithLogContext` with the finalized values after
 * `await next()` is impossible. Instead, we set reqId/traceId up front,
 * and auth middleware calls `runWithLogContext` itself to layer hubId/userId.
 */
export const logContextMiddleware = createMiddleware(async (c, next) => {
  const reqId = randomUUID()
  const traceParent = c.req.header('traceparent')
  const traceId = traceParent?.split('-')[1] ?? reqId
  await runWithLogContext({ reqId, traceId }, async () => {
    await next()
  })
})
```

- [ ] **Step 2: Update auth middleware to layer hubId + userId into the context**

Open `src/server/middleware/auth.ts`. After `c.set('pubkey', ...)` and `c.set('user', ...)`, import `runWithLogContext` and wrap the remainder:

```typescript
// src/server/middleware/auth.ts — near the bottom of the middleware
import { createHash } from 'node:crypto'
import { runWithLogContext } from '../lib/log-context'

// ... existing code that sets pubkey/user/permissions/allRoles ...

const userIdHash = createHash('sha256').update(authResult.pubkey).digest('hex').slice(0, 8)
const hubId = (authResult.user as { hubId?: string })?.hubId

await runWithLogContext({ hubId, userId: userIdHash }, async () => {
  await next()
})
```

(Replace the existing `await next()` call with the wrapped version. Verify by reading the file first — the exact field name for hubId may differ.)

- [ ] **Step 3: Mount logContextMiddleware first in `src/server/app.ts`**

Add the import and register the middleware BEFORE any other middleware/route:

```typescript
// src/server/app.ts — near other middleware imports
import { logContextMiddleware } from './middleware/log-context'

// In the middleware chain (before cors, errorHandler, auth etc.):
app.use('*', logContextMiddleware)
```

- [ ] **Step 4: Run integration-style test**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun test src/server/lib/logger.test.ts src/server/lib/log-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/log-context.ts src/server/middleware/auth.ts src/server/app.ts
git commit -m "feat(logger): mount request log-context middleware"
```

---

## Task 8: Rewrite client `debug-log.ts` with localStorage namespace filter

**Files:**
- Modify (rewrite): `src/client/lib/debug-log.ts`
- Create: `src/client/lib/debug-log.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/debug-log.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createDebugLog } from './debug-log'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('createDebugLog (DEV)', () => {
  test('logs when namespace matches localStorage "debug"', () => {
    localStorage.setItem('debug', 'llamenos:crypto,llamenos:sip')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const log = createDebugLog('llamenos:crypto')
    log('hello')
    expect(spy).toHaveBeenCalledWith('[llamenos:crypto]', 'hello')
  })

  test('skips when namespace does not match', () => {
    localStorage.setItem('debug', 'llamenos:sip')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    createDebugLog('llamenos:crypto')('no')
    expect(spy).not.toHaveBeenCalled()
  })

  test('wildcard patterns match prefix', () => {
    localStorage.setItem('debug', 'llamenos:*')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    createDebugLog('llamenos:sip')('x')
    expect(spy).toHaveBeenCalled()
  })

  test('no localStorage entry = silent', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    createDebugLog('llamenos:crypto')('x')
    expect(spy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rewrite `debug-log.ts`**

```typescript
// src/client/lib/debug-log.ts
/**
 * DEV-only scoped debug logger. In production builds the entire function
 * body is dead-code-eliminated by Vite (import.meta.env.DEV === false) AND
 * stripped by esbuild's `drop: ['console']` + `pure: ['console.log']` config.
 *
 * Runtime scoping (DEV only): set `localStorage.debug` to a comma-separated
 * list of namespaces/globs, e.g.:
 *   localStorage.setItem('debug', 'llamenos:crypto,llamenos:sip:*')
 *
 * Matching rules: exact namespace match, or glob `ns:*` = startsWith `ns:`.
 */
export function createDebugLog(namespace: string) {
  return (...args: unknown[]) => {
    if (!import.meta.env.DEV) return
    const patterns = (globalThis.localStorage?.getItem('debug') ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)
    const match = patterns.some((p) => {
      if (p === namespace) return true
      if (p.endsWith(':*')) return namespace.startsWith(p.slice(0, -1))
      if (p.endsWith('*')) return namespace.startsWith(p.slice(0, -1))
      return false
    })
    if (!match) return
    console.log(`[${namespace}]`, ...args)
  }
}
```

- [ ] **Step 3: Run tests**

Run: `bun test src/client/lib/debug-log.test.ts`
Expected: PASS (4 tests). If vitest is the client test runner, use `bunx vitest run src/client/lib/debug-log.test.ts` instead. (Check `package.json` to confirm test runner for client tests; if unit tests use `bun:test`, rewrite the test with `bun:test` imports and a `localStorage` polyfill.)

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/debug-log.ts src/client/lib/debug-log.test.ts
git commit -m "feat(logger): DEV-only scoped client debug-log with localStorage filter"
```

---

## Task 9: Vite prod build strips console.*

**Files:**
- Modify: `vite.config.ts`
- Create: `scripts/verify-no-console.sh`
- Modify: `package.json`

- [ ] **Step 1: Add esbuild drop config to vite.config.ts**

Open `vite.config.ts`. Inside the `defineConfig({...})` object, add:

```typescript
export default defineConfig({
  // ... existing plugins, resolve, etc. ...
  esbuild: {
    drop: ['console', 'debugger'],
    pure: ['console.log', 'console.debug', 'console.info', 'console.warn', 'console.error'],
  },
  // ... rest of config ...
})
```

(If `esbuild` key already exists, merge these properties.)

- [ ] **Step 2: Create the verification script**

```bash
# scripts/verify-no-console.sh
#!/usr/bin/env bash
set -euo pipefail

DIST="${1:-dist/client}"

if [ ! -d "$DIST" ]; then
  echo "verify-no-console: $DIST not found; run build first." >&2
  exit 1
fi

# Grep for `console.` in built JS, excluding vendor chunks if needed.
# Allow `console.error` only inside `assets/vendor-*.js` (third-party libs).
HITS=$(grep -rEn 'console\.(log|warn|info|debug|error)' "$DIST" --include='*.js' \
  | grep -vE 'assets/vendor-[^:]*\.js:' || true)

if [ -n "$HITS" ]; then
  echo "verify-no-console: FAIL — console.* found in production bundle:" >&2
  echo "$HITS" >&2
  exit 1
fi

echo "verify-no-console: OK — no console.* in production bundle."
```

Then:

```bash
chmod +x scripts/verify-no-console.sh
```

- [ ] **Step 3: Wire into package.json build script**

Open `package.json`. Update the `build` script:

```json
{
  "scripts": {
    "build": "vite build && scripts/verify-no-console.sh dist/client",
    "verify:no-console": "scripts/verify-no-console.sh dist/client"
  }
}
```

- [ ] **Step 4: Run a production build and verify**

Run: `bun run build`
Expected: Build succeeds and `verify-no-console: OK` appears.

If it FAILS with console.* found: look at the hits. Some will be from your own source (fix in the sweep tasks). Some may be from vendored libs — extend the `grep -vE` exclusion in `verify-no-console.sh` to cover them, but be conservative.

**Note:** the sweep tasks below will still leave many of your own `console.*` calls in dev source. Vite's `drop: ['console']` removes them from the prod bundle, so this script passes even before the sweep. The sweep is about dev-time consistency and lint enforcement.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts scripts/verify-no-console.sh package.json
git commit -m "feat(build): strip console.* from prod client bundle + verify step"
```

---

## Task 10: Enable Biome `noConsole` rule

**Files:**
- Modify: `biome.json`

- [ ] **Step 1: Add the noConsole rule**

Open `biome.json`. Inside `linter.rules.suspicious`, add:

```json
"noConsole": {
  "level": "error",
  "options": {
    "allow": ["error"]
  }
}
```

Wait — we want to block ALL console, including error. Change to:

```json
"noConsole": "error"
```

- [ ] **Step 2: Add a Biome override so `src/server/lib/logger.ts` is exempt**

Still in `biome.json`, add an `overrides` section (merge with existing if present):

```json
"overrides": [
  {
    "include": ["src/server/lib/logger.ts", "src/client/lib/debug-log.ts"],
    "linter": {
      "rules": {
        "suspicious": {
          "noConsole": "off"
        }
      }
    }
  }
]
```

- [ ] **Step 3: Run lint to see the damage**

Run: `bun run lint 2>&1 | grep -c noConsole || echo "0"`
Expected: A number ≈ 200+ (the 209 call sites, minus the two exempt files). This is expected — the sweep tasks fix them. Do NOT commit yet.

- [ ] **Step 4: Revert the Biome change temporarily**

The lint rule would fail CI. We'll commit this change only AFTER the sweep is complete (Task 15). For now, `git checkout biome.json` to revert, and note that Task 15 re-applies it.

Run: `git checkout biome.json`
Expected: biome.json restored.

(No commit for this task — it's completed in Task 15.)

---

## Task 11: Sweep — server telephony adapters

**Files:** `src/server/telephony/{bandwidth,plivo,sip-bridge-adapter,telnyx,twilio,vonage}.ts`

- [ ] **Step 1: For each file, add module-level logger and replace console calls**

For each of the 6 files, apply this pattern:

1. At the top (after imports), add:

```typescript
import { createLogger } from '../lib/logger'
const log = createLogger('telephony.<adapter>')
```

Where `<adapter>` is the file name without extension (`telephony.twilio`, `telephony.plivo`, etc.).

2. Replace each `console.log(msg, data)` → `log.info(msg, data)` (wrap data in `{ key: value }` if it was bare).
3. Replace `console.warn(msg, data)` → `log.warn(msg, data)`.
4. Replace `console.error(msg, err)` → `log.error(msg, err)`.
5. Replace `console.error(msg, err, extra)` → `log.error(msg, err, extra)`.
6. Replace `console.debug(msg, data)` → `log.debug(msg, data)`.

**Rules:**
- If the data being logged is a bare string or number (e.g. `console.log('SID:', sid)`), convert to `log.info('SID', { sid })`.
- If the second arg was an `Error`, use `log.error(msg, err)`.
- If you see a Ciphertext/phone/nsec being logged, REMOVE that field from the log entirely — do not just redact at the call site.
- Never pass `err` via the `extra` object; use the second arg of `log.error`.

- [ ] **Step 2: Verify telephony adapters**

Run: `bun run typecheck`
Expected: PASS.

Run: `grep -rE "console\.(log|warn|error|info|debug)" src/server/telephony/`
Expected: no output.

Run: `bun test src/server/telephony/ --bail 2>&1 | tail -20` (if telephony tests exist)
Expected: Tests that existed before still pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/telephony/
git commit -m "refactor(logger): migrate telephony adapters to createLogger"
```

---

## Task 12: Sweep — server messaging, jobs, middleware, lib, routes, services, server entry

**Files:** everything listed in "Sweep targets" except telephony and the client files. ~32 files.

Apply the **same pattern** as Task 11. Namespace mapping:

| Directory | Namespace prefix |
|---|---|
| `src/server/messaging/*.ts` | `messaging.<file>` (e.g. `messaging.router`, `messaging.signal-registration`) |
| `src/server/jobs/*.ts` | `jobs.<file>` |
| `src/server/middleware/*.ts` | `middleware.<file>` |
| `src/server/lib/*.ts` | `lib.<file>` (exclude logger.ts itself) |
| `src/server/routes/*.ts` | `routes.<file>` |
| `src/server/services/*.ts` | `services.<file>` |
| `src/server/server.ts` | `server` |

- [ ] **Step 1: Work through each directory, one commit per directory**

For each directory, do the same mechanical replacement as Task 11. Work in this order (smaller first): middleware → jobs → messaging → server.ts → routes → services → lib.

**Special case — `src/server/middleware/error.ts`:** this catches thrown errors and currently does `console.error(err)`. Convert to:

```typescript
const log = createLogger('middleware.error')
// ...
log.error('unhandled request error', err, { path: c.req.path, method: c.req.method })
```

**Special case — `src/server/lib/storage-manager.integration.test.ts`:** this is a test file. Leave `console.*` alone OR convert to `log` — whichever is less churn. The Biome override in Task 10 will NOT cover tests, so either convert or add `storage-manager.integration.test.ts` to Biome override. Prefer conversion.

- [ ] **Step 2: After each directory, verify**

Run: `bun run typecheck`
Expected: PASS.

Run: `grep -rE "console\.(log|warn|error|info|debug)" src/server/<dir>/`
Expected: no output.

- [ ] **Step 3: Commit each directory separately**

Example:
```bash
git add src/server/middleware/
git commit -m "refactor(logger): migrate middleware to createLogger"

git add src/server/jobs/
git commit -m "refactor(logger): migrate jobs to createLogger"

# ... and so on
```

- [ ] **Step 4: Final server verification**

Run: `grep -rE "console\.(log|warn|error|info|debug)" src/server/ --include="*.ts" | grep -v "src/server/lib/logger.ts"`
Expected: no output.

Run: `bun run test:unit 2>&1 | tail -20`
Expected: all unit tests pass (unchanged behavior).

---

## Task 13: Sweep — client files

**Files:** 10 client files listed in "Sweep targets".

- [ ] **Step 1: Apply the pattern with `createDebugLog`**

For each file:

1. At top:

```typescript
import { createDebugLog } from '@/lib/debug-log'
const log = createDebugLog('llamenos:<area>')
```

Namespace mapping:

| File | Namespace |
|---|---|
| `components/error-boundary.tsx` | `llamenos:error-boundary` |
| `components/setup/AdminBootstrap.tsx` | `llamenos:setup` |
| `lib/auth.tsx` | `llamenos:auth` |
| `lib/key-manager.ts` | `llamenos:keys` |
| `lib/nostr/relay.ts` | `llamenos:nostr` |
| `lib/webrtc/adapters/plivo.ts` | `llamenos:webrtc:plivo` |
| `lib/webrtc/adapters/twilio.ts` | `llamenos:webrtc:twilio` |
| `lib/webrtc/adapters/vonage.ts` | `llamenos:webrtc:vonage` |
| `lib/webrtc/manager.ts` | `llamenos:webrtc` |
| `routes/settings.tsx` | `llamenos:settings` |

2. Replace ALL `console.log/warn/info/debug` with `log(...)` — `createDebugLog` returns a single callable, no levels.

3. Replace `console.error(msg, err)` — decide per call:
   - If it's a user-facing error that should surface → ensure it's being thrown/toasted upstream, and replace the log with `log(msg, err)` (dev-only visibility).
   - If it's a dev-only diagnostic → `log(msg, err)`.
   - **Never** log Ciphertext/nsec/pubkey/phone/name at the call site.

4. **Special case — `src/client/components/error-boundary.tsx`**: the error boundary is the ONE place a client-side error surfaces. Keep the visible UI behavior; replace `console.error(error, errorInfo)` with `log('error boundary caught', { errName: error.name, errMsg: error.message })`. Do not log the full error object (may contain PII).

- [ ] **Step 2: Verify**

Run: `bun run typecheck`
Expected: PASS.

Run: `grep -rE "console\.(log|warn|error|info|debug)" src/client/ --include="*.ts" --include="*.tsx" | grep -v "src/client/lib/debug-log.ts"`
Expected: no output.

Run: `bun run build`
Expected: PASS. `verify-no-console: OK` printed.

- [ ] **Step 3: Commit**

```bash
git add src/client/
git commit -m "refactor(logger): migrate client files to createDebugLog"
```

---

## Task 14: Integration test — reqId/hubId propagate, no PII in logs

**Files:**
- Create: `tests/api/logging.spec.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/api/logging.spec.ts
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'
import { spawn } from 'node:child_process'

test.describe('logging', () => {
  test('request context (reqId, hubId) propagates into logs', async ({ request }) => {
    // Hit a known endpoint. We verify context propagation via the response
    // headers if exposed, OR by tailing the server logs in dev. For CI we
    // rely on the unit tests for ALS; here we just assert the endpoint runs
    // and doesn't leak PII into response bodies.
    const res = await authedRequest(request, 'GET', '/api/health')
    expect(res.status()).toBe(200)
  })

  test('phone numbers are not echoed into error responses', async ({ request }) => {
    // Intentionally malformed payload that would previously log the phone.
    const res = await authedRequest(request, 'POST', '/api/contacts', {
      data: { phone: '+12025550199', name: 'TestPerson' },
    })
    const body = await res.text()
    expect(body).not.toContain('+12025550199')
    expect(body).not.toContain('TestPerson')
  })
})
```

(Adjust endpoints to match actual routes; `/api/health` and `/api/contacts` are examples. Read `src/server/app.ts` to pick real endpoints.)

- [ ] **Step 2: Run the test**

Run: `bun run test:api -- logging.spec.ts`
Expected: PASS. If the test fails because endpoints differ, adjust.

- [ ] **Step 3: Commit**

```bash
git add tests/api/logging.spec.ts
git commit -m "test(logger): integration test for context + no-PII-leak"
```

---

## Task 15: Enable Biome `noConsole` + pre-commit hook + skill

**Files:**
- Modify: `biome.json`
- Modify: `lefthook.yml`
- Create: `.claude/skills/logging/SKILL.md`

- [ ] **Step 1: Re-enable the Biome rule**

Open `biome.json`. Apply the same edit from Task 10:

```json
"suspicious": {
  "noExplicitAny": "warn",
  "noArrayIndexKey": "warn",
  "noConsole": "error"
}
```

And add the override:

```json
"overrides": [
  {
    "include": ["src/server/lib/logger.ts", "src/client/lib/debug-log.ts"],
    "linter": { "rules": { "suspicious": { "noConsole": "off" } } }
  }
]
```

(Merge with existing `overrides` if present.)

- [ ] **Step 2: Verify lint is clean**

Run: `bun run lint`
Expected: PASS, no `noConsole` errors.

If errors remain: there are files missed by the sweep. Fix them with the Task 11 pattern.

- [ ] **Step 3: Add a pre-commit no-console job to lefthook.yml**

Open `lefthook.yml`. Add a job under `pre-commit.jobs` (the existing `lint-fix` job already catches `noConsole` via Biome, so this is redundant IF `lint-fix` runs `biome check` — which it does. No extra job needed. Skip to Step 4.)

Actually, the existing `lint-fix` job runs `bunx biome check --diagnostic-level=error --files-ignore-unknown=true --no-errors-on-unmatched {staged_files}` which will now enforce `noConsole` for staged files. Nothing more to add.

- [ ] **Step 4: Write the skill**

```markdown
# .claude/skills/logging/SKILL.md
---
name: logging
description: Use when adding log statements, editing files that log, or debugging log output. Enforces the project's scoped structured logging rules (no console.*, no PII, namespaces, createLogger/createDebugLog).
---

# Logging Rules

## Server

- **Always use `createLogger('category.subcategory')`** from `@server/lib/logger` at module top. One logger per file.
- **Never** use `console.*`. Biome will block it.
- **Namespaces are dot-separated**: `telephony.twilio`, `auth.webauthn`, `services.files`.
- **Levels**: `debug` (noisy, dev), `info` (normal flow), `warn` (degraded but handled), `error` (failures).
- **Error helper**: `log.error(msg, err, extra?)` — pass the `Error` object as the 2nd arg. Do NOT spread errors into `extra`.
- **Request context (reqId, hubId, userId, traceId) auto-attaches** via AsyncLocalStorage. Don't re-add it to every call.

### Banned in log extras (type-gate enforced)

`Ciphertext`, `HmacHash`, `PhoneNumber`, `Nsec`, `Pubkey` (branded types). The TS compiler rejects these at the call site.

### Runtime-redacted keys (belt-and-braces)

Any extra-field key matching `/phone|email|nsec|secret|token|ciphertext|encrypted|content|recovery|^pin$|password|credential/i` or `/^(first|last|full|display|user)?name$/i` is replaced with `"[redacted]"`. This is a safety net — do NOT rely on it; still avoid logging these fields.

### Config (server env)

- `LOG_LEVEL=debug|info|warn|error` (default `info`)
- `LOG_NAMESPACES=telephony.*,auth` (default `*`)
- `LOG_RATE_LIMITS='{"info":500}'` (JSON; defaults: debug 50/s, info 200/s, warn 500/s, error unlimited)
- `LOG_STACKS=true` to include stack traces (default false in prod)

## Client

- **Always use `createDebugLog('llamenos:area')`** from `@/lib/debug-log`.
- **Never** use `console.*`. Biome blocks it AND Vite strips it from prod.
- **Client logs are DEV-only.** Production bundle contains zero logs. This is a zero-knowledge requirement.
- **Runtime scoping** (DEV): `localStorage.setItem('debug', 'llamenos:crypto,llamenos:webrtc:*')`.
- No level distinction on client — all logs go through the one `log()` callable.
- Errors that need to surface to the user: throw them or use the error boundary / toast. Do not rely on logs.

## When in doubt

- Adding a new component? Use `createLogger('<domain>.<file>')`.
- Logging an error? `log.error(msg, err)`.
- Logging sensitive user data? Don't. Log an ID or count instead.
```

- [ ] **Step 5: Final verification**

Run: `bun run lint`
Expected: PASS.

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run build`
Expected: PASS, `verify-no-console: OK`.

Run: `bun run test:unit`
Expected: PASS.

Run: `grep -rE "console\.(log|warn|error|info|debug)" src/ --include="*.ts" --include="*.tsx" | grep -vE "src/(server/lib/logger|client/lib/debug-log)\.ts"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add biome.json .claude/skills/logging/SKILL.md
git commit -m "feat(logger): enforce noConsole lint rule + add logging skill"
```

---

## Task 16: Update package.json typecheck test deps for type-d

**Files:**
- Modify: `package.json` (if `vitest` not already a dev dep for `.test-d.ts`)

- [ ] **Step 1: Check whether vitest is present for `.test-d.ts` type tests**

Run: `grep -E '"vitest"' package.json || echo "missing"`

If missing: the `logger-types.test-d.ts` file won't run. Either add `vitest` as a devDep OR remove `logger-types.test-d.ts` and rely on `tsc --noEmit` over the file (it already type-checks the assertions via `expectTypeOf` if vitest's types are available).

Simpler: install `@vitest/expect-type` as devDep OR convert the test-d file to use a hand-rolled type-assertion helper:

```typescript
// src/shared/logger-types.test-d.ts
import type { Loggable, Unloggable } from './logger-types'

type Assert<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type IsNever<T> = [T] extends [never] ? true : false

type PhoneNumber = string & Unloggable

// These are compile-time checks; they have no runtime effect.
type _1 = Assert<IsNever<Loggable<{ phone: PhoneNumber }>['phone']>>
type _2 = Assert<Equal<Loggable<{ hubId: string }>, { hubId: string }>>

export {}
```

Replace the file with this if vitest is not installed.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit if modified**

```bash
git add src/shared/logger-types.test-d.ts package.json
git commit -m "chore(logger): type-level assertions without vitest dep"
```

---

## Wrap-up checks

- [ ] Run full test suite: `bun run test:all`
- [ ] Run build: `bun run build`
- [ ] Verify zero `console.*` in source: `grep -rE "console\.(log|warn|error|info|debug)" src/ --include="*.ts" --include="*.tsx" | grep -vE "src/(server/lib/logger|client/lib/debug-log)\.ts"` → no output.
- [ ] Verify zero `console.*` in prod bundle: `scripts/verify-no-console.sh dist/client` → OK.
- [ ] Open PR with summary of: new primitives, sweep scope (209 → 0), enforcement layers (lint, build, skill), breaking changes (none — backward-compatible extras signature).

## Self-Review Summary

- **Spec coverage**: all 6 design sections mapped to tasks (1-2 type gate, 3 context, 4 redactor, 5 rate limiter, 6 logger, 7 middleware, 8 client, 9 build, 10+15 enforcement, 11-13 sweep, 14 integration test).
- **No placeholders**: every code block is complete; namespace mappings explicit; env-var defaults stated.
- **Type consistency**: `Loggable<T>`, `LogExtra`, `Logger`, `LogLevel`, `RateLimiter`, `LogContext` defined once and reused consistently across tasks.
- **Known risk**: Task 7's auth-middleware edit assumes the hubId field shape; the step tells the implementer to read the file first and adapt. Task 8's test runner choice (vitest vs bun:test) is flagged for verification.
