import { DEFAULT_LANGUAGE, IVR_LANGUAGES } from '../../shared/languages'
import { IVR_PROMPTS, getPrompt, getVoicemailThanks } from '../../shared/voice-prompts'
import { createLogger } from '../lib/logger'
import type {
  AudioUrlMap,
  CallAnsweredParams,
  CaptchaResponseParams,
  IncomingCallParams,
  LanguageMenuParams,
  RingUsersParams,
  TelephonyAdapter,
  TelephonyResponse,
  VoicemailParams,
  WebhookCallInfo,
  WebhookCallStatus,
  WebhookDigits,
  WebhookQueueResult,
  WebhookQueueWait,
  WebhookRecordingStatus,
  WebhookVerificationResult,
} from './adapter'

const log = createLogger('telephony.vonage')

/**
 * Vonage voice language codes, keyed by ISO 639-1.
 */
const VONAGE_VOICE_CODES: Record<string, { language: string; style?: number }> = {
  en: { language: 'en-US' },
  es: { language: 'es-MX' },
  zh: { language: 'cmn-CN' },
  tl: { language: 'fil-PH' },
  vi: { language: 'vi-VN' },
  ar: { language: 'ar' },
  fr: { language: 'fr-FR' },
  ht: { language: 'fr-FR' }, // No Haitian Creole, use French
  ko: { language: 'ko-KR' },
  ru: { language: 'ru-RU' },
  hi: { language: 'hi-IN' },
  pt: { language: 'pt-BR' },
  de: { language: 'de-DE' },
}

function getVonageVoice(lang: string) {
  return VONAGE_VOICE_CODES[lang] ?? VONAGE_VOICE_CODES[DEFAULT_LANGUAGE]
}

/** Build a talk action */
function talk(text: string, lang: string, bargeIn = false): Record<string, unknown> {
  const voice = getVonageVoice(lang)
  return { action: 'talk', text, language: voice.language, ...(bargeIn ? { bargeIn: true } : {}) }
}

/** Build a stream action (play audio URL) */
function stream(url: string, bargeIn = false): Record<string, unknown> {
  return { action: 'stream', streamUrl: [url], ...(bargeIn ? { bargeIn: true } : {}) }
}

/** Build a talk or stream action depending on custom audio */
function sayOrStream(
  promptKey: string,
  lang: string,
  audioUrls?: AudioUrlMap,
  textOverride?: string,
  bargeIn = false
): Record<string, unknown> {
  const audioUrl = audioUrls?.[`${promptKey}:${lang}`]
  if (audioUrl) return stream(audioUrl, bargeIn)
  const text = textOverride ?? getPrompt(promptKey, lang)
  return talk(text, lang, bargeIn)
}

/** Build hub query param suffix for callback URLs */
function hubQP(hubId?: string): string {
  return hubId ? `&hub=${encodeURIComponent(hubId)}` : ''
}

/** Build hub query param as first param (?hub=...) for URLs with no existing params */
function hubQPFirst(hubId?: string): string {
  return hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
}

/**
 * VonageAdapter — Vonage Voice API implementation of TelephonyAdapter.
 * Uses NCCO (Nexmo Call Control Object) JSON format instead of TwiML XML.
 */
export class VonageAdapter implements TelephonyAdapter {
  private apiKey: string
  private apiSecret: string
  private applicationId: string
  private phoneNumber: string
  // Vonage Voice API requires JWT auth with private key for API calls
  // For webhook responses, we return NCCO JSON
  // Private key stored as string (PEM format)
  private privateKey?: string

  constructor(
    apiKey: string,
    apiSecret: string,
    applicationId: string,
    phoneNumber: string,
    privateKey?: string
  ) {
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.applicationId = applicationId
    this.phoneNumber = phoneNumber
    this.privateKey = privateKey
  }

  private ncco(actions: Record<string, unknown>[]): TelephonyResponse {
    return {
      contentType: 'application/json',
      body: JSON.stringify(actions),
    }
  }

