# Next Backlog

## High Priority (Pre-Launch)
- [ ] Set up Cloudflare Tunnel for local dev with Twilio webhooks
- [ ] Configure production wrangler secrets (TWILIO_*, ADMIN_PUBKEY)
- [ ] Test full call flow end-to-end: incoming call -> CAPTCHA -> parallel ring -> answer -> notes -> hang up
- [ ] Fix E2E test isolation — local DO state accumulates between runs, causing stale data failures
- [ ] **M3** Review login button color in light mode — solid black clashes with soft theme

## Medium Priority
- [ ] Implement proper session expiry UX (warning before timeout, re-auth prompt)
- [ ] Add volunteer phone number editing with E.164 live validation feedback
- [ ] Auth token nonce-based replay protection (currently mitigated by HTTPS + 5min window)

## Low Priority (Post-Launch)
- [ ] **L1** Add keyboard shortcuts help dialog
- [ ] **L2** Replace raw `<select>` with shadcn Select component in volunteer form
- [ ] **L3** Add confirmation dialogs for settings toggles that affect active operations
- [ ] **L6** Extend command palette to search notes and calls
- [ ] **L7** Add manual dismiss button to toast notifications
- [ ] Add call recording playback in notes view
- [ ] Investigate SIP trunk integration as TelephonyAdapter alternative
- [ ] Add WebRTC-based in-browser calling for volunteers (no phone needed)
