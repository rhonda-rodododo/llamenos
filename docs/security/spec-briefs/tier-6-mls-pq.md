# Tier 6 — MLS + Post-Quantum Migration (Spec Brief)

**Date:** 2026-04-10
**Master doc:** [`../SECURITY_IMPROVEMENTS_MASTER.md`](../SECURITY_IMPROVEMENTS_MASTER.md) §3.5.2 (Wire MLS), §3.5.3 (MLS brief), §3.10 (Tuta PQ), §6.3, §7 Tier 6
**Effort:** Months — optional long-term evolution
**Depends on:** Tier 1 (HPKE is the MLS pre-requisite), Tier 3 (per-device keys become MLS members), Tier 5 (SFrame key derivation moves to MLS exporter)
**Status:** Ready for spec authoring — but lowest priority; not load-bearing

## Goal

Two related long-term upgrades, both optional and both dependent on every prior tier:

1. **Migrate hub state to MLS (RFC 9420)** via Wire's `core-crypto` WASM library. Hub membership becomes an MLS group; hub-key rotation becomes an MLS `Commit` advancing a group epoch. Per-device keys from Tier 3 become MLS members. SFrame keys for voice calls derive from the MLS `exporter_secret`. Llamenos gets continuous post-compromise security + standardized group crypto.

2. **Add a post-quantum hybrid layer** following the TutaCrypt pattern: each device gets an ML-KEM-1024 keypair alongside its X25519 keypair. HPKE / key-wrap operations combine three shared secrets via HKDF: X25519-identity-DH, X25519-ephemeral-DH, and ML-KEM KEM. Secure as long as **either** X25519 or ML-KEM-1024 survives. Defeats "harvest now, decrypt later" adversaries.

Both are well-understood but not currently critical. Ship only after Tiers 0–5 are stable.

## Why this matters

### 6.1. Why MLS

Our hub-key model (after Tier 3) is:
- Random symmetric hub key.
- HPKE-wrapped per-device individually.
- Rotated on departure via Cascading Lazy Key Rotation.

This is **structurally pre-MLS** — it's literally the design MLS was standardized to replace. MLS (RFC 9420, July 2023) gives us:

- **O(log n) group operations** via TreeKEM. Our current O(N) rewrap cost doesn't matter at small hubs (tens of members) but starts to matter at hundreds.
- **Continuous post-compromise security.** Any member's Update proposal injects fresh entropy into the group state. A compromised device is eventually healed.
- **Standardized epoch/commit model** with formal security proofs (Alwen et al. CRYPTO 2020).
- **SFrame key derivation for free.** MLS `exporter_secret` can derive SFrame keys (the `draft-ietf-mls-sframe` pattern). Membership change = new epoch = new SFrame key, automatically.
- **Interop** with other MLS-using systems (Wire, Cisco Webex, Matrix once it migrates, Discord DAVE-adjacent).

**Wire ships MLS in production in the browser today** via `core-crypto` — a Rust implementation of OpenMLS compiled to WASM. We don't need to implement MLS ourselves; we use Wire's implementation.

**The hard problem MLS doesn't solve:** local storage of MLS group state. Each client maintains per-epoch state (TreeKEM private keys, epoch secrets, pending proposals). This state needs to be persisted across reloads. Wire's `core-crypto` encrypts it under a user-supplied key and stores in IndexedDB. We'd follow the same pattern, wrapping under our non-extractable CryptoKey layer from Tier 1.

### 6.2. Why PQ hybrid

"Harvest now, decrypt later" is a real adversary capability for crisis hotline data. Call notes that identify abuse victims, right-wing extremism reports, or political dissidents may remain interesting to state actors for decades. Classical ECC will be broken by a sufficiently large quantum computer — the timeline is disputed (10? 20? 30 years?) but the conservative assumption is "within the archival lifetime of our data".

**Tuta (TutaCrypt, March 2024) is the concrete reference implementation.** Their hybrid:
- Two keypairs per user: X25519 + Kyber-1024 (now ML-KEM-1024 per NIST FIPS 203).
- On send, derive three shared secrets:
  - `DHI` = X25519(sender identity, recipient identity)
  - `DHE` = X25519(sender ephemeral, recipient identity)
  - `SSPQ` = ML-KEM shared secret via recipient's ML-KEM public key
- Feed all three into HKDF-SHA-256 → symmetric key.
- Use symmetric key with AES-256 (Tuta) or XChaCha20-Poly1305 (us).
- **Secure as long as either X25519 OR ML-KEM-1024 remains unbroken.**

