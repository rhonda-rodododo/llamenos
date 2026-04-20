# Spec: v2 Protocol Templates → v1 Entity/Relationship Architecture

**Date:** 2026-04-19  
**Status:** Draft — architecture spec, no implementation  
**Author:** Sisyphus (dispatched research)  
**Scope:** Docs-only. Defines how v1 (`llamenos-hotline`) can evolve to support v2's template-driven entity/relationship model while preserving zero-knowledge E2EE invariants.

---

## §1 — Goal

Bring v2's rich template system into v1's production E2EE architecture. v2 defines 14 use-case templates (general-hotline, copwatch, street-medic, bail-fund, mutual-aid, ice-rapid-response, jail-support, hate-crime-reporting, stop-the-sweeps, dv-crisis, missing-persons, kyr-training, tenant-organizing, anti-trafficking). Each template declares:

- **Entity types** — what kinds of records exist (e.g. `medical_encounter`, `trafficking_case`)
- **Custom field schemas** — per-entity typed fields with validation, conditional visibility, and indexing
- **Statuses & severities** — per-entity state machines with color-coded labels
- **Contact roles** — how a contact relates to an entity (e.g. `patient`, `witness`, `attorney`)
- **Relationship types** — M:N links between entities (e.g. `immigration_case` ↔ `ice_operation`)
- **Suggested roles** — pre-configured hub roles with permission sets
- **i18n labels** — localized names and descriptions

v1 currently has a fixed entity model (`contacts`, `notes`, `reports`, `intakes`, `conversations`, `calls`) with bolt-on custom fields and a single `contactRelationships` table. The goal is to make v1 **template-configurable** so any hub can adopt a v2 template (or build its own) without code changes, while keeping the server zero-knowledge.

---

## §2 — v2 Template Anatomy

### 2.1 Template manifest structure

```typescript
interface CaseManagementTemplate {
  id: string                 // e.g. "street-medic"
  version: string            // semver
  name: string
  description: string
  author: string
  license?: string
  tags: string[]
  extends: string[]          // template inheritance (general-hotline is base)
  labels: Record<lang, Record<key, string>>  // i18n strings
  entityTypes: EntityTypeTemplate[]
  relationshipTypes: RelationshipTypeTemplate[]
  reportTypes: ReportTypeTemplate[]
  suggestedRoles: SuggestedRoleTemplate[]
}
```

### 2.2 Entity type template

```typescript
interface EntityTypeTemplate {
  name: string               // machine id: "medical_encounter"
  label: string              // i18n key
  labelPlural: string
  description: string
  icon?: string
  color?: string
  category: 'contact' | 'case' | 'event' | 'custom'
  numberPrefix?: string      // e.g. "ME"
  numberingEnabled: boolean
  defaultAccessLevel: 'assigned' | 'team' | 'hub'
  piiFields: string[]        // field names that get envelope-encrypted
  allowSubRecords: boolean
  allowFileAttachments: boolean
  allowInteractionLinks: boolean
  showInNavigation: boolean
  showInDashboard: boolean
  statuses: EnumOption[]
  defaultStatus: string
  closedStatuses: string[]
  severities?: EnumOption[]
  defaultSeverity?: string
  categories?: EnumOption[]
  contactRoles?: EnumOption[]
  fields: FieldTemplate[]
}
```

### 2.3 Field template

```typescript
interface FieldTemplate {
  name: string
  label: string
  type: 'text' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'textarea' | 'date' | 'file'
  required: boolean
  options?: FieldOption[]    // for select/multiselect
  section?: string
  helpText?: string
  order: number
  indexable: boolean
  indexType: 'exact' | 'none'
  accessLevel: 'all' | 'admin' | 'assigned' | 'custom'
  showWhen?: ShowWhen        // conditional visibility
  hubEditable: boolean
  supportAudioInput: boolean
}
```

### 2.4 Relationship type template

