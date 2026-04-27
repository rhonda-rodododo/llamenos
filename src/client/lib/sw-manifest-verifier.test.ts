import { describe, expect, test } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { ReleaseManifest } from '@shared/schemas/gossip-version'
import {
  canonicalizeJson,
  checkAntiDowngrade,
  hashResource,
  parseSignedManifest,
  verifySignedManifest,
} from './sw-manifest-verifier'

function newKeypair() {
  const sk = new Uint8Array(32)
  crypto.getRandomValues(sk)
  const pk = ed25519.getPublicKey(sk)
  return { sk, pk, pkHex: bytesToHex(pk) }
}

function makeManifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    version: 1,
    releaseTag: 'v1.0.0',
    builtAt: Date.now(),
    files: { 'index.html': 'a'.repeat(64), 'assets/app.js': 'b'.repeat(64) },
    ...overrides,
  }
}

function signManifest(manifest: ReleaseManifest, sk: Uint8Array, pkHex: string) {
  const canonical = canonicalizeJson(manifest)
  const msg = new TextEncoder().encode(canonical)
  const sig = ed25519.sign(msg, sk)
  return { manifest, signature: bytesToHex(sig), signingKey: pkHex }
}

describe('verifySignedManifest', () => {
  test('returns valid for correct signature with pinned key', () => {
    const { sk, pkHex } = newKeypair()
    const manifest = makeManifest()
    const signed = signManifest(manifest, sk, pkHex)
    const result = verifySignedManifest(signed, pkHex)
    expect(result.status).toBe('valid')
    expect(result.manifest).toEqual(manifest)
  })

  test('returns key-mismatch when signing key differs from pinned key', () => {
    const { sk, pkHex } = newKeypair()
    const { pkHex: otherPkHex } = newKeypair()
    const signed = signManifest(makeManifest(), sk, pkHex)
    const result = verifySignedManifest(signed, otherPkHex)
    expect(result.status).toBe('key-mismatch')
    expect(result.manifest).toBeNull()
  })

  test('returns signature-invalid for tampered manifest', () => {
    const { sk, pkHex } = newKeypair()
    const signed = signManifest(makeManifest(), sk, pkHex)
    signed.manifest.releaseTag = 'v9.9.9-evil'
    const result = verifySignedManifest(signed, pkHex)
    expect(result.status).toBe('signature-invalid')
    expect(result.manifest).toBeNull()
  })
})

describe('checkAntiDowngrade', () => {
  test('allows upgrade from lower to higher version', () => {
    expect(checkAntiDowngrade('v1.0.0', 'v1.1.0')).toBe(true)
  })

  test('allows same version (re-deploy)', () => {
    expect(checkAntiDowngrade('v1.0.0', 'v1.0.0')).toBe(true)
  })

  test('rejects downgrade from higher to lower version', () => {
    expect(checkAntiDowngrade('v1.1.0', 'v1.0.0')).toBe(false)
  })

  test('allows when no current version (first install)', () => {
    expect(checkAntiDowngrade(null, 'v1.0.0')).toBe(true)
  })

  test('handles semver with patches', () => {
    expect(checkAntiDowngrade('v1.0.1', 'v1.0.2')).toBe(true)
    expect(checkAntiDowngrade('v1.0.2', 'v1.0.1')).toBe(false)
  })

  test('handles major version upgrade', () => {
    expect(checkAntiDowngrade('v1.9.9', 'v2.0.0')).toBe(true)
  })

  test('rejects major version downgrade', () => {
    expect(checkAntiDowngrade('v2.0.0', 'v1.9.9')).toBe(false)
  })

  test('allows unparseable tags (dont brick the app)', () => {
    expect(checkAntiDowngrade('not-semver', 'v1.0.0')).toBe(true)
    expect(checkAntiDowngrade('v1.0.0', 'not-semver')).toBe(true)
  })
})

describe('hashResource', () => {
  test('computes SHA-256 hex of bytes', async () => {
    const bytes = new TextEncoder().encode('hello')
    const hash = await hashResource(bytes)
    // SHA-256 of "hello" is well-known
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
})

describe('parseSignedManifest', () => {
  test('parses valid signed manifest', () => {
    const { sk, pkHex } = newKeypair()
    const manifest = makeManifest()
    const signed = signManifest(manifest, sk, pkHex)
    const parsed = parseSignedManifest(signed)
    expect(parsed).not.toBeNull()
    expect(parsed?.manifest.releaseTag).toBe('v1.0.0')
  })

  test('returns null for invalid data', () => {
    expect(parseSignedManifest({ bad: 'data' })).toBeNull()
    expect(parseSignedManifest(null)).toBeNull()
    expect(parseSignedManifest('string')).toBeNull()
  })
})

describe('canonicalizeJson', () => {
  test('sorts object keys', () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  test('handles nested objects', () => {
    expect(canonicalizeJson({ z: { b: 2, a: 1 }, a: [] })).toBe('{"a":[],"z":{"a":1,"b":2}}')
  })

  test('handles null and undefined', () => {
    expect(canonicalizeJson(null)).toBe('null')
    expect(canonicalizeJson(undefined)).toBe('null')
  })

  test('handles primitives', () => {
    expect(canonicalizeJson(42)).toBe('42')
    expect(canonicalizeJson(true)).toBe('true')
    expect(canonicalizeJson('hello')).toBe('"hello"')
  })

  test('filters undefined values in objects', () => {
    expect(canonicalizeJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}')
  })
})
