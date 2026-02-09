# Next Backlog

## High Priority (Pre-Launch)
- [ ] Set up Cloudflare Tunnel for local dev with Twilio webhooks
- [ ] Configure production wrangler secrets (TWILIO_*, ADMIN_PUBKEY)
- [ ] Test full call flow end-to-end: incoming call -> CAPTCHA -> parallel ring -> answer -> notes -> hang up

## Security Audit Findings (Remaining)

### Medium
- [ ] Encrypt/hash note metadata (callId, authorPubkey) to prevent correlation analysis — *trade-off: breaks server-side filtering/grouping; notes content is already E2EE*

### Low / Future
- [ ] Add auto-lock/panic-wipe mechanism for device seizure scenarios
- [ ] SRI hashes for PWA service worker cached assets
- [ ] Consider re-auth step-up for sensitive actions (e.g., unmasking volunteer phone numbers)
- [ ] Auth token nonce-based replay protection (currently mitigated by HTTPS + Schnorr signatures + 5min window)

## Low Priority (Post-Launch)
- [ ] Add call recording playback in notes view
- [ ] Investigate SIP trunk integration as TelephonyAdapter alternative
- [ ] Add WebRTC-based in-browser calling for volunteers (no phone needed)
