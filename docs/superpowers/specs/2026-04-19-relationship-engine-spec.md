# Relationship Engine Spec (v2→v1 Series, Part 2 of 6)

**Date:** 2026-04-19  
**Status:** Draft — awaiting review  
**PR Title:** `docs: relationship engine spec (v2→v1 series 2/6)`  
**Depends on:** v2 Entity Templates Architecture (`2026-04-19-v2-entity-templates-architecture.md`)

---

## 1. Overview

This spec ports the **generic M:N relationship engine** from Llámenos v2 into v1. The goal is to replace v1's contact-only, opaque ECIES relationship payload with a **typed, cardinality-enforced, role-aware relationship system** that works between any entity types (contacts, cases, events, custom entities).

**Key design constraint:** Relationship **type metadata** (labels, role labels) is **hub-key encrypted** (AES-256-GCM). Relationship **instance payloads** (notes, custom join fields) are **MLS group encrypted** for hub-scoped data. This is the first v1 feature to use MLS for content encryption rather than per-user ECIES envelopes.

---

## 2. v2 Source of Truth

### 2.1 Relationship Type Definition

From `packages/protocol/schemas/entity-schema.ts`:

```typescript
export const relationshipTypeDefinitionSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),

  sourceEntityTypeId: z.string(),
  targetEntityTypeId: z.string(),

  cardinality: z.enum(['1:1', '1:N', 'M:N']),

  label: z.string().max(200),
  reverseLabel: z.string().max(200),
  sourceLabel: z.string().max(200),
  targetLabel: z.string().max(200),

  roles: z.array(enumOptionSchema).max(20).optional(),
  defaultRole: z.string().optional(),

  joinFields: z.array(entityFieldDefinitionSchema).max(20).optional(),

  cascadeDelete: z.boolean().optional().default(false),
  required: z.boolean().optional().default(false),

  templateId: z.string().optional(),
  isSystem: z.boolean().optional().default(false),

  createdAt: z.string(),
  updatedAt: z.string(),
})
```

### 2.2 v2 Relationship Instance (Contact-Only)

From `packages/protocol/schemas/contact-relationships.ts`:

```typescript
export const contactRelationshipSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  contactIdA: z.uuid(),
  contactIdB: z.uuid(),
  relationshipType: z.string().max(50),
  direction: relationshipDirectionSchema, // 'a_to_b' | 'b_to_a' | 'bidirectional'
  encryptedNotes: z.string().optional(),
  notesEnvelopes: z.array(recipientEnvelopeSchema).optional(),
  createdAt: z.string(),
  createdBy: z.string(),
})
```

**v2 uses ECIES envelopes (`notesEnvelopes`)** — this spec replaces that with MLS.

### 2.3 v2 Affinity Group

```typescript
export const affinityGroupSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  encryptedDetails: z.string(),
  detailEnvelopes: z.array(recipientEnvelopeSchema).min(1),
  memberCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
})
```

v2 affinity groups also use ECIES envelopes. In v1 they will use **MLS group encryption** for the group details payload.

---

## 3. v1 Current State

### 3.1 Current DB Schema (`src/server/db/schema/contacts.ts`)

```typescript
export const contactRelationships = pgTable(
  'contact_relationships',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    encryptedPayload: ciphertext('encrypted_payload').notNull(),
    payloadEnvelopes: jsonb<RecipientEnvelope[]>()('payload_envelopes').notNull().default([]),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('contact_relationships_hub_idx').on(table.hubId)]
)
```

**Problems with current v1 approach:**
1. **Opaque payload** — server stores a single encrypted blob with no structure. Cardinality, entity IDs, and relationship type are all inside the encrypted payload. The server cannot enforce 1:1, 1:N, or validate entity references.
2. **Contact-only** — no generic entity support. Cannot relate a contact to a case, or a case to an event.
3. **No relationship types** — no admin-configurable relationship vocabulary ("family", "attorney", "witness", etc.).
4. **No roles on edges** — cannot assign "primary support contact" vs "secondary".
5. **No join fields** — cannot store edge metadata (e.g., "since date", "court order number").
6. **ECIES envelopes** — per-user envelope encryption scales poorly for group-visible data. Adding a new admin requires re-wrapping all relationship payloads.

### 3.2 Current API (`src/server/routes/contacts/relationships.ts`)

- `GET /contacts/relationships` — list all (returns encrypted payloads)
- `POST /contacts/relationships` — create (accepts `encryptedPayload` + `payloadEnvelopes`)
- `DELETE /contacts/relationships/:id` — delete

No update endpoint. No type enforcement. No entity validation.

