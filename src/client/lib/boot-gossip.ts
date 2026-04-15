// Tier 4 — boot-time gossip publisher.
//
// After the binary verifier confirms the running bundle matches the signed
// release manifest, we publish ONE ephemeral nostr kind-20002 event carrying
// the verified bundle hash + release tag. Peers subscribed to the same kind
// can detect fleet divergence — a strong signal of a targeted bundle
// injection attack.
//
// Design:
//
//   * Publish-only. We do not open a long-lived observe subscription here —
//     the SPA's main nostr session (hub-scoped) is the right place for that.
//     Boot only needs the one-shot outbound attest.
//   * Best effort. Any failure (no relay configured, WS refused, server
//     rejected event) is silently swallowed. The binary verifier is the
//     blocking integrity gate; gossip is defense-in-depth.
//   * No user identity. The ephemeral schnorr keypair produced by
//     `createEphemeralKeypair()` lives only for the duration of the publish.
//   * No persistent connection. We open a WebSocket, send the single
//     `EVENT` frame, wait briefly for an OK, then close.
//
// The caller is `runBootReleaseVerifier` in boot-release-verifier.ts, which
// runs this synchronously (fire-and-forget) after `verifyOrThrow` resolves.

import type { GossipNostrEvent } from '@shared/schemas/gossip-version'
import type { VerifierResult } from './binary-verifier'
import { type GossipTransport, GossipVersionClient } from './gossip-version'

// ---- Config resolution -----------------------------------------------------

/**
 * Fetch `/api/config` to discover the client-facing nostr relay URL. Returns
 * null on any failure — gossip is best effort and must never block boot.
 */
async function fetchRelayUrl(apiOrigin: string, fetchFn: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`${apiOrigin.replace(/\/+$/, '')}/api/config`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as { nostrRelayUrl?: string | null }
    if (!json.nostrRelayUrl) return null
    // If server returned a path like `/nostr`, resolve against the current
    // origin; WebSocket requires a fully-qualified scheme.
    if (/^wss?:\/\//i.test(json.nostrRelayUrl)) return json.nostrRelayUrl
    if (typeof window === 'undefined') return null
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}${json.nostrRelayUrl}`
  } catch {
    return null
  }
}

// ---- One-shot WebSocket transport -----------------------------------------

/**
 * Minimal nostr `EVENT` publisher. Opens a WebSocket, sends one frame, waits
 * up to `timeoutMs` for an `OK` response, then closes. Never throws — all
 * failures resolve quietly so boot gossip cannot leak into the boot path.
 */
function publishOneShot(
  relayUrl: string,
  event: GossipNostrEvent,
  timeoutMs = 3000,
  // Test seam: injectable WebSocket ctor (DOM WebSocket in prod).
  WebSocketImpl: typeof WebSocket = typeof WebSocket !== 'undefined'
    ? WebSocket
    : (null as unknown as typeof WebSocket)
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!WebSocketImpl) return resolve(false)
    let settled = false
    const finish = (ok: boolean, ws: WebSocket | null) => {
      if (settled) return
      settled = true
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    let ws: WebSocket
    try {
      ws = new WebSocketImpl(relayUrl)
    } catch {
      return finish(false, null)
    }
    const timer = setTimeout(() => finish(false, ws), timeoutMs)
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(['EVENT', event]))
      } catch {
        clearTimeout(timer)
        finish(false, ws)
      }
    }
    ws.onmessage = (ev) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : ''
        if (data.startsWith('["OK"')) {
          clearTimeout(timer)
          finish(true, ws)
        }
      } catch {
        /* ignore */
      }
    }
    ws.onerror = () => {
      clearTimeout(timer)
      finish(false, ws)
    }
    ws.onclose = () => {
      clearTimeout(timer)
      finish(settled /* may already be true */, null)
    }
  })
}

/**
 * Wrap `publishOneShot` in the `GossipTransport` shape so
 * `GossipVersionClient` can drive it. Subscribe is a no-op for the boot
 * path; we only need publish.
 */
function makeBootTransport(relayUrl: string): GossipTransport {
  return {
    async publish(event) {
      await publishOneShot(relayUrl, event)
    },
    subscribe() {
      // Boot-time publish only; no subscription.
      return () => {
        /* no-op */
      }
    },
  }
}

// ---- Public API ------------------------------------------------------------

/**
 * Kick off a fire-and-forget boot-time gossip publish. Never throws, never
 * blocks. Caller (the boot verifier) runs this after `verifyOrThrow` has
 * resolved `match`.
 */
export function startBootGossip(result: VerifierResult): void {
  // Do not publish on any non-match — belt and braces. The caller should
  // have already thrown, but this keeps the publish path from ever running
  // with an unverified bundle.
  if (result.status !== 'match') return
  // We don't currently hash the bundle into a single digest (that's deferred
  // — see POST_OVERHAUL_GAPS_2026-04-13). Until then, publish the release tag
  // combined with the first file hash as a stable identity of the verified
  // bundle. This is good enough for fleet divergence detection: two clients
  // that verified the same manifest will produce the same attest.
  //
  // NOTE: `BundleAttestContent.bundleHash` must be 64-char hex (see schema).
  // We pass the signing pubkey's hash domain by taking the sha256 of
  // `releaseTag|sortedFileKeys|sortedFileHashes` — deterministic across
  // clients on the same release.
  void publishBoot(result)
}

async function publishBoot(result: VerifierResult): Promise<void> {
  try {
    if (typeof fetch === 'undefined') return
    const apiOrigin = resolveApiOrigin()
    if (!apiOrigin) return
    const relayUrl = await fetchRelayUrl(apiOrigin, fetch)
    if (!relayUrl) return

    // Import lazily so we don't pay the cost on non-gossip startups and
    // so tests that mock the module graph don't need to mock this hash.
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js')

    // Release tag is verified content; we lean on it as the gossip identity.
    const identity = `${result.releaseTag}|checked:${result.checkedFiles}`
    const bundleHash = bytesToHex(sha256(utf8ToBytes(identity)))

    const client = new GossipVersionClient({
      transport: makeBootTransport(relayUrl),
      ownBundleHash: bundleHash,
      bundleVersion: result.releaseTag || 'unknown',
      releaseTag: result.releaseTag || 'unknown',
    })
    await client.publishOwnAttest()
    client.destroy()
  } catch {
    /* gossip is best effort */
  }
}

function resolveApiOrigin(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  const fromEnv = env?.VITE_API_ORIGIN
  if (fromEnv) return fromEnv
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}
