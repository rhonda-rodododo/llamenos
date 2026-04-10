# PIN Prompt on Locked Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the crypto key is locked (after page reload or auto-lock timeout), redirect to /login for PIN entry instead of showing [encrypted] placeholders.

**Architecture:** Two targeted changes in the root layout redirect chain + login page guard. Pubkey mismatch detection via callback from decrypt-fields.ts → auth state → warning banner. No structural refactoring.

**Tech Stack:** React (useEffect, useCallback), TanStack Router, existing key-manager + decrypt-fields modules

**Spec:** `docs/superpowers/specs/2026-04-08-pin-prompt-locked-key-design.md`

---

### Task 1: Expose `isKeyUnlocked` from useAuth()

**Files:**
- Modify: `src/client/lib/auth.tsx:53-68` (AuthContextValue interface)
- Modify: `src/client/lib/auth.tsx:547-562` (context value construction)

- [ ] **Step 1: Add `isKeyUnlocked` to AuthContextValue interface**

In `src/client/lib/auth.tsx`, add `isKeyUnlocked` to the interface (after `hasNsec`):

```typescript
// In AuthContextValue interface (around line 65):
  hasNsec: boolean
  isKeyUnlocked: boolean
  adminPubkey: string
```

- [ ] **Step 2: Add `isKeyUnlocked` to the context value object**

In the `value` construction (around line 561):

```typescript
    hasNsec: state.isKeyUnlocked,
    isKeyUnlocked: state.isKeyUnlocked,
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: No errors (isKeyUnlocked is used nowhere yet, just exposed)

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/auth.tsx
git commit -m "feat(auth): expose isKeyUnlocked on AuthContextValue"
```

---

### Task 2: Guard login page redirect with isKeyUnlocked

**Files:**
- Modify: `src/client/routes/__root.tsx:104-109` (redirect-away-from-login useEffect)

- [ ] **Step 1: Add `isKeyUnlocked` to useAuth() destructure**

In `RootLayout()` function (line 62-72), add `isKeyUnlocked`:

```typescript
  const {
    isAuthenticated,
    isAdmin,
    signOut,
    name,
    isLoading,
    profileCompleted,
    needsKeySetup,
    isKeyUnlocked,
    hasPermission,
    primaryRoleName,
  } = useAuth()
```

- [ ] **Step 2: Guard the redirect-away-from-login useEffect**

Change the useEffect at line 104-109 from:

```typescript
  useEffect(() => {
    // Don't redirect away from /login during post-passkey PIN setup (needsKeySetup)
    if (!isLoading && isAuthenticated && !needsKeySetup && location.pathname === '/login') {
      navigate({ to: profileCompleted ? '/' : '/profile-setup' })
    }
  }, [isLoading, isAuthenticated, needsKeySetup, location.pathname, navigate, profileCompleted])
```

To:

```typescript
  useEffect(() => {
    // Don't redirect away from /login during post-passkey PIN setup (needsKeySetup)
    // Don't redirect away when key is locked — user needs to enter PIN first
    if (!isLoading && isAuthenticated && !needsKeySetup && isKeyUnlocked && location.pathname === '/login') {
      navigate({ to: profileCompleted ? '/' : '/profile-setup' })
    }
  }, [isLoading, isAuthenticated, needsKeySetup, isKeyUnlocked, location.pathname, navigate, profileCompleted])
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/__root.tsx
git commit -m "fix(auth): don't redirect away from /login when key is locked"
```

---

### Task 3: Add locked-key redirect to /login

**Files:**
- Modify: `src/client/routes/__root.tsx` (add new useEffect + import hasStoredKey)

- [ ] **Step 1: Import hasStoredKey**

Add to the imports in `__root.tsx` (around line 18, near the keyManager import):

```typescript
import { hasStoredKey } from '@/lib/key-manager'
```

- [ ] **Step 2: Add the locked-key redirect useEffect**