```typescript
interface RelationshipTypeTemplate {
  sourceEntityTypeName: string
  targetEntityTypeName: string
  cardinality: '1:1' | '1:N' | 'M:N'
  label: string
  reverseLabel: string
  sourceLabel: string
  targetLabel: string
  roles?: EnumOption[]
  defaultRole?: string
  cascadeDelete: boolean
  required: boolean
}
```

### 2.5 Cross-template patterns observed

| Pattern | Templates | Implication for v1 |
|---|---|---|
| Single entity + contact link | 8 templates (bail-fund, copwatch, street-medic, etc.) | Simplest case: one entity type, M:N contacts |
| Two entity types + cross-link | ice-rapid-response, jail-support, hate-crime-reporting, stop-the-sweeps | Need generic entity-to-entity relationships |
| Report types inside template | jail-support, stop-the-sweeps | Report types become a special case of entity type |
| Sub-records (parent/child) | tenant-organizing (`allowSubRecords: true`) | Need hierarchical entity linking |
| Event tracking (not case mgmt) | kyr-training | Entity category = `event`; no contact roles |
| No contact roles | kyr-training, mass-arrest-event, ice-operation | Entity types can exist without contact linking |

**Field type distribution across all 14 templates:**
- `text`: 28 unique field names
- `textarea`: 29 unique field names
- `select`: 32 unique field names
- `checkbox`: 42 unique field names
- `number`: 25 unique field names
- `date`: 14 unique field names
- `location`: 7 unique field names
- `multiselect`: 2 unique field names
- `file`: 0 in templates (but supported by type system)

v1's current custom field types: `text`, `number`, `select`, `multiselect`, `checkbox`, `textarea`, `location`, `file`. This is a **near-perfect match** — v1 already supports all v2 field types except `date`.

---

## §3 — E2EE Constraints

v1's encryption model is non-negotiable. The template system must be designed **around** these invariants.

### 3.1 Encryption tiers (v1 today)

| Tier | Data | Encryption | Who decrypts |
|---|---|---|---|
| **Tier 0** — Plaintext (queryable) | `contactType`, `riskLevel`, `tags`, `status`, `identifierHash` | None | Server + all clients |
| **Tier 1** — Hub-key encrypted | Org metadata: role names, shift names, report type names, custom field labels | AES-256-GCM via non-extractable `CryptoKey`, per-record AAD | Any hub member with hub key |
| **Tier 2** — ECIES envelope (summary) | Contact display name, notes | ECIES-wrapped per recipient | `contacts:envelope-summary` permission holders |
| **Tier 2** — ECIES envelope (full) | Contact full name, phone, PII blob | ECIES-wrapped per recipient | `contacts:envelope-full` permission holders |
| **Tier 3** — Forward secrecy | Per-note / per-message symmetric key | Unique random key per note, ECIES-wrapped per reader | Note/message recipients |

### 3.2 How templates map to encryption tiers

| Template concept | Encryption treatment | Rationale |
|---|---|---|
| **Template JSON itself** | Stored **plaintext** on server | Schema/config, not user data. The server must know field types to validate and index. |
| **Entity type name/label/description** | **Hub-key encrypted** (Tier 1) | Org metadata — same treatment as role names, shift names |
| **Status labels, severity labels, contact role labels** | **Hub-key encrypted** (Tier 1) | Org metadata — localized, hub-specific |
| **Field labels, help text, section names** | **Hub-key encrypted** (Tier 1) | Org metadata |
| **Field values marked in `piiFields`** | **ECIES envelope** (Tier 2) | Same as contact PII — per-recipient envelope |
| **Field values NOT in `piiFields`** | **Hub-key encrypted** (Tier 1) | Org metadata — readable by all hub members |
| **Relationship payload** | **ECIES envelope** (Tier 2) | Same as current `contactRelationships` — server sees nothing |
| **Entity instance identifiers** | **Plaintext** (queryable) | `hubId`, `entityTypeId`, `status`, `assignedTo`, `createdBy` needed for routing and ACL |

### 3.3 Critical design rule

> The server must be able to validate field values (type checking, requiredness, option membership) **without decrypting them**. This means field schemas (type, required, options list) are plaintext, but field labels and option **labels** are hub-key encrypted. Option **keys** (machine values) are plaintext so the server can validate.

