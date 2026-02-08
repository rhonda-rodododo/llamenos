# Epic 12: Accessibility (A11y)

## Summary
Added skip links, aria-labels on icon-only buttons, heading hierarchy fix, HTML lang/dir sync, and toast a11y roles. Added `a11y` i18n namespace to all 13 locales.

## Changes
- `__root.tsx`: Skip link to `#main-content`, `<main id="main-content" tabIndex={-1}>`, aria-labels on language/theme/menu/close buttons
- All 8 route pages: `<h2>` -> `<h1>` for page titles (sidebar brand is `<p>`)
- Icon-only buttons: Added `aria-label` to copy, delete, edit, remove, search, clear-filters buttons across 6 files
- `shifts.tsx`: `aria-pressed` on day toggle buttons
- `volunteers.tsx`: `aria-pressed` on active/inactive toggle
- `login.tsx`: `aria-label` on language and theme buttons
- `i18n.ts`: Syncs `document.documentElement.lang` and `dir` (RTL for Arabic) on language change
- `toast.tsx`: `role="status"` for success/info, `role="alert"` for errors; `aria-live="polite"` on container
- 13 locale files: Added `a11y` namespace with 13 translated keys

## Files Modified (26)
- 8 route files + `login.tsx`
- `src/client/lib/i18n.ts`
- `src/client/lib/toast.tsx`
- 13 locale JSON files
