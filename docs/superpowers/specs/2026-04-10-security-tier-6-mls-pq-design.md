# Security Tier 6 — MLS + Post-Quantum Hybrid

**Date:** 2026-04-10
**Status:** Draft
**Branch:** `feat/sec-tier-6-mls-pq`
**Branch base:** `feat/sec-tier-0-albrecht-hardening`
**Depends on:** Tier 1 (HPKE primitives + `items_key` indirection) and Tier 3 (per-device keys + sigchain). Tier 2 and Tier 5 are orthogonal but Tier 5 benefits from Tier 6's SFrame-from-exporter integration.
**Optional:** This tier is long-term evolution, not a blocker for production. It should NOT land until Tiers 0–5 are stable and audited.
**Brief:** [`docs/security/spec-briefs/tier-6-mls-pq.md`](../../security/spec-briefs/tier-6-mls-pq.md)
**Master doc:** [`docs/security/SECURITY_IMPROVEMENTS_MASTER.md`](../../security/SECURITY_IMPROVEMENTS_MASTER.md) §1.2, §3.5.2, §3.5.3, §3.9.5, §3.10, §3.11, §6, §7 Tier 6, §8.3, §8.4, §9

## Problem

Llamenos' current hub-key model — after Tiers 0–3 land — is:

- A random 32-byte symmetric hub key per hub.
- HPKE-wrapped (Tier 1) individually to each device's X25519 identity key (Tier 3).
- Rotated via Cascading Lazy Key Rotation on every member/device removal (Tier 3).
- Membership changes signed into a hash-chained audit log verified before rewrap (Tier 0).

This is **structurally pre-MLS**. It is literally the design MLS (RFC 9420, July 2023) was standardized to replace. The current model has two load-bearing gaps that Tiers 0–3 cannot close:

1. **No continuous post-compromise security.** A device compromise on day 1 stays catastrophic on day 100 unless a membership change *happens* to trigger a rotation. Cascading Lazy Key Rotation heals on departure, not on the passage of time. An adversary who exfiltrates a device's X25519 secret key in January and then lets the device continue normal operation reads every hub communication through December.

2. **No post-quantum protection against harvest-now-decrypt-later (HNDL) adversaries.** Every ECIES/HPKE envelope Llamenos has ever written is encrypted against a classical X25519 KEM. Classical ECC will be broken by a sufficiently large quantum computer — the timeline is disputed (10? 20? 30 years?) but the conservative assumption for crisis-hotline data is "within the archival lifetime of the notes". Call notes that identify abuse victims, right-wing extremism reports, or political dissidents will still matter to nation-state adversaries in 2040. Recorded today, decrypted then.

Tier 6 addresses both gaps with a single architectural change: **migrate the hub-key lifecycle to MLS (RFC 9420) using a post-quantum hybrid ciphersuite**. The two upgrades collapse into one spec because the IETF `draft-ietf-mls-pq-ciphersuites` draft defines PQ hybrids **at the MLS ciphersuite layer** — picking an MLS ciphersuite like `MLS_256_XWING_AES256GCM_SHA512_Ed25519` gives Llamenos MLS group keying, continuous PCS via TreeKEM commits, and X25519+ML-KEM-768 hybrid key encapsulation — all in one primitive choice. Running "MLS" and "PQ" as two separate workstreams would be architectural waste.

**Concrete gaps that Tier 6 closes:**

1. **Continuous PCS absent.** Each device's X25519 identity key is long-lived; hub keys rotate only on membership change. An ongoing device compromise cannot be healed short of forcing a member removal. MLS's TreeKEM `Update` + `Commit` pattern injects fresh entropy into the group state on demand — the spec calls for daily background updates.
2. **Classical-only KEM.** Every HPKE envelope uses X25519. No hybrid defense against a future quantum break. ML-KEM-768 or ML-KEM-1024 combined with X25519 via an IETF-blessed combiner (XWing, QSF) closes the HNDL surface.
3. **Per-hub `items_key` rewrap is O(N devices).** Scales fine for 20-device hubs, starts to hurt at 200-device hubs (large crisis response coalitions). MLS TreeKEM is O(log n).
4. **SFrame voice keys in Tier 5 are per-call randomly generated, wrapped per participant.** With MLS we derive them from `MLS-Exporter(label, context, length)`. Membership change automatically advances the epoch and automatically refreshes every SFrame base key. Zero additional key distribution.
5. **"Provable delete" is currently best-effort.** A deleted note on the server still lives in every volunteer's IDB decrypt cache. With an MLS epoch tree, a deleted note's wrapping key can be tied to a specific epoch; advancing the epoch destroys the keying material on every device, making the note cryptographically unrecoverable even with total device seizure (master doc §8.3).
6. **Hub-key distribution via the existing Nostr relay is unstructured.** MLS defines a strict message typing: `KeyPackage`, `Welcome`, `Commit`, `Application`. These need a delivery service that preserves ordering within an epoch. We extend strfry (our existing self-hosted relay) with MLS-aware event types; we do NOT adopt a standalone MLS DS.

Every item above becomes a workstream in this tier.

## Design

The spec is organized as nine workstreams (6.1 through 6.9). Workstreams 6.1–6.5 are MLS core. Workstream 6.6 integrates with Tier 5 (SFrame). Workstream 6.7 grounds the wild idea from master doc §8.3 (provable delete). Workstream 6.8 covers the delivery-service extension on strfry. Workstream 6.9 is the fingerprint verification UX that must ship BEFORE any MLS code goes live (the Tuta lesson). They will be batched into at most two pull requests — PR #1 ships fingerprint verification + vendored ts-mls skeleton; PR #2 ships the MLS code path behind the `tier6Enabled` feature flag — because the PR that flips the feature flag has load-bearing UX and audit implications that should land as a single atomic review.

**Guiding principles** (derived from master §9):

- No backward-compatibility shims. Pre-production gives us the latitude to drop the Tier 3 hub-key format for MLS-enabled hubs cleanly.
- Every MLS operation is gated behind a per-hub `tier6Enabled` flag. Mixed hubs (some Tier 3, some Tier 6) coexist in the same app installation with zero shared code paths.
- The MLS library dependency is pinned to an exact version and **vendored** into the repo (`vendor/ts-mls/`) for reproducible builds and supply-chain attestation. No floating dependency for load-bearing crypto.
- **Post-quantum is the default.** Every new Tier 6 hub uses an MLS ciphersuite with an ML-KEM hybrid. There is no "classical only" MLS option shipped in Llamenos. Making PQ opt-in repeats the Tuta mistake.
- Key fingerprint verification UX must ship **before** any hub is flipped to Tier 6. Tuta shipped TutaCrypt in March 2024 with TOFU only and had to backfill fingerprint verification in August 2025. We do not repeat this.
- `items_key` indirection (Tier 1) is the only data-layer migration knob. The per-user `items_key` wrapper changes from "Tier 3 hub-key HPKE envelope" to "MLS exporter-derived key". Every underlying note, message, report, and attachment stays encrypted under its existing per-artifact random key. Migration is O(users), not O(notes).
- Hub-key → MLS-epoch binding is enforced cryptographically and documented in the audit log. Tier 0's signed sigchain records the MLS epoch number and the MLS TreeKEM root commitment hash on every membership change; clients verify both before processing a new epoch.

### 6.1. MLS library choice — ts-mls (vendored)

**Threat model:** Any load-bearing cryptographic dependency is a supply-chain attack surface. Adopting MLS means either writing it ourselves (months of work, high bug surface, zero audit coverage) or taking a dependency. Both candidates — Wire `core-crypto` and `LukaJCB/ts-mls` — have trade-offs. The wrong choice costs us weeks of integration work or bloats the PWA bundle beyond what a crisis-hotline user on a 3G connection can tolerate.

**Decision: adopt `LukaJCB/ts-mls`, vendor into `vendor/ts-mls/` at a pinned version.** Justification:

**Factors favoring ts-mls:**

