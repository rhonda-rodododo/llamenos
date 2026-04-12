import type { Ciphertext } from '@shared/crypto-types'
import type { FirehoseConnectionStatus } from '@shared/schemas/firehose'
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '../db'
import {
  firehoseConnections,
  firehoseMessageBuffer,
  firehoseNotificationOptouts,
} from '../db/schema/firehose'
import type { CryptoService } from '../lib/crypto-service'

type FirehoseConnection = typeof firehoseConnections.$inferSelect
type FirehoseMessageBuffer = typeof firehoseMessageBuffer.$inferSelect
type FirehoseNotificationOptout = typeof firehoseNotificationOptouts.$inferSelect

export type CreateConnectionData = {
  /** Client-generated UUID for AAD binding. */
  id?: string
  signalGroupId?: string | null
  displayName?: string
  encryptedDisplayName?: Ciphertext | null
  reportTypeId: string
  agentPubkey: string
  encryptedAgentNsec: string
  geoContext?: string | null
  geoContextCountryCodes?: string[] | null
  inferenceEndpoint?: string | null
  extractionIntervalSec?: number
  systemPromptSuffix?: string | null
  bufferTtlDays?: number
  notifyViaSignal?: boolean
  status?: FirehoseConnectionStatus
}

/**
 * Fields that may be updated via the public updateConnection method.
 * Intentionally omits `agentPubkey` and `encryptedAgentNsec` — keypair
 * fields are immutable after creation. Use setAgentKeypair for initial
 * creation and any future keypair rotation.
 */
export type UpdateConnectionData = Omit<
  Partial<CreateConnectionData>,
  'agentPubkey' | 'encryptedAgentNsec'
>

export type AddBufferMessageData = {
  signalTimestamp: Date
  encryptedContent: string
  encryptedSenderInfo: string
  expiresAt: Date
}

