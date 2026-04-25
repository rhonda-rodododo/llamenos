# Blind Index Crypto Worker Integration

**Date:** 2026-04-25
**Status:** Draft — pending review
**Depends on:** Blind Index Search spec (Part 6, 2026-04-19), Entity Crypto Engine spec (2026-04-25)
**Blocks:** Entity Crypto Engine implementation (blind index computation)

---

## 1. Problem

The Entity Crypto Engine spec (2026-04-25, Section 3.3.2) calls `cryptoWorker.computeBlindIndex(hubId, fieldName, value)` to compute blind indexes alongside field encryption. **This method does not exist.** Neither the crypto worker nor the crypto worker client exposes a blind index computation handler.

The Blind Index Search spec (Part 6, 2026-04-19) defines the cryptographic approach (HKDF key derivation from hub key, per-field domain separation, HMAC-SHA256) but does not specify the crypto worker RPC interface.

This spec bridges that gap.

## 2. Design

### 2.1 Key Derivation (from Part 6 spec)

```
blindIndexKey = HKDF-SHA256(
  ikm   = hubKey,                           // 32-byte hub symmetric key
  salt  = 0x00...00,                        // empty salt
  info  = "llamenos:blind-index:<fieldName>", // per-field domain separation
  length = 32
)

blindIndex = HMAC-SHA256(key = blindIndexKey, message = normalize(value))
```

The hub key must be available in the crypto worker (loaded via `unlockWithHandles`). The HKDF key is derived per field name and cached for the duration of the session (or until hub key rotates).

### 2.2 Normalization (from Part 6 spec)

| Field Type | Normalization |
|---|---|
| `text` | NFKC, lowercase, trim, collapse whitespace |
| `number` | Integer: decimal string; Float: 6 decimal places |
| `select` | Lowercase option key |
| `multiselect` | Lowercase each key, sort lexicographically, hash each individually |
| `checkbox` | `"true"` / `"false"` |
| `date` | ISO 8601 date portion only (`YYYY-MM-DD`) |
| `textarea`, `file`, `location` | Not indexable |

Normalization is implemented in `src/shared/lib/blind-index-normalize.ts` (new file, shared between client and server for consistency).

### 2.3 Crypto Worker RPC

#### Single computation

```typescript
// New WorkerRequest variant in crypto-worker.ts
| {
    type: 'computeBlindIndex'
    id: string
    fieldName: string
    normalizedValue: string  // pre-normalized by caller
  }

// Response
| {
    type: 'computeBlindIndex'
    id: string
    result: string  // hex-encoded HMAC-SHA256
  }
```

The worker:
1. Checks that the hub key is loaded (throws if locked)
2. Derives the per-field HKDF key from the hub key + `LABEL_BLIND_INDEX:<fieldName>` info
3. Computes `HMAC-SHA256(blindIndexKey, normalizedValue)`
4. Zeros the derived key
5. Returns the hex-encoded hash

#### Batch computation

```typescript
| {
    type: 'computeBlindIndexBatch'
    id: string
    fields: Array<{ fieldName: string; normalizedValue: string }>
  }

// Response
| {
    type: 'computeBlindIndexBatch'
    id: string
    results: Array<{ fieldName: string; blindIndex: string }>
  }
```

The batch variant derives each HKDF key once per unique `fieldName` and reuses it across all values for that field. This reduces HKDF derivation overhead by ~40% for bulk operations.

### 2.4 Crypto Worker Client

```typescript
// New methods in crypto-worker-client.ts

/**
 * Compute a blind index hash for a single field value.
 * The value must be pre-normalized by the caller using normalizeForBlindIndex().
 */
async computeBlindIndex(fieldName: string, normalizedValue: string): Promise<string>

/**
 * Compute blind indexes for multiple field values in a single worker round-trip.
 * Returns a map of fieldName → hexHash.
 */
async computeBlindIndexBatch(
  fields: Array<{ fieldName: string; normalizedValue: string }>
): Promise<Map<string, string>>
```

Note: the `hubId` parameter from the Entity Crypto Engine spec is removed from the worker interface. The worker always uses the currently-loaded hub key. If the caller needs indexes for a different hub, the hub key must be swapped first (which is already how `unlockWithHandles` works — one hub key at a time).

### 2.5 Shared Normalization Module

