/**
 * BandwidthAdapter — Bandwidth Voice API v2 implementation of TelephonyAdapter.
 *
 * Uses BXML (Bandwidth XML) — similar to Twilio's TwiML. Returns BXML XML
 * in response to webhook callbacks. Key verb differences from TwiML:
 * - <SpeakSentence> instead of <Say>
 * - <PlayAudio> instead of <Play>
 * - <Gather> is the same
 * - <Bridge> for connecting calls
 * - <StartRecording>/<StopRecording> for call recording
 * - <Record> for voicemail recording
 *
 * Authentication: Basic auth `{apiToken}:{apiSecret}` for API calls.
 * API base: `https://voice.bandwidth.com/api/v2/accounts/{accountId}`
 *
 * Reference: https://dev.bandwidth.com/apis/voice/
 *            https://dev.bandwidth.com/docs/voice/bxml/
 */

import { DEFAULT_LANGUAGE, IVR_LANGUAGES } from '../../shared/languages'
import {
  BandwidthWebhookEventSchema,
  mapBandwidthDisconnectCause,
} from '../../shared/schemas/external/bandwidth-voice'
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

const log = createLogger('telephony.bandwidth')

/**
 * Bandwidth TTS voice names mapped by ISO 639-1 language code.
 * Bandwidth uses `locale` and `gender` attributes on <SpeakSentence>.
 * Provider-specific — lives here, not in shared config.
 */
const BANDWIDTH_VOICES: Record<string, { locale: string; gender: string }> = {
  en: { locale: 'en_US', gender: 'female' },
  es: { locale: 'es_MX', gender: 'female' },
  zh: { locale: 'zh_CN', gender: 'female' },
  tl: { locale: 'en_US', gender: 'female' }, // No Tagalog; English fallback
  vi: { locale: 'en_US', gender: 'female' }, // No Vietnamese; English fallback
  ar: { locale: 'ar_XA', gender: 'female' },
  fr: { locale: 'fr_FR', gender: 'female' },
  ht: { locale: 'fr_FR', gender: 'female' }, // Haitian Creole → French fallback
  ko: { locale: 'ko_KR', gender: 'female' },
  ru: { locale: 'ru_RU', gender: 'female' },
  hi: { locale: 'hi_IN', gender: 'female' },
  pt: { locale: 'pt_BR', gender: 'female' },
  de: { locale: 'de_DE', gender: 'female' },
}

function getBandwidthVoice(lang: string): { locale: string; gender: string } {
  return BANDWIDTH_VOICES[lang] ?? BANDWIDTH_VOICES[DEFAULT_LANGUAGE]
}

/** Escape XML special characters for safe BXML embedding */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Generate BXML: <PlayAudio> if custom audio exists, <SpeakSentence> fallback */
function speakOrPlay(
  promptKey: string,
  lang: string,
  audioUrls?: AudioUrlMap,
  text?: string
): string {
  const audioUrl = audioUrls?.[`${promptKey}:${lang}`]
  if (audioUrl) {
    return `<PlayAudio>${escapeXml(audioUrl)}</PlayAudio>`
  }
  const { locale, gender } = getBandwidthVoice(lang)
  const content = text ?? getPrompt(promptKey, lang)
  return `<SpeakSentence locale="${locale}" gender="${gender}">${escapeXml(content)}</SpeakSentence>`
}

/** Build XML-escaped hub query param suffix for BXML callback URLs */
function hubXmlParam(hubId?: string): string {
  return hubId ? `&amp;hub=${escapeXml(encodeURIComponent(hubId))}` : ''
}

/** Build hub query param suffix for non-XML URLs */
function hubQueryParam(hubId?: string): string {
  return hubId ? `&hub=${encodeURIComponent(hubId)}` : ''
}

/**
 * BandwidthAdapter — Bandwidth Voice API v2 implementation.
 *
 * Returns BXML XML for IVR flows, uses REST API for call control.
 */
export class BandwidthAdapter implements TelephonyAdapter {
  private accountId: string
  private apiToken: string
  private apiSecret: string
  private applicationId: string
  private phoneNumber: string

