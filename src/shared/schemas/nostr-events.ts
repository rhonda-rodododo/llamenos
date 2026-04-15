import { z } from '@hono/zod-openapi'

/**
 * Tier 5 voice E2EE — Nostr event payload schemas.
 *
 * These payloads are carried inside ephemeral Nostr events (KIND_SFRAME_KEY,
 * KIND_DTLS_BINDING, KIND_CALL_SIGNAL) and represent the runtime contract
 * between the key distribution layer and the Nostr relay. All hex strings
 * are lowercase; fingerprints must NOT contain colons.
 */

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const hexAny = z.string().regex(/^[0-9a-f]+$/)

/**
 * SFrame call-secret wrap event. The initiator generates the per-call
 * 32-byte secret, HPKE-wraps it once per recipient device, and publishes
 * one of these events to KIND_SFRAME_KEY.
 */
export const SFrameKeyEventPayloadSchema = z.object({
  type: z.literal('call:sframe-key'),
  callId: z.string().uuid(),
  initiatorDeviceId: hex64,
  keyId: z.number().int().min(0).max(127),
  recipients: z
    .array(
      z.object({
        deviceId: hex64,
        hpkeEnc: hexAny,
        hpkeCiphertext: hexAny,
      })
    )
    .min(1),
  senderIds: z.array(hex64).min(1).max(32),
  issuedAt: z.string().datetime(),
  reason: z.enum(['initial', 'rotate_join', 'rotate_leave', 'rotate_scheduled']),
})
export type SFrameKeyEvent = z.infer<typeof SFrameKeyEventPayloadSchema>

/**
 * DTLS fingerprint binding event. Each peer publishes their WebRTC DTLS
 * certificate fingerprint so remote peers can verify the SRTP keying handshake
 * was not MitM'd — the fingerprint is pinned by the out-of-band Nostr signature.
 */
export const DtlsBindingEventPayloadSchema = z.object({
  type: z.literal('call:dtls-binding'),
  callId: z.string().uuid(),
  deviceId: hex64,
  fingerprint: hex64, // SHA-256 fingerprint, colons stripped + lowercased
  bindingHash: hex64,
  issuedAt: z.string().datetime(),
})
export type DtlsBindingEvent = z.infer<typeof DtlsBindingEventPayloadSchema>

/**
 * Call mode signal. Peers announce whether they're operating in E2EE SFrame
 * mode or falling back to PSTN bridge mode (which cannot be E2EE).
 *
 * `callId` is the telephony provider's call identifier (e.g. Twilio SID
 * `CAxxxx`, Asterisk channel ID) — NOT a UUID. Relaxed to `string().min(1)`.
 * `hubId` is the routing scope; falls back to `'global'` for single-hub deployments.
 */
export const CallModePayloadSchema = z.object({
  type: z.literal('call:mode'),
  callId: z.string().min(1),
  mode: z.enum(['sframe', 'pstn']),
  reason: z.string().optional(),
  hubId: z.string().min(1),
})
type CallModeEvent = z.infer<typeof CallModePayloadSchema>
