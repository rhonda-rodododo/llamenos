# Blind Index Search Spec (v2→v1 Series, Part 6 of 6)

**Date:** 2026-04-19
**Status:** Draft — docs-only, no code changes
**PR title:** `docs: blind index search spec (v2→v1 series 6/6)`

## Overview

This spec defines **Blind Index Search** for Llámenos v1 — enabling the server to filter encrypted entity field values without ever seeing the plaintext. In v2's entity template system, fields can be marked `indexable: true` with `indexType: 'exact'`. In v1's zero-knowledge architecture, the server cannot decrypt field values. Blind indexes bridge this gap: the **client** computes a deterministic HMAC-SHA256 hash of the field value using a hub-derived key, and the **server** stores and queries the hash.

This document specifies the architecture, schema, client-side computation, server-side query, domain separation labels, performance characteristics, limitations, and migration path.

---

## 1. Problem Statement

### 1.1 The Gap

v2 entity templates define structured records (cases, contacts, events) with typed fields. Some fields need to be filterable server-side:
- Find all cases with `status = "open"`
- Find all contacts with `riskLevel = "high"`
- Find all records where `assignedTo = "user-pubkey"`

In v1's E2EE model:
- Field values are encrypted (hub-key AES-GCM or per-note ECIES envelopes)
- The server sees only ciphertext
- `WHERE` clauses on encrypted values are impossible

### 1.2 Existing v1 Blind Index Patterns

v1 already uses HMAC-SHA256 blind indexes in several places:

| Table | Column | Purpose |
|-------|--------|---------|
| `contacts` | `identifierHash` | HMAC of phone/identifier for dedup + lookup |
| `bans` | `phoneHash` | HMAC of banned phone number |
| `subscribers` | `identifierHash` | HMAC of subscriber identifier (phone/email) |
| `conversations` | `contactIdentifierHash` | HMAC for conversation dedup by channel+identifier |
| `push_subscriptions` | `endpointHash` | HMAC of push endpoint for dedup |
| `invite_codes` | `recipientPhoneHash` | HMAC of invite recipient phone |
| `user_sessions` | `tokenHash`, `ipHash` | HMAC of session token and client IP |
| `note_envelopes` | `contactHash` | HMAC linking notes to contacts |

These use `CryptoService.hmac()` (server-side HMAC-SHA256 with `HMAC_SECRET`) or `hmacHashed` column type from `crypto-columns.ts`.

### 1.3 v2's Approach

v2's `entity-schema.ts` defines:
```typescript
indexable: z.boolean().optional().default(false),
indexType: z.enum(['exact', 'none']).optional().default('none'),
```

v2's `records.ts` schema stores blind indexes in a `blindIndexes` record:
```typescript
blindIndexes: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
```

This allows per-field exact-match filtering on the server while the actual field values remain E2EE.

---

## 2. Architecture

### 2.1 Core Principle

> **The client computes the blind index; the server only stores and queries it.**

This preserves zero-knowledge: the server never sees the plaintext value, only a deterministic, unforgeable hash that it cannot reverse.

### 2.2 Key Derivation

The blind index key is **derived from the hub key**, not a server secret. This ensures:
- **Cross-hub isolation**: A hash computed for hub A is useless for hub B
- **No server knowledge**: The server does not know the HMAC key for any hub's blind indexes
- **Membership-bound**: Only current hub members can compute valid blind indexes

Key derivation (HKDF-SHA256):
```
blindIndexKey = HKDF-SHA256(
  ikm = hubKey,           // 32-byte hub symmetric key
  salt = 0x00...00,       // empty salt
  info = "llamenos:blind-index:<fieldName>",
  length = 32
)
```

The `info` parameter includes the field name for **per-field domain separation** — the HMAC key for `status` is different from the HMAC key for `riskLevel`, preventing cross-field correlation attacks.

### 2.3 HMAC Computation

```
blindIndex = HMAC-SHA256(
  key = blindIndexKey,
  message = normalize(value)
)
```

Where `normalize(value)` applies field-type-specific normalization (see §4.2).

### 2.4 Comparison with Existing v1 HMAC Patterns

