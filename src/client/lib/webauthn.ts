/**
 * WebAuthn client-side helpers for passkey registration, login, and credential management.
 * Uses @simplewebauthn/browser for browser API interaction.
 * Auth is handled via the auth facade client (JWT access tokens).
 */

import { LABEL_KEK_PRF, LABEL_PRF_KEK_SALT_V1 } from '@shared/crypto-labels'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { authFacadeClient, type WebAuthnCredentialInfo } from './auth-facade-client'

/**
 * Thrown when a WebAuthn operation expected PRF support but the authenticator
 * or browser did not return a PRF evaluation. Callers use this to fall back
 * to OPAQUE / recovery-phrase unlock.
 */
export class PrfUnsupportedError extends Error {
  constructor(message = 'WebAuthn PRF extension not supported by this authenticator') {
    super(message)
    this.name = 'PrfUnsupportedError'
  }
}

// Re-export for consumers that import WebAuthnCredentialInfo from this module
export type { WebAuthnCredentialInfo } from './auth-facade-client'

/**
 * Check if WebAuthn is supported in this browser.
 */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  )
}

/**
 * Request WebAuthn PRF evaluation for KEK derivation.
 * Returns the PRF output (32 bytes) or null if PRF is not supported.
 */
export async function requestWebAuthnPRF(): Promise<Uint8Array | null> {
  if (!isWebAuthnAvailable()) return null

  try {
    const saltBytes = new TextEncoder().encode(LABEL_KEK_PRF)
    const salt: ArrayBuffer = saltBytes.buffer.slice(
      saltBytes.byteOffset,
      saltBytes.byteOffset + saltBytes.byteLength
    ) as ArrayBuffer
    const challengeBytes = new Uint8Array(32)
    crypto.getRandomValues(challengeBytes)
    const challenge: ArrayBuffer = challengeBytes.buffer.slice(0) as ArrayBuffer
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        extensions: {
          prf: { eval: { first: salt } },
        },
      },
    })) as PublicKeyCredential

    const results = credential.getClientExtensionResults() as Record<string, unknown>
    const prf = results.prf as { results?: { first?: ArrayBuffer } } | undefined
    if (!prf?.results?.first) return null

    return new Uint8Array(prf.results.first)
  } catch {
    return null
  }
}

/**
 * Register a new WebAuthn credential (passkey).
 * Requires existing auth (access token via auth facade client).
 */
export async function registerCredential(label: string): Promise<void> {
  // 1. Get registration options from server (authenticated)
  const optionsResponse = await authFacadeClient.getRegisterOptions()
  const { challengeId, ...optionsJSON } = optionsResponse

  // 2. Create credential via browser WebAuthn API
  const attestation = await startRegistration({ optionsJSON })

  // 3. Verify with server
  await authFacadeClient.verifyRegistration(attestation, label, challengeId)
}

/**
 * Register a WebAuthn credential with the PRF extension requested.
 *
 * Registration itself cannot evaluate PRF — authenticators only advertise PRF
 * support at create-time via `extensions.prf = {}`. Subsequent auth calls
 * (see `unlockPrfFromCredential`) perform the actual PRF evaluation with a
 * salt. The server verifies the attestation unchanged; the extension is
 * purely a client/authenticator signal.
 *
 * Throws `PrfUnsupportedError` if the authenticator does not confirm PRF
 * support in the client extension results. Callers must treat this as a
 * hard failure for PRF-primary onboarding and fall back to OPAQUE.
 */
async function _registerPrfCredential(label: string): Promise<void> {
  if (!isWebAuthnAvailable()) throw new PrfUnsupportedError('WebAuthn not available')

  const optionsResponse = await authFacadeClient.getRegisterOptions()
  const { challengeId, ...optionsJSON } = optionsResponse

  const optionsWithPrf = {
    ...optionsJSON,
    extensions: { ...(optionsJSON.extensions ?? {}), prf: {} },
  }

  const attestation = await startRegistration({ optionsJSON: optionsWithPrf })

  const clientExtensions = attestation.clientExtensionResults as Record<string, unknown> | undefined
  const prfResult = clientExtensions?.prf as { enabled?: boolean } | undefined
  if (!prfResult || prfResult.enabled !== true) {
    throw new PrfUnsupportedError('authenticator did not confirm PRF support during registration')
  }

  await authFacadeClient.verifyRegistration(attestation, label, challengeId)
}

/**
 * Evaluate the WebAuthn PRF extension against `LABEL_PRF_KEK_SALT_V1` to
 * derive stable 32 bytes of entropy bound to a registered authenticator.
 * The returned bytes are fed into HKDF (label: `LABEL_PRF_KEK_SALT_V1`) to
 * derive the per-factor wrapping key inside the crypto worker — this module
 * never holds the KEK itself.
 *
 * This call does NOT require a server challenge: it is a local crypto
 * primitive, not a login assertion. The main-thread caller should hand the
 * result to the crypto worker via `importFactorAsAesKw` and zero the
 * returned `Uint8Array` afterwards.
 *
 * Throws `PrfUnsupportedError` if the authenticator or browser cannot
 * produce a PRF output.
 */
export async function unlockPrfFromCredential(): Promise<Uint8Array> {
  if (!isWebAuthnAvailable()) throw new PrfUnsupportedError('WebAuthn not available')

  const saltBytes = new TextEncoder().encode(LABEL_PRF_KEK_SALT_V1)
  const salt: ArrayBuffer = saltBytes.buffer.slice(
    saltBytes.byteOffset,
    saltBytes.byteOffset + saltBytes.byteLength
  ) as ArrayBuffer
  const challengeBytes = new Uint8Array(32)
  crypto.getRandomValues(challengeBytes)
  const challenge: ArrayBuffer = challengeBytes.buffer.slice(0) as ArrayBuffer

  let credential: PublicKeyCredential
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        userVerification: 'required',
        extensions: { prf: { eval: { first: salt } } },
      },
    })) as PublicKeyCredential
  } catch (e) {
    throw new PrfUnsupportedError(`WebAuthn PRF assertion failed: ${(e as Error).message}`)
  }

  const results = credential.getClientExtensionResults() as Record<string, unknown>
  const prf = results.prf as { results?: { first?: ArrayBuffer } } | undefined
  if (!prf?.results?.first) {
    throw new PrfUnsupportedError('authenticator returned no PRF evaluation')
  }
  return new Uint8Array(prf.results.first)
}

/**
 * Login with a passkey. Returns access token + pubkey.
 * No auth required — uses discoverable credentials.
 */
export async function loginWithPasskey(): Promise<{ token: string; pubkey: string }> {
  // 1. Get authentication options from server (no auth needed)
  const optionsResponse = await authFacadeClient.getLoginOptions()
  const { challengeId, ...optionsJSON } = optionsResponse

  // 2. Authenticate via browser WebAuthn API
  const assertion = await startAuthentication({ optionsJSON })

  // 3. Verify with server — returns access token
  const { accessToken, pubkey } = await authFacadeClient.verifyLogin(assertion, challengeId)

  return { token: accessToken, pubkey }
}

/**
 * List registered credentials for the current user.
 */
export async function listCredentials(): Promise<WebAuthnCredentialInfo[]> {
  const { devices } = await authFacadeClient.listDevices()
  return devices
}

/**
 * Delete a registered credential.
 */
export async function deleteCredential(id: string): Promise<void> {
  await authFacadeClient.deleteDevice(id)
}
