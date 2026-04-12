import { hexToBytes } from '@noble/hashes/utils.js'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'
import { API_ORIGIN } from './api/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebAuthnCredentialInfo {
  id: string
  label: string
  backedUp: boolean
  createdAt: string
  lastUsedAt: string
  // E2EE envelope-encrypted label (Phase 2D)
  encryptedLabel?: string
  labelEnvelopes?: import('@shared/types').RecipientEnvelope[]
}

export interface UserInfo {
  pubkey: string
  nsecSecret: Uint8Array
  pendingRotation?: {
    previousNsecSecret: Uint8Array
  }
}

export interface DeviceListResponse {
  devices: WebAuthnCredentialInfo[]
  warning?: string
}

/** Login options extended with the server-issued challengeId */
export interface LoginOptionsResponse extends PublicKeyCredentialRequestOptionsJSON {
  challengeId: string
}

/** Registration options extended with the server-issued challengeId */
export interface RegisterOptionsResponse extends PublicKeyCredentialCreationOptionsJSON {
  challengeId: string
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AuthFacadeError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'AuthFacadeError'
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

class AuthFacadeClient {
  private accessToken: string | null = null

  constructor() {
    // Restore test JWT from sessionStorage (survives page reloads in E2E tests).
    // Safe in production: __TEST_JWT is never set outside of Playwright test runs.
    if (typeof sessionStorage !== 'undefined') {
      const testJwt = sessionStorage.getItem('__TEST_JWT')
      if (testJwt) this.accessToken = testJwt
    }
  }

  // --- Token management ---

  getAccessToken(): string | null {
    return this.accessToken
  }

  setAccessToken(token: string): void {
    this.accessToken = token
  }

  clearAccessToken(): void {
    this.accessToken = null
  }

  // --- Internal helpers ---

