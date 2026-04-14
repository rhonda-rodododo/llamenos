/**
 * Runtime probe for native WebCrypto curve support.
 *
 * Tier 1 ships with an @noble/curves X25519 KEM (via @hpke/dhkem-x25519)
 * because Bun's WebCrypto lacks `deriveBits({ name: 'X25519' })`. Browsers
 * with full native X25519 are still routed through the @noble path for
 * uniform behavior.
 *
 * This probe lets us track when runtimes gain the missing pieces, so we can
 * swap the KEM implementation to `@hpke/core`'s native DhkemX25519HkdfSha256
 * without guessing. It is a telemetry/diagnostic hook — NOT a decision
 * switch. Flipping crypto paths based on runtime sniffing would make the
 * wire format depend on the client's WebCrypto feature set, which is the
 * class of bug we are trying to eliminate.
 *
 * Result fields are all booleans; log/report them but do not branch on them.
 */

export interface NativeCurvesSupport {
  x25519KeyGen: boolean
  x25519DeriveBits: boolean
  ed25519KeyGen: boolean
  ed25519Sign: boolean
}

async function tryX25519KeyGen(): Promise<boolean> {
  try {
    const kp = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair
    return kp.privateKey.algorithm.name === 'X25519'
  } catch {
    return false
  }
}

async function tryX25519DeriveBits(): Promise<boolean> {
  try {
    const kp = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair
    const bits = await crypto.subtle.deriveBits(
      { name: 'X25519', public: kp.publicKey },
      kp.privateKey,
      256
    )
    return bits.byteLength === 32
  } catch {
    return false
  }
}

async function tryEd25519KeyGen(): Promise<boolean> {
  try {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    return kp.privateKey.algorithm.name === 'Ed25519'
  } catch {
    return false
  }
}

async function tryEd25519Sign(): Promise<boolean> {
  try {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new Uint8Array(8))
    return sig.byteLength === 64
  } catch {
    return false
  }
}

/**
 * Probe all four capabilities in parallel. Returns a readonly result that
 * callers can log (e.g. `console.info('native-curves', await probeNativeCurves())`).
 */
export async function probeNativeCurves(): Promise<NativeCurvesSupport> {
  const [x25519KeyGen, x25519DeriveBits, ed25519KeyGen, ed25519Sign] = await Promise.all([
    tryX25519KeyGen(),
    tryX25519DeriveBits(),
    tryEd25519KeyGen(),
    tryEd25519Sign(),
  ])
  return { x25519KeyGen, x25519DeriveBits, ed25519KeyGen, ed25519Sign }
}
