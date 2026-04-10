# Tier 3 — Per-Device Keys & Sigchain (Spec Brief)

**Date:** 2026-04-10
**Master doc:** [`../SECURITY_IMPROVEMENTS_MASTER.md`](../SECURITY_IMPROVEMENTS_MASTER.md) §3.8 (Keybase), §5.3, §6.1, §7 Tier 3
**Effort:** ~1 month of real work — this is the load-bearing architectural change
**Depends on:** Tier 0 (signed sigchain entries), Tier 1 (non-extractable CryptoKey + HPKE), Tier 2 (WebAuthn PRF unlock)
**Status:** Ready for spec authoring

## Goal

Pivot Llamenos from **"one identity key per user"** (the Standard Notes anti-pattern) to **"one keypair per device + a Per-User Key (PUK) boxed per device + a user sigchain signed by device keys"** — the Keybase model. This is the single most important architectural change in the entire roadmap.

After this tier:
- Each device (browser profile, phone app) has its own X25519 + Ed25519 keypair generated locally. The private keys never leave the device.
- The user's cross-device identity is a 32-byte PUK, HPKE-wrapped individually to each of the user's active device pubkeys.
- Adding a device is a signed sigchain entry: an existing device signs "new device X has pubkey Y". Hub members verify the sigchain before trusting new device memberships.
- Paper recovery keys are cryptographically identical to devices, just BIP39-rendered.
- Hub keys are distributed via HPKE-wrap per device (not per user), and rotated via **Cascading Lazy Key Rotation** on member/device removal.
- Revoking a stolen laptop is a sigchain `device_remove` entry + a hub-key rotation.

## Why this matters

Our current design: one `nsec` per user, unlocked on each device by the same multi-factor KEK, hub key wrapped once per user. Standard Notes has exactly this shape and their Cure53 audit + community have identified it as a known weakness:

- **Single credential compromise = all devices forever.** If any one device is compromised and the identity key is exfiltrated, every other device the user owns is also compromised for all historical data.
- **No true device revocation.** You can't "kick off" a lost laptop without rotating the whole identity key and re-wrapping everything.
- **Multi-device coordination is awkward.** Our current ephemeral-ECDH provisioning room pattern is clever but doesn't give us a tamper-evident record of which devices the user has ever had.

Keybase solved all three with **per-device keys + sigchain + PUK**. The design is publicly documented, NCC-audited, and praised specifically for its defense against phantom-user injection — the same attack class Matrix was hit by in Albrecht #1.

Combined with Tiers 1 and 2, Tier 3 gives us:
- **Non-extractable per-device keys.** XSS on one device cannot exfiltrate any key to attack another device.
- **Per-device unlock via WebAuthn PRF.** Each device's passkey unlocks only that device.
- **Tamper-evident device history.** A stolen laptop that gets revoked can't continue to receive new hub-key rotations — the sigchain cryptographically excludes it.
- **Hub membership that the server can't forge.** Albrecht #1 is fully closed: a server claiming "volunteer X has a new device" is rejected unless the claim is signed into the user sigchain by an existing verified device.

## Current Llamenos state

**Files to refactor or replace:**

- `src/client/lib/key-store-v2.ts` — currently stores one user identity key. Becomes per-device.
- `src/client/lib/crypto-worker.ts` — signing + decrypting operations shift from user-scoped to device-scoped.
- `src/client/lib/hub-key-manager.ts` — wraps hub key per user; becomes per device.
- `src/server/services/audit-service.ts` (or equivalent Epic 77 primitive) — extended with typed sigchain entries (depends on Tier 0).
- `src/server/db/schema.ts` — new tables: `user_devices`, `user_sigchain_entries`, `hub_ptk_generations`, `device_recovery_envelopes` etc.
- `src/server/routes/auth-facade.ts` — device enrollment endpoints.
- `src/client/lib/device-provisioning.ts` (current ephemeral ECDH room) — gets replaced or refactored.
- `src/client/lib/auth.tsx` — device context (which device am I on) as a first-class concept.
- `src/shared/schemas/sigchain.ts` (new) — typed sigchain entry schemas.
- `src/shared/schemas/devices.ts` (new) — device enrollment schemas.

