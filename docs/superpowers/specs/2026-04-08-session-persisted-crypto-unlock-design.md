# Session-Persisted Crypto Unlock

**Date:** 2026-04-08
**Depends on:** PR #48 (PIN prompt on locked key)

## Problem

Page reload destroys the Web Worker, wiping the secret key from its closure. Re-unlocking requires PBKDF2 (600K iterations, 2-5s under parallel load). The user configures a 15-60 minute auto-lock timer, but a page reload effectively resets it to zero. Even with the PIN prompt fix (PR #48), the user must re-enter their PIN on every reload, which is a poor UX for a crisis hotline app where volunteers may reload frequently.

## Solution

After the Web Worker unlocks, it exports a "session capsule" — the nsec encrypted under a random session token. The main thread stores the capsule in IndexedDB and the token in sessionStorage. On page reload, both are read and sent back to the Worker for instant re-unlock (~1ms, no PBKDF2).

```
First unlock (slow path — PIN entry):
  PIN -> PBKDF2(600K) -> KEK -> Worker.unlock(kek, nonce, ct) -> nsec in closure
  Worker.exportSession() -> {encryptedNsec, capsuleNonce} -> IndexedDB
  random 32-byte sessionToken -> sessionStorage

Page reload (fast path — instant):
  sessionStorage has token? -> IDB has capsule? -> autoLockExpiry not passed?
  -> Worker.importSession(token, capsule) -> nsec in closure (~1ms)
  No PBKDF2. No PIN prompt. User sees decrypted content immediately.

Auto-lock / sign-out / panic wipe:
  -> Clear IDB capsule + sessionStorage token + Worker.lock()
  -> Next access requires full PIN entry (slow path)
```

## Security Model

### Threat model unchanged

The session capsule does NOT weaken the existing security model:

- **nsec never appears in plaintext on main thread** — the Worker encrypts it internally and returns an opaque blob. The main thread stores it but can't read it.
- **sessionStorage is tab-scoped** — cleared when the tab closes. The IDB capsule becomes undecryptable garbage without the token.
- **XSS equivalence** — an attacker with XSS who can read sessionStorage + IDB can reconstruct the nsec. But an attacker with XSS can ALSO intercept the `postMessage` channel to the Web Worker, which already carries the KEK hex (line 226 of key-manager.ts). The attack surface is equivalent.
- **Panic wipe** — `keyManager.wipeKey()` clears IDB capsule + sessionStorage token + Worker state + localStorage encrypted key. Full destruction chain.
- **Physical device seizure** — auto-lock timer expiry is checked on reload. If the device was seized and reopened after the timer expired, the fast path fails and PIN is required.

### Tab duplication

`sessionStorage` IS copied when the user duplicates a tab (browser "Duplicate Tab"). Both tabs can unlock. This matches user expectation — duplicate tab = same session. If the user locks one tab, the capsule is cleared from IDB, and the other tab's next unlock attempt will fail (IDB is shared), falling through to PIN entry.

### Why not Service Worker relay

Service Workers can be terminated by the browser after ~30 seconds of inactivity (Chrome is aggressive). A terminated SW loses all in-memory state. IDB + sessionStorage is:
- Simpler (no postMessage relay protocol)
- More reliable (IDB survives SW termination)
- Already uses existing browser APIs (no new SW message handlers)

The SW stays focused on caching and push notifications.

## Components

### 1. Crypto Worker extensions (`src/client/lib/crypto-worker.ts`)

Two new message handlers:

**`exportSession`**: Called after unlock succeeds.
1. Generate 32-byte random token via `crypto.getRandomValues`
2. Encrypt `nsecHex` (UTF-8 bytes) with XChaCha20-Poly1305 under the token
3. Return `{encryptedNsecHex, capsuleNonceHex}` — opaque to main thread

**`importSession`**: Called on reload to restore state.
1. Receive `{tokenHex, encryptedNsecHex, capsuleNonceHex}`
2. Decrypt nsecHex with XChaCha20-Poly1305
3. Restore `secretKey` and `publicKeyHex`
4. Reset rate limits
5. Return pubkey hex (same as `unlock`)

### 2. Crypto Worker Client (`src/client/lib/crypto-worker-client.ts`)

Two new async methods:

```typescript
exportSession(): Promise<{ encryptedNsec: string; capsuleNonce: string }>
importSession(tokenHex: string, encryptedNsec: string, capsuleNonce: string): Promise<string>
```

### 3. Session capsule store (new: `src/client/lib/session-capsule.ts`)

Manages the IDB + sessionStorage pair:

```typescript
interface SessionCapsule {
  encryptedNsec: string    // hex — Worker-encrypted nsec blob
  capsuleNonce: string     // hex — XChaCha20 nonce
  autoLockExpiresAt: number // timestamp (ms) — when auto-lock should fire
  pubkeyHash: string       // first 16 chars of SHA-256(pubkey) — identity check
}

storeCapsule(token: string, capsule: SessionCapsule): Promise<void>
loadCapsule(): Promise<{ token: string; capsule: SessionCapsule } | null>
clearCapsule(): Promise<void>
updateAutoLockExpiry(expiresAt: number): Promise<void>
```

- **IDB database**: `llamenos-session`, single object store `capsules`, single key `active`
- **sessionStorage key**: `llamenos-session-token`
- `loadCapsule()` returns null if: no token in sessionStorage, no capsule in IDB, or `Date.now() >= autoLockExpiresAt`
- `pubkeyHash` verifies the capsule matches the current user (prevents cross-user capsule reuse if localStorage key changes)

### 4. Key Manager changes (`src/client/lib/key-manager.ts`)

**After successful unlock (line ~226):**
```
pubkey = await cryptoWorker.unlock(kekHex, nonce, ciphertext)
// NEW: export session capsule for reload persistence
const session = await cryptoWorker.exportSession()
const expiresAt = Date.now() + getAutoLock()
await storeCapsule(sessionToken, {
  ...session,
  autoLockExpiresAt: expiresAt,
  pubkeyHash: blob.pubkeyHash,
})
```

**New `trySessionRestore()` — called before PBKDF2 unlock:**
```
1. loadCapsule() — checks sessionStorage + IDB + expiry
2. If null: return false (fall through to PIN entry)
3. Verify pubkeyHash matches current localStorage blob
4. await cryptoWorker.importSession(token, capsule)
5. resetAutoLockTimer()
6. notifyCallbacks(unlockCallbacks)
7. clearSessionToken from sessionStorage (prevent replay?)
   — Actually NO: keep it for the next reload. Only clear on lock/signout.
8. return true
```

**Auto-lock timer persistence:**
- `resetAutoLockTimer()`: Also calls `updateAutoLockExpiry(Date.now() + getAutoLock())` — debounced (at most once per 30 seconds) to avoid IDB write spam
- `lock()`: calls `clearCapsule()`
- `wipeKey()`: calls `clearCapsule()`
- `disableAutoLock()` (demo mode): sets `autoLockExpiresAt` to `Infinity`

**Key rotation:** After `handleRotation()` or `rotateSyntheticToReal()`, re-export session capsule since the Worker now holds a re-encrypted nsec.

### 5. Auth integration (`src/client/lib/auth.tsx`)

In the `restoreSession` useEffect (line ~199):
```
// Before fetching /auth/me, try session capsule restore
const restored = await keyManager.trySessionRestore()
if (restored) {
  // Key is unlocked — proceed with full profile fetch + decrypt
  isUnlocked = true
}
```

This happens before the existing `keyManager.isUnlocked()` check, so the flow becomes:
1. `restoreSession()` fires on mount
2. `authFacadeClient.refreshToken()` restores API session
3. `trySessionRestore()` restores crypto state (instant)
4. `getMe()` fetches profile
5. `decryptObjectFields()` works immediately (key is unlocked)
6. State: `isAuthenticated=true, isKeyUnlocked=true` — user sees decrypted dashboard

## Interaction with existing features

| Feature | Interaction |
|---------|-------------|
| **PIN prompt (PR #48)** | If `trySessionRestore()` succeeds, `isKeyUnlocked=true` immediately. Locked-key redirect never fires. |
| **Panic wipe** | `wipeKey()` clears capsule + token + Worker + localStorage. Full destruction. |
| **Demo mode** | `disableAutoLock()` sets expiry to Infinity. Capsule never expires. |
| **Decrypt recovery (PR #46)** | `lock()` on crypto errors clears capsule. Next reload requires PIN. |
| **Key rotation** | After rotation, re-export capsule with new nsec. |
| **Mismatch detection (PR #48)** | `resetMismatchFired()` on unlock still fires. Session restore counts as unlock. |
| **Tab close** | sessionStorage cleared. Capsule in IDB becomes undecryptable. |
| **Browser crash** | Same as tab close — sessionStorage lost. |
| **Multiple tabs** | Each tab gets its own sessionStorage copy. Each can restore independently. Lock in one tab clears IDB capsule — other tabs' next restore attempt fails, falls through to PIN. |

## Files Changed

| File | Change |
|------|--------|
| `src/client/lib/crypto-worker.ts` | Add `exportSession` + `importSession` handlers |
| `src/client/lib/crypto-worker-client.ts` | Add `exportSession()` + `importSession()` methods |
| `src/client/lib/session-capsule.ts` | **New** — IDB + sessionStorage capsule store |
| `src/client/lib/key-manager.ts` | Add `trySessionRestore()`, capsule export after unlock, capsule clear on lock/wipe, debounced expiry updates |
| `src/client/lib/auth.tsx` | Call `trySessionRestore()` in `restoreSession` flow |
| `src/client/lib/panic-wipe.ts` | Add `clearCapsule()` to wipe chain |

## Out of Scope

- Service Worker as crypto engine (Approach 3 from brainstorming)
- Cross-tab session sharing (each tab manages its own capsule independently)
- E2E test infrastructure changes (separate spec)

## Success Criteria

1. Page reload with valid session: user sees decrypted dashboard in <500ms (no PIN prompt, no PBKDF2)
2. Page reload after auto-lock expiry: user sees PIN prompt (capsule expired)
3. Tab close + reopen: user sees PIN prompt (sessionStorage cleared)
4. Panic wipe: all session state cleared, capsule destroyed
5. Lock via auto-lock timer: capsule cleared, next reload requires PIN
6. Key rotation: new capsule exported, old one replaced
7. No regression in existing E2E tests

---

## Amendment 2026-04-09 — Cross-tab lock, orphan cleanup, future work

Added during PR A brainstorming. These refinements extend the original design without changing its core flow.

### Cross-tab lock propagation via `BroadcastChannel`

**Problem:** The original spec accepts that locking in tab A leaves tab B's Worker unlocked until tab B reloads. This violates user expectation ("lock everywhere").

**Design:** Add a `BroadcastChannel('llamenos-lock')` owned by `key-manager.ts`.

- `lock()`, `wipeKey()`, and panic-wipe post `{type: 'lock'}` on the channel as their first step, before any local destruction. Posting is synchronous and does not block on delivery.
- A module-level subscriber listens for the message. On receipt, it calls `lock()` locally.
- A `suppressBroadcast` flag guards the listener path so the secondary `lock()` does not re-broadcast and cause an infinite loop.
- The channel is closed in a `beforeunload` handler for hygiene.

This adds ~20 lines to `key-manager.ts`. No new dependencies. BroadcastChannel is baseline-supported in all target browsers; if missing (very old browsers or some private modes), cross-tab lock silently degrades to the original tabs-lock-independently behavior.

**Test hook:** The new `clearSessionCapsule` test helper (see e2e-test-infrastructure spec amendment) also dispatches the lock broadcast so tests can deterministically force a lock across all tabs of a `BrowserContext`.

### IDB orphan cleanup on load

**Problem:** If sessionStorage is cleared (browser restart, tab close) but the user reopens the app, the IDB capsule is orphaned — undecryptable (token is gone) but still occupying storage. Over time, stale capsules accumulate.

**Design:** `loadCapsule()` deletes the IDB entry as part of the "return null" path when sessionStorage has no token. No security implication — the orphan was already unreadable — but prevents storage bloat.

### Debounced auto-lock expiry update cadence

Confirming the spec default of **30 seconds** debounce on `updateAutoLockExpiry`. Worst-case drift is ~29 seconds, which in the pathological scenario means the capsule's stored expiry is slightly stale versus the in-memory timer; reload in that window may fall through to PIN entry even though the timer "should" still be live. Acceptable tradeoff versus IDB write frequency.

### Future work (not in PR A)

**Shared auto-lock timer across tabs (Option C from brainstorming).** Tabs currently each have their own idle-detection timer, so one tab can auto-lock while another is active. A future iteration could move the authoritative `autoLockExpiresAt` into IDB with a `BroadcastChannel` for activity pings, giving all tabs a single shared timer. Deferred because:

- Subtle concurrency: which tab owns idle detection? How are BroadcastChannel activity pings reconciled with IDB writes?
- Current behavior (independent per-tab timers) is defensible security-wise — an idle tab genuinely has been idle even if a sibling tab is active.
- Not needed to unblock PR A's stated goals.

Capture as a backlog item once PR A merges, so it is not lost.
