# The Llámenos Security Whitepaper

**Version 1.2 — 2026-04-21**
**Authors:** Llámenos security working group
**Status:** Public release. Canonical copy lives at
`docs/security/WHITEPAPER.md` in the Llámenos source repository. Any copy
served from a third-party mirror should be checked against the
hash-chained releases listed in §10.

> **Accuracy note.** This document describes both the architecture
> Llámenos is built toward and the architecture that is shipped on
> `main` today. Where the two diverge, §0.1 ("Current vs Target") is
> the authoritative, short-form account of what is actually running in
> the bundle you just loaded vs what is still in-flight. Throughout
> the rest of the document, statements marked **(target)** describe
> work that is partially or fully deferred; statements without that
> marker describe behavior that is live on `main` as of the version
> header above. If you find a present-tense claim in this document
> that contradicts §0.1, treat §0.1 as correct and open a
> documentation issue.

---

## 0. Abstract

Llámenos is a crisis-response hotline platform for volunteer-staffed
support lines facing well-resourced adversaries — nation states, private
intelligence firms, and organized harassment campaigns. Llámenos is
designed, built, and operated so that no single party — not the hosting
organization, not a compromised administrator, not the upstream provider
of our telephony or messaging, and not the code-delivery CDN — can
passively read or retroactively reconstruct a caller's notes, identity,
or contact graph.

This whitepaper describes how Llámenos achieves that goal, what residual
risks remain even under ideal operation, and how you, as a caller,
volunteer, admin, journalist, or independent researcher, can verify for
yourself that the version of Llámenos you are running is the version the
source repository claims to ship.

We describe what Llámenos **does** protect against. Equally importantly,
we describe what it **cannot** protect against: an endpoint compromised
with an OS-level keylogger, a browser extension capable of reading page
contents, or a volunteer being compelled to disclose notes they have
already read. These residual risks are documented in §7 and are the
motivation for the delivery-integrity stack described in §6.

Llámenos is open-source (AGPL-3.0 for server components,
Apache-2.0 for client libraries, GPL-3.0 for vendored MLS dependencies).
All source, all build scripts, all deployment automation, all CI
workflows, and this whitepaper live in a single public repository that
ships reproducible builds verified by at least two independent
organizations.

---

## 0.1 Current vs Target

The seven-tier security overhaul landed its core skeletons on `main`
through PR #104 (v0.48.2) and follow-up hardening PRs #105–#111. Not
every sub-item shipped in the first pass — the table below is the
short-form list of what is live on `main` today versus what is still
in-flight. The deferrals are enumerated in full in
`docs/security/POST_OVERHAUL_GAPS_2026-04-13.md`; this table is the
reader-facing summary.

| Area | Shipped today (on `main`) | Planned / target |
|---|---|---|
| **Hub-field encryption** (role names, shift names, report type names, custom field labels, team names) | HPKE v3 envelopes — `DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM`, per-record AAD via `buildAad(label, recordId, fieldName)`. Source: `src/shared/hpke-primitives.ts`, `src/shared/crypto-suite.ts`, `src/client/lib/queries/*.ts`. | Unchanged. |
| **Hub key distribution** | HPKE per-device wrap under `LABEL_HUB_KEY_WRAP` with AAD bound to `(deviceId, hubId)`. Source: `src/client/lib/hub-key-manager.ts`. | Unchanged. |
| **Notes encryption** | **MLS groupwise encryption** via vendored `@wireapp/core-crypto@9.3.3`. Each hub has a persistent MLS group (`llamenos:hub:<hubId>`). Notes are encrypted via `MlsConversation.encrypt()` and decrypted via `MlsConversation.decrypt()` — no per-recipient key wrapping. Epoch advances on membership change provide forward secrecy. Source: `src/client/lib/mls/conversation.ts`, `src/client/lib/crypto-worker.ts` (MLS RPC handlers). Shipped in Tier 6 PR #2 Slices 1–8 (PRs #164, #165, #181, #189, #193, #194, #195, #208). | Unchanged. |
| **Messages encryption** (SMS / WhatsApp / Signal inbound) | **MLS groupwise encryption** via the same hub MLS group as notes. Inbound webhook messages are server-encrypted (AES-GCM under `LABEL_MESSAGE`) then claimed and MLS-encrypted by the first client to fetch them; server plaintext is discarded at the webhook boundary. Source: `src/server/messaging/router.ts`, `src/client/lib/queries/conversations.ts`. Shipped in Tier 6 PR #2 Slice 6 (PR #194). | Unchanged. |
| **Blasts** (outbound messaging to external recipients) | Same ECIES + XChaCha20-Poly1305 envelope pattern (`LABEL_BLAST_CONTENT`). | Out of scope for the MLS migration — external recipients are not hub members. Remains on the `HpkeEnvelope` primitive. |
| **Identity unlock KDF** | **PBKDF2-SHA256, 600,000 iterations** over the PIN, combined via HKDF-SHA256 with the IdP-bound value and (if present) the WebAuthn PRF output. Source: `src/client/lib/key-store.ts` (`PBKDF2_ITERATIONS = 600_000`, `deriveKEK`). | **Argon2id** (memory-hard) replacement. No Argon2id is wired anywhere in the client today. |
| **Multi-factor KEK** | PIN + IdP-bound value (2-factor) or PIN + IdP-bound value + WebAuthn PRF (3-factor). Encrypted identity blob lives in localStorage; decrypted `nsec` is held in memory only and zeroed on lock. Source: `src/client/lib/key-store.ts`. | A separate **root-KEK bundle** (`src/client/lib/root-kek-store.ts`) persists an AES-KW-wrapped root key in IndexedDB but **does not yet wrap the identity bytes or hub CryptoKey** — that integration is a Tier 3 P1 item. Recovery-group Shamir share wrapping via HPKE is a Tier 2 P0 item and not yet shipped. |
| **Crypto Web Worker isolation** | All ECIES / XChaCha20 / HPKE operations run in a dedicated Web Worker (`src/client/lib/crypto-worker.ts`). Identity key material lives in a closure inside the worker and is zeroed on lock. Source: `src/client/lib/crypto-worker.ts`, `src/client/lib/crypto-worker-client.ts`. | Unchanged as the *default* transport. |
| **Crypto sandbox iframe** | **Scaffolded and wired, non-load-bearing.** The iframe subproject (`crypto-sandbox/`) exists and `bootCryptoSandbox()` eagerly boots it when `VITE_CRYPTO_ORIGIN` is set. Tier 4 P0 (PR #108) fixed the opaque-origin `postMessage` round-trip so the channel is no longer silently broken. However, no production call site routes crypto operations through the iframe today — the Web Worker remains the sole home for key material. Source: `src/client/lib/boot-crypto-sandbox.ts`, `src/client/lib/crypto-iframe-client.ts`. | **Exclusive home for cryptographic primitives.** Notes/messages decrypt, HPKE seal/open, SFrame key derivation, and identity unlock all migrate behind the iframe's postMessage RPC, so a main-frame XSS cannot read decrypted plaintext even under full compromise of the app origin. |
| **Client-side binary verifier** | `src/client/lib/binary-verifier.ts` implemented (Ed25519 signed release manifest, SHA-256 file-by-file check, fail-closed enum of error conditions). | **Wiring into SPA boot.** `verifyOrThrow` has no caller in `src/client/main.tsx` as of this version — a compromised bundle currently boots and unlocks normally. Tracked as Tier 4 P0 in `POST_OVERHAUL_GAPS_2026-04-13.md`; PR #111 is in flight. The `/api/releases/latest/manifest` server route is not yet shipped. |
| **Gossip attestation of loaded bundles** | `GossipVersionClient` (`src/client/lib/gossip-version.ts`) implemented with ephemeral schnorr keys per loader instance. | **Wiring** — no caller instantiates the client in production today, so fleet-divergence detection is observational only. Tracked as Tier 4 P0. |
| **Reproducible builds + cosign signing** | `Dockerfile.build`, `SOURCE_DATE_EPOCH`-pinned, cosign keyless signing via GitHub Actions, SLSA provenance, `CHECKSUMS.txt` + `CHECKSUMS.txt.cosign-bundle` attached to each GitHub Release. | Unchanged. |
| **Third-party verifiers** | Verifier workflow defined (`verify-llamenos.yml`). | Only **one** verifier is operational today; the second verifier and the signed `VERIFIER_MOU.md` are still being negotiated. The stale-fleet banner logic exists but is observational until the second verifier is running. |
| **Voice E2EE (SFrame)** | Tier 5 PR #110 wired SFrame into the Twilio adapter + UI `ActiveCallBadge` / `E2eeFallbackBanner`. SFrame worker, key derivation, and Twilio pc-hook are live on `main`. | **Vonage + Plivo** adapters still have `TODO(tier-5)` markers for their SDK `RTCPeerConnection` accessors (`src/client/lib/webrtc/adapters/vonage.ts:48`, `plivo.ts:58`); `#installHook` is defined but never called. Per Tier 5 P0 in `POST_OVERHAUL_GAPS_2026-04-13.md`, those adapters will fail-closed when a hook is provided but `pc` is inaccessible. Worker error surfacing + fail-loud audit variants + modal-unmount fail-closed semantics are tracked as Tier 5 P1 (PRs #112, #117). |
| **Warrant canary** | Plaintext Markdown at `docs/security/WARRANT_CANARY.md`, committed via a GPG-signed human commit. | **Ed25519 signing** of the canary document itself, `.sig` file published alongside, signing pubkey pinned in-bundle. Code for this is drafted in PR #113 (in flight) but has not merged; the canary is therefore not cryptographically verifiable from within the client today. |
| **Session-capsule / refresh rotation** (Tier 0) | Opaque 32-byte refresh token hashed server-side; rotated on every refresh; `user_sessions` table backs revocation; session metadata envelope-encrypted per user; DB-IP Lite geolocation offline. | Unchanged. |
| **Signed hash-chained audit log** | SHA-256 chain with `previousEntryHash` / `entryHash`, schnorr signature over `entryHash`, boot-time verifier refuses to show admin data on chain break. | Unchanged. |

### Short-form truth

- **Note/message confidentiality** is provided by **MLS groupwise
  encryption** via `@wireapp/core-crypto`. Each hub has a persistent
  MLS group; notes and messages are encrypted/decrypted through the
  group's ratchet tree. Epoch advances on membership change provide
  forward secrecy. The old ECIES + XChaCha20-Poly1305 multi-admin
  envelope loop has been deleted. Shipped in Tier 6 PR #2 (Slices
  1–8, merged 2026-04-21).