Because we have the `items_key` indirection from Tier 1, the PQ migration is cheap at the data level: we re-wrap the per-user `items_key` with PQ hybrid, and every note underneath stays decryptable. Zero per-note re-encryption.

**Why not sooner?** Two reasons:
1. ML-KEM-1024 keys and ciphertexts are ~1.5 KB each. Adding them to every envelope significantly bloats storage. Acceptable but worth planning.
2. Browser JS/WASM ML-KEM implementations exist (`mlkem`, `@noble/post-quantum`) but are less battle-tested than our AEAD primitives. Waiting for more maturity is prudent.

## Current Llamenos state (post Tiers 0–5)

After Tiers 0–5 are complete, the starting state is:
- Per-device X25519 + Ed25519 non-extractable keys in IDB.
- Hub key HPKE-wrapped per device, rotated via CLKR.
- Sigchain for user + hub + device state.
- Per-call SFrame key HPKE-wrapped per participant device.
- `items_key` indirection at per-user layer.
- WebAuthn PRF unlock.
- Split-origin delivery + sandboxed crypto iframe.

Tier 6 adds on top:
- Wire `core-crypto` WASM as a new dependency.
- MLS group state per hub, stored in IDB (encrypted under existing non-extractable CryptoKey).
- ML-KEM-1024 per-device keypair (generated at device enrollment; added to sigchain).
- PQ-hybrid envelope format (new version).
- Fingerprint verification UX (must ship BEFORE PQ — Tuta lesson).

## Proposed approach

### 6.3. MLS migration path

**Step 1 — Add `core-crypto` WASM as a dependency.**
```
package.json: "@wireapp/core-crypto": "^latest-audited-version"
```
Verify Wire's audit posture and pick a version Cryspen has reviewed.

**Step 2 — MLS group per hub.**
Each hub gets an MLS group. Group members are user **devices** (not users). When a user has 3 devices across 2 hubs, that user is represented 3× in each of the 2 hubs (6 total memberships).

**Step 3 — Group creation.**
When a hub is created:
1. Admin's device initializes an MLS group via `core-crypto.newConversation(hubId, config)`.
2. Config: ciphersuite `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519` (the X25519 + ChaCha20-Poly1305 profile). Pick MLS ciphersuite 0x0003.
3. First Commit establishes the group with just the admin's device.
4. Group state serialized and stored in IDB.

