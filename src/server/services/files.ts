import { eq, sql } from 'drizzle-orm'
import type { EncryptedMetaItem, FileKeyEnvelope, FileRecord } from '../../shared/types'
import type { Database } from '../db'
import { fileRecords } from '../db/schema'
import { AppError } from '../lib/errors'
import { createLogger } from '../lib/logger'
import type { StorageManager, StorageNamespace } from '../types'

const log = createLogger('services.files')

export class FilesService {
  constructor(
    protected readonly db: Database,
    private readonly storage: StorageManager | null
  ) {}

  get hasStorage(): boolean {
    return this.storage !== null
  }

  // ------------------------------------------------------------------ DB: FileRecord CRUD

  async createFileRecord(
    data: Omit<FileRecord, 'completedChunks' | 'createdAt' | 'completedAt'>
  ): Promise<FileRecord> {
    const now = new Date()
    const [row] = await this.db
      .insert(fileRecords)
      .values({
        id: data.id,
        hubId: data.hubId,
        conversationId: data.conversationId,
        messageId: data.messageId ?? null,
        uploadedBy: data.uploadedBy,
        recipientEnvelopes: data.recipientEnvelopes,
        encryptedMetadata: data.encryptedMetadata,
        totalSize: data.totalSize,
        totalChunks: data.totalChunks,
        status: data.status,
        completedChunks: 0,
        createdAt: now,
        contextType: data.contextType ?? null,
        contextId: data.contextId ?? null,
      })
      .returning()
    return this.#rowToFileRecord(row)
  }

  async getFileRecord(id: string): Promise<FileRecord | null> {
    const rows = await this.db.select().from(fileRecords).where(eq(fileRecords.id, id)).limit(1)
    return rows[0] ? this.#rowToFileRecord(rows[0]) : null
  }

  /**
   * Atomically increment completedChunks. Returns the updated counts.
   * Uses sql`` to avoid read-modify-write races.
   */
  async incrementChunk(id: string): Promise<{ completedChunks: number; totalChunks: number }> {
    const [row] = await this.db
      .update(fileRecords)
      .set({ completedChunks: sql`${fileRecords.completedChunks} + 1` })
      .where(eq(fileRecords.id, id))
      .returning({
        completedChunks: fileRecords.completedChunks,
        totalChunks: fileRecords.totalChunks,
      })
    if (!row) throw new AppError(404, 'Upload not found')
    return { completedChunks: row.completedChunks, totalChunks: row.totalChunks }
  }

  async completeUpload(id: string): Promise<FileRecord> {
    const [row] = await this.db
      .update(fileRecords)
      .set({ status: 'complete', completedAt: new Date() })
      .where(eq(fileRecords.id, id))
      .returning()
    if (!row) throw new AppError(404, 'Upload not found')
    return this.#rowToFileRecord(row)
  }

  async updateContext(
    id: string,
    contextType: 'conversation' | 'note' | 'report' | 'custom_field',
    contextId: string
  ): Promise<FileRecord> {
    const [row] = await this.db
      .update(fileRecords)
      .set({ contextType, contextId })
      .where(eq(fileRecords.id, id))
      .returning()
    if (!row) throw new AppError(404, 'Upload not found')
    return this.#rowToFileRecord(row)
  }

  async failUpload(id: string): Promise<void> {
    await this.db.update(fileRecords).set({ status: 'failed' }).where(eq(fileRecords.id, id))
  }

