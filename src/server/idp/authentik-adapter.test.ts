/**
 * Unit tests for AuthentikAdapter.
 * All HTTP calls are intercepted by mocking globalThis.fetch.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { AuthentikAdapter } from './authentik-adapter'

// --- Isolation: save/restore globalThis.fetch so other test files aren't affected ---

const originalFetch = globalThis.fetch

afterAll(() => {
  globalThis.fetch = originalFetch
})

// --- Test fixtures ---

/**
 * Cast any value to `typeof fetch` through `unknown`.
 * Bun's Mock type lacks the non-callable `.preconnect` property that the
 * full `fetch` type declares, so a direct cast is rejected. Going through
 * `unknown` is the correct TypeScript escape hatch here — the mock *does*
 * satisfy the call signature at runtime.
 */
function asFetch(fn: unknown): typeof fetch {
  return fn as unknown as typeof fetch
}

const TEST_PUBKEY = 'a'.repeat(64)
const TEST_CONFIG = {
  url: 'https://auth.example.com',
  apiToken: 'test-token',
  // 64 hex chars = 32 bytes
  idpValueEncryptionKey: 'deadbeef'.repeat(8),
}

function makeUser(
  overrides: Partial<{
    pk: number
    username: string
    name: string
    is_active: boolean
    path: string
    attributes: Record<string, string>
  }> = {}
) {
  return {
    pk: 42,
    username: TEST_PUBKEY,
    name: TEST_PUBKEY,
    is_active: true,
    path: 'llamenos',
    attributes: {} as Record<string, string>,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function listResponse<T>(results: T[], status = 200): Response {
  return jsonResponse({ count: results.length, next: null, previous: null, results }, status)
}

// --- Tests ---

describe('AuthentikAdapter', () => {
  let adapter: AuthentikAdapter

  beforeEach(() => {
    adapter = new AuthentikAdapter(TEST_CONFIG)
  })

  // --- initialize ---

  describe('initialize', () => {
    test('succeeds when Authentik API returns 200', async () => {
      globalThis.fetch = asFetch(mock(() => Promise.resolve(listResponse([makeUser()]))))

      await expect(adapter.initialize()).resolves.toBeUndefined()
    })

    test('throws when Authentik API returns non-200', async () => {
      globalThis.fetch = asFetch(
        mock(() => Promise.resolve(new Response('Forbidden', { status: 403 })))
      )

      await expect(adapter.initialize()).rejects.toThrow('403')
    })
  })

  // --- createUser ---

  describe('createUser', () => {
    test('posts to /api/v3/core/users/ and returns IdPUser', async () => {
      const mockFetch = mock((url: string, init?: RequestInit) => {
        expect(url).toBe('https://auth.example.com/api/v3/core/users/')
        expect(init?.method).toBe('POST')
        const body = JSON.parse(init?.body as string) as {
          username: string
          is_active: boolean
          path: string
          attributes: { nsec_secret: string }
        }
        expect(body.username).toBe(TEST_PUBKEY)
        expect(body.is_active).toBe(true)
        expect(body.path).toBe('llamenos')
        expect(body.attributes.nsec_secret).toBeString()

        return Promise.resolve(
          jsonResponse(makeUser({ attributes: { nsec_secret: body.attributes.nsec_secret } }))
        )
      })
      globalThis.fetch = asFetch(mockFetch)

      const user = await adapter.createUser(TEST_PUBKEY)

      expect(user.pubkey).toBe(TEST_PUBKEY)
      expect(user.active).toBe(true)
      expect(user.externalId).toBe('42')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    test('throws on non-200 response', async () => {
      globalThis.fetch = asFetch(
        mock(() => Promise.resolve(new Response('conflict', { status: 400 })))
      )

      await expect(adapter.createUser(TEST_PUBKEY)).rejects.toThrow('400')
    })
  })

  // --- getUser ---

  describe('getUser', () => {
    test('returns IdPUser when user is found', async () => {
      globalThis.fetch = asFetch(mock(() => Promise.resolve(listResponse([makeUser()]))))

      const user = await adapter.getUser(TEST_PUBKEY)

      expect(user).not.toBeNull()
      expect(user?.pubkey).toBe(TEST_PUBKEY)
      expect(user?.active).toBe(true)
      expect(user?.externalId).toBe('42')
    })

    test('returns null when user is not found', async () => {
      globalThis.fetch = asFetch(mock(() => Promise.resolve(listResponse([]))))

      const user = await adapter.getUser(TEST_PUBKEY)
      expect(user).toBeNull()
    })

    test('encodes pubkey in query string', async () => {
      const mockFetch = mock((url: string) => {
        expect(url).toContain(encodeURIComponent(TEST_PUBKEY))
        return Promise.resolve(listResponse([]))
      })
      globalThis.fetch = asFetch(mockFetch)

      await adapter.getUser(TEST_PUBKEY)
    })
  })

  // --- deleteUser ---

  describe('deleteUser', () => {
    test('looks up user then sends DELETE to /api/v3/core/users/:pk/', async () => {
      const calls: string[] = []
      globalThis.fetch = asFetch(
        mock((url: string, init?: RequestInit) => {
          calls.push(`${init?.method ?? 'GET'} ${url}`)
          if ((init?.method ?? 'GET') === 'GET') {
            return Promise.resolve(listResponse([makeUser()]))
          }
          return Promise.resolve(new Response(null, { status: 204 }))
        })
      )

      await adapter.deleteUser(TEST_PUBKEY)

      expect(calls).toHaveLength(2)
      expect(calls[1]).toBe('DELETE https://auth.example.com/api/v3/core/users/42/')
    })

    test('throws when user is not found', async () => {
      globalThis.fetch = asFetch(mock(() => Promise.resolve(listResponse([]))))

      await expect(adapter.deleteUser(TEST_PUBKEY)).rejects.toThrow('not found')
    })
  })

  // --- getNsecSecret ---

  describe('getNsecSecret', () => {
    test('decrypts and returns the nsec_secret (round-trip)', async () => {
      const secret = new Uint8Array(32).fill(0xab)

      // Access private method via cast for round-trip test
      const encrypted = (
        adapter as unknown as { encryptSecret(s: Uint8Array): string }
      ).encryptSecret(secret)
      const user = makeUser({ attributes: { nsec_secret: encrypted } })

      globalThis.fetch = asFetch(mock(() => Promise.resolve(listResponse([user]))))

      const result = await adapter.getNsecSecret(TEST_PUBKEY)
      expect(result).toEqual(secret)
    })

    test('throws when nsec_secret attribute is missing', async () => {
      globalThis.fetch = asFetch(
        mock(() => Promise.resolve(listResponse([makeUser({ attributes: {} })])))
      )

      await expect(adapter.getNsecSecret(TEST_PUBKEY)).rejects.toThrow('nsec_secret')
    })

    test('throws when user is not found', async () => {
      globalThis.fetch = asFetch(mock(() => Promise.resolve(listResponse([]))))

      await expect(adapter.getNsecSecret(TEST_PUBKEY)).rejects.toThrow('not found')
    })
  })

  // --- rotateNsecSecret ---

  describe('rotateNsecSecret', () => {
    test('returns current (new) and previous (old) secrets', async () => {
      const oldSecret = new Uint8Array(32).fill(0x11)
      const oldEncrypted = (
        adapter as unknown as { encryptSecret(s: Uint8Array): string }
      ).encryptSecret(oldSecret)

      let patchedAttributes: Record<string, string> | undefined

      globalThis.fetch = asFetch(
        mock((_url: string, init?: RequestInit) => {
          const method = init?.method ?? 'GET'
          if (method === 'GET') {
            return Promise.resolve(
              listResponse([makeUser({ attributes: { nsec_secret: oldEncrypted } })])
            )
          }
          // PATCH
          const body = JSON.parse(init?.body as string) as { attributes: Record<string, string> }
          patchedAttributes = body.attributes
          return Promise.resolve(jsonResponse(makeUser({ attributes: patchedAttributes })))
        })
      )

      const rotation = await adapter.rotateNsecSecret(TEST_PUBKEY)

      // previous should equal the old secret
      expect(rotation.previous).toEqual(oldSecret)
      // current should be a new 32-byte value (not equal to old)
      expect(rotation.current).toHaveLength(32)
      expect(rotation.current).not.toEqual(oldSecret)

      // PATCH should have written both new and previous
      expect(patchedAttributes?.nsec_secret).toBeString()
      expect(patchedAttributes?.previous_nsec_secret).toBe(oldEncrypted)
    })

    test('throws when no existing nsec_secret found', async () => {
      globalThis.fetch = asFetch(
        mock(() => Promise.resolve(listResponse([makeUser({ attributes: {} })])))
      )

      await expect(adapter.rotateNsecSecret(TEST_PUBKEY)).rejects.toThrow('nsec_secret')
    })
  })

  // --- confirmRotation ---

  describe('confirmRotation', () => {
    test('patches user to remove previous_nsec_secret', async () => {
      const oldEncrypted = 'nonce:ct'
      const newEncrypted = 'nonce2:ct2'
      const userWithBoth = makeUser({
        attributes: {
          nsec_secret: newEncrypted,
          previous_nsec_secret: oldEncrypted,
        },
      })

      let patchedAttributes: Record<string, string> | undefined

      globalThis.fetch = asFetch(
        mock((_url: string, init?: RequestInit) => {
          const method = init?.method ?? 'GET'
          if (method === 'GET') {
            return Promise.resolve(listResponse([userWithBoth]))
          }
          const body = JSON.parse(init?.body as string) as { attributes: Record<string, string> }
          patchedAttributes = body.attributes
          return Promise.resolve(jsonResponse(makeUser({ attributes: patchedAttributes })))
        })
      )

      await adapter.confirmRotation(TEST_PUBKEY)

      expect(patchedAttributes?.nsec_secret).toBe(newEncrypted)
      expect(patchedAttributes?.previous_nsec_secret).toBeUndefined()
    })
  })

  // --- refreshSession ---

  describe('refreshSession', () => {
    test('returns valid: true for active user', async () => {
      globalThis.fetch = asFetch(
        mock(() => Promise.resolve(listResponse([makeUser({ is_active: true })])))
      )

      const result = await adapter.refreshSession(TEST_PUBKEY)
      expect(result).toEqual({ valid: true })
    })

    test('returns valid: false for inactive user', async () => {
      globalThis.fetch = asFetch(
        mock(() => Promise.resolve(listResponse([makeUser({ is_active: false })])))
      )

      const result = await adapter.refreshSession(TEST_PUBKEY)
      expect(result).toEqual({ valid: false })
    })

    test('returns valid: false when user not found', async () => {
      globalThis.fetch = asFetch(mock(() => Promise.resolve(listResponse([]))))

      const result = await adapter.refreshSession(TEST_PUBKEY)
      expect(result).toEqual({ valid: false })
    })
  })

  // --- revokeSession / revokeAllSessions ---

  describe('revokeSession', () => {
    test('lists then deletes each Authentik session individually', async () => {
      const calls: string[] = []
      const SESSION_UUID = 'session-uuid-abc123'
      globalThis.fetch = asFetch(
        mock((url: string, init?: RequestInit) => {
          const method = init?.method ?? 'GET'
          calls.push(`${method} ${url}`)
          if (method === 'GET') {
            // Distinguish user lookup from session list by URL shape
            if (url.includes('authenticated-sessions')) {
              return Promise.resolve(listResponse([{ uuid: SESSION_UUID }]))
            }
            return Promise.resolve(listResponse([makeUser()]))
          }
          return Promise.resolve(new Response(null, { status: 204 }))
        })
      )

      await adapter.revokeSession(TEST_PUBKEY)

      // Call 1: user lookup GET
      // Call 2: session list GET
      // Call 3: DELETE individual session
      expect(calls).toHaveLength(3)
      expect(calls[0]).toContain('GET')
      expect(calls[1]).toContain('GET')
      expect(calls[1]).toContain('authenticated-sessions')
      expect(calls[2]).toContain('DELETE')
      expect(calls[2]).toContain(`authenticated-sessions/${SESSION_UUID}/`)
    })

    test('skips session deletion when session list is empty', async () => {
      const calls: string[] = []
      globalThis.fetch = asFetch(
        mock((url: string, init?: RequestInit) => {
          const method = init?.method ?? 'GET'
          calls.push(`${method} ${url}`)
          if (method === 'GET') {
            if (url.includes('authenticated-sessions')) {
              return Promise.resolve(listResponse([]))
            }
            return Promise.resolve(listResponse([makeUser()]))
          }
          return Promise.resolve(new Response(null, { status: 204 }))
        })
      )

      await adapter.revokeSession(TEST_PUBKEY)

      // Call 1: user lookup, Call 2: session list — no DELETE calls
      expect(calls).toHaveLength(2)
      expect(calls[1]).toContain('authenticated-sessions')
      expect(calls.some((c) => c.includes('DELETE'))).toBe(false)
    })

    test('does nothing when user not found', async () => {
      const calls: string[] = []
      globalThis.fetch = asFetch(
        mock((_url: string, init?: RequestInit) => {
          calls.push(init?.method ?? 'GET')
          return Promise.resolve(listResponse([]))
        })
      )

      await adapter.revokeSession(TEST_PUBKEY)

      // Only the lookup call — no delete
      expect(calls).toHaveLength(1)
      expect(calls[0]).toBe('GET')
    })
  })

  // --- createInviteLink ---

  describe('createInviteLink', () => {
    test('posts to invitations endpoint and returns invite URL', async () => {
      const invitePk = 'abc-123-uuid'
      globalThis.fetch = asFetch(
        mock(() =>
          Promise.resolve(
            jsonResponse({
              pk: invitePk,
              name: 'test-invite',
              expires: null,
              flow_slug: 'default-enrollment-flow',
              single_use: true,
            })
          )
        )
      )

      const url = await adapter.createInviteLink({
        createdBy: TEST_PUBKEY,
        expiresInMs: 86400000,
      })

      expect(url).toContain(invitePk)
      expect(url).toContain('default-enrollment-flow')
    })

    test('uses default expiry of 7 days when expiresInMs not provided', async () => {
      let postedBody: Record<string, unknown> | undefined

      globalThis.fetch = asFetch(
        mock((_url: string, init?: RequestInit) => {
          postedBody = JSON.parse(init?.body as string) as Record<string, unknown>
          return Promise.resolve(
            jsonResponse({
              pk: 'uuid-001',
              name: 'test',
              expires: null,
              flow_slug: 'default-enrollment-flow',
              single_use: true,
            })
          )
        })
      )

      await adapter.createInviteLink({ createdBy: TEST_PUBKEY })

      expect(postedBody?.expires).toBeString()
      // expires should be roughly 7 days from now
      const expiresDate = new Date(postedBody?.expires as string)
      const sevenDays = 7 * 24 * 60 * 60 * 1000
      expect(expiresDate.getTime()).toBeGreaterThan(Date.now() + sevenDays - 5000)
    })

    test('includes roles in fixed_data when provided', async () => {
      let postedBody: Record<string, unknown> | undefined

      globalThis.fetch = asFetch(
        mock((_url: string, init?: RequestInit) => {
          postedBody = JSON.parse(init?.body as string) as Record<string, unknown>
          return Promise.resolve(
            jsonResponse({ pk: 'x', name: 'y', expires: null, flow_slug: 'f', single_use: true })
          )
        })
      )

      await adapter.createInviteLink({ createdBy: TEST_PUBKEY, roles: ['volunteer'] })

      expect((postedBody?.fixed_data as { roles: string[] })?.roles).toEqual(['volunteer'])
    })
  })
})
