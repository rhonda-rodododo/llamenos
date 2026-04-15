# H4 — Tier 6 MLS PR #2 Brainstorm

**Date:** 2026-04-14
**Author:** Security workstream (scoping session)
**Status:** Draft — awaiting human review of open decisions before implementation begins

---

## 1. What are we trying to accomplish?

Replace the legacy ECIES + XChaCha20-Poly1305 multi-admin envelope pattern for
**notes** and **messages** with MLS (Messaging Layer Security, RFC 9420) groupwise
encryption via the vendored `@wireapp/core-crypto@9.3.3` WASM library. Each hub
gets a persistent MLS group; all hub members (volunteers + admins) are group
members. Encrypting a note or message becomes `cc.encryptMessage(hubGroupId,
plaintext)` — the MLS ratchet tree handles key distribution, forward secrecy, and
post-compromise security automatically. The multi-admin recipient-envelope loop
(`adminPubkeys.map(pk => eciesWrapKey(noteKey, pk, LABEL_NOTE_KEY))` at
`src/shared/crypto-envelopes.ts:69-73`) is deleted entirely.

**Why MLS over the current design:**

1. **Forward secrecy + post-compromise security.** The current per-note/message
   random key is wrapped under long-lived identity keys. Compromising one identity
   key decrypts all past notes wrapped to it. MLS epoch ratcheting provides both
   forward secrecy (old messages safe after key compromise) and post-compromise
   security (new messages safe after key healing via Update).
2. **O(1) encryption cost.** The current design wraps the symmetric key N times
   (once per admin). MLS encrypts once against the group tree — cost is O(log N).
3. **Membership-change semantics.** Adding/removing an admin today requires
   re-wrapping or accepting that the removed admin's copy persists. MLS epoch
   advance cryptographically excludes removed members from future messages.
4. **Provable delete via epoch key.** `LABEL_NOTE_EPOCH_KEY` (already defined at
   `src/shared/crypto-labels.ts:354`) enables epoch-bound note keys — deleting
   the epoch key makes all notes in that epoch unrecoverable.

**Non-goals:**

- **Blasts** (`LABEL_BLAST_CONTENT`) are out of scope — they target external
  recipients who are not hub members. They stay on the envelope pattern.
- **Hub-field encryption** (role names, shift names, etc.) stays on HPKE v3 +
  AES-GCM. MLS is for the note/message application layer only.
- **Envelope-encrypted PII** (contacts, bans, call records) stays on its current
  path. Per-record AAD migration is a separate Tier 1 P1 item.