### 3.3 Current Client (`src/client/components/contacts/contact-relationship-section.tsx`)

Renders decrypted `RelationshipPayload`:
```typescript
interface RelationshipPayload {
  fromContactId: string
  toContactId: string
  relationship: string
  isEmergency: boolean
}
```

This is contact-only, hardcoded, and has no type/role/cardinality awareness.

### 3.4 Current MLS Infrastructure (v1)

v1 has **full MLS infrastructure** already built:

- **DB:** `mls_hub_state`, `mls_key_packages`, `mls_epoch_commits` (`src/server/db/schema/mls.ts`)
- **Server routes:** `src/server/routes/mls.ts` — bootstrap, key packages, commits, epoch fetch, purge
- **Client conversation:** `src/client/lib/mls/conversation.ts` — `MlsConversation` class with `encrypt()`, `decrypt()`, `addMembers()`, `removeMembers()`, `catchUp()`
- **Client bootstrap:** `src/client/lib/mls/hub-bootstrap.ts` — `bootstrapMlsForNewHub()`, `uploadKeyPackages()`
- **API client:** `src/client/lib/mls/mls-api-client.ts` — typed wrappers for all MLS endpoints
- **Tests:** `conversation.test.ts`, `mls.test.ts`, `hub-bootstrap.test.ts`

**However:** MLS is currently only used for the audit log integrity chain (`src/client/lib/audit-log-client.ts` uses `MlsConversation` for signing). No application data is encrypted with MLS yet. This spec will be the **first production use of MLS for content encryption**.

### 3.5 Hub-Key Encryption Pattern (v1)

v1 uses hub-key AES-256-GCM encryption for organizational metadata:

- **Encrypt:** `encryptHubField(value, hubId, recordId, fieldName)` → `Ciphertext | undefined`
- **Decrypt:** `decryptHubField(encrypted, hubId, recordId, fieldName)` → `string` (throws `HubFieldTamperError` on tamper)
- **AAD:** `hubFieldAad(recordId, fieldName)` = `llamenos:hub-field:<recordId>:<fieldName>`
- **Storage:** `ciphertext()` columns in Drizzle schema
- **Pattern:** Server accepts both `encryptedFoo` (ciphertext) and `foo` (plaintext fallback) on create/update. Client sends both.

This pattern is used for: hubs, roles, teams, tags, shifts, report types, custom fields, settings.

---

## 4. Target Architecture

### 4.1 Encryption Model

| Data | Encryption | Rationale |
|------|-----------|-----------|
| Relationship type metadata (labels, role labels, join field definitions) | **Hub-key AES-256-GCM** | Hub-scoped config data. All hub members need to read. Server cannot read (zero-knowledge). |
| Relationship instance payload (notes, join field values, role assignment) | **MLS group encryption** | Hub-scoped operational data. All hub members need to read. MLS provides post-compromise security and efficient group membership changes. |
| Affinity group details (name, description, member list) | **MLS group encryption** | Same rationale as relationship payloads. |

**Open question:** If a relationship's data should be visible only to specific users (not all hub members), document this as an open question with MLS vs per-user alternatives. For v1 Phase 1, assume all relationship data is hub-visible. A future Phase 2 could add "private relationships" using per-user ECIES envelopes (similar to notes) or a sub-group MLS approach.

### 4.2 DB Schema

#### 4.2.1 `entity_type_relationship_types`

Replaces the implicit relationship vocabulary with explicit, admin-configurable types.

```typescript
export const entityTypeRelationshipTypes = pgTable(
  'entity_type_relationship_types',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),

    // Entity type references (opaque IDs — server does not need to resolve)
    sourceEntityTypeId: text('source_entity_type_id').notNull(),
    targetEntityTypeId: text('target_entity_type_id').notNull(),

    // Cardinality enforced at application layer (server validates on create/update)
    cardinality: text('cardinality').notNull(), // '1:1' | '1:N' | 'M:N'

    // Hub-key encrypted labels (server stores ciphertext only)
    encryptedLabel: ciphertext('encrypted_label').notNull(),
    encryptedReverseLabel: ciphertext('encrypted_reverse_label').notNull(),
    encryptedSourceLabel: ciphertext('encrypted_source_label').notNull(),
    encryptedTargetLabel: ciphertext('encrypted_target_label').notNull(),

    // Hub-key encrypted role definitions (JSON array of enumOptionSchema)
    encryptedRoles: ciphertext('encrypted_roles'),

    // Hub-key encrypted join field definitions (JSON array of entityFieldDefinitionSchema)
    encryptedJoinFields: ciphertext('encrypted_join_fields'),

    // Plaintext flags (server can read for enforcement)
    cascadeDelete: boolean('cascade_delete').notNull().default(false),
    required: boolean('required').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),

    templateId: text('template_id'),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('etrt_hub_idx').on(table.hubId),
    index('etrt_source_target_idx').on(table.sourceEntityTypeId, table.targetEntityTypeId),
  ]
)
```

