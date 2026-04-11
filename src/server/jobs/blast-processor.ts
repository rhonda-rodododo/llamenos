/**
 * BlastProcessor — Core delivery engine for broadcast messages.
 *
 * Polls every 30s for blasts in 'sending' or due 'scheduled' status,
 * then delivers to matching subscribers via messaging adapters.
 *
 * Supports: resume after crash (skip already-delivered), cancellation
 * checks at batch boundaries, per-channel rate limiting, opt-out footers.
 */

import { LABEL_BLAST_CONTENT, LABEL_HUB_FIELD } from '@shared/crypto-labels'
import { eciesUnwrapKey } from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type { MessagingChannelType } from '@shared/types'
import { getMessagingAdapter } from '../lib/adapters'
import type { CryptoService } from '../lib/crypto-service'
import { createLogger } from '../lib/logger'
import { deriveServerKeypair } from '../lib/nostr-publisher'
import type { MessagingAdapter } from '../messaging/adapter'
import type { Services } from '../services'
import { matchesBlastFilters, selectChannel } from '../services/blasts'
import type { Blast, Subscriber, SubscriberChannel } from '../types'

const OPT_OUT_FOOTERS: Record<string, string> = {
  en: 'Reply STOP to unsubscribe',
  es: 'Responda STOP para cancelar la suscripción',
  zh: '回复 STOP 取消订阅',
  tl: 'Mag-reply ng STOP para mag-unsubscribe',
  vi: 'Trả lời STOP để hủy đăng ký',
  ar: 'أرسل STOP لإلغاء الاشتراك',
  fr: 'Répondez STOP pour vous désabonner',
  ht: 'Reponn STOP pou dezabòne',
  ko: 'STOP을 보내 구독을 취소하세요',
  ru: 'Ответьте STOP для отписки',
  hi: 'सदस्यता रद्द करने के लिए STOP भेजें',
  pt: 'Responda STOP para cancelar a assinatura',
  de: 'Antworten Sie STOP zum Abbestellen',
}

/** Per-channel rate-limit delay in milliseconds. */
const CHANNEL_DELAYS: Record<string, number> = {
  sms: 1000,
  whatsapp: 50,
  signal: 500,
  rcs: 200,
}

const log = createLogger('jobs.blast-processor')

const BATCH_SIZE = 50

/** Max concurrent sends per batch per channel. Keeps DB pool and external API load reasonable. */
const CONCURRENCY = 10

export class BlastProcessor {
  private readonly services: Services
  private readonly crypto: CryptoService
  private readonly serverSecret: string
  private processing = false

  constructor(services: Services, crypto: CryptoService, serverSecret: string) {
    this.services = services
    this.crypto = crypto
    this.serverSecret = serverSecret
  }