- **SFrame voice E2EE** — separate Tier 5 work, not part of this epic.
- **Post-quantum ciphersuite** — future work. Ship with classical X25519 first.
- **Data migration of existing encrypted notes/messages.** Pre-production policy
  (`POST_OVERHAUL_GAPS_2026-04-13.md` §Top-level directive #5): wipe-if-unreadable
  is acceptable. No dual code paths, no ECIES→MLS re-encryption.

---

## 2. Who is affected?

**Volunteers:** Transparent change — notes and messages continue to work through
the same UI. The MLS group membership is managed automatically (join on enrollment,
leave on removal). New device enrollment produces a Welcome message instead of
ECIES key wrapping.

**Admins:** Gain epoch-advance controls (visible in audit UI). Lose the concept of
"admin envelopes" — replaced by MLS group membership where admins are simply
members with admin-level permissions.

**Operators (self-hosted):** New DB tables (`mls_hub_state`, `mls_key_packages`)
and a WASM binary (~2-4 MB gzipped for core-crypto). Server gains new routes for
key-package publication and commit distribution. Ansible/Docker deployment must
serve the WASM file. No new external service dependencies.

**Reviewers/auditors:** Whitepaper §0.1 "Current vs Target" must be updated to
reflect the MLS shipment. The "ECIES-based E2EE pending MLS cutover" language can
be replaced with "MLS-based E2EE" once the cutover lands.

**Breaking changes to existing encrypted data:** Yes, intentionally. Per
pre-production policy, existing ECIES-encrypted notes and messages become
unreadable after the migration. A TRUNCATE or schema migration that drops the old
envelope columns is acceptable. No data migration path is required.

---

## 3. What does "done" look like?

Acceptance criteria mapped to the 11-item scope from
`POST_OVERHAUL_GAPS_2026-04-13.md` §Tier 6 §P0:

| # | Item | Gate/Stretch | Acceptance criterion |
|---|------|-------------|---------------------|
| 1 | Core-crypto client bootstrap | **Gate** | `@wireapp/core-crypto` WASM initializes in the crypto-worker, MLS client identity keypair is generated and persisted in IDB, `loadCoreCrypto()` at `src/client/lib/mls/core-crypto-loader.ts` succeeds on SPA boot |
| 2 | `MlsConversation` real implementation | **Gate** | `src/client/lib/mls/conversation.ts` exposes `createGroup`, `addMembers`, `removeMembers`, `encrypt`, `decrypt`, `processWelcome`, `currentEpoch` — all backed by core-crypto calls |
| 3 | DB schema (`mls_hub_state` + `mls_key_packages`) | **Gate** | Drizzle migration creates both tables; `hubs.cs_profile` column added |
| 4 | Server routes (key-packages, welcome, commits, epochs) | **Gate** | REST endpoints for key-package CRUD, welcome fan-out, commit storage/fetch, epoch query |
| 5 | Hub creation bootstrap | **Gate** | Creating a hub also creates the MLS group; first admin auto-joins; hub without MLS group is a hard error |
| 6 | Notes path cutover | **Gate** | `encryptNote` / `decryptNoteWithKey` at `src/shared/crypto-envelopes.ts:51-105` replaced by MLS encrypt/decrypt; `adminEnvelopes` loop deleted; `noteEnvelopes` table updated to store MLS ciphertext |
| 7 | Messages path cutover | **Gate** | `encryptMessage` / `EncryptedMessagePayload` at `src/shared/crypto-envelopes.ts:111-143` replaced; `readerEnvelopes` loop deleted; webhook inbound path encrypts via MLS |
| 8 | Epoch commits on admin add/remove | **Gate** | Admin membership change triggers MLS epoch advance; hub-key rotation logic replaced |
| 9 | Audit payload variants | **Gate** | 7 new audit entry types: `mls_group_init`, `mls_members_added`, `mls_members_removed`, `mls_path_update`, `mls_epoch_purge`, `mls_ciphersuite_upgrade_planned`, `mls_ciphersuite_upgrade_completed` |
| 10 | Tests (round-trip + adversarial) | **Gate** | Unit tests for MlsConversation, API tests for server routes, adversarial tests for wrong-epoch/missing-commit/replay/stale-device |
| 11 | Docs update | Stretch | `HPKE_MIGRATION_NOTES.md` updated, `WHITEPAPER.md` §0.1 updated, `AEAD_AUDIT_...` updated. Can follow in a docs-only PR. |

All 10 gate items must pass before the epic is considered complete.

---

## 4. What library / crypto primitive stack?

### Decision: Already made

The codebase has already committed to `@wireapp/core-crypto@9.3.3`:

- Vendored at `vendor/@wireapp/core-crypto/` (see `VENDOR.md`: SHA-256
  `4573bd8d966e4530797ab35c1cacd1133b48febe2fbb8ae477c2ccd49def01eb`)
- `file:` dependency in `package.json`
- `core-crypto-loader.ts` at `src/client/lib/mls/core-crypto-loader.ts` implements
  lazy WASM loading
- SAS derivation (`sas.ts`) and emoji table (`emoji-table.ts`) are already
  functional and unit-tested against it
- GPL-3.0 license (compatible with project's AGPL-3.0 server + Apache-2.0 client
  libraries split)

### Library capabilities (verified from `corecrypto.d.ts`)

| Capability | API | Notes |
|-----------|-----|-------|
| MLS client init | `mls_init(clientId, ciphersuites, nbKeyPackage?)` | Initializes MLS state with client identity |
| Group creation | `createConversation(convId, credType, config?)` | Creates group with current client as sole member |
| Add members | `addClientsToConversation(convId, keyPackages[])` | Consumes key packages, returns commit + welcome |
| Remove members | `removeClientsFromConversation(convId, clientIds[])` | Epoch advance, excludes removed members |
| Encrypt | `encryptMessage(convId, message)` | Returns MLS application message (ciphertext) |
| Decrypt | `decryptMessage(convId, payload)` | Returns `DecryptedMessage` with plaintext + metadata |
| Process welcome | `processWelcomeMessage(welcome, config?)` | Joins existing group via Welcome message |
| Key packages | `clientKeypackages(cs, credType, amount)` | Generates TLS-serialized key packages for upload |
| Epoch query | `conversationEpoch(convId)` | Returns current epoch number |
| External commit | `joinByExternalCommit(groupInfo, credType, config?)` | Alternative join path when key package is stale |
| IDB persistence | `openDatabase(name, key)` | IndexedDB-backed persistent state |

### Ciphersuite selection

Two candidates from `Ciphersuite` enum:

| Ciphersuite | ID | KEM | AEAD | Hash | Sig |
|------------|-----|-----|------|------|-----|
| `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` | 1 | X25519 | AES-128-GCM | SHA-256 | Ed25519 |
| `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519` | 3 | X25519 | ChaCha20-Poly1305 | SHA-256 | Ed25519 |

**Recommendation:** Ciphersuite 1 (AES-128-GCM). Rationale:
- Aligns with the existing HPKE suite (`DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 +
  AES-256-GCM`) — same KEM family
- Hardware-accelerated AES-NI on all target platforms (modern browsers)
- core-crypto's default ciphersuite
- The existing note/message encryption uses XChaCha20-Poly1305, but that's the
  legacy path being replaced, not a constraint on the MLS suite

**Decision for human:** Ciphersuite 1 vs 3. See §Decisions deferred to human.

### WASM size

The `@wireapp/core-crypto` WASM binary is typically 2-4 MB gzipped. This is
loaded lazily by `core-crypto-loader.ts` — it does not block initial page load.
The WASM file is served as a static asset from `vendor/@wireapp/core-crypto/src/`.

---

## 5. Edge cases and failure modes

### 5.1 Epoch update race — two admins rotate concurrently

**Scenario:** Admin A and Admin B both issue an Update (epoch advance) at the same
time. Each generates a Commit against epoch N. The server receives both.

**Mitigation:** The server must enforce epoch ordering. Only the first Commit
against epoch N is accepted; the second receives a 409 Conflict. The rejected
client fetches the winning Commit, processes it (advancing to epoch N+1), then
retries its own operation against epoch N+1. The `mls_hub_state` table should have
a `UNIQUE(hub_id, epoch)` constraint to enforce this at the DB level.

### 5.2 Key-package exhaustion

**Scenario:** A device's pre-uploaded key packages are all consumed (e.g., the
device was added to many groups, or the device was offline for a long time and
other clients consumed its packages for Welcome messages).

**Mitigation:** The server's key-package consumption endpoint must check remaining
count. When count drops below a threshold (e.g., 5), the server includes a
`key_packages_low` flag in the response. The client refills on next activity.
core-crypto's `clientKeypackages()` generates fresh packages on demand. If count
reaches 0, the joining party falls back to External Commit (via
`joinByExternalCommit`). The `MlsConversation.addMembers` wrapper must handle the
"key package already consumed" error from core-crypto gracefully.

### 5.3 Out-of-order Welcome message

**Scenario:** Device B uploads key packages. Admin A adds B to the group and
distributes a Welcome. But B also joins a second group, consuming the same key
package, before processing the first Welcome.

**Mitigation:** core-crypto's `processWelcomeMessage` will throw if the referenced
key package has been deleted locally. The error message says "join this group with
an external commit" (documented in `corecrypto.d.ts:1791-1793`). The client must
catch this specific error and fall back to `joinByExternalCommit`.

### 5.4 Member removal during pending Commit

**Scenario:** Admin A removes member C while member C has a pending (not yet
committed) proposal in flight.

**Mitigation:** The server processes Commits in epoch order. If A's removal Commit
lands first (epoch N → N+1), C's pending proposal references epoch N and is
rejected. C's client, upon fetching the new epoch, discovers it has been removed
and clears local group state. The UI shows "You have been removed from this hub."

