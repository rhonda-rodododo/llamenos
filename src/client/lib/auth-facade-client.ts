import { hexToBytes } from '@noble/hashes/utils.js'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

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
    return fetch(path, {
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
    const res = await fetch('/api/auth/webauthn/login-options', { method: 'POST' })
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
    const res = await fetch('/api/auth/webauthn/login-verify', {
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
    const res = await fetch('/api/auth/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
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
    const res = await fetch('/api/auth/token/refresh', {
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

  // ---------------------------------------------------------------------------
  // Signal contact endpoints
  // ---------------------------------------------------------------------------

  async getSignalContact(): Promise<{
    contact: {
      identifierHash: string
      identifierCiphertext: string
      identifierEnvelope: import('@shared/types').RecipientEnvelope[]
      identifierType: 'phone' | 'username'
      verifiedAt: string | null
      updatedAt: string
    } | null
  }> {
    const res = await this.authedFetch('/api/auth/signal-contact')
    await AuthFacadeClient.assertOk(res, 'Failed to get signal contact')
    return res.json() as Promise<{
      contact: {
        identifierHash: string
        identifierCiphertext: string
        identifierEnvelope: import('@shared/types').RecipientEnvelope[]
        identifierType: 'phone' | 'username'
        verifiedAt: string | null
        updatedAt: string
      } | null
    }>
  }

  async getSignalContactHmacKey(): Promise<{ key: string }> {
    const res = await this.authedFetch('/api/auth/signal-contact/hmac-key')
    await AuthFacadeClient.assertOk(res, 'Failed to get HMAC key')
    return res.json() as Promise<{ key: string }>
  }

  async registerSignalContact(body: {
    identifierHash: string
    identifierCiphertext: string
    identifierEnvelope: import('@shared/types').RecipientEnvelope[]
    identifierType: 'phone' | 'username'
    plaintextIdentifier: string
  }): Promise<{ ok: true }> {
    const res = await this.authedFetch('/api/auth/signal-contact', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await AuthFacadeClient.assertOk(res, 'Failed to register signal contact')
    return res.json() as Promise<{ ok: true }>
  }

  async deleteSignalContact(): Promise<{ ok: true }> {
    const res = await this.authedFetch('/api/auth/signal-contact', {
      method: 'DELETE',
    })
    await AuthFacadeClient.assertOk(res, 'Failed to delete signal contact')
    return res.json() as Promise<{ ok: true }>
  }

  // ---------------------------------------------------------------------------
  // Security prefs endpoints
  // ---------------------------------------------------------------------------

  async getSecurityPrefs(): Promise<{
    autoLockMs: number
    disappearingTimerDays: number
    digestCadence: string
    alertOnNewDevice: boolean
    alertOnPasskeyChange: boolean
    alertOnPinChange: boolean
    notificationChannel: string
  }> {
    const res = await this.authedFetch('/api/auth/security-prefs')
    await AuthFacadeClient.assertOk(res, 'Failed to get security prefs')
    return res.json() as Promise<{
      autoLockMs: number
      disappearingTimerDays: number
      digestCadence: string
      alertOnNewDevice: boolean
      alertOnPasskeyChange: boolean
      alertOnPinChange: boolean
      notificationChannel: string
    }>
  }

  async updateSecurityPrefs(
    patch: Partial<{
      autoLockMs: number
      disappearingTimerDays: number
      digestCadence: string
      alertOnNewDevice: boolean
      alertOnPasskeyChange: boolean
      alertOnPinChange: boolean
      notificationChannel: string
    }>
  ): Promise<{
    autoLockMs: number
    disappearingTimerDays: number
    digestCadence: string
    alertOnNewDevice: boolean
    alertOnPasskeyChange: boolean
    alertOnPinChange: boolean
    notificationChannel: string
  }> {
    const res = await this.authedFetch('/api/auth/security-prefs', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    await AuthFacadeClient.assertOk(res, 'Failed to update security prefs')
    return res.json() as Promise<{
      autoLockMs: number
      disappearingTimerDays: number
      digestCadence: string
      alertOnNewDevice: boolean
      alertOnPasskeyChange: boolean
      alertOnPinChange: boolean
      notificationChannel: string
    }>
  }

  // ---------------------------------------------------------------------------
  // OPAQUE endpoints (Tier 2)
  //
  // Routes live under /api/opaque/* (authenticated router), NOT /api/auth/*.
  // Request/response shapes match src/shared/schemas/opaque.ts.
  // ---------------------------------------------------------------------------

  /**
   * Start an OPAQUE registration handshake. The server creates a registration
   * response against the purpose's ServerSetup.
   */
  async opaqueRegisterStart(params: {
    purpose: string
    credentialIdentifier: string
    registrationRequest: string
  }): Promise<{ sessionId: string; registrationResponse: string }> {
    const res = await this.authedFetch('/api/opaque/registration/start', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    await AuthFacadeClient.assertOk(res, 'OPAQUE register start failed')
    return res.json() as Promise<{ sessionId: string; registrationResponse: string }>
  }

  /**
   * Finish an OPAQUE registration handshake. The server stores the password file.
   */
  async opaqueRegisterFinish(params: {
    sessionId: string
    credentialIdentifier: string
    registrationUpload: string
  }): Promise<void> {
    const res = await this.authedFetch('/api/opaque/registration/finish', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    await AuthFacadeClient.assertOk(res, 'OPAQUE register finish failed')
  }

  /**
   * Start an OPAQUE login handshake. Sends the client's credential request
   * to the server and returns the server's credential response.
   */
  async opaqueLoginStart(params: {
    purpose: string
    credentialIdentifier: string
    credentialRequest: string
  }): Promise<{ sessionId: string; credentialResponse: string }> {
    const res = await this.authedFetch('/api/opaque/login/start', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    await AuthFacadeClient.assertOk(res, 'OPAQUE login start failed')
    return res.json() as Promise<{ sessionId: string; credentialResponse: string }>
  }

  /**
   * Finish an OPAQUE login handshake. Sends the client's credential finalization
   * to the server for session-key confirmation.
   */
  async opaqueLoginFinish(params: {
    sessionId: string
    credentialFinalization: string
  }): Promise<void> {
    const res = await this.authedFetch('/api/opaque/login/finish', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    await AuthFacadeClient.assertOk(res, 'OPAQUE login finish failed')
  }

  // ---------------------------------------------------------------------------
  // Recovery phrase endpoints (Tier 2)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the recovery phrase metadata (salt, KDF params) for the current user.
   * Used by the unlock orchestrator to derive the recovery-phrase KEK.
   */
  async getRecoveryPhraseMeta(): Promise<{
    salt: string
    kdfParams: { algo: string; t: number; m: number; p: number }
  }> {
    const res = await this.authedFetch('/api/auth/recovery-phrase/meta')
    await AuthFacadeClient.assertOk(res, 'Failed to get recovery phrase metadata')
    return res.json() as Promise<{
      salt: string
      kdfParams: { algo: string; t: number; m: number; p: number }
    }>
  }

  /**
   * Store (or rotate) the recovery phrase metadata. Called during enrollment
   * or recovery phrase rotation. The phrase itself is never sent to the server —
   * only the Argon2id salt + KDF params.
   */
  async setRecoveryPhraseMeta(params: {
    salt: string
    kdfParams: { algo: string; t: number; m: number; p: number }
  }): Promise<void> {
    const res = await this.authedFetch('/api/auth/recovery-phrase/meta', {
      method: 'PUT',
      body: JSON.stringify(params),
    })
    await AuthFacadeClient.assertOk(res, 'Failed to set recovery phrase metadata')
  }

  // ---------------------------------------------------------------------------
  // Root-KEK envelope endpoints (Tier 2)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Recovery Group endpoints (Tier 2 PR-C)
  // ---------------------------------------------------------------------------

  async recoveryGroupEnroll(body: {
    hubId: string
    threshold: number
    totalShares: number
    groupPublicKey: string
    shareEnvelopes: { adminPubkey: string; envelope: string }[]
    shareCommitments: string[]
  }): Promise<{ ok: true }> {
    const res = await this.authedFetch('/api/auth/recovery-group/enroll', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await AuthFacadeClient.assertOk(res, 'Recovery group enrollment failed')
    return res.json() as Promise<{ ok: true }>
  }

  async recoveryGroupGetInfo(hubId: string): Promise<{
    hubId: string
    groupPublicKey: string
    threshold: number
    totalShares: number
    shareCommitments: string[]
    createdAt: string
    rotatedAt: string | null
  } | null> {
    try {
      const res = await this.authedFetch(`/api/auth/recovery-group/${encodeURIComponent(hubId)}`)
      if (res.status === 404) return null
      await AuthFacadeClient.assertOk(res, 'Failed to get recovery group info')
      return res.json() as Promise<{
        hubId: string
        groupPublicKey: string
        threshold: number
        totalShares: number
        shareCommitments: string[]
        createdAt: string
        rotatedAt: string | null
      }>
    } catch {
      return null
    }
  }

  async recoveryGroupInitiate(body: {
    hubId: string
    userIdentifier: string
    newDevicePubkey: string
  }): Promise<{ sessionId: string; expiresAt: string; coordinatorPubkey: string }> {
    const res = await fetch('/api/auth/recovery-group/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await AuthFacadeClient.assertOk(res, 'Recovery group initiation failed')
    return res.json() as Promise<{
      sessionId: string
      expiresAt: string
      coordinatorPubkey: string
    }>
  }

  async recoveryGroupContributeShare(body: {
    sessionId: string
    encryptedShare: string
  }): Promise<{ ok: true; status: string; contributionCount: number }> {
    const res = await this.authedFetch('/api/auth/recovery-group/contribute-share', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await AuthFacadeClient.assertOk(res, 'Share contribution failed')
    return res.json() as Promise<{ ok: true; status: string; contributionCount: number }>
  }

  async recoveryGroupGetSession(sessionId: string): Promise<{
    sessionId: string
    hubId: string
    status: string
    contributionCount: number
    threshold: number
    createdAt: string
    expiresAt: string
    delayRemainingMs: number
  } | null> {
    const res = await fetch(`/api/auth/recovery-group/session/${encodeURIComponent(sessionId)}`)
    if (res.status === 404) return null
    await AuthFacadeClient.assertOk(res, 'Failed to fetch recovery session')
    return res.json() as Promise<{
      sessionId: string
      hubId: string
      status: string
      contributionCount: number
      threshold: number
      createdAt: string
      expiresAt: string
      delayRemainingMs: number
    }>
  }

  async recoveryGroupComplete(body: {
    sessionId: string
    newBundle: unknown
    emergencyOverride?: {
      justification: string
      coApproverPubkey: string
      coApproverSignature: string
    }
  }): Promise<{ ok: true }> {
    const res = await fetch('/api/auth/recovery-group/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await AuthFacadeClient.assertOk(res, 'Recovery completion failed')
    return res.json() as Promise<{ ok: true }>
  }

  async recoveryGroupPutUserEnvelope(body: {
    hubId: string
    envelope: string
  }): Promise<{ ok: true }> {
    const res = await this.authedFetch('/api/auth/recovery-group/user-envelope', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await AuthFacadeClient.assertOk(res, 'Failed to store recovery envelope')
    return res.json() as Promise<{ ok: true }>
  }

  // ---------------------------------------------------------------------------
  // Root-KEK envelope endpoints (Tier 2)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the root-KEK envelope bundle from the server. Returns null if no
   * bundle is stored yet (first-time enrollment).
   */
  async getRootKekBundle(): Promise<unknown | null> {
    try {
      const res = await this.authedFetch('/api/auth/root-kek/bundle')
      if (res.status === 404) return null
      await AuthFacadeClient.assertOk(res, 'Failed to get root-KEK bundle')
      return res.json()
    } catch {
      return null
    }
  }

  /**
   * Persist the root-KEK envelope bundle on the server. Overwrites any
   * existing bundle. The bundle is also stored in IDB client-side.
   */
  async putRootKekBundle(bundle: unknown): Promise<void> {
    const res = await this.authedFetch('/api/auth/root-kek/bundle', {
      method: 'PUT',
      body: JSON.stringify(bundle),
    })
    await AuthFacadeClient.assertOk(res, 'Failed to store root-KEK bundle')
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const authFacadeClient = new AuthFacadeClient()
