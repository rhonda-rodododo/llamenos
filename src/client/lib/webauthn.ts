/**
 * WebAuthn client-side helpers for admin step-up authentication.
 *
 * Uses @simplewebauthn/browser for registration and authentication flows.
 */

import { startRegistration, startAuthentication } from '@simplewebauthn/browser'

const API_BASE = '/api'

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  // Import auth header dynamically to avoid circular deps
  const { getInMemoryKeyPair } = await import('./key-memory')
  const { createAuthToken } = await import('./crypto')
  const keyPair = getInMemoryKeyPair()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (keyPair) {
    headers['Authorization'] = `Bearer ${createAuthToken(keyPair.secretKey, Date.now())}`
  }
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: 'Request failed' })) as { error?: string }
    throw new Error(errBody.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface StoredCredential {
  id: string
  label: string
  deviceType: string
  backedUp: boolean
  createdAt: string
  transports?: string[]
}

/**
 * Register a new WebAuthn credential (security key or biometric).
 */
export async function registerCredential(label: string): Promise<StoredCredential> {
  // 1. Get registration options from server
  const options = await fetchJson<Record<string, unknown>>('/webauthn/register/options', {
    method: 'POST',
    body: JSON.stringify({ label }),
  })

  // 2. Start registration in browser (triggers biometric/security key dialog)
  const attResp = await startRegistration({ optionsJSON: options as unknown as Parameters<typeof startRegistration>[0]['optionsJSON'] })

  // 3. Send attestation response to server for verification
  const result = await fetchJson<{ verified: boolean; credential: StoredCredential }>('/webauthn/register/verify', {
    method: 'POST',
    body: JSON.stringify({ response: attResp, label }),
  })

  return result.credential
}

/**
 * Authenticate with an existing WebAuthn credential (step-up auth).
 */
export async function authenticateWithCredential(): Promise<boolean> {
  // 1. Get authentication options from server
  const options = await fetchJson<Record<string, unknown>>('/webauthn/authenticate/options', {
    method: 'POST',
    body: JSON.stringify({}),
  })

  // 2. Start authentication in browser
  const asseResp = await startAuthentication({ optionsJSON: options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'] })

  // 3. Send assertion response to server for verification
  const result = await fetchJson<{ verified: boolean }>('/webauthn/authenticate/verify', {
    method: 'POST',
    body: JSON.stringify({ response: asseResp }),
  })

  return result.verified
}

/**
 * List registered credentials for the current user.
 */
export async function listCredentials(): Promise<StoredCredential[]> {
  const result = await fetchJson<{ credentials: StoredCredential[] }>('/webauthn/credentials')
  return result.credentials
}

/**
 * Delete a registered credential.
 */
export async function deleteCredential(credentialId: string): Promise<void> {
  await fetchJson(`/webauthn/credentials/${encodeURIComponent(credentialId)}`, {
    method: 'DELETE',
  })
}

/**
 * Check if WebAuthn is supported in this browser.
 */
export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
}
