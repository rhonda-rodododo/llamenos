// Tier 4 PR-C — gossip protocol for SPA version hashes.
//
// Each running client publishes a signed Nostr kind-20002 event carrying
// the SHA-256 of the bundle it loaded. Peers subscribe to the same kind
// and raise an alarm when they see a hash that differs from their own —
// the first observable signal of a targeted bundle injection attack
// aimed at a single user or a small subset of the fleet.
//
// Privacy constraints:
//
//   * **Never** sign with the user's long-term Nostr identity key. Every
//     GossipVersionClient creates a fresh schnorr keypair on construction;
//     the secret key lives only in closure and is zeroed on `destroy()`.
//   * The published event carries no user identifier — the pubkey is
//     ephemeral, timestamps are coarse (seconds), and the user-agent is
//     trimmed to 256 chars.
//   * No IP-to-identity correlation happens in this module. Relay-side
//     linkability is a separate concern handled by the Tor / deliberate
//     connection-churn design documented in the whitepaper.
//
// This module is transport-agnostic: callers inject a `GossipTransport`
// that knows how to publish + subscribe on the relay. That keeps the unit
// tests hermetic and keeps this file testable without a live strfry.

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  BUNDLE_ATTEST_KIND,
  type BundleAttestContent,
  BundleAttestContentSchema,
  GOSSIP_TAG,
  type GossipNostrEvent,
  GossipNostrEventSchema,
} from '@shared/schemas/gossip-version'

// ---- Keypair ---------------------------------------------------------------

interface EphemeralKeypair {
  readonly secretKey: Uint8Array
  readonly pubkeyHex: string
}

export function createEphemeralKeypair(): EphemeralKeypair {
  const secretKey = new Uint8Array(32)
  crypto.getRandomValues(secretKey)
  // schnorr.getPublicKey() returns the x-only 32-byte pubkey directly.
  const pub = schnorr.getPublicKey(secretKey)
  return { secretKey, pubkeyHex: bytesToHex(pub) }
}

// ---- Nostr event construction ---------------------------------------------

/**
 * NIP-01 canonical serialization used to compute the event id:
 *   `[0, pubkey, created_at, kind, tags, content]`
 *
 * The JSON encoding must be stable — strfry and nostr-tools both use
 * `JSON.stringify` over this shape, so we mirror them exactly.
 */
function serializeForId(ev: {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}): string {
  return JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])
}

export function signGossipEvent(
  kp: EphemeralKeypair,
  content: BundleAttestContent
): GossipNostrEvent {
  const base = {
    pubkey: kp.pubkeyHex,
    created_at: content.timestamp,
    kind: BUNDLE_ATTEST_KIND,
    tags: [[...GOSSIP_TAG]],
    content: JSON.stringify(content),
  }
  const serialized = serializeForId(base)
  const id = bytesToHex(sha256(utf8ToBytes(serialized)))
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), kp.secretKey))
  return { id, ...base, sig } as GossipNostrEvent
}

// ---- Signature verification (peer events) --------------------------------

export function verifyGossipEvent(event: GossipNostrEvent): boolean {
  const expectedIdHex = bytesToHex(
    sha256(
      utf8ToBytes(
        serializeForId({
          pubkey: event.pubkey,
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags,
          content: event.content,
        })
      )
    )
  )
  if (expectedIdHex !== event.id) return false
  try {
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))
  } catch {
    return false
  }
}

// ---- Transport -------------------------------------------------------------

export interface GossipTransport {
  publish(event: GossipNostrEvent): Promise<void>
  subscribe(kinds: number[], onEvent: (event: GossipNostrEvent) => void): () => void
}

// ---- Client ----------------------------------------------------------------