Example:
```json
{
  "name": "category",
  "type": "select",
  "required": true,
  "options": [
    { "key": "general_inquiry", "label": "General Inquiry" },
    { "key": "crisis", "label": "Crisis" }
  ]
}
```

- Server stores: `name=category`, `type=select`, `required=true`, `options=[{key:"general_inquiry"}, {key:"crisis"}]`
- Client encrypts and stores: `label` for each option, plus the field's `label` and `helpText`
- Server validates: `category` must be one of `["general_inquiry", "crisis"]` (plaintext keys)
- Client renders: decrypts labels with hub key

### 3.4 `showWhen` conditional visibility

`showWhen` references field **names** (plaintext) and compares against plaintext values (keys for selects, booleans for checkboxes). The server does not evaluate `showWhen` — it's a client-side rendering concern. The server stores the `showWhen` rule as plaintext JSON.

### 3.5 Indexable fields

v2 templates mark some fields as `indexable: true` with `indexType: 'exact'`. In v1's E2EE model:

- **Plaintext-indexable fields**: `status`, `assignedTo`, `createdAt`, `entityTypeId` — already plaintext
- **Hub-key-encrypted field values**: Cannot be server-indexed. If a field needs server-side filtering (e.g. `category = "crisis"`), the client must either:
  1. Store the value as **plaintext** (relaxing E2EE for that field), or
  2. Use **client-side filtering** after fetching and decrypting

**Recommendation**: For Phase 1, keep `indexable` as a client-side hint. Do not build server indexes on encrypted values. Revisit if performance becomes unacceptable for large datasets.

---

## §4 — Architecture Sketch

### 4.1 Database schema additions

