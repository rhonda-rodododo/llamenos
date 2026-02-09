import type {
  TelephonyAdapter,
  IncomingCallParams,
  CaptchaResponseParams,
  CallAnsweredParams,
  LanguageMenuParams,
  RingVolunteersParams,
  VoicemailParams,
  TelephonyResponse,
  AudioUrlMap,
} from './adapter'
import {
  LANGUAGE_MAP,
  DEFAULT_LANGUAGE,
  IVR_LANGUAGES,
  ivrIndexToDigit,
} from '../../shared/languages'

/**
 * Get Twilio voice language code for a language.
 * Falls back to en-US if the language isn't configured.
 */
function getTwilioVoice(lang: string): string {
  return LANGUAGE_MAP[lang]?.twilioVoice ?? LANGUAGE_MAP[DEFAULT_LANGUAGE].twilioVoice
}

/**
 * Voice prompts for all supported languages.
 * Each prompt has a key-per-language with fallback to English.
 *
 * Future extension: admins can upload recorded audio per prompt+language.
 * The adapter would check for a custom audio URL first, falling back to
 * these TTS strings. TwiML would use <Play> for audio, <Say> for TTS.
 */
const VOICE_PROMPTS: Record<string, Record<string, string>> = {
  greeting: {
    en: 'Thank you for calling {name}.',
    es: 'Gracias por llamar a {name}.',
    zh: '感谢您致电{name}。',
    tl: 'Salamat sa pagtawag sa {name}.',
    vi: 'Cảm ơn bạn đã gọi đến {name}.',
    ar: 'شكراً لاتصالك بـ {name}.',
    fr: 'Merci d\'avoir appelé {name}.',
    ht: 'Mèsi paske ou rele {name}.',
    ko: '{name}에 전화해 주셔서 감사합니다.',
    ru: 'Спасибо, что позвонили в {name}.',
    hi: '{name} पर कॉल करने के लिए धन्यवाद।',
    pt: 'Obrigado por ligar para {name}.',
    de: 'Vielen Dank für Ihren Anruf bei {name}.',
  },
  rateLimited: {
    en: 'We are currently experiencing high call volume. Please try again later.',
    es: 'Estamos experimentando un alto volumen de llamadas. Por favor, intente más tarde.',
    zh: '我们目前通话量较大，请稍后再试。',
    tl: 'Maraming tumatawag sa ngayon. Pakisubukan muli mamaya.',
    vi: 'Chúng tôi hiện đang có lượng cuộc gọi cao. Vui lòng thử lại sau.',
    ar: 'نحن نواجه حاليا حجم مكالمات كبير. يرجى المحاولة مرة أخرى لاحقا.',
    fr: 'Nous connaissons actuellement un volume d\'appels élevé. Veuillez réessayer plus tard.',
    ht: 'Nou gen anpil apèl kounye a. Tanpri eseye ankò pita.',
    ko: '현재 통화량이 많습니다. 나중에 다시 시도해 주세요.',
    ru: 'В настоящее время у нас большой объем звонков. Пожалуйста, перезвоните позже.',
    hi: 'वर्तमान में कॉल की संख्या अधिक है। कृपया बाद में पुनः प्रयास करें।',
    pt: 'Estamos com um alto volume de chamadas. Por favor, tente novamente mais tarde.',
    de: 'Wir haben derzeit ein hohes Anrufaufkommen. Bitte versuchen Sie es später erneut.',
  },
  captchaPrompt: {
    en: 'Please enter the following digits:',
    es: 'Por favor, ingrese los siguientes dígitos:',
    zh: '请输入以下数字：',
    tl: 'Pakilagay ang mga sumusunod na numero:',
    vi: 'Vui lòng nhập các chữ số sau:',
    ar: 'يرجى إدخال الأرقام التالية:',
    fr: 'Veuillez saisir les chiffres suivants :',
    ht: 'Tanpri antre chif sa yo:',
    ko: '다음 숫자를 입력해 주세요:',
    ru: 'Пожалуйста, введите следующие цифры:',
    hi: 'कृपया निम्नलिखित अंक दर्ज करें:',
    pt: 'Por favor, digite os seguintes números:',
    de: 'Bitte geben Sie die folgenden Ziffern ein:',
  },
  captchaTimeout: {
    en: 'We did not receive your input. Goodbye.',
    es: 'No recibimos su entrada. Adiós.',
    zh: '我们未收到您的输入。再见。',
    tl: 'Hindi namin natanggap ang iyong input. Paalam.',
    vi: 'Chúng tôi không nhận được thông tin của bạn. Tạm biệt.',
    ar: 'لم نتلق مدخلاتك. مع السلامة.',
    fr: 'Nous n\'avons pas reçu votre saisie. Au revoir.',
    ht: 'Nou pa resevwa repons ou. Orevwa.',
    ko: '입력을 받지 못했습니다. 안녕히 계세요.',
    ru: 'Мы не получили ваш ввод. До свидания.',
    hi: 'हमें आपका इनपुट नहीं मिला। अलविदा।',
    pt: 'Não recebemos sua entrada. Até logo.',
    de: 'Wir haben Ihre Eingabe nicht erhalten. Auf Wiederhören.',
  },
  pleaseHold: {
    en: 'Please hold while we connect you.',
    es: 'Por favor, espere mientras lo conectamos.',
    zh: '请稍候，我们正在为您转接。',
    tl: 'Pakihintay habang kinokonekta ka namin.',
    vi: 'Xin vui lòng chờ trong khi chúng tôi kết nối bạn.',
    ar: 'يرجى الانتظار بينما نقوم بتوصيلك.',
    fr: 'Veuillez patienter pendant que nous vous connectons.',
    ht: 'Tanpri tann pandan n ap konekte ou.',
    ko: '연결해 드릴 때까지 잠시만 기다려 주세요.',
    ru: 'Пожалуйста, подождите, пока мы вас соединяем.',
    hi: 'कृपया प्रतीक्षा करें, हम आपको कनेक्ट कर रहे हैं।',
    pt: 'Por favor, aguarde enquanto conectamos você.',
    de: 'Bitte warten Sie, während wir Sie verbinden.',
  },
  captchaSuccess: {
    en: 'Thank you. Please hold while we connect you.',
    es: 'Gracias. Por favor, espere mientras lo conectamos.',
    zh: '谢谢。请稍候，我们正在为您转接。',
    tl: 'Salamat. Pakihintay habang kinokonekta ka namin.',
    vi: 'Cảm ơn bạn. Xin vui lòng chờ trong khi chúng tôi kết nối bạn.',
    ar: 'شكرا لك. يرجى الانتظار بينما نقوم بتوصيلك.',
    fr: 'Merci. Veuillez patienter pendant que nous vous connectons.',
    ht: 'Mèsi. Tanpri tann pandan n ap konekte ou.',
    ko: '감사합니다. 연결해 드릴 때까지 잠시만 기다려 주세요.',
    ru: 'Спасибо. Пожалуйста, подождите, пока мы вас соединяем.',
    hi: 'धन्यवाद। कृपया प्रतीक्षा करें, हम आपको कनेक्ट कर रहे हैं।',
    pt: 'Obrigado. Por favor, aguarde enquanto conectamos você.',
    de: 'Danke. Bitte warten Sie, während wir Sie verbinden.',
  },
  captchaFail: {
    en: 'Invalid input. Goodbye.',
    es: 'Entrada inválida. Adiós.',
    zh: '输入无效。再见。',
    tl: 'Hindi valid ang input. Paalam.',
    vi: 'Thông tin không hợp lệ. Tạm biệt.',
    ar: 'إدخال غير صالح. مع السلامة.',
    fr: 'Saisie invalide. Au revoir.',
    ht: 'Repons envalid. Orevwa.',
    ko: '잘못된 입력입니다. 안녕히 계세요.',
    ru: 'Неверный ввод. До свидания.',
    hi: 'अमान्य इनपुट। अलविदा।',
    pt: 'Entrada inválida. Até logo.',
    de: 'Ungültige Eingabe. Auf Wiederhören.',
  },
  waitMessage: {
    en: 'Your call is important to us. Please hold while we connect you with a volunteer.',
    es: 'Su llamada es importante para nosotros. Por favor, espere mientras lo conectamos con un voluntario.',
    zh: '您的来电对我们非常重要。请稍候，我们正在为您转接志愿者。',
    tl: 'Mahalaga sa amin ang iyong tawag. Pakihintay habang kinokonekta ka namin sa isang boluntaryo.',
    vi: 'Cuộc gọi của bạn rất quan trọng với chúng tôi. Xin vui lòng chờ trong khi chúng tôi kết nối bạn với tình nguyện viên.',
    ar: 'مكالمتك مهمة بالنسبة لنا. يرجى الانتظار بينما نقوم بتوصيلك بمتطوع.',
    fr: 'Votre appel est important pour nous. Veuillez patienter pendant que nous vous connectons avec un bénévole.',
    ht: 'Apèl ou enpòtan pou nou. Tanpri tann pandan n ap konekte ou ak yon volontè.',
    ko: '귀하의 전화는 소중합니다. 자원봉사자와 연결해 드릴 때까지 잠시만 기다려 주세요.',
    ru: 'Ваш звонок важен для нас. Пожалуйста, подождите, пока мы соединяем вас с волонтёром.',
    hi: 'आपकी कॉल हमारे लिए महत्वपूर्ण है। कृपया प्रतीक्षा करें, हम आपको एक स्वयंसेवक से जोड़ रहे हैं।',
    pt: 'Sua chamada é importante para nós. Por favor, aguarde enquanto conectamos você com um voluntário.',
    de: 'Ihr Anruf ist uns wichtig. Bitte warten Sie, während wir Sie mit einem Freiwilligen verbinden.',
  },
  voicemailPrompt: {
    en: 'No one is available to take your call right now. Please leave a message after the tone and we will get back to you.',
    es: 'No hay nadie disponible para atender su llamada en este momento. Por favor, deje un mensaje después del tono y nos pondremos en contacto con usted.',
    zh: '目前没有人能接听您的电话。请在提示音后留言，我们会尽快回复您。',
    tl: 'Walang available na makasagot ng iyong tawag ngayon. Mangyaring mag-iwan ng mensahe pagkatapos ng tono.',
    vi: 'Hiện không có ai có thể nhận cuộc gọi của bạn. Vui lòng để lại tin nhắn sau tiếng bíp.',
    ar: 'لا يوجد أحد متاح للرد على مكالمتك الآن. يرجى ترك رسالة بعد النغمة.',
    fr: 'Personne n\'est disponible pour prendre votre appel pour le moment. Veuillez laisser un message après le bip.',
    ht: 'Pa gen moun disponib pou pran apèl ou kounye a. Tanpri kite yon mesaj apre son an.',
    ko: '현재 전화를 받을 수 있는 사람이 없습니다. 신호음 후 메시지를 남겨주세요.',
    ru: 'В данный момент никто не может ответить на ваш звонок. Пожалуйста, оставьте сообщение после сигнала.',
    hi: 'इस समय आपकी कॉल लेने के लिए कोई उपलब्ध नहीं है। कृपया बीप के बाद एक संदेश छोड़ें।',
    pt: 'Ninguém está disponível para atender sua ligação no momento. Por favor, deixe uma mensagem após o sinal.',
    de: 'Im Moment ist niemand verfügbar, um Ihren Anruf entgegenzunehmen. Bitte hinterlassen Sie eine Nachricht nach dem Signalton.',
  },
}

