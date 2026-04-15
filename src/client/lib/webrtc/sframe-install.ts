import type { SFrameTransformOptions, SFrameWorkerClient } from './sframe-worker-client.js'

/**
 * Minimal subset of `SFrameWorkerClient` the installer actually needs. The
 * full client is not required here — this lets tests inject a stub and lets
 * the installer work with any object exposing `buildTransform`.
 */
interface TransformFactory {
  buildTransform: (options: SFrameTransformOptions) => unknown
}

interface InstallSFrameInputs {
  callId: string
  senderId: string
  /** null when feature-detect said SFrame is unsupported — the installer
   *  throws `sframe_unsupported` so callers can branch to the fallback modal. */
  sframeClient: TransformFactory | SFrameWorkerClient | null
  codecHeaderLength?: number
}

/**
 * Install SFrame transforms on both directions of a peer connection:
 *   - outbound: existing audio senders
 *   - inbound: audio receivers (installed on the next `track` event)
 *
 * Video senders/receivers are NOT wrapped — this is audio-only.
 *
 * Throws `sframe_unsupported` when `sframeClient` is null (feature-detect
 * failure path). Callers must catch and present the fallback consent modal.
 */
export function installSFrameTransforms(pc: RTCPeerConnection, inputs: InstallSFrameInputs): void {
  if (!inputs.sframeClient) throw new Error('sframe_unsupported')
  const client = inputs.sframeClient
  const codecHeaderLength = inputs.codecHeaderLength ?? 0

  // Outbound senders already attached
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'audio') continue
    // biome-ignore lint/suspicious/noExplicitAny: RTCRtpSender.transform is a new API not in lib.dom yet
    ;(sender as any).transform = client.buildTransform({
      direction: 'outbound',
      callId: inputs.callId,
      senderId: inputs.senderId,
      codecHeaderLength,
    })
  }

  // Inbound: each track event installs a transform on its receiver
  pc.addEventListener('track', (ev: Event) => {
    const trackEv = ev as RTCTrackEvent
    if (trackEv.track.kind !== 'audio') return
    const transform = client.buildTransform({
      direction: 'inbound',
      callId: inputs.callId,
      codecHeaderLength,
    })
    // biome-ignore lint/suspicious/noExplicitAny: RTCRtpReceiver.transform is a new API not in lib.dom yet
    ;(trackEv.receiver as any).transform = transform
  })
}