```typescript
// ── entity_types ──
// Stores the configuration for each entity type in a hub.
// Template-loaded on hub creation; admin-editable afterwards.
export const entityTypes = pgTable(
  'entity_types',
  {
    id: text('id').primaryKey(),           // UUID
    hubId: text('hub_id').notNull().default('global'),
    templateId: text('template_id'),        // null = custom/admin-created
    machineName: text('machine_name').notNull(), // e.g. "medical_encounter"
    category: text('category').notNull().default('case'), // 'contact'|'case'|'event'|'custom'

    // Tier 1 — hub-key encrypted metadata
    encryptedName: ciphertext('encrypted_name').notNull(),
    encryptedNamePlural: ciphertext('encrypted_name_plural'),
    encryptedDescription: ciphertext('encrypted_description'),

    // Presentation
    icon: text('icon'),
    color: text('color'),
    numberPrefix: text('number_prefix'),
    numberingEnabled: boolean('numbering_enabled').notNull().default(false),

    // Access / behavior
    defaultAccessLevel: text('default_access_level').notNull().default('assigned'),
    allowSubRecords: boolean('allow_sub_records').notNull().default(false),
    allowFileAttachments: boolean('allow_file_attachments').notNull().default(true),
    allowInteractionLinks: boolean('allow_interaction_links').notNull().default(true),
    showInNavigation: boolean('show_in_navigation').notNull().default(true),
    showInDashboard: boolean('show_in_dashboard').notNull().default(false),

    // Soft delete (template removal)
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entity_types_hub_idx').on(table.hubId),
    unique('entity_types_hub_machine_name_unique').on(table.hubId, table.machineName),
  ]
)

// ── entity_type_statuses ──
// Per-entity-type status definitions (was: hardcoded in report-types)
export const entityTypeStatuses = pgTable(
  'entity_type_statuses',
  {
    id: text('id').primaryKey(),
    entityTypeId: text('entity_type_id').notNull(),
    value: text('value').notNull(),           // machine value: "triaged"
    encryptedLabel: ciphertext('encrypted_label').notNull(),
    color: text('color'),
    icon: text('icon'),
    order: integer('order').notNull().default(0),
    isClosed: boolean('is_closed').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (table) => [
    index('entity_type_statuses_entity_idx').on(table.entityTypeId),
  ]
)

// ── entity_type_fields ──
// Per-entity-type custom field definitions
export const entityTypeFields = pgTable(
  'entity_type_fields',
  {
    id: text('id').primaryKey(),
    entityTypeId: text('entity_type_id').notNull(),
    name: text('name').notNull(),             // machine name: "chief_complaint"
    type: text('type').notNull(),             // 'text'|'number'|'select'|...
    required: boolean('required').notNull().default(false),
    order: integer('order').notNull().default(0),

    // Tier 1 — hub-key encrypted
    encryptedLabel: ciphertext('encrypted_label').notNull(),
    encryptedHelpText: ciphertext('encrypted_help_text'),
    encryptedSection: ciphertext('encrypted_section'),

    // Options (plaintext keys, encrypted labels)
    options: jsonb<{ key: string; encryptedLabel?: string }[]>()('options'),

    // Validation / behavior
    validation: jsonb<Record<string, unknown>>()('validation'), // min/max, regex
    indexable: boolean('indexable').notNull().default(false),
    accessLevel: text('access_level').notNull().default('all'), // 'all'|'admin'|'assigned'|'custom'
    isPii: boolean('is_pii').notNull().default(false),          // derived from template piiFields
    showWhen: jsonb<Record<string, unknown>>()('show_when'),
    hubEditable: boolean('hub_editable').notNull().default(true),
    supportAudioInput: boolean('support_audio_input').notNull().default(false),
  },
  (table) => [
    index('entity_type_fields_entity_idx').on(table.entityTypeId),
  ]
)

// ── entity_type_contact_roles ──
// Per-entity-type contact role definitions
export const entityTypeContactRoles = pgTable(
  'entity_type_contact_roles',
  {
    id: text('id').primaryKey(),
    entityTypeId: text('entity_type_id').notNull(),
    value: text('value').notNull(),           // machine value: "patient"
    encryptedLabel: ciphertext('encrypted_label').notNull(),
    color: text('color'),
    icon: text('icon'),
    order: integer('order').notNull().default(0),
  },
  (table) => [
    index('entity_type_contact_roles_entity_idx').on(table.entityTypeId),
  ]
)

// ── entity_instances ──
// The actual records (was: contacts, reports, intakes as separate tables)
// This is the BIG change — generic table for all entity instances.
export const entityInstances = pgTable(
  'entity_instances',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    entityTypeId: text('entity_type_id').notNull(),

    // Plaintext — queryable / ACL
    status: text('status').notNull().default('open'),
    assignedTo: text('assigned_to'),          // pubkey of primary assignee
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    // Optional auto-numbering
    displayNumber: text('display_number'),    // e.g. "ME-00042"

    // Tier 1 — hub-key encrypted non-PII field values
    // Stored as JSONB: { fieldName: ciphertext }
    encryptedFieldValues: jsonb<Record<string, string>>()('encrypted_field_values')
      .notNull()
      .default({}),

    // Tier 2 — ECIES envelope for PII field values
    // Stored as JSONB: { fieldName: { encryptedValue: ciphertext, envelopes: RecipientEnvelope[] } }
    piiFieldValues: jsonb<Record<string, { encryptedValue: string; envelopes: unknown[] }>>()(
      'pii_field_values'
    )
      .notNull()
      .default({}),
  },
  (table) => [
    index('entity_instances_hub_idx').on(table.hubId),
    index('entity_instances_hub_entity_idx').on(table.hubId, table.entityTypeId),
    index('entity_instances_hub_status_idx').on(table.hubId, table.status),
    index('entity_instances_assigned_idx').on(table.hubId, table.assignedTo),
  ]
)

// ── entity_relationships ──
// Generic M:N relationships between any two entity instances
// Replaces the current contactRelationships table (which is contact→contact only)
export const entityRelationships = pgTable(
  'entity_relationships',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    relationshipTypeId: text('relationship_type_id').notNull(), // refs entity_type_relationship_types
    sourceEntityId: text('source_entity_id').notNull(),
    targetEntityId: text('target_entity_id').notNull(),

    // Tier 2 — fully E2EE payload (role, notes, etc.)
    encryptedPayload: ciphertext('encrypted_payload').notNull(),
    payloadEnvelopes: jsonb<RecipientEnvelope[]>()('payload_envelopes').notNull().default([]),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entity_relationships_hub_idx').on(table.hubId),
    index('entity_relationships_source_idx').on(table.sourceEntityId),
    index('entity_relationships_target_idx').on(table.targetEntityId),
  ]
)

// ── entity_type_relationship_types ──
// Configuration for allowed relationships between entity types
export const entityTypeRelationshipTypes = pgTable(
  'entity_type_relationship_types',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    templateId: text('template_id'),
    sourceEntityTypeId: text('source_entity_type_id').notNull(),
    targetEntityTypeId: text('target_entity_type_id').notNull(),
    cardinality: text('cardinality').notNull().default('M:N'), // '1:1'|'1:N'|'M:N'

    // Tier 1 — hub-key encrypted labels
    encryptedLabel: ciphertext('encrypted_label').notNull(),
    encryptedReverseLabel: ciphertext('encrypted_reverse_label'),
    encryptedSourceLabel: ciphertext('encrypted_source_label'),
    encryptedTargetLabel: ciphertext('encrypted_target_label'),

    // Roles (plaintext keys, encrypted labels)
    roles: jsonb<{ value: string; encryptedLabel?: string; color?: string; order?: number }[]>()(
      'roles'
    ),
    defaultRole: text('default_role'),
    cascadeDelete: boolean('cascade_delete').notNull().default(false),
    required: boolean('required').notNull().default(false),
  },
  (table) => [
    index('entity_type_rel_types_hub_idx').on(table.hubId),
  ]
)
```