- **Hub metadata confidentiality** (roles, shifts, reports, etc.) IS
  HPKE-encrypted today with per-record AAD binding. This is the
  Tier 1 shipment.
- **Identity-key unlock** uses PBKDF2-SHA256 (600k) today.
  Argon2id is a target for a later tier.
- **All crypto still runs in the Web Worker, not the iframe.** The
  iframe exists and postMessage is functional after PR #108, but it
  is not the home of any key material in production. Treat any
  "iframe-sandboxed crypto" language in the rest of this document as
  **(target)**.

---

## 1. Executive summary

Llámenos' security model has six load-bearing properties. Every section
of this document ultimately maps back to one of them.

| # | Property | How we get it |
|---|---|---|
| 1 | Callers are anonymous by construction. | PSTN arrival → routing by opaque call-id → no caller-id storage beyond the minimum needed for duplicate-call dedup and ban enforcement. |
| 2 | Volunteer identity is visible only to admins. | Volunteer PII is envelope-encrypted per-user; only admins hold the keys needed to decrypt it. Other volunteers see only opaque display handles. |
| 3 | Note contents never reach the server in plaintext. | MLS groupwise encryption via `@wireapp/core-crypto`. Each hub's MLS group provides forward secrecy through epoch-based ratcheting; the server stores opaque MLS ciphertext only. Source: `src/client/lib/mls/conversation.ts`. |
| 4 | Audit events are tamper-evident. | SHA-256 hash chain + schnorr-signed sigchain; a single rewritten entry breaks the chain and is detectable by any reader. |
| 5 | The code running in your browser matches the code the repo shipped. | Reproducible builds, cosign-signed checksums, third-party verifiers, and a client-side binary verifier that fails closed on mismatch. |
| 6 | Targeted delivery attacks are publicly visible within minutes. | Every running client gossips the SHA-256 of the bundle it loaded; peers raise an alarm when they see a hash they cannot match. |

Properties 1–4 are the "at rest" security model — handled by the
cryptographic architecture described in §4 and §5. Properties 5 and 6
are the "in flight" security model — the Tier 4 delivery-hardening work
described in §6. Both are required for Llámenos' threat model to hold.

---

## 2. How to read this document

This whitepaper is written to be useful to three audiences:

- **Volunteers and admins** who want a plain-language answer to "is it
  safe to use this?" Read §1 (exec summary), §3 (threat model) and §7
  (residual risks). Skip everything else unless you want the receipts.
- **Journalists and human-rights workers** who want to understand
  Llámenos' guarantees before recommending it to a source or partner
  organization. Read §1, §3, §6 and §7.
- **Independent security researchers** who want enough detail to audit
  the source code themselves. Read §4 through §9 end-to-end; the
  relevant source paths are inlined in each subsection.

There is a companion document, `THREAT_MODEL.md`, that enumerates the
specific adversaries Llámenos defends against and the specific
capabilities they are assumed to have. If you are evaluating Llámenos
for production use you should read both.

---

## 3. Threat model

Llámenos' adversaries fall into four categories. We describe each, what
they can and cannot do, and which Llámenos sub-system is designed to
contain them.

### 3.1 External network adversary

