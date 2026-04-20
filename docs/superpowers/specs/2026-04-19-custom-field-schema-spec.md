# Custom Field Schema Engine Spec

**v2→v1 Series, Part 4 of 6**  
**Date:** 2026-04-19  
**Status:** Draft — docs-only, no code changes  
**PR Title:** `docs: custom field schema engine spec (v2→v1 series 4/6)`

---

## 1. Overview

This spec defines the **Custom Field Schema Engine** for Llámenos v1 — a per-entity-type typed field system with validation, conditional visibility, PII marking, and dynamic form rendering. It replaces the current flat `custom_field_definitions` table with a schema-aware engine that supports entity types (contacts, cases, events), field-level access control, and tiered encryption.

The design is informed by v2's `entityFieldDefinitionSchema` and `fieldTemplateSchema`, adapted to v1's existing architecture (Drizzle ORM, hub-key encryption, MLS group encryption, ECIES envelopes).

---

## 2. Encryption Model (CRITICAL)

v1 uses a **three-tier encryption model**. The Custom Field Schema Engine must route every field and value through the correct tier:

| Data | Encryption Tier | Mechanism |
|------|----------------|-----------|
| **Field definitions** (label, helpText, section name, option labels) | **Hub-key encrypted** (Tier 1) | AES-256-GCM via `hub-field-crypto.ts` |
| **Field definition schema** (name, type, required, option keys, validation rules) | **Plaintext** | Server validates; no encryption |
| **Field values (non-PII)** | **Hub-key encrypted** (Tier 1) | AES-256-GCM via `hub-field-crypto.ts` |
| **Field values (PII, `isPii: true`)** | **MLS group encryption** | **NOT ECIES envelopes** — encrypted via `MlsConversation.encrypt()` for the hub group |
| **`showWhen` rules** | **Plaintext** | Client-side rendering concern; references field names + plaintext option keys |
| **Option keys** | **Plaintext** | Server validates membership in allowed set |
| **Option labels** | **Hub-key encrypted** (Tier 1) | AES-256-GCM |

### 2.1 Why MLS for PII Values?

The current v1 architecture uses **per-note ECIES envelopes** for note content (forward secrecy, unique key per note). For custom field values marked as PII, we need **group encryption** so that:
- All current hub members can decrypt
- Adding/removing members is handled via MLS epoch commits
- No per-field envelope proliferation (ECIES would create N envelopes per field value per reader)

MLS is already bootstrapped in v1 (`src/client/lib/mls/`, `src/server/db/schema/mls.ts`, `src/server/routes/mls.ts`). The MLS group ID is deterministic per hub: `llamenos:hub:<hubId>`.

### 2.2 Hub-Key Encryption for Metadata

Field labels, help text, section names, and option labels are **organizational metadata** — they should be readable by all hub members but opaque to the server. This matches the existing hub-key encryption pattern used for roles, shifts, and report types.

**AAD binding:** Every hub-key ciphertext must use `hubFieldAad(recordId, fieldName)` from `src/shared/lib/hub-field-aad.ts`.

---

## 3. Database Schema

### 3.1 New Table: `entity_type_fields`

Replaces `custom_field_definitions` as the canonical field schema store. The old table is retained during migration (see §8).

