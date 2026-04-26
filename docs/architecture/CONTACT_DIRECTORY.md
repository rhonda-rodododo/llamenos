# Contact Directory Architecture

The Contact Directory is a hub-scoped contact management system with end-to-end encryption, permission-based access control, team-scoped workflows, and auto-linking to calls and conversations.

## Data Model

### contacts

The primary table. All PII is envelope-encrypted; the server stores only ciphertext, HMAC hashes, and plaintext metadata used for filtering.

| Column | Type | Encryption | Purpose |
|--------|------|------------|---------|
| `id` | text PK | -- | UUID |
| `hub_id` | text | -- | Hub tenancy scope |
| `contact_type` | text | -- | Plaintext, queryable (e.g. `caller`, `support`, `organization`) |
| `risk_level` | text | -- | Plaintext, queryable (`low`, `medium`, `high`, `critical`) |
| `tags` | jsonb string[] | -- | Plaintext tag IDs for GIN-indexed filtering |
| `identifier_hash` | text | HMAC | `HMAC_PHONE_PREFIX` hash of phone number for dedup/auto-link |
| `encrypted_display_name` | ciphertext | Tier 1 ECIES | Envelope-encrypted for `contacts:envelope-summary` recipients |
| `display_name_envelopes` | jsonb | -- | `RecipientEnvelope[]` keyed by pubkey |
| `encrypted_notes` | ciphertext | Tier 1 ECIES | Free-text notes, same recipient set as display name |
| `notes_envelopes` | jsonb | -- | `RecipientEnvelope[]` |
| `encrypted_full_name` | ciphertext | Tier 2 ECIES | Legal name, for `contacts:envelope-full` recipients only |
| `full_name_envelopes` | jsonb | -- | `RecipientEnvelope[]` |
| `encrypted_phone` | ciphertext | Tier 2 ECIES | Phone number, for `contacts:envelope-full` recipients only |
| `phone_envelopes` | jsonb | -- | `RecipientEnvelope[]` |
| `encrypted_pii` | ciphertext | Tier 2 ECIES | Blob for remaining PII (email, address, DOB, channels) |
| `pii_envelopes` | jsonb | -- | `RecipientEnvelope[]` |
| `assigned_to` | text | -- | Pubkey of assigned case manager |
| `merged_into` | text | -- | ID of contact this was merged into (soft-delete) |
| `created_by` | text | -- | Pubkey of creator |
| `created_at` | timestamp | -- | |
| `updated_at` | timestamp | -- | |
| `last_interaction_at` | timestamp | -- | Updated on call/conversation link |
| `deleted_at` | timestamp | -- | Soft-delete marker |

**Indexes**: `hub_id`, `(hub_id, identifier_hash)`, `merged_into`.

### contact_relationships

Fully E2EE relationship records. The server cannot see which contacts are linked or how.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text PK | UUID |
| `hub_id` | text | Hub scope |
| `encrypted_payload` | ciphertext | E2EE blob containing both contact IDs, relationship type, and notes |
| `payload_envelopes` | jsonb | `RecipientEnvelope[]` for `contacts:envelope-full` recipients |
| `created_by` | text | Pubkey |
| `created_at` | timestamp | |

### contact_call_links / contact_conversation_links

Join tables linking contacts to calls and conversations. These are plaintext references used for timeline assembly and assignment resolution.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text PK | UUID |
| `hub_id` | text | Hub scope |
| `contact_id` | text | FK to contacts |
| `call_id` / `conversation_id` | text | FK to calls / conversations |
| `linked_by` | text | Pubkey or `'auto'` or `'merge'` |
| `created_at` | timestamp | |

### tags

Hub-scoped tags with hub-key encrypted labels. The `name` field is a plaintext slug used for deduplication; the `encrypted_label` is the human-readable display name encrypted with the hub key (Tier 2 symmetric).

| Column | Type | Encryption | Purpose |
|--------|------|------------|---------|
| `id` | text PK | -- | UUID |
| `hub_id` | text | -- | Hub scope |
| `name` | text | -- | Plaintext slug (unique per hub) |
| `encrypted_label` | ciphertext | Hub-key AES-256-GCM | Display label |
| `color` | text | -- | Hex color code |
| `encrypted_category` | ciphertext | Hub-key AES-256-GCM | Optional grouping |
| `created_by` | text | -- | Pubkey |

