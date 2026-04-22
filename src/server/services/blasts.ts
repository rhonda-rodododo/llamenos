import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, lte, or } from 'drizzle-orm'
import type { RecipientEnvelope } from '../../shared/types'
import type { Database } from '../db'
import { blastDeliveries, blasts, subscribers } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import type {
  Blast,
  BlastDelivery,
  BlastStats,
  CreateBlastData,
  CreateDeliveryData,
  CreateSubscriberData,
  Subscriber,
  SubscriberChannel,
} from '../types'
import type { SettingsService } from './settings'

/** Pure filter: does a subscriber match the blast's targeting criteria? */
export function matchesBlastFilters(
  sub: Subscriber,
  targetChannels: string[],
  targetTags: string[],
  targetLanguages: string[]
): boolean {
  if (sub.status !== 'active') return false
  if (!sub.encryptedIdentifier) return false
  if (targetChannels.length > 0) {
    const hasVerifiedMatch = (sub.channels as SubscriberChannel[]).some(
      (ch) => ch.verified && targetChannels.includes(ch.type)
    )
    if (!hasVerifiedMatch) return false
  }
  if (targetTags.length > 0) {
    if (!sub.tags.some((t) => targetTags.includes(t))) return false
  }
  if (targetLanguages.length > 0) {
    if (!sub.language || !targetLanguages.includes(sub.language)) return false
  }
  return true
}

/** Pick the first verified channel matching target channels (or any verified if no filter). */
export function selectChannel(sub: Subscriber, targetChannels: string[]): SubscriberChannel | null {
  const channels = sub.channels as SubscriberChannel[]
  if (targetChannels.length === 0) {
    return channels.find((ch) => ch.verified) ?? null
  }
  return channels.find((ch) => ch.verified && targetChannels.includes(ch.type)) ?? null
}

export class BlastService {
  #settings: SettingsService

  constructor(
    protected readonly db: Database,
    private readonly crypto: CryptoService,
    settings: SettingsService
  ) {
    this.#settings = settings
  }

  // ------------------------------------------------------------------ Blasts

