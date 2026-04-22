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
 * AsteriskAdapter — communicates with an ARI bridge service that runs
 * alongside Asterisk. The bridge translates ARI events into HTTP webhooks
 * (JSON format) and receives JSON commands back from this adapter.
 *
 * Unlike cloud providers, Asterisk doesn't have a hosted API — the bridge
 * service handles the ARI WebSocket connection and translates between
 * ARI and our webhook format.
 *
 * Extends SipBridgeAdapter for shared bridge communication logic.
 */
export class AsteriskAdapter extends SipBridgeAdapter {
  constructor(
    private ariUrl: string,
    private ariUsername: string,
    private ariPassword: string,
    phoneNumber: string,
    bridgeCallbackUrl: string,
    bridgeSecret: string
  ) {
    super(phoneNumber, bridgeCallbackUrl, bridgeSecret)
  }

  // --- JSON command helpers ---

  private json(commands: AriCommand[]): TelephonyResponse {
    return {
      contentType: 'application/json',
      body: JSON.stringify({ commands }),
    }
  }

  private speak(text: string, lang: string): AriCommand {
    return { action: 'speak', text, language: getAsteriskLang(lang) }
  }

  private play(url: string): AriCommand {
    return { action: 'play', url }
  }

  private speakOrPlay(
    promptKey: string,
    lang: string,
    audioUrls?: AudioUrlMap,
    text?: string
  ): AriCommand {
    const audioUrl = audioUrls?.[`${promptKey}:${lang}`]
    if (audioUrl) return this.play(audioUrl)
    const content = text ?? getPrompt(promptKey, lang)
    return this.speak(content, lang)
  }

  // --- IVR / Call flow ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const { enabledLanguages } = params
    const activeLanguages = IVR_LANGUAGES.filter((code) => enabledLanguages.includes(code))

    if (activeLanguages.length <= 1) {
      const lang = activeLanguages[0] || DEFAULT_LANGUAGE
      return this.json([
        this.speak(' ', lang),
        {
          action: 'gather',
          numDigits: 0,
          timeout: 0,
          callbackEvent: 'language_selected',
          metadata: { auto: '1', forceLang: lang },
        },
      ])
    }

    // Build speak commands for each enabled language
    const commands: AriCommand[] = []
    for (const langCode of IVR_LANGUAGES) {
      if (!enabledLanguages.includes(langCode)) continue
      const prompt = IVR_PROMPTS[langCode]
      if (!prompt) continue
      commands.push(this.speak(prompt, langCode))
    }

    // Gather DTMF digits
    commands.push({
      action: 'gather',
      numDigits: 1,
      timeout: 8,
      callbackEvent: 'language_selected',
    })

    return this.json(commands)
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const { rateLimited, voiceCaptchaEnabled, callerLanguage: lang, callSid, audioUrls } = params

    if (rateLimited) {
      return this.json([this.speakOrPlay('rateLimited', lang, audioUrls), { action: 'hangup' }])
    }

    if (voiceCaptchaEnabled && params.captchaDigits) {
      const digits = params.captchaDigits
      return this.json([
        this.speakOrPlay(
          'captcha',
          lang,
          audioUrls,
          getPrompt('captcha', lang).replace('{digits}', digits.split('').join(' '))
        ),
        {
          action: 'gather',
          numDigits: 4,
          timeout: 10,
          callbackEvent: 'captcha_response',
          metadata: { callSid },
        },
      ])
    }

    // Enqueue caller
    return this.json([
      this.speakOrPlay('connecting', lang, audioUrls),
      {
        action: 'queue',
        queueName: callSid,
        waitMusicEvent: 'wait_music',
        exitEvent: 'queue_exit',
      },
    ])
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const { digits, expectedDigits, callerLanguage: lang, callSid } = params

    if (digits === expectedDigits) {
      return this.json([
        this.speak(getPrompt('captchaSuccess', lang), lang),
        {
          action: 'queue',
          queueName: callSid,
          waitMusicEvent: 'wait_music',
          exitEvent: 'queue_exit',
        },
      ])
    }

    // Retry: re-Gather with new digits
    if (params.remainingAttempts && params.remainingAttempts > 0 && params.newCaptchaDigits) {
      return this.json([
        this.speak(getPrompt('captchaRetry', lang), lang),
        this.speak(params.newCaptchaDigits.split('').join(' '), lang),
        {
          action: 'gather',
          numDigits: 4,
          timeout: 10,
          callbackEvent: 'captcha_response',
          metadata: { callSid },
        },
      ])
    }

