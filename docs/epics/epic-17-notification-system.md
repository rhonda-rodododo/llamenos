# Epic 17: Notification System

## Problem
Volunteers have no audio or visual alert when an incoming call arrives. The UI shows a green card, but if the tab is backgrounded or the volunteer is looking away, they will miss the call. For a crisis hotline, missed calls can have serious consequences.

## Goal
Volunteers receive clear audio and visual notifications for incoming calls, with configurable settings.

## Scope

### Audio Ringtone
- Play a looping ringtone sound when WebSocket delivers a `call_ringing` event
- Stop ringtone when call is answered, missed, or cancelled
- Use Web Audio API or `<audio>` element with a bundled ringtone file
- Volume: system default (no custom volume control needed)

### Browser Tab Indicators
- Flash the document title between "Llámenos" and "Incoming Call!" while ringing
- Update favicon to show a red/green badge dot during ringing
- Reset on answer/dismiss

### Browser Notifications (Optional)
- Request Notification permission on first login (one-time prompt)
- Show browser notification with caller info when call rings
- Click notification → focus the tab
- Respect system Do Not Disturb

### Volunteer Settings
- Add to Settings page: "Call Notifications" section
- Toggle: "Play ringtone for incoming calls" (default: on)
- Toggle: "Show browser notifications" (default: on)
- Store in volunteer profile (localStorage for immediate, API for persistence)

## Files to Modify
- `src/client/lib/ws.ts` — trigger notification on call_ringing event
- `src/client/lib/notifications.ts` — new module for audio + browser notification logic
- `src/client/routes/settings.tsx` — notification preference toggles
- `src/client/routes/index.tsx` — title flashing during active ringing
- `public/ringtone.mp3` (or `.ogg`) — bundled ringtone asset

## Acceptance Criteria
- [ ] Audio plays when call rings, stops when answered/missed
- [ ] Tab title flashes during ringing
- [ ] Browser notification shows (if permission granted)
- [ ] Volunteer can mute ringtone in settings
- [ ] No audio plays when volunteer is on break
- [ ] Works in background tabs
- [ ] E2E test: verify notification toggle appears in settings