### 5.5 Recovery after client lock (PIN re-entry)

**Scenario:** The user locks the app (zeroing the nsec in the crypto-worker
closure). On unlock, MLS group state must be restored.

**Mitigation:** core-crypto persists all MLS state in IndexedDB (via
`openDatabase`). On unlock, the client re-opens the core-crypto database with the
same key (derived from the KEK). Group state, epoch, and ratchet tree are restored
from IDB. No network round-trip needed for state recovery. The IDB database key
must be derived deterministically from the user's KEK so that lock/unlock cycles
produce the same key.

### 5.6 Migration of existing ECIES-encrypted notes

**Scenario:** A hub has existing ECIES-encrypted notes in `noteEnvelopes` and
messages in `messageEnvelopes`. After the MLS cutover, these are unreadable.

**Mitigation:** Per pre-production policy (§Top-level directive #5 in
`POST_OVERHAUL_GAPS_2026-04-13.md`): **wipe-if-unreadable is acceptable.** The
migration either TRUNCATEs the note/message tables or adds new MLS-specific
columns alongside the old ones (with the old columns becoming dead). No re-
encryption path. The UI should show "Notes from before the security upgrade are no
longer available" for any pre-migration records that remain.

### 5.7 Multi-device state divergence

**Scenario:** User has devices D1 and D2. D1 is online and processes all Commits.
D2 is offline for a week. When D2 comes online, it is many epochs behind.

**Mitigation:** D2 fetches all pending Commits from the server's epoch store (the
`mls_hub_state` table stores Commits per epoch). core-crypto processes them
sequentially, advancing the local epoch. If the Commit chain is too long or
includes a removal of D2, the client must handle gracefully. The server's
`GET /api/hubs/:hubId/mls/commits?since_epoch=N` endpoint returns all Commits
after epoch N, paginated.

### 5.8 core-crypto WASM load failure

**Scenario:** The WASM binary fails to load (network error, CSP violation, corrupt
file).

**Mitigation:** `loadCoreCrypto()` at `src/client/lib/mls/core-crypto-loader.ts:15-27`
already throws on failure. Under the new directive (no dual code paths, no
fallback), a WASM load failure means the app cannot encrypt or decrypt
notes/messages. The app must show an error boundary: "Security module failed to
load. Please refresh or check your connection." This is fail-closed by design.

### 5.9 Server compromise — Commit injection

**Scenario:** A compromised server injects a fake Commit that adds an attacker's
device to the group.

**Mitigation:** MLS Commits are signed by the committer's leaf key. core-crypto
verifies the signature on `decryptMessage`. A fake Commit with an unknown signer
is rejected. The audit chain logs every membership change; the client-side audit
verifier detects discrepancies between the signed audit chain and the MLS epoch
log. Additionally, `addClientsToConversation` requires key packages signed by the
added device's identity — the server cannot forge these.

### 5.10 Concurrent note creation during epoch transition

**Scenario:** Volunteer V encrypts a note at epoch N. While the note is in flight
to the server, Admin A advances the epoch to N+1. Other clients are now at N+1
and cannot decrypt a message encrypted at epoch N.

**Mitigation:** MLS application messages include the epoch number. core-crypto's
`decryptMessage` handles messages from recent past epochs (the ratchet tree retains
enough state to decrypt messages from the immediately preceding epoch, subject to
the `out_of_order_tolerance` configuration). The server should store the epoch
number alongside the encrypted note so clients can verify they have the right epoch
state before attempting decryption. If decryption fails due to epoch mismatch, the
client should fetch missing Commits and retry.

### 5.11 IDB corruption or quota exhaustion

**Scenario:** The browser's IndexedDB is corrupted (browser crash, storage
pressure) or hits quota limits, causing core-crypto's database operations to fail.

**Mitigation:** core-crypto operations that fail with IDB errors should be caught
and surfaced as "Security state corrupted — please re-enroll this device." The
re-enrollment flow issues a new Welcome to the device, rebuilding its MLS state
from scratch. The old device's MLS leaf is removed from the group.

### 5.12 Hub with zero members (degenerate state)

**Scenario:** All members leave a hub, or the last admin is removed. The MLS group
has no members.

**Mitigation:** The hub creation flow ensures at least one admin is a group member.
The removal flow must refuse to remove the last admin. This is enforced both at the
server (API validation) and in the MLS layer (the committer must remain in the
group after a removal Commit).

---

## 6. Operational concerns

### DB migrations

All migrations are **additive** — new tables and columns only. No existing tables
are dropped in the migration itself.

- `mls_hub_state`: stores per-hub group state (group ID, current epoch, latest
  commit blob, ratchet tree snapshot for external joins).
- `mls_key_packages`: stores per-device pre-uploaded key packages.
- `hubs.cs_profile`: new column (`text`, default `'standard'`).
- Old note/message envelope columns (`authorEnvelope`, `adminEnvelopes`,
  `readerEnvelopes`, `ephemeralPubkey`) become dead after cutover. They can be
  dropped in a follow-up migration or left as nullable dead columns.

### Backup/restore implications

core-crypto stores all MLS state in the browser's IndexedDB. This is NOT backed up
by the server. If a user clears browser data or moves to a new device, they must
re-enroll (receive a new Welcome). The server-side `mls_hub_state` table contains
enough state (GroupInfo) for external-commit joins, which is the re-enrollment
path.

Server-side DB backups capture `mls_hub_state` and `mls_key_packages`. Restoring
from backup may create epoch divergence between the server and online clients. This
is acceptable in a disaster-recovery scenario — the resolution is to have all
clients re-join via external commit after a restore.

### On-disk format versioning

core-crypto's IDB schema is versioned internally (see `migrateDatabaseKeyTypeToBytes`
for 5.x → 6.x migration). The vendored version (9.3.3) uses the current IDB
format. Future core-crypto updates may require IDB migrations, which core-crypto
handles internally. Our migration path is: update the vendor, run core-crypto's
built-in IDB migration on next app load.

### Downgrade path

If core-crypto has a critical bug post-ship:

1. **Revert the WASM binary** to a known-good version (the vendored tarball SHA is
   in `VENDOR.md`).
