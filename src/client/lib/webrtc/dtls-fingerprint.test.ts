import { describe, expect, test } from 'bun:test'
import {
  computeBindingHash,
  extractFingerprintFromSdp,
  verifyDtlsFingerprint,
} from './dtls-fingerprint.js'

const COLON_FP =
  'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89'
const NORMALIZED_FP = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

const SAMPLE_SDP = `v=0
o=- 123 2 IN IP4 0.0.0.0
s=-
t=0 0
a=group:BUNDLE 0
m=audio 9 UDP/TLS/RTP/SAVPF 111
a=fingerprint:sha-256 ${COLON_FP}
`

describe('extractFingerprintFromSdp', () => {
  test('extracts normalized sha-256 fingerprint', () => {
    expect(extractFingerprintFromSdp(SAMPLE_SDP)).toBe(NORMALIZED_FP)
  })

  test('returns null when no fingerprint line present', () => {
    expect(extractFingerprintFromSdp('v=0\r\ns=-\r\n')).toBeNull()
  })

  test('lowercases and strips colons', () => {
    const bytes = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 'FF' : '00'))
    const sdp = `a=fingerprint:sha-256 ${bytes.join(':')}`
    expect(extractFingerprintFromSdp(sdp)).toBe('ff00'.repeat(16))
  })

  test('ignores non-sha-256 fingerprint lines', () => {
    const sdp = 'a=fingerprint:sha-1 AB:CD'
    expect(extractFingerprintFromSdp(sdp)).toBeNull()
  })
})

describe('computeBindingHash', () => {
  test('is deterministic', () => {
    expect(computeBindingHash('abcd', 'call-1')).toBe(computeBindingHash('abcd', 'call-1'))
  })

  test('differs per callId', () => {
    expect(computeBindingHash('abcd', 'call-1')).not.toBe(computeBindingHash('abcd', 'call-2'))
  })

  test('differs per fingerprint', () => {
    expect(computeBindingHash('abcd', 'call-1')).not.toBe(computeBindingHash('efgh', 'call-1'))
  })

  test('returns 64-char lowercase hex', () => {
    const h = computeBindingHash('abcd', 'call-1')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('verifyDtlsFingerprint', () => {
  test('passes when SDP + binding match', () => {
    const fingerprint = NORMALIZED_FP
    const bindingHash = computeBindingHash(fingerprint, 'call-1')
    expect(verifyDtlsFingerprint(SAMPLE_SDP, { fingerprint, bindingHash, callId: 'call-1' })).toBe(
      true
    )
  })

  test('throws on binding hash mismatch', () => {
    expect(() =>
      verifyDtlsFingerprint(SAMPLE_SDP, {
        fingerprint: NORMALIZED_FP,
        bindingHash: '0'.repeat(64),
        callId: 'call-1',
      })
    ).toThrow(/dtls_binding_hash_mismatch/)
  })

  test('throws when SDP fingerprint is missing', () => {
    const fingerprint = NORMALIZED_FP
    const bindingHash = computeBindingHash(fingerprint, 'call-1')
    expect(() =>
      verifyDtlsFingerprint('v=0\r\n', { fingerprint, bindingHash, callId: 'call-1' })
    ).toThrow(/dtls_fingerprint_missing_in_sdp/)
  })

  test('throws on SDP fingerprint mismatch', () => {
    const advertised = 'ff'.repeat(32)
    const bindingHash = computeBindingHash(advertised, 'call-1')
    expect(() =>
      verifyDtlsFingerprint(SAMPLE_SDP, { fingerprint: advertised, bindingHash, callId: 'call-1' })
    ).toThrow(/dtls_fingerprint_mismatch/)
  })
})
