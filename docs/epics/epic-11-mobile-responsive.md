# Epic 11: Mobile Responsive

## Summary
Made the entire app usable on phones and tablets with a collapsible sidebar, responsive grid forms, and adaptive data layouts.

## Changes
- `__root.tsx`: Collapsible sidebar (fixed + z-40 + transform transition), mobile backdrop overlay, sticky mobile top bar with hamburger menu, close-on-navigate
- Forms (volunteers, shifts, bans, settings): `grid-cols-2` -> `grid-cols-1 sm:grid-cols-2`
- Data rows (volunteers, bans, calls, audit): Responsive padding `px-4 sm:px-6`, flex-wrap
- Volunteers: Stacked mobile layout `flex-col sm:flex-row`
- Calls search form: `flex-col sm:flex-row`, date inputs `w-full sm:w-36`
- Dashboard active call: `flex-col sm:flex-row` header, flex-wrap action buttons
- Audit timestamps: `w-full sm:w-36 sm:shrink-0`
- All page titles: `text-xl sm:text-2xl`, headers `flex-wrap gap-2`
- Main padding: `p-4 md:p-6`

## Files Modified (9)
- `src/client/routes/__root.tsx`
- `src/client/routes/index.tsx`
- `src/client/routes/volunteers.tsx`
- `src/client/routes/shifts.tsx`
- `src/client/routes/bans.tsx`
- `src/client/routes/calls.tsx`
- `src/client/routes/audit.tsx`
- `src/client/routes/notes.tsx`
- `src/client/routes/settings.tsx`
