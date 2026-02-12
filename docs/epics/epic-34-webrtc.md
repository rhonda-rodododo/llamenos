# Epic 34: WebRTC Volunteer Calling

## Problem
Volunteers can only answer calls via phone. WebRTC enables answering in-browser.

## Goals
1. Volunteers can answer calls directly in the browser via WebRTC
2. Call preference toggle: Phone / Browser / Both
3. Works with all telephony providers

## Architecture
- Provider-specific WebRTC SDKs (Twilio Client, SignalWire JS, JsSIP for Asterisk)
- New API route: `POST /api/telephony/webrtc-token` — generates provider-specific access token
- WebSocket messages: `call:webrtc-offer`, `call:webrtc-accept`
- Volunteer model: add `webrtcEnabled`, `callPreference` fields

## Files to Create
- `src/client/lib/webrtc.ts` — WebRTC client abstraction
- `src/client/components/webrtc-call.tsx` — In-browser call UI
- `src/worker/telephony/webrtc-tokens.ts` — Provider-specific token generation

## Files to Modify
- `src/worker/types.ts` — Volunteer type (webrtcEnabled, callPreference)
- `src/worker/services/ringing.ts` — WebRTC notification path
- `src/worker/routes/telephony.ts` — webrtc-token endpoint
- `src/client/routes/settings.tsx` — call preference toggle
- `src/client/routes/dashboard.tsx` — WebRTC call answer UI
- `src/client/lib/ws.ts` — handle WebRTC signaling messages

## Acceptance Criteria
- [ ] Volunteers can toggle call preference (phone/browser/both)
- [ ] WebRTC token generation works per provider
- [ ] Browser-based call answering works
- [ ] Call quality indicator displayed
- [ ] E2E tests for preference toggle
