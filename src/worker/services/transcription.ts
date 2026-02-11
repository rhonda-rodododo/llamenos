import type { Env } from '../types'
import type { DurableObjects } from '../lib/do-access'
import { getTelephony } from '../lib/do-access'
import { encryptForPublicKey } from '../lib/crypto'

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export async function maybeTranscribe(
  parentCallSid: string,
  recordingSid: string,
  volunteerPubkey: string,
  env: Env,
  dos: DurableObjects,
) {
  // Check if transcription is globally enabled
  const transRes = await dos.session.fetch(new Request('http://do/settings/transcription'))
  const { globalEnabled } = await transRes.json() as { globalEnabled: boolean }
  if (!globalEnabled) return

  // Check if volunteer has transcription enabled
  const volRes = await dos.session.fetch(new Request(`http://do/volunteer/${volunteerPubkey}`))
  if (!volRes.ok) return
  const volunteer = await volRes.json() as { transcriptionEnabled: boolean }
  if (!volunteer.transcriptionEnabled) return

  // Get recording audio directly by recording SID
  const adapter = getTelephony(env)
  const audio = await adapter.getRecordingAudio(recordingSid)
  if (!audio) return

  try {
    // Transcribe using Cloudflare Workers AI (Whisper large-v3-turbo)
    const base64Audio = arrayBufferToBase64(audio)
    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: base64Audio,
    }) as { text?: string }

    if (result.text) {
      // ECIES: encrypt transcription for the volunteer's public key
      const { encryptedContent, ephemeralPubkey } = encryptForPublicKey(result.text, volunteerPubkey)
      await dos.session.fetch(new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({
          callId: parentCallSid,
          authorPubkey: 'system:transcription',
          encryptedContent,
          ephemeralPubkey,
        }),
      }))

      // Also encrypt for admin so they can read transcriptions independently
      const adminEncrypted = encryptForPublicKey(result.text, env.ADMIN_PUBKEY)
      await dos.session.fetch(new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({
          callId: parentCallSid,
          authorPubkey: 'system:transcription:admin',
          encryptedContent: adminEncrypted.encryptedContent,
          ephemeralPubkey: adminEncrypted.ephemeralPubkey,
        }),
      }))

      // Mark call record as having a transcription
      await dos.calls.fetch(new Request(`http://do/calls/${parentCallSid}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify({ hasTranscription: true }),
      }))
    }
  } catch (err) {
    console.error('[transcription] maybeTranscribe failed:', err)
  }
}

export async function transcribeVoicemail(
  callSid: string,
  env: Env,
  dos: DurableObjects,
) {
  // Check if transcription is globally enabled
  const transRes = await dos.session.fetch(new Request('http://do/settings/transcription'))
  const { globalEnabled } = await transRes.json() as { globalEnabled: boolean }
  if (!globalEnabled) return

  // Get voicemail recording from Twilio
  const adapter = getTelephony(env)
  const audio = await adapter.getCallRecording(callSid)
  if (!audio) return

  try {
    const base64Audio = arrayBufferToBase64(audio)
    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: base64Audio,
    }) as { text?: string }

    if (result.text) {
      // Voicemails are encrypted only for admin (no volunteer answered)
      const adminEncrypted = encryptForPublicKey(result.text, env.ADMIN_PUBKEY)
      await dos.session.fetch(new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({
          callId: callSid,
          authorPubkey: 'system:voicemail',
          encryptedContent: adminEncrypted.encryptedContent,
          ephemeralPubkey: adminEncrypted.ephemeralPubkey,
        }),
      }))

      // Mark call record as having a transcription
      await dos.calls.fetch(new Request(`http://do/calls/${callSid}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify({ hasTranscription: true }),
      }))
    }
  } catch (err) {
    console.error('[transcription] transcribeVoicemail failed:', err)
  }
}