**Note:** `sourceEntityTypeId` and `targetEntityTypeId` reference `entity_types` (from Part 1 of this series, Entity Templates). If Entity Templates are not yet implemented, these can reference `contacts` implicitly for Phase 1, with a migration path to generic entities.

#### 4.2.2 `entity_relationships`

Replaces `contact_relationships` with a structured, cardinality-aware table.

```typescript
export const entityRelationships = pgTable(
  'entity_relationships',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),

    // Relationship type reference
    relationshipTypeId: text('relationship_type_id').notNull(),

    // Entity references (opaque IDs — server validates existence via service layer)
    sourceEntityId: text('source_entity_id').notNull(),
    targetEntityId: text('target_entity_id').notNull(),

    // Direction (for directed relationships)
    direction: text('direction').notNull().default('bidirectional'), // 'source_to_target' | 'target_to_source' | 'bidirectional'

    // Role on this edge (plain string key — role label is in relationship type)
    role: text('role'),

    // MLS-encrypted payload (notes, join field values)
    // The ciphertext is an MLS application message encrypted for the hub group.
    encryptedPayload: ciphertext('encrypted_payload').notNull(),

    // MLS epoch at which this payload was encrypted (for decryption context)
    mlsEpoch: integer('mls_epoch').notNull(),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('er_hub_idx').on(table.hubId),
    index('er_type_idx').on(table.relationshipTypeId),
    index('er_source_idx').on(table.sourceEntityId),
    index('er_target_idx').on(table.targetEntityId),
    // For bidirectional lookups
    index('er_source_target_idx').on(table.sourceEntityId, table.targetEntityId),
  ]
)
```

**Key differences from v1 `contact_relationships`:**
1. **Structured references** — `sourceEntityId`, `targetEntityId`, `relationshipTypeId` are plaintext so the server can enforce cardinality, validate entity existence, and cascade deletes.
2. **No ECIES envelopes** — `encryptedPayload` is an MLS ciphertext, not ECIES-wrapped per user. The server cannot read it, but it doesn't need envelopes for distribution.
3. **MLS epoch tracking** — `mlsEpoch` records which epoch the payload was encrypted under, so clients know which group state to use for decryption.
4. **Role on edge** — `role` is a plain key string; the label is decrypted from the relationship type.

#### 4.2.3 `affinity_groups`

```typescript
export const affinityGroups = pgTable(
  'affinity_groups',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),

    // MLS-encrypted details (name, description, member list)
    encryptedDetails: ciphertext('encrypted_details').notNull(),
    mlsEpoch: integer('mls_epoch').notNull(),

    // Plaintext counters (server can read for UI hints)
    memberCount: integer('member_count').notNull().default(0),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ag_hub_idx').on(table.hubId),
  ]
)

export const affinityGroupMembers = pgTable(
  'affinity_group_members',
  {
    groupId: text('group_id').notNull(),
    entityId: text('entity_id').notNull(), // contact ID or other entity ID
    role: text('role'), // plain key — label from group details
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.entityId] }),
    index('agm_group_idx').on(table.groupId),
    index('agm_entity_idx').on(table.entityId),
  ]
)
```

### 4.3 Cardinality Enforcement

