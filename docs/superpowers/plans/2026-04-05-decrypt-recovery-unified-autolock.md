# Decrypt Recovery & Unified Auto-Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix silent decryption failures that leave users stuck on `[encrypted]` placeholders with no PIN prompt, and unify the two separate lock timers into a single configurable "auto-lock after inactivity" setting.

**Architecture:** When decryption fails in `decrypt-fields.ts`, retry once, then probe the worker's lock state. If the worker is locked or broken, fire `keyManager.lock()` which triggers the existing PIN-prompt chain. Replace the dual-timer system (hardcoded 5-min idle + configurable 30s tab-hide) with a single user-configurable inactivity timer defaulting to 15 minutes.

**Tech Stack:** TypeScript, Web Workers, React, TanStack Query, Drizzle ORM, PostgreSQL, Hono

**Spec:** `docs/superpowers/specs/2026-04-05-decrypt-recovery-unified-autolock-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/client/lib/crypto-worker-client.ts` | Modify | Add `CryptoWorkerLockedError`, `reinitialize()` method |
| `src/client/lib/decrypt-fields.ts` | Modify | Replace silent catch with retry → probe → lock recovery |
| `src/client/lib/key-manager.ts` | Modify | Unify timers into single `autoLockMs`, rename API |
| `src/shared/schemas/security-prefs.ts` | Modify | Rename `lockDelayMs` → `autoLockMs`, new default/range |
| `src/server/db/schema/security-prefs.ts` | Modify | Rename column `lock_delay_ms` → `auto_lock_ms` |
| `drizzle/migrations/0048_user_security_prefs.sql` | Modify | Rename column in CREATE TABLE (pre-production) |
| `src/server/services/security-prefs.ts` | Modify | Update DEFAULTS key |
| `src/server/routes/auth-facade.ts` | Modify | Update GET/PATCH response field names |
| `src/client/components/user-sections/idle-lock-section.tsx` | Modify | New label, range 1-60 min, field `autoLockMs` |
| `tests/api/security-prefs.spec.ts` | Modify | Update field name + default value assertions |
| `src/client/lib/crypto-worker-client.test.ts` | Create | Unit tests for retry, error classification, reinitialize |
| `src/client/lib/decrypt-fields.test.ts` | Create | Unit tests for recovery flow |

---

### Task 1: Add `CryptoWorkerLockedError` and `reinitialize()` to crypto-worker-client

**Files:**
- Modify: `src/client/lib/crypto-worker-client.ts`
- Create: `src/client/lib/crypto-worker-client.test.ts`

- [ ] **Step 1: Write failing tests for error classification and reinitialize**

```typescript
// src/client/lib/crypto-worker-client.test.ts
import { describe, expect, test } from 'bun:test'
import { CryptoWorkerLockedError, isWorkerLockedError } from './crypto-worker-client'

describe('CryptoWorkerLockedError', () => {
  test('isWorkerLockedError matches "Not unlocked" error', () => {
    expect(isWorkerLockedError(new Error('Not unlocked'))).toBe(true)
  })

  test('isWorkerLockedError matches "Worker is locked" error', () => {
    expect(isWorkerLockedError(new Error('Worker is locked'))).toBe(true)
  })

  test('isWorkerLockedError matches rate limit auto-lock error', () => {
    expect(isWorkerLockedError(new Error('Rate limit exceeded — worker auto-locked'))).toBe(true)
  })

  test('isWorkerLockedError returns false for timeout error', () => {
    expect(isWorkerLockedError(new Error('Crypto worker request timed out'))).toBe(false)
  })

  test('isWorkerLockedError returns false for generic error', () => {
    expect(isWorkerLockedError(new Error('Something else went wrong'))).toBe(false)
  })

  test('CryptoWorkerLockedError has correct name', () => {
    const err = new CryptoWorkerLockedError('Not unlocked')
    expect(err.name).toBe('CryptoWorkerLockedError')
    expect(err.message).toBe('Not unlocked')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/client/lib/crypto-worker-client.test.ts`
