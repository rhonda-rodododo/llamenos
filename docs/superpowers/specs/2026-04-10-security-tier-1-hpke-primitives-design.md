# Security Tier 1 — HPKE + Primitive Modernization

**Date:** 2026-04-10
**Status:** Draft
**Branch:** `feat/sec-tier-1-hpke-primitives`
**Branch base:** `feat/sec-tier-0-albrecht-hardening` (Tier 0 lands first as a hard prerequisite)
**Brief:** [`docs/security/spec-briefs/tier-1-hpke-primitives.md`](../../security/spec-briefs/tier-1-hpke-primitives.md)
**Master doc:** [`docs/security/SECURITY_IMPROVEMENTS_MASTER.md`](../../security/SECURITY_IMPROVEMENTS_MASTER.md) §3.6, §3.9, §6.4, §6.5, §7 Tier 1, §9

## Problem

Tier 0 hardened the existing primitives against the published Albrecht and Mega attack classes without changing any primitive. Tier 1 replaces the primitives themselves.

Llamenos' current key-wrapping primitive — the `eciesWrapKey` / `eciesUnwrapKey` pair in `src/shared/crypto-primitives.ts` plus the duplicate implementations inside `src/client/lib/crypto-worker.ts`, `src/client/lib/crypto.ts`, `src/client/lib/file-crypto.ts`, and `src/server/lib/crypto-service.ts` — is hand-rolled. The construction is:

```typescript
// Current (hand-rolled ECIES) — pre-Tier-0:
const ephemeralSecret = randomBytes(32)
const ephemeralPub = secp256k1.getPublicKey(ephemeralSecret, true)
const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
const sharedX = shared.slice(1, 33)                         // extract x-coord only
const keyInput = concat(utf8ToBytes(label), sharedX)        // label prefix, NOT HKDF
const symmetricKey = sha256(keyInput)                       // one-shot SHA-256, no salt
const sealed = xchacha20poly1305(symmetricKey, nonce).encrypt(plaintext)
```

Four concrete problems with this construction:

1. **It is not HPKE.** It is an ECIES-like scheme with a `sha256(label || sharedX)` KDF instead of HKDF. That is not a standard construction, has no formal security proof, and does not match any reference implementation an auditor can check against.
2. **It uses secp256k1 for user key management.** secp256k1 was chosen for Nostr wire-format compatibility, not for security properties. Nostr pubkeys are x-only 32-byte values; to do ECDH we prepend `"02"` to compressed-form and then extract `.slice(1, 33)` from the 33-byte shared-secret output. Every one of those manual byte manipulations is a potential off-by-one bug. secp256k1 is also not a WebCrypto algorithm in any browser, so every EC operation stays in userspace `@noble/curves` JS — keys are raw `Uint8Array`, never `CryptoKey`.
3. **The private key lives as raw bytes.** `src/client/lib/crypto-worker.ts` line 80 holds `let secretKey: Uint8Array | null = null` — a plain 32-byte typed array in a Web Worker closure. The `autoLock()` function calls `secretKey.fill(0)` on lock, which is best-effort zeroization that V8's garbage collector may or may not honor. `subtle.exportKey()` does not apply because there is no `CryptoKey` — the material *is* the bytes. Bitwarden's 2024 Cure53 finding about key material retention in JS GC applies directly to us.
4. **No primitive-upgrade affordance.** Every note, message, file, and contact envelope is wrapped directly to one or more reader pubkeys. If we ever want to add post-quantum hybrid (Tier 6), swap HPKE AEAD suites, or rotate a user's identity key, we must re-wrap every envelope in the database. Standard Notes' 004 `items_key` indirection (§3.6 of the master doc) solves exactly this problem and we have not adopted it.

Tier 1 addresses all four problems with one coordinated workstream, plus two cross-cutting improvements that fall naturally out of the primitive swap: (a) the crypto worker's secret key becomes a **non-extractable `CryptoKey` handle** stored in IndexedDB, and (b) the multi-factor KEK becomes a **non-extractable AES-KW `CryptoKey`**, closing the Bitwarden/1Password JS-GC retention class of finding.

**External API surfaces verified during spec authoring** (via context7 / WebSearch / direct source inspection on 2026-04-10):

- **`@hpke/core` package structure and KEM table** — verified against `dajiaji/hpke-js/README.md` on `main`. The KEMs table confirms that DHKEM(X25519, HKDF-SHA256) is supported by `@hpke/core` directly (native WebCrypto path) as well as by the `@hpke/dhkem-x25519` extension (noble path).
- **`CipherSuite` constructor and `createSenderContext` / `createRecipientContext` signatures** — verified against `packages/core/src/cipherSuiteNative.ts`, `packages/common/src/interfaces/senderContextParams.ts`, `packages/common/src/interfaces/recipientContextParams.ts`, and `packages/common/src/interfaces/keyScheduleParams.ts` on `main`.
- **`KemInterface` public methods** — verified against `packages/common/src/interfaces/kemInterface.ts`. The interface exposes `generateKeyPair`, `deriveKeyPair`, `serializePublicKey`, `deserializePublicKey`, `serializePrivateKey`, `deserializePrivateKey`, `importKey`, `encap`, `decap`. It does NOT expose `derivePublicKey` — that method lives on the lower-level `DhkemPrimitives` interface and is not part of the public surface.
- **hpke-js extractability defaults** — verified against `packages/core/src/kems/dhkemPrimitives/xCurveNative.ts` on `main`. `generateKeyPair` and `_deserializePkcs8Key` both hard-code `extractable: true`. This means applications that want non-extractable HPKE keypairs must do a generate-export-reimport dance in user-space.
- **Native WebCrypto X25519 and Ed25519 browser status as of April 2026** — verified against Igalia blog (2025-08-25 Ed25519 Chrome ship), chromestatus.com feature 4913922408710144, Mozilla Bugzilla 1804788 + 1904836, and WICG secure-curves spec. Chrome 133+, Firefox 135+, Safari 17.4+ ship both curves in WebCrypto.
- **WebCrypto X25519/Ed25519 import/export format matrix** — verified against WICG secure-curves spec (`wicg.github.io/webcrypto-secure-curves/`). For both X25519 and Ed25519: `spki` is public-only, `pkcs8` is private-only, `raw` is public-only, `jwk` covers both. Our design uses `pkcs8` for private key wrap/unwrap and `raw` for public key storage.
- **IndexedDB + non-extractable CryptoKey persistence** — verified against MDN `SubtleCrypto.importKey` + WICG secure-curves + Mozilla Bugzilla 1348279 (resolved). The structured-clone algorithm applies to `CryptoKey` and preserves the `extractable` flag across IDB reads.

**Concrete gaps identified during code exploration:**

1. **Two parallel ECIES implementations ship in the client.** `src/shared/crypto-primitives.ts` has `eciesWrapKey` / `eciesUnwrapKey`, and `src/client/lib/crypto.ts` has its own `eciesWrapKey` / `eciesUnwrapKey` / `eciesUnwrapKeyWithSecret`. Tier 0 deletes `src/client/lib/crypto.ts` in favor of the shared primitives (see Tier 0 plan Task 17). Tier 1 therefore operates on a single unified primitive file.

2. **Server is also a participant in every envelope.** `src/server/lib/crypto-service.ts` derives its own secp256k1 keypair via HKDF from `SERVER_NOSTR_SECRET` (lines 70–83) and is always included in hub-key envelopes so the server can re-wrap the hub key for new members without requiring an online admin. This means HPKE migration must be done in lockstep on client AND server — the server's keypair, its wrap/unwrap calls, and its envelope shapes all change together.

3. **The crypto worker holds raw nsec bytes.** `src/client/lib/crypto-worker.ts` lines 80–82 declare `let secretKey: Uint8Array | null`. `handleUnlock` at line 209 decrypts the KEK blob, does `secretKey = hexToBytes(nsecHex)`, then computes `schnorr.getPublicKey(secretKey)`. On lock, `autoLock()` at line 127 calls `secretKey.fill(0)` — again, best-effort, not cryptographically sound.

4. **`key-store-v2.ts` uses localStorage, not IndexedDB.** Line 22 `const STORAGE_KEY = 'llamenos-encrypted-key-v2'` and line 158 `localStorage.setItem(STORAGE_KEY, JSON.stringify(data))`. The encrypted blob sits in localStorage as JSON text. This is a departure from modern best practice (non-extractable `CryptoKey` in IDB) and will be corrected in Tier 1.