```typescript
// src/server/db/schema/entity-type-fields.ts
import { boolean, integer, pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'
import { hubs } from './settings'

export const entityTypeFields = pgTable('entity_type_fields', {
  id: text('id').primaryKey(),
  hubId: text('hub_id')
    .notNull()
    .default('global')
    .references(() => hubs.id),

  // --- Schema (plaintext, server-validated) ---
  /** Machine name: /^[a-zA-Z0-9_]+$/ */
  name: text('name').notNull(),
  /** Field type */
  fieldType: text('field_type').notNull(),
  /** Required on create/update */
  required: boolean('required').notNull().default(false),
  /** Select/multiselect option keys (plaintext) */
  optionKeys: jsonb<string[]>()('option_keys').notNull().default([]),
  /** Validation rules (plaintext JSON) */
  validationRules: jsonb<{
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
    pattern?: string
  }>()('validation_rules'),
  /** Location field config (plaintext) */
  locationConfig: jsonb<{
    maxPrecision: 'none' | 'city' | 'neighborhood' | 'block' | 'exact'
    allowGps: boolean
    allowAutocomplete: boolean
  }>()('location_config'),
  /** Conditional visibility rule (plaintext JSON) */
  showWhen: jsonb<{
    field: string
    operator: 'equals' | 'not_equals' | 'contains' | 'is_set'
    value?: string | number | boolean
  }>()('show_when'),
  /** Section grouping key (plaintext) */
  sectionKey: text('section_key'),
  /** Display order within section */
  order: integer('order').notNull().default(0),

  // --- Encryption tier routing ---
  /** If true, field values are MLS-encrypted; if false, hub-key encrypted */
  isPii: boolean('is_pii').notNull().default(false),

  // --- Access control ---
  /** Who can see this field */
  accessLevel: text('access_level').notNull().default('all'),
  /** Role slugs for 'custom' access level */
  accessRoles: jsonb<string[]>()('access_roles').notNull().default([]),

  // --- Feature flags ---
  /** Enable audio input (Whisper transcription) for this field */
  supportAudioInput: boolean('support_audio_input').notNull().default(false),
  /** Editable by hub admins (false = template-locked) */
  hubEditable: boolean('hub_editable').notNull().default(true),

  // --- Audit ---
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // --- Encrypted metadata (hub-key encrypted) ---
  encryptedLabel: ciphertext('encrypted_label').notNull(),
  encryptedHelpText: ciphertext('encrypted_help_text'),
  encryptedPlaceholder: ciphertext('encrypted_placeholder'),
  encryptedSectionName: ciphertext('encrypted_section_name'),
  /** JSON object: { [optionKey]: ciphertext } */
  encryptedOptionLabels: ciphertext('encrypted_option_labels'),
})
```

### 3.2 New Table: `entity_type_values`

Stores the actual field values per record (note, contact, report, etc.).

```typescript
// src/server/db/schema/entity-type-values.ts
import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'

export const entityTypeValues = pgTable(
  'entity_type_values',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    /** The field definition this value belongs to */
    fieldId: text('field_id').notNull(),
    /** The entity record this value belongs to (note, contact, report, etc.) */
    recordId: text('record_id').notNull(),
    /** Entity type discriminator: 'note' | 'contact' | 'report' | 'call_record' | 'conversation' */
    entityType: text('entity_type').notNull(),

    // --- Value storage ---
    /** Non-PII values: hub-key encrypted ciphertext */
    encryptedValue: ciphertext('encrypted_value'),
    /** PII values: MLS-encrypted ciphertext (base64-encoded MLS application message) */
    mlsEncryptedValue: text('mls_encrypted_value'),

    // --- Audit ---
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entity_type_values_record_idx').on(table.recordId, table.entityType),
    index('entity_type_values_field_idx').on(table.fieldId),
    index('entity_type_values_hub_idx').on(table.hubId),
  ]
)
```

**Design rationale:**
- One row per field per record (normalized, not JSON blob) — enables per-field access control, indexing, and GDPR erasure of specific fields
- `entityType` discriminator allows the same field definition to be reused across note, contact, report contexts (replacing the old `context` enum)
- `mlsEncryptedValue` is `text` (not `ciphertext`) because MLS ciphertext is opaque binary, base64-encoded for JSON transport
- No foreign key to `entity_type_fields` — field definitions may be deleted; values remain for audit/history (soft-reference pattern)

---

## 4. Field Types

Supported field types and their value representations:

| Type | Value Storage | Validation | Notes |
|------|--------------|------------|-------|
| `text` | String | minLength, maxLength, pattern | Single-line text |
| `number` | Number | min, max | Integer or float |
| `select` | String (option key) | — | Single selection from options |
| `multiselect` | String[] (option keys) | — | Multiple selection |
| `checkbox` | Boolean | — | True/false toggle |
| `textarea` | String | minLength, maxLength | Multi-line text |
| `date` | String (ISO 8601) | — | Date picker |
| `file` | JSON `{ fileId: string }` | maxFileSize, allowedMimeTypes, maxFiles | References `file_records` |
| `location` | JSON `LocationFieldValue` | locationConfig | See §4.1 |

### 4.1 Location Field Type

```typescript
interface LocationFieldValue {
  address: string
  displayName?: string
  lat?: number
  lon?: number
  source: 'geocoded' | 'gps' | 'manual'
}
```

