import { DEFAULT_LANGUAGE, IVR_LANGUAGES } from '../../shared/languages'
import { getPrompt, IVR_PROMPTS } from '../../shared/voice-prompts'
import type {
  AudioUrlMap,
  CallAnsweredParams,
  CaptchaResponseParams,
  IncomingCallParams,
  LanguageMenuParams,
  TelephonyResponse,
  VoicemailParams,
  WebhookCallInfo,
  WebhookCallStatus,
  WebhookDigits,
  WebhookQueueResult,
  WebhookQueueWait,
  WebhookRecordingStatus,
} from './adapter'
import { SipBridgeAdapter } from './sip-bridge-adapter'

/**
 * FreeSwitchAdapter — generates mod_httapi XML responses for FreeSWITCH.
 *
 * FreeSWITCH's mod_httapi module POSTs channel variables to an HTTP endpoint
 * and expects XML documents back that control call flow. This adapter generates
 * those XML documents.
 *
 * Webhook parsing uses JSON from the sip-bridge sidecar (same protocol as
 * AsteriskAdapter). The bridge translates FreeSWITCH ESL events into
 * standardized JSON webhooks.
 *
 * Extends SipBridgeAdapter for shared bridge communication logic
 * (REST calls, HMAC validation, recording fetch/delete).
 */
export class FreeSwitchAdapter extends SipBridgeAdapter {
  constructor(
    phoneNumber: string,
    bridgeCallbackUrl: string,
    bridgeSecret: string,
    protected callbackBaseUrl: string
  ) {
    super(phoneNumber, bridgeCallbackUrl, bridgeSecret)
  }

  // --- mod_httapi XML helpers ---

  /**
   * Wrap work elements in a mod_httapi document.
   * @param work - Inner XML content for the <work> element
   * @param params - Optional channel variables to set via <params>
   */
  private doc(work: string, params?: Record<string, string>): string {
    let paramsXml = ''
    if (params && Object.keys(params).length > 0) {
      const entries = Object.entries(params)
        .map(([k, v]) => `    <param name="${escapeXml(k)}" value="${escapeXml(v)}"/>`)
        .join('\n')
      paramsXml = `\n  <params>\n${entries}\n  </params>`
    }
    return `<document type="xml/freeswitch-httapi">${paramsXml}\n  <work>${work}\n  </work>\n</document>`
  }

  /**
   * Generate a <speak> element using mod_flite TTS.
   * mod_flite only supports English voices — all languages fall back to 'slt'.
   */
  private speak(text: string, _lang: string): string {
    const voice = getFliteVoice(_lang)
    return `\n    <speak voice="${voice}">${escapeXml(text)}</speak>`
  }

  /**
   * Generate a <playback> element for audio URL or fall back to <speak> TTS.
   */
  private speakOrPlay(
    promptKey: string,
    lang: string,
    audioUrls?: AudioUrlMap,
    text?: string
  ): string {
    const audioUrl = audioUrls?.[`${promptKey}:${lang}`]
    if (audioUrl) return `\n    <playback file="${escapeXml(audioUrl)}"/>`
    const content = text ?? getPrompt(promptKey, lang)
    return this.speak(content, lang)
  }

  private buildCallbackUrl(path: string, hubId?: string): string {
    const base = `${this.callbackBaseUrl}${path}`
    return hubId ? `${base}${base.includes('?') ? '&' : '?'}hub=${encodeURIComponent(hubId)}` : base
  }

  private xmlResponse(xml: string): TelephonyResponse {
    return {
      contentType: 'text/xml',
      body: xml,
    }
  }

  // --- IVR / Call flow ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const { enabledLanguages, hubId } = params
    const activeLanguages = IVR_LANGUAGES.filter((code) => enabledLanguages.includes(code))

    if (activeLanguages.length <= 1) {
      const lang = activeLanguages[0] || DEFAULT_LANGUAGE
      // Auto-select: set variables and continue to incoming call handler
      const setVars = [
        `\n    <execute application="set" data="caller_lang=${escapeXml(lang)}"/>`,
        `\n    <execute application="set" data="call_phase=language_selected"/>`,
      ].join('')
      const callbackUrl = this.buildCallbackUrl('/telephony/incoming', hubId)
      const continueXml = `\n    <execute application="set" data="httapi_url=${escapeXml(callbackUrl)}"/>`
      return this.xmlResponse(
        this.doc(setVars + continueXml, {
          caller_lang: lang,
          call_phase: 'language_selected',
        })
      )
    }

