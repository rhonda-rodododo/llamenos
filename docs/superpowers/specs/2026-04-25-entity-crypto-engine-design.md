# Entity Crypto Engine — Declarative, Schema-Driven Encryption Layer

**Date:** 2026-04-25
**Status:** Draft — pending review
**Series:** v2→v1 Entity Architecture, cross-cutting supplement
**Depends on:** Entity Type Registry (Part 1), Custom Field Schema Engine (Part 4), Relationship Engine (Part 2), Blind Index Search (Part 6)
**Supplements:** All 6 parts of the v2→v1 spec series

---

## 1. Problem Statement

### 1.1 The Pain

The v1 codebase has **11+ query files** and **7+ mutation components** that each hand-code identical encrypt/decrypt patterns. Every React Query `queryFn` manually calls `decryptHubField()` per encrypted column. Every mutation manually calls `encryptHubField()` per field, pre-generates UUIDs for AAD binding, and sends both plaintext + encrypted variants to the server.

This has two consequences:

1. **Crypto migrations are excruciating.** The ECIES→HPKE migration required touching every file that decrypts anything. When 20+ files each contain bespoke decrypt logic, changing the underlying primitive means 20+ file edits, each with its own opportunity for subtle bugs (wrong AAD, wrong label, wrong field name, silent fallback to plaintext).

2. **New entity types require new decrypt code.** The 6-part entity architecture spec series (Parts 1–6) defines rich entity types, custom fields, relationships, timelines, and blind indexes — but each spec's client-side query hooks still show manual `decryptHubField()` calls copied from existing patterns. Adding a new entity type means writing yet another decrypt-on-fetch `queryFn` and encrypt-before-mutation helper.

### 1.2 The Opportunity

The entity type registry (Part 1) already contains the metadata needed to automate encryption:

- **Field definitions** declare `isPii`, `accessLevel`, `fieldType`, `indexable`
- **Entity type metadata** columns are named `encrypted*` by convention
- **Relationship type metadata** has `encryptedLabel`, `encryptedRoles`, etc.
- **Relationship instance payloads** use MLS group encryption
- **File attachments** use per-recipient HPKE envelopes (attorney-client privilege)

This metadata should **drive** the crypto operations, not merely describe them.

### 1.3 What This Spec Defines

The **Entity Crypto Engine** — a runtime layer that reads entity type schema metadata and provides generic encrypt/decrypt operations for any entity type, eliminating per-domain crypto code entirely.

This spec is a **cross-cutting supplement** to the 6-part entity architecture series. It does not redefine the entity types, fields, relationships, or blind indexes — it defines the shared infrastructure that makes all of them work without per-domain boilerplate.

---

## 2. Threat Model & Encryption Tiers

### 2.1 Threat Model Recap

The server is **untrusted**. A compromised server (or a subpoena of server data) should reveal as little as possible about:

- **Organizational structure** — what entity types exist, what they're named, what statuses and roles mean, how the org is configured
- **Operational data** — case notes, assessment results, referral details, timeline comments, relationship metadata
- **Personally identifiable information** — who called, who is involved, contact details, names, phone numbers
- **Privileged communications** — file attachments that may be subject to attorney-client privilege, where only specific recipients should have access
- **Server-held secrets** — API credentials, IdP tokens, provider keys that the server needs at runtime but must not be stored in plaintext at rest

### 2.2 Design Principle: Everything Encrypted

**All data is encrypted.** There is no user-facing toggle for "encrypted vs not." The blind index system (Part 6) handles server-side filterability without plaintext values, so there is no functional reason to leave field values unencrypted.

The routing question for any piece of data is **"Which tier?"** — never **"Encrypted or not?"**

The only truly plaintext data is **structural necessities** that the database requires for joins, foreign key resolution, and routing: record IDs, hub IDs, entity type IDs, machine-name option keys (for blind-index-backed validation), timestamps, and boolean config flags. Even machine-name option keys are only plaintext because their *labels* (the human-readable text) are encrypted — the keys themselves are opaque identifiers that leak no semantic meaning to an attacker.

### 2.3 Six Encryption Tiers

| Tier | Key Holder | Who Decrypts | Primitive | Examples |
|---|---|---|---|---|
| **T0 — Structural Plaintext** | N/A | Server + all clients | None | Foreign key IDs (`hub_id`, `entity_type_id`), machine-name option keys, timestamps, boolean config flags, `createdBy` pubkeys |
| **T1 — Server-Secret** | Server only (`SERVER_SECRET` / `IDP_VALUE_ENCRYPTION_KEY`) | Server only | `CryptoService.serverEncrypt()` — AES-256-GCM with label-bound AAD | API credentials (`LABEL_PROVIDER_CREDENTIAL_WRAP`), IdP tokens (`LABEL_IDP_VALUE_WRAP`), webhook signing keys, IVR audio storage keys |
| **T2 — Hub-Key** | Server (for seeding/re-wrapping) + all hub member clients (non-extractable `CryptoKey`) | All hub members | AES-256-GCM via hub symmetric key, per-record AAD (`hubFieldAad(recordId, fieldName)`) | Entity type labels/descriptions/icons/colors, status labels, field labels/helpText, option labels, non-PII field values, shift names, role names, team names, tag names |
| **T3 — MLS Group** | Current MLS group members | Current hub members (with forward secrecy — member removal revokes access to future content) | MLS `encrypt()`/`decrypt()` via per-hub group (`llamenos:hub:<hubId>`) | PII-marked entity field values, relationship instance payloads (notes, join fields), timeline inline content (comments, assessments, referrals) |
| **T4 — HPKE Envelope** | Named recipient private keys only | Specific envelope recipients | HPKE seal/open (`DHKEM(X25519) + HKDF-SHA256 + AES-256-GCM`) with AAD binding | Contact PII (full name, phone, email), user identity data, per-note forward-secrecy keys, **file attachment keys and metadata** (attorney-client privilege) |
| **T5 — Blind Index** | Hub members (for computation) | Server (for filtering, cannot reverse) | HMAC-SHA256 with hub-derived per-field HKDF key | Filterable field values (status, severity, category, assignedTo, custom select/checkbox fields marked `indexable: true`) |

