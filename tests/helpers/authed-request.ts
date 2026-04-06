/**
 * Headless authenticated request helper for API integration tests.
 *
 * Generates JWT auth tokens directly in Node/Bun, without needing a browser context.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { getPublicKey } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { signAccessToken } from '../../src/server/lib/jwt'

interface RequestOpts {
  headers?: Record<string, string>
}

export interface AuthedRequest {
  get(path: string, opts?: RequestOpts): Promise<APIResponse>
  post(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  put(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  patch(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  delete(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  /** The hex public key derived from the secret key */
  pubkey: string
}

/**
 * Create an authenticated request wrapper around Playwright's APIRequestContext.
 *
 * Uses JWT tokens signed with the test JWT_SECRET for authentication.
 *
 * @param request - Playwright's request fixture
 * @param secretKey - Nostr secret key as Uint8Array (32 bytes)
 * @param permissions - Optional permissions array (defaults to ['admin'])
 * @returns AuthedRequest with methods that auto-sign each request
 */
export function createAuthedRequest(
  request: APIRequestContext,
  secretKey: Uint8Array,
  permissions: string[] = ['*']
): AuthedRequest {
  const pubkey = getPublicKey(secretKey)
  // Use the same fallback as tests/helpers/index.ts — must match the server's JWT_SECRET.
  // Playwright worker processes do not inherit .env from Bun's startup, so we cannot
  // rely on process.env.JWT_SECRET being set in workers; use the dev fallback directly.
  const jwtSecret =
    process.env.JWT_SECRET || '0000000000000000000000000000000000000000000000000000000000000003'

  async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    const token = await signAccessToken({ pubkey, permissions }, jwtSecret, { expiresIn: '15m' })
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  return {
    pubkey,
    async get(path, opts?) {
      return request.get(path, { headers: await authHeaders(opts?.headers) })
    },
    async post(path, data?, opts?) {
      return request.post(path, {
        headers: await authHeaders(opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    async put(path, data?, opts?) {
      return request.put(path, {
        headers: await authHeaders(opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    async patch(path, data?, opts?) {
      return request.patch(path, {
        headers: await authHeaders(opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    async delete(path, data?, opts?) {
      return request.delete(path, {
        headers: await authHeaders(opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
  }
}

/**
 * Create an AuthedRequest from an nsec string.
 * Convenience wrapper for tests that have an nsec rather than raw bytes.
 */
export function createAuthedRequestFromNsec(
  request: APIRequestContext,
  nsec: string,
  permissions?: string[]
): AuthedRequest {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error(`Expected nsec, got ${decoded.type}`)
  return createAuthedRequest(request, decoded.data, permissions)
}

/**
 * Create an AuthedRequest from a hex pubkey directly (no secret key needed).
 * Signs JWTs using the test JWT_SECRET with the provided pubkey as subject.
 *
 * Useful when the admin's nsec is unknown (e.g., bootstrapped via real UI flow)
 * but the pubkey is available from storage state or refresh token.
 */
export function createAuthedRequestFromPubkey(
  request: APIRequestContext,
  pubkey: string,
  permissions: string[] = ['*']
): AuthedRequest {
  const jwtSecret =
    process.env.JWT_SECRET || '0000000000000000000000000000000000000000000000000000000000000003'

  async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    const token = await signAccessToken({ pubkey, permissions }, jwtSecret, { expiresIn: '15m' })
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  return {
    pubkey,
    async get(path, opts?) {
      return request.get(path, { headers: await authHeaders(opts?.headers) })
    },
    async post(path, data?, opts?) {
      return request.post(path, {
        headers: await authHeaders(opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    async put(path, data?, opts?) {
      return request.put(path, {
        headers: await authHeaders(opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    async patch(path, data?, opts?) {
      return request.patch(path, {
        headers: await authHeaders(opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    async delete(path, data?, opts?) {
      return request.delete(path, {
        headers: await authHeaders(opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
  }
}

/**
 * Extract admin pubkey from the stored admin.json storage state file.
 * Reads the refresh cookie JWT and decodes the `sub` claim (= admin pubkey).
 */
export function getAdminPubkeyFromStorageState(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  // Opaque refresh tokens don't carry the pubkey, so global-setup writes it
  // alongside admin.json during bootstrap.
  const pubkeyFilePath = path.resolve(__dirname, '..', 'storage', 'admin-pubkey.txt')
  if (fs.existsSync(pubkeyFilePath)) {
    const pubkey = fs.readFileSync(pubkeyFilePath, 'utf-8').trim()
    if (/^[0-9a-f]{64}$/.test(pubkey)) return pubkey
  }
  throw new Error(
    'Admin pubkey not found — tests/storage/admin-pubkey.txt missing or invalid. Re-run global-setup.'
  )
}

/**
 * Create an admin AuthedRequest from the stored admin.json storage state.
 * Extracts the admin's pubkey from the refresh cookie and creates a properly
 * signed JWT. Works for UI tests where the admin was bootstrapped via real
 * UI flow (not from a hardcoded nsec).
 */
export function createAdminApiFromStorageState(request: APIRequestContext): AuthedRequest {
  const pubkey = getAdminPubkeyFromStorageState()
  return createAuthedRequestFromPubkey(request, pubkey)
}

/**
 * Enroll a pubkey in Authentik via POST /api/auth/enroll.
 *
 * The enroll endpoint is idempotent — calling it twice for the same pubkey is safe.
 * Returns the hex-encoded nsecSecret assigned to the user in Authentik.
 *
 * @param adminApi - An AuthedRequest with `users:create` or `*` permission
 * @param pubkey - The hex pubkey of the user to enroll
 * @returns The hex-encoded nsecSecret
 */
export async function enrollInAuthentik(adminApi: AuthedRequest, pubkey: string): Promise<string> {
  const res = await adminApi.post('/api/auth/enroll', { pubkey })
  if (!res.ok()) {
    throw new Error(`Failed to enroll ${pubkey} in Authentik: ${res.status()} ${await res.text()}`)
  }
  const data = (await res.json()) as { nsecSecret: string }
  return data.nsecSecret
}
