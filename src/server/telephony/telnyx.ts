/**
 * TelnyxAdapter — Telnyx Call Control API implementation of TelephonyAdapter.
 *
 * Uses the event-driven REST model: receives webhook events, issues API commands
 * internally, returns empty responses to the route handler. State is passed via
 * base64-encoded `client_state` JSON across webhook events.
 *
 * Unlike Twilio (TwiML XML) or Vonage (NCCO JSON), Telnyx Call Control does not
 * return instruction documents. All call flow is driven by REST API calls.
 */

import { DEFAULT_LANGUAGE, IVR_LANGUAGES } from '../../shared/languages'
import {
  type TelnyxClientState,
  TelnyxWebhookEventSchema,
  decodeTelnyxClientState,
  encodeTelnyxClientState,
} from '../../shared/schemas/external/telnyx-voice'
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
import { TelnyxCallControlClient } from './telnyx-api'

const log = createLogger('telephony.telnyx')

/**
 * Telnyx TTS voice names mapped by ISO 639-1 language code.
 * Uses AWS Polly Neural voices via Telnyx's TTS engine.
 * Provider-specific — lives here, not in shared config.
 */
const TELNYX_VOICES: Record<string, { voice: string; language: string }> = {
  en: { voice: 'AWS.Polly.Joanna-Neural', language: 'en-US' },
  es: { voice: 'AWS.Polly.Lupe-Neural', language: 'es-US' },
  zh: { voice: 'AWS.Polly.Zhiyu-Neural', language: 'cmn-CN' },
  tl: { voice: 'AWS.Polly.Joanna-Neural', language: 'en-US' }, // No Tagalog Polly voice; English fallback
  vi: { voice: 'AWS.Polly.Joanna-Neural', language: 'en-US' }, // No Vietnamese Polly voice; English fallback
  ar: { voice: 'AWS.Polly.Zeina', language: 'arb' },
  fr: { voice: 'AWS.Polly.Lea-Neural', language: 'fr-FR' },
  ht: { voice: 'AWS.Polly.Lea-Neural', language: 'fr-FR' }, // Haitian Creole → French fallback
  ko: { voice: 'AWS.Polly.Seoyeon-Neural', language: 'ko-KR' },
  ru: { voice: 'AWS.Polly.Tatyana', language: 'ru-RU' },
  hi: { voice: 'AWS.Polly.Kajal-Neural', language: 'hi-IN' },
  pt: { voice: 'AWS.Polly.Camila-Neural', language: 'pt-BR' },
  de: { voice: 'AWS.Polly.Vicki-Neural', language: 'de-DE' },
}

function getTelnyxVoice(lang: string): { voice: string; language: string } {
  return TELNYX_VOICES[lang] ?? TELNYX_VOICES[DEFAULT_LANGUAGE]
}

/** Build hub query param suffix for callback URLs */
function hubQueryParam(hubId?: string): string {
  return hubId ? `&hub=${encodeURIComponent(hubId)}` : ''
}

/**
 * Map Telnyx hangup_cause to normalized call status.
 */
function mapHangupCauseToStatus(cause: string): WebhookCallStatus['status'] {
  const STATUS_MAP: Record<string, WebhookCallStatus['status']> = {
    normal_clearing: 'completed',
    originator_cancel: 'failed',
    timeout: 'no-answer',
    busy: 'busy',
    user_busy: 'busy',
    call_rejected: 'failed',
    no_user_response: 'no-answer',
    no_answer: 'no-answer',
    subscriber_absent: 'no-answer',
    normal_unspecified: 'completed',
    unallocated_number: 'failed',
    network_out_of_order: 'failed',
    recovery_on_timer_expire: 'no-answer',
    interworking: 'failed',
  }
  return STATUS_MAP[cause] ?? 'failed'
}

/**
 * TelnyxAdapter — Telnyx Call Control API implementation.
 *
 * All IVR methods issue API commands internally and return empty responses.
 * Call state is passed via base64 client_state between webhook events.
 */
export class TelnyxAdapter implements TelephonyAdapter {
  private apiKey: string
  private client: TelnyxCallControlClient
  private connectionId: string
  private phoneNumber: string

