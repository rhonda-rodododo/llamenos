import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { WebAuthnCredential } from '../types'

export interface WebAuthnExtensionOptions {
  /**
   * When true, advertise the WebAuthn PRF extension during registration.
   * The authenticator replies with `clientExtensionResults.prf.enabled` so
   * the client can decide whether PRF-primary unlock is available for this
   * credential. The server does not consume the PRF output at registration.
   */
  prf?: boolean
}

export async function generateRegOptions(
  user: { pubkey: string; name: string },
  existingCreds: WebAuthnCredential[],
  rpID: string,
  rpName: string,
  options: WebAuthnExtensionOptions = {}
) {
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.name || user.pubkey.slice(0, 16),
    userID: new TextEncoder().encode(user.pubkey) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: existingCreds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[],
    })),
    // PRF is a WebAuthn Level 3 extension — lib.dom's
    // AuthenticationExtensionsClientInputs does not yet declare it, but
    // @simplewebauthn/server passes the extensions object through verbatim.
    extensions: options.prf ? ({ prf: {} } as AuthenticationExtensionsClientInputs) : undefined,
  })
}

export async function verifyRegResponse(
  response: any,
  challenge: string,
  origin: string,
  rpID: string
): Promise<VerifiedRegistrationResponse> {
  return verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  })
}

export interface WebAuthnAuthOptions {
  /**
   * When provided, request a PRF evaluation with this salt during the
   * WebAuthn assertion. The authenticator returns 32 stable bytes that the
   * client feeds into HKDF to derive the PRF KEK. Must be exactly 32 bytes
   * of domain-separated salt (e.g. HKDF of `LABEL_PRF_KEK_SALT_V1`).
   */
  prfSalt?: Uint8Array
}

export async function generateAuthOptions(
  credentials: WebAuthnCredential[],
  rpID: string,
  options: WebAuthnAuthOptions = {}
) {
  return generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials:
      credentials.length > 0
        ? credentials.map((c) => ({
            id: c.id,
            transports: c.transports as AuthenticatorTransport[],
          }))
        : undefined,
    // PRF is a WebAuthn Level 3 extension — see generateRegOptions for the
    // reason we cast.
    extensions: options.prfSalt
      ? ({
          prf: { eval: { first: options.prfSalt } },
        } as AuthenticationExtensionsClientInputs)
      : undefined,
  })
}

export async function verifyAuthResponse(
  response: any,
  credential: WebAuthnCredential,
  challenge: string,
  origin: string,
  rpID: string
): Promise<VerifiedAuthenticationResponse> {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credential.id,
      publicKey: new Uint8Array(
        base64URLToUint8Array(credential.publicKey).buffer
      ) as Uint8Array<ArrayBuffer>,
      counter: credential.counter,
      transports: credential.transports as AuthenticatorTransport[],
    },
  })
}

function base64URLToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(base64 + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
