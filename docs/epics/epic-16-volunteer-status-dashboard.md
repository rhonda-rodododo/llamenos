# Epic 16: Real-Time Volunteer Status & Admin Dashboard

## Problem
Admins have no visibility into volunteer availability. The dashboard shows active calls but not who is available, on break, or offline. During a crisis, the admin needs a real-time roster to understand capacity. Additionally, the "Calls Today" metric is hardcoded to "-" with no backend support.

## Goal
Admins see a real-time volunteer status grid on the dashboard. The "Calls Today" metric shows actual data.

## Scope

### Volunteer Presence Tracking
- Extend CallRouter DO (or SessionManager DO) to track WebSocket connection status per volunteer
- On WS connect: mark volunteer as "online"
- On WS disconnect: mark volunteer as "offline" (with grace period for reconnects)
- Combine with existing `onBreak` and active call status for composite state:
  - **Available** (online, not on break, not on call) — green
  - **On Call** (online, answering a call) — blue
  - **On Break** (online, break toggled) — yellow
  - **Offline** (no WS connection) — gray

### Admin Dashboard Card
- New card below status cards: "Volunteer Status"
- Grid of volunteer avatars/names with color-coded status dots
- Count per status (e.g., "3 available, 1 on call, 2 on break")
- Volunteer-only: don't show this card (isolation by design)

### Calls Today Metric
- Backend: count calls in CallRouter DO where `startedAt` is today (UTC)
- API: extend `GET /api/calls/active` to include `callsToday` count
- Frontend: replace hardcoded "-" with actual number

### WebSocket Broadcast
- Broadcast volunteer status changes to admin connections
- Message type: `volunteer_status` with pubkey + new status

## Files to Modify
- `src/worker/durable-objects/call-router.ts` — presence tracking, calls-today count
- `src/worker/index.ts` — API endpoint for volunteer status
- `src/client/routes/index.tsx` — new dashboard card, calls-today binding
- `src/client/lib/hooks.ts` or new `useVolunteerStatus` hook
- `src/client/lib/ws.ts` — handle `volunteer_status` messages

## Acceptance Criteria
- [ ] Admin dashboard shows real-time volunteer status grid
- [ ] Status updates within 2 seconds of change
- [ ] "Calls Today" shows actual count from backend
- [ ] Volunteers do not see other volunteers' status
- [ ] Offline detection within 30 seconds of disconnect
- [ ] E2E test for volunteer status card visibility (admin vs volunteer)