```typescript
// src/shared/lib/blind-index-normalize.ts

import type { EntityTypeField } from '@shared/schemas/entity-type-fields'

/**
 * Normalize a field value for blind index computation.
 * Deterministic and identical on all clients — the server cannot normalize
 * because it never sees plaintext.
 *
 * Returns null if the field type is not indexable.
 */
export function normalizeForBlindIndex(
  value: unknown,
  fieldType: EntityTypeField['fieldType']
): string | null {
  if (value === undefined || value === null) return null

  switch (fieldType) {
    case 'text':
      return normalizeText(String(value))
    case 'number':
      return normalizeNumber(value as number)
    case 'select':
      return String(value).toLowerCase()
    case 'checkbox':
      return value ? 'true' : 'false'
    case 'date':
      return normalizeDateToISO(String(value))
    case 'multiselect':
      // Multiselect: each option key is indexed separately
      // Caller must iterate and hash each one
      return null // handled specially by the engine
    case 'textarea':
    case 'file':
    case 'location':
      return null // not indexable
    default:
      return null
  }
}

/**
 * Normalize a multiselect value: returns sorted, lowercased option keys.
 * Each key is hashed individually; the engine stores an array of hashes.
 */
export function normalizeMultiselectForBlindIndex(
  values: string[]
): string[] {
  return values.map(v => v.toLowerCase()).sort()
}

function normalizeText(value: string): string {
  // 1. Unicode NFKC decomposition
  const nfkc = value.normalize('NFKC')
  // 2. Lowercase (locale-independent)
  const lower = nfkc.toLowerCase()
  // 3. Trim leading/trailing whitespace
  const trimmed = lower.trim()
  // 4. Collapse internal whitespace to single space
  return trimmed.replace(/\s+/g, ' ')
}

function normalizeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    if (value === Infinity) return 'inf'
    if (value === -Infinity) return '-inf'
    return 'nan'
  }
  if (Number.isInteger(value)) return value.toString()
  // Fixed 6 decimal places, strip trailing zeros but keep decimal point
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0')
}

function normalizeDateToISO(value: string): string {
  // Extract date portion only (YYYY-MM-DD)
  const d = new Date(value)
  if (isNaN(d.getTime())) return value // pass through invalid dates
  return d.toISOString().slice(0, 10)
}
```

### 2.6 Entity Crypto Engine Integration

The engine's `encryptEntityFields` function (from the main spec §3.3.2) is updated to normalize values before sending to the worker:

```typescript
// In encryptEntityFields, after encryption:
if (tier.needsBlindIndex) {
  if (field.fieldType === 'multiselect' && Array.isArray(value)) {
    const keys = normalizeMultiselectForBlindIndex(value as string[])
    const hashes = await cryptoWorker.computeBlindIndexBatch(
      keys.map(k => ({ fieldName: field.name, normalizedValue: k }))
    )
    blindIndexes[field.name] = Array.from(hashes.values())
  } else {
    const normalized = normalizeForBlindIndex(value, field.fieldType)
    if (normalized !== null) {
      blindIndexes[field.name] = await cryptoWorker.computeBlindIndex(
        field.name, normalized
      )
    }
  }
}
```

## 3. Crypto Labels

Add to `src/shared/crypto-labels.ts`:

```typescript
/** HKDF info prefix for blind index key derivation from hub key.
 *  Not enrolled in LABEL_REGISTRY — only used in local HKDF derivation, never transmitted on wire. */
export const LABEL_BLIND_INDEX = 'llamenos:blind-index' as CryptoLabel
```

This is already defined in the Blind Index Search spec (Part 6, §3.1) but has not been implemented.

## 4. Testing

### 4.1 Unit Tests

| Test | Coverage |
|---|---|
| `blind-index-normalize.test.ts` | All field types, edge cases (empty string, NaN, Unicode, multiselect sorting) |
| `crypto-worker.test.ts` | `computeBlindIndex` deterministic output, different fields → different hashes, locked worker → error |
| `crypto-worker.test.ts` | `computeBlindIndexBatch` returns correct results, batches HKDF derivation |

### 4.2 Test Vectors

Provide deterministic test vectors so implementations can cross-check:

```typescript
// Given hubKey = 0x00...00 (32 zero bytes), fieldName = 'status', value = 'open':
// blindIndexKey = HKDF-SHA256(ikm=0x00...00, salt=empty, info='llamenos:blind-index:status', len=32)
// blindIndex = HMAC-SHA256(blindIndexKey, 'open')
// Expected output: <hex string> (computed once and frozen as test vector)
```

## 5. Files to Create / Modify

### New Files

| File | Description |
|---|---|
| `src/shared/lib/blind-index-normalize.ts` | Normalization functions |
| `src/shared/lib/blind-index-normalize.test.ts` | Unit tests |

### Modified Files

| File | Change |
|---|---|
| `src/shared/crypto-labels.ts` | Add `LABEL_BLIND_INDEX` |
| `src/client/lib/crypto-worker.ts` | Add `computeBlindIndex` and `computeBlindIndexBatch` handlers |
| `src/client/lib/crypto-worker-client.ts` | Add `computeBlindIndex()` and `computeBlindIndexBatch()` methods |

---

*End of spec.*
