# File Attachment Encryption Model in Entity Context

**Date:** 2026-04-25
**Status:** Draft — pending review
**Depends on:** Entity Crypto Engine spec (2026-04-25), HPKE Migration Notes (Tier 1, Slice 5)
**Supplements:** Entity Crypto Engine spec §5

---

## 1. Problem

The Entity Crypto Engine spec (Section 5) routes `fieldType: 'file'` to T4 (HPKE Envelope) and delegates to `file-crypto.ts`, but several details are unspecified:

1. **Current file encryption still uses ECIES** — `file-crypto.ts` uses `secp256k1` ECDH + `xchacha20poly1305` for metadata encryption and ECIES key wrapping. HPKE Slice 5 (file body cutover) is pending.
2. **Items-key indirection** — the per-file symmetric key is wrapped under the user's `items_key` for rotation. How does this interact with the entity engine?
3. **Recipient set** — who are the HPKE envelope recipients for files attached to entity instances? All hub members? Only assigned users? Per-entity-type `accessLevel`?
4. **AAD formula** — what AAD binds file ciphertext to the entity instance and field?

## 2. File Encryption Architecture

### 2.1 Three Layers

File encryption has three nested layers:

```
Layer 1: File body
  └─ AES-256-GCM(fileKey, nonce, fileBody, aad=buildFileAad(fileId))

Layer 2: File key wrapping (per-recipient)
  └─ HPKE-seal(recipientPubkey, fileKey, aad=buildAad(LABEL_FILE_KEY, fileId, 'file-key'))
     → one HpkeEnvelope per recipient

Layer 3: Items-key indirection (per-user rotation)
  └─ AES-KW(itemsKeySubkey, fileKey)
     where itemsKeySubkey = HKDF(itemsKey, info='llamenos:items-key-wrap:<fileId>')
```

**Layer 1** is the actual file content encryption. The `fileKey` is a random 32-byte AES-256-GCM key.

**Layer 2** wraps the `fileKey` per recipient using HPKE. This is what makes files T4 — only named recipients can unwrap the key and decrypt the body. Currently this uses ECIES; Slice 5 migrates to HPKE.

**Layer 3** additionally wraps the `fileKey` under the user's `items_key` for efficient key rotation. When primitives change, only the `items_key` wrapping is updated; file bodies are not re-encrypted.

### 2.2 File Metadata Encryption

File metadata (filename, MIME type, file size) is separately encrypted per recipient:

```
HPKE-seal(recipientPubkey, JSON.stringify(metadata),
          aad=buildAad(LABEL_FILE_METADATA, fileId, 'metadata'))
```

This ensures the server cannot learn filenames or types. Recipients decrypt metadata to display file previews.

## 3. Recipient Set for Entity-Attached Files

### 3.1 Problem

When a file is attached to an entity instance field, who should receive HPKE envelopes?

**Option A: All hub members** — simplest, but violates attorney-client privilege. A volunteer shouldn't decrypt a legal document meant for the legal liaison.

**Option B: Per-entity-type `defaultAccessLevel`** — uses the entity type's access control to determine recipients. If `defaultAccessLevel: 'assigned'`, only the assigned user + admins get envelopes.

**Option C: Per-field `accessLevel` + `accessRoles`** — the file field's own access control determines recipients. If `accessLevel: 'custom'` with `accessRoles: ['legal-liaison']`, only users with that role get envelopes.

### 3.2 Decision: Per-Field Access Control (Option C)

The file field's `accessLevel` and `accessRoles` determine the recipient set:

| `accessLevel` | Recipients |
|---|---|
| `all` | All current hub members |
| `admin` | Users with admin role only |
| `assigned` | User assigned to the entity instance + admins |
| `custom` | Users with roles listed in `accessRoles` + admins |

The recipient set is resolved at upload time by the client. The client queries the hub's membership and role assignments to build the pubkey list.

**Key constraint:** Admins are ALWAYS included in the recipient set (they need access for audit, legal hold, and GDPR erasure). The field's `accessLevel` controls non-admin access.

