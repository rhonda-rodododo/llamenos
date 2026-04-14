# Voice End-to-End Encryption in Llamenos

## What it means

When a voice call between two WebRTC endpoints displays the **e2ee** badge, the audio is encrypted inside the browser before it leaves the device. The telephony relay (Asterisk, Twilio, or any other provider) forwards opaque ciphertext frames it cannot decrypt. Even with full server access, a seized disk, or a valid subpoena, the relay cannot reconstruct the audio.

This is achieved with **SFrame** (IETF `draft-ietf-sframe-enc`), a second AEAD encryption layer that sits above the standard DTLS-SRTP transport. Every call generates a fresh 32-byte random secret that is never persisted and is zeroed when the call ends.

## Badge states

The active call UI displays one of three badges:

| Badge | Meaning |
|---|---|
| `e2ee-direct` | Both endpoints are WebRTC browsers. Media flows peer-to-peer (no TURN relay). SFrame encryption is active. Highest assurance. |
| `e2ee-relayed` | Both endpoints are WebRTC browsers but media is relayed through a TURN server (coturn). SFrame encryption is still active -- coturn is a pure packet forwarder that cannot decrypt the frames. |
| `not-e2ee` | One leg of the call is a plain telephone (PSTN/GSM). The caller has no crypto endpoint. Audio on the PSTN leg is unencrypted. |

The badge component is `ActiveCallBadge.tsx`.

## Why PSTN calls cannot be E2EE

A caller dialing the hotline number on a regular phone uses the public switched telephone network. The phone itself has no browser, no WebRTC stack, and no cryptographic capability. The audio travels as an analog or circuit-switched digital signal to the telephony provider, which converts it to RTP for the volunteer's WebRTC session. There is no way to install an SFrame encryption endpoint on a GSM handset. This is an inherent limitation of the telephone system, not a gap in Llamenos.

For calls where both sides are WebRTC-capable (volunteer-to-volunteer, supervisor warm-transfer, internal conferences), SFrame encryption is applied and the badge reflects this.

## Hub admin policy

Admins configure the voice E2EE policy per hub:

| Policy | Behavior |
|---|---|
| `required` | Calls are refused if E2EE cannot be established. Use this when the threat model demands that no unencrypted voice data ever flows through the relay. PSTN inbound calls will be rejected. |
| `preferred` | If E2EE cannot be established (e.g., PSTN leg, unsupported browser), the volunteer sees a modal warning explaining the risk. They can choose to continue or hang up. This is the recommended default. |
| `off` | No SFrame encryption is attempted. All calls use standard DTLS-SRTP transport encryption only (hop-by-hop, relay can see audio). |

The policy is set in hub settings under the security section.

## Fallback banner

When a call is active and the policy is `preferred` but E2EE could not be established, a persistent banner appears at the top of the call UI. The banner explains:

- The call is **not** end-to-end encrypted
- The reason (PSTN leg, unsupported browser, or setup failure)
- The volunteer can hang up if the risk is unacceptable

The banner is not dismissible while the call is active.

## Incident codes

If something goes wrong during SFrame setup, the UI displays a specific incident code so the volunteer and admin can diagnose the issue:

| Code | Meaning | Action |
|---|---|---|
| `dtls_fingerprint_mismatch` | The DTLS fingerprint reported by the remote peer does not match the fingerprint published via the Nostr signaling channel. This could indicate a man-in-the-middle attack or a misconfigured relay. | The call is terminated immediately. Report to admin. |
| `sframe_setup_failed` | The SFrame key exchange or worker initialization failed. Possible causes: Web Worker creation blocked, HPKE key wrap failed, or the remote peer did not publish its SFrame key event in time. | If policy is `required`, the call is refused. If `preferred`, the fallback banner is shown. |
| `browser_unsupported` | The volunteer's browser does not support `RTCRtpScriptTransform`, which is required for SFrame. See the [browser compatibility matrix](VOICE_E2EE_BROWSER_MATRIX.md). | Upgrade the browser. If policy is `required`, the call is refused. |

## Cryptographic details

- **Per-call secret**: 32 bytes from `crypto.getRandomValues`, generated at call start, zeroed on `releaseCall`
- **Key derivation**: HKDF with `LABEL_SFRAME_BASE_KEY` info string derives per-sender base keys from the call secret
- **Cipher suite**: AES-128-GCM with SHA-256 (SFrame suite `AES_128_GCM_SHA256_128`)
- **Key distribution**: Per-call secret is HPKE-wrapped individually for each participant device and distributed via Nostr ephemeral events (`KIND_SFRAME_KEY = 20002`)
- **Fingerprint binding**: DTLS fingerprints are published and verified via Nostr ephemeral events (`KIND_DTLS_BINDING = 20003`)
- **Codec**: Opus only on SFrame-enabled contexts. G.711 transcoding is refused at codec negotiation.

## Design spec

For the full technical design, see: `docs/superpowers/specs/2026-04-10-security-tier-5-voice-e2ee-design.md`
