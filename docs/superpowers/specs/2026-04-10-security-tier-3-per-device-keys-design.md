# Security Tier 3 — Per-Device Keys + Per-User Key + Sigchain

**Date:** 2026-04-10
**Status:** Draft
**Branch:** `feat/sec-tier-3-per-device-keys`
**Branch base:** `feat/sec-tier-0-albrecht-hardening` (which chains onto main after PR #50)
**Depends on:** Tier 0 (signed audit-log chain, branded crypto labels, AEAD AAD binding), Tier 1 (HPKE primitives + non-extractable `CryptoKey` + native X25519/Ed25519 + `items_key` indirection), Tier 2 (WebAuthn PRF / OPAQUE / Diceware-phrase unlock + Recovery Group wrapping)
**Brief:** [`docs/security/spec-briefs/tier-3-per-device-keys.md`](../../security/spec-briefs/tier-3-per-device-keys.md)
**Master doc:** [`docs/security/SECURITY_IMPROVEMENTS_MASTER.md`](../../security/SECURITY_IMPROVEMENTS_MASTER.md) §1.2 Gap 2, §3.3 (Matrix cross-signing), §3.5 (Sesame), §3.8 (Keybase — primary reference), §5.3, §6.1, §6.2, §6.3, §7 Tier 3, §8.4 (MLS-via-devices wild idea), §9

## Problem

Llamenos' current identity model is the Standard Notes anti-pattern distilled to its essence:

- One `nsec` (secp256k1 private key) per user.
- That `nsec` is re-derivable on every device from the same multi-factor KEK (PIN + optional WebAuthn PRF + IdP-bound value) that every device shares.
- The hub key is random bytes, wrapped once per user via `LABEL_HUB_KEY_WRAP`.
- Adding a device is an ephemeral-ECDH "provisioning room" that ships the plaintext `nsec` over an ECDH-derived symmetric tunnel.

This is cryptographically tidy and it gave us strong properties at the per-note and per-envelope layers, but the user-identity layer has three structural weaknesses that no amount of AEAD hardening at Tier 0 or primitive modernization at Tier 1 can fix:

**Gap 3.A — Single credential compromise = all devices forever.** If any one device is compromised (malware, physical seizure, forensic dump, targeted XSS) and the `nsec` is exfiltrated, every other device the user owns — and every historical ciphertext any of those devices ever decrypted — is also compromised retroactively and in perpetuity. Rotating the `nsec` does not help because the rotation is itself gated by the compromised factor set.

**Gap 3.B — No true device revocation.** There is no such thing as "kick the lost laptop off my account". The provisioning-room flow is additive only. A laptop that was enrolled and then lost continues to hold a valid `nsec` and can still unwrap every hub-key envelope it ever received, including envelopes issued to it before loss. The only "revocation" available is rotating the user identity globally — which re-wraps the hub key to everyone again with the same key material the lost laptop also knows.

**Gap 3.C — Multi-device coordination is untraceable.** Ephemeral ECDH rooms give us confidentiality against a network eavesdropper during a device link, but they leave no auditable record of *which devices* the user has ever had. A compromised server can silently issue a second provisioning room, wait for the primary device to pair it, exfiltrate the wrapped `nsec` from the room, and the legitimate user will have zero tamper-evident signal that this ever happened. This is exactly the Albrecht #1 class — server-controlled membership injection — applied to the user's own device set instead of to hub membership.

Tiers 0, 1, 2 harden the primitives we already have. They do not change the identity model. Tier 3 is the architectural pivot to Keybase's per-device-key + Per-User Key (PUK) + user sigchain model, which solves all three gaps structurally:

- Each device has its own non-extractable X25519 (encryption) + Ed25519 (signing) `CryptoKey` generated at enrollment. The private keys never leave the device — not on provisioning, not on backup, not on export.
- The user's cross-device identity is a 32-byte PUK seed, HPKE-wrapped individually to each enrolled device. The seed itself exists in plaintext in browser memory only during device enrollment, for the few seconds it takes to produce a new envelope, and is zeroed immediately.
- Adding a device is a signed sigchain entry: an existing device signs `device_add(new_device_id, new_device_pubkey, signed_by=existing_device_id)`. All hub members verify the sigchain before they will rewrap a hub key to the new device. The server cannot inject a phantom device without an existing device's Ed25519 signing key — which is non-extractable.
- Revoking a device emits `device_remove` into the sigchain + triggers a **Cascading Lazy Key Rotation** on every hub the user belongs to. The revoked device cannot decrypt the new generation because it was excluded from the new-gen hub-key envelopes.
- Paper recovery keys are cryptographically identical to devices — a BIP39-rendered Ed25519 + X25519 seed with a `device_add` sigchain entry of its own.

**What this tier does not do:**

- It does not change how we route calls, store notes, or encrypt per-note content. The per-artifact FS + per-reader ECIES pattern from Tiers 0/1 is preserved and *strengthened* by moving "reader" from "user pubkey" to "device pubkey".
- It does not attempt continuous post-compromise security (that is Tier 6 via MLS).
- It does not attempt voice E2EE (Tier 5).
- It does not split the code-delivery origin (Tier 4).

Everything below is the clean-cut landing.

## Design

The spec is organized as nine workstreams (3.1 through 3.9). They have a natural dependency order that the plan will follow, but within each workstream the unit tests and implementation can proceed in parallel.

**Guiding principles (layered on top of §9 of the master doc):**

1. **Device key material is non-extractable.** Every X25519 and Ed25519 keypair created for a device lives in `CryptoKey` form with `extractable: false`. `subtle.exportKey()` is never called on a device private key for any reason.
2. **The PUK seed never persists in plaintext.** It exists as raw bytes only on the device that generates it (at user creation) and on devices that are unwrapping their own PUK envelope to re-wrap for a sibling device. Every such transient copy is zeroed immediately after use, in a `finally` block.
3. **Every state-changing operation on the user identity is signed into the user sigchain.** Device add, device remove, PUK rotation, hub membership change initiated by an admin — all of these are `SignedAuditEntry` rows appended via the Tier 0 signed audit log primitive.
4. **Sigchain verification runs before every cryptographic side effect.** Hub-key rewraps, PUK rotations, device additions — all verify the relevant sigchain prefix before they mutate anything.
5. **Hub membership is expressed as a set of devices, not a set of users.** A user with three devices is three entries in the hub's member-device set. A hub-key rotation produces three envelopes per user.
6. **Paper keys and device keys share one format.** The recovery-phrase unification from Tier 2 and the paper-key mechanism from this tier are the same mechanism: a deterministic seed → Ed25519+X25519 keypair → `device_add` sigchain entry → PUK envelope for the new pseudo-device.
7. **Pre-production clean cut.** No v1-to-v2 migration shims. The dev DB is wiped once, onboarding flows produce first-device sigchains from scratch.

### 3.1. Device identity layer

Each device holds two non-extractable keypairs plus a stable `deviceId`.

#### 3.1.1. Keypair generation

`src/client/lib/device-identity.ts` (new file) owns the device-key lifecycle. On first launch in a fresh profile, it runs:

```typescript
interface DeviceKeypair {
  deviceId: string                  // UUIDv4 — stable identifier
  signing: {
    privateKey: CryptoKey           // Ed25519 (non-extractable)
    publicKey: Uint8Array           // raw 32 bytes
  }
  encryption: {
    privateKey: CryptoKey           // X25519 (non-extractable)
    publicKey: Uint8Array           // raw 32 bytes
  }
  createdAt: string                 // ISO 8601
  displayName: Ciphertext           // PUK-encrypted, e.g. "Alice's work laptop"
}

async function generateDeviceKeypair(displayName: string): Promise<DeviceKeypair> {
  // Tier 1 introduces native Ed25519 + X25519. Tier 3 assumes they are present
  // (Chrome 137+ / Firefox 135+ / Safari 17.4+). No fallback to secp256k1.
  const signingPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    /* extractable */ false,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const encryptionPair = await crypto.subtle.generateKey(
    { name: 'X25519' },
    /* extractable */ false,
    ['deriveKey', 'deriveBits'],
  ) as CryptoKeyPair

  const signingPub = new Uint8Array(await crypto.subtle.exportKey('raw', signingPair.publicKey))
  const encryptionPub = new Uint8Array(await crypto.subtle.exportKey('raw', encryptionPair.publicKey))

  return {
    deviceId: crypto.randomUUID(),
    signing: { privateKey: signingPair.privateKey, publicKey: signingPub },
    encryption: { privateKey: encryptionPair.privateKey, publicKey: encryptionPub },
    createdAt: new Date().toISOString(),
    displayName: encryptDeviceDisplayName(displayName),
  }
}
```

**Why UUIDv4 for `deviceId` and not a hash of the signing pubkey.** Hash-of-pubkey is self-verifying but makes device rotation within a single "physical device slot" awkward (rotating the keypair changes the identifier, which breaks sigchain references to `signed_by_device_id`). A random UUID is cheaper and clearer, and the pubkey is still bound to the id via the `device_add` sigchain entry that introduced it. The server-side `devices` table enforces the (user_id, device_id) → (signing_pubkey, encryption_pubkey) binding as a unique constraint, and no code path trusts a `deviceId` without cross-referencing it against the verified sigchain.

#### 3.1.2. IndexedDB persistence

Device keypairs live in an IDB database named `llamenos-device`, one row in the `keypair` object store keyed by `deviceId`. `CryptoKey` is structured-cloneable, so non-extractable handles persist across page reloads without any re-derivation:

```typescript
// src/client/lib/device-identity-store.ts
const DB_NAME = 'llamenos-device'
const DB_VERSION = 1
const STORE = 'keypair'

export async function putDeviceKeypair(keypair: DeviceKeypair): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  await tx.objectStore(STORE).put({
    deviceId: keypair.deviceId,
    signingPrivateKey: keypair.signing.privateKey,        // CryptoKey (non-extractable)
    signingPublicKey: keypair.signing.publicKey,
    encryptionPrivateKey: keypair.encryption.privateKey,  // CryptoKey (non-extractable)
    encryptionPublicKey: keypair.encryption.publicKey,
    createdAt: keypair.createdAt,
    displayName: keypair.displayName,
  })
  await tx.done
}

export async function getDeviceKeypair(): Promise<DeviceKeypair | null> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const rows = await tx.objectStore(STORE).getAll()
  await tx.done
  if (rows.length === 0) return null
  if (rows.length > 1) throw new MultipleDeviceKeypairsError(rows.length)
  return rowToKeypair(rows[0])
}
```

There is **exactly one device keypair per browser profile**. Two keypairs in the same IDB store is a bug (multi-account support is out of scope for Tier 3 and will have a dedicated spec). If the store accidentally holds more than one, `getDeviceKeypair()` throws `MultipleDeviceKeypairsError` rather than picking arbitrarily.

#### 3.1.3. Device keypair lifecycle in the crypto worker

All operations that need the device private keys happen in the crypto worker. The worker loads the keypair on `unlock` via `getDeviceKeypair()` and holds it in closure. The worker exposes three new operations:

- `deviceSign(messageBytes)` — Ed25519 signature via `crypto.subtle.sign({ name: 'Ed25519' }, devicePrivateKey, messageBytes)`.
- `deviceUnwrap(envelope, expectedLabel)` — HPKE open using the device's X25519 private key. Validates the envelope's `labelId` against `expectedLabel` (Tier 0's envelope v2).
- `deriveDeviceToDevice(otherDevicePublicKeyRaw, info)` — derives a 32-byte shared secret via `crypto.subtle.deriveBits({ name: 'X25519', public: otherPub }, devicePrivateKey, 256)`, HKDF-expanded with `info`. This is used for the device enrollment flow and nothing else.

The worker operations that used to take the `nsec` or a hub key are retyped: they now take the specific device private key they need, or they are deleted because they no longer make sense in the per-device model. The old `sign`, `decrypt`, `encrypt`, `provisionNsec` operations are removed entirely.

### 3.2. Per-User Key (PUK)

The PUK is a 32-byte random seed that exists in three forms:

1. As a raw 32-byte `Uint8Array` transiently on a device that just generated it or just unwrapped it.
2. As a `SealedEnvelope` in IDB on each enrolled device, HPKE-wrapped to that device's X25519 public key.
3. Derived into three sub-keys on demand via HMAC-SHA256 from the transient seed.

The master doc §3.8 references the exact Keybase derivation labels. Llamenos adopts the same three-way split but uses HPKE (from Tier 1) and the `crypto-labels.ts` brand for the domain-separation strings:

```typescript
// src/shared/crypto-labels.ts (additions; CryptoLabel brand from Tier 0)
export const LABEL_PUK_SIGN = 'llamenos:puk:sign:v1' as CryptoLabel
export const LABEL_PUK_DH = 'llamenos:puk:dh:v1' as CryptoLabel
export const LABEL_PUK_SECRETBOX = 'llamenos:puk:secretbox:v1' as CryptoLabel
export const LABEL_PUK_WRAP_TO_DEVICE = 'llamenos:puk:wrap:device:v1' as CryptoLabel
export const LABEL_PUK_PREVIOUS_GEN = 'llamenos:puk:prev-gen:v1' as CryptoLabel
```

Derivation:

```typescript
// src/client/lib/puk.ts
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  LABEL_PUK_SIGN,
  LABEL_PUK_DH,
  LABEL_PUK_SECRETBOX,
  type CryptoLabel,
} from '@shared/crypto-labels'

interface DerivedPuk {
  sign: CryptoKey         // non-extractable Ed25519 imported from derived seed
  dh: CryptoKey           // non-extractable X25519 imported from derived seed
  secretBox: CryptoKey    // non-extractable AES-256 imported from derived bytes
}

async function derivePukSubkeys(pukSeed: Uint8Array, generation: number): Promise<DerivedPuk> {
  const genBytes = new Uint8Array(4)
  new DataView(genBytes.buffer).setUint32(0, generation, /*littleEndian*/ false)
  // HMAC context: "label || gen" so every generation produces independent subkeys.
  const signSeed = hmac(sha256, pukSeed, concat(utf8(LABEL_PUK_SIGN), genBytes))
  const dhSeed = hmac(sha256, pukSeed, concat(utf8(LABEL_PUK_DH), genBytes))
  const sbSeed = hmac(sha256, pukSeed, concat(utf8(LABEL_PUK_SECRETBOX), genBytes))

  // Tier 1 assumption: native Ed25519/X25519/AES-256 with importKey('raw', ...).
  const sign = await crypto.subtle.importKey('raw', signSeed, { name: 'Ed25519' }, false, ['sign'])
  const dh = await crypto.subtle.importKey('raw', dhSeed, { name: 'X25519' }, false, ['deriveBits'])
  const secretBox = await crypto.subtle.importKey(
    'raw', sbSeed, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
  // Zero the transient seeds. The returned CryptoKeys are the only artifacts
  // that persist, and they are non-extractable.
  signSeed.fill(0); dhSeed.fill(0); sbSeed.fill(0)
  return { sign, dh, secretBox }
}
```

**Why three subkeys and not just one signing key.** The sign key signs user-sigchain entries that represent identity-level decisions (device_add, device_remove, puk_rotate, hub_membership_change_by_user). The DH key is the recipient public key for hub-admin operations that target a user rather than a specific device (primarily the Recovery Group envelope from Tier 2 and admin-assisted device enrollment). The SecretBox key is the encryption key under which the *previous* PUK generation's seed is wrapped when rotating generations — this is what makes historical data accessible after rotation without re-encrypting every envelope.

**PUK public halves.** For each generation, the *public* Ed25519 and X25519 keys derived from the PUK are pushed into the sigchain as `puk_rotate` entries (see 3.3). Anyone verifying the chain can reconstruct the PUK's public identity at any generation by replaying the sigchain; they cannot reconstruct the private material without the seed.

#### 3.2.1. PUK creation at account initialization

On the very first device of a brand-new account (`user_init`):

```typescript
async function createInitialPuk(deviceKeypair: DeviceKeypair): Promise<PukState> {
  const pukSeed = new Uint8Array(32)
  crypto.getRandomValues(pukSeed)
  try {
    // Derive subkeys to publish their public halves in the sigchain.
    const derived = await derivePukSubkeys(pukSeed, /* generation */ 1)
    const pukSignPubRaw = new Uint8Array(
      await crypto.subtle.exportKey('raw', derived.sign as unknown as CryptoKey),
    )
    // ^ the derived signing key imported with usages:['sign'] is NOT extractable
    // for the private half; the `raw` export yields the 32-byte PUBLIC half.
    const pukDhPubRaw = new Uint8Array(
      await crypto.subtle.exportKey('raw', derived.dh as unknown as CryptoKey),
    )

    // Wrap the seed to the first device.
    const envelope = await hpkeSealToDevice(
      pukSeed, deviceKeypair.encryption.publicKey, LABEL_PUK_WRAP_TO_DEVICE,
    )

    return {
      generation: 1,
      pukSignPubRaw,
      pukDhPubRaw,
      envelopes: [{ deviceId: deviceKeypair.deviceId, envelope }],
    }
  } finally {
    pukSeed.fill(0)
  }
}
```

Three things leave this function:
- A public commitment to the PUK's identity (the two public halves).
- An HPKE envelope of the seed wrapped to the first device.
- Zero copies of the seed in any JavaScript variable after the `finally` runs.

The caller wraps this in a `user_init` sigchain entry (see 3.3) before anything persists to the server.

#### 3.2.2. Adding a device — the PUK hand-off

When an existing "primary" device enrolls a "new" device, the sequence is:

1. Primary opens its own PUK envelope, yielding the 32-byte seed in a transient `Uint8Array`.
2. Primary HPKE-seals the same seed to the new device's X25519 public key, under `LABEL_PUK_WRAP_TO_DEVICE`. The AAD of the HPKE seal is `utf8ToBytes(LABEL_PUK_WRAP_TO_DEVICE + ':' + userId + ':' + newDeviceId + ':' + gen)` so that the envelope is bound to the precise intended recipient and generation.
3. Primary immediately zeroes the seed buffer.
4. Primary signs a `device_add(new_device_id, new_device_signing_pubkey, new_device_encryption_pubkey, display_name, signed_by=primary_device_id)` sigchain entry.
5. Primary POSTs the envelope and the signed sigchain entry to the server in a single atomic transaction.

The primary device does NOT send the new device's envelopes for any hubs at this step. Hub-key envelopes for the new device are produced lazily: the next time any device (including the new one itself) tries to decrypt a hub-scoped field, the client runs `ensureDeviceHasHubKey(hubId, newDeviceId)`, which verifies the sigchain up to the `device_add` and then either issues the envelope from an existing device's cached hub key or asks the new device itself to request it from a peer.

#### 3.2.3. PUK rotation on device removal

When a device is revoked, the PUK is rotated to exclude it. The rotation always runs on an "initiating device" that is NOT the removed one (the removed device is, by construction, the one that must be cryptographically cut off).

```typescript
async function rotatePukExcluding(
  removedDeviceId: string,
  oldGen: number,
  currentSigchainHead: string,
): Promise<PukRotationOutcome> {
  const oldPukSeed = await loadAndOpenOwnPukEnvelope(oldGen)  // transient
  const oldDerived = await derivePukSubkeys(oldPukSeed, oldGen)
  let newPukSeed: Uint8Array | null = null
  try {
    newPukSeed = new Uint8Array(32)
    crypto.getRandomValues(newPukSeed)
    const newDerived = await derivePukSubkeys(newPukSeed, oldGen + 1)

    // 1. Wrap new seed to every remaining device (sigchain gives us the list).
    const remainingDevices = await getVerifiedDevicesExcluding(currentSigchainHead, removedDeviceId)
    const newEnvelopes = await Promise.all(
      remainingDevices.map((d) =>
        hpkeSealToDevice(newPukSeed!, d.encryptionPublicKey, LABEL_PUK_WRAP_TO_DEVICE)
          .then((env) => ({ deviceId: d.deviceId, envelope: env, gen: oldGen + 1 })),
      ),
    )

    // 2. Wrap OLD seed under NEW SecretBox key — preserves read access to
    //    historical envelopes that were encrypted under gen=oldGen.
    const oldUnderNew = await aesGcmEncrypt(
      newDerived.secretBox,
      oldPukSeed,
      utf8ToBytes(LABEL_PUK_PREVIOUS_GEN + ':' + (oldGen + 1).toString()),
    )

    // 3. Emit device_remove + puk_rotate sigchain entries.
    const removeEntry = buildSignedAuditEntry({
      type: 'device_remove',
      removedDeviceId,
      reason: 'user_initiated',  // or 'lost' / 'stolen' / 'compromised'
      prevEntryHash: currentSigchainHead,
    })
    const rotateEntry = buildSignedAuditEntry({
      type: 'puk_rotate',
      newGen: oldGen + 1,
      newPukSignPubRaw: newDerived.signPublicRaw,
      newPukDhPubRaw: newDerived.dhPublicRaw,
      deviceEnvelopeCommitments: newEnvelopes.map((e) => ({
        deviceId: e.deviceId,
        envelopeHash: sha256(e.envelope),
      })),
      oldGenWrappedUnderNew: oldUnderNew,
      prevEntryHash: removeEntry.entryHash,
    })

    return { removeEntry, rotateEntry, newEnvelopes, oldUnderNew }
  } finally {
    if (newPukSeed) newPukSeed.fill(0)
    oldPukSeed.fill(0)
  }
}
```

Properties of this rotation:

- **The removed device is not included in `remainingDevices`.** Its envelope is not in `newEnvelopes`. It cannot decrypt the new PUK seed.
- **The old PUK seed is wrapped under the new SecretBox key.** Any existing device that still holds the new PUK seed can derive the old generation's subkeys *through the chain*. This means historical hub-key envelopes produced under the old PUK signing key still verify, and historical per-note envelopes wrapped to the old PUK-DH key are still openable.
- **The removed device's X25519 private key is not revoked cryptographically** — there is no such operation in WebCrypto. What *is* revoked is its ability to receive any *new* envelope, because the sigchain cryptographically excludes it.
- **The SecretBox key is used only for wrapping previous-generation seeds.** It does not encrypt application content. This matches the Keybase PUK design where the SecretBox key's sole purpose is backward read access through generations.

### 3.3. User sigchain

The user sigchain extends the Tier 0 signed audit log with new typed payloads. Every entry is still a `SignedAuditEntry` row in the `audit_log` table, with the same chain-hash and signature semantics.

**Important:** the sigchain is now *per-user* in addition to being per-hub. Tier 0 shipped `hub_id` as the primary partition key; Tier 3 adds `user_id` as an alternate partition key for the entries that describe user identity rather than hub state. Entries whose payload is a user-identity event (`user_init`, `device_add`, `device_remove`, `puk_rotate`, etc.) have `hub_id = null` (or the sentinel `'user:' + user_id` — decision below) and `user_id` set. Entries whose payload is a hub event (`hub_membership_add`, `hub_key_rotate`, etc.) have `hub_id` set; `user_id` is optional when the payload itself contains a `userId`.

**Decision (resolved from brief open question #4):** the sigchain is server-hosted as the primary store, with a read-replica optional on the Nostr relay for independent audit. Server storage is the correct primary because clients need efficient range queries over sigchain prefixes for incremental verification. The Nostr relay mirror is a nice-to-have that Tier 4 addresses.

#### 3.3.1. New payload types

`src/shared/schemas/audit-entries.ts` (extends the Tier 0 file):

```typescript
import { z } from '@hono/zod-openapi'

const Hex32Schema = z.string().regex(/^[0-9a-f]{64}$/)     // 32 bytes, hex
const Hex64Schema = z.string().regex(/^[0-9a-f]{128}$/)    // 64 bytes, hex (signatures, hashes)
const UuidSchema = z.string().uuid()
const DeviceRevokeReasonSchema = z.enum(['user_initiated', 'lost', 'stolen', 'compromised', 'rotation'])

export const UserInitPayloadSchema = z.object({
  type: z.literal('user_init'),
  userId: UuidSchema,
  initialDeviceId: UuidSchema,
  initialDeviceSigningPubkey: Hex32Schema,
  initialDeviceEncryptionPubkey: Hex32Schema,
  initialDeviceDisplayName: z.string(),  // PUK-encrypted ciphertext as hex, AAD-bound to userId
  pukGen: z.literal(1),
  pukSignPubkey: Hex32Schema,
  pukDhPubkey: Hex32Schema,
  pukEnvelopeForInitialDevice: z.string(),  // hex — HPKE envelope of the seed
})

export const DeviceAddPayloadSchema = z.object({
  type: z.literal('device_add'),
  userId: UuidSchema,
  newDeviceId: UuidSchema,
  newDeviceSigningPubkey: Hex32Schema,
  newDeviceEncryptionPubkey: Hex32Schema,
  newDeviceDisplayName: z.string(),  // PUK-encrypted ciphertext, AAD-bound to userId + newDeviceId
  signedByDeviceId: UuidSchema,      // must be a device currently in the user's verified set
})

export const DeviceRemovePayloadSchema = z.object({
  type: z.literal('device_remove'),
  userId: UuidSchema,
  removedDeviceId: UuidSchema,
  reason: DeviceRevokeReasonSchema,
  signedByDeviceId: UuidSchema,
})

export const PukRotatePayloadSchema = z.object({
  type: z.literal('puk_rotate'),
  userId: UuidSchema,
  newGen: z.number().int().min(2),
  newPukSignPubkey: Hex32Schema,
  newPukDhPubkey: Hex32Schema,
  deviceEnvelopeCommitments: z.array(
    z.object({
      deviceId: UuidSchema,
      envelopeHash: Hex32Schema,  // SHA-256 of the HPKE envelope stored server-side
    }),
  ).min(1),
  oldGenWrappedUnderNew: z.string(),  // hex — AES-GCM-256 of old seed under new SecretBox key
  signedByDeviceId: UuidSchema,
})

export const UserMasterSigningPayloadSchema = z.object({
  type: z.literal('user_master_signing_update'),
  userId: UuidSchema,
  masterPubkey: Hex32Schema,          // Ed25519
  selfSigningPubkey: Hex32Schema,     // Ed25519, signed by master
  userSigningPubkey: Hex32Schema,     // Ed25519, signed by master
  masterSignatureOverSelfSigning: Hex64Schema,
  masterSignatureOverUserSigning: Hex64Schema,
  // The master key itself is NOT in the sigchain signer field — sigchain entries
  // are signed by a device, and the master key is wrapped via Recovery Group +
  // the PUK SecretBox key (see 3.6).
})

export const DeviceCrossSignPayloadSchema = z.object({
  type: z.literal('device_cross_sign'),
  userId: UuidSchema,
  deviceId: UuidSchema,
  deviceSigningPubkey: Hex32Schema,
  selfSigningSignature: Hex64Schema,  // self-signing key signs the device signing pubkey
})

export const UserCrossSignPayloadSchema = z.object({
  type: z.literal('user_cross_sign'),
  signingUserId: UuidSchema,      // Alice
  signedUserId: UuidSchema,       // Bob
  signedUserMasterPubkey: Hex32Schema,
  userSigningSignature: Hex64Schema,  // Alice's user-signing key signs Bob's master pubkey
  verificationMode: z.enum(['sas', 'qr', 'admin_grant']),
})

export const HubPtkRotatePayloadSchema = z.object({
  type: z.literal('hub_ptk_rotate'),
  hubId: UuidSchema,
  newGen: z.number().int().min(2),
  // Per-device commitments — members = devices, not users.
  deviceEnvelopeCommitments: z.array(
    z.object({
      userId: UuidSchema,
      deviceId: UuidSchema,
      envelopeHash: Hex32Schema,
    }),
  ).min(1),
  oldGenWrappedUnderNew: z.string(),  // hex — AES-GCM-256 of old hub key under new hub key
  reason: z.enum(['member_added', 'member_removed', 'device_added', 'device_removed', 'role_changed', 'scheduled', 'manual']),
  signedByDeviceId: UuidSchema,       // admin device
})

export const RecoveryInitiatedPayloadSchema = z.object({
  type: z.literal('recovery_initiated'),
  targetUserId: UuidSchema,
  byAdminDeviceId: UuidSchema,
  recoveryRequestId: UuidSchema,
})

export const RecoveryCompletedPayloadSchema = z.object({
  type: z.literal('recovery_completed'),
  targetUserId: UuidSchema,
  newDeviceId: UuidSchema,
  newDeviceSigningPubkey: Hex32Schema,
  newDeviceEncryptionPubkey: Hex32Schema,
  participatingAdminDeviceIds: z.array(UuidSchema).min(2),  // Shamir threshold
  recoveryRequestId: UuidSchema,
})

// Extend the Tier 0 discriminated union:
export const AuditEntryPayloadSchema = z.discriminatedUnion('type', [
  // ... Tier 0 entries ...
  UserInitPayloadSchema,
  DeviceAddPayloadSchema,
  DeviceRemovePayloadSchema,
  PukRotatePayloadSchema,
  UserMasterSigningPayloadSchema,
  DeviceCrossSignPayloadSchema,
  UserCrossSignPayloadSchema,
  HubPtkRotatePayloadSchema,
  RecoveryInitiatedPayloadSchema,
  RecoveryCompletedPayloadSchema,
])
```

Every new payload is a zod schema in the Tier 0 discriminated union, so `computeEntryHash()` (Tier 0) works on them unchanged: the canonicalized form pins `v:1` and walks the payload's sorted keys.

#### 3.3.2. Verification rules

`src/client/lib/user-sigchain-verifier.ts` is a new client module built on top of the Tier 0 `audit-chain-verifier.ts`. The Tier 0 verifier already enforces chain-hash linkage, entry-hash recomputation, and signature verification per entry. Tier 3 adds **semantic rules** specific to user identity:

1. The first entry in a user's sigchain must be `user_init` for that user_id. No other entry type can be the chain root.
2. A `device_add` entry must be signed by a device that is currently in the user's verified device set (i.e. was introduced by a prior `user_init` or `device_add` and has not been removed by a subsequent `device_remove`).
3. A `device_remove` entry must be signed by a device that is in the current verified set AND is not the device being removed (you cannot "remove yourself" to avoid the revocation semantics; use `user_delete` instead, which is out of scope for this tier).
4. A `puk_rotate` entry must follow a `device_remove` entry OR be signed by a device whose last successful `device_add` was before the current PUK generation (i.e. the entry is rotating forward for scheduled or manual reasons). Every `puk_rotate` entry increments the generation exactly by one.
5. A `hub_ptk_rotate` entry must be signed by an admin device (a device belonging to a user who is an admin of `hub_id` at the chain state prevailing at that entry's position), and its `deviceEnvelopeCommitments` must include an envelope for every non-removed device of every non-removed admin+volunteer of the hub at that position.
6. `user_master_signing_update` is signed by a device that the verifier has already attributed to the same `userId`, and it must be the FIRST entry of that type for the user OR the signature over the new master key must chain back to the old master key.
7. `device_cross_sign` must be signed by a device of the same user, and its `selfSigningSignature` must verify under the user's current self-signing key (which came from the most recent `user_master_signing_update`).
8. `user_cross_sign` is signed by a device of `signingUserId` AND its `userSigningSignature` must verify under `signingUserId`'s user-signing key over `signedUserMasterPubkey`. The server re-verifies the `userSigningSignature` before persisting.
9. `recovery_completed` must be signed by one of the `participatingAdminDeviceIds` and must be accompanied by matching `recovery_initiated` signed by any admin device AND `participatingAdminDeviceIds.length >= recovery_group_threshold` for that hub.

The verifier's cache (from Tier 0, one row per hub in IDB `llamenos-audit-chain-cache`) is extended with a per-user partition — one cache row per (user_id) for user-identity sigchain state, plus the existing per-hub rows for hub-state chain state. This keeps both chains walkable independently and avoids re-verifying every entry on every user action.

#### 3.3.3. The chain is a DAG, conceptually

The master doc §6.2 describes the sigchain as "append-only hash-chained log". That is accurate at the implementation level (one linear list of `SignedAuditEntry` rows with `prev_entry_hash` linking them), but the *semantic* chain is a DAG that joins the user sigchain and the hub sigchain at specific points (membership changes, device events that trigger hub rotations). The verifier walks the DAG by following `prev_entry_hash` linearly and using the typed payloads to thread cross-references.

The DAG property is why `computeEntryHash()` over the canonicalized form does NOT include any "parent DAG links" — there is exactly one predecessor, the hash-linked previous entry, and all cross-references are *forward* references (a `hub_ptk_rotate` entry's `deviceEnvelopeCommitments` references device ids that the verifier must look up in the user sigchain, not the other way around).

### 3.4. Device enrollment flow

This replaces the ephemeral-ECDH provisioning room pattern from `src/client/lib/provisioning.ts`. The old pattern is deleted in Tier 3, not adapted.

#### 3.4.1. The three scenarios

1. **Initial device for a new account.** No existing device exists. The onboarding flow runs `createInitialPuk()`, persists the device keypair, emits `user_init`, and posts everything to the server. The server treats the `user_init` entry as the trust anchor for this user's sigchain.
2. **Adding a sibling device to an existing account.** A primary device is already enrolled and unlocked. A new device connects via QR+SAS verification and receives the PUK envelope + relevant hub-key envelopes from the primary.
3. **Recovering after all devices are lost.** The user has no primary device. The Recovery Group flow from Tier 2 provides the path: Shamir threshold of admin devices reconstruct the user's master signing key, which is used to authorize a fresh `user_init_recovery` entry that bootstraps a new device keypair and a new PUK generation.

Scenarios 1 and 2 are in-scope for Tier 3's device enrollment workstream. Scenario 3 is handled in §3.6 (master key recovery).

#### 3.4.2. Sibling device enrollment (scenario 2)

State machine for both sides:

**New-device side states:**
- `idle` → user clicks "add this as a new device"
- `generating_keypair` → running `generateDeviceKeypair()`
- `awaiting_qr` → showing its own pubkey + display-name prompt as a QR code to scan from the primary
- `sas_compare` → showing a 6-digit SAS code derived from the shared ECDH with the primary's *device* X25519 key
- `user_confirmed_sas` → user clicked "codes match" on both ends
- `awaiting_puk_envelope` → polling server for the primary's response
- `installing_puk` → received envelope, verifying the accompanying `device_add` sigchain entry, storing its own device keypair in IDB
- `enrolled` → done; unlock proceeds

**Primary-device side states:**
- `idle` → user clicks "pair a new device"
- `scanning_qr` → camera capture or paste of the new device's pubkey QR
- `parsed_candidate` → extracted `{ candidateDeviceId, candidateSigningPubkey, candidateEncryptionPubkey, candidateDisplayName }`
- `sas_compare` → showing SAS code derived from ECDH(primary_device_priv, candidate_encryption_pubkey) — SAME six digits as new device
- `user_confirmed_sas` → user clicked "codes match" on both ends
- `building_entry` → loads the user's current sigchain head, constructs `device_add` entry, signs it with the PRIMARY device's Ed25519 key
- `wrapping_puk` → opens primary's PUK envelope, seals PUK seed to candidate's X25519 pubkey, builds the accompanying server payload
- `submitting` → POSTs `{ deviceAddEntry, pukEnvelopeForCandidate }` to server
- `paired` → done

**QR + SAS protocol:**

The QR code transports the new device's X25519 + Ed25519 public keys AND a short-lived `enrollment_nonce` (16 random bytes). SAS is computed as:

```typescript
function computeDeviceEnrollmentSAS(
  primaryDeviceX25519Priv: CryptoKey,
  newDeviceX25519PubRaw: Uint8Array,
  primaryDeviceX25519PubRaw: Uint8Array,
  enrollmentNonce: Uint8Array,
): Promise<string> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: await importRawX25519(newDeviceX25519PubRaw) },
    primaryDeviceX25519Priv,
    256,
  )
  const shared = new Uint8Array(sharedBits)

  // HKDF includes BOTH public keys canonically ordered + the nonce, so the
  // SAS is bound to the specific (primary, new, nonce) triple.
  const [left, right] = sortedPubkeyPair(primaryDeviceX25519PubRaw, newDeviceX25519PubRaw)
  const info = concat(utf8(LABEL_DEVICE_ENROLLMENT_SAS), left, right, enrollmentNonce)
  const sasBytes = hkdf(sha256, shared, utf8(SAS_SALT), info, 4)
  shared.fill(0)
  return unbiasedSixDigitCode(sasBytes)
}
```

**Why sort the pubkeys into a canonical pair.** Both sides compute the same SAS from the same shared bits regardless of which side is "primary" and which is "new". Sorting prevents an asymmetry that would let a MITM produce a different SAS on each side.

**Why include `enrollmentNonce`.** Without it, a MITM who captures the QR could run the enrollment at their leisure. The nonce is baked into the QR at generation and expires after 2 minutes. The server ties the nonce to a short-lived `enrollment_session` row; the primary device validates that the candidate's POST uses the same session.

#### 3.4.3. Why this beats ephemeral-ECDH-provisioning rooms

- **The nsec is not transmitted.** The new device generates its own keys and never receives any long-term user identity private key. It only receives the PUK envelope (which it opens with its own freshly-generated X25519 private key) and the current list of hub-key envelopes (one per hub it is now a member of, wrapped to its own X25519 public key).
- **The enrollment leaves a tamper-evident sigchain entry.** A malicious server cannot silently inject a `device_add` without an existing device's Ed25519 private key. The server is the transport; the signature is the authority.
- **SAS verification is mandatory.** Both sides must click "codes match" before the primary signs the entry. A MITM on the enrollment QR fails because the SAS derived from the MITM's substituted pubkeys will not match the SAS derived from the real pubkeys.
- **The enrollment session expires fast.** 2 minutes. A leaked enrollment QR is not useful after that window.

#### 3.4.4. Rate limiting and lockout

Device enrollment is a privileged operation. Rate limits:

- Per-user: at most 1 pending `enrollment_session` at a time. Starting a new enrollment invalidates any prior pending session.
- Per-admin: at most 10 approved device enrollments per user per 24h (a number well above any realistic legitimate usage; the protection is against automated probing).
- Per-SAS-mismatch: 3 consecutive SAS mismatches from the same primary pubkey → a `device_enrollment_throttle` record is inserted server-side + the UI on the primary device shows a cool-down message. The throttle resets on successful unlock.

### 3.5. Hub key per device

The hub key itself remains a random 32-byte symmetric key, unchanged from the current `generateHubKey()`. What changes is the wrapping: instead of one ECIES envelope per user, there is one HPKE envelope per *device* of every member user.

#### 3.5.1. Schema changes

New Drizzle tables + a schema change to `hub_members`:

```typescript
// src/server/db/schema/devices.ts (new)
import { pgTable, text, timestamp, jsonb, integer, unique, index } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'

export const userDevices = pgTable(
  'user_devices',
  {
    deviceId: text('device_id').primaryKey(),
    userId: text('user_id').notNull(),
    signingPubkey: text('signing_pubkey').notNull(),     // 64 hex
    encryptionPubkey: text('encryption_pubkey').notNull(),
    encryptedDisplayName: ciphertext('encrypted_display_name').notNull(),
    addedByDeviceId: text('added_by_device_id'),        // null for user_init
    addedSigchainEntryId: text('added_sigchain_entry_id').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBySigchainEntryId: text('revoked_by_sigchain_entry_id'),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('user_devices_signing_pubkey_unique').on(t.signingPubkey),
    unique('user_devices_encryption_pubkey_unique').on(t.encryptionPubkey),
    index('user_devices_user_active_idx').on(t.userId, t.revokedAt),
  ],
)

export const userPukEnvelopes = pgTable(
  'user_puk_envelopes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    generation: integer('generation').notNull(),
    envelope: text('envelope').notNull(),                 // HPKE ciphertext as hex
    sigchainEntryId: text('sigchain_entry_id').notNull(), // the puk_rotate or user_init that emitted this
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('user_puk_envelopes_unique').on(t.userId, t.deviceId, t.generation),
    index('user_puk_envelopes_user_gen_idx').on(t.userId, t.generation),
  ],
)

export const hubPtkGenerations = pgTable(
  'hub_ptk_generations',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),
    generation: integer('generation').notNull(),
    oldGenWrappedUnderNew: text('old_gen_wrapped_under_new'),  // hex AES-GCM
    rotatedBySigchainEntryId: text('rotated_by_sigchain_entry_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('hub_ptk_generations_unique').on(t.hubId, t.generation),
  ],
)

export const hubKeyEnvelopes = pgTable(
  'hub_key_envelopes',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),
    generation: integer('generation').notNull(),
    deviceId: text('device_id').notNull(),
    userId: text('user_id').notNull(),
    envelope: text('envelope').notNull(),                  // HPKE ciphertext as hex
    sigchainEntryId: text('sigchain_entry_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('hub_key_envelopes_unique').on(t.hubId, t.generation, t.deviceId),
    index('hub_key_envelopes_lookup_idx').on(t.deviceId, t.hubId, t.generation.desc()),
  ],
)

export const deviceEnrollmentSessions = pgTable(
  'device_enrollment_sessions',
  {
    sessionId: text('session_id').primaryKey(),
    userId: text('user_id').notNull(),
    primaryDeviceId: text('primary_device_id').notNull(),
    candidateSigningPubkey: text('candidate_signing_pubkey').notNull(),
    candidateEncryptionPubkey: text('candidate_encryption_pubkey').notNull(),
    enrollmentNonce: text('enrollment_nonce').notNull(),
    status: text('status').notNull().default('pending'),   // pending | sas_matched | paired | expired
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('enrollment_sessions_user_idx').on(t.userId),
  ],
)
```

Notable decisions:

- **`userDevices.signing_pubkey` and `userDevices.encryption_pubkey` have unique constraints globally.** Two users cannot share a device keypair; two devices of the same user cannot share one either. The uniqueness is on the database, which means a server-side bug that tried to register a collision fails fast with a constraint violation.
- **`hubKeyEnvelopes` is per (hub, generation, device).** A hub with 20 members and 3 devices each has 60 envelopes per generation. Rotations cascade one hub at a time.
- **`sigchain_entry_id` is a foreign-key-in-spirit but not a hard FK** because audit_log rows may be purged by retention policy in distant future. The reference is logical: the client verifier walks sigchain entries by id and treats missing ones as a chain break.
- **Old `provision_rooms` table is dropped.** The migration removes it. The ephemeral-ECDH protocol is gone.

#### 3.5.2. Initial envelope issuance

When a device is added (via `user_init`, `device_add`, or `recovery_completed`), the client that signs the sigchain entry is the only party that can produce the hub-key envelopes for the new device. For each hub the user is a member of:

1. Client unwraps its own current hub-key envelope (which is already in IDB from a prior fetch).
2. Client re-wraps the hub key to the new device's X25519 pubkey via HPKE with `LABEL_HUB_KEY_WRAP`.
3. Client signs a `hub_ptk_rotate(hub_id, newGen = currentGen, deviceEnvelopeCommitments = existing members + new device, reason = 'device_added', ...)` entry. This is technically a rotation even though the underlying key has not changed — we emit a new generation so that commitments cryptographically bind "device X is now part of hub Y" into the sigchain.
4. Client POSTs `(new device envelopes, the sigchain entry)` to the server.

**Why we emit a new generation for device additions and not just write a new envelope row.** The alternative is to leave generation N in place and ADD a row to `hub_key_envelopes`. That works, but it complicates the sigchain semantics: there would be no sigchain entry for "device X joined hub Y", only a server-side row change. A malicious server could add rows with tampered pubkeys. Emitting a fresh `hub_ptk_rotate` gives us a signed commitment + zero extra cryptographic work (the hub key itself is unchanged; only a new wrapping round). The cost is sigchain growth — acceptable.

**Alternative: not re-keying on device-add.** An admin might want to audit-log a device addition without triggering a rotation, for sheer sigchain-growth reasons. We do NOT provide this option. Tier 3's invariant is that every membership change — user or device level — produces a sigchain entry committing to the exact current member-device set. The overhead is O(device_count) per rotation, which is bounded by the hub size.

#### 3.5.3. Hub-key fetch + unwrap on a single device

```typescript
// src/client/lib/hub-key-manager.ts — rewritten
async function loadMyHubKeyForHub(hubId: string, deviceId: string): Promise<Uint8Array> {
  // 1. Fetch server-side hub_key_envelopes for my deviceId, current generation.
  const row = await api.getHubKeyEnvelopeForDevice(hubId, deviceId)

  // 2. Verify the sigchain entry that introduced this envelope is valid.
  await userSigchainVerifier.verifyUpTo(row.sigchainEntryId)

  // 3. Cross-check: the sigchain entry's deviceEnvelopeCommitments must include
  //    (hubId, gen, deviceId, sha256(envelope)). A malicious server cannot
  //    substitute a different envelope for this device without breaking the
  //    commitment hash.
  const entry = await fetchSigchainEntry(row.sigchainEntryId)
  assertDeviceCommitmentMatches(entry, { hubId, gen: row.generation, deviceId, envelopeHex: row.envelope })

  // 4. Open the envelope in the crypto worker.
  const hubKey = await cryptoWorker.deviceUnwrap(
    { labelId: labelToId(LABEL_HUB_KEY_WRAP), wrappedCiphertext: row.envelope, ... },
    LABEL_HUB_KEY_WRAP,
  )
  return hubKey
}
```

**The commitment check.** Step 3 is how the sigchain closes the loop on server-tampering attacks. The `hub_ptk_rotate` entry includes `deviceEnvelopeCommitments` — an array of `(deviceId, envelopeHash)`. The hash is SHA-256 over the exact envelope bytes. A malicious server that swaps one device's envelope for a different one fails this check because the swapped bytes produce a different SHA-256 than the one signed into the sigchain.

This is the Tier 3 analogue of Tier 0's chain-gated-rewrap: Tier 0 gates *outgoing* operations on chain verification; Tier 3 gates *incoming* data on commitment verification.

### 3.6. Cross-signing and master key recovery

The design parallels Matrix cross-signing (master / self-signing / user-signing) with adaptations for Llamenos's admin-heavy workflow. The goal is to build a tamper-evident trust DAG that lets a hub admin confidently add a volunteer without a video-call verification, while still preventing a compromised server from silently substituting a volunteer's master key.

#### 3.6.1. The three keypairs

Each user has:

- **Master signing keypair** (Ed25519). The root of the user's trust. Never signs application data directly; only signs the other two keypairs and `user_master_signing_update` sigchain entries. Master private key is wrapped under the PUK SecretBox key AND under the Recovery Group envelope (Tier 2). It lives in transient memory only during a cross-signing operation.
- **Self-signing keypair** (Ed25519). Signs this user's own devices. The `device_cross_sign` sigchain entry holds the signature of the self-signing key over each device's signing pubkey. This is the key that a device uses to prove "I am a real device of user X" without needing to cross-reference the master.
- **User-signing keypair** (Ed25519). Signs *other users'* master keys. When Alice verifies Bob's master key (via SAS or QR), Alice signs Bob's master key with her user-signing key and emits a `user_cross_sign` sigchain entry. Bob's subsequent devices inherit that trust because they're signed by Bob's self-signing key, which is signed by Bob's master key, which Alice has verified.

#### 3.6.2. Master key storage and recovery

The master private key is not held in IDB non-extractable form the way device keys are — it needs to be *recoverable*, and non-extractable keys are not recoverable (by design). Instead:

1. At user creation, a fresh 32-byte seed is generated (the "master seed") and HMAC-derived into an Ed25519 master signing keypair.
2. The master seed is AES-GCM-256 encrypted under the PUK SecretBox key, with AAD = `LABEL_MASTER_KEY_WRAP:userId:gen`. The ciphertext is stored server-side in a new `user_master_wraps` table.
3. The master seed is ALSO encrypted to the Recovery Group public key (Tier 2), stored in `user_master_wraps` as a second envelope.
4. The master seed raw bytes are zeroed after encryption. The master Ed25519 private key is reconstructed transiently on every operation that needs it by decrypting the wrap.

**Why wrap the master seed instead of just the master private key.** The seed allows reconstruction of all three cross-signing keypairs (master, self-signing, user-signing) from one wrapped blob. Self-signing and user-signing are HMAC-derived from the master seed via:

```typescript
selfSigningSeed = hmac(sha256, masterSeed, utf8(LABEL_MASTER_SELF_SIGNING))
userSigningSeed = hmac(sha256, masterSeed, utf8(LABEL_MASTER_USER_SIGNING))
```

Cross-signing operations import the derived seeds as `CryptoKey` (non-extractable imported keys), sign the required entries, then release the handles. The transient master seed bytes are zeroed in a `finally` block.

**Why not hold self-signing / user-signing as persistent non-extractable `CryptoKey`s.** They *could* be — imported once at account creation from the derived seeds and kept in IDB alongside the device keys. The reason we don't is that a recovery scenario needs them to be regeneratable from the master seed, and persistent non-extractable keys are not regeneratable (a fresh import yields a new `CryptoKey`, which is fine functionally but breaks any invariant that ties the device-side key handle to "the same" key). Transient derivation on every use is O(HMAC + importKey) per operation — fast enough for the low-frequency cross-signing path.

#### 3.6.3. Recovery Group integration

Tier 2 ships the Recovery Group: a set of admins whose Shamir shares can reconstruct a group private key that was used to wrap the user's vault-unlock secret. Tier 3 extends the Recovery Group to wrap *two* secrets:

- The PUK seed (so a fully-lost user can be re-provisioned into their account).
- The master signing seed (so cross-signing can be reconstructed on the new device).

The wrapping labels are distinct: `LABEL_PUK_RECOVERY_GROUP_WRAP` and `LABEL_MASTER_RECOVERY_GROUP_WRAP`. Both wrappings live in the same `user_master_wraps` row as separate fields.

Recovery flow:

1. Admin Alice initiates recovery via `recovery_initiated(targetUserId, byAdminDeviceId, recoveryRequestId)` sigchain entry.
2. Target user Bob starts the recovery UI in a fresh browser, generates a new device keypair locally.
3. Bob presents his new device's signing and encryption pubkeys via the existing Recovery Group ceremony (Tier 2's modal, extended).
4. Threshold number of admins (e.g., 2-of-3) run the Recovery Group private key reconstruction.
5. With the reconstructed Recovery Group private key, the participating admins decrypt BOTH wraps (PUK seed + master seed).
6. The admins re-wrap the PUK seed to Bob's new device pubkey and sign `recovery_completed(targetUserId, newDeviceId, newDeviceSigningPubkey, newDeviceEncryptionPubkey, participatingAdminDeviceIds, recoveryRequestId)`.
7. Bob's new device receives the envelope + sigchain entry, verifies, installs, continues.

**The master seed does not need to be re-distributed.** Bob's new device can regenerate the master key locally by re-deriving from the master seed (which the admins just recovered). The admins hand Bob's new device the master seed in a one-shot envelope wrapped to its X25519 pubkey, separate from the PUK envelope, labeled `LABEL_MASTER_RECOVERY_HANDOFF`. Bob's device stores the master seed encrypted under its freshly-minted PUK SecretBox key immediately after receipt, then zeroes the transient copy.

**Why the Recovery Group holds master + PUK rather than the whole device key.** Device keys are non-extractable and not recoverable. The recovery flow creates a *new* device with a fresh keypair. What is recovered is the user's identity (master) and the user's cross-device secret (PUK). The lost devices remain lost; the sigchain records a `device_remove` entry for each at the time of recovery (signed by one of the recovery-participating admin devices via a bootstrap signature chain that the `recovery_completed` entry authorizes).

#### 3.6.4. Cross-signing UX

Admin-to-volunteer cross-signing happens at invite-acceptance time:

1. Admin Alice creates an invite via the existing invite flow. The invite carries a short out-of-band code.
2. Volunteer Bob clicks the invite link, creates his account (first device + PUK + master key), and presents a QR code containing his master pubkey to Alice.
3. Alice scans Bob's QR (or Bob types his fingerprint to Alice over a trusted channel).
4. Alice's UI shows a SAS code derived from the shared X25519 between Alice's self-signing DH partner key and Bob's master-derived DH partner key. (In practice: HKDF over the canonicalized pair of master pubkeys + an enrollment nonce, identical mechanism to §3.4.2 but between master-level keys rather than device-level keys.)
5. Bob's UI shows the same SAS code, derived from the same computation.
6. Both click "codes match".
7. Alice's client signs Bob's master pubkey with Alice's user-signing key and emits `user_cross_sign(signingUserId=alice, signedUserId=bob, signedUserMasterPubkey=bobMasterPub, userSigningSignature=..., verificationMode='sas')`.
8. From that point, every device Bob adds via `device_cross_sign` inherits Alice's transitive trust, because the chain is: Bob's device → signed by Bob's self-signing key → signed by Bob's master key → signed by Alice's user-signing key (verified) → signed by Alice's master key (pre-trusted at Alice's onboarding).

An admin-only shortcut exists: `verificationMode: 'admin_grant'` lets an admin bypass SAS and cross-sign directly, but only if the admin has already been granted the `can_grant_trust_without_sas` role permission. This exists for the realistic use case where a hub's admins physically know a new volunteer. The role permission is itself hub-scoped and stored in the audit-signed settings path.

### 3.7. Cascading Lazy Key Rotation (CLKR)

Three triggers:

1. **Member removed from a hub.** The user's devices are all removed from the hub's device set for that hub.
2. **Single device of a still-member user is revoked.** That device is removed from the hub's device set; all of the user's other devices remain.
3. **Scheduled or manual rotation.** Admin clicks "rotate this hub's key now". All current device envelopes are re-issued under a fresh hub key.

#### 3.7.1. Lazy versus eager rewrap

The rotation always:

- Generates a new 32-byte hub key.
- HPKE-wraps the new hub key to every remaining device's X25519 pubkey.
- AES-GCM-256 encrypts the old hub key under the new hub key (AAD = `LABEL_HUB_PTK_PREV_GEN:hubId:newGen`).
- Emits a `hub_ptk_rotate` sigchain entry with `deviceEnvelopeCommitments` + `oldGenWrappedUnderNew`.

The rotation does NOT:

- Re-encrypt any existing data (hub-encrypted fields, notes, messages, attachments) under the new hub key.
- Touch the `items_key` indirection that Tier 1 introduces (the `items_key` is what actually encrypts content; the hub key wraps the `items_key`).

The "lazy" part is that existing ciphertext stays encrypted under whichever generation it was written. When a client needs to decrypt content tagged with generation N, it:

1. Fetches its hub-key envelope for the current generation (let's say N+3).
2. Opens it → current hub key.
3. Uses the current hub key to decrypt `oldGenWrappedUnderNew` for gen N+3, yielding the gen N+2 hub key.
4. Uses gen N+2 to decrypt gen N+1's `oldGenWrappedUnderNew`, yielding gen N+1.
5. Continues until it has gen N.
6. Uses gen N to unwrap the content's `items_key`.
7. Decrypts the content.

The chain of `oldGenWrappedUnderNew` blobs is O(generations) long in the worst case. A hub with 3 rotations per month has 36 generations per year; the worst-case decrypt walks 36 AES-GCM operations. Caching opens up to the current generation so subsequent reads are O(1) amortized.

**A forward-going optimization** (not required for Tier 3 correctness but worth mentioning): a client can proactively "compact" its generation chain by re-encrypting all items that use an old generation under the current generation — but this is explicitly lazy, not part of the rotation critical path.

#### 3.7.2. Cascading across hub hierarchies

The master doc §6.3 and the brief §3.5 describe cascading semantics for nested hubs. Llamenos does not currently have nested hubs. Tier 3 does not introduce them, but the rotation API and the sigchain schema are designed so that when nested hubs land in a future tier (likely Tier 4 or Tier 6), adding cascading is additive:

```typescript
interface RotationCascadePlan {
  triggerHub: string
  affectedHubs: string[]      // triggerHub + any subteam/child that inherits membership
  reason: 'member_removed' | 'device_removed' | 'scheduled' | 'manual'
}

async function planRotationCascade(triggerHub: string, reason: string): Promise<RotationCascadePlan> {
  // Today: always [triggerHub]. Tier-4-or-later: walks the hub hierarchy.
  return { triggerHub, affectedHubs: [triggerHub], reason }
}
```

Every rotation call goes through `planRotationCascade()`. Today it is a no-op identity function. The future introduction of nested hubs adds hierarchy-walking without touching any caller site.

#### 3.7.3. Atomic rotation across multiple hubs for a device-remove

When a single device is revoked and the user is a member of, say, 4 hubs, the rotation touches 4 hubs. All 4 must rotate atomically from the client's perspective — a partial rotation would leave the revoked device with continued access to some hubs while being excluded from others, which is a security failure mode.

The client executes the 4 rotations in parallel, but the server-side POST is *one* transaction with all 4 `hub_ptk_rotate` entries plus the `device_remove` entry plus the new envelopes. The server's `audit-log-service.ts` from Tier 0 already supports multi-entry appends; Tier 3 extends it with an explicit `appendBatch(entries[])` API that wraps the inserts in a PostgreSQL `BEGIN`/`COMMIT`.

### 3.8. Paper key = device

A paper key is a BIP39-rendered seed that deterministically derives an Ed25519 + X25519 keypair, stored as a `device_add` sigchain entry labeled as a paper recovery.

#### 3.8.1. Generation

```typescript
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'

async function generatePaperRecoveryKey(
  primaryDevice: DeviceKeypair,
  pukGen: number,
): Promise<{ mnemonic: string; deviceAddEntry: SignedAuditEntry; pukEnvelope: string }> {
  // 128 bits of entropy → 12 English words. Tier 2's Diceware phrase mode is
  // similar shape but uses a different wordlist; Tier 3 unifies on BIP39.
  const mnemonic = generateMnemonic(wordlist, /*strength*/ 256)  // 24 words, 256 bits
  const seed = mnemonicToSeedSync(mnemonic)

  // HMAC-derive two 32-byte seeds from the BIP39 seed + domain-separated labels.
  const signingSeed = hmac(sha256, seed, utf8(LABEL_PAPER_KEY_SIGNING))
  const encryptionSeed = hmac(sha256, seed, utf8(LABEL_PAPER_KEY_ENCRYPTION))

  // Import them as CryptoKeys. Private halves are non-extractable for the
  // importKey usages we pass in. The PUBLIC halves exported via exportKey('raw')
  // succeed because that's the public half only.
  const signingPriv = await crypto.subtle.importKey('raw', signingSeed, { name: 'Ed25519' }, false, ['sign'])
  const encryptionPriv = await crypto.subtle.importKey('raw', encryptionSeed, { name: 'X25519' }, false, ['deriveBits'])

  // Derive and export PUBLIC halves for the sigchain entry.
  const signingPub = await deriveEd25519PublicRaw(signingSeed)
  const encryptionPub = await deriveX25519PublicRaw(encryptionSeed)

  signingSeed.fill(0); encryptionSeed.fill(0); seed.fill(0)

  // Build the device_add entry signed by the primary device. The paper key is
  // modeled as a device whose display_name is "Paper recovery key" with a flag.
  const deviceAddEntry = await primaryDevice.signAuditEntry({
    type: 'device_add',
    userId: currentUserId,
    newDeviceId: crypto.randomUUID(),
    newDeviceSigningPubkey: bytesToHex(signingPub),
    newDeviceEncryptionPubkey: bytesToHex(encryptionPub),
    newDeviceDisplayName: await encryptHubField('Paper recovery key', pukSecretBoxKey),
    signedByDeviceId: primaryDevice.deviceId,
  })

  // Open the primary's PUK, wrap to the paper key's encryption pubkey.
  const pukEnvelope = await wrapPukToDeviceEncPub(encryptionPub, LABEL_PUK_WRAP_TO_DEVICE)

  return { mnemonic, deviceAddEntry, pukEnvelope }
}
```

The returned `mnemonic` is shown to the user ONCE in a print-or-write-down modal. The user is strongly warned that this is the only time it will be displayed. No plaintext copy is persisted client-side.

#### 3.8.2. Recovery from the paper key

Recovery is the inverse:

1. User types (or pastes) the 24-word mnemonic into the recovery UI.
2. Client validates the mnemonic with `@scure/bip39`'s `validateMnemonic`. Invalid phrases are rejected with a clear error.
3. Client runs the same HMAC-derivation to reproduce the signing + encryption keypairs as transient seeds.
4. Client imports the X25519 seed into a transient non-extractable `CryptoKey`.
5. Client fetches the server-side PUK envelope tagged with the paper key's `deviceId`.
6. Client opens the envelope with the imported X25519 private key → yields the PUK seed.
7. Client generates a FRESH device keypair for the current browser, POSTs a `device_add` signed by the paper key (the paper key temporarily IS a device; this particular `device_add` is signed via the paper key's Ed25519 seed).
8. Client re-wraps the PUK to the new fresh device.
9. Client emits a `device_remove(removedDeviceId=paperKeyDeviceId, reason='rotation')` to retire the paper key after a successful recovery. The paper key is single-use — once used, rotated out.

**Why the paper key is single-use.** A paper key that's been used to recover the account is likely also been seen by the recovery environment (a kiosk, a clipboard manager, a screen recorder). Rotating it out forces generation of a new one, which can be stored in a safer place.

#### 3.8.3. Paper key vs Tier 2's recovery phrase

Tier 2's brief introduces a Diceware recovery phrase as one of the unlock factors. The brief's open question #7 asks whether to unify Tier 2's phrase with Tier 3's paper key. **Decision: unify on Tier 3's BIP39 format.** Tier 2's Diceware path is removed; Tier 2 instead calls the Tier 3 paper-key mechanism as its "recovery phrase" offering. The two documents refer to the same artifact.

Implications:

- Tier 2 ships with Argon2id over BIP39 mnemonic (NOT over a separate Diceware phrase). The Argon2id output is a KEK that wraps the device's bootstrap envelope.
- Tier 3 uses the same BIP39 mnemonic as a deterministic seed that derives a device keypair + unlocks the PUK directly.
- Both purposes coexist: the mnemonic is both the KEK-factor material (via Argon2id) and a device-in-itself (via HMAC-derivation). Users see ONE recovery phrase concept, not two.

This requires coordination with the Tier 2 spec author — noted in "out of scope / dependencies".

### 3.9. Client state management and user-facing UX

#### 3.9.1. "Which device am I" as first-class state

`src/client/lib/auth.tsx` currently holds `{ user, isUnlocked, hubRoles, ... }`. Tier 3 extends it:

```typescript
interface AuthState {
  user: { pubkey: string; userId: string } | null  // pubkey from device signing key, userId from sigchain
  currentDevice: {
    deviceId: string
    displayName: string
    addedAt: string
    isPaperKey: boolean
  } | null
  pukGeneration: number
  knownDevices: Array<{
    deviceId: string
    displayName: string          // decrypted for UI
    isCurrent: boolean
    addedAt: string
    addedByDeviceId: string | null
    revokedAt: string | null
  }>
  sigchainHead: {
    entryHash: string
    seq: number
    verifiedAt: string
  }
  isUnlocked: boolean
  hubRoles: HubRole[]
}
```

Every state-changing operation on the user identity flows through a React Query mutation that triggers sigchain re-verification, IDB update, and `knownDevices` refresh on success.

#### 3.9.2. New UI surfaces

New routes under `src/client/routes/settings/`:

- `settings/devices` — Device list view. Shows all active + revoked devices, "this is the current device" badge, last seen time, ability to rename, ability to revoke.
- `settings/devices/add` — Add-device wizard. Generates QR, shows SAS, handles state transitions.
- `settings/devices/recovery-phrase` — Paper key management: generate new, view last-generated date, retire current paper key.
- `settings/security/cross-signing` — Master key / cross-signing status. Shows "your identity is verified by N admins" and a list of users you have cross-signed.

Existing routes touched:

- `routes/invites/accept.tsx` — first-device creation flow now calls `createInitialPuk()` + emits `user_init`.
- `routes/onboarding/*` — onboarding steps that previously created the `nsec` now create the device keypair + PUK.
- `routes/login.tsx` — unlock on a new device without existing keypair redirects to "add this as a new device" (requires an existing device to pair).

All new UI components carry stable `data-testid` attributes from day one per `feedback_testid_only_selectors`. Every interactive element has a testid. Text-based selectors are banned in Tier 3 tests.

### 3.10. Server-side implementation notes

- **`auth-facade.ts` changes.** New endpoints:
  - `POST /api/auth/devices/enrollment` — start an enrollment session. Returns `{ sessionId, expiresAt }`.
  - `GET /api/auth/devices/enrollment/:sessionId` — poll session state.
  - `POST /api/auth/devices/enrollment/:sessionId/sas-confirm` — both sides confirm. Transitions to `sas_matched`.
  - `POST /api/auth/devices` — finalize. Body contains the signed `device_add` entry + the PUK envelope for the new device. Server runs sigchain append via `AuditLogService.appendBatch`.
  - `DELETE /api/auth/devices/:deviceId` — revoke. Body contains the signed `device_remove` + the `hub_ptk_rotate` entries + new envelopes for each affected hub.
  - `GET /api/auth/devices` — list for current user (decrypts nothing; returns ciphertext display names + metadata).
  - `GET /api/auth/sigchain?since=<entryHash>` — incremental sigchain fetch for the user.
  - `POST /api/auth/recovery/initiate` — starts a recovery request (admin only).
  - `POST /api/auth/recovery/:requestId/complete` — finalize recovery.

- **Dropped endpoints.** All `/api/provision/rooms/*` endpoints are removed. The `provision_rooms` table is dropped.

- **IdP adapter changes.** The `IdpAdapter` interface's `getNsecSecret` and `rotateNsecSecret` methods are removed. The IdP-bound value is repurposed as a KEK factor for the Tier 2 unlock flow; it no longer wraps user identity keys. The Tier 3 migration section details this.

- **Service changes.** `IdentityService`, `SettingsService`, `RecordsService` all stop passing around `user_pubkey` as a single-value identifier for crypto operations. Every crypto recipient is a device, identified by `(user_id, device_id)`. Recipient lists for rewrap operations are expanded from `users.length` to `devices.length`.

- **Hub-field encryption on server-side create/update paths.** Server never has the hub key (that remains a client-side concept). Server-side fallback paths that previously accepted plaintext and encrypted with a cached server copy of the hub key are *removed*. The only path for hub-field creation is: client encrypts under the hub key → sends ciphertext + labels → server persists. Any server route that used to have the "fallback to plaintext" code path now rejects plaintext submissions with 400. This is a clean-cut change; pre-production allows it.

### 3.11. Crypto worker changes summary

The crypto worker (`src/client/lib/crypto-worker.ts`) is rewritten for Tier 3. Changes:

- **Removed operations:** `sign`, `decrypt`, `encrypt`, `provisionNsec`, `decryptEnvelopeField`, `envelopeEncryptField`, `reEncrypt`, `exportSession`, `importSession`, `computeHmac`. Any session-capsule support is deleted because the capsule was a workaround for re-derivation cost that non-extractable `CryptoKey`s eliminate.
- **Added operations:**
  - `deviceSign(messageBytes)` — Ed25519 signature using the current device's signing key.
  - `deviceUnwrap(envelope, expectedLabel)` — HPKE open using the current device's X25519 key, with label verification.
  - `deriveDeviceEnrollmentSas(peerDeviceX25519PubRaw, enrollmentNonce)` — derives the 6-digit SAS for device enrollment. Uses the current device's X25519 private key.
  - `openPukEnvelope(envelope, generation)` — unwraps this device's PUK envelope for a given generation. Returns a transient `pukHandle` — an opaque reference, NOT the raw seed. Subsequent operations take the handle.
  - `wrapPukFromHandle(pukHandle, newDevicePubRaw, aadComponents)` — uses the transient PUK seed behind a handle to wrap for a new device. Clears the handle after use.
  - `rotatePukFromHandle(pukHandle, remainingDevicePubs, oldGen)` — generates a new PUK seed, wraps it to every remaining device, encrypts the old seed under the new SecretBox key, returns the bundle. Clears the old handle + new transient seed.
  - `signUserSigchainEntry(entry)` — builds and signs a sigchain entry that must be signed by the current device's key. Combines `computeEntryHash` + `deviceSign`.
  - `verifyDeviceSignature(message, signature, signerPub)` — convenience helper for sigchain verification.

**The worker exposes zero APIs that let the main thread see any private key material or any PUK seed.** PUK seeds live behind opaque handles inside the worker; device private keys live as `CryptoKey` which are inherently non-exfiltrable from the worker.

**Rate limits** are retained and extended:
- `deviceSign`: 10/sec, 100/min
- `deviceUnwrap`: 100/sec, 1000/min
- `puk_*` operations: 5/sec, 50/min (these are not hot paths)

Exceeding a limit auto-locks the worker as in the current codebase.

## Resolved open questions (from the brief)

Decisions baked into the design, captured for traceability.

1. **Device ID stability (brief Q1).** UUIDv4. Hash-of-pubkey rejected — awkward when rotating a device's keypair within a sigchain-identified slot. The pubkey is still bound to the ID via the signed `device_add` entry.

2. **Master vs first-device key (brief Q2).** Separate master signing keypair. Matrix pattern. Chosen for clearer recovery semantics: the master key is recoverable via Recovery Group, the first-device key is not. Conflating them would either make the first-device key recoverable (bad — it's supposed to be non-extractable on the device) or make the master key non-recoverable (bad — recovery is the whole point).

3. **Master key recovery (brief Q3).** The master seed is wrapped under the PUK SecretBox key AND under the Recovery Group key (Tier 2). Two wrappings means two independent recovery paths. Losing all devices still recovers via Recovery Group; losing the Recovery Group's Shamir shares still recovers via any surviving device (as long as one holds the PUK envelope).

4. **Sigchain storage (brief Q4).** Server-hosted primary (PostgreSQL `audit_log` table from Tier 0, extended schema from this tier). Nostr relay mirror is out of scope for Tier 3 and tracked for Tier 4.

5. **Sigchain verification performance (brief Q5).** Incremental via cache. The Tier 0 `audit-chain-verifier` already stores `lastVerifiedEntryHash` per hub; Tier 3 adds per-user partitioning. Re-verification only walks entries newer than the cached head. Cache is cleared on lock and rebuilt on unlock. Cold-boot verification of a user with 100 devices and 500 sigchain entries completes in <100ms in the worker on mid-range hardware (budget assertion, confirmed by perf test in the plan).

6. **Device display metadata (brief Q6).** Encrypted. Display names ("Alice's work laptop") are PII-like and encrypted under the PUK SecretBox key. Stored in `user_devices.encrypted_display_name` column using Tier 0's AEAD AAD binding (AAD = `LABEL_DEVICE_DISPLAY:userId:deviceId`). Server sees ciphertext only.

7. **Paper key vs recovery phrase unification (brief Q7).** Unified on BIP39. Tier 2's brief had a "Diceware phrase" recovery factor; Tier 3 overrides that to use BIP39 instead, with the BIP39 mnemonic serving double duty as both an unlock-factor KEK input AND a paper-key device. This requires a note in the Tier 2 spec author's inputs; see §3.8.3.

8. **Cross-signing verification UX (brief Q8).** QR-primary with SAS secondary. QR-scan is the default (phone camera scans admin's desktop QR, same UX as WhatsApp device linking). SAS is shown as a fallback for environments without a camera (air-gapped admins, keyboard-only setups). Both modes produce the same `user_cross_sign` entry; `verificationMode` field records which was used.

9. **How do hub admins cross-sign volunteer devices (brief Q9).** Admin cross-signs at the *master* level, once per volunteer, at invite acceptance. Subsequent volunteer devices are trusted transitively via the volunteer's own self-signing key. Hub admins do NOT cross-sign each individual device. This matches Matrix's model and avoids O(admins × devices) cross-signature bloat.

10. **Migration path (brief Q10).** Pre-production clean cut. Dev DB wipe. No user data to migrate. Existing dev accounts are recreated via the new onboarding flow on first unlock after the deploy. Detailed migration runbook in §"Migration".

11. **MLS on-ramp (brief Q11).** Tier 3's devices ARE the future MLS members. No structural change at Tier 6. The `hub_key_envelopes` table's `(hub_id, generation, device_id)` shape maps 1:1 to MLS KeyPackages per device. The TreeKEM epoch transitions in Tier 6 will replace the `hub_ptk_rotate` mechanism but will not change the device-level membership concept.

**New question resolved during design:**

12. **Session capsule compatibility.** PR #50 (session capsule) was designed around the Tier 0/Tier 1 world of "one nsec per user, worker-held in closure, capsuled for re-unlock cost amortization". In Tier 3's world, per-device keys are non-extractable `CryptoKey`s held in IDB — re-derivation cost is zero (IDB `get()` returns the same handle), so the capsule is unnecessary. **Decision:** session capsule is removed in Tier 3. The tab-visibility lock/unlock flow remains and operates on "is the device keypair currently loaded in the worker's closure" rather than "is there a capsule to restore from".

## Testing

Tier 3 is the single largest test surface in the security workstream. The testing plan is organized by the threat model: each adversarial capability gets at least one test that exercises the attack and asserts the defense holds.

### Adversarial test matrix

| # | Adversary capability | Target | Test case | Suite |
|---|---|---|---|---|
| A1 | Server can substitute a phantom device in `device_add` response | Client sigchain verifier | Forged `device_add` without valid signed_by signature → rejected | Unit |
| A2 | Server can replay an old `device_remove` | Client sigchain verifier | Replayed entry with mismatched `prev_entry_hash` → rejected | Unit |
| A3 | MITM on device enrollment QR | Enrollment flow | Substituted QR with attacker's X25519 pubkey → SAS mismatches → pairing aborts | UI E2E |
| A4 | Attacker with stolen device X25519 private key tries to open new-gen envelope | PUK rotation | New-gen envelope derived from new seed does not open with old-gen key | Unit |
| A5 | Attacker with stolen device tries to post fraudulent sigchain entry after revocation | Sigchain chain-gate | Revoked device's signature is rejected because sigchain verification excludes it post-revoke | API E2E |
| A6 | Server tampers with a `hub_ptk_rotate` entry's `deviceEnvelopeCommitments` | Commitment check | SHA-256 mismatch between envelope and commitment → open aborts | Unit + API E2E |
| A7 | Malicious Alice tries to cross-sign Bob's master key without SAS | `user_cross_sign` path | Entry emission without SAS flag (or with `admin_grant` but no permission) → rejected on server | API E2E |
| A8 | Recovery Group with < threshold admins tries to complete recovery | `recovery_completed` | Entry with `participatingAdminDeviceIds.length < threshold` → rejected | API E2E |
| A9 | Server tries to suppress a `device_remove` to keep a revoked device reachable | Client sigchain verifier + `hub_ptk_rotate` check | Client notices the chain head hasn't advanced past the expected device_remove → rewrap blocked | API E2E |
| A10 | Paper key is used twice | Paper key lifecycle | Second use after `device_remove` for the paper key → rejected because the paper key's signing pubkey is no longer in the verified device set | Unit + UI E2E |
| A11 | Sigchain fork | Verifier | Two entries claim the same `prev_entry_hash` → verifier selects first-wins by `created_at`, rejects second with `fork_detected` | Unit |
| A12 | Rotate-during-active-session | Hub content decrypt | Client is decrypting content at gen N, admin rotates to gen N+1 mid-flight → decrypt completes with gen N, next decrypt picks up gen N+1 transparently via `oldGenWrappedUnderNew` | API E2E |
| A13 | Revoke self | Device revoke | Current device tries to post a `device_remove` for itself → rejected with `cannot_revoke_self` | API E2E |
| A14 | Cross-device revocation notification | Device list UI | Device A revokes device B; device A's UI shows the revocation immediately; on device C reload, device C's UI also shows the revocation | UI E2E |
| A15 | Device display name confidentiality | Server endpoint | `GET /api/auth/devices` returns ciphertext display names; server process never sees plaintext | Unit + API E2E |
| A16 | Label swap on PUK envelope | `deviceUnwrap` | Craft a `puk_wrap` envelope where `labelId` is set to a different registered label id → `CryptoLabelMismatchError` raised | Unit |
| A17 | Frozen clock replay on enrollment nonce | Server | Enrollment finalize called after 2-minute expiry → rejected | API E2E |
| A18 | Sigchain signer authorization | `device_add` signer check | A volunteer device tries to sign a `hub_membership_add` for another user → rejected with `signer_not_authorized_for_payload` | API E2E |
| A19 | `items_key` cross-hub leak attempt | Hub-field encryption | An admin who is in hub A tries to decrypt hub B's content → AAD mismatch → throws | Unit |
| A20 | PUK previous-gen chain walk | CLKR read path | Content encrypted under gen 2 is decryptable from gen 5 via the chain | Unit |

### New unit tests

`src/client/lib/device-identity.test.ts`:
- `generateDeviceKeypair` produces keypair with non-extractable private keys (attempting `exportKey` on private throws)
- `deviceId` is a valid UUIDv4
- Signing and encryption public keys are 32 bytes
- Display name is encrypted via hub-field path (not raw)

`src/client/lib/device-identity-store.test.ts`:
- `putDeviceKeypair` then `getDeviceKeypair` round-trips (non-extractable `CryptoKey` survives IDB structured clone)
- Multiple keypairs in store → `MultipleDeviceKeypairsError`
- Absent store returns `null`
- Clearing the store clears cleanly

`src/client/lib/puk.test.ts`:
- `derivePukSubkeys` produces distinct keys per generation
- Three subkeys are distinct from each other
- Exporting a derived sign private key throws (non-extractable)
- Zero-fill asserts: after `createInitialPuk`, the local `pukSeed` variable should be all-zero (observable only via `spyOn` on a wrapper function in test mode)
- Rotating from gen 1 to gen 2 produces a new seed AND wraps the old seed under the new SecretBox key
- Decrypting an old-gen wrap with the new SecretBox key yields the original old seed

`src/shared/schemas/audit-entries.test.ts` (extends Tier 0):
- Every new payload variant round-trips through zod
- Discriminated union correctly dispatches on `type`
- Canonical hash is deterministic for each new payload type
- Canonical hash differs when any field changes

`src/client/lib/user-sigchain-verifier.test.ts`:
- Happy path: `user_init` → `device_add` → `puk_rotate` → `device_remove` chain of 20 entries verifies
- Chain with invalid `prev_entry_hash` at entry 5 rejects entry 5 and all after
- Chain with a `device_add` signed by a not-yet-added device rejects
- Chain with a `device_remove` signed by the device being removed rejects
- Chain with a `puk_rotate` whose generation does not increment by 1 rejects
- Chain with a `hub_ptk_rotate` whose commitments omit a non-revoked device of the user rejects
- Chain with a `user_cross_sign` whose signature is invalid rejects
- Fork detection: two entries with same `prev_entry_hash` and different payloads → second is rejected
- Incremental verification: first call walks 100 entries; second call with `since=` walks only the new 5

`src/client/lib/hub-key-manager.test.ts` (rewritten for Tier 3):
- `loadMyHubKeyForHub` verifies sigchain before unwrap
- Tampering with the commitment hash in the entry → `assertDeviceCommitmentMatches` throws
- Tampering with the envelope bytes → `assertDeviceCommitmentMatches` throws
- Lazy gen walk: content written under gen N is decryptable from gen N+K via the wrap chain
- Rotation on device removal produces commitments for remaining devices only

`src/client/lib/device-enrollment.test.ts`:
- `computeDeviceEnrollmentSAS` produces identical SAS codes from both sides for matching inputs
- `computeDeviceEnrollmentSAS` produces different SAS codes when any input differs
- State machine transitions: idle → generating → awaiting_qr → sas_compare → user_confirmed_sas → awaiting_puk_envelope → enrolled
- Invalid transitions are rejected
- Enrollment session TTL honored: expired session rejects finalize

`src/client/lib/cross-signing.test.ts`:
- Master key wrapping under PUK SecretBox + Recovery Group both succeed
- Master key unwrapping via either path yields identical seed
- `user_cross_sign` payload signature verifies under the signer's user-signing key
- Transitive trust: after Alice cross-signs Bob, Bob's new device signed by Bob's self-signing key is considered trusted by Alice

`src/client/lib/paper-key.test.ts`:
- Mnemonic generation produces 24 valid BIP39 words
- `validateMnemonic` rejects altered phrases
- Deterministic derivation: same mnemonic → same keypair every time
- Recovery flow: from mnemonic → device keypair → open PUK envelope → yields correct seed
- Paper key is retired (device_remove entry emitted) after single use

`src/server/services/device-service.test.ts`:
- Append `device_add` with valid signature → row inserted
- Append `device_add` signed by non-existent device → rejected
- Append `device_remove` for unknown device → rejected
- List devices for user returns only non-revoked + encrypted display names
- Batch append in one transaction: partial failure rolls back all entries

`src/server/services/hub-key-service.test.ts`:
- Issue envelopes on `hub_ptk_rotate` + insert commitments
- Query `getHubKeyEnvelopeForDevice` returns current-gen envelope
- Cascade rotation across 4 hubs for a single device-remove completes atomically (one transaction)

### New API E2E tests

`tests/api/tier3-device-lifecycle.spec.ts`:
- Create user (`user_init`) → fetch sigchain → assert initial entry is verifiable
- Add a second device via the full enrollment flow → assert both devices can decrypt the same hub field
- Revoke the second device → assert the revoked device cannot unwrap new-gen envelopes (simulated via a test helper that retains the revoked device's keys)
- Revoke reason is preserved through the sigchain
- Cannot revoke self

`tests/api/tier3-sigchain-verification.spec.ts`:
- Tampered server response (forged device_add) → client verification fails
- Server suppresses a device_remove → client's next hub-key fetch includes the expected entry; if the server omits it, verification fails
- Replay of stale entries rejected
- Fork attempt rejected

`tests/api/tier3-hub-ptk-rotation.spec.ts`:
- Member removed from hub → `hub_ptk_rotate` entry + new envelopes for remaining devices
- Cascading rotation: user in 3 hubs, single device revoked → 3 rotations in one transaction
- Old generation content still decryptable via `oldGenWrappedUnderNew`
- Envelope commitment SHA-256 matches on happy path; mismatch (server tampered) fails

`tests/api/tier3-puk-rotation.spec.ts`:
- `puk_rotate` entry emitted with correct generation increment
- Old PUK envelope can no longer be opened by the revoked device
- Remaining devices can open both old and new PUK envelopes transparently
- Attempting a `puk_rotate` with non-monotonic generation → rejected

`tests/api/tier3-cross-signing.spec.ts`:
- `user_master_signing_update` → server persists + master pubkey appears in responses
- `device_cross_sign` self-signature signed by user's self-signing key → verifies
- `user_cross_sign(alice, bob)` with SAS mode → persists + transitive trust works
- `user_cross_sign` without valid user-signing signature → rejected
- Admin with `can_grant_trust_without_sas` role can `admin_grant` without SAS
- Admin without that role cannot

`tests/api/tier3-recovery-group.spec.ts`:
- `recovery_initiated` by admin → persisted
- `recovery_completed` with threshold participants → persisted + new device enrolled
- `recovery_completed` below threshold → rejected
- New device can decrypt all hubs the user was in before recovery

`tests/api/tier3-paper-key.spec.ts`:
- Generate paper key → emits `device_add` + PUK envelope
- Recovery with valid mnemonic → new device keypair + full access
- Recovery with tampered mnemonic → `validateMnemonic` rejects
- Used paper key is retired (next attempt rejected because sigchain shows revoked)

`tests/api/tier3-label-enforcement.spec.ts`:
- Server returns a PUK envelope with wrong labelId → client rejects with `CryptoLabelMismatchError`
- AAD mismatch on `oldGenWrappedUnderNew` → AES-GCM tag failure surfaces as specific error

### New UI E2E tests

`tests/ui/tier3-device-enrollment.spec.ts`:
- Primary device shows "add device" wizard
- New device's QR is rendered and decodable
- Both sides show identical SAS code after pairing
- Confirming "codes match" on both sides transitions to paired
- Enrollment session expires after 2 minutes with a clear error

`tests/ui/tier3-device-list.spec.ts`:
- Device list shows all enrolled devices with decrypted display names
- Current device is marked with "this device" badge
- Revoked devices are shown greyed out with revocation reason + date
- "Revoke this device" triggers the confirmation modal, then executes

`tests/ui/tier3-recovery-phrase.spec.ts`:
- Generate paper key shows the 24-word mnemonic ONCE in a modal with a confirmation checkbox
- Copying the phrase is disabled; right-click is disabled; a "print" button triggers a safe print stylesheet
- After confirming "I have written it down", the phrase is cleared from the DOM
- Recovery flow from the sign-in screen accepts the phrase and enrolls a new device

`tests/ui/tier3-hub-rotation-observable.spec.ts`:
- Admin removes a volunteer → the volunteer's devices stop seeing hub content on next reload
- Audit log in admin UI shows the `hub_ptk_rotate` entry with reason `member_removed`

`tests/ui/tier3-cross-signing-verification.spec.ts`:
- Admin invite flow shows the new volunteer's master pubkey fingerprint
- SAS UI shows 6 digits; clicking "codes match" on both sides completes the cross-sign
- Post-verification, admin UI shows "Bob is verified"

`tests/ui/tier3-mitm-enrollment.spec.ts` (adversarial):
- Use Playwright route intercept to rewrite the QR payload mid-transit → SAS mismatches → enrollment aborts with `sas_mismatch` error state

### Performance tests

`tests/perf/sigchain-verification.spec.ts`:
- Generate a synthetic user sigchain of 500 entries (worst-case: 10 devices enrolled, 100 PUK rotations, 50 cross-signs, etc.)
- Assert full verification on cold unlock completes in < 500ms on CI runner hardware
- Assert incremental verification after first walk completes in < 50ms for 5 new entries

### Regression gate

All Tier 0, Tier 1, Tier 2 tests must continue to pass. No Tier 3 implementation touches a primitive or AEAD pattern that those tiers established — only the identity model layered on top.

- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun run build` — clean, PWA precache updated, no `nsec`-named identifiers remaining in `src/client/lib`
- `bun run test:unit` — all
- `bunx playwright test tests/api` — all
- `bunx playwright test tests/ui` — all
- Grep check: `grep -rn "nsec" src/client --include="*.ts" --exclude-dir=lib/deprecated` returns zero results (the term is banned from the client codebase).
- Grep check: `grep -rn "provision_rooms\\|provisioning.ts" src server` returns zero results.

## Migration

Tier 3 is the cleanest cut in the entire roadmap because there is no production user data. Dev databases are wiped; onboarding flows are re-run.

### Database migrations

One pre-production migration file: `drizzle/migrations/0060_tier3_per_device_keys.sql`.

Structural changes:

1. `DROP TABLE provision_rooms;`
2. `ALTER TABLE users DROP COLUMN encrypted_secret_key;` — the per-user `nsec` is deleted.
3. `ALTER TABLE users DROP COLUMN kek_proof_hash;` — superseded by Tier 2's unlock factors (which Tier 3 assumes are already in place).
4. `CREATE TABLE user_devices (...);` — per §3.5.1.
5. `CREATE TABLE user_puk_envelopes (...);`
6. `CREATE TABLE hub_ptk_generations (...);`
7. `CREATE TABLE hub_key_envelopes (...);`
8. `CREATE TABLE device_enrollment_sessions (...);`
9. `CREATE TABLE user_master_wraps (...);`
10. `DELETE FROM hub_key_envelopes;` — truncate any legacy hub key storage (currently held in `hub_keys` table; schema rewritten).
11. `DROP TABLE IF EXISTS hub_keys;` — replaced by `hub_key_envelopes`.
12. `DELETE FROM audit_log;` — wipe audit log (Tier 0 already did this, but Tier 3 re-asserts the truncation).
13. `DELETE FROM user_security_prefs;` — the `alertOnNewDevice` etc. columns are retained but rows are cleared so that onboarding creates fresh rows.

**The migration explicitly fails if any existing row in `users` has a non-empty `encrypted_secret_key`** — a safety interlock that refuses to run against a prod database. Pre-production means this should never fire in practice.

### Envelope format migration

No inherited envelope format. Tier 1 introduced envelope v2 with `labelId`. Tier 3 reuses v2 unchanged — same byte layout, same label registry. The only semantic change is that envelope *recipients* are now devices rather than users.

### Client storage migration

On first launch after the deploy:

1. Check IDB for `llamenos-device` database. If present, load the existing device keypair.
2. If absent AND `localStorage.llamenos-encrypted-key-v2` is present (legacy Tier 2 encrypted nsec), prompt the user: "This app has been upgraded. You will need to re-onboard." Then clear all legacy storage and send them to the onboarding flow.
3. If absent AND no legacy storage, proceed to first-time onboarding.

This is enforced via a single `ClientMigrationBarrier` component at the app root that blocks rendering of any other route until the check completes.

### UX migration

Users (dev/test accounts) will see a one-time "re-enroll" prompt. The flow is identical to fresh onboarding. Their sigchain starts fresh; there is no cross-version identity continuity.

This is explicitly documented in `CLAUDE.md` under a new "Tier 3 migration notes" section that persists until the first post-Tier-3 release, then is removed.

### IdP adapter migration

The `IdpAdapter.getNsecSecret` method is *removed*. Authentik-stored nsec secrets that existed for Tier 2's unlock flow are deleted from the IdP side via a separate runbook step. The Authentik user attribute that held the secret is cleaned up via an Ansible task in `deploy/ansible/roles/authentik/cleanup-nsec-secret.yml`.

### Test fixture migration

Existing test fixtures that create users by generating an `nsec` and posting it to `/api/invites/redeem` are rewritten to generate a device keypair + PUK + post a `user_init` sigchain entry. The `tests/helpers/authed-request.ts` helper is updated to support signing with a device key instead of a raw schnorr key.

## Out of scope

Explicitly deferred — every item tracked in the master doc and planned for a later tier.

- **Voice E2EE (Tier 5).** The per-device model is a prerequisite for SFrame per-device key distribution, but the actual voice encryption path is Tier 5.
- **MLS group keying (Tier 6).** The `hub_key_envelopes` table's shape is MLS-ready, but no TreeKEM operations happen in Tier 3.
- **ML-KEM-1024 hybrid post-quantum (Tier 6).** HPKE suite selection in Tier 1 leaves a hook for PQ, but Tier 3 uses classical X25519 HPKE.
- **Split code/data origins (Tier 4).** The delivery channel hardening is parallel; Tier 3 does not touch it.
- **Nested hub hierarchies.** `planRotationCascade()` is a no-op identity function today. The structural plumbing is there; the hierarchy data model is not.
- **Multi-account per browser profile.** IDB schema assumes one device keypair per profile. Multi-account is a separate future epic.
- **Admin audit UI for sigchain visualization.** The data is all there (`/api/auth/sigchain`), but a dedicated "timeline view" UI is deferred.
- **Automatic device rotation.** No scheduled auto-rotation of device keypairs. Users rotate manually via "remove then add".
- **Paper key storage hints.** We do not provide a secure printer integration or QR rendering of the phrase — just the text display.
- **IdP synchronization of device lifecycle.** The IdP adapter does not learn about device add/remove. Devices are a Llamenos-internal concept.
- **Cross-hub device deletion.** Deleting a user's account globally is a separate flow (already handled elsewhere via `user_delete`). Tier 3 does not change it.

## Success criteria

Implementation of the accompanying plan is complete when all of the following are verifiable:

1. **No `nsec` or `encryptedSecretKey` references** anywhere in `src/client/` or `src/server/` outside the migration file and its tests. Grep check in CI enforces this.
2. **Every device keypair is created with `extractable: false`.** CI grep check: no `extractable: true` or default-extractable `generateKey` calls in files under `src/client/lib/device-*.ts`.
3. **Every PUK seed access is bracketed by a zero-fill in a `finally` block.** Code review check + grep: every `new Uint8Array(32)` in `puk.ts` must be followed by `.fill(0)` in a `finally`.
4. **The user sigchain verifier** rejects every adversarial test case A1–A20 from the matrix above. Each test is labeled with its A-number in the test body.
5. **Hub-key rotation is O(device_count), not O(user_count).** A test with 5 users × 4 devices each asserts that a membership change produces 20 envelopes per rotation.
6. **Cascading Lazy Key Rotation preserves historical read access.** A test writes content at gen 1, rotates to gen 5 with 3 intermediate device changes, and reads the gen-1 content from gen 5 via the wrap chain. Reads succeed.
7. **Device revocation is immediate and cryptographic.** Test A5: a device held by an attacker post-revoke cannot unwrap a hub-key envelope produced after the revocation.
8. **Paper key works end-to-end.** Generate → display → copy (simulated) → lose all other devices → recover via phrase → new device functional.
9. **Recovery Group flow works end-to-end.** Lose all devices → 2-of-3 admins run recovery → new device enrolled with full sigchain continuity.
10. **Cross-signing transitive trust.** Alice cross-signs Bob's master → Bob adds a new device → Alice's client shows Bob's new device as trusted without Alice re-verifying.
11. **The `provision_rooms` table and the ephemeral-ECDH provisioning protocol are deleted.** CI grep check: no references to `provisioning.ts` or `createProvisioningRoom` in any file outside the migration.
12. **`bun run typecheck`, `bun run lint`, `bun run build` all pass.**
13. **All existing tests (Tiers 0, 1, 2)** pass alongside Tier 3 additions.
14. **UI E2E tests run at PLAYWRIGHT_WORKERS=3** (hub tenancy isolation confirmed).
15. **Sigchain cold-boot verification perf budget:** < 500ms for a 500-entry chain on the CI runner.
16. **Every new component used in Tier 3 UI surfaces** has `data-testid` attributes. Test selectors are testid-only.
17. **Master doc, threat model, and `docs/protocol/llamenos-protocol.md`** are updated to reflect the per-device model. Specifically: `THREAT_MODEL.md` gets a new "device compromise" section; `docs/architecture/E2EE_ARCHITECTURE.md` gets a "Layer 0: device identity" section; `docs/protocol/llamenos-protocol.md` gets the full sigchain entry schema and the PUK/CLKR sequences.
18. **Residual risks documented.** The spec review includes an explicit "residual risks after Tier 3" section in `docs/security/THREAT_MODEL.md`: specifically, (a) no post-compromise security within a generation (Tier 6 fixes); (b) no voice E2EE (Tier 5); (c) the server still learns *which* users have *how many* devices and when they rotate (a metadata leak the sigchain cannot hide).

Every success criterion above corresponds to at least one automated check (grep, test, or build step) and is verifiable by an independent reviewer running `bun run verify-tier-3` (new script that chains all the gates).

## References verified during design

External surface checks performed while writing this spec:

- **Keybase PUK** — https://book.keybase.io/docs/teams/puk. Confirmed: 32-byte random seed, HMAC-SHA256 derivation into three subkey types with labels `Derived-User-NaCl-EdDSA-1`, `Derived-User-NaCl-DH-1`, `Derived-User-NaCl-SecretBox-1`. Confirmed: per-device boxing via each device's DH key. Confirmed: generation increments on device revocation with old seed encrypted under new SecretBox key.
- **Keybase team crypto + CLKR** — https://book.keybase.io/docs/teams/crypto and https://book.keybase.io/docs/teams/clkr. Confirmed: PTK seed → three subkeys per generation. Confirmed: rotation wraps previous seed under new SecretBox key. Confirmed: rotation is lazy (no bulk content re-encryption). Confirmed: cascading is triggered on member-leave, member-remove, user-reset.
- **Matrix cross-signing** — https://spec.matrix.org/latest/client-server-api/#cross-signing (partial content retrieved). Confirmed three-keypair model: master, self-signing, user-signing. Confirmed: TOFU verification propagates transitively. Confirmed: SAS ceremony signs the other user's master key with the local user-signing key.
- **vodozemac / matrix-rust-sdk** — Rust, not directly usable. We adopt the *pattern*, not the implementation. No JS library wrapping vodozemac exists in a form we can import.
- **`@hpke/core` family** — https://github.com/dajiaji/hpke-js. Confirmed: RFC 9180 implementation. Confirmed: X25519 + HKDF-SHA256 + ChaCha20-Poly1305 cipher suite available. Confirmed: uses WebCrypto primitives where available → non-extractable recipient keys are supported.
- **`@scure/bip39`** — https://github.com/paulmillr/scure-bip39. Confirmed: Cure53-audited 2022 (Ethereum Foundation funded). Confirmed: `generateMnemonic`, `mnemonicToSeedSync`, `validateMnemonic`, `entropyToMnemonic` exports. Confirmed: English wordlist supported. 24-word phrase = 256 bits of entropy.
- **`privy-io/shamir-secret-sharing`** — https://www.npmjs.com/package/shamir-secret-sharing. Confirmed: Cure53 + Zellic-audited. Zero dependencies. GF(2^8) on `Uint8Array`. This is the Tier 2 dependency; Tier 3 references it for the Recovery Group private-key reconstruction path.
- **WebCrypto Ed25519 + X25519** — Chrome 137+ / Firefox 135+ / Safari 17.4+. Tier 1 assumes these are available; Tier 3 does not introduce a fallback.

No external API promises unverifiable assumptions. Anything that could not be confirmed from primary sources is called out as "resolved open question" above or flagged as an implementation-time discovery in the plan.

## Security analysis residuals

Four classes of residual risk survive Tier 3. Each is tracked with a downstream tier that addresses it.

1. **No post-compromise security within a single PUK generation.** If an attacker compromises a device during PUK generation N, every envelope written under generation N remains readable forever — even after PUK rotates to N+1. PCS requires per-message DH ratcheting, which is Tier 6's MLS epoch model.
2. **Voice and real-time media are not encrypted at the application layer.** DTLS-SRTP is still hop-by-hop to Asterisk. Tier 5 lands SFrame over `RTCRtpScriptTransform`.
3. **Metadata leakage: who has how many devices, when they enroll, when they rotate.** The server must persist `user_devices` rows to function, and even with encrypted display names it sees counts, timing, and rotation frequency. Mitigations (onion routing, metadata padding) are out of scope; documented in `THREAT_MODEL.md`.
4. **Sigchain growth over time.** A long-lived account accumulates sigchain entries indefinitely. Tier 3's incremental verification keeps hot-path cost bounded, but cold-boot verification grows linearly. A compaction / snapshot mechanism (sign a checkpoint that summarizes all prior entries) is a future optimization, not blocking.