| Aspect | Existing v1 HMAC (server-side) | Blind Index HMAC (client-side) |
|--------|-------------------------------|-------------------------------|
| Key source | `HMAC_SECRET` env var | Hub key (derived per-field) |
| Who computes | Server (`CryptoService.hmac()`) | Client (crypto worker) |
| Who can verify | Server only | Any hub member |
| Use case | Server-only fields (phone hash, token hash) | E2EE fields that need filtering |
| Cross-hub isolation | Manual (hubId prefix in input) | Automatic (hub key derivation) |

---

## 3. Domain Separation Labels

### 3.1 New Constants

Add to `src/shared/crypto-labels.ts`:

```typescript
/** HKDF info prefix for blind index key derivation from hub key */
export const LABEL_BLIND_INDEX = 'llamenos:blind-index' as CryptoLabel

/** HMAC label: master seed → blind index signing seed (future use) */
export const LABEL_BLIND_INDEX_SIGN = 'llamenos:blind-index:sign:v1' as CryptoLabel
```

Note: `LABEL_BLIND_INDEX` is used as the **HKDF info prefix**, not as an AEAD label. It does not need to be enrolled in `LABEL_REGISTRY` because it is never transmitted on the wire as a `labelId` byte — it is only used in local HKDF derivation.

### 3.2 Per-Field Info Strings

The full HKDF `info` parameter for a field named `status` is:
```
"llamenos:blind-index:status"
```

For a nested field like `customFields.priority`:
```
"llamenos:blind-index:customFields.priority"
```

Field names are limited to `[a-zA-Z0-9_.]` to prevent info-string injection.

---

## 4. Which Fields Can Be Indexed

### 4.1 Indexable Field Types

Only fields that support **exact-match equality** can be blind-indexed. The following field types from `entityFieldDefinitionSchema` are eligible:

| Field Type | Indexable | Normalization | Notes |
|------------|-----------|---------------|-------|
| `text` | ✅ Yes | Lowercase, trim whitespace, NFKC unicode | Case-insensitive exact match |
| `number` | ✅ Yes | Stringify with fixed precision | Integer: `"42"`, Float: `"3.14159"` |
| `select` | ✅ Yes | Lowercase option key | Match by option `key`, not `label` |
| `multiselect` | ✅ Yes (array) | Lowercase each option key, sort lexicographically | Stored as sorted array of hashes |
| `checkbox` | ✅ Yes | `"true"` / `"false"` | Boolean exact match |
| `textarea` | ❌ No | — | Too high cardinality, no meaningful exact match |
| `date` | ⚠️ Partial | ISO 8601 date only (`YYYY-MM-DD`) | No range queries — exact date only |
| `file` | ❌ No | — | File metadata is not indexable |
| `location` | ❌ No | — | Geographic queries require different primitives |

### 4.2 Normalization Rules

Normalization MUST be deterministic and identical on all clients. The server cannot normalize because it does not see the plaintext.

**Text normalization:**
1. Unicode NFKC decomposition
2. Lowercase (locale-independent `toLowerCase()`)
3. Trim leading/trailing whitespace
4. Collapse internal whitespace to single space
5. Empty string → `""` (valid hash, distinguishable from null)

**Number normalization:**
1. Integer: decimal string, no leading zeros (except `"0"`)
2. Float: fixed 6 decimal places, strip trailing zeros, decimal point required
3. Special values: `Infinity` → `"inf"`, `-Infinity` → `"-inf"`, `NaN` → `"nan"`

**Select/multiselect normalization:**
1. Use the option `key` (machine identifier), NOT the `label` (human-readable, i18n-dependent)
2. Lowercase the key
3. For multiselect: sort keys lexicographically, hash each individually

**Date normalization:**
1. Extract date portion only (`YYYY-MM-DD`)
2. Timezone is the hub's configured timezone (stored in hub settings)
3. No time component — exact date match only

### 4.3 Non-Indexable Query Patterns

The following CANNOT be supported with blind indexes:

| Query Pattern | Why Not | Alternative |
|--------------|---------|-------------|
| Substring / `LIKE` | Deterministic hash of full value reveals nothing about substrings | Client-side search (download + decrypt + filter) |
| Range queries (`>`, `<`, `BETWEEN`) | Hash ordering is unrelated to value ordering | Client-side filter after fetch; or plaintext numeric column (server-visible) |
| Full-text search | Tokenization + inverted index requires plaintext | Client-side search; future: encrypted search index (ORAM/FHE — out of scope) |
| Fuzzy matching | Levenshtein distance requires plaintext comparison | Client-side filter |
| Regex | Requires plaintext | Client-side filter |

---

## 5. DB Schema

### 5.1 Per-Field Blind Index Columns

For entity instances (cases, contacts, custom records), blind indexes are stored as **dedicated columns** on the `entity_instances` table (or equivalent v1 table). This is more efficient than v2's JSONB `blindIndexes` record for PostgreSQL query planning and indexing.

```typescript
// src/server/db/schema/entity-instances.ts (new file)
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { hmacHashed } from '../crypto-columns'

export const entityInstances = pgTable(
  'entity_instances',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    entityTypeId: text('entity_type_id').notNull(),

    // --- Blind indexes (server-filterable, client-computed) ---
    // These are HMAC-SHA256 hashes of normalized field values.
    // Column names follow: bi_<fieldName> (blind index)
    biStatus: hmacHashed('bi_status'),
    biSeverity: hmacHashed('bi_severity'),
    biCategory: hmacHashed('bi_category'),
    biAssignedTo: hmacHashed('bi_assigned_to'),

    // For custom fields, a JSONB map of field-name → hash
    // This avoids schema migrations when fields are added/removed
    biCustomFields: text('bi_custom_fields').$type<Record<string, string>>(),

    // --- E2EE content (server-opaque) ---
    encryptedSummary: text('encrypted_summary').notNull(),
    summaryEnvelopes: jsonb<RecipientEnvelope[]>('summary_envelopes').notNull().default([]),

    encryptedFields: text('encrypted_fields'),
    fieldEnvelopes: jsonb<RecipientEnvelope[]>('field_envelopes').notNull().default([]),

    encryptedPII: text('encrypted_pii'),
    piiEnvelopes: jsonb<RecipientEnvelope[]>('pii_envelopes').notNull().default([]),

    // --- Metadata ---
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    index('entity_instances_hub_entity_idx').on(table.hubId, table.entityTypeId),
    index('entity_instances_hub_status_idx').on(table.hubId, table.biStatus),
    index('entity_instances_hub_severity_idx').on(table.hubId, table.biSeverity),
    index('entity_instances_hub_assigned_idx').on(table.hubId, table.biAssignedTo),
  ]
)
```

### 5.2 Index Strategy

Every blind index column that participates in filtering gets a **composite index** on `(hubId, biColumn)`. This is critical for performance — without it, every query becomes a full table scan.

The `biCustomFields` JSONB column uses **GIN indexing** for sparse custom field queries:
```sql
CREATE INDEX entity_instances_custom_bi_gin ON entity_instances
  USING GIN (bi_custom_fields)
  WHERE bi_custom_fields IS NOT NULL;
```

### 5.3 Column Naming Convention

- Standard fields: `bi_<camelCaseFieldName>` → `bi_status`, `bi_riskLevel`
- Custom fields: stored in `bi_customFields` JSONB as `{ "priority": "<hash>", "tags": ["<hash1>", "<hash2>"] }`

---

## 6. Client-Side Index Computation

### 6.1 Crypto Worker Extension

The crypto worker (`src/client/lib/crypto-worker.ts`) gains a new handler:

```typescript
// New WorkerRequest variant
| {
    type: 'computeBlindIndex'
    id: string
    hubId: string
    fieldName: string
    value: string
  }
```

And the crypto worker client (`src/client/lib/crypto-worker-client.ts`) exposes:

```typescript
async computeBlindIndex(hubId: string, fieldName: string, value: string): Promise<string>
```

### 6.2 Implementation