interface GossipClientConfig {
  transport: GossipTransport
  /** Pre-computed bundle hash for the currently running SPA. */
  ownBundleHash: string
  /** Semver or build id string (e.g., `1.4.2`). */
  bundleVersion: string
  /** Release tag from the cosign pipeline (e.g., `v1.4.2`). */
  releaseTag: string
  /**
   * Optional user-agent override. Defaults to `navigator.userAgent` sliced
   * to 256 chars. Test harnesses pass a fixed value so snapshots are
   * stable.
   */
  userAgent?: string
  /** Injected keypair for determinism in tests; otherwise ephemeral. */
  keypair?: EphemeralKeypair
  /** Clock injection for tests. Returns epoch seconds. */
  now?: () => number
}

export interface FleetObservation {
  readonly content: BundleAttestContent
  readonly event: GossipNostrEvent
  readonly divergent: boolean
}

type FleetObserver = (obs: FleetObservation) => void

export class GossipVersionClient {
  private readonly keypair: EphemeralKeypair
  private readonly observers = new Set<FleetObserver>()
  private unsubscribe: (() => void) | null = null
  private destroyed = false
  private readonly userAgent: string
  private readonly now: () => number

  constructor(private readonly config: GossipClientConfig) {
    if (!/^[0-9a-f]{64}$/.test(config.ownBundleHash)) {
      throw new Error('gossip: ownBundleHash must be 64-char lowercase hex')
    }
    this.keypair = config.keypair ?? createEphemeralKeypair()
    this.userAgent =
      config.userAgent ??
      (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown').slice(0, 256)
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000))
  }

  get pubkeyHex(): string {
    return this.keypair.pubkeyHex
  }

  async publishOwnAttest(): Promise<GossipNostrEvent> {
    if (this.destroyed) throw new Error('gossip: client destroyed')
    const content: BundleAttestContent = {
      version: 1,
      bundleHash: this.config.ownBundleHash,
      bundleVersion: this.config.bundleVersion,
      releaseTag: this.config.releaseTag,
      timestamp: this.now(),
      userAgent: this.userAgent,
    }
    // Schema guard: we never publish anything that wouldn't round-trip.
    BundleAttestContentSchema.parse(content)
    const event = signGossipEvent(this.keypair, content)
    await this.config.transport.publish(event)
    return event
  }

  /**
   * Subscribe a single observer to fleet attestations. Every incoming
   * event is verified (id recomputation + schnorr), then its content is
   * schema-validated, then the observer is called. The `divergent` flag
   * is pre-computed so consumers don't need to duplicate the compare.
   */
  observe(observer: FleetObserver): () => void {
    if (this.destroyed) throw new Error('gossip: client destroyed')
    this.observers.add(observer)
    if (!this.unsubscribe) {
      this.unsubscribe = this.config.transport.subscribe([BUNDLE_ATTEST_KIND], (event) =>
        this.handleEvent(event)
      )
    }
    return () => {
      this.observers.delete(observer)
      if (this.observers.size === 0 && this.unsubscribe) {
        this.unsubscribe()
        this.unsubscribe = null
      }
    }
  }

  private handleEvent(event: GossipNostrEvent): void {
    // Outer shape guard: reject anything that doesn't match the kind /
    // pubkey / sig formats we signed for. This is what stops malformed
    // relay output from reaching the UI.
    const outer = GossipNostrEventSchema.safeParse(event)
    if (!outer.success) return

    // Drop our own echoes — relays replay ephemeral events to every
    // subscriber including the publisher, and a healthy match against
    // our own attest isn't interesting.
    if (outer.data.pubkey === this.keypair.pubkeyHex) return

    if (!verifyGossipEvent(outer.data)) return

    let parsedContent: BundleAttestContent
    try {
      const json: unknown = JSON.parse(outer.data.content)
      const parsed = BundleAttestContentSchema.safeParse(json)
      if (!parsed.success) return
      parsedContent = parsed.data
    } catch {
      return
    }

    const divergent = parsedContent.bundleHash !== this.config.ownBundleHash
    const obs: FleetObservation = {
      content: parsedContent,
      event: outer.data,
      divergent,
    }
    for (const o of this.observers) o(obs)
  }

  destroy(): void {
    this.destroyed = true
    this.observers.clear()
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    // Zero the secret key so a post-use memory inspection turns up nothing.
    this.keypair.secretKey.fill(0)
  }
}
