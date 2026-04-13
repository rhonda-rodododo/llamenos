# Voice E2EE Browser Compatibility Matrix

Voice E2EE in Llamenos requires **`RTCRtpScriptTransform`** from the W3C WebRTC Encoded Transform specification. This API allows the SFrame worker to intercept encoded media frames before they reach the DTLS transport, encrypting them with a key the relay does not possess.

## Supported browsers

| Browser | Minimum Version | Notes |
|---|---|---|
| Chrome | 94+ | `RTCRtpScriptTransform` supported since 94. The older `createEncodedStreams()` API (Insertable Streams, origin trial) is deprecated and not used by Llamenos. |
| Edge | 94+ | Chromium-based, same engine as Chrome. Same minimum version applies. |
| Firefox | 117+ | `RTCRtpScriptTransform` supported since 117. Earlier versions had no encoded transform support. |
| Safari | 15.4+ | Partial support. `RTCRtpScriptTransform` is available but WebCodecs integration may require a polyfill depending on the specific operation. Test on target Safari versions before relying on E2EE in production. |

## Unsupported browsers

| Browser | Reason |
|---|---|
| Internet Explorer | No WebRTC support at all. |
| Opera Mini | Proxy-based rendering, no local WebRTC stack. |
| UC Browser | No `RTCRtpScriptTransform` support. |

## What happens on an unsupported browser

1. The SFrame worker client detects that `RTCRtpScriptTransform` is not available in the browser's `RTCRtpSender`/`RTCRtpReceiver` prototypes.
2. The `browser_unsupported` incident code is surfaced in the call UI.
3. Behavior depends on the hub's voice E2EE policy:
   - **`required`**: The call is refused. The volunteer sees an error explaining that their browser does not support voice E2EE and must upgrade.
   - **`preferred`**: A persistent fallback banner warns that the call is not end-to-end encrypted. The volunteer can choose to continue or hang up.
   - **`off`**: No change in behavior -- SFrame is not attempted regardless.

## Known quirks

- **Chrome `createEncodedStreams()`**: Chrome 86-93 shipped an earlier API called Insertable Streams (`RTCRtpSender.createEncodedStreams()`). This API is deprecated and Llamenos does not use it. If a user is on Chrome 86-93 (extremely unlikely), they will see the `browser_unsupported` fallback.
- **Safari WebCodecs**: Safari 15.4 added `RTCRtpScriptTransform` but certain WebCodecs APIs used by some SFrame implementations may behave differently. Llamenos uses `crypto.subtle` (AES-GCM) inside the worker, not WebCodecs for the AEAD, so this is not a blocking issue for basic SFrame operation. However, edge cases around `transferable` streams in Safari should be tested.
- **Firefox Worker scope**: Firefox's `RTCRtpScriptTransform` requires the transform function to be defined in a `DedicatedWorkerGlobalScope`. Llamenos already runs SFrame in a dedicated worker, so no special handling is needed.

## Recommended minimum versions for production

For the best experience with voice E2EE, recommend volunteers use:

- Chrome 100+ or Edge 100+
- Firefox 120+
- Safari 16.4+

These versions have stable `RTCRtpScriptTransform` implementations with fewer edge cases than the absolute minimum versions listed above.
