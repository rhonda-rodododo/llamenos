# MLS Preconditions & Hub Bootstrap for Entity Crypto Engine

**Date:** 2026-04-25
**Status:** Draft — pending review
**Depends on:** Entity Crypto Engine spec (2026-04-25), MLS Tier 6 (PR #2, merged)
**Supplements:** Entity Crypto Engine spec §10.2

---

## 1. Problem

The Entity Crypto Engine routes `isPii: true` fields to T3 (MLS Group encryption). This requires an MLS conversation (`MlsConversation`) to be available for the hub. But:

1. **When is MLS bootstrapped?** Is it mandatory at hub creation, or lazy?
2. **What happens if MLS isn't available?** The engine spec says "throw `MlsNotAvailableError`" (§10.2), but what's the UX flow?
3. **How does the React component tree access the MLS conversation?** The spec references `useMlsConversation(hubId)` but this hook doesn't exist yet.
4. **Pre-MLS hubs** — if a hub was created before MLS was mandatory, how do PII fields work?

## 2. MLS Bootstrap Lifecycle

### 2.1 Hub Creation (Mandatory MLS Bootstrap)

MLS group bootstrap is part of hub creation, not lazy. This is established in the Tier 6 implementation:

```
Admin creates hub
  → Server generates hub key + distributes HPKE envelopes
  → Client calls bootstrapMlsForNewHub(hubId)
    → Generates MLS key packages
    → Creates MLS group with group ID `llamenos:hub:<hubId>`
    → Uploads initial key package to server
    → Submits initial epoch commit
  → Hub is ready
```

**Post-Tier-6, every hub has an MLS group at creation time.** There is no "pre-MLS hub" state for new hubs.

### 2.2 Legacy Hubs (Pre-Tier-6)

Hubs created before Tier 6 shipped do not have MLS groups. These hubs:
- Can use T2 (hub-key) encryption for all fields
- **Cannot use T3 (MLS) encryption** — `isPii: true` fields are blocked
- Cannot create entity types with `isPii: true` fields until MLS is bootstrapped

**Admin action required:** The hub admin must trigger "Enable MLS Encryption" from hub settings. This runs the same bootstrap flow as hub creation.

### 2.3 MLS Availability States

| State | Hub-Key Available | MLS Available | PII Fields | Entity Engine Behavior |
|---|---|---|---|---|
| **Locked** | No | No | Blocked | All decrypt returns `'[encrypted]'` placeholders; mutations rejected |
| **Unlocked, no MLS** | Yes | No | Blocked | T2 fields work; T3 fields throw `MlsNotAvailableError`; entity types with `isPii` fields show admin warning |
| **Unlocked, MLS bootstrapped** | Yes | Yes | Available | Full engine functionality |

## 3. React Hook: `useMlsConversation`

### 3.1 Implementation

```typescript
// src/client/lib/hooks/use-mls-conversation.ts

import { useEffect, useState } from 'react'
import { MlsConversation } from '@/lib/mls/conversation'
import { getMlsGroupState } from '@/lib/mls/mls-api-client'
import { useConfig } from '@/lib/config'

/**
 * Returns the MLS conversation for the current hub, or null if MLS
 * is not bootstrapped / not yet initialized.
 *
 * The conversation is lazily initialized on first access and cached
 * for the hub's lifetime. It automatically catches up to the latest
 * epoch on mount and whenever the epoch changes.
 */
export function useMlsConversation(hubId: string): MlsConversation | null {
  const [conv, setConv] = useState<MlsConversation | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const groupState = await getMlsGroupState(hubId)
        if (!groupState || cancelled) return

        const conversation = await MlsConversation.fromGroupState(
          `llamenos:hub:${hubId}`,
          groupState
        )
        await conversation.catchUp()

        if (!cancelled) setConv(conversation)
      } catch {
        // MLS not bootstrapped for this hub — return null
        if (!cancelled) setConv(null)
      }
    }

    void init()
    return () => { cancelled = true }
  }, [hubId])

  return conv
}
```

### 3.2 Integration with `useEntityCrypto`

The `useEntityCrypto` hook (from the main spec §3.5) uses `useMlsConversation` internally:

```typescript
export function useEntityCrypto(entityTypeId: string) {
  const { currentHubId } = useConfig()
  const mlsConv = useMlsConversation(currentHubId)
  const { data: fields } = useEntityTypeFields(currentHubId, entityTypeId)

  // `ready` is true when hub-key is loaded AND (no PII fields OR MLS is available)
  const hasPiiFields = fields?.some(f => f.isPii) ?? false
  const ready = !!fields && (!hasPiiFields || !!mlsConv)

  return useMemo(() => ({
    decryptInstance: (instance) => decryptEntityFieldValues(
      instance.encryptedFieldValues,
      instance.piiFieldValues,
      fields ?? [],
      currentHubId,
      instance.id,
      mlsConv ?? undefined
    ),
    encryptFields: (values, recordId) => encryptEntityFields(
      values, fields ?? [], currentHubId, recordId, mlsConv ?? undefined
    ),
    ready,
    mlsAvailable: !!mlsConv,
    hubId: currentHubId,
  }), [currentHubId, mlsConv, fields])
}
```

## 4. UX for MLS Unavailable States

### 4.1 Entity Type Admin — Creating Fields

When an admin creates a new field definition and toggles `isPii: true`:

- **MLS bootstrapped:** Toggle works. Field is created with `isPii: true`.
- **MLS NOT bootstrapped:** Toggle is disabled. Tooltip: "MLS encryption must be enabled for this hub before PII fields can be created. Go to Hub Settings → Security → Enable MLS Encryption."

### 4.2 Entity Instance Form — Viewing/Editing

When a user views an entity instance that has PII fields:

- **MLS available:** PII fields render with decrypted values.
- **MLS NOT available:** PII fields render as `[Encrypted — MLS required]`. Non-PII fields still render normally. A banner at the top of the form explains the situation.

### 4.3 Entity Instance Form — Saving

When a user tries to save an entity instance with PII field values:

- **MLS available:** Encrypt and save normally.
- **MLS NOT available:** Save button is disabled for the entire form if any PII field has a value. Non-PII-only instances can be saved. Error message: "Cannot save PII fields without MLS encryption. Contact your hub admin."

## 5. Admin: "Enable MLS Encryption" Flow

For legacy (pre-Tier-6) hubs that need MLS bootstrapped:

```
Admin navigates to Hub Settings → Security
  → "Enable MLS Encryption" button (shown only if MLS not bootstrapped)
  → Click triggers bootstrapMlsForNewHub(hubId)
  → Progress indicator while key packages generate + group creates
  → Success: "MLS encryption enabled. PII fields are now available."
  → Failure: "Failed to enable MLS. Please try again or contact support."
  → Page reloads; useMlsConversation now returns a valid conversation
```

## 6. Testing

| Test | Coverage |
|---|---|
| `use-mls-conversation.test.ts` | Hook returns conversation for bootstrapped hub, null for non-bootstrapped |
| `entity-crypto-engine.test.ts` | PII field encrypt throws when MLS unavailable |
| `entity-crypto-engine.test.ts` | Non-PII fields work when MLS unavailable |
| `entity-type-admin.spec.ts` (E2E) | `isPii` toggle disabled when MLS not bootstrapped |
| `entity-form.spec.ts` (E2E) | PII fields show placeholder when MLS unavailable |

## 7. Files to Create / Modify

### New Files

| File | Description |
|---|---|
| `src/client/lib/hooks/use-mls-conversation.ts` | React hook for MLS conversation access |

### Modified Files

| File | Change |
|---|---|
| `src/client/lib/hooks/use-entity-crypto.ts` | Wire `useMlsConversation` into crypto context |
| `src/client/components/admin-sections/entity-types-section.tsx` | Disable `isPii` toggle when MLS unavailable |
| `src/client/components/hub-settings/security-section.tsx` | Add "Enable MLS Encryption" button for legacy hubs |

---

*End of spec.*
