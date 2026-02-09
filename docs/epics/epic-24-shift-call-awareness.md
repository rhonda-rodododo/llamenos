# Epic 24: Shift & Call Status Awareness

## Problem
Volunteers and admins have no visibility into their shift schedule from the app. The dashboard "Current Shift" card only shows "Ready" / "On Break" / "On Call" — it doesn't tell you whether you're actually on shift, when your shift starts/ends, or when your next shift is. Additionally, when creating a note on the Notes page, the call ID must be manually selected even if you're actively on a call.

## Goals
1. Make shift status obvious throughout the app (sidebar + dashboard)
2. Show current shift times and next upcoming shift
3. Make active call status visible beyond just the dashboard
4. Auto-fill call ID in note creation when user is on an active call

## Changes

### Backend

#### New endpoint: `GET /shifts/my-status`
- Accessible to all authenticated users (not admin-only)
- Returns the current user's shift context:
  ```json
  {
    "onShift": true,
    "currentShift": { "name": "Evening", "startTime": "18:00", "endTime": "02:00" },
    "nextShift": { "name": "Morning", "startTime": "09:00", "endTime": "17:00", "day": 3 }
  }
  ```
- Implementation: Forward to ShiftManager DO with the user's pubkey
- ShiftManager DO: New route `GET /my-status?pubkey=<pubkey>` that:
  - Finds active shifts containing this pubkey (same logic as `getCurrentVolunteers`)
  - Finds next upcoming shift for this pubkey (scan all shifts, find nearest future day+time)

### Frontend

#### `src/client/lib/api.ts`
- Add `getMyShiftStatus()` function

#### `src/client/lib/hooks.ts`
- New `useShiftStatus()` hook:
  - Fetches shift status on mount and periodically (every 60s)
  - Returns `{ onShift, currentShift, nextShift, loading }`

#### Sidebar (`src/client/routes/__root.tsx`)
- Add shift status indicator below the user name/role line:
  - On shift: green dot + shift name + end time (e.g., "Evening — until 02:00")
  - Off shift: gray dot + next shift (e.g., "Next: Morning at 09:00")
- Add in-call indicator when `currentCall` is active:
  - Blue pulsing dot + "In Call" text

#### Dashboard (`src/client/routes/index.tsx`)
- Enhance the "Current Shift" status card:
  - Show shift name and time range when on shift
  - Show "Off Shift" + next shift info when not on shift
  - Keep existing break toggle behavior

#### Notes page (`src/client/routes/notes.tsx`)
- When user has an active call (`currentCall` from `useCalls()`):
  - Auto-fill `newNoteCallId` with `currentCall.id`
  - Show a hint: "Note will be attached to your active call"
- The `useCalls()` hook needs to be used on the notes page (currently only dashboard uses it)

#### Command Palette (`src/client/components/command-palette.tsx`)
- Show shift status in the palette header or as a status line

### i18n
- New keys: `shifts.onShift`, `shifts.offShift`, `shifts.nextShift`, `shifts.until`, `shifts.startsAt`, `dashboard.activeCallNote`
- Add to all 13 locale files

## Acceptance Criteria
- [ ] Sidebar shows green/gray dot indicating on-shift/off-shift status
- [ ] Sidebar shows current shift name + end time, or next shift name + start time
- [ ] Dashboard "Current Shift" card shows shift schedule info
- [ ] Notes page auto-fills call ID when user is on an active call
- [ ] Sidebar shows blue "In Call" indicator during active calls
- [ ] Shift status refreshes automatically (polling or WebSocket)
- [ ] All new strings translated in 13 locales
- [ ] E2E tests cover shift status display