### teams / team_members / contact_team_assignments

Teams group users and contacts together for scoped access.

| Table | Columns | Purpose |
|-------|---------|---------|
| `teams` | `id`, `hub_id`, `encrypted_name` (hub-key), `encrypted_description` (hub-key), `created_by`, timestamps | Team definition |
| `team_members` | `team_id`, `user_pubkey`, `added_by`, `created_at` | User membership (composite PK) |
| `contact_team_assignments` | `id`, `contact_id`, `team_id`, `hub_id`, `assigned_by`, `created_at` | Contact-to-team assignment (unique on contact+team) |

### contact_intakes

Intake submissions are E2EE records submitted by volunteers during calls, reviewed by case managers via triage.

| Column | Type | Encryption | Purpose |
|--------|------|------------|---------|
| `id` | text PK | -- | UUID |
| `hub_id` | text | -- | Hub scope |
| `contact_id` | text | -- | Optional link to existing contact |
| `call_id` | text | -- | Optional link to originating call |
| `encrypted_payload` | ciphertext | ECIES | E2EE intake form data |
| `payload_envelopes` | jsonb | -- | `RecipientEnvelope[]` |
| `status` | text | -- | `pending` / `reviewed` / `merged` / `dismissed` |
| `reviewed_by` | text | -- | Pubkey of reviewer |
| `submitted_by` | text | -- | Pubkey of submitter |

## Encryption Architecture

Contact encryption uses two tiers mapped to two permission levels, plus HMAC hashing for phone-based lookups.

```
                        ┌─────────────────────────────────────────┐
                        │            Client Browser               │
                        │                                         │
                        │  ┌─────────────────────────────────┐    │
                        │  │  Tier 1: Summary Envelope       │    │
                        │  │  (LABEL_CONTACT_SUMMARY)        │    │
                        │  │  ────────────────────────        │    │
                        │  │  display name, notes             │    │
                        │  │  ECIES-wrapped for each user     │    │
                        │  │  with contacts:envelope-summary  │    │
                        │  └─────────────────────────────────┘    │
                        │                                         │
                        │  ┌─────────────────────────────────┐    │
                        │  │  Tier 2: PII Envelope           │    │
                        │  │  (LABEL_CONTACT_PII)            │    │
                        │  │  ────────────────────────        │    │
                        │  │  full name, phone, email, etc.   │    │
                        │  │  ECIES-wrapped for each user     │    │
                        │  │  with contacts:envelope-full     │    │
                        │  └─────────────────────────────────┘    │
                        │                                         │
                        │  ┌─────────────────────────────────┐    │
                        │  │  HMAC Phone Hash                │    │
                        │  │  (HMAC_PHONE_PREFIX)            │    │
                        │  │  ────────────────────────        │    │
                        │  │  Server-side HMAC of phone       │    │
                        │  │  for dedup and auto-linking      │    │
                        │  └─────────────────────────────────┘    │
                        └─────────────────────────────────────────┘
                                          │
                                          ▼
                        ┌─────────────────────────────────────────┐
                        │            Server / Database             │
                        │                                         │
                        │  Stores only ciphertext + envelopes     │
                        │  Cannot read any PII                    │
                        │  HMAC hash enables phone-based lookup   │
                        │  without revealing the number           │
                        └─────────────────────────────────────────┘
```

### Envelope recipients

When a contact is created or updated, the client fetches the current recipient lists from `GET /api/contacts/recipients`, which returns two pubkey arrays:

- `summaryPubkeys` -- all active users with `contacts:envelope-summary`
- `piiPubkeys` -- all active users with `contacts:envelope-full`

The client encrypts each field using ECIES and wraps the symmetric key for each recipient in the corresponding list. The server stores the resulting `RecipientEnvelope[]` alongside each ciphertext field.

### Relationship encryption

Contact relationships (`contact_relationships`) are fully E2EE. The encrypted payload contains both contact IDs, the relationship type, and any notes. The server cannot determine which contacts are linked. Only users with `contacts:envelope-full` receive envelopes.

### Tag and team encryption

Tags and teams use Tier 2 hub-key encryption (symmetric XChaCha20), not ECIES envelopes. The `encrypted_label` on tags and `encrypted_name`/`encrypted_description` on teams are decrypted client-side using the hub shared key. This is cheaper than per-user envelopes and appropriate because these are organizational metadata, not PII.

