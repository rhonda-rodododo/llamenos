# Epic 31: Custom Note Fields

## Problem
Currently, notes consist of a single free-text field plus a call ID. Different crisis hotlines may need structured data — mood/severity ratings, category tags, follow-up flags, referral info — that varies by organization. Admins need the ability to define custom fields that appear on the note form, with validation rules and role-based visibility controls.

## Goals
1. Admin can define custom fields via a "Custom Note Fields" settings section
2. Custom fields appear in the note creation/edit form (NoteSheet) alongside the existing text field
3. Fields support types: text, number, select (dropdown), checkbox, textarea
4. Each field has configurable validation: required, min/max length (text), min/max value (number), options list (select)
5. Each field has visibility/editability flags: `visibleToVolunteers`, `editableByVolunteers` (admins always see/edit all)
6. Custom field data is encrypted alongside the note content (E2EE preserved)

## Architecture

### Custom Field Definition Type
```ts
// src/shared/types.ts
interface CustomFieldDefinition {
  id: string               // unique UUID
  name: string             // internal key (machine-readable, e.g. "severity")
  label: string            // display label (e.g. "Severity Rating")
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea'
  required: boolean
  options?: string[]        // for 'select' type only
  validation?: {
    minLength?: number      // text/textarea
    maxLength?: number      // text/textarea
    min?: number            // number
    max?: number            // number
  }
  visibleToVolunteers: boolean   // if false, only admins see this field in notes
  editableByVolunteers: boolean  // if false, volunteers see field as read-only (admin fills it)
  order: number                  // display order in the form
  createdAt: string
}
```

### Storage
- Stored in SessionManager DO under key `custom-fields` as a JSON array
- Admin CRUD via API endpoints

### API Endpoints (Admin Only for writes; read for all authenticated)

#### `GET /settings/custom-fields`
Returns all custom field definitions. Volunteers receive filtered list (only `visibleToVolunteers: true` fields).

#### `PUT /settings/custom-fields`
Replaces the full custom fields array (admin only). Validates:
- No duplicate `name` values
- `select` type must have non-empty `options` array
- `order` values are sequential
- Maximum 20 custom fields

#### Individual field CRUD is handled client-side — the admin edits the full list and saves the whole array (simpler than individual endpoints for a config object).

### Encrypted Note Content Structure
Currently, `encryptedContent` is a plain encrypted string (the note text). To support custom fields, the encrypted payload becomes a JSON structure:

```ts
// What gets encrypted before storage
interface NotePayload {
  text: string                           // the existing free-text note
  fields?: Record<string, string | number | boolean>  // custom field values keyed by field ID
}
```

