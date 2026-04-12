/**
 * TypeScript wrapper around `@serenity-kit/opaque`.
 *
 * - Awaits the library's WASM `ready` promise before any operation.
 * - Surfaces a typed, promise-shaped client and server API that matches the
 *   OPAQUE protocol stages, so callers never touch the library directly.
 * - All wire values are opaque base64url strings (no Uint8Array conversions
 *   needed — the library handles encoding internally).
 *
 * Export key handling:
 *   The library produces a hex-encoded export key. For KEK derivation we
 *   convert to Uint8Array (32 bytes) so the crypto worker can HKDF it into
 *   a non-extractable AES-KW CryptoKey. The hex string is never persisted.
 *
 * Security:
 *   - This module NEVER logs, persists, or returns the raw password.
 *   - The export key is returned to the caller and must be zeroed after use.
 *   - Session keys are discarded server-side immediately after validation.
 */

import { client, ready, server } from '@serenity-kit/opaque'

// ---------------------------------------------------------------------------
// Base64url → Uint8Array (for export key / session key conversion).
// The library returns opaque strings that happen to be base64url-encoded.
// ---------------------------------------------------------------------------

function decodeBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---------------------------------------------------------------------------
// One-time initialization.
// ---------------------------------------------------------------------------

let initialized = false

async function ensureReady(): Promise<void> {
  if (!initialized) {
    await ready
    initialized = true
  }
}

// ---------------------------------------------------------------------------
// Typed client API.
// ---------------------------------------------------------------------------

export interface ClientStart {
  /** Ephemeral opaque client state — must be held in memory only. */
  state: string
  /** First protocol message to send to the server. */
  message: string
}

export interface ClientRegistrationFinish {
  /** Final registration record (= "password file") for the server. */
  message: string
  /** 64-byte export key — local, never sent. */
  exportKey: Uint8Array
  /** Long-term server static public key (for client-side pinning). */
  serverStaticPk: Uint8Array
}

export interface ClientLoginFinish {
  /** Credential finalization to send back to the server. */
  message: string
  /** 64-byte session key — bound to this login only. */
  sessionKey: Uint8Array
  /** 64-byte export key — local, never sent. */
  exportKey: Uint8Array
  /** Long-term server static public key. */
  serverStaticPk: Uint8Array
}

export interface ServerStart {
  /** Ephemeral opaque server state — keep in memory only. */
  state: string
  /** Message to return to the client. */
  message: string
}

export interface ServerLoginFinish {
  /** 64-byte session key for the completed handshake. */
  sessionKey: Uint8Array
}

export const opaqueClient = {
  async registrationStart(password: string): Promise<ClientStart> {
    await ensureReady()
    const { clientRegistrationState, registrationRequest } = client.startRegistration({ password })
    return { state: clientRegistrationState, message: registrationRequest }
  },

  async registrationFinish(params: {
    stateBase64: string
    password: string
    registrationResponseBase64: string
  }): Promise<ClientRegistrationFinish> {
    await ensureReady()
    const { registrationRecord, exportKey, serverStaticPublicKey } = client.finishRegistration({
      clientRegistrationState: params.stateBase64,
      registrationResponse: params.registrationResponseBase64,
      password: params.password,
    })
    return {
      message: registrationRecord,
      exportKey: decodeBase64Url(exportKey),
      serverStaticPk: decodeBase64Url(serverStaticPublicKey),
    }
  },

  async loginStart(password: string): Promise<ClientStart> {
    await ensureReady()
    const { clientLoginState, startLoginRequest } = client.startLogin({ password })
    return { state: clientLoginState, message: startLoginRequest }
  },

  async loginFinish(params: {
    stateBase64: string
    password: string
    credentialResponseBase64: string
  }): Promise<ClientLoginFinish> {
    await ensureReady()
    const result = client.finishLogin({
      clientLoginState: params.stateBase64,
      loginResponse: params.credentialResponseBase64,
      password: params.password,
    })
    if (!result) {
      throw new Error('OPAQUE login failed — password mismatch')
    }
    return {
      message: result.finishLoginRequest,
      sessionKey: decodeBase64Url(result.sessionKey),
      exportKey: decodeBase64Url(result.exportKey),
      serverStaticPk: decodeBase64Url(result.serverStaticPublicKey),
    }
  },
}

// ---------------------------------------------------------------------------
// Typed server API.
// ---------------------------------------------------------------------------

export const opaqueServer = {
  async createSetup(): Promise<string> {
    await ensureReady()
    return server.createSetup()
  },

  async createRegistrationResponse(params: {
    setupBase64: string
    registrationRequestBase64: string
    credentialIdentifier: string
  }): Promise<string> {
    await ensureReady()
    const { registrationResponse } = server.createRegistrationResponse({
      serverSetup: params.setupBase64,
      userIdentifier: params.credentialIdentifier,
      registrationRequest: params.registrationRequestBase64,
    })
    return registrationResponse
  },

  /**
   * In `@serenity-kit/opaque` the client's `finishRegistration` produces
   * the `registrationRecord` (= password file) directly. There is no
   * separate server-side step. This method is a pass-through that returns
   * the upload unchanged, preserving the interface the server routes expect.
   */
  async finishRegistration(params: { uploadBase64: string }): Promise<string> {
    await ensureReady()
    return params.uploadBase64
  },

  async startLogin(params: {
    setupBase64: string
    passwordFileBase64: string
    credentialRequestBase64: string
    credentialIdentifier: string
  }): Promise<ServerStart> {
    await ensureReady()
    const { serverLoginState, loginResponse } = server.startLogin({
      serverSetup: params.setupBase64,
      registrationRecord: params.passwordFileBase64,
      startLoginRequest: params.credentialRequestBase64,
      userIdentifier: params.credentialIdentifier,
    })
    return { state: serverLoginState, message: loginResponse }
  },

  async finishLogin(params: {
    stateBase64: string
    credentialFinalizationBase64: string
  }): Promise<ServerLoginFinish> {
    await ensureReady()
    const { sessionKey } = server.finishLogin({
      serverLoginState: params.stateBase64,
      finishLoginRequest: params.credentialFinalizationBase64,
    })
    return { sessionKey: decodeBase64Url(sessionKey) }
  },
}

// ---------------------------------------------------------------------------
// Base64url helpers (for opaque-wrapper.ts consumers).
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const opaqueEncoding = {
  bytesToBase64Url,
  base64UrlToBytes,
}