## Auto-Linking

Incoming calls and messages are matched to existing contacts via HMAC-hashed phone number lookup.

```
  Incoming call/message
         │
         ▼
  ┌──────────────────────┐
  │ HMAC(phone, prefix)  │   Server computes HMAC of caller phone
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │ SELECT FROM contacts │   Query: identifier_hash = computed HMAC
  │ WHERE identifier_hash│          AND hub_id = current hub
  │       = ?            │          AND deleted_at IS NULL
  └──────────┬───────────┘
             │
        ┌────┴────┐
        │ Found?  │
        └────┬────┘
         yes │         no
             ▼          ▼
  ┌────────────────┐  (no link created)
  │ INSERT INTO    │
  │ contact_call_  │
  │ links          │
  │ linked_by=auto │
  └────────────────┘
             │
             ▼
  ┌────────────────────────────┐
  │ UPDATE contacts            │
  │ SET last_interaction_at    │
  │     = NOW()                │
  └────────────────────────────┘
             │
             ▼
  ┌────────────────────────────┐
  │ Auto-assign to handler's   │
  │ teams (if linked_by is     │
  │ not 'auto')                │
  └────────────────────────────┘
```

The `findByIdentifierHash()` method on `ContactService` performs the lookup. The `linkCall()` and `linkConversation()` methods create the association, update `last_interaction_at`, and trigger team auto-assignment when the linker is a real user (not system-generated).

### Team auto-assignment

When a user (not `'auto'`) links a call or conversation to a contact, `TeamsService.autoAssignForUser()` is called. It looks up all teams the linking user belongs to and creates `contact_team_assignments` entries for each, using `ON CONFLICT DO NOTHING` to avoid duplicates.

## Intake Workflows

Intakes are how new contact information enters the system from volunteers during calls.

### Flow

```
  Volunteer on call
         │
         ▼
  ┌──────────────────────────┐
  │ POST /api/intakes        │
  │ {                        │
  │   callId,                │
  │   encryptedPayload,      │   E2EE form data (name, phone, notes)
  │   payloadEnvelopes       │
  │ }                        │
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────┐
  │ status = 'pending'       │   Stored as E2EE intake record
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────┐
  │ Case Manager triage      │   Users with contacts:triage permission
  │ GET /api/intakes         │   see all pending intakes
  └──────────┬───────────────┘
             │
     ┌───────┼───────┐
     ▼       ▼       ▼
  reviewed  merged  dismissed
     │       │
     │       ▼
     │  ┌────────────────────────────┐
     │  │ Create or update contact   │
     │  │ from decrypted intake data │
     │  └────────────────────────────┘
     ▼
  (no contact action,
   data noted for records)
```

### Permission gating

- Any user with `notes:create` can submit an intake
- Only users with `contacts:triage` can see all intakes and change status
- Non-triage users see only their own submissions

### Create from call

The `POST /api/contacts/from-call/{callId}` endpoint combines contact creation and call linking in one step. The volunteer provides encrypted contact data; the server creates the contact and immediately links it to the specified call.

## Bulk Operations

### Import

`POST /api/contacts/import` accepts up to 500 contacts per batch. Each contact in the array must include pre-encrypted fields and envelopes.

**Requirements**:
- Permissions: `contacts:create` + `contacts:envelope-full`
- Deduplication: If `identifierHash` is provided, the server checks for existing contacts with the same hash and skips duplicates
- Response: `{ created: number, errors: Array<{ index: number, error: string }> }`

**Client-side flow**:
1. Parse CSV/JSON input
2. For each contact, encrypt fields using the recipient pubkey lists from `GET /api/contacts/recipients`
3. Compute `identifierHash` via `POST /api/contacts/hash-phone` (if phone is available)
4. POST the batch to `/api/contacts/import`

### Export

Export is client-side decryption of the contact list:
1. `GET /api/contacts` returns all accessible contacts (ciphertext)
2. Client decrypts each field using the user's private key
3. Client serializes to CSV/JSON for download

No server-side export endpoint is needed because the server cannot decrypt the data.

### Bulk update

`PATCH /api/contacts/bulk` updates tags and risk level across multiple contacts in one call.

