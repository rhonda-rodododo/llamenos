# H4 — Tier 6 MLS PR #2 Epic Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ECIES + XChaCha20-Poly1305 multi-admin envelope encryption for notes and messages with MLS groupwise encryption via `@wireapp/core-crypto`, eliminating the per-recipient key-wrapping loop entirely.

**Architecture:** Each hub gets a persistent MLS group (group ID = `llamenos:hub:<hubId>`). Hub creation bootstraps the group with the first admin. Notes and messages are encrypted via `cc.encryptMessage()` and decrypted via `cc.decryptMessage()`. Epoch advances on membership change replace hub-key rotation. The server stores Commits and distributes Welcomes; the server never sees plaintext. core-crypto runs inside the existing crypto Web Worker.

**Tech Stack:** `@wireapp/core-crypto@9.3.3` (vendored WASM), Drizzle ORM (Postgres schema), Hono + OpenAPIHono (server routes), React Query (client), `bun:test` + Playwright (testing).

**Epic name:** `h4-mls-pr2`
**Branch convention:** `feat/mls-pr2-slice-N` (e.g., `feat/mls-pr2-slice-1`)

**Brainstorm doc:** `docs/security/H4_MLS_PR2_BRAINSTORM.md`
**Prerequisite human decisions:** See brainstorm §8 (ciphersuite, IDB key derivation, group ID format, epoch retention, WASM loading, Commit ordering).

---

## Dependency graph

```
Slice 1 (DB schema + server routes)
  ↓
Slice 2 (core-crypto bootstrap in crypto-worker)
  ↓
Slice 3 (MlsConversation implementation)
  ↓
Slice 4 (Hub creation bootstrap)
  ↓
Slice 5 (Notes path cutover)
  ↓
Slice 6 (Messages path cutover)
  ↓
Slice 7 (Epoch commits on admin add/remove)
  ↓
Slice 8 (Audit payload variants)
  ↓
Slice 9 (Adversarial + integration tests)
  ↓
Slice 10 (Docs update + ECIES sidecar cleanup)
```

Slices 1-3 are foundational. Slices 5+6 can be parallelized. Slice 8 can
start after Slice 4. Slice 10 depends on everything else.

---

## Slice 1: DB schema + server MLS routes

**Goal:** Server-side infrastructure for MLS state management. After this slice,
clients can upload key packages, and the server can store/retrieve MLS Commits and
Welcome messages.

**Effort:** ~2-3 days, ~400-600 lines

**Branch:** `feat/mls-pr2-slice-1`

### Files

- **Create:** `src/server/db/schema/mls.ts` — Drizzle schema for `mls_hub_state` + `mls_key_packages`
- **Create:** `drizzle/migrations/NNNN_mls_schema.sql` — Generated migration
- **Modify:** `src/server/db/schema/index.ts` — Add `export * from './mls'`
- **Modify:** `src/server/db/schema/settings.ts` — Add `csProfile` column to `hubs` table
- **Create:** `src/shared/schemas/mls.ts` — Zod schemas for MLS API types
- **Modify:** `src/shared/schemas/index.ts` — Add `export * from './mls'`
- **Create:** `src/server/services/mls-service.ts` — `MlsService` class
- **Modify:** `src/server/services/index.ts` — Register `MlsService` in `Services` interface + `createServices`
- **Create:** `src/server/routes/mls.ts` — OpenAPIHono routes for MLS endpoints
- **Modify:** `src/server/app.ts` — Mount MLS routes
- **Create:** `src/server/services/mls-service.test.ts` — Unit tests for MlsService
- **Create:** `tests/api/mls-routes.spec.ts` — API E2E tests for MLS endpoints

### DB schema details

`mls_hub_state` table:
```sql
CREATE TABLE mls_hub_state (
  hub_id       TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  epoch        INTEGER NOT NULL DEFAULT 0,
  group_id     BYTEA NOT NULL,          -- MLS group ID (UTF-8 of 'llamenos:hub:<hubId>')
  commit_data  BYTEA,                   -- Latest TLS-serialized Commit
  group_info   BYTEA,                   -- GroupInfo for external joins
  ratchet_tree BYTEA,                   -- Ratchet tree snapshot
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (hub_id),
  UNIQUE (hub_id, epoch)
);
```

`mls_key_packages` table:
```sql
CREATE TABLE mls_key_packages (
  id           TEXT PRIMARY KEY,        -- crypto.randomUUID()
  user_id      TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  hub_id       TEXT NOT NULL,
  ciphersuite  INTEGER NOT NULL DEFAULT 1,
  key_package  BYTEA NOT NULL,          -- TLS-serialized KeyPackage
  consumed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at  TIMESTAMPTZ
);
CREATE INDEX mls_key_packages_device_hub_idx ON mls_key_packages(device_id, hub_id);
CREATE INDEX mls_key_packages_available_idx ON mls_key_packages(hub_id, consumed) WHERE NOT consumed;
```

`hubs.cs_profile` column:
```sql
ALTER TABLE hubs ADD COLUMN cs_profile TEXT NOT NULL DEFAULT 'standard';
```

### MLS epoch history table

`mls_epoch_commits` table (stores all Commits for catch-up):
```sql
CREATE TABLE mls_epoch_commits (
  id           TEXT PRIMARY KEY,
  hub_id       TEXT NOT NULL,
  epoch        INTEGER NOT NULL,
  commit_data  BYTEA NOT NULL,
  welcome_data BYTEA,                   -- Welcome for newly added members (nullable)
  committer_id TEXT NOT NULL,           -- device ID of the committer
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hub_id, epoch)
);
CREATE INDEX mls_epoch_commits_hub_epoch_idx ON mls_epoch_commits(hub_id, epoch);
```

