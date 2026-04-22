/**
 * Zod schemas for sip-bridge service API responses.
 *
 * The sip-bridge is a self-hosted sidecar that sits alongside SIP servers
 * (Asterisk, FreeSWITCH, Kamailio), translates protocol-specific events into
 * HTTP webhooks, and exposes a JSON REST API for call management. The Llámenos
 * server communicates with it via the BridgeClient (HMAC-signed requests).
 *
 * All responses from the bridge are JSON (application/json).
 *
 * Reference: src/server/telephony/bridge-client.ts
 *            src/server/telephony/asterisk.ts
 */

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Section 1: Ring result (/ring)
// Response to POST /ring — initiates parallel ringing to a set of SIP/PSTN
// endpoints. Returns the channel IDs so the server can cancel them later.
// ---------------------------------------------------------------------------

export const AsteriskRingResultSchema = z.looseObject({
  /** Whether all ring operations were successfully initiated */
  ok: z.boolean(),
  /**
   * Array of Asterisk channel IDs for each ringing leg.
   * Pass these to POST /commands/cancel-ringing to abort ringing.
   */
  channelIds: z.array(z.string()),
})
export type AsteriskRingResult = z.infer<typeof AsteriskRingResultSchema>

// ---------------------------------------------------------------------------
// Section 2: Recording audio response (/recordings/call/:callSid,
//            /recordings/:recordingSid)
// Response to GET /recordings/... — returns the audio file as base64-encoded
// binary so it can be transported over JSON without multipart complexity.
// ---------------------------------------------------------------------------

export const AsteriskRecordingAudioSchema = z.looseObject({
  /**
   * Base64-encoded audio data.
   * The caller is responsible for decoding via atob() / Buffer.from(v, 'base64').
   */
  audio: z.string(),
  /** MIME type of the audio (e.g. 'audio/wav', 'audio/ogg'). Optional hint. */
  mimeType: z.string().optional(),
  /** Duration of the recording in seconds, if known */
  duration: z.number().optional(),
})
export type AsteriskRecordingAudio = z.infer<typeof AsteriskRecordingAudioSchema>

// ---------------------------------------------------------------------------
// Section 3: Health check (/health)
// Response to GET /health — used by the server to verify the bridge is reachable
// and the ARI/SIP stack is properly configured before processing calls.
// ---------------------------------------------------------------------------

export const AsteriskHealthSchema = z.looseObject({
  /**
   * General health status string.
   * Expected values: 'ok', 'degraded', 'error' — but treated as a free string
   * since the bridge may evolve its status vocabulary.
   */
  status: z.string(),
  /** Seconds the bridge process has been running */
  uptime: z.number(),
  /** Whether a SIP endpoint has been successfully provisioned */
  sipConfigured: z.boolean(),
  /** Asterisk ARI WebSocket connection status, if reported */
  ariConnected: z.boolean().optional(),
  /** Version string of the bridge service */
  version: z.string().optional(),
  /** Number of active call channels currently tracked */
  activeChannels: z.number().optional(),
})
export type AsteriskHealth = z.infer<typeof AsteriskHealthSchema>

// ---------------------------------------------------------------------------
// Section 4: Generic command acknowledgment (/commands/*)
// Response to POST /commands/hangup, POST /commands/cancel-ringing, etc.
// The bridge returns a minimal ack body; only 'ok' is guaranteed.
// ---------------------------------------------------------------------------

export const AsteriskCommandAckSchema = z.looseObject({
  /** Whether the command was accepted and dispatched */
  ok: z.boolean(),
  /** Optional human-readable message (useful for debugging errors) */
  message: z.string().optional(),
})
export type AsteriskCommandAck = z.infer<typeof AsteriskCommandAckSchema>

// ---------------------------------------------------------------------------
// Section 5: Inbound webhook from the sip-bridge to the Llámenos server
// The bridge POSTs JSON events to the Llámenos webhook URL when call events
// occur (incoming call, DTMF, queue events, recording complete, etc.).
// These are validated before being passed to SipBridgeAdapter.parse*Webhook().
// ---------------------------------------------------------------------------

/**
 * Asterisk channel / call state values (mapped from ARI channel states).
 * - Ring:       Channel is ringing (outbound)
 * - Up:         Channel is answered / bridged
 * - Hangup:     Channel has been hung up
 * - Down:       Channel is initializing (not yet ringing)
 */
export const AsteriskChannelStateSchema = z.enum(['Ring', 'Up', 'Hangup', 'Down'])
export type AsteriskChannelState = z.infer<typeof AsteriskChannelStateSchema>

export const SipBridgeWebhookSchema = z.looseObject({
  /**
   * Channel ID (used as callSid throughout the adapter).
   * May be UUID format (e.g. 'b4e7c9d1-1234-...').
   */
  channelId: z.string().optional(),
  /**
   * Alternative field name sent by some bridge event types.
   * The adapter checks both.
   */
  callSid: z.string().optional(),
  /** Caller's phone number (E.164 or SIP URI) */
  callerNumber: z.string().optional(),
  /** Alternative caller field name */
  from: z.string().optional(),
  /** Called number or SIP URI */
  calledNumber: z.string().optional(),
  /** Alternative called-number field name */
  to: z.string().optional(),
  /** DTMF digits collected by a gather/input action */
  digits: z.string().optional(),
  /**
   * Channel state (used for status mapping).
   */
  state: AsteriskChannelStateSchema.optional(),
  /**
   * Alternative status field used in some event types.
   */
  status: z.string().optional(),
  /**
   * Seconds the caller has been in the queue (for waitMusic events).
   */
  queueTime: z.number().optional(),
  /**
   * Why the call left the queue (for queueExit events).
   * e.g. 'bridged', 'hangup', 'leave', 'error'
   */
  result: z.string().optional(),
  /**
   * Alternative reason field used in some hangup event types.
   */
  reason: z.string().optional(),
  /**
   * Recording name or path within the SIP server (used as recordingSid).
   */
  recordingName: z.string().optional(),
  /**
   * Alternative recording identifier.
   */
  recordingSid: z.string().optional(),
  /**
   * Recording lifecycle status.
   * 'done' maps to 'completed'; anything else maps to 'failed'.
   */
  recordingStatus: z.string().optional(),
  /** ISO-8601 or Unix epoch timestamp of the event */
  timestamp: z.union([z.string(), z.number()]).optional(),
  /** The callbackEvent name set in the outgoing JSON command */
  event: z.string().optional(),
  /** Any extra metadata the bridge echoes back from command payloads */
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type SipBridgeWebhook = z.infer<typeof SipBridgeWebhookSchema>

export type { SipBridgeWebhook as AsteriskBridgeWebhook }
// ---------------------------------------------------------------------------
// Backward-compat aliases — existing code importing AsteriskBridgeWebhookSchema
// or AsteriskBridgeWebhook from this module will continue to compile.
// ---------------------------------------------------------------------------
export { SipBridgeWebhookSchema as AsteriskBridgeWebhookSchema }
