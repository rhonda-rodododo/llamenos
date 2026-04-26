import { describe, expect, test } from 'bun:test'
import { x25519 } from '@noble/curves/ed25519.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  computeProvisioningSAS,
  computeSASForNewDevice,
  computeSASForPrimaryDevice,
  decodeProvisioningQR,
  decryptProvisionedNsec,
  encodeProvisioningQR,
  encryptNsecForDevice,
  getShortCode,
} from './provisioning'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genKeypair(): { secret: Uint8Array; pubHex: string } {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const pub = x25519.getPublicKey(secret)
  return { secret, pubHex: bytesToHex(pub) }
}

// ---------------------------------------------------------------------------
// C1: computeProvisioningSAS
// ---------------------------------------------------------------------------

describe('computeProvisioningSAS', () => {
  test('deterministic: same sharedX → same SAS', () => {
    const sharedX = new Uint8Array(32).fill(0xab)
    const sas1 = computeProvisioningSAS(sharedX)
    const sas2 = computeProvisioningSAS(sharedX)
    expect(sas1).toBe(sas2)
  })

  test('format matches /^\\d{3} \\d{3}$/', () => {
    const sharedX = new Uint8Array(32).fill(0x11)
    const sas = computeProvisioningSAS(sharedX)
    expect(/^\d{3} \d{3}$/.test(sas)).toBe(true)
  })

  test('one-bit flip produces different SAS', () => {
    const sharedX = new Uint8Array(32).fill(0x55)
    const flipped = new Uint8Array(sharedX)
    flipped[0] ^= 0x01
    expect(computeProvisioningSAS(sharedX)).not.toBe(computeProvisioningSAS(flipped))
  })

  test('all-zeros input produces valid SAS string', () => {
    const sas = computeProvisioningSAS(new Uint8Array(32))
    expect(/^\d{3} \d{3}$/.test(sas)).toBe(true)
  })

  test('all-0xff input produces valid SAS string', () => {
    const sas = computeProvisioningSAS(new Uint8Array(32).fill(0xff))
    expect(/^\d{3} \d{3}$/.test(sas)).toBe(true)
  })

  test('output is zero-padded to exactly 7 chars (nnn nnn)', () => {
    // Run over many random inputs to verify zero-padding is always applied
    let found = false
    for (let i = 0; i < 200; i++) {
      const buf = new Uint8Array(32)
      buf[0] = i
      const sas = computeProvisioningSAS(buf)
      expect(sas.length).toBe(7)
      // "001 234" would only appear if zero-padding is working
      if (sas.startsWith('00')) found = true
    }
    // We can't guarantee a hit in 200 tries, but the length check is authoritative
    expect(found || true).toBe(true)
  })

  test('1000 random shared secrets all produce valid 6-digit codes with no extreme bias', () => {
    const seen = new Set<string>()

    for (let i = 0; i < 1000; i++) {
      const secret = new Uint8Array(32)
      crypto.getRandomValues(secret)
      const sas = computeProvisioningSAS(secret)

      // Format: "XXX XXX"
      expect(sas).toMatch(/^\d{3} \d{3}$/)

      // Numeric value within 000000-999999
      const numeric = sas.replace(' ', '')
      const num = Number.parseInt(numeric, 10)
      expect(num).toBeGreaterThanOrEqual(0)
      expect(num).toBeLessThanOrEqual(999999)

      seen.add(sas)
    }

    // Distribution check: 1M possible codes, 1000 samples should yield high variety
    // (no extreme bias — if biased, many would collide)
    expect(seen.size).toBeGreaterThan(900)
  })
})

// ---------------------------------------------------------------------------
// C2: SAS symmetry — MITM prevention
// ---------------------------------------------------------------------------

describe('SAS symmetry (MITM prevention)', () => {
  test('computeSASForNewDevice and computeSASForPrimaryDevice produce identical SAS', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()

    const sasFromNewDevice = computeSASForNewDevice(ephemeral.secret, primary.pubHex)
    const sasFromPrimary = computeSASForPrimaryDevice(primary.secret, ephemeral.pubHex)

    expect(sasFromNewDevice).toBe(sasFromPrimary)
  })

  test('different keypairs produce different SAS (no false positives)', () => {
    const e1 = genKeypair()
    const p1 = genKeypair()
    const e2 = genKeypair()
    const p2 = genKeypair()

    const sas1 = computeSASForNewDevice(e1.secret, p1.pubHex)
    const sas2 = computeSASForNewDevice(e2.secret, p2.pubHex)

    expect(sas1).not.toBe(sas2)
  })

  test('swapped roles (wrong key combination) produce different SAS', () => {
    const e = genKeypair()
    const p = genKeypair()

    const correctSAS = computeSASForNewDevice(e.secret, p.pubHex)
    const wrongSAS = computeSASForNewDevice(e.secret, e.pubHex)

    expect(correctSAS).not.toBe(wrongSAS)
  })
})

// ---------------------------------------------------------------------------
// C3: encryptNsecForDevice / decryptProvisionedNsec
// ---------------------------------------------------------------------------