2. **If the IDB format is incompatible**, users must clear IDB and re-enroll.
3. **If the MLS protocol state is corrupted**, the server can issue a group-wide
   re-initialization: create a new MLS group for the hub, distribute Welcomes to
   all current members, and mark the old group as archived.
4. **Reverting to ECIES envelopes** is NOT a downgrade path. Per directive #3, no
   dual code paths. If MLS is broken, fix MLS — don't fall back.

---

## 7. Interaction with existing systems

### Audit chain

**Yes, MLS commits generate audit entries.** Every MLS lifecycle event maps to a
signed audit entry type:

| MLS event | Audit entry type | Payload |
|-----------|-----------------|---------|
| Group created (hub bootstrap) | `mls_group_init` | `{ hubId, groupId, ciphersuite, creatorDeviceId, epoch: 0 }` |
| Members added | `mls_members_added` | `{ hubId, addedDeviceIds[], epoch, committerId }` |
| Members removed | `mls_members_removed` | `{ hubId, removedDeviceIds[], epoch, committerId }` |
| Key material updated (self-update) | `mls_path_update` | `{ hubId, epoch, updaterId }` |
| Old epoch keys purged | `mls_epoch_purge` | `{ hubId, purgedEpochRange, reason }` |
| Ciphersuite upgrade planned | `mls_ciphersuite_upgrade_planned` | `{ hubId, fromCs, toCs, targetDate }` |
| Ciphersuite upgrade completed | `mls_ciphersuite_upgrade_completed` | `{ hubId, fromCs, toCs, epoch }` |

These are appended to the existing `signedAuditEntries` table at
`src/server/db/schema/records.ts:59-88` via the `AuditLogService.appendSigned`
method. The `AuditEntryPayload` discriminated union at
`src/shared/schemas/audit-entries.ts` must be extended with the 7 new variants.

### Recovery group

**Question: Can Shamir-recovered keys bootstrap an MLS membership?**

The recovery group reconstructs the user's root KEK, which derives the identity
key (nsec). The identity key is used to sign the MLS client credential. So yes —
after recovery, the user can:

1. Reconstruct the root KEK via Shamir
2. Derive the identity key
3. Initialize a new core-crypto client with that identity
4. Generate fresh key packages
5. Have an admin add them to the MLS group via a Welcome

