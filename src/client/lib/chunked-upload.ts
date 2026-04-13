import type { EncryptedMetaItem, FileKeyEnvelope, UploadInit } from '@shared/types'
import { completeUpload, getUploadStatus, initUpload, uploadChunk } from './api'

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB

export interface ChunkedUploadOptions {
  encryptedContent: Uint8Array
  conversationId: string
  recipientEnvelopes: FileKeyEnvelope[]
  encryptedMetadata: EncryptedMetaItem[]
  /**
   * Client-generated UUID used as AAD binding in the file encryption (Task 8+).
   * Passed to the server so it can store and return this as the canonical fileId,
   * enabling AAD verification on decrypt. Server-side acceptance in Task 9.
   */
  fileId?: string
  chunkSize?: number
  onProgress?: (completed: number, total: number) => void
}

export interface UploadResult {
  fileId: string
  status: string
}

/**
 * Upload an encrypted file in chunks with progress reporting.
 * For files smaller than the chunk size, uses a single chunk.
 */
export async function chunkedUpload(options: ChunkedUploadOptions): Promise<UploadResult> {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE
  const totalSize = options.encryptedContent.length
  const totalChunks = Math.ceil(totalSize / chunkSize)

  // Initialize upload — include client-generated fileId so server can use it as the canonical ID.
  // V2 envelopes are cast to the legacy FileKeyEnvelope type here; Task 9 will update
  // the server to accept FileKeyEnvelope natively and remove the cast.
  const initData: UploadInit = {
    totalSize,
    totalChunks,
    conversationId: options.conversationId,
    recipientEnvelopes: options.recipientEnvelopes as unknown as UploadInit['recipientEnvelopes'],
    encryptedMetadata: options.encryptedMetadata,
    ...(options.fileId ? { fileId: options.fileId } : {}),
  }

  const { uploadId } = await initUpload(initData)

  // Upload chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, totalSize)
    const chunk = options.encryptedContent.slice(start, end).buffer as ArrayBuffer

    await uploadChunk(uploadId, i, chunk)
    options.onProgress?.(i + 1, totalChunks)
  }

  // Complete upload
  return completeUpload(uploadId)
}

/**
 * Resume a partially completed upload.
 * Checks which chunks are already uploaded and continues from there.
 */
export async function resumeUpload(
  uploadId: string,
  encryptedContent: Uint8Array,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  onProgress?: (completed: number, total: number) => void
): Promise<UploadResult> {
  const status = await getUploadStatus(uploadId)

  if (status.status === 'complete') {
    return { fileId: uploadId, status: 'complete' }
  }

  const totalChunks = status.totalChunks
  const startFrom = status.completedChunks

  // Upload remaining chunks
  for (let i = startFrom; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, encryptedContent.length)
    const chunk = encryptedContent.slice(start, end).buffer as ArrayBuffer

    await uploadChunk(uploadId, i, chunk)
    onProgress?.(i + 1, totalChunks)
  }

  // Complete upload
  return completeUpload(uploadId)
}
