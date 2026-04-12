/**
 * High-level file upload/download helpers for custom field attachments.
 * Wraps the chunked upload API with E2EE (XChaCha20-Poly1305 + ECIES key envelopes).
 */
import type { EncryptedFileMetadata, FileFieldValue } from '@shared/types'
import { bindUploadContext, downloadFile, getFileEnvelopes, getFileMetadata } from './api'
import { chunkedUpload } from './chunked-upload'
import { decryptFile, decryptFileMetadata, encryptFile } from './file-crypto'

export interface UploadEncryptedFileOptions {
  file: File
  /** Uploader's own pubkey — always gets an envelope. */
  uploaderPubkey: string
  /** Admin pubkeys — each gets their own key envelope. */
  adminPubkeys: string[]
  /** Optional: bind to context on upload init (can also be done later via bindContext). */
  contextType?: 'note' | 'report' | 'custom_field'
  contextId?: string
  /** Progress callback: (completedChunks, totalChunks) */
  onProgress?: (completed: number, total: number) => void
}

/**
 * Encrypt a file and upload it via the chunked upload API.
 * Returns { fileId } as a FileFieldValue ready for storage in NotePayload.fields.
 *
 * Key wrapping: one envelope per recipient (uploader + all admins) using ECIES.
 * After upload, optionally bind the file to a note/report via PATCH /api/uploads/:id/context.
 */
export async function uploadEncryptedFile(
  options: UploadEncryptedFileOptions
): Promise<FileFieldValue> {
  const { file, uploaderPubkey, adminPubkeys, contextType, contextId, onProgress } = options

  // Deduplicate pubkeys (uploader may already be an admin)
  const allPubkeys = Array.from(new Set([uploaderPubkey, ...adminPubkeys]))

  // Generate a client-side fileId for AAD binding (Task 8+).
  // This ID is sent to the server which stores it as the canonical fileId,
  // ensuring the fileId-bound AAD can round-trip on decrypt.
  const fileId = crypto.randomUUID()

  // Encrypt the file and produce key envelopes + encrypted metadata for all recipients
  const encrypted = await encryptFile(file, fileId, allPubkeys)

  const result = await chunkedUpload({
    encryptedContent: encrypted.encryptedContent,
    // For custom field uploads, conversationId is not used; pass empty string.
    // The server accepts this when contextType === 'custom_field'.
    conversationId: '',
    recipientEnvelopes: encrypted.recipientEnvelopes,
    encryptedMetadata: encrypted.encryptedMetadata,
    fileId,
    onProgress,
  })

  // Use the client-generated fileId (the server should echo it back; fall back gracefully)
  const resolvedFileId = result.fileId || fileId

  // Bind context if provided at upload time
  if (contextType && contextId) {
    await bindUploadContext(resolvedFileId, contextType, contextId)
  }

  return { fileId: resolvedFileId }
}

/**
 * Bind a completed upload to a parent record (note, report, etc.).
 * Called after the parent record is saved and its ID is known.
 */
export async function bindFileContext(
  fileId: string,
  contextType: 'note' | 'report' | 'custom_field',
  contextId: string
): Promise<void> {
  await bindUploadContext(fileId, contextType, contextId)
}

export interface DownloadedFile {
  data: Uint8Array
  metadata: EncryptedFileMetadata
  blob: Blob
}

/**
 * Download and decrypt a file given the caller's secret key.
 * Fetches envelopes, unwraps the file key, fetches metadata, then fetches and decrypts content.
 */
export async function downloadAndDecryptFile(
  fileId: string,
  callerPubkey: string
): Promise<DownloadedFile> {
  // Fetch key envelopes and find the one for this caller
  const envelopes = await getFileEnvelopes(fileId)
  const myEnvelope = envelopes.envelopes.find((e) => e.pubkey === callerPubkey)
  if (!myEnvelope) {
    throw new Error('No key envelope found for caller')
  }

  // Fetch encrypted metadata and decrypt it
  const metaResponse = await getFileMetadata(fileId)
  const myMeta = metaResponse.metadata.find((m) => m.pubkey === callerPubkey)
  if (!myMeta) {
    throw new Error('No metadata envelope found for caller')
  }
  const metadata = await decryptFileMetadata(myMeta.encryptedContent, myMeta.ephemeralPubkey)
  if (!metadata) {
    throw new Error('Failed to decrypt file metadata')
  }

  // Download encrypted content
  const encryptedContent = await downloadFile(fileId)

  // Decrypt using the unwrapped file key — fileId reconstructs the AAD used during encryption
  const { blob } = await decryptFile(encryptedContent, myEnvelope, fileId)

  // Verify checksum
  const hashBuffer = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (hashHex !== metadata.checksum) {
    throw new Error('File integrity check failed — checksum mismatch')
  }

  // Re-create blob with correct MIME type
  const typedBlob = new Blob([await blob.arrayBuffer()], { type: metadata.mimeType })

  return {
    data: new Uint8Array(await typedBlob.arrayBuffer()),
    metadata,
    blob: typedBlob,
  }
}

/**
 * Trigger a browser download of a decrypted file.
 * Creates a temporary object URL and clicks it.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after a short delay to allow the download to start
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