**Notes:**

- **T2 and server-side hub-key are the same cryptographic tier** — same key, same AAD formula — but different execution contexts. The server calls `CryptoService.hubEncryptField()` (e.g., when seeding template labels); the client calls `encryptHubField()` via the crypto worker. The engine must know which context it's in.
- **T4 (HPKE Envelope) is critical for file attachments.** Files uploaded to entity records (evidence photos, legal documents, medical records) may be subject to attorney-client privilege. Not all hub members should have access — only named recipients on the envelope. The per-file random symmetric key is HPKE-wrapped per recipient under `LABEL_FILE_KEY`; file metadata (filename, MIME type, size) is separately HPKE-wrapped under `LABEL_FILE_METADATA`. The `items_key` indirection layer allows key rotation without re-encrypting file bodies.
- **T5 (Blind Index) is not standalone encryption** — it's a companion to T2/T3. An indexed field has its value encrypted (T2 or T3) AND its blind index hash stored (T5) simultaneously. The engine computes both in one operation.
- **T3 vs T4 for PII:** `isPii: true` on a field definition routes to T3 (MLS group) for hub-scoped PII that all members should see (e.g., immigration case A-numbers visible to all case managers). T4 (HPKE envelope) is for per-recipient PII where access is permission-gated (e.g., contact full names visible only to `contacts:envelope-full` holders). The distinction maps to the existing `accessLevel` field: `all`/`assigned` → T2 (hub-key), `admin` with `isPii` → T3 (MLS), per-recipient permissions → T4 (HPKE).

### 2.4 Tier Routing Decision Tree

```
For a given field value:

1. Is it a structural necessity (FK, machine key, timestamp, config flag)?
   → T0 Plaintext

2. Is it a server-only secret (API key, IdP token, webhook secret)?
   → T1 Server-Secret

3. Is it a file attachment body or file metadata?
   → T4 HPKE Envelope (per-recipient, attorney-client privilege)

4. Is it restricted to specific recipients (accessLevel: 'custom' with named roles)?
   → T4 HPKE Envelope (per-recipient, only named role holders can decrypt)

5. Is the field marked `isPii: true`?
   → T3 MLS Group (forward secrecy on member removal)

6. Is it a relationship instance payload or timeline inline content?
   → T3 MLS Group

7. Is it entity metadata (label, description, icon, color) or a non-PII field value?
   → T2 Hub-Key

8. Is the field marked `indexable: true`?
   → ALSO compute T5 Blind Index (in addition to T2, T3, or T4)
```

---

## 3. Engine Architecture

### 3.1 Core Design

The Entity Crypto Engine is **not a single class** — it's a set of composable utilities that read entity type field definitions from the registry and apply the correct encryption tier automatically. The utilities exist in two execution contexts:

| Context | Location | Responsibilities |
|---|---|---|
| **Client-side engine** | `src/client/lib/entity-crypto-engine.ts` | Decrypt-on-fetch in `queryFn`, encrypt-before-mutation, blind index computation, file envelope management |
| **Server-side engine** | `src/server/lib/entity-crypto-engine.ts` | Hub-key encryption during template seeding, server-secret encryption, blind index validation, tier enforcement (reject unencrypted values for non-T0 fields) |

Both sides share a **tier resolution function** in `src/shared/lib/tier-resolution.ts` that takes a field definition and returns the encryption tier. This is the single source of truth for routing.

### 3.2 Shared: Tier Resolution

```typescript
// src/shared/lib/tier-resolution.ts

import type { EntityTypeField } from '@shared/schemas/entity-type-fields'

export type EncryptionTier = 'plaintext' | 'server-secret' | 'hub-key' | 'mls-group' | 'hpke-envelope' | 'blind-index'

export interface TierResolution {
  /** Primary encryption tier for the field value */
  valueTier: EncryptionTier
  /** Whether a blind index should also be computed */
  needsBlindIndex: boolean
}

/**
 * Determine the encryption tier for a field value based on its schema definition.
 *
 * This is the SINGLE SOURCE OF TRUTH for tier routing. Both client and server
 * call this function — they diverge only in which crypto primitive they invoke
 * for the resolved tier.
 *
 * Note: This function only routes ENTITY FIELD VALUES. It does not handle:
 * - T0 (Structural Plaintext) — structural fields (IDs, timestamps, config flags)
 *   are not entity fields; they are table columns managed by the service layer.
 * - T1 (Server-Secret) — server infrastructure config (API keys, IdP tokens)
 *   is not entity data; it's handled by CryptoService.serverEncrypt() directly.
 * - Entity type metadata (labels, descriptions) — always T2 hub-key, handled
 *   by resolveMetadataTier() below.
 */
export function resolveFieldTier(field: EntityTypeField): TierResolution {
  // File fields always use HPKE envelope (attorney-client privilege).
  // Only named recipients can decrypt file content and metadata.
  if (field.fieldType === 'file') {
    return { valueTier: 'hpke-envelope', needsBlindIndex: false }
  }

  // Per-recipient restricted fields use HPKE envelope.
  // accessLevel 'custom' with specific accessRoles means only those role
  // holders should see the value — this maps to per-recipient envelopes.
  if (field.accessLevel === 'custom' && field.accessRoles.length > 0) {
    return { valueTier: 'hpke-envelope', needsBlindIndex: field.indexable }
  }

  // PII fields use MLS group encryption (forward secrecy on member removal).
  // All current hub members can decrypt, but removed members lose access.
  if (field.isPii) {
    return {
      valueTier: 'mls-group',
      needsBlindIndex: field.indexable,
    }
  }

  // All other field values use hub-key encryption.
  // Readable by all hub members, encrypted at rest, opaque to the server.
  return {
    valueTier: 'hub-key',
    needsBlindIndex: field.indexable,
  }
}

/**
 * Determine the encryption tier for entity type metadata (labels, descriptions, etc.).
 * Metadata is ALWAYS hub-key encrypted — this function exists for completeness
 * and to make the "everything encrypted" invariant explicit.
 */
export function resolveMetadataTier(): EncryptionTier {
  return 'hub-key'
}
```