Expected: FAIL — `CryptoWorkerLockedError` and `isWorkerLockedError` not exported

- [ ] **Step 3: Implement CryptoWorkerLockedError, isWorkerLockedError, and reinitialize()**

In `src/client/lib/crypto-worker-client.ts`, add before the class:

```typescript
/** Error messages from the worker that indicate the key is no longer available. */
const LOCKED_ERROR_PATTERNS = [
  'Not unlocked',
  'Worker is locked',
  'Rate limit exceeded — worker auto-locked',
]

/** Distinguishes "worker has no key" from generic timeouts/crashes. */
export class CryptoWorkerLockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CryptoWorkerLockedError'
  }
}

/** Check if an error indicates the worker's key was zeroed/lost. */
export function isWorkerLockedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return LOCKED_ERROR_PATTERNS.some((p) => err.message.includes(p))
}
```

Then in the `CryptoWorkerClient` class, update the `worker.onmessage` handler to wrap locked errors:

```typescript
if (resp.type === 'error') {
  const err = isWorkerLockedError(new Error(resp.error))
    ? new CryptoWorkerLockedError(resp.error)
    : new Error(resp.error)
  pending.reject(err)
} else {
  pending.resolve(resp.result)
}
```

Add the `reinitialize()` method to the class:

```typescript
/**
 * Terminate the current worker and create a fresh one.
 * Used when the worker is in a broken state (responding but not functioning).
 */
reinitialize(): void {
  // Reject pending requests
  const error = new Error('Worker reinitialized')
  for (const [, pending] of this.pending) {
    clearTimeout(pending.timeoutId)
    pending.reject(error)
  }
  this.pending.clear()

  this.worker.terminate()
  this.worker = new Worker(new URL('./crypto-worker.ts', import.meta.url), {
    type: 'module',
  })
  this.worker.onmessage = this.handleMessage.bind(this)
  this.worker.onerror = this.handleError.bind(this)
}
```

To make `reinitialize()` work, extract the `onmessage` and `onerror` handlers into named methods `handleMessage` and `handleError`, and call them from both the constructor and `reinitialize()`:

```typescript
private handleMessage(event: MessageEvent<WorkerResponse>): void {
  const resp = event.data
  const pending = this.pending.get(resp.id)
  if (!pending) return

  this.pending.delete(resp.id)
  clearTimeout(pending.timeoutId)

  if (resp.type === 'error') {
    const err = isWorkerLockedError(new Error(resp.error))
      ? new CryptoWorkerLockedError(resp.error)
      : new Error(resp.error)
    pending.reject(err)
  } else {
    pending.resolve(resp.result)
  }
}

private handleError(event: ErrorEvent): void {
  const error = new Error(`Worker error: ${event.message}`)
  for (const [id, pending] of this.pending) {
    clearTimeout(pending.timeoutId)
    pending.reject(error)
    this.pending.delete(id)
  }
}
```

Update the constructor to use them:

```typescript
constructor() {
  this.worker = new Worker(new URL('./crypto-worker.ts', import.meta.url), {
    type: 'module',
  })
  this.worker.onmessage = this.handleMessage.bind(this)
  this.worker.onerror = this.handleError.bind(this)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/client/lib/crypto-worker-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/crypto-worker-client.ts src/client/lib/crypto-worker-client.test.ts
git commit -m "feat(crypto): add CryptoWorkerLockedError + reinitialize() to worker client"
```

---

### Task 2: Add decrypt recovery flow to decrypt-fields

**Files:**
- Modify: `src/client/lib/decrypt-fields.ts`
- Create: `src/client/lib/decrypt-fields.test.ts`

- [ ] **Step 1: Write failing tests for retry → probe → lock flow**