### Server routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/hubs/:hubId/mls/key-packages` | Upload key packages for a device |
| `GET` | `/api/hubs/:hubId/mls/key-packages/:deviceId` | Fetch available key packages for a device |
| `DELETE` | `/api/hubs/:hubId/mls/key-packages/:id` | Mark a key package as consumed |
| `POST` | `/api/hubs/:hubId/mls/commits` | Submit a Commit (epoch advance) |
| `GET` | `/api/hubs/:hubId/mls/commits` | Fetch Commits since a given epoch (`?since_epoch=N`) |
| `GET` | `/api/hubs/:hubId/mls/state` | Get current group state (epoch, group info) |
| `POST` | `/api/hubs/:hubId/mls/welcome` | Store a Welcome message for a specific device |
| `GET` | `/api/hubs/:hubId/mls/welcome/:deviceId` | Fetch pending Welcome messages for a device |

### Zod schemas (`src/shared/schemas/mls.ts`)

```typescript
import { z } from '@hono/zod-openapi'

export const MlsKeyPackageUploadSchema = z.object({
  deviceId: z.string().min(1),
  keyPackages: z.array(z.string().describe('Base64-encoded TLS-serialized KeyPackage')).min(1).max(100),
  ciphersuite: z.number().int().default(1),
})
export type MlsKeyPackageUpload = z.infer<typeof MlsKeyPackageUploadSchema>

export const MlsCommitSubmitSchema = z.object({
  epoch: z.number().int().min(0),
  commitData: z.string().describe('Base64-encoded TLS-serialized Commit'),
  welcomeData: z.string().optional().describe('Base64-encoded Welcome for newly added members'),
  welcomeRecipientDeviceIds: z.array(z.string()).optional(),
  committerId: z.string().min(1),
})
export type MlsCommitSubmit = z.infer<typeof MlsCommitSubmitSchema>

export const MlsGroupStateSchema = z.object({
  hubId: z.string(),
  epoch: z.number().int(),
  groupId: z.string().describe('Base64-encoded MLS group ID'),
  groupInfo: z.string().optional().describe('Base64-encoded GroupInfo for external joins'),
  csProfile: z.string(),
})
export type MlsGroupState = z.infer<typeof MlsGroupStateSchema>

export const MlsCommitEntrySchema = z.object({
  id: z.string(),
  epoch: z.number().int(),
  commitData: z.string(),
  welcomeData: z.string().optional(),
  committerId: z.string(),
  createdAt: z.string(),
})
export type MlsCommitEntry = z.infer<typeof MlsCommitEntrySchema>

export const MlsWelcomeStoreSchema = z.object({
  recipientDeviceId: z.string().min(1),
  welcomeData: z.string().describe('Base64-encoded TLS-serialized Welcome'),
  epoch: z.number().int().min(0),
})
export type MlsWelcomeStore = z.infer<typeof MlsWelcomeStoreSchema>
```

### MlsService (`src/server/services/mls-service.ts`)

```typescript
export class MlsService {
  constructor(protected readonly db: Database) {}

  async uploadKeyPackages(hubId: string, data: MlsKeyPackageUpload): Promise<void> { /* insert rows */ }
  async consumeKeyPackage(hubId: string, deviceId: string): Promise<{ id: string; keyPackage: Buffer } | null> { /* mark consumed, return */ }
  async getAvailableKeyPackageCount(hubId: string, deviceId: string): Promise<number> { /* count */ }
  async submitCommit(hubId: string, data: MlsCommitSubmit): Promise<void> { /* insert epoch_commits + update hub_state */ }
  async getCommitsSinceEpoch(hubId: string, sinceEpoch: number): Promise<MlsCommitEntry[]> { /* select */ }
  async getGroupState(hubId: string): Promise<MlsGroupState | null> { /* select hub_state */ }
  async initializeGroupState(hubId: string, groupId: Buffer, groupInfo: Buffer): Promise<void> { /* insert */ }
  async storeWelcome(hubId: string, data: MlsWelcomeStore): Promise<void> { /* insert */ }
  async getPendingWelcomes(hubId: string, deviceId: string): Promise<Array<{ welcomeData: string; epoch: number }>> { /* select */ }
}
```

### Steps

- [ ] **Step 1:** Create `src/server/db/schema/mls.ts` with the `mlsHubState`, `mlsKeyPackages`, and `mlsEpochCommits` Drizzle table definitions. Add `csProfile` to `hubs` in `src/server/db/schema/settings.ts`.
- [ ] **Step 2:** Export from `src/server/db/schema/index.ts`.
- [ ] **Step 3:** Run `bun run migrate:generate` to generate the SQL migration file. Verify the generated SQL matches the schema above.
- [ ] **Step 4:** Run `bun run migrate` to apply the migration.
- [ ] **Step 5:** Create `src/shared/schemas/mls.ts` with all Zod schemas. Export from `src/shared/schemas/index.ts`.
- [ ] **Step 6:** Create `src/server/services/mls-service.ts` with the `MlsService` class. Write unit tests in `src/server/services/mls-service.test.ts` covering: upload key packages, consume key package (returns oldest unconsumed), submit commit (happy path + epoch conflict → 409), get commits since epoch, initialize group state.
- [ ] **Step 7:** Register `MlsService` in `src/server/services/index.ts` (`Services` interface + `createServices` factory).
- [ ] **Step 8:** Create `src/server/routes/mls.ts` with OpenAPIHono routes. All routes require `jwtAuth`. Key-package upload validates against `MlsKeyPackageUploadSchema`. Commit submit validates against `MlsCommitSubmitSchema` and returns 409 on epoch conflict.
- [ ] **Step 9:** Mount MLS routes in `src/server/app.ts`.
- [ ] **Step 10:** Write API E2E tests in `tests/api/mls-routes.spec.ts` covering: upload + consume key packages, submit commit + epoch conflict, fetch commits since epoch, welcome store + fetch, group state initialization + retrieval.
- [ ] **Step 11:** Run `bun run typecheck && bun run build`. Fix any type errors.
- [ ] **Step 12:** Run `bun run test:unit` and `bun run test:api` (MLS tests only). Fix failures.
- [ ] **Step 13:** Commit: `feat(sec/tier-6): MLS DB schema + server routes (slice 1)`

### Exit criteria
- All new tables exist in the DB schema
- All 8 server routes respond correctly
- Unit tests for MlsService pass
- API E2E tests for all routes pass
- `bun run typecheck` clean
- `bun run build` succeeds

