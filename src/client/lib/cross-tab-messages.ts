/**
 * Cross-tab message types and parsers.
 *
 * Two separate BroadcastChannel protocols run side-by-side in the client:
 *
 *   - `llamenos-capsule-sync` (session-capsule.ts) — request/response for
 *     sibling tabs to share their session token on page load.
 *   - `llamenos-lock` (key-manager.ts) — fan-out lock notifications so a
 *     lock in one tab also locks the worker closure in every sibling.
 *
 * Each channel still owns its own lifecycle (factory seam, onmessage
 * binding, test injection) in its respective module. Only the message
 * type declarations and validators live here so:
 *
 *   1. Every cross-tab payload passes through a validator that handles
 *      a non-object input, missing fields, and wrong hex lengths before
 *      the data reaches any consumer logic.
 *   2. Adding a third protocol requires adding a named parser here, not
 *      reinventing the validation shape inside another module.
 *
 * Parsers return `null` on any failure. Callers that receive `null` on
 * an `onmessage` boundary MUST drop the message silently — it is either
 * a sibling on a different protocol version or a malicious page that
 * has somehow obtained BroadcastChannel access.
 */

import {
  type PubkeyHash16,
  type SessionToken,
  tryPubkeyHash16,
  trySessionToken,
} from '@shared/crypto-types'

export const SYNC_CHANNEL_NAME = 'llamenos-capsule-sync'
export const LOCK_CHANNEL_NAME = 'llamenos-lock'

export interface SyncRequestMessage {
  type: 'request-token'
  nonce: string
  pubkeyHash: PubkeyHash16
}

export interface SyncResponseMessage {
  type: 'token-response'
  nonce: string
  pubkeyHash: PubkeyHash16
  token: SessionToken
}

export interface LockMessage {
  type: 'lock'
}

export type SyncMessage = SyncRequestMessage | SyncResponseMessage
export type CrossTabMessage = SyncMessage | LockMessage

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

/**
 * Parse an untrusted BroadcastChannel payload as a sync request or response.
 * Returns `null` on any validation failure.
 */
export function parseSyncMessage(data: unknown): SyncMessage | null {
  if (!isObject(data)) return null

  const type = data.type
  if (type === 'request-token') {
    const nonce = data.nonce
    if (typeof nonce !== 'string' || nonce.length === 0) return null
    const pubkeyHash = tryPubkeyHash16(data.pubkeyHash)
    if (pubkeyHash === null) return null
    return { type: 'request-token', nonce, pubkeyHash }
  }

  if (type === 'token-response') {
    const nonce = data.nonce
    if (typeof nonce !== 'string' || nonce.length === 0) return null
    const pubkeyHash = tryPubkeyHash16(data.pubkeyHash)
    if (pubkeyHash === null) return null
    const token = trySessionToken(data.token)
    if (token === null) return null
    return { type: 'token-response', nonce, pubkeyHash, token }
  }

  return null
}

/**
 * Parse an untrusted BroadcastChannel payload as a lock notification.
 * Returns `null` on any validation failure.
 */
export function parseLockMessage(data: unknown): LockMessage | null {
  if (!isObject(data)) return null
  if (data.type !== 'lock') return null
  return { type: 'lock' }
}