- Permissions: `contacts:update-own` (minimum) -- scope enforcement applies
- Supports `addTags`, `removeTags`, and `riskLevel` in a single request
- Contacts outside the user's scope are silently skipped
- Response: `{ updated: number, skipped: number }`

### Bulk delete

`DELETE /api/contacts/bulk` soft-deletes multiple contacts.

- Permissions: `contacts:delete` + update scope
- Contacts outside scope are skipped
- Response: `{ deleted: number, skipped: number }`

### Merge

`POST /api/contacts/{primaryId}/merge` merges a secondary contact into a primary.

- Permissions: `contacts:update-all` + `contacts:envelope-full` + `contacts:delete`
- Re-links all calls and conversations from secondary to primary
- Merges tag arrays (union, deduplicated)
- Soft-deletes secondary with `merged_into` reference to primary

## PBAC Integration

Contact access is governed by three orthogonal permission dimensions.

### 1. Scope (whose contacts can be accessed)

| Permission | Scope | Effect |
|------------|-------|--------|
| `contacts:read-own` | own | Contacts created by the user |
| `contacts:read-assigned` | assigned | Contacts assigned to the user (see assignment resolution below) |
| `contacts:read-all` | all | All contacts in the hub |
| `contacts:update-own` | own | Edit own contacts |
| `contacts:update-assigned` | assigned | Edit assigned contacts |
| `contacts:update-all` | all | Edit any contact |

Scopes are hierarchical: `all` subsumes `assigned` subsumes `own`.

### 2. Tier (what data can be decrypted)

| Permission | Tier | Fields accessible |
|------------|------|-------------------|
| `contacts:envelope-summary` | 1 | Display name, notes, tags, risk level |
| `contacts:envelope-full` | 2 | Full name, phone, email, address, PII blob |

Tier permissions control which ECIES envelopes are created for the user. A user without `contacts:envelope-full` never receives PII envelopes, so even if they access the ciphertext, they cannot decrypt it.

### 3. Actions (what operations are allowed)

| Permission | Operation |
|------------|-----------|
| `contacts:create` | Create new contacts and relationships |
| `contacts:update-summary` | Edit summary fields (display name, notes, tags) |
| `contacts:update-pii` | Edit PII fields (full name, phone, address) |
| `contacts:delete` | Soft-delete contacts |
| `contacts:link` | Link/unlink calls and conversations |
| `contacts:triage` | Review and process intake submissions |
| `tags:create` | Create new tags |

### Authorization check composition

A complete authorization check composes all three dimensions. For example, "can this user edit this contact's phone number?" requires:

1. **Scope**: `contacts:update-own` / `update-assigned` / `update-all` (is this contact in scope?)
2. **Tier**: `contacts:envelope-full` (can the user decrypt PII?)
3. **Action**: `contacts:update-pii` (can the user write PII fields?)

### Assignment resolution

The `ContactsAssignmentResolver` determines "assigned" scope through four paths:

1. **Creator**: `contact.created_by = userPubkey`
2. **Direct assignment**: `contact.assigned_to = userPubkey`
3. **Call handling**: User handled a call linked to the contact (join through `contact_call_links` and `call_legs`)
4. **Team membership**: User is a member of a team the contact is assigned to (join through `contact_team_assignments` and `team_members`)

### Default role permissions

| Role | Contact permissions |
|------|-------------------|
| **Super Admin** | `*` (all) |
| **Hub Admin** | `contacts:*` (all contact permissions) |
| **Case Manager** | `contacts:read-assigned`, `contacts:update-assigned`, `contacts:envelope-summary`, `contacts:envelope-full`, `contacts:create`, `contacts:link`, `contacts:triage`, `tags:create` |
| **Volunteer** | `contacts:create`, `contacts:read-own`, `contacts:envelope-summary` |
| **Voicemail Reviewer** | `contacts:read-assigned`, `contacts:envelope-summary` |
| **Reviewer** | No contact permissions |
| **Reporter** | No contact permissions |

## API Endpoints

All endpoints are mounted under `/api/contacts` (OpenAPIHono with `createRoute()`).

