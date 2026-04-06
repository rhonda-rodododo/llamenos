# Decrypt Recovery & Unified Auto-Lock

**Date:** 2026-04-05
**Status:** Approved
**Branch base:** `feat/device-management` (PR #43)

## Problem

When the crypto worker times out (30s per-request timeout) or rate-limit auto-locks, decryption fails silently. `decrypt-fields.ts` swallows errors in a bare `catch {}`, leaving server-provided `[encrypted]` placeholders displayed in the UI. The `keyManager.onLock()` callback never fires because the key manager doesn't know the worker lost its key. Users see `[encrypted]` everywhere with no PIN prompt and no recovery path.

Separately, `key-manager.ts` has two independent lock timers:
- **Idle timeout:** 5 minutes, hardcoded (`IDLE_TIMEOUT_MS`)
- **Tab-hide delay:** 30 seconds default, configurable via PR #43's slider

5 minutes is too aggressive for volunteers waiting for hotline calls while doing other work — they'd re-enter their PIN constantly. Having two separate timer concepts is confusing for users.

## Design

### 1. Decrypt Failure Detection & Recovery

The crypto worker can fail for three reasons:
1. **Transient timeout** — tab was frozen/slow, worker is still keyed
2. **Worker auto-locked** — rate limit exceeded, key zeroed inside worker
3. **Worker crashed** — unrecoverable, needs reinitialization

**Recovery flow in `decrypt-fields.ts`:**

1. On first decrypt failure: **retry once** (covers transient tab-freeze/slow scenarios)
2. On second failure: call `cryptoWorker.isUnlocked()` to probe worker state
3. If worker reports **locked**: fire `keyManager.lock()` — this triggers the existing chain (auth state → PIN prompt → re-fetch on unlock)
4. If worker reports **unlocked but still failing**: worker is broken — terminate and reinitialize it, then fire `keyManager.lock()`

The lock only fires once per failure batch — a flag prevents multiple concurrent decrypt failures from each independently triggering lock. The first failure to detect the problem fires the lock; subsequent in-flight decrypts just fail normally (their queries will be cleared by the lock callback anyway).

**Error class:** Add `CryptoWorkerLockedError` to `crypto-worker-client.ts` to distinguish "worker has no key" errors from generic timeouts. The worker already returns descriptive error strings (`"Not unlocked"`, `"Rate limit exceeded — worker auto-locked"`) — match on these.

**Worker reinitialization:** Add a `reinitialize()` method to `CryptoWorkerClient` that terminates the current worker, creates a fresh one, and reattaches the message handler. This is the recovery path for a genuinely broken worker (scenario 3).

### 2. Unified Auto-Lock Timeout

Merge both timers into a single **"Auto-lock after inactivity"** setting:

- **Default:** 15 minutes (900,000 ms)
- **Range:** 1 minute → 60 minutes, step 1 minute
- **Storage:** `security-prefs` table from PR #43, field renamed `lockDelayMs` → `autoLockMs`
- **localStorage key:** `llamenos-auto-lock` (replaces `llamenos-lock-delay`)

**Behavior:** One timer, reset on any user activity:
- Mouse clicks, keypresses, touch events
- API request completion (via `markActivity()` in auth.tsx)
- Tab becoming visible (visibilitychange → visible resets timer)

Tab hiding is **not** a lock trigger — it's just the absence of activity. If you switch tabs for 2 minutes with a 15-minute lock, nothing happens. If you're away for 15 minutes, you lock regardless of tab state.

**Removed:** `IDLE_TIMEOUT_MS` constant, `DEFAULT_LOCK_DELAY_MS` constant, `visibilityTimer`, separate tab-hide handler. Replaced by single `autoLockTimer` using the user's configured value.

**API rename:** `setLockDelay()`/`getLockDelayMs()` → `setAutoLockMs()`/`getAutoLockMs()`

### 3. Integration Points

**The full recovery chain:**

```
decrypt attempt → timeout (30s) → retry once → still fails
  → cryptoWorker.isUnlocked() probe
    → false → keyManager.lock()
    → true (broken) → worker.reinitialize() → keyManager.lock()
      → onLock callbacks:
        → auth.tsx: isKeyUnlocked = false → PIN prompt renders
        → query-client.ts: removeQueries(ENCRYPTED_QUERY_KEYS)
        → decryptCache.clear()
      → user enters PIN → unlock → loadHubKeys → invalidateEncryptedQueries()
      → queries refetch → decrypt with fresh worker → clean data
```

### 4. Files Changed

| File | Change |
|------|--------|
| `src/client/lib/crypto-worker-client.ts` | Add `CryptoWorkerLockedError`, `reinitialize()` method, export error class |
| `src/client/lib/decrypt-fields.ts` | Replace silent `catch {}` with retry → probe → lock flow; add lock-once flag |
| `src/client/lib/key-manager.ts` | Unify idle + tab-hide into single `autoLockMs` timer (default 15 min); rename API to `setAutoLockMs`/`getAutoLockMs`; remove `IDLE_TIMEOUT_MS`, `DEFAULT_LOCK_DELAY_MS`, `visibilityTimer` |
| `src/client/components/user-sections/idle-lock-section.tsx` | Update label to "Auto-lock after inactivity", range 1-60 min (step 1 min), field name `autoLockMs` |
| `src/shared/schemas/security-prefs.ts` | Rename `lockDelayMs` → `autoLockMs`, default 900000 |
| `src/server/services/security-prefs.ts` | Match schema rename |
| `drizzle/migrations/` (if column rename needed) | Rename column or add new + drop old |

**Not changed:** `auth.tsx`, `query-client.ts`, login flow — these already handle lock→PIN correctly. The only missing piece was triggering the lock when decryption fails.

### 5. Testing

- **Unit test:** `crypto-worker-client` retry logic, `CryptoWorkerLockedError` detection
- **Unit test:** `decrypt-fields` retry → probe → lock sequence with mocked worker
- **Unit test:** `key-manager` unified timer reset/fire behavior
- **Integration test:** Full chain — simulate worker timeout → verify lock fires → verify PIN prompt renders
- **API test:** `security-prefs` endpoint accepts `autoLockMs`, rejects out-of-range values

### 6. Non-Goals

- Changing the 30s per-request timeout in `crypto-worker-client.ts` — this is an implementation detail for detecting broken workers, not a user-facing setting
- Adding a visible countdown before lock — not needed for this fix, could be a future enhancement
- Offline/service-worker decrypt recovery — out of scope