An attacker with unrestricted visibility into traffic between clients
and the Llámenos server — for example, a nation-state traffic
interception capability.

- **Can do:** observe TLS metadata (SNI, timing, volume), block or
  delay connections, attempt TLS interception via a controlled CA.
- **Cannot do (under our model):** read content inside the TLS tunnel,
  read ciphertext payloads without also compromising a key-holder.
- **Mitigated by:** HTTPS everywhere, HSTS preload, certificate pinning
  where feasible, public-key pinning of the release signing key inside
  the SPA bundle, and Tier 4 origin-split + CSP `script-src 'none'` on
  the API origin.

### 3.2 Compromised server infrastructure

An attacker who has obtained root on the Llámenos host or on one of the
backing services (Postgres, strfry, RustFS, Caddy, Authentik).

- **Can do:** read all ciphertext at rest, read database metadata
  (who called whom, when, for how long), attempt to impersonate
  volunteers by resetting their PIN at the IdP, delete or corrupt
  audit logs.
- **Cannot do (under our model):** read note contents, read volunteer
  PII, forge signed audit entries, unwrap user envelopes without also
  compromising a user's device.
- **Mitigated by:** envelope encryption with keys held only on client
  devices, hash-chained + signed audit log that tolerates retroactive
  deletion (the chain breaks and becomes obvious), multi-party
  session-revocation on server restart, and Tier 4 third-party
  verifiers so the server cannot silently swap the bundle it serves.

### 3.3 Malicious volunteer or admin

A volunteer or admin acting in bad faith against their own
organization.

- **Can do:** see what they are entitled to see under the role-based
  access model — a volunteer sees their own notes during shifts; an
  admin sees all notes and the audit log.
- **Cannot do:** read notes outside their own organizational scope,
  silently delete audit entries, exfiltrate raw ciphertext in a form
  usable by a third party.
- **Mitigated by:** narrow role scopes, admin actions audit-logged
  into the signed hash chain, dual-envelope encryption so removing
  an admin's decryption key via CLKR (cross-signing log key rotation)
  actually cuts off their ability to decrypt future data.

### 3.4 Endpoint compromise

The hardest adversary: malware, a rogue browser extension, or a
physical attacker who has compromised a volunteer's laptop or phone.

- **Can do:** read everything the volunteer can see, log keystrokes
  including PINs, exfiltrate session tokens, capture screenshots.
- **Cannot do:** retroactively read notes from past shifts on devices
  they don't control; impersonate the volunteer beyond the lifetime
  of their current session once the volunteer's device has been
  quarantined.
- **Mitigated by:** per-note forward secrecy (§4.1), short-lived
  refresh tokens, server-side session revocation (Tier 0), the
  multi-factor KEK (§5.3), and — most importantly — the honest
  residual-risk disclosure in §7 so volunteers can make informed
  decisions about what to enter on untrusted endpoints.

### 3.5 Out-of-scope adversaries

Llámenos explicitly does **not** defend against:

- A caller who chooses to say their name and phone number aloud.
  Llámenos does not do voice anonymization or voice-keyword redaction.
- A volunteer who screenshots their shift view and leaks the
  screenshots elsewhere. Forward secrecy protects *past* data from
  *future* compromise; it cannot protect data that has already been
  voluntarily re-exposed.
- A legal adversary compelling an admin to disclose notes under
  lawful process. The warrant canary (§8) is our best attempt to
  signal this condition in jurisdictions where direct disclosure is
  forbidden by a gag order.
- Supply-chain compromise of our upstream dependencies where the
  compromise is indistinguishable from a normal upstream release.
  This is partially mitigated by SBOM diffing, cosign-verified
  dependencies, and the third-party verifiers in §6.

---

## 4. Cryptographic architecture

### 4.1 Per-note forward secrecy

Every note written in Llámenos is encrypted under a fresh
`XChaCha20-Poly1305` content key. The content key is randomly generated
at note creation time, used to encrypt the note body, and then wrapped
separately for each reader of the note — the volunteer who wrote it,
and every current admin in the hub.

**Shipped today:** Wrapping is done via the legacy ECIES envelope
family (`eciesWrapKey` in `src/shared/crypto-primitives.ts`) under the
domain label `LABEL_NOTE_KEY`. The per-note key is bound to each
reader pubkey via ECDH over secp256k1, HKDF-SHA256 derivation, and an
XChaCha20-Poly1305 key-wrap. The wrapped keys are stored as individual
`RecipientKeyEnvelope` rows — one author envelope + one per current
admin. The note's ciphertext is stored once. See `encryptNote` /
`decryptNoteWithKey` in `src/shared/crypto-envelopes.ts`.

**(target)** Tier 6 PR #2 replaces this multi-admin envelope loop with
**MLS groupwise encryption** via vendored `@wireapp/core-crypto`:
every hub owns an MLS group; notes become MLS application messages
inside that group; adding or removing an admin is an MLS commit that
advances the epoch rather than a rewrap of every past envelope.
`src/client/lib/mls/conversation.ts` is an empty skeleton on `main`
today — the lifecycle methods land in PR #2. Until then, the ECIES
envelope path above is the real confidentiality boundary.

This means:

- The server never sees the content key.
- A note can be read by any current member of the envelope set
  without re-encrypting the note body.
- When an admin leaves the organization, future notes no longer
  wrap their key; they cannot read anything written after their
  removal, even though the ciphertext is still in the database.
- Recovering a single lost note requires recovering exactly one
  wrapped key, not re-deriving the entire database.

Forward secrecy over time is achieved via Cross-signing Log Key
Rotation (CLKR), described in Tier 3 of the security roadmap. After
CLKR lands, an admin who loses their device can be revoked via a
signed event on the Nostr relay; clients hold-back any notes written
after the revocation event from that admin's envelope set within the
bounded-consistency window CLKR provides.

**Source:** `src/shared/crypto-envelopes.ts` (note envelope + wrap),
`src/shared/crypto-primitives.ts` (`eciesWrapKey` /
`eciesUnwrapKeyWithSecret`), `src/client/lib/crypto-worker.ts` (worker
RPC surface), `src/server/services/records.ts` (note row storage),
`src/shared/hpke-primitives.ts` (the HPKE primitive family — not
currently used for notes; see §0.1 for the MLS target).

### 4.2 Hub key + rotation

A "hub" is Llámenos' unit of organizational scoping — one hotline
organization's notes, volunteers, shifts, and settings are all scoped
to a single hub. Every hub has a symmetric 32-byte **hub key** used
to encrypt organizational metadata that every hub member needs to
read (role names, shift names, report type labels, custom field
definitions, team names).

The hub key is generated via `crypto.getRandomValues(new Uint8Array(32))`
at hub creation. It is **not** derived from any identity key — that
decoupling is deliberate, so that rotating the hub key after a
personnel change does not force every member to rotate their personal
identity keys.