    // Build speak prompts for each language option
    let promptXml = ''
    for (const langCode of IVR_LANGUAGES) {
      if (!enabledLanguages.includes(langCode)) continue
      const prompt = IVR_PROMPTS[langCode]
      if (!prompt) continue
      promptXml += this.speak(prompt, langCode)
    }

    // Gather single digit for language selection
    const callbackUrl = this.buildCallbackUrl('/telephony/language-selected', hubId)
    const bindXml = `\n    <bind strip="#">~\\d ${escapeXml(callbackUrl)}</bind>`
    const timeoutXml = '\n    <pause milliseconds="8000"/>'

    return this.xmlResponse(this.doc(promptXml + bindXml + timeoutXml))
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const {
      rateLimited,
      voiceCaptchaEnabled,
      callerLanguage: lang,
      callSid,
      audioUrls,
      hubId,
    } = params

    if (rateLimited) {
      const speakXml = this.speakOrPlay('rateLimited', lang, audioUrls)
      const hangupXml = '\n    <hangup/>'
      return this.xmlResponse(this.doc(speakXml + hangupXml))
    }

    if (voiceCaptchaEnabled && params.captchaDigits) {
      const digits = params.captchaDigits
      const speakXml =
        this.speakOrPlay('captchaPrompt', lang, audioUrls) +
        this.speak(digits.split('').join(' '), lang)
      const callbackUrl = this.buildCallbackUrl('/telephony/captcha-response', hubId)
      const bindXml = `\n    <bind strip="#">~\\d{4} ${escapeXml(callbackUrl)}</bind>`
      const timeoutXml = '\n    <pause milliseconds="10000"/>'
      return this.xmlResponse(
        this.doc(speakXml + bindXml + timeoutXml, {
          call_phase: 'captcha',
        })
      )
    }

    // Normal flow: speak connecting message and park the channel
    const speakXml = this.speakOrPlay('connecting', lang, audioUrls)
    const parkXml = `\n    <execute application="park"/>`
    return this.xmlResponse(
      this.doc(speakXml + parkXml, {
        call_phase: 'queue',
        queue_name: callSid,
      })
    )
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const { digits, expectedDigits, callerLanguage: lang, callSid, hubId } = params

    if (digits === expectedDigits) {
      const speakXml = this.speak(getPrompt('captchaSuccess', lang), lang)
      const parkXml = `\n    <execute application="park"/>`
      return this.xmlResponse(
        this.doc(speakXml + parkXml, {
          call_phase: 'queue',
          queue_name: callSid,
        })
      )
    }

    // Retry with new digits
    if (params.remainingAttempts && params.remainingAttempts > 0 && params.newCaptchaDigits) {
      const retryPrompt = this.speak(getPrompt('captchaRetry', lang), lang)
      const digitsPrompt = this.speak(params.newCaptchaDigits.split('').join(' '), lang)
      const callbackUrl = this.buildCallbackUrl('/telephony/captcha-response', hubId)
      const bindXml = `\n    <bind strip="#">~\\d{4} ${escapeXml(callbackUrl)}</bind>`
      const timeoutXml = '\n    <pause milliseconds="10000"/>'
      return this.xmlResponse(this.doc(retryPrompt + digitsPrompt + bindXml + timeoutXml))
    }