**Precision levels:**
- `exact` — full lat/lon (4+ decimal places)
- `block` — lat/lon rounded to ~2 decimal places (~1km)
- `neighborhood` — lat/lon rounded to ~1 decimal place (~10km)
- `city` — city name only, no coordinates
- `none` — address string only, no geocoding

**Privacy:** Location values are **always PII** (`isPii: true` by default) because lat/lon can identify individuals. The precision level controls what the client stores; the server never sees plaintext coordinates.

---

## 5. Validation Rules

Validation is **client-side primary, server-side secondary** (defense in depth).

### 5.1 Client Validation

```typescript
// src/shared/schemas/entity-type-fields.ts
const ValidationRulesSchema = z.object({
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(), // JS RegExp string
})
```

The `CustomFieldInputs` component (`src/client/components/notes/custom-field-inputs.tsx`) already has validation logic; it will be extended to support the new rule shapes and `showWhen` evaluation.

### 5.2 Server Validation

On `PUT /entity-type-fields/:hubId/values` (batch update), the server:
1. Looks up the field definition by `fieldId`
2. Validates the plaintext schema (type, required, option key membership)
3. Rejects values for fields the user cannot access (based on `accessLevel` + roles)
4. Does **NOT** validate content semantics (min/max) — the server cannot read encrypted values

**Exception:** For non-PII hub-key encrypted values, the server could theoretically decrypt if it holds the hub key. We intentionally do **not** do this — server-side validation of encrypted content violates zero-knowledge principles. Client validation is the primary gate.

---

## 6. Conditional Visibility (`showWhen`)

`showWhen` rules are **plaintext** and evaluated client-side.

```typescript
const ShowWhenSchema = z.object({
  field: z.string(), // name of the dependent field
  operator: z.enum(['equals', 'not_equals', 'contains', 'is_set']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
})
```

### 6.1 Evaluation Rules

- `equals`: dependent field value === `value`
- `not_equals`: dependent field value !== `value`
- `contains`: dependent field value (string or array) includes `value`
- `is_set`: dependent field value is not undefined/null/empty string

### 6.2 Evaluation Order

Fields are evaluated in `order` sequence within their `section`. A field with `showWhen` referencing a field that comes later in order is a **configuration error** — the UI logs a warning and shows the field unconditionally.

### 6.3 Cross-Field Dependencies

`showWhen` can reference any field in the same entity context (e.g., same note form, same contact edit form). It cannot reference fields in other records.

---

## 7. Access Control

### 7.1 Access Levels

| Level | Meaning |
|-------|---------|
| `all` | Visible to all hub members |
| `admin` | Visible only to users with `admin` role |
| `assigned` | Visible only to the user assigned to the record (e.g., note author, contact owner) |
| `custom` | Visible only to users with roles listed in `accessRoles` |

### 7.2 Enforcement

- **Server:** Filters field definitions in `GET /entity-type-fields` based on the caller's role. Rejects updates to values for inaccessible fields.
- **Client:** The `DynamicFormRenderer` (§9) filters fields before rendering. This is a UX optimization, not a security boundary — the server is the security boundary.

---

## 8. Migration from `custom_field_definitions`

### 8.1 Migration Strategy

**Phase 1 (backward-compatible):**
1. Create `entity_type_fields` and `entity_type_values` tables
2. Add migration script that copies existing `custom_field_definitions` rows into `entity_type_fields`
3. Update `CustomFieldInputs` to read from both old and new tables (preference new)
4. Keep `custom_field_definitions` read-only for rollback

**Phase 2 (cutover):**
1. Migrate all note/contact/report values from inline JSON blobs (`notePayload.fields`) to `entity_type_values` rows
2. Update all query hooks to use `entity_type_values`
3. Drop `custom_field_definitions` table (in a later release)

### 8.2 Data Mapping

| Old (`custom_field_definitions`) | New (`entity_type_fields`) |
|----------------------------------|---------------------------|
| `fieldType` | `fieldType` (same values) |
| `required` | `required` |
| `visibleTo` | `accessLevel` (map: `contacts:envelope-summary` → `all`, `contacts:envelope-full` → `admin`) |
| `context` | `entityType` (map: `notes` → `note`, `reports` → `report`, `all` → multiple rows or `entityType` array) |
| `order` | `order` |
| `encryptedFieldName` | `name` (plaintext) + `encryptedLabel` (hub-key encrypted) |
| `encryptedLabel` | `encryptedLabel` |
| `encryptedOptions` | `optionKeys` (plaintext keys) + `encryptedOptionLabels` (hub-key encrypted labels) |
| `validation` | `validationRules` |
| `locationSettings` | `locationConfig` |
| — | `isPii` (default `false` for migrated fields) |
| — | `showWhen` (default `null`) |
| — | `supportAudioInput` (default `false`) |

