import { describe, expect, test } from 'bun:test'
import { generateSessionToken, hashSessionToken, verifySessionToken } from './session-tokens'

describe('session-tokens', () => {
  test('generateSessionToken returns 43-char base64url string', () => {
    const token = generateSessionToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('generateSessionToken returns different values on each call', () => {
    const a = generateSessionToken()
    const b = generateSessionToken()
    expect(a).not.toBe(b)
  })

  test('hashSessionToken produces stable 64-char hex hash', () => {
    const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const hash = hashSessionToken(token, 'secret-key')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(token, 'secret-key')).toBe(hash)
  })

  test('hashSessionToken changes with secret', () => {
    const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    expect(hashSessionToken(token, 'a')).not.toBe(hashSessionToken(token, 'b'))
  })

  test('verifySessionToken returns true for matching token/hash', () => {
    const token = generateSessionToken()
    const hash = hashSessionToken(token, 'secret')
    expect(verifySessionToken(token, hash, 'secret')).toBe(true)
  })

  test('verifySessionToken returns false for non-matching token', () => {
    const hash = hashSessionToken(generateSessionToken(), 'secret')
    expect(verifySessionToken(generateSessionToken(), hash, 'secret')).toBe(false)
  })
})
