/**
 * OPAQUE ServerSetup lifecycle.
 *
 * Each Llamenos hub runs three independent OPAQUE instances — one per
 * `OpaquePurpose` (`root-kek`, `recovery-phrase`, `recovery-group`). A
 * ServerSetup is the long-lived RFC 9807 blob produced by
 * `opaqueServer.createSetup()` and is the private half of the long-term
 * server identity for that purpose. It MUST be stable: rotating it
 * invalidates every password file registered against the previous setup.
 *
 * This module is the single point of access for those blobs. It:
 *
 *   1. Lazily creates the row on first read so the admin never has to
 *      run a bootstrap migration to enable OPAQUE for a new purpose.
 *   2. Caches the base64url blob in process memory so the hot login path
 *      never incurs a round-trip after the first request per purpose.
 *      The ServerSetup never changes without explicit admin action, so
 *      the cache can be unbounded per purpose for the process lifetime.
 *   3. Exposes an explicit `rotateServerSetup` that generates a new
 *      blob, overwrites the row, and evicts the cache. Rotation is a
 *      deliberate, auditable operation — every per-user password file
 *      registered under the old setup becomes unusable immediately.
 *
 * The module is intentionally dependency-light: it takes a `Database`
 * handle and nothing else. Callers own the decision about whether to
 * trigger a rotation.
 */

import { eq } from 'drizzle-orm'
import { opaqueServer } from '../../client/lib/opaque-client'
import type { OpaquePurpose } from '../../shared/schemas/opaque'
import type { Database } from '../db'
import { opaqueServerSetup } from '../db/schema/opaque'

const setupCache = new Map<OpaquePurpose, string>()

/**
 * Fetch the base64url `ServerSetup` blob for a purpose, lazily creating
 * it on first access. Subsequent calls within the same process return
 * the cached blob without touching the database.
 */
export async function getOrCreateServerSetup(
  db: Database,
  purpose: OpaquePurpose
): Promise<string> {
  const cached = setupCache.get(purpose)
  if (cached) return cached

  const existing = await db
    .select({ setup: opaqueServerSetup.setup })
    .from(opaqueServerSetup)
    .where(eq(opaqueServerSetup.purpose, purpose))
    .limit(1)

  const existingRow = existing[0]
  if (existingRow) {
    setupCache.set(purpose, existingRow.setup)
    return existingRow.setup
  }

  const freshSetup = await opaqueServer.createSetup()
  // `ON CONFLICT DO NOTHING` makes the insert tolerant of a race where
  // two requests both miss the cache and both try to create the row.
  // The second insert no-ops and a follow-up select returns whichever
  // row won the race so both callers agree on the same bytes.
  await db
    .insert(opaqueServerSetup)
    .values({ purpose, setup: freshSetup })
    .onConflictDoNothing({ target: opaqueServerSetup.purpose })

  const winner = await db
    .select({ setup: opaqueServerSetup.setup })
    .from(opaqueServerSetup)
    .where(eq(opaqueServerSetup.purpose, purpose))
    .limit(1)

  const setup = winner[0]?.setup ?? freshSetup
  setupCache.set(purpose, setup)
  return setup
}

/**
 * Replace the stored `ServerSetup` for a purpose with a freshly
 * generated one. Every OPAQUE password file previously registered for
 * this purpose becomes unusable — the new blob has no relationship to
 * the old one. Callers are responsible for auditing the rotation and
 * notifying users that they must re-register.
 */
export async function rotateServerSetup(db: Database, purpose: OpaquePurpose): Promise<string> {
  const freshSetup = await opaqueServer.createSetup()
  const now = new Date()
  await db
    .insert(opaqueServerSetup)
    .values({ purpose, setup: freshSetup, createdAt: now, rotatedAt: now })
    .onConflictDoUpdate({
      target: opaqueServerSetup.purpose,
      set: { setup: freshSetup, rotatedAt: now },
    })
  setupCache.set(purpose, freshSetup)
  return freshSetup
}

/**
 * Test-only hook: drop the in-process cache so successive calls hit
 * the database again. Used by integration tests that truncate the
 * `opaque_server_setup` table between runs.
 */
export function _test_resetServerSetupCache(): void {
  setupCache.clear()
}
