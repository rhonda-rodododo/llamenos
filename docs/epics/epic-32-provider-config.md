# Epic 32: Provider Configuration System

## Problem
Llámenos only supports Twilio. Admins need to select and configure alternative telephony providers (SignalWire, Vonage, Plivo, Asterisk) from the settings UI.

## Goals
1. Admin can select a telephony provider and configure credentials from settings
2. Provider config persists in SessionManagerDO
3. `getTelephony()` becomes async and reads provider config to instantiate the correct adapter
4. Twilio env vars remain as fallback when no config is saved
5. Connection test validates credentials before saving

## Types
- `TelephonyProviderType`: `'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk'`
- `TelephonyProviderConfig`: Provider-specific credential fields

## Architecture
- Provider config stored as `settings:telephony-provider` in SessionManagerDO
- GET/PATCH `/api/settings/telephony-provider` (admin only)
- POST `/api/settings/telephony-provider/test` — validates creds
- `getTelephony(env)` → `getTelephony(env, dos)` (async, reads config)
- Audit event: `telephonyProviderChanged`

## Files to Modify
- `src/shared/types.ts` — add TelephonyProviderConfig, TelephonyProviderType
- `src/worker/types.ts` — keep TWILIO_* as fallback
- `src/worker/lib/do-access.ts` — refactor getTelephony() to async
- `src/worker/routes/settings.ts` — add telephony-provider routes
- `src/worker/durable-objects/session-manager.ts` — handle settings:telephony-provider
- `src/worker/routes/telephony.ts` — update all getTelephony() calls
- `src/worker/services/ringing.ts` — update getTelephony() call
- `src/worker/services/transcription.ts` — update getTelephony() calls
- `src/client/routes/settings.tsx` — add Telephony Provider section (admin only)
- `src/client/lib/api.ts` — add telephony provider API functions
- `src/client/locales/*.json` — new i18n keys (13 locales)

## Acceptance Criteria
- [ ] Admin can select provider from dropdown (twilio/signalwire/vonage/plivo/asterisk)
- [ ] Credential form changes based on selected provider
- [ ] Config saves to DO and survives restart
- [ ] Twilio env vars used as fallback when no config saved
- [ ] Connection test endpoint validates creds
- [ ] Audit log records provider changes
- [ ] All getTelephony() call sites updated to async
- [ ] E2E tests cover provider selection and config persistence
- [ ] Type check passes
