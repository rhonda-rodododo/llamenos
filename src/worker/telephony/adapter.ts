/**
 * TelephonyAdapter — abstract interface for telephony providers.
 * All telephony logic goes through this adapter.
 * Twilio is the first implementation; designed for future provider swaps (e.g., SIP trunks).
 */
export interface TelephonyAdapter {
  /**
   * Generate TwiML/response for an incoming call.
   * Handles the initial call flow: ban check, voice CAPTCHA, parallel ringing.
   */
  handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse>

  /**
   * Generate response for CAPTCHA digit gather (after caller enters digits).
   */
  handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse>

  /**
   * Generate response when a volunteer answers — connect the call.
   */
  handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse>

  /**
   * End/reject a call.
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

export interface IncomingCallParams {
  callSid: string
  callerNumber: string
  isBanned: boolean
  voiceCaptchaEnabled: boolean
  rateLimited: boolean
  callerLanguage: string
}

export interface CaptchaResponseParams {
  callSid: string
  digits: string
  expectedDigits: string
  callerLanguage: string
}

export interface CallAnsweredParams {
  callSid: string
  volunteerPhone: string
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
