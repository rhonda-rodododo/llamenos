import { randomUUID } from 'node:crypto'
import { LABEL_VOICEMAIL_WRAP, labelToId } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import type { FileKeyEnvelope } from '@shared/types'
import type { CryptoService } from '../lib/crypto-service'
import type { FilesService } from '../services/files'
import type { RecordsService } from '../services/records'
import type { TelephonyAdapter } from '../telephony/adapter'
import { createLogger } from './logger'

const log = createLogger('lib.voicemail-storage')

interface StoreVoicemailParams {
  callSid: string
  recordingSid: string
  hubId: string
  adminPubkeys: string[]
  adapter: TelephonyAdapter
  files: FilesService
  records: RecordsService
  maxBytes: number
  crypto: CryptoService
}

/**
 * Orchestrates voicemail audio storage:
 * 1. Download audio from telephony provider
 * 2. Validate size — bail with 'oversized' if too large, keeping provider copy as fallback
 * 3. Encrypt with ECIES envelopes for each admin
 * 4. Store encrypted blob in object storage via FilesService
 * 5. Delete from provider only after successful storage
 * 6. Update call record with voicemailFileId
 *
 * Returns the new fileId on success, or 'oversized' if the audio exceeds maxBytes.
 */
export async function storeVoicemailAudio(
  params: StoreVoicemailParams
): Promise<string | 'oversized'> {
  const { callSid, recordingSid, hubId, adminPubkeys, adapter, files, records, maxBytes, crypto } =
    params

  // 1. Download audio from provider
  const audioBuffer = await adapter.getRecordingAudio(recordingSid)
  if (!audioBuffer) {
    throw new Error(`Failed to download recording ${recordingSid} for call ${callSid}`)
  }

  const audioBytes = new Uint8Array(audioBuffer)

  // 2. Validate size — if over limit, log warning and keep provider copy as fallback
  if (audioBytes.length > maxBytes) {
    log.warn('Audio exceeds max size — keeping provider copy', {
      audioBytes: audioBytes.length,
      maxBytes,
      callSid,
    })
    return 'oversized'
  }

  // 3. Encrypt audio with ECIES envelopes for each admin
  const { encrypted, envelopes } = crypto.envelopeEncryptBinary(
    audioBytes,
    adminPubkeys,
    LABEL_VOICEMAIL_WRAP
  )

  const voicemailLabelId = labelToId(LABEL_VOICEMAIL_WRAP)
  // @ts-expect-error Slice 5: file crypto ECIES → HPKE migration
  const recipientEnvelopes: FileKeyEnvelope[] = envelopes.map((env) => ({
    v: 2,
    labelId: voicemailLabelId,
    pubkey: env.pubkey,
    // @ts-expect-error Slice 3: server crypto ECIES → HPKE migration
    wrappedKey: env.wrappedKey as Ciphertext,
    // @ts-expect-error Slice 3: server crypto ECIES → HPKE migration
    ephemeralPubkey: env.ephemeralPubkey,
  }))

  // 4. Store encrypted blob in object storage via FilesService
  const fileId = randomUUID()
  const encryptedBytes = Buffer.from(encrypted as string, 'hex')

  // putAssembled first — if this throws, we don't proceed to createFileRecord or deleteRecording
  await files.putAssembled(hubId, fileId, new Uint8Array(encryptedBytes), 'voicemails')
  await files.createFileRecord({
    id: fileId,
    hubId,
    conversationId: null,
    messageId: undefined,
    uploadedBy: 'system:voicemail',
    recipientEnvelopes,
    encryptedMetadata: [],
    totalSize: encryptedBytes.length,
    totalChunks: 1,
    status: 'complete',
    contextType: 'voicemail',
    contextId: callSid,
  })
  await files.completeUpload(fileId)

  // 5. Delete from provider — only after successful storage
  await adapter.deleteRecording(recordingSid)

  // 6. Update call record with file reference
  await records.updateCallRecord(callSid, hubId, { voicemailFileId: fileId })

  return fileId
}