/**
 * IVR language menu prompts — each language announces itself in its native voice.
 * Keyed by language code, value is the phrase spoken in that language.
 */
const IVR_PROMPTS: Record<string, string> = {
  es: 'Para español, marque uno.',
  en: 'For English, press two.',
  zh: '如需中文服务，请按三。',
  tl: 'Para sa Tagalog, pindutin ang apat.',
  vi: 'Tiếng Việt, nhấn năm.',
  ar: 'للعربية، اضغط ستة.',
  fr: 'Pour le français, appuyez sur sept.',
  ht: 'Pou Kreyòl, peze wit.',
  ko: '한국어는 아홉 번을 눌러주세요.',
  ru: 'Для русского языка нажмите ноль.',
}

/** Get a voice prompt in the given language, falling back to English. */
export function getPrompt(key: string, lang: string): string {
  return VOICE_PROMPTS[key]?.[lang] ?? VOICE_PROMPTS[key]?.[DEFAULT_LANGUAGE] ?? ''
}

/** Generate TwiML: <Play> if custom audio exists, <Say> fallback */
function sayOrPlay(promptKey: string, lang: string, audioUrls?: AudioUrlMap, text?: string): string {
  const audioUrl = audioUrls?.[`${promptKey}:${lang}`]
  if (audioUrl) {
    return `<Play>${audioUrl}</Play>`
  }
  const voice = getTwilioVoice(lang)
  const content = text ?? getPrompt(promptKey, lang)
  return `<Say language="${voice}">${content}</Say>`
}