  constructor(apiKey: string, connectionId: string, phoneNumber: string) {
    this.apiKey = apiKey
    this.client = new TelnyxCallControlClient(apiKey)
    this.connectionId = connectionId
    this.phoneNumber = phoneNumber
  }

  // --- IVR Methods ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const enabled = params.enabledLanguages
    const activeLanguages = IVR_LANGUAGES.filter((code) => enabled.includes(code))

    const clientState = encodeTelnyxClientState({
      hubId: params.hubId,
      lang: DEFAULT_LANGUAGE,
      callSid: params.callSid,
      phase: 'language',
    })

    // Answer the call first
    await this.client.command(params.callSid, 'answer', {
      client_state: clientState,
    })

    // If only 1 language enabled, skip the menu
    if (activeLanguages.length <= 1) {
      const lang = activeLanguages[0] || DEFAULT_LANGUAGE
      const skipState = encodeTelnyxClientState({
        hubId: params.hubId,
        lang,
        callSid: params.callSid,
      })
      // Speak a brief pause then set client_state with the chosen language
      await this.client.command(params.callSid, 'speak', {
        payload: ' ',
        voice: getTelnyxVoice(lang).voice,
        language: getTelnyxVoice(lang).language,
        client_state: skipState,
      })
      return this.emptyTelephonyResponse()
    }

    // Build the language menu prompt text
    const promptParts: string[] = []
    for (const langCode of IVR_LANGUAGES) {
      if (!enabled.includes(langCode)) continue
      const prompt = IVR_PROMPTS[langCode]
      if (prompt) promptParts.push(prompt)
    }

    const menuText = promptParts.join(' ')
    const { voice, language } = getTelnyxVoice(DEFAULT_LANGUAGE)

    await this.client.command(params.callSid, 'gather_using_speak', {
      payload: menuText,
      voice,
      language,
      minimum_digits: 1,
      maximum_digits: 1,
      timeout_millis: 8000,
      client_state: clientState,
    })

    return this.emptyTelephonyResponse()
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const { voice, language } = getTelnyxVoice(lang)
    const greetingText = getPrompt('greeting', lang).replace('{name}', params.hotlineName)

    if (params.rateLimited) {
      const rateLimitText = getPrompt('rateLimited', lang)
      await this.client.command(params.callSid, 'speak', {
        payload: `${greetingText} ${rateLimitText}`,
        voice,
        language,
      })
      // After speak completes, hangup
      await this.client.command(params.callSid, 'hangup', {})
      return this.emptyTelephonyResponse()
    }

    if (params.voiceCaptchaEnabled && params.captchaDigits) {
      const digits = params.captchaDigits
      const captchaText = getPrompt('captchaPrompt', lang)
      const digitsSpoken = digits.split('').join(', ')
      const captchaState = encodeTelnyxClientState({
        hubId: params.hubId,
        lang,
        callSid: params.callSid,
        phase: 'captcha',
      })

      await this.client.command(params.callSid, 'speak', {
        payload: greetingText,
        voice,
        language,
      })

      await this.client.command(params.callSid, 'gather_using_speak', {
        payload: `${captchaText} ${digitsSpoken}.`,
        voice,
        language,
        minimum_digits: 1,
        maximum_digits: 4,
        timeout_millis: 10000,
        client_state: captchaState,
      })

      return this.emptyTelephonyResponse()
    }

    // No CAPTCHA — greet, play hold message, start hold music
    const holdText = getPrompt('pleaseHold', lang)
    const queueState = encodeTelnyxClientState({
      hubId: params.hubId,
      lang,
      callSid: params.callSid,
      phase: 'queue',
    })

    await this.client.command(params.callSid, 'speak', {
      payload: `${greetingText} ${holdText}`,
      voice,
      language,
      client_state: queueState,
    })

    // Play hold music — the actual music playback will be triggered after speak ends
    await this.client.command(params.callSid, 'playback_start', {
      audio_url:
        'https://com.twilio.music.soft-rock.s3.amazonaws.com/_ghost_-_promo_2_sample_pack.mp3',
      loop: 'infinity',
      client_state: queueState,
    })

    return this.emptyTelephonyResponse()
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const { voice, language } = getTelnyxVoice(lang)

