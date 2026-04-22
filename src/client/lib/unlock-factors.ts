import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
/**
 * Tagged-union unlock orchestration.
 *
 *  runUnlockFactor(factor) →
 *    1. derive a factor-specific raw key
 *    2. locate the matching envelope in the root-KEK bundle (IDB)
 *    3. ask the crypto worker to HKDF + AES-KW unwrap the root KEK
 *    4. worker is now in the Unlocked state
 *
 * The factor-specific derivation branch is the only thing that differs
 * between PRF / OPAQUE / recovery phrase / recovery group.
 */
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_OPAQUE_EXPORT_KEK } from '@shared/crypto-labels'
import type { RootKekEnvelope, RootKekEnvelopeBundle } from '@shared/schemas/root-kek-envelope'
import type { DicewarePhrase } from './recovery-phrase'
import { loadBundleFromIdb } from './root-kek-store'

// ---------------------------------------------------------------------------
// Factor discriminated union
// ---------------------------------------------------------------------------

export type UnlockFactor =
  | { type: 'prf'; credentialId?: string }
  | { type: 'opaque'; password: string; userIdentifier: string; purpose?: string }
  | { type: 'recoveryPhrase'; phrase: DicewarePhrase; salt: Uint8Array }
  | { type: 'recoveryGroup'; rootKekBytes: Uint8Array }

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NoMatchingEnvelopeError extends Error {
  constructor(factorType: string, factorId?: string) {
    super(`No matching envelope for ${factorType}${factorId ? `:${factorId}` : ''}`)
    this.name = 'NoMatchingEnvelopeError'
  }
}

/** @knipignore — error class for unlock factor failures; caught by future factor management UI */
export class FactorDerivationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FactorDerivationError'
  }
}

export class BundleMissingError extends Error {
  constructor() {
    super('root KEK bundle missing — re-enroll required')
    this.name = 'BundleMissingError'
  }
}

// ---------------------------------------------------------------------------
// Envelope lookup helper
// ---------------------------------------------------------------------------

function findEnvelope(
  bundle: RootKekEnvelopeBundle,
  factorType: RootKekEnvelope['factorType'],
  factorId?: string
): RootKekEnvelope {
  const env = bundle.envelopes.find(
    (e) => e.factorType === factorType && (factorId === undefined || e.factorId === factorId)
  )
  if (!env) throw new NoMatchingEnvelopeError(factorType, factorId)
  return env
}

// ---------------------------------------------------------------------------
// Factor-specific derivation → 32-byte hex + envelope matching
// ---------------------------------------------------------------------------

interface DerivedFactor {
  /** 32-byte factor key as hex, ready for rootKekUnwrap. */
  factorBytesHex: string
  /** Matched envelope from the bundle. */
  envelope: RootKekEnvelope
  /** Raw bytes to zero after use. */
  rawToZero: Uint8Array[]
}

async function derivePrf(
  bundle: RootKekEnvelopeBundle,
  factor: Extract<UnlockFactor, { type: 'prf' }>
): Promise<DerivedFactor> {
  const { unlockPrfFromCredential } = await import('./webauthn')
  const prfOutput = await unlockPrfFromCredential()

  // Find a PRF envelope — if credentialId is specified, match it; otherwise take the first PRF
  const env = findEnvelope(bundle, 'prf', factor.credentialId)

  return {
    factorBytesHex: bytesToHex(prfOutput),
    envelope: env,
    rawToZero: [prfOutput],
  }
}