---

## 9. Dynamic Form Renderer

### 9.1 Component: `DynamicFormRenderer`

A new component that replaces `CustomFieldInputs` for entity-type-aware contexts.

```typescript
// src/client/components/dynamic-form-renderer.tsx
interface DynamicFormRendererProps {
  /** Entity type discriminator */
  entityType: 'note' | 'contact' | 'report' | 'call_record' | 'conversation'
  /** The record ID being edited (for AAD binding) */
  recordId: string
  /** Current field values (from entity_type_values or inline) */
  values: Record<string, unknown>
  /** Callback on value change */
  onChange: (values: Record<string, unknown>) => void
  /** User's roles for access control filtering */
  userRoles: string[]
  /** Is the user an admin? */
  isAdmin: boolean
  /** Is the user assigned to this record? */
  isAssigned: boolean
  /** Disable all inputs */
  disabled?: boolean
}
```

### 9.2 Rendering Pipeline

1. **Fetch field definitions** for the entity type + hub (React Query, staleTime 10min)
2. **Decrypt metadata** (labels, help text, option labels) via `decryptHubField()` in the queryFn
3. **Filter by access** — remove fields the user cannot see
4. **Evaluate `showWhen`** — hide fields whose condition is not met by current `values`
5. **Group by `sectionKey`** — render sections with headers
6. **Render inputs** — map field type to input component
7. **Validate on submit** — run client-side validation, return errors map

### 9.3 Audio Input Support

When `supportAudioInput: true` on a `text` or `textarea` field:
- Show a microphone icon next to the input
- On click: start `MediaRecorder` → stream to Web Worker → Whisper ONNX inference
- Transcribed text is inserted at cursor position
- Audio blob is **not** stored — only the transcribed text

---

## 10. API Routes

### 10.1 Field Definitions

```
GET    /api/entity-type-fields/:hubId          → List field definitions (filtered by access)
POST   /api/entity-type-fields/:hubId          → Create field definition (admin only)
PATCH  /api/entity-type-fields/:hubId/:fieldId → Update field definition (admin only)
DELETE /api/entity-type-fields/:hubId/:fieldId → Delete field definition (admin only)
PUT    /api/entity-type-fields/:hubId/reorder  → Reorder fields (admin only)
```

**Request/Response schemas:** Defined in `src/shared/schemas/entity-type-fields.ts` (to be created).

### 10.2 Field Values

```
GET    /api/entity-type-values/:recordId?entityType=note  → Get values for a record
PUT    /api/entity-type-values/:recordId                 → Batch update values
DELETE /api/entity-type-values/:recordId/:fieldId        → Delete a specific field value
```

**Encryption handling:**
- Client encrypts non-PII values with `encryptHubField(value, hubId, recordId, fieldName)` before sending
- Client encrypts PII values with `mlsConversation.encrypt(new TextEncoder().encode(value))` before sending
- Server stores ciphertext opaquely
- On GET, server returns ciphertext; client decrypts in the queryFn

---

## 11. Zod Schemas

### 11.1 Shared Schemas

Create `src/shared/schemas/entity-type-fields.ts`:

```typescript
import { z } from '@hono/zod-openapi'

export const FieldTypeSchema = z.enum([
  'text', 'number', 'select', 'multiselect', 'checkbox',
  'textarea', 'date', 'file', 'location',
])

export const AccessLevelSchema = z.enum(['all', 'admin', 'assigned', 'custom'])

export const ValidationRulesSchema = z.object({
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
})

export const LocationConfigSchema = z.object({
  maxPrecision: z.enum(['none', 'city', 'neighborhood', 'block', 'exact']),
  allowGps: z.boolean(),
  allowAutocomplete: z.boolean(),
})

export const ShowWhenSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals', 'contains', 'is_set']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
})

export const EntityTypeFieldSchema = z.object({
  id: z.string().uuid(),
  hubId: z.string(),
  name: z.string().regex(/^[a-zA-Z0-9_]+$/).max(50),
  fieldType: FieldTypeSchema,
  required: z.boolean(),
  optionKeys: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100)),
  validationRules: ValidationRulesSchema.optional(),
  locationConfig: LocationConfigSchema.optional(),
  showWhen: ShowWhenSchema.optional(),
  sectionKey: z.string().max(100).optional(),
  order: z.number().int().min(0),
  isPii: z.boolean(),
  accessLevel: AccessLevelSchema,
  accessRoles: z.array(z.string()),
  supportAudioInput: z.boolean(),
  hubEditable: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Encrypted fields (ciphertext strings for API)
  encryptedLabel: z.string(),
  encryptedHelpText: z.string().optional(),
  encryptedPlaceholder: z.string().optional(),
  encryptedSectionName: z.string().optional(),
  encryptedOptionLabels: z.string().optional(),
})

export const EntityTypeValueSchema = z.object({
  id: z.string().uuid(),
  hubId: z.string(),
  fieldId: z.string().uuid(),
  recordId: z.string(),
  entityType: z.enum(['note', 'contact', 'report', 'call_record', 'conversation']),
  encryptedValue: z.string().optional(),
  mlsEncryptedValue: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
```

---

## 12. Client-Side Query Hooks

### 12.1 Field Definitions

```typescript
// src/client/lib/queries/entity-type-fields.ts
export const entityTypeFieldsOptions = (hubId: string, entityType: string) =>
  queryOptions({
    queryKey: queryKeys.entityTypeFields.list(hubId, entityType),
    queryFn: async () => {
      const defs = await getEntityTypeFields(hubId, entityType)
      return Promise.all(
        defs.map(async (def) => ({
          ...def,
          label: await decryptHubField(def.encryptedLabel, hubId, def.id, 'encrypted_label'),
          helpText: def.encryptedHelpText
            ? await decryptHubField(def.encryptedHelpText, hubId, def.id, 'encrypted_help_text')
            : undefined,
          sectionName: def.encryptedSectionName
            ? await decryptHubField(def.encryptedSectionName, hubId, def.id, 'encrypted_section_name')
            : undefined,
          optionLabels: def.encryptedOptionLabels
            ? await decryptOptionLabels(def.encryptedOptionLabels, hubId, def.id)
            : {},
        }))
      )
    },
    staleTime: 10 * 60_000,
  })
```

### 12.2 Field Values

```typescript
export const entityTypeValuesOptions = (recordId: string, entityType: string, hubId: string) =>
  queryOptions({
    queryKey: queryKeys.entityTypeValues.detail(recordId, entityType),
    queryFn: async () => {
      const values = await getEntityTypeValues(recordId, entityType)
      const mlsConv = await getMlsConversation(hubId) // from hub-key-manager or mls/conversation.ts
      return Promise.all(
        values.map(async (v) => {
          if (v.mlsEncryptedValue && mlsConv) {
            const decrypted = await mlsConv.decrypt(base64ToBytes(v.mlsEncryptedValue))
            return { ...v, value: new TextDecoder().decode(decrypted.message!) }
          }
          if (v.encryptedValue) {
            return {
              ...v,
              value: await decryptHubField(v.encryptedValue, hubId, v.id, 'encrypted_value'),
            }
          }
          return { ...v, value: undefined }
        })
      )
    },
    staleTime: 5 * 60_000,
  })
```

---

## 13. Query Keys Update

Add to `src/client/lib/queries/keys.ts`:

```typescript
entityTypeFields: {
  all: ['entityTypeFields'] as const,
  list: (hubId: string, entityType: string) =>
    ['entityTypeFields', 'list', hubId, entityType] as const,
},
entityTypeValues: {
  all: ['entityTypeValues'] as const,
  detail: (recordId: string, entityType: string) =>
    ['entityTypeValues', 'detail', recordId, entityType] as const,
},
```

Add `'entityTypeFields'` and `'entityTypeValues'` to `ENCRYPTED_QUERY_KEYS` in `src/client/lib/query-client.ts`.

---

## 14. Crypto Labels

Add to `src/shared/crypto-labels.ts`:

```typescript
/** Hub-key encryption of entity type field labels */
export const LABEL_ENTITY_FIELD_LABEL = 'llamenos:entity-field-label:v1' as CryptoLabel
/** Hub-key encryption of entity type field option labels */
export const LABEL_ENTITY_FIELD_OPTION_LABEL = 'llamenos:entity-field-option-label:v1' as CryptoLabel
/** Hub-key encryption of entity type field values (non-PII) */
export const LABEL_ENTITY_FIELD_VALUE = 'llamenos:entity-field-value:v1' as CryptoLabel
```