  private async vonageApi(path: string, init: RequestInit): Promise<Response> {
    // Vonage Voice API uses JWT auth; for simplicity, use Basic auth with api_key:api_secret
    // Full JWT auth requires private key signing (RS256)
    const auth = btoa(`${this.apiKey}:${this.apiSecret}`)
    return fetch(`https://api.nexmo.com${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })
  }

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const enabled = params.enabledLanguages
    const hp = hubQP(params.hubId)
    const activeLanguages = IVR_LANGUAGES.filter((code) => enabled.includes(code))

    if (activeLanguages.length <= 1) {
      const lang = activeLanguages[0] || DEFAULT_LANGUAGE
      // Redirect by returning NCCO that fetches from the language-selected endpoint
      return this.ncco([
        {
          action: 'talk',
          text: ' ',
        },
        {
          action: 'notify',
          payload: { lang, auto: true },
          eventUrl: [`/telephony/language-selected?auto=1&forceLang=${lang}${hp}`],
          eventMethod: 'POST',
        },
      ])
    }

    // Build talk actions for each enabled language
    const talkActions: Record<string, unknown>[] = []
    for (const langCode of IVR_LANGUAGES) {
      if (!enabled.includes(langCode)) continue
      const prompt = IVR_PROMPTS[langCode]
      if (!prompt) continue
      talkActions.push(talk(prompt, langCode, true))
    }

    return this.ncco([
      {
        action: 'input',
        type: ['dtmf'],
        dtmf: { maxDigits: 1, timeOut: 8 },
        eventUrl: [`/telephony/language-selected${hubQPFirst(params.hubId)}`],
        eventMethod: 'POST',
      },
      ...talkActions,
    ])
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const hp = hubQP(params.hubId)
    const greetingText = getPrompt('greeting', lang).replace('{name}', params.hotlineName)
    const greetingAction = sayOrStream('greeting', lang, params.audioUrls, greetingText)

    if (params.rateLimited) {
      const rateLimitAction = sayOrStream('rateLimited', lang, params.audioUrls)
      return this.ncco([greetingAction, rateLimitAction])
    }

    if (params.voiceCaptchaEnabled && params.captchaDigits) {
      const digits = params.captchaDigits
      const captchaAction = sayOrStream('captchaPrompt', lang, params.audioUrls, undefined, true)
      const digitsTalk = talk(`${digits.split('').join(', ')}.`, lang, true)

      return this.ncco([
        greetingAction,
        captchaAction,
        digitsTalk,
        {
          action: 'input',
          type: ['dtmf'],
          dtmf: { maxDigits: 4, timeOut: 10 },
          eventUrl: [`/telephony/captcha?callSid=${params.callSid}&lang=${lang}${hp}`],
          eventMethod: 'POST',
        },
      ])
    }

    const holdAction = sayOrStream('pleaseHold', lang, params.audioUrls)
    return this.ncco([
      greetingAction,
      holdAction,
      {
        action: 'conversation',
        name: params.callSid,
        startOnEnter: false,
        endOnExit: false,
        musicOnHoldUrl: [`/telephony/wait-music?lang=${lang}${hp}`],
      },
    ])
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const hp = hubQP(params.hubId)

    if (params.digits === params.expectedDigits) {
      return this.ncco([
        talk(getPrompt('captchaSuccess', lang), lang),
        {
          action: 'conversation',
          name: params.callSid,
          startOnEnter: false,
          endOnExit: false,
          musicOnHoldUrl: [`/telephony/wait-music?lang=${lang}${hp}`],
        },
      ])
    }

    // Retry: re-Gather with new digits
    if (params.remainingAttempts && params.remainingAttempts > 0 && params.newCaptchaDigits) {
      const retryDigits = params.newCaptchaDigits
      return this.ncco([
        talk(getPrompt('captchaRetry', lang), lang),
        talk(`${retryDigits.split('').join(', ')}.`, lang, true),
        {
          action: 'input',
          type: ['dtmf'],
          dtmf: { maxDigits: 4, timeOut: 10 },
          eventUrl: [`/telephony/captcha?callSid=${params.callSid}&lang=${lang}${hp}`],
          eventMethod: 'POST',
        },
      ])
    }

    return this.ncco([talk(getPrompt('captchaFail', lang), lang)])
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const hp = hubQP(params.hubId)
    return this.ncco([
      {
        action: 'conversation',
        name: params.parentCallSid,
        startOnEnter: true,
        endOnExit: true,
        record: true,
        eventUrl: [
          `${params.callbackUrl}/telephony/call-recording?parentCallSid=${params.parentCallSid}&pubkey=${params.userPubkey}${hp}`,
        ],
        eventMethod: 'POST',
      },
    ])
  }

  async handleWaitMusic(
    lang: string,
    audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse> {
    if (queueTime !== undefined && queueTime >= (queueTimeout ?? 90)) {
      // Signal to leave the conversation/queue
      return this.ncco([])
    }

    const waitAction = sayOrStream('waitMessage', lang, audioUrls)
    return this.ncco([
      waitAction,
      {
        action: 'stream',
        streamUrl: [
          'https://com.twilio.music.soft-rock.s3.amazonaws.com/_ghost_-_promo_2_sample_pack.mp3',
        ],
      },
    ])
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const hp = hubQP(params.hubId)
    const voicemailAction = sayOrStream('voicemailPrompt', lang, params.audioUrls)
    return this.ncco([
      voicemailAction,
      {
        action: 'record',
        endOnSilence: 5,
        endOnKey: '#',
        beepStart: true,
        timeOut: params.maxRecordingSeconds ?? 120,
        eventUrl: [
          `${params.callbackUrl}/telephony/voicemail-recording?callSid=${params.callSid}${hp}`,
        ],
        eventMethod: 'POST',
      },
      talk(getVoicemailThanks(lang), lang),
    ])
  }

  rejectCall(): TelephonyResponse {
    return this.ncco([])
  }

  async hangupCall(callSid: string): Promise<void> {
    await this.vonageApi(`/v1/calls/${callSid}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'hangup' }),
    })
  }

  async ringUsers(params: RingUsersParams): Promise<string[]> {
    const callSids: string[] = []
    const hubParam = params.hubId ? `&hub=${encodeURIComponent(params.hubId)}` : ''

    // Build outbound targets: one per phone number + one per browser identity
    const outboundTargets: Array<{
      pubkey: string
      to: Array<Record<string, string>>
      machineDetection?: string
    }> = []
    for (const vol of params.users) {
      if (vol.phone) {
        outboundTargets.push({
          pubkey: vol.pubkey,
          to: [{ type: 'phone', number: vol.phone.replace('+', '') }],
          machineDetection: 'hangup',
        })
      }
      if (vol.browserIdentity) {
        outboundTargets.push({
          pubkey: vol.pubkey,
          to: [{ type: 'app', user: vol.browserIdentity }],
        })
      }
    }

    const calls = await Promise.allSettled(
      outboundTargets.map(async (target) => {
        const body: Record<string, unknown> = {
          to: target.to,
          from: { type: 'phone', number: this.phoneNumber.replace('+', '') },
          answer_url: [
            `${params.callbackUrl}/telephony/user-answer?parentCallSid=${params.callSid}&pubkey=${target.pubkey}${hubParam}`,
          ],
          answer_method: 'POST',
          event_url: [
            `${params.callbackUrl}/telephony/call-status?parentCallSid=${params.callSid}&pubkey=${target.pubkey}${hubParam}`,
          ],
          event_method: 'POST',
          ringing_timer: 30,
        }
        if (target.machineDetection) {
          body.machine_detection = target.machineDetection
        }

        const res = await this.vonageApi('/v1/calls', {
          method: 'POST',
          body: JSON.stringify(body),
        })

        if (res.ok) {
          const data = (await res.json()) as { uuid: string }
          return data.uuid
        }
        throw new Error(`Failed to call ${target.pubkey}`)
      })
    )

    for (const result of calls) {
      if (result.status === 'fulfilled') {
        callSids.push(result.value)
      } else {
        log.error('Failed to ring volunteer', result.reason)
      }
    }

    if (callSids.length === 0 && outboundTargets.length > 0) {
      log.error('CRITICAL: All outbound calls failed — no volunteers are being rung', undefined, {
        targetCount: outboundTargets.length,
      })
    }

    return callSids
  }

  async cancelRinging(callSids: string[], exceptSid?: string): Promise<void> {
    const results = await Promise.allSettled(
      callSids
        .filter((sid) => sid !== exceptSid)
        .map((sid) =>
          this.vonageApi(`/v1/calls/${sid}`, {
            method: 'PUT',
            body: JSON.stringify({ action: 'hangup' }),
          })
        )
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn('Failed to cancel ringing', { reason: String(result.reason) })
      }
    }
  }

  async validateWebhook(request: Request): Promise<boolean> {
    // Vonage signs webhooks using a signature secret (HMAC-SHA256)
    // The signature is sent in the Authorization header or as a query parameter
    // We validate using the apiSecret as the signing key
    const url = new URL(request.url)

    // Epic 258 H16: Timestamp check applies unconditionally (before signature check)
    // to prevent replay attacks even when a valid signature is present
    const timestamp = url.searchParams.get('timestamp')
    if (!timestamp) return false
    const ts = Number.parseInt(timestamp, 10)
    if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

    const sig = url.searchParams.get('sig')
    if (!sig) return false

    // Reconstruct signing input: sort all query params (excluding sig), concatenate
    const params = Array.from(url.searchParams.entries())
      .filter(([key]) => key !== 'sig')
      .sort(([a], [b]) => a.localeCompare(b))

    let sigInput = ''
    for (const [key, value] of params) {
      sigInput += `&${key}=${value}`
    }

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.apiSecret) as Uint8Array<ArrayBuffer>,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signed = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(sigInput) as Uint8Array<ArrayBuffer>
    )
    const expected = Array.from(new Uint8Array(signed))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Constant-time comparison
    if (sig.length !== expected.length) return false
    const aBuf = encoder.encode(sig.toLowerCase())
    const bBuf = encoder.encode(expected)
    let result = 0
    for (let i = 0; i < aBuf.length; i++) {
      result |= aBuf[i] ^ bBuf[i]
    }
    return result === 0
  }

  async getCallRecording(callSid: string): Promise<ArrayBuffer | null> {
    // Vonage provides recording URL in the recording webhook
    // Fetch from the Vonage recordings API
    const res = await this.vonageApi(`/v1/calls/${callSid}`, { method: 'GET' })
    if (!res.ok) {
      log.error('Failed to get call info', undefined, {
        callSid,
        status: res.status,
        statusText: res.statusText,
      })
      return null
    }

    const data = (await res.json()) as { recording_url?: string }
    if (!data.recording_url) return null

    const audioRes = await fetch(data.recording_url, {
      headers: { Authorization: `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}` },
    })
    if (!audioRes.ok) {
      log.error('Failed to get recording audio for call', undefined, {
        callSid,
        status: audioRes.status,
        statusText: audioRes.statusText,
      })
      return null
    }
    return audioRes.arrayBuffer()
  }

  async getRecordingAudio(recordingSid: string): Promise<ArrayBuffer | null> {
    // Vonage recording URLs are full URLs, not SIDs
    const audioRes = await fetch(recordingSid, {
      headers: { Authorization: `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}` },
    })
    if (!audioRes.ok) {
      log.error('Failed to get recording audio', undefined, {
        recordingSid,
        status: audioRes.status,
        statusText: audioRes.statusText,
      })
      return null
    }
    return audioRes.arrayBuffer()
  }

  async deleteRecording(recordingSid: string): Promise<void> {
    // recordingSid is the recording_url for Vonage (e.g. https://api.nexmo.com/v1/files/{uuid})
    try {
      const url = new URL(recordingSid)
      const mediaId = url.pathname.split('/').pop()
      if (!mediaId) return
      await fetch(`https://api.nexmo.com/v3/media/${mediaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}` },
      })
    } catch (err) {
      log.error('Failed to delete recording', err)
    }
  }

  // --- Webhook parsing ---
  // Vonage sends webhooks as JSON (not form data like Twilio)

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const data = (await request.clone().json()) as Record<string, string>
    return {
      callSid: data.uuid || data.conversation_uuid || '',
      callerNumber: data.from || '',
      calledNumber: data.to || undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const data = (await request.clone().json()) as Record<string, unknown>
    const dtmf = data.dtmf as Record<string, string> | undefined
    return {
      callSid: (data.uuid || data.conversation_uuid || '') as string,
      callerNumber: (data.from || '') as string,
      digits: dtmf?.digits || '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const data = (await request.clone().json()) as Record<string, unknown>
    const dtmf = data.dtmf as Record<string, string> | undefined
    return {
      digits: dtmf?.digits || '',
      callerNumber: (data.from || '') as string,
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const data = (await request.clone().json()) as Record<string, string>
    const STATUS_MAP: Record<string, WebhookCallStatus['status']> = {
      started: 'initiated',
      ringing: 'ringing',
      answered: 'answered',
      completed: 'completed',
      busy: 'busy',
      timeout: 'no-answer',
      unanswered: 'no-answer',
      failed: 'failed',
      rejected: 'failed',
      cancelled: 'failed',
    }
    return { status: STATUS_MAP[data.status] ?? 'failed' }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const data = (await request.clone().json()) as Record<string, string>
    return {
      queueTime: Number.parseInt(data.duration || '0', 10),
    }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const data = (await request.clone().json()) as Record<string, string>
    const status = data.status || ''
    if (status === 'answered') return { result: 'bridged' }
    if (status === 'completed') return { result: 'hangup' }
    return { result: 'error' }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const data = (await request.clone().json()) as Record<string, string>
    return {
      status: data.recording_url ? 'completed' : 'failed',
      recordingSid: data.recording_url || undefined,
      callSid: data.conversation_uuid || undefined,
    }
  }

  handleVoicemailComplete(lang: string): TelephonyResponse {
    return this.ncco([talk(getVoicemailThanks(lang), lang)])
  }

  handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse {
    return this.ncco([sayOrStream('unavailableMessage', lang, audioUrls), { action: 'hangup' }])
  }

  emptyResponse(): TelephonyResponse {
    return this.ncco([])
  }

  async testConnection() {
    const { vonageCapabilities } = await import('./vonage-capabilities')
    return vonageCapabilities.testConnection({
      type: 'vonage',
      phoneNumber: this.phoneNumber,
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      applicationId: this.applicationId,
      privateKey: this.privateKey,
    } as Parameters<typeof vonageCapabilities.testConnection>[0])
  }

  async verifyWebhookConfig(
    _phoneNumber: string,
    expectedBaseUrl: string
  ): Promise<WebhookVerificationResult> {
    const expectedVoiceUrl = `${expectedBaseUrl}/telephony/incoming`

    if (!this.privateKey) {
      return {
        configured: false,
        expectedUrl: expectedVoiceUrl,
        warning:
          'Vonage private key not configured — cannot verify webhook URLs via Application API',
      }
    }

    try {
      const jwt = await this.signApplicationJwt()
      const res = await fetch(`https://api.nexmo.com/v2/applications/${this.applicationId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${jwt}` },
      })

      if (!res.ok) {
        return {
          configured: false,
          expectedUrl: expectedVoiceUrl,
          warning: `Failed to query Vonage Application API: ${res.status} ${res.statusText}`,
        }
      }

      const data = (await res.json()) as {
        capabilities?: {
          voice?: {
            webhooks?: {
              answer_url?: { address?: string }
              event_url?: { address?: string }
            }
          }
        }
      }

      const answerUrl = data.capabilities?.voice?.webhooks?.answer_url?.address ?? ''
      const configured = answerUrl.startsWith(expectedBaseUrl)

      return {
        configured,
        expectedUrl: expectedVoiceUrl,
        actualUrl: answerUrl || undefined,
        warning: configured
          ? undefined
          : 'Voice answer webhook URL does not point to this application',
      }
    } catch (err) {
      return {
        configured: false,
        expectedUrl: expectedVoiceUrl,
        warning: `Vonage Application API error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * Sign a short-lived JWT for Vonage Application API authentication.
   * Uses RS256 with the application's private key.
   */
  private async signApplicationJwt(): Promise<string> {
    const { signJwtRs256 } = await import('./webrtc-tokens')
    const now = Math.floor(Date.now() / 1000)
    const jti = crypto.randomUUID()
    const header = { typ: 'JWT', alg: 'RS256' }
    const payload = {
      iat: now,
      exp: now + 60, // 1 minute — only needed for a single API call
      jti,
      application_id: this.applicationId,
    }
    return signJwtRs256(header, payload, this.privateKey!)
  }
}