**Step 4 — Member addition.**
When admin adds a volunteer:
1. Admin fetches volunteer's device MLS KeyPackages (pre-published per-device).
2. Admin's `core-crypto` creates an `Add` proposal + a `Commit` that includes the proposal.
3. Commit produces a `Welcome` message for the new device(s) + a `Commit` message for existing members.
4. Server distributes both via the auth-facade / Nostr relay.
5. Volunteer devices process `Welcome` → they're now group members with the current epoch secret.
6. Admin emits a `hub_membership_add` sigchain entry referencing the new epoch number (for audit + Albrecht #1 defense).

**Step 5 — Member removal.**
Admin creates a `Remove` proposal + `Commit`. Remaining members process and advance to the new epoch. Removed device cannot decrypt the new epoch — cryptographic revocation.

**Step 6 — Member update (PCS).**
Periodically (or on demand), each member creates an `Update` proposal with a fresh HPKE keypair. Advances the group state path, injects fresh entropy. Continuous post-compromise security.

**Step 7 — Epoch secret → SFrame key (Tier 5 integration).**
```typescript
const exporterSecret = mlsGroup.exportSecret(
  label: "SFrame 1.0 Base Key",
  context: utf8Bytes(callId),
  length: 32
)
const sframeBaseKey = await crypto.subtle.importKey('raw', exporterSecret, 'HKDF', false, ['deriveKey'])
// Use sframeBaseKey to derive per-call SFrame keys
```

When the group advances epoch (member add/remove/update), the exporter secret changes automatically. Calls started in the new epoch get fresh keys with no explicit key distribution.

**Step 8 — Data encryption.**
Notes/messages can either (a) continue using per-note random keys HPKE-wrapped per device, or (b) use MLS application messages directly. Option (a) preserves our per-note forward secrecy exactly as today. Option (b) leverages MLS's `encryption_secret` for free but loses per-note independence. **Recommend option (a) — keep the data model, use MLS for hub membership only.**

**Migration from Tier 3 hub keys:**
- Read-and-convert: each device locally converts its Tier 3 hub-key state into an initial MLS group state, with admin's device as the sole initial member, then re-adds every other device via MLS.
- Or clean-cut if pre-production.

### 6.4. Post-quantum hybrid

**Step 1 — Pick the library.** `@noble/post-quantum` (ML-KEM-1024, ML-DSA) is the simplest bet as of 2026 — same author as `@noble/curves`, consistent API. Check its audit posture before adopting.

**Step 2 — Per-device ML-KEM keypair.**
Extend Tier 3 device enrollment to also generate an ML-KEM-1024 keypair:
```typescript
import { ml_kem1024 } from '@noble/post-quantum/ml-kem'
const { publicKey, secretKey } = ml_kem1024.keygen()
// Store secretKey in IDB (cannot be non-extractable — not a WebCrypto algo)
// Public key goes into the device's sigchain entry
```

**Note:** ML-KEM is not yet in WebCrypto so it cannot be non-extractable. The secret key lives as raw bytes in the crypto iframe's memory, wrapped under the existing non-extractable AES-KW KEK at rest in IDB. This is a step backward on the non-extractable dimension for this one key class.

**Step 3 — Hybrid envelope format.**
Envelope version `v3` (after v1 ECIES, v2 HPKE):
```typescript
type HybridEnvelope = {
  version: 'v3'
  suite: 'x25519-mlkem1024-hkdf-sha256-chacha20poly1305'
  x25519_enc: Uint8Array      // HPKE encapsulated key (classical)
  mlkem_ct: Uint8Array        // ML-KEM ciphertext
  aead_ct: Uint8Array         // ChaCha20-Poly1305 ciphertext
  label: CryptoLabel
}
```

**Step 4 — Three-secret HKDF combine.**
```typescript
const dhI = await x25519.sharedSecret(senderIdentity, recipientIdentity)
const dhE = await x25519.sharedSecret(senderEphemeral, recipientIdentity)
const { sharedSecret: ssPQ, ciphertext: mlkemCt } = ml_kem1024.encapsulate(recipientMlKemPub)

const combined = hkdfSha256(
  ikm: concat(dhI, dhE, ssPQ),
  salt: undefined,
  info: utf8Bytes(LABEL_HYBRID_COMBINE_V1),
  length: 32
)
const aeadKey = await crypto.subtle.importKey('raw', combined, 'HKDF', false, ['deriveKey'])
combined.fill(0)

// Then seal the plaintext under aeadKey using ChaCha20-Poly1305 or AES-GCM-256.
```

**Step 5 — `items_key` re-wrap.**
Because of Tier 1's `items_key` indirection, we only re-wrap the per-user `items_key` under the PQ hybrid envelope. Every underlying note stays encrypted under its existing per-note key. Migration is O(users), not O(notes).

**Step 6 — Fingerprint verification UX (CRITICAL — Tuta lesson).**
Before shipping PQ hybrid, ship **key fingerprint verification UX**. Users must be able to verify their counterparts' keys out of band (SAS emoji, QR code). Tuta shipped TutaCrypt in March 2024 with TOFU only and had to backfill fingerprint verification in August 2025. Avoid this.

**Step 7 — Staged rollout.**
- New accounts get PQ keypairs from day one.
- Existing accounts get PQ keypairs on next device enrollment.
- Envelope format v3 co-exists with v2; clients read both, write v3 for new data.

## Open design questions

### For MLS

1. **Ciphersuite.** `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519` (0x0003) or the AES variant? Recommend X25519 + ChaCha20-Poly1305 for consistency with Tier 1.
2. **MLS for messages vs just hub state?** Recommend just hub state + SFrame key derivation; keep notes/messages on the existing per-artifact model.
3. **Storage of MLS group state.** `core-crypto` handles this internally but the key wrapping choice is ours.
4. **Commit frequency for PCS.** Daily auto-update? On demand? Recommend daily background Update commit per device.
5. **Interop.** Bridging to other MLS systems someday? Out of scope but keep the ciphersuite choice interoperable.
6. **Subteams / sub-hubs.** MLS supports "external commits" for joining without an invite; use if we ever have public-joinable hubs.
7. **Migration trigger.** Per-hub opt-in, global flag, or automatic? Recommend per-hub opt-in for MVP.

### For PQ hybrid

1. **ML-KEM parameter set.** 512, 768, or 1024? 1024 is conservative (Tuta's choice). Recommend 1024 for long-term confidentiality.
2. **Signing: add ML-DSA or Falcon?** Classical Ed25519 remains fine in the hybrid for authenticity (signing is less threatened by HNDL than encryption). Recommend defer — add later if needed.
3. **Storage overhead.** ML-KEM-1024 public key is ~1.5 KB, ciphertext ~1.5 KB. Measure DB growth and set expectations.
4. **Backwards compatibility.** `items_key` indirection minimizes the blast radius. Document.
5. **Fingerprint verification UX.** Short authentication string, emoji, or full hex comparison? Recommend 7-emoji SAS.
6. **Timing of rollout.** Tier 6 is not urgent but the fingerprint UX prerequisite is worth considering earlier.

## Concrete scope

**MLS in scope:**
- Add `@wireapp/core-crypto` WASM dependency.
- Define MLS group lifecycle per hub.
- Member add/remove/update flows.
- Sigchain integration (epoch numbers in hub_membership entries).
- `exporter_secret` integration with SFrame (Tier 5).
- Local MLS state persistence.
- Migration from Tier 3 hub keys.
- Tests + audit prep.

**PQ in scope:**
- Per-device ML-KEM-1024 keypair generation.
- Envelope v3 format.
- Three-secret HKDF combine.
- Fingerprint verification UX (SAS emoji).
- `items_key` re-wrap for PQ.
- ML-KEM secret storage under KEK wrap.

**Out of scope:**
- MLS application messages for notes/messages.
- ML-DSA signatures (stick with Ed25519).
- Full PQ migration in one step (staged rollout).
- Interop with other MLS systems.

## Success criteria

**MLS:**
1. `core-crypto` WASM loads in the sandboxed crypto iframe.
2. Hub creation initializes an MLS group with the creator's device.
3. Member add → `Welcome` + `Commit` → new member processes successfully.
4. Member remove → new epoch; removed device cannot decrypt new content.
5. Daily Update commit rotates path secrets without disrupting users.
6. SFrame calls use MLS-derived keys from `exporter_secret`; epoch change = fresh SFrame key.
7. MLS state survives reload.

**PQ:**
8. New device enrollment generates an ML-KEM-1024 keypair.
9. New writes use v3 envelope format.
10. Hybrid decrypt falls back to X25519-only if ML-KEM verification fails (or vice versa) — test both legs.
11. Fingerprint verification UX lets users compare SAS codes out-of-band.
12. Migration re-wraps `items_key` without touching any note data.
13. Typecheck + build + all tests pass.

## Trade-offs and anti-patterns

**Do:**
- Use Wire's `core-crypto` — don't implement MLS yourself.
- Use `@noble/post-quantum` ML-KEM — don't roll your own.
- Ship fingerprint verification UX BEFORE PQ.
- Use the `items_key` indirection to make migration cheap.
- Keep per-note forward secrecy — don't let MLS absorb that.

**Don't:**
- Migrate notes to MLS application messages — lose per-note FS.
- Skip fingerprint verification UX.
- Use ML-KEM-512 (too weak for long-term).
- Store ML-KEM secret keys unwrapped.
- Assume ML-KEM libraries are as mature as classical ones — hedge.

## Pointers to primary sources

**Must read:**
- RFC 9420 MLS: https://www.rfc-editor.org/rfc/rfc9420.html
- OpenMLS book: https://openmls.tech/
- Wire `core-crypto`: https://github.com/wireapp/core-crypto
- Cryspen OpenMLS overview: https://cryspen.com/openmls/
- Tuta TutaCrypt: https://tuta.com/blog/post-quantum-cryptography
- `@noble/post-quantum`: https://github.com/paulmillr/noble-post-quantum
- NIST FIPS 203 ML-KEM: https://csrc.nist.gov/pubs/fips/203/final
- Alwen et al. MLS formal analysis (CRYPTO 2020): https://eprint.iacr.org/2019/1189

**Optional:**
- Cisco `mlspp` C++ for cross-implementation check: https://github.com/cisco/mlspp
- Signal PQXDH + Sparse PQ Ratchet (for comparison): https://signal.org/docs/specifications/pqxdh/

## Related work in the repo

- Tier 1 — HPKE is the MLS pre-requisite; `items_key` makes PQ migration cheap.
- Tier 3 — per-device keys become MLS members.
- Tier 5 — SFrame keys derive from MLS `exporter_secret`.
- `docs/protocol/llamenos-protocol.md` — will need a new "Post-Tier-6" section.
- `docs/architecture/E2EE_ARCHITECTURE.md` — update to reflect MLS layer.

## Final notes

Tier 6 is long-term work. It should NOT block Tiers 0–5. But the architecture of every prior tier has been chosen to make Tier 6 a smooth extension rather than a rewrite — `items_key` indirection, per-device keys, HPKE primitives, SFrame-from-exporter integration. When Tier 6 lands, it should feel like a natural next step, not a pivot.

Ship order suggestion: MLS first (unlocks SFrame-from-exporter, PCS, interop). PQ second (HNDL defense, less urgent). Both can be done per-hub opt-in before going universal.