### 4.2 Template loader

On **hub creation**, the server (or a background job) reads the selected template JSON and seeds the configuration tables:

1. Insert `entity_types` rows (one per template `entityTypes`)
2. Insert `entity_type_statuses` rows (one per status per entity type)
3. Insert `entity_type_fields` rows (one per field per entity type)
4. Insert `entity_type_contact_roles` rows (one per role per entity type)
5. Insert `entity_type_relationship_types` rows (one per `relationshipTypes`)
6. Insert `suggestedRoles` into the existing `roles` table (with default permissions)

**Encryption at load time**: The loader cannot encrypt labels because it doesn't have the hub key. Instead:
- The loader stores **plaintext labels temporarily** (or empty strings)
- The **first admin client** that unlocks the hub key performs a "template finalize" step: fetches all unencrypted config rows, encrypts labels with the hub key, and PATCHes them back
- Alternatively, the hub-creation flow already requires an admin to be present — encrypt during creation

### 4.3 Custom field renderer

The client already has `custom-field-inputs.tsx` which renders fields based on `CustomFieldDefinition`. This component generalizes to entity-type fields:

```typescript
// Pseudocode for dynamic form generation
function EntityForm({ entityTypeId, instance }: Props) {
  const { fields } = useEntityTypeFields(entityTypeId)
  const hubId = useConfig().currentHubId

  return (
    <form>
      {fields.map((field) => (
        <DynamicFieldInput
          key={field.id}
          field={field}
          value={instance?.fieldValues[field.name]}
          onChange={(val) => updateField(field.name, val)}
        />
      ))}
    </form>
  )
}
```

**Conditional visibility**: `showWhen` is evaluated client-side after decrypting field values. The renderer skips fields whose `showWhen` predicate is false.

### 4.4 Relationship UI

Replace the current `contactRelationships` (contact→contact only) with generic `entityRelationships`:

- **Contact ↔ Entity**: A contact linked to a `medical_encounter` with role `patient`
- **Entity ↔ Entity**: An `immigration_case` linked to an `ice_operation` with role `affected_by`
- **UI pattern**: Same as current relationship section — list of linked entities with role badges, click to navigate

---

## §5 — Phased Delivery

This is a large epic. Breaking it into 5 phases lets us ship incrementally without breaking existing data.

### Phase 1: Generic Entity Type Registry
**Goal**: Admins can create/edit entity types via UI; existing tables untouched.