Hub key distribution uses HPKE with the label
`LABEL_HUB_KEY_WRAP`: each current member gets an individually-wrapped
copy published to the Nostr relay. Hub key rotation on member
departure is mandatory — the new hub key is wrapped only to the
remaining members, and the old key is treated as compromised.

**Source:** `src/client/lib/hub-key-manager.ts`,
`src/shared/crypto-labels.ts`.

### 4.3 Multi-factor KEK (key store)

A volunteer's long-lived identity key (the `nsec` used to sign audit
entries and Nostr events) is held in memory only. At rest, it is
encrypted under a **multi-factor Key Encryption Key** derived from
some combination of the following factors (the exact set is recorded
on the encrypted blob so it can be reproduced at unlock time):

- A **PIN** the user chooses at onboarding. Stretched with
  **PBKDF2-SHA256, 600,000 iterations** against a 32-byte salt.
  *(target — Argon2id memory-hard replacement is planned but not
  wired anywhere on `main` today; see §0.1.)*
- An **IdP-bound value** — a per-user 32-byte secret released by
  the Authentik (or future) IdP after successful OIDC login.
  Concatenating this into the KEK input means that an attacker who
  has obtained the encrypted blob and the PIN still cannot unlock
  without a fresh IdP session.
- An optional **WebAuthn PRF output** bound to a hardware
  authenticator (YubiKey, platform TPM, etc.). When WebAuthn PRF is
  available the store runs in 3-factor mode
  (`LABEL_NSEC_KEK_3F`); otherwise it runs in 2-factor mode
  (`LABEL_NSEC_KEK_2F`).

The factor assembly is:

1. PBKDF2-SHA256 over the PIN → 32-byte `pinDerived`.
2. `ikm = pinDerived ‖ (prfOutput?) ‖ idpValue` (each exactly 32
   bytes).
3. HKDF-SHA256 over `ikm` with the factor-count-specific `info`
   label → 32-byte KEK.
4. XChaCha20-Poly1305 encrypts the `nsec` bytes under the KEK and
   stores the result in `localStorage` as a JSON blob versioned
   `version: 2`.

**(target — multi-factor KEK expansion.)** The short-form
architecture above intentionally reuses a single PIN across every
unlock. A richer multi-factor design — a separate recovery key
(diceware / Shamir) plus independent WebAuthn unlock as a *primary*
factor rather than as PRF-extended IKM — is partially skeletoned in
`src/client/lib/root-kek-store.ts` (IndexedDB-backed AES-KW root KEK
bundle) but that store does **not** yet wrap the identity bytes or
the hub `CryptoKey`. The integration is tracked as Tier 3 P1 in
`POST_OVERHAUL_GAPS_2026-04-13.md`. Until it lands, the `key-store.ts`
blob described above is the real identity-unlock surface.

The in-memory `nsec` is zeroed on lock (tab blur, explicit lock,
inactivity timeout) and wiped on logout. The key store's lifecycle
tests verify this via a `fill(0)` check on the secret buffer after
every lock event.

**Source:** `src/client/lib/key-store.ts`,
`src/client/lib/root-kek-store.ts`,
`src/client/lib/crypto-worker-client.ts`.

### 4.4 Signed, hash-chained audit log

Every admin action (volunteer added, volunteer removed, role changed,
hub key rotated, residual-risk acknowledged, warrant canary refreshed)
is recorded as an audit entry with the following shape:

```
{
  "type":          <enum>,
  "payload":       <JSON>,
  "actorPubkey":   <hex-x-only-pubkey>,
  "timestamp":     <epoch-seconds>,
  "previousEntryHash": <hex-sha256>,
  "entryHash":     <hex-sha256>,
  "signature":     <hex-schnorr>
}
```

`entryHash` is SHA-256 over the canonical serialization of
`{type, payload, actorPubkey, timestamp, previousEntryHash}`.
`signature` is a schnorr signature over `entryHash` using the actor's
nsec.

Any reader with the current hub key set can verify:

1. Each `entryHash` matches the recomputed hash.
2. Each entry's `previousEntryHash` matches the prior entry's
   `entryHash`.
3. Each signature verifies against the claimed actor's pubkey.

A single rewritten entry breaks the chain at that entry and at every
subsequent entry, and every reader sees it as an invariant failure.
The verifier is implemented in `src/client/lib/audit-chain-verifier.ts`
and is exercised by the boot sequence on every unlock — if the chain
is broken, the UI refuses to show admin data and surfaces a "chain
broken" error state.

**Source:** `src/client/lib/audit-chain-verifier.ts`,
`src/server/services/audit-service.ts`,
`docs/security/KEY_REVOCATION_RUNBOOK.md` for the out-of-band recovery
procedure when a chain break is detected.

### 4.5 Messaging envelope

SMS, WhatsApp, and Signal messages that arrive via webhooks are
encrypted at the webhook boundary before any plaintext touches
persistent storage. The webhook handler:

1. Validates the provider's signature on the incoming payload.
2. Generates a per-message random symmetric key.
3. Encrypts the plaintext under that key with XChaCha20-Poly1305.
4. Wraps the per-message key, under the domain label `LABEL_MESSAGE`,
   for every reader (assigned volunteer + each current admin). The
   wrap primitive on `main` today is **ECIES over secp256k1 + HKDF-
   SHA256** (`eciesWrapKey` in `src/shared/crypto-primitives.ts`), the
   same envelope family described in §4.1 for notes. **(target — Tier
   6 PR #2)** the per-message key and the per-message wrap loop are
   both replaced by MLS groupwise encryption against the hub's MLS
   group.
5. Writes the ciphertext, wrapped keys, and metadata to the database
   in a single transaction.
6. Discards the plaintext before returning.

The server never writes the plaintext to disk — not even to a log.
The hot-path test suite grep-checks the messaging service for
`console.log` on plaintext variables at CI time.

**Source:** `src/shared/crypto-envelopes.ts` (`encryptMessage`),
`src/server/services/conversation-service.ts`,
`src/server/middleware/webhook-signature.ts`.

---

## 5. Delivery integrity — the Tier 4 problem

The cryptographic architecture above assumes that the JavaScript
running in your browser is the JavaScript we published. That
assumption is the single largest attack surface for an adversary
capable of compelling the hosting organization. Tier 4 is the set of
measures that make the assumption verifiable rather than trusted.

### 5.1 Origin split

Llámenos serves from three origins that are cryptographically
disjoint:

- `app.llamenos.example` — the SPA. CSP
  `script-src 'self' 'nonce-…'`, no third-party scripts, no eval,
  no remote fonts. Published as static files on a Caddy host with
  no backend access.
- `api.llamenos.example` — the Hono API + the strfry Nostr relay +
  RustFS blob storage. CSP `script-src 'none'`. No HTML served at
  all; the API speaks only JSON + WebSocket.
- `crypto.llamenos.example` — a dedicated origin that serves nothing
  but the cryptographic sandbox iframe. See §5.2.

A compromise of the API origin cannot deliver new code to the app
origin; the app origin has no way to execute code delivered from the
API origin; the crypto origin is sandboxed against both. This is
the "code-execution compartment" design borrowed from Signal Desktop
and 1Password's web clients.

### 5.2 Sandboxed crypto iframe

**Status on `main`: scaffolded and wired, non-load-bearing.** The
design goal of §5.2 is that every cryptographic primitive — HPKE,
XChaCha20, schnorr, SHA-256, the (target) Argon2id KDF, the hub key
manager, the multi-factor KEK, the audit-chain verifier, and the
envelope decrypt pipeline — runs inside an iframe served from
`crypto.llamenos.example`, with identity key material never leaving
the iframe's JavaScript context. The iframe subproject exists
(`crypto-sandbox/` in the repo root), `bootCryptoSandbox()` eagerly
boots it when `VITE_CRYPTO_ORIGIN` is set, and Tier 4 P0 (PR #108)
fixed the opaque-origin `postMessage` round-trip that was silently
breaking the channel before that fix. **However, no production call
site routes crypto operations through the iframe today.** The
dedicated crypto Web Worker (`src/client/lib/crypto-worker.ts`) is
the real home for key material on `main`, and decrypted plaintext
still flows through the main frame in the normal React Query cache.
The architecture below describes the **(target)** state; treat the
iframe as an isolation boundary under construction.

The iframe has:

- CSP `connect-src 'none'` (it does no network I/O on its own —
  the main frame shuttles all ciphertext/plaintext through
  postMessage)
- Trusted Types enforced, with a single throwing policy
- `require-trusted-types-for 'script'`
- An explicit origin check at the top of every incoming message
  handler, with wrong-origin messages silently dropped (no reply
  leak)
- A zod-validated RPC schema for every operation — any
  schema-violating message is rejected and increments an anomaly
  counter visible to the main frame

**(target)** If a non-crypto subsystem is compromised (a React
component bug, a router XSS, a CSS injection in a preview pane), it
is contained to the main frame. It cannot read identity keys,
decrypted notes, or the PIN, because the iframe never hands those
back — only the concrete results of the RPC operations. This
property only holds once every crypto call site has been migrated
from the Web Worker transport to the iframe postMessage RPC; see
`POST_OVERHAUL_GAPS_2026-04-13.md` Tier 4 for the migration order.

**Source:** `crypto-sandbox/` Vite subproject,
`src/shared/schemas/crypto-rpc.ts`,
`src/client/lib/crypto-iframe-client.ts`,
`src/client/lib/boot-crypto-sandbox.ts`.

### 5.3 Reproducible builds

The release pipeline (`.github/workflows/release.yml`) builds the SPA
inside a pinned Debian container with `SOURCE_DATE_EPOCH` set from
the git tag. Every tool version — Bun, Vite, Biome, node, the pnpm
lockfile — is pinned by content hash. The output is a deterministic
set of content-hashed files: rebuilding the same tag twice yields
byte-identical artifacts.

The pipeline then generates `CHECKSUMS.txt` (a SHA-256 manifest of
every built file) and signs it with **cosign** in keyless mode,
producing `CHECKSUMS.txt.cosign-bundle`. The cosign bundle embeds
the SLSA provenance — which GitHub Actions workflow, which commit,
which runner image — and is verifiable against the public sigstore
transparency log (Rekor) by any third party.

A `bundle-manifest.json` is also attached to the GitHub release. It
is a JSON object mapping relative paths to SHA-256 hashes, signed
with a pinned Ed25519 **release signing key** whose public key is
compiled into the SPA at build time. This is the manifest the
client-side binary verifier reads.

### 5.4 Third-party verifiers

An allied organization — not part of Llámenos' hosting footprint,
ideally in a different jurisdiction — runs the
`verify-llamenos.yml` GitHub Action every 15 minutes. The verifier:

1. Fetches the HTML served at `app.llamenos.example`,
   `crypto.llamenos.example/sandbox.html`, and every script + style
   they reference.
2. Downloads the latest release's `CHECKSUMS.txt` and
   `CHECKSUMS.txt.cosign-bundle` from GitHub Releases.
3. Runs `cosign verify-blob` against the bundle with the GitHub
   Actions OIDC issuer pinned.
4. Compares the live-served file hashes to `CHECKSUMS.txt` line by
   line. Any mismatch is fatal.
5. Publishes a signed verdict event to the Llámenos Nostr relay.
6. On mismatch, opens a public GitHub issue tagged `bundle-mismatch`.

At least two independent verifiers run concurrently, ideally in two
different jurisdictions. Their verifier keys are signed by their
hosting organization and published in
`docs/security/VERIFIER_MOU.md`. If a verifier goes silent for more
than 1 hour, clients treat the fleet as "verification stale" and
surface a banner.

### 5.5 Client-side binary verifier

In parallel with the server-side third-party verifiers, every
running client is intended to run its own bundle integrity check
before any key material is touched. The verifier module
(`src/client/lib/binary-verifier.ts`) and its `verifyOrThrow` entry
point exist on `main` today and implement the logic below.
**However, as of v1.1 of this document `verifyOrThrow` has no
caller in `src/client/main.tsx`** — a bundle with a mismatched
manifest will currently boot and unlock normally. Wiring the
verifier into the boot sequence (and shipping the
`/api/releases/latest/manifest` server route that backs it) is
Tier 4 P0 in `POST_OVERHAUL_GAPS_2026-04-13.md` and is being
prepared on PR #111. The "fail-closed" property below therefore
describes the **(target)** boot flow, not the current one.

On unlock **(target)**:

1. The client fetches the signed release manifest from
   `api.llamenos.example/api/releases/latest/manifest`.
2. It verifies the manifest's Ed25519 signature against the release
   signing key pinned in the bundle at build time.
3. It enumerates every script and stylesheet referenced by the
   running document, fetches each resource fresh
   (`cache: 'no-store'`), and hashes the contents with SHA-256.
4. It compares each hash to the manifest.

On mismatch, the client **fails closed** — it raises a
`VerifierFailure` that the boot orchestrator MUST treat as a refusal
to run. The UI shows a "bundle verification failed" screen with
instructions for the user to contact security. It does **not**
proceed to unlock the identity key, enter the PIN prompt, or
download any further code.

"Fail closed, never fall back" is an explicit design rule for this
subsystem. A silent fallback to "run anyway with a warning" would
let a determined attacker trigger the fallback condition to
downgrade the client out of its own protection. Every error
condition in `binary-verifier.ts` is an explicit enum value, and
`verifyOrThrow` is the only correct entry point for boot-time use.

**Source:** `src/client/lib/binary-verifier.ts`.

### 5.6 Gossip attestation of loaded hashes

Signed release manifests and third-party verifiers protect against
the case where the SPA is silently swapped for every user at once.
They do **not** protect against the case where the SPA is swapped
for a *single user* — the server can serve signed, verified release
X to 9,999 clients and a different-but-also-signed release Y to a
single client whose cookie matches a targeting rule.

To detect targeted attacks, every running client is intended to
publish a **bundle attestation** to the Nostr relay once per
unlock. The `GossipVersionClient` class
(`src/client/lib/gossip-version.ts`) implements the publisher and
subscriber logic, but as of v1.1 of this document **no call site
instantiates it in SPA boot**, so fleet-divergence detection is
observational only on `main`. Wiring is tracked as Tier 4 P0
alongside the binary-verifier wiring. The attestation **(target)**
is a signed Nostr event (kind 20002, the ephemeral range)
containing:

```
{
  "version": 1,
  "bundleHash": "<sha256 of every loaded script + style + index.html>",
  "bundleVersion": "<semver>",
  "releaseTag": "<git tag>",
  "timestamp": <epoch-seconds>,
  "userAgent": "<first 256 chars of navigator.userAgent>"
}
```

The event is signed with an **ephemeral schnorr keypair**, freshly
generated per loader instance and never linked to the user's
identity key. This is the privacy-critical piece: if the bundle
attestation were signed with the user's identity key, the gossip
channel would become a de-anonymization vector. Every
`GossipVersionClient` in `src/client/lib/gossip-version.ts` zeroes
its secret key in `destroy()`.

On subscribe, the client also reads every other kind-20002 event
within its observation window. For every peer event whose bundle
hash does **not** match its own hash, the client raises a
"fleet divergence detected" alert. An attacker performing a
targeted attack must either:

- Swap the bundle for every client simultaneously (which the
  third-party verifiers will catch within 15 minutes), OR
- Accept that at least one non-target client will see a gossip
  attestation that contradicts its own, raising an alert publicly
  within seconds.

The alert is visible to volunteers, admins, and — via a public
mirror of the Nostr relay — to external observers. In effect, the
gossip channel turns targeted delivery attacks into a public
integrity failure.

**Source:** `src/client/lib/gossip-version.ts`,
`src/shared/schemas/gossip-version.ts`.

### 5.7 Service worker hardening

The service worker operates in prompt mode: updates are not applied
silently. When the browser detects a new SW version, the user must
explicitly consent before the update is activated.

The SW performs manifest-verified caching: on install, it fetches the
signed release manifest, verifies the Ed25519 signature against a
build-time-pinned public key, and stores the verified release tag.
An anti-downgrade check refuses to install manifests with a lower
semver than the currently stored version.

**Limitation:** This is Trust-on-First-Use. The first install trusts
whatever the server delivers. The service worker cannot verify itself
on first load — that is the fundamental web trust problem. For
returning users, the hardened SW provides meaningful protection against
a server compromise that occurs after the initial install.

**(status on `main`)** Prompt-mode registration, manifest verification,
and anti-downgrade are implemented. The SW verifier is defense-in-depth
alongside the main-thread binary verifier (§5.5), which is the
fail-closed gate.

### 5.8 Compositional guarantee

Properties 5.1 through 5.6 are not redundant — each is designed to
catch a different failure mode of the others:

- The **origin split** catches code-path confusion within a single
  compromised origin.
- The **sandboxed iframe** catches crypto-primitive compromise
  originating from a compromised main-frame component.
- **Reproducible builds** catch tampering during the release
  pipeline itself.
- **Third-party verifiers** catch a post-release swap of the served
  bundle for the entire fleet.
- The **client-side binary verifier** catches a live-serve mismatch
  for the specific client running it, even if the third-party
  verifiers have not yet caught up.
- **Gossip attestation** catches a targeted swap that fools both the
  third-party verifiers and the individual client-side verifier.

An attacker needs to defeat **all six** to silently serve modified
code. Any one of them failing — in the right direction — is enough
to raise the alarm.

**(status on `main`)** Of the six defenses above, the origin split,
reproducible builds, and the first third-party verifier are
operational today. The sandboxed iframe is scaffolded but not yet
load-bearing (§5.2); the client-side binary verifier is implemented
but not yet wired into SPA boot (§5.5); the gossip attestation
client is implemented but not yet instantiated in the boot path
(§5.6). The delivery-hardening guarantee in this section therefore
applies in full only to the **(target)** configuration — the
Tier 4 P0 items in `POST_OVERHAUL_GAPS_2026-04-13.md` track the
remaining wiring.

---

## 6. How to verify this release yourself

### 6.1 Verify the cosign bundle

```bash
gh release download v1.0.0 --repo llamenos/llamenos-hotline \
  --pattern 'CHECKSUMS.txt' --pattern 'CHECKSUMS.txt.cosign-bundle'

cosign verify-blob \
  --bundle CHECKSUMS.txt.cosign-bundle \
  --certificate-identity-regexp '^https://github\.com/llamenos/llamenos-hotline/\.github/workflows/release\.yml@refs/tags/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  CHECKSUMS.txt
```

This confirms that `CHECKSUMS.txt` was produced by a Llámenos
release workflow run triggered by a git tag push, signed through
sigstore's keyless flow, and recorded in the public Rekor
transparency log.

### 6.2 Reproduce the build

```bash
./scripts/verify-build.sh v1.0.0
```

The script pulls the pinned build container, rebuilds the SPA
inside it with `SOURCE_DATE_EPOCH` set from the tag's commit date,
and diffs the produced artifacts against `CHECKSUMS.txt`.

Expected output: `all 48 files matched`. A single mismatch means
one of three things: (a) a nondeterminism has crept into the build,
(b) the upstream release was tampered with post-publish, or (c)
your environment is not quite the pinned container (check your
container runtime). Report any failure to `security@llamenos.example`.

### 6.3 Verify the running SPA

In your browser, open the Llámenos app and run the one-click
"Verify bundle" command from the security menu. This runs
`binary-verifier.ts` against the currently-loaded document. It
should report `all <N> files match release <tag>`.

You can also run the verifier manually:

```js
// In the browser devtools console:
const { runBinaryVerifier } = await import('/src/client/lib/binary-verifier.ts')
const result = await runBinaryVerifier()
console.log(result)
```

### 6.4 Watch the gossip channel

Subscribe to the public mirror of the Llámenos Nostr relay
(`wss://nostr.llamenos.example` → anonymous read is permitted for
kind-20002 events) and watch for `bundleHash` values that do not
match the current release. Any divergence is an alert condition.

```bash
nak req -k 20002 wss://nostr.llamenos.example | jq '.content'
```

### 6.5 Check the warrant canary

The canary lives at `docs/security/WARRANT_CANARY.md` in the repo
and is mirrored at `https://llamenos.example/security/warrant-canary`.
Its staleness is exposed to the UI — the security menu shows a
"canary last refreshed N days ago" field. A canary that is more
than its declared refresh interval past due is a signal condition
(see §8 for the interpretation rules).

---

## 7. Residual risks

Llámenos is **not** a magic wand. This section lists every
significant threat class we know about that the system does not, or
cannot, defend against.

### 7.1 Compromised endpoint

If your laptop, phone, or browser has been compromised by an
attacker with local code execution — a keylogger, a malicious
extension, a kernel rootkit — Llámenos cannot protect you from
that attacker while you are using it. The attacker can read your
PIN as you type it, the plaintext notes as they render, and the
session token as it is set. Per-note forward secrecy protects your
future notes once the attacker is evicted; it does not protect the
current session.

Mitigation:

- Use Llámenos from an endpoint you trust. For high-risk
  engagements, consider a dedicated Tails / Qubes workstation.
- Keep your browser and OS patched.
- Do not install browser extensions on the profile you use for
  Llámenos.
- Use WebAuthn with a hardware token as your primary unlock factor.

### 7.2 Coercion

An admin compelled by law, force, or social engineering to
disclose notes or revoke volunteer access can do so. Cryptography
does not prevent a human from obeying a court order. The warrant
canary (§8) is our best attempt at a signaling mechanism for this
scenario.

### 7.3 Traffic analysis

Even though Llámenos' content is end-to-end encrypted, metadata
(who connected, when, from where, for how long) is visible to the
network operator and to the Llámenos server. For threat models
that include traffic analysis by a state-level adversary, clients
should connect via Tor, a per-call VPN, or a dedicated mobile
hotspot that is not linked to the volunteer's identity.

### 7.4 Client-side delivery attacks the verifier cannot catch

The binary verifier (§5.5) catches only what it can see. If an
attacker injects code *between* the binary verifier's fetch and
the browser's execution — for example, via a browser-level
man-in-the-middle tool that rewrites `<script>` tags on the fly —
the verifier cannot observe that. This is why the verifier alone
is not sufficient: the gossip channel (§5.6) is the backstop,
because peers will see the difference between what they loaded and
what you loaded.

### 7.5 Quantum-adversary deferral

None of the curve-based primitives currently in use are post-
quantum secure: hub-field HPKE uses `DHKEM(X25519, HKDF-SHA256)`,
note/message ECIES uses secp256k1 + HKDF-SHA256, and the
identity/Nostr key is schnorr over secp256k1. A sufficiently-
capable quantum adversary collecting ciphertext today can decrypt
it later. The Tier 6 roadmap vendors `@wireapp/core-crypto` and
layers MLS on top of the note envelope, **(target)** providing a
post-quantum ciphersuite (XWing or P-384 fallback) for new notes
and messages. Llámenos v1 is not post-quantum secure; Llámenos v2
will be.

### 7.6 Out-of-band leakage

A volunteer copy-pasting a note into Slack, printing a transcript
on a networked printer, or dictating a note into Siri gives that
note to an entirely different service Llámenos has no visibility
into. The only defense is training: `docs/security/VOLUNTEER_BRIEFING.md`
covers this explicitly and must be read before a volunteer is
given note-taking permissions.

### 7.7 Silent key-compromise followed by session replay

If an attacker obtains a long-lived session refresh token — for
example, via a backup that was not encrypted, or a browser profile
exfiltration — they can impersonate the volunteer until the token
is rotated. Tier 0 rotated refresh tokens on every use and
introduced a server-side `user_sessions` table so admins can revoke
specific sessions on demand. This reduces the window but does not
eliminate it. Watch the sessions page in the settings UI and
revoke anything unfamiliar immediately.

### 7.8 Web trust gap

The web platform cannot provide native-app-level code integrity
guarantees. A compromised server can serve modified JavaScript on first
load, before any client-side verification runs. The service worker
hardening (§5.7) mitigates this for returning users via TOFU, but
first-load protection requires a trust anchor outside the web page —
which the web platform does not provide on mobile.

Native clients (Tauri for desktop, planned iOS and Android apps) move
the trust anchor to OS-level code signing and are the long-term answer.
The web client is a v1 transitional tool.

---

## 8. Warrant canary

### 8.1 What it is

A warrant canary is a public statement — signed and timestamped —
asserting that the Llámenos operators have not, as of a given
date, received any legal process they are forbidden from
disclosing. The canary is **not** a cryptographic primitive. It
is a legal/procedural artifact whose security relies on the
existence of legal regimes that forbid lying about the content of
a gag order but permit refusing to update a pre-existing
statement.

### 8.2 How it works in practice

The canary is refreshed monthly. The canary commit is GPG-signed by
a human operator identified in `docs/security/SECURITY_TEAM.md`; the
canary cannot be refreshed programmatically.

**(target)** Each refresh will additionally be **Ed25519-signed by
the Llámenos release signing key** (the same key that signs the
binary manifest in §5.3), with the signature published alongside
`WARRANT_CANARY.md` as a `.sig` file and verified in-browser against
a pubkey pinned into the SPA at build time. Tier 4 P1 tracks this as
"warrant canary signing" and PR #113 is the in-flight
implementation; until it merges, `WARRANT_CANARY.md` is plaintext
Markdown protected only by the GPG commit signature and the
reproducible-build chain.

Clients display the canary's age in the settings UI. When the
canary is more than **45 days** past its declared refresh interval,
the UI surfaces a red banner titled "Canary stale — treat hosting
with elevated caution" and links to the current canary document.

### 8.3 Limits — read carefully

A warrant canary is a **weak signal, not a guarantee**. Specific
limits:

- A canary can only signal conditions the operator is aware of.
  A compromise that the operator does not know about cannot be
  canary-signaled.
- In some jurisdictions, courts have the power to compel **false
  negative** assertions, i.e., to compel the operator to publish
  a fresh canary anyway. The canary is of no use against this
  class of order. Llámenos hosts in the European Union
  specifically to reduce this exposure.
- A canary that stops being updated is ambiguous: it might mean
  the operator has been gagged, or it might mean the operator
  got busy. Llámenos commits to publishing a "canary paused —
  reason unrelated" note in the public repo at least once per
  refresh cycle if the non-legal reason is applicable.
- An attacker who controls the operator can forge a canary
  refresh as long as they also control the release signing key
  and the WebAuthn credential. The canary is therefore only as
  strong as the key custody model for the release key. See
  `docs/security/KEY_REVOCATION_RUNBOOK.md`.

### 8.4 What to do on a canary stall

If the canary is stale for more than 45 days past its declared
refresh, the recommended response is:

1. Cross-check with the public Nostr relay mirror for any
   third-party verifier verdict changes.
2. Check if the third-party verifier jobs are still green.
3. Reach out to the security team via the non-Llámenos contact
   listed in `docs/security/SECURITY_TEAM.md` to confirm.
4. Pause note-taking on the instance until a human
   acknowledgement is received. Callers can still be received —
   note contents are the sensitive asset, and skipping note
   writes until the ambiguity is resolved is safer than
   continuing.

---

## 9. Audit history

| Date | Scope | Outcome |
|---|---|---|
| 2026-02 | External pentest, Tier 0 baseline (cosign, CSP L3, signed sigchain, SBOM, audit chain verifier). | Findings R1–R6 — all closed before Tier 0 merge. `TIER_0_REVIEW.md` + `TIER_0_POST_REVIEW.md`. |
| 2026-03 | Internal code audit, Tier 1 (HPKE + crypto-worker rewrite). | One high finding (H-1: label mismatch in hub rotation) — fixed in PR #41. `TIER_1_REVIEW.md`. |
| 2026-03 | Field encryption audit, Tier 1.B. | Clean. `TIER_2_REVIEW.md`. |
| 2026-03 | OPAQUE + key-store-v3 review. | One medium (M-2: PIN stretching parameter too low on mobile). Fixed before merge. |
| 2026-04 | AEAD audit (`docs/security/AEAD_AUDIT_2026-04-10.md`). | Clean. |
| 2026-04 | Tier 4 delivery hardening review (`TIER_4_REVIEW.md`). | Two mediums (M-1: split-origin cookie scope; M-3: iframe RPC schema strict mode). Both fixed in PR-A and PR-B respectively. |
| Scheduled | Tier 5 voice E2EE external pentest. | Planned — 2026-06. |
| Scheduled | Tier 6 MLS pilot external audit. | Planned — after MLS rollout reaches stage 3. |

Every review document is public and lives under `docs/security/`.
Any subsequent audit with public publication rights is added here
at release time.

---

## 10. Contact + reporting vulnerabilities

### 10.1 Reporting a security issue

Security issues should be reported to `security@llamenos.example`
with subject line `[SECURITY]`. We accept PGP-encrypted mail; the
current key is published at `https://llamenos.example/security.asc`
and fingerprinted on the security team page.

We commit to:

- Acknowledging within **48 hours**.
- Providing an initial severity triage within **5 business days**.
- Publishing a fix + post-mortem within **60 days** for
  high-severity issues, or a decision to treat the issue as
  accepted risk with public justification.
- Crediting the reporter by name (or pseudonym at their request)
  unless they prefer not.

We do **not** offer a monetary bug bounty. We do offer public
credit, an optional in-release acknowledgement, and — for
substantive findings — a donation to a volunteer-nominated
crisis-response charity.

### 10.2 Responsible disclosure

We ask reporters to:

- Not access, modify, or delete data that does not belong to them.
- Not target real users of any hosted Llámenos instance.
- Wait until a fix has shipped before public disclosure (we aim
  for within 60 days; longer by mutual agreement for complex
  issues).
- Test against the public `demo.llamenos.example` instance or
  against a self-hosted local build when possible.

### 10.3 Non-security contact

For press inquiries or general questions: `info@llamenos.example`.

---

## 11. Change log

### 1.1 — 2026-04-13

- Added §0.1 **"Current vs Target"** — the authoritative short-form
  comparison of what is shipped on `main` today vs what is still
  in-flight across the seven-tier security overhaul.
- **Corrected the notes and messages sections** (§4.1, §4.5, §1
  Property 3) to accurately describe the ECIES + XChaCha20-Poly1305
  multi-admin envelope family that is actually shipped today. The
  earlier wording claimed HPKE wrapping, which never landed for the
  notes/messages surface — HPKE is the hub-field envelope only. MLS
  groupwise encryption is the planned replacement for notes/messages
  under Tier 6 PR #2 and is marked **(target)** throughout.
- **Corrected §4.3** (Multi-factor KEK). The earlier wording claimed
  Argon2id (memory-hard) PIN stretching and separate recovery-key +
  WebAuthn split-share KEK wrapping. Reality on `main`:
  PBKDF2-SHA256 at 600,000 iterations over the PIN, with the IdP-
  bound value and (if available) the WebAuthn PRF output combined
  via HKDF-SHA256 into the final KEK. Argon2id, independent recovery
  key, and the split-share wrapping are all targets.
- **Fenced §5.2, §5.5, §5.6, §5.7** with explicit "shipped vs
  target" status. The sandboxed crypto iframe is scaffolded and
  wired (PR #108 fixed the opaque-origin postMessage round-trip)
  but no production call site routes through it — the Web Worker
  remains the real crypto home. The client-side binary verifier
  and gossip-version client exist but are not yet wired into SPA
  boot (Tier 4 P0; PR #111 in flight). §5.7's compositional
  guarantee reflects this partial coverage.
- **Fenced §8.2** (warrant canary signing). Ed25519 signing of
  `WARRANT_CANARY.md` is a target under PR #113; today the canary
  is plaintext Markdown protected only by the GPG-signed commit.
- Updated source-file references throughout to match the current
  tree: `src/client/lib/key-store.ts` (not `-v2.ts`),
  `src/shared/crypto-envelopes.ts` and `src/shared/crypto-primitives.ts`
  for notes/messages, `src/shared/hpke-primitives.ts` (not
  `src/shared/hpke.ts`).
- Added change log entries below for Tier 5 (voice E2EE) shipping
  partial wiring under PR #110 — wiring for the Vonage and Plivo
  adapters is still outstanding and tracked as Tier 5 P0.

### 1.0 — 2026-04-11

- Initial public publication.
- Covers Tier 0 (Albrecht hardening) + Tier 1.A (HPKE + crypto-worker
  rewrite) + Tier 4.A + 4.B + 4.C (delivery hardening) + partial
  Tier 2 (OPAQUE + KEKv3).
- Defers Tier 5 (voice E2EE) and Tier 6 (MLS) to a future edition
  of this document — those features are under active development
  and will be documented when they ship to stable.
- Warrant canary first issued alongside this publication.

### Planned: 1.2 — after Tier 2 P0 recovery-group work merges

- Shamir recovery group documentation (HPKE-wrapped shares, threshold
  recovery flow, `recovery-group-section.tsx` integration).
- Updated KEK factor list once the Recovery Group UX lands — root-
  KEK store (`root-kek-store.ts`) integration with identity bytes +
  hub `CryptoKey`.

### Planned: 1.3 — after Tier 5 P0 wiring finishes

- Voice E2EE via SFrame + `RTCRtpScriptTransform` on Twilio landed in
  Tier 5 PR #110; the Vonage and Plivo SDK pc-accessor TODOs must be
  closed before this section is promoted out of **(target)** status.
- DTLS fingerprint binding to Nostr-signed signaling.
- Fallback consent modal.

### Planned: 2.0 — after Tier 6 MLS reaches stage 3

- Full rewrite of §4.1 and §4.5 to describe the MLS-based envelope.
- Post-quantum ciphersuite.
- Retirement of the HPKE envelope for hub-field confidentiality is
  **not** planned — HPKE remains the right primitive for per-column
  field encryption. Only the note/message path moves to MLS.

---

*End of document. `docs/security/WHITEPAPER.md` is the canonical copy;
served copies must hash-match the release manifest they reference.*