  constructor(
    accountId: string,
    apiToken: string,
    apiSecret: string,
    applicationId: string,
    phoneNumber: string
  ) {
    this.accountId = accountId
    this.apiToken = apiToken
    this.apiSecret = apiSecret
    this.applicationId = applicationId
    this.phoneNumber = phoneNumber
  }

  // --- IVR Methods ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const enabled = params.enabledLanguages
    const hp = hubXmlParam(params.hubId)
    const activeLanguages = IVR_LANGUAGES.filter((code) => enabled.includes(code))

    // If only 1 language enabled, skip the menu entirely
    if (activeLanguages.length <= 1) {
      const lang = activeLanguages[0] || DEFAULT_LANGUAGE
      return this.bxml(`
        <Response>
          <Redirect redirectUrl="/telephony/language-selected?auto=1&amp;forceLang=${lang}${hp}"/>
        </Response>
      `)
    }

    // Build <SpeakSentence> elements for each enabled language
    const speakElements = IVR_LANGUAGES.map((langCode) => {
      if (!enabled.includes(langCode)) return ''
      const { locale, gender } = getBandwidthVoice(langCode)
      const prompt = IVR_PROMPTS[langCode]
      if (!prompt) return ''
      return `<SpeakSentence locale="${locale}" gender="${gender}">${prompt}</SpeakSentence>`
    })
      .filter(Boolean)
      .join('\n      ')

    return this.bxml(`
      <Response>
        <Gather maxDigits="1" gatherUrl="/telephony/language-selected${params.hubId ? `?hub=${escapeXml(encodeURIComponent(params.hubId))}` : ''}" firstDigitTimeout="8" repeatCount="1">
          ${speakElements}
        </Gather>
        <Redirect redirectUrl="/telephony/language-selected?auto=1${hp}"/>
      </Response>
    `)
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const { locale, gender } = getBandwidthVoice(lang)
    const hp = hubXmlParam(params.hubId)
    const greetingText = getPrompt('greeting', lang).replace('{name}', params.hotlineName)
    const greetingBxml = speakOrPlay('greeting', lang, params.audioUrls, greetingText)

    if (params.rateLimited) {
      const rateLimitBxml = speakOrPlay('rateLimited', lang, params.audioUrls)
      return this.bxml(`
        <Response>
          ${greetingBxml}
          ${rateLimitBxml}
          <Hangup/>
        </Response>
      `)
    }

    if (params.voiceCaptchaEnabled && params.captchaDigits) {
      const digits = params.captchaDigits
      const captchaBxml = speakOrPlay('captchaPrompt', lang, params.audioUrls)
      return this.bxml(`
        <Response>
          <Gather maxDigits="4" gatherUrl="/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}" firstDigitTimeout="10" repeatCount="1">
            ${greetingBxml}
            ${captchaBxml}
            <SpeakSentence locale="${locale}" gender="${gender}">${escapeXml(digits.split('').join(', '))}.</SpeakSentence>
          </Gather>
          <SpeakSentence locale="${locale}" gender="${gender}">${escapeXml(getPrompt('captchaTimeout', lang))}</SpeakSentence>
          <Hangup/>
        </Response>
      `)
    }

    // No CAPTCHA — greet, hold message, redirect to wait music loop
    const holdBxml = speakOrPlay('pleaseHold', lang, params.audioUrls)
    return this.bxml(`
      <Response>
        ${greetingBxml}
        ${holdBxml}
        <Redirect redirectUrl="/telephony/wait-music?lang=${lang}&amp;callSid=${params.callSid}${hp}"/>
      </Response>
    `)
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const { locale, gender } = getBandwidthVoice(lang)
    const hp = hubXmlParam(params.hubId)

    if (params.digits === params.expectedDigits) {
      return this.bxml(`
        <Response>
          <SpeakSentence locale="${locale}" gender="${gender}">${getPrompt('captchaSuccess', lang)}</SpeakSentence>
          <Redirect redirectUrl="/telephony/wait-music?lang=${lang}&amp;callSid=${params.callSid}${hp}"/>
        </Response>
      `)
    }

