/**
 * Tier 0 — Same-origin font loading.
 *
 * The app ships DM Sans as local `.woff2` files under `/fonts/dm-sans/`
 * (see `index.html` and `public/fonts/dm-sans/dm-sans.css`). No requests
 * should ever go to `fonts.googleapis.com` or `fonts.gstatic.com`:
 *
 *   - It leaks the user's IP + User-Agent to a third party the CSP is
 *     supposed to lock down.
 *   - `font-src 'self'` in the CSP would block the request anyway, producing
 *     an invisible-font regression.
 *
 * This spec loads the app root (which redirects unauthenticated users to
 * `/login`, but the HTML document and <link rel=stylesheet> are identical)
 * and captures every outbound request. It then asserts:
 *
 *   1. At least one request matched `/fonts/dm-sans/` — the stylesheet and
 *      its referenced `.woff2` files.
 *   2. No request matched `fonts.googleapis.com` or `fonts.gstatic.com`.
 *   3. The `<link rel="stylesheet" href=".../dm-sans.css">` element is
 *      present in the served DOM.
 */

import { expect, test } from '@playwright/test'

test.describe('Font rendering (same-origin, no Google CDN)', () => {
  test('fonts load from /fonts/ same-origin; no requests to fonts.googleapis.com or fonts.gstatic.com', async ({
    page,
  }) => {
    const requestedUrls: string[] = []
    page.on('request', (req) => {
      requestedUrls.push(req.url())
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // At least one request must target our self-hosted DM Sans bundle.
    const dmSansRequests = requestedUrls.filter((url) => url.includes('/fonts/dm-sans/'))
    expect(
      dmSansRequests.length,
      `Expected at least one /fonts/dm-sans/ request, got: ${requestedUrls.join(', ')}`
    ).toBeGreaterThanOrEqual(1)

    // The stylesheet itself should have been fetched.
    const dmSansStylesheet = dmSansRequests.find((url) => url.endsWith('dm-sans.css'))
    expect(dmSansStylesheet, 'dm-sans.css must be fetched from same-origin').toBeTruthy()

    // Google Fonts CDNs must never be contacted.
    const googleApisRequest = requestedUrls.find((url) => url.includes('fonts.googleapis.com'))
    expect(
      googleApisRequest,
      `Unexpected request to fonts.googleapis.com: ${googleApisRequest ?? ''}`
    ).toBeUndefined()

    const gstaticRequest = requestedUrls.find((url) => url.includes('fonts.gstatic.com'))
    expect(
      gstaticRequest,
      `Unexpected request to fonts.gstatic.com: ${gstaticRequest ?? ''}`
    ).toBeUndefined()

    // All font-bearing requests must be same-origin (localhost:3000).
    const origin = new URL(page.url()).origin
    const fontFileRequests = requestedUrls.filter((url) => /\.(woff2?|ttf|otf)(\?|$)/i.test(url))
    for (const url of fontFileRequests) {
      expect(new URL(url).origin, `Font file must be same-origin (${origin}), got: ${url}`).toBe(
        origin
      )
    }
  })

  test('dm-sans.css <link> element is present in the served DOM', async ({ page }) => {
    await page.goto('/')
    // Head <link> elements are non-interactive and have no natural testid slot.
    // The href pattern IS what the test is asserting, so this is the allowed
    // exception per the project's E2E selector rules.
    const linkCount = await page.locator('link[href*="dm-sans.css"]').count()
    expect(linkCount, 'dm-sans.css stylesheet link must exist in <head>').toBeGreaterThanOrEqual(1)
  })
})