  async getFilesByConversation(conversationId: string): Promise<FileRecord[]> {
    const rows = await this.db
      .select()
      .from(fileRecords)
      .where(eq(fileRecords.conversationId, conversationId))
    return rows.map((r) => this.#rowToFileRecord(r))
  }

  async getFilesByHub(hubId: string): Promise<FileRecord[]> {
    const rows = await this.db.select().from(fileRecords).where(eq(fileRecords.hubId, hubId))
    return rows.map((r) => this.#rowToFileRecord(r))
  }

  async addRecipientEnvelope(
    id: string,
    envelope: FileKeyEnvelope,
    meta: EncryptedMetaItem
  ): Promise<void> {
    // Use a row-level lock to prevent concurrent share operations from racing
    // and silently losing E2EE key material (lost-update on JSONB append).
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          recipientEnvelopes: fileRecords.recipientEnvelopes,
          encryptedMetadata: fileRecords.encryptedMetadata,
        })
        .from(fileRecords)
        .where(eq(fileRecords.id, id))
        .for('update')
      if (!existing) throw new AppError(404, 'File not found')
      await tx
        .update(fileRecords)
        .set({
          recipientEnvelopes: [...(existing.recipientEnvelopes as FileKeyEnvelope[]), envelope],
          encryptedMetadata: [...(existing.encryptedMetadata as EncryptedMetaItem[]), meta],
        })
        .where(eq(fileRecords.id, id))
    })
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToFileRecord(r: typeof fileRecords.$inferSelect): FileRecord {
    return {
      id: r.id,
      hubId: r.hubId ?? 'global',
      conversationId: r.conversationId,
      messageId: r.messageId ?? undefined,
      uploadedBy: r.uploadedBy,
      recipientEnvelopes: (r.recipientEnvelopes as FileKeyEnvelope[]) ?? [],
      encryptedMetadata: (r.encryptedMetadata as EncryptedMetaItem[]) ?? [],
      totalSize: r.totalSize,
      totalChunks: r.totalChunks,
      status: r.status as FileRecord['status'],
      completedChunks: r.completedChunks,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString(),
      contextType: (r.contextType as FileRecord['contextType']) ?? undefined,
      contextId: r.contextId ?? undefined,
    }
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(hubId: string): Promise<void> {
    if (this.storage) {
      // Clean up storage objects before removing DB records so we don't orphan blobs
      const rows = await this.db
        .select({ id: fileRecords.id, totalChunks: fileRecords.totalChunks })
        .from(fileRecords)
      await Promise.all(
        rows.flatMap((r) => [
          this.deleteAssembled(hubId, r.id).catch((err) =>
            log.error('Storage cleanup failed', err, { fileId: r.id })
          ),
          this.deleteAllChunks(hubId, r.id, r.totalChunks).catch((err) =>
            log.error('Chunk cleanup failed', err, { fileId: r.id })
          ),
        ])
      )
    }
    await this.db.delete(fileRecords)
  }

  // ------------------------------------------------------------------ Storage: Chunks

  async putChunk(
    hubId: string,
    uploadId: string,
    chunkIndex: number,
    data: ArrayBuffer
  ): Promise<void> {
    const key = `${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    await this.#requireStorage().put(hubId, 'attachments', key, data)
  }

  async getChunk(hubId: string, uploadId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
    const key = `${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    const obj = await this.#requireStorage().get(hubId, 'attachments', key)
    return obj ? obj.arrayBuffer() : null
  }

  async deleteChunk(hubId: string, uploadId: string, chunkIndex: number): Promise<void> {
    const key = `${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    await this.#requireStorage().delete(hubId, 'attachments', key)
  }

  async deleteAllChunks(hubId: string, uploadId: string, totalChunks: number): Promise<void> {
    const storage = this.#requireStorage()
    // Delete in parallel batches of 100 to avoid both sequential latency and
    // overwhelming the storage with 10k concurrent requests.
    const BATCH = 100
    for (let i = 0; i < totalChunks; i += BATCH) {
      const end = Math.min(i + BATCH, totalChunks)
      await Promise.all(
        Array.from({ length: end - i }, (_, j) => {
          const key = `${uploadId}/chunk-${String(i + j).padStart(6, '0')}`
          return storage.delete(hubId, 'attachments', key)
        })
      )
    }
  }

  // ------------------------------------------------------------------ Storage: Assembled content

  async putAssembled(
    hubId: string,
    uploadId: string,
    data: Uint8Array,
    namespace: StorageNamespace = 'attachments'
  ): Promise<void> {
    await this.#requireStorage().put(hubId, namespace, `${uploadId}/content`, data)
  }

  async getAssembled(
    hubId: string,
    uploadId: string,
    namespace: StorageNamespace = 'attachments'
  ): Promise<{ body: ReadableStream; size: number } | null> {
    return this.#requireStorage().get(hubId, namespace, `${uploadId}/content`)
  }

  async deleteAssembled(
    hubId: string,
    uploadId: string,
    namespace: StorageNamespace = 'attachments'
  ): Promise<void> {
    await this.#requireStorage().delete(hubId, namespace, `${uploadId}/content`)
  }

  // ------------------------------------------------------------------ Storage: Envelopes & Metadata (blob copies for backward compat)

  async storeEnvelopesBlob(
    hubId: string,
    uploadId: string,
    envelopes: FileKeyEnvelope[]
  ): Promise<void> {
    await this.#requireStorage().put(
      hubId,
      'attachments',
      `${uploadId}/envelopes`,
      JSON.stringify(envelopes)
    )
  }

  async storeMetadataBlob(
    hubId: string,
    uploadId: string,
    meta: EncryptedMetaItem[]
  ): Promise<void> {
    await this.#requireStorage().put(
      hubId,
      'attachments',
      `${uploadId}/metadata`,
      JSON.stringify(meta)
    )
  }

  // ------------------------------------------------------------------ Private: storage guard

  #requireStorage(): StorageManager {
    if (!this.storage) throw new AppError(503, 'File storage not configured')
    return this.storage
  }
}