- DB: Add `entity_types`, `entity_type_statuses` tables
- API: CRUD routes for entity types (hub-key encrypted labels)
- Admin UI: "Entity Types" section in admin shell
- Client: React Query hooks, decrypt-on-fetch
- **No migration of existing data yet** — `contacts`, `reports`, `intakes` stay as-is
- **New code paths only**: creating a new entity type doesn't affect existing records

**Effort estimate**: 2-3 weeks  
**Risk**: Low — additive only

### Phase 2: Custom Field Schema
**Goal**: Per-entity-type field definitions with full type support.

- DB: Add `entity_type_fields` table
- API: CRUD for field definitions
- Client: Dynamic form renderer (extend existing `custom-field-inputs.tsx`)
- Add `date` field type to v1 custom fields (missing vs v2)
- **Migrate existing `custom_field_definitions`**: map `context` → `entity_type_id` (notes→contact, reports→report, etc.)
- **Report types**: Start treating report types as a specialized entity type (`category: 'report'`)

**Effort estimate**: 2-3 weeks  
**Risk**: Medium — touches custom-fields admin UI and all note/report forms

### Phase 3: Relationship Types
**Goal**: Generic M:N relationships between any entities.

- DB: Add `entity_type_relationship_types`, `entity_relationships` tables
- API: CRUD for relationship types; create/link/unlink relationships
- Client: Relationship section generalized beyond contacts
- **Migrate existing `contactRelationships`**: move data from old table to new `entity_relationships` with a synthetic relationship type `contact→contact`
- **Preserve E2EE**: relationship payload stays ECIES-envelope encrypted

**Effort estimate**: 2 weeks  
**Risk**: Medium — data migration of existing relationships

### Phase 4: Template Loader
**Goal**: Import v2 JSON templates on hub creation.

- Build template parser that reads v2 JSON → v1 DB schema
- Handle `extends` (template inheritance) by merging entity types/fields/relationships
- Handle i18n labels: store in `labels` JSONB on `entity_types`, or use existing i18n system
- Add "Choose template" step to hub creation flow
- Seed 14 built-in templates as static JSON files in `src/server/templates/`
- **Template versioning**: store `templateId` + `templateVersion` on config rows so admins know what they started from

**Effort estimate**: 2 weeks  
**Risk**: Low — mostly data transformation, no new crypto

### Phase 5: Template Marketplace / Sharing
**Goal**: Export/import custom templates between hubs; community template gallery.

- Export: serialize a hub's entity types + fields + relationships → template JSON
- Import: validate JSON against `templateManifestSchema`, then seed
- Community gallery: static site or GitHub repo of user-contributed templates
- **License consideration**: v2 templates use CC-BY-SA-4.0; community contributions should specify license

**Effort estimate**: 1-2 weeks  
**Risk**: Low — UX feature

---

## §6 — What v1 Already Has That Maps

| v1 Feature | v2 Equivalent | Gap |
|---|---|---|
| `reportTypes` table + admin UI | Entity type (`category: 'report'`) | Report types lack: statuses, fields, contact roles, relationships |
| `custom_field_definitions` table | `entity_type_fields` | Current custom fields are global per-context, not per-entity-type |
| `contactRelationships` table | `entity_relationships` | Current is contact→contact only; no generic entity support |
| `contacts` table | Entity type (`category: 'contact'`) | Contacts have hardcoded schema; not template-driven |
| Hub-key encryption (`encryptHubField` / `decryptHubField`) | Tier 1 encryption for all org metadata | ✅ Already supports encrypting labels/names |
| ECIES envelope encryption (`RecipientEnvelope`) | Tier 2 encryption for PII fields | ✅ Already supports per-recipient envelopes |
| `ciphertext` column type | Encrypted field storage | ✅ Already used for all encrypted columns |
| `LABEL_HUB_FIELD` | Domain separation for hub-key crypto | ✅ Already defined |
| `LABEL_CONTACT_RELATIONSHIP` | Domain separation for relationship crypto | ✅ Already defined |

