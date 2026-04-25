import { LABEL_USER_PII } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { MessageDeliveryStatus, RecipientEnvelope } from '../../shared/types'
import type { Database } from '../db'
import { conversations, messageEnvelopes, users } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import type {
  Conversation,
  ConversationFilters,
  CreateConversationData,
  CreateMessageData,
  EncryptedMessage,
} from '../types'

/** Check if a string is a valid 64-char hex secp256k1 x-only pubkey */
const isValidPubkey = (pk: string) => /^[0-9a-f]{64}$/i.test(pk)

export class ConversationService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  // ------------------------------------------------------------------ Conversations

  async listConversations(
    filters: ConversationFilters
  ): Promise<{ conversations: Conversation[]; total: number }> {
    const hId = filters.hubId ?? 'global'
    const conditions: ReturnType<typeof eq>[] = [eq(conversations.hubId, hId)]
    if (filters.status) conditions.push(eq(conversations.status, filters.status))
    if (filters.assignedTo) conditions.push(eq(conversations.assignedTo, filters.assignedTo))
    if (filters.channelType) conditions.push(eq(conversations.channelType, filters.channelType))
    const whereClause = and(...conditions)

    const [{ value: rawTotal }] = await this.db
      .select({ value: count() })
      .from(conversations)
      .where(whereClause)
    const total = Number(rawTotal)

    const page = filters.page ?? 1
    const limit = filters.limit ?? 50
    const offset = (page - 1) * limit
    const rows = await this.db
      .select()
      .from(conversations)
      .where(whereClause)
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit)
      .offset(offset)
    return { conversations: await Promise.all(rows.map((r) => this.#rowToConversation(r))), total }
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const rows = await this.db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
    return rows[0] ? await this.#rowToConversation(rows[0]) : null
  }

  async createConversation(data: CreateConversationData): Promise<Conversation> {
    const id = crypto.randomUUID()
    const now = new Date()

    // E2EE encrypt contactLast4 for assigned user + admin pubkeys
    let encryptedContactFields: Record<string, unknown> = {}
    if (data.contactLast4) {
      const adminPubkeys = (await this.#getSuperAdminPubkeys()).filter(isValidPubkey)
      const recipientPubkeys = [
        ...new Set([
          ...(data.assignedTo && isValidPubkey(data.assignedTo) ? [data.assignedTo] : []),
          ...adminPubkeys,
        ]),
      ]
      if (recipientPubkeys.length > 0) {
        const envelope = await this.crypto.envelopeEncrypt(
          data.contactLast4,
          recipientPubkeys,
          LABEL_USER_PII,
          '',
          'contactLast4'
        )
        encryptedContactFields = {
          encryptedContactLast4: envelope.encrypted || ('' as Ciphertext),
          contactLast4Envelopes: envelope.envelopes,
        }
      }
    }

    const values = {
      id,
      hubId: data.hubId ?? 'global',
      channelType: data.channelType,
      contactIdentifierHash: data.skipDedup
        ? `${data.contactIdentifierHash}:${id}`
        : data.contactIdentifierHash,
      externalId: data.externalId ?? null,
      assignedTo: data.assignedTo ?? null,
      status: data.status ?? 'waiting',
      metadata: data.skipDedup
        ? { ...(data.metadata ?? {}), reporterPubkey: data.contactIdentifierHash }
        : (data.metadata ?? {}),
      reportTypeId: data.reportTypeId ?? null,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      ...encryptedContactFields,
    }

    if (data.skipDedup) {
      // For reports: always create a new row. The contactIdentifierHash has a
      // unique suffix so the unique constraint won't conflict. The original
      // pubkey is preserved in metadata.reporterPubkey for ownership checks.
      const [row] = await this.db.insert(conversations).values(values).returning()
      return await this.#rowToConversation(row)
    }

    const [row] = await this.db
      .insert(conversations)
      .values(values)
      .onConflictDoUpdate({
        target: [
          conversations.hubId,
          conversations.channelType,
          conversations.contactIdentifierHash,
        ],
        set: {
          updatedAt: now,
          ...(data.externalId ? { externalId: data.externalId } : {}),
          ...(data.status ? { status: data.status } : {}),
        },
      })
      .returning()
    return await this.#rowToConversation(row)
  }

  async updateConversation(
    id: string,
    data: Partial<{
      status: string
      assignedTo: string | null
      metadata: Record<string, unknown>
    }>
  ): Promise<Conversation> {
    const existing = await this.getConversation(id)
    if (!existing) throw new AppError(404, 'Conversation not found')

    const [row] = await this.db
      .update(conversations)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assignedTo !== undefined ? { assignedTo: data.assignedTo } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, id))
      .returning()
    return await this.#rowToConversation(row)
  }

  async findByExternalId(
    hubId: string,
    channelType: string,
    externalId: string
  ): Promise<Conversation | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.hubId, hubId),
          eq(conversations.channelType, channelType),
          eq(conversations.externalId, externalId)
        )
      )
      .limit(1)
    return rows[0] ? await this.#rowToConversation(rows[0]) : null
  }

  async getConversationStats(
    hubId?: string
  ): Promise<{ total: number; waiting: number; active: number; closed: number }> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select({ status: conversations.status })
      .from(conversations)
      .where(eq(conversations.hubId, hId))
    const total = rows.length
    const waiting = rows.filter((r) => r.status === 'waiting').length
    const active = rows.filter((r) => r.status === 'active').length
    const closed = rows.filter((r) => r.status === 'closed').length
    return { total, waiting, active, closed }
  }

  // ------------------------------------------------------------------ Messages

  async getMessages(
    conversationId: string,
    page = 1,
    limit = 50
  ): Promise<{ messages: EncryptedMessage[]; total: number }> {
    const [{ value: rawTotal }] = await this.db
      .select({ value: count() })
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.conversationId, conversationId))
    const total = Number(rawTotal)

    const offset = (page - 1) * limit
    const rows = await this.db
      .select()
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.conversationId, conversationId))
      .orderBy(desc(messageEnvelopes.createdAt))
      .limit(limit)
      .offset(offset)
    return { messages: rows.map((r) => this.#rowToMessage(r)), total }
  }

  async addMessage(data: CreateMessageData): Promise<EncryptedMessage> {
    const id = crypto.randomUUID()
    const now = new Date()

    const deliveryStatus =
      data.deliveryStatus ??
      (data.status === 'sent'
        ? 'sent'
        : data.status === 'delivered'
          ? 'delivered'
          : data.status === 'failed'
            ? 'failed'
            : 'pending')

    const [row] = await this.db
      .insert(messageEnvelopes)
      .values({
        id,
        conversationId: data.conversationId,
        direction: data.direction,
        authorPubkey: data.authorPubkey,
        encryptedContent: data.encryptedContent,
        readerEnvelopes: (data.readerEnvelopes ?? []) as RecipientEnvelope[],
        hasAttachments: data.hasAttachments ?? false,
        attachmentIds: data.attachmentIds ?? [],
        externalId: data.externalId ?? null,
        status: data.status ?? 'pending',
        deliveryStatus,
        deliveryStatusUpdatedAt: now,
        providerMessageId: data.providerMessageId ?? data.externalId ?? null,
        deliveryError: data.deliveryError ?? null,
        mlsCiphertext: data.mlsCiphertext ?? null,
        mlsEpoch: data.mlsEpoch ?? null,
        serverEncryptedBody: data.serverEncryptedBody ?? null,
        createdAt: now,
      })
      .returning()

    // Atomically increment conversation message count to avoid race condition
    await this.db
      .update(conversations)
      .set({
        messageCount: sql`${conversations.messageCount} + 1`,
        lastMessageAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, data.conversationId))

    return this.#rowToMessage(row)
  }

  async claimMessage(
    id: string,
    data: {
      encryptedContent?: string
      mlsCiphertext: string
      mlsEpoch: number
    }
  ): Promise<EncryptedMessage> {
    const [row] = await this.db
      .update(messageEnvelopes)
      .set({
        encryptedContent: data.encryptedContent ?? '',
        readerEnvelopes: [],
        mlsCiphertext: data.mlsCiphertext,
        mlsEpoch: data.mlsEpoch,
        serverEncryptedBody: null,
      })
      .where(eq(messageEnvelopes.id, id))
      .returning()
    return this.#rowToMessage(row)
  }

  async updateMessageStatus(
    id: string,
    data: { status: string; deliveredAt?: Date; readAt?: Date; failureReason?: string }
  ): Promise<void> {
    await this.db
      .update(messageEnvelopes)
      .set({
        status: data.status,
        ...(data.deliveredAt ? { deliveredAt: data.deliveredAt } : {}),
        ...(data.readAt ? { readAt: data.readAt } : {}),
        ...(data.failureReason ? { failureReason: data.failureReason } : {}),
      })
      .where(eq(messageEnvelopes.id, id))
  }

  /**
   * Update delivery status for a message identified by its provider message ID (externalId).
   * Called from status callback webhooks.
   */
  async updateMessageDeliveryByExternalId(
    providerMessageId: string,
    data: {
      deliveryStatus: MessageDeliveryStatus
      deliveryError?: string
    }
  ): Promise<boolean> {
    const now = new Date()
    const result = await this.db
      .update(messageEnvelopes)
      .set({
        deliveryStatus: data.deliveryStatus,
        deliveryStatusUpdatedAt: now,
        ...(data.deliveryError !== undefined ? { deliveryError: data.deliveryError } : {}),
        // Also update legacy fields for compatibility
        status: data.deliveryStatus,
        ...(data.deliveryStatus === 'delivered' ? { deliveredAt: now } : {}),
        ...(data.deliveryStatus === 'read' ? { readAt: now } : {}),
        ...(data.deliveryError ? { failureReason: data.deliveryError } : {}),
      })
      .where(eq(messageEnvelopes.providerMessageId, providerMessageId))
      .returning({ id: messageEnvelopes.id })
    return result.length > 0
  }

  // ------------------------------------------------------------------ Admin Pubkey Helper

  /** Return pubkeys of all active super-admin users for E2EE envelope recipients */
  async #getSuperAdminPubkeys(): Promise<string[]> {
    const rows = await this.db
      .select({ pubkey: users.pubkey, roles: users.roles })
      .from(users)
      .where(eq(users.active, true))
    return rows
      .filter((r) => (r.roles as string[]).includes('role-super-admin'))
      .map((r) => r.pubkey)
  }

  // ------------------------------------------------------------------ Private helpers

  async #rowToConversation(r: typeof conversations.$inferSelect): Promise<Conversation> {
    const cl4Env = (r.contactLast4Envelopes as import('@shared/types').RecipientEnvelope[]) ?? []
    const contactLast4 =
      (await this.crypto.envelopeDecryptFromList(cl4Env, LABEL_USER_PII, '', 'contactLast4')) ??
      undefined
    return {
      id: r.id,
      hubId: r.hubId,
      channelType: r.channelType,
      contactIdentifierHash: r.contactIdentifierHash,
      contactLast4,
      externalId: r.externalId,
      assignedTo: r.assignedTo,
      status: r.status,
      metadata: r.metadata as Record<string, unknown>,
      reportTypeId: r.reportTypeId ?? null,
      messageCount: r.messageCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastMessageAt: r.lastMessageAt,
      // E2EE envelope fields for client-side decryption
      ...(cl4Env.length > 0
        ? {
            encryptedContactLast4: r.encryptedContactLast4 as string,
            contactLast4Envelopes: cl4Env,
          }
        : {}),
    }
  }

  #rowToMessage(r: typeof messageEnvelopes.$inferSelect): EncryptedMessage {
    return {
      id: r.id,
      conversationId: r.conversationId,
      direction: r.direction,
      authorPubkey: r.authorPubkey,
      encryptedContent: r.encryptedContent,
      readerEnvelopes: (r.readerEnvelopes as RecipientEnvelope[]) ?? [],
      hasAttachments: r.hasAttachments,
      attachmentIds: r.attachmentIds as string[],
      externalId: r.externalId,
      status: r.status,
      deliveryStatus: r.deliveryStatus as MessageDeliveryStatus,
      deliveryStatusUpdatedAt: r.deliveryStatusUpdatedAt,
      providerMessageId: r.providerMessageId,
      deliveryError: r.deliveryError,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
      failureReason: r.failureReason,
      retryCount: r.retryCount,
      mlsCiphertext: r.mlsCiphertext,
      mlsEpoch: r.mlsEpoch,
      serverEncryptedBody: r.serverEncryptedBody,
      createdAt: r.createdAt,
    }
  }

  async getConversationsByIds(ids: string[], hubId: string) {
    if (ids.length === 0) return []
    return this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.hubId, hubId), inArray(conversations.id, ids)))
      .orderBy(desc(conversations.lastMessageAt))
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(messageEnvelopes)
    await this.db.delete(conversations)
  }
}
