import { beforeAll, describe, expect, test } from 'bun:test'
import type { User } from '../types'
import { authenticateRequest } from './auth'
import { signAccessToken } from './jwt'

const TEST_JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!'
const TEST_PUBKEY = 'a'.repeat(64)
const mockUser: User = {
  pubkey: TEST_PUBKEY,
  name: '',
  encryptedName: '' as never,
  phone: '',
  encryptedPhone: '' as never,
  roles: ['admin'],
  hubRoles: [],
  createdAt: new Date().toISOString(),
  active: true,
  encryptedSecretKey: '',
  transcriptionEnabled: false,
  spokenLanguages: ['en'],
  uiLanguage: 'en',
  profileCompleted: true,
  onBreak: false,
  callPreference: 'phone',
}
const mockIdentity = {
  getUser: async (pubkey: string) => (pubkey === TEST_PUBKEY ? mockUser : null),
}
beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET
})

describe('authenticateRequest', () => {
  test('null for missing header', async () => {
    expect(await authenticateRequest(new Request('http://localhost/'), mockIdentity)).toBeNull()
  })
  test('null for non-Bearer', async () => {
    const req = new Request('http://localhost/', { headers: { Authorization: 'Basic abc' } })
    expect(await authenticateRequest(req, mockIdentity)).toBeNull()
  })
  test('null for invalid JWT', async () => {
    const req = new Request('http://localhost/', {
      headers: { Authorization: 'Bearer bad.jwt.here' },
    })
    expect(await authenticateRequest(req, mockIdentity)).toBeNull()
  })
  test('null for wrong secret', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: ['*'] },
      'wrong-secret-key-at-least-32-chars!'
    )
    const req = new Request('http://localhost/', { headers: { Authorization: `Bearer ${token}` } })
    expect(await authenticateRequest(req, mockIdentity)).toBeNull()
  })
  test('null for non-existent user', async () => {
    const token = await signAccessToken(
      { pubkey: 'b'.repeat(64), permissions: ['*'] },
      TEST_JWT_SECRET
    )
    const req = new Request('http://localhost/', { headers: { Authorization: `Bearer ${token}` } })
    expect(await authenticateRequest(req, mockIdentity)).toBeNull()
  })
  test('returns {pubkey, user} for valid auth', async () => {
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: ['*'] },
      TEST_JWT_SECRET
    )
    const req = new Request('http://localhost/', { headers: { Authorization: `Bearer ${token}` } })
    const result = await authenticateRequest(req, mockIdentity)
    expect(result).not.toBeNull()
    expect(result!.pubkey).toBe(TEST_PUBKEY)
  })
  test('throws when JWT_SECRET empty', async () => {
    const saved = process.env.JWT_SECRET
    process.env.JWT_SECRET = ''
    const token = await signAccessToken(
      { pubkey: TEST_PUBKEY, permissions: ['*'] },
      TEST_JWT_SECRET
    )
    const req = new Request('http://localhost/', { headers: { Authorization: `Bearer ${token}` } })
    expect(authenticateRequest(req, mockIdentity)).rejects.toThrow('JWT_SECRET not configured')
    process.env.JWT_SECRET = saved
  })
})
