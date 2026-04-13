/**
 * SFrame hook types — shared across WebRTC adapters.
 *
 * A `SFramePeerConnectionHook` is invoked by each adapter as soon as the
 * underlying `RTCPeerConnection` for an incoming (or outgoing) call becomes
 * available. The hook is expected to install SFrame encoded-frame transforms
 * on the pc's senders/receivers and to verify the DTLS fingerprint binding.
 *
 * Adapters stay oblivious to SFrame itself — they only forward the pc and a
 * small context blob. The orchestration state machine (key distribution,
 * key-event waiting, ratchet-on-join etc.) lives outside the adapters and is
 * validated end-to-end by the Workstream 5.9 UI E2E tests.
 */
export type SFramePeerConnectionHook = (
  pc: RTCPeerConnection,
  ctx: { callId: string; direction: 'inbound' | 'outbound' }
) => void | Promise<void>

/** Constructor options shared by every WebRTC adapter that supports SFrame. */
export interface SFrameCapableAdapterOptions {
  /**
   * Optional SFrame installation hook. When provided, the adapter will invoke
   * it as soon as the RTCPeerConnection is available for an inbound call so
   * SFrame transforms can be installed before the first media frame flows.
   *
   * When omitted, the adapter behaves exactly as before — no SFrame wiring.
   */
  sframeHook?: SFramePeerConnectionHook
}
