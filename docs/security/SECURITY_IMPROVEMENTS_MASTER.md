# Security Improvements — Master Document

**Date:** 2026-04-10
**Status:** Ideation / brainstorming capture
**Scope:** Comprehensive research of web-based E2EE prior art + synthesis of a target architecture for Llamenos that aims to be among the best-of-class.
**Sibling docs:**
- [`THREAT_MODEL.md`](./THREAT_MODEL.md) — existing adversary model
- [`../architecture/E2EE_ARCHITECTURE.md`](../architecture/E2EE_ARCHITECTURE.md) — current three-tier encryption design
- [`../protocol/llamenos-protocol.md`](../protocol/llamenos-protocol.md) — current cryptographic protocol spec
- [`SECURITY_AUDIT_2026-02-R6.md`](./SECURITY_AUDIT_2026-02-R6.md) — most recent internal audit
- [`../superpowers/specs/2026-04-10-*`](../superpowers/specs/) — individual design docs derived from this master

---

## 0. Purpose of This Document

Llamenos' current E2EE architecture is already structurally sound compared to most of the web E2EE ecosystem. But "structurally sound" is not "best in class". This document is the result of a deep research pass across nine mature web E2EE systems plus the modern browser crypto platform, and it proposes a concrete upgrade path that would place Llamenos in the top tier of publicly-deployable web E2EE apps.

It is a **brainstorming / ideation capture** — not a commitment to any specific change. Each workstream gets its own spec (see the index at the end) which is the real design artifact; those specs lead into plans which are the real implementation artifacts. This document is the glue that records *why* each spec exists and how they fit together.

---

## 1. Executive Summary

### 1.1. What we got right

Llamenos already does a surprising number of things most web E2EE apps do not:

- **Domain-separated crypto labels** (`src/shared/crypto-labels.ts`, 25 constants).
- **Per-note forward secrecy.** Each note/message/report/attachment gets a unique random key, ECIES-wrapped per reader. *Stronger* than 1Password, Bitwarden, Proton Drive, Matrix Megolm, and CryptPad on two load-bearing dimensions — cryptographic role enforcement and revocation without re-encrypting historical data.
- **Hub key rotation on member departure** — CryptPad, Proton Drive, Bitwarden, 1Password all explicitly punt on this.
- **Multi-factor KEK** (PIN + optional recovery key + optional WebAuthn blob) — strict superset of Matrix SSSS, Standard Notes, Bitwarden, 1Password.
- **Hash-chained audit log** with `previousEntryHash + entryHash` — already gives us the primitive for signed sigchain membership.
- **Reproducible builds + SLSA + content-hashed filenames + CHECKSUMS.txt + verify-build.sh.**
- **Hub key is random bytes, not password-derived** — avoids the Mega-class failure where cracking one password cracks the whole hub.
- **Crypto worker isolation.**
- **XChaCha20-Poly1305 AEAD everywhere** for content encryption.

### 1.2. Where we fall behind

**Gap 1 — Primitives are one generation behind the 2026 frontier.**
- Hand-rolled ECIES over `@noble/curves` secp256k1. HPKE (RFC 9180) is the formally-analyzed standard and our 25 labels map 1:1 to HPKE `info` strings.
- Identity key (`nsec`) lives as raw bytes in a Web Worker closure. Modern apps use non-extractable `CryptoKey` in IndexedDB — XSS becomes a live oracle rather than a smash-and-grab.
- PIN-derived KEK protects the at-rest identity key. WebAuthn PRF (1Password, Bitwarden 2026, Dashlane) provides hardware-rooted 32-byte entropy with no brute-forceable ciphertext on disk.

**Gap 2 — Multi-device is the Standard Notes anti-pattern.**
- Current: "one identity key per user, unlocked on each device via the same PIN". Single compromise = all devices forever.
- Target: Keybase's **per-device key + Per-User Key (PUK) + sigchain** model. Each device has its own keypair; the hub key is boxed per-device (not per-user); device linking is a signed sigchain entry verified by all hub members.

**Smaller gaps:**
- **Call E2EE** — don't have it. SFrame via `RTCRtpScriptTransform` (Jitsi approach) is the production-proven path through Asterisk B2BUA.
- **Delivery channel** — code + data served from same VPS. Splitting origins cuts the most plausible mass-SMCD attack.
- **Post-quantum** — Tuta shipped hybrid (X25519 + Kyber-1024) in March 2024. HNDL adversaries are real for crisis hotline data.

### 1.3. The high-leverage plays

Four changes, in order, would move Llamenos from "already-good" to "best-in-class":

1. **Tier 0 — Albrecht hardening.** Label enforcement at decrypt boundaries, AEAD audit, sign membership into audit sigchain before rewrap, strict CSP/Trusted Types/COOP/COEP. Days of work.
2. **Tier 1 — Primitive modernization.** HPKE, non-extractable `CryptoKey`, native WebCrypto X25519/Ed25519, Standard Notes `items_key` indirection. Weeks.
3. **Tier 3 — Per-device keys + sigchain + Recovery Group.** The Keybase pivot. Load-bearing architectural change.
4. **Tier 5 — SFrame voice E2EE + split delivery origin.** The differentiator.

Everything else (MLS, PQ hybrid, Tauri desktop, public audit) stacks on top.

---

## 2. Current Architecture Snapshot

### 2.1. Three encryption tiers

| Tier | Mechanism | Data | Key wrap |
|---|---|---|---|
| **1. Envelope PII** | Per-record random key + AEAD + ECIES per reader | User names, phones, contacts, invites, credentials | ECIES(secp256k1) per reader |
| **2. Hub-key** | Shared symmetric key + AEAD | Role names, shift names, report types, custom field labels, team names, tags | Hub key ECIES-wrapped per member, rotated on departure |
| **3. Per-artifact forward secrecy** | Unique random key per note + AEAD + ECIES per reader | Call notes, transcriptions, reports, attachments, messages | ECIES(secp256k1) per reader |

### 2.2. Key management