Add this useEffect after the existing redirect-away-from-login effect (after the block ending at line ~109, before the profile-setup redirect):

```typescript
  // Redirect to /login when authenticated but key is locked (after reload or auto-lock).
  // The user needs to enter their PIN to decrypt data. Without this, the app renders
  // with [encrypted] placeholders silently.
  useEffect(() => {
    if (
      !isLoading &&
      !configLoading &&
      isAuthenticated &&
      !isKeyUnlocked &&
      hasStoredKey() &&
      location.pathname !== '/login' &&
      location.pathname !== '/onboarding' &&
      location.pathname !== '/link-device' &&
      location.pathname !== '/setup'
    ) {
      // Save current path so login page can redirect back after PIN entry
      if (location.pathname !== '/') {
        sessionStorage.setItem('returnTo', location.pathname)
      }
      navigate({ to: '/login' })
    }
  }, [isLoading, configLoading, isAuthenticated, isKeyUnlocked, location.pathname, navigate])
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Verify build passes**

Run: `bun run build 2>&1 | tail -5`
Expected: Build completes successfully

- [ ] **Step 5: Commit**

```bash
git add src/client/routes/__root.tsx
git commit -m "fix(auth): redirect to /login when key is locked after reload or auto-lock

After page reload or auto-lock timeout, the refresh cookie restores the
API session but the crypto key stays locked. Previously the app rendered
with [encrypted] placeholders. Now redirects to /login for PIN entry."
```

---

### Task 4: Run the 2 failing E2E tests to verify they pass

**Files:**
- None modified — validation only

- [ ] **Step 1: Build the project**

Run: `bun run build 2>&1 | tail -5`
Expected: Build completes

- [ ] **Step 2: Run the 2 previously-failing tests**

Run: `bunx playwright test tests/ui/telephony-provider.spec.ts:122 tests/ui/webrtc-settings.spec.ts:151 --reporter=line 2>&1 | tail -20`
Expected: Both tests pass. The `reenterPinAfterReload` helper should find the PIN screen on the first wait (stage 1) without needing the fallback stages.

- [ ] **Step 3: Run the auth-guards test to verify no regression**

Run: `bunx playwright test tests/ui/auth-guards.spec.ts --reporter=line 2>&1 | tail -20`
Expected: All tests pass, including "session requires PIN re-entry after reload" (line 38) which should now hit the `onLogin` branch consistently.

- [ ] **Step 4: Run the full UI test suite to check for regressions**

Run: `bunx playwright test --reporter=line 2>&1 | tail -30`
Expected: No new failures. If any tests relied on staying on dashboard with locked key, they would need updating — but none should, since that was always a bug.

---

### Task 5: Add decrypt mismatch callback to decrypt-fields.ts

**Files:**
- Modify: `src/client/lib/decrypt-fields.ts:17-27` (add mismatch handler types)
- Modify: `src/client/lib/decrypt-fields.ts:205-218` (fire handler on mismatch)
- Test: `src/client/lib/decrypt-fields.test.ts`

- [ ] **Step 1: Write failing test for mismatch callback**

Add to the end of `src/client/lib/decrypt-fields.test.ts`:

```typescript
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { resolveEncryptedFields, setOnDecryptMismatch } from './decrypt-fields'

