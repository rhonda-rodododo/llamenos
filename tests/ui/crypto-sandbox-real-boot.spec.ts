// Tier 4 P0 — crypto sandbox iframe opaque-origin round-trip regression.
//
// This spec is intended to catch the "silently broken postMessage channel"
// bug documented in docs/security/TIER_4_POST_REVIEW.md §C-3 (and fixed in
// the Option A branch that introduced this file). The bug:
//
//   bootRealIframe() creates an iframe with `sandbox="allow-scripts"` but
//   NO `allow-same-origin`. Sandboxed-without-allow-same-origin iframes
//   have an opaque origin; both sides observe `ev.origin === "null"` on
//   every message. Any origin check that expects the configured crypto
//   origin drops every message, so the channel is silently dead.
//
// The fix (Option A, see docs/security/TIER_5_POST_REVIEW.md) is:
//   1. Parent accepts `ev.origin === "null"` for incoming messages.
//   2. Parent posts with `targetOrigin === "*"` (opaque targets require it).
//   3. Every request carries a 32-byte per-call nonce, echoed on the
//      response. The parent drops any response whose nonce does not match
//      an outstanding-request nonce stored in its closure.
//
// This spec verifies (3) end-to-end against a real Chromium iframe.
//
// ────────────────────────────────────────────────────────────────────────
// INFRA STATUS: SKIPPED
//
// `bun run test:e2e` boots the SPA via Playwright's `webServer` block in
// `playwright.config.ts` (`bun run build && bun run start`), serving only
// `dist/client/*` on http://localhost:3000. `VITE_CRYPTO_ORIGIN` is NOT set
// in that env, so `bootCryptoSandbox()` no-ops and no iframe is ever
// created — there is nothing to test at /api/health/ready.
//
// To un-skip this spec the test harness needs to:
//
//   1. Build the crypto-sandbox bundle (`bun --cwd crypto-sandbox run build`
//      outputs to `dist/crypto-sandbox/sandbox.html`).
//   2. Serve the sandbox on a DIFFERENT origin from the SPA (e.g. via a
//      second static file server on port 3100, or a Caddy reverse-proxy
//      with two virtual hosts). Using the same origin would defeat the
//      purpose — we specifically need to exercise the opaque-origin +
//      nonce round-trip path.
//   3. Pass `VITE_CRYPTO_ORIGIN=http://localhost:3100` when building the
//      SPA so the iframe boot path is compiled in.
//   4. Set `VITE_CRYPTO_PARENT_ORIGIN=http://localhost:3000` when building
//      the crypto sandbox so its origin check accepts the SPA frame.
//   5. Make sure both the SPA and the sandbox honour the Caddy CSP
//      (`connect-src 'none'` on the crypto host, `frame-src` allowing the
//      crypto host on the SPA host) — otherwise the iframe will be blocked
//      before boot.
//
// Until (1)–(5) are wired into CI, the nonce round-trip is fully covered
// by `src/client/lib/crypto-iframe-client.test.ts`, which drives the
// exact same handshake through a fake iframe harness. That suite is the
// effective regression for the round-trip; this file exists so the
// browser-level check lands the moment the infra is available.
// ────────────────────────────────────────────────────────────────────────

import { expect, test } from '@playwright/test'

test.describe('crypto sandbox opaque-origin round-trip', () => {
  test.skip(
    true,
    'Infra: needs two-origin webserver + VITE_CRYPTO_ORIGIN build-time env. See file header for the un-skip recipe.'
  )

  test('parent drives a full RPC round trip against the sandbox iframe', async ({ page }) => {
    await page.goto('/')

    // Wait for the real iframe to be attached to the DOM.
    const iframeLocator = page.locator('[data-testid="crypto-sandbox-iframe"]')
    await expect(iframeLocator).toBeAttached({ timeout: 5_000 })

    // Drive the RPC through the exposed client singleton in the window.
    // The round-trip goes: main frame → iframe postMessage → router →
    // response with echoed nonce → main frame verifies nonce → resolve.
    const { result, elapsedMs } = await page.evaluate(async () => {
      const mod = await import('/src/client/lib/crypto-iframe-client.ts')
      const client = mod.getCryptoIframeClient()
      await client.ready
      const started = performance.now()
      const isUnlocked = await client.isUnlocked()
      return { result: isUnlocked, elapsedMs: performance.now() - started }
    })

    // The stub isUnlocked handler returns `false` when the sandbox is
    // locked. What matters for this regression is that we got any answer
    // back at all — with the nonce path wired correctly and within the
    // RPC timeout — not the specific boolean value.
    expect(typeof result).toBe('boolean')
    expect(elapsedMs).toBeLessThan(2_000)
  })
})