```typescript
// Inside crypto-worker.ts
function handleComputeBlindIndex(hubId: string, fieldName: string, value: string): string {
  if (!hubKey) throw new Error('Worker is locked — hub key not available')

  // 1. Derive per-field key via HKDF
  const info = new TextEncoder().encode(`${LABEL_BLIND_INDEX}:${fieldName}`)
  const blindIndexKey = hkdf(sha256, hubKey, new Uint8Array(0), info, 32)

  // 2. Normalize value
  const normalized = normalizeFieldValue(fieldName, value)

  // 3. HMAC-SHA256
  const mac = hmac(sha256, blindIndexKey, new TextEncoder().encode(normalized))

  // 4. Zero derived key
  blindIndexKey.fill(0)

  return bytesToHex(mac)
}
```

### 6.3 Hub Key Availability

Blind index computation requires the hub key to be loaded in the worker (via `unlockWithHandles`). If the hub key is not available:
- **Create/update operations**: The client refuses the write and shows an error: "Hub key required to save indexed fields. Please unlock your key."
- **Search operations**: The client cannot compute the search hash, so server-side filtering is unavailable. Fallback to client-side search (download all, decrypt, filter).

### 6.4 Batch Computation

For bulk operations (import, migration), the worker supports a batch variant:

```typescript
| {
    type: 'computeBlindIndexes'
    id: string
    hubId: string
    fields: Array<{ fieldName: string; value: string }>
  }
```

This derives the HKDF key once per field name and reuses it across all values, reducing CPU overhead by ~40% for bulk operations.

---

## 7. Server-Side Query

### 7.1 Query Pattern

The server receives a search request with pre-computed blind index hashes:

```typescript
// API request body (from client)
{
  "filters": {
    "status": "a3f7c2...",           // single exact match
    "riskLevel": ["b8e1d4...", "c5a9f2..."], // OR match (any of)
    "tags": ["d2e8a1...", "f4c7b3..."]       // multiselect: contains all
  }
}
```

### 7.2 SQL Generation

The server translates filters into `WHERE` clauses:

```sql
SELECT * FROM entity_instances
WHERE hub_id = 'hub-123'
  AND entity_type_id = 'case'
  AND bi_status = 'a3f7c2...'
  AND (bi_risk_level = 'b8e1d4...' OR bi_risk_level = 'c5a9f2...')
  AND bi_custom_fields @> '{"tags": ["d2e8a1...", "f4c7b3..."]}'
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;
```

### 7.3 API Schema

```typescript
// src/shared/schemas/entity-search.ts (new file)
import { z } from 'zod'

export const entityFilterSchema = z.object({
  entityTypeId: z.string(),
  filters: z.record(
    z.string(),
    z.union([z.string(), z.array(z.string())])
  ).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'closedAt']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(50),
})

export type EntityFilterInput = z.infer<typeof entityFilterSchema>
```

### 7.4 Security Considerations

- **No plaintext in API**: The server never receives the plaintext value, only the hash
- **Rate limiting**: Search endpoints are rate-limited per user to prevent hash-grinding attacks
- **Hub scoping**: Every query includes `hub_id = ?` — cross-hub leakage is structurally impossible
- **No partial match**: The server cannot infer anything about the plaintext from the hash (preimage resistance of HMAC-SHA256)

---

## 8. Performance

### 8.1 Index Size

- Each blind index is **64 hex characters** = 32 bytes raw = 64 bytes as stored text
- A case record with 5 indexed fields uses ~320 bytes for blind indexes
- PostgreSQL index overhead: ~1.3× the column size
- For 1M records with 5 indexed fields: ~416 MB index space

### 8.2 Collision Probability

HMAC-SHA256 produces 256-bit outputs. For a given hub and field:
- Birthday bound for 50% collision probability: ~2^128 hashes
- Practical collision probability with 1M values: ~2^-216 (negligible)
- Conclusion: collisions are cryptographically impossible in practice

### 8.3 Query Performance

With composite `(hub_id, bi_column)` indexes:
- Exact match on single field: **O(log n)** index seek
- Multiple AND conditions: **O(log n)** per condition, PostgreSQL uses bitmap AND
- Multiselect containment (GIN): **O(k)** where k = number of matching entries
- Sort by `created_at` with filter: **O(log n)** if index supports ordering

