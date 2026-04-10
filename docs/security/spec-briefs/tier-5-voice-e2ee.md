# Tier 5 — Voice E2EE via SFrame (Spec Brief)

**Date:** 2026-04-10
**Master doc:** [`../SECURITY_IMPROVEMENTS_MASTER.md`](../SECURITY_IMPROVEMENTS_MASTER.md) §3.5.4 (state of the art), §3.7 (Jitsi), §7 Tier 5
**Effort:** Weeks
**Depends on:** Tier 1 (HPKE for key distribution), partial Tier 3 (per-device keys give cleaner per-participant key targets)
**Status:** Ready for spec authoring

## Goal

Ship **end-to-end encrypted voice calls** that work through Llamenos' Asterisk-based SIP bridge by implementing **SFrame via `RTCRtpScriptTransform`** — the same pattern Jitsi Meet, Google Meet, Cisco Webex Zero-Trust, Wire, and Discord DAVE use in production.

After this tier, a volunteer-caller voice call is genuinely E2EE: Asterisk can see the RTP header metadata (SSRC, timestamps) and can forward frames between the two participants, but cannot decrypt the actual audio payload. Even if Asterisk is subpoenaed, seized, or compromised, the call content remains confidential.

**This is the single most differentiating feature in the entire roadmap.** A crisis hotline with a self-hosted SIP bridge AND end-to-end encrypted calls is genuinely novel — no other hotline platform has this.

## Why this matters

**The fundamental problem:** WebRTC's built-in encryption (DTLS-SRTP) is **hop-by-hop** when any media-terminating middlebox is in the path. Asterisk as a B2BUA terminates DTLS-SRTP on each leg — it holds the DTLS keys and re-encrypts on the other side. The audio passes through Asterisk in plaintext during this translation.

For Llamenos' routing model (volunteer's browser ↔ Asterisk ↔ caller's GSM phone) we can never get E2EE *all the way* to the caller — the caller is on a plain phone, no crypto. But we CAN get E2EE between the volunteer and any *other* end that speaks WebRTC (warm-transfer to a supervisor, internal volunteer-to-volunteer conferences, group calls, and — in the future — caller apps that support it).

**Three escape-hatch options exist:**
1. **DTLS fingerprint binding for peer-to-peer 1:1.** If Asterisk can be configured to NOT terminate media (media passthrough, directmedia=yes), DTLS-SRTP becomes genuinely end-to-end between volunteer and the other WebRTC endpoint. This is the Signal model. Works but fragile against NAT + requires TURN fallback which introduces its own relay.
2. **SFrame (`draft-ietf-sframe-enc`) via `RTCRtpScriptTransform`.** Add a SECOND AEAD layer on top of DTLS-SRTP, intercepting encoded media frames in the browser before they hit the DTLS transport. Asterisk still terminates DTLS-SRTP; it sees opaque ciphertext frames. This is the Jitsi/Wire/Webex pattern.
3. **MLS-keyed SFrame** (Tier 6 forward reference). SFrame base key derived from an MLS `exporter_secret`. Gives continuous post-compromise security.

**We ship option 2 in Tier 5** with a migration path to option 3 in Tier 6.

## Current Llamenos state

**Files to touch:**
- `src/client/lib/telephony/sip-webrtc-adapter.ts` (or wherever JsSIP integration lives) — add the encoded transform hook.
- `src/client/lib/telephony/` — any WebRTC-related client code.
- `src/client/lib/sframe-worker.ts` (new) — dedicated Web Worker for SFrame AEAD operations.
- `src/client/lib/sframe-key-manager.ts` (new) — per-call key generation + distribution + rotation.
- `src/server/services/call-router-service.ts` (or equivalent) — Asterisk coordination.
- `src/server/telephony/` — SIP/asterisk adapter code.
- `deploy/ansible/` — Asterisk config updates for media passthrough where possible.
- `asterisk-bridge/` — Asterisk Bridge Docker image + ARI config.
- Nostr relay — used as the signaling channel for SFrame key distribution.

**Existing patterns:**
- `SipWebRTCAdapter` wraps JsSIP UA for SIP-over-WSS signaling + browser DTLS-SRTP media.
- Asterisk provisioned via `AsteriskProvisioner` → sip-bridge → ARI dynamic config.
- coturn TURN relay for NAT traversal with time-limited HMAC credentials.
- Caddy terminates TLS and proxies WSS to Asterisk.
- JsSIP `newRTCSession` fires for both incoming and outgoing; check `originator === 'remote'`.
- Nostr relay (strfry) runs ephemeral kind 20001 events, hub-key-encrypted.

**Watch-outs:**
- JsSIP `reloadModule('res_pjsip.so')` disrupts ALL active SIP sessions — avoid during live calls.
- Asterisk WSS requires TLS — in production Caddy proxies WSS→WS.
- Memory sorcery wizard pattern makes dynamic config effective immediately.

