// Tier 4 P1 — warrant canary Ed25519 signature verification.
//
// The warrant canary shipped in `docs/security/WARRANT_CANARY.md` is a
// plaintext markdown statement. On its own, a plaintext file in a repo is
// trivially forgeable by anyone with push access — which defeats the entire
// point of a canary that is supposed to survive coercion of the operators.
//
// This module pairs the markdown file with a detached Ed25519 signature
// published alongside it (e.g. `WARRANT_CANARY.md.sig`). The client bundle
// pins the canary signing public key at BUILD time via
// `VITE_WARRANT_CANARY_PUBKEY`, so a later compromise of the hosting layer
// cannot silently swap both the canary AND its signature — a mismatch with
// the pinned pubkey is visible to every running client.
//
// The signing key is held offline by the publisher; neither the private key
// nor any test key ever lives in the repository. See
// `scripts/sign-warrant-canary.ts` for the signing flow and
// `scripts/verify-canary.sh` for the CLI verifier.
//
// Design constraints:
//   * Browser-bundle safe: depends only on `@noble/curves/ed25519` which is
//     already in the dependency tree for the binary verifier.
//   * No network I/O. Caller is responsible for fetching the canary bytes
//     and the signature bytes.
//   * No logging. Returns a discrete status; never throws on signature
//     mismatch (only on malformed base64).
//   * "Unavailable" (missing pinned pubkey) is distinct from "invalid"
//     (pubkey present, signature wrong). A dev build without the env var
//     set is "unavailable", not "invalid".

import { ed25519 } from '@noble/curves/ed25519.js'

// ---- Public types ----------------------------------------------------------

export type WarrantCanaryStatus = 'valid' | 'invalid' | 'unavailable'

// ---- Build-time pinned key -------------------------------------------------

function readViteEnv(name: string): string | undefined {
  // Vite injects `import.meta.env.*` at build time; guard the read so this
  // module is still importable in environments (bun scripts, unit tests)
  // where `import.meta.env` is undefined.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[name]
}

function resolvePinnedPubkey(): string | null {
  const raw = readViteEnv('VITE_WARRANT_CANARY_PUBKEY')
  if (raw === undefined || raw === '') return null
  return raw
}

/**
 * The base64-encoded Ed25519 public key that signs the warrant canary,
 * pinned at build time via `VITE_WARRANT_CANARY_PUBKEY`.
 *
 * `null` when the env var is unset — `verifyWarrantCanary` will return
 * `'unavailable'` in that case, and build/CI pipelines SHOULD set the env
 * var before shipping a client bundle to users. Dev builds commonly run
 * without it and that is fine.
 */
export const WARRANT_CANARY_PUBKEY_BASE64: string | null = resolvePinnedPubkey()

// ---- Test-only override ----------------------------------------------------

// Tests inject a pubkey here instead of mutating a frozen module constant.
// Production code never reads this; `verifyWarrantCanary` prefers it only
// when it is explicitly set.
let __testPubkeyOverride: string | null | undefined

/** Test-only: inject/reset the pinned pubkey. Do NOT call from app code. */
export function __test_setPubkey(base64OrNull: string | null | undefined): void {
  __testPubkeyOverride = base64OrNull
}

function activePubkeyBase64(): string | null {
  if (__testPubkeyOverride !== undefined) return __testPubkeyOverride
  return WARRANT_CANARY_PUBKEY_BASE64
}

// ---- Base64 helpers --------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array {
  // Accept standard and URL-safe alphabets; strip whitespace / padding noise.
  const normalized = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  // atob is available in browsers and Bun.
  const binary = atob(normalized)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

// ---- Public API ------------------------------------------------------------

/**
 * Verifies a detached Ed25519 signature over the UTF-8 bytes of the warrant
 * canary content.
 *
 * @param content         The exact bytes of `WARRANT_CANARY.md` as a UTF-8
 *                        string. Must match the bytes that were signed
 *                        byte-for-byte (no trimming, no newline fiddling).
 * @param signatureBase64 Base64-encoded 64-byte Ed25519 signature, as
 *                        produced by `scripts/sign-warrant-canary.ts`.
 * @returns `'valid'`       — signature verifies against the pinned pubkey.
 *          `'invalid'`     — pinned pubkey present, signature does not
 *                            verify (tampered content, wrong key, or
 *                            malformed signature bytes).
 *          `'unavailable'` — no pinned pubkey in this build; verification
 *                            is a no-op and callers should surface that
 *                            fact to the user rather than claim success.
 */
export async function verifyWarrantCanary(
  content: string,
  signatureBase64: string
): Promise<WarrantCanaryStatus> {
  const pubkeyB64 = activePubkeyBase64()
  if (pubkeyB64 === null) return 'unavailable'

  let pubkeyBytes: Uint8Array
  let sigBytes: Uint8Array
  try {
    pubkeyBytes = base64ToBytes(pubkeyB64)
    sigBytes = base64ToBytes(signatureBase64)
  } catch {
    return 'invalid'
  }

  if (pubkeyBytes.length !== 32 || sigBytes.length !== 64) return 'invalid'

  const msgBytes = new TextEncoder().encode(content)

  try {
    const ok = ed25519.verify(sigBytes, msgBytes, pubkeyBytes)
    return ok ? 'valid' : 'invalid'
  } catch {
    // @noble/curves throws on structurally-invalid signatures (bad point
    // encoding, etc.). Treat those as `invalid`, never as `unavailable`.
    return 'invalid'
  }
}