### 3.3 Re-encryption on Access Change

If an admin changes a file field's `accessLevel` (e.g., from `all` to `custom`), existing file envelopes must be re-wrapped for the new recipient set. This is a client-driven operation:

1. Admin triggers "Re-encrypt files" from the entity type admin UI
2. Client fetches all entity instances with file values in the affected field
3. For each file: decrypt file key → re-wrap under new recipient set → upload new envelopes
4. Old envelopes are replaced atomically (transaction)

This is expensive but rare. Access level changes on file fields should be infrequent.

## 4. Entity Crypto Engine Integration

### 4.1 Engine Behavior for File Fields

When the engine encounters `fieldType: 'file'`:

**On encrypt (create/update mutation):**
- The engine does NOT encrypt the file body — that happens at upload time via `file-crypto.ts`
- The engine stores the `fileId` reference as the field value (plaintext reference to `file_records.id`)
- The engine validates that the referenced `fileId` has HPKE envelopes for the correct recipient set (defense-in-depth)

**On decrypt (query fetch):**
- The engine returns the `fileId` reference as-is
- File body decryption happens on demand when the user opens/downloads via the file preview pipeline
- File metadata decryption (filename, type) happens in the file preview component, not the engine

### 4.2 Upload Flow

```
User selects file in entity form
  → Client resolves recipient set from field accessLevel + hub membership
  → Client calls file-crypto.ts encryptFile(file, recipientPubkeys)
  → Client uploads encrypted body to storage (RustFS via /api/uploads)
  → Server returns fileId
  → Client includes fileId in entity instance mutation payload
  → Entity engine stores fileId in encryptedFieldValues (as plaintext reference)
```

### 4.3 Download Flow

```
User clicks file preview in entity form
  → Component fetches file record (includes HPKE envelopes)
  → file-crypto.ts decryptFileKey(envelopes) → fileKey
  → file-crypto.ts decryptFileBody(encryptedBody, fileKey) → plaintext
  → Component renders file preview
```

## 5. HPKE Slice 5 Transition

### 5.1 Current State (ECIES)

`file-crypto.ts` currently uses:
- `secp256k1.getSharedSecret()` for ECDH
- `xchacha20poly1305` for metadata encryption
- `eciesWrapKey` for file key wrapping
- Custom AAD via `buildFileAad(fileId)`

### 5.2 Target State (HPKE)

After Slice 5:
- `hpkeSeal()` / `hpkeOpen()` for file key wrapping
- `hpkeSeal()` for metadata encryption
- AAD via `buildAad(LABEL_FILE_KEY, fileId, 'file-key')` and `buildAad(LABEL_FILE_METADATA, fileId, 'metadata')`
- File body encryption stays AES-256-GCM (unchanged)

### 5.3 Entity Engine Agnosticism

The entity engine is agnostic to whether files use ECIES or HPKE internally. It delegates to `file-crypto.ts` regardless. When Slice 5 ships, the engine requires no changes — only `file-crypto.ts` changes.

## 6. Testing

| Test | Coverage |
|---|---|
| `file-crypto.test.ts` | Encrypt/decrypt round-trip with correct AAD |
| `entity-file-field.spec.ts` | Upload file to entity instance, verify envelopes match field accessLevel |
| `file-access-control.spec.ts` | Verify non-recipient cannot decrypt file; admin always can |
| `file-reencrypt.spec.ts` | Change accessLevel, trigger re-encryption, verify new recipient set |

## 7. Files to Modify

| File | Change |
|---|---|
| `src/client/lib/file-crypto.ts` | (Slice 5) Migrate ECIES → HPKE for key wrap and metadata |
| `src/client/lib/entity-crypto-engine.ts` | Validate file field references have correct envelopes |
| `src/client/components/custom-fields/file-field-input.tsx` | Pass `accessLevel` / `accessRoles` to upload flow for recipient resolution |

---

*End of spec.*