  /**
   * Single poll iteration — find and process one blast.
   * Called by setInterval every 30s.
   */
  async processOnce(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      const pending = await this.services.blasts.findBlastsToProcess()
      if (pending.length === 0) return

      // Promote any scheduled blasts to 'sending'
      for (const blast of pending) {
        if (blast.status === 'scheduled') {
          await this.services.blasts.updateBlast(blast.id, { status: 'sending' })
          await this.services.records.addAuditEntry(blast.hubId, 'blastScheduled', 'system', {
            blastId: blast.id,
            name: blast.name,
          })
        }
      }

      // Process the first sending blast
      const toProcess = pending.find((b) => b.status === 'sending') ?? pending[0]
      await this.processBlast(toProcess)
    } finally {
      this.processing = false
    }
  }

  /**
   * Process a single blast: filter subscribers, send messages, record deliveries.
   */
  async processBlast(blast: Blast): Promise<void> {
    let hubKey: Uint8Array
    try {
      hubKey = await this._getHubKey(blast.hubId)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error('Failed to get hub key for blast', err, { blastId: blast.id })
      await this.services.blasts.updateBlast(blast.id, {
        status: 'failed' as string,
        error: `Hub key error: ${errorMsg}`,
      })
      await this.services.records.addAuditEntry(blast.hubId, 'blastFailed', 'system', {
        blastId: blast.id,
        name: blast.name,
        error: `Hub key error: ${errorMsg}`,
      })
      return
    }

    // Decrypt blast content from server's ECIES envelope
    let blastText: string
    try {
      blastText = this._decryptBlastContent(blast)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error('Failed to decrypt blast content', err, { blastId: blast.id })
      await this.services.blasts.updateBlast(blast.id, {
        status: 'failed' as string,
        error: `Blast decryption error: ${errorMsg}`,
      })
      await this.services.records.addAuditEntry(blast.hubId, 'blastFailed', 'system', {
        blastId: blast.id,
        name: blast.name,
        error: `Blast decryption error: ${errorMsg}`,
      })
      return
    }

    // Load all subscribers for this hub
    const allSubscribers = await this.services.blasts.listSubscribers(blast.hubId)

    // Filter by blast targeting criteria
    const eligible = allSubscribers.filter((sub) =>
      matchesBlastFilters(sub, blast.targetChannels, blast.targetTags, blast.targetLanguages)
    )

    // Skip already-delivered (for resume after crash)
    const delivered = await this.services.blasts.getDeliveredSubscriberIds(blast.id)
    const remaining = eligible.filter((sub) => !delivered.has(sub.id))

    // Update total recipients stat
    await this.services.blasts.updateBlast(blast.id, {
      stats: { totalRecipients: eligible.length },
    })

    let sentCount = delivered.size // start from already-delivered count
    let failedCount = 0

    // Group remaining subscribers by channel type so each channel queue can
    // be processed concurrently with its own rate-limit cadence.
    const channelBatches = new Map<string, Array<{ sub: Subscriber; channel: SubscriberChannel }>>()
    for (const sub of remaining) {
      const channel = selectChannel(sub, blast.targetChannels)
      if (!channel) {
        failedCount++
        continue
      }
      const key = channel.type
      if (!channelBatches.has(key)) channelBatches.set(key, [])
      channelBatches.get(key)!.push({ sub, channel })
    }

    // Each channel type runs its own queue concurrently. Within a channel we
    // send CONCURRENCY recipients in parallel, then apply the per-channel
    // rate-limit delay once per batch (amortising it across the batch).
    let wasCancelled = false

    const channelPromises = Array.from(channelBatches.entries()).map(
      async ([channelType, recipients]) => {
        const delay = CHANNEL_DELAYS[channelType] ?? CHANNEL_DELAYS.sms
        let adapter: MessagingAdapter | null = null

        for (let i = 0; i < recipients.length; i += CONCURRENCY) {
          // Check cancellation at BATCH_SIZE boundaries (same semantics as before)
          if (i > 0 && i % BATCH_SIZE === 0) {
            const current = await this.services.blasts.getBlast(blast.id)
            if (current?.status === 'cancelled') {
              wasCancelled = true
              await this.services.blasts.updateBlast(blast.id, {
                stats: { sent: sentCount, failed: failedCount },
              })
              await this.services.records.addAuditEntry(blast.hubId, 'blastCancelled', 'system', {
                blastId: blast.id,
                name: blast.name,
                sent: sentCount,
                remaining: recipients.length - i,
              })
              return
            }

            // Periodic stats update at batch boundary
            await this.services.blasts.updateBlast(blast.id, {
              stats: { sent: sentCount, failed: failedCount },
            })
          }

          const batch = recipients.slice(i, i + CONCURRENCY)

          // Get adapter once per channel type (lazy init)
          if (!adapter) {
            adapter = await this._getAdapter(channelType as MessagingChannelType, blast.hubId)
          }

          // Send the batch concurrently
          const results = await Promise.allSettled(
            batch.map(async ({ sub, channel }) => {
              const identifier = await this._decryptIdentifier(sub.encryptedIdentifier!, hubKey)
              if (!identifier) {
                failedCount++
                await this.services.blasts.createDelivery({
                  blastId: blast.id,
                  subscriberId: sub.id,
                  channelType: channel.type,
                  status: 'failed',
                  error: 'Failed to decrypt identifier',
                })
                return
              }

              const footer = OPT_OUT_FOOTERS[sub.language ?? 'en'] ?? OPT_OUT_FOOTERS.en
              const body = `${blastText}\n\n${footer}`

              try {
                const result = await adapter!.sendMessage({
                  recipientIdentifier: identifier,
                  body,
                })

                if (result.success) {
                  sentCount++
                  await this.services.blasts.createDelivery({
                    blastId: blast.id,
                    subscriberId: sub.id,
                    channelType: channel.type,
                    status: 'sent',
                  })
                } else {
                  failedCount++
                  await this.services.blasts.createDelivery({
                    blastId: blast.id,
                    subscriberId: sub.id,
                    channelType: channel.type,
                    status: 'failed',
                    error: result.error ?? 'Send failed',
                  })
                }
              } catch (err) {
                failedCount++
                const errorMsg = err instanceof Error ? err.message : String(err)
                await this.services.blasts.createDelivery({
                  blastId: blast.id,
                  subscriberId: sub.id,
                  channelType: channel.type,
                  status: 'failed',
                  error: errorMsg,
                })
              }
            })
          )

          // Log any unexpected Promise.allSettled rejections (should not occur — inner catch covers it)
          for (const r of results) {
            if (r.status === 'rejected') {
              failedCount++
              log.error('Unexpected send error', r.reason)
            }
          }

          // Apply rate-limit delay once per concurrent batch (amortised over CONCURRENCY sends)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    )

    // Wait for all channel queues to complete
    await Promise.all(channelPromises)

    // If any channel triggered a cancellation we already emitted the audit entry; skip final update
    if (wasCancelled) return

    // Final status update
    await this.services.blasts.updateBlast(blast.id, {
      status: 'sent',
      sentAt: new Date(),
      stats: { sent: sentCount, failed: failedCount },
    })

    await this.services.records.addAuditEntry(blast.hubId, 'blastSent', 'system', {
      blastId: blast.id,
      name: blast.name,
      totalRecipients: eligible.length,
      sent: sentCount,
      failed: failedCount,
    })
  }

  // ── Overridable helpers for testing ──

  /** Get the hub's decrypted hub key. Override in tests. */
  async _getHubKey(hubId: string): Promise<Uint8Array> {
    const envelopes = await this.services.settings.getHubKeyEnvelopes(hubId)
    return this.crypto.unwrapHubKey(envelopes)
  }

  /** Decrypt an encrypted subscriber identifier. Override in tests. */
  async _decryptIdentifier(encrypted: string, hubKey: Uint8Array): Promise<string | null> {
    return this.crypto.hubDecrypt(encrypted as Ciphertext, hubKey, LABEL_HUB_FIELD)
  }

  /**
   * Decrypt blast content from the server's ECIES envelope.
   * Derives server keypair, finds matching envelope, unwraps the blast key,
   * then decrypts the content and returns the plaintext message text.
   */
  _decryptBlastContent(blast: Blast): string {
    const { secretKey, pubkey } = deriveServerKeypair(this.serverSecret)

    const envelope = blast.contentEnvelopes.find((e) => e.pubkey === pubkey)
    if (!envelope) {
      throw new Error(`No blast content envelope for server pubkey ${pubkey}`)
    }

    // ECIES-unwrap the per-blast symmetric key and decrypt content
    const plaintext = this.crypto.envelopeDecrypt(
      blast.encryptedContent as Ciphertext,
      envelope,
      secretKey,
      LABEL_BLAST_CONTENT
    )

    // Parse JSON payload and return text field
    const payload = JSON.parse(plaintext) as { text: string }
    return payload.text
  }

  /** Get a messaging adapter for the given channel type. Override in tests. */
  async _getAdapter(channel: MessagingChannelType, hubId: string): Promise<MessagingAdapter> {
    return getMessagingAdapter(channel, this.services.settings, this.crypto, hubId)
  }
}

/**
 * Schedule the blast processor to run every 30 seconds.
 * Call once during server startup.
 */
export function scheduleBlastProcessor(
  services: Services,
  crypto: CryptoService,
  serverSecret: string
): NodeJS.Timeout {
  const processor = new BlastProcessor(services, crypto, serverSecret)
  // Run once immediately on startup (resume any in-progress blasts)
  processor.processOnce().catch((err) => log.error('Initial run failed', err))
  return setInterval(() => {
    processor.processOnce().catch((err) => log.error('Poll failed', err))
  }, 30_000)
}