- **Identity key** (`nsec`) — secp256k1 Nostr-style keypair, encrypted under multi-factor KEK in IndexedDB (`key-store-v2.ts`).
- **Multi-factor KEK** — PIN (Argon2id) + optional recovery key + optional WebAuthn blob. Factor rotation without re-encrypting data.
- **Plaintext nsec** — crypto Web Worker closure only, zeroed on lock.
- **Session capsule** (PR #50) — worker-encrypted nsec capsule in IDB + sessionStorage. BroadcastChannel cross-tab sync.
- **Hub key** — random 32 bytes, ECIES-wrapped per member via `LABEL_HUB_KEY_WRAP`. Rotated on departure.
- **Device linking** — ephemeral ECDH provisioning rooms over Nostr relay.

### 2.3. Content encryption

- **AEAD:** XChaCha20-Poly1305 via `@noble/ciphers/chacha.js`.
- **Key wrap:** hand-rolled ECIES over secp256k1 + HKDF with `crypto-labels.ts` context.
- **Domain separation:** 25 labels in `src/shared/crypto-labels.ts`.
- **Signatures:** schnorr/Ed25519 via `@noble/curves` and WebAuthn.

### 2.4. Adjacent security primitives

Hash-chained audit log (Epic 77); reproducible Docker builds; SLSA provenance + CHECKSUMS.txt; `scripts/verify-build.sh`; crypto worker rate limiter; opaque server-side session tokens; offline GeoIP.

---

## 3. Research Summary — Nine Systems

Nine mature web E2EE systems were researched via primary sources. Each subsection is a compressed distillation; primary-source URLs are listed in §11.

### 3.1. CryptPad

**What it is:** Zero-knowledge collaborative document suite, ~10 years old.

**Key hierarchy:** `scrypt(password, username || salt)` → login keys → decrypt a server-stored blob containing long-term x25519/Ed25519 keypairs + a pointer to the user's "CryptDrive" (itself an encrypted collaborative document holding URL-seeds).

**Sharing model — capability URLs.** 18 random bytes → SHA-512 → split into Ed25519 signing seed (write capability) + symmetric key + channel ID. URL fragment (`#...`) never sent to server. **No per-recipient cryptographic operation** — "sharing" = "copy a URL". Unlimited readers/editors cost zero crypto work but access is a bearer token, not identity-bound.

**Access levels:**
- **Read** enforced cryptographically (no key → opaque ciphertext).
- **Write** enforced server-side via Ed25519 signatures on each patch against `PK` in channel metadata.
- **Owner** server-enforced via signed long-term-key requests.

**Revocation:** **None without re-keying.** Explicit blog statement: "granted shared accesses are not revokable".

**Teams:** Team has its own derived keyset with four roles. **No group key wrapped per member.** Former members retain decryption capabilities — no automatic rotation.

**Browser key storage:** Long-term keys in server-stored encrypted drive document, scrypt-decrypted per session. Keys in memory only.

**Acknowledged weaknesses:**
1. Honest-but-curious server only.
2. No cryptographic revocation.
3. Former team members keep keys.
4. URL as bearer token.
5. No forward secrecy at document level.

**Takeaways:**
- Our hub key rotation is **stronger** than CryptPad's team model. Preserve.
- Our per-note FS is **stronger** than CryptPad's static per-document key. Preserve.
- Do NOT adopt capability URLs — hotline threat model demands revocation.
- **Worth stealing:** sandboxed-iframe crypto core pattern, vendored dependencies, detailed published security docs.
- **Worth stealing:** scrypt-derived login-blob-containing-pointers pattern as a multi-device recovery primitive.

### 3.2. Proton Drive

**What it is:** ~100M users, all OpenPGP Curve25519, browser client (ProtonMail/WebClients monorepo).

**Key hierarchy:**
1. Login password → **SRP-6a** for auth; never sent to server.
2. Login password → **bcrypt** (72-char truncation) → mailbox password.
3. User Key (OpenPGP) locked with mailbox-derived passphrase.
4. Address Keys per email, OpenPGP, passphrases wrapped by User Key.
5. Share Key (per share root), passphrase = random 32 bytes encrypted to address/parent node key.
6. Node Key per file/folder, passphrase encrypted to parent's node key.
7. Content Key Packet per file: random session key, ECIES-wrapped via node key.
8. File blocks (≤4 MB) encrypted with content session key.

**Sharing with another Proton user:** `CryptoProxy.encryptSessionKey({sessionKey, encryptionKeys: invitee.publicKey})` — rewraps the share passphrase's **session key** as a new OpenPGP PKESK packet to invitee's address pubkey. **Existing ciphertext untouched.** O(1) per member. Signatures use critical contexts like `DRIVE_SIGNATURE_CONTEXT.SHARE_MEMBER_INVITER` to prevent cross-protocol forgery.

**Public share URLs:** URL token + 12-char random password (OpenPGP SKESK wrap). Password appended to URL **fragment** (never sent to server).

**Permissions:** Plain integer bitflags (VIEWER=4, EDITOR=4|2, ADMIN=4|2|16). **Purely server-enforced.** A viewer holds the same node keys as an editor.

**Revocation:** **No re-key on folder tree.** Remove member → delete their key packet row. Cached keys/ciphertext remain valid forever.

**Browser key storage:** Unlocked `PrivateKeyReference` opaque handles held by a **CryptoProxy worker** (separate thread). Raw key material never crosses to main thread. Persistent disk = encrypted armored keys only.

**Acknowledged trade-offs:** no cryptographic revocation; server-enforced permissions; bcrypt truncation; TOFU on recipient pubkeys (Key Transparency deploying); metadata leakage; OpenPGP is the universal primitive.

**Takeaways:**
- Our per-note FS **stronger** than Proton (they reuse node keys for a file's lifetime).
- Our hub key rotation **stronger** than Proton (they punt entirely).
- Our multi-factor KEK **stronger** than Proton's single-factor bcrypt.
- **Worth adopting:** critical signature contexts = our crypto-labels pattern. Enforce at every signature call site.
- **Worth adopting:** session-key rewrap pattern for O(1) resharing — once on HPKE, sharing with a new reader is `HPKE.rewrap(sessionKey, newReaderPubkey)` with no payload touch.
- **Worth adopting:** URL-fragment-password pattern for any anonymous-access links.
- **Worth considering:** per-node asymmetric key model if we ever want "share this subset of the hub's notes with an outside reviewer".

### 3.3. Matrix (Olm + Megolm) via Element Web

**What it is:** IETF-adjacent open-standard E2EE, most-audited web group-crypto in production.

**Olm (1:1) — Double Ratchet variant:**
- **3DH** initial key agreement (not X3DH). Concatenated shared secret → HKDF-SHA-256 → root + chain keys.
- AES-256-CBC with PKCS#7 + HMAC-SHA-256 **truncated to 64 bits** (NCC 2016 flagged as weak).
- No signed prekey, custom varint framing.

**Megolm (group) — sender-key hash ratchet:**
- 32-byte ratchet split into four 8-byte parts R₀..R₃, each reseeded on different cadences (1, 256, 65k, 16M ticks). O(log n) fast-forward to any index.
- Each ciphertext Ed25519-signed by a per-session signing key.
- **Key distribution:** sender ships `(session_id, ratchet_state, ed25519_pubkey)` to every recipient device over Olm 1:1 `m.room_key` to-device events. **O(N) at rotation, O(1) per message.**
- **Forward secrecy** only within ratchet. Recipients cache ratchet at lowest-needed index → exfiltrating state exposes everything from that index forward.
- **Post-compromise security** essentially zero — no per-message DH.
- **Rotation:** default 1 week / 100 msgs. matrix-js-sdk force-rotates on any membership change (join, leave, kick, ban, new device).
- **Old session keys NOT revoked** from departed members.

**Cross-signing:** Three Ed25519 keypairs — master (root of trust), self-signing (signs your devices), user-signing (signs other users' master keys). TOFU on first verification, transitive thereafter.

**Secret Storage (SSSS):** Encrypted account data on homeserver, single default key (4S recovery key OR PBKDF2-SHA-512 passphrase ≥500k iterations). `m.secret_storage.v1.aes-hmac-sha2` = AES-256-CTR + HMAC-SHA-256.

**Element Web's at-rest wrap:** Modern Element uses a short-lived IDB-persisted AES-256-GCM wrap key (terminology: "crypto-store wrap key") held in the matrix-rust-sdk CryptoStore, itself protected by a browser-stored random key in localStorage for web. Trust boundary effectively same as our session capsule.

**Key Backup (Megolm history):** `m.megolm_backup.v1.curve25519-aes-sha2`. Backup Curve25519 keypair; private key stored as a secret inside SSSS; public key published. Each inbound Megolm session ECIES-wrapped to backup pubkey and uploaded.

**Power levels are NOT cryptographic.** Acknowledged openly — server-enforced state events.

**Audits:**
- **NCC Group, Nov 2016** (libolm v1.3.0): unknown-key-share in Olm pre-keys (fixed); HMAC truncation to 64 bits; C hygiene.
- **Cure53, May 2022** (vodozemac Rust rewrite): positive, medium findings on zeroization + constant-time fixed.

**The Albrecht et al. 2022/2023 attacks** — "Practically-exploitable Cryptographic Vulnerabilities in Matrix" (IEEE S&P 2023). Five attacks, **all against matrix-js-sdk + Element Web**:

1. **Homeserver-controlled membership injection** — server silently adds attacker device; sending client rotates Megolm and encrypts to attacker. Blind trust of server's device-list responses. **Partially fixed**, structurally unfixed.
2. **SAS identifier confusion (CVE-2022-39250)** — device IDs and cross-signing pubkeys in the same namespace. Malicious server made Alice sign attacker's master key. Fixed with strict domain separation.
3. **Olm/Megolm type confusion (CVE-2022-39251, -39255, -39248)** — matrix-js-sdk accepted `m.room_key` to-device messages **encrypted with Megolm instead of Olm**. Megolm has no per-sender auth, so forged sessions were treated as fully authenticated. Fixed by strictly requiring Olm for to-device key material.
4. **Forwarded-key spoofing** — `forwarding_curve25519_key_chain` not cryptographically verified. Any device could claim to forward on behalf of anyone.
5. **IND-CCA break in key backup** — MAC didn't cover IV in AES-CBC wrapping. Fixed by including IV in HMAC.

Matrix's response: patched SDKs, accelerated vodozemac + matrix-rust-sdk adoption, began MSC1834 (MLS in Matrix).

**Takeaways (critical):**
- Our hub-key + ECIES-wrap-per-member is **structurally Megolm-Sender-Keys**. We inherit its attack surface.
- **Albrecht #3 — strict label domain separation at every decrypt call site.** Our `LABEL_*` constants must be *enforced* at decrypt, not just set at encrypt.
- **Albrecht #1 — don't trust server-asserted membership.** Admin must sign membership changes into the audit-log chain *before* the rewrap runs.
- **Albrecht #5 — backup integrity must cover IV + framing.** Use AEAD end-to-end for exports.
- **Don't regress on power levels.** Our roles must be enforced via explicit per-key envelopes, not server-asserted claims.
- **Cross-signing worth stealing** for device-linking (replaces ephemeral ECDH provisioning rooms).
- Our multi-factor KEK is a strict superset of SSSS.

### 3.4. Bitwarden + 1Password (team vaults)

#### 3.4.1. Bitwarden

**Key hierarchy:** `PBKDF2-HMAC-SHA256(password, email)` @ 600k iters (or Argon2id) → Master Key → HKDF-Expand → 512-bit Stretched Master Key → wraps a 512-bit User Symmetric Key. Auth uses a *separate* `PBKDF2(MasterKey, password)` hash, re-hashed server-side with 600k more iters. Per-item 64-byte Cipher Key wrapped by User (or Org) Symmetric Key.

**Organization key:** 512-bit Org Symmetric Key. Each user has RSA-2048 keypair (private wrapped under User Symmetric Key). Org key RSA-OAEP-wrapped per member → one Protected Org Symmetric Key per member.

**Collections + Groups:** **Server-side only.** Single Org Symmetric Key; read/write/manage are API-enforced only.

**Invitation:** Two-phase — invite → invitee uploads pubkey → admin Confirms and wraps Org key. TOFU fingerprint phrase.

**Revocation:** No automatic rotation. Manual "Rotate account encryption key" exists.

**Web vault session:** Decrypted keys in JS memory only. Hard refresh = locked. Cross-tab via BroadcastChannel.

**Audits:** Cure53 2023 (2 findings, 1 fixed). **Cure53/Insight Risk 2024: high-impact finding that browsers retained master password + vault keys in process memory after lock/timeout** (JS GC artifact). Mitigated with more aggressive zeroization but JS cannot guarantee this.

#### 3.4.2. 1Password

**2SKD chain:** password → NFKD → PBKDF2-HMAC-SHA256 @ 650k iters, salt = HKDF(16-byte account salt, email). In parallel: **128-bit Secret Key** expanded via HKDF. **AUK = PBKDF2-output XOR SecretKey-expanded** → 256-bit JWK. Separate derivation for SRP-x.

**SRP-6a, 4096-bit safe prime.** Client-side x computation. Login yields mutually-authenticated shared session key used for an **additional transport encryption layer inside TLS**.

**Shared vaults:** AES-256-GCM vault key. RSA-OAEP wrap per member. Groups implemented as synthetic users with their own RSA keypair.

**Recovery Group (Business) — ★ the innovation:**
- At vault creation, the vault key is **additionally wrapped under the Recovery Group's public key**.
- Carol forgets password → Bob (recovery group member) signals → server suspends Carol, emails reset link → Carol runs signup flow → server hands Bob `pk_C` + recovery-group-wrapped vault key → Bob decrypts with recovery group private key (unwrapped via his AUK → group private key chain), re-wraps under `pk_C`, posts back. **Server orchestrates but never sees plaintext.**

**Web client session:** Decrypted keys in memory + Session Encryption Key re-wraps in-memory keyset into sessionStorage for reload-within-tab. Threat model explicitly accepts XSS on 1password.com as game-over.

**Audits:** Cure53 Core 2021, Mobile 2022, NCC B5 + SCIM. Notable: **rotating Secret Key after RSA compromise does not fully heal the account** — historical vault-key wrappings under old RSA pubkey remain valid.

#### 3.4.3. Takeaways

| Dimension | BW | 1P | **Llamenos (current)** |
|---|---|---|---|
| Cryptographic role enforcement | ❌ | ❌ | ✅ **per-reader envelope** |
| Revocation w/o re-encryption | ❌ | ❌ | ✅ **rotate-on-leave, forward-only** |
| Admin-assisted recovery w/o server trust | ⚠️ ent only | ✅ **Recovery Group** | ⚠️ recovery key factor |
| Multi-factor KEK | ❌ | ⚠️ pw+SK | ✅ **PIN+recovery+WebAuthn** |

- Our per-note + ECIES-per-reader is **stronger than both.** Keep.
- **Steal: 1Password Recovery Group.** Pre-wrap each volunteer's device key under a synthetic "recovery group" pubkey at onboarding; 2-of-3 Shamir the group's private key across admins.
- **Steal: 2SKD pattern** (password XOR Secret Key) as a PIN-strengthener if we keep a PIN factor.
- **Steal: transport-crypto layer inside TLS** (OPAQUE gives us this).
- **Do NOT regress** to password-only or single-factor.
- **JS GC memory retention is a known cross-ecosystem weakness.** Non-extractable CryptoKey is the structural fix.

### 3.5. Signal + Wire

#### 3.5.1. Signal

**X3DH + Double Ratchet.** Symmetric KDF chain (FS per-message) + DH ratchet (PCS). Rev 4 (2025-11-04) adds **Sparse Post-Quantum Ratchet** and **Triple Ratchet** combining PQXDH + classical DH.

**Sender Keys (groups):** Each member generates chain key + signing key, distributes over pairwise Double Ratchet, broadcasts single ciphertext.

**Sealed Sender:** Short-lived sender certificate inside ciphertext. Server learns recipient but not sender.

**Sesame multi-device:** **No master key shared across devices.** Each device has own identity keypair + prekey bundle. Linking desktop: QR-coded ephemeral keypair + provisioning message with copy of account identity key. After that, N separate X3DH sessions per sender-device × recipient-device pair.

**Signal Desktop storage:** Electron + SQLCipher (AES-256 CBC), key in OS keystore via `safeStorage`.

**Signal voice (1:1):** WebRTC DTLS-SRTP. **DTLS fingerprints exchanged inside Double-Ratchet-encrypted signaling over Signal service.** TURN relays see only SRTP ciphertext; content E2EE to peer.

**Audits:** NCC 2016 (Cohn-Gordon formal analysis EuroS&P 2017), Trail of Bits 2022 (libsignal Rust), Quarkslab 2023 (PQXDH).

#### 3.5.2. Wire

**Proteus:** Rust re-implementation of Double Ratchet without header encryption, compiled to WASM (`proteus-wasm`).

**Multi-device pain:** One session per device pair = N×M fanout. Triggered MLS migration.

**MLS adoption (2022):** Wire was the **first commercial messenger to ship MLS.** TreeKEM gives O(log n) group operations. Add/Remove/Update as Proposals → Commit → new epoch. Epoch secret → key schedule with `encryption_secret`, `exporter_secret`, etc.

**Wire voice E2EE — the reference production deployment:**
- Self-hosted SFU + **SFrame** layered above DTLS-SRTP.
- **SFrame base key derived from MLS `exporter_secret`** via `MLS-Exporter(label, context, length)` — the `draft-ietf-mls-sframe` pattern.
- Membership change → new MLS epoch → new exporter → new SFrame key.

**Browser key storage:** `core-crypto` (Rust MLS WASM). MLS state in IndexedDB encrypted under passphrase-derived key.

**Audits:** Kudelski 2018, X41 D-Sec 2017, Cryspen on `core-crypto`, Alwen et al. CRYPTO 2020 formal MLS analysis.

#### 3.5.3. MLS (RFC 9420)

July 2023. TreeKEM binary tree of HPKE keypairs. O(log n) Commits. Epoch secret → key schedule. Adopted by Wire, Cisco Webex, Discord DAVE, Matrix (planned), Google RCS.

#### 3.5.4. Voice call E2EE state of the art

**The layering problem:** In any SFU topology, DTLS-SRTP is **hop-by-hop** to SFU. SFU *must* decrypt SRTP for header rewriting, simulcast selection. TURN relays are different (pure forwarders never terminating DTLS).

**For Llamenos:** 1:1 volunteer↔caller over Twilio or JsSIP — *if* media is peer-to-peer or TURN-relayed, DTLS-SRTP + fingerprint verification over hub-key-authenticated signaling gives E2EE. Problem begins if Asterisk is a media-terminating B2BUA (usually is) or if conferences are introduced.

**SFrame (`draft-ietf-sframe-enc`):** AEAD layer above RTP/SRTP encrypting the media payload with AES-128-GCM, AES-256-GCM, or AES-CTR+HMAC-SHA256 (80/64/32-bit tag variants). SFrame header (Key ID + frame counter) cleartext-but-authenticated. Key management explicitly out of scope — options:
1. **Sender Keys:** each participant generates own SFrame key, distributes via pre-existing secure channel, ratchet.
2. **MLS-based:** derive SFrame base key from MLS `exporter_secret`.

**Production deployments:** Google Meet/Duo, Jitsi Meet, Cisco Webex Zero-Trust, Wire, Discord DAVE.

**Browser enabler:** **WebRTC Encoded Transforms** (`RTCRtpScriptTransform`). Chrome ~2021, Firefox ~2023, Safari limited.

**Llamenos realistic path:**
- **Phase 1 (1:1 TURN-relayed):** Configure Asterisk for media passthrough. DTLS fingerprints authenticated through hub-key-encrypted Nostr signaling. Signal model adapted.
- **Phase 2 (B2BUA / conference / supervisor-listen):** SFrame via `RTCRtpScriptTransform`. Per-call random key HPKE-wrapped per participant device.
- **Asterisk gotcha:** SFrame works unchanged because Asterisk only touches RTP headers.
- **Do NOT attempt** to replace DTLS-SRTP with Signal ratchets. SFrame-on-top is the only portable escape.

**Takeaways:**
- Voice E2EE via SFrame is now a production-proven blueprint.
- Wire's MLS-exporter-keyed SFrame is the reference implementation.
- MLS via Wire `core-crypto` is realistic for hub state in 6–12 months. HPKE is the pre-requisite.

### 3.6. Standard Notes

**Key derivation split:** Password + salt → Argon2id → 512-bit output split: first half = Master Key (device-only), second half = Server Password. Server stores hash of Server Password only.

**Item encryption (004):** Per-item random content key, each item XChaCha20-Poly1305 with AAD binding `item UUID + "004" + key params`. **004 introduced the `items_key`:** per-user symmetric key encrypted under Master Key, wraps individual item keys.

**003 → 004 changes:** PBKDF2+AES-CBC-HMAC → Argon2id + XChaCha20-Poly1305. **`items_key` indirection lets future primitive upgrades avoid re-encrypting every item.** ★

**Multi-device weakness:** Password re-derivation only. **Single password compromise = total account compromise across all devices forever.** No per-device keys, no sigchain. **We must not copy this.**

**Audit:** Cure53 multi-week. Findings resolved. Published with 004.

**Takeaways:**
- **Steal the `items_key` indirection.** Wrap per-note keys under a user-scoped `items_key` wrapped under device keys. Future ECIES → ML-KEM migration re-wraps *one* `items_key` per user, not every note. Zero-downtime primitive upgrades.
- **Do NOT copy multi-device model.**

### 3.7. Jitsi Meet E2EE

**Threat model:** DTLS-SRTP hop-by-hop to Jitsi Videobridge SFU. Same as Asterisk B2BUA problem.

**Insertable Streams mechanism:**
- `RTCRtpSender.createEncodedStreams()` / `RTCRtpScriptTransform` exposes post-encode pre-packetize media frames to JS.
- Jitsi encrypts payload with **AES-GCM-128** via WebCrypto in dedicated Web Worker (`E2EEworker`).
- **VP8 headers (3/10 bytes) + Opus TOC left plaintext** for SFU routing.

**JFrame format:** SFrame with trailer (not header): 12-byte IV + 16-byte GCM tag + key ID + reserved. 96-bit IV = `SSRC || RTP timestamp || frame counter` (unique per key).

**Key distribution:**
- Originally: passphrase-based shared secret (demo kludge).
- **Moved to libolm in 2021.** Pairwise Olm sessions over XMPP signaling; each participant generates random media key, broadcasts via Olm. Media key never transits SFU in plaintext.

**Rotation:**
- **Leave:** all remaining participants generate new random media key, redistribute.
- **Join:** existing participants HKDF-ratchet forward. Forward secrecy against new members.

**Limitations acknowledged:**
- E2EE covers audio/video/screen-share only — chat/polls NOT E2EE.
- SFU sees metadata (who's speaking, bitrates, timing).
- Recording breaks E2EE.
- No identity auth of media key sender.

**Audits:** No public cryptographic audit by 8x8/Jitsi — community review only.

**Takeaways (critical for our voice E2EE):**
- **This is the concrete blueprint.** All pieces validated in production.
- `RTCRtpScriptTransform` in dedicated Web Worker.
- AES-GCM-128. VP8 + Opus headers plaintext.
- Key distribution via pairwise libolm is **exactly our hub-key model** — we can distribute per-call keys via existing ECIES wrap. No new primitive required.
- New-key-on-leave + HKDF-ratchet-on-join.
- Chromium-first; Firefox works but test carefully.

### 3.8. Keybase — per-device keys + sigchain

**What it is:** Acquired + shut down by Zoom, but crypto is publicly documented + NCC-audited. Foundational for per-device-key + tamper-evident-identity-log design.

**Per-device keys + Per-User Key (PUK) — ★ the innovation:**
- **No password-derived master key.** Each device generates Ed25519 + Curve25519 keypair at enrollment; private keys never leave the device.
- **PUK** = 32-byte random seed, HMAC-SHA256-derived into three keys (EdDSA, Curve25519 DH, NaCl SecretBox).
- **PUK seed NaCl-boxed individually to each device's pubkey.**
- Adding a device = existing device boxes PUK to new device's pubkey. Instant.
- **Paper keys are device keys rendered as BIP39 wordlists** — cryptographically identical to a device.

**Sigchain:** Append-only hash-chained log signed by device keys. Entries: `device_add`, `device_revoke`, `puk_rotate_gen_N`. Clients verify from TOFU. **Tamper-evident identity log.**

**Teams + Per-Team Key (PTK):**
- Random seed per generation → team signing key + DH key + SecretBox key.
- Roles: owner > admin > writer > reader.
- **Read enforced cryptographically** (server withholds app-key masks from non-readers).
- **Write enforced via signed sigchain entries.**
- Team has its own sigchain.

**PTK distribution + Cascading Lazy Key Rotation — ★ the other innovation:**
- Current team seed NaCl-boxed to each member's PUK DH key.
- On removal/reset/device-revoke:
  1. Generate new PTK generation.
  2. Seed re-boxed to remaining members' PUKs.
  3. Previous generation's seed encrypted under new generation's SecretBox key (current members can still decrypt historical content).
  4. New public halves signed into team sigchain.
- **"Lazy"** because app-key derivation happens on read, not rotation time.
- **"Cascading"** because subteams inheriting the parent team's membership also rotate.

**NCC Group audit (Feb 2019):**
- LKS 6-char minimum flagged.
- Default chat lacks forward secrecy.
- Phantom user injection risk mitigated by client-side sigchain verification.
- Praised sigchain-based team membership as guarding against ghost users.

**Takeaways — the single most important research finding:**
- **Adopt the per-device-key model.** Each Llamenos device has its own X25519 + Ed25519 keypair generated at onboarding.
- **Adopt the PUK pattern.** User's "master secret" is a 32-byte random PUK, NaCl/HPKE-boxed per-device.
- **Adopt paper-keys-as-devices.** Diceware-phrase-rendered device, cryptographically identical.
- **Adopt user sigchain.** Our hash-chained audit log already gives the primitive — extend with signed typed entries.
- **Adopt Cascading Lazy Key Rotation.** Formalize our hub key rotation. Cascade across hub-membership graph.
- **Adopt sigchain-based membership as Albrecht #1 defense.**

### 3.9. Modern browser crypto primitives (2026)

#### 3.9.1. Non-extractable `CryptoKey` in IndexedDB

**The single biggest improvement available.** A `CryptoKey` with `extractable: false` is a **handle, not bytes**. `subtle.exportKey()` throws. Raw key material never enters JS heap. Lives in the browser's crypto sandbox (out-of-process on Chromium/Safari).

`CryptoKey` is structured-cloneable: `indexedDB.put(cryptoKey, 'identity')` works. On reload, `get()` returns the same non-extractable handle. **No capsule, no re-derivation.**

**Attack surface change:** XSS can still *use* the key via exposed helpers but cannot exfiltrate. Forces an attacker to maintain persistent access and proxy operations vs. smash-and-grab.

**Algorithm set (early 2026):**
- Symmetric: AES-GCM, AES-KW, AES-CTR, HMAC, HKDF
- Asymmetric: ECDH/ECDSA on P-256/384/521, RSA-OAEP, RSA-PSS
- **X25519: Chrome 133 (Feb 2025), Firefox 135, Safari 17.4+** ★
- **Ed25519: Chrome 137 (May 2025)** ★
- **Not native:** XChaCha20-Poly1305, secp256k1, Argon2id — stay in `@noble/*`

**Best-in-class users:** Element Web's Rust crypto stack (the at-rest wrap key pattern), Turnkey verifiable sessions, Proton Mail.

#### 3.9.2. WebAuthn PRF extension

**The passwordless KEK.** CTAP2 `hmac-secret`. Authenticator holds per-credential 32-byte seed; you send salt, get back `HMAC(seed, salt)`. Seed hardware-rooted.

**Shipping (early 2026):**
- Chrome/Edge: stable since 116 for platform auth; PRF-on-create Chrome 147.
- Safari 18 / iOS 18 / macOS 15: iCloud Keychain passkeys; broken for YubiKeys in Safari.
- Firefox 139+ platform; 148 for Windows Hello PRF-on-create.

**Pattern:**
1. Register: `navigator.credentials.create({extensions:{prf:{eval:{first:salt1}}}})`.
2. Unlock: `get({extensions:{prf:{eval:{first:salt1}}}})` → 32 bytes.
3. HKDF → non-extractable AES-KW → unwrap device key bootstrap envelope.

**Who uses it:** 1Password, Dashlane, Bitwarden 2026.1.

**Limitation:** Per-credential. **Must register ≥2 credentials** at onboarding.

#### 3.9.3. HPKE (RFC 9180)

**Standard replacing hand-rolled ECIES.** Four modes (base, psk, auth, authpsk). Primitives: X25519 or P-256/384/521 KEM + HKDF + AES-GCM or ChaCha20-Poly1305.

**Browser implementations:**
- `@hpke/core` + `@hpke/dhkem-x25519` + `@hpke/chacha20poly1305`. Built on WebCrypto where possible (P-256 KEMs + AES-GCM native → can use non-extractable recipient keys).
- `panva/hpke` — slimmer, cross-runtime.

**Used in:** TLS ECH, Oblivious HTTP (RFC 9458), MLS KeyPackages, PPM.

**For Llamenos:** `ECIES(recipient_pubkey, label, plaintext)` → `suite.createSenderContext({recipientPublicKey, info: label}).seal(aad, plaintext)`. **25 `LABEL_*` constants map 1:1 to HPKE `info` strings.**

#### 3.9.4. OPAQUE (RFC 9807)

**Removes password from the wire.** Published mid-2025. Client proves password knowledge via blind OPRF; server holds opaque envelope only the correct password unlocks. Both sides derive matching session keys PLUS client gets stable `export_key`.

**The `export_key` is the killer feature:** deterministic high-entropy symmetric secret server never sees. Unlock local vault with it — "password" has hardware-grade entropy against offline attackers.

**Mature implementations:** `@serenity-kit/opaque` (WASM of `facebook/opaque-ke`, OTF Red Team Lab audited); `bytemare/opaque` (Go); Meta's production deployment.

**Trade-off:** Extra round trip.

#### 3.9.5. MLS in browser

- `openmls/openmls` Rust → WASM.
- **Wire ships `core-crypto` in production** — reference browser MLS deployment.
- Matrix prototyping.

**Hard problem MLS doesn't solve:** Local key storage. Implementer's problem.

**Practical:** MLS realistic for hubs in 6–12 months. **HPKE is the pre-requisite.**

#### 3.9.6. Storage patterns

| Mechanism | Persistence | XSS-resistant | Notes |
|---|---|---|---|
| **IDB + non-extractable CryptoKey** | ✅ | Partial | **Modern best practice.** |
| IDB + encrypted blob (current) | ✅ | ❌ | KEK exposable once unlocked. |
| sessionStorage | Tab lifetime | ❌ | Do not use for keys. |
| BroadcastChannel | Ephemeral | Same-origin | OK for unlock-state signaling. |
| OPFS | ✅ | Same as IDB | 3–4× faster; big blobs not small keys. |
| DBSC | ✅ hardware-backed | ✅ | No app API — cookie-binding only. |
| Service Worker key holder | ✅ | ❌ | Not a boundary. |

#### 3.9.7. Anti-patterns to ban

- `localStorage` for any secret.
- Raw key bytes in JS globals.
- Keys in cookies.
- **PIN-only KEKs with no hardware mix** — Argon2id over 4–6 digit PIN is ~14–20 bits of real entropy. Crackable in hours on one GPU from a leaked blob. **Current Llamenos weakness.**

### 3.10. Tuta (post-quantum hybrid)

**Key hierarchy:** `password → Argon2id → userPassphraseKey (AES-256) → wraps user's asymmetric keypair → wraps mailbox sessionKeys`.

**Argon2id migration (2023):** `m=64 MiB, t=3, p=4` (OWASP 2026 floor).

**TutaCrypt (March 2024) — PQ hybrid:**
- Two keypairs per user: **X25519 + Kyber-1024** (now ML-KEM-1024).
- Three shared secrets → HKDF-SHA-256:
  - `DHI` = ECDH(sender identity, recipient identity)
  - `DHE` = ECDH(sender ephemeral, recipient identity)
  - `SSPQ` = Kyber KEM shared secret
- HKDF output → AES-256-CBC + HMAC-SHA-256 (encrypt-then-MAC for nonce-reuse robustness).
- **Secure as long as either X25519 OR Kyber-1024 survives.** HNDL defense.
- No forward secrecy. No PQ path authentication until August 2025 "key verification" feature.

**Takeaways:**
- **Steal the X25519+Kyber hybrid with HKDF-combined secrets.** Slot ML-KEM-1024 alongside existing chain, HKDF-combine, no envelope format change.
- **Plan fingerprint/verification UX BEFORE shipping PQ** (Tuta lesson).

### 3.11. Mega.nz (cautionary tale)

**Study the FAILURES.** Every failure traces to missing AEAD, missing domain separation, or master-key reuse.

**Scheme:** `password → PBKDF2 → auth key + master key → AES-ECB(master)` wraps RSA key, Ed25519 key, Curve25519 key, per-node file keys. Master key encrypted under password-derived key stored in **`localStorage`**.

**Backendal, Haller, Paterson — "MEGA: Malleable Encryption Goes Awry" (IACR 2022/959):**

1. **RSA key recovery (originally 512 → later 6 login attempts).** Encrypted RSA private key is ECB under master key with NO MAC. Malicious server tampers with block; session-ID exchange leaks whether guessed prime factor is above/below real one. Binary search + lattice recovers primes. **Root cause: no AEAD on at-rest key blobs.**
2. **Plaintext recovery** via same login oracle, decrypts arbitrary master-key ciphertexts. **Root cause: ECB + master-key reuse.**
3. **Framing attack.** No integrity on wrapped file keys. **Root cause: integrity absent.**
4. **GaP-Bleichenbacher on session ID.** Custom RSA padding as Bleichenbacher oracle.
5. **Integrity/all-zero-key attack.** ECB malleability + public share links' known plaintext.

**Albrecht & Paterson — "Caveat Implementor!" (EUROCRYPT 2023):** Mega refused AEAD. Sanity checks themselves became an oracle.

**Moral: incomplete patches preserving the broken primitive create new oracles.**

**Mandatory defenses (audit against):**
1. Every ciphertext column AEAD. **No exceptions.**
2. Every KDF/HKDF call consumes a label. Grep raw string literals in crypto paths.
3. Identity key only wraps other keys, never data.
4. Shareable envelopes use different key hierarchy than identity.
5. AEAD tag is the integrity mechanism.
6. ECB is poison. Weak PBKDF2 is poison.

### 3.12. Other systems — shorter notes

- **Skiff** (shut down 2024): per-document key wrapped per collaborator (same shape as ours). Trail of Bits audit **never publicly released**. **Lesson: publish audits or they don't count.** Lesson: vendor longevity for E2EE SaaS is fragile — argues for our self-hosted deployment being first-class.
- **Whiteout Mail** (abandoned): browser OpenPGP. PGP's lack of AEAD (until RFC 9580, 2024) made it a bad target for web E2EE.
- **Mailvelope / FlowCrypt:** WebExtensions — storage not bound to single-origin document lifecycle. Our closest analogue is the crypto Web Worker.
- **Threema Web:** Phone is source of truth; browser is a render-only SaltyRTC terminal. **Lesson: "browser is just a renderer" for highest-threat users.**
- **Proton Mail:** Decrypted keys in `sessionStorage` not IDB. Cross-tab sync painful.
- **ProseMirror/Y.js E2EE collab:** No mature audited implementation. For admin+volunteer collab on notes, safest path is per-note rekey on every edit commit, not live CRDT sync.

---

## 4. Cross-System Comparison Matrix

| Dimension | CP | PD | Mx | BW | 1P | S/W | SN | Jt | KB | Tu | **LM cur** | **LM target** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Cryptographic role enforcement | R only | ❌ | ❌ | ❌ | ❌ | N/A | N/A | N/A | ✅ | ❌ | ✅ per-reader | ✅ per-device |
| Revocation w/o re-encrypt history | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | ✅ | N/A | ✅ | ✅ CLKR | N/A | ✅ rotate-leave | ✅ CLKR |
| Forward secrecy (per-artifact) | ❌ | ❌ | ⚠️ | N/A | N/A | ✅ | ⚠️ | ✅ | ⚠️ | ❌ | ✅ | ✅ |
| Post-compromise security | ❌ | ❌ | ❌ | N/A | N/A | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ MLS later |
| Multi-factor KEK | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ | N/A | ✅ | ❌ | ✅ | ✅ PRF+OPAQUE |
| Non-extractable key storage | ❌ | ⚠️ | ✅ | ❌ | ❌ | ⚠️ | ❌ | N/A | ⚠️ | ❌ | ❌ | ✅ |
| Multi-device (proper) | ❌ | ⚠️ | ✅ xs | ⚠️ | ⚠️ | ✅ Sesame | ❌ | N/A | ✅ **sig** | ⚠️ | ⚠️ | ✅ **sigchain** |
| Admin recovery w/o server trust | ❌ | ❌ | ❌ | ⚠️ | ✅ **RG** | ❌ | ❌ | N/A | ❌ | ❌ | ❌ | ✅ **RG+Shamir** |
| PQ hybrid | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | N/A | ❌ | ✅ | ❌ | ✅ |
| Call E2EE | N/A | N/A | ⚠️ 1:1 | N/A | N/A | ✅ | N/A | ✅ **IS** | N/A | N/A | ❌ | ✅ **SFrame** |
| Delivery channel integrity | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ | ❌ | ❌ | ⚠️ | ✅ | ✅ +verifier |
| Sandboxed crypto core | ✅ ifr | ⚠️ wk | ⚠️ wk | ❌ | ❌ | Elec | ❌ | ✅ wk | ❌ | ⚠️ | ⚠️ wk | ✅ ifr+wk |
| Publicly audited | ❌ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | ❌ internal | ✅ commissioned |
| Whitepaper published | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ consolidated |

Target state: checkmark in every row.

---

## 5. Key Insights

1. **Our per-note + ECIES-per-reader is a genuine strength.** Preserve it.
2. **Our hub-key is Megolm-Sender-Keys — audit for Albrecht attacks.**
3. **Our multi-device story is the Standard Notes anti-pattern — pivot to Keybase.**
4. **Browser primitives in 2026 solve problems we currently hand-roll.**
5. **Voice E2EE has a concrete production blueprint.**
6. **Trusting-trust on delivery is the residual risk — mitigate in depth, be transparent.**

---

## 6. Refined Target Architecture

Four layers, each independently evolvable.

### 6.1. Layer 1 — Device identity

Each device has its own non-extractable X25519 + Ed25519 `CryptoKey`s in IndexedDB. **No user-scoped "identity key" at all.** User-level secret is a **PUK** (32 random bytes), HPKE-wrapped per-device.

**KEK unlock** (priority order):
1. **WebAuthn PRF** on a platform passkey → HKDF → non-extractable AES-KW → unwrap device bootstrap envelope.
2. **OPAQUE** `export_key` → same path.
3. **Argon2id(recovery phrase)** — Diceware, never a 6-digit PIN.

Minimum credentials at onboarding: two.

**Cross-tab:** Web Locks API for unlock-ceremony serialization + BroadcastChannel for unlock/lock events + IDB session record as ground truth.

### 6.2. Layer 2 — User state (sigchain)

Per-user append-only hash-chained log signed by device keys:
- `device_add(new_device_pubkey, signed_by_existing)`
- `device_remove(device_id, signed_by_master)`
- `puk_rotate(new_gen_id)`
- `hub_membership_change(hub_id, user_id, role, action)`
- `recovery_group_enroll(shamir_share_commitments)`

Existing `audit-log` primitive extends here.

### 6.3. Layer 3 — Hub state

- **Hub symmetric key (PTK)** distributed via HPKE-wrap per *device*. Cascading Lazy Key Rotation on departure.
- **`items_key` indirection:** hub PTK wraps per-member `items_key` which wraps per-note content keys. Primitive upgrades re-wrap the `items_key`, not every note.
- **Sigchain verification before rewrap** (Albrecht #1 defense).

### 6.4. Layer 4 — Content

- **Notes/messages/reports/attachments:** per-artifact random key, HPKE-wrapped per reader device (or via `items_key`).
- **Messages (optional Phase 2):** migrate to MLS via Wire `core-crypto` for continuous PCS + large groups.
- **Calls:**
  - Phase 1 (1:1 TURN): DTLS-SRTP + fingerprint binding via hub-key-authenticated signaling.
  - Phase 2 (B2BUA/conference): SFrame via `RTCRtpScriptTransform`, per-call key HPKE-wrapped per participant.
  - Phase 3 (optional): MLS exporter_secret-keyed SFrame.

### 6.5. Crosscutting

- HPKE-base everywhere (labels → `info` strings)
- Non-extractable CryptoKey wherever WebCrypto covers the algorithm
- CSP L3 strict-dynamic + Trusted Types
- COOP + COEP + CORP origin isolation
- Split code-delivery origin from API origin
- Sandboxed crypto iframe on distinct origin (CryptPad pattern)
- Third-party bundle-hash verifier + Nostr gossip attestation
- PQ hybrid (ML-KEM-1024 + X25519 HKDF-combine, Tuta pattern)
- Public security whitepaper + commissioned audit
- Optional signed WebExtension verifier
- Optional Tauri desktop build

---

## 7. Sequenced Roadmap

| Tier | Spec | Scope | Effort |
|---|---|---|---|
| **0** | Albrecht Hardening | Label enforcement, AEAD audit, signed sigchain membership, CSP L3, Trusted Types, COOP/COEP, cosign/SLSA/SBOM | Days |
| **1** | HPKE + Primitives | HPKE migration, non-extractable CryptoKey, native X25519/Ed25519, items_key indirection | Weeks |
| **2** | Unlock & Recovery | WebAuthn PRF primary, OPAQUE, Diceware recovery phrase, 1Password Recovery Group (2-of-3 Shamir) | Weeks |
| **3** | Per-Device Keys | Keybase per-device keys, PUK, user sigchain, Cascading Lazy Key Rotation, cross-signing device trust | ~1 month |
| **4** | Delivery Hardening | Split code/data origins, sandboxed crypto iframe, third-party verifier, Nostr gossip attestation, whitepaper | Weeks (parallel to 3) |
| **5** | Voice E2EE | SFrame via RTCRtpScriptTransform, Asterisk passthrough config, per-call HPKE key distribution, DTLS fingerprint binding | Weeks |
| **6** | MLS + PQ | MLS via Wire core-crypto, ML-KEM-1024 hybrid via HKDF-combine | Months, optional |

**Parallel non-blocking:** commission a real audit; Tauri desktop build for highest-risk tier; optional signed WebExtension verifier.

---

## 8. Wild Ideas

### 8.1. Gossip-signed bundle hashes
Every logged-in client, on unlock, signs a commitment to the bundle hash it ran and publishes to our Nostr relay. Targeted-SMCD shows up as one client with a divergent hash while the rest agree. Zero extra infrastructure.

### 8.2. Voice E2EE keyed by WebAuthn PRF
Both participants derive ephemeral SFrame key from per-device passkey PRF, salted by call ID. SIP bridge cannot decrypt even if subpoenaed — key never existed outside two Secure Enclaves.

### 8.3. Provable-delete for call notes
Per-note keys in an MLS epoch tree. "Delete" = epoch advance excluding the note's key, with old epoch material destroyed on every device. After epoch turns, the note is mathematically unrecoverable even with total seizure.

### 8.4. Hub key as an MLS group, members = devices
Volunteers' *devices* are MLS members; user is a label over their devices. Stolen laptop → MLS remove that device → PCS guarantees future notes unreadable. Old cached notes can be remote-wiped via panic message. Marries Keybase per-device keys with Wire production MLS.

### 8.5. Browser-as-renderer mode (Threema Web pattern)
Highest-threat volunteers: browser holds no long-term identity key. Paired mobile device is source of truth; browser proxies crypto ops via SaltyRTC-style session. Lower convenience, dramatically higher assurance.

---

## 9. Mandatory Cross-Cutting Principles

Derived from cautionary tales:

1. **Every ciphertext column AEAD.** No exceptions. XChaCha20-Poly1305 default.
2. **Every KDF/HKDF call consumes a label** from `crypto-labels.ts`. Raw string literals in crypto paths are latent Mega bugs.
3. **Labels enforced at decrypt.** Decrypt call passes expected label; rejects mismatch. Prevents Albrecht type confusion.
4. **Identity/device key only wraps other keys, never data directly.**
5. **Shareable/ephemeral envelopes use a different key hierarchy.**
6. **AEAD tag is the integrity mechanism.** Never client-side format checks.
7. **IV + framing metadata covered by the AEAD tag.**
8. **Membership changes signed into sigchain before crypto rewrap runs.**
9. **Cryptographic access control enforces roles.** Never from server-asserted claims.
10. **Publish or it doesn't count.** Whitepaper + audit + residual risk statements.

---

## 10. Spec Index

Each tier becomes a spec; each spec becomes a plan.

| Tier | Spec file | Status |
|---|---|---|
| 0 — Albrecht Hardening | `docs/superpowers/specs/2026-04-10-security-tier-0-albrecht-hardening-design.md` | Draft |
| 1 — HPKE + Primitives | `docs/superpowers/specs/2026-04-10-security-tier-1-hpke-primitives-design.md` | Pending |
| 2 — Unlock & Recovery | `docs/superpowers/specs/2026-04-10-security-tier-2-unlock-recovery-design.md` | Pending |
| 3 — Per-Device Keys | `docs/superpowers/specs/2026-04-10-security-tier-3-per-device-keys-design.md` | Pending |
| 4 — Delivery Hardening | `docs/superpowers/specs/2026-04-10-security-tier-4-delivery-hardening-design.md` | Pending |
| 5 — Voice E2EE | `docs/superpowers/specs/2026-04-10-security-tier-5-voice-e2ee-design.md` | Pending |
| 6 — MLS + PQ | `docs/superpowers/specs/2026-04-10-security-tier-6-mls-pq-design.md` | Pending |

Plans under `docs/superpowers/plans/` written per spec as approved for implementation.

---

## 11. Consolidated Bibliography

### Researched systems

**CryptPad:** https://blog.cryptpad.org/images/whitepaper.pdf · https://blog.cryptpad.org/2024/03/14/Most-Secure-CryptPad-Usage/ · https://docs.cryptpad.org/en/user_guide/security.html · github.com/cryptpad/cryptpad

**Proton Drive:** https://proton.me/blog/protondrive-security · https://proton.me/blog/encrypted-email-authentication · https://proton.me/blog/elliptic-curve-cryptography · https://proton.me/files/proton_keytransparency_whitepaper.pdf · github.com/ProtonMail/WebClients

**Matrix:** https://gitlab.matrix.org/matrix-org/olm/-/raw/master/docs/olm.md · https://gitlab.matrix.org/matrix-org/olm/-/raw/master/docs/megolm.md · https://spec.matrix.org/latest/client-server-api/#end-to-end-encryption · NCC 2016 audit · https://nebuchadnezzar-megolm.github.io/ · https://eprint.iacr.org/2023/485 · https://matrix.org/blog/2022/09/28/ · https://arxiv.org/html/2408.12743v2

**Bitwarden + 1Password:** https://bitwarden.com/help/bitwarden-security-white-paper/ · Cure53/Insight Risk 2024 report · https://agilebits.github.io/security-design/ · https://agilebits.github.io/security-design/restore.html · https://support.1password.com/security-assessments/

**Signal + Wire:** https://signal.org/docs/specifications/doubleratchet/ · https://signal.org/docs/specifications/x3dh/ · https://signal.org/docs/specifications/sesame/ · https://signal.org/blog/sealed-sender/ · https://datatracker.ietf.org/doc/rfc9420/ · https://datatracker.ietf.org/doc/draft-ietf-sframe-enc/ · https://datatracker.ietf.org/doc/draft-barnes-sframe-mls/ · github.com/wireapp/proteus · https://wire.com/en/blog/messaging-layer-security-mls-explained · https://www.cisco.com/c/en/us/solutions/collateral/collaboration/white-paper-c11-744553.html · RFC 8827

**Standard Notes:** https://standardnotes.com/help/security/encryption · https://standardnotes.com/blog/standard-notes-security-audits-2021

**Jitsi Meet E2EE:** https://github.com/jitsi/lib-jitsi-meet/blob/master/doc/e2ee.md · https://jitsi.org/blog/e2ee/ · https://jitsi.org/wp-content/uploads/2021/08/jitsi-e2ee-1.0.pdf

**Keybase:** https://book.keybase.io/docs/teams/crypto · https://book.keybase.io/docs/teams/puk · NCC Group 2019 audit

**Tuta:** https://tuta.com/blog/post-quantum-cryptography · https://tuta.com/blog/celebrating-one-year-pq-launch · https://tuta.com/encryption

**Mega.nz cautionary papers:** https://eprint.iacr.org/2022/959.pdf · https://mega-awry.io/ · https://eprint.iacr.org/2023/329 · https://mega-caveat.github.io/

### Browser crypto platform

- W3C WebCrypto L2: https://w3c.github.io/webcrypto/
- MDN SubtleCrypto: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
- WebAuthn extensions: https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions
- Corbado PRF guide 2026: https://www.corbado.com/blog/passkeys-prf-webauthn
- Bitwarden PRF: https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/
- Yubico PRF guide: https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html
- Igalia WebCrypto curves: https://blogs.igalia.com/jfernandez/2025/02/28/can-i-use-secure-curves-in-the-web-platform/
- RFC 9180 HPKE · https://github.com/dajiaji/hpke-js · https://github.com/panva/hpke
- RFC 9807 OPAQUE · https://github.com/serenity-kit/opaque · https://github.com/facebook/opaque-ke
- RFC 9420 MLS · https://openmls.tech/ · https://cryspen.com/openmls/
- Element-R IDB wrap-key pattern: https://github.com/element-hq/element-web/issues/24967
- dchest on keychain storage: https://dchest.com/2025/06/17/how-to-store-web-data-in-keychain/
- DBSC: https://developer.chrome.com/docs/web-platform/device-bound-session-credentials

### Delivery integrity & threat model

- SLSA: https://slsa.dev/ · Sigstore: https://sigstore.dev/ · Reproducible Builds: https://reproducible-builds.org/
- Trusted Types: https://www.w3.org/TR/trusted-types/ · CSP3: https://www.w3.org/TR/CSP3/

### Academic papers

- Cohn-Gordon, Cremers, Dowling, Garratt, Stebila — "A Formal Security Analysis of the Signal Messaging Protocol" (IEEE EuroS&P 2017)
- Alwen et al. — "Security Analysis and Improvements for the IETF MLS Standard" (CRYPTO 2020)
- Backendal, Haller, Paterson — "MEGA: Malleable Encryption Goes Awry" (IEEE S&P 2023, IACR 2022/959)
- Albrecht, Haller, Hofheinz, Paterson — "Caveat Implementor! Key Recovery Attacks on MEGA" (EUROCRYPT 2023, IACR 2023/329)
- Albrecht, Celi, Dowling, Jones — "Practically-exploitable Cryptographic Vulnerabilities in Matrix" (IEEE S&P 2023)
- "Matrix Reloaded" mechanized formal analysis (arxiv 2408.12743, 2024)