```typescript
// src/client/lib/decrypt-fields.test.ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { CryptoWorkerLockedError } from './crypto-worker-client'

// We need to mock the crypto-worker-client module and key-manager module
// before importing decrypt-fields
const mockDecryptEnvelopeField = mock<(
  encryptedHex: string,
  ephemeralPubkeyHex: string,
  wrappedKeyHex: string,
  label: string
) => Promise<string>>()
const mockIsUnlocked = mock<() => Promise<boolean>>()
const mockReinitialize = mock<() => void>()
const mockLock = mock<() => Promise<void>>()

// Track if lock was called
let lockCallCount = 0

mock.module('./crypto-worker-client', () => ({
  cryptoWorker: {
    decryptEnvelopeField: mockDecryptEnvelopeField,
    isUnlocked: mockIsUnlocked,
    reinitialize: mockReinitialize,
  },
  CryptoWorkerLockedError,
  isWorkerLockedError: (err: unknown) =>
    err instanceof CryptoWorkerLockedError,
}))

mock.module('./key-manager', () => ({
  lock: () => {
    lockCallCount++
    return mockLock()
  },
}))

// Import AFTER mocking
const { DecryptCache, decryptObjectFields, resetDecryptRecoveryState } = await import('./decrypt-fields')

describe('decrypt recovery', () => {
  beforeEach(() => {
    lockCallCount = 0
    mockDecryptEnvelopeField.mockReset()
    mockIsUnlocked.mockReset()
    mockReinitialize.mockReset()
    mockLock.mockResolvedValue(undefined)
    resetDecryptRecoveryState()
  })

  test('successful decrypt does not trigger lock', async () => {
    mockDecryptEnvelopeField.mockResolvedValue('Alice')
    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(obj.name).toBe('Alice')
    expect(lockCallCount).toBe(0)
  })

  test('retries once on timeout then locks when worker reports locked', async () => {
    mockDecryptEnvelopeField
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
    mockIsUnlocked.mockResolvedValue(false)

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(obj.name).toBe('[encrypted]')
    expect(lockCallCount).toBe(1)
  })

  test('retries once on timeout and succeeds on retry', async () => {
    mockDecryptEnvelopeField
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
      .mockResolvedValueOnce('Alice')

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(obj.name).toBe('Alice')
    expect(lockCallCount).toBe(0)
  })

  test('CryptoWorkerLockedError triggers lock immediately without retry', async () => {
    mockDecryptEnvelopeField.mockRejectedValue(
      new CryptoWorkerLockedError('Not unlocked')
    )

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(obj.name).toBe('[encrypted]')
    expect(lockCallCount).toBe(1)
  })

  test('worker unlocked but broken triggers reinitialize + lock', async () => {
    mockDecryptEnvelopeField
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
    mockIsUnlocked.mockResolvedValue(true) // unlocked but still failing

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(mockReinitialize).toHaveBeenCalledTimes(1)
    expect(lockCallCount).toBe(1)
  })

  test('lock fires only once for multiple concurrent decrypt failures', async () => {
    mockDecryptEnvelopeField.mockRejectedValue(
      new CryptoWorkerLockedError('Not unlocked')
    )

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      encryptedPhone: 'deadbeef',
      phoneEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: '1122', wrappedKey: '3344' }],
      name: '[encrypted]',
      phone: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(lockCallCount).toBe(1)
  })
})

describe('DecryptCache', () => {
  test('get returns null for missing entry', () => {
    const cache = new DecryptCache()
    expect(cache.get('foo', 'bar')).toBeNull()
  })

  test('set and get round-trips', () => {
    const cache = new DecryptCache()
    cache.set('ct', 'label', 'plaintext')
    expect(cache.get('ct', 'label')).toBe('plaintext')
  })

  test('clear empties the cache', () => {
    const cache = new DecryptCache()
    cache.set('ct', 'label', 'plaintext')
    cache.clear()
    expect(cache.get('ct', 'label')).toBeNull()
    expect(cache.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/client/lib/decrypt-fields.test.ts`
Expected: FAIL — `resetDecryptRecoveryState` not exported, recovery logic not implemented

