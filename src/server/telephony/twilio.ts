import { DEFAULT_LANGUAGE, IVR_LANGUAGES } from '../../shared/languages'
import { getPrompt, getVoicemailThanks, IVR_PROMPTS } from '../../shared/voice-prompts'
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

const log = createLogger('telephony.twilio')

/**
 * Twilio TwiML voice language codes, keyed by ISO 639-1 language code.
 * Provider-specific — lives here, not in shared config.
 */
const VOICE_CODES: Record<string, string> = {
  en: 'en-US',
  es: 'es-MX',
  zh: 'cmn-CN',
  tl: 'fil-PH',
  vi: 'vi-VN',
  ar: 'ar-XA',
  fr: 'fr-FR',
  ht: 'fr-FR', // Twilio doesn't support Haitian Creole; French is closest
  ko: 'ko-KR',
  ru: 'ru-RU',
  hi: 'hi-IN',
  pt: 'pt-BR',
  de: 'de-DE',
}

/**
 * Get Twilio voice language code for a language.
 * Falls back to en-US if the language isn't configured.
 */
function getTwilioVoice(lang: string): string {
  return VOICE_CODES[lang] ?? VOICE_CODES[DEFAULT_LANGUAGE]
}

/** Escape XML special characters for safe TwiML embedding */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Generate TwiML: <Play> if custom audio exists, <Say> fallback */
function sayOrPlay(
  promptKey: string,
  lang: string,
  audioUrls?: AudioUrlMap,
  text?: string
): string {
  const audioUrl = audioUrls?.[`${promptKey}:${lang}`]
  if (audioUrl) {
    return `<Play>${escapeXml(audioUrl)}</Play>`
  }
  const voice = getTwilioVoice(lang)
  const content = text ?? getPrompt(promptKey, lang)
  return `<Say language="${voice}">${escapeXml(content)}</Say>`
}

/** Build XML-escaped hub query param suffix for TwiML callback URLs */
function hubXmlParam(hubId?: string): string {
  return hubId ? `&amp;hub=${escapeXml(encodeURIComponent(hubId))}` : ''
}

/** Build hub query param suffix for non-XML URLs */
function _hubQueryParam(hubId?: string): string {
  return hubId ? `&hub=${encodeURIComponent(hubId)}` : ''
}

/**
 * TwilioAdapter — Twilio implementation of TelephonyAdapter.
 */
export class TwilioAdapter implements TelephonyAdapter {
  protected accountSid: string
  protected authToken: string
  protected phoneNumber: string

  constructor(accountSid: string, authToken: string, phoneNumber: string) {
    this.accountSid = accountSid
    this.authToken = authToken
    this.phoneNumber = phoneNumber
  }

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const enabled = params.enabledLanguages
    const hp = hubXmlParam(params.hubId)
    // Filter IVR languages to only those enabled by admin
    const activeLanguages = IVR_LANGUAGES.filter((code) => enabled.includes(code))

    // If only 1 language enabled, skip the menu entirely
    if (activeLanguages.length <= 1) {
      const lang = activeLanguages[0] || DEFAULT_LANGUAGE
      return this.twiml(`
        <Response>
          <Redirect method="POST">/telephony/language-selected?auto=1&amp;forceLang=${lang}${hp}</Redirect>
        </Response>
      `)
    }

    // Build <Say> elements only for enabled languages, keeping fixed digit mapping
    const sayElements = IVR_LANGUAGES.map((langCode) => {
      if (!enabled.includes(langCode)) return ''
      const voice = getTwilioVoice(langCode)
      const prompt = IVR_PROMPTS[langCode]
      if (!prompt) return ''
      return `<Say language="${voice}">${prompt}</Say>`
    })
      .filter(Boolean)
      .join('\n      ')

    return this.twiml(`
      <Response>
        <Gather numDigits="1" action="/telephony/language-selected${params.hubId ? `?hub=${escapeXml(encodeURIComponent(params.hubId))}` : ''}" method="POST" timeout="8">
          ${sayElements}
        </Gather>
        <Redirect method="POST">/telephony/language-selected?auto=1${hp}</Redirect>
      </Response>
    `)
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const tLang = getTwilioVoice(lang)
    const hp = hubXmlParam(params.hubId)
    const greetingText = getPrompt('greeting', lang).replace('{name}', params.hotlineName)
    const greetingTwiml = sayOrPlay('greeting', lang, params.audioUrls, greetingText)