  private async authedFetch(path: string, opts: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) throw new AuthFacadeError(401, 'Not authenticated')
    return fetch(`${API_ORIGIN}${path}`, {
      credentials: 'include',
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${this.accessToken}`,
      },
    })
  }

  private static async assertOk(res: Response, message: string): Promise<void> {
    if (!res.ok) {
      let detail = message
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) detail = body.error
      } catch {
        // ignore parse failure
      }
      throw new AuthFacadeError(res.status, detail)
    }
  }

  // ---------------------------------------------------------------------------
  // Public routes (no auth required)
  // ---------------------------------------------------------------------------

  /**
   * Fetch WebAuthn login options from the server.
   * The returned object includes a `challengeId` that must be passed to `verifyLogin`.
   */
  async getLoginOptions(): Promise<LoginOptionsResponse> {
    const res = await fetch(`${API_ORIGIN}/api/auth/webauthn/login-options`, {
      method: 'POST',
      credentials: 'include',
    })
    await AuthFacadeClient.assertOk(res, 'Failed to get login options')
    return res.json() as Promise<LoginOptionsResponse>
  }

  /**
   * Submit a WebAuthn authentication assertion to the server.
   * Stores the returned access token in memory.
   *
   * @param assertion  The `AuthenticationResponseJSON` from `startAuthentication()`
   * @param challengeId  The challengeId returned by `getLoginOptions()`
   */
  async verifyLogin(
    assertion: AuthenticationResponseJSON,
    challengeId: string
  ): Promise<{ accessToken: string; pubkey: string }> {
    const res = await fetch(`${API_ORIGIN}/api/auth/webauthn/login-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion, challengeId }),
      credentials: 'include', // required for httpOnly refresh cookie
    })
    await AuthFacadeClient.assertOk(res, 'Login verification failed')
    const data = (await res.json()) as { accessToken: string; pubkey: string }
    this.accessToken = data.accessToken
    return data
  }

  /**
   * Validate an invite code.
   * Returns `{ valid: true, roles }` on success or `{ valid: false }` on failure.
   */
  async acceptInvite(code: string): Promise<{ valid: boolean; roles?: string[] }> {
    const res = await fetch(`${API_ORIGIN}/api/auth/invite/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      credentials: 'include',
    })
    if (!res.ok) {
      return { valid: false }
    }
    return res.json() as Promise<{ valid: boolean; roles?: string[] }>
  }

  // ---------------------------------------------------------------------------
  // Authenticated routes (require a valid access token)
  // ---------------------------------------------------------------------------

  /**
   * Fetch WebAuthn registration options for adding a new credential.
   * The returned object includes a `challengeId` that must be passed to `verifyRegistration`.
   */
  async getRegisterOptions(): Promise<RegisterOptionsResponse> {
    const res = await this.authedFetch('/api/auth/webauthn/register-options', { method: 'POST' })
    await AuthFacadeClient.assertOk(res, 'Failed to get register options')
    return res.json() as Promise<RegisterOptionsResponse>
  }

  /**
   * Submit a WebAuthn attestation to register a new credential.
   *
   * @param attestation  The `RegistrationResponseJSON` from `startRegistration()`
   * @param label        A human-readable label for the device (e.g. "iPhone 15")
   * @param challengeId  The challengeId returned by `getRegisterOptions()`
   */
  async verifyRegistration(
    attestation: RegistrationResponseJSON,
    label: string,
    challengeId: string
  ): Promise<void> {
    const res = await this.authedFetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify({ attestation, label, challengeId }),
    })
    await AuthFacadeClient.assertOk(res, 'Registration verification failed')
  }

  /**
   * Exchange the httpOnly refresh cookie for a new short-lived access token.
   * Stores the returned access token in memory.
   */
  async refreshToken(): Promise<{ accessToken: string }> {
    const res = await fetch(`${API_ORIGIN}/api/auth/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include', // required to send the httpOnly refresh cookie
    })
    await AuthFacadeClient.assertOk(res, 'Token refresh failed')
    const data = (await res.json()) as { accessToken: string }
    this.accessToken = data.accessToken
    return data
  }

  /**
   * Fetch the current user's pubkey and nsec secret (for KEK derivation).
   * Returns `null` if the request fails (e.g. token expired).
   */
  async getUserInfo(): Promise<UserInfo | null> {
    try {
      const res = await this.authedFetch('/api/auth/userinfo')
      if (!res.ok) return null
      const data = (await res.json()) as {
        pubkey: string
        nsecSecret: string
        pendingRotation?: { previousNsecSecret: string }
      }
      return {
        pubkey: data.pubkey,
        nsecSecret: hexToBytes(data.nsecSecret),
        pendingRotation: data.pendingRotation
          ? { previousNsecSecret: hexToBytes(data.pendingRotation.previousNsecSecret) }
          : undefined,
      }
    } catch {
      return null
    }
  }

  /**
   * Confirm that a key rotation has been completed client-side.
   * The server will discard the previous nsec secret after this call.
   */
  async confirmRotation(): Promise<void> {
    const res = await this.authedFetch('/api/auth/rotation/confirm', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    await AuthFacadeClient.assertOk(res, 'Failed to confirm rotation')
  }

  /**
   * Revoke the current session (clears the server-side session and the httpOnly refresh cookie).
   * Clears the in-memory access token.
   */
  async revokeSession(): Promise<void> {
    const res = await this.authedFetch('/api/auth/session/revoke', {
      method: 'POST',
      body: JSON.stringify({}),
      credentials: 'include', // required to clear the httpOnly refresh cookie
    })
    // Always clear the local token, even if the server call fails
    this.accessToken = null
    await AuthFacadeClient.assertOk(res, 'Failed to revoke session')
  }

  /**
   * List all WebAuthn credentials registered for the current user.
   * Returns an empty list (with no warning) if the request fails.
   */
  async listDevices(): Promise<DeviceListResponse> {
    try {
      const res = await this.authedFetch('/api/auth/devices')
      if (!res.ok) return { devices: [] }
      // Server returns `credentials`, normalise to `devices` for the client interface
      const data = (await res.json()) as {
        credentials: WebAuthnCredentialInfo[]
        warning?: string
      }
      return { devices: data.credentials, warning: data.warning }
    } catch {
      return { devices: [] }
    }
  }

  /**
   * Enroll a pubkey in the IdP (Authentik), creating the user and returning the
   * nsec secret used for KEK derivation. Requires an authenticated session.
   */
  async enroll(pubkey: string): Promise<{ nsecSecret: Uint8Array }> {
    const res = await this.authedFetch('/api/auth/enroll', {
      method: 'POST',
      body: JSON.stringify({ pubkey }),
    })
    await AuthFacadeClient.assertOk(res, 'Enrollment failed')
    const data = (await res.json()) as { nsecSecret: string }
    return { nsecSecret: hexToBytes(data.nsecSecret) }
  }

  /**
   * Delete a registered WebAuthn credential by its ID.
   */
  async deleteDevice(id: string): Promise<void> {
    const res = await this.authedFetch(`/api/auth/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    await AuthFacadeClient.assertOk(res, 'Failed to delete device')
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const authFacadeClient = new AuthFacadeClient()