The recovery flow does NOT restore MLS epoch state (that's per-device in IDB). The
recovered user joins as a new device, receiving all future messages but not past
ones (forward secrecy working as intended).

### Device linking

Device enrollment currently uses ECDH provisioning rooms to transfer the identity
key to a new device. With MLS, device linking adds a step:

1. Existing device provisions the identity key to the new device (unchanged)
2. New device initializes core-crypto with the provisioned identity
3. New device generates key packages and uploads to the server
4. An existing member (or the hub admin) adds the new device to the MLS group
   via `addClientsToConversation`, distributing a Welcome

The `LABEL_MLS_PROVISION` label at `src/shared/crypto-labels.ts:357` is already
defined for this purpose.

### Hub key rotation on revoke

**Replaced by MLS epoch advance.** The current hub-key rotation (generate new
random 32 bytes, HPKE-wrap per remaining member under `LABEL_HUB_KEY_WRAP`) is
the note/message analog of what MLS does automatically on member removal. When an
admin removes a member, the MLS epoch advances, and the removed member's leaf is
excluded from the new ratchet tree. No separate hub-key rotation step needed for
notes/messages.

**Hub-field encryption (AES-GCM with the hub key) is unaffected** — the hub key
continues to be distributed via HPKE wrap. Only the note/message path moves to MLS.

### SFrame calls

**Not in scope.** SFrame voice E2EE (Tier 5) uses a separate key distribution
mechanism (HPKE-wrapped call secrets via Nostr). MLS could eventually replace the
SFrame key distribution, but that's a future epic, not part of this one.

### Hub-field encryption

**Unaffected.** Hub fields (role names, shift names, etc.) stay on HPKE v3 +
AES-GCM with the hub key. The hub key distribution mechanism (HPKE wrap per
device under `LABEL_HUB_KEY_WRAP`) is orthogonal to MLS.

---

## 8. Decisions deferred to human

1. **Ciphersuite selection:** Ciphersuite 1 (X25519 + AES-128-GCM) vs Ciphersuite
   3 (X25519 + ChaCha20-Poly1305). Recommendation is CS 1 for hardware
   acceleration. CS 3 matches the current XChaCha20 primitive but that's being
   replaced anyway. Decision needed before Slice 1 implementation.

2. **core-crypto IDB encryption key derivation:** The core-crypto IDB database
   requires a `DatabaseKey` (passphrase or raw bytes). Options:
   - (a) Derive from the user's KEK via HKDF with `LABEL_MLS_PROVISION` info
   - (b) Generate a random 32-byte key, wrap it under the KEK (like the hub key)
   - (c) Use the nsec bytes directly (leaks the identity key to IDB if the
     browser's IDB encryption is weak)
   
   Recommendation: (a) — deterministic, no extra wrapping, survives lock/unlock.

3. **MLS group ID format:** Options:
   - (a) `llamenos:hub:<hubId>` as UTF-8 bytes — human-readable, deterministic
   - (b) Random 32-byte group ID — opaque to the server, must be stored in
     `mls_hub_state`
   
   Recommendation: (a) — deterministic means any client can compute the group ID
   from the hub ID without a server round-trip.

4. **Epoch retention policy:** How many past epochs' key material to retain for
   out-of-order message decryption:
   - (a) 1 epoch (minimal — tight forward secrecy)
   - (b) 5 epochs (tolerant of slow clients)
   - (c) Configurable per-hub via `hubs.cs_profile`
   
   Recommendation: (b) with (c) as a future enhancement.

5. **WASM loading strategy:** Currently `core-crypto-loader.ts` uses dynamic
   `import()`. Options for the production path:
   - (a) Keep dynamic import, load lazily on first MLS operation
   - (b) Preload the WASM during SPA boot (blocks initial render but ensures MLS
     is ready)
   - (c) Load in the crypto-worker during worker initialization (parallel to main
     thread)
   
   Recommendation: (c) — aligns with the existing crypto-worker isolation pattern.

6. **Server-side Commit ordering:** The server must enforce epoch ordering for
   Commits. Options:
   - (a) Optimistic locking with `UNIQUE(hub_id, epoch)` — reject on conflict
   - (b) Pessimistic locking with `SELECT FOR UPDATE` on the hub row
   - (c) Serial queue per hub (e.g., a DB advisory lock keyed on hub ID)
   
   Recommendation: (a) — simplest, lets the DB enforce the invariant.

---

## 9. Recommendations — ready for approval

Research conducted 2026-04-15 against `@wireapp/core-crypto@9.3.3` (vendored,
SHA-256 `4573bd8d...`), RFC 9420 (MLS), and the llamenos codebase on `main`.

**Summary of all 7 recommendations** (6 from §8 + 1 newly identified):

- **Decision 1 — Ciphersuite:** CS 1 (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`)
- **Decision 2 — IDB encryption key derivation:** (a) HKDF from KEK with `LABEL_MLS_PROVISION`
- **Decision 3 — MLS group ID format:** (a) `llamenos:hub:<hubId>` as UTF-8 bytes
- **Decision 4 — Epoch retention policy:** (b) 5 epochs, server-managed via `mls_epoch_commits`
- **Decision 5 — WASM loading strategy:** (c) Load in crypto-worker during worker init
- **Decision 6 — Server-side Commit ordering:** (a) Optimistic locking with `UNIQUE(hub_id, epoch)`
- **Decision 7 — Inbound webhook encryption** *(newly identified)*: Server-encrypt-then-client-claim pattern with server as external sender

---

### Decision 1: Ciphersuite selection

**Question:** Should MLS groups use Ciphersuite 1 (X25519 + AES-128-GCM + SHA-256
+ Ed25519) or Ciphersuite 3 (X25519 + ChaCha20-Poly1305 + SHA-256 + Ed25519)?

**Recommendation:** **Ciphersuite 1 (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`)**

**Rationale:** AES-128-GCM has hardware acceleration (AES-NI) on all modern x86
and ARM platforms, which matters for the crypto-worker's decrypt-on-fetch pattern
where batch decryption throughput is rate-limited to 100 ops/sec. CS 1 is
core-crypto's default ciphersuite (returned by `ciphersuiteDefault()` at
`corecrypto.d.ts:12`), which means it receives the most testing and optimization
in the Wire codebase. Critically, CS 1 aligns with the existing HPKE suite
(`DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM`) used for hub-field
encryption — same KEM, same hash family, same AEAD family. This reduces the
cryptographic surface area an auditor must review: one AEAD family (AES-GCM)
instead of two.

**Alternatives considered:**
- **CS 3 (ChaCha20-Poly1305):** Matches the legacy XChaCha20-Poly1305 primitive
  being replaced, but that continuity is illusory — the MLS ratchet tree, not the
  AEAD, is what provides forward secrecy. ChaCha20 is faster in software-only
  contexts (no AES-NI), but all target browsers (Chrome, Firefox, Safari on
  desktop and mobile) have had AES-NI-backed WebCrypto for years. ChaCha20 would
  add a second AEAD family alongside AES-GCM (hub-field encryption), increasing
  audit surface.
- **CS 2 or CS 7 (P-256/P-384):** NIST curves have broader compliance
  recognition, but the codebase is already committed to X25519/Ed25519 for
  identity keys (`key-store.ts`, `crypto-worker.ts`). Switching KEM/sig curves
  would break the identity model.

**Security implications:** Both CS 1 and CS 3 provide 128-bit security. The
choice between AES-GCM and ChaCha20-Poly1305 does not affect forward secrecy or
post-compromise security — those properties come from the MLS ratchet tree, not
the AEAD. AES-GCM's nonce-misuse vulnerability (catastrophic plaintext recovery
on nonce reuse) is mitigated by MLS itself: the protocol derives nonces
deterministically from the key schedule, so nonce reuse requires a broken
implementation of MLS, not a random collision. For the llamenos threat model
(nation-state adversaries, long-term traffic logging), AES-128-GCM's 128-bit key
is adequate — upgrading to 256-bit is a post-quantum consideration deferred
explicitly per §1 non-goals.

**Sources:**
- RFC 9420 §17.1 — MLS cipher suite registry (CS IDs 1–7)
- `vendor/@wireapp/core-crypto/src/corecrypto.d.ts:29-57` — `Ciphersuite` enum
- `vendor/@wireapp/core-crypto/src/corecrypto.d.ts:12` — `ciphersuiteDefault()` returns CS 1
- `src/shared/hpke-primitives.ts` — HPKE suite is AES-256-GCM (same AEAD family)
- `docs/security/HPKE_MIGRATION_NOTES.md:89-91` — canonical suite definition

**Unlocks / blocks:** Ciphersuite choice must be finalized before Slice 1 (DB
schema uses `ciphersuite INTEGER NOT NULL DEFAULT 1` in `mls_key_packages`) and
Slice 2 (core-crypto init passes ciphersuite array to `mls_init`). Does not
constrain any other decision.

---

### Decision 2: core-crypto IDB encryption key derivation

**Question:** How should the 32-byte `DatabaseKey` for core-crypto's IndexedDB
encryption be derived?

**Recommendation:** **(a) HKDF from the user's KEK via `LABEL_MLS_PROVISION`**

**Rationale:** The KEK (key encryption key) is the canonical root of the client
key hierarchy, derived from PIN + IdP-bound value (+ optional WebAuthn PRF) via
PBKDF2 + HKDF (see `key-store.ts:1-13`). Deriving the IDB key via HKDF with a
domain-specific label (`LABEL_MLS_PROVISION` at `crypto-labels.ts:357`) produces
a deterministic, reproducible key that survives lock/unlock cycles without any
additional storage. On unlock, the crypto-worker reconstructs the KEK → derives
the IDB key → opens core-crypto → MLS state is restored from IDB. No extra
wrapping step, no extra storage, no race condition between key availability and
IDB open.

**Alternatives considered:**
- **(b) Random 32-byte key, wrapped under KEK:** Adds a wrapping/unwrapping step
  and requires persisting the wrapped key somewhere (localStorage or a new IDB
  store). This creates a chicken-and-egg problem: you need the wrapped key to open
  the IDB, but if the wrapped key is also in IDB, you can't get to it. It would
  require a separate storage channel (localStorage), adding fragility.