**Existing primitives to extend:**
- Hash-chained audit log (Epic 77) — becomes the sigchain substrate.
- PR #48/PR #50 device management — PR #48 added "device" as a concept in `user_security_prefs`; this tier makes it the primary key-holding unit.
- Multi-factor KEK (Tier 2 upgraded) — now wraps the per-device key, not a shared user identity.

**Watch-outs:**
- This is the **biggest architectural change** in the roadmap. Coordinate with everything.
- Pre-production means no data migration needed, but UX migration matters.
- The spec must not break cross-hub identity. A user in three hubs is still one user; they just have N devices.

## Proposed approach

### 3.1. Device identity

Each device, at enrollment:

```typescript
// Generate non-extractable keypair — the device's signing + encryption keys.
const signingKeypair = await crypto.subtle.generateKey(
  { name: 'Ed25519' },  // native where available; fall back to P-256 ECDSA
  false,
  ['sign', 'verify'],
)
const encryptionKeypair = await crypto.subtle.generateKey(
  { name: 'X25519' },  // native where available; fall back to P-256 ECDH
  false,
  ['deriveKey', 'deriveBits'],
)

// Persist non-extractable CryptoKeys directly in IDB:
await idb.put('device_signing_priv', signingKeypair.privateKey)  // non-extractable
await idb.put('device_encryption_priv', encryptionKeypair.privateKey)  // non-extractable

// Export public halves (these ARE extractable by design):
const signingPub = await crypto.subtle.exportKey('raw', signingKeypair.publicKey)
const encryptionPub = await crypto.subtle.exportKey('raw', encryptionKeypair.publicKey)

// Generate a stable device ID (a random UUID or a hash of the signing pubkey):
const deviceId = uuid()
```

The KEK from Tier 2 (WebAuthn PRF / OPAQUE / recovery phrase) wraps a small **device bootstrap envelope** containing metadata + an AES-KW wrapping key. It does NOT wrap the device private keys directly — those are non-extractable and stay in IDB unconditionally. The KEK authenticates the session; it doesn't protect the key material at rest (the browser's crypto sandbox does).

### 3.2. Per-User Key (PUK)

**Concept (Keybase):** The PUK is a 32-byte random seed that represents the user's cross-device identity. It is HMAC-SHA256-derived into (a) an EdDSA signing key, (b) an X25519 DH key, (c) a symmetric SecretBox key. Any operation that needs "the user's identity" — not "this device's identity" — uses a PUK-derived key.

The PUK seed itself is **never unwrapped** — it only exists as a plaintext value transiently when a new device is being enrolled. It lives in IDB as an HPKE envelope wrapped individually to each device's X25519 pubkey.

**PUK initial creation:** At account creation, the first device:
1. Generates a 32-byte random PUK seed.
2. HPKE-wraps the PUK seed to its own X25519 pubkey, stores in IDB + server as `puk_envelope_gen_1_device_1`.
3. Emits a `puk_rotate(gen=1, device_commitments=[device_1_pub])` sigchain entry.

**Adding a second device:**
1. Existing device reads its PUK envelope, HPKE-opens to recover the seed transiently.
2. HPKE-wraps the seed to the new device's pubkey → new envelope.
3. Zero the in-memory seed.
4. Emit a `device_add(new_device_id, pubkey, signed_by=existing_device_id)` sigchain entry.
5. Upload the new envelope to the server, indexed by `(user_id, new_device_id, puk_gen=1)`.

**PUK rotation** (on device removal):
1. Existing device generates a new 32-byte PUK seed.
2. HPKE-wraps to every remaining device's pubkey (NOT the removed device).
3. Optionally wraps the OLD PUK seed under a symmetric key derived from the NEW PUK seed (so current members can still decrypt old-PUK-encrypted data).
4. Emit `device_remove(device_id, signed_by_admin)` and `puk_rotate(gen=2, device_commitments=[remaining devices])` sigchain entries.