Expected query times:
- 10K records: < 5ms
- 100K records: < 10ms
- 1M records: < 50ms
- 10M records: < 200ms (with proper partitioning by hub_id)

### 8.4 Client-Side Computation Cost

- HKDF derivation: ~0.1ms per field (amortized to ~0.01ms in batch mode)
- HMAC-SHA256: ~0.05ms per value
- For a form with 10 indexed fields: ~1ms total on a modern laptop
- For bulk import of 1K records with 5 fields each: ~500ms (acceptable for background task)

---

## 9. Limitations

### 9.1 No Range Queries

Blind indexes are hashes — they destroy ordering. You cannot query `age > 18` or `date BETWEEN '2026-01-01' AND '2026-01-31'`.

**Workarounds:**
- For dates: Store year/month/day as separate indexed fields if range queries are needed
- For numbers: Use bucketed ranges (e.g., `ageBracket: "18-25"`, `ageBracket: "26-35"`)
- For full range support: Accept that the field cannot be E2EE — store plaintext server-side

### 9.2 No Substring Search

A hash of `"John Doe"` reveals nothing about `"John"` or `"Doe"`.

**Workaround:** Client-side search — download all records, decrypt, and filter locally. Suitable for small datasets (< 10K records). For larger datasets, use the alternative below.

### 9.3 No Full-Text Search

Tokenization, stemming, and inverted indexes require plaintext.

**Workaround:** Same as substring — client-side search for small datasets.

### 9.4 Client Must Be Online to Search

Because the client computes the search hash, offline search is impossible unless the client has pre-computed hashes for all possible search terms (impractical).

**Mitigation:** Recent search hashes can be cached locally (IndexedDB) for a short TTL.

### 9.5 Membership Required

Only current hub members can compute valid blind indexes. If a user is removed from a hub, they can no longer search that hub's records (by design — this is a security feature, not a bug).

---

## 10. Alternative: Client-Side Search

For fields that are **not** indexable (textarea, file metadata, notes content), the client must perform search locally.

### 10.1 Pattern

1. Fetch all records for the entity type (paginated, e.g., 500 at a time)
2. Decrypt fields in the crypto worker
3. Filter decrypted values against search criteria
4. Display results

### 10.2 When to Use

| Scenario | Approach |
|----------|----------|
| Small dataset (< 1K records) | Client-side search for all fields |
| Large dataset + exact match needed | Blind index for indexable fields |
| Large dataset + substring search | Client-side search with pagination + caching |
| Full-text search on notes | Client-side search only (notes are E2EE per-note forward secrecy) |

### 10.3 Hybrid Approach

The recommended UI pattern combines both:
1. **Server-side filter** using blind indexes for structured fields (status, type, assignedTo)
2. **Client-side filter** on the result set for text fields (title, description)

This gives fast initial filtering + flexible text search on a manageable result set.

---

## 11. Migration: Adding Blind Indexes to Existing Data

### 11.1 The Problem

When a new field is marked `indexable` or when blind indexes are added to an existing entity type, existing records have no blind index values. They become invisible to filtered queries.

### 11.2 Migration Strategy

**Phase 1: Backfill (client-driven)**
1. Admin triggers "Rebuild search indexes" from the UI
2. Client fetches all existing records for the entity type (batch of 100)
3. For each record, client decrypts the field value, computes the blind index, and sends `PATCH /api/entities/:id/blind-indexes`
4. Server updates the `bi_*` columns
5. Progress is shown in the UI

**Phase 2: Lazy backfill (server-side)**
- Records without a blind index are still returned in unfiltered queries
- When a record is next edited, the client computes and sends the blind index
- Over time, all active records get indexed

**Phase 3: Migration job (optional)**
- For large datasets, a server-side background job can iterate records
- The job cannot compute blind indexes (no hub key), so it marks records as "needs re-index"
- The client picks up "needs re-index" records on next sync

### 11.3 API for Backfill