    if (params.rateLimited) {
      const rateLimitTwiml = sayOrPlay('rateLimited', lang, params.audioUrls)
      return this.twiml(`
        <Response>
          ${greetingTwiml}
          ${rateLimitTwiml}
          <Hangup/>
        </Response>
      `)
    }

    if (params.voiceCaptchaEnabled && params.captchaDigits) {
      const digits = params.captchaDigits
      const captchaTwiml = sayOrPlay('captchaPrompt', lang, params.audioUrls)
      return this.twiml(`
        <Response>
          <Gather numDigits="4" action="/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST" timeout="10">
            ${greetingTwiml}
            ${captchaTwiml}
            <Say language="${tLang}">${escapeXml(digits.split('').join(', '))}.</Say>
          </Gather>
          <Say language="${tLang}">${escapeXml(getPrompt('captchaTimeout', lang))}</Say>
          <Hangup/>
        </Response>
      `)
    }

    const holdTwiml = sayOrPlay('pleaseHold', lang, params.audioUrls)
    return this.twiml(`
      <Response>
        ${greetingTwiml}
        ${holdTwiml}
        <Enqueue waitUrl="/telephony/wait-music?lang=${lang}${hp}" action="/telephony/queue-exit?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST">${params.callSid}</Enqueue>
      </Response>
    `)
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const tLang = getTwilioVoice(lang)
    const hp = hubXmlParam(params.hubId)

    if (params.digits === params.expectedDigits) {
      return this.twiml(`
        <Response>
          <Say language="${tLang}">${getPrompt('captchaSuccess', lang)}</Say>
          <Enqueue waitUrl="/telephony/wait-music?lang=${lang}${hp}" action="/telephony/queue-exit?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST">${params.callSid}</Enqueue>
        </Response>
      `)
    }

    // Retry: re-Gather with new digits
    if (params.remainingAttempts && params.remainingAttempts > 0 && params.newCaptchaDigits) {
      const retryDigits = params.newCaptchaDigits
      return this.twiml(`
        <Response>
          <Gather numDigits="4" action="/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST" timeout="10">
            <Say language="${tLang}">${escapeXml(getPrompt('captchaRetry', lang))}</Say>
            <Say language="${tLang}">${escapeXml(retryDigits.split('').join(', '))}.</Say>
          </Gather>
          <Redirect method="POST">/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}</Redirect>
        </Response>
      `)
    }

