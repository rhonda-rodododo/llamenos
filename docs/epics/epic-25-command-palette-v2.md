# Epic 25: Command Palette Enhancements

## Problem
1. The command palette has a Language group with 13 languages, but language switching is infrequent — this clutters the palette and pushes useful actions down.
2. There's no way to quickly create a note from anywhere in the app without navigating to the Notes page.
3. The command palette doesn't support searching notes or calls (backlog item L6).

## Goals
1. Remove the Language group from the command palette
2. Add "Quick Note" action that opens an inline note dialog
3. Add note and call search to the palette

## Changes

### Remove Language Group
- Delete the Language `<CommandGroup>` from `command-palette.tsx`
- Remove the `Globe` import (if unused elsewhere)
- Remove `setLanguage` import
- Remove `LANGUAGES` import
- Language switching remains available in the sidebar (where it already exists)

### Quick Note Action
- Add a "New Note" command in the Actions group
- When selected: opens a small modal/dialog for note creation
  - If user has an active call (from `useCalls()`), auto-fill call ID
  - Otherwise, show a call ID input field
  - Textarea for note content
  - Save button that encrypts + creates note via API
  - On success: close dialog, show toast
- This reuses existing note creation logic from `notes.tsx`

#### Implementation
- New component: inline in `command-palette.tsx` or a separate `QuickNoteDialog` component
- Uses `encryptNote()` + `createNote()` from existing libs
- Needs access to `keyPair` from `useAuth()`
- Needs `currentCall` from `useCalls()` for auto-fill

### Search Notes & Calls (L6)
- Add a "Search" group that appears when user types in the palette
- Searches decrypted notes (client-side, from cached/recent notes)
- Shows matching notes with truncated preview
- Selecting a note navigates to `/notes?callId=<callId>&search=<query>`
- For calls (admin only): search call history, navigate to `/calls?q=<query>`

## Files to Modify
- `src/client/components/command-palette.tsx` — main changes
- `src/client/lib/api.ts` — if new search endpoints needed
- `src/client/locales/*.json` — new i18n keys for quick note dialog
- Remove `commandPalette.language` key from all locales (cleanup)

## Acceptance Criteria
- [ ] Language group removed from command palette
- [ ] "New Note" action appears in Actions group
- [ ] Quick note dialog opens with call ID auto-fill (if on active call)
- [ ] Quick note encrypts and saves via API
- [ ] Toast confirms note creation
- [ ] Note/call search results appear when typing in palette
- [ ] All new strings translated in 13 locales
- [ ] E2E test: open palette, create quick note