### Rollback strategy
Revert the migration (drop the 3 new tables, drop the `cs_profile` column). No
data dependencies — these tables are empty until Slice 4 populates them.

---

## Slice 2: core-crypto bootstrap in crypto-worker

**Goal:** Initialize `@wireapp/core-crypto` inside the existing crypto Web Worker,
generate and persist the MLS client identity, and expose the core-crypto context
through the worker's RPC interface.

**Effort:** ~1-2 days, ~300-500 lines

**Branch:** `feat/mls-pr2-slice-2`

### Files

- **Modify:** `src/client/lib/crypto-worker.ts` — Add MLS initialization to the worker
- **Modify:** `src/client/lib/crypto-worker-client.ts` — Add MLS RPC methods to the client
- **Modify:** `src/client/lib/mls/core-crypto-loader.ts` — Enhance to support worker-context initialization
- **Create:** `src/client/lib/mls/mls-worker-init.ts` — MLS client initialization logic (IDB open, `mls_init`, key package generation)
- **Create:** `src/client/lib/mls/mls-worker-init.test.ts` — Unit tests

### core-crypto initialization sequence

1. Worker receives `unlockWithHandles` (existing path)
2. After identity unlock, worker calls `initMlsClient()`:
   - `loadCoreCrypto()` — lazy WASM load
   - `openDatabase('llamenos-mls-<userId>', derivedKey)` — IDB with KEK-derived key
   - `cc.transaction(ctx => ctx.mls_init(clientId, [ciphersuite], 100))` — init MLS with 100 initial key packages
3. Worker stores the `CoreCrypto` instance in a closure variable (like `_secretKey` today)
4. Worker exposes new RPC methods: `mlsEncrypt`, `mlsDecrypt`, `mlsCreateGroup`, `mlsAddMembers`, `mlsRemoveMembers`, `mlsProcessWelcome`, `mlsGetKeyPackages`, `mlsGetEpoch`

### MLS client ID format

`<userId>:<deviceId>` encoded as UTF-8 `Uint8Array`. This binds the MLS credential
to both the user and the specific device, enabling per-device revocation.

### Steps

- [ ] **Step 1:** Create `src/client/lib/mls/mls-worker-init.ts` with `initMlsClient(userId, deviceId, kekDerivedKey, ciphersuite)` that opens the core-crypto database and calls `mls_init`. Returns the `CoreCrypto` instance.
- [ ] **Step 2:** Write unit tests in `src/client/lib/mls/mls-worker-init.test.ts` covering: successful init, double-init is idempotent, wrong key fails gracefully.
- [ ] **Step 3:** Add new MLS request/response types to the crypto-worker RPC protocol in `src/client/lib/crypto-worker.ts` (e.g., `{ type: 'mlsEncrypt', conversationId: string, plaintext: string }` → `{ type: 'mlsEncrypt_result', ciphertext: string }`).
- [ ] **Step 4:** Wire `initMlsClient()` into the worker's `unlockWithHandles` handler, after identity key extraction. Store the `CoreCrypto` instance in a module-scoped `let _coreCrypto: CoreCrypto | null`.
- [ ] **Step 5:** Implement the 8 MLS RPC handlers in the worker: `mlsEncrypt`, `mlsDecrypt`, `mlsCreateGroup`, `mlsAddMembers`, `mlsRemoveMembers`, `mlsProcessWelcome`, `mlsGetKeyPackages`, `mlsGetEpoch`.
- [ ] **Step 6:** Add corresponding RPC client methods to `src/client/lib/crypto-worker-client.ts`.
- [ ] **Step 7:** Add a `lock` path that calls `_coreCrypto?.close()` and sets `_coreCrypto = null`.
- [ ] **Step 8:** Run `bun run typecheck && bun run build`. Fix type errors.
- [ ] **Step 9:** Run unit tests.
- [ ] **Step 10:** Commit: `feat(sec/tier-6): core-crypto bootstrap in crypto-worker (slice 2)`

### Exit criteria
- core-crypto WASM loads successfully in the worker context
- MLS client initializes with identity keypair persisted in IDB
- All 8 RPC methods are callable from the client
- Lock/unlock cycle restores MLS state from IDB
- `bun run typecheck` clean

### Rollback strategy
Revert the worker changes. No server-side state created. IDB database is
per-device and auto-cleaned on next init.

---

## Slice 3: MlsConversation implementation

**Goal:** Replace the 11-line skeleton at `src/client/lib/mls/conversation.ts` with
a real implementation wrapping core-crypto's group lifecycle API.

**Effort:** ~1-2 days, ~300-400 lines

**Branch:** `feat/mls-pr2-slice-3`

### Files

- **Modify:** `src/client/lib/mls/conversation.ts` — Full implementation
- **Create:** `src/client/lib/mls/conversation.test.ts` — Unit tests
- **Create:** `src/client/lib/mls/types.ts` — MLS-specific TypeScript types

### MlsConversation API

```typescript
export class MlsConversation {
  private constructor(
    private readonly hubId: string,
    private readonly groupId: Uint8Array,
    private readonly cryptoWorker: CryptoWorkerClient,
  ) {}

  static groupIdForHub(hubId: string): Uint8Array {
    return new TextEncoder().encode(`llamenos:hub:${hubId}`)
  }

  static async create(hubId: string, cryptoWorker: CryptoWorkerClient): Promise<MlsConversation> { /* createGroup via RPC */ }
  static async joinViaWelcome(hubId: string, welcome: Uint8Array, cryptoWorker: CryptoWorkerClient): Promise<MlsConversation> { /* processWelcome via RPC */ }
  static async joinViaExternalCommit(hubId: string, groupInfo: Uint8Array, cryptoWorker: CryptoWorkerClient): Promise<MlsConversation> { /* joinByExternalCommit via RPC */ }

  async addMembers(keyPackages: Uint8Array[]): Promise<{ commit: Uint8Array; welcome: Uint8Array }> { /* addClientsToConversation via RPC */ }
  async removeMembers(clientIds: string[]): Promise<{ commit: Uint8Array }> { /* removeClientsFromConversation via RPC */ }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> { /* encryptMessage via RPC */ }
  async decrypt(ciphertext: Uint8Array): Promise<{ plaintext: Uint8Array; epoch: number; senderId: string }> { /* decryptMessage via RPC */ }

  async currentEpoch(): Promise<number> { /* conversationEpoch via RPC */ }
  async generateKeyPackages(count: number): Promise<Uint8Array[]> { /* clientKeypackages via RPC */ }
}
```

