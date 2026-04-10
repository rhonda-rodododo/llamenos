/**
 * Hub Key Cache
 *
 * Fetches and caches per-hub symmetric keys for Nostr event decryption.
 * Each hub has a 32-byte key distributed as ECIES-wrapped envelopes.
 * After login, call `loadHubKeysForUser()` to populate the cache.
 *
 * The cache is module-level (not React state) so it survives component
 * re-renders and can be accessed from the RelayManager callback.
 */

import { getMyHubKeyEnvelope } from './api'
import type { KeyEnvelope } from './crypto'
import { unwrapHubKey } from './hub-key-manager'

const hubKeyCache = new Map<string, Uint8Array>()
/** Monotonically-increasing generation counter. Prevents stale concurrent loads from writing. */
let cacheGeneration = 0

/**
 * Retrieve a hub key by hub ID. Returns null if not yet loaded or decryption failed.
 */
export function getHubKeyForId(hubId: string): Uint8Array | null {
  return hubKeyCache.get(hubId) ?? null
}

/**
 * Fetch hub key envelopes for all given hub IDs and decrypt them using the
 * crypto worker (secret key never touches the main thread).
 * Populates the module-level cache.
 *
 * Called after successful authentication. Errors on individual hubs are
 * silently ignored — the cache will simply lack that hub's key, and Nostr
 * decryption will fall back to REST polling for that hub.
 */
export async function loadHubKeysForUser(hubIds: string[]): Promise<void> {
  if (!hubIds.length) return

  // Increment generation BEFORE clearing so concurrent in-flight fetches from a
  // previous call can detect they are stale and skip the set().
  const myGeneration = ++cacheGeneration
  hubKeyCache.clear()

  await Promise.allSettled(
    hubIds.map(async (hubId) => {
      try {
        const raw = await getMyHubKeyEnvelope(hubId)
        if (!raw) return
        // Normalize: server may return ephemeralPk or ephemeralPubkey
        const envelope: KeyEnvelope = {
          wrappedKey: raw.wrappedKey,
          ephemeralPubkey: raw.ephemeralPubkey || raw.ephemeralPk || '',
        }
        const hubKey = await unwrapHubKey(envelope)
        // Only write if this load is still the current generation
        if (cacheGeneration === myGeneration) {
          hubKeyCache.set(hubId, hubKey)
        }
      } catch {
        // Hub key unavailable or decryption failed — skip; REST polling covers this hub
      }
    })
  )
}

/**
 * Clear the cache — called on sign-out or key lock.
 */
export function clearHubKeyCache(): void {
  cacheGeneration++ // Invalidate any in-flight loadHubKeysForUser calls
  hubKeyCache.clear()
}

/**
 * Inject a hub key directly into the cache.
 *
 * For E2E tests only — allows Playwright to provision a known hub key so that
 * encrypted org metadata can be decrypted in the browser without going through
 * the full ECIES envelope unwrap flow.
 */
export function setHubKeyForTest(hubId: string, key: Uint8Array): void {
  hubKeyCache.set(hubId, key)
}

/**
 * Return the number of hub keys currently cached.
 *
 * For E2E tests only — lets tests verify that `loadHubKeysForUser` actually
 * populated the cache after an unlock or capsule-restore path, without
 * needing to know which hub id to look up.
 */
export function getHubKeyCacheSizeForTest(): number {
  return hubKeyCache.size
}