### 3.3. User sigchain

**Extends Epic 77 hash-chained audit log.** The audit log already provides hash-chaining. Tier 3 adds typed, signed entries specific to the user identity + device lifecycle.

**Entry types:**

```typescript
type SigchainEntry =
  | { type: 'user_init', user_id: string, initial_device_id: string, initial_device_pubkey: Uint8Array, puk_gen_1_commitment: Uint8Array }
  | { type: 'device_add', new_device_id: string, new_device_signing_pubkey: Uint8Array, new_device_encryption_pubkey: Uint8Array, display_name: string, signed_by_device_id: string }
  | { type: 'device_remove', removed_device_id: string, reason: 'user_initiated' | 'lost' | 'stolen' | 'compromised' | 'rotation', signed_by_device_id: string }
  | { type: 'puk_rotate', new_gen: number, device_commitments: Array<{ device_id: string, envelope_hash: Uint8Array }> }
  | { type: 'hub_membership_add', hub_id: string, user_id: string, role: Role, signed_by_admin_device_id: string }
  | { type: 'hub_membership_remove', hub_id: string, user_id: string, signed_by_admin_device_id: string }
  | { type: 'hub_ptk_rotate', hub_id: string, new_gen: number, device_commitments: Array<...>, signed_by: string }
  | { type: 'recovery_group_enroll', hub_id: string, threshold: number, share_commitments: Uint8Array[] }
  | { type: 'recovery_initiated', target_user_id: string, by_admin_device_id: string }
  | { type: 'recovery_completed', target_user_id: string, new_device_id: string, participating_admin_device_ids: string[] }

type SigchainEntryEnvelope = {
  prev_hash: Uint8Array  // chain link
  seq: number
  entry: SigchainEntry
  signature: Uint8Array  // Ed25519 signature over (prev_hash || seq || entry)
  signed_by_device_pubkey: Uint8Array  // for verification lookup
}
```

**Verification** (every client, on every hub-key operation):
1. Fetch the sigchain.
2. Verify hash chain: each `prev_hash` matches the hash of the previous entry.
3. Verify every signature with the claimed `signed_by_device_pubkey`.
4. Verify that each `signed_by_device_pubkey` was registered as a valid device at or before that entry's `seq` (walking the chain).
5. Verify that `device_add` entries are signed by an existing valid device.
6. Verify that `hub_membership_*` entries are signed by a device belonging to a user with admin role at that hub at that `seq`.
7. Maintain a cache of verified state keyed by last-known-good-seq for performance.

### 3.4. Hub key per device (not per user)

Currently: hub key wrapped once per user via `LABEL_HUB_KEY_WRAP`.

**New model:** hub key wrapped once per **device**, using HPKE with `info = LABEL_HUB_KEY_WRAP`.

When a user has 3 devices, they have 3 individual hub-key envelopes — one per device. Adding a 4th device requires an existing device to HPKE-wrap the hub key to the 4th device's pubkey. The hub operator (admin) does NOT need to participate for device additions *within* an existing user's set of devices — any existing device of that user can do the wrap.

**Why per-device vs per-user:**
- Stolen laptop → revoke that device specifically without affecting the user's other devices.
- Each device can be independently keyed for Tier 6's MLS migration (where MLS members are devices, not users).
- XSS on one device cannot read hub keys on another device.

### 3.5. Cascading Lazy Key Rotation (CLKR)

**Keybase PTK pattern.** When a member or a device is removed from a hub:

1. Generate a new hub PTK generation (gen = N+1).
2. HPKE-wrap the new hub key to every remaining device's pubkey.
3. **Critical: encrypt the previous generation's hub key under the new generation's hub key** and store. This lets current members still decrypt historical content without needing to keep the old key around outside the envelope.
4. **Lazy:** do NOT re-encrypt all historical notes. Existing notes stay encrypted under gen-N. Current members derive gen-N from gen-(N+1) via the wrapped-previous-gen chain when they need to decrypt old content.
5. **Cascading:** if User X is removed from Hub A, and User X is also in Sub-Hub B that inherits membership from Hub A, rotate Sub-Hub B too.
6. Emit a `hub_ptk_rotate(hub_id, new_gen, device_commitments)` sigchain entry signed by the initiating admin.