## Proposed approach

### 5.1. Phase 1 — DTLS fingerprint binding for 1:1 peer-to-peer

**Low-hanging fruit.** For volunteer-to-volunteer or volunteer-to-supervisor 1:1 calls where both endpoints are browsers and Asterisk can be configured for media passthrough:

1. Configure Asterisk for `directmedia=yes` + RTP passthrough for the relevant dialplan contexts.
2. Fall back to coturn TURN relay for NAT traversal; coturn is a pure packet forwarder and does not terminate DTLS.
3. When the call sets up, each browser's DTLS certificate fingerprint is extracted via `RTCPeerConnection.getLocalCertificates()`.
4. Each browser publishes its fingerprint to a per-call hub-key-encrypted Nostr event (kind 20003 or similar), signed by its device Ed25519 key.
5. The other browser fetches the Nostr event, verifies the signature, and compares the DTLS fingerprint to what its peer claims via SDP.
6. If the SDP fingerprint doesn't match the Nostr-asserted fingerprint → MITM detected → fail loud.

**Result:** for that topology, DTLS-SRTP is genuinely end-to-end (no middlebox holds keys) and the fingerprint binding defends against Asterisk or a compromised SIP proxy injecting a MITM.

**Reality check:** Volunteer-to-caller calls (the primary Llamenos use case) almost always require media to pass through Asterisk for PSTN conversion. Phase 1 applies to *secondary* use cases: warm transfers, supervisor listen-in, volunteer conferences, internal coordination. Phase 2 covers the primary use case.

### 5.2. Phase 2 — SFrame via `RTCRtpScriptTransform`

**The main event.** For calls where media passes through Asterisk (or any B2BUA / SFU), add a second AEAD layer above DTLS-SRTP that Asterisk cannot decrypt.

**Mechanism:**

```typescript
// In the UI / main thread, when setting up a peer connection:
const pc = new RTCPeerConnection(iceConfig)

// For each sender:
pc.getSenders().forEach((sender) => {
  if (sender.track?.kind === 'audio') {
    // @ts-ignore - RTCRtpSender.transform is a newer API
    sender.transform = new RTCRtpScriptTransform(sframeWorker, {
      direction: 'outbound',
      callId,
      deviceId: ownDeviceId,
    })
  }
})

// For each receiver:
pc.getReceivers().forEach((receiver) => {
  if (receiver.track?.kind === 'audio') {
    // @ts-ignore
    receiver.transform = new RTCRtpScriptTransform(sframeWorker, {
      direction: 'inbound',
      callId,
    })
  }
})
```

Inside the `sframeWorker`:

```typescript
// sframe-worker.ts (runs in a dedicated Web Worker)
onrtctransform = (event) => {
  const { readable, writable, options } = event.transformer
  const { direction, callId, deviceId } = options

  const transformer = new TransformStream({
    async transform(encodedFrame, controller) {
      if (direction === 'outbound') {
        const sealed = await sframeSeal(encodedFrame.data, callId, deviceId, frameCounter++)
        encodedFrame.data = sealed
      } else {
        const plain = await sframeOpen(encodedFrame.data, callId)
        encodedFrame.data = plain
      }
      controller.enqueue(encodedFrame)
    }
  })

  readable.pipeThrough(transformer).pipeTo(writable)
}
```