    if (params.digits === params.expectedDigits) {
      const successText = getPrompt('captchaSuccess', lang)
      const queueState = encodeTelnyxClientState({
        hubId: params.hubId,
        lang,
        callSid: params.callSid,
        phase: 'queue',
      })

      await this.client.command(params.callSid, 'speak', {
        payload: successText,
        voice,
        language,
        client_state: queueState,
      })

      await this.client.command(params.callSid, 'playback_start', {
        audio_url:
          'https://com.twilio.music.soft-rock.s3.amazonaws.com/_ghost_-_promo_2_sample_pack.mp3',
        loop: 'infinity',
        client_state: queueState,
      })

      return this.emptyTelephonyResponse()
    }

    // Retry with new digits
    if (params.remainingAttempts && params.remainingAttempts > 0 && params.newCaptchaDigits) {
      const retryText = getPrompt('captchaRetry', lang)
      const retryDigits = params.newCaptchaDigits.split('').join(', ')
      const captchaState = encodeTelnyxClientState({
        hubId: params.hubId,
        lang,
        callSid: params.callSid,
        phase: 'captcha',
      })

      await this.client.command(params.callSid, 'gather_using_speak', {
        payload: `${retryText} ${retryDigits}.`,
        voice,
        language,
        minimum_digits: 1,
        maximum_digits: 4,
        timeout_millis: 10000,
        client_state: captchaState,
      })

      return this.emptyTelephonyResponse()
    }

    // No retries left — reject
    const failText = getPrompt('captchaFail', lang)
    await this.client.command(params.callSid, 'speak', {
      payload: failText,
      voice,
      language,
    })
    await this.client.command(params.callSid, 'hangup', {})

    return this.emptyTelephonyResponse()
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const hubParam = hubQueryParam(params.hubId)
    const recordingCallbackUrl = `${params.callbackUrl}/telephony/call-recording?parentCallSid=${params.parentCallSid}&pubkey=${params.userPubkey}${hubParam}`

    // Bridge the caller and user
    await this.client.command(params.parentCallSid, 'bridge', {
      call_control_id: params.parentCallSid,
    })

    // Start recording
    await this.client.command(params.parentCallSid, 'record_start', {
      format: 'mp3',
      channels: 'single',
      client_state: encodeTelnyxClientState({
        lang: 'en',
        callSid: params.parentCallSid,
        hubId: params.hubId,
      }),
    })

    return this.emptyTelephonyResponse()
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const { voice, language } = getTelnyxVoice(lang)
    const voicemailText = getPrompt('voicemailPrompt', lang)

    const vmState = encodeTelnyxClientState({
      hubId: params.hubId,
      lang,
      callSid: params.callSid,
    })

    // Speak voicemail prompt
    await this.client.command(params.callSid, 'speak', {
      payload: voicemailText,
      voice,
      language,
      client_state: vmState,
    })

    // Start recording after prompt
    await this.client.command(params.callSid, 'record_start', {
      format: 'mp3',
      play_beep: true,
      max_length_secs: params.maxRecordingSeconds ?? 120,
      client_state: vmState,
    })