| Method | Path | Permission(s) | Purpose |
|--------|------|---------------|---------|
| `GET` | `/` | `contacts:envelope-summary` + read scope | List contacts (filtered) |
| `POST` | `/` | `contacts:create` | Create a contact |
| `GET` | `/recipients` | `contacts:envelope-summary` | Get encryption recipient pubkeys |
| `GET` | `/check-duplicate` | `contacts:envelope-summary` | Check for duplicate by hash or phone |
| `POST` | `/hash-phone` | `contacts:envelope-summary` | Compute HMAC for a phone number |
| `POST` | `/from-call/{callId}` | `contacts:create` | Create contact + auto-link to call |
| `POST` | `/import` | `contacts:create` + `contacts:envelope-full` | Batch import (max 500) |
| `PATCH` | `/bulk` | `contacts:update-own` (min) | Bulk update tags/risk level |
| `DELETE` | `/bulk` | `contacts:delete` | Bulk soft-delete |
| `GET` | `/relationships` | `contacts:envelope-full` | List relationships |
| `POST` | `/relationships` | `contacts:create` | Create a relationship |
| `DELETE` | `/relationships/{id}` | `contacts:delete` | Delete a relationship |
| `GET` | `/{id}` | `contacts:envelope-summary` + read scope | Get single contact |
| `PATCH` | `/{id}` | update scope + action tier | Update a contact |
| `DELETE` | `/{id}` | `contacts:delete` + update scope | Soft-delete a contact |
| `GET` | `/{id}/timeline` | read scope | Get linked calls, conversations, notes |
| `POST` | `/{id}/link` | `contacts:link` + update scope | Link call/conversation |
| `DELETE` | `/{id}/link` | `contacts:link` + update scope | Unlink call/conversation |
| `POST` | `/{id}/notify` | `contacts:envelope-full` + `conversations:send` | Send notification to support contact |
| `POST` | `/{primaryId}/merge` | `contacts:update-all` + `contacts:envelope-full` + `contacts:delete` | Merge secondary into primary |

Intakes are mounted under `/api/intakes`:

| Method | Path | Permission(s) | Purpose |
|--------|------|---------------|---------|
| `POST` | `/` | `notes:create` | Submit intake |
| `GET` | `/` | (filtered by triage) | List intakes |
| `GET` | `/{id}` | (filtered by triage) | Get single intake |
| `PATCH` | `/{id}` | `contacts:triage` | Update intake status |

Teams are mounted under `/api/teams`:

| Method | Path | Permission(s) | Purpose |
|--------|------|---------------|---------|
| `POST` | `/` | (admin) | Create team |
| `GET` | `/` | (authenticated) | List teams with counts |
| `PATCH` | `/{id}` | (admin) | Update team |
| `DELETE` | `/{id}` | (admin) | Delete team (cascades members + assignments) |
| `POST` | `/{id}/members` | (admin) | Add members |
| `DELETE` | `/{id}/members/{pubkey}` | (admin) | Remove member |
| `GET` | `/{id}/members` | (authenticated) | List members |
| `POST` | `/{id}/contacts` | (admin) | Assign contacts to team |
| `DELETE` | `/{id}/contacts/{contactId}` | (admin) | Unassign contact |
| `GET` | `/{id}/contacts` | (authenticated) | List team contacts |

## Key Source Files

| File | Purpose |
|------|---------|
| `src/server/db/schema/contacts.ts` | Contact, relationship, and link table definitions |
| `src/server/db/schema/tags.ts` | Tag table definition |
| `src/server/db/schema/teams.ts` | Team, member, and assignment table definitions |
| `src/server/db/schema/intakes.ts` | Intake table definition |
| `src/server/services/contacts.ts` | ContactService -- CRUD, dedup, auto-linking, relationships |
| `src/server/services/teams.ts` | TeamsService -- team CRUD, membership, contact assignment, auto-assign |
| `src/server/lib/assignment-resolver.ts` | ContactsAssignmentResolver -- scope resolution for "assigned" |
| `src/server/routes/contacts.ts` | Contact API routes (OpenAPIHono) |
| `src/server/routes/contacts-import.ts` | Import and merge routes |
| `src/server/routes/intakes.ts` | Intake API routes |
| `src/shared/schemas/contacts.ts` | Zod schemas for contact API validation |
| `src/shared/permissions.ts` | PBAC permission catalog and resolution logic |
| `src/shared/crypto-labels.ts` | Domain separation constants for contact encryption |