**SFrame AEAD details (JFrame-compatible format for Jitsi interop down the line):**
- AEAD: **AES-GCM-128** (spec calls for GCM; 128-bit is fast and sufficient for per-frame).
- Key: 16 bytes, per-call, per-sender generation (the sender's "SFrame key").
- Nonce: **96-bit IV** derived from `SSRC || RTP timestamp || frame counter`. Unique per key.
- AAD: RTP header metadata that must remain cleartext-but-authenticated (SSRC, seq, timestamp, optionally payload-type).
- Frame format: SFrame header (Key ID + counter) + ciphertext + GCM tag. **Opus TOC byte and VP8 payload header stay in plaintext** so Asterisk can still make forwarding/codec decisions.
- Alternative: a trailer format (Jitsi JFrame) — decide between header and trailer. Header is simpler; trailer avoids some RTP parser headaches. Pick one and document.

**What Asterisk sees:**
- RTP header with correct SSRC, sequence, timestamp.
- Opus TOC byte (unchanged).
- SFrame header/trailer with opaque key ID.
- 16-byte GCM tag.
- Encrypted audio payload.

Asterisk's forwarding logic works unchanged. It still does jitter buffering, NACK handling, and bandwidth estimation based on RTP headers. It cannot hear the audio.

**Codec compatibility:** Opus is the happy path. G.711/G.722 legacy codecs used for PSTN compat are NOT SFrame-transparent because they have no "payload header" separation — the entire payload is audio samples. For calls that require G.711 transcoding in Asterisk, SFrame cannot be applied (Asterisk needs plaintext to transcode). **For those calls, E2EE is not achievable through the Asterisk path — document explicitly.**

### 5.3. Key distribution

**Per-call random key, HPKE-wrapped per participant device.** Reuses our existing per-note pattern.

**Flow:**
1. Call initiator generates a random 32-byte "call secret".
2. HKDF the call secret → SFrame base keys: `sframe_key_volunteer_device = HKDF(call_secret, "sframe" || volunteer_device_id)`, same for each participant device.
3. HPKE-wrap the call secret to each participant's X25519 device pubkey (from Tier 3) with `info = LABEL_VOICE_CALL_KEY`.
4. Publish the wrapped envelopes to per-call hub-key-encrypted Nostr events (kind 20004).
5. Each participant's client opens the HPKE envelope, derives their SFrame key, passes it to the SFrame worker.
6. Call proceeds with E2EE audio.

**Rotation on leave:** For multi-party calls, when a participant drops, the remaining participants generate a new call secret and redistribute. Old participant cannot derive the new key.

**Rotation on join:** HKDF-ratchet the existing call secret forward. The joining participant gets the *new* key and cannot decrypt historical frames. This is the Jitsi pattern.

**Nonce management:** The 96-bit IV formula (`SSRC || timestamp || counter`) must never repeat for the same key. The counter is per-sender, per-key, monotonic.

### 5.4. DTLS fingerprint binding as a prerequisite

**Even with SFrame in place**, we still want to verify that the DTLS-SRTP leg isn't being MITM'd by Asterisk or some other middlebox — because if the attacker can substitute their own DTLS fingerprint and inject a modified SFrame header, they might be able to force the SFrame layer to fail-open or DoS. So Phase 1's fingerprint binding is still valuable as defense in depth.

Combine:
- SFrame AEAD provides content confidentiality.
- DTLS fingerprint binding via Nostr-signed events detects transport-layer MITM.
- Per-call random key HPKE-wrapped per device prevents replay across calls.

### 5.5. Asterisk / infrastructure changes

- **Dialplan:** no change for SFrame calls — Asterisk's RTP forwarding is codec-payload-transparent.
- **Codec negotiation:** force Opus-only on SFrame-enabled contexts. Reject G.711 negotiation unless explicitly configured.
- **Recording:** Asterisk-side call recording is fundamentally incompatible with SFrame E2EE (it records opaque ciphertext). For hub admin recording features (if they exist), either (a) client-side record the decrypted audio and upload encrypted, or (b) document that recording is disabled for E2EE calls. Decide.
- **Metadata:** Asterisk still logs call duration, participants, start/stop times. Not content. Log minimization is separate work.

### 5.6. UI / UX

- **E2EE badge:** when SFrame is active, show a persistent "End-to-end encrypted" badge in the call UI.
- **Fallback warning:** if a call falls back to non-E2EE (e.g., G.711 PSTN leg), show a clear warning.
- **Fingerprint verification:** for internal volunteer-to-volunteer 1:1, optionally show a short hash (6 emoji or 4 decimal groups) for SAS-style verification.
- **No mic/cam access:** SFrame does not affect microphone/camera access prompts — they work as before.

## Open design questions

1. **SFrame format: header or trailer?** Jitsi uses a trailer (easier for some RTP parsers); the IETF draft uses a header. Decide based on browser/Asterisk RTP parser compatibility.
2. **AES-GCM-128 vs AES-GCM-256 vs AES-CTR+HMAC-SHA256?** GCM-128 is fastest; GCM-256 is conservative; CTR+HMAC avoids some nonce-reuse concerns. Recommend GCM-128 (Jitsi choice) — fast, sufficient, native WebCrypto support.
3. **G.711 fallback.** Accept that E2EE is only available for Opus-capable legs, or spend effort on alternative transports? Recommend document + accept; E2EE to a phone caller is impossible without app-side crypto on the phone.
4. **SAS verification for 1:1.** Worth the UI cost? Recommend optional per-hub setting.
5. **Recording compatibility.** Decide whether to disable Asterisk recording for SFrame calls or offer client-side recording with upload-to-RustFS path (separate encryption path).
6. **Key distribution channel.** Nostr events (hub-key-encrypted) vs SIP INFO messages vs custom WebSocket messages? Recommend Nostr events — we already have authenticated hub-key channels.
7. **Call metadata minimization.** Asterisk logs vs encrypted audit log in our DB — document what's retained and for how long.
8. **Browser compatibility.** `RTCRtpScriptTransform` support: Chrome/Edge stable, Firefox 115+, Safari 17+. Test matrix. Document fallback behavior for unsupported browsers.
9. **Codec negotiation UX.** If the caller's client doesn't support Opus, do we route via G.711 and show "not E2EE" or refuse the call?
10. **Interop with Jitsi (far future).** If we want to bridge into Jitsi rooms someday, JFrame format compatibility matters. Recommend align with Jitsi's format where possible.

## Concrete scope

**In scope:**
- SFrame AEAD implementation in a dedicated Web Worker (`sframe-worker.ts`).
- `RTCRtpScriptTransform` integration in the JsSIP adapter.
- Per-call random key generation + HPKE wrap per participant device.
- Nostr event schema for SFrame key distribution (new kind).
- DTLS fingerprint binding via signed Nostr events.
- SAS verification UI (optional).
- Asterisk config audit for media passthrough support where applicable.
- Codec negotiation enforcement (Opus preferred).
- Call UI: E2EE badge, fallback warning.
- Browser compatibility test matrix.
- Unit tests: SFrame encrypt/decrypt roundtrip; nonce uniqueness; key rotation.
- API tests: HPKE envelope for call keys.
- UI tests: call setup with E2EE badge visible.

**Out of scope:**
- MLS-keyed SFrame (Tier 6).
- Caller-app E2EE (caller on GSM can't be E2EE, period).
- Video E2EE (Llamenos is voice-only for MVP; the pattern extends trivially if video is added).
- Call recording with client-side encryption (separate spec).
- Asterisk recording engine changes.

## Success criteria

1. Volunteer-to-volunteer 1:1 call in the browser is E2EE via SFrame; Asterisk logs show only ciphertext RTP payloads.
2. Simulated Asterisk compromise (tcpdump on the bridge) confirms no plaintext audio.
3. Call fingerprint verification detects a simulated DTLS MITM.
4. Key rotation on participant join/leave works.
5. E2EE badge displayed during the call.
6. Fallback to non-E2EE for G.711 calls is explicit and UI-warned.
7. Browser compatibility test passes on Chrome, Firefox, Safari latest.
8. No increase in call setup latency beyond 200ms (measure).
9. All existing telephony tests pass.
10. Typecheck + build + lint clean.

## Trade-offs and anti-patterns

**Do:**
- Use `RTCRtpScriptTransform` (the modern API), not the deprecated Insertable Streams.
- Run SFrame in a dedicated Web Worker to not block the main thread.
- Leave RTP headers + codec payload headers (Opus TOC, VP8) in plaintext so Asterisk can still route.
- Use a per-call random key — don't derive from the hub key directly (cross-call forward secrecy).
- Verify DTLS fingerprints via an authenticated signaling channel (our Nostr relay).
- Show clear E2EE status in the UI; never hide a fallback.

**Don't:**
- Try to replace DTLS-SRTP entirely. The browser stack won't let you.
- Attempt SFrame on transcoded G.711 legs. It won't work.
- Share SFrame keys across calls. Fresh key per call.
- Let Asterisk record E2EE calls. It'd just store ciphertext.
- Promise "all calls are E2EE" in marketing — be specific about volunteer-to-volunteer vs volunteer-to-caller.
- Derive SFrame keys from the DTLS key material. They must be independent.

## Pointers to primary sources

**Must read:**
- SFrame IETF draft: https://datatracker.ietf.org/doc/draft-ietf-sframe-enc/
- MLS + SFrame IETF draft: https://datatracker.ietf.org/doc/draft-barnes-sframe-mls/
- Jitsi Meet E2EE docs (the reference implementation): https://github.com/jitsi/lib-jitsi-meet/blob/master/doc/e2ee.md
- Jitsi E2EE PDF: https://jitsi.org/wp-content/uploads/2021/08/jitsi-e2ee-1.0.pdf
- Wire E2EE calls: https://wire.com/en/blog/messaging-layer-security-mls-explained
- Cisco Webex zero-trust whitepaper: https://www.cisco.com/c/en/us/solutions/collateral/collaboration/white-paper-c11-744553.html
- WebRTC Encoded Transforms API: https://w3c.github.io/webrtc-encoded-transform/
- RFC 8827 WebRTC Security Architecture: https://datatracker.ietf.org/doc/html/rfc8827

**Optional:**
- Discord DAVE protocol writeup: https://daveprotocol.com/
- Google Meet E2EE Tech Brief (where published)

## Related work in the repo

- Tier 1 — HPKE for key distribution.
- Tier 3 — per-device keys for per-participant SFrame targets.
- `src/server/telephony/` — existing telephony adapters.
- `docs/epics/` — any existing voice epic.
- `asterisk-bridge/` — Asterisk config.
- Nostr relay (strfry) — key distribution channel.
- JsSIP integration — the existing SIP WebRTC adapter.
- `src/client/lib/crypto-worker-client.ts` — pattern for cross-thread RPC (mirror for SFrame worker).