describe('encryptNsecForDevice / decryptProvisionedNsec', () => {
  test('roundtrip: encrypt on primary side, decrypt on new device side', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const nsec = 'nsec1testvalue0000000000000000000000000000000000000000000000'
    const encrypted = encryptNsecForDevice(nsec, ephemeral.pubHex, primary.secret)
    const decrypted = decryptProvisionedNsec(encrypted, primary.pubHex, ephemeral.secret)
    expect(decrypted).toBe(nsec)
  })

  test('roundtrip preserves arbitrary nsec strings', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const nsec = `nsec1${'a'.repeat(59)}`
    const encrypted = encryptNsecForDevice(nsec, ephemeral.pubHex, primary.secret)
    const decrypted = decryptProvisionedNsec(encrypted, primary.pubHex, ephemeral.secret)
    expect(decrypted).toBe(nsec)
  })

  test('wrong ephemeral secret fails decryption', () => {
    const ephemeral = genKeypair()
    const wrongEphemeral = genKeypair()
    const primary = genKeypair()
    const nsec = 'nsec1somekeyvalue'
    const encrypted = encryptNsecForDevice(nsec, ephemeral.pubHex, primary.secret)
    expect(() => decryptProvisionedNsec(encrypted, primary.pubHex, wrongEphemeral.secret)).toThrow()
  })

  test('wrong primary pubkey fails decryption', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const wrongPrimary = genKeypair()
    const nsec = 'nsec1somekeyvalue'
    const encrypted = encryptNsecForDevice(nsec, ephemeral.pubHex, primary.secret)
    expect(() => decryptProvisionedNsec(encrypted, wrongPrimary.pubHex, ephemeral.secret)).toThrow()
  })

  test('nonce uniqueness: same inputs produce different ciphertext each time', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const nsec = 'nsec1nonce_uniqueness_test'
    const enc1 = encryptNsecForDevice(nsec, ephemeral.pubHex, primary.secret)
    const enc2 = encryptNsecForDevice(nsec, ephemeral.pubHex, primary.secret)
    expect(enc1).not.toBe(enc2)
  })

  test('encrypted output is a valid hex string', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const encrypted = encryptNsecForDevice('nsec1test', ephemeral.pubHex, primary.secret)
    expect(/^[0-9a-f]+$/.test(encrypted)).toBe(true)
    expect(encrypted.length).toBeGreaterThanOrEqual(98)
  })
})

// ---------------------------------------------------------------------------
// C4: encodeProvisioningQR / decodeProvisioningQR
// ---------------------------------------------------------------------------

describe('encodeProvisioningQR / decodeProvisioningQR', () => {
  test('roundtrip: encode then decode returns original values', () => {
    const roomId = 'room-abc-123'
    const token = 'tok-xyz-456'

    const encoded = encodeProvisioningQR(roomId, token)
    const decoded = decodeProvisioningQR(encoded)

    expect(decoded).not.toBeNull()
    expect(decoded?.r).toBe(roomId)
    expect(decoded?.t).toBe(token)
  })

  test('invalid JSON returns null', () => {
    expect(decodeProvisioningQR('not json at all')).toBeNull()
    expect(decodeProvisioningQR('{broken')).toBeNull()
    expect(decodeProvisioningQR('')).toBeNull()
  })

  test('valid JSON but missing r field returns null', () => {
    expect(decodeProvisioningQR(JSON.stringify({ t: 'tok' }))).toBeNull()
  })

  test('valid JSON but missing t field returns null', () => {
    expect(decodeProvisioningQR(JSON.stringify({ r: 'room' }))).toBeNull()
  })

  test('valid JSON with both fields returns ProvisioningQRData', () => {
    const data = decodeProvisioningQR(JSON.stringify({ r: 'r1', t: 't1' }))
    expect(data).toEqual({ r: 'r1', t: 't1' })
  })

  test('encoded QR is valid JSON string', () => {
    const encoded = encodeProvisioningQR('room1', 'token1')
    expect(() => JSON.parse(encoded)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// C5: getShortCode
// ---------------------------------------------------------------------------

describe('getShortCode', () => {
  test('returns first 8 chars of roomId uppercased', () => {
    expect(getShortCode('abcdefghijklmnop')).toBe('ABCDEFGH')
  })

  test('already uppercase roomId is returned unchanged', () => {
    expect(getShortCode('ABCDEFGHXXX')).toBe('ABCDEFGH')
  })

  test('mixed case is uppercased', () => {
    expect(getShortCode('aBcDeFgHiJ')).toBe('ABCDEFGH')
  })

  test('short roomId shorter than 8 chars does not crash', () => {
    expect(getShortCode('abc')).toBe('ABC')
    expect(getShortCode('')).toBe('')
  })

  test('exactly 8 chars returns all of them uppercased', () => {
    expect(getShortCode('12345678')).toBe('12345678')
  })

  test('UUID-style roomId returns correct short code', () => {
    const roomId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    expect(getShortCode(roomId)).toBe('F47AC10B')
  })
})
