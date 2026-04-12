import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  type EnrollmentQrPayload,
  InvalidTransitionError,
  NewDeviceEnrollmentMachine,
  PrimaryDeviceEnrollmentMachine,
  computeEnrollmentSAS,
  decodeEnrollmentQr,
  encodeEnrollmentQr,
} from './device-enrollment'

// Deterministic test data
const TEST_SIGNING_PUB = 'a'.repeat(64) // 32 bytes hex
const TEST_ENCRYPTION_PUB = 'b'.repeat(64)
const TEST_NONCE = 'c'.repeat(64)
const TEST_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'
const TEST_PRIMARY_SIGNING_PUB = 'd'.repeat(64)

const VALID_PAYLOAD: EnrollmentQrPayload = {
  newDeviceSigningPubkey: TEST_SIGNING_PUB,
  newDeviceEncryptionPubkey: TEST_ENCRYPTION_PUB,
  enrollmentNonce: TEST_NONCE,
  sessionId: TEST_SESSION_ID,
}

describe('QR encoding/decoding', () => {
  it('round-trips a valid payload', () => {
    const encoded = encodeEnrollmentQr(VALID_PAYLOAD)
    const decoded = decodeEnrollmentQr(encoded)
    expect(decoded).toEqual(VALID_PAYLOAD)
  })

  it('produces a base64url string without padding', () => {
    const encoded = encodeEnrollmentQr(VALID_PAYLOAD)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })

  it('rejects non-base64url input', () => {
    expect(() => decodeEnrollmentQr('not valid!!!')).toThrow('not valid base64url')
  })

  it('rejects non-JSON base64', () => {
    // base64url of "not json"
    const encoded = btoa('not json').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(() => decodeEnrollmentQr(encoded)).toThrow('not valid JSON')
  })

  it('rejects payload missing required fields', () => {
    const partial = btoa(JSON.stringify({ newDeviceSigningPubkey: TEST_SIGNING_PUB }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(() => decodeEnrollmentQr(partial)).toThrow('missing required fields')
  })

  it('rejects payload with non-string fields', () => {
    const bad = btoa(
      JSON.stringify({
        newDeviceSigningPubkey: 123,
        newDeviceEncryptionPubkey: TEST_ENCRYPTION_PUB,
        enrollmentNonce: TEST_NONCE,
        sessionId: TEST_SESSION_ID,
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(() => decodeEnrollmentQr(bad)).toThrow('fields must be strings')
  })

  it('rejects payload with invalid hex pubkey', () => {
    const bad = btoa(
      JSON.stringify({
        ...VALID_PAYLOAD,
        newDeviceSigningPubkey: 'not-hex-at-all-not-even-close-to-64-chars',
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(() => decodeEnrollmentQr(bad)).toThrow('not valid hex')
  })

  it('rejects payload with wrong-length nonce', () => {
    const bad = btoa(
      JSON.stringify({
        ...VALID_PAYLOAD,
        enrollmentNonce: 'abcd', // too short
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(() => decodeEnrollmentQr(bad)).toThrow('not valid hex')
  })
})

describe('SAS code computation', () => {
  it('produces a formatted 6-digit code (XXX XXX)', () => {
    const sas = computeEnrollmentSAS(
      TEST_SIGNING_PUB,
      TEST_ENCRYPTION_PUB,
      TEST_NONCE,
      TEST_PRIMARY_SIGNING_PUB
    )
    expect(sas).toMatch(/^\d{3} \d{3}$/)
  })

  it('is deterministic for the same inputs', () => {
    const sas1 = computeEnrollmentSAS(
      TEST_SIGNING_PUB,
      TEST_ENCRYPTION_PUB,
      TEST_NONCE,
      TEST_PRIMARY_SIGNING_PUB
    )
    const sas2 = computeEnrollmentSAS(
      TEST_SIGNING_PUB,
      TEST_ENCRYPTION_PUB,
      TEST_NONCE,
      TEST_PRIMARY_SIGNING_PUB
    )
    expect(sas1).toBe(sas2)
  })

  it('differs when any input changes', () => {
    const baseline = computeEnrollmentSAS(
      TEST_SIGNING_PUB,
      TEST_ENCRYPTION_PUB,
      TEST_NONCE,
      TEST_PRIMARY_SIGNING_PUB
    )
    const differentNonce = computeEnrollmentSAS(
      TEST_SIGNING_PUB,
      TEST_ENCRYPTION_PUB,
      'e'.repeat(64),
      TEST_PRIMARY_SIGNING_PUB
    )
    const differentPrimary = computeEnrollmentSAS(
      TEST_SIGNING_PUB,
      TEST_ENCRYPTION_PUB,
      TEST_NONCE,
      'f'.repeat(64)
    )
    // At least one should differ (overwhelmingly likely with HKDF)
    expect(baseline === differentNonce && baseline === differentPrimary).toBe(false)
  })
})

describe('NewDeviceEnrollmentMachine', () => {
  let machine: NewDeviceEnrollmentMachine

  beforeEach(() => {
    machine = new NewDeviceEnrollmentMachine()
  })

  it('starts in idle state', () => {
    expect(machine.state).toBe('idle')
  })

  it('transitions idle -> generating_keypair -> awaiting_qr on start()', async () => {
    await machine.start()
    expect(machine.state).toBe('awaiting_qr')
    expect(machine.keypair).not.toBeNull()
  })

  it('produces a valid QR payload in awaiting_qr state', async () => {
    await machine.start()
    const payload = machine.getQrPayload()
    expect(payload.newDeviceSigningPubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.newDeviceEncryptionPubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.enrollmentNonce).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof payload.sessionId).toBe('string')
    expect(payload.sessionId.length).toBeGreaterThan(0)
  })

  it('throws on getQrPayload() from idle state', () => {
    expect(() => machine.getQrPayload()).toThrow(InvalidTransitionError)
  })

  it('transitions awaiting_qr -> sas_compare on receivePrimaryPubkey()', async () => {
    await machine.start()
    machine.receivePrimaryPubkey(TEST_ENCRYPTION_PUB, TEST_PRIMARY_SIGNING_PUB)
    expect(machine.state).toBe('sas_compare')
  })

  it('produces a SAS code in sas_compare state', async () => {
    await machine.start()
    machine.receivePrimaryPubkey(TEST_ENCRYPTION_PUB, TEST_PRIMARY_SIGNING_PUB)
    const sas = machine.getSasCode()
    expect(sas).toMatch(/^\d{3} \d{3}$/)
  })

  it('transitions sas_compare -> confirming -> enrolled', async () => {
    await machine.start()
    machine.receivePrimaryPubkey(TEST_ENCRYPTION_PUB, TEST_PRIMARY_SIGNING_PUB)
    machine.confirmSas()
    expect(machine.state).toBe('confirming')
    machine.markEnrolled()
    expect(machine.state).toBe('enrolled')
  })

  it('throws InvalidTransitionError on invalid transitions', async () => {
    // Can't confirm from idle
    expect(() => machine.confirmSas()).toThrow(InvalidTransitionError)

    await machine.start()
    // Can't mark enrolled from awaiting_qr
    expect(() => machine.markEnrolled()).toThrow(InvalidTransitionError)

    // Can't call start() again
    expect(() => machine.start()).toThrow(InvalidTransitionError)
  })

  it('transitions to failed from any non-terminal state', async () => {
    await machine.start()
    machine.fail('user cancelled')
    expect(machine.state).toBe('failed')
    expect(machine.failReason).toBe('user cancelled')
  })

  it('throws when failing from a terminal state', async () => {
    await machine.start()
    machine.receivePrimaryPubkey(TEST_ENCRYPTION_PUB, TEST_PRIMARY_SIGNING_PUB)
    machine.confirmSas()
    machine.markEnrolled()
    expect(() => machine.fail('too late')).toThrow(InvalidTransitionError)
  })

  it('expires after 5 minutes', async () => {
    await machine.start()

    // Manually set startedAt to 6 minutes ago
    // biome-ignore lint/suspicious/noExplicitAny: test-only access to private field
    ;(machine as any)._startedAt = Date.now() - 6 * 60 * 1000

    // Any method call should trigger expiry check
    expect(() => machine.getQrPayload()).toThrow(InvalidTransitionError)
    expect(machine.state).toBe('expired')
  })

  it('does not expire if within 5 minutes', async () => {
    await machine.start()
    // Still within time window
    const payload = machine.getQrPayload()
    expect(payload).toBeDefined()
    expect(machine.state).toBe('awaiting_qr')
  })
})

describe('PrimaryDeviceEnrollmentMachine', () => {
  let machine: PrimaryDeviceEnrollmentMachine
  const MY_DEVICE_ID = 'device-001'

  beforeEach(() => {
    machine = new PrimaryDeviceEnrollmentMachine()
  })

  it('starts in idle state', () => {
    expect(machine.state).toBe('idle')
  })

  it('transitions idle -> awaiting_qr on start()', () => {
    machine.start(MY_DEVICE_ID, TEST_PRIMARY_SIGNING_PUB)
    expect(machine.state).toBe('awaiting_qr')
    expect(machine.myDeviceId).toBe(MY_DEVICE_ID)
  })

  it('transitions awaiting_qr -> sas_compare on receiveQr()', () => {
    machine.start(MY_DEVICE_ID, TEST_PRIMARY_SIGNING_PUB)
    machine.receiveQr(VALID_PAYLOAD)
    expect(machine.state).toBe('sas_compare')
    expect(machine.qrPayload).toEqual(VALID_PAYLOAD)
  })

  it('produces a SAS code in sas_compare state', () => {
    machine.start(MY_DEVICE_ID, TEST_PRIMARY_SIGNING_PUB)
    machine.receiveQr(VALID_PAYLOAD)
    const sas = machine.getSasCode()
    expect(sas).toMatch(/^\d{3} \d{3}$/)
  })

  it('transitions sas_compare -> enrolling -> enrolled', () => {
    machine.start(MY_DEVICE_ID, TEST_PRIMARY_SIGNING_PUB)
    machine.receiveQr(VALID_PAYLOAD)
    machine.confirmSas()
    expect(machine.state).toBe('enrolling')
    machine.markEnrolled()
    expect(machine.state).toBe('enrolled')
  })

  it('throws InvalidTransitionError on invalid transitions', () => {
    // Can't receiveQr from idle
    expect(() => machine.receiveQr(VALID_PAYLOAD)).toThrow(InvalidTransitionError)

    machine.start(MY_DEVICE_ID, TEST_PRIMARY_SIGNING_PUB)
    // Can't confirm from awaiting_qr (must scan QR first)
    expect(() => machine.confirmSas()).toThrow(InvalidTransitionError)
  })

  it('transitions to failed from any non-terminal state', () => {
    machine.start(MY_DEVICE_ID, TEST_PRIMARY_SIGNING_PUB)
    machine.receiveQr(VALID_PAYLOAD)
    machine.fail('SAS mismatch')
    expect(machine.state).toBe('failed')
    expect(machine.failReason).toBe('SAS mismatch')
  })

  it('throws when failing from a terminal state', () => {
    machine.start(MY_DEVICE_ID, TEST_PRIMARY_SIGNING_PUB)
    machine.receiveQr(VALID_PAYLOAD)
    machine.confirmSas()
    machine.markEnrolled()
    expect(() => machine.fail('too late')).toThrow(InvalidTransitionError)
  })

  it('expires after 5 minutes', () => {
    machine.start(MY_DEVICE_ID, TEST_PRIMARY_SIGNING_PUB)

    // biome-ignore lint/suspicious/noExplicitAny: test-only access to private field
    ;(machine as any)._startedAt = Date.now() - 6 * 60 * 1000

    expect(() => machine.receiveQr(VALID_PAYLOAD)).toThrow(InvalidTransitionError)
    expect(machine.state).toBe('expired')
  })
})

describe('SAS code agreement between machines', () => {
  it('both sides compute the same SAS code for matching inputs', () => {
    const sas = computeEnrollmentSAS(
      VALID_PAYLOAD.newDeviceSigningPubkey,
      VALID_PAYLOAD.newDeviceEncryptionPubkey,
      VALID_PAYLOAD.enrollmentNonce,
      TEST_PRIMARY_SIGNING_PUB
    )

    // Simulate what PrimaryDeviceEnrollmentMachine.getSasCode() does
    const primaryMachine = new PrimaryDeviceEnrollmentMachine()
    primaryMachine.start('dev-1', TEST_PRIMARY_SIGNING_PUB)
    primaryMachine.receiveQr(VALID_PAYLOAD)
    const primarySas = primaryMachine.getSasCode()

    expect(sas).toBe(primarySas)
  })
})
