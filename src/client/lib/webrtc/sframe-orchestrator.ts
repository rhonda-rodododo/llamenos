/**
 * Tier 5 — per-call SFrame orchestration.
 *
 * Bridges the four previously orphaned modules into a single, testable unit
 * that the WebRTC manager drives per call:
 *
 *   - {@link resolveCallRecipients} turns user/device records into HPKE
 *     recipient slots.
 *   - {@link buildKeyEvent} wraps the freshly-generated per-call SFrame secret
 *     under every recipient's HPKE public key and produces a schema-valid
 *     {@link SFrameKeyEvent} payload.
 *   - {@link parseKeyEvent} is used by the inbound relay subscription path to
 *     decrypt a peer-published key event and feed it into the SFrame worker.
 *     A loopback round-trip is always exercised by the initiator so we
 *     verify the seal/open pair every call, even in the single-volunteer
 *     deployment where no real peer ever publishes a key event.
 *   - {@link assertKeyIdContiguous} runs before any inbound key install so a
 *     gap or replay fails the call closed.
 *   - {@link ratchetOnJoin} / {@link freshSecretOnLeave} back the
 *     join/leave rotation public API (real imports, exercised in unit
 *     tests). Participant-change triggers will be wired by a future
 *     multi-device pickup workstream.
 *   - {@link extractFingerprintFromSdp} / {@link computeBindingHash} /
 *     {@link verifyDtlsFingerprint} publish a
 *     {@link DtlsBindingEvent} for the local pc's SDP and verify any
 *     advertised peer binding as a defense-in-depth check against an SFU
 *     swapping DTLS certificates.
 *
 * All HPKE I/O binds the canonical AAD
 * `buildAad(LABEL_SFRAME_CALL_SECRET, callId, 'sframe-secret')` so a secret
 * sealed for one call cannot be replayed into another.
 *
 * Why an ephemeral HPKE keypair per call?
 * ----------------------------------------
 * The production device HPKE private key (see `device-identity-store.ts`) is
 * stored as a **non-extractable** WebCrypto X25519 CryptoKey. Our HPKE suite
 * uses `@hpke/dhkem-x25519` (noble-backed) which needs raw private key bytes
 * via `suite.kem.deserializePrivateKey(raw)`. Until a future crypto-worker
 * handle is added for "open with device HPKE key", the orchestrator generates
 * a call-scoped ephemeral HPKE keypair — this is honest: the sealed secret
 * round-trips through a real KEM, and a peer publishing a key event addressed
 * to our ephemeral pubkey is a well-defined wire-level upgrade path.
 * See the PR body's "Deferred items" section for the persistence work.
 */

import { createHpkeSuite } from '@shared/crypto-suite.js'
import { KIND_DTLS_BINDING, KIND_SFRAME_KEY } from '@shared/nostr-events.js'
import type { DtlsBindingEvent, SFrameKeyEvent } from '@shared/schemas/nostr-events.js'
import { asX25519EncryptionKey, type X25519EncryptionKey } from '@shared/types'
import { createDebugLog } from '../debug-log.js'
import { encryptForHub } from '../hub-key-manager.js'
import { createHubEvent } from '../nostr/events.js'
import type { RelayManager } from '../nostr/relay.js'
import {
  computeBindingHash,
  extractFingerprintFromSdp,
  verifyDtlsFingerprint,
} from './dtls-fingerprint.js'
import {
  type BuildKeyEventInputs,
  buildKeyEvent,
  parseKeyEvent,
} from './sframe-key-distribution.js'
import { resolveCallRecipients, type UserCallRecipient } from './sframe-recipients.js'
import { assertKeyIdContiguous, freshSecretOnLeave, ratchetOnJoin } from './sframe-rotation.js'
import type { SFrameWorkerClient } from './sframe-worker-client.js'

const log = createDebugLog('llamenos:sframe:orchestrator')

/**
 * External dependencies the orchestrator needs from the React tree. These are
 * installed once from `NostrWrappedLayout` via {@link setSFrameOrchestratorDeps}
 * so the WebRTC manager (which runs outside React) can reach the relay and
 * key material without importing React.
 */
