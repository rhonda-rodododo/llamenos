# Epic 33: Cloud Provider Adapters (SignalWire, Vonage, Plivo)

## Problem
Only Twilio is implemented. Need adapters for SignalWire, Vonage, and Plivo.

## Goals
1. SignalWire adapter extends TwilioAdapter (Twilio-compatible API)
2. Vonage adapter implements TelephonyAdapter with NCCO (JSON) responses
3. Plivo adapter implements TelephonyAdapter with Plivo XML

## Architecture

### SignalWire (`src/worker/telephony/signalwire.ts`)
- Extends TwilioAdapter, overrides base URL and auth
- Base URL: `https://{space}.signalwire.com`
- Auth: Project ID + API Token
- TwiML responses work identically

### Vonage (`src/worker/telephony/vonage.ts`)
- Different response format: NCCO (JSON array)
- `talk` instead of `<Say>`, `input` instead of `<Gather>`, `connect` instead of `<Dial>`
- Auth: API Key + Secret, or JWT with Application ID + Private Key

### Plivo (`src/worker/telephony/plivo.ts`)
- XML responses with different tags
- `<Speak>` instead of `<Say>`, `<GetDigits>` instead of `<Gather>`
- Auth: Auth ID + Auth Token

## Files to Create
- `src/worker/telephony/signalwire.ts`
- `src/worker/telephony/vonage.ts`
- `src/worker/telephony/plivo.ts`

## Files to Modify
- `src/worker/lib/do-access.ts` — factory switch on provider type
- `src/worker/telephony/twilio.ts` — make some methods protected for SignalWire inheritance

## Acceptance Criteria
- [ ] SignalWire adapter extends TwilioAdapter with URL/auth overrides
- [ ] Vonage adapter implements full TelephonyAdapter with NCCO
- [ ] Plivo adapter implements full TelephonyAdapter with Plivo XML
- [ ] Factory in do-access.ts instantiates correct adapter
- [ ] Type check passes