**Note:** PII field values use **MLS group encryption**, not hub-key encryption, so they do not need a `CryptoLabel` in the hub-field AAD sense. The MLS `info` parameter should use `LABEL_ENTITY_FIELD_VALUE` for domain separation.

---

## 15. Testing Strategy

### 15.1 Unit Tests

- `src/shared/schemas/entity-type-fields.test.ts` — zod schema validation (valid/invalid inputs)
- `src/client/lib/dynamic-form-validator.test.ts` — `showWhen` evaluation, validation rules

### 15.2 API Integration Tests

- `tests/api/entity-type-fields.spec.ts` — CRUD for field definitions, access control filtering
- `tests/api/entity-type-values.spec.ts` — batch update, encryption round-trip, MLS encryption round-trip

### 15.3 UI E2E Tests

- `tests/ui/custom-field-schema.spec.ts` — admin creates field, volunteer fills form, conditional visibility, audio input

### 15.4 Migration Test

- Run migration script against seeded `custom_field_definitions` data
- Verify old and new tables produce identical decrypted output

---

## 16. Implementation Phases

| Phase | Scope | Files |
|-------|-------|-------|
| **1** | DB schema + migrations | `src/server/db/schema/entity-type-fields.ts`, `src/server/db/schema/entity-type-values.ts`, migration SQL |
| **2** | Shared zod schemas | `src/shared/schemas/entity-type-fields.ts` |
| **3** | Server service + routes | `src/server/services/entity-type-fields.ts`, `src/server/routes/entity-type-fields.ts`, `src/server/routes/entity-type-values.ts` |
| **4** | Client API + queries | `src/client/lib/api/entity-type-fields.ts`, `src/client/lib/queries/entity-type-fields.ts` |
| **5** | Dynamic form renderer | `src/client/components/dynamic-form-renderer.tsx` |
| **6** | Migration script + cutover | `scripts/migrate-custom-fields.ts`, update note/contact/report forms |
| **7** | Tests | Unit, API, E2E suites |

---

## 17. Open Questions

1. **MLS availability:** If MLS is not yet bootstrapped for a hub (e.g., old hub created before Tier 6), should PII fields fall back to ECIES envelopes (per-reader) or be blocked until MLS is enabled?
   - **Recommendation:** Block PII field creation until MLS is bootstrapped. Display admin warning: "Enable MLS encryption to use PII-marked fields."

2. **Entity type extensibility:** Should `entityType` be an enum or a foreign key to a future `entity_types` table?
   - **Recommendation:** Start with enum (matches v1's current contexts). Migrate to foreign key when v2's full entity type system is ported.

3. **File field encryption:** File metadata is already ECIES-enveloped (`file_records.recipientEnvelopes`). Should the `fileId` reference in `entity_type_values` be plaintext or encrypted?
   - **Recommendation:** `fileId` can be plaintext — the file itself is encrypted, and the reference is not sensitive. The `file_records.contextType/contextId` already links files to records.

4. **Blind indexing:** v2's `entityFieldDefinitionSchema` has `indexable` + `indexType` for blind indexing. Should v1 support this?
   - **Recommendation:** Defer to Phase 2. Blind indexing requires additional crypto primitives (HMAC-based blind indices) and is not needed for initial launch.

---

## 18. References

- v2 entity schema: `/media/rikki/recover2/projects/llamenos/packages/protocol/schemas/entity-schema.ts`
- v2 template types: `/media/rikki/recover2/projects/llamenos/packages/protocol/template-types.ts`
- v1 current custom fields: `src/server/db/schema/settings.ts` (`customFieldDefinitions`), `src/server/services/settings/custom-fields.ts`, `src/client/components/admin-sections/custom-fields-section.tsx`
- v1 MLS implementation: `src/client/lib/mls/`, `src/server/db/schema/mls.ts`, `src/server/routes/mls.ts`
- v1 hub-key crypto: `src/client/lib/hub-field-crypto.ts`, `src/shared/lib/hub-field-aad.ts`
- v1 crypto labels: `src/shared/crypto-labels.ts`
- v1 query keys: `src/client/lib/queries/keys.ts`, `src/client/lib/query-client.ts`

---

*End of spec.*
