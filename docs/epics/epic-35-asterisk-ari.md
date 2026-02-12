# Epic 35: Asterisk ARI Adapter

## Problem
Cloud providers have per-minute costs. Self-hosted Asterisk with SIP trunks is cheaper at scale and more secure.

## Goals
1. ARI bridge service translates between Asterisk and CF Worker webhooks
2. Asterisk adapter in CF Worker handles bridge webhooks
3. Docker deployment for bridge alongside Asterisk

## Architecture
- Bridge runs on Asterisk VPS, connects via ARI WebSocket
- Translates ARI events → HTTP POST to CF Worker
- Receives HTTP responses → translates to ARI commands
- HMAC-SHA256 signed webhooks between bridge and CF Worker

## Files to Create
- `asterisk-bridge/` — separate project
  - `src/index.ts`, `src/ari-client.ts`, `src/webhook-sender.ts`, `src/command-handler.ts`
  - `Dockerfile`, `asterisk-config/` (sample configs)
- `src/worker/telephony/asterisk.ts` — Asterisk adapter

## Acceptance Criteria
- [ ] ARI bridge connects to Asterisk and forwards events
- [ ] Asterisk adapter implements TelephonyAdapter
- [ ] Bridge ↔ Worker communication secured with HMAC
- [ ] Docker deployment works
- [ ] Sample Asterisk configs provided