  async listBlasts(hubId?: string): Promise<Blast[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(blasts).where(eq(blasts.hubId, hId))
    // Client decrypts encryptedName with hub key
    return rows.map((r) => this.#rowToBlast(r))
  }

  async getBlast(id: string): Promise<Blast | null> {
    const rows = await this.db.select().from(blasts).where(eq(blasts.id, id)).limit(1)
    if (!rows[0]) return null
    return this.#rowToBlast(rows[0])
  }

  async createBlast(data: CreateBlastData): Promise<Blast> {
    const id = crypto.randomUUID()
    const hId = data.hubId ?? 'global'
    // Client provides hub-key encrypted name
    const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
    const [row] = await this.db
      .insert(blasts)
      .values({
        id,
        hubId: hId,
        encryptedName,
        encryptedContent: data.encryptedContent ?? '',
        contentEnvelopes: data.contentEnvelopes ?? [],
        targetChannels: data.targetChannels ?? [],
        targetTags: data.targetTags ?? [],
        targetLanguages: data.targetLanguages ?? [],
        status: data.status ?? 'draft',
      })
      .returning()
    return this.#rowToBlast(row)
  }

  async updateBlast(
    id: string,
    data: Partial<
      CreateBlastData & {
        stats: Partial<BlastStats>
        sentAt: Date
        scheduledAt?: Date
        error?: string | null
      }
    >
  ): Promise<Blast> {
    const existing = await this.getBlast(id)
    if (!existing) throw new AppError(404, 'Blast not found')

    const statsUpdate = data.stats ? { stats: { ...existing.stats, ...data.stats } } : {}

    // Client provides hub-key encrypted name; fall back to plaintext name
    const encFields: Record<string, unknown> = {}
    if (data.encryptedName !== undefined) {
      encFields.encryptedName = data.encryptedName
    } else if (data.name !== undefined) {
      encFields.encryptedName = data.name as Ciphertext
    }

    const [row] = await this.db
      .update(blasts)
      .set({
        ...(data.encryptedContent !== undefined ? { encryptedContent: data.encryptedContent } : {}),
        ...(data.contentEnvelopes !== undefined ? { contentEnvelopes: data.contentEnvelopes } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.targetChannels !== undefined ? { targetChannels: data.targetChannels } : {}),
        ...(data.targetTags !== undefined ? { targetTags: data.targetTags } : {}),
        ...(data.targetLanguages !== undefined ? { targetLanguages: data.targetLanguages } : {}),
        ...(data.sentAt !== undefined ? { sentAt: data.sentAt } : {}),
        ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt } : {}),
        ...(data.error !== undefined ? { error: data.error } : {}),
        ...statsUpdate,
        ...encFields,
      })
      .where(eq(blasts.id, id))
      .returning()
    return this.#rowToBlast(row)
  }

  async deleteBlast(id: string): Promise<void> {
    await this.db.delete(blasts).where(eq(blasts.id, id))
  }

  // ------------------------------------------------------------------ Subscribers

  async listSubscribers(hubId?: string): Promise<Subscriber[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(subscribers).where(eq(subscribers.hubId, hId))
    return rows.map((r) => this.#rowToSubscriber(r))
  }

  async getSubscriber(id: string): Promise<Subscriber | null> {
    const rows = await this.db.select().from(subscribers).where(eq(subscribers.id, id)).limit(1)
    return rows[0] ? this.#rowToSubscriber(rows[0]) : null
  }

  async findSubscriberByHash(identifierHash: string, hubId?: string): Promise<Subscriber | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(subscribers)
      .where(and(eq(subscribers.hubId, hId), eq(subscribers.identifierHash, identifierHash)))
      .limit(1)
    return rows[0] ? this.#rowToSubscriber(rows[0]) : null
  }

  async getSubscriberByPreferenceToken(token: string): Promise<Subscriber | null> {
    const rows = await this.db
      .select()
      .from(subscribers)
      .where(eq(subscribers.preferenceToken, token))
      .limit(1)
    return rows[0] ? this.#rowToSubscriber(rows[0]) : null
  }

  async createSubscriber(data: CreateSubscriberData): Promise<Subscriber> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(subscribers)
      .values({
        id,
        hubId: data.hubId ?? 'global',
        identifierHash: data.identifierHash,
        ...(data.encryptedIdentifier ? { encryptedIdentifier: data.encryptedIdentifier } : {}),
        channels: data.channels ?? [],
        tags: data.tags ?? [],
        language: data.language ?? null,
        status: data.status ?? 'active',
        preferenceToken: data.preferenceToken ?? crypto.randomUUID(),
      })
      .onConflictDoUpdate({
        target: [subscribers.hubId, subscribers.identifierHash],
        set: {
          channels: data.channels ?? [],
          status: data.status ?? 'active',
          ...(data.preferenceToken ? { preferenceToken: data.preferenceToken } : {}),
        },
      })
      .returning()
    return this.#rowToSubscriber(row)
  }

  async updateSubscriber(id: string, data: Partial<CreateSubscriberData>): Promise<Subscriber> {
    const existing = await this.getSubscriber(id)
    if (!existing) throw new AppError(404, 'Subscriber not found')

    const [row] = await this.db
      .update(subscribers)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.preferenceToken !== undefined ? { preferenceToken: data.preferenceToken } : {}),
        ...(data.channels !== undefined ? { channels: data.channels } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(data.language !== undefined ? { language: data.language } : {}),
      })
      .where(eq(subscribers.id, id))
      .returning()
    return this.#rowToSubscriber(row)
  }

  async deleteSubscriber(id: string): Promise<void> {
    await this.db.delete(subscribers).where(eq(subscribers.id, id))
  }

  async getSubscriberStats(
    hubId?: string
  ): Promise<{ total: number; active: number; inactive: number }> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select({ status: subscribers.status })
      .from(subscribers)
      .where(eq(subscribers.hubId, hId))
    const total = rows.length
    const active = rows.filter((r) => r.status === 'active').length
    return { total, active, inactive: total - active }
  }

  // ------------------------------------------------------------------ Deliveries

  async createDelivery(data: CreateDeliveryData): Promise<BlastDelivery> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(blastDeliveries)
      .values({
        id,
        blastId: data.blastId,
        subscriberId: data.subscriberId,
        channelType: data.channelType ?? 'sms',
        status: data.status ?? 'pending',
        ...(data.error ? { error: data.error } : {}),
      })
      .returning()
    return this.#rowToDelivery(row)
  }

  async updateDelivery(
    id: string,
    data: { status: string; error?: string; sentAt?: Date; deliveredAt?: Date }
  ): Promise<BlastDelivery> {
    const [row] = await this.db
      .update(blastDeliveries)
      .set({
        status: data.status,
        ...(data.error !== undefined ? { error: data.error } : {}),
        ...(data.sentAt !== undefined ? { sentAt: data.sentAt } : {}),
        ...(data.deliveredAt !== undefined ? { deliveredAt: data.deliveredAt } : {}),
      })
      .where(eq(blastDeliveries.id, id))
      .returning()
    if (!row) throw new AppError(404, 'Delivery not found')
    return this.#rowToDelivery(row)
  }

  async getDeliveriesForBlast(blastId: string): Promise<BlastDelivery[]> {
    const rows = await this.db
      .select()
      .from(blastDeliveries)
      .where(eq(blastDeliveries.blastId, blastId))
    return rows.map((r) => this.#rowToDelivery(r))
  }

  // ------------------------------------------------------------------ Resume helpers

  /** Get subscriber IDs that already have delivery records for a blast (for resume). */
  async getDeliveredSubscriberIds(blastId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ subscriberId: blastDeliveries.subscriberId })
      .from(blastDeliveries)
      .where(eq(blastDeliveries.blastId, blastId))
    return new Set(rows.map((r) => r.subscriberId))
  }

  /** Find blasts ready for processing (sending or due scheduled). */
  async findBlastsToProcess(): Promise<Blast[]> {
    const now = new Date()
    const rows = await this.db
      .select()
      .from(blasts)
      .where(
        or(
          eq(blasts.status, 'sending'),
          and(eq(blasts.status, 'scheduled'), lte(blasts.scheduledAt, now))
        )
      )
    return rows.map((r) => this.#rowToBlast(r))
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToBlast(r: typeof blasts.$inferSelect): Blast {
    return {
      id: r.id,
      hubId: r.hubId,
      name: '', // Client decrypts encryptedName with hub key
      encryptedName: r.encryptedName ?? undefined,
      targetChannels: r.targetChannels as string[],
      targetTags: r.targetTags as string[],
      targetLanguages: r.targetLanguages as string[],
      encryptedContent: r.encryptedContent,
      contentEnvelopes: (r.contentEnvelopes as RecipientEnvelope[]) ?? [],
      status: r.status,
      stats: r.stats as BlastStats,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
      scheduledAt: r.scheduledAt ?? null,
      error: r.error ?? null,
    }
  }

  #rowToSubscriber(r: typeof subscribers.$inferSelect): Subscriber {
    return {
      id: r.id,
      hubId: r.hubId,
      identifierHash: r.identifierHash,
      encryptedIdentifier: r.encryptedIdentifier ?? null,
      channels: r.channels as SubscriberChannel[],
      tags: r.tags as string[],
      language: r.language,
      status: r.status,
      doubleOptInConfirmed: r.doubleOptInConfirmed,
      subscribedAt: r.subscribedAt,
      preferenceToken: r.preferenceToken,
      createdAt: r.createdAt,
    }
  }

  async resetForTest(): Promise<void> {
    await this.db.delete(blastDeliveries)
    await this.db.delete(blasts)
    await this.db.delete(subscribers)
  }

  #rowToDelivery(r: typeof blastDeliveries.$inferSelect): BlastDelivery {
    return {
      id: r.id,
      blastId: r.blastId,
      subscriberId: r.subscriberId,
      channelType: r.channelType,
      status: r.status,
      error: r.error,
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
    }
  }
}
