# Epic 15: Light Mode & Design System Cleanup

## Problem
Light mode is fundamentally broken. The entire UI uses hardcoded dark-theme Tailwind colors (e.g., `bg-yellow-950/10`, `text-blue-300`, `bg-green-950/20`) that are only legible on dark backgrounds. In light mode, these render as near-black patches with invisible text. The app has no semantic color system — each component picks ad-hoc color values.

## Goal
Both light and dark themes render correctly with proper contrast on every page. Establish a small set of semantic color tokens for reuse across the app.

## Scope

### Phase 1: Audit & Fix Hardcoded Colors
Files to modify:
- `src/client/routes/index.tsx` — Dashboard (on-break, active call, incoming calls, admin call list)
- `src/client/routes/volunteers.tsx` — Generated nsec warning card
- `src/client/routes/notes.tsx` — Note decryption badges, edit states
- `src/client/routes/bans.tsx` — Ban form accents
- `src/client/routes/shifts.tsx` — Day toggle buttons
- `src/client/routes/calls.tsx` — Duration badges, status badges
- `src/client/routes/login.tsx` — Button color, card styling

For each hardcoded color:
- Use `dark:` variant pattern: `bg-yellow-100 dark:bg-yellow-950/10 text-yellow-800 dark:text-yellow-300`
- OR define CSS custom properties in the theme layer

### Phase 2: Semantic Color Tokens
Define in Tailwind config or CSS variables:
- `call-active` (blue family) — active call panel
- `call-ringing` (green family) — incoming call cards
- `on-break` (yellow family) — break notices and badges
- `danger-surface` / `danger-text` — destructive actions
- `success-surface` / `success-text` — saved/confirmed states

### Phase 3: Visual QA
- Playwright screenshot every page in both themes at 1280px and 375px
- Verify WCAG AA contrast ratio (4.5:1 for text, 3:1 for large text)
- Test with Arabic RTL in both themes

## Acceptance Criteria
- [ ] All pages render correctly in light mode (no invisible text, no near-black patches)
- [ ] All pages render correctly in dark mode (no regression)
- [ ] Semantic color tokens documented and used consistently
- [ ] Screenshots taken for every page/theme combination
- [ ] Existing E2E tests pass in both themes
