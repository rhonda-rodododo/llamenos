# Tier 1 — HPKE + Primitive Modernization (Spec Brief)

**Date:** 2026-04-10
**Master doc:** [`../SECURITY_IMPROVEMENTS_MASTER.md`](../SECURITY_IMPROVEMENTS_MASTER.md) §3.9, §3.6 (items_key), §7 Tier 1
**Effort:** Weeks
**Depends on:** Tier 0 (label enforcement makes the migration safer)
**Status:** Ready for spec authoring

## Goal

Modernize the cryptographic primitives Llamenos uses at the lowest level, without changing the architectural model. Three substitutions plus one new indirection:

1. **HPKE (RFC 9180) replaces hand-rolled ECIES** wherever we wrap a random key for a recipient.
2. **Non-extractable `CryptoKey` in IndexedDB** replaces raw-bytes identity key in a Web Worker closure.
3. **Native WebCrypto X25519/Ed25519** where the browser supports it (Chrome 133+, Firefox 135+, Safari 17.4+).
4. **Standard Notes `items_key` indirection** wraps per-note keys under a per-user/per-device key for future primitive upgrades.

The data flow through the system doesn't change. Every existing encrypted field stays encrypted. Users don't see anything.

## Why this matters

Our current crypto is hand-rolled over `@noble/curves` — good library, but our own ECIES construction has no formal security proof, no standard `info` string handling, no reference implementation to check ourselves against. HPKE is the IETF standard, has formal proofs, is deployed in TLS ECH and Oblivious HTTP, and is the foundation MLS KeyPackages use. **Adopting HPKE now is a pre-requisite for MLS later** (Tier 6) — the primitive is the on-ramp, not wasted work.

Non-extractable `CryptoKey` is the single biggest attack-surface reduction available to a web E2EE app in 2026. Raw key bytes literally never enter the JS heap — `crypto.subtle.exportKey()` throws on the handle, and the key lives in the browser's out-of-process crypto sandbox on Chromium/Safari. XSS on the page can still *use* the key through exposed helpers (smash-and-grab → live-oracle), but cannot exfiltrate it. This is the structural fix to Bitwarden/1Password's 2024 Cure53 finding about JS GC retention of key bytes.

Native X25519/Ed25519 via WebCrypto means we get the non-extractable benefit on our primary EC curves, not just AES.

`items_key` indirection (Standard Notes 004 innovation) is a zero-cost future-proofing move. When we later want to add ML-KEM for post-quantum (Tier 6), or swap HPKE suites, we re-wrap *one* `items_key` per user — not every note in the database. This eliminates one of the hardest practical problems in long-lived E2EE systems: primitive migration.

## Current Llamenos state

**Files to audit and refactor:**

