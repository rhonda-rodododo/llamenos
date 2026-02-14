# Epic 38: Extract Shared Voice Prompts

## Problem
Voice prompts (greeting, rateLimited, captchaPrompt, pleaseHold, waitMessage, voicemailPrompt, etc.) and IVR menu prompts are duplicated across 4 telephony adapters (Twilio, Vonage, Plivo, Asterisk). ~800 lines of identical multilingual strings.

## Solution
Create `src/shared/voice-prompts.ts` with all voice prompt data. Each adapter imports and uses it instead of maintaining its own copy.

## Shared Data
- `VOICE_PROMPTS` — all prompt types × 13 languages
- `VOICEMAIL_THANKS` — goodbye messages × 13 languages
- `IVR_PROMPTS` — language menu self-announcements × 10 languages
- `getPrompt(key, lang)` — helper with English fallback
- `getVoicemailThanks(lang)` — helper with English fallback

## Provider-Specific Data (stays in adapter)
- `VOICE_CODES` (Twilio/SignalWire TwiML voice codes)
- `VONAGE_VOICE_CODES` (Vonage NCCO voice names)
- `PLIVO_VOICE_CODES` (Plivo XML voice names)
- Provider-specific formatting (TwiML `<Say>`, NCCO `talk`, Plivo `<Speak>`)

## Files
- Create: `src/shared/voice-prompts.ts`
- Modify: `src/worker/telephony/twilio.ts` (remove prompts, import shared)
- Modify: `src/worker/telephony/vonage.ts` (remove prompts, import shared)
- Modify: `src/worker/telephony/plivo.ts` (remove prompts, import shared)
- Modify: `src/worker/telephony/asterisk.ts` (remove prompts, import shared)