Cardinality is enforced at the **service layer** (not DB constraints, because entity IDs are opaque and the DB doesn't know entity tables):

| Cardinality | Enforcement |
|-------------|-------------|
| `1:1` | Before creating, check no existing relationship of this type exists for either `sourceEntityId` or `targetEntityId`. |
| `1:N` | Before creating, check no existing relationship of this type exists where `targetEntityId` is already a target. Source can have many. |
| `M:N` | No uniqueness constraints. |

**Note:** For bidirectional relationships, enforcement must consider both directions (A→B and B→A are the same edge).

### 4.4 Cascade Delete

If `cascadeDelete = true` on the relationship type:
- When the **source entity** is deleted, all relationships of this type where it is the source are deleted.
- When the **target entity** is deleted, all relationships of this type where it is the target are deleted.
- For bidirectional relationships, deletion of either end cascades.

This is implemented in the entity deletion service (e.g., `ContactService.deleteContact`) by calling `RelationshipService.deleteByEntityId()`.

### 4.5 Migration from `contact_relationships`

**Phase 1 (coexistence):**
1. Create new tables (`entity_type_relationship_types`, `entity_relationships`, `affinity_groups`, `affinity_group_members`).
2. Keep `contact_relationships` read-only for backwards compatibility.
3. Write a migration script that:
   - Reads all rows from `contact_relationships`
   - Decrypts payloads (requires client-side operation with unlocked keys)
   - Creates a default relationship type "contact_link" if none exists
   - Inserts migrated rows into `entity_relationships` with `relationshipTypeId = 'contact_link'`
   - Re-encrypts payloads using MLS
4. Update client code to read from `entity_relationships`
5. Drop `contact_relationships` table in a later migration (after verification)

**Phase 2 (cleanup):**
- Drop `contact_relationships` table
- Remove old API endpoints (`/contacts/relationships`)
- Remove old client components

---

## 5. API Routes + Zod Schemas

### 5.1 Shared Schemas (`src/shared/schemas/relationships.ts`)

```typescript
import { z } from '@hono/zod-openapi'

// --- Relationship Type ---

export const RelationshipTypeSchema = z.object({
  id: z.string().openapi({ example: 'rt-abc123' }),
  hubId: z.string(),
  sourceEntityTypeId: z.string(),
  targetEntityTypeId: z.string(),
  cardinality: z.enum(['1:1', '1:N', 'M:N']),
  encryptedLabel: z.string(),
  encryptedReverseLabel: z.string(),
  encryptedSourceLabel: z.string(),
  encryptedTargetLabel: z.string(),
  encryptedRoles: z.string().optional(),
  encryptedJoinFields: z.string().optional(),
  cascadeDelete: z.boolean().optional(),
  required: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  templateId: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const CreateRelationshipTypeSchema = z.object({
  sourceEntityTypeId: z.string().min(1),
  targetEntityTypeId: z.string().min(1),
  cardinality: z.enum(['1:1', '1:N', 'M:N']),
  encryptedLabel: z.string().min(1),
  encryptedReverseLabel: z.string().min(1),
  encryptedSourceLabel: z.string().min(1),
  encryptedTargetLabel: z.string().min(1),
  encryptedRoles: z.string().optional(),
  encryptedJoinFields: z.string().optional(),
  cascadeDelete: z.boolean().optional(),
  required: z.boolean().optional(),
  templateId: z.string().optional(),
})

export const UpdateRelationshipTypeSchema = z.object({
  encryptedLabel: z.string().optional(),
  encryptedReverseLabel: z.string().optional(),
  encryptedSourceLabel: z.string().optional(),
  encryptedTargetLabel: z.string().optional(),
  encryptedRoles: z.string().optional(),
  cascadeDelete: z.boolean().optional(),
  required: z.boolean().optional(),
})

// --- Relationship Instance ---

export const RelationshipSchema = z.object({
  id: z.string().openapi({ example: 'rel-def456' }),
  hubId: z.string(),
  relationshipTypeId: z.string(),
  sourceEntityId: z.string(),
  targetEntityId: z.string(),
  direction: z.enum(['source_to_target', 'target_to_source', 'bidirectional']),
  role: z.string().optional(),
  encryptedPayload: z.string(),
  mlsEpoch: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const CreateRelationshipSchema = z.object({
  relationshipTypeId: z.string().min(1),
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  direction: z.enum(['source_to_target', 'target_to_source', 'bidirectional']).optional().default('bidirectional'),
  role: z.string().optional(),
  encryptedPayload: z.string().min(1),
  mlsEpoch: z.number().int(),
})

export const UpdateRelationshipSchema = z.object({
  role: z.string().optional(),
  encryptedPayload: z.string().optional(),
  mlsEpoch: z.number().int().optional(),
})

// --- Affinity Group ---

export const AffinityGroupSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  encryptedDetails: z.string(),
  mlsEpoch: z.number().int(),
  memberCount: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const AffinityGroupMemberSchema = z.object({
  entityId: z.string(),
  role: z.string().optional(),
  isPrimary: z.boolean(),
})

export const CreateAffinityGroupSchema = z.object({
  encryptedDetails: z.string().min(1),
  mlsEpoch: z.number().int(),
  members: z.array(AffinityGroupMemberSchema).min(1),
})

export const UpdateAffinityGroupSchema = z.object({
  encryptedDetails: z.string().optional(),
  mlsEpoch: z.number().int().optional(),
})

// --- Response wrappers ---

export const RelationshipTypeListResponseSchema = z.object({
  relationshipTypes: z.array(RelationshipTypeSchema),
})

export const RelationshipListResponseSchema = z.object({
  relationships: z.array(RelationshipSchema),
})

export const AffinityGroupListResponseSchema = z.object({
  groups: z.array(AffinityGroupSchema),
})

export const AffinityGroupWithMembersResponseSchema = AffinityGroupSchema.extend({
  members: z.array(AffinityGroupMemberSchema),
})
```

### 5.2 API Routes

Mount under `/api/relationships` (new top-level route) and `/api/affinity-groups`.

#### Relationship Types

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/relationships/types` | `settings:read` | List all relationship types for hub |
| POST | `/relationships/types` | `settings:manage` | Create a relationship type |
| PATCH | `/relationships/types/:id` | `settings:manage` | Update a relationship type |
| DELETE | `/relationships/types/:id` | `settings:manage` | Delete a relationship type (fail if instances exist) |

#### Relationship Instances

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/relationships` | `contacts:read` (or entity-specific read perm) | List relationships (filterable by `entityId`, `typeId`) |
| POST | `/relationships` | `contacts:create` (or entity-specific create perm) | Create a relationship |
| PATCH | `/relationships/:id` | `contacts:update` (or owner) | Update relationship payload/role |
| DELETE | `/relationships/:id` | `contacts:delete` (or owner) | Delete a relationship |

#### Affinity Groups

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/affinity-groups` | `contacts:read` | List affinity groups for hub |
| POST | `/affinity-groups` | `contacts:create` | Create an affinity group |
| GET | `/affinity-groups/:id` | `contacts:read` | Get group with members |
| PATCH | `/affinity-groups/:id` | `contacts:update` (or creator) | Update group details |
| DELETE | `/affinity-groups/:id` | `contacts:delete` (or creator) | Delete group |
| POST | `/affinity-groups/:id/members` | `contacts:update` | Add member |
| DELETE | `/affinity-groups/:id/members/:entityId` | `contacts:update` | Remove member |

**Permission mapping:**
- For Phase 1 (contacts-only), reuse `contacts:*` permissions.
- For Phase 2 (generic entities), introduce `entities:read`, `entities:create`, `entities:update`, `entities:delete` permissions, with sub-permissions per entity type (e.g., `cases:read`, `events:read`).

---

## 6. Client Implementation

### 6.1 React Query Hooks

Add to `src/client/lib/queries/relationships.ts`:

```typescript
// Relationship types (hub-key encrypted)
export function useRelationshipTypes() { ... }
export function useCreateRelationshipType() { ... }
export function useUpdateRelationshipType() { ... }
export function useDeleteRelationshipType() { ... }

// Relationships (MLS encrypted payload)
export function useRelationships(filters?: { entityId?: string; typeId?: string }) { ... }
export function useCreateRelationship() { ... }
export function useUpdateRelationship() { ... }
export function useDeleteRelationship() { ... }

// Affinity groups (MLS encrypted details)
export function useAffinityGroups() { ... }
export function useCreateAffinityGroup() { ... }
export function useUpdateAffinityGroup() { ... }
export function useDeleteAffinityGroup() { ... }
```

**Decryption patterns:**

1. **Relationship types** — decrypt in `queryFn` using `decryptHubField()` for each label field:
   ```typescript
   label: decryptHubField(rt.encryptedLabel, hubId, rt.id, 'label')
   ```

2. **Relationship payloads** — decrypt in `queryFn` using `MlsConversation.decrypt()`:
   ```typescript
   const conv = await getMlsConversation(hubId) // from hub-key-cache or MlsConversation cache
   const plaintext = await conv.decrypt(fromBase64(rel.encryptedPayload))
   const payload = JSON.parse(new TextDecoder().decode(plaintext.message))
   ```
   **Important:** Must call `conv.catchUp(rel.mlsEpoch - 1)` before decrypting if the local epoch is behind.

3. **Affinity group details** — same MLS decrypt pattern as relationship payloads.

### 6.2 UI Components

Replace `contact-relationship-section.tsx` with a generic `RelationshipPanel`:

```typescript
// src/client/components/relationships/relationship-panel.tsx
interface RelationshipPanelProps {
  entityId: string
  entityTypeId: string // 'contact', 'case', etc.
  onNavigate: (entityId: string, entityTypeId: string) => void
}
```

Features:
- Lists all relationships for the entity (both outgoing and incoming)
- Groups by relationship type
- Shows role badges
- Shows join field values (decrypted from payload)
- "Add relationship" button → opens type selector → entity picker → role selector
- "Create affinity group" button

**New components:**
- `RelationshipTypeEditor` — admin settings section for CRUD on relationship types
- `RelationshipForm` — create/edit relationship (entity picker, type selector, role selector, join fields)
- `AffinityGroupCard` — display group with member list
- `AffinityGroupForm` — create/edit group with member management

### 6.3 Query Keys

Add to `src/client/lib/queries/keys.ts`:

```typescript
relationships: {
  all: ['relationships'] as const,
  types: () => ['relationships', 'types'] as const,
  list: (filters?: { entityId?: string; typeId?: string }) =>
    ['relationships', 'list', filters ?? {}] as const,
  detail: (id: string) => ['relationships', 'detail', id] as const,
},
affinityGroups: {
  all: ['affinityGroups'] as const,
  list: () => ['affinityGroups', 'list'] as const,
  detail: (id: string) => ['affinityGroups', 'detail', id] as const,
},
```

Add to `ENCRYPTED_QUERY_KEYS` in `query-client.ts`:
```typescript
'relationships',
'affinityGroups',
```

---

## 7. Service Layer

### 7.1 `RelationshipService`

New file: `src/server/services/relationships.ts`

```typescript
export class RelationshipService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  // Relationship Types
  async createRelationshipType(input: CreateRelationshipTypeInput): Promise<RelationshipTypeRow>
  async listRelationshipTypes(hubId: string): Promise<RelationshipTypeRow[]>
  async updateRelationshipType(id: string, hubId: string, input: UpdateRelationshipTypeInput): Promise<RelationshipTypeRow | null>
  async deleteRelationshipType(id: string, hubId: string): Promise<boolean>

  // Relationship Instances
  async createRelationship(input: CreateRelationshipInput): Promise<RelationshipRow>
  async listRelationships(hubId: string, filters?: RelationshipFilters): Promise<RelationshipRow[]>
  async updateRelationship(id: string, hubId: string, input: UpdateRelationshipInput): Promise<RelationshipRow | null>
  async deleteRelationship(id: string, hubId: string): Promise<boolean>

  // Cardinality enforcement
  private async checkCardinality(typeId: string, sourceId: string, targetId: string): Promise<void>

  // Cascade delete
  async deleteByEntityId(entityId: string, hubId: string): Promise<number>

  // Affinity Groups
  async createAffinityGroup(input: CreateAffinityGroupInput): Promise<AffinityGroupRow>
  async listAffinityGroups(hubId: string): Promise<AffinityGroupRow[]>
  async getAffinityGroup(id: string, hubId: string): Promise<AffinityGroupRow & { members: AffinityGroupMemberRow[] } | null>
  async updateAffinityGroup(id: string, hubId: string, input: UpdateAffinityGroupInput): Promise<AffinityGroupRow | null>
  async deleteAffinityGroup(id: string, hubId: string): Promise<boolean>
  async addAffinityGroupMember(groupId: string, entityId: string, role?: string, isPrimary?: boolean): Promise<void>
  async removeAffinityGroupMember(groupId: string, entityId: string): Promise<void>
}
```

### 7.2 Integration with Existing Services

- `ContactService.deleteContact()` must call `RelationshipService.deleteByEntityId(contactId, hubId)` to honor `cascadeDelete`.
- `ContactService.resetForTest(hubId)` must also clear `entity_relationships`, `entity_type_relationship_types`, `affinity_groups`, and `affinity_group_members`.

---

## 8. MLS Integration Details

### 8.1 Encrypting Relationship Payloads

```typescript
// Client-side, when creating/updating a relationship
const conv = await getMlsConversation(hubId)
const payload = JSON.stringify({
  notes: 'Primary support contact since 2024',
  joinFields: { sinceDate: '2024-01-15', courtOrderNumber: 'CV-2024-001' }
})
const plaintext = new TextEncoder().encode(payload)
const ciphertext = await conv.encrypt(plaintext)
const mlsEpoch = await conv.currentEpoch()

