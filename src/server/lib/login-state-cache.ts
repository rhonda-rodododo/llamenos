/**
 * Short-lived cache for OPAQUE ephemeral state.
 *
 * Both the registration and login flows split across two HTTP round
 * trips:
 *
 *   1. `*_start` — client sends its first message, server calls
 *      `opaqueServer.startLogin` / `opaqueServer.createRegistrationResponse`
 *      which returns both a reply *and* an opaque `state` blob. The
 *      server must hold onto `state` until the matching finish call.
 *
 *   2. `*_finish` — client sends its final message; the server feeds
 *      both the stashed `state` and the client message into the finish
 *      function to produce a 64-byte session key.
 *
 * The state is a sealed handshake half-transcript. It carries no
 * user-supplied secrets but handing it to the wrong client still lets
 * that client complete a login for a user it shouldn't be able to, so
 * the cache MUST:
 *
 *   - key entries by a cryptographically random UUID the client cannot
 *     guess (the `sessionId` returned by `*_start`);
 *   - bind each entry to the pubkey + purpose that requested it so the
 *     finish endpoint can verify the authenticated caller owns the
 *     pending handshake;
 *   - expire aggressively — a full OPAQUE round-trip should complete
 *     in <10 s under normal conditions, so 60 s is a comfortable ceiling.
 *
 * The cache is process-local. Multi-process deployments need a Redis
 * (or similar) backend that implements the same interface; this file
 * intentionally keeps the surface tiny so the swap is mechanical.
 */

import { randomUUID } from 'node:crypto'
import type { OpaquePurpose } from '../../shared/schemas/opaque'

export type OpaqueFlow = 'registration' | 'login'

export interface LoginStateEntry {
  flow: OpaqueFlow
  purpose: OpaquePurpose
  userPubkey: string
  credentialIdentifier: string
  /** Base64url-encoded ephemeral state blob from the OPAQUE wrapper. */
  state: string
  /** Wall-clock ms at which this entry becomes invalid. */
  expiresAt: number
}

const DEFAULT_TTL_MS = 60_000

const cache = new Map<string, LoginStateEntry>()

function purgeExpired(now: number): void {
  for (const [id, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(id)
  }
}

/**
 * Store a new handshake state and return the opaque session id that
 * the caller should hand back to the client. The returned id is a
 * cryptographically random UUID; the client uses it verbatim on its
 * follow-up `*_finish` request.
 */
export function createLoginState(
  input: Omit<LoginStateEntry, 'expiresAt'>,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const now = Date.now()
  purgeExpired(now)
  const sessionId = randomUUID()
  cache.set(sessionId, { ...input, expiresAt: now + ttlMs })
  return sessionId
}

/**
 * Atomically claim a pending handshake state. The entry is deleted
 * from the cache before it is returned so a handshake can never be
 * replayed. Returns `null` if the session id is unknown, expired, or
 * already consumed.
 */
export function consumeLoginState(sessionId: string): LoginStateEntry | null {
  const now = Date.now()
  purgeExpired(now)
  const entry = cache.get(sessionId)
  if (!entry) return null
  cache.delete(sessionId)
  if (entry.expiresAt <= now) return null
  return entry
}

/**
 * Test-only hook: drop every cached entry. Used by integration tests
 * that reuse the cache across flows and need a deterministic start.
 */
export function _test_resetLoginStateCache(): void {
  cache.clear()
}

/**
 * Test-only hook: size the cache. Used by tests that assert cleanup.
 */
export function _test_loginStateCacheSize(): number {
  return cache.size
}