```typescript
// PATCH /api/entities/:id/blind-indexes
{
  "blindIndexes": {
    "status": "a3f7c2...",
    "riskLevel": "b8e1d4...",
    "customFields": {
      "priority": "d2e8a1..."
    }
  }
}
```

Server validates:
- Each hash is 64 hex characters
- Field names match the entity type's field definitions
- The user has write permission on the record

### 11.4 Rollback

If a field is later marked as **not** indexable:
1. Stop computing blind indexes for new records
2. Set the `bi_*` column to NULL for existing records (batch update)
3. Drop the index if no longer needed

---

## 12. Integration with v1 Codebase

### 12.1 Files to Modify

| File | Change |
|------|--------|
| `src/shared/crypto-labels.ts` | Add `LABEL_BLIND_INDEX` and `LABEL_BLIND_INDEX_SIGN` |
| `src/client/lib/crypto-worker.ts` | Add `computeBlindIndex` and `computeBlindIndexes` handlers |
| `src/client/lib/crypto-worker-client.ts` | Add `computeBlindIndex()` and `computeBlindIndexes()` methods |
| `src/server/db/schema/entity-instances.ts` | New table with `bi_*` columns |
| `src/server/db/crypto-columns.ts` | No change — `hmacHashed` already exists |
| `src/shared/schemas/entity-search.ts` | New file — search request/response schemas |
| `src/server/routes/entities.ts` | New routes for filtered search + blind index backfill |
| `src/client/lib/queries/entities.ts` | React Query hooks for search + blind index computation |

### 12.2 Reusing Existing Infrastructure

- **Hub key cache**: `src/client/lib/hub-key-cache.ts` already loads and caches hub keys — blind index computation uses the same cache
- **Crypto worker**: The existing worker handles all private-key operations — blind indexes extend it naturally
- **HMAC primitive**: `hmacSha256` from `@noble/hashes/hmac.js` is already used in the worker (`computeHmac` handler)
- **HKDF primitive**: `hkdf` from `@noble/hashes/hkdf.js` is already available
- **Branded types**: `HmacHash` from `src/shared/crypto-types.ts` is the correct type for blind index columns

### 12.3 Test Strategy

| Test Type | Coverage |
|-----------|----------|
| Unit | `crypto-worker.ts`: `computeBlindIndex` deterministic, different fields produce different hashes, batch mode correctness |
| Unit | `normalizeFieldValue`: unicode normalization, number formatting, date extraction |
| Integration | API: search with single filter, multiple AND filters, OR filters, pagination |
| Integration | API: backfill endpoint updates `bi_*` columns correctly |
| E2E | UI: create record with indexed field → search finds it → edit field → search finds new value |
| E2E | UI: migration dialog shows progress, records without indexes are handled gracefully |
| Security | Adversarial: hash-grinding rate limit, cross-hub query isolation, invalid hash rejection |

---

## 13. Comparison: v1 Blind Index vs. v2 Blind Index

| Aspect | v1 (this spec) | v2 (existing) |
|--------|---------------|---------------|
| Key derivation | Hub key → HKDF per-field | Hub key → HKDF per-field (assumed same) |
| Storage | Dedicated `bi_*` columns + JSONB for custom | `blindIndexes` JSONB record on `recordSchema` |
| Client computation | Crypto worker (`computeBlindIndex`) | Crypto worker (equivalent) |
| Server query | Direct `WHERE bi_column = ?` | `WHERE blindIndexes->>'field' = ?` |
| Indexing | PostgreSQL B-tree + GIN | PostgreSQL GIN on JSONB |
| Performance | Faster (native column + B-tree) | Slower (JSONB extraction) |
| Flexibility | Schema migration needed for new fields | No schema migration (dynamic JSONB keys) |
| Migration | Client backfill required | Client backfill required |

**Recommendation for v1:** Use dedicated columns for well-known fields (status, severity, assignedTo) and a JSONB `bi_customFields` column for dynamic custom fields. This balances performance (B-tree indexes on hot paths) with flexibility (no migration for custom fields).

---

## 14. Security Analysis

