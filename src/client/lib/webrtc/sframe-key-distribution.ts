import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_SFRAME_CALL_SECRET, labelToId } from '@shared/crypto-labels.js'
import type { HpkeEnvelope } from '@shared/hpke-envelope.js'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives.js'
import type { SFrameKeyEvent } from '@shared/schemas/nostr-events.js'

/**
 * Build / parse SFrame call-secret distribution events.
 *
 * HPKE label + AAD binding is enforced **inline** by this module. There is
 * no `HpkeSealFn` / `HpkeOpenFn` injection point — callers pass `callId`
 * and the module calls `hpkeSeal` / `hpkeOpen` directly with
 * `LABEL_SFRAME_CALL_SECRET` and
 * `buildAad(LABEL_SFRAME_CALL_SECRET, callId, 'sframe-secret')`. This
 * eliminates the "first caller forgets to curry" footgun that the injected
 * variant allowed. Callers must supply real X25519 HPKE keys.
 */

export interface CallRecipient {
  deviceId: string
  /** X25519 HPKE public key, non-extractable CryptoKey. */
  publicKey: CryptoKey
}

export interface BuildKeyEventInputs {
  callId: string
  initiatorDeviceId: string
  keyId: number
  callSecret: Uint8Array
  recipients: CallRecipient[]
  senderIds: string[]
  reason: 'initial' | 'rotate_join' | 'rotate_leave' | 'rotate_scheduled'
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Canonical AAD for the SFrame call-secret wrap, bound to a specific callId. */
function sframeAad(callId: string): Uint8Array {
  return buildAad(LABEL_SFRAME_CALL_SECRET, callId, 'sframe-secret')
}

/**
 * Wrap the 32-byte per-call SFrame secret under each recipient device's HPKE
 * key and produce a Nostr event payload ready to publish to KIND_SFRAME_KEY.
 *
 * Each recipient's HPKE seal produces its own `enc` (encapsulated sender key)
 * alongside a unique ciphertext. We serialize both fields as lowercase hex to
 * satisfy the `SFrameKeyEventPayloadSchema` regex — the underlying
 * `HpkeEnvelope` wire format is base64url, so we decode then re-encode as hex.
 */
export async function buildKeyEvent(inputs: BuildKeyEventInputs): Promise<SFrameKeyEvent> {
  if (inputs.callSecret.byteLength !== 32) {
    throw new Error(`callSecret must be 32 bytes, got ${inputs.callSecret.byteLength}`)
  }
  if (inputs.recipients.length === 0) {
    throw new Error('at least one recipient required')
  }

  const aad = sframeAad(inputs.callId)
  const sealedRecipients: SFrameKeyEvent['recipients'] = []
  for (const r of inputs.recipients) {
    const envelope = await hpkeSeal(inputs.callSecret, r.publicKey, LABEL_SFRAME_CALL_SECRET, aad)
    sealedRecipients.push({
      deviceId: r.deviceId,
      hpkeEnc: bytesToHex(b64urlDecode(envelope.enc)),
      hpkeCiphertext: bytesToHex(b64urlDecode(envelope.ct)),
    })
  }

  return {
    type: 'call:sframe-key',
    callId: inputs.callId,
    initiatorDeviceId: inputs.initiatorDeviceId,
    keyId: inputs.keyId,
    recipients: sealedRecipients,
    senderIds: inputs.senderIds,
    issuedAt: new Date().toISOString(),
    reason: inputs.reason,
  }
}

interface ParseKeyEventInputs {
  event: SFrameKeyEvent
  localDeviceId: string
  privateKey: CryptoKey
}

/**
 * Extract and decrypt the local device's HPKE envelope from an SFrame key
 * event. Throws if this device is not in the recipients list.
 *
 * AAD is derived inline from `inputs.event.callId`, so a secret sealed for
 * one call cannot be replayed into another — the AEAD fails on mismatch.
 */
export async function parseKeyEvent(inputs: ParseKeyEventInputs): Promise<Uint8Array> {
  const entry = inputs.event.recipients.find((r) => r.deviceId === inputs.localDeviceId)
  if (!entry) throw new Error('not a recipient of this sframe key event')

  const envelope: HpkeEnvelope = {
    v: 3,
    labelId: labelToId(LABEL_SFRAME_CALL_SECRET),
    enc: b64urlEncode(hexToBytes(entry.hpkeEnc)),
    ct: b64urlEncode(hexToBytes(entry.hpkeCiphertext)),
  }
  return hpkeOpen(
    envelope,
    inputs.privateKey,
    LABEL_SFRAME_CALL_SECRET,
    sframeAad(inputs.event.callId)
  )
}

export { LABEL_SFRAME_CALL_SECRET }