**Backward compatibility**: When decrypting, if the result is not valid JSON (or doesn't have a `text` property), treat the entire string as the `text` field (legacy notes). This preserves all existing notes without migration.

### Frontend: Settings Section

New "Custom Note Fields" card in Settings (admin only), using the `<SettingsSection>` component from Epic 30:

- List of defined fields in order, each showing: label, type badge, required badge, visibility icons
- "Add Field" button opens an inline form or dialog:
  - Field label (required)
  - Field name (auto-generated from label, editable)
  - Type selector (text/number/select/checkbox/textarea)
  - Required toggle
  - Type-specific validation inputs (min/max, options list)
  - Visibility toggles: "Visible to volunteers", "Editable by volunteers"
- Drag-to-reorder (or up/down arrows for simplicity)
- Delete button per field (with confirmation — deleting a field doesn't delete data from existing notes, it just stops showing the field)
- Save button saves the full array

### Frontend: Note Sheet Integration

Modify `NoteSheet` (`src/client/components/note-sheet.tsx`):
1. Fetch custom field definitions on open (or use a shared hook/context)
2. Render custom fields between the call ID selector and the text area
3. Each field renders based on its `type`:
   - `text` → `<Input />`
   - `number` → `<Input type="number" />`
   - `select` → `<Select>` with options
   - `checkbox` → `<Switch />` or `<Checkbox />`
   - `textarea` → `<textarea />`
4. Apply validation rules:
   - Required fields prevent save if empty
   - Min/max length/value shown as helper text and enforced on submit
5. Respect visibility/editability:
   - Volunteers only see `visibleToVolunteers` fields
   - Fields with `editableByVolunteers: false` render as disabled/read-only for volunteers
6. On save, serialize `{ text, fields }` as JSON, then encrypt the JSON string

### Frontend: Notes Display

Modify `NotesPage` (`src/client/routes/notes.tsx`):
1. After decryption, parse the payload (with legacy fallback)
2. Display custom field values below the note text
3. Respect visibility — volunteers only see `visibleToVolunteers` fields
4. In edit mode, custom field values are editable (per editability rules)

### Draft System
The existing `useDraft` hook stores draft text. Extend it to also store draft custom field values:
```ts
interface DraftState {
  text: string
  callId: string
  fields: Record<string, string | number | boolean>
  savedAt: number | null
}
```

### E2EE Considerations
- Custom field values are encrypted inside the same payload as the note text
- The server never sees field values
- Field *definitions* (labels, types, validation rules) are NOT encrypted — they're configuration data the server needs to serve to clients
- Field definitions do not contain PII — they're structural metadata (e.g., "Severity Rating", "Follow-up needed")

## Files to Create/Modify

### New Files
- `src/shared/types.ts` — `CustomFieldDefinition` and `NotePayload` types

### Modified Files
- `src/worker/durable-objects/session-manager.ts` — custom fields CRUD handlers, storage
- `src/worker/index.ts` — route custom fields API endpoints
- `src/worker/types.ts` — add `CustomFieldDefinition` type import
- `src/client/lib/api.ts` — `getCustomFields()`, `updateCustomFields()` API functions, `CustomFieldDefinition` type
- `src/client/lib/crypto.ts` — update `encryptNote`/`decryptNote` to handle `NotePayload` JSON (with legacy fallback)
- `src/client/components/note-sheet.tsx` — render custom fields, validate, include in encrypted payload
- `src/client/routes/notes.tsx` — parse `NotePayload` on decrypt, display custom field values
- `src/client/routes/settings.tsx` — Custom Note Fields admin section
- `src/client/lib/use-draft.ts` — extend draft state with `fields` map
- `src/client/locales/*.json` — `customFields.*` i18n keys (13 locales)
- `src/client/routes/index.tsx` — update dashboard note creation to include custom fields

### i18n Keys
- `customFields.title` — "Custom Note Fields"
- `customFields.description` — "Define additional fields that appear on the note form"
- `customFields.addField` — "Add Field"
- `customFields.fieldLabel` — "Field Label"
- `customFields.fieldName` — "Field Name"
- `customFields.fieldType` — "Type"
- `customFields.required` — "Required"
- `customFields.options` — "Options"
- `customFields.addOption` — "Add Option"
- `customFields.visibleToVolunteers` — "Visible to volunteers"
- `customFields.editableByVolunteers` — "Editable by volunteers"
- `customFields.noFields` — "No custom fields defined"
- `customFields.maxFields` — "Maximum 20 fields"
- `customFields.deleteConfirm` — "Delete this field? Existing notes with this field will keep their data."
- `customFields.validation.*` — min, max, minLength, maxLength labels
- `customFields.types.*` — text, number, select, checkbox, textarea labels

## Security Considerations
- Field definitions are plain config — no PII, no encryption needed
- Field *values* are encrypted alongside note text (E2EE preserved)
- Admin-only visibility flags enforced both client-side (UI filtering) and server-side (filtered GET response for non-admins)
- Max 20 fields + max 50 options per select field to prevent abuse
- Field names validated: alphanumeric + underscores, max 50 chars

## Acceptance Criteria
- [ ] Admin can add, edit, reorder, and delete custom field definitions in Settings
- [ ] Custom fields appear in NoteSheet for note creation and editing
- [ ] Field types render correct input components (text, number, select, checkbox, textarea)
- [ ] Required field validation prevents save when empty
- [ ] Min/max validation enforced for text length and number values
- [ ] Select fields show dropdown with admin-defined options
- [ ] `visibleToVolunteers: false` fields are hidden from volunteer view
- [ ] `editableByVolunteers: false` fields are read-only for volunteers
- [ ] Custom field values are encrypted as part of the note payload (E2EE)
- [ ] Legacy notes (plain text) still decrypt and display correctly
- [ ] Notes display shows custom field values below note text
- [ ] Draft auto-save includes custom field values
- [ ] All new strings translated in 13 locales
- [ ] E2E tests: admin creates custom field, volunteer creates note with field, values persist
- [ ] Maximum 20 fields enforced