**Key insight**: v1's encryption infrastructure is **already sufficient** for the template model. The gap is entirely in the **data model and UI** — making entities generic instead of hardcoded tables.

---

## §7 — Migration Path

### 7.1 Report types → Generic entity types

Current `report_types` table:
```
id | hubId | encryptedName | encryptedDescription | isDefault | archivedAt
```

Target: `entity_types` row with `category: 'report'`.

**Migration steps**:
1. Add `category` column to `report_types` (default `'report'`)
2. Create `entity_types` table
3. Backfill: insert one `entity_types` row for each `report_types` row, copying `id`, `hubId`, `encryptedName`, etc.
4. Add `entity_type_id` to the reports table (or use the same UUID since we copied it)
5. Gradually move report-type-specific logic to generic entity-type logic
6. Eventually drop `report_types` table (post-launch, after validation)

**Zero-downtime**: Keep both tables in sync via triggers or dual-write during transition.

### 7.2 Custom fields → Entity-type fields

Current `custom_field_definitions`:
```
id | hubId | fieldType | required | visibleTo | context | reportTypeIds | order | encryptedFieldName | encryptedLabel | encryptedOptions
```

`context` values: `'notes'`, `'conversations'`, `'reports'`, `'all'`.

**Migration steps**:
1. Create `entity_type_fields` table
2. Map `context` to entity type:
   - `'notes'` → entity type for contacts (or a generic `note` entity)
   - `'reports'` → entity type with `category='report'` and matching `reportTypeIds`
   - `'conversations'` → entity type for conversations
   - `'all'` → duplicate field definition across all relevant entity types
3. Backfill: insert `entity_type_fields` rows for each `custom_field_definitions` row
4. Update client code to read from `entity_type_fields` instead of `custom_field_definitions`
5. Drop `custom_field_definitions` after validation

### 7.3 Contact relationships → Generic relationships

Current `contactRelationships`:
```
id | hubId | encryptedPayload | payloadEnvelopes | createdBy | createdAt
```

**Migration steps**:
1. Create `entity_type_relationship_types` with a synthetic type: `contact ↔ contact`
2. Create `entity_relationships` table with same schema + `relationshipTypeId`
3. Backfill: copy all rows from `contactRelationships` to `entity_relationships`, setting `relationshipTypeId` to the synthetic contact-contact type
4. Update client queries to use `entity_relationships`
5. Drop `contactRelationships` after validation

### 7.4 Contacts → Entity instances

This is the **hardest migration** because `contacts` is a heavily used table with many indexed columns and foreign key references from `contactCallLinks`, `contactConversationLinks`, `notes`, etc.

**Recommended approach**: Do NOT migrate contacts to `entity_instances` in Phase 1-4. Keep `contacts` as a specialized, hardcoded entity type. Only **new** entity types (created from templates) use `entity_instances`. In a future Phase 6, consider unifying contacts into the generic model if the complexity is justified.

**Rationale**: Contacts have unique concerns (identifier hash for dedup, tiered E2EE with `contacts:envelope-summary` vs `contacts:envelope-full`, merge tracking, assignment). Forcing them into a generic schema too early risks breaking these invariants.

---

## §8 — Open Questions

1. **Should contacts be migrated to generic `entity_instances`?**
   - Pro: Unified model, simpler code
   - Con: Contacts have unique E2EE tiers (summary vs full envelopes) and indexing needs that don't generalize cleanly
   - **Recommendation**: Keep contacts specialized for now; revisit in Phase 6

2. **How should template `extends` work in v1?**
   - v2 templates can extend other templates (e.g. all extend `general-hotline`)
   - Options: (a) server-side merge at load time, (b) client-side resolution, (c) flatten at build time
   - **Recommendation**: Server-side merge at load time — simpler, no runtime complexity

3. **Should entity type configuration be versioned?**
   - If an admin edits a template-loaded entity type, future template updates shouldn't overwrite their changes
   - Options: (a) fork-on-edit (disconnect from template), (b) three-way merge, (c) manual re-import
   - **Recommendation**: Fork-on-edit — store `templateId` + `forkedAt` timestamp; template updates only affect non-forked rows