### 3.3 Client-Side Engine

The client-side engine provides three primary capabilities:

#### 3.3.1 `createEntityQuery` — Decrypt-on-Fetch Query Builder

Given an entity type ID, returns a React Query `queryOptions` config with automatic decryption in the `queryFn`. Replaces all 11+ manual decrypt-on-fetch patterns.

```typescript
// src/client/lib/entity-crypto-engine.ts

import type { EntityType, EntityTypeField } from '@shared/schemas/entity-types'
import { resolveFieldTier, resolveMetadataTier } from '@shared/lib/tier-resolution'
import { decryptHubField } from '@/lib/hub-field-crypto'
import { queryOptions } from '@tanstack/react-query'

/**
 * Decrypt all hub-key-encrypted metadata fields on an entity type record.
 * Handles: label, labelPlural, description, icon, color, and nested
 * status/field/contactRole labels.
 */
export async function decryptEntityTypeMetadata(
  raw: EntityTypeRaw,
  hubId: string
): Promise<EntityType> {
  return {
    ...raw,
    label: await decryptHubField(raw.encryptedLabel, hubId, raw.id, 'encrypted_label'),
    labelPlural: await decryptHubField(raw.encryptedLabelPlural, hubId, raw.id, 'encrypted_label_plural'),
    description: await decryptHubField(raw.encryptedDescription, hubId, raw.id, 'encrypted_description'),
    icon: await decryptHubField(raw.encryptedIcon, hubId, raw.id, 'encrypted_icon'),
    color: await decryptHubField(raw.encryptedColor, hubId, raw.id, 'encrypted_color'),
    fields: await Promise.all(
      raw.fields.map((f) => decryptFieldDefinitionMetadata(f, hubId))
    ),
    statuses: await Promise.all(
      raw.statuses.map((s) => decryptEnumOptionMetadata(s, hubId))
    ),
  }
}

/**
 * Decrypt a single entity instance's field values based on the entity type's
 * field definitions. Routes each value through the correct tier.
 */
export async function decryptEntityFieldValues(
  encryptedValues: Record<string, string>,
  piiValues: Record<string, string>,
  fields: EntityTypeField[],
  hubId: string,
  recordId: string,
  mlsConversation?: MlsConversation
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}

  await Promise.all(
    fields.map(async (field) => {
      const tier = resolveFieldTier(field)

      switch (tier.valueTier) {
        case 'hub-key': {
          const ct = encryptedValues[field.name]
          if (ct) {
            result[field.name] = await decryptHubField(ct, hubId, recordId, field.name)
          }
          break
        }
        case 'mls-group': {
          const ct = piiValues[field.name]
          if (ct && mlsConversation) {
            const decrypted = await mlsConversation.decrypt(fromBase64(ct))
            result[field.name] = JSON.parse(new TextDecoder().decode(decrypted.message!))
          }
          break
        }
        case 'hpke-envelope': {
          // File fields: the file body is decrypted via file-crypto.ts when
          // the user opens/downloads. The field value here is a fileId reference.
          // The engine stores the fileId as-is; actual file decryption is
          // handled by the existing file-crypto pipeline.
          result[field.name] = encryptedValues[field.name]
          break
        }
      }
    })
  )

  return result
}

/**
 * Build a React Query `queryOptions` for listing entity instances of a given type.
 * Automatically decrypts all field values based on the entity type's field definitions.
 *
 * This replaces every per-domain `queryFn` that manually calls `decryptHubField`.
 */
export function createEntityInstanceQuery(
  entityTypeId: string,
  hubId: string,
  fetchFn: () => Promise<{ instances: EntityInstanceRaw[] }>,
  queryKey: readonly unknown[],
  fields: EntityTypeField[],
  mlsConversation?: MlsConversation
) {
  return queryOptions({
    queryKey,
    queryFn: async () => {
      const { instances } = await fetchFn()
      return Promise.all(
        instances.map(async (instance) =>
          decryptEntityFieldValues(
            instance.encryptedFieldValues,
            instance.piiFieldValues,
            fields,
            hubId,
            instance.id,
            mlsConversation
          )
        )
      )
    },
    staleTime: 5 * 60 * 1000,
  })
}
```

#### 3.3.2 `encryptEntityFields` — Encrypt-Before-Mutation