    return this.json([this.speak(getPrompt('captchaFailed', lang), lang), { action: 'hangup' }])
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const { parentCallSid } = params
    return this.json([
      {
        action: 'bridge',
        queueName: parentCallSid,
        record: true,
      },
    ])
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const { callerLanguage: lang, audioUrls, maxRecordingSeconds } = params
    return this.json([
      this.speakOrPlay('voicemailPrompt', lang, audioUrls),
      {
        action: 'record',
        maxDuration: maxRecordingSeconds || 120,
        finishOnKey: '#',
        callbackEvent: 'recording_complete',
      },
    ])
  }

  async handleWaitMusic(
    lang: string,
    audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse> {
    const timeout = queueTimeout || 90
    if (queueTime && queueTime >= timeout) {
      return this.json([{ action: 'leave_queue' }])
    }
    return this.json([this.speakOrPlay('holdMusic', lang, audioUrls)])
  }

  rejectCall(): TelephonyResponse {
    return this.json([{ action: 'hangup', reason: 'rejected' }])
  }

  handleVoicemailComplete(lang: string): TelephonyResponse {
    return this.json([this.speak(getPrompt('voicemailThankYou', lang), lang), { action: 'hangup' }])
  }

  handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse {
    return this.json([
      this.speakOrPlay('unavailableMessage', lang, audioUrls),
      { action: 'hangup' },
    ])
  }

  emptyResponse(): TelephonyResponse {
    return { contentType: 'application/json', body: JSON.stringify({ commands: [] }) }
  }

  // --- Webhook parsing (JSON payloads from ARI bridge) ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const data = (await request.json()) as AriWebhookPayload
    return {
      callSid: data.channelId || data.callSid || '',
      callerNumber: data.callerNumber || data.from || '',
      calledNumber: data.calledNumber || data.to || undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const data = (await request.json()) as AriWebhookPayload
    return {
      callSid: data.channelId || data.callSid || '',
      callerNumber: data.callerNumber || data.from || '',
      digits: data.digits || '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const data = (await request.json()) as AriWebhookPayload
    return {
      digits: data.digits || '',
      callerNumber: data.callerNumber || data.from || '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const data = (await request.json()) as AriWebhookPayload
    return { status: mapAriStatus(data.state || data.status || '') }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const data = (await request.json()) as AriWebhookPayload
    return { queueTime: data.queueTime || 0 }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const data = (await request.json()) as AriWebhookPayload
    return { result: mapQueueResult(data.result || data.reason || '') }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const data = (await request.json()) as AriWebhookPayload
    return {
      status: data.recordingStatus === 'done' ? 'completed' : 'failed',
      recordingSid: data.recordingName || data.recordingSid,
      callSid: data.channelId || data.callSid,
    }
  }

  override async testConnection() {
    const { asteriskCapabilities } = await import('./asterisk-capabilities')
    return asteriskCapabilities.testConnection({
      type: 'asterisk',
      phoneNumber: this.phoneNumber,
      ariUrl: this.ariUrl,
      ariUsername: this.ariUsername,
      ariPassword: this.ariPassword,
      bridgeCallbackUrl: this.bridgeCallbackUrl,
    } as Parameters<typeof asteriskCapabilities.testConnection>[0])
  }
}

// --- ARI command types ---

interface AriCommandBase {
  action: string
}

interface AriSpeakCommand extends AriCommandBase {
  action: 'speak'
  text: string
  language: string
}

interface AriPlayCommand extends AriCommandBase {
  action: 'play'
  url: string
}

interface AriGatherCommand extends AriCommandBase {
  action: 'gather'
  numDigits: number
  timeout: number
  callbackEvent: string
  metadata?: Record<string, string>
}

interface AriQueueCommand extends AriCommandBase {
  action: 'queue'
  queueName: string
  waitMusicEvent: string
  exitEvent: string
}

interface AriBridgeCommand extends AriCommandBase {
  action: 'bridge'
  queueName: string
  record: boolean
}

interface AriRecordCommand extends AriCommandBase {
  action: 'record'
  maxDuration: number
  finishOnKey: string
  callbackEvent: string
}

interface AriHangupCommand extends AriCommandBase {
  action: 'hangup'
  reason?: string
}

interface AriLeaveQueueCommand extends AriCommandBase {
  action: 'leave_queue'
}

type AriCommand =
  | AriSpeakCommand
  | AriPlayCommand
  | AriGatherCommand
  | AriQueueCommand
  | AriBridgeCommand
  | AriRecordCommand
  | AriHangupCommand
  | AriLeaveQueueCommand

// --- ARI webhook payload from bridge ---

interface AriWebhookPayload {
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

function getAsteriskLang(lang: string): string {
  const map: Record<string, string> = {
    en: 'en-US',
    es: 'es',
    zh: 'zh',
    tl: 'en-US', // Tagalog — fallback to English TTS
    vi: 'vi',
    ar: 'ar',
    fr: 'fr',
    ht: 'fr', // Haitian Creole — fallback to French
    ko: 'ko',
    ru: 'ru',
    hi: 'hi',
    pt: 'pt-BR',
  }
  return map[lang] || 'en-US'
}

function mapAriStatus(state: string): WebhookCallStatus['status'] {
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