4. **How to handle `indexable` fields server-side?**
   - Server cannot index encrypted values
   - Options: (a) client-side filtering only, (b) opt-in plaintext for specific fields, (c) encrypted search index (complex)
   - **Recommendation**: Client-side filtering for Phase 1-3; revisit if datasets exceed ~10k records per hub

5. **What happens to existing `report-types` admin UI?**
   - Report types become a subset of entity types
   - Options: (a) keep separate "Report Types" admin section, (b) fold into "Entity Types" with filter
   - **Recommendation**: Fold into "Entity Types" with a `category='report'` filter; reduces UI surface area

6. **Should template JSON files live in the v1 repo or a separate package?**
   - v2 has them in `packages/protocol/templates/`
   - Options: (a) copy into v1 repo, (b) git submodule, (c) npm package
   - **Recommendation**: Copy into `src/server/templates/` in v1 repo for now; extract to shared package when v2 stabilizes

7. **Permission model for entity types**
   - v2 has `defaultAccessLevel: 'assigned' | 'team' | 'hub'`
   - v1 has granular permissions (`contacts:envelope-summary`, `contacts:envelope-full`, etc.)
   - How to map? Should each entity type get its own permission namespace?
   - **Recommendation**: Use permission patterns like `{entityType}:read`, `{entityType}:write`, `{entityType}:admin` generated dynamically from entity type machine names

8. **Auto-numbering (`numberPrefix` + `numberingEnabled`)**
   - v2 templates specify per-entity-type prefixes (e.g. "ME-00042")
   - v1 has no auto-numbering today
   - Implementation: server-side counter per hub per entity type, or client-generated with server uniqueness check
   - **Recommendation**: Server-side counter in a new `entity_type_counters` table; plaintext `displayNumber` on `entity_instances`

---

## Appendix A — v2 Template Inventory

| Template | Entity Types | Relationships | Report Types | Suggested Roles |
|---|---|---|---|---|
| general-hotline | `general_case` | contact→case | — | — |
| copwatch | `police_conduct_case` | contact→case | — | 4 |
| street-medic | `medical_encounter` | contact→case | — | 3 |
| bail-fund | `bail_fund_case` | contact→case | — | 4 |
| mutual-aid | `aid_request` | contact→case | — | 4 |
| ice-rapid-response | `immigration_case`, `ice_operation` | contact→case, case→event | — | 4 |
| jail-support | `arrest_case`, `mass_arrest_event` | contact→case, case→event | 2 | 4 |
| hate-crime-reporting | `bias_incident`, `incident_cluster` | contact→case, case→cluster | — | 4 |
| stop-the-sweeps | `displaced_person`, `sweep_event` | contact→case, case→event | 2 | 4 |
| dv-crisis | `safety_plan_case` | contact→case | — | 5 |
| missing-persons | `missing_person_case` | contact→case | — | 6 |
| kyr-training | `community_training` | — | — | 3 |
| tenant-organizing | `eviction_defense_case` | contact→case | — | 4 |
| anti-trafficking | `trafficking_case` | contact→case | — | 6 |

**Totals**: 20 unique entity types, 18 relationship types, 4 report types, 57 suggested roles.

## Appendix B — Files to Reference

- v2 template types: `~/projects/llamenos/packages/protocol/template-types.ts`
- v2 templates: `~/projects/llamenos/packages/protocol/templates/*.json`
- v1 custom fields schema: `src/server/db/schema/settings.ts` (`customFieldDefinitions`)
- v1 custom fields UI: `src/client/components/admin-sections/custom-fields-section.tsx`
- v1 report types schema: `src/server/db/schema/report-types.ts`
- v1 report types service: `src/server/services/report-types.ts`
- v1 contact relationships: `src/server/db/schema/contacts.ts` (`contactRelationships`)
- v1 relationship UI: `src/client/components/contacts/contact-relationship-section.tsx`
- v1 crypto labels: `src/shared/crypto-labels.ts`
- v1 hub-field crypto: `src/client/lib/hub-field-crypto.ts`
