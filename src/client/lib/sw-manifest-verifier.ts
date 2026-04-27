// Shared manifest verification logic for the service worker hardening layer.
// No DOM dependencies — importable from both the SW and main thread.
//
// Reuses the canonicalization and Ed25519 verification approach from
// binary-verifier.ts but exposes a narrower API tailored to SW update decisions.

import { ed25519 } from '@noble/curves/ed25519.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import {
  type ReleaseManifest,
  type SignedReleaseManifest,
  SignedReleaseManifestSchema,
} from '@shared/schemas/gossip-version'

// ---- Types ------------------------------------------------------------------

export type ManifestVerifyStatus = 'valid' | 'key-mismatch' | 'signature-invalid' | 'parse-error'

export interface ManifestVerifyResult {
  readonly status: ManifestVerifyStatus
  readonly manifest: ReleaseManifest | null
  readonly detail?: string
}

// ---- Canonical JSON (shared with binary-verifier.ts) ------------------------

/**
 * Deterministic JSON serialization:
 *   - Object keys sorted lex ASC, recursively.
 *   - Arrays preserve order.
 *   - Primitives pass through JSON.stringify.
 *
 * This must be byte-identical to the producer in the release-signing
 * pipeline and to canonicalizeJson in binary-verifier.ts.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number' || t === 'boolean' || t === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`
  }
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`
  }
  throw new TypeError(`cannot canonicalize value of type ${t}`)
}

// ---- Verification -----------------------------------------------------------

/**
 * Verify a signed release manifest against a pinned Ed25519 public key.
 * Returns a discrete status — never throws.
 */
export function verifySignedManifest(
  signed: SignedReleaseManifest,
  pinnedKeyHex: string
): ManifestVerifyResult {
  if (signed.signingKey !== pinnedKeyHex) {
    return {
      status: 'key-mismatch',
      manifest: null,
      detail: 'signing key does not match pinned key',
    }
  }
  const canonical = canonicalizeJson(signed.manifest)
  const msg = new TextEncoder().encode(canonical)
  const sig = hexToBytes(signed.signature)
  const pub = hexToBytes(signed.signingKey)
  try {
    if (!ed25519.verify(sig, msg, pub)) {
      return { status: 'signature-invalid', manifest: null }
    }
  } catch {
    return { status: 'signature-invalid', manifest: null }
  }
  return { status: 'valid', manifest: signed.manifest }
}

/**
 * Parse raw JSON into a SignedReleaseManifest. Returns null on parse failure.
 */
export function parseSignedManifest(json: unknown): SignedReleaseManifest | null {
  const parsed = SignedReleaseManifestSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

// ---- Anti-downgrade ---------------------------------------------------------

/**
 * Parse a semver tag like "v1.2.3" into [major, minor, patch].
 * Returns null if the tag doesn't match.
 */
function parseSemver(tag: string): [number, number, number] | null {
  const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Check whether upgrading from `currentTag` to `newTag` is allowed.
 * Returns true if newTag >= currentTag (or currentTag is null/unparseable).
 * Returns false if newTag < currentTag (downgrade attempt).
 */
export function checkAntiDowngrade(currentTag: string | null, newTag: string): boolean {
  if (!currentTag) return true
  const current = parseSemver(currentTag)
  const next = parseSemver(newTag)
  if (!current || !next) return true // unparseable tags — allow (don't brick the app)
  if (next[0] !== current[0]) return next[0] > current[0]
  if (next[1] !== current[1]) return next[1] > current[1]
  return next[2] >= current[2]
}

// ---- Hashing ----------------------------------------------------------------

/**
 * Compute SHA-256 hex hash of a Uint8Array. Works in both browser and SW contexts.
 */
export async function hashResource(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  const out = new Uint8Array(digest)
  let hex = ''
  for (const b of out) hex += b.toString(16).padStart(2, '0')
  return hex
}
