// Tier 4 PR-C — client-side binary verifier.
//
// Fetches the signed release manifest from the API, verifies its Ed25519
// signature against a build-time-pinned public key, then enumerates every
// script/style referenced by the running document, fetches each resource
// fresh, hashes it with SHA-256, and compares against the manifest.
//
// Failure modes are explicit; `verifyOrThrow` fails CLOSED — on any
// status other than `match` it throws a `VerifierFailure` the caller
// MUST surface as a refusal to continue. The verifier never logs file
// contents or decrypted material.
//
// Design constraints:
//   * No network activity beyond the two fetches below. No telemetry.
//   * No reliance on globals the plan hasn't blessed (`import.meta.env`
//     is injected by Vite at build time).
//   * Tests drive behavior via injected `fetchFn` and `document` so this
//     module is exercisable under bun without a real browser.
//
// See docs/superpowers/plans/2026-04-10-security-tier-4-delivery-hardening.md
// Workstream 4.C, task 17 (local verifier) — rebased onto the PR-C scope.

import { ed25519 } from '@noble/curves/ed25519.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import {
  type ReleaseManifest,
  type SignedReleaseManifest,
  SignedReleaseManifestSchema,
} from '@shared/schemas/gossip-version'

// ---- Public result shape ---------------------------------------------------

export type VerifierStatus =
  | 'match'
  | 'mismatch'
  | 'manifest-unparseable'
  | 'signature-invalid'
  | 'key-not-pinned'
  | 'fetch-error'
  | 'not-configured'

export interface VerifierMismatch {
  readonly path: string
  readonly expected: string
  readonly actual: string
}

export interface VerifierResult {
  readonly status: VerifierStatus
  readonly checkedFiles: number
  readonly mismatches: readonly VerifierMismatch[]
  readonly releaseTag: string
  readonly detail?: string
}

// ---- Config ----------------------------------------------------------------

export interface VerifierConfig {
  /**
   * Origin serving the API. Defaults to `import.meta.env.VITE_API_ORIGIN`
   * at call time. Empty string in dev is explicitly treated as
   * `not-configured`.
   */
  apiOrigin?: string
  /**
   * Origin serving the SPA bundle. Defaults to
   * `import.meta.env.VITE_APP_ORIGIN` when available, then
   * `window.location.origin`.
   */
  appOrigin?: string
  /**
   * Ed25519 release signing pubkey, hex-encoded (32 bytes → 64 hex chars).
   * This is the ONLY key the verifier trusts. It is build-time-pinned via
   * `import.meta.env.VITE_RELEASE_SIGNING_PUBKEY`. Empty string in dev is
   * treated as `not-configured` by the top-level `runBinaryVerifier`
   * (which returns a status the caller can refuse on).
   */
  pinnedSigningKey?: string
  /** Test injection: alternate fetch impl. */
  fetchFn?: typeof fetch
  /** Test injection: alternate document (for listing loaded resources). */
  documentRef?: Pick<Document, 'querySelectorAll'>
}

// ---- Utility: canonical JSON -----------------------------------------------

/**
 * Deterministic JSON serialization:
 *   - Object keys sorted lex ASC, recursively.
 *   - Arrays preserve order.
 *   - Primitives pass through JSON.stringify.
 *
 * This is the bytes-over-the-wire the release-signing pipeline signs.
 * Any divergence between producer + consumer here silently breaks the
 * signature check, so the helper is kept tiny and fully covered in tests.
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

// ---- Signature + hash primitives -------------------------------------------

export function verifyManifestSignature(
  signed: SignedReleaseManifest,
  pinnedKeyHex: string
): boolean {
  if (signed.signingKey !== pinnedKeyHex) return false
  const canonical = canonicalizeJson(signed.manifest)
  const msg = new TextEncoder().encode(canonical)
  const sig = hexToBytes(signed.signature)
  const pub = hexToBytes(signed.signingKey)
  try {
    return ed25519.verify(sig, msg, pub)
  } catch {
    return false
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  const out = new Uint8Array(digest)
  let hex = ''
  for (const b of out) hex += b.toString(16).padStart(2, '0')
  return hex
}

// ---- Loaded-resource enumeration -------------------------------------------

/**
 * Collects the relative paths of every same-origin script/stylesheet
 * referenced in the running document, plus `index.html`. Order is
 * normalized (sort + dedupe) so hashes computed by two clients on the
 * same bundle are identical.
 */
export function listLoadedResources(
  appOrigin: string,
  doc: Pick<Document, 'querySelectorAll'>
): readonly string[] {
  const urls = new Set<string>()
  urls.add(`${appOrigin.replace(/\/+$/, '')}/index.html`)

  const scripts = doc.querySelectorAll('script[src]')
  for (const el of Array.from(scripts)) {
    const src = (el as HTMLScriptElement).src
    if (src?.startsWith(appOrigin)) urls.add(src)
  }
  const links = doc.querySelectorAll('link[rel="stylesheet"][href]')
  for (const el of Array.from(links)) {
    const href = (el as HTMLLinkElement).href
    if (href?.startsWith(appOrigin)) urls.add(href)
  }
  return Array.from(urls).sort()
}

// ---- Environment reads -----------------------------------------------------

function readEnv(name: string): string {
  // Vite injects these at build time; guarded read keeps the module
  // importable in environments where `import.meta.env` is undefined.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[name] ?? ''
}

function resolveConfig(config: VerifierConfig): Required<
  Pick<VerifierConfig, 'apiOrigin' | 'appOrigin' | 'pinnedSigningKey'>
