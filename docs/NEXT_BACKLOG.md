# Next Backlog

## High Priority (Pre-Launch)
- [ ] Set up Cloudflare Tunnel for local dev with Twilio webhooks
- [ ] Configure production wrangler secrets (TWILIO_*, ADMIN_PUBKEY)
- [ ] Test full call flow end-to-end: incoming call -> CAPTCHA -> parallel ring -> answer -> notes -> hang up
- [ ] Fix E2E test isolation — local DO state accumulates between runs, causing stale data failures

## Security Audit Findings (Remaining)

### Critical / High
- [ ] Hash caller phone numbers before DO storage — plaintext numbers exposable via subpoena (use SHA-256 with salt for storage, compare by re-hashing on incoming calls)
- [ ] Hash phone numbers in ban list — same concern as above
- [ ] Move rate limiting from in-memory Map to Durable Object storage (current Map resets on Worker restart/deploy)
- [ ] Guard Twilio webhook validation against `ENVIRONMENT=development` misconfiguration in production

### Medium
- [ ] Encrypt/hash note metadata (callId, authorPubkey) to prevent correlation analysis
- [ ] Rate-limit or auth-gate invite validation endpoint (`GET /api/invites/validate/:code`) to prevent enumeration
- [ ] Hash IP addresses in audit log entries (or make retention configurable)
- [ ] Stop broadcasting volunteer pubkeys in presence updates to all connected users
- [ ] Remove plaintext pubkey from encrypted key-store localStorage entry
- [ ] Add notes export encryption (currently downloads decrypted plaintext JSON)
- [ ] Auto-clear clipboard after nsec/invite link copy (setTimeout + clipboard.writeText(''))

### Low / Future
- [ ] Add auto-lock/panic-wipe mechanism for device seizure scenarios
- [ ] SRI hashes for PWA service worker cached assets
- [ ] Consider re-auth step-up for sensitive actions (e.g., unmasking volunteer phone numbers)

## Medium Priority
- [ ] Implement proper session expiry UX (warning before timeout, re-auth prompt)
- [ ] Auth token nonce-based replay protection (currently mitigated by HTTPS + Schnorr signatures + 5min window)

## Low Priority (Post-Launch)
- [ ] Add call recording playback in notes view
- [ ] Investigate SIP trunk integration as TelephonyAdapter alternative
- [ ] Add WebRTC-based in-browser calling for volunteers (no phone needed)
