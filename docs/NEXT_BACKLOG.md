# Next Backlog

## High Priority (Pre-Launch)
- [ ] Set up Cloudflare Tunnel for local dev with Twilio webhooks
- [ ] Configure production wrangler secrets (TWILIO_*, ADMIN_PUBKEY)
- [ ] Test full call flow end-to-end: incoming call -> CAPTCHA -> parallel ring -> answer -> notes -> hang up
- [ ] Fix E2E test isolation — local DO state accumulates between runs, causing stale data failures

## Medium Priority
- [ ] Implement proper session expiry UX (warning before timeout, re-auth prompt)
- [ ] Add volunteer phone number editing with E.164 live validation feedback
- [ ] Auth token nonce-based replay protection (currently mitigated by HTTPS + 5min window)

## Low Priority (Post-Launch)
- [ ] Add call recording playback in notes view
- [ ] Investigate SIP trunk integration as TelephonyAdapter alternative
- [ ] Add WebRTC-based in-browser calling for volunteers (no phone needed)