Given field values and the entity type's field definitions, encrypts each value at the correct tier. Pre-generates UUIDs for AAD binding. Computes blind indexes for indexable fields.

```typescript
/**
 * Encrypt field values for an entity instance mutation (create or update).
 * Routes each value through the correct tier based on the field definition.
 * Also computes blind indexes for indexable fields.
 *
 * Returns the encrypted payload ready to send to the server.
 */
export async function encryptEntityFields(
  values: Record<string, unknown>,
  fields: EntityTypeField[],
  hubId: string,
  recordId: string,
  mlsConversation?: MlsConversation
): Promise<{
  encryptedFieldValues: Record<string, Ciphertext>
  piiFieldValues: Record<string, string>
  blindIndexes: Record<string, string>
}> {
  const encryptedFieldValues: Record<string, Ciphertext> = {}
  const piiFieldValues: Record<string, string> = {}
  const blindIndexes: Record<string, string> = {}

  await Promise.all(
    fields.map(async (field) => {
      const value = values[field.name]
      if (value === undefined || value === null) return

      const tier = resolveFieldTier(field)
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value)

      switch (tier.valueTier) {
        case 'hub-key': {
          const ct = await encryptHubField(stringValue, hubId, recordId, field.name)
          if (ct) encryptedFieldValues[field.name] = ct
          break
        }
        case 'mls-group': {
          if (!mlsConversation) {
            throw new Error(`MLS required for PII field "${field.name}" but not available`)
          }
          const plaintext = new TextEncoder().encode(stringValue)
          const ciphertext = await mlsConversation.encrypt(plaintext)
          piiFieldValues[field.name] = toBase64(ciphertext)
          break
        }
        case 'hpke-envelope': {
          // File encryption is handled by the file-crypto pipeline at upload
          // time, not by the entity field engine. The field value stored here
          // is a fileId reference. See file-crypto.ts.
          encryptedFieldValues[field.name] = stringValue as Ciphertext
          break
        }
      }

      // Blind index computation (in addition to encryption, not instead of)
      if (tier.needsBlindIndex) {
        blindIndexes[field.name] = await cryptoWorker.computeBlindIndex(
          hubId, field.name, stringValue
        )
      }
    })
  )

  return { encryptedFieldValues, piiFieldValues, blindIndexes }
}
```

#### 3.3.3 `encryptEntityMetadata` — Encrypt Entity Type Metadata

For admin operations that create/update entity types, statuses, fields, relationships, etc.

```typescript
/**
 * Encrypt all metadata fields on an entity type record for a create/update mutation.
 * This replaces the per-domain pattern of manually calling encryptHubField for
 * each label/description/icon/color field.
 */
export async function encryptEntityTypeMetadata(
  data: {
    label: string
    labelPlural: string
    description?: string
    icon?: string
    color?: string
  },
  hubId: string,
  recordId: string
): Promise<{
  encryptedLabel: Ciphertext | undefined
  encryptedLabelPlural: Ciphertext | undefined
  encryptedDescription: Ciphertext | undefined
  encryptedIcon: Ciphertext | undefined
  encryptedColor: Ciphertext | undefined
}> {
  const [encryptedLabel, encryptedLabelPlural, encryptedDescription, encryptedIcon, encryptedColor] =
    await Promise.all([
      encryptHubField(data.label, hubId, recordId, 'encrypted_label'),
      encryptHubField(data.labelPlural, hubId, recordId, 'encrypted_label_plural'),
      data.description ? encryptHubField(data.description, hubId, recordId, 'encrypted_description') : undefined,
      data.icon ? encryptHubField(data.icon, hubId, recordId, 'encrypted_icon') : undefined,
      data.color ? encryptHubField(data.color, hubId, recordId, 'encrypted_color') : undefined,
    ])

  return { encryptedLabel, encryptedLabelPlural, encryptedDescription, encryptedIcon, encryptedColor }
}
```

### 3.4 Server-Side Engine

The server-side engine mirrors the client's tier resolution but calls server-side primitives.