- **(c) Use nsec bytes directly:** Leaks the identity private key to the IDB
  encryption layer. If the browser's IDB encryption has a vulnerability, the
  attacker gets the identity key, compromising all signed audit entries, not just
  MLS state. Violates the principle of minimal privilege.

**Security implications:** HKDF derivation ensures the IDB key is
cryptographically independent from the identity key (nsec) and the hub key — a
compromise of the IDB encryption key does not reveal the identity key or any
non-MLS secrets. The IDB key is only as strong as the KEK, which is the
intentional security boundary: if the KEK is compromised (PIN + IdP value
leaked), the attacker can derive all downstream keys anyway. For the
server-compromise scenario, the IDB key is irrelevant — IDB lives on the client
device, not the server. For the device-compromise scenario, the attacker has
access to the browser's IDB regardless of the key derivation method.

**Sources:**
- `src/client/lib/key-store.ts:1-13` — KEK derivation chain
- `src/shared/crypto-labels.ts:357` — `LABEL_MLS_PROVISION` already defined
- `vendor/@wireapp/core-crypto/src/corecrypto.d.ts:667-673` — `DatabaseKey` constructor takes `Uint8Array`
- core-crypto KEYSTORE_IMPLEMENTATION.md — IDB value-level AES-256-GCM encryption with consumer-provided 32-byte key

**Unlocks / blocks:** Must be decided before Slice 2 (crypto-worker MLS init).
The HKDF derivation uses `LABEL_MLS_PROVISION` which is already in the label
registry, so no new label allocation needed.

---

### Decision 3: MLS group ID format

**Question:** Should MLS group IDs be deterministic human-readable strings
(`llamenos:hub:<hubId>`) or random opaque 32-byte values?

**Recommendation:** **(a) `llamenos:hub:<hubId>` encoded as UTF-8 bytes**

**Rationale:** Deterministic group IDs let any client compute the group ID from
the hub ID alone, without a server round-trip. This matters for the decrypt-on-
fetch pattern: when a React Query `queryFn` needs to decrypt a note, it needs the
`conversationId` for `cc.decryptMessage()`. With deterministic IDs, the
`conversationId` is derived locally from the hub ID already available in the
query context (via `useConfig().currentHubId`). RFC 9420 defines `group_id` as
`opaque group_id<V>` with no format constraints beyond the variable-length vector
limit — any byte sequence is valid. The deterministic format also aids debugging
and audit log readability.

**Alternatives considered:**
- **(b) Random 32-byte group ID:** Provides server opacity (the server cannot
  infer which hub a group ID belongs to), but this is a weak privacy gain — the
  server already knows the hub ID from the API route
  (`/api/hubs/:hubId/mls/commits`), so hiding the group-ID-to-hub-ID mapping adds
  no real confidentiality. Random IDs require an extra lookup table and a server
  round-trip to map hub → group ID on first access.

**Security implications:** The deterministic format leaks the hub ID to anyone
who can observe the MLS group ID (e.g., within the ratchet tree). However, the
hub ID is already present in every API request, every encrypted field's AAD (via
`buildAad`), and every audit entry — it is not a secret. For the
server-compromise scenario, the server already has the hub ID. For the
device-compromise scenario, the hub ID is in the React Query cache. The
deterministic format does not weaken forward secrecy or post-compromise security.

**Sources:**
- RFC 9420 — `opaque group_id<V>` is unconstrained
- `vendor/@wireapp/core-crypto/src/corecrypto.d.ts:320-332` — `ConversationId` takes arbitrary `Uint8Array`
- Epic plan `docs/epics/h4-mls-pr2-epic.md:7` — architecture already assumes deterministic format
- `src/shared/hpke-primitives.ts` — `buildAad(label, recordId, fieldName)` already includes hub context

**Unlocks / blocks:** Enables Slice 3 (`MlsConversation.groupIdForHub()` static
method) and Slice 4 (hub creation bootstrap). No other decisions depend on this.

---

### Decision 4: Epoch retention policy

**Question:** How many past epochs' key material should be retained for
out-of-order message decryption?

**Recommendation:** **(b) 5 epochs, managed server-side via `mls_epoch_commits` retention**

**Rationale:** 5 epochs provides tolerance for slow clients (e.g., a volunteer's
device on a poor mobile connection that is 2-3 Commits behind) without
excessively weakening forward secrecy. Importantly, `@wireapp/core-crypto@9.3.3`
does **not** expose an `out_of_order_tolerance` configuration parameter in its
TypeScript API — there is no `CustomConfiguration` field for epoch retention
(verified: `corecrypto.d.ts:628-655` has only `keyRotationSpan` and
`wirePolicy`). Epoch key retention is handled internally by core-crypto based on
which Commits have been processed. The "5 epochs" policy is therefore enforced
**server-side**: the `mls_epoch_commits` table retains Commits for catch-up, and
the server's `GET /api/hubs/:hubId/mls/commits?since_epoch=N` endpoint returns
all Commits since epoch N. Clients that are more than 5 epochs behind must
re-join via external commit (which is already the fallback path per §5.7).

**Alternatives considered:**
- **(a) 1 epoch (minimal):** Too aggressive for a crisis hotline where volunteers
  may be on intermittent connectivity. A single epoch advance during a call
  would make messages encrypted seconds ago unreadable if the volunteer's device
  misses one Commit.
- **(c) Configurable per-hub via `hubs.cs_profile`:** Adds UI and schema
  complexity for a marginal benefit. The pre-production policy should ship with a
  sensible default (5) and add configurability only if operational experience shows
  it's needed. The `cs_profile` column is already planned — it can carry this
  config in a future iteration.

**Security implications:** Retaining 5 epochs means a compromised device can
decrypt messages from the current epoch plus 4 prior epochs. This is a
forward-secrecy tradeoff: tighter retention = faster key erasure = stronger FS,
but at the cost of usability. For the llamenos threat model, 5 epochs is
reasonable — epoch advances happen on membership changes (admin add/remove), not
on a timer, so 5 epochs represents 5 membership changes, not 5 time intervals.
In practice, this is hours to days of retention, not minutes. Server-side
retention of Commit blobs does not weaken E2EE — the Commits are MLS handshake
messages that the server already transits; retaining them longer does not give the
server decryption capability.

