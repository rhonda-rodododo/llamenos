import { HMAC_PHONE_PREFIX, LABEL_PUSH_CREDENTIAL, LABEL_USER_PII } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'
import type { Database } from '../db'
import { pushSubscriptions } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import { createLogger } from '../lib/logger'

const log = createLogger('services.push')

export interface PushSubscriptionData {
  pubkey: string
  endpoint: string
  authKey: string
  p256dhKey: string
  deviceLabel?: string
}

export interface PushSubscription {
  id: string
  pubkey: string
  endpoint: string
  authKey: string
  p256dhKey: string
  deviceLabel: string | null
  createdAt: string
  updatedAt: string
}

export class PushService {
  #vapidConfigured = false

  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  async #rowToSubscription(row: typeof pushSubscriptions.$inferSelect): Promise<PushSubscription> {
    const endpoint = this.crypto.serverDecrypt(
      row.encryptedEndpoint as Ciphertext,
      LABEL_PUSH_CREDENTIAL
    )
    const authKey = this.crypto.serverDecrypt(
      row.encryptedAuthKey as Ciphertext,
      LABEL_PUSH_CREDENTIAL
    )
    const p256dhKey = this.crypto.serverDecrypt(
      row.encryptedP256dhKey as Ciphertext,
      LABEL_PUSH_CREDENTIAL
    )

    const dlEnvelopes =
      (row.deviceLabelEnvelopes as import('@shared/types').RecipientEnvelope[]) ?? []
    const deviceLabel =
      (await this.crypto.envelopeDecryptFromList(dlEnvelopes, LABEL_USER_PII, '', 'deviceLabel')) ??
      null

    return {
      id: row.id,
      pubkey: row.pubkey,
      endpoint,
      authKey,
      p256dhKey,
      deviceLabel,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  /** Create or update a push subscription (upsert on endpoint). */
  async subscribe(data: PushSubscriptionData): Promise<PushSubscription> {
    const now = new Date()

    // Encrypt push credentials with server key
    const encryptedEndpoint = this.crypto.serverEncrypt(data.endpoint, LABEL_PUSH_CREDENTIAL)
    const encryptedAuthKey = this.crypto.serverEncrypt(data.authKey, LABEL_PUSH_CREDENTIAL)
    const encryptedP256dhKey = this.crypto.serverEncrypt(data.p256dhKey, LABEL_PUSH_CREDENTIAL)

    // HMAC hash endpoint for dedup
    const endpointHash = this.crypto.hmac(data.endpoint, HMAC_PHONE_PREFIX)

    // E2EE envelope-encrypt device label for the user's own pubkey (client-side decryption)
    // Only attempt if pubkey looks like a valid 64-char hex secp256k1 x-only pubkey
    let labelEnvelope: Awaited<ReturnType<CryptoService['envelopeEncrypt']>> | undefined
    if (data.deviceLabel && /^[0-9a-f]{64}$/i.test(data.pubkey)) {
      labelEnvelope = await this.crypto.envelopeEncrypt(
        data.deviceLabel,
        [data.pubkey],
        LABEL_USER_PII,
        '',
        'deviceLabel'
      )
    }

    // E2EE device label: use envelope ciphertext if available, fallback to server-key
    const encryptedDeviceLabel = data.deviceLabel
      ? labelEnvelope
        ? labelEnvelope.encrypted
        : this.crypto.serverEncrypt(data.deviceLabel, LABEL_USER_PII)
      : undefined

    const [row] = await this.db
      .insert(pushSubscriptions)
      .values({
        pubkey: data.pubkey,
        endpointHash,
        encryptedEndpoint,
        encryptedAuthKey,
        encryptedP256dhKey,
        ...(encryptedDeviceLabel ? { encryptedDeviceLabel } : {}),
        ...(labelEnvelope ? { deviceLabelEnvelopes: labelEnvelope.envelopes } : {}),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpointHash,
        set: {
          pubkey: data.pubkey,
          encryptedAuthKey,
          encryptedP256dhKey,
          encryptedEndpoint,
          endpointHash,
          ...(encryptedDeviceLabel ? { encryptedDeviceLabel } : {}),
          ...(labelEnvelope ? { deviceLabelEnvelopes: labelEnvelope.envelopes } : {}),
          updatedAt: now,
        },
      })
      .returning()
    return await this.#rowToSubscription(row)
  }

  /** Remove a subscription by endpoint, verifying ownership by pubkey. */
  async unsubscribe(endpoint: string, pubkey: string): Promise<void> {
    const endpointHash = this.crypto.hmac(endpoint, HMAC_PHONE_PREFIX)
    const rows = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpointHash, endpointHash))
      .limit(1)

    if (rows.length === 0) {
      return // Already gone — idempotent
    }

    const [row] = rows
    if (row.pubkey !== pubkey) {
      throw new AppError(403, 'Cannot unsubscribe a subscription belonging to a different user')
    }

    await this.db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpointHash, endpointHash), eq(pushSubscriptions.pubkey, pubkey))
      )
  }

  /** Remove a stale subscription by endpoint only (called when push delivery fails). */
  async removeStaleSubscription(endpoint: string): Promise<void> {
    const endpointHash = this.crypto.hmac(endpoint, HMAC_PHONE_PREFIX)
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpointHash, endpointHash))
  }

  /** Get all subscriptions for a single user pubkey. */
  async getSubscriptionsForPubkey(pubkey: string): Promise<PushSubscription[]> {
    const rows = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.pubkey, pubkey))
    return Promise.all(rows.map((r) => this.#rowToSubscription(r)))
  }

  /** Get all subscriptions for a list of user pubkeys. */
  async getSubscriptionsForPubkeys(pubkeys: string[]): Promise<PushSubscription[]> {
    if (pubkeys.length === 0) return []
    const rows = await this.db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.pubkey, pubkeys))
    return Promise.all(rows.map((r) => this.#rowToSubscription(r)))
  }

  /**
   * Send Web Push notifications to all subscriptions for the given user pubkeys.
   * Stale subscriptions (410/404) are automatically removed.
   * Non-fatal delivery errors are logged but do not throw.
   */
  async sendPushToUsers(
    pubkeys: string[],
    data: { type: string; callSid: string; hubId: string },
    env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string }
  ): Promise<void> {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return

    // Configure VAPID once (idempotent — same values each call, but avoids repeated setup)
    if (!this.#vapidConfigured) {
      webpush.setVapidDetails(
        'mailto:admin@llamenos.org',
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY
      )
      this.#vapidConfigured = true
    }

    const subscriptions = await this.getSubscriptionsForPubkeys(pubkeys)
    const payload = JSON.stringify(data)

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { auth: sub.authKey, p256dh: sub.p256dhKey } },
            payload,
            { TTL: 30, urgency: 'high' }
          )
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode === 410 || statusCode === 404) {
            await this.removeStaleSubscription(sub.endpoint)
          } else {
            log.warn('Failed to send push', { statusCode: statusCode ?? 'unknown' })
          }
        }
      })
    )
  }
}