### Steps

- [ ] **Step 1:** Create `src/client/lib/mls/types.ts` with MLS-specific types: `MlsGroupId`, `MlsEpoch`, `MlsCommitResult`, `MlsDecryptResult`.
- [ ] **Step 2:** Write failing tests in `src/client/lib/mls/conversation.test.ts`: `groupIdForHub` produces deterministic bytes, `create` calls crypto-worker RPC, `encrypt`/`decrypt` round-trip.
- [ ] **Step 3:** Replace `src/client/lib/mls/conversation.ts:1-12` with the full `MlsConversation` class. All methods delegate to `CryptoWorkerClient` RPC calls.
- [ ] **Step 4:** Run tests. Fix failures.
- [ ] **Step 5:** Run `bun run typecheck && bun run build`.
- [ ] **Step 6:** Commit: `feat(sec/tier-6): MlsConversation implementation (slice 3)`

### Exit criteria
- `MlsConversation` exposes all methods from the API above
- `groupIdForHub` is deterministic and tested
- Unit tests pass with mocked crypto-worker
- `bun run typecheck` clean

### Rollback strategy
Revert to the skeleton. No server state involved.

---

## Slice 4: Hub creation bootstrap

**Goal:** Creating a hub also creates the MLS group. The first admin auto-joins.
A hub without an MLS group is a hard error.

**Effort:** ~1-2 days, ~300-500 lines

**Branch:** `feat/mls-pr2-slice-4`

### Files

- **Modify:** `src/client/lib/queries/hubs.ts` — Add MLS group creation to hub create mutation
- **Modify:** `src/server/routes/hubs.ts` — Hub creation route initializes MLS state
- **Modify:** `src/server/services/mls-service.ts` — Add `bootstrapHubGroup` method
- **Create:** `tests/api/mls-hub-bootstrap.spec.ts` — API tests for hub + MLS bootstrap

### Hub creation flow (modified)

1. Client calls `POST /api/hubs` (existing)
2. Server creates hub row (existing)
3. Server calls `mlsService.initializeGroupState(hubId, groupId, ...)` to create the `mls_hub_state` row
4. Client receives hub creation response with `hubId`
5. Client's `MlsConversation.create(hubId, cryptoWorker)` creates the group locally
6. Client generates a Commit adding itself (the first admin) as the sole member
7. Client uploads the Commit via `POST /api/hubs/:hubId/mls/commits`
8. Client generates key packages and uploads via `POST /api/hubs/:hubId/mls/key-packages`

### Device enrollment MLS join

When a new device enrolls (existing provisioning flow), the enrolling device must:
1. Generate key packages after identity provisioning
2. Upload key packages to the server
3. An existing member adds the new device to the MLS group, producing a Welcome
4. The Welcome is stored server-side and fetched by the new device
5. New device calls `MlsConversation.joinViaWelcome(hubId, welcome, cryptoWorker)`

### Steps

- [ ] **Step 1:** Add `bootstrapHubGroup(hubId: string)` to `MlsService`. This creates the `mls_hub_state` row with epoch 0 and the deterministic group ID.
- [ ] **Step 2:** Modify the hub creation route in `src/server/routes/hubs.ts` to call `bootstrapHubGroup` after inserting the hub row. If `bootstrapHubGroup` fails, the hub creation transaction rolls back.
- [ ] **Step 3:** Modify `src/client/lib/queries/hubs.ts` — in the hub create mutation's `onSuccess`, create the MLS group locally via `MlsConversation.create()`, submit the initial Commit, and upload initial key packages.
- [ ] **Step 4:** Add an `mlsReady` check to the hub detail query — if `mls_hub_state` exists for the hub, include `mlsEpoch` and `mlsGroupId` in the response.
- [ ] **Step 5:** Write API tests in `tests/api/mls-hub-bootstrap.spec.ts`: creating a hub also creates MLS state; hub without MLS state returns an indicator; key packages can be uploaded after hub creation.
- [ ] **Step 6:** Run `bun run typecheck && bun run build && bun run test:api`.
- [ ] **Step 7:** Commit: `feat(sec/tier-6): hub creation bootstraps MLS group (slice 4)`

### Exit criteria
- Creating a hub also creates `mls_hub_state` row
- Hub detail response includes MLS epoch and group ID
- API tests pass
- `bun run typecheck` clean

### Rollback strategy
Revert hub creation route changes. Drop `mls_hub_state` rows for any hubs created
during testing. Existing hubs (pre-slice-4) won't have MLS state and will need
re-bootstrapping when slice 4 re-lands.

---

## Slice 5: Notes path cutover

**Goal:** Replace `encryptNote` / `decryptNoteWithKey` and the multi-admin envelope
loop with MLS `encrypt` / `decrypt`. Delete the `adminEnvelopes` loop. The
`noteEnvelopes` table stores MLS ciphertext instead of ECIES envelopes.

**Effort:** ~2-3 days, ~500-700 lines

**Branch:** `feat/mls-pr2-slice-5`

### Files

- **Modify:** `src/shared/crypto-envelopes.ts` — Delete `encryptNote`, `decryptNoteWithKey`, `EncryptedNote` interface, and all note-related ECIES code (lines 37-105)
- **Modify:** `src/server/services/records.ts` — Update note creation/retrieval to use MLS ciphertext columns
- **Modify:** `src/server/db/schema/records.ts` — Update `noteEnvelopes` table: drop envelope columns, add `mlsCiphertext bytea`, `mlsEpoch integer`
- **Modify:** `src/client/lib/queries/notes.ts` (or wherever note queries live) — Replace ECIES decrypt with MLS decrypt in queryFn
- **Modify:** `src/client/components/` — Any component that calls `encryptNote` directly
- **Create:** `drizzle/migrations/NNNN_mls_notes_cutover.sql` — Schema migration
- **Modify:** `src/shared/crypto-envelopes.ts` tests — Remove ECIES note tests, add MLS note tests

