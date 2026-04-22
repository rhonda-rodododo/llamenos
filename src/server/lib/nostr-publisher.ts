/**
 * Nostr event publisher — platform-agnostic interface for publishing
 * server-signed events to a Nostr relay.
 *
 * CF deployment: service binding HTTP POST to Nosflare relay worker
 * Node deployment: persistent WebSocket to strfry relay
 *
 * The publisher handles event signing with the server keypair.
 * Callers provide EventTemplates; the publisher signs and publishes.
 */

import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_SERVER_NOSTR_KEY, LABEL_SERVER_NOSTR_KEY_INFO } from '@shared/crypto-labels'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { createLogger } from './logger'

const log = createLogger('lib.nostr-publisher')

/**
 * NostrPublisher interface — all platform implementations must satisfy this.
 */
export interface NostrPublisher {
  /** Sign and publish an event template to the relay */
  publish(template: EventTemplate): Promise<void>

  /** Get the server's public key (hex, x-only 32 bytes) */
  readonly serverPubkey: string

  /** Eager connection (optional — implementations without persistent connections can no-op) */
  connect?(): Promise<void>

  /** Graceful shutdown (close connections, flush queues) */
  close(): void
}

/**
 * Derive the server Nostr keypair from SERVER_NOSTR_SECRET using HKDF.
 *
 * This is deterministic — same secret always produces the same keypair.
 * The secret should be a 32-byte hex string generated once per deployment
 * (e.g., `openssl rand -hex 32`).
 *
 * Returns { secretKey, pubkey } where pubkey is hex x-only (32 bytes).
 */
export function deriveServerKeypair(serverSecret: string): {
  secretKey: Uint8Array
  pubkey: string
} {
  const secretBytes = hexToBytes(serverSecret)
  const secretKey = hkdf(
    sha256,
    secretBytes,
    utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
    utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
    32
  )
  const pubkey = getPublicKey(secretKey)
  return { secretKey, pubkey }
}

/**
 * Sign an event template with the server keypair.
 * Returns a fully signed VerifiedEvent ready for relay submission.
 *
 * @knipignore — Nostr event signing utility; used by publisher implementations and tests
 */
export function signServerEvent(template: EventTemplate, secretKey: Uint8Array): VerifiedEvent {
  return finalizeEvent(template, secretKey)
}

/**
 * Cloudflare NostrPublisher — publishes events via service binding
 * HTTP POST to the Nosflare relay worker.
 *
 * The service binding is an internal RPC call within the CF account,
 * so latency is <10ms with no TLS overhead.
 *
 * @knipignore — Cloudflare runtime variant; selected at startup based on platform
 */
export class CFNostrPublisher implements NostrPublisher {
  readonly serverPubkey: string
  private readonly secretKey: Uint8Array

  constructor(
    private readonly relayBinding: { fetch(request: Request): Promise<Response> },
    serverSecret: string
  ) {
    const keypair = deriveServerKeypair(serverSecret)
    this.secretKey = keypair.secretKey
    this.serverPubkey = keypair.pubkey
  }

  async publish(template: EventTemplate): Promise<void> {
    const event = signServerEvent(template, this.secretKey)

    const res = await this.relayBinding.fetch(
      new Request('http://relay/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      })
    )

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown error')
      throw new Error(`Relay rejected event (kind=${template.kind}): ${text}`)
    }
  }

  close(): void {
    // No persistent connection to close for CF service binding
  }
}

/**
 * Node.js NostrPublisher — maintains a persistent WebSocket connection
 * to a strfry (or any NIP-01 compliant) relay.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Event queue for events published during reconnection
 * - NIP-42 authentication on connect
 * - Graceful shutdown
 *
 * @knipignore — Node.js/Bun runtime variant; selected at startup by createNostrPublisher()
 */
