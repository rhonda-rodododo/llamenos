// Tier 4 — signed release manifest endpoint.
//
// The client-side binary verifier (`src/client/lib/binary-verifier.ts`) fetches
// this endpoint at boot, verifies the Ed25519 signature against a pinned
// public key built into the bundle, then hashes every loaded resource against
// the manifest and refuses to run on any mismatch.
//
// The server does not sign anything at runtime. The release pipeline builds
// the SPA reproducibly, signs the manifest offline with a release key, and
// writes the `{ manifest, signature, signingKey }` JSON blob to a path the
// server can read. At request time we simply parse + serve it. If the file
// is missing or unparseable we return 503 so the verifier fails closed.
//
// Path is configured via `RELEASE_MANIFEST_PATH`; defaults to
// `dist/client/release-manifest.json`.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRoute, z } from '@hono/zod-openapi'
import { SignedReleaseManifestSchema } from '@shared/schemas/gossip-version'
import { createRouter } from '../lib/openapi'

const releases = createRouter()

const DEFAULT_MANIFEST_PATH = path.resolve(process.cwd(), 'dist', 'client', 'release-manifest.json')

function resolveManifestPath(): string {
  return process.env.RELEASE_MANIFEST_PATH ?? DEFAULT_MANIFEST_PATH
}

// In-process cache. The file is immutable for the lifetime of a deployed
// release, so we read once and hold it. Tests can pass `RELEASE_MANIFEST_PATH`
// to point at a fixture; cache is keyed on the resolved path so a path change
// forces a re-read.
let cache: { path: string; json: unknown } | null = null

async function loadSignedManifest(): Promise<unknown> {
  const p = resolveManifestPath()
  if (cache && cache.path === p) return cache.json
  const raw = await readFile(p, 'utf-8')
  const json: unknown = JSON.parse(raw)
  cache = { path: p, json }
  return json
}

/**
 * Test hook: clear the in-process cache so a fresh path/file is re-read.
 *
 * @knipignore — integration test reset hook; called by API test suite setup
 */
export function _resetReleaseManifestCacheForTests(): void {
  cache = null
}

const ErrorSchema = z.object({ error: z.string(), detail: z.string().optional() })

const manifestRoute = createRoute({
  method: 'get',
  path: '/latest/manifest',
  tags: ['Releases'],
  summary: 'Signed release manifest (Ed25519) for the currently-deployed SPA',
  description:
    'Returned shape is { manifest, signature, signingKey }. The client verifier pins the public key at build time and refuses to continue on mismatch. This endpoint is public — the signature itself is the integrity guarantee.',
  responses: {
    200: {
      description: 'Signed manifest for the active release',
      content: { 'application/json': { schema: SignedReleaseManifestSchema } },
    },
    503: {
      description: 'No manifest provisioned — verifier must fail closed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

releases.openapi(manifestRoute, async (c) => {
  let raw: unknown
  try {
    raw = await loadSignedManifest()
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown'
    return c.json({ error: 'release manifest unavailable', detail }, 503)
  }
  const parsed = SignedReleaseManifestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'release manifest malformed', detail: parsed.error.message }, 503)
  }
  // No-cache: client must always fetch fresh. The payload is small.
  c.header('Cache-Control', 'no-store')
  return c.json(parsed.data, 200)
})

export default releases