### Note encryption: before and after

**Before (ECIES, at `src/shared/crypto-envelopes.ts:51-74`):**
```typescript
// Generate random per-note key
const noteKey = randomBytes(32)
// XChaCha20-Poly1305 encrypt the content
const cipher = xchacha20poly1305(noteKey, nonce)
const ciphertext = cipher.encrypt(utf8ToBytes(jsonString))
// Wrap noteKey for author + each admin
adminPubkeys.map(pk => eciesWrapKey(noteKey, pk, LABEL_NOTE_KEY))
```

**After (MLS):**
```typescript
// Get the hub's MLS conversation instance
const mlsConv = await getMlsConversation(hubId)
// Encrypt via MLS group — key distribution handled by ratchet tree
const mlsCiphertext = await mlsConv.encrypt(
  new TextEncoder().encode(JSON.stringify(payload))
)
// Store only the MLS ciphertext — no per-recipient envelopes
```

### noteEnvelopes table changes

Drop (or null-out) columns:
- `ephemeral_pubkey` — ECIES ephemeral key, not used in MLS
- `author_envelope` — per-author key wrap, replaced by MLS group membership
- `admin_envelopes` — per-admin key wrap array, replaced by MLS group membership

Add columns:
- `mls_ciphertext BYTEA NOT NULL` — MLS application message
- `mls_epoch INTEGER NOT NULL` — epoch at encryption time (for debugging/audit)

### Steps