async function deriveOpaque(
  bundle: RootKekEnvelopeBundle,
  factor: Extract<UnlockFactor, { type: 'opaque' }>
): Promise<DerivedFactor> {
  const { opaqueClient } = await import('./opaque-client')
  const purpose = factor.purpose ?? 'root-kek'
  const credentialIdentifier = `${factor.userIdentifier}:${purpose}`

  // Start login — client produces credential request
  const start = await opaqueClient.loginStart(factor.password)

  // Send credential request to server
  const { authFacadeClient } = await import('./auth-facade-client')
  const serverResp = await authFacadeClient.opaqueLoginStart({
    purpose,
    credentialIdentifier,
    credentialRequest: start.message,
  })

  // Finish login — client processes credential response
  const finish = await opaqueClient.loginFinish({
    stateBase64: start.state,
    password: factor.password,
    credentialResponseBase64: serverResp.credentialResponse,
  })

  // Confirm finalization on server
  await authFacadeClient.opaqueLoginFinish({
    sessionId: serverResp.sessionId,
    credentialFinalization: finish.message,
  })

  // HKDF exportKey → 32 bytes
  const derived = hkdf(
    sha256,
    finish.exportKey,
    new Uint8Array(0),
    utf8ToBytes(`${LABEL_OPAQUE_EXPORT_KEK}:opaque`),
    32
  )
  finish.exportKey.fill(0)
  finish.sessionKey.fill(0)

  const env = findEnvelope(bundle, 'opaque')

  return {
    factorBytesHex: bytesToHex(derived),
    envelope: env,
    rawToZero: [derived],
  }
}

async function deriveRecoveryPhrase(
  bundle: RootKekEnvelopeBundle,
  factor: Extract<UnlockFactor, { type: 'recoveryPhrase' }>
): Promise<DerivedFactor> {
  const { deriveRecoveryPhraseKekBytes } = await import('./recovery-phrase')
  const derived = deriveRecoveryPhraseKekBytes(factor.phrase, factor.salt)

  const env = findEnvelope(bundle, 'recoveryPhrase')

  return {
    factorBytesHex: bytesToHex(derived),
    envelope: env,
    rawToZero: [derived],
  }
}

function deriveRecoveryGroup(
  bundle: RootKekEnvelopeBundle,
  factor: Extract<UnlockFactor, { type: 'recoveryGroup' }>
): DerivedFactor {
  const env = findEnvelope(bundle, 'recoveryGroup')

  return {
    factorBytesHex: bytesToHex(factor.rootKekBytes),
    envelope: env,
    rawToZero: [factor.rootKekBytes],
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Unlock the root KEK using the given factor. On success, the crypto worker
 * holds the root KEK as a non-extractable AES-KW CryptoKey.
 *
 * Callers should invoke this in preference order: PRF → OPAQUE → recovery phrase.
 */
export async function runUnlockFactor(factor: UnlockFactor): Promise<void> {
  const bundle = await loadBundleFromIdb()
  if (!bundle) throw new BundleMissingError()

  let derived: DerivedFactor
  switch (factor.type) {
    case 'prf':
      derived = await derivePrf(bundle, factor)
      break
    case 'opaque':
      derived = await deriveOpaque(bundle, factor)
      break
    case 'recoveryPhrase':
      derived = await deriveRecoveryPhrase(bundle, factor)
      break
    case 'recoveryGroup':
      derived = deriveRecoveryGroup(bundle, factor)
      break
  }

  try {
    const { cryptoWorker } = await import('./crypto-worker-client')
    await cryptoWorker.rootKekUnwrap(
      derived.factorBytesHex,
      derived.envelope.hkdfSalt,
      derived.envelope.wrappedKey
    )
  } finally {
    // Zero all raw key material regardless of success/failure
    for (const buf of derived.rawToZero) buf.fill(0)
  }
}

/**
 * Determine which factor types are available in the current bundle.
 * Useful for the unlock UI to decide which options to present.
 */
export async function getAvailableFactorTypes(): Promise<Set<RootKekEnvelope['factorType']>> {
  const bundle = await loadBundleFromIdb()
  if (!bundle) return new Set()
  return new Set(bundle.envelopes.map((e) => e.factorType))
}

// Re-export for callers that need to catch PRF-unsupported specifically
/** @knipignore — PRF unsupported error re-export; used by WebAuthn factor registration (future UI) */
export { PrfUnsupportedError } from './webauthn'
