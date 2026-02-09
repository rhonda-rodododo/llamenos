/**
 * TelephonyAdapter — abstract interface for telephony providers.
 * All telephony logic goes through this adapter.
 * Twilio is the first implementation; designed for future provider swaps (e.g., SIP trunks).
 */
export interface TelephonyAdapter {
  /**
   * Generate the language selection IVR menu.
   * Plays each supported language option in its native voice, waits for a digit press.
   */
  handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse>

  /**
   * Generate response for the main call flow (after language is known).
   * Handles rate-limiting rejection, voice CAPTCHA, or enqueue-and-hold.
   */
  handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse>

  /**
   * Generate response for CAPTCHA digit gather (after caller enters digits).
   */
  handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse>

  /**
   * Generate response when a volunteer answers — bridge the call via queue.
   */
  handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse>

  /**
   * Generate voicemail prompt when no volunteer answers.
   * Records caller's message for later transcription.
   */
  handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse>

  /**
   * Generate hold music / wait message for callers in queue.
   * When queueTime exceeds threshold, returns <Leave/> to trigger voicemail.
   */
  handleWaitMusic(lang: string, audioUrls?: AudioUrlMap, queueTime?: number): Promise<TelephonyResponse>

  /**
   * Reject a banned/blocked caller.
   */
  rejectCall(): TelephonyResponse

  /**
   * End/hangup a call by its SID.
   */
  hangupCall(callSid: string): Promise<void>

  /**
   * Initiate parallel outbound calls to volunteers' phones.
   */
  ringVolunteers(params: RingVolunteersParams): Promise<string[]>

  /**
   * Cancel ringing for all volunteers except the one who answered.
   */
  cancelRinging(callSids: string[], exceptSid?: string): Promise<void>

  /**
   * Validate that a webhook request is authentic (from the telephony provider).
   */
  validateWebhook(request: Request): Promise<boolean>

  /**
   * Get call recording/audio for transcription.
   */
  getCallRecording(callSid: string): Promise<ArrayBuffer | null>
}

export interface LanguageMenuParams {
  callSid: string
  callerNumber: string
  hotlineName: string
  enabledLanguages: string[]
}

export interface IncomingCallParams {
  callSid: string
  callerNumber: string
  voiceCaptchaEnabled: boolean
  rateLimited: boolean
  callerLanguage: string
  hotlineName: string
  audioUrls?: AudioUrlMap
}

export interface CaptchaResponseParams {
  callSid: string
  digits: string
  expectedDigits: string
  callerLanguage: string
}

export interface CallAnsweredParams {
  /** The incoming call SID, used as the queue name to bridge caller → volunteer */
  parentCallSid: string
}

export interface VoicemailParams {
  callSid: string
  callerLanguage: string
  callbackUrl: string
  audioUrls?: AudioUrlMap
}

export interface RingVolunteersParams {
  callSid: string
  callerNumber: string
  volunteers: Array<{ pubkey: string; phone: string }>
  callbackUrl: string
}

export interface TelephonyResponse {
  contentType: string
  body: string
  status?: number
}

/** Map of "promptType:language" -> audio URL for custom recordings */
export type AudioUrlMap = Record<string, string>