```typescript
// src/server/lib/entity-crypto-engine.ts

import type { EntityTypeField } from '@shared/schemas/entity-type-fields'
import { resolveFieldTier } from '@shared/lib/tier-resolution'
import type { CryptoService } from './crypto-service'
import type { Ciphertext } from '@shared/crypto-types'

/**
 * Server-side entity crypto engine.
 *
 * Used during:
 * - Template seeding (encrypt labels with hub key)
 * - Default entity creation (encrypt seeded values)
 * - Server-secret field encryption (API keys, provider creds)
 * - Tier enforcement (reject unencrypted values for non-T0 fields)
 */
export class ServerEntityCryptoEngine {
  constructor(
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Encrypt entity type metadata with the hub key (server-side seeding).
   * Same AAD formula as client-side encryptHubField.
   */
  encryptMetadata(
    plaintext: string,
    hubKey: Uint8Array,
    recordId: string,
    fieldName: string
  ): Ciphertext {
    return this.crypto.hubEncryptField(plaintext, hubKey, recordId, fieldName)
  }

  /**
   * Encrypt a server-only secret (API key, IdP token, etc.).
   */
  encryptServerSecret(plaintext: string, label: CryptoLabel): Ciphertext {
    return this.crypto.serverEncrypt(plaintext, label)
  }

  /**
   * Validate that a mutation payload has encrypted values for all non-T0 fields.
   * Rejects writes that would store plaintext where encryption is required.
   *
   * This is a defense-in-depth check — the client should always encrypt,
   * but the server enforces the invariant.
   */
  validateEncryptionCompleteness(
    payload: Record<string, unknown>,
    fields: EntityTypeField[]
  ): { valid: boolean; violations: string[] } {
    const violations: string[] = []

    for (const field of fields) {
      const tier = resolveFieldTier(field)
      if (tier.valueTier === 'plaintext') continue

      // Check that the encrypted variant exists if any value was provided
      const hasPlaintext = payload[field.name] !== undefined
      const hasEncrypted = tier.valueTier === 'hub-key'
        ? payload[`encrypted_${field.name}`] !== undefined || payload.encryptedFieldValues?.[field.name] !== undefined
        : tier.valueTier === 'mls-group'
          ? payload.piiFieldValues?.[field.name] !== undefined
          : true // hpke-envelope handled by file upload pipeline

      if (hasPlaintext && !hasEncrypted) {
        violations.push(
          `Field "${field.name}" requires ${tier.valueTier} encryption but received plaintext only`
        )
      }
    }

    return { valid: violations.length === 0, violations }
  }

  /**
   * Encrypt all hub-key metadata fields for a template-seeded entity type.
   * Used by TemplateLoaderService when applying templates to new hubs.
   */
  encryptTemplateEntityType(
    template: TemplateEntityType,
    hubKey: Uint8Array,
    recordId: string,
    language: string,
    labels: Record<string, Record<string, string>>
  ): EncryptedEntityTypeRow {
    const resolveLabel = (key: string): string =>
      labels[language]?.[key] ?? labels['en']?.[key] ?? key

    return {
      id: recordId,
      encryptedLabel: this.encryptMetadata(
        resolveLabel(template.label), hubKey, recordId, 'encrypted_label'
      ),
      encryptedLabelPlural: this.encryptMetadata(
        resolveLabel(template.labelPlural), hubKey, recordId, 'encrypted_label_plural'
      ),
      encryptedDescription: template.description
        ? this.encryptMetadata(
            resolveLabel(template.description), hubKey, recordId, 'encrypted_description'
          )
        : null,
      encryptedIcon: template.icon
        ? this.encryptMetadata(template.icon, hubKey, recordId, 'encrypted_icon')
        : null,
      encryptedColor: template.color
        ? this.encryptMetadata(template.color, hubKey, recordId, 'encrypted_color')
        : null,
      // ... remaining plaintext config fields pass through
    }
  }
}
```

### 3.5 React Query Integration: `useEntityCrypto` Hook

A React hook that wires the engine into the component tree, providing access to the current hub's crypto context.

```typescript
// src/client/lib/hooks/use-entity-crypto.ts

import { useMemo } from 'react'
import { useConfig } from '@/lib/config'
import { useMlsConversation } from '@/lib/mls/conversation-hooks'
import { useEntityTypeFields } from '@/lib/queries/entity-type-fields'
import {
  decryptEntityFieldValues,
  encryptEntityFields,
  decryptEntityTypeMetadata,
  encryptEntityTypeMetadata,
} from '@/lib/entity-crypto-engine'

/**
 * Provides entity crypto operations bound to the current hub context.
 *
 * Components call this hook instead of manually wiring up hubId, MLS
 * conversations, and field definitions. The hook resolves all crypto
 * context from the React tree.
 */
export function useEntityCrypto(entityTypeId: string) {
  const { currentHubId } = useConfig()
  const mlsConv = useMlsConversation(currentHubId)
  const { data: fields } = useEntityTypeFields(currentHubId, entityTypeId)

  return useMemo(() => ({
    /**
     * Decrypt a raw entity instance's field values.
     */
    decryptInstance: (instance: EntityInstanceRaw) =>
      decryptEntityFieldValues(
        instance.encryptedFieldValues,
        instance.piiFieldValues,
        fields ?? [],
        currentHubId,
        instance.id,
        mlsConv ?? undefined
      ),

    /**
     * Encrypt field values for a create/update mutation.
     * Caller must provide the recordId (pre-generated UUID for creates).
     */
    encryptFields: (values: Record<string, unknown>, recordId: string) =>
      encryptEntityFields(values, fields ?? [], currentHubId, recordId, mlsConv ?? undefined),

    /**
     * Encrypt entity type metadata (labels, descriptions, etc.).
     */
    encryptMetadata: (data: MetadataInput, recordId: string) =>
      encryptEntityTypeMetadata(data, currentHubId, recordId),

    /** Current hub ID */
    hubId: currentHubId,

    /** Whether the crypto context is fully loaded */
    ready: !!fields && (fields.some(f => f.isPii) ? !!mlsConv : true),
  }), [currentHubId, mlsConv, fields])
}
```

---

## 4. Migration: Existing Entities onto the Engine

### 4.1 Migration Strategy

Existing hardcoded entities (roles, shifts, teams, tags, report types, contacts, etc.) are migrated onto the engine in two phases:

**Single phase — Register as entity types:**
Since this spec depends on the entity type registry (Part 1) already existing, there is no need for a temporary static-field-map phase. Existing entities are registered as system entity types (with `isSystem: true`) in the registry. Their field definitions come from the registry at runtime, and the engine's encrypt/decrypt utilities operate on those definitions.

The registration is a one-time migration per entity domain. Once registered, the domain's bespoke decrypt/encrypt code is deleted and replaced by engine calls.

### 4.2 Entities to Migrate

