# PIN Prompt on Locked Key + Pubkey Mismatch Detection

**Date:** 2026-04-08
**Continues:** PR #46 (decrypt recovery + unified auto-lock)
**Fixes:** 2 persistent E2E test failures on main

## Problem

After page reload or auto-lock timeout, the refresh cookie restores the API session (`isAuthenticated = true`) but the crypto key stays locked (`isKeyUnlocked = false`). The app renders the dashboard with `[encrypted]` placeholders instead of prompting for PIN re-entry.

This is both a UX bug (users see broken data) and the root cause of 2 persistent E2E failures:
- `telephony-provider.spec.ts:122` — PIN screen never appears after reload
- `webrtc-settings.spec.ts:151` — WebRTC toggle unchecked (encrypted config not decrypted)

### Auth state after reload

```
1. Page reloads → keyManager locked (worker cleared)
2. restoreSession() runs → refreshToken() succeeds via httpOnly cookie
3. getMe() returns user data → setState({...roles, isKeyUnlocked: false})
4. isAuthenticated = (isKeyUnlocked || hasAccessToken) && roles.length > 0 → TRUE
5. __root.tsx line 106: isAuthenticated && !needsKeySetup → redirect AWAY from /login
6. Dashboard renders → all encrypted fields show [encrypted]
```

The gap is step 5: the redirect-away-from-login effect doesn't check `isKeyUnlocked`, so it bounces the user off the PIN screen.

## Design

### 1. Root-level redirect to /login when key is locked

**File:** `src/client/routes/__root.tsx`

Add `isKeyUnlocked` (aliased from `hasNsec`) to the `useAuth()` destructure. Two changes:

**New useEffect — locked key redirect:**
```
When: isAuthenticated && !isKeyUnlocked && hasStoredKey() && not on a public path
Action: Save returnTo in sessionStorage, navigate to /login
```

This fires after reload (key locked, session alive) and after auto-lock timeout (key-manager fires lock callback → isKeyUnlocked flips false → effect triggers).

Guard conditions:
- Skip when `isLoading` (initial auth check in progress)
- Skip when on `/login`, `/onboarding`, `/link-device`, `/setup`, `/preferences` (public paths)
- Skip when `!hasStoredKey()` (no key to unlock — user needs recovery, not PIN)

**Modified useEffect — guard redirect-away-from-login (line 106):**
```
Before: isAuthenticated && !needsKeySetup → redirect to /
After:  isAuthenticated && !needsKeySetup && isKeyUnlocked → redirect to /
```

This prevents the app from bouncing the user off `/login` while they still need to enter their PIN.

### 2. Expose isKeyUnlocked from useAuth()

**File:** `src/client/lib/auth.tsx`

`hasNsec` already equals `state.isKeyUnlocked` but the name is misleading for UI routing logic. Add `isKeyUnlocked` to the `AuthContextValue` interface and the context value object. Keep `hasNsec` for backward compatibility (it's used in multiple places).

### 3. E2E test validation

The 2 failing tests use `reenterPinAfterReload` which has a 3-stage escalation to surface the PIN screen. With the app fix, the PIN screen will appear naturally after reload. The test helper should work on the first stage (wait for PIN input) without needing the fallback stages.

No test code changes required — validate by running the failing tests and confirming they pass.

### 4. Pubkey/envelope mismatch detection

**Problem:** When `decryptObjectFields` can't find an envelope matching the user's pubkey, it silently leaves `[encrypted]` in the UI. This happens on pubkey mismatch (re-key on another device, key corruption, stale envelopes).

**Current state (from PR #46):**
- `decryptDebugEnabled()` logs `console.warn` with reader pubkey vs envelope pubkeys
- `decryptFieldWithRecovery` fires `keyManager.lock()` on crypto errors
- `fireLockOnce()` prevents cascading locks

**Missing:** User-facing notification when the mismatch is detected.

**Design:**

Add a mismatch event system in `decrypt-fields.ts`:

```typescript
type DecryptMismatchHandler = (info: {
  field: string
  readerPubkey: string
  envelopePubkeys: string[]
}) => void

let onMismatch: DecryptMismatchHandler | null = null
export function setOnDecryptMismatch(handler: DecryptMismatchHandler | null): void {
  onMismatch = handler
}
```

In `resolveEncryptedFields`, when no envelope matches the reader's pubkey, call `onMismatch` (in addition to the existing `console.warn`).

In `auth.tsx`, subscribe to the mismatch handler and set a state flag `keyMismatchDetected: boolean`. This flag persists until the user re-verifies (future work) or logs out.

In `__root.tsx`, render a `KeyMismatchBanner` when `keyMismatchDetected` is true:
- Persistent, non-dismissible banner at the top of the authenticated layout
- Text: "Your encryption key doesn't match your stored data. Contact an admin to re-verify your identity."
- Styled as a warning (yellow/amber)

**Why detection-only, not auto-fix:** Re-verification requires admin action (re-encrypting envelopes with the correct pubkey). Auto-fixing would require the admin's private key to re-wrap. The right UX is notification + instructions.

## Files Changed

| File | Change |
|------|--------|
| `src/client/routes/__root.tsx` | Add locked-key redirect useEffect, guard login redirect with isKeyUnlocked |
| `src/client/lib/auth.tsx` | Expose `isKeyUnlocked` on AuthContextValue, subscribe to mismatch handler, add `keyMismatchDetected` state |
| `src/client/lib/decrypt-fields.ts` | Add `setOnDecryptMismatch` callback, fire on envelope mismatch |
| `src/client/components/key-mismatch-banner.tsx` | New component — warning banner for pubkey mismatch |

## Out of Scope

- Full re-verification flow (admin re-encrypts envelopes) — separate effort
- Testid selector sweep — separate Spec B
- State machine refactor for auth lifecycle — future work
- Changes to `reenterPinAfterReload` test helper — should work as-is

## Success Criteria

1. After page reload with locked key: app redirects to `/login`, shows PIN prompt
2. After auto-lock timeout: same behavior — PIN prompt appears
3. After PIN entry: app navigates back to `returnTo` path (or `/` if none)
4. `telephony-provider.spec.ts:122` passes
5. `webrtc-settings.spec.ts:151` passes
6. When pubkey doesn't match any envelope: warning banner shown
7. No regressions in existing auth flows (passkey, demo, bootstrap, profile-setup)
