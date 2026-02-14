# Epic 39: Split Notes Page

## Problem
`src/client/routes/notes.tsx` is 644 lines with custom field rendering duplicated between create and edit forms (~110 lines each, nearly identical).

## Solution
Extract reusable components.

## Components to Extract
1. `CustomFieldInputs.tsx` — Renders inputs for custom field definitions. Used in both new note form and edit form. Eliminates the 110-line duplication.
2. `NoteCard.tsx` — Single note display with field badges + edit button
3. `NoteEditForm.tsx` — Inline edit form with textarea + custom fields + save/cancel
4. `NewNoteForm.tsx` — Card with call ID selector + textarea + custom fields + save/cancel

## Files
- Create: `src/client/components/notes/*.tsx` (4 files)
- Modify: `src/client/routes/notes.tsx` (shrink to ~250 lines)