    return this.emptyTelephonyResponse()
  }

  async handleWaitMusic(
    lang: string,
    audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse> {
    // After timeout in queue with no answer, signal to leave queue → triggers voicemail
    if (queueTime !== undefined && queueTime >= (queueTimeout ?? 90)) {
      return {
        contentType: 'application/json',
        body: JSON.stringify({ leave: true }),
      }
    }

    // Return empty — hold music is already playing via playback_start with loop: infinity
    return this.emptyTelephonyResponse()
  }

  handleVoicemailComplete(lang: string): TelephonyResponse {
    // For Telnyx, the speak + hangup commands are issued asynchronously
    // We fire-and-forget the commands and return empty response
    const { voice, language } = getTelnyxVoice(lang)
    const thanksText = getVoicemailThanks(lang)

    // Note: These are fire-and-forget — we can't await in a sync method
    // The route handler should call this after recording.saved webhook
    // and the callSid should be provided via the webhook context
    void Promise.resolve() // placeholder — actual commands issued by route handler
    return this.emptyTelephonyResponse()
  }

  handleUnavailable(lang: string, _audioUrls?: AudioUrlMap): TelephonyResponse {
    // Same pattern as voicemailComplete — async commands issued by route handler
    return this.emptyTelephonyResponse()
  }

  rejectCall(): TelephonyResponse {
    return this.emptyTelephonyResponse()
  }

  emptyResponse(): TelephonyResponse {
    return this.emptyTelephonyResponse()
  }

  // --- Call Control Methods ---

  async hangupCall(callSid: string): Promise<void> {
    await this.client.command(callSid, 'hangup', {})
  }

  async ringUsers(params: RingUsersParams): Promise<string[]> {
    const callControlIds: string[] = []
    const hubParam = hubQueryParam(params.hubId)

    // Build outbound targets
    const outboundTargets: Array<{ pubkey: string; to: string }> = []
    for (const vol of params.users) {
      if (vol.phone) {
        outboundTargets.push({ pubkey: vol.pubkey, to: vol.phone })
      }
      // Note: browser calling for Telnyx would use SIP/WebRTC — not implemented yet
    }

    const calls = await Promise.allSettled(
      outboundTargets.map(async (target) => {
        const clientState = encodeTelnyxClientState({
          lang: 'en',
          callSid: params.callSid,
          hubId: params.hubId,
        })

        const result = await this.client.createCall({
          to: target.to,
          from: this.phoneNumber,
          connection_id: this.connectionId,
          webhook_url: `${params.callbackUrl}/telephony/user-answer?parentCallSid=${params.callSid}&pubkey=${target.pubkey}${hubParam}`,
          webhook_url_method: 'POST',
          client_state: clientState,
          timeout_secs: 30,
        })

        return result.call_control_id
      })
    )

    for (const result of calls) {
      if (result.status === 'fulfilled') {
        callControlIds.push(result.value)
      } else {
        log.error('Failed to ring volunteer', result.reason)
      }
    }

    if (callControlIds.length === 0 && outboundTargets.length > 0) {
      log.error('CRITICAL: All outbound calls failed — no volunteers are being rung', undefined, {
        targetCount: outboundTargets.length,
      })
    }

    return callControlIds
  }

  async cancelRinging(callSids: string[], exceptSid?: string): Promise<void> {
    const results = await Promise.allSettled(
      callSids
        .filter((sid) => sid !== exceptSid)
        .map((sid) => this.client.command(sid, 'hangup', {}))
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn('Failed to cancel ringing', { reason: String(result.reason) })
      }
    }
  }

  // --- Recording Methods ---

  async getCallRecording(_callSid: string): Promise<ArrayBuffer | null> {
    // Telnyx provides recording URLs via call.recording.saved webhook.
    // The route handler should cache the recording URL and pass it here.
    // For now, return null — actual implementation requires recording URL caching.
    return null
  }

  async getRecordingAudio(recordingSid: string): Promise<ArrayBuffer | null> {
    try {
      return await this.client.getRecording(recordingSid)
    } catch (err) {
      log.error('Failed to get recording audio', err, { recordingSid })
      return null
    }
  }

  async deleteRecording(recordingSid: string): Promise<void> {
    await this.client.deleteRecording(recordingSid)
  }

  // --- Webhook Validation ---

  async validateWebhook(request: Request): Promise<boolean> {
    const signature = request.headers.get('telnyx-signature-ed25519')
    const timestamp = request.headers.get('telnyx-timestamp')

    if (!signature || !timestamp) return false

    // Reject if timestamp is > 5 minutes old (replay attack prevention)
    const ts = Number.parseInt(timestamp, 10)
    if (Number.isNaN(ts)) return false
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - ts) > 300) return false

    try {
      const rawBody = await request.clone().text()
      return await this.client.verifyWebhookSignature(signature, timestamp, rawBody)
    } catch {
      return false
    }
  }

  // --- Webhook Parsing ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const body = await request.clone().json()
    const parsed = TelnyxWebhookEventSchema.parse(body)
    const payload = parsed.data.payload

    return {
      callSid: payload.call_control_id ?? '',
      callerNumber: payload.from ?? '',
      calledNumber: payload.to ?? undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const body = await request.clone().json()
    const parsed = TelnyxWebhookEventSchema.parse(body)
    const payload = parsed.data.payload

    // Decode client_state to get caller info
    const clientState = payload.client_state ? decodeTelnyxClientState(payload.client_state) : null

    return {
      callSid: payload.call_control_id ?? clientState?.callSid ?? '',
      callerNumber: payload.from ?? '',
      digits: payload.digits ?? '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const body = await request.clone().json()
    const parsed = TelnyxWebhookEventSchema.parse(body)
    const payload = parsed.data.payload

    return {
      digits: payload.digits ?? '',
      callerNumber: payload.from ?? '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const body = await request.clone().json()
    const parsed = TelnyxWebhookEventSchema.parse(body)
    const payload = parsed.data.payload
    const eventType = parsed.data.event_type

    if (eventType === 'call.initiated') {
      return { status: 'initiated' }
    }
    if (eventType === 'call.answered') {
      return { status: 'answered' }
    }
    if (eventType === 'call.hangup') {
      return { status: mapHangupCauseToStatus(payload.hangup_cause ?? 'normal_clearing') }
    }

    return { status: 'failed' }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const body = await request.clone().json()
    const parsed = TelnyxWebhookEventSchema.parse(body)
    const payload = parsed.data.payload

    // For Telnyx, queue time is tracked via client_state or external timer
    // Extract from client_state if available, otherwise return 0
    const clientState = payload.client_state ? decodeTelnyxClientState(payload.client_state) : null

    return {
      queueTime: 0, // Queue time tracking is handled by CallRouterService
    }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const body = await request.clone().json()
    const parsed = TelnyxWebhookEventSchema.parse(body)
    const eventType = parsed.data.event_type
    const payload = parsed.data.payload

    if (eventType === 'call.bridged') {
      return { result: 'bridged' }
    }
    if (eventType === 'call.hangup') {
      const cause = payload.hangup_cause ?? ''
      if (cause === 'normal_clearing') return { result: 'hangup' }
      if (cause === 'originator_cancel') return { result: 'hangup' }
      return { result: 'error' }
    }

    return { result: 'error' }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const body = await request.clone().json()
    const parsed = TelnyxWebhookEventSchema.parse(body)
    const payload = parsed.data.payload

    const recordingUrls = payload.recording_urls
    if (recordingUrls?.mp3) {
      return {
        status: 'completed',
        recordingSid: recordingUrls.mp3,
        callSid: payload.call_control_id ?? undefined,
      }
    }

    return { status: 'failed' }
  }

  // --- Health Methods ---

  async testConnection() {
    const { telnyxCapabilities } = await import('./telnyx-capabilities')
    return telnyxCapabilities.testConnection({
      type: 'telnyx',
      phoneNumber: this.phoneNumber,
      apiKey: this.apiKey,
      texmlAppId: this.connectionId || undefined,
    } as Parameters<typeof telnyxCapabilities.testConnection>[0])
  }

  async verifyWebhookConfig(
    _phoneNumber: string,
    expectedBaseUrl: string
  ): Promise<WebhookVerificationResult> {
    const expectedVoiceUrl = `${expectedBaseUrl}/telephony/incoming`

    if (!this.connectionId) {
      return {
        configured: false,
        expectedUrl: expectedVoiceUrl,
        warning: 'Telnyx connection_id (Call Control App) not configured',
      }
    }

    try {
      const app = await this.client.getCallControlApp(this.connectionId)
      if (!app) {
        return {
          configured: false,
          expectedUrl: expectedVoiceUrl,
          warning: `Call Control App ${this.connectionId} not found or API error`,
        }
      }

      const actualUrl = app.webhook_event_url ?? ''
      const configured = actualUrl.startsWith(expectedBaseUrl)

      return {
        configured,
        expectedUrl: expectedVoiceUrl,
        actualUrl: actualUrl || undefined,
        warning: configured ? undefined : 'Webhook event URL does not point to this application',
      }
    } catch (err) {
      return {
        configured: false,
        expectedUrl: expectedVoiceUrl,
        warning: `Telnyx API error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // --- Helpers ---

  private emptyTelephonyResponse(): TelephonyResponse {
    return {
      contentType: 'application/json',
      body: '{}',
    }
  }
}