- `src/client/lib/crypto-worker.ts` — the primary crypto op surface.
- `src/client/lib/crypto-worker-client.ts` — RPC client.
- `src/client/lib/key-store-v2.ts` — multi-factor KEK store; currently holds `nsec` as raw bytes.
- `src/shared/crypto-labels.ts` — 25 labels, map 1:1 to HPKE `info` strings.
- `src/server/lib/crypto.ts` (or equivalent server-side crypto helpers) — server needs to decrypt its own envelope-encrypted data?
- `src/client/lib/hub-key-manager.ts` — hub key distribution/rotation.
- `src/client/lib/decrypt-fields.ts` — field decryption pipeline (from PR #42/43 work).
- `src/server/db/schema.ts` — the `ciphertext()` columns.
- `package.json` — add `@hpke/core`, `@hpke/dhkem-x25519`, `@hpke/chacha20poly1305`.

**Existing patterns:**
- `@noble/ciphers/chacha.js` for XChaCha20-Poly1305 (keep for now).
- `@noble/curves/secp256k1.js` for Nostr wire format (KEEP — separate from user key management).
- `@noble/hashes` for HKDF, SHA-256, etc.
- Crypto worker singleton (one per tab, lazy init).
- Decrypt rate limiter (100 ops/sec burst, 1000 ops/min sustained).

**Watch-outs:**
- `@noble/ciphers` and `@noble/hashes` require `.js` extension in imports.
- Nostr pubkeys are x-only (32 bytes); for ECDH we prepend `"02"` for compressed format.
- `secp256k1.getSharedSecret()` returns 33 bytes; we extract x-coord via `.slice(1, 33)`.
- Decrypt is in React Query `queryFn` callbacks (not components) so cache flows correctly.

## Proposed approach

### 1.1. HPKE migration — step by step

**Library choice:** `@hpke/core` + `@hpke/dhkem-x25519` + `@hpke/chacha20poly1305`. Audit-friendly, uses WebCrypto where possible, supports non-extractable recipient keys for P-256 natively.

**Mapping:**

```typescript
// Before (hand-rolled ECIES):
const shared = secp256k1.getSharedSecret(senderPriv, recipientPub).slice(1, 33)
const key = hkdf(sha256, shared, salt, context, 32)
const sealed = xchacha20poly1305(key, nonce).seal(plaintext, aad)

// After (HPKE-base):
import { CipherSuite } from '@hpke/core'
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519'
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305'

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
})

const sender = await suite.createSenderContext({
  recipientPublicKey: recipientPub,
  info: utf8Bytes(LABEL_HUB_KEY_WRAP),  // label from crypto-labels.ts
})
const sealed = await sender.seal(plaintext, aad)
// sender.enc contains the encapsulated key to send along with sealed
```

**Envelope format:** HPKE produces `(enc, ciphertext)` — the encapsulated KEM output and the AEAD ciphertext. Our current envelope format carries `(ephemeralPubkey, ciphertext)` — same shape, different semantics. Design the new envelope as:

```typescript
type HpkeEnvelope = {
  version: 'v2'
  suite: 'x25519-hkdf-sha256-chacha20poly1305'
  enc: Uint8Array  // HPKE KEM encapsulated key
  ct: Uint8Array   // HPKE AEAD ciphertext
  label: CryptoLabel  // from crypto-labels.ts (Tier 0 constraint)
}
```

**Migration strategy:**
- Envelope format carries a `version` field. `v1` = existing ECIES, `v2` = HPKE.
- New writes always use `v2`.
- Decrypt dispatches on version.
- No backfill of existing data — old notes/PII stay in `v1` format, readers just handle both. Since we're pre-production, we can also cut clean via a one-time re-encryption migration if the spec author prefers — decide explicitly.

**Map every crypto-label to an HPKE info string** (1:1, trivial).

**Server-side HPKE:** If the server ever encrypts on behalf of users (e.g., session metadata under `LABEL_SESSION_META`), it needs an HPKE implementation too. Bun supports WebCrypto natively and HPKE libs work server-side. Confirm in the spec.

### 1.2. Non-extractable `CryptoKey` for the identity key

**The stepping-stone change.** Full per-device-keys is Tier 3. In Tier 1 we keep the *model* of one identity key per user, but we upgrade the *storage* so the key is a non-extractable `CryptoKey` handle instead of raw bytes in a worker closure.

**Sketch:**
```typescript
// Generate once at account creation:
const keypair = await crypto.subtle.generateKey(
  { name: 'X25519' },  // native if browser supports, else fall back to P-256
  false,  // NOT extractable — this is the key property
  ['deriveKey', 'deriveBits'],
)

// Persist the private key handle to IDB directly:
await idb.put('identity_key', keypair.privateKey)

// On reload, retrieve the same handle:
const privKey = await idb.get('identity_key')  // typeof === 'CryptoKey' with extractable: false
// crypto.subtle.exportKey(privKey) would THROW
```

**The wrapping still matters.** The identity key exists in IDB, but we still want it gated behind the multi-factor KEK. Pattern:
- The identity `CryptoKey` lives in IDB under a table like `keys_locked` — but locked in what sense? It's non-extractable, so "locked" is a semantic overlay.
- Two options:
  1. **Authentication gate:** the identity key is always in IDB as a non-extractable `CryptoKey`, but the crypto worker refuses to *use* it until the user has proven possession of a valid KEK factor. The KEK itself doesn't wrap the key anymore; it authenticates the session.
  2. **Wrap gate:** the identity key is wrapped under a KEK-derived AES-KW non-extractable key. Unlock = `subtle.unwrapKey` into a new non-extractable handle. Lock = delete the handle from memory (IDB retains the wrapped form).
- **Recommend option 2** for compatibility with existing lock/unlock semantics. The KEK becomes a non-extractable AES-KW key itself.

**The KEK path:**
- PIN-derived KEK: Argon2id output 32 bytes → `subtle.importKey('raw', argonOutput, 'AES-KW', false, ['unwrapKey'])`. The KEK is a non-extractable AES-KW `CryptoKey`.
- Recovery key: same treatment.
- WebAuthn-blob factor: the blob is imported the same way.
- Combining factors: HKDF with labels, but the HKDF output is immediately imported as non-extractable AES-KW.

**CRITICAL:** at no point should the raw bytes of any key (identity or KEK) live in a plain `Uint8Array` in JS longer than the ~1ms it takes to pass them to `subtle.importKey`. Audit the existing worker carefully.

**Session capsule (PR #50) simplification:** With non-extractable `CryptoKey` in IDB, there's no capsule to persist. The key survives reload automatically. The capsule work becomes purely an unlock-*event* coordinator across tabs — the Web Locks API + BroadcastChannel pattern. This is a significant simplification.

### 1.3. Native X25519 / Ed25519 where available

- **Detect:** feature-detect `subtle.generateKey({name: 'X25519'}, ...)` on startup.
- **Prefer native** for identity keys and for HPKE recipient keys (via HPKE's WebCrypto integration path).
- **Fall back to `@noble/curves`** for browsers without support, for non-extractable simulation (impossible in JS but we do our best), and for **all Nostr wire format** operations (which use secp256k1 and are not available natively).
- **Keep Nostr identity separate from user key management.** The Nostr relay uses its own keys for publishing events; the user identity key is for envelope encryption. These should not share key material.

### 1.4. `items_key` indirection

**Standard Notes 004 innovation.** Wrap per-note keys under a per-user (Tier 1) or per-device (Tier 3) `items_key`.

**Current (Tier 3 per-note FS):**
```
per-note random key → ECIES-wrapped per reader
```

**Tier 1 with items_key:**
```
per-note random key → HPKE-wrapped under user's items_key
user's items_key → HPKE-wrapped per reader (self + shared readers)
```

**Why:** Primitive upgrades (HPKE → post-HPKE, or adding ML-KEM hybrid in Tier 6) re-wrap the `items_key` only. Every note still decrypts through the existing per-note key.

**Trade-off:** one extra layer of indirection at decrypt time. Negligible cost (one HKDF + AEAD op per session, cached).

**When to roll this in:**
- Option A: together with HPKE migration (one envelope format change).
- Option B: separately, after HPKE is stable.
- **Recommend A.** Same PR, same envelope version bump.

## Open design questions for the spec author

1. **HPKE suite selection.** `X25519-HKDF-SHA256 + ChaCha20-Poly1305` or `P-256-HKDF-SHA256 + AES-256-GCM`? X25519 is smaller/faster but P-256 gets non-extractable CryptoKey support out of the box. Recommend X25519 for new writes, with P-256 as an option for the server-side decrypt path where non-extractable matters more. Decide.
2. **Envelope versioning scheme.** `v1` vs `v2` field? Or embedded in the label? Recommend explicit `version` field for clarity.
3. **Migration strategy.** Read-both-write-new vs one-shot re-encryption migration? We're pre-production — one-shot is cleaner.
4. **PR #50 session capsule interaction.** PR #50 just shipped. Does Tier 1 supersede it, extend it, or run alongside? The capsule persistence layer becomes obsolete with non-extractable `CryptoKey` in IDB. Coordinate with PR #50 author.
5. **Server-side HPKE.** Does the server ever need to HPKE-seal or HPKE-open? If yes, pick a Bun-compatible lib. If no, server stays out of this refactor.
6. **Feature detection and graceful degradation.** What does Llamenos do on a browser without native X25519? Fall back to `@noble/curves` (no non-extractable benefit) or refuse to run? Recommend fall back with a clear runtime warning.
7. **`items_key` per-user vs per-hub vs per-device.** Per-user is simplest. Per-device is what Tier 3 will need anyway. Decide whether Tier 1's `items_key` is per-user (and gets re-homed in Tier 3) or per-device (pre-work for Tier 3). Recommend per-user in Tier 1 and per-device in Tier 3.
8. **Testing strategy.** Can we run HPKE unit tests under `bun:test`? Yes — HPKE libs are pure JS/WASM. API + UI E2E tests will exercise the full path.
9. **Backwards-incompatible envelope format:** pre-production means we can cut clean. Confirm no staging/production DBs need migration.

## Concrete scope

**In scope:**
- Add `@hpke/*` dependencies.
- Define new envelope format (zod schema in `src/shared/schemas/`).
- Migrate every `ECIES(...)` call site to HPKE.
- Add `items_key` indirection layer.
- Refactor `key-store-v2.ts` to store the identity key as a non-extractable `CryptoKey`.
- Feature-detect native X25519/Ed25519; prefer native where available.
- Update KEK factors (PIN, recovery, WebAuthn) to produce non-extractable AES-KW `CryptoKey`s.
- Simplify / retire the PR #50 session capsule (coordinate with PR #50 author).
- Update all crypto worker RPC methods.
- New unit + API + UI tests for HPKE path.

**Out of scope:**
- Label enforcement at decrypt (that's Tier 0; this spec depends on it being done).
- Signed sigchain membership (Tier 0).
- WebAuthn PRF as a new factor (Tier 2).
- OPAQUE login (Tier 2).
- Per-device keys (Tier 3).
- Post-quantum hybrid (Tier 6).
- Nostr wire format changes — Nostr events still use secp256k1.

## Success criteria

1. All existing encrypt/decrypt call sites use HPKE via a single typed helper.
2. Envelope format versioned; old/new coexist or clean-cut migration completed.
3. Identity key is a non-extractable `CryptoKey` — confirmed by `subtle.exportKey()` throwing in a test.
4. KEK factors produce non-extractable AES-KW `CryptoKey`s.
5. `items_key` indirection layer in place; re-wrapping the `items_key` does not touch per-note data.
6. Native X25519 used where available; fallback path works.
7. All existing tests pass.
8. New tests: HPKE encrypt/decrypt; non-extractable flag; label mismatch rejection; `items_key` rotation without note re-encryption.
9. Typecheck + build + lint clean.
10. Session capsule simplification merged or coordinated with PR #50.

## Trade-offs and anti-patterns

**Do:**
- Keep secp256k1 + noble for Nostr wire format — don't try to unify.
- Feature-detect at runtime, not build time.
- Import KEK output into a `CryptoKey` immediately; never keep raw KEK bytes around.
- Use HPKE `info` = label from crypto-labels.ts for free domain separation.

**Don't:**
- Mix the identity key and the Nostr key. They're different keys for different purposes.
- Use AES-GCM with a fixed nonce — HPKE handles nonces correctly if used via the AEAD interface.
- Roll your own HPKE. Use `@hpke/core`.
- "While we're here" add WebAuthn PRF or per-device keys. Out of scope.
- Skip the feature-detect path. The fallback is important for compatibility.

## Pointers to primary sources

- RFC 9180 HPKE: https://datatracker.ietf.org/doc/rfc9180/
- Cloudflare HPKE primer: https://blog.cloudflare.com/hybrid-public-key-encryption/
- `@hpke/core` docs: https://github.com/dajiaji/hpke-js
- Panva HPKE alternative: https://github.com/panva/hpke
- dchest "How to store web data in the keychain" (non-extractable CryptoKey pattern): https://dchest.com/2025/06/17/how-to-store-web-data-in-keychain/
- Igalia "Can I use secure curves in the web platform" (X25519/Ed25519 shipping status): https://blogs.igalia.com/jfernandez/2025/02/28/can-i-use-secure-curves-in-the-web-platform/
- Element-R IDB wrap-key pattern: https://github.com/element-hq/element-web/issues/24967
- Standard Notes 004 items_key: https://standardnotes.com/help/security/encryption
- WebCrypto spec: https://w3c.github.io/webcrypto/

## Related work in the repo

- PR #50 session capsule (session-capsule.ts, key-manager.ts) — Tier 1 renders the persisted nsec capsule obsolete. Coordinate.
- PR #48 PIN prompt on locked key — KEK unlock UX that Tier 1 preserves.
- Crypto worker rate limiter — still applies in the new HPKE world.
- `docs/protocol/llamenos-protocol.md` — update with HPKE envelope format.
- `docs/architecture/E2EE_ARCHITECTURE.md` — update the three tiers diagram to reflect HPKE.
