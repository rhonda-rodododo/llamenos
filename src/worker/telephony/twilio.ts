import type {
  TelephonyAdapter,
  IncomingCallParams,
  CaptchaResponseParams,
  CallAnsweredParams,
  RingVolunteersParams,
  TelephonyResponse,
} from './adapter'

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

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    if (params.isBanned) {
      return this.twiml('<Response><Reject reason="rejected"/></Response>')
    }

    if (params.rateLimited) {
      return this.twiml(`
        <Response>
          <Say language="en-US">We are currently experiencing high call volume. Please try again later.</Say>
          <Hangup/>
        </Response>
      `)
    }

    if (params.voiceCaptchaEnabled) {
      // Generate a random 4-digit code
      const digits = String(Math.floor(1000 + Math.random() * 9000))
      // Store expected digits in the callback URL
      return this.twiml(`
        <Response>
          <Gather numDigits="4" action="/api/telephony/captcha?expected=${digits}&amp;callSid=${params.callSid}" method="POST" timeout="10">
            <Say language="en-US">Please enter the following digits: ${digits.split('').join(', ')}.</Say>
          </Gather>
          <Say language="en-US">We did not receive your input. Goodbye.</Say>
          <Hangup/>
        </Response>
      `)
    }

    // No CAPTCHA — proceed to ring volunteers
    // This will be handled by the worker: return a <Dial> or enqueue
    return this.twiml(`
      <Response>
        <Say language="en-US">Please hold while we connect you.</Say>
        <Enqueue waitUrl="/api/telephony/wait-music">${params.callSid}</Enqueue>
      </Response>
    `)
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    if (params.digits === params.expectedDigits) {
      return this.twiml(`
        <Response>
          <Say language="en-US">Thank you. Please hold while we connect you.</Say>
          <Enqueue waitUrl="/api/telephony/wait-music">${params.callSid}</Enqueue>
        </Response>
      `)
    }
    return this.twiml(`
      <Response>
        <Say language="en-US">Invalid input. Goodbye.</Say>
        <Hangup/>
      </Response>
    `)
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    return this.twiml(`
      <Response>
        <Dial callerId="${this.phoneNumber}">
          <Number>${params.volunteerPhone}</Number>
        </Dial>
      </Response>
    `)
  }

  async hangupCall(callSid: string): Promise<void> {
    await this.twilioApi(`/Calls/${callSid}.json`, {
      method: 'POST',
      body: new URLSearchParams({ Status: 'completed' }),
    })
  }

  async ringVolunteers(params: RingVolunteersParams): Promise<string[]> {
    const callSids: string[] = []

    // Parallel ring — call all volunteers simultaneously
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
    // Validate Twilio webhook signature
    const signature = request.headers.get('X-Twilio-Signature')
    if (!signature) return false

    const url = new URL(request.url)
    const body = await request.clone().text()
    const params = new URLSearchParams(body)

    // Build the data string for validation
    let dataString = url.toString()
    const sortedKeys = Array.from(params.keys()).sort()
    for (const key of sortedKeys) {
      dataString += key + params.get(key)
    }

    // HMAC-SHA1 validation
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

    return signature === expected
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