- [ ] **Step 3: Implement decrypt recovery flow**

Replace the `decryptObjectFields` function in `src/client/lib/decrypt-fields.ts`:

```typescript
import { LABEL_USER_PII } from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import { CryptoWorkerLockedError, cryptoWorker, isWorkerLockedError } from './crypto-worker-client'
import * as keyManager from './key-manager'

// ... (DecryptCache and resolveEncryptedFields unchanged) ...

// ---------------------------------------------------------------------------
// Decrypt recovery state
// ---------------------------------------------------------------------------

/** Prevents multiple concurrent decrypt failures from each firing lock. */
let lockFiring = false

/** Reset recovery state — exposed for testing. */
export function resetDecryptRecoveryState(): void {
  lockFiring = false
}

/**
 * Fire keyManager.lock() exactly once per failure batch.
 * Concurrent callers that arrive while the first lock is in-flight are no-ops.
 */
async function fireLockOnce(): Promise<void> {
  if (lockFiring) return
  lockFiring = true
  try {
    await keyManager.lock()
  } finally {
    lockFiring = false
  }
}

/**
 * Attempt to decrypt a single field with retry and recovery.
 *
 * 1. Try decrypt
 * 2. On CryptoWorkerLockedError → fire lock immediately (no retry — key is gone)
 * 3. On timeout/other error → retry once
 * 4. On second failure → probe worker state:
 *    - Worker locked → fire lock (PIN prompt)
 *    - Worker unlocked but broken → reinitialize worker + fire lock
 */
async function decryptFieldWithRecovery(
  ciphertext: string,
  envelope: RecipientEnvelope,
  label: string,
): Promise<string | null> {
  const worker = cryptoWorker

  // First attempt
  try {
    return await worker.decryptEnvelopeField(
      ciphertext,
      envelope.ephemeralPubkey,
      envelope.wrappedKey,
      label,
    )
  } catch (firstErr) {
    // Known locked — no point retrying
    if (firstErr instanceof CryptoWorkerLockedError) {
      await fireLockOnce()
      return null
    }

    // Transient error — retry once
    try {
      return await worker.decryptEnvelopeField(
        ciphertext,
        envelope.ephemeralPubkey,
        envelope.wrappedKey,
        label,
      )
    } catch {
      // Both attempts failed — probe worker state
      try {
        const unlocked = await worker.isUnlocked()
        if (unlocked) {
          // Worker claims unlocked but can't decrypt — broken state
          worker.reinitialize()
        }
      } catch {
        // isUnlocked itself failed — worker is definitely broken
        worker.reinitialize()
      }
      await fireLockOnce()
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// decryptObjectFields
// ---------------------------------------------------------------------------

export async function decryptObjectFields<T extends Record<string, unknown>>(
  obj: T,
  readerPubkey: string,
  label: string = LABEL_USER_PII,
): Promise<T> {
  const refs = resolveEncryptedFields(obj, readerPubkey)
  if (refs.length === 0) return obj

  await Promise.all(
    refs.map(async ({ plaintextKey, ciphertext, envelope }) => {
      // Check cache first
      const cached = decryptCache.get(ciphertext, label)
      if (cached !== null) {
        ;(obj as Record<string, unknown>)[plaintextKey] = cached
        return
      }

      const plaintext = await decryptFieldWithRecovery(ciphertext, envelope, label)
      if (plaintext !== null) {
        decryptCache.set(ciphertext, label, plaintext)
        ;(obj as Record<string, unknown>)[plaintextKey] = plaintext
      }
      // If null, field keeps its server placeholder ("[encrypted]")
      // but lock has been fired — PIN prompt will appear
    }),
  )

  return obj
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/client/lib/decrypt-fields.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/decrypt-fields.ts src/client/lib/decrypt-fields.test.ts
git commit -m "feat(crypto): add retry + probe + lock recovery to decrypt-fields"
```

---

### Task 3: Unify auto-lock timers in key-manager