// Send to server
await createRelationship({
  relationshipTypeId: 'rt-family',
  sourceEntityId: 'contact-a',
  targetEntityId: 'contact-b',
  encryptedPayload: toBase64(ciphertext),
  mlsEpoch,
})
```

### 8.2 Decrypting Relationship Payloads

```typescript
// In React Query queryFn
const conv = await getMlsConversation(hubId)
// Ensure we're at or past the epoch used for encryption
await conv.catchUp(rel.mlsEpoch - 1)
const result = await conv.decrypt(fromBase64(rel.encryptedPayload))
if (result.message) {
  const payload = JSON.parse(new TextDecoder().decode(result.message))
}
```

### 8.3 Handling Epoch Gaps

If a relationship was encrypted at epoch N and the client's local state is at epoch M < N:
1. The client must fetch and process all commits from M to N via `conv.catchUp(M)`.
2. If the client was removed from the group between M and N, decryption will fail (`isActive: false`). This is a legitimate error — the user no longer has access.
3. If the relationship payload was encrypted before the client joined, the client cannot decrypt it (MLS forward secrecy). This is by design.

### 8.4 Key Rotation on Member Removal

When a user is removed from a hub:
1. Admin calls `conv.removeMembers([clientId])` which produces a Commit.
2. The Commit is submitted to the server via `mlsApi.submitCommit()`.
3. The server increments the epoch.
4. All existing relationship payloads encrypted at earlier epochs remain readable by remaining members but not by the removed member (MLS guarantees this).
5. No re-encryption of relationship data is needed — this is the primary advantage over ECIES envelopes.

---

## 9. Migration Plan

### 9.1 Database Migrations

1. **Migration 0062** (or next available):
   ```sql
   CREATE TABLE entity_type_relationship_types (...)
   CREATE TABLE entity_relationships (...)
   CREATE TABLE affinity_groups (...)
   CREATE TABLE affinity_group_members (...)
   ```

2. **Migration 0063** (after client cutover):
   ```sql
   -- Make contact_relationships read-only by removing from schema (keep table for rollback)
   -- Actually: just stop writing to it. Drop in a later migration.
   ```

3. **Migration 0064** (after verification):
   ```sql
   DROP TABLE contact_relationships;
   ```

### 9.2 Data Migration

**Client-side migration script** (run once by an admin with unlocked keys):

```typescript
// scripts/migrate-contact-relationships.ts
async function migrate() {
  const oldRels = await listContactRelationships()
  const hubId = '...'
  const conv = await getMlsConversation(hubId)

  // Create default relationship type if none exists
  const defaultType = await createRelationshipType({
    sourceEntityTypeId: 'contact',
    targetEntityTypeId: 'contact',
    cardinality: 'M:N',
    encryptedLabel: encryptHubField('Linked Contact', hubId, 'default', 'label'),
    // ... other labels
  })

  for (const old of oldRels) {
    // Decrypt old ECIES payload
    const payload = await decryptContactRelationshipPayload(old)
    // Re-encrypt with MLS
    const plaintext = new TextEncoder().encode(JSON.stringify(payload))
    const ciphertext = await conv.encrypt(plaintext)
    const epoch = await conv.currentEpoch()

    await createRelationship({
      relationshipTypeId: defaultType.id,
      sourceEntityId: payload.fromContactId,
      targetEntityId: payload.toContactId,
      direction: 'bidirectional',
      encryptedPayload: toBase64(ciphertext),
      mlsEpoch: epoch,
    })
  }
}
```

**Note:** This requires the admin's crypto worker to be unlocked. It cannot run server-side because the server cannot decrypt ECIES payloads.

### 9.3 API Migration

- Keep old `/contacts/relationships` endpoints for 1 release cycle (read-only).
- Add new `/relationships/*` endpoints.
- Update client to use new endpoints.
- Deprecate old endpoints in OpenAPI docs.
- Remove old endpoints in a later release.

---

## 10. Testing Strategy

### 10.1 Unit Tests

- `RelationshipService` cardinality enforcement (all 3 cardinalities, both directions)
- `RelationshipService` cascade delete behavior
- `RelationshipService` migration helper (mocked DB)

### 10.2 API Integration Tests

- CRUD for relationship types
- CRUD for relationship instances
- Cardinality rejection tests (1:1 duplicate, 1:N duplicate target)
- Filter tests (by entityId, by typeId)
- Affinity group CRUD + member management

### 10.3 UI E2E Tests

- Create relationship type in admin settings
- Create relationship between two contacts
- View relationship panel on contact detail
- Create affinity group
- Add/remove members from affinity group
- Verify MLS decryption (check decrypted payload renders correctly)

### 10.4 MLS-Specific Tests

- Relationship payload encrypt/decrypt round-trip
- Epoch catch-up before decrypt
- Member removal → verify removed user cannot decrypt new payloads
- Verify existing payloads still decryptable after member removal (MLS property)

---

## 11. Security Considerations

### 11.1 Zero-Knowledge Server

- Relationship type labels are hub-key encrypted — server cannot read them.
- Relationship payloads are MLS encrypted — server cannot read them.
- Affinity group details are MLS encrypted — server cannot read them.
- The server only sees: entity IDs, relationship type IDs, cardinality, cascadeDelete flag, role keys, MLS epoch.

### 11.2 Cardinality Side-Channel

The server knows cardinality constraints and entity IDs. An attacker with server access could:
- See that two entities are related (but not how)
- Count relationships per entity
- See relationship type IDs (but not labels)

**Mitigation:** This is acceptable for v1. Future work could add blind indexes or encrypted entity ID references.

### 11.3 MLS Epoch Leak

The `mlsEpoch` column is plaintext. An attacker could correlate relationship creation times with epoch changes to infer when group membership changed. This is a minor metadata leak and acceptable for v1.

### 11.4 Open Question: Private Relationships

If a relationship should be visible only to specific users (not all hub members), MLS hub-wide encryption is insufficient. Alternatives:
1. **Per-user ECIES envelopes** (like notes) — scales poorly, requires re-wrapping on membership changes.
2. **MLS sub-groups** — create a separate MLS group for the relationship. Complex to manage.
3. **Access control on client** — encrypt with MLS hub-wide, but include an `allowedPubkeys` list in the payload. Client filters. Leaks metadata to all hub members.

**Recommendation:** Document as Phase 2 open question. Phase 1 uses hub-wide MLS.

---

## 12. Files to Create/Modify

### New Files
- `src/server/db/schema/relationships.ts` — new tables
- `src/shared/schemas/relationships.ts` — zod schemas
- `src/server/services/relationships.ts` — service layer
- `src/server/routes/relationships.ts` — API routes
- `src/server/routes/affinity-groups.ts` — API routes
- `src/client/lib/api/relationships.ts` — API client
- `src/client/lib/queries/relationships.ts` — React Query hooks
- `src/client/components/relationships/relationship-panel.tsx`
- `src/client/components/relationships/relationship-type-editor.tsx`
- `src/client/components/relationships/relationship-form.tsx`
- `src/client/components/relationships/affinity-group-card.tsx`
- `src/client/components/relationships/affinity-group-form.tsx`
- `src/server/services/relationships.integration.test.ts`
- `tests/api/relationships.spec.ts`
- `tests/ui/relationships.spec.ts`

### Modified Files
- `src/server/db/schema/index.ts` — export new tables
- `src/server/db/schema/contacts.ts` — mark `contact_relationships` deprecated (comment)
- `src/server/app.ts` — mount new routes
- `src/shared/schemas/index.ts` — export relationship schemas
- `src/client/lib/api/index.ts` — export relationship API
- `src/client/lib/queries/keys.ts` — add query keys
- `src/client/lib/queries/contacts.ts` — update relationship hooks to use new API
- `src/client/lib/query-client.ts` — add to ENCRYPTED_QUERY_KEYS
- `src/client/components/contacts/contact-relationship-section.tsx` — replace with generic panel
- `src/server/services/contacts.ts` — add cascade delete call
- `src/server/routes/contacts/relationships.ts` — mark deprecated
- `docs/NEXT_BACKLOG.md` — add entry

---

## 13. Dependencies

- **Part 1 (Entity Templates):** `sourceEntityTypeId` and `targetEntityTypeId` reference entity types. If Entity Templates are not yet implemented, hardcode `'contact'` for Phase 1 and generalize in Phase 2.
- **MLS infrastructure:** Already complete in v1. No new MLS work needed.
- **Hub-key encryption:** Already complete in v1. No new crypto work needed.

---

## 14. Rollback Plan

1. If migration fails: keep `contact_relationships` table. Old client code can still read it.
2. If new API has bugs: client can fall back to old `/contacts/relationships` endpoints (keep them read-only for 1 release).
3. If MLS decryption fails: client shows "[encrypted]" placeholder (existing pattern) and logs error.

---

## 15. Open Questions

1. **Entity Templates dependency:** Should Phase 1 ship with hardcoded `'contact'` entity type, or wait for Entity Templates (Part 1)?
   - **Recommendation:** Ship Phase 1 with hardcoded `'contact'` type. Generalize when Entity Templates land.

2. **Private relationships:** Should we support relationships visible only to specific users?
   - **Recommendation:** No. Document as Phase 2. Use hub-wide MLS for Phase 1.

3. **Affinity group vs. relationship type:** Affinity groups are essentially N:N relationships with a group entity. Should they share the same table?
   - **Recommendation:** Keep separate tables. Affinity groups have different UI patterns (group card vs. edge list) and different metadata (member count, primary flag).

4. **Migration timing:** Should the ECIES→MLS migration be automatic on app load, or a manual admin action?
   - **Recommendation:** Manual admin action with a UI prompt. Automatic migration risks data loss if keys are not loaded.

5. **Role labels encryption:** Role labels are in `encryptedRoles` (hub-key encrypted). Role keys on the edge are plaintext. Is this the right balance?
   - **Recommendation:** Yes. The server needs the role key for filtering/sorting (e.g., "show all primary contacts"). The label is UI-only and encrypted.

---

*End of spec.*
