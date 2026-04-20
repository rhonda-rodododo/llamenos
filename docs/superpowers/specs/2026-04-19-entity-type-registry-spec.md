# Entity Type Registry Spec

## v2→v1 Series, Part 1 of 6

**Date:** 2026-04-19
**Status:** Draft — pending review
**Depends on:** PR #199 (v2 Entity Templates Architecture overview)
**Blocks:** Part 2 (Entity Instance CRUD), Part 3 (Relationship Types), Part 4 (Template Engine), Part 5 (Custom Field Migration), Part 6 (Report Type Deprecation)

---

## 1. Overview

This spec defines the **Entity Type Registry** — the foundation for bringing v2's custom entity types into v1. An entity type is an admin-configurable schema definition that describes a category of record (e.g., "Crisis Case", "Contact", "Event"). It replaces and subsumes v1's current `report_types` table with a much richer, field-definition-capable model.

Entity types are **hub-scoped** and **hub-key encrypted** for metadata. They are the schema layer; actual entity instances (the data) are covered in Part 2.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Hub-key encryption for metadata** | Names, labels, descriptions, status labels, field labels are org metadata — encrypted via AES-256-GCM (`LABEL_HUB_FIELD`) with per-record AAD binding. |
| **Plaintext schema/config** | Field types, option keys, required flags, validation rules must be readable by the server for form validation and query building. |
| **MLS for PII content (future)** | Entity instance field values marked in `piiFields` will use MLS group encryption (Part 2). This spec defines the `piiFields` registry only. |
| **No ECIES envelopes** | v1 is migrating to MLS. Do NOT use `recipientEnvelopeSchema`, `adminEnvelopes`, or per-recipient wrapping. |
| **Migration path from `report_types`** | Existing report types become entity types with `category: 'case'`. The `report_types` table is deprecated but not dropped until Part 6. |

---

## 2. DB Schema

### 2.1 `entity_types` table

```typescript
// src/server/db/schema/entity-types.ts
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'
import { hubs } from './settings'

export const entityTypes = pgTable(
  'entity_types',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id')
      .notNull()
      .default('global')
      .references(() => hubs.id, { onDelete: 'cascade' }),

    // --- Machine name (plaintext, immutable after creation) ---
    name: text('name').notNull(), // e.g. 'crisis_case', /^[a-zA-Z0-9_]+$/

    // --- Hub-key encrypted metadata ---
    encryptedLabel: ciphertext('encrypted_label').notNull(),        // singular display name
    encryptedLabelPlural: ciphertext('encrypted_label_plural').notNull(),
    encryptedDescription: ciphertext('encrypted_description'),
    encryptedIcon: ciphertext('encrypted_icon'),                    // e.g. 'case-sensitive'
    encryptedColor: ciphertext('encrypted_color'),                  // e.g. '#ff0000'

    // --- Category (plaintext) ---
    category: text('category').notNull().default('case'), // 'contact' | 'case' | 'event' | 'custom'

    // --- Configuration flags (plaintext) ---
    numberingEnabled: boolean('numbering_enabled').notNull().default(false),
    numberPrefix: text('number_prefix'), // e.g. 'CASE', /^[A-Z]{1,5}$/
    allowSubRecords: boolean('allow_sub_records').notNull().default(false),
    allowFileAttachments: boolean('allow_file_attachments').notNull().default(true),
    allowInteractionLinks: boolean('allow_interaction_links').notNull().default(true),
    showInNavigation: boolean('show_in_navigation').notNull().default(true),
    showInDashboard: boolean('show_in_dashboard').notNull().default(false),

    // --- Access control (plaintext) ---
    defaultAccessLevel: text('default_access_level').notNull().default('assigned'), // 'assigned' | 'team' | 'hub'
    piiFields: jsonb<string[]>('pii_fields').notNull().default([]), // field names that are PII → MLS in Part 2
    accessRoles: jsonb<string[]>('access_roles').notNull().default([]),
    editRoles: jsonb<string[]>('edit_roles').notNull().default([]),

    // --- Template tracking (plaintext) ---
    templateId: text('template_id'),         // if created from a template
    templateVersion: text('template_version'),

    // --- Lifecycle (plaintext) ---
    isArchived: boolean('is_archived').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false), // seeded by templates, not user-deletable
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entity_types_hub_idx').on(table.hubId),
    uniqueIndex('entity_types_hub_name_unique').on(table.hubId, table.name),
    // Partial unique: only one default per category per hub (applied via SQL migration)
  ]
)
```