describe('decrypt mismatch callback', () => {
  afterEach(() => {
    setOnDecryptMismatch(null)
  })

  test('fires mismatch handler when no envelope matches reader pubkey', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)

    const obj = {
      encryptedName: 'some-ciphertext',
      nameEnvelopes: [
        { pubkey: 'aaaa', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' },
      ],
    }

    // Reader pubkey doesn't match any envelope
    resolveEncryptedFields(obj, 'different-pubkey')

    expect(handler).toHaveBeenCalledWith({
      field: 'encryptedName',
      readerPubkey: 'different-pubkey',
      envelopePubkeys: ['aaaa'],
    })
  })

  test('does not fire when envelope matches reader pubkey', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)

    const obj = {
      encryptedName: 'some-ciphertext',
      nameEnvelopes: [
        { pubkey: 'reader-key', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' },
      ],
    }

    resolveEncryptedFields(obj, 'reader-key')

    expect(handler).not.toHaveBeenCalled()
  })

  test('does not fire when no reader pubkey provided', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)

    const obj = {
      encryptedName: 'some-ciphertext',
      nameEnvelopes: [
        { pubkey: 'aaaa', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' },
      ],
    }

    resolveEncryptedFields(obj)

    expect(handler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/client/lib/decrypt-fields.test.ts 2>&1 | tail -10`
Expected: FAIL — `setOnDecryptMismatch` is not a function / not exported

- [ ] **Step 3: Implement mismatch callback in decrypt-fields.ts**

Add after the `decryptDebugEnabled()` function (around line 27):

```typescript
// ---------------------------------------------------------------------------
// Decrypt mismatch notification
// ---------------------------------------------------------------------------

export interface DecryptMismatchInfo {
  field: string
  readerPubkey: string
  envelopePubkeys: string[]
}

type DecryptMismatchHandler = (info: DecryptMismatchInfo) => void

let mismatchHandler: DecryptMismatchHandler | null = null

/** Register a handler called when no envelope matches the reader's pubkey. */
export function setOnDecryptMismatch(handler: DecryptMismatchHandler | null): void {
  mismatchHandler = handler
}
```

Then in `resolveEncryptedFields`, update the no-envelope branch (around line 205-218):

```typescript
    if (!envelope) {
      if (readerPubkey) {
        const envelopePubkeys = (envelopes as RecipientEnvelope[]).map((e) => e.pubkey)
        if (decryptDebugEnabled()) {
          // eslint-disable-next-line no-console
          console.warn(`[decrypt-fields] No envelope for reader on field "${key}":`, {
            readerPubkey,
            envelopePubkeys,
          })
        }
        mismatchHandler?.({ field: key, readerPubkey, envelopePubkeys })
      }
      continue
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/client/lib/decrypt-fields.test.ts 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 5: Verify typecheck**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/decrypt-fields.ts src/client/lib/decrypt-fields.test.ts
git commit -m "feat(crypto): add mismatch callback to decrypt-fields

Fires when no envelope matches the reader's pubkey during field
decryption. Auth layer can subscribe to detect stale envelopes
and show a warning banner."
```

---

### Task 6: Wire mismatch detection into auth state

**Files:**
- Modify: `src/client/lib/auth.tsx:29-51` (AuthState interface)
- Modify: `src/client/lib/auth.tsx:107-112` (initial state)
- Modify: `src/client/lib/auth.tsx:142-161` (useEffect for lock/unlock)
- Modify: `src/client/lib/auth.tsx:547-562` (context value)

- [ ] **Step 1: Add `keyMismatchDetected` to AuthState and AuthContextValue**

In the `AuthState` interface (around line 29), add:

```typescript
  /** True when decrypt found no matching envelope for user's pubkey */
  keyMismatchDetected: boolean
```

In the `AuthContextValue` interface (after `isKeyUnlocked`), add:

```typescript
  keyMismatchDetected: boolean
```

- [ ] **Step 2: Set initial state and add to context value**

In the initial state (around line 107), add `keyMismatchDetected: false`.

In the `value` construction (around line 560), add:

```typescript
    keyMismatchDetected: state.keyMismatchDetected,
```

- [ ] **Step 3: Subscribe to mismatch handler in a useEffect**

Add import at the top of auth.tsx:

```typescript
import { setOnDecryptMismatch } from './decrypt-fields'
```

Add a useEffect after the existing lock/unlock listener (after line ~161):

```typescript
  // Listen for decrypt envelope mismatches (no envelope for our pubkey)
  useEffect(() => {
    setOnDecryptMismatch((info) => {
      setState((s) => {
        if (s.keyMismatchDetected) return s // already flagged
        return { ...s, keyMismatchDetected: true }
      })
    })
    return () => setOnDecryptMismatch(null)
  }, [])
```

- [ ] **Step 4: Clear mismatch flag on sign-out**

In the `signOut` callback, where state is reset (search for `isKeyUnlocked: false` in signOut), add `keyMismatchDetected: false`.

- [ ] **Step 5: Verify typecheck**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/auth.tsx
git commit -m "feat(auth): wire decrypt mismatch detection into auth state

Subscribe to setOnDecryptMismatch in AuthProvider. Sets
keyMismatchDetected flag when no envelope matches the user's
pubkey, cleared on sign-out."
```

---

### Task 7: Create KeyMismatchBanner component

**Files:**
- Create: `src/client/components/key-mismatch-banner.tsx`
- Modify: `src/client/routes/__root.tsx` (render banner in authenticated layout)

- [ ] **Step 1: Create the banner component**

Create `src/client/components/key-mismatch-banner.tsx`:

```tsx
import { useAuth } from '@/lib/auth'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function KeyMismatchBanner() {
  const { keyMismatchDetected } = useAuth()
  const { t } = useTranslation()

  if (!keyMismatchDetected) return null

  return (
    <div
      role="alert"
      data-testid="key-mismatch-banner"
      className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 dark:bg-amber-600 dark:text-amber-50"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {t('crypto.keyMismatch', {
        defaultValue:
          'Your encryption key doesn\u2019t match your stored data. Contact an admin to re-verify your identity.',
      })}
    </div>
  )
}
```

- [ ] **Step 2: Add the banner to the authenticated layout in __root.tsx**

Import at the top of `__root.tsx`:

```typescript
import { KeyMismatchBanner } from '@/components/key-mismatch-banner'
```

In `AuthenticatedLayout`, add after `<PwaInstallBanner />` (around line 514):

```tsx
        <PwaInstallBanner />
        <KeyMismatchBanner />
```

- [ ] **Step 3: Add the i18n key to all locale files**

Add to `public/locales/en.json` under a new `"crypto"` section:

```json
  "crypto": {
    "keyMismatch": "Your encryption key doesn\u2019t match your stored data. Contact an admin to re-verify your identity."
  }
```

For the other locale files, add the same English string (translation is a separate pass):

```json
  "crypto": {
    "keyMismatch": "Your encryption key doesn\u2019t match your stored data. Contact an admin to re-verify your identity."
  }
```

- [ ] **Step 4: Verify typecheck and build**

Run: `bun run typecheck 2>&1 | tail -5 && bun run build 2>&1 | tail -5`
Expected: Both pass

- [ ] **Step 5: Commit**

```bash
git add src/client/components/key-mismatch-banner.tsx src/client/routes/__root.tsx public/locales/
git commit -m "feat(ui): add KeyMismatchBanner for pubkey/envelope mismatch

Renders a persistent amber warning when decrypt-fields detects no
matching envelope for the user's pubkey. Tells the user to contact
an admin for re-verification."
```

---

### Task 8: Final verification

**Files:**
- None modified — validation only

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 2: Run build**

Run: `bun run build 2>&1 | tail -5`
Expected: Build completes

- [ ] **Step 3: Run unit tests**

Run: `bun test 2>&1 | tail -10`
Expected: All pass, including new decrypt-fields mismatch tests

- [ ] **Step 4: Run the 2 previously-failing E2E tests**

Run: `bunx playwright test tests/ui/telephony-provider.spec.ts:122 tests/ui/webrtc-settings.spec.ts:151 --reporter=line 2>&1 | tail -20`
Expected: Both pass

- [ ] **Step 5: Run auth-related E2E tests**

Run: `bunx playwright test tests/ui/auth-guards.spec.ts tests/ui/login-restore.spec.ts --reporter=line 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 6: Run full UI suite for regression check**

Run: `bunx playwright test --reporter=line 2>&1 | tail -30`
Expected: No new failures