- [ ] **Step 1:** Create the Drizzle schema migration: add `mlsCiphertext` and `mlsEpoch` columns to `noteEnvelopes`. Make old envelope columns nullable (don't drop yet — slice 10 cleans up).
- [ ] **Step 2:** Run `bun run migrate:generate && bun run migrate`.
- [ ] **Step 3:** Update `src/server/db/schema/records.ts:118-140` — add the new columns to the Drizzle table definition.
- [ ] **Step 4:** Update `RecordsService` note creation (`src/server/services/records.ts`) — accept `mlsCiphertext` and `mlsEpoch` instead of `authorEnvelope` + `adminEnvelopes`. The server stores the opaque MLS blob; it never sees plaintext.
- [ ] **Step 5:** Update `RecordsService` note retrieval — return `mlsCiphertext` and `mlsEpoch` in the response.
- [ ] **Step 6:** Update the client note create mutation — encrypt via `MlsConversation.encrypt()` instead of `encryptNote()`. Send `mlsCiphertext` to the server.
- [ ] **Step 7:** Update the client note query's `queryFn` — decrypt via `MlsConversation.decrypt()` instead of the ECIES unwrap path.
- [ ] **Step 8:** Delete `encryptNote` and `decryptNoteWithKey` from `src/shared/crypto-envelopes.ts:37-105`. Delete the `EncryptedNote` interface. Update imports across the codebase.
- [ ] **Step 9:** Update `noteReplies` table similarly (same columns, same pattern at `src/server/db/schema/records.ts:143-152`).
- [ ] **Step 10:** Update tests — remove ECIES note encryption tests, add MLS round-trip tests.
- [ ] **Step 11:** Run `bun run typecheck && bun run build && bun run test:unit && bun run test:api`.
- [ ] **Step 12:** Commit: `feat(sec/tier-6): notes path cutover to MLS (slice 5)`

### Exit criteria
- Notes are encrypted/decrypted via MLS
- `encryptNote` / `decryptNoteWithKey` deleted from `crypto-envelopes.ts`
- No `adminEnvelopes` loop for notes anywhere in the codebase
- Round-trip test: create note → read note → decrypted content matches
- `bun run typecheck` clean

### Rollback strategy
Revert schema migration (drop new columns, restore old columns to NOT NULL).
Revert code changes. Any notes created during testing period are lost (pre-prod).

---

## Slice 6: Messages path cutover

**Goal:** Replace `encryptMessage` / `EncryptedMessagePayload` and the
`readerEnvelopes` loop with MLS equivalents. Webhook inbound path (SMS/WhatsApp/
Signal) encrypts via MLS.

**Effort:** ~2-3 days, ~500-700 lines

**Branch:** `feat/mls-pr2-slice-6`

### Files

- **Modify:** `src/shared/crypto-envelopes.ts` — Delete `encryptMessage`, `EncryptedMessagePayload`, and message-related ECIES code (lines 107-143)
- **Modify:** `src/server/db/schema/conversations.ts` — Update `messageEnvelopes` table: add `mlsCiphertext`, `mlsEpoch`, make `readerEnvelopes` nullable
- **Create:** `drizzle/migrations/NNNN_mls_messages_cutover.sql`
- **Modify:** `src/server/services/conversations.ts` — Update message creation to accept MLS ciphertext
- **Modify:** `src/server/routes/` — Webhook routes for inbound SMS/WhatsApp/Signal: encrypt inbound plaintext via server-side MLS or pass through for client encryption
- **Modify:** `src/client/lib/queries/conversations.ts` (or equivalent) — Replace ECIES decrypt with MLS decrypt
- **Modify:** Tests

### Inbound webhook encryption challenge

The current flow (`src/server/services/conversations.ts:61-80`) encrypts inbound
message plaintext on the server side using `crypto.envelopeEncrypt()`. With MLS,
the server cannot encrypt (it's not an MLS group member). Two options:

**Option A: Server stores plaintext temporarily, client encrypts on fetch.**
Server stores inbound message as server-encrypted (existing `CryptoService`
AES-GCM under `LABEL_MESSAGE`). The first client to fetch the message decrypts
the server-encrypted body, re-encrypts via MLS, and updates the record.

**Option B: Server is an external sender in the MLS group.**
core-crypto supports `externalSenders` in `ConversationConfiguration`. The server
holds an external-sender key and can encrypt application messages without being a
full group member. This is simpler but requires the server to hold key material
capable of encrypting messages to the group.

**Decision for human:** Option A preserves the zero-knowledge property (server
never holds MLS keys). Option B is simpler but gives the server encryption
capability. Recommendation: Option A — the brief server-encrypted storage is
already the pattern used today, and the "discard plaintext immediately" invariant
is maintained.

### Steps

- [ ] **Step 1:** Create the Drizzle schema migration: add `mlsCiphertext` and `mlsEpoch` to `messageEnvelopes`. Make `readerEnvelopes` nullable.
- [ ] **Step 2:** Run `bun run migrate:generate && bun run migrate`.
- [ ] **Step 3:** Update `src/server/db/schema/conversations.ts:52-76` with new columns.
- [ ] **Step 4:** Update `ConversationService` message creation — accept `mlsCiphertext` + `mlsEpoch` OR fall back to server-encrypted-plaintext for inbound webhooks.
- [ ] **Step 5:** Update the inbound webhook handler(s) to store server-encrypted plaintext (unchanged from today's pattern, but now marked as "pending MLS encryption").
- [ ] **Step 6:** Add a client-side "claim and encrypt" flow: when fetching messages that have server-encrypted content but no MLS ciphertext, the client decrypts the server blob, MLS-encrypts, and PATCHes the record.
- [ ] **Step 7:** Update the client message query's `queryFn` — decrypt via `MlsConversation.decrypt()`.
- [ ] **Step 8:** Delete `encryptMessage` and `EncryptedMessagePayload` from `src/shared/crypto-envelopes.ts:107-143`. Update imports.
- [ ] **Step 9:** Update tests.
- [ ] **Step 10:** Run `bun run typecheck && bun run build && bun run test:unit && bun run test:api`.
- [ ] **Step 11:** Commit: `feat(sec/tier-6): messages path cutover to MLS (slice 6)`

### Exit criteria
- Messages are encrypted/decrypted via MLS
- `encryptMessage` / `EncryptedMessagePayload` deleted
- Inbound webhook messages are server-encrypted then client-MLS-encrypted on first fetch
- Round-trip test: send message → read message → decrypted content matches
- `bun run typecheck` clean

### Rollback strategy
Same as Slice 5 — revert migration, revert code. Pre-prod data loss is acceptable.

---

## Slice 7: Epoch commits on admin add/remove

**Goal:** Admin membership changes trigger MLS epoch advances. Replace hub-key
rotation with MLS group membership management.

**Effort:** ~1-2 days, ~300-400 lines

**Branch:** `feat/mls-pr2-slice-7`

### Files

- **Modify:** `src/client/lib/queries/hubs.ts` or `src/client/lib/queries/members.ts` — Add/remove member triggers MLS addMembers/removeMembers
- **Modify:** `src/server/routes/hubs.ts` — Member management routes coordinate with MLS
- **Modify:** `src/client/lib/hub-key-manager.ts` — Remove note/message-related rotation logic (hub key still rotates for hub-field encryption)
- **Create:** `tests/api/mls-membership.spec.ts` — API tests for membership + MLS epoch

### Admin add flow (MLS)

1. Admin A invites user B (existing invite flow)
2. B accepts, completes enrollment, generates key packages, uploads them
3. Admin A fetches B's key packages from `GET /api/hubs/:hubId/mls/key-packages/:deviceId`
4. Admin A calls `mlsConv.addMembers([bKeyPackage])` — produces a Commit + Welcome
5. Admin A submits the Commit via `POST /api/hubs/:hubId/mls/commits`
6. Admin A stores the Welcome via `POST /api/hubs/:hubId/mls/welcome` for device B
7. Device B fetches the Welcome and joins the group

### Admin remove flow (MLS)

1. Admin A removes user C
2. Admin A calls `mlsConv.removeMembers([cClientId])` — produces a Commit
3. Admin A submits the Commit (epoch N → N+1)
4. All remaining members fetch and process the Commit
5. User C's devices, on next sync, discover removal and clear local MLS state

### Steps

- [ ] **Step 1:** Add MLS key-package fetch + `addMembers` + Commit submit + Welcome store to the member-add mutation in the client.
- [ ] **Step 2:** Add MLS `removeMembers` + Commit submit to the member-remove mutation.
- [ ] **Step 3:** Add a "fetch and process pending commits" step to the app's sync loop (or to the Nostr real-time handler). When a `mls_epoch_advance` event arrives via Nostr, the client fetches and processes the Commit.
- [ ] **Step 4:** Update `hub-key-manager.ts` — remove the note/message key-rotation logic. Hub key rotation for hub-field encryption remains unchanged.
- [ ] **Step 5:** Write API tests in `tests/api/mls-membership.spec.ts`: add member → epoch advances; remove member → epoch advances; removed member cannot decrypt new messages.
- [ ] **Step 6:** Run `bun run typecheck && bun run build && bun run test:api`.
- [ ] **Step 7:** Commit: `feat(sec/tier-6): MLS epoch commits on admin add/remove (slice 7)`

### Exit criteria
- Adding a member to a hub advances the MLS epoch
- Removing a member advances the MLS epoch
- Removed members cannot decrypt messages created after removal
- Hub-field (non-MLS) key rotation still works independently
- API tests pass

### Rollback strategy
Revert membership mutation changes. Hub key rotation reverts to its previous
behavior. No MLS Commits are persisted if the slice is never merged.

---

## Slice 8: Audit payload variants

**Goal:** Add 7 new audit entry types for MLS lifecycle events to the signed audit
chain.

**Effort:** ~1 day, ~200-300 lines

**Branch:** `feat/mls-pr2-slice-8`

### Files

- **Modify:** `src/shared/schemas/audit-entries.ts` — Add 7 new discriminated union variants to `AuditEntryPayload`
- **Modify:** `src/client/lib/audit-log-client.ts` — Add helper methods for emitting MLS audit entries
- **Modify:** Slices 4-7 call sites — Emit audit entries on group init, member add, member remove, path update
- **Create:** `src/client/lib/audit-log-client.mls.test.ts` — Unit tests for MLS audit entry creation

### New audit entry types

```typescript
// In src/shared/schemas/audit-entries.ts — extend the AuditEntryPayload union

export const MlsGroupInitPayload = z.object({
  type: z.literal('mls_group_init'),
  hubId: z.string(),
  groupId: z.string(),
  ciphersuite: z.number().int(),
  creatorDeviceId: z.string(),
  epoch: z.literal(0),
})

export const MlsMembersAddedPayload = z.object({
  type: z.literal('mls_members_added'),
  hubId: z.string(),
  addedDeviceIds: z.array(z.string()),
  epoch: z.number().int(),
  committerId: z.string(),
})

export const MlsMembersRemovedPayload = z.object({
  type: z.literal('mls_members_removed'),
  hubId: z.string(),
  removedDeviceIds: z.array(z.string()),
  epoch: z.number().int(),
  committerId: z.string(),
})

export const MlsPathUpdatePayload = z.object({
  type: z.literal('mls_path_update'),
  hubId: z.string(),
  epoch: z.number().int(),
  updaterId: z.string(),
})

export const MlsEpochPurgePayload = z.object({
  type: z.literal('mls_epoch_purge'),
  hubId: z.string(),
  purgedEpochStart: z.number().int(),
  purgedEpochEnd: z.number().int(),
  reason: z.string(),
})

export const MlsCiphersuiteUpgradePlannedPayload = z.object({
  type: z.literal('mls_ciphersuite_upgrade_planned'),
  hubId: z.string(),
  fromCiphersuite: z.number().int(),
  toCiphersuite: z.number().int(),
  targetDate: z.string(),
})

export const MlsCiphersuiteUpgradeCompletedPayload = z.object({
  type: z.literal('mls_ciphersuite_upgrade_completed'),
  hubId: z.string(),
  fromCiphersuite: z.number().int(),
  toCiphersuite: z.number().int(),
  epoch: z.number().int(),
})
```

### Steps

- [ ] **Step 1:** Add the 7 Zod schemas to `src/shared/schemas/audit-entries.ts` and extend the `AuditEntryPayload` discriminated union.
- [ ] **Step 2:** Add helper methods to `src/client/lib/audit-log-client.ts`: `logMlsGroupInit`, `logMlsMembersAdded`, `logMlsMembersRemoved`, `logMlsPathUpdate`.
- [ ] **Step 3:** Wire audit entry emission into the MLS lifecycle call sites from Slices 4-7.
- [ ] **Step 4:** Write unit tests verifying audit entry creation + payload schema validation.
- [ ] **Step 5:** Run `bun run typecheck && bun run build && bun run test:unit`.
- [ ] **Step 6:** Commit: `feat(sec/tier-6): MLS audit payload variants (slice 8)`

### Exit criteria
- 7 new audit entry types defined and validated by Zod
- `AuditEntryPayload` discriminated union includes all MLS variants
- Group init, member add/remove emit signed audit entries
- Unit tests pass
- `bun run typecheck` clean

### Rollback strategy
Revert the schema extension. Audit entries created during testing remain in the
DB but are harmless (the verifier skips unknown types gracefully).

---

## Slice 9: Adversarial + integration tests

**Goal:** Prove the MLS integration is correct and resilient against attack
scenarios: wrong epoch, missing commit, replay, stale device, concurrent epoch
advance.

**Effort:** ~2-3 days, ~600-800 lines

**Branch:** `feat/mls-pr2-slice-9`

### Files

- **Create:** `tests/api/mls-adversarial.spec.ts` — Adversarial API tests
- **Create:** `src/client/lib/mls/conversation.adversarial.test.ts` — Client-side adversarial unit tests
- **Modify:** `tests/api/mls-routes.spec.ts` — Add integration-level round-trip tests
- **Create:** `tests/ui/mls-notes.spec.ts` — UI E2E test for MLS note round-trip (if UI tests are feasible)

### Test matrix

| Scenario | Type | What it asserts |
|----------|------|----------------|
| Note encrypt → decrypt round-trip | Unit | MLS encrypt + decrypt produces original plaintext |
| 3-device note sync via Welcome | API | Device 1 creates note, device 2 joins via Welcome, device 2 decrypts |
| Wrong epoch message rejected | Unit | `decryptMessage` on a message from epoch N+5 when client is at epoch N fails with clear error |
| Missing commit in chain | API | Client at epoch N receives commit for epoch N+2 (skipping N+1) — server returns gap, client fetches missing commits |
| Replayed commit rejected | API | Submitting the same commit twice returns 409 |
| Stale device cannot decrypt | API | Removed device fetches post-removal note — decryption fails |
| Concurrent epoch advance (race) | API | Two clients submit commits for the same epoch — one succeeds, one gets 409 |
| Key package exhaustion fallback | Unit | When no key packages available, `joinByExternalCommit` is used |
| IDB corruption recovery | Unit | core-crypto IDB cleared → re-enrollment via Welcome succeeds |
| Admin removal excludes from future | API | Admin B removed → note created after removal → B cannot decrypt |
| Lock/unlock preserves MLS state | Unit | Lock (zero keys) → unlock (restore from IDB) → decrypt succeeds |
| Inbound webhook MLS encryption | API | Inbound SMS → server stores server-encrypted → client claims + MLS-encrypts → other client decrypts |

### Steps

- [ ] **Step 1:** Write unit-level adversarial tests in `src/client/lib/mls/conversation.adversarial.test.ts`: wrong-epoch, key-package exhaustion, IDB recovery, lock/unlock round-trip.
- [ ] **Step 2:** Write API-level adversarial tests in `tests/api/mls-adversarial.spec.ts`: 3-device sync, missing commit chain, replayed commit, stale device, concurrent epoch race, admin removal exclusion, webhook claim-and-encrypt.
- [ ] **Step 3:** Add integration round-trip tests to `tests/api/mls-routes.spec.ts`: full lifecycle (create hub → bootstrap MLS → add member → create note → member decrypts → remove member → new note → removed member cannot decrypt).
- [ ] **Step 4:** Run all test suites: `bun run test:unit && bun run test:api`.
- [ ] **Step 5:** Fix any failures discovered.
- [ ] **Step 6:** Commit: `test(sec/tier-6): MLS adversarial + integration tests (slice 9)`

### Exit criteria
- All 12 adversarial scenarios pass
- Full lifecycle integration test passes
- No regressions in existing test suites
- `bun run test:all` passes

### Rollback strategy
Tests-only slice — revert is trivial.

---

## Slice 10: Docs update + ECIES sidecar cleanup

**Goal:** Update security documentation to reflect the MLS shipment. Begin cleanup
of the ECIES sidecar in the crypto-worker (remove note/message-related ECIES code
paths).

**Effort:** ~1-2 days, ~300-500 lines

**Branch:** `feat/mls-pr2-slice-10`

### Files

- **Modify:** `docs/security/HPKE_MIGRATION_NOTES.md` — Update "What HPKE does NOT cover today" section
- **Modify:** `docs/security/WHITEPAPER.md` — Update §0.1 "Current vs Target" table to mark notes/messages as MLS
- **Modify:** `src/shared/crypto-envelopes.ts` — Remove dead note/message ECIES code (if not already removed in slices 5-6)
- **Modify:** `src/client/lib/crypto-worker.ts` — Remove ECIES note/message handlers from the sidecar
- **Modify:** `docs/security/POST_OVERHAUL_GAPS_2026-04-13.md` — Mark Tier 6 PR #2 items as complete
- **Modify:** `docs/NEXT_BACKLOG.md` — Update to reflect MLS completion
- **Modify:** `docs/COMPLETED_BACKLOG.md` — Add MLS epic entry

### Steps

- [ ] **Step 1:** Update `HPKE_MIGRATION_NOTES.md` — change "What HPKE does NOT cover today" (lines 37-59) to note that notes and messages have moved to MLS. The ECIES sidecar still remains for: envelope-encrypted PII (contacts, bans, call_records), blasts, file bodies.
- [ ] **Step 2:** Update `WHITEPAPER.md` §0.1 — change the "Notes encryption" and "Messages encryption" rows from "Legacy ECIES" to "MLS groupwise encryption via @wireapp/core-crypto". Remove the "(target)" marker.
- [ ] **Step 3:** Remove dead ECIES note/message code from `crypto-envelopes.ts` and `crypto-worker.ts` if not already done.
- [ ] **Step 4:** Update `POST_OVERHAUL_GAPS_2026-04-13.md` — mark all 11 Tier 6 PR #2 items as complete with PR references.
- [ ] **Step 5:** Update `NEXT_BACKLOG.md` and `COMPLETED_BACKLOG.md`.
- [ ] **Step 6:** Run `bun run typecheck && bun run build` to verify no dead imports.
- [ ] **Step 7:** Commit: `docs(sec/tier-6): MLS PR #2 docs update + ECIES sidecar cleanup (slice 10)`

### Exit criteria
- `WHITEPAPER.md` accurately describes MLS as live (not target)
- `HPKE_MIGRATION_NOTES.md` correctly scopes what ECIES still covers
- No dead note/message ECIES code in the codebase
- `bun run typecheck` clean
- `bun run build` succeeds

### Rollback strategy
Docs-only + dead code removal — trivially revertible.

---

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | **core-crypto WASM fails in Web Worker context** — Some WASM modules require DOM APIs or `self.location` that are unavailable in workers | Medium | High (blocks entire epic) | Slice 2 is an early test. If WASM fails in worker, fall back to main-thread with `SharedArrayBuffer` isolation or dedicated iframe. The vendored version (9.3.3) is known to work in Wire's web client which uses workers. |
| 2 | **core-crypto IDB storage exceeds quota** — MLS ratchet trees grow with group size. A hub with 50 members may generate significant IDB state. | Low | Medium | core-crypto manages its own IDB compaction. Monitor IDB size in dev. If quota is an issue, implement epoch pruning (delete old epoch state, keep last N epochs). |
| 3 | **Inbound webhook encryption gap** — Between server receiving an inbound SMS and a client claiming + MLS-encrypting it, the message exists as server-encrypted plaintext. A server compromise during this window exposes the message. | Medium | Medium | This is the same threat model as today (server encrypts inbound messages). MLS makes the window explicit rather than hiding it in the envelope pattern. The fix is the "external sender" approach (brainstorm §Decision 6B) but that gives the server MLS encryption capability. Human decision needed. |
| 4 | **Epoch ordering race under concurrent admin ops** — Two admins adding members simultaneously | Medium | Low | DB-level `UNIQUE(hub_id, epoch)` on `mls_epoch_commits` rejects the loser with 409. Client retries against the new epoch. Well-understood pattern from Signal/Wire. |
| 5 | **Breaking change to `noteEnvelopes` / `messageEnvelopes` tables** — Existing ECIES-encrypted data becomes unreadable | Certain | Low | Pre-production policy explicitly allows wipe-if-unreadable. The migration makes old envelope columns nullable; data is not deleted, just inaccessible. |
| 6 | **core-crypto version upgrade path** — Future core-crypto versions may change the IDB schema or wire format | Medium | Medium | Pin the vendored version with SHA-256 verification. core-crypto includes internal IDB migrations. Document the upgrade procedure in `VENDOR.md`. Test upgrade path before bumping. |

---

## Open questions (from brainstorm, carried forward)

1. **Ciphersuite 1 vs 3** — Must be decided before Slice 2 implementation.
2. **core-crypto IDB key derivation method** — Must be decided before Slice 2.
3. **MLS group ID format** — Deterministic (`llamenos:hub:<hubId>`) recommended. Decide before Slice 3.
4. **Epoch retention count** — 5 recommended. Can be changed later. Decide before Slice 5.
5. **Inbound webhook encryption strategy** — Option A (server-encrypt + client-claim) vs Option B (external sender). Must be decided before Slice 6.
6. **Server Commit ordering strategy** — Optimistic locking recommended. Decide before Slice 1.
