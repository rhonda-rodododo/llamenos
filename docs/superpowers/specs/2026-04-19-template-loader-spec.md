# Template Loader + Marketplace Spec

> **v2→v1 Series, Part 5 of 6**  
> **Date:** 2026-04-19  
> **Status:** Draft — ready for review  
> **Scope:** Docs-only spec. No code changes in this PR.

---

## 1. Overview

This spec defines how Llámenos v1 (the hotline webapp) will import **case-management templates** from the v2 protocol repository (`packages/protocol/templates/`). Templates are JSON configuration packages that bootstrap a hub's schema with entity types, custom fields, statuses, relationship types, report types, suggested roles, and i18n labels tailored to specific use cases (jail support, DV crisis, copwatch, etc.).

The goal is to let new organizations choose a template during hub creation and have their hub pre-configured with domain-appropriate data structures, rather than starting from a blank slate.

### 1.1 What This Spec Covers

- Template JSON parsing and validation (reusing v2's zod schemas)
- Template `extends` inheritance resolution
- Hub creation flow: "Choose a template" step
- Seeding entity types, fields, statuses, relationships, suggested roles from template
- Template versioning and update semantics
- Hub-key encryption of all labels during seeding
- Suggested roles → v1 role creation with permission mapping
- i18n label handling (templates carry multi-language labels)
- Future: export hub config → template JSON, import custom templates, community gallery
- Template summary API for listing available templates without loading full JSON

### 1.2 What This Spec Does NOT Cover

- v2 entity runtime (entity records, sub-records, relationship queries) — that is Part 6
- Template marketplace UI beyond the hub-creation picker
- Community rating/review system

---

## 2. Background: v2 Template System

### 2.1 Template Structure

v2 templates live in `packages/protocol/templates/` and conform to `templateManifestSchema` (defined in `packages/protocol/template-types.ts`). Key sections:

| Section | Description |
|---------|-------------|
| `id`, `version`, `name`, `description` | Metadata |
| `extends` | Array of template IDs to inherit from (currently all `[]`) |
| `labels` | Per-language translation map for entity/report type labels |
| `entityTypes` | Case/event/contact type definitions with fields, statuses, severities |
| `relationshipTypes` | Contact↔entity and entity↔entity relationship definitions |
| `reportTypes` | Reporter-facing form definitions (jail-support LO reports, etc.) |
| `suggestedRoles` | Pre-built role definitions with permission arrays |

### 2.2 Representative Templates

The v2 repo ships 14 templates:

- `general-hotline` — minimal base (cases, contacts, follow-ups)
- `copwatch` — police accountability (badge numbers, incident types, CCRB referrals)
- `dv-crisis` — domestic violence (lethality assessment, shelter placement, protection orders)
- `ice-rapid-response` — immigration enforcement (ICE operations, legal referrals, accompaniment)
- `street-medic` — protest medical (triage, treatment, disposition)
- `tenant-organizing` — eviction defense (housing court, rent stabilization, HP actions)
- `bail-fund` — community bail (disbursements, court monitoring, bond types)
- `jail-support` — mass arrest (arraignment tracking, attorney matching, LO reports)
- `mutual-aid` — disaster response (aid requests, resource delivery)
- `kyr-training` — community education (training events, attendance)
- `anti-trafficking`, `hate-crime-reporting`, `missing-persons`, `stop-the-sweeps`

All templates currently set `extends: []`. The architecture supports inheritance (e.g., `general-hotline` as base, others extending it), but it is not yet used.

### 2.3 Field Types in Templates

v2 templates declare fields with these types:

```
text, number, select, multiselect, checkbox, textarea, date, file, location, contact, contacts
```

v1's `CustomFieldDefinition` currently supports:

```
text, number, select, checkbox, textarea, file, location, contact, contacts
```

**Gap:** `multiselect` and `date` are missing from v1 custom fields. These must be added to v1's `CustomFieldDefinitionSchema` and the `custom_field_definitions` table before template fields using them can be seeded.

---

## 3. v1 Context: Where Templates Fit

### 3.1 Hub Creation Today

Hubs are created via:

1. **Setup wizard** (`src/client/components/setup/SetupWizard.tsx`) — on first admin login, completes setup and auto-creates a default hub named `HOTLINE_NAME` with the admin assigned `role-super-admin`.
2. **Admin Hubs section** (`src/client/components/admin-sections/hubs-section.tsx`) — super admins can create additional hubs with name, description, and phone number.

Both paths call `POST /hubs` → `services.settings.createHub()` → `hub-management.ts:createHub()`.

After hub creation, the setup wizard generates a hub key and distributes it:

```typescript
const { envelopes } = services.crypto.generateAndWrapHubKey([pubkey])
await services.settings.setHubKeyEnvelopes(newHub.id, envelopes)
```

### 3.2 Hub-Key Encryption Pattern

v1 encrypts hub-scoped metadata (role names, shift names, report type names, custom field labels, etc.) with a per-hub AES-256-GCM key. The pattern:

- **Server stores** `encryptedName`, `encryptedDescription`, etc. in `ciphertext` columns
- **Client decrypts** via `decryptHubField(encryptedValue, hubId, recordId, fieldName)` in React Query `queryFn`
- **Client encrypts** via `encryptHubField(value, hubId, recordId, fieldName)` before sending to server
- **Server fallback:** if `encryptedName` is missing, uses plaintext `name` (for bootstrap-seeded values before hub key exists)

This pattern is already used for:
- `hubs.encryptedName` / `encryptedDescription`
- `roles.encryptedName` / `encryptedDescription`
- `reportTypes.encryptedName` / `encryptedDescription`
- `customFieldDefinitions.encryptedFieldName` / `encryptedLabel` / `encryptedOptions`

### 3.3 Role System

v1 roles are stored in the `roles` table with:
- `id`, `hubId` (null = global), `encryptedName`, `encryptedDescription`
- `permissions: jsonb<string[]>`
- `isDefault: boolean`

Default roles (`DEFAULT_ROLES` in `src/shared/permissions.ts`) are auto-seeded on first `listRoles()` call:
- `role-super-admin`, `role-hub-admin`, `role-reviewer`, `role-case-manager`, `role-volunteer`, `role-reporter`, `role-voicemail-reviewer`

The `listRoles()` service encrypts default role names with the hub key if available, or stores plaintext as fallback.

### 3.4 Report Types

v1 report types are stored in `report_types` with:
- `id`, `hubId`, `encryptedName`, `encryptedDescription`, `isDefault`, `archivedAt`

There is currently no UI for admin report-type management. The table exists and is used by the reporter portal.

### 3.5 Custom Fields

v1 custom fields are stored in `custom_field_definitions` with:
- `id`, `hubId`, `fieldType`, `required`, `visibleTo`, `context`, `reportTypeIds`, `order`
- `encryptedFieldName`, `encryptedLabel`, `encryptedOptions`

Admin UI exists at `src/client/components/admin-sections/custom-fields-section.tsx`.

### 3.6 i18n System

v1 uses i18next with locale files in `public/locales/` (22 languages). All user-facing strings must have entries in every locale file or the CI `check-locales.ts` script fails.

Template labels are NOT i18next keys — they are per-template translation maps. The template loader must resolve template labels into the hub's encrypted metadata, not into the global i18n system.

---

## 4. Design

### 4.1 High-Level Flow

```
Admin creates hub
    ↓
[NEW] "Choose a template" step (optional — "Blank hub" is default)
    ↓
Template JSON loaded from server bundle (not fetched from v2 repo at runtime)
    ↓
Template validated against zod schema
    ↓
Hub created (existing flow)
    ↓
Hub key generated and distributed (existing flow)
    ↓
Template entities seeded:
    - Report types → report_types table
    - Custom fields → custom_field_definitions table
    - Roles → roles table (suggestedRoles only, default roles still auto-seeded)
    - Labels → resolved and encrypted with hub key
    ↓
Admin lands in new hub with pre-configured schema
```

### 4.2 Template Source

**Decision:** Template JSON files are copied into v1's repository at build time (e.g., `src/shared/templates/` or `public/templates/`). They are NOT fetched from the v2 repo at runtime.

**Rationale:**
- v1 is a self-hosted app with no dependency on v2 infrastructure
- Templates are small (~5-50KB each, 14 files = ~400KB total)
- Bundling ensures templates are available offline and version-locked with the app
- Future marketplace can add dynamic template loading as an extension

**Build integration:**
- Add a `scripts/copy-templates.sh` that copies `../llamenos/packages/protocol/templates/*.json` into `src/shared/templates/`
- Or use a Bun build step / Vite plugin to import them as JSON modules
- Template manifest (index) generated at build time listing IDs, names, versions, tags

### 4.3 Template Validation

Reuse v2's `templateManifestSchema` (from `packages/protocol/template-types.ts`) in v1:

```typescript
// src/shared/schemas/templates.ts
import { z } from 'zod/v4'

// Copy of v2's templateManifestSchema
export const TemplateManifestSchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string(),
  author: z.string(),
  license: z.string().optional(),
  tags: z.array(z.string()),
  extends: z.array(z.string()).default([]),
  labels: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  entityTypes: z.array(entityTypeTemplateSchema),
  relationshipTypes: z.array(relationshipTypeTemplateSchema).default([]),
  reportTypes: z.array(reportTypeTemplateSchema).default([]),
  suggestedRoles: z.array(suggestedRoleTemplateSchema).default([]),
})

export type TemplateManifest = z.infer<typeof TemplateManifestSchema>
```

**Note:** The sub-schemas (`entityTypeTemplateSchema`, etc.) must also be copied. This is intentional duplication — v1 should not import from v2 at runtime.

### 4.4 Template Inheritance (`extends`)

v2 templates declare `extends: []` today, but the schema supports inheritance. The loader must resolve inheritance at load time:

```typescript
function resolveTemplate(manifest: TemplateManifest, allTemplates: Map<string, TemplateManifest>): TemplateManifest {
  if (manifest.extends.length === 0) return manifest

  const merged: TemplateManifest = {
    ...manifest,
    entityTypes: [],
    relationshipTypes: [],
    reportTypes: [],
    suggestedRoles: [],
    labels: {},
  }

  for (const parentId of manifest.extends) {
    const parent = allTemplates.get(parentId)
    if (!parent) throw new Error(`Template ${manifest.id} extends unknown template ${parentId}`)
    const resolvedParent = resolveTemplate(parent, allTemplates)
    merged.entityTypes.push(...resolvedParent.entityTypes)
    merged.relationshipTypes.push(...resolvedParent.relationshipTypes)
    merged.reportTypes.push(...resolvedParent.reportTypes)
    merged.suggestedRoles.push(...resolvedParent.suggestedRoles)
    merged.labels = { ...merged.labels, ...resolvedParent.labels }
  }

  // Child overrides parent for same-named entities
  const entityMap = new Map(merged.entityTypes.map(e => [e.name, e]))
  for (const et of manifest.entityTypes) entityMap.set(et.name, et)
  merged.entityTypes = Array.from(entityMap.values())

  // Same for report types, roles, etc.
  // ...

  return merged
}
```

**Conflict resolution:** Child wins for same `name`/`id`. Labels are shallow-merged per-language.

### 4.5 Hub Creation with Template

#### 4.5.1 API Changes

`POST /hubs` currently accepts:

```typescript
{
  name?: string
  encryptedName?: string
  description?: string
  encryptedDescription?: string
  phoneNumber?: string
}
```

**Add:** optional `templateId?: string` field.

```typescript
const createHubRoute = createRoute({
  // ...
  request: {
    body: {
      schema: z.object({
        name: z.string().optional(),
        encryptedName: z.string().optional(),
        description: z.string().optional(),
        encryptedDescription: z.string().optional(),
        phoneNumber: z.string().optional(),
        templateId: z.string().optional(), // NEW
      }),
    },
  },
})
```

#### 4.5.2 Server Flow

```typescript
routes.openapi(createHubRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  const nameValue = body.encryptedName?.trim() || body.name?.trim()
  if (!nameValue) return c.json({ error: 'Name required' }, 400)

  // 1. Create hub (existing)
  const hub = await services.settings.createHub({...})

  // 2. Bootstrap MLS (existing)
  // ...

  // 3. Generate hub key (existing)
  const { envelopes } = services.crypto.generateAndWrapHubKey([pubkey])
  await services.settings.setHubKeyEnvelopes(hub.id, envelopes)

  // 4. [NEW] Apply template if specified
  if (body.templateId) {
    const templateLoader = c.get('templateLoader') // or services.templates
    await templateLoader.applyTemplate(hub.id, body.templateId, pubkey)
  }

  // 5. Provision storage (existing)
  // ...

  return c.json({ hub }, 200)
})
```

**Key constraint:** The hub key must be generated BEFORE template seeding, because all template labels need to be encrypted with the hub key.

#### 4.5.3 Template Application Service

New service: `TemplateLoaderService` (`src/server/services/template-loader.ts`)

Responsibilities:
1. Load and validate template JSON
2. Resolve `extends` inheritance
3. Map template entities to v1 database records
4. Encrypt all labels with hub key
5. Insert into appropriate tables
6. Audit log the seeding operation

```typescript
export class TemplateLoaderService {
  constructor(
    private db: Database,
    private crypto: CryptoService,
    private settings: SettingsService,
    private reportTypes: ReportTypeService,
    private records: RecordsService,
  ) {}

  async applyTemplate(hubId: string, templateId: string, actorPubkey: string): Promise<void> {
    const template = await this.loadTemplate(templateId)
    const hubKey = await this.settings.getHubKey(hubId)
    if (!hubKey) throw new AppError(500, 'Hub key not available for template seeding')

    await this.db.transaction(async (tx) => {
      // Seed report types
      for (const rt of template.reportTypes) {
        await this.seedReportType(tx, hubId, rt, hubKey)
      }

      // Seed custom fields (from entityTypes.fields)
      for (const et of template.entityTypes) {
        for (const field of et.fields) {
          await this.seedCustomField(tx, hubId, et, field, hubKey)
        }
      }

      // Seed suggested roles
      for (const sr of template.suggestedRoles) {
        await this.seedRole(tx, hubId, sr, hubKey)
      }

      // Audit log
      await this.records.addAuditEntry(hubId, 'templateApplied', actorPubkey, {
        templateId: template.id,
        templateVersion: template.version,
        entityTypes: template.entityTypes.map(e => e.name),
        reportTypes: template.reportTypes.map(r => r.name),
        roles: template.suggestedRoles.map(r => r.slug),
      })
    })
  }
}
```

### 4.6 Mapping Template Entities to v1 Tables

#### 4.6.1 Report Types → `report_types`

Template `reportTypes` map directly to v1 `report_types`:

| Template Field | v1 DB Column | Notes |
|----------------|--------------|-------|
| `name` | `encryptedName` | Encrypt with hub key, AAD = `(id, 'encrypted_name')` |
| `label` | `encryptedName` | Use `label` (human-readable) not `name` (machine key) |
| `description` | `encryptedDescription` | Encrypt with hub key |
| `statuses` | NOT stored | v1 report types don't have per-type statuses yet |
| `fields` | NOT stored | v1 report types don't have per-type fields yet |

**Gap:** v1 `report_types` table has no columns for `statuses`, `fields`, `icon`, `color`, `numberPrefix`, `numberingEnabled`, `allowFileAttachments`, `allowCaseConversion`, `mobileOptimized`. These are v2 features.

**Decision for v1:** Store report type metadata as a hub-encrypted JSON blob in a new column `report_types.encryptedConfig`, or defer per-type statuses/fields to Part 6. For Part 5, seed only `name` and `description`.

#### 4.6.2 Entity Type Fields → `custom_field_definitions`

Template `entityTypes[].fields` map to v1 custom fields:

| Template Field | v1 DB Column | Transform |
|----------------|--------------|-----------|
| `name` | `encryptedFieldName` | Encrypt with hub key |
| `label` | `encryptedLabel` | Encrypt with hub key |
| `type` | `fieldType` | Map `multiselect` → `select` (or add `multiselect` support) |
| `required` | `required` | Pass through |
| `options` | `encryptedOptions` | JSON-stringify and encrypt |
| `section` | NOT stored | v1 custom fields have no section grouping |
| `helpText` | NOT stored | Could be added to `encryptedOptions` metadata |
| `order` | `order` | Pass through |
| `indexable` | NOT stored | v1 has no server-side indexing of custom fields |
| `accessLevel` | `visibleTo` | Map: `all` → `contacts:envelope-summary`, `admin` → `contacts:envelope-full`, `assigned` → `contacts:envelope-summary` |
| `showWhen` | NOT stored | Conditional field display not yet in v1 |

**Context assignment:** Template fields should be seeded with `context: 'notes'` (or `context: 'reports'` for report-type fields). This controls where they appear in the UI.

**Field type gaps:**
- `date` — not in v1 `CustomFieldDefinitionSchema`. Must be added.
- `multiselect` — not in v1. Must be added, or mapped to `select` with a note.
- `file` — supported in v1
- `location` — supported in v1
- `contact` / `contacts` — supported in v1

#### 4.6.3 Suggested Roles → `roles`

Template `suggestedRoles` map to v1 roles:

| Template Field | v1 DB Column | Transform |
|----------------|--------------|-----------|
| `name` | `encryptedName` | Encrypt with hub key |
| `description` | `encryptedDescription` | Encrypt with hub key |
| `permissions` | `permissions` | Pass through (but validate against `PERMISSION_CATALOG`) |
| `slug` | `id` | Use `slug` as role ID, prefix with `role-` if needed |

**Permission validation:** Template permissions must be checked against v1's `PERMISSION_CATALOG`. Unknown permissions should be:
- Logged as a warning
- Stripped from the role (don't fail the whole template)
- OR mapped to closest equivalent (e.g., `evidence:*` → `files:*`)

**Decision:** Strip unknown permissions with a warning. v1's permission catalog is the source of truth.

**Role ID collision:** If a suggested role slug collides with a default role ID (`role-super-admin`, `role-hub-admin`, etc.), prefix it: `role-template-{slug}`.

#### 4.6.4 Statuses, Severities, Contact Roles

These are template metadata that v1 does not yet have database tables for.

**Options:**
1. Store as hub-encrypted JSON in a new `hub_template_config` table
2. Defer to Part 6 (entity runtime)

**Decision:** Store in a new `hub_template_config` table as hub-encrypted JSON. This preserves the data for Part 6 without blocking Part 5.

```typescript
// src/server/db/schema/template-config.ts
export const hubTemplateConfig = pgTable('hub_template_config', {
  hubId: text('hub_id').primaryKey().references(() => hubs.id),
  templateId: text('template_id').notNull(),
  templateVersion: text('template_version').notNull(),
  encryptedConfig: ciphertext('encrypted_config').notNull(), // JSON of statuses, severities, contactRoles, relationshipTypes
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

The `encryptedConfig` contains the full template manifest (minus labels, which are already encrypted into individual rows) so Part 6 can deserialize it.

### 4.7 Label Resolution and i18n

Templates carry labels in multiple languages:

```json
{
  "labels": {
    "en": { "general_case.label": "Case", "general_case.labelPlural": "Cases" },
    "es": { "general_case.label": "Caso", "general_case.labelPlural": "Casos" }
  }
}
```

Entity types reference labels by key:

```json
{
  "name": "general_case",
  "label": "general_case.label",
  "labelPlural": "general_case.labelPlural",
  "description": "general_case.description"
}
```

**Resolution strategy:**

1. Determine the hub's primary language (from setup wizard or admin preference)
2. Resolve label keys against `labels[language]`
3. Fall back to `labels['en']` if key missing
4. Fall back to the raw key string if still missing
5. Encrypt resolved plaintext with hub key

**Label keys in entity type fields:** Field `label` values are literal strings (not keys), so no resolution needed. Only `entityType.label`, `entityType.labelPlural`, `entityType.description`, `reportType.label`, `reportType.labelPlural`, `reportType.description` use the key system.

**Contact role labels:** Also use the key system. Resolved and encrypted the same way.

### 4.8 Hub-Key Encryption During Seeding

All seeded values must be encrypted with the hub key using the same AAD formula as existing v1 code:

```typescript
// Server-side encryption during seeding
function hubEncryptField(
  cryptoService: CryptoService,
  plaintext: string,
  hubKey: Uint8Array,
  recordId: string,
  fieldName: string
): Ciphertext {
  return cryptoService.hubEncryptField(plaintext, hubKey, recordId, fieldName)
}
```

The AAD is `hubFieldAad(recordId, fieldName)` which binds the ciphertext to the specific row and column.

**Critical:** The `recordId` used for AAD must be the same ID that the client will use when decrypting. For server-generated IDs (UUIDs), the client doesn't know the ID at encryption time. This is why v1's existing pattern requires:

- Client pre-generates the UUID and sends it in the create request
- Server stores that same ID
- Both sides use it for AAD

For template seeding, the server generates the IDs, so the client cannot pre-encrypt. Therefore:

**Server encrypts during seeding.** The client will decrypt on first fetch using the server-stored IDs. This is the same pattern used for default role seeding in `role-management.ts:listRoles()`.

### 4.9 Template Summary API

For the hub creation UI, we need a lightweight endpoint that lists available templates without loading full JSON:

```typescript
// GET /templates
{
  "templates": [
    {
      "id": "general-hotline",
      "version": "1.1.0",
      "name": "General Hotline",
      "description": "Basic hotline case tracking...",
      "author": "Llamenos Project",
      "license": "CC-BY-SA-4.0",
      "tags": ["hotline", "general", "basic"],
      "extends": [],
      "entityTypeCount": 1,
      "reportTypeCount": 0,
      "suggestedRoleCount": 0,
      "languages": ["en", "es"]
    },
    {
      "id": "copwatch",
      "version": "1.0.0",
      "name": "Police Accountability / Copwatch",
      "description": "Police conduct documentation...",
      // ...
    }
  ]
}
```

This is generated at build time from the template JSON files and served as a static JSON asset (e.g., `/templates/index.json`). No server endpoint needed.

### 4.10 Client-Side Hub Creation UI

#### 4.10.1 Setup Wizard Integration

Add a new step (or sub-step) to the setup wizard after "Identity" (step 0):

**Step 0.5: Choose Template**

- Display template cards with name, description, tags
- Show entity type count, report type count, role count as badges
- "Blank hub" option (default, no template)
- Selection stored in `SetupData` as `templateId?: string`

On `completeSetup()`, the `templateId` is passed to `POST /hubs` (or `POST /setup/complete` if we add template support there).

#### 4.10.2 Admin Hub Creation Dialog

The `CreateHubDialog` in `hubs-section.tsx` should also offer template selection:

- Add a `<Select>` or card grid for template choice
- Default to "Blank hub"
- Pass `templateId` to `createHub.mutate()`

### 4.11 Template Versioning and Updates

**Question:** What happens when a template gets a new version?

**Decision for v1 (Part 5):** Templates are immutable after hub creation. There is NO automatic update mechanism.

**Rationale:**
- Hubs are long-lived and may have data that depends on the original schema
- Automatic field/status changes could break existing records
- Admins can manually create new fields/roles to match updated templates

**Future:** A "Compare with latest template" feature could show diffs and let admins manually apply changes. This is out of scope for Part 5.

**Version tracking:** The `hub_template_config` table stores `templateId` and `templateVersion` for audit/reference purposes.

---

## 5. Database Schema Changes

### 5.1 New Table: `hub_template_config`

```sql
CREATE TABLE hub_template_config (
  hub_id TEXT PRIMARY KEY REFERENCES hubs(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  encrypted_config TEXT NOT NULL, -- ciphertext JSON blob
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.2 New Column: `custom_field_definitions.field_type` expansion

Add `multiselect` and `date` to the allowed types. In v1 this is currently a `text` column with runtime validation. Update `CustomFieldDefinitionSchema`:

```typescript
// src/shared/schemas/settings.ts
const CustomFieldTypeSchema = z.enum([
  'text', 'number', 'select', 'multiselect', 'checkbox',
  'textarea', 'file', 'location', 'contact', 'contacts', 'date'
])
```

And update any UI components that switch on field type.

### 5.3 New Column: `report_types.encrypted_config` (optional)

If we want to preserve template report-type metadata (statuses, fields, icon, color):

```sql
ALTER TABLE report_types ADD COLUMN encrypted_config TEXT;
```

**Decision:** Add this column. It stores the full template report type as hub-encrypted JSON. The v1 reporter portal ignores it for now; Part 6 will use it.

---

## 6. API Changes

### 6.1 `POST /hubs`

Add `templateId?: string` to request body.

### 6.2 `POST /setup/complete`

Add `templateId?: string` to request body. Passed through to hub creation.

### 6.3 `GET /templates` (static asset)

No server route. Serve `public/templates/index.json` as a static file.

### 6.4 New Server Service: `TemplateLoaderService`

```typescript
// src/server/services/template-loader.ts
export class TemplateLoaderService {
  constructor(
    private db: Database,
    private crypto: CryptoService,
    private settings: SettingsService,
    private reportTypeService: ReportTypeService,
    private records: RecordsService,
  )

  async applyTemplate(hubId: string, templateId: string, actorPubkey: string): Promise<void>
  async loadTemplate(templateId: string): Promise<TemplateManifest>
  private async seedReportType(tx, hubId, rt, hubKey): Promise<void>
  private async seedCustomField(tx, hubId, et, field, hubKey): Promise<void>
  private async seedRole(tx, hubId, sr, hubKey): Promise<void>
}
```

### 6.5 New Shared Schema: `TemplateManifestSchema`

```typescript
// src/shared/schemas/templates.ts
export const TemplateManifestSchema = z.object({...})
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>
```

---

## 7. Client Changes

### 7.1 New API Function

```typescript
// src/client/lib/api/templates.ts
export async function listTemplates(): Promise<TemplateSummary[]> {
  const res = await fetch('/templates/index.json')
  return res.json()
}
```

### 7.2 New Query Hook

```typescript
// src/client/lib/queries/templates.ts
export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: listTemplates,
    staleTime: Infinity, // templates don't change at runtime
  })
}
```

### 7.3 UI Components

- `TemplatePicker` — card grid for template selection
- `TemplateCard` — individual template card with metadata badges
- Integrate into `SetupWizard` (new step) and `CreateHubDialog`

### 7.4 i18n Keys

New keys needed (must be added to all 22 locale files):

```json
{
  "templates": {
    "title": "Choose a template",
    "description": "Start with a pre-configured setup for your use case",
    "blankHub": "Blank hub",
    "blankHubDescription": "Start from scratch with no pre-configured fields or roles",
    "entityTypes": "{{count}} entity types",
    "reportTypes": "{{count}} report types",
    "roles": "{{count}} roles",
    "tags": "Tags"
  }
}
```

---

## 8. Security Considerations

### 8.1 Template Validation

- All template JSON must be validated against `TemplateManifestSchema` at build time AND runtime
- Malformed templates must not crash the server — return 400 with clear error
- Template IDs must be allowlisted (only IDs present in the bundled templates directory are valid)

### 8.2 Permission Check

- Only users with `system:manage-hubs` can create hubs with templates
- Template application is part of hub creation, which is already guarded

### 8.3 Audit Logging

- `templateApplied` audit entry with template ID, version, and seeded entity counts
- Logged by actor pubkey for accountability

### 8.4 Hub Key Availability

- Template seeding MUST fail if hub key is not available (should never happen — key is generated immediately after hub creation)
- Do NOT fall back to plaintext storage for template-seeded values

### 8.5 No External Template Loading

- Templates are bundled at build time
- No runtime fetch from external URLs
- Prevents SSRF, supply-chain, and template-injection attacks

---

## 9. Testing Strategy

### 9.1 Unit Tests

- `template-manifest-schema.test.ts` — validate all 14 v2 templates against `TemplateManifestSchema`
- `template-loader.test.ts` — test inheritance resolution, label resolution, permission stripping
- `template-encryption.test.ts` — verify hub-key encryption of seeded values

### 9.2 API E2E Tests

- `templates.spec.ts` — `GET /templates/index.json` returns valid summaries
- `hub-template.spec.ts` — `POST /hubs` with `templateId` creates hub with seeded data
- Verify report types, custom fields, and roles are created
- Verify audit log entry exists

### 9.3 UI E2E Tests

- `setup-wizard-template.spec.ts` — template picker appears in setup wizard, selection persists
- `hub-create-template.spec.ts` — admin can create hub with template from hubs section

### 9.4 i18n Tests

- Verify new template-related keys exist in all 22 locale files
- Verify label resolution falls back correctly (language → en → raw key)

---

## 10. Future Work (Post-Part 5)

### 10.1 Export Hub → Template JSON

Admins can export their hub's current schema as a template JSON file. This enables:
- Backup of hub configuration
- Sharing configurations between instances
- Forking an existing hub's schema

### 10.2 Custom Template Import

Admins upload a template JSON file (validated against schema) and create a hub from it.

### 10.3 Community Gallery

A public gallery of user-contributed templates, browsable in-app. Requires:
- Template submission UI
- Moderation/review workflow
- Rating system (optional)

### 10.4 Template Update Diff

When a bundled template gets a new version, show admins a diff of what changed and let them selectively apply updates to existing hubs.

### 10.5 v2 Entity Runtime (Part 6)

The `hub_template_config.encrypted_config` column stores full template metadata (statuses, severities, contact roles, relationship types) for use by the v2 entity runtime:
- Entity record CRUD
- Relationship management
- Sub-records
- Status/severity workflows
- Numbering/auto-ID generation

---

## 11. Implementation Plan

### Phase 1: Foundation (1-2 days)
1. Copy v2 template JSONs and `templateManifestSchema` into v1 repo
2. Add `src/shared/schemas/templates.ts`
3. Add build script to copy templates and generate `index.json`
4. Add `multiselect` and `date` to `CustomFieldDefinitionSchema`
5. Add `hub_template_config` table + Drizzle schema
6. Add `report_types.encrypted_config` column

### Phase 2: Server (2-3 days)
7. Implement `TemplateLoaderService`
8. Update `POST /hubs` to accept `templateId`
9. Update `POST /setup/complete` to pass `templateId`
10. Add audit logging for template application
11. Write unit tests for template loading and encryption

### Phase 3: Client (2-3 days)
12. Implement `listTemplates()` API and `useTemplates()` hook
13. Build `TemplatePicker` and `TemplateCard` components
14. Integrate into `SetupWizard` (new step)
15. Integrate into `CreateHubDialog`
16. Add i18n keys to all locale files
17. Write UI E2E tests

### Phase 4: Validation (1 day)
18. Run full test suite
19. Verify all 14 templates validate and seed correctly
20. Run `bun run typecheck` and `bun run build`
21. Update `docs/NEXT_BACKLOG.md`

---

## 12. Open Questions

1. **Should `general-hotline` be the implicit base for all templates?**  
   v2 templates don't use `extends`, but if they did, `general-hotline` is the natural base. The loader should support it regardless.

2. **How should template `location` fields with `locationOptions` be handled?**  
   v1 `LocationFieldSettingsSchema` has `maxPrecision` and `allowGps`. Template `locationOptions` has `maxPrecision`, `allowGps`, `allowAutocomplete`. The extra field can be stored in `encryptedOptions` or ignored.

3. **Should template-suggested roles replace or supplement default roles?**  
   **Decision:** Supplement. Default roles (`role-super-admin`, `role-hub-admin`, etc.) are still seeded. Template suggested roles are ADDITIONAL roles specific to the use case.

4. **What about template `relationshipTypes`?**  
   v1 has no relationship-type table. Store in `hub_template_config.encrypted_config` for Part 6.

5. **Should we support `extends` resolution now or defer?**  
   **Decision:** Implement now. It's simple recursive merging and future-proofs the system.

---

## 13. Files to Create / Modify

### New Files
- `src/shared/schemas/templates.ts`
- `src/shared/templates/` (build-copied from v2)
- `src/server/services/template-loader.ts`
- `src/server/db/schema/template-config.ts`
- `src/client/lib/api/templates.ts`
- `src/client/lib/queries/templates.ts`
- `src/client/components/template-picker.tsx`
- `src/client/components/template-card.tsx`
- `tests/unit/template-manifest-schema.test.ts`
- `tests/unit/template-loader.test.ts`
- `tests/api/hub-template.spec.ts`
- `tests/ui/setup-wizard-template.spec.ts`

### Modified Files
- `src/server/routes/hubs.ts` — add `templateId` to `POST /hubs`
- `src/server/routes/setup.ts` — add `templateId` to `POST /setup/complete`
- `src/server/services/settings/index.ts` — inject `TemplateLoaderService`
- `src/server/db/schema/report-types.ts` — add `encrypted_config`
- `src/shared/schemas/settings.ts` — add `multiselect`, `date` to field types
- `src/client/components/setup/SetupWizard.tsx` — add template step
- `src/client/components/admin-sections/hubs-section.tsx` — add template picker to create dialog
- `src/client/lib/api/hubs.ts` — add `templateId` to `createHub`
- `public/locales/*.json` — add template i18n keys (22 files)
- `package.json` — add template copy build step
- `docs/NEXT_BACKLOG.md` — add template loader entry

---

## 14. Dependencies

- None beyond existing v1 stack
- v2 `template-types.ts` is copied, not imported
- Template JSONs are copied, not fetched

---

*End of spec.*