    return this.twiml(`
      <Response>
        <Say language="${tLang}">${getPrompt('captchaFail', lang)}</Say>
        <Hangup/>
      </Response>
    `)
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const hp = hubXmlParam(params.hubId)
    return this.twiml(`
      <Response>
        <Dial record="record-from-answer" recordingStatusCallback="${params.callbackUrl}/telephony/call-recording?parentCallSid=${params.parentCallSid}&amp;pubkey=${params.userPubkey}${hp}" recordingStatusCallbackEvent="completed">
          <Queue>${params.parentCallSid}</Queue>
        </Dial>
      </Response>
    `)
  }

  async handleWaitMusic(
    lang: string,
    audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse> {
    // After timeout in queue with no answer, leave queue → triggers voicemail
    if (queueTime !== undefined && queueTime >= (queueTimeout ?? 90)) {
      return this.twiml('<Response><Leave/></Response>')
    }

    const waitTwiml = sayOrPlay('waitMessage', lang, audioUrls)
    return this.twiml(`
      <Response>
        ${waitTwiml}
        <Play>https://com.twilio.music.soft-rock.s3.amazonaws.com/_ghost_-_promo_2_sample_pack.mp3</Play>
      </Response>
    `)
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const hp = hubXmlParam(params.hubId)
    const voicemailTwiml = sayOrPlay('voicemailPrompt', lang, params.audioUrls)
    return this.twiml(`
      <Response>
        ${voicemailTwiml}
        <Record maxLength="${params.maxRecordingSeconds ?? 120}" action="/telephony/voicemail-complete?callSid=${params.callSid}&amp;lang=${lang}${hp}" recordingStatusCallback="${params.callbackUrl}/telephony/voicemail-recording?callSid=${params.callSid}${hp}" recordingStatusCallbackEvent="completed" />
        <Hangup/>
      </Response>
    `)
  }

  rejectCall(): TelephonyResponse {
    return this.twiml('<Response><Reject reason="rejected"/></Response>')
  }

  async hangupCall(callSid: string): Promise<void> {
    await this.twilioApi(`/Calls/${callSid}.json`, {
      method: 'POST',
      body: new URLSearchParams({ Status: 'completed' }),
    })
  }

  async ringUsers(params: RingUsersParams): Promise<string[]> {
    const callSids: string[] = []
    const hubParam = params.hubId ? `&hub=${encodeURIComponent(params.hubId)}` : ''

    // Build list of outbound calls: one per phone number + one per browser identity
    const outboundTargets: Array<{ pubkey: string; to: string }> = []
    for (const vol of params.users) {
      if (vol.phone) {
        outboundTargets.push({ pubkey: vol.pubkey, to: vol.phone })
      }
      if (vol.browserIdentity) {
        outboundTargets.push({ pubkey: vol.pubkey, to: `client:${vol.browserIdentity}` })
      }
    }

    const calls = await Promise.allSettled(
      outboundTargets.map(async (target) => {
        const body = new URLSearchParams({
          To: target.to,
          From: this.phoneNumber,
          Url: `${params.callbackUrl}/telephony/user-answer?parentCallSid=${params.callSid}&pubkey=${target.pubkey}${hubParam}`,
          StatusCallback: `${params.callbackUrl}/telephony/call-status?parentCallSid=${params.callSid}&pubkey=${target.pubkey}${hubParam}`,
          Timeout: '30',
        })
        // Only enable machine detection for phone calls, not browser clients
        if (!target.to.startsWith('client:')) {
          body.set('MachineDetection', 'Enable')
        }
        // Twilio REST API requires separate params per event (not space-separated)
        body.append('StatusCallbackEvent', 'initiated')
        body.append('StatusCallbackEvent', 'ringing')
        body.append('StatusCallbackEvent', 'answered')
        body.append('StatusCallbackEvent', 'completed')

        const res = await this.twilioApi('/Calls.json', {
          method: 'POST',
          body,
        })

        if (res.ok) {
          const data = (await res.json()) as { sid: string }
          return data.sid
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
          this.twilioApi(`/Calls/${sid}.json`, {
            method: 'POST',
            body: new URLSearchParams({ Status: 'completed' }),
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
    const signature = request.headers.get('X-Twilio-Signature')
    if (!signature) return false

    const url = new URL(request.url)
    const body = await request.clone().text()
    const params = new URLSearchParams(body)

    let dataString = url.toString()
    const sortedKeys = Array.from(params.keys()).sort()
    for (const key of sortedKeys) {
      dataString += key + params.get(key)
    }

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.authToken) as Uint8Array<ArrayBuffer>,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(dataString) as Uint8Array<ArrayBuffer>
    )
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)))

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expected.length) return false
    const aBuf = encoder.encode(signature)
    const bBuf = encoder.encode(expected)
    let result = 0
    for (let i = 0; i < aBuf.length; i++) {
      result |= aBuf[i] ^ bBuf[i]
    }
    return result === 0
  }

  async getCallRecording(callSid: string): Promise<ArrayBuffer | null> {
    const res = await this.twilioApi(`/Calls/${callSid}/Recordings.json`, {
      method: 'GET',
    })
    if (!res.ok) {
      log.error('Failed to get recordings for call', undefined, {
        callSid,
        status: res.status,
        statusText: res.statusText,
      })
      return null
    }

    const data = (await res.json()) as { recordings?: Array<{ sid: string }> }
    if (!data.recordings?.length) return null

    const recordingSid = data.recordings[0].sid
    const audioRes = await fetch(`${this.getRecordingBaseUrl()}/Recordings/${recordingSid}.wav`, {
      headers: {
        Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
      },
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

  async getRecordingAudio(recordingSid: string): Promise<ArrayBuffer | null> {
    const audioRes = await fetch(`${this.getRecordingBaseUrl()}/Recordings/${recordingSid}.wav`, {
      headers: {
        Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
      },
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
    await this.twilioApi(`/Recordings/${recordingSid}.json`, { method: 'DELETE' })
  }

  // --- Webhook parsing ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const form = await request.clone().formData()
    return {
      callSid: form.get('CallSid') as string,
      callerNumber: form.get('From') as string,
      calledNumber: (form.get('To') as string) || undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const form = await request.clone().formData()
    return {
      callSid: form.get('CallSid') as string,
      callerNumber: form.get('From') as string,
      digits: (form.get('Digits') as string) || '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const form = await request.clone().formData()
    return {
      digits: (form.get('Digits') as string) || '',
      callerNumber: (form.get('From') as string) || '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const form = await request.clone().formData()
    const raw = form.get('CallStatus') as string
    const STATUS_MAP: Record<string, WebhookCallStatus['status']> = {
      initiated: 'initiated',
      ringing: 'ringing',
      'in-progress': 'answered',
      completed: 'completed',
      busy: 'busy',
      'no-answer': 'no-answer',
      failed: 'failed',
      canceled: 'failed',
    }
    return { status: STATUS_MAP[raw] ?? 'failed' }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const form = await request.clone().formData()
    return {
      queueTime: Number.parseInt((form.get('QueueTime') as string) || '0', 10),
    }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const form = await request.clone().formData()
    const raw = form.get('QueueResult') as string
    const RESULT_MAP: Record<string, WebhookQueueResult['result']> = {
      leave: 'leave',
      'queue-full': 'queue-full',
      error: 'error',
      bridged: 'bridged',
      hangup: 'hangup',
    }
    return { result: RESULT_MAP[raw] ?? 'error' }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const form = await request.clone().formData()
    const raw = form.get('RecordingStatus') as string
    return {
      status: raw === 'completed' ? 'completed' : 'failed',
      recordingSid: (form.get('RecordingSid') as string) || undefined,
      callSid: (form.get('CallSid') as string) || undefined,
    }
  }

  // --- Additional response methods ---

  handleVoicemailComplete(lang: string): TelephonyResponse {
    const voice = getTwilioVoice(lang)
    return this.twiml(`
      <Response>
        <Say language="${voice}">${getVoicemailThanks(lang)}</Say>
        <Hangup/>
      </Response>
    `)
  }

  handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse {
    const unavailableTwiml = sayOrPlay('unavailableMessage', lang, audioUrls)
    return this.twiml(`
      <Response>
        ${unavailableTwiml}
        <Hangup/>
      </Response>
    `)
  }

  emptyResponse(): TelephonyResponse {
    return this.twiml('<Response/>')
  }

  async testConnection() {
    const { twilioCapabilities } = await import('./twilio-capabilities')
    return twilioCapabilities.testConnection({
      type: 'twilio',
      phoneNumber: this.phoneNumber,
      accountSid: this.accountSid,
      authToken: this.authToken,
    } as Parameters<typeof twilioCapabilities.testConnection>[0])
  }

  async verifyWebhookConfig(
    phoneNumber: string,
    expectedBaseUrl: string
  ): Promise<WebhookVerificationResult> {
    const expectedVoiceUrl = `${expectedBaseUrl}/telephony/incoming`
    try {
      const encoded = encodeURIComponent(phoneNumber)
      const res = await this.twilioApi(`/IncomingPhoneNumbers.json?PhoneNumber=${encoded}`, {
        method: 'GET',
      })
      if (!res.ok) {
        return {
          configured: false,
          expectedUrl: expectedVoiceUrl,
          warning: `Failed to query Twilio API: ${res.status} ${res.statusText}`,
        }
      }
      const data = (await res.json()) as {
        incoming_phone_numbers?: Array<{ voice_url?: string }>
      }
      const numbers = data.incoming_phone_numbers
      if (!numbers?.length) {
        return {
          configured: false,
          expectedUrl: expectedVoiceUrl,
          warning: `Phone number ${phoneNumber} not found in this Twilio account`,
        }
      }
      const actualUrl = numbers[0].voice_url ?? ''
      const configured = actualUrl.startsWith(expectedBaseUrl)
      return {
        configured,
        expectedUrl: expectedVoiceUrl,
        actualUrl: actualUrl || undefined,
        warning: configured ? undefined : 'Voice webhook URL does not point to this application',
      }
    } catch (err) {
      return {
        configured: false,
        expectedUrl: expectedVoiceUrl,
        warning: `Error verifying webhook: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // --- Helpers ---

  protected twiml(xml: string): TelephonyResponse {
    return {
      contentType: 'text/xml',
      body: xml.trim(),
    }
  }

  protected getApiBaseUrl(): string {
    return `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}`
  }

  protected getRecordingBaseUrl(): string {
    return `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}`
  }

  protected async twilioApi(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
        ...(init.body instanceof URLSearchParams
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
        ...init.headers,
      },
    })
  }
}