**Sources:**
- `vendor/@wireapp/core-crypto/src/corecrypto.d.ts:628-655` — `CustomConfiguration` has no epoch retention field
- `docs/epics/h4-mls-pr2-epic.md:113-127` — `mls_epoch_commits` table design
- RFC 9420 §14 — Commit ordering is linear; clients process Commits sequentially
- Brainstorm §5.7 — multi-device catch-up via sequential Commit processing
- Brainstorm §5.10 — `decryptMessage` handles recent past epochs

**Unlocks / blocks:** Affects Slice 1 (server-side retention policy in
`mls_epoch_commits` cleanup job) and Slice 7 (epoch advance on membership
change). A future enhancement (per-hub configurability via `cs_profile`) can be
added without changing the MLS implementation.

---

### Decision 5: WASM loading strategy

**Question:** How should the core-crypto WASM binary (~2-4 MB gzipped) be loaded?

**Recommendation:** **(c) Load in the crypto-worker during worker initialization**

**Rationale:** The crypto-worker is already the isolation boundary for all
cryptographic operations (`crypto-worker.ts` holds the nsec, HPKE handles, and
hub CryptoKey in closures). Loading WASM in the worker keeps the main thread
responsive during the 2-4 MB download + compilation. The existing
`core-crypto-loader.ts` uses dynamic `import()` which naturally works in worker
context. The load happens during `unlockWithHandles` (after PIN entry), so it
does not block initial page render — the user sees the login screen immediately,
and WASM loads in parallel with the unlock flow. This is the same pattern used
for the existing `@noble/*` imports in the worker.

**Alternatives considered:**
- **(a) Keep lazy dynamic import, load on first MLS operation:** Adds latency to
  the first note decrypt after login — the user sees a loading state while WASM
  compiles. This is the current skeleton behavior but suboptimal for UX.
- **(b) Preload during SPA boot:** Wastes bandwidth for unauthenticated visitors
  (login page loads 2-4 MB of WASM they may never use) and blocks the critical
  rendering path. The WASM binary is only useful after authentication.

**Security implications:** Loading WASM in the worker ensures the core-crypto
memory space (ratchet tree, epoch keys, identity keypair) is isolated from the
main thread's DOM. A main-thread XSS attack cannot directly read worker memory.
This is consistent with the existing design where `_secretKey` is held in the
worker closure, not in main-thread state. For the server-compromise scenario, the
server serves the WASM binary — a compromised server could serve a malicious WASM.
This is mitigated by Subresource Integrity (SRI) or a content hash check against
`VENDOR.md`'s SHA-256. The load-in-worker strategy does not change this threat
surface.

**Sources:**
- `src/client/lib/mls/core-crypto-loader.ts:1-27` — current lazy loader (dynamic import)
- `src/client/lib/crypto-worker.ts` — existing worker isolation pattern
- `docs/security/HPKE_MIGRATION_NOTES.md:112-115` — HPKE sidecar in crypto-worker
- Epic plan Slice 2 — worker init sequence described at `h4-mls-pr2-epic.md:259-264`

**Unlocks / blocks:** Directly shapes Slice 2 (crypto-worker bootstrap). Does not
affect server-side decisions.

---

### Decision 6: Server-side Commit ordering

**Question:** How should the server enforce epoch ordering for concurrent MLS
Commits?

**Recommendation:** **(a) Optimistic locking with `UNIQUE(hub_id, epoch)` constraint**

**Rationale:** Optimistic locking is the simplest approach: the `mls_epoch_commits`
table's `UNIQUE(hub_id, epoch)` constraint (defined in the epic plan at
`h4-mls-pr2-epic.md:117-127`) causes a DB-level constraint violation when two
Commits target the same epoch. The server catches the unique violation and returns
HTTP 409 Conflict. The losing client fetches the winning Commit, processes it
(advancing local state), and retries. This matches RFC 9420's linear epoch model:
"The history of a group is divided into a linear sequence of epochs." Each epoch
has exactly one Commit. The DB constraint is the single source of truth for this
invariant.

**Alternatives considered:**
- **(b) Pessimistic locking (`SELECT FOR UPDATE`):** Requires holding a row lock
  during the entire Commit validation + storage transaction. Under normal
  operation, hub membership changes are rare (admin adds/removes, not per-message),
  so contention is low. Pessimistic locking adds complexity (lock timeouts,
  deadlock detection) for a contention rate that doesn't justify it.
- **(c) Advisory lock per hub:** Adds application-level lock management (acquire
  → process → release) that must handle crashes, timeouts, and stale locks. This
  is appropriate for high-contention workflows but overkill for MLS Commits, which
  happen at human-action frequency (membership changes), not machine frequency.

**Security implications:** Optimistic locking ensures exactly-once epoch
advancement — no Commit can be silently dropped or duplicated. For the
server-compromise scenario, a compromised server could refuse to store a Commit
(denial of service) or reorder Commits. But MLS Commits are signed by the
committer's leaf key and include the epoch number — clients verify the signature
and epoch chain on `decryptMessage`. A reordered or fabricated Commit is detected
and rejected by core-crypto. The DB constraint prevents a subtler attack: the
server accepting two different Commits for the same epoch (forking the group
state). The `UNIQUE` constraint makes this impossible at the storage layer.

**Sources:**
- RFC 9420 §14 — linear epoch sequence, each epoch has exactly one Commit
- `docs/epics/h4-mls-pr2-epic.md:117-127` — `mls_epoch_commits` table with `UNIQUE(hub_id, epoch)`
- `docs/epics/h4-mls-pr2-epic.md:86-87` — `mls_hub_state` also has `UNIQUE(hub_id, epoch)`
- Brainstorm §5.1 — epoch update race mitigation
- Brainstorm §5.9 — server compromise / Commit injection

**Unlocks / blocks:** Directly shapes Slice 1 (DB schema and server routes).
Does not constrain client-side decisions.

---

### Decision 7: Inbound webhook encryption (newly identified)

**Question:** After the MLS cutover, how should inbound SMS/WhatsApp/Signal
messages be encrypted when the external sender is not an MLS group member?

