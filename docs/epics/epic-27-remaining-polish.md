# Epic 27: Remaining Polish & Backlog Items

## Problem
Several medium/low-priority items from the backlog remain unimplemented. These are small quality-of-life improvements that collectively improve the production readiness of the app.

## Items

### 1. Replace Raw `<select>` with shadcn Select (L2)
**File**: `src/client/routes/notes.tsx:253-266`
The call ID dropdown in the new note form uses a raw `<select>` element that doesn't match the shadcn design system.
- Replace with shadcn `Select` / `SelectTrigger` / `SelectContent` / `SelectItem`
- Also applies to any other raw `<select>` elements in the codebase (check volunteer form)

### 2. Toast Dismiss Button (L7)
**File**: `src/client/lib/toast.tsx` (or wherever toast is implemented)
- Add an `X` button to manually dismiss toast notifications
- Currently toasts auto-dismiss after timeout but can't be closed early

### 3. Keyboard Shortcuts Help Dialog (L1)
- Add a `?` keyboard shortcut that opens a help dialog showing all available shortcuts:
  - `Cmd/Ctrl+K` — Command palette
  - `?` — This help dialog
  - Any other shortcuts added
- Can be a simple modal/dialog with a table of shortcuts
- Also accessible from command palette as a "Keyboard Shortcuts" action

### 4. Confirmation Dialogs for Settings Toggles (L3)
- Add confirmation when toggling settings that affect active operations:
  - Disabling global transcription
  - Enabling/disabling voice CAPTCHA
  - Enabling/disabling rate limiting
- Use existing `ConfirmDialog` component

## Files to Modify
- `src/client/routes/notes.tsx` — shadcn Select for call ID
- `src/client/lib/toast.tsx` — dismiss button
- `src/client/components/command-palette.tsx` — keyboard shortcuts action
- `src/client/routes/settings.tsx` — confirmation dialogs on toggles
- `src/client/locales/*.json` — i18n for shortcuts dialog, confirm messages

## Acceptance Criteria
- [ ] No raw `<select>` elements remain in the codebase
- [ ] Toasts have a dismiss button
- [ ] `?` key opens keyboard shortcuts help
- [ ] Settings toggles with side effects show confirmation dialog
- [ ] All new strings in 13 locales
- [ ] E2E tests updated where applicable
