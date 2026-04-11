import { Aes256Gcm, CipherSuite, HkdfSha256 } from '@hpke/core'
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519'

/**
 * Stable identifier for the Llámenos HPKE cipher suite.
 * Bumped when any of KEM / KDF / AEAD change. This identifier is a code-level
 * constant only — it is NOT written into `EnvelopeV3` (which carries `v: 3`
 * and a `labelId` wire field, not a suite id). Future suite migrations will
 * rev the envelope `v` number or introduce a sibling wire format.
 *
 * RFC 9180 IDs for this suite:
 *   KEM:  0x0020 (DHKEM(X25519, HKDF-SHA256))
 *   KDF:  0x0001 (HKDF-SHA256)
 *   AEAD: 0x0002 (AES-256-GCM)
 *
 * Note on the X25519 KEM: we import from `@hpke/dhkem-x25519` (which uses
 * @noble/curves under the hood) rather than `@hpke/core`'s native X25519.
 * The native KEM requires `crypto.subtle.deriveBits({ name: 'X25519' })`,
 * which Bun does not yet implement. Browsers with native X25519 still run
 * the @noble path — the performance delta is negligible for our payloads,
 * and uniform runtime behavior is more valuable than a micro-optimization.
 * See `src/client/lib/native-curves-check.ts` for the runtime probe that
 * will let us swap back to native once Bun ships deriveBits.
 */
export const HPKE_SUITE_ID = 'llamenos-hpke-v1:x25519-hkdf-sha256-aes256gcm' as const

export type HpkeSuiteId = typeof HPKE_SUITE_ID

/**
 * Factory for the single cipher suite used by the app.
 * Callers must create a fresh suite per sender/recipient context — reusing
 * suite instances across contexts is explicitly safe per the library, but
 * keeping this centralized prevents drift.
 */
export function createHpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  })
}
