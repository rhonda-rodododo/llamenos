import { expect, test } from '@playwright/test'

// Tier 4 — signed release manifest endpoint.
//
// The server either serves the signed manifest file (200) or returns 503 so
// the client verifier fails closed. Both outcomes are legitimate depending
// on whether the deployment has provisioned a manifest, so the test accepts
// both and asserts shape.

test.describe('GET /api/releases/latest/manifest', () => {
  test('returns 200 + signed manifest shape, or 503 with error detail', async ({ request }) => {
    const res = await request.get('/api/releases/latest/manifest')
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    if (res.status() === 200) {
      // Signed manifest shape: { manifest, signature, signingKey }
      expect(body).toHaveProperty('manifest')
      expect(body).toHaveProperty('signature')
      expect(body).toHaveProperty('signingKey')
      // Signature + signingKey must be lowercase hex of expected lengths.
      expect(body.signature).toMatch(/^[0-9a-f]{128}$/)
      expect(body.signingKey).toMatch(/^[0-9a-f]{64}$/)
      // Manifest must carry version + releaseTag + builtAt + files map.
      expect(body.manifest.version).toBe(1)
      expect(typeof body.manifest.releaseTag).toBe('string')
      expect(typeof body.manifest.builtAt).toBe('number')
      expect(typeof body.manifest.files).toBe('object')
      // Cache-Control must be no-store; the verifier fetches this every boot.
      expect(res.headers()['cache-control']).toContain('no-store')
    } else {
      // 503: verifier must fail closed — confirm shape is an error envelope.
      expect(body).toHaveProperty('error')
    }
  })

  test('endpoint is public (no auth required)', async ({ request }) => {
    // No Authorization / session cookie — must not 401.
    const res = await request.get('/api/releases/latest/manifest', {
      headers: { cookie: '' },
    })
    expect(res.status()).not.toBe(401)
    expect([200, 503]).toContain(res.status())
  })
})
