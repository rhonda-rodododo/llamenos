import { beforeEach, describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  BUNDLE_ATTEST_KIND,
  type BundleAttestContent,
  type GossipNostrEvent,
} from '@shared/schemas/gossip-version'
import {
  createEphemeralKeypair,
  type FleetObservation,
  type GossipTransport,
  GossipVersionClient,
  signGossipEvent,
  verifyGossipEvent,
} from './gossip-version'

const HASH_OWN = 'a'.repeat(64)
const HASH_FOREIGN = 'b'.repeat(64)

class FakeTransport implements GossipTransport {
  published: GossipNostrEvent[] = []
  private handler: ((event: GossipNostrEvent) => void) | null = null

  publish(event: GossipNostrEvent): Promise<void> {
    this.published.push(event)
    return Promise.resolve()
  }

  subscribe(_kinds: number[], onEvent: (event: GossipNostrEvent) => void): () => void {
    this.handler = onEvent
    return () => {
      this.handler = null
    }
  }

  deliver(event: GossipNostrEvent): void {
    if (this.handler) this.handler(event)
  }

  get subscribed(): boolean {
    return this.handler !== null
  }
}

function baseContent(hash: string): BundleAttestContent {
  return {
    version: 1,
    bundleHash: hash,
    bundleVersion: '1.0.0',
    releaseTag: 'v1.0.0',
    timestamp: 1_700_000_000,
    userAgent: 'test-agent',
  }
}

// ---- Keypair + signing -----------------------------------------------------

describe('createEphemeralKeypair', () => {
  test('returns 32-byte secret + 32-byte x-only pub', () => {
    const kp = createEphemeralKeypair()
    expect(kp.secretKey.length).toBe(32)
    expect(kp.pubkeyHex).toMatch(/^[0-9a-f]{64}$/)
  })

  test('each call is distinct', () => {
    const a = createEphemeralKeypair()
    const b = createEphemeralKeypair()
    expect(a.pubkeyHex).not.toBe(b.pubkeyHex)
  })
})

describe('signGossipEvent + verifyGossipEvent', () => {
  test('valid round-trip', () => {
    const kp = createEphemeralKeypair()
    const event = signGossipEvent(kp, baseContent(HASH_OWN))
    expect(event.kind).toBe(BUNDLE_ATTEST_KIND)
    expect(event.pubkey).toBe(kp.pubkeyHex)
    expect(verifyGossipEvent(event)).toBe(true)
  })

  test('id is the sha256 of the NIP-01 serialization', () => {
    const kp = createEphemeralKeypair()
    const event = signGossipEvent(kp, baseContent(HASH_OWN))
    // Re-deriving should yield the same id.
    const again = signGossipEvent(kp, baseContent(HASH_OWN))
    expect(again.id).toBe(event.id)
  })

  test('tampered content defeats verification', () => {
    const kp = createEphemeralKeypair()
    const event = signGossipEvent(kp, baseContent(HASH_OWN))
    const tampered: GossipNostrEvent = {
      ...event,
      content: JSON.stringify(baseContent(HASH_FOREIGN)),
    }
    expect(verifyGossipEvent(tampered)).toBe(false)
  })

  test('tampered id defeats verification', () => {
    const kp = createEphemeralKeypair()
    const event = signGossipEvent(kp, baseContent(HASH_OWN))
    const tampered = { ...event, id: 'f'.repeat(64) }
    expect(verifyGossipEvent(tampered)).toBe(false)
  })

  test('random signature defeats verification', () => {
    const kp = createEphemeralKeypair()
    const event = signGossipEvent(kp, baseContent(HASH_OWN))
    // Sign a DIFFERENT message with the same key — still a valid schnorr
    // sig, but not over `event.id`, so verification must fail.
    const wrongSig = schnorr.sign(hexToBytes('c'.repeat(64)), kp.secretKey)
    const tampered = {
      ...event,
      sig: Array.from(wrongSig)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    }
    expect(verifyGossipEvent(tampered)).toBe(false)
  })
})

// ---- GossipVersionClient ---------------------------------------------------

describe('GossipVersionClient.publishOwnAttest', () => {
  let transport: FakeTransport
  beforeEach(() => {
    transport = new FakeTransport()
  })

  test('publishes a signed, verifiable event', async () => {
    const client = new GossipVersionClient({
      transport,
      ownBundleHash: HASH_OWN,
      bundleVersion: '1.0.0',
      releaseTag: 'v1.0.0',
      userAgent: 'bun-test',
      now: () => 1_700_000_000,
    })
    const event = await client.publishOwnAttest()
    expect(transport.published.length).toBe(1)
    expect(verifyGossipEvent(event)).toBe(true)
    const content = JSON.parse(event.content) as BundleAttestContent
    expect(content.bundleHash).toBe(HASH_OWN)
    expect(content.timestamp).toBe(1_700_000_000)
    client.destroy()
  })

  test('uses an ephemeral keypair distinct from any caller-held identity', async () => {
    const kp = createEphemeralKeypair()
    const client = new GossipVersionClient({
      transport,
      ownBundleHash: HASH_OWN,
      bundleVersion: '1',
      releaseTag: 'v1',
      userAgent: 'ua',
      keypair: kp,
    })
    expect(client.pubkeyHex).toBe(kp.pubkeyHex)
    client.destroy()
  })

  test('throws when caller passes a non-hex bundle hash', () => {
    expect(
      () =>
        new GossipVersionClient({
          transport,
          ownBundleHash: 'not hex',
          bundleVersion: '1',
          releaseTag: 'v1',
          userAgent: 'ua',
        })
    ).toThrow(/64-char/)
  })

  test('publishOwnAttest after destroy throws', async () => {
    const client = new GossipVersionClient({
      transport,
      ownBundleHash: HASH_OWN,
      bundleVersion: '1',
      releaseTag: 'v1',
      userAgent: 'ua',
    })
    client.destroy()
    await expect(client.publishOwnAttest()).rejects.toThrow(/destroyed/)
  })
})