    // Retry: re-Gather with new digits
    if (params.remainingAttempts && params.remainingAttempts > 0 && params.newCaptchaDigits) {
      const retryDigits = params.newCaptchaDigits
      return this.bxml(`
        <Response>
          <Gather maxDigits="4" gatherUrl="/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}" firstDigitTimeout="10" repeatCount="1">
            <SpeakSentence locale="${locale}" gender="${gender}">${escapeXml(getPrompt('captchaRetry', lang))}</SpeakSentence>
            <SpeakSentence locale="${locale}" gender="${gender}">${escapeXml(retryDigits.split('').join(', '))}.</SpeakSentence>
          </Gather>
          <Redirect redirectUrl="/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}"/>
        </Response>
      `)
    }

    return this.bxml(`
      <Response>
        <SpeakSentence locale="${locale}" gender="${gender}">${getPrompt('captchaFail', lang)}</SpeakSentence>
        <Hangup/>
      </Response>
    `)
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const hp = hubXmlParam(params.hubId)
    const recordingCallbackUrl = `${params.callbackUrl}/telephony/call-recording?parentCallSid=${escapeXml(params.parentCallSid)}&amp;pubkey=${escapeXml(params.userPubkey)}${hp}`
    return this.bxml(`
      <Response>
        <StartRecording recordingAvailableUrl="${recordingCallbackUrl}"/>
        <Bridge targetCall="${escapeXml(params.parentCallSid)}"/>
      </Response>
    `)
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const hp = hubXmlParam(params.hubId)
    const voicemailBxml = speakOrPlay('voicemailPrompt', lang, params.audioUrls)
    return this.bxml(`
      <Response>
        ${voicemailBxml}
        <Record maxDuration="${params.maxRecordingSeconds ?? 120}" recordCompleteUrl="/telephony/voicemail-complete?callSid=${params.callSid}&amp;lang=${lang}${hp}" recordingAvailableUrl="${params.callbackUrl}/telephony/voicemail-recording?callSid=${params.callSid}${hp}"/>
        <Hangup/>
      </Response>
    `)
  }

  async handleWaitMusic(
    lang: string,
    audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse> {
    // After timeout in queue with no answer, hang up to trigger voicemail
    if (queueTime !== undefined && queueTime >= (queueTimeout ?? 90)) {
      return this.bxml('<Response><Hangup/></Response>')
    }

    const waitBxml = speakOrPlay('waitMessage', lang, audioUrls)
    return this.bxml(`
      <Response>
        ${waitBxml}
        <PlayAudio>https://com.twilio.music.soft-rock.s3.amazonaws.com/_ghost_-_promo_2_sample_pack.mp3</PlayAudio>
        <Redirect redirectUrl="/telephony/wait-music?lang=${lang}"/>
      </Response>
    `)
  }

  handleVoicemailComplete(lang: string): TelephonyResponse {
    const { locale, gender } = getBandwidthVoice(lang)
    return this.bxml(`
      <Response>
        <SpeakSentence locale="${locale}" gender="${gender}">${getVoicemailThanks(lang)}</SpeakSentence>
        <Hangup/>
      </Response>
    `)
  }

  handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse {
    const unavailableBxml = speakOrPlay('unavailableMessage', lang, audioUrls)
    return this.bxml(`
      <Response>
        ${unavailableBxml}
        <Hangup/>
      </Response>
    `)
  }

  rejectCall(): TelephonyResponse {
    return this.bxml('<Response><Hangup/></Response>')
  }

  emptyResponse(): TelephonyResponse {
    return this.bxml('<Response/>')
  }

  // --- Call Control Methods ---

  async hangupCall(callSid: string): Promise<void> {
    await this.bandwidthApi(`/calls/${callSid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'completed' }),
    })
  }

  async ringUsers(params: RingUsersParams): Promise<string[]> {
    const callIds: string[] = []
    const hubParam = hubQueryParam(params.hubId)

    // Build outbound targets: one per phone number
    const outboundTargets: Array<{ pubkey: string; to: string }> = []
    for (const vol of params.users) {
      if (vol.phone) {
        outboundTargets.push({ pubkey: vol.pubkey, to: vol.phone })
      }
      // Note: browser calling for Bandwidth would use WebRTC — not implemented yet
    }

    const calls = await Promise.allSettled(
      outboundTargets.map(async (target) => {
        const res = await this.bandwidthApi('/calls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: this.phoneNumber,
            to: target.to,
            applicationId: this.applicationId,
            answerUrl: `${params.callbackUrl}/telephony/user-answer?parentCallSid=${params.callSid}&pubkey=${target.pubkey}${hubParam}`,
            disconnectUrl: `${params.callbackUrl}/telephony/call-status?parentCallSid=${params.callSid}&pubkey=${target.pubkey}${hubParam}`,
            callTimeout: 30,
            tag: JSON.stringify({
              parentCallSid: params.callSid,
              pubkey: target.pubkey,
              hubId: params.hubId,
            }),
          }),
        })

        if (res.ok) {
          const data = (await res.json()) as { callId: string }
          return data.callId
        }
        throw new Error(`Failed to call ${target.pubkey}: ${res.status}`)
      })
    )

    for (const result of calls) {
      if (result.status === 'fulfilled') {
        callIds.push(result.value)
      } else {
        log.error('Failed to ring volunteer', result.reason)
      }
    }

    if (callIds.length === 0 && outboundTargets.length > 0) {
      log.error('CRITICAL: All outbound calls failed — no volunteers are being rung', undefined, {
        targetCount: outboundTargets.length,
      })
    }

    return callIds
  }

  async cancelRinging(callSids: string[], exceptSid?: string): Promise<void> {
    const results = await Promise.allSettled(
      callSids
        .filter((sid) => sid !== exceptSid)
        .map((sid) =>
          this.bandwidthApi(`/calls/${sid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: 'completed' }),
          })
        )
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn('Failed to cancel ringing', { reason: String(result.reason) })
      }
    }
  }

  // --- Recording Methods ---

  async getCallRecording(callSid: string): Promise<ArrayBuffer | null> {
    const res = await this.bandwidthApi(`/calls/${callSid}/recordings`, { method: 'GET' })
    if (!res.ok) {
      log.error('Failed to get recordings for call', undefined, {
        callSid,
        status: res.status,
        statusText: res.statusText,
      })
      return null
    }

    const data = (await res.json()) as Array<{ recordingId: string; mediaUrl?: string }>
    if (!data.length) return null

    const recordingId = data[0].recordingId
    return this.getRecordingAudio(recordingId)
  }

  async getRecordingAudio(recordingSid: string): Promise<ArrayBuffer | null> {
    // Bandwidth recording media URL pattern
    const audioRes = await this.bandwidthApi(`/recordings/${recordingSid}/media`, { method: 'GET' })
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
    await this.bandwidthApi(`/recordings/${recordingSid}`, { method: 'DELETE' })
  }

  // --- Webhook Validation ---

  async validateWebhook(request: Request): Promise<boolean> {
    // Bandwidth webhook validation uses Basic auth on the callback URL.
    // The application is configured with a callbackAuthUsername and callbackAuthPassword.
    // We verify the Authorization header matches our configured credentials.
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Basic ')) return false

    try {
      const decoded = atob(authHeader.slice(6))
      const [username, password] = decoded.split(':')
      // Compare against configured credentials using constant-time comparison
      const expectedUser = this.apiToken
      const expectedPass = this.apiSecret

      if (!username || !password) return false
      if (username.length !== expectedUser.length || password.length !== expectedPass.length) {
        return false
      }

      const encoder = new TextEncoder()
      const aUser = encoder.encode(username)
      const bUser = encoder.encode(expectedUser)
      const aPass = encoder.encode(password)
      const bPass = encoder.encode(expectedPass)

      let result = 0
      for (let i = 0; i < aUser.length; i++) {
        result |= aUser[i] ^ bUser[i]
      }
      for (let i = 0; i < aPass.length; i++) {
        result |= aPass[i] ^ bPass[i]
      }
      return result === 0
    } catch {
      return false
    }
  }

  // --- Webhook Parsing ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const body = await request.clone().json()
    const parsed = BandwidthWebhookEventSchema.parse(body)

    return {
      callSid: parsed.callId ?? '',
      callerNumber: parsed.from ?? '',
      calledNumber: parsed.to ?? undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const body = await request.clone().json()
    const parsed = BandwidthWebhookEventSchema.parse(body)

    return {
      callSid: parsed.callId ?? '',
      callerNumber: parsed.from ?? '',
      digits: parsed.digits ?? '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const body = await request.clone().json()
    const parsed = BandwidthWebhookEventSchema.parse(body)

    return {
      digits: parsed.digits ?? '',
      callerNumber: parsed.from ?? '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const body = await request.clone().json()
    const parsed = BandwidthWebhookEventSchema.parse(body)
    const eventType = parsed.eventType

    if (eventType === 'initiate') return { status: 'initiated' }
    if (eventType === 'answer') return { status: 'answered' }
    if (eventType === 'disconnect') {
      return { status: mapBandwidthDisconnectCause(parsed.cause ?? 'unknown') }
    }

    return { status: 'failed' }
  }

  async parseQueueWaitWebhook(_request: Request): Promise<WebhookQueueWait> {
    // Bandwidth doesn't have native queues — queue time is tracked by CallRouterService
    return { queueTime: 0 }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const body = await request.clone().json()
    const parsed = BandwidthWebhookEventSchema.parse(body)
    const eventType = parsed.eventType

    if (eventType === 'transferComplete') return { result: 'bridged' }
    if (eventType === 'disconnect') {
      const cause = parsed.cause ?? ''
      if (cause === 'hangup' || cause === 'cancel') return { result: 'hangup' }
      return { result: 'error' }
    }

    return { result: 'error' }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const body = await request.clone().json()
    const parsed = BandwidthWebhookEventSchema.parse(body)

    if (parsed.eventType === 'recordingAvailable' || parsed.eventType === 'recordComplete') {
      return {
        status: 'completed',
        recordingSid: parsed.recordingId ?? undefined,
        callSid: parsed.callId ?? undefined,
      }
    }

    return { status: 'failed' }
  }

  // --- Health Methods ---

  async testConnection() {
    const { bandwidthCapabilities } = await import('./bandwidth-capabilities')
    return bandwidthCapabilities.testConnection({
      type: 'bandwidth',
      phoneNumber: this.phoneNumber,
      accountId: this.accountId,
      apiToken: this.apiToken,
      apiSecret: this.apiSecret,
      applicationId: this.applicationId,
    } as Parameters<typeof bandwidthCapabilities.testConnection>[0])
  }

  async verifyWebhookConfig(
    _phoneNumber: string,
    expectedBaseUrl: string
  ): Promise<WebhookVerificationResult> {
    const expectedVoiceUrl = `${expectedBaseUrl}/telephony/incoming`

    try {
      const res = await this.bandwidthApi(`/../applications/${this.applicationId}`, {
        method: 'GET',
      })
      if (!res.ok) {
        return {
          configured: false,
          expectedUrl: expectedVoiceUrl,
          warning: `Failed to query Bandwidth API: ${res.status} ${res.statusText}`,
        }
      }
      const data = (await res.json()) as {
        callInitiatedCallbackUrl?: string
      }
      const actualUrl = data.callInitiatedCallbackUrl ?? ''
      const configured = actualUrl.startsWith(expectedBaseUrl)

      return {
        configured,
        expectedUrl: expectedVoiceUrl,
        actualUrl: actualUrl || undefined,
        warning: configured ? undefined : 'Voice callback URL does not point to this application',
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

  private bxml(xml: string): TelephonyResponse {
    return {
      contentType: 'application/xml',
      body: xml.trim(),
    }
  }

  private getApiBaseUrl(): string {
    return `https://voice.bandwidth.com/api/v2/accounts/${this.accountId}`
  }

  private async bandwidthApi(path: string, init: RequestInit): Promise<Response> {
    const auth = btoa(`${this.apiToken}:${this.apiSecret}`)
    return fetch(`${this.getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    })
  }
}
