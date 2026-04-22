import { describe, expect, test } from 'bun:test'
import { signAccessToken, verifyAccessToken } from './jwt'

const TEST_SECRET = 'test-secret-at-least-32-chars-long!!'
const TEST_PUBKEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
const TEST_PERMISSIONS = ['notes:read', 'notes:write', 'calls:answer']

describe('signAccessToken', () => {
  test('returns a string with 3 dot-separated parts (JWS compact)', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
  })

  test('produces unique tokens on each call (different jti)', async () => {
    const t1 = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    const t2 = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    expect(t1).not.toBe(t2)
  })

  test('respects custom expiresIn option', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET,
      { expiresIn: '1h' }
    )
    const payload = await verifyAccessToken(token, TEST_SECRET)
    const delta = payload.exp! - payload.iat!
    // 1h = 3600s, allow small tolerance
    expect(delta).toBeGreaterThanOrEqual(3599)
    expect(delta).toBeLessThanOrEqual(3601)
  })

  test('uses default 15m expiry when no option provided', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    const payload = await verifyAccessToken(token, TEST_SECRET)
    const delta = payload.exp! - payload.iat!
    // 15m = 900s
    expect(delta).toBeGreaterThanOrEqual(899)
    expect(delta).toBeLessThanOrEqual(901)
  })
})

describe('verifyAccessToken', () => {
  test('decodes a valid token with correct claims', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    const payload = await verifyAccessToken(token, TEST_SECRET)

    expect(payload.sub).toBe(TEST_PUBKEY)
    expect(payload.permissions).toEqual(TEST_PERMISSIONS)
    expect(payload.iss).toBe('llamenos')
    expect(typeof payload.iat).toBe('number')
    expect(typeof payload.exp).toBe('number')
    expect(typeof payload.jti).toBe('string')
    expect(payload.jti?.length).toBeGreaterThan(0)
  })

  test('iat is close to current time', async () => {
    const before = Math.floor(Date.now() / 1000)
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    const after = Math.floor(Date.now() / 1000)
    const payload = await verifyAccessToken(token, TEST_SECRET)

    expect(payload.iat).toBeGreaterThanOrEqual(before)
    expect(payload.iat).toBeLessThanOrEqual(after + 1)
  })

  test('rejects token signed with wrong secret', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    await expect(verifyAccessToken(token, 'wrong-secret-entirely-different')).rejects.toThrow()
  })

  test('rejects expired token', async () => {
    // Sign with 1-second expiry then wait for it to expire
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET,
      { expiresIn: '1s' }
    )
    // Wait 2 seconds to ensure expiry
    await new Promise((r) => setTimeout(r, 2000))
    await expect(verifyAccessToken(token, TEST_SECRET)).rejects.toThrow()
  })

  test('rejects malformed token string', async () => {
    await expect(verifyAccessToken('not-a-jwt', TEST_SECRET)).rejects.toThrow()
  })

  test('rejects token with tampered payload', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    const [header, _payload, signature] = token.split('.')
    // Replace payload with a different base64url-encoded JSON
    const tamperedPayload = btoa(JSON.stringify({ sub: 'attacker', permissions: ['admin'] }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const tampered = `${header}.${tamperedPayload}.${signature}`
    await expect(verifyAccessToken(tampered, TEST_SECRET)).rejects.toThrow()
  })

  test('rejects empty string', async () => {
    await expect(verifyAccessToken('', TEST_SECRET)).rejects.toThrow()
  })
})

describe('token header', () => {
  test('uses HS256 algorithm', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: TEST_PERMISSIONS },
      TEST_SECRET
    )
    const [headerB64] = token.split('.')
    const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')))
    expect(header.alg).toBe('HS256')
  })
})
