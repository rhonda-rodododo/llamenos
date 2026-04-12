/**
 * Hub Key Cache
 *
 * Fetches and caches per-hub symmetric keys for Nostr event decryption and
 * hub-field AEAD. Each hub has a 32-byte key distributed as ECIES-wrapped
 * envelopes. After login, call `loadHubKeysForUser()` to populate the cache.
 *
 * The cache holds two representations per hub:
 *   - raw 32-byte `Uint8Array` — needed by Nostr event decryption and any
 *     legacy XChaCha20 path still in the tree (scheduled for removal)
 *   - non-extractable AES-256-GCM `CryptoKey` — the Tier 1 hub-field path
 *     (`hub-field-crypto-v3.ts`) operates on this handle. Raw bytes never
 *     flow through the worker boundary for the v3 path.
 *
 * Both representations are populated atomically by `loadHubKeysForUser` so
 * there is no window where the v1 path sees a key the v3 path does not.
 *
 * The cache is module-level (not React state) so it survives component
 * re-renders and can be accessed from the RelayManager callback.
 */

import type { KeyEnvelope } from '@shared/crypto-primitives'
import { getMyHubKeyEnvelope } from './api'
import { importHubKeyCryptoKey } from './hub-field-crypto-v3'
import { unwrapHubKey } from './hub-key-manager'

interface CachedHubKey {
  raw: Uint8Array
  cryptoKey: CryptoKey
}

const hubKeyCache = new Map<string, CachedHubKey>()
/** Monotonically-increasing generation counter. Prevents stale concurrent loads from writing. */
let cacheGeneration = 0

/**
 * Retrieve a hub key by hub ID as raw bytes.
 *
 * Returns null if not yet loaded or decryption failed. Used by the Nostr
 * event decryption path (which needs the 32 raw bytes to feed into
 * XChaCha20-Poly1305) and by any remaining v1 hub-field call site.
 */
export function getHubKeyForId(hubId: string): Uint8Array | null {
  return hubKeyCache.get(hubId)?.raw ?? null
}

/**
 * Retrieve a hub key by hub ID as a non-extractable AES-256-GCM CryptoKey.
 *
 * Returns null if not yet loaded or decryption failed. This is the Tier 1
 * entry point for hub-field crypto: the CryptoKey handle never exposes raw
 * bytes, so there is no path for the key to leak into the main thread or a
 * future silent logging sink.
 */
export function getHubKeyCryptoKeyForId(hubId: string): CryptoKey | null {
  return hubKeyCache.get(hubId)?.cryptoKey ?? null
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
        const hubKeyBytes = await unwrapHubKey(envelope)
        const cryptoKey = await importHubKeyCryptoKey(hubKeyBytes)
        // Only write if this load is still the current generation
        if (cacheGeneration === myGeneration) {
          hubKeyCache.set(hubId, { raw: hubKeyBytes, cryptoKey })
        }
      } catch {
        // Hub key unavailable or decryption failed — skip; REST polling covers this hub
      }
    })
  )
}

/**
 * Clear the cache — called on sign-out or key lock.
 *
 * Dropping the CryptoKey handle releases the non-extractable reference; the
 * browser frees the underlying AES-GCM key material as soon as GC runs and
 * no other code holds the handle.
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
 * the full ECIES envelope unwrap flow. Imports the CryptoKey handle so that
 * both the v1 and v3 read paths work immediately after injection.
 */
export async function setHubKeyForTest(hubId: string, key: Uint8Array): Promise<void> {
  const cryptoKey = await importHubKeyCryptoKey(key)
  hubKeyCache.set(hubId, { raw: key, cryptoKey })
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
