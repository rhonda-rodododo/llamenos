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