export class FirehoseService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  // ---------------------------------------------------------------------------
  // Connection CRUD
  // ---------------------------------------------------------------------------

  async createConnection(hubId: string, data: CreateConnectionData): Promise<FirehoseConnection> {
    const id = data.id ?? crypto.randomUUID()
    const now = new Date()
    const [row] = await this.db
      .insert(firehoseConnections)
      .values({
        id,
        hubId,
        signalGroupId: data.signalGroupId ?? null,
        displayName: data.displayName ?? '',
        encryptedDisplayName: (data.encryptedDisplayName ?? null) as Ciphertext | null,
        reportTypeId: data.reportTypeId,
        agentPubkey: data.agentPubkey,
        encryptedAgentNsec: data.encryptedAgentNsec,
        geoContext: data.geoContext ?? null,
        geoContextCountryCodes: data.geoContextCountryCodes ?? null,
        inferenceEndpoint: data.inferenceEndpoint ?? null,
        extractionIntervalSec: data.extractionIntervalSec ?? 60,
        systemPromptSuffix: data.systemPromptSuffix ?? null,
        bufferTtlDays: data.bufferTtlDays ?? 7,
        notifyViaSignal: data.notifyViaSignal ?? true,
        status: data.status ?? 'pending',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return row
  }

  async getConnection(id: string): Promise<FirehoseConnection | null> {
    const rows = await this.db
      .select()
      .from(firehoseConnections)
      .where(eq(firehoseConnections.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  async listConnections(hubId: string): Promise<FirehoseConnection[]> {
    return this.db
      .select()
      .from(firehoseConnections)
      .where(eq(firehoseConnections.hubId, hubId))
      .orderBy(firehoseConnections.createdAt)
  }

  async listActiveConnections(): Promise<FirehoseConnection[]> {
    return this.db
      .select()
      .from(firehoseConnections)
      .where(eq(firehoseConnections.status, 'active'))
      .orderBy(firehoseConnections.createdAt)
  }

  async updateConnection(
    id: string,
    data: UpdateConnectionData
  ): Promise<FirehoseConnection | null> {
    const now = new Date()
    const rows = await this.db
      .update(firehoseConnections)
      .set({
        ...(data.signalGroupId !== undefined ? { signalGroupId: data.signalGroupId } : {}),
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.encryptedDisplayName !== undefined
          ? { encryptedDisplayName: data.encryptedDisplayName as Ciphertext | null }
          : {}),
        ...(data.reportTypeId !== undefined ? { reportTypeId: data.reportTypeId } : {}),
        ...(data.geoContext !== undefined ? { geoContext: data.geoContext } : {}),
        ...(data.geoContextCountryCodes !== undefined
          ? { geoContextCountryCodes: data.geoContextCountryCodes }
          : {}),
        ...(data.inferenceEndpoint !== undefined
          ? { inferenceEndpoint: data.inferenceEndpoint }
          : {}),
        ...(data.extractionIntervalSec !== undefined
          ? { extractionIntervalSec: data.extractionIntervalSec }
          : {}),
        ...(data.systemPromptSuffix !== undefined
          ? { systemPromptSuffix: data.systemPromptSuffix }
          : {}),
        ...(data.bufferTtlDays !== undefined ? { bufferTtlDays: data.bufferTtlDays } : {}),
        ...(data.notifyViaSignal !== undefined ? { notifyViaSignal: data.notifyViaSignal } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        updatedAt: now,
      })
      .where(eq(firehoseConnections.id, id))
      .returning()
    return rows[0] ?? null
  }

  /**
   * Set the agent keypair on a connection — used only during initial creation
   * and any future keypair rotation. Deliberately separate from updateConnection
   * so the public update path cannot accidentally mutate keypair fields.
   */
  async setAgentKeypair(
    id: string,
    pubkey: string,
    encryptedNsec: string
  ): Promise<FirehoseConnection | null> {
    const now = new Date()
    const rows = await this.db
      .update(firehoseConnections)
      .set({ agentPubkey: pubkey, encryptedAgentNsec: encryptedNsec, updatedAt: now })
      .where(eq(firehoseConnections.id, id))
      .returning()
    return rows[0] ?? null
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db.delete(firehoseConnections).where(eq(firehoseConnections.id, id))
  }

  async findConnectionBySignalGroup(
    signalGroupId: string,
    hubId?: string
  ): Promise<FirehoseConnection | null> {
    const conditions = [eq(firehoseConnections.signalGroupId, signalGroupId)]
    if (hubId !== undefined) {
      conditions.push(eq(firehoseConnections.hubId, hubId))
    }
    const rows = await this.db
      .select()
      .from(firehoseConnections)
      .where(and(...conditions))
      .limit(1)
    return rows[0] ?? null
  }

  async findPendingConnection(hubId: string): Promise<FirehoseConnection | null> {
    const rows = await this.db
      .select()
      .from(firehoseConnections)
      .where(
        and(
          eq(firehoseConnections.hubId, hubId),
          eq(firehoseConnections.status, 'pending'),
          isNull(firehoseConnections.signalGroupId)
        )
      )
      .orderBy(firehoseConnections.createdAt)
      .limit(1)
    return rows[0] ?? null
  }

  // ---------------------------------------------------------------------------
  // Buffer Operations
  // ---------------------------------------------------------------------------

  async addBufferMessage(
    connectionId: string,
    data: AddBufferMessageData
  ): Promise<FirehoseMessageBuffer> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(firehoseMessageBuffer)
      .values({
        id,
        connectionId,
        signalTimestamp: data.signalTimestamp,
        encryptedContent: data.encryptedContent,
        encryptedSenderInfo: data.encryptedSenderInfo,
        clusterId: null,
        extractedReportId: null,
        receivedAt: new Date(),
        expiresAt: data.expiresAt,
      })
      .returning()
    return row
  }

  async getUnextractedMessages(connectionId: string): Promise<FirehoseMessageBuffer[]> {
    return this.db
      .select()
      .from(firehoseMessageBuffer)
      .where(
        and(
          eq(firehoseMessageBuffer.connectionId, connectionId),
          isNull(firehoseMessageBuffer.extractedReportId)
        )
      )
      .orderBy(firehoseMessageBuffer.signalTimestamp)
  }

  async markMessagesExtracted(
    messageIds: string[],
    reportId: string,
    clusterId: string
  ): Promise<void> {
    if (messageIds.length === 0) return
    await this.db
      .update(firehoseMessageBuffer)
      .set({ extractedReportId: reportId, clusterId })
      .where(inArray(firehoseMessageBuffer.id, messageIds))
  }

  async purgeExpiredMessages(): Promise<number> {
    const now = new Date()
    const result = await this.db
      .delete(firehoseMessageBuffer)
      .where(lt(firehoseMessageBuffer.expiresAt, now))
      .returning({ id: firehoseMessageBuffer.id })
    return result.length
  }

  async getBufferSize(connectionId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(firehoseMessageBuffer)
      .where(eq(firehoseMessageBuffer.connectionId, connectionId))
    return result[0]?.count ?? 0
  }

  // ---------------------------------------------------------------------------
  // Notification Optouts
  // ---------------------------------------------------------------------------

  async addOptout(connectionId: string, userId: string): Promise<FirehoseNotificationOptout> {
    const id = crypto.randomUUID()
    const now = new Date()
    const [row] = await this.db
      .insert(firehoseNotificationOptouts)
      .values({ id, connectionId, userId, optedOutAt: now })
      .onConflictDoNothing()
      .returning()
    // If the row already existed, fetch it
    if (row) return row
    const existing = await this.db
      .select()
      .from(firehoseNotificationOptouts)
      .where(
        and(
          eq(firehoseNotificationOptouts.connectionId, connectionId),
          eq(firehoseNotificationOptouts.userId, userId)
        )
      )
      .limit(1)
    return existing[0]
  }

  async removeOptout(connectionId: string, userId: string): Promise<void> {
    await this.db
      .delete(firehoseNotificationOptouts)
      .where(
        and(
          eq(firehoseNotificationOptouts.connectionId, connectionId),
          eq(firehoseNotificationOptouts.userId, userId)
        )
      )
  }

  async isOptedOut(connectionId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: firehoseNotificationOptouts.id })
      .from(firehoseNotificationOptouts)
      .where(
        and(
          eq(firehoseNotificationOptouts.connectionId, connectionId),
          eq(firehoseNotificationOptouts.userId, userId)
        )
      )
      .limit(1)
    return rows.length > 0
  }

  async resetForTest(): Promise<void> {
    await this.db.delete(firehoseConnections)
  }
}
