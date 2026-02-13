# Epic 36: Telephony Provider Documentation

## Problem
Operators need comprehensive docs to choose and configure a telephony provider.

## Goals
1. Provider comparison page with pricing, features, security
2. Step-by-step setup guides per provider (en + es) for the doc site, linked to from the README
3. In-app help text in Telephony Provider settings
4. WebRTC additions to setup and usage guides
5. Simplify README to reference deployment info, and create a DEVELOPMENT.md to include development setup, so that README is simplified, and then create multiple translations of the README

## Files to Create
- `site/src/content/docs/en/telephony-providers.md` — comparison page
- `site/src/content/docs/en/setup-twilio.md`
- `site/src/content/docs/en/setup-signalwire.md`
- `site/src/content/docs/en/setup-vonage.md`
- `site/src/content/docs/en/setup-plivo.md`
- `site/src/content/docs/en/setup-asterisk.md`
- `site/src/content/docs/en/webrtc-calling.md`
- Spanish translations for all above
- Update where twilio information is hardcoded into all documentation, update security notices

## Acceptance Criteria
- [ ] Provider comparison page covers all 5 options
- [ ] Setup guides complete for each provider (en + es)
- [ ] In-app help text shows in settings section
- [ ] WebRTC guide covers browser compat and troubleshooting
- [ ] Site builds and deploys successfully
