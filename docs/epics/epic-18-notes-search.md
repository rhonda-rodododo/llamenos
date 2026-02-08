# Epic 18: Notes & Search Improvements

## Problem
The Notes page has several UX gaps:
1. No search or filter — finding a specific note requires scrolling through all notes
2. Creating a new note requires manually typing a Call ID — volunteers don't know call IDs
3. No pagination — all notes load at once (will degrade with volume)
4. No way to navigate from Call History to related notes
5. No data export capability (GDPR requirement)

## Goal
Notes page is searchable, paginated, and easy to use during and after calls.

## Scope

### Search & Filter
- Add search bar at top of Notes page
- Search by note content (decrypted client-side, so search must be client-side too)
- Filter by date range
- Filter by call ID (dropdown or text input)
- URL-persisted search params (like Call History page)

### Call ID UX Fix
- Replace manual Call ID text input with a dropdown of recent calls
- Fetch recent calls from `/api/calls/history?limit=20` to populate dropdown
- Show caller number + timestamp for each option
- Still allow manual entry as fallback

### Pagination
- Backend: add `page` and `limit` params to `GET /api/notes`
- Frontend: pagination controls matching Call History and Audit pages
- Default: 50 notes per page

### Call History → Notes Navigation
- Add "View Notes" link/button on each call in Call History
- Navigate to `/notes?callId={id}` to show filtered view

### GDPR Export (Lower Priority)
- Admin-only "Export Notes" button
- Decrypt all notes client-side, export as CSV/JSON
- Include: timestamp, call ID, content (decrypted), author (name or pubkey)

## Files to Modify
- `src/client/routes/notes.tsx` — search bar, pagination, call ID dropdown
- `src/client/routes/calls.tsx` — "View Notes" link per call
- `src/client/lib/api.ts` — paginated notes endpoint
- `src/worker/index.ts` — pagination params on notes API
- `src/worker/durable-objects/session-manager.ts` — paginated notes query

## Acceptance Criteria
- [ ] Notes page has search bar that filters by decrypted content
- [ ] New Note form uses dropdown of recent calls instead of manual Call ID
- [ ] Notes page is paginated (50 per page)
- [ ] Call History page has "View Notes" link per call
- [ ] URL search params persist across navigation
- [ ] E2E test: search filters notes, pagination works
