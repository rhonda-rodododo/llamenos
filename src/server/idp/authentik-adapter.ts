/**
 * AuthentikAdapter — IdPAdapter implementation backed by Authentik's REST API.
 *
 * Users are keyed by Nostr pubkey (hex) as their username.
 * The nsec_secret is stored in user.attributes as an envelope-encrypted hex string.
 *
 * Encryption scheme: AES-256-GCM, key derived via HKDF from
 * IDP_VALUE_ENCRYPTION_KEY with domain separation label LABEL_IDP_VALUE_WRAP.
 * Stored format: "<nonce_hex>:<ciphertext_hex>"
 */

import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { aesGcmDecrypt, aesGcmEncrypt } from '@shared/aes-gcm'
import { LABEL_IDP_VALUE_WRAP } from '@shared/crypto-labels'
import type { IdPAdapter, IdPUser, InviteOpts, NsecSecretRotation } from './adapter'

// --- Config ---

export interface AuthentikConfig {
  /** Base URL of the Authentik instance, e.g. https://auth.example.com */
  url: string
  /** Service account API token */
  apiToken: string
  /** Hex-encoded 32-byte master key for idp_value envelope encryption (64 hex chars) */
  idpValueEncryptionKey: string
}

// --- Raw Authentik API shapes ---

interface AuthentikUser {
  pk: number
  username: string
  name: string
  is_active: boolean
  path: string
  attributes: Record<string, string>
}

interface AuthentikListResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

interface AuthentikInvitation {
  pk: string
  name: string
  expires: string | null
  flow_slug: string
  single_use: boolean
}

// --- Adapter ---

export class AuthentikAdapter implements IdPAdapter {
  private readonly config: AuthentikConfig
  private readonly encKey: Uint8Array

  constructor(config: AuthentikConfig) {
    this.config = config
    const ikm = hexToBytes(config.idpValueEncryptionKey)
    this.encKey = hkdf(
      sha256,
      ikm,
      utf8ToBytes(LABEL_IDP_VALUE_WRAP),
      utf8ToBytes('llamenos:idp-value-enc'),
      32
    )
  }

  async initialize(): Promise<void> {
    // Authentik health-check can report ready before its API is fully bootstrapped
    // (returns 503 during startup). Retry with backoff up to ~30s to handle this.
    const maxAttempts = 10
    let lastStatus = 0
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await this.apiCall('GET', '/api/v3/core/users/?page_size=1')
      if (res.ok) return
      lastStatus = res.status
      // 503 = still starting up, retry. Other codes = fail fast.
      if (res.status !== 503) {
        throw new Error(`Authentik API connectivity check failed: HTTP ${res.status}`)
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    }
    throw new Error(
      `Authentik API connectivity check failed after ${maxAttempts} attempts: HTTP ${lastStatus}`
    )
  }

  // --- User lifecycle ---