**The cascading part only applies** if we have nested hub hierarchies — currently we don't, but plan for it.

### 3.6. Cross-signing for device trust

**Matrix cross-signing adapted.** Each user has a **master signing keypair** — an Ed25519 keypair that is ONLY used to sign the user's own device signing pubkeys. The master private key lives in IDB as a non-extractable `CryptoKey`, but is *additionally* wrapped under the Recovery Group envelope (Tier 2) for admin-assisted recovery.

When a user verifies another user's master pubkey once (SAS code, QR scan, out-of-band), they sign it with their own user-signing key. Future devices of that user are transitively trusted because they're signed by the verified master key.

For Llamenos: when admin Alice adds volunteer Bob to a hub, Alice verifies Bob's master pubkey (maybe via an out-of-band channel like a short-lived code or a physical QR) and signs it into her own trust store. Bob's subsequent device additions propagate trust through his master key.

This replaces the ephemeral-ECDH-provisioning-room pattern with a tamper-evident one.

### 3.7. Paper key = device

**Keybase lesson.** A paper recovery key is cryptographically identical to a device:
1. Generate a fresh X25519 + Ed25519 keypair.
2. Serialize the private-key seeds as BIP39 words.
3. Emit a `device_add(paper_recovery, signed_by_existing_device)` sigchain entry.
4. Show the phrase to the user ONCE.
5. HPKE-wrap the PUK to the paper key's pubkey and store as an envelope.

Recovery: user types the phrase → derive keypair → fetch PUK envelope → unwrap → use to bootstrap a real new device.

**Note:** this is *different* from the Diceware recovery phrase in Tier 2. Tier 2's phrase unlocks the KEK; Tier 3's paper key IS a device. Both can coexist; recommend unifying into one pattern where the "recovery phrase" deterministically derives a paper device keypair (no separate Argon2id path).

## Open design questions

1. **Device ID stability.** UUID or hash of signing pubkey? UUID is simpler, hash is self-verifying. Pick one.
2. **Master key vs first-device key.** Does the user have a separate "master" Ed25519 key (cross-signing root) that signs device keys, or does the first device's signing key serve as master? Matrix has the former; Keybase uses the latter. Recommend separate master for clearer recovery semantics.
3. **Master key recovery.** If the master key is in non-extractable IDB on one device and that device dies, the user has lost the ability to sign new device additions. The Recovery Group envelope must cover the master key, not just the PUK.
4. **Sigchain storage.** Server-hosted (cachable) or Nostr relay (resilient)? Recommend server-hosted primary + optional Nostr relay mirror for audit.
5. **Sigchain verification performance.** Caching strategy? Full re-verify on every hub-key op is O(N). Cache up to `verified_seq` and only re-verify new entries.
6. **Device display metadata.** Encrypted or plaintext? Device display name is PII-like (e.g., "Alice's Work Laptop"). Encrypt.
7. **Paper key vs recovery phrase unification.** Keep Tier 2's Diceware phrase separate or unify? Recommend unify — one "recovery phrase" that deterministically derives a paper device keypair.
8. **Cross-signing verification UX.** SAS codes (7-emoji or decimal) or QR only? Recommend both, with QR as primary for same-room verification.
9. **How do hub admins cross-sign volunteer devices?** Does admin verification flow through the admin's cross-signing, or is hub membership itself the trust gate? Decide.
10. **Migration path for existing users.** Pre-production means no prod users, but dev/test accounts exist. Define a clean-cut migration.
11. **MLS on-ramp.** Tier 6 may move hub state to MLS. How does Tier 3's per-device hub-key model map to MLS members? Recommend Tier 3's devices are the future MLS members — no structural change at Tier 6.

## Concrete scope