**Files:**
- Modify: `src/client/lib/key-manager.ts`

- [ ] **Step 1: Replace dual-timer system with single unified timer**

In `src/client/lib/key-manager.ts`, replace the auto-lock section (lines 35-106):

Remove:
- `IDLE_TIMEOUT_MS` constant (5 min hardcoded)
- `DEFAULT_LOCK_DELAY_MS` constant (30s)
- `LOCK_DELAY_KEY` constant
- `visibilityTimer` variable
- `getLockDelay()` private function
- `setLockDelay()` export
- `getLockDelayMs()` export
- The entire `visibilitychange` event listener

Replace with:

```typescript
// --- Unified auto-lock ---
let autoLockTimer: ReturnType<typeof setTimeout> | null = null
const lockCallbacks: Set<() => void> = new Set()
const unlockCallbacks: Set<() => void> = new Set()
let autoLockDisabled = false

const AUTO_LOCK_KEY = 'llamenos-auto-lock'
const DEFAULT_AUTO_LOCK_MS = 15 * 60 * 1000 // 15 minutes
const MIN_AUTO_LOCK_MS = 60_000 // 1 minute
const MAX_AUTO_LOCK_MS = 60 * 60 * 1000 // 60 minutes

function getAutoLock(): number {
  try {
    const stored = localStorage.getItem(AUTO_LOCK_KEY)
    if (stored) {
      const ms = Number.parseInt(stored, 10)
      if (ms >= MIN_AUTO_LOCK_MS && ms <= MAX_AUTO_LOCK_MS) return ms
    }
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_AUTO_LOCK_MS
}

/** Set the auto-lock timeout in milliseconds (1 min – 60 min). */
export function setAutoLockMs(ms: number): void {
  const clamped = Math.max(MIN_AUTO_LOCK_MS, Math.min(MAX_AUTO_LOCK_MS, ms))
  localStorage.setItem(AUTO_LOCK_KEY, String(clamped))
  // Reset timer with new value if currently unlocked
  resetAutoLockTimer()
}

/** Get the current auto-lock timeout in milliseconds. */
export function getAutoLockMs(): number {
  return getAutoLock()
}

function resetAutoLockTimer(): void {
  if (autoLockDisabled) return
  if (autoLockTimer) clearTimeout(autoLockTimer)
  autoLockTimer = setTimeout(() => {
    void lock()
  }, getAutoLock())
}

function notifyCallbacks(callbacks: Set<() => void>) {
  callbacks.forEach((cb) => cb())
}

// Activity listeners — reset the single timer on user interaction
if (typeof document !== 'undefined') {
  const resetOnActivity = () => resetAutoLockTimer()
  document.addEventListener('click', resetOnActivity, { passive: true })
  document.addEventListener('keydown', resetOnActivity, { passive: true })
  document.addEventListener('touchstart', resetOnActivity, { passive: true })

  // Tab becoming visible counts as activity (resets timer)
  // Tab becoming hidden is NOT a lock trigger — just absence of activity
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resetAutoLockTimer()
  })
}
```

Update the `lock()` function — remove `visibilityTimer` references:

```typescript
export async function lock(): Promise<void> {
  await cryptoWorker.lock()
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
  notifyCallbacks(lockCallbacks)
}
```

Update `disableAutoLock()` — remove `visibilityTimer` references:

```typescript
export function disableAutoLock() {
  autoLockDisabled = true
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
}
```