| Current Entity | Current Table | Category | Phase |
|---|---|---|---|
| Roles | `roles` | `config` | B (after registry) |
| Shifts | `shifts` | `config` | B |
| Teams | `teams` | `config` | B |
| Tags | `tags` | `config` | B |
| Report Types | `report_types` | `case` | B (subsumed by entity types per Part 1) |
| Custom Fields | `custom_field_definitions` | `config` | B (subsumed by `entity_type_fields` per Part 4) |
| Contacts | `contacts` | `contact` | B (last — complex E2EE tiers) |
| Notes | `note_envelopes` | `content` | B (MLS groupwise per Tier 6) |
| Conversations | `conversations` | `content` | B |
| Call Records | `call_records` | `content` | B |
| Hub Settings | `hubs` | `config` | B |

### 4.3 What Does NOT Migrate

- **Server-secret fields** (provider configs, IdP tokens) stay on `CryptoService.serverEncrypt()`. They are not entity types — they are server infrastructure config.
- **Auth/session data** (JWT tokens, session tokens, WebAuthn credentials) are not entity data.
- **MLS protocol state** (key packages, epoch commits) is infrastructure, not content.

---

## 5. File Attachment Encryption

### 5.1 Attorney-Client Privilege Model

File attachments are the most sensitive data in the system. In many use cases (legal aid, immigration defense, DV crisis), uploaded documents are subject to attorney-client privilege. Only named recipients should be able to decrypt file contents and metadata.

The engine treats file fields as **T4 (HPKE Envelope)** unconditionally:

1. **File body encryption:** A random per-file AES-256-GCM key encrypts the file body. This key is HPKE-sealed per recipient under `LABEL_FILE_KEY` with AAD binding to the file ID.
2. **File metadata encryption:** Filename, MIME type, size are HPKE-sealed per recipient under `LABEL_FILE_METADATA`.
3. **Items-key indirection:** The per-file key is additionally wrapped under the user's `items_key` for efficient key rotation. When primitives rotate (e.g., ECIES→HPKE), only the `items_key` wrapping changes; file bodies stay byte-identical.
4. **Entity field value:** The entity field stores a `fileId` reference (plaintext). The actual file crypto is handled by the existing `file-crypto.ts` pipeline, not by the entity field engine.

### 5.2 Engine Integration