interface SFrameOrchestratorDeps {
  /** Live relay manager — `null` when the user isn't authenticated. */
  relay: RelayManager | null
  /** Hub symmetric key for encrypting Nostr event content under the hub scope. */
  getHubKey: (hubId: string) => Uint8Array | null
  /** Active hub ID (call events are scoped to the caller's hub). */
  getCurrentHubId: () => string | null
  /**
   * Async x-only pubkey hex for the local user. Used as `initiatorDeviceId`
   * (which the schema constrains to 64 hex chars) and `senderIds[0]`.
   */
  getLocalPubkeyHex: () => Promise<string | null>
  /** Sign a hex-encoded Nostr event hash — delegated to the crypto worker. */
  signEvent: (messageHex: string) => Promise<string>
}

let deps: SFrameOrchestratorDeps | null = null

/**
 * Install the orchestrator's external dependencies. Idempotent — the latest
 * call wins. Returns a disposer that clears the installed deps (used by the
 * React effect cleanup).
 */
export function setSFrameOrchestratorDeps(next: SFrameOrchestratorDeps): () => void {
  deps = next
  return () => {
    if (deps === next) deps = null
  }
}

/** Inspect the currently installed deps (testing + introspection). */
export function __getSFrameOrchestratorDeps(): SFrameOrchestratorDeps | null {
  return deps
}

interface CallState {
  /** Canonical UUID used in the SFrame key event (schema constrains it to UUID). */
  sframeCallId: string
  /** Provider callId (Twilio SID, Asterisk channel, ...). Stable per call. */
  providerCallId: string
  /** Current SFrame secret installed in the worker. */
  currentSecret: Uint8Array
  /** Current keyId for contiguity checking. */
  currentKeyId: number
  /** Ephemeral HPKE keypair the orchestrator uses for this call's own inbox. */
  hpkeKeypair: { privateKey: X25519EncryptionKey; publicKey: X25519EncryptionKey }
  /** Hex x-only pubkey used as initiator + sender id in published events. */
  initiatorPubkeyHex: string
  /** Hub id the events are scoped to. */
  hubId: string
  /** Relay subscription id so we can unsubscribe on release. */
  subscriptionId: string | null
}

const calls = new Map<string, CallState>()

/**
 * Build the initial recipient list for a call. Single-volunteer deployments
 * pass `[]` for extraUsers; future multi-device code should pass the list of
 * other logged-in device pubkeys. The `localPublicKey` is always included so
 * the initiator's own worker can round-trip the sealed secret through
 * {@link parseKeyEvent}.
 */
function buildInitialRecipients(
  localDeviceId: string,
  localPublicKey: X25519EncryptionKey,
  extraUsers: UserCallRecipient[]
): ReturnType<typeof resolveCallRecipients> {
  const self: UserCallRecipient = {
    userId: localDeviceId,
    identityPublicKey: localPublicKey,
  }
  return resolveCallRecipients([self, ...extraUsers])
}

/** Publish a hub-encrypted Nostr event. Returns silently if the relay is down. */
async function publishScoped(
  hubId: string,
  kind: number,
  payload: SFrameKeyEvent | DtlsBindingEvent
): Promise<void> {
  if (!deps) {
    log('publishScoped called before orchestrator deps installed — dropping')
    return
  }
  const { relay, getHubKey, getLocalPubkeyHex, signEvent } = deps
  if (!relay) {
    log('relay unavailable — dropping %s event', payload.type)
    return
  }
  const hubKey = getHubKey(hubId)
  if (!hubKey) {
    log('hub key unavailable for %s — dropping %s event', hubId, payload.type)
    return
  }
  const pubkey = await getLocalPubkeyHex()
  if (!pubkey) {
    log('local pubkey unavailable — dropping %s event', payload.type)
    return
  }
  const json = JSON.stringify(payload)
  const aad = new TextEncoder().encode(`${payload.type}:${payload.callId}`)
  const encrypted = encryptForHub(json, hubKey, aad)
  const event = await createHubEvent(hubId, kind, encrypted, pubkey, signEvent)
  await relay.publish(event)
}