Update all calls to `resetAutoLockTimers()` → `resetAutoLockTimer()` (remove plural — there's now one timer). These are in `unlock()` (line 237) and `importKey()` (line 309).

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: May fail if `idle-lock-section.tsx` still imports `setLockDelay` — that's fixed in Task 5. Check for errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/key-manager.ts
git commit -m "feat(key-manager): unify idle + tab-hide into single auto-lock timer (15m default)"
```

---

### Task 4: Rename `lockDelayMs` → `autoLockMs` in backend

**Files:**
- Modify: `drizzle/migrations/0048_user_security_prefs.sql`
- Modify: `src/server/db/schema/security-prefs.ts`
- Modify: `src/shared/schemas/security-prefs.ts`
- Modify: `src/server/services/security-prefs.ts`
- Modify: `src/server/routes/auth-facade.ts`

- [ ] **Step 1: Update the migration SQL (pre-production, safe to modify)**

In `drizzle/migrations/0048_user_security_prefs.sql`, change:

```sql
lock_delay_ms INTEGER NOT NULL DEFAULT 30000,
```
to:
```sql
auto_lock_ms INTEGER NOT NULL DEFAULT 900000,
```

- [ ] **Step 2: Update Drizzle schema**

In `src/server/db/schema/security-prefs.ts`, change:

```typescript
lockDelayMs: integer('lock_delay_ms').notNull().default(30000),
```
to:
```typescript
autoLockMs: integer('auto_lock_ms').notNull().default(900000),
```

- [ ] **Step 3: Update Zod schema**

In `src/shared/schemas/security-prefs.ts`, change:

```typescript
lockDelayMs: z.number().int().min(0).max(600_000),
```
to:
```typescript
autoLockMs: z.number().int().min(60_000).max(3_600_000),
```

- [ ] **Step 4: Update service DEFAULTS**

In `src/server/services/security-prefs.ts`, change:

```typescript
lockDelayMs: 30000,
```
to:
```typescript
autoLockMs: 900000,
```

- [ ] **Step 5: Update auth-facade response fields**

In `src/server/routes/auth-facade.ts`, in both the GET `/security-prefs` handler (~line 1342) and PATCH `/security-prefs` handler (~line 1360), change:

```typescript
lockDelayMs: row.lockDelayMs,
```
to:
```typescript
autoLockMs: row.autoLockMs,
```

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: May show errors in `idle-lock-section.tsx` (fixed in Task 5) — backend should be clean.

- [ ] **Step 7: Commit**

```bash
git add drizzle/migrations/0048_user_security_prefs.sql src/server/db/schema/security-prefs.ts src/shared/schemas/security-prefs.ts src/server/services/security-prefs.ts src/server/routes/auth-facade.ts
git commit -m "refactor(backend): rename lockDelayMs → autoLockMs with 15-min default"
```

---

### Task 5: Update IdleLockSection UI component

**Files:**
- Modify: `src/client/components/user-sections/idle-lock-section.tsx`

- [ ] **Step 1: Update component to use unified auto-lock API**

Replace the entire file:

```typescript
import { SectionBody, SectionDescription } from '@/components/user-shell/section-layout'
import { setAutoLockMs } from '@/lib/key-manager'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Prefs {
  autoLockMs: number
}

const MIN_MS = 60_000 // 1 minute
const MAX_MS = 3_600_000 // 60 minutes
const STEP_MS = 60_000 // 1 minute
const DEFAULT_MS = 900_000 // 15 minutes

export function IdleLockSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: prefs } = useQuery<Prefs>({
    queryKey: ['security', 'prefs'],
    queryFn: async () => {
      const res = await fetch('/api/auth/security-prefs', { credentials: 'include' })
      if (!res.ok) return { autoLockMs: DEFAULT_MS }
      return res.json()
    },
  })
  const [draft, setDraft] = useState(DEFAULT_MS)

  useEffect(() => {
    if (prefs) setDraft(prefs.autoLockMs)
  }, [prefs])

  const update = useMutation({
    mutationFn: async (ms: number) => {
      const res = await fetch('/api/auth/security-prefs', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoLockMs: ms }),
      })
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security', 'prefs'] })
      setAutoLockMs(draft)
    },
  })

  const format = (ms: number) => {
    const min = Math.round(ms / 60_000)
    if (min === 1) return t('security.autoLock.oneMinute', '1 min')
    return `${min} min`
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">
        {t('security.autoLock.title', 'Auto-lock after inactivity')}
      </h3>
      <SectionBody data-testid="idle-lock-slider">
        <SectionDescription>
          {t(
            'security.autoLock.desc',
            'Lock the app after this long without activity. Applies whether the tab is visible or hidden.',
          )}
        </SectionDescription>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={MIN_MS}
            max={MAX_MS}
            step={STEP_MS}
            value={draft}
            onChange={(e) => setDraft(Number(e.target.value))}
            onMouseUp={(e) => update.mutate(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => update.mutate(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => update.mutate(Number((e.target as HTMLInputElement).value))}
            className="flex-1"
            data-testid="lock-slider"
          />
          <span className="text-sm w-16 text-right" data-testid="lock-value">
            {format(draft)}
          </span>
        </div>
      </SectionBody>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS — all `lockDelayMs`/`setLockDelay` references resolved

- [ ] **Step 3: Commit**

```bash
git add src/client/components/user-sections/idle-lock-section.tsx
git commit -m "feat(ui): update auto-lock slider to unified 1-60 min range"
```

---

### Task 6: Update API E2E tests

**Files:**
- Modify: `tests/api/security-prefs.spec.ts`

- [ ] **Step 1: Update field names and default assertions**

```typescript
// tests/api/security-prefs.spec.ts
import { expect, test } from '@playwright/test'
import { generateSecretKey } from 'nostr-tools/pure'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Security prefs API', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const res = await request.get('/api/health/live', { timeout: 5000 })
      if (!res.ok()) test.skip(true, 'Server not reachable')
    } catch {
      test.skip(true, 'Server not reachable')
    }
  })

  test('GET returns defaults on first access', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/security-prefs')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.autoLockMs).toBe(900000)
    expect(body.digestCadence).toBe('weekly')
    expect(body.disappearingTimerDays).toBe(1)
    expect(body.alertOnNewDevice).toBe(true)
    expect(body.alertOnPasskeyChange).toBe(true)
    expect(body.alertOnPinChange).toBe(true)
  })

  test('PATCH updates autoLockMs', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      autoLockMs: 300_000,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.autoLockMs).toBe(300_000)
  })

  test('PATCH updates cadence', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      digestCadence: 'off',
      disappearingTimerDays: 3,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.digestCadence).toBe('off')
    expect(body.disappearingTimerDays).toBe(3)
  })

  test('PATCH rejects invalid disappearingTimerDays', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      disappearingTimerDays: 99,
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH rejects autoLockMs below minimum', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      autoLockMs: 1000,
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH rejects autoLockMs above maximum', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      autoLockMs: 99_999_999,
    })
    expect(res.status()).toBe(400)
  })
})
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/api/security-prefs.spec.ts
git commit -m "test(api): update security-prefs tests for autoLockMs rename + validation"
```

---

### Task 7: Fix remaining references and verify build

**Files:**
- Potentially: any file still referencing `lockDelayMs`, `setLockDelay`, `getLockDelayMs`, `LOCK_DELAY_KEY`

- [ ] **Step 1: Search for stale references**

Run: `grep -r "lockDelayMs\|setLockDelay\|getLockDelayMs\|getLockDelay\|LOCK_DELAY_KEY\|lock_delay_ms\|IDLE_TIMEOUT_MS\|DEFAULT_LOCK_DELAY" src/ tests/ drizzle/ --include='*.ts' --include='*.tsx' --include='*.sql' -l`

Fix any remaining references in source code (ignore docs/plans — those are historical).

- [ ] **Step 2: Search for i18n keys that may reference old labels**

Run: `grep -r "security\.lock\." src/ --include='*.ts' --include='*.tsx' -l`

Update any remaining `security.lock.*` i18n keys to `security.autoLock.*` in source files.

- [ ] **Step 3: Run full typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 4: Run unit tests**

Run: `bun test src/client/lib/crypto-worker-client.test.ts src/client/lib/decrypt-fields.test.ts`
Expected: PASS

- [ ] **Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve remaining lockDelayMs references after rename"
```
