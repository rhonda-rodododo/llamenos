import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_SFRAME_CALL_SECRET, labelToId } from '@shared/crypto-labels.js'
import type { HpkeEnvelope } from '@shared/hpke-envelope.js'
import type { SFrameKeyEvent } from '@shared/schemas/nostr-events.js'

/**
 * Injected HPKE primitives. The real implementations live in
 * `@shared/hpke-primitives.ts` as `hpkeSeal(plaintext, recipientPublicKey,
 * label, aad)` and `hpkeOpen(envelope, recipientPrivateKey, expectedLabel,
 * aad)`. This module accepts a simpler two-argument form so unit tests can
 * inject stubs without standing up real X25519 keys.
 *
 * In production, call sites MUST curry the real primitives to bind
 * `LABEL_SFRAME_CALL_SECRET` as the label and an appropriate AAD (for
 * example, `buildAad(LABEL_SFRAME_CALL_SECRET, callId, 'sframe-secret')`)
 * before passing them in. The curry is the place to enforce those bindings,
 * not this module.
 */
export type HpkeSealFn = (
  plaintext: Uint8Array,
  recipientPublicKey: CryptoKey
) => Promise<HpkeEnvelope>

export type HpkeOpenFn = (
  envelope: HpkeEnvelope,
  recipientPrivateKey: CryptoKey
) => Promise<Uint8Array>

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
  hpkeSeal: HpkeSealFn
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

  const sealedRecipients: SFrameKeyEvent['recipients'] = []
  for (const r of inputs.recipients) {
    const envelope = await inputs.hpkeSeal(inputs.callSecret, r.publicKey)
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

export interface ParseKeyEventInputs {
  event: SFrameKeyEvent
  localDeviceId: string
  privateKey: CryptoKey
  hpkeOpen: HpkeOpenFn
}

/**
 * Extract and decrypt the local device's HPKE envelope from an SFrame key
 * event. Throws if this device is not in the recipients list.
 *
 * The reconstructed `HpkeEnvelope.labelId` is stamped with
 * `labelToId(LABEL_SFRAME_CALL_SECRET)` so that the real `hpkeOpen` label
 * cross-check (see `src/shared/hpke-primitives.ts`) passes. Test stubs that
 * ignore labelId still work because they never inspect the field.
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
  return inputs.hpkeOpen(envelope, inputs.privateKey)
}

export { LABEL_SFRAME_CALL_SECRET }