5. **The session capsule (PR #50) persists a Worker-encrypted nsec in IDB + a random token in sessionStorage.** `src/client/lib/session-capsule.ts` lines 62–73 define `SessionCapsule { encryptedNsec, capsuleNonce, autoLockExpiresAt, pubkeyHash }`. The capsule exists *because* the nsec is raw bytes — if it were a non-extractable `CryptoKey` handle, we could put the handle itself in IDB and skip the capsule encryption layer entirely. Tier 1 retires the capsule as a persistence format and keeps only the cross-tab unlock coordinator (BroadcastChannel signalling, Web Locks serialization).

6. **`key-store-v2.ts` already has a 2F/3F KEK derivation flow.** Lines 81–99 derive `KEK` from `PIN + IdP value + optional PRF output` via HKDF-SHA256. Tier 1 does **not** add new factors (that is Tier 2) — it converts the *output* of this derivation into a non-extractable `CryptoKey` so the KEK bytes never sit in a main-thread `Uint8Array` longer than the `subtle.importKey` call.

7. **The DB schema stores envelope JSONB that will shape-change.** `src/server/db/schema/records.ts` lines 60 and 80 declare `authorEnvelope: jsonb<RecipientEnvelope>()('author_envelope')` and `adminEnvelopes: jsonb<RecipientEnvelope[]>()('admin_envelopes')`. `src/shared/types.ts` line 32 defines `RecipientEnvelope = { pubkey, wrappedKey, ephemeralPubkey }`. HPKE produces a different shape: `(enc, ciphertext)`. We will change the DB columns and the JSONB shape in one migration.

8. **The zod schema mirrors the branded types at the API boundary.** `src/shared/schemas/records.ts` lines 32–37 declare `RecipientEnvelopeSchema = z.object({ pubkey, wrappedKey, ephemeralPubkey })`. API validation also changes.

9. **Tier 0's `LABEL_REGISTRY` already exists.** Tier 0 adds a branded `CryptoLabel` type, a `LABEL_REGISTRY` array, and a `labelToId` / `idToLabel` helper pair. Tier 1 reuses all of this: HPKE's `info` parameter **is** `utf8ToBytes(cryptoLabel)` — a 1:1 mapping with no translation step. The label-in-AAD binding introduced by Tier 0 at the envelope-v2 layer is layered on top of HPKE's own `info`-in-key-schedule binding for triple-redundant domain separation.

10. **Tier 0's `decryptEnvelopeV2` helper becomes the v3 helper.** Tier 0 ships envelope-v2 (hand-rolled ECIES with `labelId` in AAD). Tier 1 ships envelope-v3 (HPKE, one suite, `enc` + `ct` fields, label in HPKE `info`). Pre-production allows a clean cut — no v2-reader retention.

**Threat-model alignment:**

| Attack | Tier 0 defense | Tier 1 additional defense |
|---|---|---|
| Albrecht #3 (type confusion at decrypt) | branded `CryptoLabel` + AAD label binding | HPKE `info` binds label at key-schedule level — a third independent mechanism |
| JS GC retention of key bytes (Bitwarden 2024 Cure53) | n/a (primitive unchanged) | Non-extractable `CryptoKey` — private key bytes never enter JS heap |
| XSS smash-and-grab of identity key | rate limiter forces proxy-through-worker | Non-extractable key is *unexportable* — XSS becomes a live oracle bound by the worker rate limit, not a smash-and-grab |
| Hand-rolled KDF bugs | n/a | HPKE uses RFC 9180 key schedule (HKDF-Extract + HKDF-Expand with `context_string` binding suite + mode + info) |
| Post-quantum migration cost | n/a | `items_key` indirection — swapping HPKE suites re-wraps one key per user, not every artifact |
| Audit findability | labels enforced at decrypt | HPKE has a formal spec, reference implementations, and a commissioned test vector suite (RFC 9180 §A) |

## Design

Organized as four workstreams. 1.1 is the load-bearing primitive swap; 1.2 is the storage upgrade that falls out of it; 1.3 is the native-curve preference pass; 1.4 is the `items_key` indirection that future primitive upgrades need.

All four workstreams land together in one PR, because the envelope format (1.1) and the DB schema (1.1) cannot be half-migrated, and the storage upgrade (1.2) depends on the HPKE suite choice (1.1).

**Guiding principles** (master doc §9, carried forward from Tier 0):

- No backward compatibility. Pre-production. Envelope v2 (hand-rolled ECIES with `labelId` AAD) is deleted in the same PR that introduces envelope v3 (HPKE).
- No new optional parameters on crypto primitives — every crypto function is either HPKE-typed or deleted.
- Domain separation via HPKE `info` string plus `CryptoLabel` branded type (enforced at compile time) plus outer AAD binding (enforced at tag-check time). Three independent mechanisms.
- Non-extractable `CryptoKey` wherever the chosen algorithm is supported by WebCrypto. Where it is not (secp256k1 for Nostr wire, XChaCha20 for legacy), raw bytes remain, but they stay inside the Web Worker's dedicated thread and are not persisted.
- Identity key never wraps data directly — it only derives per-artifact HPKE encapsulations. The `items_key` indirection formalizes this.
- No dependency on PR #50's persistence layer surviving Tier 1; the capsule is retired as a storage format.

### 1.1. HPKE migration — the primitive swap

#### 1.1.1. Suite selection

**Decision: `DHKEM(X25519, HKDF-SHA256)` + `HKDF-SHA256` + `AES-256-GCM`.**

This is HPKE suite ID `0x0020` / `0x0001` / `0x0002` per RFC 9180 §7.1.

**Why X25519:** The `@hpke/core` package ships `DhkemX25519HkdfSha256` natively using WebCrypto where available (confirmed via the dajiaji/hpke-js README KEMs table — ✅ column for `@hpke/core` alongside `@hpke/dhkem-x25519`). On browsers with native X25519 (Chrome 133+, Firefox 135+, Safari 17.4+ — confirmed via Igalia blog and WebKit bug trackers as of April 2026), `suite.kem.generateKeyPair()` returns `CryptoKey` handles that can be non-extractable. On runtimes without native X25519, `@hpke/dhkem-x25519` (noble-backed) is the compatibility extension, but for April 2026 Chromium/WebKit/Gecko targets, we expect native X25519 everywhere.

We do **not** use `@hpke/dhkem-secp256k1` for user keys. secp256k1 is kept exclusively for Nostr wire format (event signing and relay publishing), via `@noble/curves/secp256k1.js`. The user identity key and the Nostr publishing key are decoupled — the user has one X25519 keypair for HPKE-based content encryption and one Ed25519 keypair (also X25519-compatible via `ed25519-to-x25519` conversion — see §1.3) for signing, and the Nostr relay gets its own separate secp256k1 key derived from the same identity root via a domain-separated HKDF.

**Why AES-256-GCM over ChaCha20-Poly1305:**

| Criterion | AES-256-GCM (`@hpke/core` native) | ChaCha20-Poly1305 (`@hpke/chacha20poly1305` extension) |
|---|---|---|
| Package | Built into `@hpke/core`, no extension | Requires `@hpke/chacha20poly1305` extension |
| Backing impl | Native WebCrypto `AES-GCM` subtle impl | `@noble/ciphers/chacha` userspace JS |
| Non-extractable recipient keys | ✅ Yes, via WebCrypto AES-GCM key import | ⚠️ Partial — the AEAD key derived from HPKE key schedule is a raw bytes value by necessity, not a CryptoKey |
| Bundle size | Smaller (no extension) | +~15 KB |
| Side-channel resistance | Hardware-backed on AES-NI CPUs | Constant-time JS |
| Matches existing Llamenos AEAD | ✗ (current XChaCha20-Poly1305) | ✓ (closest to current ChaCha20) |

The brief tentatively recommended ChaCha20-Poly1305 for continuity. Continuity is not a security property. AES-256-GCM via `@hpke/core` is the stronger choice: it stays entirely within native WebCrypto, it enables the non-extractable CryptoKey story for the AEAD key material, and it ships with fewer external dependencies in the crypto path. We accept the one-time incongruity with the current XChaCha20-Poly1305 code — the whole point of Tier 1 is to replace it anyway.

The XChaCha20-Poly1305 primitive is **not** retained elsewhere either. The server-key encryption path (`CryptoService.serverEncrypt/serverDecrypt`) is migrated to HPKE-single-shot with the server's own HPKE keypair as recipient. Hub-key symmetric encryption (`encryptForHub` / `decryptFromHub`) is migrated to AES-256-GCM via WebCrypto, with AAD carrying `(label, recordId, fieldName)` as it does in Tier 0 — but with the key being a non-extractable `CryptoKey` derived from the hub key bytes at import time.

**Codified decision:**

```typescript
// src/shared/crypto-suite.ts (NEW)
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256, Aes256Gcm } from '@hpke/core'

// RFC 9180 suite id: 0x0020 / 0x0001 / 0x0002
// See https://datatracker.ietf.org/doc/html/rfc9180#section-7.1
export const HPKE_SUITE_ID = 'llamenos-hpke-v1:x25519-hkdf-sha256-aes256gcm' as const

export function createHpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  })
}
```

There is exactly one suite. There are no alternates, no per-record suite negotiation, and no suite-id field in the envelope (the suite is implicit in the envelope version). If and when Tier 6 adds ML-KEM hybrid, a v4 envelope format will be introduced.

#### 1.1.2. HPKE API surface used

Verified against `dajiaji/hpke-js/packages/core/src/cipherSuiteNative.ts` (commit on main as of 2026-04-10). Exact call shape:

```typescript
// Recipient setup (at account creation):
// Step 1: hpke-js generateKeyPair returns extractable keys by default
// (verified against packages/core/src/kems/dhkemPrimitives/xCurveNative.ts —
// line: generateKey(this._algName, /* extractable */ true, KEM_USAGES)).
// We cannot change this without forking. Instead, we do a
// generate-export-reimport dance to end up with a non-extractable
// persistent private key.
const suite = createHpkeSuite()
const extractableKeypair = await suite.kem.generateKeyPair()
// Step 2: Export the private key in pkcs8 format (X25519 does not support
// `raw` for private keys — verified against WICG secure-curves spec).
const pkcs8 = await crypto.subtle.exportKey('pkcs8', extractableKeypair.privateKey)
try {
  // Step 3: Re-import as NON-extractable. The original extractable handle
  // will be GCd; we keep no reference to it after this point.
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'X25519' },
    /* extractable */ false,
    ['deriveBits'],
  )
  // privateKey is now a non-extractable CryptoKey. Use it for all
  // subsequent operations. The pkcs8 ArrayBuffer is zeroed below.
} finally {
  new Uint8Array(pkcs8).fill(0)
}
// extractableKeypair.publicKey is public — keep it as-is or
// serialize to 32 raw bytes via `suite.kem.serializePublicKey`.

// Sender (encryptor) seal — unchanged, recipient public key is not secret:
const sender = await suite.createSenderContext({
  recipientPublicKey: recipientPubkey,  // CryptoKey (imported via suite.kem.importKey)
  info: utf8ToBytes(label),             // ArrayBufferView of the CryptoLabel string
})
const ct = await sender.seal(plaintext, aad)
// sender.enc is an ArrayBuffer — the KEM encapsulated key to ship alongside ct.
// hpke-js generates its own ephemeral sender keypair internally; that one is
// extractable by hpke-js convention but lives only for the duration of encap
// and is dropped when createSenderContext returns.

// Recipient (decryptor) open — works with non-extractable privateKey:
const recipient = await suite.createRecipientContext({
  recipientKey: nonExtractablePrivateKey,  // non-extractable — works fine
  enc: encapsulatedKey,                    // ArrayBuffer from sender.enc
  info: utf8ToBytes(expectedLabel),        // MUST match the sender's info
})
const pt = await recipient.open(ct, aad)
// Internally kem.decap calls subtle.deriveBits, which does NOT require
// the private key to be extractable. Verified by reading dhkemPrimitives/
// xCurveNative.ts dh() method which uses deriveBits, not exportKey.
```

**Key facts** (from source inspection, not speculation):

- `SenderContextParams.info` and `RecipientContextParams.info` are `ArrayBufferLike | ArrayBufferView`, default empty. Max 128 bytes. See `hpke-js/packages/common/src/interfaces/keyScheduleParams.ts`. Our labels are well under 128 bytes.
- `EncryptionContextImpl.seal(data, aad = EMPTY)` takes plaintext first, AAD second. Both are `ArrayBufferLike | ArrayBufferView`. Return is `Promise<ArrayBuffer>`.
- `EncryptionContextImpl.open(ct, aad = EMPTY)` inverse. Return is `Promise<ArrayBuffer>`.
- `suite.kem.generateKeyPair()` returns `Promise<CryptoKeyPair>` with **extractable** private key (hard-coded in hpke-js native X25519 KEM as `generateKey(algName, true, KEM_USAGES)`). We do a generate-export-reimport dance to get a non-extractable persistent private key.
- `suite.createSenderContext({ recipientPublicKey })` requires a `CryptoKey` (NOT raw bytes) per `SenderContextParams`. Raw bytes must be imported first via `suite.kem.importKey('raw', bytes, /* isPublic */ true)`.
- `suite.createRecipientContext({ recipientKey })` accepts a non-extractable `CryptoKey` because internally `kem.decap` uses `subtle.deriveBits` which does not require extractability. Verified against `dhkemPrimitives/xCurveNative.ts::dh()`.
- The single-shot convenience methods `suite.seal({ recipientPublicKey, info }, pt, aad)` and `suite.open({ recipientKey, enc, info }, ct, aad)` exist and create+discard the context. We use them for stateless per-artifact operations; we use the explicit `createSenderContext` / `createRecipientContext` form only when we need the shared key schedule across multiple seals (not needed for Llamenos' current data model, but kept in mind for Tier 5 SFrame keying).

**Non-use:** We do not use HPKE's `psk` mode, `auth` mode, or `authpsk` mode in Tier 1. Base mode is sufficient for our current "wrap a random per-artifact key for N recipients" usage. `auth` mode (sender authentication via sender's static key) is deferred to Tier 3 when per-device sender keys land — at that point we can bind the sender's device identity into the HPKE key schedule. Master doc §6.5 and brief §Concrete scope both defer sender-authenticated HPKE to Tier 3; this spec is consistent.

#### 1.1.3. Envelope format v3

The canonical envelope shape shipped in Tier 1 (replacing Tier 0's envelope-v2):

```typescript
// src/shared/types.ts (REPLACE EnvelopeV2 from Tier 0)
import type { CryptoLabel } from './crypto-labels'
import type { Ciphertext } from './crypto-types'

export interface EnvelopeV3 {
  /** Envelope format version. Hard-coded literal so decrypt dispatch
   *  rejects any other value. */
  v: 3
  /** Index into LABEL_REGISTRY (Tier 0 introduced this). HPKE info string
   *  is ALSO bound, so labelId is redundant with HPKE's own binding —
   *  intentional, per the "three independent mechanisms" design principle. */
  labelId: number
  /** HPKE KEM encapsulated key, hex-encoded. Always 32 bytes / 64 hex chars
   *  for X25519 on our chosen suite. */
  enc: string
  /** HPKE AEAD ciphertext with tag appended, hex-encoded. Length = plaintext
   *  length + 16 bytes tag. */
  ct: Ciphertext
}

/** An EnvelopeV3 tagged with the recipient's x-only pubkey hex
 *  (matches the existing RecipientEnvelope shape for DB-compat). */
export interface RecipientEnvelopeV3 extends EnvelopeV3 {
  pubkey: string
}
```

Changes from Tier 0's envelope-v2 shape:

| Field | v2 (Tier 0) | v3 (Tier 1) | Rationale |
|---|---|---|---|
| `v` | `2` | `3` | Version bump forces decrypt-path dispatch |
| `labelId` | ✓ | ✓ (unchanged) | Redundant label binding — still required |
| `wrappedKey` | ✓ | ✗ | Replaced by HPKE `ct` |
| `ephemeralPubkey` | ✓ | ✗ | Replaced by HPKE `enc` |
| `enc` | ✗ | ✓ | HPKE KEM encapsulated key output |
| `ct` | ✗ | ✓ | HPKE AEAD seal output |
| `suite` | ✗ | ✗ | Single-suite design; implicit in `v: 3` |

The zod schema tracks the types:

```typescript
// src/shared/schemas/records.ts (REPLACE RecipientEnvelopeSchema)
export const EnvelopeV3Schema = z.object({
  v: z.literal(3),
  labelId: z.number().int().min(0),
  enc: z.string().regex(/^[0-9a-f]{64}$/),
  ct: z.string().regex(/^[0-9a-f]+$/),
})

export const RecipientEnvelopeV3Schema = EnvelopeV3Schema.extend({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
})
export type RecipientEnvelopeV3 = z.infer<typeof RecipientEnvelopeV3Schema>
```

#### 1.1.4. HPKE primitive module

New file `src/shared/crypto-primitives.ts` (replacing the Tier 0 version). The hand-rolled `eciesWrapKey` / `eciesUnwrapKey` / `symmetricEncrypt` / `symmetricDecrypt` all go away. They are replaced by:

```typescript
// src/shared/crypto-primitives.ts (NEW Tier 1 surface)
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { type CryptoLabel, labelToId, idToLabel, LABEL_REGISTRY } from './crypto-labels'
import { createHpkeSuite } from './crypto-suite'
import type { EnvelopeV3, RecipientEnvelopeV3 } from './types'
import type { Ciphertext } from './crypto-types'

// ---- Errors ----

export class CryptoLabelMismatchError extends Error {
  name = 'CryptoLabelMismatchError' as const
  constructor(public readonly expected: CryptoLabel, public readonly actual: CryptoLabel) {
    super(`Crypto label mismatch: expected ${expected}, got ${actual}`)
  }
}

export class EnvelopeVersionError extends Error {
  name = 'EnvelopeVersionError' as const
  constructor(public readonly got: unknown) {
    super(`Envelope version ${got} not supported (expected 3)`)
  }
}

// ---- AAD construction ----

/** AAD for every per-artifact HPKE envelope: label bytes + labelId byte + record id.
 *  Binds the ciphertext to both its crypto context and the row it belongs to. */
export function envelopeAad(label: CryptoLabel, recordId: string): Uint8Array {
  const labelBytes = utf8ToBytes(label)
  const idBytes = new Uint8Array([labelToId(label)])
  const recordBytes = utf8ToBytes(recordId)
  const out = new Uint8Array(labelBytes.length + 1 + recordBytes.length)
  out.set(labelBytes, 0)
  out.set(idBytes, labelBytes.length)
  out.set(recordBytes, labelBytes.length + 1)
  return out
}

// ---- HPKE wrap (sender side) ----

export async function hpkeSeal(params: {
  plaintext: Uint8Array
  /** MUST be a CryptoKey — not raw bytes. Use importRecipientX25519Pub
   *  to convert a hex x-only pubkey to a CryptoKey first. hpke-js's
   *  SenderContextParams.recipientPublicKey is typed as CryptoKey in
   *  packages/common/src/interfaces/senderContextParams.ts. */
  recipientPublicKey: CryptoKey
  label: CryptoLabel
  aad: Uint8Array
}): Promise<EnvelopeV3> {
  const suite = createHpkeSuite()
  const info = utf8ToBytes(params.label)
  const sender = await suite.createSenderContext({
    recipientPublicKey: params.recipientPublicKey,
    info,
  })
  const ct = new Uint8Array(await sender.seal(params.plaintext, params.aad))
  const enc = new Uint8Array(sender.enc)
  return {
    v: 3,
    labelId: labelToId(params.label),
    enc: bytesToHex(enc),
    ct: bytesToHex(ct) as Ciphertext,
  }
}

/** Convert an x-only 32-byte X25519 public key hex to a CryptoKey
 *  suitable for hpkeSeal's recipientPublicKey parameter.
 *
 *  suite.kem.importKey accepts Uint8Array directly (ArrayBufferView);
 *  we pass the bytes without going through .buffer to avoid subtle
 *  issues with sliced Uint8Array views having larger underlying buffers. */
const pubkeyImportCache = new Map<string, CryptoKey>()
export async function importRecipientX25519Pub(pubkeyHex: string): Promise<CryptoKey> {
  const cached = pubkeyImportCache.get(pubkeyHex)
  if (cached) return cached
  const suite = createHpkeSuite()
  const bytes = hexToBytes(pubkeyHex)
  if (bytes.length !== 32) {
    throw new Error(`X25519 public key must be 32 bytes, got ${bytes.length}`)
  }
  const pubKey = await suite.kem.importKey(
    'raw',
    bytes,
    /* isPublic */ true,
  )
  pubkeyImportCache.set(pubkeyHex, pubKey)
  return pubKey
}

// ---- HPKE unwrap (recipient side) ----

export async function hpkeOpen(params: {
  envelope: EnvelopeV3
  recipientPrivateKey: CryptoKey
  expectedLabel: CryptoLabel
  aad: Uint8Array
}): Promise<Uint8Array> {
  if (params.envelope.v !== 3) throw new EnvelopeVersionError(params.envelope.v)
  const actualLabel = idToLabel(params.envelope.labelId)
  if (actualLabel !== params.expectedLabel) {
    throw new CryptoLabelMismatchError(params.expectedLabel, actualLabel)
  }
  const suite = createHpkeSuite()
  const info = utf8ToBytes(params.expectedLabel)
  // RecipientContextParams.enc is ArrayBufferLike | ArrayBufferView —
  // Uint8Array is acceptable directly. Avoid .buffer because hexToBytes
  // may return a Uint8Array view whose .buffer is larger than the view.
  const recipient = await suite.createRecipientContext({
    recipientKey: params.recipientPrivateKey,
    enc: hexToBytes(params.envelope.enc),
    info,
  })
  const pt = await recipient.open(hexToBytes(params.envelope.ct), params.aad)
  return new Uint8Array(pt)
}
```

Callers pass `aad` explicitly. There is no default AAD. This preserves the Tier 0 "AAD is required" property that forces every call site through the audit.

**Note on raw pubkey handling:** `SenderContextParams.recipientPublicKey` is typed strictly as `CryptoKey` (verified against `hpke-js/packages/common/src/interfaces/senderContextParams.ts`). Raw ArrayBufferLike public keys are NOT accepted directly. The helper `importRecipientX25519Pub(hex)` shown in the code block above converts a 32-byte x-only hex pubkey (the format we store in the DB under `pubkey` columns and JSONB envelopes) to a non-extractable `CryptoKey` via `suite.kem.importKey('raw', bytes, true)`. The cache is per-suite-instance and per-pubkey string, cleared on worker lock. Key imports are O(microseconds) but avoid the parse overhead per envelope seal.

For envelope decryption, `recipientPrivateKey` is *always* a non-extractable `CryptoKey` — there is no raw-bytes decrypt path in the client. The server's decrypt path (1.2.5 below) receives its own non-extractable `CryptoKey` from a process-local derive step at boot.

#### 1.1.5. Hub-key symmetric encryption becomes AES-256-GCM via WebCrypto

The hub-key symmetric encryption path (`encryptForHub` / `decryptFromHub` in `src/client/lib/hub-key-manager.ts` and the server's `hubEncrypt` / `hubDecrypt` in `crypto-service.ts`) must also migrate. HPKE is recipient-asymmetric; the hub key is a shared symmetric secret. The right primitive is plain AEAD — AES-256-GCM via `SubtleCrypto.encrypt/decrypt`.

New helpers in `src/shared/crypto-primitives.ts`:

```typescript
// src/shared/crypto-primitives.ts (hub symmetric path)

/** Imports a 32-byte hub key as a non-extractable AES-256-GCM CryptoKey. */
export async function importHubKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  if (keyBytes.length !== 32) throw new Error('Hub key must be 32 bytes')
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  )
}

export async function hubFieldEncrypt(params: {
  plaintext: Uint8Array
  hubKey: CryptoKey            // non-extractable AES-GCM key
  label: CryptoLabel
  recordId: string
  fieldName: string
}): Promise<Ciphertext> {
  const iv = new Uint8Array(12)  // AES-GCM standard: 96-bit nonce
  crypto.getRandomValues(iv)
  const aad = utf8ToBytes(`${params.label}:${params.recordId}:${params.fieldName}`)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      params.hubKey,
      params.plaintext,
    ),
  )
  const packed = new Uint8Array(1 + iv.length + ct.length)
  packed[0] = 1  // format version byte: 1 = AES-256-GCM, 12-byte nonce, 128-bit tag
  packed.set(iv, 1)
  packed.set(ct, 1 + iv.length)
  return bytesToHex(packed) as Ciphertext
}

export async function hubFieldDecrypt(params: {
  ciphertext: Ciphertext
  hubKey: CryptoKey
  label: CryptoLabel
  recordId: string
  fieldName: string
}): Promise<Uint8Array> {
  const packed = hexToBytes(params.ciphertext)
  if (packed[0] !== 1) throw new Error(`Unsupported hub field format version ${packed[0]}`)
  const iv = packed.slice(1, 13)
  const ct = packed.slice(13)
  const aad = utf8ToBytes(`${params.label}:${params.recordId}:${params.fieldName}`)
  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      params.hubKey,
      ct,
    ),
  )
  return pt
}
```

The hub key itself (the 32-byte random secret) is still wrapped per-member via HPKE. The unwrap path returns a `CryptoKey` handle directly — see 1.1.6 for `unwrapHubKeyEnvelope`.

**AES-GCM vs. XChaCha20-Poly1305 for hub fields:**

- AES-GCM 12-byte nonce has a birthday bound at ~2³² messages before nonce reuse risk. XChaCha20 has a 24-byte nonce and effectively unlimited messages. For hub fields (role names, shift names, tags, etc.) we are in the low thousands per hub per lifetime — far under 2³².
- AES-GCM is native WebCrypto; XChaCha20 requires `@noble/ciphers` userspace. Non-extractable CryptoKey is only possible with the native path.
- If we ever approach the nonce budget, we rotate the hub key (which already happens on member changes). Nonce reuse under key rotation is not a real risk.

Accepted trade-off: smaller nonce space, stronger key-storage story.

#### 1.1.6. Hub key distribution via HPKE

`src/client/lib/hub-key-manager.ts` is rewritten to use HPKE end-to-end:

```typescript
// src/client/lib/hub-key-manager.ts (Tier 1 rewrite, sketch)
import { hpkeSeal, hpkeOpen, importHubKey, envelopeAad } from '@shared/crypto-primitives'
import { LABEL_HUB_KEY_WRAP } from '@shared/crypto-labels'
import type { RecipientEnvelopeV3 } from '@shared/types'

/** Generates a random 32-byte hub key, imports it as a non-extractable
 *  AES-GCM CryptoKey, and returns both the CryptoKey and the raw bytes.
 *  The raw bytes are used ONCE to wrap for initial recipients, then zeroed. */
async function generateHubKey(): Promise<{ hubKey: CryptoKey; rawForWrap: Uint8Array }> {
  const rawForWrap = new Uint8Array(32)
  crypto.getRandomValues(rawForWrap)
  const hubKey = await importHubKey(rawForWrap)
  return { hubKey, rawForWrap }
}

export async function wrapHubKeyForMember(params: {
  hubKeyRaw: Uint8Array          // zeroed by caller after all wraps complete
  memberHpkePubkey: CryptoKey    // imported via importRecipientX25519Pub
  memberXOnlyHex: string         // for the envelope's `pubkey` field
  hubId: string                  // goes into AAD
}): Promise<RecipientEnvelopeV3> {
  const envelope = await hpkeSeal({
    plaintext: params.hubKeyRaw,
    recipientPublicKey: params.memberHpkePubkey,
    label: LABEL_HUB_KEY_WRAP,
    aad: envelopeAad(LABEL_HUB_KEY_WRAP, params.hubId),
  })
  return { ...envelope, pubkey: params.memberXOnlyHex }
}

export async function unwrapHubKeyEnvelope(params: {
  envelope: RecipientEnvelopeV3
  recipientPrivateKey: CryptoKey   // non-extractable device HPKE private key
  hubId: string
}): Promise<CryptoKey> {
  const rawKey = await hpkeOpen({
    envelope: params.envelope,
    recipientPrivateKey: params.recipientPrivateKey,
    expectedLabel: LABEL_HUB_KEY_WRAP,
    aad: envelopeAad(LABEL_HUB_KEY_WRAP, params.hubId),
  })
  try {
    return await importHubKey(rawKey)
  } finally {
    rawKey.fill(0)
  }
}
```

Note the `rawKey.fill(0)` after importing: the unwrap path is the *only* place in Tier 1 where 32 raw hub-key bytes touch a main-thread `Uint8Array`, and the window is the single microtask between `hpkeOpen` returning and `importHubKey` consuming. `subtle.importKey` copies the bytes into the WebCrypto sandbox; the caller's zero is best-effort cleanup but the structural property is that the CryptoKey handle now lives in the sandbox and the raw bytes are not referenced anywhere else.

#### 1.1.7. Migration strategy

**One-shot clean cut.** Pre-production gives us the freedom. All existing `encrypted_*` columns are wiped by the Tier 1 migration; all note/message/file/contact envelopes are wiped; every user re-onboards as if first-run. The brief's "read-both-write-new" option is explicitly rejected as a workaround that violates the "no backward compatibility shims" principle.

The migration itself (`drizzle/migrations/0052_envelope_v3_hpke.sql`, shown as a code block — not actually created per the guard rails):

```sql
-- Wipe all encrypted content: env v2 (Tier 0) and v1 (pre-Tier-0) are gone.
-- Pre-production: dev DBs are reset on migration. No production data to preserve.

TRUNCATE TABLE note_envelopes CASCADE;
TRUNCATE TABLE note_replies CASCADE;
TRUNCATE TABLE call_records CASCADE;
TRUNCATE TABLE contact_intakes CASCADE;
TRUNCATE TABLE contacts CASCADE;
TRUNCATE TABLE blasts CASCADE;
TRUNCATE TABLE conversations CASCADE;
TRUNCATE TABLE identity CASCADE;
TRUNCATE TABLE push_subscriptions CASCADE;
TRUNCATE TABLE audit_log CASCADE;
TRUNCATE TABLE sessions CASCADE;
TRUNCATE TABLE auth_events CASCADE;
TRUNCATE TABLE signal_contacts CASCADE;
TRUNCATE TABLE intakes CASCADE;
-- settings: wipe encrypted provider_config / ivr_audio / push credentials etc.
-- Keep hub rows themselves but null out their encrypted fields.
UPDATE settings SET
  provider_config = '{}'::jsonb,
  ivr_audio_data = NULL,
  geocoding_api_key = NULL,
  blast_welcome_message = NULL,
  blast_bye_message = NULL,
  blast_double_opt_in_message = NULL;

-- No column shape changes: the `RecipientEnvelope` JSONB columns hold the new
-- envelope-v3 shape { v: 3, labelId, enc, ct, pubkey }. Shape is enforced at
-- the zod schema layer, not at the SQL layer.

-- Hub keys are re-generated on first post-migration admin login; the admin
-- account is the migration's trust anchor.
```

Users' identity keys (their HPKE keypairs) are also regenerated — there is no migration of the nsec to a new HPKE keypair because there is no nsec in the post-migration world. Any existing encrypted-key-v2 blob in localStorage is deleted by the client on first post-migration load; the user re-runs the bootstrap flow and receives a fresh HPKE keypair from the IdP-bound `nsecSecret` path (the same flow that onboards a new user).

**Required because of the clean cut:** the `identity.ts` schema's `encrypted_name`, `encrypted_phone`, etc. get re-populated on re-onboarding. The `invites.ts` redemption flow also clears and re-encrypts under the new keypair. The `bootstrap-admin.ts` script is updated to generate HPKE keypairs instead of secp256k1 nsec.

### 1.2. Non-extractable `CryptoKey` storage

#### 1.2.1. Design overview

The user's identity private key transitions from `Uint8Array` in a Worker closure to a non-extractable `CryptoKey` in IndexedDB. On page reload, the browser returns the same `CryptoKey` handle via structured clone, and the worker receives it via `postMessage`. The worker never sees raw key bytes.

The multi-factor KEK also becomes a non-extractable `CryptoKey`, specifically an AES-KW key used to wrap/unwrap the stored identity `CryptoKey`. The KEK bytes exist in JS memory for exactly one microtask between the HKDF output and the `subtle.importKey('raw', ..., 'AES-KW', false, ['wrapKey', 'unwrapKey'])` call.

#### 1.2.2. IDB storage layout

```typescript
// src/client/lib/identity-key-store.ts (NEW)
//
// IDB database: 'llamenos-identity' (version 1)
// Object store: 'v3-keys', keyPath 'id'
//
// Record shape:
//   {
//     id: 'active'                    // singleton in Tier 1; per-device in Tier 3
//     // Encryption keypair (X25519 for HPKE) — non-extractable after unlock
//     wrappedHpkePrivateKey: ArrayBuffer    // AES-KW-wrapped pkcs8 X25519 private key
//     hpkePublicKeyRaw: ArrayBuffer         // raw 32-byte X25519 public key
//     // Signing keypair (Ed25519 for audit-log signatures) — non-extractable
//     wrappedEd25519PrivateKey: ArrayBuffer // AES-KW-wrapped pkcs8 Ed25519 private key
//     ed25519PublicKeyRaw: ArrayBuffer      // raw 32-byte Ed25519 public key
//     // Nostr publishing key (secp256k1) — raw bytes because no WebCrypto
//     // backing exists for secp256k1. Lives only inside nostr-worker on unlock.
//     wrappedNostrPrivateKey: ArrayBuffer   // AES-KW-wrapped raw 32-byte secp256k1
//     nostrPublicKeyRaw: ArrayBuffer        // x-only 32-byte secp256k1 public key
//     // KDF parameters (for re-deriving the KEK on each unlock)
//     kdf: 'pbkdf2-sha256'                  // future-proofed for 'argon2id'
//     kdfParams: { salt: ArrayBuffer; iterations: number }
//     // Factor metadata (what inputs deriveKEK expects)
//     idpIssuer: string                     // for Tier 2 IdP-bound factor
//     prfUsed: boolean                      // whether WebAuthn PRF participates in KEK
//     prfCredentialId?: string              // WebAuthn credential id if prfUsed
//     // Identification (for multi-account detection without touching the key)
//     pubkeyHashHex: string                 // first 16 hex chars of SHA-256(hpkePublicKeyRaw)
//     createdAt: number                     // Date.now()
//   }
//
// Both keypairs share the same KEK — the KEK wraps both private keys
// in the same unlock transaction. If Tier 2 diverges the factors,
// the wraps can be split into separate records.
```

The wrapped private key is a `Uint8Array` of the AES-KW-wrapped X25519 private key in `pkcs8` format. On unlock, the worker receives the record, receives the KEK (as a non-extractable AES-KW `CryptoKey`), and calls:

```typescript
const privateKey = await crypto.subtle.unwrapKey(
  'pkcs8',          // X25519 supports raw (pub only), pkcs8 (priv), and jwk
  wrappedPrivateKey,
  kekCryptoKey,
  { name: 'AES-KW' },
  { name: 'X25519' },
  false,            // the unwrapped key is NON-extractable
  ['deriveBits'],
)
```

**Format note:** WebCrypto L2 specifies that X25519 private keys can be exported/imported in `pkcs8` or `jwk` format, but NOT `raw` (which is only valid for public keys). AES-KW operates on a 16-byte-aligned opaque blob, so we wrap a pkcs8-encoded private key (typically 48 bytes for X25519) and unwrap it the same way. The `pkcs8` blob plus its AES-KW integrity tag is what gets stored in IDB.

**Critical property:** `subtle.unwrapKey` takes the wrapped bytes, the unwrapping key, the algorithm to interpret the unwrapped bytes as, and the desired extractability of the unwrapped key. We pass `false` for the extractable flag. The resulting `CryptoKey` handle cannot be exported via `subtle.exportKey`. This is the structural fix to the "JS GC retains key bytes" weakness.

**Public key storage.** The X25519 public key is stored as `publicKeyRaw: ArrayBuffer` (32 bytes) in the same IDB record, separately from the wrapped private key. The public key is not a secret — storing it as raw bytes is intentional and correct. On unlock, the public key is retrieved from IDB alongside the wrapped private key and passed to the worker via the same `postMessage`. The KEM interface (`hpke-js/packages/common/src/interfaces/kemInterface.ts`) does not expose a "derive public from private" method, so retrieving the pre-stored public key is the only correct path.

#### 1.2.3. Why not put the `CryptoKey` directly in IDB unwrapped?

Three options were considered:

| Option | Description | Trade-off |
|---|---|---|
| A: Always-unwrapped | Store the `CryptoKey` directly in IDB. On reload, retrieve via structured clone, bypass KEK entirely. | No KEK = no unlock ceremony. Anyone with IDB access is "unlocked". XSS can *use* the key but cannot exfiltrate — but we lose the "explicit unlock" user-facing control. |
| B: KEK-wrapped, raw bytes | Store AES-KW-wrapped raw private key bytes. On unlock, `subtle.unwrapKey(..., extractable: false)`. | KEK required each unlock. Raw bytes exist in IDB but are AES-KW-protected (128-bit key-wrapping security). Unlocked `CryptoKey` is non-extractable. **This is our choice.** |
| C: CryptoKey in IDB + KEK gate | Put the `CryptoKey` handle in IDB + require KEK possession to authorize its use (worker-side semantic gate). | KEK is no longer a cryptographic gate — it's an authorization signal. A worker bug that skips the check exposes the key. Weaker than B. |

We pick **B** because it preserves the existing unlock UX (user enters PIN → factors combine → KEK derives → identity key unwraps), keeps the KEK as a load-bearing cryptographic gate (not just an authorization check), and produces a non-extractable unwrapped `CryptoKey` that XSS cannot exfiltrate.

Option A is revisited in Tier 3 when device-linking becomes a sigchain entry — at that point the "unlocked" state has a different meaning and always-unwrapped is more appropriate.

#### 1.2.4. KEK becomes a non-extractable AES-KW CryptoKey

`src/client/lib/key-store-v2.ts` `deriveKEK` currently returns a raw `Uint8Array`:

```typescript
// BEFORE (current, pre-Tier-1):
export function deriveKEK(factors: KEKFactors): Uint8Array {
  const pinDerived = pbkdf2(sha256, pinBytes, factors.salt, { c: 600_000, dkLen: 32 })
  const ikm = factors.prfOutput
    ? new Uint8Array([...pinDerived, ...factors.prfOutput, ...factors.idpValue])
    : new Uint8Array([...pinDerived, ...factors.idpValue])
  return hkdf(sha256, ikm, factors.salt, info, 32)
}
```

Tier 1 rewrite:

```typescript
// src/client/lib/key-store-v2.ts (Tier 1 rewrite, excerpt)
export async function deriveKEK(factors: KEKFactors): Promise<CryptoKey> {
  // Step 1: PIN → PBKDF2-SHA256 (STILL @noble/hashes — WebCrypto has
  // SubtleCrypto PBKDF2 but using it requires import/deriveBits dance
  // and doesn't offer a material security win here. Keep noble for now.)
  const pinBytes = new TextEncoder().encode(factors.pin)
  const pinDerived = pbkdf2(sha256, pinBytes, factors.salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  })
  try {
    // Step 2: combine factors
    const ikm = factors.prfOutput
      ? new Uint8Array([...pinDerived, ...factors.prfOutput, ...factors.idpValue])
      : new Uint8Array([...pinDerived, ...factors.idpValue])
    try {
      // Step 3: HKDF
      const infoLabel = factors.prfOutput ? LABEL_NSEC_KEK_3F : LABEL_NSEC_KEK_2F
      const info = new TextEncoder().encode(infoLabel)
      const rawKek = hkdf(sha256, ikm, factors.salt, info, 32)
      try {
        // Step 4: IMMEDIATELY import as non-extractable AES-KW
        const kek = await crypto.subtle.importKey(
          'raw',
          rawKek,
          { name: 'AES-KW', length: 256 },
          /* extractable */ false,
          ['wrapKey', 'unwrapKey'],
        )
        return kek
      } finally {
        rawKek.fill(0)
      }
    } finally {
      ikm.fill(0)
    }
  } finally {
    pinDerived.fill(0)
  }
}
```

Every intermediate `Uint8Array` is zeroed in a `finally`. The raw KEK exists for exactly one microtask between the HKDF output and `subtle.importKey`. After that, `kek` is an opaque handle — `subtle.exportKey(kek)` throws `DataError`. Tests assert this (see Testing section).

#### 1.2.5. Crypto worker rewrite

The crypto worker's `handleUnlock` / `handleLock` / `handleSign` / `handleDecrypt` / `handleEncrypt` are all rewritten to operate on `CryptoKey` handles instead of raw bytes. The worker communicates with the main thread via `postMessage` with `Transferable`; `CryptoKey` is structured-cloneable, so the main thread can ship the wrapped-key record to the worker without touching the plaintext private key material.

New worker message protocol:

```typescript
// src/client/lib/crypto-worker.ts (Tier 1 protocol)
type WorkerRequest =
  // Unlock the worker by unwrapping the stored identity keys with the KEK.
  // Both the X25519 HPKE key and the Ed25519 signing key are unwrapped in
  // one unlock transaction; the public key raw bytes are provided alongside.
  | {
      type: 'unlock'
      id: string
      kek: CryptoKey                           // non-extractable AES-KW key
      wrappedHpkePrivateKey: ArrayBuffer       // AES-KW-wrapped pkcs8 X25519
      hpkePublicKeyRaw: ArrayBuffer            // raw 32-byte X25519 pub
      wrappedEd25519PrivateKey: ArrayBuffer    // AES-KW-wrapped pkcs8 Ed25519
      ed25519PublicKeyRaw: ArrayBuffer         // raw 32-byte Ed25519 pub
    }
  | { type: 'lock'; id: string }
  // Sign an audit entry or a Nostr event (Nostr path goes through a separate
  // secp256k1 key per Tier 3; in Tier 1 it's still schnorr over the identity key).
  | { type: 'signAuditEntry'; id: string; entryHashHex: string }
  // HPKE decrypt an envelope using the worker-held identity private key.
  | {
      type: 'hpkeOpen'
      id: string
      envelope: EnvelopeV3
      expectedLabel: CryptoLabel
      aad: Uint8Array
    }
  // HPKE encrypt for a recipient — uses the recipient's raw pubkey hex as input.
  | {
      type: 'hpkeSeal'
      id: string
      plaintextHex: string
      recipientPubkeyHex: string
      label: CryptoLabel
      aad: Uint8Array
    }
  | { type: 'getPublicKey'; id: string }
  | { type: 'isUnlocked'; id: string }
  // Re-wrap the identity key under a new KEK (PIN change etc.)
  | { type: 'reWrap'; id: string; newKek: CryptoKey }
  // Provisioning: seal the identity key's material for a new device via
  // an ephemeral HPKE handshake. The worker does a controlled export via
  // AES-KW wrap under a short-lived ephemeral AES-KW key, which is
  // transmitted via a separate HPKE channel to the new device.
  | {
      type: 'provisionIdentity'
      id: string
      newDeviceHpkePubkey: ArrayBuffer
    }
```

Handler sketch:

```typescript
// src/client/lib/crypto-worker.ts
// All four private-key and public-key handles below are dropped on lock.
// Non-extractable CryptoKey handles cannot be zeroed explicitly; instead
// we drop the reference and rely on the crypto sandbox's GC to release
// backing material. The pubkey raw bytes are filled with zero on lock.
let hpkePrivateKey: CryptoKey | null = null    // non-extractable X25519
let hpkePublicKeyRaw: Uint8Array | null = null
let hpkePublicKeyHex: string | null = null
let ed25519PrivateKey: CryptoKey | null = null // non-extractable Ed25519
let ed25519PublicKeyRaw: Uint8Array | null = null
let ed25519PublicKeyHex: string | null = null

async function handleUnlock(req: {
  kek: CryptoKey
  wrappedHpkePrivateKey: ArrayBuffer
  hpkePublicKeyRaw: ArrayBuffer
  wrappedEd25519PrivateKey: ArrayBuffer
  ed25519PublicKeyRaw: ArrayBuffer
}) {
  hpkePrivateKey = await crypto.subtle.unwrapKey(
    'pkcs8',                  // X25519 private-key export format per WebCrypto L2
    req.wrappedHpkePrivateKey,
    req.kek,
    { name: 'AES-KW' },
    { name: 'X25519' },
    false,                    // NON-extractable — subtle.exportKey will throw
    ['deriveBits'],
  )
  ed25519PrivateKey = await crypto.subtle.unwrapKey(
    'pkcs8',
    req.wrappedEd25519PrivateKey,
    req.kek,
    { name: 'AES-KW' },
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  // The public keys are not derived from the private keys (the KEM
  // interface exposes no such method — verified against
  // hpke-js/packages/common/src/interfaces/kemInterface.ts). Instead,
  // the public key raw bytes are stored alongside the wrapped private
  // keys in IDB at account creation and shipped via the unlock message.
  hpkePublicKeyRaw = new Uint8Array(req.hpkePublicKeyRaw)
  hpkePublicKeyHex = bytesToHex(hpkePublicKeyRaw)
  ed25519PublicKeyRaw = new Uint8Array(req.ed25519PublicKeyRaw)
  ed25519PublicKeyHex = bytesToHex(ed25519PublicKeyRaw)
  return { hpkePublicKeyHex, ed25519PublicKeyHex }
}

async function handleHpkeOpen(req: {
  envelope: EnvelopeV3
  expectedLabel: CryptoLabel
  aad: Uint8Array
}): Promise<string> {
  if (!hpkePrivateKey) throw new Error('Worker is locked')
  if (!checkRateLimit('decrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const pt = await hpkeOpen({
    envelope: req.envelope,
    recipientPrivateKey: hpkePrivateKey,
    expectedLabel: req.expectedLabel,
    aad: req.aad,
  })
  return bytesToHex(pt)
}

async function handleSignAuditEntry(req: { entryHashHex: string }): Promise<string> {
  if (!ed25519PrivateKey) throw new Error('Worker is locked')
  if (!checkRateLimit('sign')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const sigBuf = await crypto.subtle.sign(
    { name: 'Ed25519' },
    ed25519PrivateKey,
    hexToBytes(req.entryHashHex),
  )
  return bytesToHex(new Uint8Array(sigBuf))
}

function handleLock() {
  // CryptoKey handles — dropping the reference allows the crypto sandbox
  // to release backing material on the next GC pass. The pubkey raw bytes
  // are zeroed explicitly because they are plain Uint8Array views.
  hpkePrivateKey = null
  ed25519PrivateKey = null
  hpkePublicKeyHex = null
  ed25519PublicKeyHex = null
  if (hpkePublicKeyRaw) hpkePublicKeyRaw.fill(0)
  if (ed25519PublicKeyRaw) ed25519PublicKeyRaw.fill(0)
  hpkePublicKeyRaw = null
  ed25519PublicKeyRaw = null
  resetRateLimits()
}
```

**Why store the public key alongside the wrapped private key?** The HPKE KEM interface (`hpke-js/packages/common/src/interfaces/kemInterface.ts`) does not expose a "derive public from private" method — only `serializePublicKey(CryptoKey)` and `generateKeyPair()`. Since the unlocked `CryptoKey` is non-extractable, we cannot export its raw private bytes and re-derive the public half at unlock time. Instead, we store the public-key raw bytes as a separate IDB field at account-creation time, read them alongside the wrapped private key on each unlock, and carry them in the unlock message. The public key is public — storing its raw bytes in IDB is intentional and has zero security impact.

**Ed25519 auxiliary signing key for audit log.** The identity key is an X25519 private key for HPKE. Audit-log signing uses schnorr-over-secp256k1 today (Tier 0 workstream 0.2). In Tier 1, we **decouple the signing identity from the encryption identity**:

- An **Ed25519 private key** is generated alongside the X25519 key at onboarding.
- Both keys are stored in IDB, wrapped under the same KEK.
- The worker holds both as non-extractable `CryptoKey` handles.
- Audit-log entry signing uses Ed25519 via `subtle.sign({ name: 'Ed25519' }, privEd25519, entryHashBytes)`.
- schnorr-over-secp256k1 is retired from the audit-log path. The user's secp256k1 Nostr-wire key (still derived for Nostr publishing compatibility) is a separate key with a narrower role.

This is a scope expansion vs. the brief, but it is required: we cannot hold a raw secp256k1 private key in a `Uint8Array` inside the worker *and* claim we have "non-extractable key storage". The whole point of 1.2 is to eliminate raw key bytes from JS memory, and schnorr-over-secp256k1 has no WebCrypto backing in 2026 browsers. Ed25519 is native WebCrypto (shipping Chrome 137+, Firefox 135+, Safari 17.4+) and is the natural signing counterpart to X25519 for HPKE.

**Master-doc alignment:** Master doc §6.5 lists "Non-extractable CryptoKey wherever WebCrypto covers the algorithm" as a crosscutting crosscut. The Ed25519-for-signing promotion is a direct consequence. The Nostr-wire secp256k1 path keeps its own key, derived from a separate HKDF context, lives in a different worker module, and is used only for publishing Nostr events where secp256k1 is mandatory.

### 1.3. Native WebCrypto X25519/Ed25519 preference

#### 1.3.1. Feature detection

```typescript
// src/shared/crypto-suite.ts (NEW)
let hasNativeX25519Cached: boolean | null = null
export async function hasNativeX25519(): Promise<boolean> {
  if (hasNativeX25519Cached !== null) return hasNativeX25519Cached
  try {
    await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])
    hasNativeX25519Cached = true
  } catch {
    hasNativeX25519Cached = false
  }
  return hasNativeX25519Cached
}

let hasNativeEd25519Cached: boolean | null = null
export async function hasNativeEd25519(): Promise<boolean> {
  if (hasNativeEd25519Cached !== null) return hasNativeEd25519Cached
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    hasNativeEd25519Cached = true
  } catch {
    hasNativeEd25519Cached = false
  }
  return hasNativeEd25519Cached
}
```

#### 1.3.2. Graceful degradation policy

**Decision: Require native X25519 and Ed25519. No fall-back path.**

The brief recommended a fall-back to `@noble/curves`. We reject this for three reasons:

1. The whole value proposition of this tier is non-extractable key storage. Noble curves produce raw bytes. Falling back disables the structural security property we are adding.
2. As of April 2026, Chrome, Firefox, and Safari all ship both X25519 and Ed25519 in WebCrypto (verified via WebKit, Bugzilla, and chromestatus). Llamenos targets modern browsers (the PWA minimum is already Chrome ≥120 / Firefox ≥115 / Safari ≥17).
3. A fall-back creates a two-path crypto architecture that doubles audit surface forever.

On unsupported browsers, the app displays a **hard error on first load** ("Your browser does not support the cryptographic primitives required by Llamenos. Please use Chrome 133+, Firefox 135+, or Safari 17.4+."). The error page is static, does not require the app bundle to run past the feature check, and is served from the same origin as the main app.

This is a deliberate raising of the minimum browser bar. Llamenos serves crisis hotline volunteers; the typical device is a modern laptop or phone. The master doc §6.5 explicitly lists browser-minimum tightening as part of the target architecture.

#### 1.3.3. secp256k1 is retained only for Nostr wire format

`src/client/lib/nostr/relay.ts` publishes Nostr events. Nostr events are signed with schnorr over secp256k1 by protocol definition. We retain `@noble/curves/secp256k1.js` for this single path. The Nostr signing key is **not** the user identity key — it is derived from a separate HKDF root to prevent cross-context use.

```typescript
// src/client/lib/nostr-identity.ts (NEW)
//
// A per-user Nostr signing key is generated INDEPENDENTLY of the X25519
// HPKE identity key. It is NOT derived from the HPKE key — both keys
// come from the same entropy source (crypto.getRandomValues) at account
// creation, generated in the same ceremony, and are persisted together
// in IDB under the same KEK. They are separate keys with different roles:
//
//   - X25519 HPKE key: envelope encryption / decryption (never signs)
//   - Ed25519 key:     audit-log + sigchain signing (never encrypts)
//   - secp256k1 key:   Nostr wire-format publishing ONLY
//
// The Nostr key is held as raw bytes inside a dedicated Nostr publishing
// worker (separate Web Worker from the crypto worker). secp256k1 has no
// WebCrypto backing in 2026, so the bytes cannot be held as a CryptoKey.
// The Nostr publishing worker is a narrow-purpose worker that handles
// only Nostr event signing; it does NOT perform any HPKE operations and
// is isolated from the main crypto worker.
//
// At account creation, the Nostr secp256k1 private key is generated via
// @noble/curves/secp256k1.js, AES-KW-wrapped under the KEK (treating the
// raw bytes as the AES-KW wrap input — AES-KW accepts any 16-byte-aligned
// blob, and we pad the 32-byte secp256k1 private key to 32 bytes, which
// is already aligned), and stored alongside the HPKE + Ed25519 wrapped
// blobs. On unlock, the Nostr worker receives the AES-KW-unwrapped raw
// bytes via postMessage, holds them in its closure, and zeroes them on
// lock. The unwrap path exposes raw bytes briefly for the Nostr publishing
// worker's consumption; this is acceptable because the Nostr worker is
// dedicated to a single narrow purpose.
```

Key properties of this design:

1. **No cross-derivation between HPKE and Nostr keys.** Losing one does not leak the other. Tier 3 device-linking can rotate the Nostr key independently.
2. **The HPKE private key is never exported.** The export-reimport dance at generation is the only point where the X25519 *pkcs8 form* exists in JS, and that form is not usable to derive a secp256k1 key (pkcs8 is a DER-encoded ASN.1 wrapper, not a raw private scalar — extracting the inner 32 bytes would be a parse step that we explicitly do NOT perform).
3. **The Nostr publishing worker is a separate isolation domain.** The existing `src/client/lib/nostr/relay.ts` is refactored to run inside a dedicated Web Worker (`nostr-worker.ts`), mirroring the crypto worker's isolation pattern. Neither worker can read the other's memory.
4. **Tier 3 per-device keys** will promote the Nostr key to per-device, at which point each device has its own secp256k1 keypair and the user's public "Nostr identity" becomes a set of device keys signed into a sigchain — the same sigchain pattern used for HPKE device keys. At that point the "cross-isolation" argument becomes irrelevant because there is no cross-derivation at all.

### 1.4. `items_key` indirection

#### 1.4.1. Design

Standard Notes 004 introduced an `items_key` layer between the master key and per-item content keys. The invariant is: primitive upgrades (HPKE suite swap, post-quantum hybrid, etc.) require re-wrapping exactly one `items_key` per user, not every item's envelope.

For Llamenos Tier 1, we introduce a per-user `items_key` (32-byte random, AES-256-GCM as a non-extractable CryptoKey) that sits between the user's HPKE identity key and the per-artifact random keys. The per-user `items_key` itself is HPKE-wrapped to the user's HPKE identity key and stored server-side as part of the user record.

Tier 3 will later introduce a per-device `items_key` layer on top — the user-level `items_key` is wrapped to each device, and primitive upgrades rotate the user-level key without touching the per-device wraps. Tier 1's per-user `items_key` becomes the unit of rotation; Tier 3's per-device `items_key` becomes the unit of distribution.

#### 1.4.2. Data flow for a note

**Current flow (pre-Tier-1):**

```
note plaintext
  ↓ XChaCha20-Poly1305 with random per-note key
encrypted note content
  │
  │ per-note key
  ↓ ECIES-wrap to author's secp256k1 pubkey → authorEnvelope
  ↓ ECIES-wrap to each admin's secp256k1 pubkey → adminEnvelopes[]
```

**Tier 1 flow:**

```
note plaintext
  ↓ AES-256-GCM with random per-note key (AAD = "note:{id}")
encrypted note content
  │
  │ per-note key (32 bytes)
  ↓ AES-KW-wrap under user's items_key → wrappedNoteKey
wrappedNoteKey
  │
  │ items_key (32 bytes)
  ↓ HPKE-seal to author's X25519 identity pubkey → authorItemsKeyEnvelope (ONE per user)
  ↓ HPKE-seal to each admin's X25519 identity pubkey → adminItemsKeyEnvelopes[] (ONE per admin)
```

The author-envelope / admin-envelope expansion happens at the *items_key* layer, not the *per-note* layer. Per note, the number of envelopes is now exactly one: the wrapped note key under the author's items_key, stored alongside the ciphertext. The items_key envelopes are fetched once per session and cached.

**Reader path:**

1. Fetch `authorItemsKeyEnvelope` for the reader user (or the admin envelope matching the reader's device pubkey).
2. Call `hpkeOpen` to unwrap the `items_key` bytes → import as non-extractable AES-KW `CryptoKey`.
3. For each note, call `subtle.unwrapKey('raw', wrappedNoteKey, itemsKeyCryptoKey, 'AES-KW', { name: 'AES-GCM' }, false, ['decrypt'])` to get a non-extractable per-note AES-GCM key.
4. Call `subtle.decrypt` with that key to decrypt the note content.

**Cost:** One HPKE unwrap per session per user (for the items_key), plus one AES-KW unwrap per note. AES-KW is fast: measured <0.2ms per call in WebCrypto. For a hub with 1000 historical notes, the session cost is ~200ms of AES-KW unwraps — comfortably inside the existing decrypt rate limiter budget (1000/min sustained).

**Writer path:**

1. `subtle.generateKey({ name: 'AES-GCM', length: 256 }, /* extractable */ true, ['encrypt'])` — produces a fresh key as a `CryptoKey` with no raw-bytes exposure. The `extractable: true` is required ONLY so we can `wrapKey` it; the key's raw form never enters JS.
2. `subtle.wrapKey('raw', key, itemsKey, { name: 'AES-KW' })` — produces the wrapped blob to store alongside the note.
3. `subtle.unwrapKey('raw', wrappedKey, itemsKey, { name: 'AES-KW' }, { name: 'AES-GCM' }, /* extractable */ false, ['encrypt'])` — produces a **non-extractable** sibling of the same key for the actual `subtle.encrypt` call.
4. Drop the original extractable reference; perform the encrypt via the non-extractable sibling; drop the non-extractable reference when done.

This uses WebCrypto's own primitives end-to-end — no raw bytes in JS at any point. The short-lived extractable handle exists only long enough to be wrapped; its backing material lives in the crypto sandbox the entire time. The helper lives in `crypto-primitives.ts`:

```typescript
// src/shared/crypto-primitives.ts
export async function itemsKeyWrapNewKey(params: {
  itemsKey: CryptoKey   // AES-KW, non-extractable
}): Promise<{ wrappedKey: ArrayBuffer; key: CryptoKey }> {
  // 1. Generate a fresh AES-256-GCM key as an extractable CryptoKey.
  //    Its backing material lives in the crypto sandbox; no raw bytes.
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true,
    ['encrypt'],
  )
  // 2. Wrap with the items_key. This produces AES-KW output (raw key
  //    bytes wrapped under AES-KW — the raw key never leaves the sandbox).
  const wrappedKey = await crypto.subtle.wrapKey(
    'raw', ephemeral, params.itemsKey, { name: 'AES-KW' },
  )
  // 3. Unwrap into a fresh NON-extractable handle for the actual encrypt.
  //    subtle.unwrapKey is the only API that can produce a live
  //    non-extractable key from wrapped bytes in one step.
  const key = await crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    params.itemsKey,
    { name: 'AES-KW' },
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt'],
  )
  // 4. The extractable ephemeral is no longer referenced — GC collects it.
  //    The returned `key` is non-extractable and the wrappedKey blob is
  //    what gets stored with the note.
  return { wrappedKey, key }
}
```

The raw bytes of the per-note key **never touch JS memory**. This is a material improvement over both the pre-Tier-1 state (raw bytes held for the lifetime of the encrypt) and the naive Tier 1 implementation sketch (raw bytes held for three microtasks). The only side effect of generating the extractable ephemeral is that *a crypto-sandbox-resident extractable handle exists for ~1ms* before the non-extractable version replaces it; an attacker who could introspect the sandbox in that window could in principle read the key, but they could also just read any key, so this does not materially widen the attack surface.

#### 1.4.3. Admin multi-reader model via `items_key`

Llamenos' current multi-admin model wraps per-note keys for each admin. Under `items_key` indirection, the multi-admin wrapping moves up one layer:

- The *items_key* is wrapped for each reader (author + all admins).
- Per-note keys are wrapped exactly once — under the author's items_key.
- An admin reading a note first fetches the author's items_key via the admin-specific envelope, then unwraps the per-note key, then decrypts.

**Concern:** what if an admin reads a note but is not in the author's admin envelope list (e.g., they joined after the note was written)? Under the current design, the server would have to re-wrap the per-note key for the new admin (which requires decrypting it, which the server cannot do under E2EE). Under `items_key` indirection, the server re-wraps only the author's items_key for the new admin — a single operation per user, not per note.

Actually, the server cannot re-wrap either, because the server does not have plaintext access to the items_key — it only has the HPKE-sealed version. The re-wrap must be initiated by a user who already has access to the items_key. The practical flow:

1. New admin Alice joins the hub.
2. Existing admin Bob (or the note author) detects the new admin via the audit-log sigchain.
3. Bob decrypts the author's items_key via his own admin envelope, re-wraps it for Alice's HPKE identity key (`hpkeSeal` with label `LABEL_ITEMS_KEY_WRAP`), and posts the new envelope to the server.
4. Alice can now decrypt all existing notes for which Bob had the items_key.

This is the "Cascading Lazy Key Rotation" primitive from §3.8 of the master doc, scoped to Tier 1 as a user-level items_key rewrap instead of a full hub-key rotation. The full sigchain-driven cascading rotation is Tier 3.

#### 1.4.4. Storage schema

```typescript
// src/server/db/schema/identity.ts (Tier 1 addition — shown as code block only)
export const userItemsKeys = pgTable('user_items_keys', {
  id: text('id').primaryKey(),           // uuid
  userId: text('user_id').notNull(),
  hubId: text('hub_id').notNull(),
  // One row per reader per items_key. The author's own items_key envelope
  // is stored here too (readerUserId === authorUserId) so all reads follow
  // the same code path.
  ownerUserId: text('owner_user_id').notNull(),   // whose items_key this is
  readerUserId: text('reader_user_id').notNull(),  // which reader can open the envelope
  envelope: jsonb<RecipientEnvelopeV3>()('envelope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('user_items_keys_hub_owner_idx').on(table.hubId, table.ownerUserId),
  index('user_items_keys_reader_idx').on(table.readerUserId),
  uniqueIndex('user_items_keys_owner_reader_idx').on(table.ownerUserId, table.readerUserId),
])
```

Per-note storage stays structurally similar; the `authorEnvelope` and `adminEnvelopes[]` columns are repurposed:

- `authorEnvelope: jsonb<{ wrappedNoteKey: string; itemsKeyOwner: string }>()` — the per-note key AES-KW-wrapped under the author's items_key, plus which items_key to unwrap with.
- `adminEnvelopes` is **dropped** — admins read via their own `user_items_keys` entry for the author's items_key + the single `authorEnvelope.wrappedNoteKey`.

This eliminates the O(N_admins) envelope storage per note. Storage cost scales O(N_authors × N_readers) at the items_key layer, amortized across all notes.

### 1.5. Non-scope: things we deliberately do not touch

These are reaffirmed from the brief and master doc §7:

- **WebAuthn PRF as a primary KEK factor** — Tier 2. The existing optional PRF factor in `key-store-v2.ts` is kept as-is but converted to the non-extractable CryptoKey output path.
- **OPAQUE login** — Tier 2.
- **Diceware recovery phrase** — Tier 2.
- **1Password-style Recovery Group** — Tier 2.
- **Per-device X25519/Ed25519 keys + sigchain** — Tier 3. Tier 1 stays at "one user = one HPKE keypair".
- **Cross-signing device trust** — Tier 3.
- **Split code/data origins, sandboxed crypto iframe** — Tier 4.
- **SFrame voice E2EE** — Tier 5. Would consume HPKE for per-call key distribution; this tier makes it easier.
- **MLS via Wire core-crypto** — Tier 6. HPKE is the pre-requisite; this tier ships it.
- **ML-KEM-1024 / X-Wing hybrid post-quantum** — Tier 6. `@hpke/core` supports `@hpke/hybridkem-x-wing` and `@hpke/ml-kem`; Tier 6 swaps the suite to one of those in a single `createHpkeSuite()` change (plus re-wrap of every items_key).

## Resolved open questions (from the brief)

1. **HPKE suite selection.** `DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM`. See 1.1.1. Rejected the ChaCha20-Poly1305 option because it requires a non-native-WebCrypto extension and disables the non-extractable CryptoKey story for AEAD keys.

2. **Envelope versioning scheme.** Explicit `v: 3` discriminator literal in envelope-v3 (Tier 0 shipped v2; Tier 1 ships v3). Decrypt dispatch rejects any other value at schema-validation time.

3. **Migration strategy.** One-shot clean cut. Every `ciphertext` column is wiped; every user re-onboards; every hub key is regenerated. No read-both-write-new path. See 1.1.7. Pre-production gives us this freedom and the brief's own "cut clean" recommendation is accepted.

4. **PR #50 session capsule interaction.** The capsule's *persistence layer* is retired — the encrypted nsec blob in IDB + token in sessionStorage becomes obsolete because the identity key is now a non-extractable CryptoKey handle directly in IDB. The capsule's *cross-tab unlock coordinator* (BroadcastChannel + Web Locks API) is retained and reused: same `BroadcastChannel('llamenos-lock')` pattern, same `navigator.locks.request('llamenos-unlock', ...)` serialization of the unlock ceremony. `src/client/lib/session-capsule.ts` is deleted and its cross-tab logic moves into `src/client/lib/identity-key-store.ts`. Coordinate with PR #50 author for the cross-tab test fixtures that already exist — those tests port over to the new file with renames only.

5. **Server-side HPKE.** Yes. The server has its own HPKE identity keypair (X25519), derived at boot from `SERVER_NOSTR_SECRET` via the HPKE standard `DeriveKeyPair(ikm)` operation. Concretely:
    ```typescript
    const ikm = hkdf(SERVER_NOSTR_SECRET, LABEL_SERVER_HPKE_KEY)
    const extractable = await suite.kem.deriveKeyPair(ikm)
    // hpke-js's deriveKeyPair hard-codes extractable: true in its
    // internal _deserializePkcs8Key. Force non-extractable via re-import:
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', extractable.privateKey)
    const serverPrivateKey = await crypto.subtle.importKey(
      'pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits'],
    )
    new Uint8Array(pkcs8).fill(0)
    const serverPublicKey = extractable.publicKey  // public — no re-import needed
    ```
    `suite.kem.deriveKeyPair` implements RFC 9180 §7.1.3 and is deterministic in `ikm`, so the server's HPKE pubkey is stable across restarts. Every hub-key envelope set includes the server as a recipient so the server can re-wrap for new members (same as today). The server uses `@hpke/core` — it's runtime-agnostic and the Bun CI matrix in the hpke-js repo confirms Bun support.

6. **Feature detection and graceful degradation.** Hard error on unsupported browsers. No fallback. See 1.3.2. The minimum browser is Chrome 133 / Firefox 135 / Safari 17.4. This is a deliberate raising of the minimum bar.

7. **`items_key` per-user vs per-hub vs per-device.** **Per-user, per-hub.** A user who is a member of multiple hubs has one items_key *per hub they belong to*. Rationale: items_keys should be scoped such that leaving a hub removes access — if the items_key were global per-user, leaving a hub would require a global items_key rotation. Per-hub items_keys align rotation boundaries with hub membership changes. Tier 3 adds per-device wrapping on top of this per-user-per-hub structure (the user-level items_key is wrapped for each device's HPKE key instead of for the user's single HPKE key).

8. **Testing strategy.** HPKE unit tests run under `bun:test` — `@hpke/core` is pure JS/WASM and compatible with Bun (confirmed via hpke-js CI matrix). API + UI E2E tests exercise the full encrypt → persist → decrypt → render path. See Testing section.

9. **Backwards-incompatible envelope format.** Confirmed: no staging or production DB needs migration. Dev DBs are reset via `bun run dev:docker:down && bun run dev:docker && bun run migrate`. The Tier 0 spec already documents this pattern.

10. **Ed25519 promotion to primary signing key.** *Open question added by this spec, not the brief.* Resolved: Yes. Audit-log signing moves from schnorr-over-secp256k1 to Ed25519 via native WebCrypto `subtle.sign`. The user's secp256k1 key is retained only for Nostr event publishing and is derived from a separate HKDF root. See 1.2.5 and 1.3.3.

## Testing

**Guiding principle:** every workstream lands with unit + API E2E + UI E2E coverage proportional to its blast radius. No workstream ships without adversarial negative-path tests. Tier 1 inherits Tier 0's testing architecture: three-suite split (unit / API E2E / UI E2E), testid-only UI selectors, and the `authedRequest` helper for API tests.

### New unit tests

All under `src/` colocated `.test.ts` with `bun:test`:

- **`src/shared/crypto-suite.test.ts` (NEW)**
  - `createHpkeSuite` returns a `CipherSuite` with the expected KEM/KDF/AEAD triple
  - `hasNativeX25519` returns `true` in the test environment (Bun fake-IndexedDB + native X25519 polyfill; see §Migration > Test runtime)
  - `hasNativeEd25519` returns `true` in the test environment

- **`src/shared/crypto-primitives.test.ts` (REPLACES Tier 0 version)**
  - `hpkeSeal` / `hpkeOpen` round-trip succeeds with matching label + AAD
  - `hpkeOpen` throws `CryptoLabelMismatchError` when envelope.labelId's resolved label differs from `expectedLabel`
  - `hpkeOpen` throws `EnvelopeVersionError` on `v: 2` envelope
  - `hpkeOpen` throws underlying WebCrypto error on mismatched AAD
  - `hpkeOpen` throws underlying WebCrypto error on tampered `ct` byte
  - `hpkeOpen` throws underlying WebCrypto error on tampered `enc` byte
  - `importHubKey` returns a non-extractable `CryptoKey` (assertion: `subtle.exportKey('raw', k)` throws `InvalidAccessError`)
  - `hubFieldEncrypt` / `hubFieldDecrypt` round-trip with matching `(label, recordId, fieldName)` succeeds
  - `hubFieldDecrypt` throws when `fieldName` is swapped (AAD mismatch)
  - `hubFieldDecrypt` throws when `recordId` is swapped
  - `itemsKeyWrapNewKey` returns a wrapped key + non-extractable live key
  - The live key from `itemsKeyWrapNewKey` cannot be exported (`subtle.exportKey` throws)
  - **Adversarial: label swap attack.** Build envelope-v3 with valid HPKE sealing under LABEL_NOTE_KEY but labelId set to LABEL_MESSAGE's id. Assert `hpkeOpen` rejects with `CryptoLabelMismatchError` before attempting WebCrypto operations (fail-fast on the registry check).
  - **Adversarial: info vs AAD dual-binding.** Build two envelopes with same plaintext, same key, same AAD, but different labels (different HPKE `info`). Assert both `ct` and `enc` bytes differ — demonstrates HPKE info is bound to key schedule, not just framing.
  - **Adversarial: cross-hub AAD substitution.** Encrypt a hub field under `(hubId: 'A', recordId: 'x', fieldName: 'name')`, attempt to decrypt under `(hubId: 'B', recordId: 'x', fieldName: 'name')`. Assert failure.

- **`src/client/lib/key-store-v2.test.ts` (UPDATED)**
  - `deriveKEK` now returns a `CryptoKey` (not `Uint8Array`)
  - The returned KEK is non-extractable: `subtle.exportKey('raw', kek)` throws `InvalidAccessError`
  - `deriveKEK` zeroes all intermediate byte arrays on the happy path (verified via a Proxy-wrapped Uint8Array factory)
  - `deriveKEK` zeroes all intermediate byte arrays on the error path (forced failure via bad HKDF input)
  - The two-factor (PIN + IdP) path and three-factor (PIN + PRF + IdP) path both produce non-extractable AES-KW keys
  - Re-deriving with the same factors produces a key that can unwrap a blob wrapped with the original key (semantic equivalence check)

- **`src/client/lib/identity-key-store.test.ts` (NEW)**
  - Save + load round-trip: put a non-extractable X25519 `CryptoKey` in IDB, read it back, confirm the handle works with HPKE `createSenderContext`
  - The loaded `CryptoKey` is still non-extractable: `subtle.exportKey` throws
  - Structured clone preserves the key across IDB transactions
  - Wrap + store + fetch + unwrap: put a wrapped private key blob in IDB under a KEK, retrieve, unwrap with the same KEK, confirm the unwrapped key works with HPKE
  - Wrap + store + fetch + unwrap with wrong KEK: throws `OperationError` (AES-KW integrity failure)

- **`src/client/lib/crypto-worker.test.ts` (UPDATED)**
  - `handleUnlock` accepts a `{ kek: CryptoKey, wrappedPrivateKey: ArrayBuffer }` message and stores a non-extractable private key handle
  - After unlock, `handleHpkeOpen` succeeds on a valid envelope
  - After lock (`hpkePrivateKey = null`), `handleHpkeOpen` throws `'Worker is locked'`
  - Rate limit still fires after 100 decrypts/sec (inherited from existing behavior)
  - The worker's closure never contains a `Uint8Array` that holds the private key bytes (source-level assertion: grep the compiled worker bundle for `Uint8Array` retentions in the `secretKey` binding — done via a dev-only introspection shim)
  - **Adversarial: main thread cannot read the key.** Worker receives unlock, main thread attempts `postMessage` query for raw key bytes. Worker has no message handler for "exportPrivateKey" — confirmed via exhaustive switch check.

- **`src/client/lib/hub-key-manager.test.ts` (UPDATED)**
  - `wrapHubKeyForMember` produces an envelope-v3 that `unwrapHubKeyEnvelope` can open with the member's private key
  - `unwrapHubKeyEnvelope` returns a non-extractable AES-GCM `CryptoKey` (the hub key)
  - `unwrapHubKeyEnvelope` rejects an envelope whose `hubId` in AAD does not match the caller's `hubId` parameter
  - Hub key rotation: old `CryptoKey` no longer decrypts messages encrypted with the new key (cross-key-confusion test)

- **`src/shared/crypto-labels.test.ts` (UPDATED from Tier 0)**
  - Inherits Tier 0's LABEL_REGISTRY + branded type tests
  - Adds `LABEL_SERVER_HPKE_KEY`, `LABEL_ITEMS_KEY_WRAP`, `LABEL_USER_HPKE_IDENTITY`, `LABEL_NOTE_KEY_WRAP` (via items_key), and asserts labelToId/idToLabel round-trip for each

### New API E2E tests

Under `tests/api/`, using Playwright without a browser via `authedRequest`:

- **`tests/api/hpke-envelope-roundtrip.spec.ts` (NEW)**
  - POST a note via the API → encrypted content is stored → GET the note → decrypt on the client via the Playwright fixture → plaintext matches
  - POST a note with a deliberately malformed envelope-v3 (bad hex in `enc`) → API responds 400 with zod validation error
  - POST a note with envelope-v2 structure → API responds 400 (no v2 acceptance)
  - POST a note, then tamper with the stored `ct` byte via direct DB write, then GET → client decrypt throws, surfaces as `DecryptError`
  - POST a note as admin A, wrap for admin B via items_key-rewrap endpoint, GET as admin B → decrypts successfully
  - POST a note as admin A, GET as admin C (who has no items_key access) → authorEnvelope lookup fails, decrypt error surfaces

- **`tests/api/hub-key-hpke-rewrap.spec.ts` (NEW)**
  - Admin creates hub → server generates hub key, HPKE-wraps for admin + server → admin unwraps successfully
  - Admin invites a volunteer → volunteer onboards → admin rewraps hub key for volunteer via HPKE → volunteer unwraps successfully
  - Admin removes a volunteer → hub key rotates (new random bytes) → new envelopes generated for remaining members → removed volunteer's cached hub key no longer decrypts new messages
  - Attempted tamper: API returns hub key envelopes with swapped `enc` bytes → client HPKE open throws → rewrap path is blocked (inherits Tier 0 chain verification)

- **`tests/api/items-key-rewrap.spec.ts` (NEW)**
  - New admin joins hub → existing admin rewraps items_key for new admin via HPKE-seal → new admin fetches items_key envelope → unwraps successfully
  - Attempted items_key access by non-admin → API returns 403 before envelope delivery
  - items_key rotation flow: admin triggers rotation → new items_key generated → all existing wrapped note keys re-wrapped under new items_key → old items_key retained server-side for audit trail (not accessible to clients; rotation is not destructive to data, only to active keys)

- **`tests/api/encrypted-field-decrypt.spec.ts` (NEW)**
  - Every `ciphertext()` column that stores user-visible content has a round-trip test: create via API, fetch via API, client-side decrypt via the appropriate `crypto-primitives` helper, assert plaintext matches
  - Coverage target: `contacts`, `notes`, `call_records`, `reports`, `blasts`, `conversations`, `identity` (PII fields), `audit_log`
  - One negative test per table: tamper with the `ct` byte → decrypt fails

- **`tests/api/server-hpke-identity.spec.ts` (NEW)**
  - Server starts → server HPKE keypair is derived and imported as non-extractable → API exposes server public key via `/api/server/pubkey`
  - Server public key is stable across restarts (derived from `SERVER_NOSTR_SECRET`, not random on boot)
  - Admin creates a hub → server's envelope entry in the hub_keys response is HPKE-openable by the server's private key (verified by a test-only endpoint `/api/test/server-unwrap` enabled in test env only)

### New UI E2E tests

Under `tests/ui/`, using Playwright with Chromium:

- **`tests/ui/pin-unlock-hpke.spec.ts` (NEW)**
  - User lands on app → KEK prompt renders → user enters PIN → key-store-v2 derives KEK as non-extractable CryptoKey → worker unwraps identity key → public key hex surfaces in the UI test fixture → note list loads and decrypts successfully
  - Wrong PIN → KEK unwrap fails → error toast with testid `toast-decrypt-error`
  - Successful unlock → `window.__testOnly_probe` exposes `{ isUnlocked: true, hasCryptoKey: true, keyExportable: false }` — the last two are assertions that the structural property holds

- **`tests/ui/identity-key-persistence.spec.ts` (NEW)**
  - Unlock → note list loads → reload the page → `window.__testOnly_probe` reports the private key is still an unwrapped non-extractable `CryptoKey` (survived structured clone)
  - Lock → `window.__testOnly_probe` reports `isUnlocked: false, hasCryptoKey: false`
  - Lock in tab A → tab B (same origin) also locks within 500ms (cross-tab lock propagation)

- **`tests/ui/hpke-adversarial.spec.ts` (NEW)**
  - Use Playwright route interception to swap one envelope's `labelId` byte from `LABEL_NOTE_KEY` to `LABEL_MESSAGE` → client decrypt surfaces an error toast with testid `toast-decrypt-error` and text "Note could not be decrypted"
  - Same but swap the `enc` byte → same outcome
  - Same but swap the `ct` byte → same outcome
  - All three failures are logged to `window.__testOnly_cryptoErrors` with structured `{ type: 'CryptoLabelMismatchError' | 'DecryptError', envelope: ... }`

- **`tests/ui/items-key-rewrap-flow.spec.ts` (NEW)**
  - Admin A creates a hub, posts 3 notes → admin B joins → admin A triggers "share access with B" which rewraps A's items_key for B via HPKE → admin B signs in → sees all 3 notes decrypted

### Regression gate

Every Tier 1 workstream is blocked until these all pass on CI:

```bash
bun run typecheck                              # 0 errors
bun run lint                                   # 0 errors
bun run build                                  # clean build, dist/ populated
bun run test:unit                              # all unit tests pass
bunx playwright test tests/api                 # all API tests pass
bunx playwright test tests/ui                  # all UI tests pass
grep -rn "eciesWrapKey\|eciesUnwrapKey\|encryptForHub\|decryptFromHub\|symmetricEncrypt\|symmetricDecrypt" src --include="*.ts" --exclude="*.test.ts"   # zero matches
grep -rn "xchacha20poly1305" src --include="*.ts" --exclude="*/nostr/*"   # zero matches outside the Nostr wire path
grep -rn "secretKey: Uint8Array" src/client/lib/crypto-worker.ts   # zero matches
```

The grep checks are part of the CI pipeline (`.github/workflows/ci.yml` — shown as an edit in the plan) and enforce the structural post-Tier-1 state.

### Adversarial test design notes

The adversarial tests are written *first* in the TDD flow, before any primitive swap code lands. Each negative case maps to a concrete published attack class:

- **Label swap (Albrecht #3)** — the compile-time `CryptoLabel` brand (Tier 0) plus runtime label binding in HPKE `info` plus AAD labelId byte = three independent mechanisms. The adversarial tests drop the labelId byte specifically to verify the third mechanism catches the attack even if the first two are bypassed.
- **AAD substitution (Mega integrity #3)** — AAD covers record id + field name; substituting across rows or columns fails tag verification at the WebCrypto layer, not at a client-side format check.
- **Key extraction attempt** — asserting `subtle.exportKey` throws on the identity key is the single most important adversarial test in this tier. It is the thing that differentiates Tier 1 from Tier 0.
- **Rate limit bypass attempt** — inherited from Tier 0's rate limiter. Tier 1 preserves the exact same rate bucket configuration; a regression test asserts 101st decrypt within a second auto-locks the worker.

## Migration

**Database.** One new migration: `drizzle/migrations/0052_envelope_v3_hpke.sql`. Shown as a SQL code block above (§1.1.7). Forward-only. Pre-production dev DBs are reset via `bun run dev:docker:down && bun run dev:docker && bun run migrate`. The migration sequence from a fresh clone is documented in `CLAUDE.md` under "Tier 1 migration notes" (removed after first post-Tier-1 release, matching the Tier 0 pattern).

**Envelope format.** Envelope-v2 (Tier 0, hand-rolled ECIES + `labelId` AAD) is deleted. Envelope-v3 (HPKE) is the only supported format from Tier 1 onward. No version-dispatch decrypt path. A zod schema validates `v: z.literal(3)` at the API boundary so any other version is rejected with a 400.

**Key-store format.** `key-store-v2` is retained as a namespace — the file is heavily edited but the `v: 2` JSON structure in localStorage is deleted (in favor of the IDB-based `identity-key-store`). On first post-Tier-1 load, any residual `llamenos-encrypted-key-v2` localStorage entry is deleted by the migration helper in `src/client/lib/migrations/drop-key-store-v2-localstorage.ts`. Users are re-prompted through the onboarding flow.

**Deprecation of hand-rolled primitives.** `src/shared/crypto-primitives.ts` is the only file that owns the crypto surface after Tier 1. `src/client/lib/crypto.ts` is already deleted by Tier 0. `src/client/lib/crypto-worker.ts` no longer contains any crypto implementation — it only has the RPC protocol + a state machine around `CryptoKey` handles. `src/client/lib/file-crypto.ts` becomes a thin wrapper around `hpkeSeal` / `hpkeOpen` with the file-specific AAD. `src/server/lib/crypto-service.ts` is rewritten to use the same `hpkeSeal` / `hpkeOpen` primitives.

**Dependencies.** Four new npm packages added in the Tier 1 plan (not in this spec file per guard rails):

- `@hpke/core` — HPKE base implementation, native WebCrypto
- `idb` — a tiny (0.7 KB) typed wrapper around IndexedDB for the identity key store

The `@hpke/chacha20poly1305` and `@hpke/dhkem-x25519` extensions are **not** added — we use only the native paths bundled in `@hpke/core`. The fewer dependencies in the crypto path, the smaller the audit surface.

`@noble/curves`, `@noble/ciphers`, `@noble/hashes` are retained for:

- Nostr wire-format secp256k1 signing (unchanged)
- PBKDF2-SHA256 in the KEK derivation (unchanged; native `subtle.deriveBits` PBKDF2 is viable but doesn't earn us a material win here)
- HKDF-SHA256 in the Nostr key derivation (unchanged)
- SHA-256 hashing for pubkey identification and canonical JSON (unchanged)

`@noble/ciphers` usage drops from ~30 call sites to 2–3 (only inside the Nostr event signing path and test fixtures), which is a signal of how much of the crypto path shifts to WebCrypto.

**Server boot sequence.** Server at startup derives its HPKE keypair from `SERVER_NOSTR_SECRET` via `suite.kem.deriveKeyPair(hkdf(SERVER_NOSTR_SECRET, LABEL_SERVER_HPKE_KEY))` → export-reimport dance to non-extractable. The server's private key is a non-extractable `CryptoKey` for the life of the process. On SIGTERM / graceful shutdown, the key handle is GCd as the process exits. No on-disk persistence of the private key — it is always re-derived from `SERVER_NOSTR_SECRET` on boot. This is deterministic, so the server's HPKE pubkey is stable across restarts and can be cached in the `hub_keys` table without re-wrapping.

**Test runtime.** Bun's WebCrypto implementation supports X25519 and Ed25519 as of Bun 1.1+ (the repo's `package.json` already pins `@types/bun@^1.3.11`). CI runs unit tests under `bun test`; if a transient Bun release regresses X25519/Ed25519 support, CI fails loud and we pin to a known-good version. No Node.js path.

**Playwright fixture.** A new fixture `tests/fixtures/hpke.ts` exposes helpers for building HPKE envelopes client-side in test code (for adversarial envelope construction). The fixture imports from `@shared/crypto-primitives` directly — the test path is the same path the app uses.

## Out of scope

Tier 1 is explicitly about primitive modernization. The following are deferred:

- **WebAuthn PRF as a primary factor** — Tier 2. The existing optional PRF path in `key-store-v2.ts` is retained and converted to the non-extractable CryptoKey output form, but no new factor is added.
- **OPAQUE login** — Tier 2.
- **Diceware recovery phrase** — Tier 2. The current recovery-key format (raw bytes persisted server-side, encrypted under a PBKDF2-derived key) is retained and converted to the non-extractable CryptoKey form with no UX change.
- **1Password-style Recovery Group** — Tier 2.
- **Per-device keys** — Tier 3. The user's HPKE keypair is still singular in Tier 1. Tier 3 promotes each device to its own HPKE keypair and the user's items_key gets wrapped per-device instead of per-user.
- **Sigchain-driven device trust** — Tier 3. Tier 1's items_key distribution is still TOFU-rooted via the existing onboarding flow.
- **Cascading Lazy Key Rotation (formal)** — Tier 3. Tier 1 ships a simpler items_key rotation primitive but does not implement the cascading generation semantics.
- **Cross-signed device provisioning** — Tier 3.
- **Split code/data origins** — Tier 4.
- **Sandboxed crypto iframe on distinct origin** — Tier 4.
- **Third-party bundle-hash verifier + Nostr gossip attestation** — Tier 4.
- **Voice call E2EE via SFrame** — Tier 5. Tier 1's HPKE surface makes the per-call key distribution path trivial, but no SFrame code ships in this tier.
- **MLS via Wire core-crypto** — Tier 6.
- **Post-quantum hybrid (ML-KEM-1024 or X-Wing)** — Tier 6. `@hpke/ml-kem` and `@hpke/hybridkem-x-wing` exist as drop-in suite replacements; the Tier 6 work is swap `DhkemX25519HkdfSha256` for `XWingKem`, rotate the per-user items_key, done.
- **Tuta fingerprint/verification UX** — Tier 6, shipped alongside PQ hybrid.
- **Public commissioned audit** — parallel non-blocking workstream, master doc §7.
- **Tauri desktop build** — parallel non-blocking workstream, master doc §7.

## Success criteria

The implementation is complete when all of the following hold:

1. **Zero hand-rolled ECIES.** `grep -rn "eciesWrapKey\|eciesUnwrapKey\|eciesUnwrapKeyWithSecret" src --include="*.ts"` returns zero matches.

2. **Zero `symmetricEncrypt` / `symmetricDecrypt`.** `grep -rn "symmetricEncrypt\|symmetricDecrypt" src --include="*.ts"` returns zero matches. All symmetric operations go through `hubFieldEncrypt` / `hubFieldDecrypt` (for hub-scoped) or HPKE (for everything else).

3. **Every envelope in the database is `v: 3`.** A SQL-level audit script (`scripts/audit-envelopes.sh`) queries every `jsonb` column that stores envelope data and asserts `v = 3` for every row. Run in CI against the dev DB after the Tier 1 migration.

4. **Identity key is a non-extractable CryptoKey.** A unit test (`src/client/lib/crypto-worker.test.ts`) asserts that after unlock, `subtle.exportKey('raw', workerPrivateKey)` throws `InvalidAccessError`.

5. **KEK is a non-extractable CryptoKey.** A unit test (`src/client/lib/key-store-v2.test.ts`) asserts that `subtle.exportKey('raw', kek)` throws `InvalidAccessError` for the output of `deriveKEK`.

6. **items_key indirection is live.** A unit test (`src/shared/crypto-primitives.test.ts`) asserts that rewrapping a per-note key under a new items_key does not touch the per-note ciphertext — byte comparison before and after rotation confirms `ct` is unchanged.

7. **HPKE suite is exactly one.** `grep -rn "new CipherSuite" src --include="*.ts"` returns exactly one match, in `src/shared/crypto-suite.ts`.

8. **No `@noble/ciphers` imports outside the Nostr path.** `grep -rn "@noble/ciphers" src --include="*.ts"` returns matches only in `src/client/lib/nostr/` or test fixtures. Enforced by CI grep check in `.github/workflows/ci.yml`.

9. **Native X25519 + Ed25519 required.** A unit test asserts `hasNativeX25519()` and `hasNativeEd25519()` both return true in the CI environment. A UI E2E test asserts the app displays a hard-error page in a synthetic no-native-curve environment (simulated by stubbing `subtle.generateKey` to throw on X25519).

10. **Server HPKE identity key is non-extractable at runtime.** A server unit test boots a `CryptoService`, asserts `subtle.exportKey('pkcs8', serverHpkeKey.privateKey)` throws `InvalidAccessError`. The server uses the same generate-export-reimport dance as the client to end up with a non-extractable handle. The extractable intermediate exists only for the duration of the reimport (~1 microtask).

11. **Every adversarial test passes.** All tests in `tests/ui/hpke-adversarial.spec.ts` and the adversarial cases in `src/shared/crypto-primitives.test.ts` pass. These are enumerated in the Testing section — label swap, AAD substitution, key extraction attempts, tampered `enc` / `ct` bytes, version downgrade (v2 in a v3 slot), and label swap with intact HPKE envelope.

12. **Regression gate is green.** `bun run typecheck && bun run lint && bun run build && bun run test:unit && bunx playwright test tests/api && bunx playwright test tests/ui` completes with zero failures on CI. `./scripts/verify-build.sh` (Tier 0 infrastructure) continues to pass.

Every criterion above is verifiable by a deterministic command check or a specific test id, and is verifiable by an independent reviewer without repo history context.