**Recommendation:** **Server-encrypt-then-client-claim: the server encrypts
inbound message bodies using a server-held HPKE key, stores the ciphertext, and
the assigned volunteer's client claims and re-encrypts into the MLS group.**

**Rationale:** The current inbound webhook path (`src/server/messaging/router.ts:222-247`)
uses server-side ECIES envelope encryption: the server receives plaintext from
Twilio/Vonage/etc., encrypts it under the admin and assigned volunteer pubkeys,
and discards the plaintext. With MLS, the server cannot encrypt into the MLS
group because it is not a group member (and making the server a group member would
violate the zero-knowledge property). The recommended pattern:

1. Server receives inbound webhook with plaintext message body.
2. Server encrypts the body using the existing `HpkeService.serverEncrypt()`
   under `LABEL_MESSAGE` (server-held HPKE key, same pattern as ephemeral call
   data at `src/server/services/calls.ts:212`).
3. Server stores the HPKE-encrypted ciphertext with a `pending_mls_seal` flag.
4. The assigned volunteer's client (or any online hub member) fetches pending
   messages, decrypts the HPKE envelope using the server's public key (which
   clients already have for session metadata decryption), and re-encrypts the
   plaintext into the MLS group via `cc.encryptMessage()`.
5. The MLS ciphertext replaces the HPKE ciphertext; the `pending_mls_seal` flag
   is cleared.

This is a **transit encryption** pattern: the server holds plaintext for the
minimum time (the gap between webhook receipt and the next online client's claim).
It is strictly better than the current pattern (which also has the server see
plaintext momentarily) because it preserves the MLS epoch binding and forward
secrecy for the stored-at-rest ciphertext.

**Alternatives considered:**
- **Make the server an MLS "external sender":** MLS External Senders (RFC 9420
  §12.1.8) can propose changes but cannot encrypt application messages. MLS does
  not have a concept of "external encrypter" — only group members can call
  `encryptMessage`. This option is architecturally impossible.
- **Leave inbound messages on the legacy ECIES path:** Violates the "no dual code
  paths" directive from `POST_OVERHAUL_GAPS_2026-04-13.md`. Would require keeping
  the ECIES sidecar alive indefinitely for a single call site.
- **Client-side webhook processing:** Route webhooks to a connected client
  instead of the server. This requires an always-on client (breaks offline
  operation) and exposes the webhook endpoint to client availability, which is
  unacceptable for a crisis hotline.

**Security implications:** The server sees inbound message plaintext in transit —
this is inherent to the architecture (external SMS/WhatsApp senders cannot do E2E
encryption to the MLS group). The threat model already accepts this for inbound
webhooks: the server is a trusted relay for external channel messages (see
`src/server/messaging/router.ts:222` comment). The improvement over the current
ECIES pattern is that stored-at-rest ciphertext gains MLS forward secrecy and
post-compromise security after the client claim step. If a client is online, the
transit window is seconds; if all clients are offline, the HPKE-encrypted
ciphertext waits safely (the server HPKE key is AES-256-GCM, same security level
as the MLS group). For the device-compromise scenario, only messages claimed
after the compromise are at risk — unclaimed HPKE-encrypted messages remain safe
because the server HPKE private key is server-side only.

**Sources:**
- `src/server/messaging/router.ts:222-247` — current server-side ECIES encryption of inbound messages
- `src/server/lib/hpke-service.ts` — existing server-side HPKE seal/open capability
- `docs/security/HPKE_MIGRATION_NOTES.md:108-109` — `LABEL_SERVER_HPKE_KEY` for server-held data
- RFC 9420 §12.1.8 — External Senders can propose, not encrypt
- PR #154 body — lists "Inbound webhook encryption" as decision #5 (not in brainstorm §8)

**Unlocks / blocks:** Affects Slice 6 (messages path cutover). Must be designed
before the messaging router is rewritten. Does not affect Slice 5 (notes path)
since notes are always created by authenticated hub members who are in the MLS
group.

---

### Discrepancy between PR body and §8

The PR body for PR #154 lists 6 decisions:
1. Ciphersuite ✓
2. IDB key derivation ✓
3. Group ID format ✓
4. Epoch retention ✓
5. **Inbound webhook encryption: server-encrypt+client-claim vs external sender**
6. Server Commit ordering ✓

The brainstorm §8 lists 6 decisions:
1. Ciphersuite ✓
2. IDB key derivation ✓
3. Group ID format ✓
4. Epoch retention ✓
5. **WASM loading strategy (dynamic / preload / crypto-worker)**
6. Server Commit ordering ✓

**Resolution:** Both lists are partially correct. The PR body includes the
inbound webhook encryption decision (which was identified during PR creation but
not written into §8), while §8 includes the WASM loading strategy (which the PR
body omitted). **There are actually 7 decisions**, not 6. Both the WASM loading
strategy and the inbound webhook encryption are real, load-bearing decisions that
must be resolved before implementation. This §9 covers all 7.

The brainstorm §8 is the authoritative document for the 6 decisions it contains.
The PR body's decision #5 (inbound webhook encryption) is a genuine gap in §8
that was caught during PR summarization. Decision 7 above fills this gap.

---

### Validation of §8's existing recommendations

The existing recommendations in §8 were validated against the current codebase
and core-crypto 9.3.3 API. All 5 existing recommendations (decisions 2-6) are
**confirmed correct**. No recommendation needed to be overridden.

One nuance worth flagging: §8 decision 4 references `out_of_order_tolerance` as
a configuration concept. **UNVERIFIED:** core-crypto 9.3.3's TypeScript API
(`corecrypto.d.ts`) does not expose an `out_of_order_tolerance` parameter in
`CustomConfiguration` or `ConversationConfiguration`. The epoch retention
tolerance appears to be managed internally by core-crypto based on which Commits
have been processed, not via an explicit client configuration. The "5 epochs"
recommendation is therefore best enforced as a **server-side retention policy**
(how many past Commits the server stores for catch-up) rather than a client-side
decryption window. If a future core-crypto version exposes this parameter, it
should be set to 5 for consistency.

---

**Ready for review — approve or override each recommendation, then Slice 1 can
be dispatched.**