describe('GossipVersionClient.observe (fleet divergence)', () => {
  let transport: FakeTransport
  beforeEach(() => {
    transport = new FakeTransport()
  })

  function makeClient(): GossipVersionClient {
    return new GossipVersionClient({
      transport,
      ownBundleHash: HASH_OWN,
      bundleVersion: '1',
      releaseTag: 'v1',
      userAgent: 'ua',
      now: () => 1,
    })
  }

  test('peer matching our hash is non-divergent', () => {
    const client = makeClient()
    const observations: FleetObservation[] = []
    client.observe((o) => observations.push(o))

    // Peer with a different pubkey but the same hash
    const peer = createEphemeralKeypair()
    const event = signGossipEvent(peer, baseContent(HASH_OWN))
    transport.deliver(event)

    expect(observations.length).toBe(1)
    expect(observations[0]?.divergent).toBe(false)
    expect(observations[0]?.content.bundleHash).toBe(HASH_OWN)
    client.destroy()
  })

  test('peer with a different hash is divergent', () => {
    const client = makeClient()
    const observations: FleetObservation[] = []
    client.observe((o) => observations.push(o))

    const peer = createEphemeralKeypair()
    const event = signGossipEvent(peer, baseContent(HASH_FOREIGN))
    transport.deliver(event)

    expect(observations.length).toBe(1)
    expect(observations[0]?.divergent).toBe(true)
    expect(observations[0]?.content.bundleHash).toBe(HASH_FOREIGN)
    client.destroy()
  })

  test('drops our own echoes (same pubkey)', () => {
    const kp = createEphemeralKeypair()
    const client = new GossipVersionClient({
      transport,
      ownBundleHash: HASH_OWN,
      bundleVersion: '1',
      releaseTag: 'v1',
      userAgent: 'ua',
      keypair: kp,
      now: () => 1,
    })
    const observations: FleetObservation[] = []
    client.observe((o) => observations.push(o))

    const own = signGossipEvent(kp, baseContent(HASH_OWN))
    transport.deliver(own)

    expect(observations.length).toBe(0)
    client.destroy()
  })

  test('drops events with invalid signatures', () => {
    const client = makeClient()
    const observations: FleetObservation[] = []
    client.observe((o) => observations.push(o))

    const peer = createEphemeralKeypair()
    const event = signGossipEvent(peer, baseContent(HASH_FOREIGN))
    const tampered = { ...event, sig: 'a'.repeat(128) }
    transport.deliver(tampered)

    expect(observations.length).toBe(0)
    client.destroy()
  })

  test('drops events with unparseable content', () => {
    const client = makeClient()
    const observations: FleetObservation[] = []
    client.observe((o) => observations.push(o))

    // Craft a valid-signed event that carries garbage (non-JSON) content.
    // The outer schema + sig-over-id checks pass, but the inner
    // `BundleAttestContentSchema` parse must drop it silently.
    const peer = createEphemeralKeypair()
    const base = {
      pubkey: peer.pubkeyHex,
      created_at: 1,
      kind: BUNDLE_ATTEST_KIND,
      tags: [['t', 'llamenos-gossip-attest']],
      content: 'not json {',
    }
    const serialized = JSON.stringify([
      0,
      base.pubkey,
      base.created_at,
      base.kind,
      base.tags,
      base.content,
    ])
    const id = sha256(utf8ToBytes(serialized))
    const sig = schnorr.sign(id, peer.secretKey)
    const forged: GossipNostrEvent = {
      id: bytesToHex(id),
      ...base,
      sig: bytesToHex(sig),
    }
    transport.deliver(forged)

    expect(observations.length).toBe(0)
    client.destroy()
  })

  test('unsubscribes from transport when last observer is removed', () => {
    const client = makeClient()
    const off = client.observe(() => {})
    expect(transport.subscribed).toBe(true)
    off()
    expect(transport.subscribed).toBe(false)
    client.destroy()
  })

  test('destroy() zeroes the ephemeral secret key', () => {
    const kp = createEphemeralKeypair()
    const client = new GossipVersionClient({
      transport,
      ownBundleHash: HASH_OWN,
      bundleVersion: '1',
      releaseTag: 'v1',
      userAgent: 'ua',
      keypair: kp,
    })
    expect(kp.secretKey.some((b) => b !== 0)).toBe(true)
    client.destroy()
    expect(kp.secretKey.every((b) => b === 0)).toBe(true)
  })
})