> & {
  fetchFn: typeof fetch
  documentRef: Pick<Document, 'querySelectorAll'> | null
} {
  const apiOrigin = config.apiOrigin ?? readEnv('VITE_API_ORIGIN')
  const appOrigin =
    config.appOrigin ??
    readEnv('VITE_APP_ORIGIN') ??
    (typeof window !== 'undefined' ? window.location.origin : '')
  const pinnedSigningKey = config.pinnedSigningKey ?? readEnv('VITE_RELEASE_SIGNING_PUBKEY')
  const fetchFn =
    config.fetchFn ?? (typeof fetch !== 'undefined' ? fetch : (null as unknown as typeof fetch))
  const documentRef = config.documentRef ?? (typeof document !== 'undefined' ? document : null)
  return { apiOrigin, appOrigin, pinnedSigningKey, fetchFn, documentRef }
}

// ---- Public API ------------------------------------------------------------

/**
 * Fetches the signed manifest, verifies the signature against the pinned
 * key, then hashes every loaded resource against it. Returns a discrete
 * status — this function never throws; consumers who want fail-closed
 * behavior should call `verifyOrThrow`.
 */
export async function runBinaryVerifier(config: VerifierConfig = {}): Promise<VerifierResult> {
  const { apiOrigin, appOrigin, pinnedSigningKey, fetchFn, documentRef } = resolveConfig(config)

  if (!pinnedSigningKey || !apiOrigin) {
    return {
      status: 'not-configured',
      checkedFiles: 0,
      mismatches: [],
      releaseTag: '',
      detail: 'VITE_RELEASE_SIGNING_PUBKEY or VITE_API_ORIGIN not set; refusing to skip silently',
    }
  }
  if (!fetchFn || !documentRef) {
    return {
      status: 'not-configured',
      checkedFiles: 0,
      mismatches: [],
      releaseTag: '',
      detail: 'no fetch or document available in this environment',
    }
  }

  // 1. Fetch + parse signed manifest.
  let signed: SignedReleaseManifest
  try {
    const res = await fetchFn(`${apiOrigin.replace(/\/+$/, '')}/api/releases/latest/manifest`, {
      cache: 'no-store',
    })
    if (!res.ok) {
      return {
        status: 'fetch-error',
        checkedFiles: 0,
        mismatches: [],
        releaseTag: '',
        detail: `manifest HTTP ${res.status}`,
      }
    }
    const json: unknown = await res.json()
    const parsed = SignedReleaseManifestSchema.safeParse(json)
    if (!parsed.success) {
      return {
        status: 'manifest-unparseable',
        checkedFiles: 0,
        mismatches: [],
        releaseTag: '',
        detail: parsed.error.message,
      }
    }
    signed = parsed.data
  } catch (err) {
    return {
      status: 'fetch-error',
      checkedFiles: 0,
      mismatches: [],
      releaseTag: '',
      detail: err instanceof Error ? err.message : 'unknown',
    }
  }

  // 2. Pin check: the manifest must be signed with the pinned key (not
  //    some other key the server happens to advertise).
  if (signed.signingKey !== pinnedSigningKey) {
    return {
      status: 'key-not-pinned',
      checkedFiles: 0,
      mismatches: [],
      releaseTag: signed.manifest.releaseTag,
      detail: 'manifest signing key does not match pinned release key',
    }
  }

  // 3. Verify the signature.
  if (!verifyManifestSignature(signed, pinnedSigningKey)) {
    return {
      status: 'signature-invalid',
      checkedFiles: 0,
      mismatches: [],
      releaseTag: signed.manifest.releaseTag,
    }
  }

  // 4. Hash every loaded resource + compare.
  const mismatches: VerifierMismatch[] = []
  let checked = 0
  const loaded = listLoadedResources(appOrigin, documentRef)

  for (const url of loaded) {
    const relative = url.slice(appOrigin.replace(/\/+$/, '').length).replace(/^\/+/, '')
    const expected = signed.manifest.files[relative]
    if (!expected) {
      mismatches.push({ path: relative, expected: '<unlisted>', actual: '<present>' })
      checked++
      continue
    }
    let actual: string
    try {
      const res = await fetchFn(url, { cache: 'no-store' })
      if (!res.ok) {
        mismatches.push({ path: relative, expected, actual: `fetch:${res.status}` })
        checked++
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      actual = await sha256Hex(bytes)
    } catch (err) {
      mismatches.push({
        path: relative,
        expected,
        actual: err instanceof Error ? `fetch:${err.message}` : 'fetch:unknown',
      })
      checked++
      continue
    }
    if (actual !== expected) {
      mismatches.push({ path: relative, expected, actual })
    }
    checked++
  }

  return {
    status: mismatches.length === 0 ? 'match' : 'mismatch',
    checkedFiles: checked,
    mismatches,
    releaseTag: signed.manifest.releaseTag,
  }
}

// ---- Fail-closed wrapper ---------------------------------------------------

export class VerifierFailure extends Error {
  constructor(public readonly result: VerifierResult) {
    super(
      `binary verifier refused to run: status=${result.status}${result.detail ? ` (${result.detail})` : ''}${result.mismatches.length > 0 ? ` mismatched=${result.mismatches.length}` : ''}`
    )
    this.name = 'VerifierFailure'
  }
}

/**
 * Fail-closed wrapper. Throws on anything but `match`. Callers at the SPA
 * boot site MUST refuse to continue when this throws — unlock, network,
 * and crypto ops all depend on the integrity this verifier asserts.
 */
export async function verifyOrThrow(config: VerifierConfig = {}): Promise<VerifierResult> {
  const result = await runBinaryVerifier(config)
  if (result.status !== 'match') {
    throw new VerifierFailure(result)
  }
  return result
}

// Re-exported so callers don't have to pull from the schema module for a
// single type.
export type { ReleaseManifest, SignedReleaseManifest }
