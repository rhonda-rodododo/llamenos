import { afterEach, describe, expect, test } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519.js'
import { __test_setPubkey, verifyWarrantCanary } from './warrant-canary'

// Base64 encode a Uint8Array without depending on Node Buffer. Bun exposes
// btoa as a global so this works in the same way the browser bundle will.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0)
  return btoa(binary)
}

function newKeypair(): { sk: Uint8Array; pk: Uint8Array } {
  const sk = ed25519.utils.randomSecretKey()
  const pk = ed25519.getPublicKey(sk)
  return { sk, pk }
}

function signMessage(content: string, sk: Uint8Array): string {
  const msg = new TextEncoder().encode(content)
  const sig = ed25519.sign(msg, sk)
  return bytesToBase64(sig)
}

describe('verifyWarrantCanary', () => {
  afterEach(() => {
    __test_setPubkey(undefined)
  })

  test('valid signature over untouched content verifies', async () => {
    const { sk, pk } = newKeypair()
    __test_setPubkey(bytesToBase64(pk))

    const content = '# Llamenos Warrant Canary\n\nAs of today, nothing to report.\n'
    const sigB64 = signMessage(content, sk)

    await expect(verifyWarrantCanary(content, sigB64)).resolves.toBe('valid')
  })

  test('tampered content fails verification', async () => {
    const { sk, pk } = newKeypair()
    __test_setPubkey(bytesToBase64(pk))

    const original = '# Llamenos Warrant Canary\n\nClean.\n'
    const sigB64 = signMessage(original, sk)

    const tampered = `${original}SECRETLY APPENDED\n`
    await expect(verifyWarrantCanary(tampered, sigB64)).resolves.toBe('invalid')
  })

  test('signature from a different key fails verification', async () => {
    const signer = newKeypair()
    const attacker = newKeypair()
    // Pin the legitimate pubkey, but sign with the attacker's key.
    __test_setPubkey(bytesToBase64(signer.pk))

    const content = '# Llamenos Warrant Canary\n\nAs of today, nothing to report.\n'
    const sigB64 = signMessage(content, attacker.sk)

    await expect(verifyWarrantCanary(content, sigB64)).resolves.toBe('invalid')
  })

  test('no pinned pubkey returns unavailable', async () => {
    __test_setPubkey(null)
    const content = '# anything\n'
    // A structurally valid signature from some other key — the function
    // must short-circuit before attempting verification.
    const { sk } = newKeypair()
    const sigB64 = signMessage(content, sk)

    await expect(verifyWarrantCanary(content, sigB64)).resolves.toBe('unavailable')
  })

  test('malformed base64 signature returns invalid, not unavailable', async () => {
    const { pk } = newKeypair()
    __test_setPubkey(bytesToBase64(pk))

    await expect(verifyWarrantCanary('# content\n', 'this is not base64 at all !!!')).resolves.toBe(
      'invalid'
    )
  })

  test('wrong-length signature returns invalid', async () => {
    const { pk } = newKeypair()
    __test_setPubkey(bytesToBase64(pk))

    // 10 bytes of base64 — clearly not a 64-byte Ed25519 signature.
    const shortSig = bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    await expect(verifyWarrantCanary('# content\n', shortSig)).resolves.toBe('invalid')
  })
})