### 14.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Server learns plaintext | Server only sees HMAC hashes — preimage resistance prevents recovery |
| Cross-hub hash reuse | Per-hub key derivation ensures hashes are hub-scoped |
| Cross-field hash reuse | Per-field HKDF info ensures hashes are field-scoped |
| Hash grinding (find two values with same hash) | 256-bit HMAC — computationally infeasible |
| Offline dictionary attack | Attacker needs hub key (only held by members) |
| Removed member still searches | Hub key rotation on member departure excludes them |

### 14.2 Hub Key Rotation

When a member leaves the hub, the hub key is rotated (existing v1 behavior). After rotation:
1. All blind indexes become invalid (old key-derived hashes no longer match)
2. A migration job recomputes all blind indexes using the new hub key
3. The departed member cannot compute valid hashes (they don't have the new key)

This is the same rotation story as hub-field encryption — it is already supported by `hub-key-manager.ts`.

### 14.3 Audit Logging

Every blind index backfill operation is logged in the audit log:
- `actorPubkey`: Who triggered the backfill
- `entityTypeId`: Which entity type was re-indexed
- `recordCount`: How many records were updated
- `previousEntryHash`: Chain integrity

---

## 15. Open Questions

1. **Should we support prefix matching?** Some use cases need "find all cases with case number starting with CASE-2026-". This could be supported by storing multiple truncated hashes (e.g., hash of first 4 chars, first 8 chars) at the cost of index size and privacy leakage (server learns approximate length and prefix structure).

2. **Should we support numeric range buckets?** For fields like `age` or `priority`, bucketed ranges ("18-25", "26-35") could be stored as additional blind indexes. This trades precision for queryability.

3. **How to handle entity type schema changes?** When a field is renamed or removed, existing blind index columns may become orphaned. A garbage collection job should periodically scan and drop unused `bi_*` columns.

4. **Should multiselect use set containment or exact match?** The spec proposes "contains all" (`@>`), but some UIs may want "contains any". Both can be supported with different query operators.

---

## 16. References

- v1 HMAC patterns: `src/server/db/schema/contacts.ts`, `src/server/db/schema/records.ts`, `src/server/db/schema/identity.ts`
- v1 CryptoService: `src/server/lib/crypto-service.ts` (`.hmac()` method)
- v1 Crypto worker: `src/client/lib/crypto-worker.ts` (`computeHmac` handler)
- v1 Hub key cache: `src/client/lib/hub-key-cache.ts`
- v1 Hub field crypto: `src/client/lib/hub-field-crypto.ts`
- v1 Crypto labels: `src/shared/crypto-labels.ts`
- v1 Crypto primitives: `src/shared/crypto-primitives.ts` (`hmacSha256`, `hkdfDerive`)
- v2 Entity schema: `/media/rikki/recover2/projects/llamenos/packages/protocol/schemas/entity-schema.ts`
- v2 Records schema: `/media/rikki/recover2/projects/llamenos/packages/protocol/schemas/records.ts`
- v2 Template types: `/media/rikki/recover2/projects/llamenos/packages/protocol/template-types.ts`
- v2 Indexing approach: `entityFieldDefinitionSchema.indexable` + `indexType`

---

## 17. Summary

Blind Index Search enables server-side filtering of encrypted entity fields by having the client compute deterministic HMAC-SHA256 hashes using a hub-derived, per-field key. The server stores these hashes in dedicated `bi_*` columns with composite B-tree indexes, enabling fast exact-match queries without ever seeing the plaintext.

**Key properties:**
- Zero-knowledge: Server sees only hashes
- Deterministic: Same value → same hash (enables equality queries)
- Domain-separated: Per-hub, per-field key derivation prevents cross-context attacks
- Performant: B-tree index seeks on `(hub_id, bi_column)`
- Limited: Exact match only — no range, substring, or full-text search on encrypted fields

**Next steps (implementation):**
1. Add `LABEL_BLIND_INDEX` to `crypto-labels.ts`
2. Extend crypto worker with `computeBlindIndex` handler
3. Create `entity_instances` table with `bi_*` columns
4. Implement search API with blind index filters
5. Build client-side search UI with hybrid server/client filtering
6. Write migration path for backfilling existing records