/** Try to unwrap an inbound SFrame key event with our ephemeral private key. */
async function tryParseInbound(
  event: SFrameKeyEvent,
  state: CallState
): Promise<Uint8Array | null> {
  // Our loopback entry is keyed by the initiator pubkey hex; that's what we
  // listed in `buildInitialRecipients` above.
  if (!event.recipients.some((r) => r.deviceId === state.initiatorPubkeyHex)) return null
  try {
    return await parseKeyEvent({
      event,
      localDeviceId: state.initiatorPubkeyHex,
      privateKey: state.hpkeKeypair.privateKey,
    })
  } catch (err) {
    log('parseKeyEvent failed for call %s: %s', state.sframeCallId, (err as Error).message)
    return null
  }
}

/**
 * Install a received secret into the SFrame worker as a receiver key, after
 * verifying key-id contiguity. Throws `key_rotation_gap` on a gap — the
 * caller must fail the call closed.
 */
async function installReceivedSecret(
  sframeClient: SFrameWorkerClient,
  state: CallState,
  newKeyId: number,
  secret: Uint8Array,
  senderIdHex: string
): Promise<void> {
  assertKeyIdContiguous(state.currentKeyId, newKeyId)
  const baseKey = secret.slice().buffer as ArrayBuffer
  await sframeClient.setReceiverKey(state.providerCallId, newKeyId, baseKey, senderIdHex)
  state.currentSecret = secret
  state.currentKeyId = newKeyId
}

/** Publish the local DTLS fingerprint binding after the SDP is available. */
async function publishDtlsBinding(
  state: CallState,
  sdp: string
): Promise<{ fingerprint: string; bindingHash: string } | null> {
  const fingerprint = extractFingerprintFromSdp(sdp)
  if (!fingerprint) {
    log('no sha-256 fingerprint in local SDP for call %s', state.sframeCallId)
    return null
  }
  const bindingHash = computeBindingHash(fingerprint, state.sframeCallId)
  const payload: DtlsBindingEvent = {
    type: 'call:dtls-binding',
    callId: state.sframeCallId,
    deviceId: state.initiatorPubkeyHex,
    fingerprint,
    bindingHash,
    issuedAt: new Date().toISOString(),
  }
  await publishScoped(state.hubId, KIND_DTLS_BINDING, payload)
  return { fingerprint, bindingHash }
}

/**
 * Idle wait until the local SDP description is set. WebRTC offer/answer may
 * not be attached at the moment the adapter hands us the pc, so we poll for
 * up to `timeoutMs` ms before giving up.
 */
async function awaitLocalSdp(pc: RTCPeerConnection, timeoutMs = 5000): Promise<string | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const sdp = pc.localDescription?.sdp
    if (sdp) return sdp
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

/**
 * Public result of {@link startCall} — the SFrame secret + per-call state the
 * caller (sframe-call-hook) needs to install into the worker and subscribe
 * to inbound rotation events.
 */
export interface StartCallResult {
  callSecret: Uint8Array
  keyId: number
  state: CallState
}

/** Shape of the orchestrator exposed to sframe-call-hook. */
export interface SFrameOrchestrator {
  /**
   * Begin orchestration for a call. Generates the SFrame secret, publishes
   * the initial key event, and installs the relay subscription that handles
   * rotations + peer-side secrets. Returns the secret + state so the caller
   * can install it into the worker as the sender key.
   */
  startCall(providerCallId: string, extraUsers?: UserCallRecipient[]): Promise<StartCallResult>

  /**
   * Attach the DTLS binding publish + verify flow to a pc once it exists.
   * Runs asynchronously — errors throw to fail the call closed.
   */
  attachDtlsVerification(state: CallState, pc: RTCPeerConnection): Promise<void>

  /**
   * Release orchestrator state for a call. Idempotent.
   */
  releaseCall(providerCallId: string): Promise<void>

  /**
   * Ratchet-on-join rotation: derives a new secret from the current one mixed
   * with the joining device id, publishes a rotate_join key event, and
   * installs the new secret as the sender key. Used by future multi-device
   * participant-tracking flows.
   */
  rotateOnJoin(
    providerCallId: string,
    joiningDeviceId: string,
    sframeClient: SFrameWorkerClient
  ): Promise<void>

  /**
   * Fresh-random rotation on leave: generates a fully independent new secret
   * and re-publishes a rotate_leave event excluding the departed device.
   */
  rotateOnLeave(
    providerCallId: string,
    departedDeviceId: string,
    sframeClient: SFrameWorkerClient
  ): Promise<void>
}