1. **Native PQ ciphersuite support at the MLS layer.** ts-mls supports `draft-ietf-mls-pq-ciphersuites` ciphersuites including `MLS_256_XWING_AES256GCM_SHA512_Ed25519` and the pure ML-KEM variants. Verified via the README example and by LukaJCB's own description: "It is suitable for browsers, Node.js, or serverless environments and supports the recently standardized Post Quantum public-key algorithms (FIPS-203, FIPS-204) as well as the X-Wing hybrid KEM combining X25519 and ML-KEM." This collapses "MLS" and "PQ hybrid" into one decision.
2. **Single runtime dependency** — `@hpke/core`. This aligns exactly with Tier 1's HPKE adoption: ts-mls piggybacks on the same HPKE engine we already ship, which means the MLS WASM-less path reuses our Web-Crypto-native HPKE implementation. Bundle impact is minimal because the HPKE code is already in our bundle.
3. **Pure TypeScript** — no WASM, no wasm-bindgen glue, no FFI surface. This matches our "sandboxed crypto iframe" direction from Tier 4 (which expects JS-only modules) and our non-extractable-CryptoKey pattern from Tier 1 (which Wire core-crypto's Rust keystore would bypass with its own AES-256-GCM keystore).
4. **Type safety + immutability** — the README calls these out as explicit design goals, matching our Zod-branded-type style.
5. **MIT license** — permissive, no copyleft question. Wire core-crypto is GPL-3.0 (AGPL-3.0 compatible via section 13, but MIT is simpler).
6. **NIP-EE precedent** — the Nostr ecosystem's E2EE group protocol proposal (`marmot-ts` on GitHub) is built on ts-mls + Nostr relay distribution. This is the exact integration pattern Llamenos needs: MLS messages ride on strfry events, groups are distributed over the Nostr relay we already operate. Marmot-ts is a functional reference implementation we can study for patterns.

**Factors against ts-mls:**

1. **Maturity gap vs Wire core-crypto.** Wire ships core-crypto in production to millions of users; ts-mls has a single maintainer, no corporate backing, and no published security audit as of April 2026.
2. **We own the state persistence layer.** Wire's core-crypto bundles an encrypted IndexedDB keystore (Rexie + AES-256-GCM). ts-mls gives us raw MLS state objects; we must persist them ourselves.
3. **Smaller ecosystem.** Fewer battle-tested bug reports to learn from.

**Mitigation for the maturity gap:**

1. **Vendor the library.** Pin an exact commit of ts-mls into `vendor/ts-mls/` in the monorepo. Never update it transparently; every bump is a PR with a full diff review. This is stricter than npm version pinning because it removes the lockfile-bypass risk. Reproducible builds (Tier 0) include vendored sources in the SLSA provenance.
2. **Commission an independent audit.** Tier 6 explicitly includes an audit line-item: an external cryptography firm (Cure53, Trail of Bits, or NCC) reviews (a) the vendored ts-mls tree, (b) our integration surface, and (c) the PQ ciphersuite implementation path. This is a budgeted prerequisite before any production hub enables Tier 6.
3. **Adversarial unit tests.** The test suite covers negative paths that the library's own tests do not: malformed KeyPackages, out-of-order Commits, replayed Welcomes, forged epoch numbers, ciphersuite downgrade attempts, tampered TreeKEM paths. These tests live in `src/client/lib/mls/**.test.ts` as a second defensive layer.
4. **Keep Tier 3 paths available.** The Tier 3 hub-key code does NOT get deleted. A hub toggles `tier6Enabled`; if the flag is off, Tier 3 runs unchanged. The MLS code lives entirely in `src/client/lib/mls/` and is only loaded when a hub opts in. This keeps the Tier 3 surface as a fallback until Tier 6 has matured across enough real hubs.
5. **Feature flag + staged rollout.** Tier 6 starts as an internal-testing flag (`tier6Enabled: false` by default on all hubs). The first month it's enabled only on the internal Llamenos development hub. The second month it's opt-in per hub via an admin UI. The third month (assuming zero incidents) it becomes the default for new hubs. Existing Tier 3 hubs migrate by admin action, never automatically.

**Vendoring layout:**

```
vendor/
  ts-mls/
    LICENSE                  # MIT license text
    README.md                # vendor-notes with commit SHA, upstream URL, audit date
    src/                     # full ts-mls source tree at pinned commit
    package.json             # vendored; the monorepo root package.json points at this path
    tsconfig.json
  PROVENANCE.md              # chain-of-custody for every vendored dependency
```

The monorepo `package.json` lists the vendored module via a file: dependency: `"ts-mls": "file:./vendor/ts-mls"`. SLSA provenance (Tier 0) covers the `vendor/` subtree as first-class source.

**Rejected alternative — Wire `@wireapp/core-crypto`.**

- **Bundle size.** Core-crypto's WASM binary is ~1–2 MB uncompressed, substantial for a crisis-hotline PWA targeting low-bandwidth regions. ts-mls adds ~50–100 KB on top of the already-shipping `@hpke/core`.
- **Keystore conflict.** Core-crypto's Rexie-based IndexedDB keystore with AES-256-GCM uses a consumer-supplied 32-byte key. Llamenos's Tier 1 + Tier 4 architecture puts key material in non-extractable `CryptoKey` handles under a sandboxed iframe. Core-crypto's keystore bypasses both protections — we'd be running a second, different at-rest format alongside ours, with its own audit surface.
- **Unified MLS+Proteus API is surplus.** Core-crypto multiplexes MLS and Proteus (Wire's Double Ratchet). Llamenos has no Proteus code path and no reason to add one; we pay bundle cost for unused abstraction.
- **License complexity.** GPL-3.0 + AGPL-3.0 compatibility works via section 13 but is a conversation with any commercial integrator in the future. MIT is friction-free.
- **Version churn.** Core-crypto jumped from 1.0.0-rc to 9.x in under a year; the public TypeScript API has been rewritten multiple times. ts-mls's surface is smaller and more stable.
- **No PQ ciphersuite support as of April 2026.** Core-crypto's roadmap mentions PQ but the current shipping ciphersuites are classical (X25519/P-256). Tier 6's entire value proposition is PQ + MLS; adopting a library that requires a second major upgrade to get PQ is worse than picking the library that already has it.

### 6.2. MLS ciphersuite selection — XWing as default

**Threat model:** The MLS ciphersuite selection is the single most load-bearing decision in Tier 6. It determines whether we get PQ coverage, what our epoch-advance cost is, how big our KeyPackages grow, and whether the library's implementation is audited.

**Decision: `MLS_256_XWING_AES256GCM_SHA512_Ed25519` as default.** Also supported for upgrade: `MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519` (pure PQ, 256-bit classical-equivalent, used by highest-risk hubs).

**Justification:**

1. **XWing is the IETF-preferred hybrid KEM.** Defined in `draft-connolly-cfrg-xwing-kem` + `draft-mahy-mls-xwing`, it combines X25519 and ML-KEM-768 with a proper HKDF-based combiner, explicitly designed to be secure as long as **either** primitive survives. This is the construction Mega tried to do by concatenating keys and failed — XWing is the corrected formal version. It is NOT a bolt-on; the combiner is the construction. Using XWing through ts-mls avoids the "re-invent HKDF combine" trap entirely.
2. **ML-KEM-768 (not 1024) is the right security level.** ML-KEM-768 provides 128-bit classical-security equivalent post-quantum; combined with X25519 gives the same PCS + HNDL-defense profile as Signal's PQXDH. ML-KEM-1024 provides 192-bit classical-equivalent — stronger, but with 2x bigger public keys and 1.4x bigger ciphertexts. For the vast majority of crisis-hotline hubs, 128-bit is ample; for specialized hubs handling state-adversary threat models (whistleblower flows, exiled dissident coordination), the 1024 variant is available via the admin setting `cryptoProfile: 'high'`.
3. **AES-256-GCM + SHA-512 + Ed25519.** These are the standard NIST choices for the 256-bit MLS profile. AES-256-GCM is native WebCrypto (fast), SHA-512 is native, Ed25519 has been native in Chrome since 137, Firefox since 139, Safari since 18. All four primitives are non-extractable-CryptoKey-compatible on modern browsers.
4. **Explicit rejection of ChaCha20-Poly1305 at the MLS layer.** Llamenos uses XChaCha20-Poly1305 at the application layer (notes, messages, hub-encrypted fields). Running ChaCha20 inside MLS on top of XChaCha20 at the app layer is extra audit surface for zero added security. AES-256-GCM inside MLS is fine; it's covered by native WebCrypto and the ciphersuite is standards-tracked.

**Ciphersuite identifier matrix (what ts-mls exposes):**

| Name | IETF id | Classical KEM | PQ KEM | Hybrid method | Signature | AEAD | Hash |
|---|---|---|---|---|---|---|---|
| `MLS_256_XWING_AES256GCM_SHA512_Ed25519` | IANA-pending (`draft-mahy-mls-xwing`) | X25519 | ML-KEM-768 | XWing | Ed25519 | AES-256-GCM | SHA-512 |
| `MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519` | IANA-pending (`draft-ietf-mls-pq-ciphersuites`) | — | ML-KEM-1024 | none (pure PQ) | Ed25519 | AES-256-GCM | SHA-512 |
| `MLS_256_DHKEMP384_AES256GCM_SHA512_P384` | 0x0007 | P-384 | — | — | ECDSA-P384 | AES-256-GCM | SHA-512 |

The two PQ ciphersuite numeric codepoints are pending IANA allocation as of April 2026 (the IETF drafts are in-progress). ts-mls hardcodes provisional codepoints matching the draft authors' proposals. Llamenos pins the codepoint in the `hub_create` audit entry at hub creation time, which anchors us to whatever codepoint we used; if IANA allocates a different number later, a ciphersuite-upgrade flow (6.3) re-bootstraps the group under the final codepoint.

**Downgrade defense.** The ciphersuite is pinned per hub in the initial `hub_create` audit entry (Tier 0 signed sigchain). Every Commit re-asserts the ciphersuite; clients reject a Commit that changes it. An attacker cannot trick a Tier 6 hub into accepting a classical-only ciphersuite even if they compromise a single device's MLS state — the chain verification catches it.

### 6.3. MLS group lifecycle per hub

**Group model:** one MLS group per hub. Members = user **devices** (from Tier 3). A user with 3 devices across 2 hubs is represented 3 times in each of the 2 hubs = 6 total memberships.

**State per hub, per device:**

```typescript
// src/client/lib/mls/mls-state.ts
export interface MlsGroupState {
  hubId: string
  ciphersuite: 'MLS_256_XWING_AES256GCM_SHA512_Ed25519' | 'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519'
  groupId: Uint8Array // MLS group context identifier
  epoch: number
  lastCommitHash: string // hex SHA-256 of the last processed Commit
  treeHash: string       // hex SHA-256 of the TreeKEM root commitment at this epoch
  // opaque serialized ts-mls state — persisted encrypted under the Tier 1 non-extractable
  // AES-KW key via the crypto worker. NEVER exported to the main thread.
  opaqueState: Ciphertext
}
```

**Persistence:** `MlsGroupState` lives in a new IndexedDB store `mls_group_state` keyed by `${hubId}:${deviceId}`. The `opaqueState` field is encrypted before storage — the ts-mls state object contains TreeKEM private path secrets, which are the crown jewels of the MLS security argument. They never appear in main-thread memory. The worker thread holds the deserialized state in closure, re-encrypts on every mutation, and writes back.

**Group creation (hub admin, first device):**

1. Admin's device generates an MLS credential: a `BasicCredential` with `identity = adminDeviceId (uuid)` and `signatureKey = deviceEdPubkey (from Tier 3 sigchain)`.
2. Admin's device initializes the group via ts-mls `createGroup(credential, ciphersuite, groupId)`. The `groupId` is a 16-byte random value written into the `hub_create` audit entry (Tier 0).
3. The initial state has the admin's device as the sole member at epoch 0.
4. Admin emits a Tier 0 signed audit entry with payload `{ type: 'mls_group_init', hubId, groupId, ciphersuite, initialTreeHash, epoch: 0 }`.
5. The `opaqueState` is serialized + AES-KW-wrapped + stored in `mls_group_state`.

**KeyPackage publication (every device, ongoing):**

Every device maintains a supply of unused `KeyPackage` objects it has published to the server. A `KeyPackage` binds:
- the device's credential (identity + Ed25519 signature key),
- a short-lived init key (HPKE X25519 for classical hubs, XWing hybrid for Tier 6 hubs),
- a ciphersuite tag,
- an expiration timestamp,
- a lifetime capability set,
- an Ed25519 signature from the device's long-term signing key.

Clients publish 10 unused KeyPackages per hub-ciphersuite pair at onboarding and replenish when fewer than 3 remain unused. Published via a new `POST /api/mls/key-packages` endpoint; stored server-side in an opaque blob column and handed out on-demand (one-use-per-add). Expired KeyPackages (past lifetime) are server-side-filtered before dispatch.

**Member add (admin adds a volunteer):**

1. Admin device fetches target volunteer's published `KeyPackage`s via `GET /api/users/{userId}/key-packages?hubId={hubId}&ciphersuite={ciphersuite}`.
2. Server returns one unused `KeyPackage` per device the volunteer owns (from the Tier 3 sigchain).
3. Admin device calls ts-mls `createCommit([...adds])` where each `add` is an `AddProposal(keyPackage)` — producing:
   - A `Commit` message (broadcast to existing group members).
   - A `Welcome` message (one per added device).
   - An updated group state at epoch `N+1`.
4. Admin emits a Tier 0 signed audit entry `{ type: 'mls_members_added', hubId, epoch: N+1, addedDevicePubkeys: [...], newTreeHash, commitHash }`. Chain verification MUST pass before step 5.
5. Admin publishes:
   - The `Commit` as a Nostr event (kind `20001`, tag `["t", "llamenos:mls:commit"]`, content = opaque binary-over-base64).
   - The `Welcome` messages as Nostr DMs sent directly to each new device's Nostr pubkey (one event per device, kind `20002`, tag `["t", "llamenos:mls:welcome"]`).
6. Existing group members' clients process the `Commit`:
   - Fetch the matching audit entry; verify chain.
   - Verify TreeHash in the Commit matches the audit entry's `newTreeHash`.
   - Apply the Commit via ts-mls `processMessage(commit)`.
   - Persist new `opaqueState`.
7. New members' clients process the `Welcome`:
   - Verify the credentials of the sender against the Tier 3 sigchain.
   - Verify the Tier 0 audit entry's existence + signature.
   - Call ts-mls `joinFromWelcome(welcome)` to derive the current epoch state.
   - Persist new `opaqueState`.
8. Both sides now hold epoch `N+1`. The admin's `items_key` (Tier 1) is rewrapped under the new epoch's exporter-derived key (see 6.5).

**Member remove (admin removes a volunteer, or a device is revoked):**

1. Admin device creates `RemoveProposal(memberIndex)` for each device being removed (one per device for multi-device users).
2. ts-mls `createCommit([...removes])` produces a `Commit` and advances to epoch `N+1` with a cryptographic exclusion of the removed path secrets.
3. Tier 0 audit entry `{ type: 'mls_members_removed', hubId, epoch: N+1, removedDevicePubkeys, newTreeHash, commitHash }`.
4. Commit broadcast on Nostr relay. Existing members process and advance. Removed members' devices NEVER advance — they simply cannot derive the new epoch secret because their path secrets are excluded.
5. Admin's `items_key` rewrapped under the new epoch key.

**Critical property:** removed devices retain access to data from epochs `≤N` (via cached state) but CANNOT decrypt any new content from epoch `N+1` onward. This is continuous cryptographic revocation, not server-enforced. A compromised server that re-adds a removed device (Albrecht #1 attack) fails because the Tier 0 chain verification rejects the unauthorized `mls_members_added` entry before the Commit is processed.

**Update / PCS advance (every device, daily background):**

1. A background task in the crypto worker triggers daily (jittered +/- 2 hours) per-hub per-device.
2. ts-mls `createCommit([], { updatePath: true })` generates an `UpdateProposal` with a fresh leaf HPKE keypair, and a `Commit` that applies it. The TreeKEM path up to the root is re-derived with fresh secrets.
3. Resulting `Commit` is published as above. Audit entry type: `mls_path_update`.
4. This is the source of **continuous post-compromise security** — a compromised device that does not control the user permanently is eventually healed. If the attacker stops exfiltrating, their key material becomes stale within a day.

**Ciphersuite upgrade (hub-wide, rare):**

Changing ciphersuites cryptographically requires a fresh MLS group. Procedure:

1. Admin publishes `{ type: 'mls_ciphersuite_upgrade_planned', hubId, fromCiphersuite, toCiphersuite, effectiveEpoch }` audit entry.
2. At `effectiveEpoch`, admin creates a *new* MLS group with the new ciphersuite, re-adds every current device via KeyPackages under the new ciphersuite.
3. Old group continues until the new group is fully populated (both run in parallel for a grace window, default 7 days).
4. `items_key` is rewrapped under the new group's exporter secret; the old group's exporter secret is permanently destroyed.
5. Audit entry `{ type: 'mls_ciphersuite_upgrade_completed', hubId, oldGroupId, newGroupId, newCiphersuite, newEpoch }`.

This is rare — expected usage is zero for most hubs. Its existence matters because it gives us a clean path when the IETF draft finalizes, NIST drops a parameter set, or a new hybrid combiner is standardized.

### 6.4. Post-quantum hybrid via XWing (built into ciphersuite)

**Threat model:** HNDL adversaries archive every ciphertext Llamenos emits, waiting for the day a quantum computer can break X25519. For crisis-hotline data with decade-scale archival value, this is a real threat even if the quantum break is 20 years away.

**Defense: XWing hybrid key encapsulation** — the construction is baked into the MLS ciphersuite choice, not a separate envelope format.

XWing combines X25519 and ML-KEM-768 in a construction proven secure in the random oracle model, as long as **either** primitive survives. From the IETF draft `draft-connolly-cfrg-xwing-kem`:

```
// XWing key generation
(pk_X, sk_X) ← X25519.keygen()
(pk_M, sk_M) ← ML_KEM_768.keygen()
pk_XWing = pk_M || pk_X          // 1216 bytes (1184 ML-KEM + 32 X25519)
sk_XWing = sk_M || sk_X          // concatenated secret

// Encapsulation (sender side)
(ct_M, ss_M) ← ML_KEM_768.encaps(pk_M)
sk_E ← random 32 bytes
pk_E  ← X25519.derive_public(sk_E)
ss_X  ← X25519.derive_shared(sk_E, pk_X)
ct = ct_M || pk_E                // XWing ciphertext
ss = SHAKE256(ss_M || ss_X || ct_M || pk_E || pk_X || "XWing")

// Decapsulation (receiver side)
ss_M ← ML_KEM_768.decaps(ct_M, sk_M)
ss_X ← X25519.derive_shared(sk_X, pk_E)
ss = SHAKE256(ss_M || ss_X || ct_M || pk_E || pk_X || "XWing")
```

The single `ss` is the shared secret fed into MLS's key schedule (`init_secret`, `epoch_secret`, `exporter_secret`, etc.).

**Why not hand-roll the combiner?** Master doc §3.11 (the Mega cautionary tale): Mega attempted a classical+classical combination and made it ECB-malleable and vulnerable. The correct primitive is a formally-specified combiner that binds ciphertexts, public keys, and a domain separation tag into the final secret derivation. XWing is that primitive. Tuta's TutaCrypt uses a bespoke three-secret HKDF combine (`DHI || DHE || SSPQ → HKDF`); XWing is the IETF-sanctioned generalization and is preferred because it inherits the formal analysis from the IETF drafting process, not from Tuta's in-house review.

**Storage impact:**

- X25519 public key: 32 bytes. XWing public key: 1216 bytes (~38x bigger).
- X25519 ciphertext: 32 bytes. XWing ciphertext: 1120 bytes (~35x bigger).
- Per-device KeyPackage: ~300 bytes today → ~1500 bytes Tier 6.
- Per-hub MLS state on disk: ~5 KB + O(log n) per member → ~10 KB + O(log n) Tier 6.

These numbers are acceptable at Llamenos scale (hubs of 20–200 devices). Documented in the migration section.

**Graceful degradation test (adversarial):**

1. Mock ts-mls to force-fail the ML-KEM leg on decapsulation (return random bytes). Assert that the resulting `ss` is wrong, and therefore the resulting MLS epoch secret is wrong, and therefore MLS `processMessage` rejects with `WrongEpochSecret`. This tests that a broken PQ leg triggers a clean fail-closed.
2. Mock ts-mls to force-fail the X25519 leg. Same expected outcome.
3. Only when both legs succeed does processing work. This is the "secure if either survives" property verified via two separate failure injections.

**Note on ML-DSA signatures (deferred):** Ed25519 continues to be the signature algorithm. Signatures are authentication — they protect messages that are transmitted NOW, not archived. A future Ed25519 break affects only live signatures, not archived ciphertexts. Adding ML-DSA (FIPS 204) now would double key sizes for no HNDL-relevant benefit. Revisit in a future tier only if NIST or the IETF community signals a timeline for Ed25519 deprecation.

### 6.5. `items_key` integration from Tier 1

**Threat model:** Every note, message, report, and attachment in a hub is encrypted under a per-artifact random key, wrapped per-reader via HPKE. Rewrapping every artifact on every hub-wide rekey is O(notes × devices), unacceptable at scale. Tier 1 introduces the `items_key` indirection: a single per-user symmetric key wraps all artifact keys, and hub-key rotation only touches the `items_key`, not the artifacts.

**Design:** MLS replaces the `items_key` wrapping layer cleanly:

```
OLD (Tier 1 + Tier 3):
  artifact_key ← random(32)
  wrapped_artifact_key ← HPKE-wrap(items_key, artifact_key, LABEL_NOTE_KEY)
  items_key ← random(32)
  wrapped_items_key ← HPKE-wrap(device_pubkey, items_key, LABEL_ITEMS_KEY)

NEW (Tier 6):
  artifact_key ← random(32)
  wrapped_artifact_key ← HPKE-wrap(items_key, artifact_key, LABEL_NOTE_KEY)
  items_key = MLS.exportSecret(LABEL_ITEMS_KEY_EXPORT, contextBytes(hubId), 32)
              // derived deterministically from current MLS epoch_secret
```

The per-user `items_key` no longer lives as ciphertext in a database column. It is **derived on demand** from the current MLS epoch's exporter secret. Every member at the current epoch computes the same `items_key`, and removed members cannot compute it because they cannot derive the new epoch's exporter secret.

**Migration property (O(users)):** When MLS advances to a new epoch, no data needs to be re-encrypted. The `items_key` derivation changes, but every artifact's `wrapped_artifact_key` under the OLD `items_key` must still be readable for historical notes. This is solved by:

1. Every time the epoch advances, the client caches the old epoch's `items_key` in memory keyed by epoch number.
2. Wrapped artifacts are tagged with the epoch they were sealed under: `{ epoch: N, wrapped: ... }`.
3. On read, the client looks up the cached epoch's `items_key` and unwraps.
4. When a device "forgets" an epoch (e.g., after a provable-delete horizon, see 6.7), it removes that epoch's `items_key` from the cache — rendering all `wrapped_artifact_key`s from that epoch unrecoverable on that device.

The cache is a hot-memory-only structure; a page reload recomputes from current + cached epoch states. It is never persisted in cleartext.

**Epoch boundary handling:**

- Writes always use the current epoch. New notes tagged `{ epoch: current }`.
- Reads may require any past epoch. The cache walks back until it hits the epoch tagged in the wrap.
- Forward secrecy is provided by the existing per-artifact key (one-time use). The epoch layer adds revocation granularity.

### 6.6. SFrame integration (Tier 5) — exporter secret as key source

**Threat model:** Tier 5 ships voice E2EE via SFrame over `RTCRtpScriptTransform`. The per-call SFrame base key is currently a random 32-byte key HPKE-wrapped per participant device and distributed via the existing hub-key encrypted Nostr event channel. Key rotation on member change requires manual orchestration.

**Tier 6 replacement:** Derive the SFrame base key from the MLS exporter secret at the current epoch:

```typescript
// src/client/lib/mls/sframe-key.ts
import { LABEL_SFRAME_BASE_KEY } from '@shared/crypto-labels'

export async function deriveSFrameBaseKey(
  mlsGroup: MlsGroupHandle,
  callId: string,
): Promise<Uint8Array> {
  // ts-mls exporter: MLS-Exporter(label, context, length)
  // label = "llamenos:sframe-base-key:v1"
  // context = utf8Bytes(callId) — binds the key to a specific call
  // length = 32 bytes
  return mlsGroup.exportSecret(
    LABEL_SFRAME_BASE_KEY,
    new TextEncoder().encode(callId),
    32,
  )
}
```

**Property:** Every member at the current epoch derives the same SFrame base key for a given call ID. Removed members cannot derive it (wrong epoch). Added members at a later epoch cannot derive the key used by an earlier epoch unless the call started before they were added (in which case they are not participants and should not have the key anyway).

**Automatic epoch→key rotation:** When MLS advances an epoch during an active call, the exporter secret changes. Clients can either (a) keep the old SFrame key for the duration of the current call and rotate only on call end, or (b) trigger an SFrame key rotation mid-call via the Tier 5 SFrame key-ID mechanism. Default: (a). Rationale: Tier 5's design already tolerates a call outliving short-term membership changes; the exporter-derived key is refreshed on every new call.

**Tier 5 migration:** The SFrame code path gets a conditional:

```typescript
if (hub.tier6Enabled) {
  key = await deriveSFrameBaseKey(mlsGroup, callId)
} else {
  key = await deriveSFrameBaseKeyFromHubKey(hubKey, callId)
}
```

Both paths remain in the codebase until Tier 6 is the default.

### 6.7. Provable delete via epoch advancement (master doc §8.3)

**Threat model:** When a user deletes a note in Llamenos, the note's ciphertext is removed from server storage. But every device that has ever read the note retains the per-note key in its decrypt cache (even if the cache is browser IDB, which persists across reloads). A targeted device seizure after deletion can recover the plaintext. This is "best-effort delete", not provable delete.

**Tier 6 provable-delete design:**

1. A note marked `provableDelete: true` on creation gets an additional wrapping layer. Instead of being wrapped directly by the `items_key`, it is double-wrapped:
   - Inner: `wrapped_note_key ← HPKE-wrap(note_epoch_key, note_key, LABEL_NOTE_KEY)`.
   - Outer: `note_epoch_key ← MLS.exportSecret(LABEL_NOTE_EPOCH_KEY, noteId, 32)` at the epoch the note was created.
2. The outer wrapping is pinned to the epoch. When the admin explicitly triggers a "purge" operation on a set of provable-delete notes:
   - Admin creates an MLS `Commit` (with an empty proposal list) to advance the epoch.
   - Clients receive the Commit and process it, advancing the epoch.
   - Clients that have the old epoch's `note_epoch_key` cached are instructed (via a signed `mls_epoch_purge` audit entry) to **forget** that epoch's exporter output.
   - Any provable-delete note wrapped under the purged epoch can never again be decrypted on any device, even if the ciphertext is recovered from server backups.
3. The purge audit entry is visible in the admin audit log and lists the epoch number being purged.

**Important caveats:**

- Provable delete is opt-in per note. Default notes remain in the normal `items_key` hierarchy and are not affected by epoch purges.
- A device that was offline at the purge and comes back later processes the purge instruction in FIFO order, forgetting the epoch **before** it caches any new content from the current epoch.
- An attacker who has exfiltrated the epoch key *before* the purge can still decrypt; provable-delete does not protect against an adversary who was already inside.
- The only guarantee is: after the epoch is purged AND every device has processed the purge, no future recovery is possible without breaking the MLS or PQ primitives.

**Scope:** Provable-delete is a feature-flagged capability shipped in Tier 6 but disabled by default at the hub level. First target users are whistleblower hubs where the threat is post-event device seizure.

### 6.8. MLS delivery service — strfry extension

**Threat model:** MLS messages (`KeyPackage`, `Welcome`, `Commit`, `Application`) need ordered delivery within an epoch and fan-out to every member. Traditional MLS deployments use a standalone "Delivery Service" (DS). Llamenos already operates strfry (a self-hosted Nostr relay) as our group-communication backbone. Adding a second service is operational debt.

**Decision: extend strfry with MLS-aware event kinds + tags.** No new infrastructure.

**Event kinds:**

| Nostr kind | Content | Tags | Delivery |
|---|---|---|---|
| `20001` | `Commit` or `Application` message (base64 opaque bytes) | `["t", "llamenos:mls:commit"]`, `["hub", hubId]`, `["e", epoch]` | Broadcast to all hub subscribers |
| `20002` | `Welcome` message per added device | `["t", "llamenos:mls:welcome"]`, `["p", newDeviceNostrPubkey]`, `["hub", hubId]` | Direct to a specific device's subscription |
| `20003` | `KeyPackage` publication | `["t", "llamenos:mls:keypackage"]`, `["p", deviceNostrPubkey]`, `["cs", ciphersuite]` | Stored indefinitely, pulled by admin on demand |

**Ordering guarantees:** The Nostr relay is in-order within a topic. Within a single hub's `20001` stream, Commits are delivered in the server's receive order. Clients process Commits in order and reject out-of-order Commits (`CommitEpochMismatch`). This is the same guarantee any MLS DS provides.

**Server-side filter:** A thin filter on the strfry side rejects event kinds `20001`–`20003` that are not properly tagged or that come from publishers not in the hub's sigchain. This is defense-in-depth; the Tier 0 audit chain is the authoritative source of membership, and the client verifies every MLS message against it before processing.

**KeyPackage storage / fetch:**

- `POST /api/mls/key-packages` — publish 10 KeyPackages for a device. Server stores in `mls_key_packages` table `(id, deviceId, hubId, ciphersuite, keyPackageBytes, expiresAt, consumedAt)`.
- `GET /api/users/{userId}/key-packages?hubId&ciphersuite` — admin fetches one unused KeyPackage per device. Atomically marked consumed.
- Expired KeyPackages (past `expiresAt`) filtered out server-side and periodically purged.

The KeyPackage API is a shallow auth-facade layer over the `mls_key_packages` table. All contents are opaque to the server.

### 6.9. Fingerprint verification UX — ships BEFORE Tier 6 flag flips

**Threat model:** MLS does not solve identity verification. A malicious server can publish a crafted `KeyPackage` for "alice@example.com" that actually contains the attacker's public key. Unless alice's device authenticates that the KeyPackage she published is what her fellow group members *see*, the MLS group is MITM'ed. The defense is out-of-band fingerprint verification: alice shows bob a short authentication string derived from her long-term identity key; bob confirms it matches the UI in his app.

**Tuta shipped TutaCrypt with TOFU only and had to backfill fingerprint verification 17 months later.** We do not repeat this.

**Design: 7-emoji SAS (Short Authentication String).**

```typescript
// src/client/lib/mls/sas.ts
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { LABEL_SAS_V2 } from '@shared/crypto-labels'

const EMOJI_BASE = [/* 64 carefully chosen emoji, locale-stable */]

export function deriveSasEmoji(
  deviceEdPubkey: Uint8Array,
): string[] {
  // HKDF over the device's Ed25519 public key → 6 bytes → 7 emoji
  // (Each emoji uses 6 bits of entropy; 7 × 6 = 42 bits — adequate for casual verification.)
  const sasBytes = hkdf(sha256, deviceEdPubkey, undefined, LABEL_SAS_V2, 6)
  // Pack 42 bits into 7 indices of 6 bits each:
  return packSix(sasBytes, 7).map(i => EMOJI_BASE[i])
}
```

**UX flow:**

1. Volunteer onboards, enters hub, publishes their device sigchain entry.
2. Admin UI shows the new device with its derived 7-emoji SAS and a "Verify fingerprint" button.
3. Admin calls the volunteer on the phone (out of band): "Please open your settings page and read me the 7 emojis."
4. Volunteer reads the emojis; admin clicks each one in the right order.
5. If match, admin clicks "Verified" — a Tier 0 signed audit entry `{ type: 'device_fingerprint_verified', hubId, verifiedDeviceId, verifierDeviceId }` is appended.
6. The volunteer's device is marked verified in the admin UI; unverified devices are visually distinguished.

**Fingerprint rotation:** The SAS is derived from the device's long-term Ed25519 public key, which is stable across MLS epochs. It only changes when the device itself rotates its identity key, which triggers a re-verification flow.

**Language-stable emoji set:** The 64 chosen emojis are tested for:
- No rendering ambiguity across fonts (no visually similar pairs).
- Stable names in all 13 Llamenos locales (verified by native-speaker review).
- No culturally offensive glyphs.
- Cross-platform rendering (iOS + Android + Windows + Linux all render the same).

This check is in the Tier 6 UI test suite.

**Ship order:** This fingerprint verification UX ships in Tier 6's FIRST PR, BEFORE the MLS code path is added. It is live even for Tier 3 hubs (verifying device public keys is meaningful under Tier 3's per-device sigchain model). When Tier 6 flips on, the verification state carries over — a device verified under Tier 3 remains verified in Tier 6.

## Resolved open questions (from the brief)

Decisions made during brainstorming and baked into the design above. Captured here for traceability.

1. **MLS library choice — ts-mls or Wire core-crypto?** ts-mls, vendored into `vendor/ts-mls/` at a pinned commit. Reasons: native PQ ciphersuite support at the MLS layer, minimal bundle impact (single dep on `@hpke/core` which Tier 1 already ships), pure TypeScript (fits non-extractable-CryptoKey + sandboxed-iframe patterns), MIT license, NIP-EE precedent via marmot-ts. Mitigations for the maturity gap: vendoring, commissioned audit, adversarial tests, feature flag, Tier 3 fallback code retained.

2. **MLS ciphersuite.** `MLS_256_XWING_AES256GCM_SHA512_Ed25519` as default. `MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519` as opt-in for high-risk hubs. Neither classical-only ciphersuite is shipped.

3. **Group granularity — per-hub or per-conversation?** Per-hub. Members = devices. 20–200 devices per hub is the expected scale; MLS is designed for this.

4. **MLS for messages vs just hub state?** Just hub state + SFrame key derivation. Notes, messages, reports, attachments continue using per-artifact random keys under the `items_key`. Preserves per-note forward secrecy.

5. **`items_key` integration.** Derive per-user `items_key` from the MLS exporter secret at the current epoch. No separate wrap column.

6. **Epoch cache lifetime.** In-memory only, per-tab. Page reload recomputes from persisted opaque MLS state. Old epochs are cached until explicitly purged via `mls_epoch_purge` (provable delete) or until the device is locked.

7. **Commit frequency for PCS.** Daily background Update commit per device, jittered ±2 hours to avoid thundering herd.

8. **MLS delivery service.** Extend existing strfry relay with kinds 20001–20003. No new infrastructure. Ordered-within-topic guarantee sufficient; client-side verification catches out-of-order.

9. **KeyPackage lifetime.** 30 days, 10 pre-published per device per hub per ciphersuite. Replenish when 3 remaining.

10. **Ciphersuite upgrade path.** Full new-group bootstrap with parallel grace period. Rare; provides clean IETF-draft tracking.

11. **Migration trigger.** Per-hub opt-in. Internal hub first (month 1), volunteer opt-in (month 2), default-on for new hubs (month 3 if zero incidents). Existing Tier 3 hubs migrate on admin action, never automatically.

12. **Transparency log (key commitment).** Defer. Tier 0's signed audit log with TreeHash + epoch number is sufficient anchoring; a Sigstore transparency log is nice-to-have and can be added as a post-Tier-6 enhancement.

13. **Provable delete scope.** Opt-in per note; feature-flag per hub; disabled by default. Admin-triggered epoch purges only; no automatic time-based purging in Tier 6.

14. **Fingerprint verification ordering.** Ships in Tier 6 PR #1, BEFORE MLS code, so Tier 3 hubs can already verify device fingerprints. Verification state carries over to Tier 6 on opt-in.

15. **PQ signature (ML-DSA) adoption.** Deferred. Ed25519 continues for authentication. Signatures protect live messages, not archived ciphertexts; HNDL doesn't apply to signatures. Revisit only if NIST/IETF signals Ed25519 deprecation.

16. **XChaCha20-Poly1305 at MLS layer.** Rejected. MLS uses AES-256-GCM internally (WebCrypto native). Application-layer XChaCha20-Poly1305 remains for notes/hub fields. No layering confusion.

17. **Ciphersuite downgrade defense.** Pinned in `hub_create` audit entry; re-asserted in every Commit; client rejects mismatch.

## Testing

**Guiding principle:** every workstream lands with unit + API E2E + UI E2E coverage proportional to its blast radius. Crypto code gets adversarial test cases that assert the *negative* path (wrong ciphersuite rejected, wrong epoch rejected, forged KeyPackage rejected, tampered TreeHash rejected, removed member cannot decrypt new epoch). The library maturity gap is closed by writing more tests than the library itself ships, explicitly for the failure modes we care about.

### New unit tests

- `src/client/lib/mls/mls-group.test.ts`
  - Group creation with XWing ciphersuite produces valid initial state at epoch 0.
  - Single-device group can process its own Update Commit.
  - Two-device group: add, Welcome derivation, both converge on same epoch secret.
  - Three-device group: remove, removed device cannot derive new epoch.
  - Path update: epoch secret changes, TreeHash changes, no members lost.
  - Serialized + AES-KW-wrapped state round-trips through IDB.
  - `MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519` path exercised for the same flows.
- `src/client/lib/mls/mls-group.adversarial.test.ts`
  - Forged KeyPackage (valid signature under wrong Ed25519 key) rejected.
  - KeyPackage past expiration rejected.
  - Commit at wrong epoch (replay of older Commit) rejected.
  - Commit with valid MLS structure but wrong TreeHash (vs Tier 0 audit entry) rejected at the application layer.
  - Tampered `Application` message payload fails AEAD tag.
  - Forged `Welcome` (attacker re-signs their own KeyPackage, sends to new device) rejected because chain verification fails.
  - Ciphersuite downgrade attempt: new Commit asserts a different ciphersuite than the hub's `hub_create` entry — rejected.
  - Mocked ML-KEM failure: decapsulation returns wrong bytes → epoch secret wrong → `processMessage` throws.
  - Mocked X25519 failure: same expected outcome.
  - Concurrent Commits (two admins add members in the same epoch): only one processes; the second is rejected with `CommitEpochMismatch`, client retries on the new epoch.
- `src/client/lib/mls/mls-exporter.test.ts`
  - `exportSecret(label, context, length)` is deterministic within an epoch.
  - Different contexts produce different keys.
  - Different epochs produce different keys.
  - `deriveSFrameBaseKey` and `deriveItemsKey` produce distinct outputs for the same epoch (different labels).
  - Round-trip: member A derives X, member B derives X, both match at the current epoch.
- `src/client/lib/mls/mls-state-persistence.test.ts`
  - Opaque state encrypted under AES-KW before IDB write.
  - Opaque state decrypted inside worker closure only, never in main thread.
  - Corrupted state on disk (bit-flip) fails AEAD tag on read.
  - Cross-tab access via BroadcastChannel respects the Tier 1 Web Locks serialization.
- `src/client/lib/mls/mls-items-key.test.ts`
  - `items_key` derivation matches for two members at same epoch.
  - Epoch advance changes `items_key`; old epoch cached for historical reads.
  - Forgotten epoch (evicted from cache) cannot decrypt old wraps.
  - Wrap tagged with epoch; read path walks back to correct epoch in cache.
- `src/client/lib/mls/sas.test.ts`
  - SAS emoji derivation is deterministic for a given pubkey.
  - Different pubkeys produce different emoji sequences with overwhelming probability (birthday test over 10k random keys).
  - All 64 base emojis render identically in the test font set.
  - Locale stability: the 7-emoji sequence is character-identical across all 13 Llamenos locales.
- `src/client/lib/mls/provable-delete.test.ts`
  - A note sealed under epoch N's `note_epoch_key` is recoverable at epoch N and at epoch N+1 when N is still cached.
  - After `mls_epoch_purge` forgets epoch N on a device, the note is unrecoverable on that device.
  - Re-entering the hub under a fresh device cannot recover notes from a purged epoch even with full MLS state access.
- `src/server/routes/mls-key-packages.test.ts`
  - Publish 10 KeyPackages for a device: 201 response, server stores.
  - Fetch one: 200, returns oldest unused, marks consumed.
  - Fetch with exhausted supply: 410 Gone.
  - Fetch with expired supply: 410 Gone.
  - Fetch for a device the requester is not admin of the hub for: 403.

### New API E2E tests

- `tests/api/mls-hub-lifecycle.spec.ts`
  - Enable Tier 6 on a hub via admin API.
  - Admin creates MLS group; verify `hub_create` audit entry contains `ciphersuite`, `initialTreeHash`, `groupId`, `epoch: 0`.
  - Add a second device via KeyPackage fetch + Commit.
  - Verify both devices converge on epoch 1 with matching TreeHash.
  - Verify Tier 0 audit entry exists and has valid schnorr signature.
  - Add 10 more devices; verify epoch advances linearly; verify TreeHash evolves.
- `tests/api/mls-member-removal.spec.ts`
  - Two devices in a hub. Admin removes device 2. Verify:
    - Tier 0 audit entry appended with `mls_members_removed`.
    - Device 1 processes the Commit and advances to epoch N+1.
    - Device 2, if it tries to decrypt new `items_key` data, fails with `EpochUnreachable`.
    - Device 1 can still read historical notes from epochs ≤N.
- `tests/api/mls-commit-ordering.spec.ts`
  - Two admins concurrently send Add Commits. First wins; second is rejected with `CommitEpochMismatch`. Second admin retries and succeeds.
- `tests/api/mls-commit-replay.spec.ts`
  - Admin posts a Commit for epoch N+1. Attacker replays the same Commit bytes. Second occurrence rejected by relay filter + client-side chain check.
- `tests/api/mls-forged-keypackage.spec.ts`
  - Attacker (with admin role) publishes a KeyPackage for user B signed under attacker's own Ed25519 key. Admin fetches, attempts Add. The `Welcome` sent to device B is processed by device B's client, which verifies the KeyPackage signature against device B's sigchain entry — fails. Device B does not join; audit entry missing the expected chain.
- `tests/api/mls-ciphersuite-downgrade.spec.ts`
  - Attacker-controlled server returns a Commit with a different ciphersuite field. Client rejects at processing time; audit entry trace shows mismatch.
- `tests/api/mls-key-package-expiry.spec.ts`
  - Publish KeyPackages with short expiration; wait past; fetch; expect `410 Gone`.
- `tests/api/mls-sframe-integration.spec.ts`
  - Two Tier 6 devices start a voice call. SFrame base key is derived from MLS exporter. Both devices derive the same key. Third (removed) device in the same hub cannot derive it.
- `tests/api/mls-provable-delete.spec.ts`
  - Create a note with `provableDelete: true`. Decrypt it. Admin triggers epoch purge. Second device that was offline processes the purge. Both devices fail to decrypt the note thereafter.

### New UI E2E tests

- `tests/ui/mls-hub-opt-in.spec.ts`
  - Admin navigates to hub settings, clicks "Enable Tier 6 (MLS + PQ)". Modal asks for fingerprint verification of all current devices first. Admin verifies each. Opt-in proceeds. New `hub_create` audit entry visible in admin audit UI.
- `tests/ui/mls-device-verification.spec.ts`
  - Volunteer onboards. Admin sees unverified device with red badge. Admin opens "Verify fingerprint" modal, reads out the 7 emojis. Volunteer's UI shows the same 7 emojis. Admin clicks each in order. Verified badge turns green.
- `tests/ui/mls-member-removal.spec.ts`
  - Admin removes a volunteer. Epoch advance visible in admin audit log with new TreeHash. Volunteer's device shows "Hub access revoked" banner on next load.
- `tests/ui/mls-background-update.spec.ts`
  - With clock mocked forward by 24 hours, every device's background Update Commit is visible in the audit log at the expected jittered times.
- `tests/ui/mls-sas-emoji-render.spec.ts`
  - SAS emoji rendering test across all 13 locales; visual regression check via Playwright snapshots.
- `tests/ui/mls-fingerprint-mismatch.spec.ts`
  - Admin clicks the wrong emoji during verification. UI shows "mismatch — please retry out of band". No audit entry written. Device remains unverified.

### Existing test suites — regression gate

All existing tests must continue to pass. Tier 6 is additive to Tiers 0–5; no behavior change is intended for classical (Tier 3) hubs:

- `bun run typecheck` — clean.
- `bun run lint` — clean.
- `bun run build` — clean; vendored `vendor/ts-mls/` source tree included in build output.
- `bun run test:unit` — all existing + new unit tests pass.
- `bunx playwright test tests/api` — all existing + new API tests pass, including classical Tier 3 hub regression tests.
- `bunx playwright test tests/ui` — all existing + new UI tests pass, including Tier 3 hub flow tests.
- `./scripts/verify-build.sh` — verifies vendored ts-mls sources are in SLSA provenance, cosign bundle covers the vendor subtree.

### Adversarial test design notes

Crypto dependencies demand tests that the library authors cannot reasonably ship themselves — tests that simulate broken primitives, forged signers, replayed messages, and tampered state. These live next to the MLS integration code and run in the unit suite.

- **Broken primitive injection.** Using a test-only mock wrapper around `@hpke/core`, force ML-KEM decapsulation to return random bytes. Assert that downstream MLS processing throws `WrongEpochSecret`, not a silent wrong-key decrypt. Repeat for X25519.
- **Forged KeyPackage replay.** Take a valid published KeyPackage, bump the internal expiration, re-sign with a wrong key, submit. Assert that (a) server accepts it (server is opaque to signatures), but (b) the intended recipient's client rejects it on chain verification.
- **Epoch mismatch.** Build two Commits for epoch N+1 from two admins racing. Assert the second one is rejected with `CommitEpochMismatch` and the client auto-retries on epoch N+2.
- **Malicious TreeHash.** Build an otherwise-valid Commit where the TreeHash field is corrupted. Assert the audit-entry chain verification catches it before `processMessage` runs.
- **Provable delete roundtrip.** Create note, process epoch advance, process `mls_epoch_purge`, confirm note is unrecoverable. Then roll back state on a separate device that was offline, confirm the roll-forward purge is FIFO and the note is equally unrecoverable on the rolled-forward device.
- **SAS emoji collision.** Generate 10k random Ed25519 pubkeys and compute their 7-emoji SAS; assert no two match (probability of collision is cosmically low at 42 bits for this sample size).
- **Device fingerprint verification flow with a tampered middle.** Admin UI shows emoji set A; the volunteer UI shows emoji set A; a MITM tampers the hub-settings payload to show emoji set B on the admin UI. Admin reads set A to the volunteer; volunteer sees set A; admin clicks set B. Assert the resulting "verification" is NOT recorded — the client derives from the device's actual Ed25519 pubkey (from the verified Tier 0 sigchain entry), not from the server-returned string.

## Migration

**Database.** Several new tables and one modification:

- `drizzle/migrations/0060_mls_hub_state.sql` — per-device MLS state store:
  ```sql
  CREATE TABLE mls_hub_state (
    hub_id UUID NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    group_id BYTEA NOT NULL,
    ciphersuite TEXT NOT NULL CHECK (ciphersuite IN (
      'MLS_256_XWING_AES256GCM_SHA512_Ed25519',
      'MLS_256_MLKEM1024_AES256GCM_SHA512_Ed25519'
    )),
    epoch BIGINT NOT NULL,
    last_tree_hash TEXT NOT NULL,
    last_commit_hash TEXT NOT NULL,
    opaque_state_ciphertext TEXT NOT NULL,       -- AES-KW-wrapped under device KEK
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (hub_id, device_id)
  );
  ```
- `drizzle/migrations/0061_mls_key_packages.sql`:
  ```sql
  CREATE TABLE mls_key_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    hub_id UUID NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    ciphersuite TEXT NOT NULL,
    key_package_bytes BYTEA NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consumed_by_device_id UUID REFERENCES devices(id)
  );
  CREATE INDEX mls_key_packages_unused ON mls_key_packages (device_id, hub_id, ciphersuite)
    WHERE consumed_at IS NULL;
  ```
- `drizzle/migrations/0062_hubs_tier6_flag.sql` — add `tier6_enabled BOOLEAN NOT NULL DEFAULT false` to `hubs`; add `cs_profile TEXT NOT NULL DEFAULT 'standard' CHECK (cs_profile IN ('standard', 'high'))`. Standard = XWing ciphersuite; high = ML-KEM-1024 ciphersuite.
- `drizzle/migrations/0063_mls_audit_entry_types.sql` — no schema change; documents the new Tier 0 audit payload variants (`mls_group_init`, `mls_members_added`, `mls_members_removed`, `mls_path_update`, `mls_ciphersuite_upgrade_planned`, `mls_ciphersuite_upgrade_completed`, `mls_epoch_purge`, `device_fingerprint_verified`). Schema update via `src/shared/schemas/audit-entries.ts`.

No data migration. All tables start empty. Opting in a hub runs the bootstrap flow described in 6.3.

**Package manifest.** `package.json` gets one line: `"ts-mls": "file:./vendor/ts-mls"`. Vendored source is tracked in git. No `node_modules` surprise from a transitive update. The monorepo `bun install` resolves ts-mls to the vendored path directly.

**Fingerprint verification UX ships FIRST.** PR #1 in this tier adds the fingerprint verification primitive (SAS emoji derivation + admin UI) without touching MLS at all. It works with Tier 3 device sigchain entries from day one. PR #2 adds the MLS code path behind the `tier6Enabled` flag.

**Feature flag staging:**

1. **Month 1 (internal hub only):** `tier6Enabled` manually flipped by a root-DB update on the Llamenos internal development hub. No user-facing setting. A small team of developers exercises the end-to-end flow daily.
2. **Month 2 (volunteer opt-in):** Admin UI gains a "Migrate hub to Tier 6 (MLS + PQ)" button in hub settings. Clicking it runs a checklist modal:
   - All current devices must have verified fingerprints.
   - Admin must acknowledge the MLS audit scope (modal with summary).
   - Confirmation required to proceed.
   On confirmation, the hub's `tier6_enabled` flips; all devices pre-publish KeyPackages; the bootstrap flow runs.
3. **Month 3 (default-on for new hubs, existing hubs stay opt-in):** The "create new hub" flow defaults to `tier6Enabled: true`. Existing hubs remain opt-in indefinitely.
4. **Month 6 (audit prerequisite complete):** External audit of ts-mls integration is completed and remediated. At this point, Llamenos marketing can assert "post-quantum hybrid by default".

**Audit commissioning.** The tier explicitly includes a budget line-item for an external audit. Target firms: Cure53, Trail of Bits, NCC Group. Scope:
- The vendored ts-mls source tree at the pinned commit.
- Llamenos's MLS integration code (`src/client/lib/mls/**`).
- The feature-flag + migration path.
- The PQ ciphersuite code path specifically.
- The Nostr relay delivery + server-side KeyPackage storage endpoints.
- Interaction with Tier 0 audit signatures and Tier 3 device sigchain.

Audit report published to `docs/security/` on completion (following the "publish or it doesn't count" principle).

**No rollback.** Once a hub flips to `tier6Enabled: true`, it does NOT flip back. A botched migration means the hub is stuck in a partially-MLS state; recovery is "recreate the hub, re-add members, re-attach historical data via admin tools". This is a hard property and must be communicated in the opt-in modal.

**Classical hubs continue to work unchanged.** The entire Tier 3 hub-key code path is untouched. Mixed-mode deployment (some hubs Tier 3, some Tier 6) is supported indefinitely.

**SFrame (Tier 5) integration.** Tier 5's SFrame key derivation gets a conditional (see 6.6): `if (hub.tier6Enabled) { deriveSFrameBaseKey(mlsGroup, callId) } else { deriveSFrameBaseKeyFromHubKey(hubKey, callId) }`. Both paths coexist. Tests cover both.

## Out of scope

Explicitly deferred to later tiers. Every item below is either out-of-Tier-6 entirely or a future enhancement layered on top of Tier 6.

- **MLS application messages for notes/messages/reports.** Tier 6 uses MLS only for group state + `items_key` derivation. Notes and messages continue to use per-artifact random keys under the `items_key` indirection. This preserves per-note forward secrecy and keeps the change surface manageable.
- **ML-DSA (FIPS 204) post-quantum signatures.** Ed25519 continues for authentication. Signatures protect live messages, not archived ciphertexts; HNDL adversaries don't threaten signing. Revisit only if NIST or the IETF signals Ed25519 deprecation.
- **SLH-DSA (FIPS 205).** Same reasoning. Stateless hash-based signatures are huge (~8 KB) and unsuitable for the Llamenos wire format today.
- **Sigstore transparency log for epoch commitments.** Tier 0's signed audit log already anchors TreeHashes. A Sigstore transparency log is nice-to-have as a third-party attestation layer; not load-bearing for Tier 6.
- **MLS interop with Wire, Matrix, Discord DAVE.** Out of scope for Llamenos's internal threat model. The ciphersuite choice (`MLS_256_XWING_*`) is interoperable in principle, but Llamenos's Nostr delivery service is bespoke and not wire-compatible with other MLS deployments.
- **External commits for public-joinable hubs.** MLS supports joining a group via an ExternalCommit without being invited. Llamenos has no public-joinable hubs at this time; the feature is unimplemented.
- **Group splits / subgroups.** Multi-team hubs could benefit from per-team MLS subgroups. Deferred; current scale is manageable with one group per hub.
- **Cross-device transparent MLS state sync.** Each device holds its own MLS state. A user with multiple devices has multiple memberships (one per device) and pays the state-size cost per device. Cross-device sync (one user, multiple devices, one MLS membership) is not possible in the MLS model — it violates TreeKEM's per-leaf-private-path guarantee. Users with multiple devices simply have multiple MLS memberships; the ergonomics are handled at the UI layer.
- **Post-quantum signatures for the Tier 0 audit log.** The Tier 0 audit log uses Ed25519 schnorr signatures. Like MLS authentication, these are live-message protection, not archived-ciphertext protection. No PQ upgrade in Tier 6.
- **Device-bound session credentials (DBSC) hardware binding of MLS state.** Tier 4 may explore DBSC; orthogonal to Tier 6.
- **Mobile MLS via WireFoundation SDK.** Llamenos is web-first. Mobile is a future product; if/when it happens, the mobile MLS library will be separately selected.
- **Support for MLS ciphersuites other than XWing and ML-KEM-1024 variants.** If the IETF standardizes additional hybrids (e.g. `ML-KEM-768 + P-256`), we add them via ciphersuite upgrade flow, not via a parallel shipping ciphersuite.
- **Real-time MLS commit rate limiting on the server side.** Out of scope for the initial ship; add if abuse is observed.
- **Automatic provable-delete horizon.** Tier 6 ships admin-triggered epoch purges only. Time-based auto-purge (e.g. "delete everything from epochs older than 90 days") is a future enhancement.

## Success criteria

The spec is complete when the implementation of the accompanying plan achieves all of the following:

1. **ts-mls vendored and pinned.** `vendor/ts-mls/` contains a full source tree at a documented commit SHA; `package.json` resolves `ts-mls` via `file:./vendor/ts-mls`; SLSA provenance covers the vendored subtree.

2. **MLS group lifecycle end-to-end.** A hub with `tier6Enabled: true` can:
   - Create a fresh MLS group with ciphersuite `MLS_256_XWING_AES256GCM_SHA512_Ed25519`.
   - Add a second device and confirm both converge on epoch 1 with matching TreeHash.
   - Remove a device; the removed device cannot decrypt new epoch data.
   - Run a daily background Update Commit without disrupting users.

3. **PQ hybrid verified.** Unit tests confirm that a mocked X25519 failure or a mocked ML-KEM failure each individually fail-close (no silent wrong-key decrypt); both primitives must succeed for a correct epoch derivation.

4. **SFrame integration.** A voice call in a Tier 6 hub derives its SFrame base key from `MLS.exportSecret(LABEL_SFRAME_BASE_KEY, callId, 32)`. Epoch advance during a call triggers fresh key derivation on the next call.

5. **`items_key` derivation.** The per-user `items_key` is no longer stored as a database column for Tier 6 hubs; it is derived on demand from the current epoch's exporter secret. Historical notes continue to be decryptable via cached epoch keys.

6. **Fingerprint verification UX ships FIRST.** The 7-emoji SAS flow is live for Tier 3 hubs before any MLS code is added. A device verified under Tier 3 retains its verification after Tier 6 opt-in.

7. **Ciphersuite downgrade rejected.** An adversarial test injects a Commit with a different ciphersuite than the hub's initial ciphersuite; the client rejects with a structured error.

8. **Strfry delivery.** MLS messages ride on Nostr events kinds 20001–20003 with the documented tags. Server-side filter rejects malformed entries. Client-side chain verification gates every processing step.

9. **Provable delete.** A note created with `provableDelete: true` in epoch N becomes cryptographically unrecoverable on every device after an admin-triggered `mls_epoch_purge` advances the epoch past N.

10. **Audit commissioned.** An external cryptography firm has reviewed the vendored ts-mls source, the Llamenos integration code, and the PQ ciphersuite path. Findings are remediated. Audit report is published to `docs/security/`.

11. **Staged rollout verified.** Month 1 dogfoods on internal hub; Month 2 offers opt-in; Month 3 defaults-on for new hubs only if zero Month-1/Month-2 incidents. Existing Tier 3 hubs remain supported indefinitely.

12. **All existing tests pass.** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit`, `bunx playwright test tests/api`, `bunx playwright test tests/ui` all green. Mixed-mode deployment (Tier 3 + Tier 6 hubs side by side) is covered by regression tests.

13. **Bundle size budget respected.** Tier 6 adds ≤500 KB gzipped to the client bundle compared to Tier 3 baseline. Measured in the CI build step; a budget check fails the build if exceeded.

14. **Documentation.** `docs/protocol/llamenos-protocol.md` gains a "Tier 6 — MLS + PQ" section; `docs/architecture/E2EE_ARCHITECTURE.md` is updated with the post-Tier-6 four-layer diagram; `docs/security/SUPPLY_CHAIN_HARDENING.md` is updated with the vendored ts-mls provenance entry; an audit report is added to `docs/security/` on completion.

Every success-criteria item has a corresponding test or artifact and is verifiable by an independent reviewer.
