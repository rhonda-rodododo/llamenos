import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { cspNonce } from './csp-nonce'

describe('cspNonce middleware', () => {
  test('sets a base64 nonce on context', async () => {
    const app = new Hono()
    let captured = ''
    app.use('*', cspNonce)
    app.get('/', (c) => {
      captured = (c.get as (k: string) => string)('cspNonce')
      return c.text('ok')
    })

    await app.request('/')
    expect(captured).toMatch(/^[A-Za-z0-9+/]+=*$/)
    const decoded = atob(captured)
    expect(decoded.length).toBe(16)
  })

  test('generates unique nonce per request', async () => {
    const app = new Hono()
    const nonces: string[] = []
    app.use('*', cspNonce)
    app.get('/', (c) => {
      nonces.push((c.get as (k: string) => string)('cspNonce'))
      return c.text('ok')
    })

    await app.request('/')
    await app.request('/')
    expect(nonces[0]).not.toBe(nonces[1])
  })
})