/**
 * TwilioAdapter — Twilio implementation of TelephonyAdapter.
 */
export class TwilioAdapter implements TelephonyAdapter {
  private accountSid: string
  private authToken: string
  private phoneNumber: string

  constructor(accountSid: string, authToken: string, phoneNumber: string) {
    this.accountSid = accountSid
    this.authToken = authToken
    this.phoneNumber = phoneNumber
  }

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const enabled = params.enabledLanguages
    // Filter IVR languages to only those enabled by admin
    const activeLanguages = IVR_LANGUAGES.filter(code => enabled.includes(code))

    // If only 1 language enabled, skip the menu entirely
    if (activeLanguages.length <= 1) {
      const lang = activeLanguages[0] || DEFAULT_LANGUAGE
      return this.twiml(`
        <Response>
          <Redirect method="POST">/api/telephony/language-selected?auto=1&amp;forceLang=${lang}</Redirect>
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
    }).filter(Boolean).join('\n      ')

    return this.twiml(`
      <Response>
        <Gather numDigits="1" action="/api/telephony/language-selected" method="POST" timeout="8">
          ${sayElements}
        </Gather>
        <Redirect method="POST">/api/telephony/language-selected?auto=1</Redirect>
      </Response>
    `)
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const tLang = getTwilioVoice(lang)
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

    if (params.voiceCaptchaEnabled) {
      const digits = String(Math.floor(1000 + Math.random() * 9000))
      const captchaTwiml = sayOrPlay('captchaPrompt', lang, params.audioUrls)
      return this.twiml(`
        <Response>
          <Gather numDigits="4" action="/api/telephony/captcha?expected=${digits}&amp;callSid=${params.callSid}&amp;lang=${lang}" method="POST" timeout="10">
            ${greetingTwiml}
            ${captchaTwiml}
            <Say language="${tLang}">${digits.split('').join(', ')}.</Say>
          </Gather>
          <Say language="${tLang}">${getPrompt('captchaTimeout', lang)}</Say>
          <Hangup/>
        </Response>
      `)
    }

    const holdTwiml = sayOrPlay('pleaseHold', lang, params.audioUrls)
    return this.twiml(`
      <Response>
        ${greetingTwiml}
        ${holdTwiml}
        <Enqueue waitUrl="/api/telephony/wait-music?lang=${lang}" action="/api/telephony/queue-exit?callSid=${params.callSid}&amp;lang=${lang}" method="POST">${params.callSid}</Enqueue>
      </Response>
    `)
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage
    const tLang = getTwilioVoice(lang)

    if (params.digits === params.expectedDigits) {
      return this.twiml(`
        <Response>
          <Say language="${tLang}">${getPrompt('captchaSuccess', lang)}</Say>
          <Enqueue waitUrl="/api/telephony/wait-music?lang=${lang}" action="/api/telephony/queue-exit?callSid=${params.callSid}&amp;lang=${lang}" method="POST">${params.callSid}</Enqueue>
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
    return this.twiml(`
      <Response>
        <Dial>
          <Queue>${params.parentCallSid}</Queue>
        </Dial>
      </Response>
    `)
  }

  async handleWaitMusic(lang: string, audioUrls?: AudioUrlMap, queueTime?: number, queueTimeout?: number): Promise<TelephonyResponse> {
    // After timeout in queue with no answer, leave queue → triggers voicemail
    if (queueTime !== undefined && queueTime >= (queueTimeout ?? 90)) {
      return this.twiml(`<Response><Leave/></Response>`)
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
    const voicemailTwiml = sayOrPlay('voicemailPrompt', lang, params.audioUrls)
    return this.twiml(`
      <Response>
        ${voicemailTwiml}
        <Record maxLength="${params.maxRecordingSeconds ?? 120}" action="/api/telephony/voicemail-complete?callSid=${params.callSid}&amp;lang=${lang}" recordingStatusCallback="${params.callbackUrl}/api/telephony/voicemail-recording?callSid=${params.callSid}" recordingStatusCallbackEvent="completed" />
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

  async ringVolunteers(params: RingVolunteersParams): Promise<string[]> {
    const callSids: string[] = []

    const calls = await Promise.allSettled(
      params.volunteers.map(async (vol) => {
        const body = new URLSearchParams({
          To: vol.phone,
          From: this.phoneNumber,
          Url: `${params.callbackUrl}/api/telephony/volunteer-answer?parentCallSid=${params.callSid}&pubkey=${vol.pubkey}`,
          StatusCallback: `${params.callbackUrl}/api/telephony/call-status?parentCallSid=${params.callSid}&pubkey=${vol.pubkey}`,
          StatusCallbackEvent: 'initiated ringing answered completed',
          Timeout: '30',
          MachineDetection: 'Enable',
        })

        const res = await this.twilioApi('/Calls.json', {
          method: 'POST',
          body,
        })

        if (res.ok) {
          const data = await res.json() as { sid: string }
          return data.sid
        }
        throw new Error(`Failed to call ${vol.pubkey}`)
      })
    )

    for (const result of calls) {
      if (result.status === 'fulfilled') {
        callSids.push(result.value)
      }
    }

    return callSids
  }

  async cancelRinging(callSids: string[], exceptSid?: string): Promise<void> {
    await Promise.allSettled(
      callSids
        .filter(sid => sid !== exceptSid)
        .map(sid =>
          this.twilioApi(`/Calls/${sid}.json`, {
            method: 'POST',
            body: new URLSearchParams({ Status: 'completed' }),
          })
        )
    )
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
      encoder.encode(this.authToken),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(dataString))
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
    if (!res.ok) return null

    const data = await res.json() as { recordings?: Array<{ sid: string }> }
    if (!data.recordings?.length) return null

    const recordingSid = data.recordings[0].sid
    const audioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Recordings/${recordingSid}.wav`,
      {
        headers: {
          'Authorization': 'Basic ' + btoa(`${this.accountSid}:${this.authToken}`),
        },
      }
    )

    if (!audioRes.ok) return null
    return audioRes.arrayBuffer()
  }

  // --- Helpers ---

  private twiml(xml: string): TelephonyResponse {
    return {
      contentType: 'text/xml',
      body: xml.trim(),
    }
  }

  private async twilioApi(path: string, init: RequestInit): Promise<Response> {
    return fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}${path}`,
      {
        ...init,
        headers: {
          'Authorization': 'Basic ' + btoa(`${this.accountSid}:${this.authToken}`),
          ...(init.body instanceof URLSearchParams
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
          ...init.headers,
        },
      }
    )
  }
}
