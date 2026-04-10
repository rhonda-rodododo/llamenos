# E2E Test Infrastructure Hardening

**Date:** 2026-04-08
**Context:** PR #48 exposed test fragility — `page.goto()` wipes crypto state, global-setup bootstrap is flaky, tests lack patterns for reload-safe behavior.
**Partial dependency on:** Session-persisted crypto unlock spec (for `clearSessionCapsule` helper). Items 1-3 and 5 can be implemented independently.

## Problem

Several E2E test patterns are fragile:

1. **`gotoAdminSection` uses `page.goto()` (full reload)** — wipes the crypto worker. Tests that use this instead of `gotoAdminPath` (SPA navigation) break when the locked-key redirect is active. Multiple tests were found mixing both patterns.

2. **Global-setup DB reset is flaky** — `test-reset-no-admin` via HTTP sometimes returns before the server's config cache is invalidated. The `bootstrapAdmin` function then sees a stale `needsBootstrap=false` and shows the Setup Wizard instead of the Create Admin Account form. Recovery (clear caches, reload) sometimes works, sometimes doesn't.

3. **`reenterPinAfterReload` is complex and fragile** — 3-stage escalation (wait → block refresh → goto /login) was needed because the app didn't redirect to /login on locked key. With PR #48's fix (and eventually session capsule persistence), this helper can be simplified.

4. **No documented patterns** for when to use SPA nav vs full reload in tests.

## Design

### 1. Sweep `page.goto()` in authenticated tests

**Rule:** Authenticated tests must use SPA navigation (`gotoAdminPath`, `navigateAfterLogin`, or `__TEST_ROUTER.navigate()`) unless they specifically need a full reload (testing reload behavior). Tests that need full reload must call `reenterPinAfterReload` afterward (or `clearSessionCapsule` + `reenterPinAfterReload` once session persistence lands).

**Action:** Audit all `tests/ui/` files for `page.goto('/admin/...')` or `page.goto('/')` patterns in tests that use authenticated fixtures (`adminPage`, `hubAdminPage`, `volunteerPage`). Replace with SPA navigation.

Exceptions (intentional full reloads):
- `auth-guards.spec.ts` — testing redirect behavior with fresh contexts
- Tests that explicitly test reload persistence (telephony-provider, webrtc-settings, i18n locale, theme)
- `global-setup.ts` — bootstrap flow requires full page loads

### 2. Fix global-setup DB reset reliability

**Root cause:** The HTTP `test-reset-no-admin` endpoint clears runtime caches on the server, but:
- The Workbox service worker may cache `/api/config` responses
- The browser may have a stale config in memory from a previous test run

**Fix — direct SQL verification after HTTP reset:**

After the HTTP reset succeeds, verify the DB state directly via a SQL query (postgres is already imported in global-setup). Check that no admin user exists:

```sql
SELECT COUNT(*) FROM users WHERE roles::text LIKE '%"role-super-admin"%'
```

If count > 0, retry the reset. This is authoritative — no cache involved.

Also: In `bootstrapAdmin`, add a `navigator.serviceWorker.getRegistrations()` + `unregister()` step BEFORE the first `page.goto('/setup')`, and block the `/api/config` request until after SW unregistration completes. This prevents stale cached config from interfering.

### 3. Simplify `reenterPinAfterReload`

With PR #48's locked-key redirect:
- After reload, the app redirects to `/login` automatically
- The PIN screen appears naturally
- The 3-stage escalation (wait → block refresh → goto /login) is no longer needed

**Simplified helper:**
```typescript
export async function reenterPinAfterReload(page: Page): Promise<void> {
  // App redirects to /login automatically when key is locked after reload
  await page.waitForURL(/\/login/, { timeout: 15000 })
  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  await pinInput.waitFor({ state: 'visible', timeout: 10000 })
  await enterPin(page, TEST_PIN)
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
}
```

The old helper's fallback stages become unnecessary. The `reenterPinAfterReload` body shrinks from ~70 lines to ~10.

### 4. Add `clearSessionCapsule` test helper (for session persistence spec)

Once session capsule persistence lands, `page.reload()` will NOT require PIN re-entry (the capsule auto-restores). Tests that specifically test PIN re-entry behavior need to clear the capsule first:

```typescript
export async function clearSessionCapsule(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.removeItem('llamenos-session-token')
    // IDB clear happens automatically when token is missing
  })
}
```

Usage pattern:
```typescript
// Test reload persistence (e.g., telephony config persists)
await page.reload()
// Key auto-restores from capsule — no PIN needed
await expect(page.getByTestId('some-config')).toBeVisible()

// Test PIN re-entry after forced lock
await clearSessionCapsule(page)
await page.reload()
await reenterPinAfterReload(page)  // PIN required
```

### 5. Document test navigation patterns

Add a JSDoc block to `tests/helpers/index.ts` and `tests/helpers/admin-settings.ts`:

```
Navigation patterns for authenticated tests:
- gotoAdminPath(page, '/admin/section') — SPA nav, preserves crypto state. DEFAULT.
- navigateAfterLogin(page, '/path') — SPA nav with auto-detect. Use for non-admin paths.
- gotoAdminSection(page, 'slug') — FULL RELOAD. Only for testing reload behavior.
  Must call reenterPinAfterReload() afterward.
- page.goto('/path') — FULL RELOAD. Avoid in authenticated tests.
  Wipes crypto worker. Use SPA nav instead.
- page.reload() — FULL RELOAD. Wipes crypto worker.
  With session capsule: auto-restores (no PIN needed).
  Without capsule (or after clearSessionCapsule): requires reenterPinAfterReload().
```

## Files Changed

| File | Change |
|------|--------|
| `tests/helpers/index.ts` | Simplify `reenterPinAfterReload`, add `clearSessionCapsule`, add navigation pattern docs |
| `tests/helpers/admin-settings.ts` | Add navigation pattern JSDoc |
| `tests/global-setup.ts` | Add direct SQL verification after HTTP reset, improve SW cleanup in bootstrapAdmin |
| `tests/ui/*.spec.ts` | Sweep: replace `page.goto()` with SPA nav in authenticated tests |

## Out of Scope

- Rewriting all tests to use testid selectors (separate backlog item #4)
- Changing the Playwright config or project structure
- Adding new test suites

## Success Criteria

1. Global-setup bootstrap succeeds consistently (no "Setup Wizard appeared" warning)
2. No test uses `page.goto('/admin/...')` in authenticated context without explicit reload intent
3. `reenterPinAfterReload` is <15 lines
4. All tests that use `page.reload()` either rely on session capsule auto-restore or explicitly call `reenterPinAfterReload`
5. Navigation patterns documented in test helpers

---

## Amendment 2026-04-09 — PR A scoping notes

Added during PR A brainstorming. Clarifies scope and sequencing without changing the original items.

### Item 2 stays as defense-in-depth

Since the original spec was written, PR #48 landed `api-setup` → `setup` project dependency in `playwright.config.ts`, which eliminated the concurrent-reset race between the two setup projects. That is likely the dominant cause of the "Setup Wizard appeared" warning.

The config-cache failure mode the spec describes (Workbox caching `/api/config`, browser holding a stale in-memory config) is a separate, plausible failure mode. Direct SQL verification costs ~25 lines and catches it cheaply, so item 2 stays in PR A as defense in depth. If it never fires in practice after PR A merges, we can revisit.

### Item 4 — `clearSessionCapsule` helper also dispatches cross-tab lock

The companion session-capsule spec adds a `BroadcastChannel('llamenos-lock')` for cross-tab lock propagation. The `clearSessionCapsule` test helper must also dispatch a lock message on that channel so tests can deterministically force a lock across all tabs of a `BrowserContext`, not just the page the helper was called on:

```typescript
export async function clearSessionCapsule(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.removeItem('llamenos-session-token')
    try {
      const bc = new BroadcastChannel('llamenos-lock')
      bc.postMessage({ type: 'lock' })
      bc.close()
    } catch {}
    // IDB orphan is cleaned up automatically on next loadCapsule()
  })
}
```

### Sequencing constraint for PR A plan

The plan that executes PR A must land changes in this order so every commit keeps the build and test suite green:

1. **Session capsule + crypto worker changes** (client + worker). Nothing in the test suite depends on the capsule yet; `reenterPinAfterReload` still functions as before because the current callers still expect the old behavior.
2. **`clearSessionCapsule` helper** (test helper addition, no callers yet).
3. **Migrate tests that rely on `page.reload()` forcing a PIN prompt** — insert `clearSessionCapsule(page)` immediately before each `page.reload()` so the lock behavior is preserved. These tests now explicitly opt into lock-on-reload.
4. **Simplify `reenterPinAfterReload`** — safe now because step 3 has already ensured every caller either wants the new simple behavior or has migrated to `clearSessionCapsule` + `page.reload()`.
5. **`page.goto()` sweep** — orthogonal, can be interleaved anywhere.
6. **Global-setup SQL verification + JSDoc documentation** — standalone, land last.

### Sweep scope triage (item 1)

Audit of `tests/ui/` found 51 total `page.goto`/`fixturePage.goto` calls. Triage:

**Keep (legitimate full-reload or unauthenticated flow):** `auth-guards.spec.ts`, `bootstrap.spec.ts`, `login-restore.spec.ts`, `demo-mode.spec.ts` login paths, `device-linking.spec.ts`, `invite-onboarding.spec.ts`, `i18n.spec.ts` locale-reload paths.

**Sweep candidates:** `admin-nav-config.spec.ts`, `dashboard-analytics.spec.ts`, `conversations.spec.ts`, `blasts.spec.ts`, `messaging-epics.spec.ts`, `invite-delivery.spec.ts`, `capture-screenshots.spec.ts`, `pwa-offline.spec.ts`.

Target: ~10–15 file edits, not 51.