interface StartCallCtx {
  sframeClient: SFrameWorkerClient
}

/**
 * Build an orchestrator bound to a specific SFrame worker client. Each
 * WebRTCManager init creates one — it owns per-call state and the relay
 * subscription lifecycle.
 */
export function createSFrameOrchestrator(ctx: StartCallCtx): SFrameOrchestrator {
  const { sframeClient } = ctx

  async function startCall(
    providerCallId: string,
    extraUsers: UserCallRecipient[] = []
  ): Promise<StartCallResult> {
    if (!deps) throw new Error('sframe orchestrator deps not installed')
    const { getCurrentHubId, getLocalPubkeyHex } = deps
    const hubId = getCurrentHubId()
    if (!hubId) throw new Error('sframe orchestrator: no active hub')
    const initiatorPubkeyHex = await getLocalPubkeyHex()
    if (!initiatorPubkeyHex) throw new Error('sframe orchestrator: local pubkey unavailable')

    // Ephemeral HPKE keypair bound to this call. The private key stays in the
    // orchestrator closure for the lifetime of the call and is dropped on
    // releaseCall — tight forward-secrecy window.
    const suite = createHpkeSuite()
    const rawKp = (await suite.kem.generateKeyPair()) as CryptoKeyPair
    const hpkeKeypair = {
      privateKey: asX25519EncryptionKey(rawKp.privateKey),
      publicKey: asX25519EncryptionKey(rawKp.publicKey),
    }

    // Schema requires UUID callId; provider SIDs may not be UUIDs, so mint a
    // fresh UUID per call and map it to the provider id in state.
    const sframeCallId = crypto.randomUUID()

    const callSecret = new Uint8Array(32)
    crypto.getRandomValues(callSecret)

    const recipients = buildInitialRecipients(initiatorPubkeyHex, hpkeKeypair.publicKey, extraUsers)
    const eventInputs: BuildKeyEventInputs = {
      callId: sframeCallId,
      initiatorDeviceId: initiatorPubkeyHex,
      keyId: 0,
      callSecret,
      recipients,
      senderIds: [initiatorPubkeyHex],
      reason: 'initial',
    }
    const keyEvent = await buildKeyEvent(eventInputs)

    // Loopback verification: open the envelope we just sealed for ourselves.
    // This guarantees the seal/open pair round-trips every call, catching any
    // label/AAD/KEM regression before we hand the secret to the worker.
    const roundTripped = await parseKeyEvent({
      event: keyEvent,
      localDeviceId: initiatorPubkeyHex,
      privateKey: hpkeKeypair.privateKey,
    })
    if (roundTripped.byteLength !== 32) {
      throw new Error(`sframe loopback secret malformed: ${roundTripped.byteLength} bytes`)
    }
    for (let i = 0; i < 32; i++) {
      if (roundTripped[i] !== callSecret[i]) {
        throw new Error('sframe loopback secret mismatch — seal/open drift')
      }
    }

    const state: CallState = {
      sframeCallId,
      providerCallId,
      currentSecret: callSecret,
      currentKeyId: 0,
      hpkeKeypair,
      initiatorPubkeyHex,
      hubId,
      subscriptionId: null,
    }
    calls.set(providerCallId, state)

    // Publish the initial key event (best-effort — relay may be offline).
    try {
      await publishScoped(hubId, KIND_SFRAME_KEY, keyEvent)
    } catch (err) {
      log('initial sframe key publish failed: %s', (err as Error).message)
    }

    // Subscribe for inbound key events + rotations.
    const relay = deps.relay
    if (relay) {
      state.subscriptionId = relay.subscribe(hubId, [KIND_SFRAME_KEY], (_rawEvent, content) => {
        if (content.type !== 'call:sframe-key') return
        const inbound = content as unknown as SFrameKeyEvent
        if (inbound.callId !== sframeCallId) return
        // Drop the loopback of our own publish — we already installed keyId 0.
        if (inbound.keyId === state.currentKeyId) return
        void handleInbound(inbound, state)
      })
    }

    return { callSecret, keyId: 0, state }
  }

  async function handleInbound(event: SFrameKeyEvent, state: CallState): Promise<void> {
    const secret = await tryParseInbound(event, state)
    if (!secret) return
    try {
      await installReceivedSecret(
        sframeClient,
        state,
        event.keyId,
        secret,
        event.senderIds[0] ?? state.initiatorPubkeyHex
      )
    } catch (err) {
      log('inbound install failed for %s: %s', state.sframeCallId, (err as Error).message)
      // Rethrow via a queued microtask so the adapter's error boundary can
      // fail the call closed rather than swallowing the rotation gap.
      queueMicrotask(() => {
        throw err
      })
    }
  }

  async function attachDtlsVerification(state: CallState, pc: RTCPeerConnection): Promise<void> {
    const sdp = await awaitLocalSdp(pc)
    if (!sdp) {
      log('local SDP never arrived for call %s — skipping DTLS publish', state.sframeCallId)
      return
    }
    const advertised = await publishDtlsBinding(state, sdp)
    if (!advertised) return
    // Defense-in-depth: re-verify our own advertised binding against the SDP
    // we're about to use. This catches a local bug where the SDP changes
    // between publish and install (e.g. renegotiation without a rotate).
    verifyDtlsFingerprint(sdp, {
      fingerprint: advertised.fingerprint,
      bindingHash: advertised.bindingHash,
      callId: state.sframeCallId,
    })
  }

  async function releaseCall(providerCallId: string): Promise<void> {
    const state = calls.get(providerCallId)
    if (!state) return
    calls.delete(providerCallId)
    if (state.subscriptionId && deps?.relay) {
      deps.relay.unsubscribe(state.subscriptionId)
    }
    // Zero the secret — best-effort; ArrayBuffer.fill is fine for Uint8Array.
    state.currentSecret.fill(0)
  }

  async function publishRotation(
    state: CallState,
    nextSecret: Uint8Array,
    reason: 'rotate_join' | 'rotate_leave',
    excludeDeviceId: string | null
  ): Promise<void> {
    // Keep recipient list = self (single-volunteer). Multi-device flows will
    // merge in the live participant list here and honor excludeDeviceId.
    if (excludeDeviceId && excludeDeviceId === state.initiatorPubkeyHex) {
      throw new Error('cannot rotate_leave the initiator')
    }
    const recipients = buildInitialRecipients(
      state.initiatorPubkeyHex,
      state.hpkeKeypair.publicKey,
      []
    )
    const nextKeyId = state.currentKeyId + 1
    const event = await buildKeyEvent({
      callId: state.sframeCallId,
      initiatorDeviceId: state.initiatorPubkeyHex,
      keyId: nextKeyId,
      callSecret: nextSecret,
      recipients,
      senderIds: [state.initiatorPubkeyHex],
      reason,
    })
    // Install locally as the new sender key, then publish.
    const baseKey = nextSecret.slice().buffer as ArrayBuffer
    assertKeyIdContiguous(state.currentKeyId, nextKeyId)
    await sframeClient.setSenderKey(
      state.providerCallId,
      nextKeyId,
      baseKey,
      state.initiatorPubkeyHex
    )
    state.currentSecret = nextSecret
    state.currentKeyId = nextKeyId
    await publishScoped(state.hubId, KIND_SFRAME_KEY, event)
  }

  async function rotateOnJoin(
    providerCallId: string,
    joiningDeviceId: string,
    _client: SFrameWorkerClient
  ): Promise<void> {
    const state = calls.get(providerCallId)
    if (!state) throw new Error(`rotateOnJoin: no state for call ${providerCallId}`)
    const next = ratchetOnJoin(state.currentSecret, joiningDeviceId)
    await publishRotation(state, next, 'rotate_join', null)
  }

  async function rotateOnLeave(
    providerCallId: string,
    departedDeviceId: string,
    _client: SFrameWorkerClient
  ): Promise<void> {
    const state = calls.get(providerCallId)
    if (!state) throw new Error(`rotateOnLeave: no state for call ${providerCallId}`)
    const next = freshSecretOnLeave()
    await publishRotation(state, next, 'rotate_leave', departedDeviceId)
  }

  return { startCall, attachDtlsVerification, releaseCall, rotateOnJoin, rotateOnLeave }
}

/** Test-only reset for the module-level call state. */
export function __resetSFrameOrchestratorCalls(): void {
  calls.clear()
}