**Notes:**
- `name` is plaintext and immutable — it's the machine identifier used in code, URLs, and permission strings.
- `encryptedLabel`, `encryptedLabelPlural`, `encryptedDescription`, `encryptedIcon`, `encryptedColor` are hub-key encrypted.
- `piiFields` is a JSONB array of field `name` strings. These fields will use MLS encryption for instance values in Part 2. For now, this is just the registry.
- The partial unique index `entity_types_one_default_per_category_per_hub` is added via SQL migration (Drizzle doesn't support WHERE on indexes natively).

### 2.2 `entity_type_statuses` table

Statuses are extracted to their own table (unlike v2 where they're embedded in the entity type JSON) to enable:
- Referential integrity from entity instances
- Independent status management UI
- Status-level permission grants (future)

```typescript
// src/server/db/schema/entity-type-statuses.ts
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'
import { entityTypes } from './entity-types'

export const entityTypeStatuses = pgTable(
  'entity_type_statuses',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),
    entityTypeId: text('entity_type_id')
      .notNull()
      .references(() => entityTypes.id, { onDelete: 'cascade' }),

    // --- Machine value (plaintext) ---
    value: text('value').notNull(), // e.g. 'open', /^[a-zA-Z0-9_-]+$/

    // --- Hub-key encrypted metadata ---
    encryptedLabel: ciphertext('encrypted_label').notNull(),
    encryptedColor: ciphertext('encrypted_color'),       // e.g. '#00ff00'
    encryptedIcon: ciphertext('encrypted_icon'),         // e.g. 'circle-dot'

    // --- Status semantics (plaintext) ---
    isDefault: boolean('is_default').notNull().default(false),
    isClosed: boolean('is_closed').notNull().default(false),   // terminal state
    isDeprecated: boolean('is_deprecated').notNull().default(false), // hidden from new instances
    order: integer('order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entity_type_statuses_hub_idx').on(table.hubId),
    index('entity_type_statuses_entity_type_idx').on(table.entityTypeId),
    uniqueIndex('entity_type_statuses_type_value_unique').on(table.entityTypeId, table.value),
    // Partial unique: only one default per entity type (applied via SQL migration)
  ]
)
```

### 2.3 `entity_type_fields` table (field definitions)

Field definitions are stored relationally (not as JSONB) to allow:
- Querying field types for validation
- Indexing on `indexable` fields for search
- Referential integrity

```typescript
// src/server/db/schema/entity-type-fields.ts
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'
import { entityTypes } from './entity-types'

export const entityTypeFields = pgTable(
  'entity_type_fields',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),
    entityTypeId: text('entity_type_id')
      .notNull()
      .references(() => entityTypes.id, { onDelete: 'cascade' }),

    // --- Machine name (plaintext, immutable) ---
    name: text('name').notNull(), // e.g. 'severity', /^[a-zA-Z0-9_]+$/

    // --- Hub-key encrypted metadata ---
    encryptedLabel: ciphertext('encrypted_label').notNull(),
    encryptedHelpText: ciphertext('encrypted_help_text'),
    encryptedPlaceholder: ciphertext('encrypted_placeholder'),

    // --- Schema (plaintext — server needs these for validation) ---
    fieldType: text('field_type').notNull(), // 'text' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'textarea' | 'date' | 'file' | 'location'
    required: boolean('required').notNull().default(false),
    options: jsonb<{ key: string; label: string }[]>('options'), // for select/multiselect — keys are plaintext, labels encrypted separately
    validation: jsonb<{
      minLength?: number
      maxLength?: number
      min?: number
      max?: number
      pattern?: string
    }>('validation'),
    locationOptions: jsonb<{
      maxPrecision: 'none' | 'city' | 'neighborhood' | 'block' | 'exact'
      allowGps: boolean
      allowAutocomplete: boolean
    }>('location_options'),

    // --- Conditional visibility (plaintext) ---
    showWhen: jsonb<{
      field: string
      operator: 'equals' | 'not_equals' | 'contains' | 'is_set'
      value?: string | number | boolean
    }>('show_when'),

    // --- Access control (plaintext) ---
    accessLevel: text('access_level').notNull().default('all'), // 'all' | 'admin' | 'assigned' | 'custom'
    accessRoles: jsonb<string[]>('access_roles').notNull().default([]),

    // --- Search / index (plaintext) ---
    indexable: boolean('indexable').notNull().default(false),
    indexType: text('index_type').notNull().default('none'), // 'exact' | 'none'

    // --- Layout (plaintext) ---
    section: text('section'), // e.g. 'Details', 'Assessment'
    order: integer('order').notNull().default(0),

    // --- Template tracking (plaintext) ---
    templateId: text('template_id'),
    hubEditable: boolean('hub_editable').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entity_type_fields_hub_idx').on(table.hubId),
    index('entity_type_fields_entity_type_idx').on(table.entityTypeId),
    index('entity_type_fields_indexable_idx').on(table.entityTypeId, table.indexable),
  ]
)
```

**Note on `options`:** The `options` JSONB stores `{ key: string, label: string }` where `key` is plaintext (used for validation, queries, conditional visibility) and `label` is the human-readable string that gets hub-key encrypted. However, to avoid partial encryption complexity in JSONB, we store the full options JSONB as plaintext but encrypt the `label` values separately when sending to the client. The client decrypts labels on fetch; the server uses keys for validation.

**Alternative (recommended):** Store options as plaintext JSONB with `{ key, encryptedLabel }` — the `encryptedLabel` is a hub-field ciphertext. This matches the existing `customFieldDefinitions.encryptedOptions` pattern.

### 2.4 Migration SQL

```sql
-- drizzle/migrations/NNNN_entity_types.sql
-- Create entity_types table
CREATE TABLE IF NOT EXISTS "entity_types" (
  "id" text PRIMARY KEY NOT NULL,
  "hub_id" text NOT NULL DEFAULT 'global',
  "name" text NOT NULL,
  "encrypted_label" text NOT NULL,
  "encrypted_label_plural" text NOT NULL,
  "encrypted_description" text,
  "encrypted_icon" text,
  "encrypted_color" text,
  "category" text NOT NULL DEFAULT 'case',
  "numbering_enabled" boolean NOT NULL DEFAULT false,
  "number_prefix" text,
  "allow_sub_records" boolean NOT NULL DEFAULT false,
  "allow_file_attachments" boolean NOT NULL DEFAULT true,
  "allow_interaction_links" boolean NOT NULL DEFAULT true,
  "show_in_navigation" boolean NOT NULL DEFAULT true,
  "show_in_dashboard" boolean NOT NULL DEFAULT false,
  "default_access_level" text NOT NULL DEFAULT 'assigned',
  "pii_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "access_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "edit_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "template_id" text,
  "template_version" text,
  "is_archived" boolean NOT NULL DEFAULT false,
  "is_system" boolean NOT NULL DEFAULT false,
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "entity_types"
  ADD CONSTRAINT "entity_types_hub_id_hubs_id_fk"
  FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "entity_types_hub_idx" ON "entity_types" ("hub_id");
CREATE UNIQUE INDEX IF NOT EXISTS "entity_types_hub_name_unique" ON "entity_types" ("hub_id", "name");

-- Create entity_type_statuses table
CREATE TABLE IF NOT EXISTS "entity_type_statuses" (
  "id" text PRIMARY KEY NOT NULL,
  "hub_id" text NOT NULL,
  "entity_type_id" text NOT NULL,
  "value" text NOT NULL,
  "encrypted_label" text NOT NULL,
  "encrypted_color" text,
  "encrypted_icon" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_closed" boolean NOT NULL DEFAULT false,
  "is_deprecated" boolean NOT NULL DEFAULT false,
  "order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "entity_type_statuses"
  ADD CONSTRAINT "entity_type_statuses_entity_type_id_fk"
  FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "entity_type_statuses_hub_idx" ON "entity_type_statuses" ("hub_id");
CREATE INDEX IF NOT EXISTS "entity_type_statuses_entity_type_idx" ON "entity_type_statuses" ("entity_type_id");
CREATE UNIQUE INDEX IF NOT EXISTS "entity_type_statuses_type_value_unique" ON "entity_type_statuses" ("entity_type_id", "value");

-- Create entity_type_fields table
CREATE TABLE IF NOT EXISTS "entity_type_fields" (
  "id" text PRIMARY KEY NOT NULL,
  "hub_id" text NOT NULL,
  "entity_type_id" text NOT NULL,
  "name" text NOT NULL,
  "encrypted_label" text NOT NULL,
  "encrypted_help_text" text,
  "encrypted_placeholder" text,
  "field_type" text NOT NULL,
  "required" boolean NOT NULL DEFAULT false,
  "options" jsonb,
  "validation" jsonb,
  "location_options" jsonb,
  "show_when" jsonb,
  "access_level" text NOT NULL DEFAULT 'all',
  "access_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "indexable" boolean NOT NULL DEFAULT false,
  "index_type" text NOT NULL DEFAULT 'none',
  "section" text,
  "order" integer NOT NULL DEFAULT 0,
  "template_id" text,
  "hub_editable" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "entity_type_fields"
  ADD CONSTRAINT "entity_type_fields_entity_type_id_fk"
  FOREIGN KEY ("entity_type_id") REFERENCES "entity_types"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "entity_type_fields_hub_idx" ON "entity_type_fields" ("hub_id");
CREATE INDEX IF NOT EXISTS "entity_type_fields_entity_type_idx" ON "entity_type_fields" ("entity_type_id");
CREATE INDEX IF NOT EXISTS "entity_type_fields_indexable_idx" ON "entity_type_fields" ("entity_type_id", "indexable");
```

---

## 3. Zod Schemas

### 3.1 Shared Schemas (`src/shared/schemas/entity-types.ts`)

```typescript
import { z } from 'zod/v4'

// --- Reusable building blocks ---

export const enumOptionSchema = z.object({
  value: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(50),
  label: z.string().max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).optional(),
  order: z.number().int().min(0).optional().default(0),
  isDefault: z.boolean().optional(),
  isClosed: z.boolean().optional(),
  isDeprecated: z.boolean().optional(),
})
export type EnumOption = z.infer<typeof enumOptionSchema>

export const fieldOptionSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100),
  label: z.string().max(200),
})
export type FieldOption = z.infer<typeof fieldOptionSchema>

export const showWhenSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals', 'contains', 'is_set']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
})
export type ShowWhen = z.infer<typeof showWhenSchema>

// --- Entity Field Definition ---

export const entityFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().regex(/^[a-zA-Z0-9_]+$/).max(50),
  label: z.string().max(200),
  type: z.enum([
    'text', 'number', 'select', 'multiselect', 'checkbox',
    'textarea', 'date', 'file', 'location',
  ]),
  required: z.boolean().optional().default(false),
  options: z.array(fieldOptionSchema).max(50).optional(),
  locationOptions: z.object({
    maxPrecision: z.enum(['none', 'city', 'neighborhood', 'block', 'exact']).optional().default('exact'),
    allowGps: z.boolean().optional().default(true),
    allowAutocomplete: z.boolean().optional().default(true),
  }).optional(),
  validation: z.object({
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
  }).optional(),
  section: z.string().max(100).optional(),
  helpText: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  order: z.number().int().min(0).optional().default(0),
  indexable: z.boolean().optional().default(false),
  indexType: z.enum(['exact', 'none']).optional().default('none'),
  accessLevel: z.enum(['all', 'admin', 'assigned', 'custom']).optional().default('all'),
  accessRoles: z.array(z.string()).optional(),
  showWhen: showWhenSchema.optional(),
  templateId: z.string().optional(),
  hubEditable: z.boolean().optional().default(true),
  createdAt: z.string().optional(),
})
export type EntityFieldDefinition = z.infer<typeof entityFieldDefinitionSchema>

// --- Entity Category ---

export const entityCategorySchema = z.enum(['contact', 'case', 'event', 'custom'])
export type EntityCategory = z.infer<typeof entityCategorySchema>

// --- Entity Type (full) ---

export const entityTypeSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  name: z.string(),
  label: z.string(),
  labelPlural: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  category: entityCategorySchema,
  fields: z.array(entityFieldDefinitionSchema),
  statuses: z.array(enumOptionSchema),
  defaultStatus: z.string(),
  closedStatuses: z.array(z.string()),
  numberingEnabled: z.boolean(),
  numberPrefix: z.string().optional(),
  defaultAccessLevel: z.enum(['assigned', 'team', 'hub']),
  piiFields: z.array(z.string()),
  allowSubRecords: z.boolean(),
  allowFileAttachments: z.boolean(),
  allowInteractionLinks: z.boolean(),
  showInNavigation: z.boolean(),
  showInDashboard: z.boolean(),
  accessRoles: z.array(z.string()).optional(),
  editRoles: z.array(z.string()).optional(),
  templateId: z.string().optional(),
  templateVersion: z.string().optional(),
  isArchived: z.boolean(),
  isSystem: z.boolean(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type EntityType = z.infer<typeof entityTypeSchema>

// --- Create / Update Input Schemas ---

export const createEntityTypeSchema = z.object({
  id: z.string().uuid().optional(), // client-generated for AAD binding
  name: z.string().regex(/^[a-zA-Z0-9_]+$/).max(100),
  label: z.string().min(1).max(200),
  labelPlural: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  icon: z.string().max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  category: entityCategorySchema,
  fields: z.array(entityFieldDefinitionSchema.omit({ id: true }).extend({
    id: z.string().uuid().optional(),
  })).max(100).optional().default([]),
  statuses: z.array(enumOptionSchema).min(1).max(50),
  defaultStatus: z.string(),
  closedStatuses: z.array(z.string()).optional().default([]),
  numberingEnabled: z.boolean().optional().default(false),
  numberPrefix: z.string().regex(/^[A-Z]{1,5}$/).optional(),
  defaultAccessLevel: z.enum(['assigned', 'team', 'hub']).optional().default('assigned'),
  piiFields: z.array(z.string()).optional().default([]),
  allowSubRecords: z.boolean().optional().default(false),
  allowFileAttachments: z.boolean().optional().default(true),
  allowInteractionLinks: z.boolean().optional().default(true),
  showInNavigation: z.boolean().optional().default(true),
  showInDashboard: z.boolean().optional().default(false),
  accessRoles: z.array(z.string()).optional(),
  editRoles: z.array(z.string()).optional(),
  templateId: z.string().optional(),
  templateVersion: z.string().optional(),
})
export type CreateEntityTypeInput = z.infer<typeof createEntityTypeSchema>

export const updateEntityTypeSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  labelPlural: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  icon: z.string().max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fields: z.array(entityFieldDefinitionSchema.omit({ id: true }).extend({
    id: z.string().uuid().optional(),
  })).max(100).optional(),
  statuses: z.array(enumOptionSchema).min(1).max(50).optional(),
  defaultStatus: z.string().optional(),
  closedStatuses: z.array(z.string()).optional(),
  numberingEnabled: z.boolean().optional(),
  numberPrefix: z.string().regex(/^[A-Z]{1,5}$/).optional(),
  defaultAccessLevel: z.enum(['assigned', 'team', 'hub']).optional(),
  piiFields: z.array(z.string()).optional(),
  allowSubRecords: z.boolean().optional(),
  allowFileAttachments: z.boolean().optional(),
  allowInteractionLinks: z.boolean().optional(),
  showInNavigation: z.boolean().optional(),
  showInDashboard: z.boolean().optional(),
  accessRoles: z.array(z.string()).optional(),
  editRoles: z.array(z.string()).optional(),
  isArchived: z.boolean().optional(),
})
export type UpdateEntityTypeInput = z.infer<typeof updateEntityTypeSchema>

// --- Response Wrappers ---

export const entityTypeListResponseSchema = z.object({
  entityTypes: z.array(entityTypeSchema),
})
export const entityTypeResponseSchema = z.object({
  entityType: entityTypeSchema,
})
```

**Notes:**
- `createEntityTypeSchema` accepts `id` optionally so the client can pre-generate a UUID for AAD binding (same pattern as `CreateReportTypeSchema`).
- The `encrypted*` variants are NOT in the zod schemas — the client sends plaintext + encrypted together in the API layer (see §4).

---

## 4. API Routes

### 4.1 Route File: `src/server/routes/entity-types.ts`

Follows the exact pattern of `src/server/routes/report-types.ts`.

```typescript
import { createRoute, z } from '@hono/zod-openapi'
import type { Ciphertext } from '@shared/crypto-types'
import { createEntityTypeSchema, updateEntityTypeSchema, entityTypeSchema } from '@shared/schemas/entity-types'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const entityTypesRoutes = createRouter()

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'et-abc123' }),
})

// ── GET / — list all entity types ──
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Entity Types'],
  summary: 'List entity types',
  responses: {
    200: {
      description: 'Entity types list',
      content: {
        'application/json': {
          schema: z.object({ entityTypes: z.array(entityTypeSchema) }),
        },
      },
    },
  },
})

entityTypesRoutes.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const types = await services.entityTypes.listEntityTypes(hubId)
  return c.json({ entityTypes: types }, 200)
})

// ── POST / — create entity type ──
const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Entity Types'],
  summary: 'Create an entity type',
  middleware: [requirePermission('settings:manage-fields')],
  request: {
    body: {
      content: {
        'application/json': { schema: createEntityTypeSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Entity type created',
      content: {
        'application/json': { schema: z.object({ entityType: entityTypeSchema }) },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

entityTypesRoutes.openapi(createRoute_, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  // The service handles both plaintext fallback and encrypted fields
  const entityType = await services.entityTypes.createEntityType(hubId, body)

  await services.records.addAuditEntry(hubId, 'entityTypeCreated', pubkey, {
    entityTypeId: entityType.id,
    name: entityType.name,
  })

  return c.json({ entityType }, 201)
})

// ── PATCH /:id — update entity type ──
const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Entity Types'],
  summary: 'Update an entity type',
  middleware: [requirePermission('settings:manage-fields')],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        'application/json': { schema: updateEntityTypeSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Entity type updated',
      content: {
        'application/json': { schema: z.object({ entityType: entityTypeSchema }) },
      },
    },
  },
})

entityTypesRoutes.openapi(updateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const entityType = await services.entityTypes.updateEntityType(hubId, id, body)

  await services.records.addAuditEntry(hubId, 'entityTypeUpdated', pubkey, {
    entityTypeId: id,
  })

  return c.json({ entityType }, 200)
})

// ── DELETE /:id — archive entity type ──
const archiveRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Entity Types'],
  summary: 'Archive an entity type',
  middleware: [requirePermission('settings:manage-fields')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Entity type archived',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

entityTypesRoutes.openapi(archiveRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')

  await services.entityTypes.archiveEntityType(hubId, id)
  await services.records.addAuditEntry(hubId, 'entityTypeArchived', pubkey, { entityTypeId: id })

  return c.json({ ok: true }, 200)
})

// ── POST /:id/unarchive ──
const unarchiveRoute = createRoute({
  method: 'post',
  path: '/{id}/unarchive',
  tags: ['Entity Types'],
  summary: 'Unarchive an entity type',
  middleware: [requirePermission('settings:manage-fields')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Entity type restored',
      content: {
        'application/json': { schema: z.object({ entityType: entityTypeSchema }) },
      },
    },
  },
})

entityTypesRoutes.openapi(unarchiveRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')

  const entityType = await services.entityTypes.unarchiveEntityType(hubId, id)
  await services.records.addAuditEntry(hubId, 'entityTypeUnarchived', pubkey, { entityTypeId: id })

  return c.json({ entityType }, 200)
})

export default entityTypesRoutes
```

### 4.2 Service: `src/server/services/entity-types.ts`

Follows the exact pattern of `src/server/services/report-types.ts`.

Key behaviors:
- **Create**: Accepts `id` from client (for AAD binding). Falls back to `crypto.randomUUID()`.
- **Hub-key encryption fallback**: If client doesn't send encrypted fields, server encrypts with hub key using `cryptoService.hubEncryptField()` (same pattern as `custom-fields.ts`).
- **Fields + statuses are atomic**: Creating an entity type inserts into `entity_types`, `entity_type_statuses`, and `entity_type_fields` in a transaction.
- **Update**: Replaces all fields and statuses (full overwrite) to keep the service simple. Partial field updates can be added later if needed.

```typescript
// Simplified service interface
export class EntityTypeService {
  async listEntityTypes(hubId: string): Promise<EntityType[]>
  async getEntityType(hubId: string, id: string): Promise<EntityType | null>
  async createEntityType(hubId: string, data: CreateEntityTypeInput): Promise<EntityType>
  async updateEntityType(hubId: string, id: string, data: UpdateEntityTypeInput): Promise<EntityType>
  async archiveEntityType(hubId: string, id: string): Promise<void>
  async unarchiveEntityType(hubId: string, id: string): Promise<EntityType>
}
```

---

## 5. Client-Side API Client

### 5.1 API Functions (`src/client/lib/api/entity-types.ts`)

```typescript
import type { Ciphertext } from '@shared/crypto-types'
import type { CreateEntityTypeInput, EntityType, UpdateEntityTypeInput } from '@shared/schemas/entity-types'
import { request } from './client'

export async function listEntityTypes() {
  return request<{ entityTypes: EntityType[] }>('/entity-types')
}

export async function createEntityType(data: CreateEntityTypeInput & {
  encryptedLabel?: Ciphertext
  encryptedLabelPlural?: Ciphertext
  encryptedDescription?: Ciphertext
  encryptedIcon?: Ciphertext
  encryptedColor?: Ciphertext
}) {
  return request<{ entityType: EntityType }>('/entity-types', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateEntityType(
  id: string,
  data: UpdateEntityTypeInput & {
    encryptedLabel?: Ciphertext
    encryptedLabelPlural?: Ciphertext
    encryptedDescription?: Ciphertext
    encryptedIcon?: Ciphertext
    encryptedColor?: Ciphertext
  }
) {
  return request<{ entityType: EntityType }>(`/entity-types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function archiveEntityType(id: string) {
  return request<{ ok: boolean }>(`/entity-types/${id}`, { method: 'DELETE' })
}

export async function unarchiveEntityType(id: string) {
  return request<{ entityType: EntityType }>(`/entity-types/${id}/unarchive`, { method: 'POST' })
}
```

### 5.2 React Query Hooks (`src/client/lib/queries/entity-types.ts`)

Follows the decrypt-on-fetch pattern exactly like `src/client/lib/queries/reports.ts` (`useReportTypes`).

```typescript
import { queryOptions, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { decryptHubField } from '@/lib/hub-field-crypto'
import { listEntityTypes, createEntityType, updateEntityType, archiveEntityType, unarchiveEntityType } from '@/lib/api'
import { queryKeys } from './keys'
import type { EntityType } from '@shared/schemas/entity-types'

const entityTypesOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.settings.entityTypes(),
    queryFn: async (): Promise<EntityType[]> => {
      const { entityTypes } = await listEntityTypes()
      return Promise.all(
        entityTypes.map(async (et) => ({
          ...et,
          label: await decryptHubField(et.encryptedLabel, hubId, et.id, 'encrypted_label'),
          labelPlural: await decryptHubField(et.encryptedLabelPlural, hubId, et.id, 'encrypted_label_plural'),
          description: await decryptHubField(et.encryptedDescription, hubId, et.id, 'encrypted_description'),
          icon: await decryptHubField(et.encryptedIcon, hubId, et.id, 'encrypted_icon'),
          color: await decryptHubField(et.encryptedColor, hubId, et.id, 'encrypted_color'),
          // Field labels and status labels are also decrypted
          fields: await Promise.all(
            et.fields.map(async (f) => ({
              ...f,
              label: await decryptHubField(f.encryptedLabel, hubId, f.id, 'encrypted_label'),
              helpText: await decryptHubField(f.encryptedHelpText, hubId, f.id, 'encrypted_help_text'),
              placeholder: await decryptHubField(f.encryptedPlaceholder, hubId, f.id, 'encrypted_placeholder'),
              options: f.options
                ? await Promise.all(
                    f.options.map(async (opt) => ({
                      ...opt,
                      label: await decryptHubField(opt.encryptedLabel, hubId, f.id, `encrypted_option_${opt.key}`),
                    }))
                  )
                : undefined,
            }))
          ),
          statuses: await Promise.all(
            et.statuses.map(async (s) => ({
              ...s,
              label: await decryptHubField(s.encryptedLabel, hubId, s.id, 'encrypted_label'),
              color: await decryptHubField(s.encryptedColor, hubId, s.id, 'encrypted_color'),
              icon: await decryptHubField(s.encryptedIcon, hubId, s.id, 'encrypted_icon'),
            }))
          ),
        }))
      )
    },
    staleTime: 5 * 60 * 1000,
  })

export function useEntityTypes(hubId = 'global') {
  return useQuery(entityTypesOptions(hubId))
}

// Mutations follow the same invalidate pattern as useReportTypes
```

**Query Key Addition:**

```typescript
// src/client/lib/queries/keys.ts
export const queryKeys = {
  // ... existing keys ...
  settings: {
    // ... existing settings keys ...
    entityTypes: () => ['settings', 'entityTypes'] as const,
  },
} as const
```

**ENCRYPTED_QUERY_KEYS classification:**

```typescript
// src/client/lib/query-client.ts
const ENCRYPTED_QUERY_KEYS: QueryKeyDomain[] = [
  // ... existing entries ...
  // Entity types are hub-key encrypted organizational metadata
  // (classified under 'settings' domain — already in ENCRYPTED_QUERY_KEYS)
]
```

Since entity types use the `settings` query key prefix (`['settings', 'entityTypes']`), and `settings` is already in `ENCRYPTED_QUERY_KEYS`, no additional classification is needed.

---

## 6. Admin UI Section

### 6.1 Component: `src/client/components/admin-sections/entity-types-section.tsx`

Modeled after `report-types-section.tsx` and `custom-fields-section.tsx`.

**Features:**
- List all entity types with category badges
- Expand/collapse to see fields and statuses
- Create new entity type with inline form
- Edit existing entity type (full form)
- Archive / unarchive
- Show template source if created from template
- Filter by category

**Key UI patterns from v1:**
- Use `SectionBody`, `SectionDescription` from `@/components/section-layout`
- Use `Badge`, `Button`, `Input`, `Textarea`, `Switch` from `@/components/ui/*`
- Use `data-testid` attributes for every interactive element (E2E test requirement)
- Use `useTranslation()` for all user-facing strings
- Encrypt fields with `encryptHubField()` before sending
- Invalidate `queryKeys.settings.entityTypes()` on mutation success

**Form fields for create/edit:**
- Name (machine name, auto-generated from label if empty)
- Label / Label Plural
- Description
- Category (select: contact, case, event, custom)
- Icon (text input, e.g. 'case-sensitive')
- Color (color picker or hex input)
- Fields section (reorderable list, same UX as custom-fields-section)
- Statuses section (reorderable list with isDefault, isClosed toggles)
- Configuration toggles (numbering, sub-records, file attachments, etc.)

---

## 7. Permission System Integration

### 7.1 New Permissions

Add to `PERMISSION_CATALOG` in `src/shared/permissions.ts`:

```typescript
// Under Settings: Actions
'settings:manage-entity-types': {
  label: 'Create, edit, and archive entity types',
  group: 'settings',
  subgroup: 'actions',
},

// Under a new domain: Entity Types (for instance-level permissions in Part 2)
'entity-types:read-all': {
  label: 'View all entity instances of any type',
  group: 'entity-types',
  subgroup: 'scope',
  scope: 'all',
},
'entity-types:read-assigned': {
  label: 'View entity instances assigned to them',
  group: 'entity-types',
  subgroup: 'scope',
  scope: 'assigned',
},
'entity-types:create': {
  label: 'Create new entity instances',
  group: 'entity-types',
  subgroup: 'actions',
},
'entity-types:update-all': {
  label: 'Edit any entity instance',
  group: 'entity-types',
  subgroup: 'scope',
  scope: 'all',
},
'entity-types:delete': {
  label: 'Delete entity instances',
  group: 'entity-types',
  subgroup: 'actions',
},
```

**Note:** The `settings:manage-fields` permission already exists and is used for custom fields and report types. For the initial rollout, entity type management can reuse `settings:manage-fields` (since it's an admin setting). The new `settings:manage-entity-types` permission is added for future granularity but the routes should accept either:

```typescript
middleware: [requirePermission('settings:manage-fields')], // or 'settings:manage-entity-types'
```

### 7.2 Role Defaults

- **Hub Admin**: gets `settings:manage-entity-types` (via `settings:*` wildcard)
- **Case Manager**: gets `entity-types:read-assigned`, `entity-types:create`, `entity-types:update-all` (for their assigned cases)
- **Volunteer**: gets `entity-types:read-assigned`, `entity-types:create` (for cases they handle)

---

## 8. Migration Path from `report_types`

### 8.1 Data Migration

When this feature ships, existing `report_types` rows must become `entity_types` rows:

```sql
-- Migration: migrate report_types → entity_types
INSERT INTO entity_types (
  id, hub_id, name, encrypted_label, encrypted_label_plural,
  encrypted_description, category, show_in_navigation, show_in_dashboard,
  is_system, created_at, updated_at
)
SELECT
  id, hub_id,
  regexp_replace(lower(name), '[^a-z0-9_]+', '_', 'g'), -- derive machine name
  encrypted_name,                                      -- label
  encrypted_name || 's',                               -- labelPlural (best effort)
  encrypted_description,
  'case',                                              -- category
  true,                                                -- showInNavigation
  false,                                               -- showInDashboard
  false,                                               -- isSystem
  created_at, updated_at
FROM report_types
WHERE NOT EXISTS (SELECT 1 FROM entity_types WHERE entity_types.id = report_types.id);

-- Create default status for migrated report types
INSERT INTO entity_type_statuses (id, hub_id, entity_type_id, value, encrypted_label, is_default, order)
SELECT
  gen_random_uuid()::text, hub_id, id, 'open', 'Open', true, 0
FROM report_types
WHERE NOT EXISTS (SELECT 1 FROM entity_type_statuses WHERE entity_type_statuses.entity_type_id = report_types.id);
```

**Note:** This migration is best-effort. The `name` derivation from the encrypted label is imperfect (we only have ciphertext). A better approach: run a server-side script at startup that decrypts report type names with the hub key, generates proper machine names, and inserts into `entity_types`.

### 8.2 Dual-Read Period

During the transition (until Part 6):
- `report_types` table remains
- `EntityTypeService.listEntityTypes()` should UNION existing report types (as entity types) with new entity types
- The `report-types-section.tsx` UI can be replaced by `entity-types-section.tsx` but still show report types as a read-only "Legacy Report Types" subsection
- `customFieldDefinitions.reportTypeIds` continues to reference `report_types.id` until Part 5

### 8.3 Deprecation Timeline

| Part | Action |
|------|--------|
| Part 1 (this spec) | Create `entity_types`, `entity_type_statuses`, `entity_type_fields`. Migrate report types. Dual-read. |
| Part 2 | Entity instance CRUD using entity types. |
| Part 3 | Relationship types. |
| Part 4 | Template engine. |
| Part 5 | Migrate custom fields to entity type fields. |
| Part 6 | Drop `report_types` table. Remove dual-read. Update all references. |

---

## 9. MLS Integration (Part 2 Preview)

This spec defines the `piiFields` registry on entity types. In Part 2, when creating/updating entity instances:

1. Fields NOT in `piiFields` → hub-key encrypted (same as current hub-field pattern)
2. Fields IN `piiFields` → MLS group encrypted via `MlsConversation.encrypt()`

The MLS encryption flow:
```typescript
// In the client, when saving an entity instance
const conv = await getMlsConversation(hubId) // from hub-bootstrap.ts
const plaintext = JSON.stringify({ fieldName: value, ... })
const ciphertext = await conv.encrypt(new TextEncoder().encode(plaintext))
// Send ciphertext to server as base64
```

The server stores the MLS ciphertext in an `entity_instances` table (defined in Part 2). All hub members with MLS group state can decrypt.

**Important:** Do NOT implement MLS encryption in this spec. Only define `piiFields` as a registry.

---

## 10. Files to Create / Modify

### New Files

| File | Description |
|------|-------------|
| `src/server/db/schema/entity-types.ts` | Drizzle schema for `entity_types` |
| `src/server/db/schema/entity-type-statuses.ts` | Drizzle schema for `entity_type_statuses` |
| `src/server/db/schema/entity-type-fields.ts` | Drizzle schema for `entity_type_fields` |
| `src/shared/schemas/entity-types.ts` | Zod schemas for API |
| `src/server/routes/entity-types.ts` | OpenAPIHono CRUD routes |
| `src/server/services/entity-types.ts` | Service layer |
| `src/client/lib/api/entity-types.ts` | API client functions |
| `src/client/lib/queries/entity-types.ts` | React Query hooks |
| `src/client/components/admin-sections/entity-types-section.tsx` | Admin UI |
| `drizzle/migrations/NNNN_entity_types.sql` | SQL migration |

### Modified Files

| File | Change |
|------|--------|
| `src/server/db/schema/index.ts` | Export new schemas |
| `src/shared/schemas/index.ts` | Export entity-types schema |
| `src/shared/permissions.ts` | Add `settings:manage-entity-types`, `entity-types:*` permissions |
| `src/client/lib/queries/keys.ts` | Add `entityTypes` query key |
| `src/client/lib/api/index.ts` | Export entity-types API |
| `src/server/app.ts` | Mount `/entity-types` routes |
| `src/server/services/index.ts` | Add `EntityTypeService` to service container |

---

## 11. Testing Strategy

### Unit Tests
- `entity-types.test.ts` (colocated with schema): Zod schema validation edge cases
- `entity-type-service.test.ts`: Service layer CRUD, hub scoping, archive logic

### API E2E Tests
- `tests/api/entity-types.spec.ts`:
  - List entity types (auth required)
  - Create entity type (requires `settings:manage-fields`)
  - Update entity type
  - Archive / unarchive
  - Hub isolation (can't see other hub's types)
  - Validation errors (invalid name format, missing label)

### UI E2E Tests
- `tests/ui/entity-types.spec.ts`:
  - Admin navigates to Settings → Entity Types
  - Create new entity type with fields and statuses
  - Edit entity type
  - Archive entity type
  - Verify encrypted labels decrypt correctly

---

## 12. Open Questions

1. **Should we support `severities` and `categories` as separate tables like statuses, or embed them?**
   - v2 embeds them in the entity type JSON. For v1, separate tables give better queryability. Recommend: separate `entity_type_severities` and `entity_type_categories` tables, following the same pattern as `entity_type_statuses`.

2. **How do we handle the `options` field label encryption?**
   - Option A: Store full options as plaintext JSONB, encrypt labels client-side before sending. Server validates using keys.
   - Option B: Store `encryptedLabel` per option in JSONB. This is cleaner but requires the JSONB structure to be `{ key, encryptedLabel }` instead of `{ key, label }`.
   - **Recommendation:** Option B. It matches the existing `customFieldDefinitions.encryptedOptions` pattern.

3. **Should entity types have a `default` flag like report types?**
   - Report types have `isDefault` for the report form. Entity types don't need a global default — the default is context-dependent (e.g., default case type vs default contact type). Omit `isDefault` from entity types; add it later if needed.

4. **Contact roles (`contactRoles` in v2) — in scope?**
   - v2 has `contactRoles` for relationship typing. This is relationship-type metadata, not entity-type metadata. Defer to Part 3 (Relationship Types).

---

## 13. Appendix: v2 → v1 Field Mapping

| v2 Field | v1 Location | Notes |
|----------|-------------|-------|
| `entityTypeDefinition.id` | `entity_types.id` | Same |
| `entityTypeDefinition.name` | `entity_types.name` | Plaintext, machine name |
| `entityTypeDefinition.label` | `entity_types.encrypted_label` | Hub-key encrypted |
| `entityTypeDefinition.labelPlural` | `entity_types.encrypted_label_plural` | Hub-key encrypted |
| `entityTypeDefinition.description` | `entity_types.encrypted_description` | Hub-key encrypted |
| `entityTypeDefinition.icon` | `entity_types.encrypted_icon` | Hub-key encrypted |
| `entityTypeDefinition.color` | `entity_types.encrypted_color` | Hub-key encrypted |
| `entityTypeDefinition.category` | `entity_types.category` | Plaintext enum |
| `entityTypeDefinition.fields` | `entity_type_fields` | Relational, not JSONB |
| `entityTypeDefinition.statuses` | `entity_type_statuses` | Relational, not JSONB |
| `entityTypeDefinition.defaultStatus` | `entity_type_statuses.is_default` | Via partial unique index |
| `entityTypeDefinition.closedStatuses` | `entity_type_statuses.is_closed` | Boolean flag |
| `entityTypeDefinition.severities` | `entity_type_severities` | Future table (see Q1) |
| `entityTypeDefinition.categories` | `entity_type_categories` | Future table (see Q1) |
| `entityTypeDefinition.numberPrefix` | `entity_types.number_prefix` | Plaintext |
| `entityTypeDefinition.numberingEnabled` | `entity_types.numbering_enabled` | Plaintext boolean |
| `entityTypeDefinition.defaultAccessLevel` | `entity_types.default_access_level` | Plaintext |
| `entityTypeDefinition.piiFields` | `entity_types.pii_fields` | JSONB array |
| `entityTypeDefinition.allowSubRecords` | `entity_types.allow_sub_records` | Plaintext |
| `entityTypeDefinition.allowFileAttachments` | `entity_types.allow_file_attachments` | Plaintext |
| `entityTypeDefinition.allowInteractionLinks` | `entity_types.allow_interaction_links` | Plaintext |
| `entityTypeDefinition.showInNavigation` | `entity_types.show_in_navigation` | Plaintext |
| `entityTypeDefinition.showInDashboard` | `entity_types.show_in_dashboard` | Plaintext |
| `entityTypeDefinition.accessRoles` | `entity_types.access_roles` | JSONB |
| `entityTypeDefinition.editRoles` | `entity_types.edit_roles` | JSONB |
| `entityTypeDefinition.isArchived` | `entity_types.is_archived` + `archived_at` | Plaintext |
| `entityTypeDefinition.isSystem` | `entity_types.is_system` | Plaintext |
| `entityTypeDefinition.templateId` | `entity_types.template_id` | Plaintext |
| `entityTypeDefinition.templateVersion` | `entity_types.template_version` | Plaintext |
| `entityFieldDefinition.*` | `entity_type_fields.*` | Direct mapping |
| `enumOptionSchema.*` | `entity_type_statuses.*` | Direct mapping |

---

*End of spec. Ready for review and implementation planning.*
