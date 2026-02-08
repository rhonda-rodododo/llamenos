# Next Backlog

## High Priority (Pre-Launch)
- [ ] Set up Cloudflare Tunnel for local dev with Twilio webhooks
- [ ] Test full call flow end-to-end: incoming call -> CAPTCHA -> parallel ring -> answer -> notes -> hang up
- [ ] Implement proper E2EE for transcriptions (currently stored as plaintext by system)
- [ ] Add Playwright E2E tests for login, volunteer management, call notes
- [ ] Set up wrangler deploy pipeline (manual for now)

## Medium Priority
- [ ] Add call history page for admins with search/filter
- [ ] Add volunteer phone number validation (E.164 format)
- [ ] Add error toast notifications (replace silent catch blocks)
- [ ] Add loading skeletons for all pages
- [ ] Implement proper session expiry and refresh
- [ ] Add volunteer availability toggle (go on-break without leaving shift)

## Low Priority (Post-Launch)
- [ ] Add dark/light theme toggle (currently dark only)
- [ ] Add more languages (German, etc.)
- [ ] Add call recording playback in notes view
- [ ] Add data export for GDPR compliance
- [ ] Investigate SIP trunk integration as TelephonyAdapter alternative
- [ ] Add WebRTC-based in-browser calling for volunteers (no phone needed)
