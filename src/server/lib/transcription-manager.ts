import { LABEL_MESSAGE, LABEL_VOICEMAIL_TRANSCRIPT } from '@shared/crypto-labels'
import type { Services } from '../services'
import type { Env } from '../types'
import { getTelephony } from './adapters'
import { createLogger } from './logger'

const log = createLogger('lib.transcription-manager')

export async function maybeTranscribe(
  parentCallSid: string,
  recordingSid: string,
  userPubkey: string,
  hubId: string,
  env: Env,
  services: Services
) {
  // Check if transcription is globally enabled
  const transSettings = await services.settings.getTranscriptionSettings()
  if (!transSettings.globalEnabled) return

  // Check if user has transcription enabled
  const user = await services.identity.getUser(userPubkey)
  if (!user?.transcriptionEnabled) return

  // Get recording audio directly by recording SID
  const adapter = await getTelephony(services.settings, undefined, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return
  const audio = await adapter.getRecordingAudio(recordingSid)
  if (!audio) return

  try {
    // Transcribe using self-hosted Whisper
    const result = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(audio)],
    })

    if (result.text) {
      // Server-encrypt the transcription at rest (AES-GCM with server key).
      // Clients will see this as a server-encrypted note; a future MLS claim
      // path can re-encrypt for group decryption.
      const encrypted = await services.crypto.serverEncrypt(result.text, LABEL_MESSAGE)

      await services.records.createNote({
        callId: parentCallSid,
        authorPubkey: 'system:transcription',
        encryptedContent: encrypted as string,
      })

      // Mark call record as having a transcription and persist the recording SID
      await services.records.updateCallRecord(parentCallSid, hubId, {
        hasTranscription: true,
        recordingSid,
        hasRecording: true,
      })
    }
  } catch (err) {
    log.error('maybeTranscribe failed', err)
  }
}

export async function transcribeVoicemail(
  callSid: string,
  hubId: string,
  env: Env,
  services: Services
) {
  // Check if transcription is globally enabled
  const transSettings = await services.settings.getTranscriptionSettings()
  if (!transSettings.globalEnabled) return

  // Get voicemail recording from telephony provider
  const adapter = await getTelephony(services.settings, undefined, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return
  const audio = await adapter.getCallRecording(callSid)
  if (!audio) return

  try {
    const result = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(audio)],
    })

    if (result.text) {
      // Server-encrypt voicemail transcription at rest
      const encrypted = await services.crypto.serverEncrypt(result.text, LABEL_VOICEMAIL_TRANSCRIPT)

      await services.records.createNote({
        callId: callSid,
        authorPubkey: 'system:voicemail',
        encryptedContent: encrypted as string,
      })

      // Mark call record as having a transcription
      await services.records.updateCallRecord(callSid, hubId, {
        hasTranscription: true,
      })
    }
  } catch (err) {
    log.error('transcribeVoicemail failed', err)
  }
}
