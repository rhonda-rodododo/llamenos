/**
 * Device enrollment state machines for adding a new device to a user's account.
 *
 * Two sides:
 * - **New device**: generates keypair → displays QR → receives primary's pubkey → SAS compare → enrolled
 * - **Primary device**: scans QR → SAS compare → wraps PUK → sends device_add → enrolled
 *
 * Both machines enforce valid state transitions and a 5-minute session expiry.
 */
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_DEVICE_ENROLLMENT_SAS } from '@shared/crypto-labels'
import { unbiasedSixDigitCode } from '@shared/crypto-primitives'
import type { DeviceKeypair } from '@shared/types'

import { generateDeviceKeypair, pubkeyToHex } from './device-identity'

// --- Types ---

export type EnrollmentState =
  | 'idle'
  | 'generating_keypair'
  | 'awaiting_qr'
  | 'sas_compare'
  | 'confirming'
  | 'enrolling'
  | 'enrolled'
  | 'failed'
  | 'expired'

export interface EnrollmentQrPayload {
  newDeviceSigningPubkey: string // hex
  newDeviceEncryptionPubkey: string // hex
  enrollmentNonce: string // hex (32 bytes)
  sessionId: string
}

export class InvalidTransitionError extends Error {
  constructor(from: EnrollmentState, to: EnrollmentState) {
    super(`Invalid enrollment transition: ${from} \u2192 ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

// --- SAS Code ---

/**
 * Derive a 6-digit SAS code from the new device's signing pubkey,
 * encryption pubkey, enrollment nonce, and the primary device's
 * signing pubkey. Both sides compute this independently.
 */
export function computeEnrollmentSAS(
  newSigningPub: string,
  newEncryptionPub: string,
  enrollmentNonce: string,
  primarySigningPub: string
): string {
  // Concatenate all inputs for the HKDF IKM
  const encoder = new TextEncoder()
  const ikm = encoder.encode(
    `${newSigningPub}:${newEncryptionPub}:${enrollmentNonce}:${primarySigningPub}`
  )
  const salt = encoder.encode(LABEL_DEVICE_ENROLLMENT_SAS)
  const info = encoder.encode('enrollment-sas')
  const sasBytes = hkdf(sha256, ikm, salt, info, 4)
  const code = unbiasedSixDigitCode(sasBytes)
  return `${code.slice(0, 3)} ${code.slice(3)}`
}

// --- QR Encoding ---

/** Encode an enrollment QR payload as base64url JSON. */
export function encodeEnrollmentQr(payload: EnrollmentQrPayload): string {
  const json = JSON.stringify(payload)
  // base64url encode
  const bytes = new TextEncoder().encode(json)
  let base64 = ''
  for (const byte of bytes) {
    base64 += String.fromCharCode(byte)
  }
  return btoa(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode a base64url-encoded enrollment QR payload. Throws on invalid data. */
export function decodeEnrollmentQr(encoded: string): EnrollmentQrPayload {
  // Restore standard base64
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) base64 += '='

  let json: string
  try {
    json = atob(base64)
  } catch {
    throw new Error('Invalid enrollment QR: not valid base64url')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid enrollment QR: not valid JSON')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('newDeviceSigningPubkey' in parsed) ||
    !('newDeviceEncryptionPubkey' in parsed) ||
    !('enrollmentNonce' in parsed) ||
    !('sessionId' in parsed)
  ) {
    throw new Error('Invalid enrollment QR: missing required fields')
  }

  const p = parsed as Record<string, unknown>
  if (
    typeof p.newDeviceSigningPubkey !== 'string' ||
    typeof p.newDeviceEncryptionPubkey !== 'string' ||
    typeof p.enrollmentNonce !== 'string' ||
    typeof p.sessionId !== 'string'
  ) {
    throw new Error('Invalid enrollment QR: fields must be strings')
  }

  // Validate hex format (64 hex chars = 32 bytes)
  const hexPattern = /^[0-9a-f]{64}$/
  if (!hexPattern.test(p.newDeviceSigningPubkey)) {
    throw new Error('Invalid enrollment QR: newDeviceSigningPubkey is not valid hex (32 bytes)')
  }
  if (!hexPattern.test(p.newDeviceEncryptionPubkey)) {
    throw new Error('Invalid enrollment QR: newDeviceEncryptionPubkey is not valid hex (32 bytes)')
  }
  if (!hexPattern.test(p.enrollmentNonce)) {
    throw new Error('Invalid enrollment QR: enrollmentNonce is not valid hex (32 bytes)')
  }

  return {
    newDeviceSigningPubkey: p.newDeviceSigningPubkey,
    newDeviceEncryptionPubkey: p.newDeviceEncryptionPubkey,
    enrollmentNonce: p.enrollmentNonce,
    sessionId: p.sessionId,
  }
}

// --- Session Expiry ---

const SESSION_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes

// --- New Device Enrollment Machine ---

export class NewDeviceEnrollmentMachine {
  private _state: EnrollmentState = 'idle'
  private _startedAt: number | null = null
  private _keypair: DeviceKeypair | null = null
  private _enrollmentNonce: string | null = null
  private _sessionId: string | null = null
  private _primarySigningPub: string | null = null
  private _primaryEncryptionPub: string | null = null
  private _failReason: string | null = null

  get state(): EnrollmentState {
    return this._state
  }

  get failReason(): string | null {
    return this._failReason
  }

  get keypair(): DeviceKeypair | null {
    return this._keypair
  }

  private checkExpiry(): void {
    if (
      this._startedAt !== null &&
      Date.now() - this._startedAt >= SESSION_EXPIRY_MS &&
      this._state !== 'enrolled' &&
      this._state !== 'failed' &&
      this._state !== 'expired'
    ) {
      this._state = 'expired'
    }
  }

  private transition(from: EnrollmentState | EnrollmentState[], to: EnrollmentState): void {
    this.checkExpiry()
    const allowed = Array.isArray(from) ? from : [from]
    if (!allowed.includes(this._state)) {
      throw new InvalidTransitionError(this._state, to)
    }
    this._state = to
  }

  /** Start enrollment: idle -> generating_keypair -> awaiting_qr */
  async start(): Promise<void> {
    this.transition('idle', 'generating_keypair')
    this._startedAt = Date.now()

    try {
      this._keypair = await generateDeviceKeypair({ isPaperKey: false })

      // Generate enrollment nonce (32 bytes)
      const nonce = new Uint8Array(32)
      crypto.getRandomValues(nonce)
      this._enrollmentNonce = bytesToHex(nonce)
      this._sessionId = crypto.randomUUID()

      this._state = 'awaiting_qr'
    } catch (err) {
      this._state = 'failed'
      this._failReason = err instanceof Error ? err.message : 'Keypair generation failed'
      throw err
    }
  }

  /** Get the QR payload for display. Only valid in awaiting_qr state. */
  getQrPayload(): EnrollmentQrPayload {
    this.checkExpiry()
    if (this._state !== 'awaiting_qr') {
      throw new InvalidTransitionError(this._state, 'awaiting_qr')
    }
    if (!this._keypair || !this._enrollmentNonce || !this._sessionId) {
      throw new Error('Enrollment state is inconsistent — keypair not generated')
    }
    return {
      newDeviceSigningPubkey: pubkeyToHex(this._keypair.signing.publicKey),
      newDeviceEncryptionPubkey: pubkeyToHex(this._keypair.encryption.publicKey),
      enrollmentNonce: this._enrollmentNonce,
      sessionId: this._sessionId,
    }
  }

  /** Receive the primary device's pubkeys. awaiting_qr -> sas_compare */
  receivePrimaryPubkey(encryptionPub: string, signingPub: string): void {
    this.transition('awaiting_qr', 'sas_compare')
    this._primaryEncryptionPub = encryptionPub
    this._primarySigningPub = signingPub
  }

  /** Get the SAS code for display. Only valid in sas_compare state. */
  getSasCode(): string {
    this.checkExpiry()
    if (this._state !== 'sas_compare') {
      throw new InvalidTransitionError(this._state, 'sas_compare')
    }
    if (!this._keypair || !this._enrollmentNonce || !this._primarySigningPub) {
      throw new Error('Enrollment state is inconsistent')
    }
    return computeEnrollmentSAS(
      pubkeyToHex(this._keypair.signing.publicKey),
      pubkeyToHex(this._keypair.encryption.publicKey),
      this._enrollmentNonce,
      this._primarySigningPub
    )
  }

  /** Confirm SAS match. sas_compare -> confirming */
  confirmSas(): void {
    this.transition('sas_compare', 'confirming')
  }

  /** Mark enrollment as complete. confirming -> enrolled */
  markEnrolled(): void {
    this.transition('confirming', 'enrolled')
  }

  /** Fail the enrollment from any non-terminal state. */
  fail(reason: string): void {
    this.checkExpiry()
    if (this._state === 'enrolled' || this._state === 'failed' || this._state === 'expired') {
      throw new InvalidTransitionError(this._state, 'failed')
    }
    this._failReason = reason
    this._state = 'failed'
  }
}

// --- Primary Device Enrollment Machine ---

export class PrimaryDeviceEnrollmentMachine {
  private _state: EnrollmentState = 'idle'
  private _startedAt: number | null = null
  private _myDeviceId: string | null = null
  private _qrPayload: EnrollmentQrPayload | null = null
  private _primarySigningPub: string | null = null
  private _failReason: string | null = null

  get state(): EnrollmentState {
    return this._state
  }

  get failReason(): string | null {
    return this._failReason
  }

  get myDeviceId(): string | null {
    return this._myDeviceId
  }

  get qrPayload(): EnrollmentQrPayload | null {
    return this._qrPayload
  }

  private checkExpiry(): void {
    if (
      this._startedAt !== null &&
      Date.now() - this._startedAt >= SESSION_EXPIRY_MS &&
      this._state !== 'enrolled' &&
      this._state !== 'failed' &&
      this._state !== 'expired'
    ) {
      this._state = 'expired'
    }
  }

  private transition(from: EnrollmentState | EnrollmentState[], to: EnrollmentState): void {
    this.checkExpiry()
    const allowed = Array.isArray(from) ? from : [from]
    if (!allowed.includes(this._state)) {
      throw new InvalidTransitionError(this._state, to)
    }
    this._state = to
  }

  /** Start enrollment. idle -> awaiting_qr */
  start(myDeviceId: string, primarySigningPub: string): void {
    this.transition('idle', 'awaiting_qr')
    this._myDeviceId = myDeviceId
    this._primarySigningPub = primarySigningPub
    this._startedAt = Date.now()
  }

  /** Receive and validate QR payload from new device. awaiting_qr -> sas_compare */
  receiveQr(payload: EnrollmentQrPayload): void {
    this.transition('awaiting_qr', 'sas_compare')
    this._qrPayload = payload
  }

  /** Get the SAS code for display. Only valid in sas_compare state. */
  getSasCode(): string {
    this.checkExpiry()
    if (this._state !== 'sas_compare') {
      throw new InvalidTransitionError(this._state, 'sas_compare')
    }
    if (!this._qrPayload || !this._primarySigningPub) {
      throw new Error('Enrollment state is inconsistent')
    }
    return computeEnrollmentSAS(
      this._qrPayload.newDeviceSigningPubkey,
      this._qrPayload.newDeviceEncryptionPubkey,
      this._qrPayload.enrollmentNonce,
      this._primarySigningPub
    )
  }

  /** Confirm SAS match. sas_compare -> enrolling */
  confirmSas(): void {
    this.transition('sas_compare', 'enrolling')
  }

  /** Mark enrollment as complete. enrolling -> enrolled */
  markEnrolled(): void {
    this.transition('enrolling', 'enrolled')
  }

  /** Fail the enrollment from any non-terminal state. */
  fail(reason: string): void {
    this.checkExpiry()
    if (this._state === 'enrolled' || this._state === 'failed' || this._state === 'expired') {
      throw new InvalidTransitionError(this._state, 'failed')
    }
    this._failReason = reason
    this._state = 'failed'
  }
}