When the engine encounters a `fieldType: 'file'` field:
- **On encrypt:** The engine does NOT encrypt the field value itself (it's a fileId reference). File encryption happens at upload time via `file-crypto.ts`. The engine passes the fileId through.
- **On decrypt:** Same — the fileId is passed through. The file body is decrypted on demand when the user opens/downloads via the existing file preview pipeline.
- **Tier enforcement:** The server-side engine validates that any file field references a `file_records` row with valid HPKE envelopes. A file without envelopes is rejected.

### 5.3 HPKE Migration Note

File crypto currently uses legacy ECIES (`xchacha20poly1305` + `secp256k1` ECDH). This is tracked in the HPKE migration plan as Slice 5. When Slice 5 ships, the file crypto pipeline switches to HPKE. The entity crypto engine is agnostic to this — it delegates to `file-crypto.ts` regardless of which primitive that module uses internally.

---

## 6. Relationship and Timeline Encryption

### 6.1 Relationship Type Metadata (T2 — Hub-Key)

Relationship type labels, role labels, and join field definitions are hub-key encrypted. The engine's `decryptEntityTypeMetadata` pattern applies identically:

```typescript
export async function decryptRelationshipTypeMetadata(
  raw: RelationshipTypeRaw,
  hubId: string
): Promise<RelationshipType> {
  return {
    ...raw,
    label: await decryptHubField(raw.encryptedLabel, hubId, raw.id, 'encrypted_label'),
    reverseLabel: await decryptHubField(raw.encryptedReverseLabel, hubId, raw.id, 'encrypted_reverse_label'),
    sourceLabel: await decryptHubField(raw.encryptedSourceLabel, hubId, raw.id, 'encrypted_source_label'),
    targetLabel: await decryptHubField(raw.encryptedTargetLabel, hubId, raw.id, 'encrypted_target_label'),
    roles: raw.encryptedRoles
      ? JSON.parse(await decryptHubField(raw.encryptedRoles, hubId, raw.id, 'encrypted_roles'))
      : undefined,
    joinFields: raw.encryptedJoinFields
      ? JSON.parse(await decryptHubField(raw.encryptedJoinFields, hubId, raw.id, 'encrypted_join_fields'))
      : undefined,
  }
}
```

### 6.2 Relationship Instance Payloads (T3 — MLS Group)

Relationship payloads (notes, join field values, role assignment) are MLS group encrypted. The engine handles this via the same `mlsConversation.encrypt()`/`decrypt()` path used for PII field values.

### 6.3 Timeline Inline Content (T3 — MLS Group)

Timeline interactions (comments, assessments, referrals) use MLS group encryption for inline content. Linked interactions (notes, calls, messages, file uploads) are plaintext pointers to their source records — the content encryption is handled by the source record's own encryption tier.

---

## 7. Blind Index Integration

### 7.1 Automatic Computation

When the engine encrypts a field value and `resolveFieldTier()` returns `needsBlindIndex: true`, the engine **also** computes the blind index hash and includes it in the mutation payload. The caller never explicitly requests blind index computation — it happens as a side effect of encryption.

### 7.2 Batch Optimization

For bulk operations (template seeding, import, migration backfill), the engine batches blind index computations per field name to amortize HKDF key derivation cost (~40% reduction per the Part 6 spec).

### 7.3 Hub Key Rotation

When the hub key rotates (member departure), all blind indexes become invalid. The engine provides a `reindexEntityInstances()` utility that:
1. Fetches all instances for an entity type
2. Decrypts field values with the old hub key (still cached until rotation completes)
3. Re-encrypts with the new hub key
4. Recomputes all blind indexes with the new hub-derived HKDF keys
5. Batch-updates the server

This is a client-driven operation triggered by the admin who initiates the key rotation.

---

## 8. ENCRYPTED_QUERY_KEYS Exhaustiveness

### 8.1 Existing Pattern

`src/client/lib/query-client.ts` classifies every query key domain as either `ENCRYPTED_QUERY_KEYS` or `PLAINTEXT_QUERY_KEYS`. The `MissingDomains` type check produces a compile-time error if a new domain is added to `queryKeys` without being classified. Encrypted domains are cleared on lock and invalidated on unlock.

### 8.2 Engine Impact

The engine introduces a new query key domain for generic entity instances:

```typescript
entityInstances: {
  all: ['entityInstances'] as const,
  list: (entityTypeId: string) => ['entityInstances', 'list', entityTypeId] as const,
  detail: (id: string) => ['entityInstances', 'detail', id] as const,
},
```

This domain is classified as `ENCRYPTED_QUERY_KEYS` because entity instance field values are always encrypted (T2/T3/T4).

Entity type metadata queries are already classified under `settings` (which is in `ENCRYPTED_QUERY_KEYS`).

---

## 9. Crypto Label Additions

New domain separation constants for the engine:

```typescript
// src/shared/crypto-labels.ts

/** Entity instance field value (hub-key encrypted, non-PII) */
export const LABEL_ENTITY_FIELD_VALUE = 'llamenos:entity-field-value:v1' as CryptoLabel

/** Entity instance PII field value (MLS group encrypted) */
export const LABEL_ENTITY_PII_VALUE = 'llamenos:entity-pii-value:v1' as CryptoLabel

/** Relationship instance payload (MLS group encrypted) */
export const LABEL_RELATIONSHIP_PAYLOAD = 'llamenos:relationship-payload:v1' as CryptoLabel

/** Timeline inline content (MLS group encrypted) */
export const LABEL_INTERACTION_CONTENT = 'llamenos:interaction-content:v1' as CryptoLabel
```

These are enrolled in `LABEL_REGISTRY` with wire-format indices for the HPKE envelope `labelId` byte.

---

## 10. Error Handling

### 10.1 Missing Hub Key

If the hub key is not loaded (user hasn't unlocked, or key cache expired):
- **Decrypt:** Returns `'[encrypted]'` placeholder strings (existing pattern). Components render the placeholder; user sees a prompt to unlock.
- **Encrypt:** Throws `HubKeyNotAvailableError`. The mutation is rejected before the API call. Components should check `useEntityCrypto().ready` before enabling save buttons.

### 10.2 Missing MLS Conversation

If MLS is not bootstrapped for the hub (pre-Tier-6 hub):
- **PII fields:** Throws `MlsNotAvailableError` with a user-facing message: "MLS encryption required for this field. Contact your admin."
- **Non-PII fields:** Unaffected (hub-key encrypted).
- **Admin action:** The hub admin must bootstrap MLS before PII fields can be used. The entity type admin UI should disable `isPii` toggle on field definitions until MLS is bootstrapped.

### 10.3 Tamper Detection

`HubFieldTamperError` is thrown if a hub-key ciphertext fails AES-GCM authentication. This indicates either:
- Data corruption
- Tampered ciphertext (active attacker)
- Wrong hub key (key rotation race condition)

The engine surfaces this error to the component layer with the field name and record ID for debugging. It does NOT fall back to plaintext.

### 10.4 Tier Enforcement Violations

The server-side engine's `validateEncryptionCompleteness()` rejects mutations that provide plaintext for non-T0 fields without a corresponding encrypted value. This is defense-in-depth — a well-behaved client always encrypts, but a compromised or buggy client cannot silently store plaintext.

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Test File | Coverage |
|---|---|
| `tier-resolution.test.ts` | Every field type × isPii × indexable combination maps to correct tier |
| `entity-crypto-engine.test.ts` (client) | Encrypt/decrypt round-trip for hub-key fields, MLS fields, file field passthrough |
| `entity-crypto-engine.test.ts` (server) | Template seeding encryption, server-secret encryption, tier enforcement validation |
| `blind-index-integration.test.ts` | Blind index computed alongside encryption, batch optimization |

### 11.2 API Integration Tests

| Test File | Coverage |
|---|---|
| `entity-instances.spec.ts` | Create instance with mixed-tier fields, verify server stores ciphertext, verify tier enforcement rejects plaintext |
| `entity-type-crud.spec.ts` | Create/update entity type with encrypted metadata, verify decrypt round-trip |
| `template-seeding.spec.ts` | Apply template, verify all labels are hub-key encrypted server-side |

### 11.3 UI E2E Tests

| Test File | Coverage |
|---|---|
| `entity-form.spec.ts` | Create entity instance via form, verify encrypted values in DB, verify decrypted display |
| `entity-type-admin.spec.ts` | Admin creates entity type, verify metadata labels decrypt correctly |
| `file-attachment.spec.ts` | Upload file to entity, verify HPKE envelopes, verify only named recipients can download |

---

## 12. Files to Create / Modify

### New Files

| File | Description |
|---|---|
| `src/shared/lib/tier-resolution.ts` | Shared tier routing logic — single source of truth |
| `src/client/lib/entity-crypto-engine.ts` | Client-side encrypt/decrypt utilities |
| `src/server/lib/entity-crypto-engine.ts` | Server-side encrypt/validate/seed utilities |
| `src/client/lib/hooks/use-entity-crypto.ts` | React hook for component-level crypto context |
| `src/shared/lib/tier-resolution.test.ts` | Unit tests for tier resolution |
| `src/client/lib/entity-crypto-engine.test.ts` | Client engine unit tests |
| `src/server/lib/entity-crypto-engine.test.ts` | Server engine unit tests |

### Modified Files

| File | Change |
|---|---|
| `src/shared/crypto-labels.ts` | Add `LABEL_ENTITY_FIELD_VALUE`, `LABEL_ENTITY_PII_VALUE`, `LABEL_RELATIONSHIP_PAYLOAD`, `LABEL_INTERACTION_CONTENT` |
| `src/client/lib/queries/entity-types.ts` | Replace manual decrypt with `decryptEntityTypeMetadata()` |
| `src/client/lib/queries/relationships.ts` | Replace manual decrypt with `decryptRelationshipTypeMetadata()` |
| `src/client/lib/queries/case-interactions.ts` | Use engine for MLS decrypt |
| `src/client/lib/queries/keys.ts` | Add `entityInstances` query key domain |
| `src/client/lib/query-client.ts` | Classify `entityInstances` in `ENCRYPTED_QUERY_KEYS` |
| `src/server/services/template-loader.ts` | Use `ServerEntityCryptoEngine.encryptTemplateEntityType()` |
| `src/server/services/entity-types.ts` | Use `ServerEntityCryptoEngine.validateEncryptionCompleteness()` |

### Files Modified During Migration (Phase B)

| File | Change |
|---|---|
| `src/client/lib/queries/roles.ts` | Replace manual decrypt-on-fetch with engine |
| `src/client/lib/queries/shifts.ts` | Same |
| `src/client/lib/queries/teams.ts` | Same |
| `src/client/lib/queries/tags.ts` | Same |
| `src/client/lib/queries/reports.ts` | Same |
| `src/client/lib/queries/settings.ts` | Same |
| `src/client/lib/queries/notes.ts` | Same |
| `src/client/lib/queries/contacts.ts` | Same (most complex — multi-tier) |
| `src/client/lib/queries/conversations.ts` | Same |
| `src/client/lib/queries/blasts.ts` | Same |
| `src/client/lib/queries/hubs.ts` | Same |
| `src/client/components/admin-sections/hub-roles-section.tsx` | Replace manual encrypt-before-mutation |
| `src/client/components/admin-sections/custom-fields-section.tsx` | Same |
| All mutation components that call `encryptHubField` manually | Same |

---

## 13. Dependencies

| Dependency | Status | Required For |
|---|---|---|
| Entity Type Registry (Part 1) | Spec complete, not implemented | Runtime field definitions |
| Custom Field Schema Engine (Part 4) | Spec complete, not implemented | Field-level `isPii`, `indexable`, `accessLevel` |
| MLS Group Encryption (Tier 6) | Implemented (PR #2 merged) | T3 encrypt/decrypt for PII fields |
| HPKE Primitives (Tier 1) | Implemented | T4 envelope encrypt/decrypt for files |
| Blind Index Search (Part 6) | Spec complete, not implemented | T5 blind index computation |
| Hub-Key Infrastructure | Implemented | T2 encrypt/decrypt |
| File Crypto Pipeline | Implemented (ECIES, HPKE Slice 5 pending) | T4 file body encryption |

---

## 14. Open Questions

1. **Should the engine handle the ECIES→HPKE migration transparently?** When existing entities are migrated onto the engine, some may still have ECIES-wrapped envelopes. Should the engine detect the envelope version and call the appropriate open primitive, or should all data be re-encrypted to HPKE before migration?
   - **Recommendation:** The engine should handle both formats during a transition period (detect `v: 3` for HPKE vs legacy for ECIES). Re-encryption is a separate migration pass.

2. **Should `resolveFieldTier` support custom tier overrides?** An admin might want to mark a specific non-PII field as MLS-encrypted for extra protection. Should the field definition support an explicit `encryptionTier` override?
   - **Recommendation:** Not for v1. The tier is determined by the field's semantic properties (`isPii`, `fieldType`). An explicit override adds complexity and audit surface. Revisit if real use cases emerge.

3. **Should the engine enforce that file fields can ONLY reference files with valid envelopes?** Or is it acceptable for the engine to pass through fileIds and let the file download pipeline handle access control?
   - **Recommendation:** Enforce at the server-side engine. A file field value referencing an unencrypted file is a security violation. The `validateEncryptionCompleteness` check should verify envelope existence for file fields.

4. **How should the engine handle field definition changes?** If an admin changes a field from `isPii: false` to `isPii: true`, existing values are hub-key encrypted but should now be MLS encrypted. Should the engine trigger a re-encryption migration?
   - **Recommendation:** Yes, as a client-driven background job (similar to blind index backfill). The admin triggers "Re-encrypt field values" from the entity type admin UI. The engine fetches all instances, decrypts with hub key, re-encrypts with MLS, and batch-updates.

5. **Rate limiting for bulk decrypt operations:** The existing decrypt rate limiter (100 ops/sec burst, 1000 ops/min sustained) may be insufficient for entity types with many fields. Should the engine implement its own batching/throttling?
   - **Recommendation:** The engine should batch decrypt operations per record (one `Promise.all` per instance, not per field). This naturally stays within rate limits for typical entity types (5-15 fields). For entity types with 50+ fields, the engine should chunk into batches of 20 fields with 10ms delays between chunks.

---

*End of spec. Ready for review.*
