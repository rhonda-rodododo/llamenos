# Epic 37: Split Admin Settings Page

## Problem
`src/client/routes/admin/settings.tsx` is 1,135 lines with 17+ state variables handling 8 unrelated settings sections in a single component.

## Solution
Extract each settings section into its own component file under `src/client/components/admin-settings/`.

## Components to Extract
1. `PasskeyPolicySection.tsx` — WebAuthn require toggles
2. `TelephonyProviderSection.tsx` — Provider selection, credentials, WebRTC config, test/save
3. `TranscriptionSection.tsx` — Global toggle + volunteer opt-out
4. `IvrLanguagesSection.tsx` — Language enable/disable grid
5. `CallSettingsSection.tsx` — Queue timeout + voicemail max
6. `VoicePromptsSection.tsx` — Audio recorder grid per prompt type + language
7. `CustomFieldsSection.tsx` — Field CRUD, ordering, validation config
8. `SpamSection.tsx` — CAPTCHA + rate limiting toggles + settings

## Shared Interface
Each section component receives:
- `expanded: boolean`
- `onToggle: (open: boolean) => void`
- Section-specific state/handlers

The parent page retains: loading state, section expansion Set, deep-link scrolling, confirm dialog.

## Files
- Create: `src/client/components/admin-settings/*.tsx` (8 files)
- Modify: `src/client/routes/admin/settings.tsx` (shrink to ~150 lines)