    // Failed
    const failXml = this.speak(getPrompt('captchaFailed', lang), lang)
    const hangupXml = '\n    <hangup/>'
    return this.xmlResponse(this.doc(failXml + hangupXml))
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const { parentCallSid } = params
    // Bridge this volunteer's channel to the parked caller
    const bridgeXml = `\n    <execute application="intercept" data="${escapeXml(parentCallSid)}"/>`
    return this.xmlResponse(this.doc(bridgeXml))
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const { callerLanguage: lang, audioUrls, maxRecordingSeconds, hubId } = params
    const maxSeconds = maxRecordingSeconds || 120
    const speakXml = this.speakOrPlay('voicemailPrompt', lang, audioUrls)
    const callbackUrl = this.buildCallbackUrl('/telephony/voicemail-recording', hubId)
    const recordXml = `\n    <record name="voicemail_${Date.now()}.wav" error-file="silence_stream://250" beep-file="tone_stream://%(250,0,800)" limit="${maxSeconds}" action="${escapeXml(callbackUrl)}"/>`
    return this.xmlResponse(this.doc(speakXml + recordXml))
  }

  async handleWaitMusic(
    lang: string,
    audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse> {
    const timeout = queueTimeout || 90
    if (queueTime && queueTime >= timeout) {
      // Queue timeout exceeded — transfer to voicemail
      const leaveXml = `\n    <execute application="transfer" data="voicemail"/>`
      return this.xmlResponse(this.doc(leaveXml))
    }
    const musicXml = this.speakOrPlay('holdMusic', lang, audioUrls)
    return this.xmlResponse(this.doc(musicXml))
  }

  rejectCall(): TelephonyResponse {
    const hangupXml = '\n    <hangup cause="CALL_REJECTED"/>'
    return this.xmlResponse(this.doc(hangupXml))
  }

  handleVoicemailComplete(lang: string): TelephonyResponse {
    const speakXml = this.speak(getPrompt('voicemailThankYou', lang), lang)
    const hangupXml = '\n    <hangup/>'
    return this.xmlResponse(this.doc(speakXml + hangupXml))
  }

  handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse {
    const speakXml = this.speakOrPlay('unavailableMessage', lang, audioUrls)
    const hangupXml = '\n    <hangup/>'
    return this.xmlResponse(this.doc(speakXml + hangupXml))
  }

  emptyResponse(): TelephonyResponse {
    return this.xmlResponse(this.doc(''))
  }

  // --- Webhook parsing (JSON payloads from sip-bridge, same as Asterisk) ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const data = (await request.json()) as BridgeWebhookPayload
    return {
      callSid: data.channelId || data.callSid || '',
      callerNumber: data.callerNumber || data.from || '',
      calledNumber: data.calledNumber || data.to || undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const data = (await request.json()) as BridgeWebhookPayload
    return {
      callSid: data.channelId || data.callSid || '',
      callerNumber: data.callerNumber || data.from || '',
      digits: data.digits || '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const data = (await request.json()) as BridgeWebhookPayload
    return {
      digits: data.digits || '',
      callerNumber: data.callerNumber || data.from || '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const data = (await request.json()) as BridgeWebhookPayload
    return { status: mapBridgeStatus(data.state || data.status || '') }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const data = (await request.json()) as BridgeWebhookPayload
    return { queueTime: data.queueTime || 0 }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const data = (await request.json()) as BridgeWebhookPayload
    return { result: mapQueueResult(data.result || data.reason || '') }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const data = (await request.json()) as BridgeWebhookPayload
    return {
      status: data.recordingStatus === 'done' ? 'completed' : 'failed',
      recordingSid: data.recordingName || data.recordingSid,
      callSid: data.channelId || data.callSid,
    }
  }

  override async testConnection() {
    const { freeswitchCapabilities } = await import('./freeswitch-capabilities')
    return freeswitchCapabilities.testConnection({
      type: 'freeswitch',
      phoneNumber: this.phoneNumber,
      eslUrl: '',
      eslPassword: '',
      bridgeCallbackUrl: this.bridgeCallbackUrl,
    } as Parameters<typeof freeswitchCapabilities.testConnection>[0])
  }
}

// --- Bridge webhook payload (same format as Asterisk bridge) ---

interface BridgeWebhookPayload {
  event?: string
  channelId?: string
  callSid?: string
  callerNumber?: string
  calledNumber?: string
  from?: string
  to?: string
  digits?: string
  state?: string
  status?: string
  queueTime?: number
  result?: string
  reason?: string
  recordingStatus?: string
  recordingName?: string
  recordingSid?: string
}

// --- Helpers ---

/**
 * Get mod_flite voice name. mod_flite only has English voices (slt, awb, kal, rms).
 * 'slt' is the default female voice and most natural-sounding.
 */
export function getFliteVoice(_lang: string): string {
  return 'slt'
}

/**
 * Escape special XML characters to prevent injection.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function mapBridgeStatus(state: string): WebhookCallStatus['status'] {
  switch (state.toLowerCase()) {
    case 'ring':
    case 'ringing':
      return 'ringing'
    case 'up':
    case 'answered':
      return 'answered'
    case 'down':
    case 'hangup':
    case 'completed':
      return 'completed'
    case 'busy':
      return 'busy'
    case 'noanswer':
    case 'no-answer':
      return 'no-answer'
    case 'congestion':
    case 'failed':
      return 'failed'
    default:
      return 'initiated'
  }
}

function mapQueueResult(result: string): WebhookQueueResult['result'] {
  switch (result.toLowerCase()) {
    case 'bridged':
    case 'answered':
      return 'bridged'
    case 'leave':
    case 'timeout':
      return 'leave'
    case 'full':
    case 'queue-full':
      return 'queue-full'
    case 'hangup':
    case 'caller-hangup':
      return 'hangup'
    default:
      return 'error'
  }
}
