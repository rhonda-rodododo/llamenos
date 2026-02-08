# Next Backlog

## High Priority (Pre-Launch)
- [ ] Set up Cloudflare Tunnel for local dev with Twilio webhooks
- [ ] Test full call flow end-to-end: incoming call -> CAPTCHA -> parallel ring -> answer -> notes -> hang up
- [ ] Implement proper E2EE for transcriptions (currently stored as plaintext by system)
- [ ] Add Playwright E2E tests for login, volunteer management, call notes
- [ ] Set up wrangler deploy pipeline (manual for now)

## Medium Priority
- [ ] Implement proper session expiry UX (warning before timeout, re-auth prompt)
- [ ] Add confirmation dialogs for destructive actions (replace browser confirm())
- [ ] Add search/filter to call history page
- [ ] Add volunteer phone number editing with E.164 live validation feedback
- [ ] Add WebSocket reconnection with backoff on connection loss

## Low Priority (Post-Launch)
- [ ] Add dark/light theme toggle (currently dark only)
- [ ] Add more languages (German, etc.)
- [ ] Add call recording playback in notes view
- [ ] Add data export for GDPR compliance
- [ ] Investigate SIP trunk integration as TelephonyAdapter alternative
- [ ] Add WebRTC-based in-browser calling for volunteers (no phone needed)