**In scope:**
- Per-device X25519 + Ed25519 keypair generation and IDB storage.
- Per-user master signing keypair.
- PUK creation + per-device HPKE wrapping + rotation.
- Typed, signed sigchain entries (extends Tier 0 primitive).
- Sigchain verification layer with caching.
- Device enrollment endpoints (auth facade).
- Hub key wrapping per-device instead of per-user.
- Cascading Lazy Key Rotation implementation.
- Cross-signing for device trust (SAS / QR verification UX).
- Paper key = device (unifying Tier 2's recovery phrase).
- Master key recovery via Recovery Group envelope.
- UI: device list, device verification status, "add device" flow, "remove device" flow.
- Data model migrations (pre-production clean-cut).
- Unit + API + UI tests.

**Out of scope:**
- MLS migration (Tier 6).
- Voice E2EE (Tier 5).
- Sharing hub state with outside reviewers (future tier).
- Backwards-compat shims (pre-production, clean cut).

## Success criteria

1. Each device has its own X25519 + Ed25519 non-extractable keypair in IDB.
2. User has a PUK seed that never exists as bytes in JS except during enrollment.
3. Adding a second device via QR/SAS flow works; both devices can decrypt all user content.
4. Removing a device emits a sigchain entry + triggers PUK rotation + hub-key rotation for every hub the user is in; the removed device can no longer derive new hub keys.
5. Stolen-laptop scenario: revoking the device cryptographically prevents future reads even if the device retains network access.
6. Admin adding a volunteer signs into the user sigchain; clients verify the sigchain before trusting the new member for hub-key rewrap.
7. Master signing key can be recovered via Recovery Group if all user devices are lost.
8. Cascading Lazy Key Rotation: rotating Hub A where user is removed also rotates nested Sub-Hub B.
9. Sigchain verification is O(delta) amortized via caching.
10. All existing tests pass; new tests cover device lifecycle, sigchain verification, CLKR correctness.
11. Typecheck + build + lint clean.

## Trade-offs and anti-patterns

**Do:**
- Per-device keypairs are non-extractable from day one.
- Every state-changing operation is signed into the sigchain.
- Cache sigchain verification but invalidate aggressively on new entries.
- Paper key derivation is deterministic from the phrase (repeatable recovery).

**Don't:**
- Keep a "fallback user identity key" around. The per-device model is the only model.
- Allow sigchain entries without a valid signature chain back to a verified device.
- Use server-asserted role claims for cryptographic access control (Albrecht #1).
- Mix the master signing key with device signing keys — keep them distinct.
- Re-encrypt all historical data on every rotation. CLKR's "wrap old-gen under new-gen" pattern is the whole point.
- Skip the cross-signing verification UX. Users must see and confirm new devices.

## Pointers to primary sources

**Must read:**
- Keybase PUK + sigchain: https://book.keybase.io/docs/teams/puk
- Keybase team crypto: https://book.keybase.io/docs/teams/crypto
- Keybase NCC Group audit: https://keybase.io/docs-assets/blog/NCC_Group_Keybase_KB2018_Public_Report_2019-02-27_v1.3.pdf
- Matrix cross-signing spec: https://spec.matrix.org/latest/client-server-api/#cross-signing
- Signal Sesame multi-device: https://signal.org/docs/specifications/sesame/
- Albrecht attacks (context for why sigchain membership matters): https://nebuchadnezzar-megolm.github.io/

**Optional:**
- Tamper-evident log design (general): Certificate Transparency RFC 6962 as a reference for chain structure.
- Shamir's Secret Sharing for master key recovery: `@stablelib/shamir`.

## Related work in the repo

- Tier 0 — sigchain primitive foundation.
- Tier 1 — non-extractable CryptoKey + HPKE primitives.
- Tier 2 — unlock flow + Recovery Group (wraps master key in addition to PUK).
- Epic 77 hash-chained audit log — the substrate.
- PR #48 device management in `user_security_prefs` — Tier 3 makes this the primary abstraction.
- `docs/protocol/llamenos-protocol.md` — will need substantial update.
- `docs/architecture/E2EE_ARCHITECTURE.md` — three-tier model gets a new "layer 0: device identity" section.
- Threat model should be updated to name device compromise as a first-class adversary capability.