  async createUser(pubkey: string): Promise<IdPUser> {
    const secret = generateRandomBytes(32)
    const encryptedSecret = await this.encryptSecret(secret)

    const res = await this.apiCall('POST', '/api/v3/core/users/', {
      username: pubkey,
      name: pubkey,
      is_active: true,
      path: 'llamenos',
      attributes: {
        nsec_secret: encryptedSecret,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Failed to create Authentik user: HTTP ${res.status} — ${body}`)
    }

    const user = (await res.json()) as AuthentikUser
    return toIdPUser(user)
  }

  async getUser(pubkey: string): Promise<IdPUser | null> {
    const user = await this.findUserByPubkey(pubkey)
    return user ? toIdPUser(user) : null
  }

  async deleteUser(pubkey: string): Promise<void> {
    const user = await this.requireUserByPubkey(pubkey)

    const res = await this.apiCall('DELETE', `/api/v3/core/users/${user.pk}/`)
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete Authentik user: HTTP ${res.status}`)
    }
  }

  // --- Nsec encryption secret ---

  async getNsecSecret(pubkey: string): Promise<Uint8Array> {
    const user = await this.requireUserByPubkey(pubkey)
    const encrypted = user.attributes.nsec_secret
    if (!encrypted) {
      throw new Error(`No nsec_secret found in Authentik attributes for user ${pubkey}`)
    }
    return await this.decryptSecret(encrypted)
  }

  async rotateNsecSecret(pubkey: string): Promise<NsecSecretRotation> {
    const user = await this.requireUserByPubkey(pubkey)

    const oldEncrypted = user.attributes.nsec_secret
    if (!oldEncrypted) {
      throw new Error(`No existing nsec_secret to rotate for user ${pubkey}`)
    }

    const previous = await this.decryptSecret(oldEncrypted)
    const current = generateRandomBytes(32)
    const newEncrypted = await this.encryptSecret(current)

    const patchAttributes: Record<string, string> = {
      ...user.attributes,
      nsec_secret: newEncrypted,
      previous_nsec_secret: oldEncrypted,
    }

    const res = await this.apiCall('PATCH', `/api/v3/core/users/${user.pk}/`, {
      attributes: patchAttributes,
    })
    if (!res.ok) {
      throw new Error(`Failed to rotate nsec_secret for user ${pubkey}: HTTP ${res.status}`)
    }

    return { current, previous }
  }

  async confirmRotation(pubkey: string): Promise<void> {
    const user = await this.requireUserByPubkey(pubkey)

    // Rebuild attributes without previous_nsec_secret (avoid delete operator)
    const { previous_nsec_secret: _discarded, ...patchAttributes } = user.attributes

    const res = await this.apiCall('PATCH', `/api/v3/core/users/${user.pk}/`, {
      attributes: patchAttributes,
    })
    if (!res.ok) {
      throw new Error(`Failed to confirm rotation for user ${pubkey}: HTTP ${res.status}`)
    }
  }

  // --- Session management ---

  async refreshSession(pubkey: string): Promise<{ valid: boolean }> {
    const user = await this.findUserByPubkey(pubkey)
    if (!user) return { valid: false }
    return { valid: user.is_active }
  }

  async revokeSession(pubkey: string): Promise<void> {
    // Authentik session revocation: delete all authenticated sessions for the user.
    // The facade manages its own JWT sessions; this signals the IdP to invalidate.
    await this.deleteAuthentikSessions(pubkey)
  }

  async revokeAllSessions(pubkey: string): Promise<void> {
    await this.deleteAuthentikSessions(pubkey)
  }

  // --- Invite / enrollment ---

  async createInviteLink(opts: InviteOpts): Promise<string> {
    const expiresInMs = opts.expiresInMs ?? 7 * 24 * 60 * 60 * 1000
    const expires = new Date(Date.now() + expiresInMs).toISOString()

    const body: Record<string, unknown> = {
      name: `invite-${opts.createdBy.slice(0, 8)}-${Date.now()}`,
      expires,
      single_use: true,
      flow_slug: 'default-enrollment-flow',
    }

    if (opts.roles && opts.roles.length > 0) {
      body.fixed_data = { roles: opts.roles }
    }

    const res = await this.apiCall('POST', '/api/v3/stages/invitation/invitations/', body)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to create invite: HTTP ${res.status} — ${text}`)
    }

    const invitation = (await res.json()) as AuthentikInvitation
    const baseUrl = this.config.url.replace(/\/$/, '')
    return `${baseUrl}/if/flow/default-enrollment-flow/?itoken=${invitation.pk}`
  }

  // --- Private helpers ---

  private async apiCall(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.config.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  private async findUserByPubkey(pubkey: string): Promise<AuthentikUser | null> {
    const res = await this.apiCall(
      'GET',
      `/api/v3/core/users/?username=${encodeURIComponent(pubkey)}`
    )
    if (!res.ok) {
      throw new Error(`Failed to look up Authentik user: HTTP ${res.status}`)
    }
    const data = (await res.json()) as AuthentikListResponse<AuthentikUser>
    return data.results[0] ?? null
  }

  private async requireUserByPubkey(pubkey: string): Promise<AuthentikUser> {
    const user = await this.findUserByPubkey(pubkey)
    if (!user) {
      throw new Error(`Authentik user not found for pubkey: ${pubkey}`)
    }
    return user
  }

  private async deleteAuthentikSessions(pubkey: string): Promise<void> {
    const user = await this.findUserByPubkey(pubkey)
    if (!user) return

    // List all sessions for this user
    const listRes = await this.apiCall(
      'GET',
      `/api/v3/core/authenticated-sessions/?user=${user.pk}`
    )
    if (!listRes.ok) return
    const data = (await listRes.json()) as AuthentikListResponse<{ uuid: string }>

    // Delete each session individually
    for (const session of data.results) {
      await this.apiCall('DELETE', `/api/v3/core/authenticated-sessions/${session.uuid}/`)
    }
  }

  /**
   * Encrypt a secret using AES-256-GCM.
   * Returns the hex-encoded nonce(12) || ciphertext+tag.
   */
  private async encryptSecret(secret: Uint8Array): Promise<string> {
    return aesGcmEncrypt(secret, this.encKey, new Uint8Array(0))
  }

  /**
   * Decrypt a stored secret. Accepts the new AES-GCM format (hex nonce+ct).
   */
  private async decryptSecret(encrypted: string): Promise<Uint8Array> {
    return aesGcmDecrypt(encrypted, this.encKey, new Uint8Array(0))
  }
}

// --- Module-private utilities ---

function generateRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

function toIdPUser(user: AuthentikUser): IdPUser {
  return {
    pubkey: user.username,
    active: user.is_active,
    externalId: String(user.pk),
  }
}
