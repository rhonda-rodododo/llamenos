import type { ConnectionTestResult } from '@shared/types'
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
import { BridgeClient } from './bridge-client'

const log = createLogger('telephony.sip-bridge')

/**
 * SipBridgeAdapter — abstract base class for telephony adapters that communicate
 * with a sip-bridge sidecar service.
 *
 * Provides shared bridge communication logic (REST calls to the bridge, HMAC
 * webhook validation, recording fetch/delete) that is identical for any PBX
 * using the sip-bridge protocol (Asterisk, FreeSWITCH, Kamailio, etc.).
 *
 * Subclasses must implement the IVR command generation methods and webhook
 * parsing methods, which are PBX-specific.
 */
export abstract class SipBridgeAdapter implements TelephonyAdapter {
  protected bridge: BridgeClient

  constructor(
    protected phoneNumber: string,
    protected bridgeCallbackUrl: string,
    protected bridgeSecret: string
  ) {
    this.bridge = new BridgeClient(bridgeCallbackUrl, bridgeSecret)
  }

  // --- Shared bridge communication (REST calls to sip-bridge) ---

  async hangupCall(callSid: string): Promise<void> {
    await this.bridge.request('POST', '/commands/hangup', { channelId: callSid })
  }

  async ringUsers(params: RingUsersParams): Promise<string[]> {
    const { callSid, callerNumber, users, callbackUrl, hubId } = params
    const result = await this.bridge.request('POST', '/ring', {
      parentCallSid: callSid,
      callerNumber,
      users: users.map((v) => ({
        pubkey: v.pubkey,
        phone: v.phone,
        browserIdentity: v.browserIdentity,
      })),
      callbackUrl,
      hubId,
    })
    return (result as { ok?: boolean; channelIds?: string[] })?.channelIds ?? []
  }

  async cancelRinging(callSids: string[], exceptSid?: string): Promise<void> {
    await this.bridge.request('POST', '/commands/cancel-ringing', {
      callSids,
      exceptSid,
    })
  }

  async getCallRecording(callSid: string): Promise<ArrayBuffer | null> {
    try {
      const result = await this.bridge.request('GET', `/recordings/call/${callSid}`)
      if (result && typeof result === 'object' && 'audio' in result) {
        // Bridge returns base64-encoded audio
        const base64 = (result as { audio: string }).audio
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes.buffer
      }
      return null
    } catch (err) {
      log.error('Failed to get recording for call', err, { callSid })
      return null
    }
  }

  async getRecordingAudio(recordingSid: string): Promise<ArrayBuffer | null> {
    try {
      const result = await this.bridge.request('GET', `/recordings/${recordingSid}`)
      if (result && typeof result === 'object' && 'audio' in result) {
        const base64 = (result as { audio: string }).audio
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes.buffer
      }
      return null
    } catch (err) {
      log.error('Failed to get recording audio', err, { recordingSid })
      return null
    }
  }

  async deleteRecording(recordingSid: string): Promise<void> {
    try {
      await this.bridge.request('DELETE', `/recordings/${recordingSid}`)
    } catch (err) {
      log.error('Failed to delete recording', err)
    }
  }

  // --- Webhook validation (HMAC-SHA256 with replay protection) ---

  async validateWebhook(request: Request): Promise<boolean> {
    const signature = request.headers.get('X-Bridge-Signature')
    if (!signature) return false

    const body = await request.clone().text()
    const timestamp = request.headers.get('X-Bridge-Timestamp') || ''

    // Reject webhooks with timestamps older than 5 minutes (replay protection)
    const tsSeconds = Number.parseInt(timestamp, 10)
    if (Number.isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
      return false
    }

    const payload = `${timestamp}.${body}`

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.bridgeSecret) as Uint8Array<ArrayBuffer>,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload) as Uint8Array<ArrayBuffer>
    )
    const expectedSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSig.length) return false
    const encoder = new TextEncoder()
    const aBuf = encoder.encode(signature)
    const bBuf = encoder.encode(expectedSig)
    let result = 0
    for (let i = 0; i < aBuf.length; i++) {
      result |= aBuf[i] ^ bBuf[i]
    }
    return result === 0
  }

  async verifyWebhookConfig(
    _phoneNumber: string,
    _expectedBaseUrl: string
  ): Promise<WebhookVerificationResult> {
    // Self-hosted SIP bridges control the dialplan directly.
    // No external webhook configuration to verify.
    return { configured: true }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const result = await this.bridge.request('GET', '/health')
      const latencyMs = Date.now() - start
      const health = result as { status?: string; uptime?: number }
      if (health?.status === 'ok') {
        return { connected: true, latencyMs }
      }
      return {
        connected: false,
        latencyMs,
        error: `SIP bridge unhealthy: ${JSON.stringify(health)}`,
        errorType: 'unknown',
      }
    } catch (err) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: `SIP bridge unreachable: ${String(err)}`,
        errorType: 'network_error',
      }
    }
  }

  // --- Abstract methods: IVR / call flow (PBX-specific) ---

  abstract handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse>
  abstract handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse>
  abstract handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse>
  abstract handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse>
  abstract handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse>
  abstract handleWaitMusic(
    lang: string,
    audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse>
  abstract rejectCall(): TelephonyResponse
  abstract handleVoicemailComplete(lang: string): TelephonyResponse
  abstract handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse
  abstract emptyResponse(): TelephonyResponse

  // --- Abstract methods: webhook parsing (PBX-specific field names) ---

  abstract parseIncomingWebhook(request: Request): Promise<WebhookCallInfo>
  abstract parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits>
  abstract parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }>
  abstract parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus>
  abstract parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait>
  abstract parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult>
  abstract parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus>
}
