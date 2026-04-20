# Interaction Timeline Spec (v2→v1 Series, Part 3 of 6)

**Date:** 2026-04-19
**Status:** Draft — awaiting review
**Branch target:** `feat/interaction-timeline`
**Depends on:** Entity Templates spec (Part 2 of 6) — `entity_instances` table must exist
**Prerequisite:** MLS group bootstrapped per hub (Tier 6 PR #1 shipped, or Tier 3 hub-key fallback active)

## Overview

This spec defines the **Interaction Timeline** — a unified, chronologically-ordered event stream that links existing records (notes, calls, messages) to entity instances, captures inline encrypted comments, and records status changes. It is the per-case activity log that volunteers and admins see when viewing an entity instance (e.g., a "Domestic Violence Case #42").

The timeline is **distinct** from:
- The **signed audit chain** (`signed_audit_entries`) — that is a tamper-evident, hub-wide security log for membership/key/device events.
- The **contact timeline** (`contact-timeline.tsx`) — that merges calls/conversations/notes for a contact; it is client-side only and not linked to entity instances.

## Design Principles

1. **No ECIES for inline content.** Inline interactions (comments, assessments) use **MLS group encryption** — encrypted once under the hub MLS group, decryptable by all current hub members. This avoids the O(N) `contentEnvelopes` per-row ECIES pattern from v2.
2. **Linked interactions are plaintext pointers.** The `case_interactions` row stores only the source record ID (`sourceId`). The content itself remains encrypted in its source table (`note_envelopes`, `call_records`, `message_envelopes`) under the existing per-note/per-message ECIES envelopes.
3. **Status changes are plaintext.** Status values must be queryable server-side for filtering and reporting.
4. **Hub-key for metadata.** Interaction type labels, author references, and other metadata use hub-key AES-GCM encryption where appropriate (following the Tier 1 hub-field pattern).
5. **Blind index for filtering.** `interactionTypeHash` enables server-side filtering by type without revealing the type plaintext to a compromised server.

## v2→v1 Mapping

| v2 Concept | v1 Equivalent | Notes |
|---|---|---|
| `CaseInteraction` | `case_interactions` table | New table |
| `interactionType` enum | Same 8 types | Preserved |
| `sourceId` | Same | Plaintext FK pointer |
| `encryptedContent` + `contentEnvelopes` (ECIES) | `encryptedContent` (MLS ciphertext) | **MLS group encryption**, not ECIES envelopes |
| `authorPubkey` | Same | Plaintext — already visible in source tables |
| `interactionTypeHash` | Same | HMAC-SHA256 blind index |
| `previousStatusHash` / `newStatusHash` | `previousStatus` / `newStatus` | **Plaintext** in v1 (queryable) |
| `caseId` | `entityInstanceId` | Renamed for v1 entity-template terminology |

## DB Schema

### `case_interactions` table

```typescript
// src/server/db/schema/case-interactions.ts
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { ciphertext, hmacHashed } from '../crypto-columns'

export const interactionTypeEnum = [
  'note',         // Linked: note_envelopes.id
  'call',         // Linked: call_records.id
  'message',      // Linked: message_envelopes.id (via conversation)
  'status_change',// Inline: plaintext status transition
  'referral',     // Inline: encrypted referral metadata
  'assessment',   // Inline: encrypted assessment form data
  'file_upload',  // Linked: file_records.id
  'comment',      // Inline: encrypted comment text
] as const

export const caseInteractions = pgTable(
  'case_interactions',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),

    // --- Entity instance binding ---
    entityInstanceId: text('entity_instance_id').notNull(),

    // --- Interaction classification ---
    interactionType: text('interaction_type', {
      enum: interactionTypeEnum,
    }).notNull(),
    interactionTypeHash: hmacHashed('interaction_type_hash').notNull(),

    // --- Source link (for linked interactions) ---
    // Plaintext ID of the source record. The content is encrypted in the
    // source table under existing ECIES envelopes (notes, calls, messages).
    sourceId: text('source_id'),
    sourceTable: text('source_table'), // 'note_envelopes' | 'call_records' | 'message_envelopes' | 'file_records'

    // --- Inline content (for comment, assessment, referral) ---
    // MLS-encrypted ciphertext. NOT ECIES envelopes. The client encrypts
    // the JSON payload via MlsConversation.encrypt() and stores the raw
    // MLS ciphertext here. All current hub members can decrypt.
    encryptedContent: ciphertext('encrypted_content'),

    // --- Status change metadata (plaintext, queryable) ---
    previousStatus: text('previous_status'),
    newStatus: text('new_status'),
    statusChangeReason: text('status_change_reason'),

    // --- Author & ordering ---
    authorPubkey: text('author_pubkey').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // --- Soft delete (for GDPR / admin redaction) ---
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
  },
  (table) => [
    // Primary lookup: all interactions for an entity instance, newest first
    index('case_interactions_entity_created_idx').on(
      table.entityInstanceId,
      table.createdAt
    ),
    // Filter by interaction type (blind index)
    index('case_interactions_entity_type_idx').on(
      table.entityInstanceId,
      table.interactionTypeHash
    ),
    // Filter by source record (e.g., "which cases reference this note?")
    index('case_interactions_source_idx').on(
      table.sourceTable,
      table.sourceId
    ),
    // Hub-scoped queries
    index('case_interactions_hub_idx').on(table.hubId),
  ]
)
```

### Schema Notes

- **`entityInstanceId`** references `entity_instances.id` (defined in Part 2 spec). No formal FK constraint — entity instances may be soft-deleted and we want to retain timeline history.
- **`sourceTable`** + **`sourceId`** form a polymorphic pointer. No formal FK to avoid cross-table constraints on sharded/large tables.
- **`encryptedContent`** stores raw MLS ciphertext bytes (base64-encoded for JSON transport). For linked interactions (`note`, `call`, `message`, `file_upload`), this column is `NULL` — the content lives in the source table.
- **`interactionTypeHash`** is `HMAC-SHA256(HMAC_SECRET, interactionType)` using the server's `HMAC_SECRET`. Same pattern as `phoneHash` in `bans` and `identifierHash` in `contacts`.
- **No `updatedAt`** — interactions are immutable. Edits create a new `comment` interaction or a `status_change`.

## Zod Schemas

### `src/shared/schemas/case-interactions.ts`

```typescript
import { z } from '@hono/zod-openapi'

export const InteractionTypeSchema = z.enum([
  'note',
  'call',
  'message',
  'status_change',
  'referral',
  'assessment',
  'file_upload',
  'comment',
])
export type InteractionType = z.infer<typeof InteractionTypeSchema>

// --- Create Interaction ---

export const CreateCaseInteractionSchema = z.object({
  entityInstanceId: z.string().min(1),
  interactionType: InteractionTypeSchema,
  // For linked interactions: source record ID
  sourceId: z.string().optional(),
  sourceTable: z.enum(['note_envelopes', 'call_records', 'message_envelopes', 'file_records']).optional(),
  // For inline interactions: MLS-encrypted content
  encryptedContent: z.string().optional(),
  // For status_change only
  previousStatus: z.string().optional(),
  newStatus: z.string().optional(),
  statusChangeReason: z.string().optional(),
  // Blind index — computed client-side or server-side
  interactionTypeHash: z.string().min(1),
}).refine(
  (data) => {
    // Linked types require sourceId
    if (['note', 'call', 'message', 'file_upload'].includes(data.interactionType)) {
      return !!data.sourceId && !!data.sourceTable
    }
    // Inline types require encryptedContent (except status_change)
    if (['comment', 'referral', 'assessment'].includes(data.interactionType)) {
      return !!data.encryptedContent
    }
    // status_change requires newStatus
    if (data.interactionType === 'status_change') {
      return !!data.newStatus
    }
    return true
  },
  { message: 'Invalid interaction payload for type' }
)
export type CreateCaseInteractionInput = z.infer<typeof CreateCaseInteractionSchema>

// --- Response Types ---

export const CaseInteractionSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  entityInstanceId: z.string(),
  interactionType: InteractionTypeSchema,
  interactionTypeHash: z.string(),
  sourceId: z.string().optional(),
  sourceTable: z.string().optional(),
  encryptedContent: z.string().optional(),
  previousStatus: z.string().optional(),
  newStatus: z.string().optional(),
  statusChangeReason: z.string().optional(),
  authorPubkey: z.string(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),
  deletedBy: z.string().optional(),
})
export type CaseInteraction = z.infer<typeof CaseInteractionSchema>

// --- List Query ---

export const ListCaseInteractionsQuerySchema = z.object({
  entityInstanceId: z.string().min(1),
  interactionTypeHash: z.string().optional(),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListCaseInteractionsQuery = z.infer<typeof ListCaseInteractionsQuerySchema>

export const CaseInteractionListResponseSchema = z.object({
  interactions: z.array(CaseInteractionSchema),
  total: z.number().int(),
  hasMore: z.boolean(),
})
export type CaseInteractionListResponse = z.infer<typeof CaseInteractionListResponseSchema>

// --- Decrypted content payload (client-side only) ---

export const InteractionContentSchema = z.object({
  text: z.string(),
  // For status changes (also stored plaintext):
  previousStatus: z.string().optional(),
  newStatus: z.string().optional(),
  changeReason: z.string().optional(),
  // For referrals:
  referredToHubId: z.string().optional(),
  referredToEntityId: z.string().optional(),
  referralNotes: z.string().optional(),
  // For assessments:
  assessmentType: z.string().optional(),
  assessmentResult: z.record(z.string(), z.unknown()).optional(),
  // For file uploads:
  fileName: z.string().optional(),
  fileId: z.string().optional(),
})
export type InteractionContent = z.infer<typeof InteractionContentSchema>
```

## API Routes

### `src/server/routes/case-interactions.ts`

Mounted at `/api/case-interactions` (or `/api/entity-instances/:id/interactions` — see Open Questions).

```typescript
import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'
import { getDb } from '../db'
import { caseInteractions } from '../db/schema/case-interactions'
import { and, eq, gte, lte, isNull, sql, desc } from 'drizzle-orm'
import {
  CreateCaseInteractionSchema,
  CaseInteractionSchema,
  CaseInteractionListResponseSchema,
  ListCaseInteractionsQuerySchema,
} from '@shared/schemas/case-interactions'

const router = createRouter()

// ── POST / — create an interaction ──
const createRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Case Interactions'],
  summary: 'Create a case interaction',
  middleware: [requirePermission('cases:write')], // or 'notes:create' — see Open Questions
  request: {
    body: {
      content: {
        'application/json': { schema: CreateCaseInteractionSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Interaction created',
      content: { 'application/json': { schema: CaseInteractionSchema } },
    },
    400: { description: 'Validation error' },
    403: { description: 'Permission denied' },
  },
})

router.openapi(createRoute, async (c) => {
  const body = c.req.valid('json')
  const db = getDb()
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const id = crypto.randomUUID()
  const now = new Date()

  await db.insert(caseInteractions).values({
    id,
    hubId,
    entityInstanceId: body.entityInstanceId,
    interactionType: body.interactionType,
    interactionTypeHash: body.interactionTypeHash,
    sourceId: body.sourceId,
    sourceTable: body.sourceTable,
    encryptedContent: body.encryptedContent,
    previousStatus: body.previousStatus,
    newStatus: body.newStatus,
    statusChangeReason: body.statusChangeReason,
    authorPubkey: pubkey,
    createdAt: now,
  })

  // If status_change, also update the entity instance's current status
  if (body.interactionType === 'status_change' && body.newStatus) {
    // TODO: update entity_instances.status — depends on Part 2 spec
  }

  return c.json(
    {
      id,
      hubId,
      entityInstanceId: body.entityInstanceId,
      interactionType: body.interactionType,
      interactionTypeHash: body.interactionTypeHash,
      sourceId: body.sourceId,
      sourceTable: body.sourceTable,
      encryptedContent: body.encryptedContent,
      previousStatus: body.previousStatus,
      newStatus: body.newStatus,
      statusChangeReason: body.statusChangeReason,
      authorPubkey: pubkey,
      createdAt: now.toISOString(),
    },
    201
  )
})

// ── GET / — list interactions for an entity instance ──
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Case Interactions'],
  summary: 'List interactions for an entity instance',
  middleware: [requirePermission('cases:read')],
  request: {
    query: ListCaseInteractionsQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated interaction list',
      content: { 'application/json': { schema: CaseInteractionListResponseSchema } },
    },
  },
})

router.openapi(listRoute, async (c) => {
  const query = c.req.valid('query')
  const db = getDb()

  const conditions = [
    eq(caseInteractions.entityInstanceId, query.entityInstanceId),
    isNull(caseInteractions.deletedAt),
  ]

  if (query.interactionTypeHash) {
    conditions.push(eq(caseInteractions.interactionTypeHash, query.interactionTypeHash))
  }
  if (query.after) {
    conditions.push(gte(caseInteractions.createdAt, new Date(query.after)))
  }
  if (query.before) {
    conditions.push(lte(caseInteractions.createdAt, new Date(query.before)))
  }

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(caseInteractions)
      .where(and(...conditions))
      .orderBy(desc(caseInteractions.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(caseInteractions)
      .where(and(...conditions)),
  ])

  const total = countResult[0]?.count ?? 0

  return c.json({
    interactions: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      deletedAt: r.deletedAt?.toISOString(),
    })),
    total,
    hasMore: total > query.offset + rows.length,
  })
})

// ── DELETE /:id — soft-delete an interaction (admin or author only) ──
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Case Interactions'],
  summary: 'Soft-delete an interaction',
  middleware: [requirePermission('cases:write')],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Not found' },
    403: { description: 'Not author or admin' },
  },
})

router.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param')
  const db = getDb()
  const pubkey = c.get('pubkey')
  const isAdmin = c.get('isAdmin') // or permission check

  const row = await db
    .select()
    .from(caseInteractions)
    .where(eq(caseInteractions.id, id))
    .limit(1)

  if (row.length === 0) {
    return c.json({ error: 'Not found' }, 404)
  }

  if (row[0].authorPubkey !== pubkey && !isAdmin) {
    return c.json({ error: 'Not author or admin' }, 403)
  }

  await db
    .update(caseInteractions)
    .set({ deletedAt: new Date(), deletedBy: pubkey })
    .where(eq(caseInteractions.id, id))

  return c.body(null, 204)
})

export default router
```

## Client-Side Encryption / Decryption

### MLS Encryption for Inline Content

For `comment`, `assessment`, and `referral` types, the client encrypts the JSON payload using the hub's MLS group:

```typescript
// src/client/lib/case-interactions.ts
import type { MlsConversation } from './mls/conversation'
import type { InteractionContent } from '@shared/schemas/case-interactions'

export async function encryptInteractionContent(
  content: InteractionContent,
  mlsConv: MlsConversation
): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(content))
  const ciphertext = await mlsConv.encrypt(plaintext)
  // Base64-encode for JSON transport
  return btoa(String.fromCharCode(...ciphertext))
}

export async function decryptInteractionContent(
  encryptedContent: string,
  mlsConv: MlsConversation
): Promise<InteractionContent> {
  const binary = atob(encryptedContent)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const result = await mlsConv.decrypt(bytes)
  if (!result.message) {
    throw new Error('MLS handshake message received instead of application data')
  }
  const json = new TextDecoder().decode(result.message)
  return JSON.parse(json) as InteractionContent
}
```

**Key points:**
- The MLS ciphertext is **opaque to the server**. The server cannot decrypt it.
- All current hub members can decrypt via their MLS group state.
- When a member is removed, their device cannot decrypt new interactions (MLS forward secrecy).
- The `MlsConversation` instance is obtained from the hub's MLS group state (see Tier 6 spec §6.3).

### Fallback for Non-MLS Hubs

If a hub has not yet bootstrapped MLS (`tier6Enabled === false`), inline content falls back to **hub-key encryption** (AES-256-GCM via `encryptHubField` / `decryptHubField`):

```typescript
export async function encryptInteractionContentFallback(
  content: InteractionContent,
  hubId: string,
  interactionId: string
): Promise<string> {
  const { encryptHubField } = await import('./hub-field-crypto')
  const json = JSON.stringify(content)
  return encryptHubField(json, hubId, interactionId, 'encrypted_content') ?? ''
}
```

This fallback is **temporary** — once Tier 6 is the default, it can be removed. The spec assumes Tier 6 is active.

## Client: Timeline Component

### `src/client/components/case-timeline.tsx`

A unified timeline component rendering mixed interaction types, similar to `contact-timeline.tsx` but with decryption and entity-instance binding.

```typescript
import { useCaseInteractions } from '@/lib/queries/case-interactions'
import { useMlsConversation } from '@/lib/mls/conversation-hooks'
import { decryptInteractionContent } from '@/lib/case-interactions'
import { useTranslation } from 'react-i18next'

interface CaseTimelineProps {
  entityInstanceId: string
  hubId: string
}

export function CaseTimeline({ entityInstanceId, hubId }: CaseTimelineProps) {
  const { t } = useTranslation()
  const { data, isLoading } = useCaseInteractions(entityInstanceId)
  const mlsConv = useMlsConversation(hubId)

  if (isLoading) return <TimelineSkeleton />

  return (
    <div className="space-y-4">
      {data?.interactions.map((interaction) => (
        <InteractionCard
          key={interaction.id}
          interaction={interaction}
          mlsConv={mlsConv}
        />
      ))}
    </div>
  )
}

function InteractionCard({ interaction, mlsConv }) {
  // Linked interactions: fetch source record separately
  if (interaction.sourceId) {
    return <LinkedInteractionCard interaction={interaction} />
  }

  // Status changes: render plaintext
  if (interaction.interactionType === 'status_change') {
    return <StatusChangeCard interaction={interaction} />
  }

  // Inline interactions: decrypt via MLS
  if (interaction.encryptedContent && mlsConv) {
    return <DecryptedInteractionCard interaction={interaction} mlsConv={mlsConv} />
  }

  return <FallbackCard interaction={interaction} />
}
```

### React Query Hooks

```typescript
// src/client/lib/queries/case-interactions.ts
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'
import { listCaseInteractions, createCaseInteraction } from '@/lib/api'

export const caseInteractionsOptions = (entityInstanceId: string) =>
  queryOptions({
    queryKey: queryKeys.caseInteractions.list(entityInstanceId),
    queryFn: async () => listCaseInteractions({ entityInstanceId }),
    staleTime: 30 * 1000, // 30s — timeline is highly dynamic
  })

export function useCaseInteractions(entityInstanceId: string) {
  return useQuery(caseInteractionsOptions(entityInstanceId))
}

export function useCreateCaseInteraction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createCaseInteraction,
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.caseInteractions.list(vars.entityInstanceId),
      })
    },
  })
}
```

Add to `queryKeys`:

```typescript
// src/client/lib/queries/keys.ts
export const queryKeys = {
  // ... existing keys ...
  caseInteractions: {
    all: ['caseInteractions'] as const,
    list: (entityInstanceId: string) =>
      ['caseInteractions', 'list', entityInstanceId] as const,
  },
} as const
```

And classify in `query-client.ts`:

```typescript
const ENCRYPTED_QUERY_KEYS: QueryKeyDomain[] = [
  // ... existing ...
  'caseInteractions', // MLS ciphertext + linked encrypted sources
]
```

## Auto-Creation on Source Record Events

When a note, call, or message is created and linked to an entity instance, a corresponding `case_interactions` row should be **auto-inserted** by the service layer:

```typescript
// In RecordsService.createNote() / createCall() / etc.
if (entityInstanceId) {
  await this.createCaseInteraction({
    entityInstanceId,
    interactionType: 'note', // or 'call', 'message'
    sourceId: noteId,
    sourceTable: 'note_envelopes',
    interactionTypeHash: hmacHash('note', HMAC_SECRET),
    authorPubkey: pubkey,
  })
}
```

This ensures the timeline stays synchronized without requiring explicit client calls.

## Permissions

| Action | Required Permission | Notes |
|---|---|---|
| List interactions | `cases:read` | Or `entity_instances:read` — see Open Questions |
| Create interaction | `cases:write` | Author must be hub member |
| Delete interaction | `cases:write` + (isAuthor \|\| isAdmin) | Soft delete only |
| Create status_change | `cases:manage` | Only admins/case managers can change status |

## Testing

### Unit Tests

- `case-interactions.schema.test.ts` — Zod schema validation, refine rules
- `case-interactions.service.test.ts` — Auto-creation on note/call/message creation

### API E2E Tests

- `tests/api/case-interactions.spec.ts`:
  - Create linked interaction (note → entity instance)
  - Create inline interaction (comment with MLS ciphertext)
  - Create status_change interaction
  - List with type filter (`interactionTypeHash`)
  - Soft-delete (author vs admin vs other)
  - Unauthorized access (wrong hub)

### UI E2E Tests

- `tests/ui/case-timeline.spec.ts`:
  - Timeline renders mixed interaction types
  - Inline comment decrypts and displays
  - Status change shows transition badge
  - Linked note opens note detail on click
  - Infinite scroll / pagination

## Migration

No migration needed for existing data — `case_interactions` is a new table. Existing notes/calls/messages that were not linked to entity instances will not appear in any timeline until:
1. Entity instances are created (Part 2 spec).
2. A manual or automated linking process associates historical records with entity instances.

## Open Questions

1. **Permission name:** Should this use `cases:*` or `entity_instances:*`? The v2 spec uses "case" terminology; v1 uses "entity instance". Recommend `cases:read` / `cases:write` / `cases:manage` for user-facing permission names, mapping internally to entity instances.

2. **Route mounting:** Should interactions be nested under `/api/entity-instances/:id/interactions` or a flat `/api/case-interactions`? The flat approach is simpler for the list query (which already requires `entityInstanceId` in the query params). Recommend flat for consistency with other v1 APIs.

3. **MLS readiness:** This spec assumes MLS group encryption is available. If Tier 6 PR #2 has not shipped, inline content must use the hub-key fallback. The implementation should gate on `hub.tier6Enabled` and use the appropriate encryption path.

4. **Status change side effects:** Should a `status_change` interaction automatically update `entity_instances.current_status`? Yes — the service layer should perform both operations in a transaction.

5. **Referral cross-hub:** If a case is referred to another hub, the `referredToHubId` field in the encrypted payload may reference a hub the current user is not a member of. The timeline should still display the referral event (with limited metadata) to preserve auditability.

## Files to Create / Modify

### New Files
- `src/server/db/schema/case-interactions.ts`
- `src/shared/schemas/case-interactions.ts`
- `src/server/routes/case-interactions.ts`
- `src/client/lib/queries/case-interactions.ts`
- `src/client/lib/case-interactions.ts` (encrypt/decrypt helpers)
- `src/client/components/case-timeline.tsx`
- `tests/api/case-interactions.spec.ts`
- `tests/ui/case-timeline.spec.ts`

### Modified Files
- `src/server/db/schema/index.ts` — export `caseInteractions`
- `src/shared/schemas/index.ts` — export case-interaction schemas
- `src/server/app.ts` — mount case-interactions routes
- `src/client/lib/queries/keys.ts` — add `caseInteractions` query keys
- `src/client/lib/query-client.ts` — classify `caseInteractions` as encrypted
- `src/client/lib/api/index.ts` — export API functions (if not auto-generated)

## Related Specs

- **Part 2:** Entity Templates Architecture — `docs/superpowers/specs/2026-04-19-v2-entity-templates-architecture.md`
- **Tier 6 MLS:** `docs/superpowers/specs/2026-04-10-security-tier-6-mls-pq-design.md`
- **Hub Field Crypto:** `src/client/lib/hub-field-crypto.ts`
- **Contact Timeline (reference UI):** `src/client/components/contacts/contact-timeline.tsx`

---

*End of spec.*