export class NodeNostrPublisher implements NostrPublisher {
  readonly serverPubkey: string
  private readonly secretKey: Uint8Array
  private ws: WebSocket | null = null
  private authenticated = false
  private connecting = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pendingEvents: VerifiedEvent[] = []
  private closed = false
  private static readonly MAX_PENDING = 500
  private authTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly relayUrl: string,
    serverSecret: string
  ) {
    const keypair = deriveServerKeypair(serverSecret)
    this.secretKey = keypair.secretKey
    this.serverPubkey = keypair.pubkey
  }

  /**
   * Connect to the relay. Called automatically on first publish,
   * or can be called explicitly for eager connection.
   */
  async connect(): Promise<void> {
    if (this.closed || this.connecting) return
    if (this.ws?.readyState === WebSocket.OPEN) return

    this.connecting = true

    try {
      const ws = new WebSocket(this.relayUrl)

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close()
          reject(new Error(`WebSocket connection timeout to ${this.relayUrl}`))
        }, 10_000)

        ws.addEventListener('open', () => {
          clearTimeout(timeout)
          this.ws = ws
          this.reconnectAttempts = 0
          this.setupListeners(ws)
          resolve()
        })

        ws.addEventListener('error', (e) => {
          clearTimeout(timeout)
          reject(new Error(`WebSocket connection error: ${e}`))
        })
      })
    } catch (err) {
      this.scheduleReconnect()
      throw err
    } finally {
      this.connecting = false
    }
  }

  async publish(template: EventTemplate): Promise<void> {
    const event = signServerEvent(template, this.secretKey)

    if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify(['EVENT', event]))
      return
    }

    // Bounded queue — drop oldest if at capacity
    if (this.pendingEvents.length >= NodeNostrPublisher.MAX_PENDING) {
      this.pendingEvents.shift()
      log.warn('Queue full, dropping oldest event')
    }
    this.pendingEvents.push(event)

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect().catch((err) => {
        log.error('Failed to connect', err)
      })
    }
  }

  close(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.authTimer) {
      clearTimeout(this.authTimer)
      this.authTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.pendingEvents = []
  }

  private setupListeners(ws: WebSocket): void {
    ws.addEventListener('message', (msg) => {
      try {
        const data = JSON.parse(typeof msg.data === 'string' ? msg.data : '')
        if (Array.isArray(data)) {
          if (data[0] === 'AUTH') {
            if (this.authTimer) {
              clearTimeout(this.authTimer)
              this.authTimer = null
            }
            this.handleNIP42Auth(data[1] as string)
          } else if (data[0] === 'OK') {
            // Event accepted — data[1] is event ID, data[2] is boolean, data[3] is message
            if (!data[2]) {
              log.warn('Event rejected by relay', { eventId: data[1], reason: data[3] })
            }
          } else if (data[0] === 'NOTICE') {
            log.warn('Relay notice', { notice: data[1] })
          }
        }
      } catch {
        // Ignore malformed messages
      }
    })

    ws.addEventListener('close', () => {
      this.authenticated = false
      this.ws = null
      if (this.authTimer) {
        clearTimeout(this.authTimer)
        this.authTimer = null
      }
      if (!this.closed) {
        this.scheduleReconnect()
      }
    })

    ws.addEventListener('error', (err) => {
      log.error('WebSocket error', err)
    })

    // If no AUTH challenge arrives within 2s, assume open relay
    this.authTimer = setTimeout(() => {
      this.authTimer = null
      if (!this.authenticated && this.ws === ws) {
        this.authenticated = true
        this.flushPendingEvents()
      }
    }, 2000)
  }

  private handleNIP42Auth(challenge: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['relay', this.relayUrl],
          ['challenge', challenge],
        ],
        content: '',
      },
      this.secretKey
    )

    this.ws.send(JSON.stringify(['AUTH', authEvent]))
    this.authenticated = true
    this.flushPendingEvents()
  }

  private flushPendingEvents(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    while (this.pendingEvents.length > 0) {
      const event = this.pendingEvents.shift()!
      this.ws.send(JSON.stringify(['EVENT', event]))
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return

    this.reconnectAttempts++
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch((err) => {
        log.error('Reconnect failed', err)
      })
    }, delay)
  }
}

/**
 * No-op publisher for deployments without a relay configured.
 * Events are silently dropped. Used when SERVER_NOSTR_SECRET is not set.
 *
 * @knipignore — fallback variant; selected at startup when relay is unconfigured
 */
export class NoopNostrPublisher implements NostrPublisher {
  readonly serverPubkey = ''

  async publish(_template: EventTemplate): Promise<void> {
    // No relay configured — silently drop events
  }

  close(): void {
    // Nothing to close
  }
}

/**
 * Create the appropriate NostrPublisher for the current platform.
 *
 * CF: Uses NOSFLARE service binding
 * Node: Uses NOSTR_RELAY_URL WebSocket
 * Neither: Returns NoopNostrPublisher
 */
export function createNostrPublisher(env: {
  NOSFLARE?: { fetch(request: Request): Promise<Response> }
  SERVER_NOSTR_SECRET?: string
  NOSTR_RELAY_URL?: string
}): NostrPublisher {
  if (!env.SERVER_NOSTR_SECRET) {
    return new NoopNostrPublisher()
  }

  // CF deployment: service binding to Nosflare relay
  if (env.NOSFLARE) {
    return new CFNostrPublisher(env.NOSFLARE, env.SERVER_NOSTR_SECRET)
  }

  // Node deployment: persistent WebSocket to strfry
  if (env.NOSTR_RELAY_URL) {
    return new NodeNostrPublisher(env.NOSTR_RELAY_URL, env.SERVER_NOSTR_SECRET)
  }

  return new NoopNostrPublisher()
}
