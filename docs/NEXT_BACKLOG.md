# Next Backlog

## High Priority (Pre-Launch)
- [ ] Set up Cloudflare Tunnel for local dev with telephony webhooks
- [x] Configure production wrangler secrets (TWILIO_*, ADMIN_PUBKEY) — deployed and running
- [ ] Test full call flow end-to-end: incoming call -> CAPTCHA -> parallel ring -> answer -> notes -> hang up *(requires real phone + telephony account)*

## Security Audit Findings (Remaining)

### Medium
- [ ] Encrypt/hash note metadata (callId, authorPubkey) to prevent correlation analysis — *trade-off: breaks server-side filtering/grouping; notes content is already E2EE*

### Low / Future
- [ ] Add auto-lock/panic-wipe mechanism for device seizure scenarios
- [ ] SRI hashes for PWA service worker cached assets
- [ ] Consider re-auth step-up for sensitive actions (e.g., unmasking volunteer phone numbers)
- [ ] Auth token nonce-based replay protection (currently mitigated by HTTPS + Schnorr signatures + 5min window)

## Multi-Provider Telephony (Epics 32–36) — COMPLETE
- [x] Epic 32: Provider Configuration System (admin UI, API, DO storage, connection test)
- [x] Epic 33: Cloud Provider Adapters (SignalWire extends TwilioAdapter, Vonage, Plivo)
- [x] Epic 34: WebRTC Volunteer Calling (in-browser call answer, provider-specific SDKs)
- [x] Epic 35: Asterisk ARI Adapter (self-hosted SIP, ARI bridge service)
- [x] Epic 36: Telephony Documentation (provider comparison, setup guides, in-app help)

## Low Priority (Post-Launch)
- [ ] Add call recording playback in notes view
- [x] Marketing site + docs at llamenos-hotline.com (Astro + Cloudflare Pages)
