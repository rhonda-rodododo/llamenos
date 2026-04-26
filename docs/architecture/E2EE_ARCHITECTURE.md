# Llamenos E2EE Architecture Overview

## Vision

Transform Llamenos from a "server-side encrypted" model to a **true zero-knowledge architecture** where:

1. **The server stores data it cannot read** - All content E2EE
2. **The server sees minimal metadata** - Real-time events via Nostr relay
3. **The server cannot correlate activity** - Encrypted metadata, ephemeral presence
4. **Users can verify code integrity** - Reproducible builds
5. **Audio never leaves the device** - Client-side transcription

## Three Encryption Tiers

All persistent data in Llamenos is encrypted using one of three tiers, chosen by sensitivity and access pattern:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 1: Envelope-Encrypted PII (per-user ECIES)                        │
│  (legacy — HPKE migration planned)                                       │
│                                                                          │
│  Who decrypts: Individual user (their nsec)                              │
│  Symmetric key: Per-record random key, ECIES-wrapped per reader          │
│  Crypto: secp256k1 ECDH ephemeral + SHA-256(label || sharedX)           │
│          + XChaCha20-Poly1305 key wrap                                   │
│  Domain label: LABEL_USER_PII, LABEL_CONTACT_PII, LABEL_CONTACT_SUMMARY│
│                                                                          │
│  Data: user names, phone numbers, contact records, invite details,       │
│        ban details, credential fields, intake payloads                   │
│                                                                          │
│  Pattern:                                                                │
│    encryptedFoo (ciphertext) + fooEnvelopes[] (per-reader ECIES wraps)  │
│    Each envelope: { pubkey, ephemeralPubkey, wrappedKey }                │
│    Server stores ciphertext + envelopes; cannot decrypt either           │
│                                                                          │
│  Status: Legacy ECIES — active for all envelope PII call sites.          │
│  Migration to HPKE planned but NOT YET DONE for this tier.               │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 2: Hub-Key Encrypted Org Metadata (AES-256-GCM via WebCrypto)     │
│                                                                          │
│  Who decrypts: All hub members (shared hub key)                          │
│  Key: Random 32 bytes, HPKE-distributed per member                       │
│       DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM           │
│  Crypto: AES-256-GCM via non-extractable WebCrypto CryptoKey            │
│  AAD: buildAad(label, recordId, fieldName) — prevents row/column swaps  │
│                                                                          │
│  Data: role names/descriptions, shift names, report type names,          │
│        custom field labels, team names, tag names, hub names             │
│                                                                          │
│  Pattern:                                                                │
│    encryptedName column in DB (ciphertext column type)                   │
│    Client: encryptHubField(value, hubId) / decryptHubField(ct, hubId)   │
│    Server fallback: stores plaintext if client sends no encrypted value  │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 3: MLS Groupwise Encryption (forward secrecy via epoch ratchet)   │
│                                                                          │
│  Who decrypts: All hub MLS group members                                 │
│  Protocol: MLS (RFC 9420) via @wireapp/core-crypto WASM                  │
│  Group ID: llamenos:hub:<hubId> (persistent per hub)                     │
│  Domain labels: LABEL_NOTE_KEY, LABEL_MESSAGE                            │
│                                                                          │
│  Data: call notes, transcripts, reports, SMS/WhatsApp/Signal messages    │
│                                                                          │
│  Properties:                                                             │
│    - Notes/messages encrypted through the group's ratchet tree           │
│    - Epoch advances on membership change provide forward secrecy         │
│    - No per-recipient key wrapping — group handles distribution          │
│    - Compromising one epoch does not reveal prior epochs                  │
│                                                                          │
│  Remaining ECIES call sites (NOT yet in MLS):                            │
│    - Blasts (LABEL_BLAST_CONTENT) — external recipients not in group     │
│    - Voicemail transcripts                                               │
│    - File attachments                                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Tier Summary Table

| Tier | Key Scope | Primitive | Access Pattern | Example Data |
|------|-----------|-----------|----------------|--------------|
| 1 | Per-record, per-reader | ECIES envelope (legacy — HPKE migration planned) | Individual user | User names, phones, contacts |
| 2 | Per-hub, all members | AES-256-GCM (WebCrypto), HPKE-distributed hub key | All hub members | Role names, shift names, tags |
| 3 | Per-hub MLS group | MLS groupwise (RFC 9420, @wireapp/core-crypto) | All hub group members | Notes, messages, transcripts |

## Multi-Factor KEK Derivation

The user's secret key (nsec) is encrypted at rest in localStorage using a Key Encryption Key (KEK) derived from multiple independent factors. Compromising any single factor is insufficient to recover the nsec.

```
Factor 1: PIN (6-8 digits)        Factor 2: IdP Value (32 bytes)     Factor 3: WebAuthn PRF (optional)
     │                                  │                                    │
     │  PBKDF2-SHA256                   │  From Authentik                    │  From hardware key
     │  600k iterations                 │  nsecSecret field                  │  via prf extension
     │  32-byte salt                    │  (or synthetic for                 │
     │                                  │   device-link flows)               │
     ▼                                  ▼                                    ▼
  pinDerived (32 bytes)           idpValue (32 bytes)               prfOutput (32 bytes)
     │                                  │                                    │
     └──────────┬───────────────────────┘                                    │
                │                       ┌────────────────────────────────────┘
                │                       │
                ▼                       ▼
         ┌──────────────────────────────────────┐
         │  Concatenation:                       │
         │  2F: pinDerived || idpValue           │
         │  3F: pinDerived || prfOutput || idpValue │
         └──────────────────┬───────────────────┘
                            │
                            ▼
         ┌──────────────────────────────────────┐
         │  HKDF-SHA256                          │
         │  salt: same 32-byte salt              │
         │  info: "llamenos:nsec-kek:2f"         │
         │    or  "llamenos:nsec-kek:3f"         │
         │  dkLen: 32 bytes                      │
         └──────────────────┬───────────────────┘
                            │
                            ▼
                       KEK (32 bytes)
                            │
                            ▼
         ┌──────────────────────────────────────┐
         │  XChaCha20-Poly1305                   │
         │  Encrypts nsec hex string             │
         │  Stored in localStorage as JSON:      │
         │  { version: 2, salt, nonce,           │
         │    ciphertext, pubkeyHash,            │
         │    prfUsed, idpIssuer }               │
         └──────────────────────────────────────┘
```

### Security Properties

| Property | Mechanism |
|----------|-----------|
| PIN brute-force resistance | PBKDF2 with 600k iterations makes each guess ~0.5s |
| IdP binding | KEK changes if IdP rotates the nsecSecret; server-side factor |
| WebAuthn hardware binding | PRF output from FIDO2 authenticator; device-bound |
| Factor independence | HKDF over concatenation — all factors required to derive same KEK |
| Domain separation | Separate HKDF info labels for 2F vs 3F modes |
| No plaintext pubkey stored | Only truncated SHA-256 hash of pubkey stored for identification |
| Synthetic fallback | Device-link flows use deterministic synthetic IdP value; auto-rotated to real value on next unlock with valid IdP session |
| KEK rotation | Re-encryption happens inside crypto worker; nsec never touches main thread |

## Web Worker Isolation

The user's secret key (nsec) **never exists on the main thread**. All private-key operations are delegated to a dedicated Web Worker via structured `postMessage` communication.

```
┌─────────────────────────────────────┐     ┌─────────────────────────────────┐
│          MAIN THREAD                 │     │        CRYPTO WORKER             │
│                                      │     │                                  │
│  CryptoWorkerClient (singleton)      │     │  Closure-scoped state:           │
│    │                                 │     │    secretKey: Uint8Array | null   │
│    │  .unlock(kek, nonce, ct)  ──────┼──▶  │    publicKeyHex: string | null   │
│    │  .unlockWithHandles(...)  ──────┼──▶  │    hpkePrivateKey: CryptoKey     │
│    │  .sign(messageHex)        ──────┼──▶  │      (non-extractable X25519)    │
│    │  .decrypt(eph, wrapped, label)──┼──▶  │    _hubKey: CryptoKey            │
│    │  .encrypt(pt, pub, label) ──────┼──▶  │      (non-extractable AES-GCM)  │
│    │  .hpkeSeal(pt, pub, label)──────┼──▶  │    mlsInstance: CoreCrypto       │
│    │  .hpkeOpen(env, label)    ──────┼──▶  │      (@wireapp/core-crypto WASM) │
│    │  .hpkePublicKeyRaw()      ──────┼──▶  │                                  │
│    │  .mlsInit(hubId)          ──────┼──▶  │  Operations:                     │
│    │  .mlsEncryptMessage(...)  ──────┼──▶  │    unlock    — decrypt nsec blob │
│    │  .mlsDecryptMessage(...)  ──────┼──▶  │    unlockWithHandles — install   │
│    │  .decryptEnvelopeField()  ──────┼──▶  │      non-extractable CryptoKeys  │
│    │  .reEncrypt(newKek)       ──────┼──▶  │    lock      — zero + null key   │
│    │  .provisionNsec(eph)      ──────┼──▶  │    sign      — Schnorr signature │
│    │  .lock()                  ──────┼──▶  │    decrypt   — ECIES unwrap      │
│    │  .getPublicKey()          ──────┼──▶  │    encrypt   — ECIES wrap        │
│    │  .isUnlocked()            ──────┼──▶  │    hpkeSeal  — HPKE encrypt      │
│    │                                 │     │    hpkeOpen  — HPKE decrypt      │
│    │  ◀── Promise<result> ───────────┼──◀  │    mlsInit   — MLS group setup   │
│    │                                 │     │    mlsEncryptMessage — MLS seal   │
│                                      │     │    mlsDecryptMessage — MLS open   │
│  Request/Response Protocol:          │     │    reEncrypt — KEK rotation      │
│    { type, id, ...params }     ──▶   │     │    provision — device linking    │
│    { type: 'success'|'error',        │     │    decryptEnvelopeField          │
│      id, result|error }       ◀──    │     │      — ECIES unwrap + symmetric  │
│                                      │     │        decrypt in one round trip  │
│  Singleton: one worker per tab       │     │                                  │
│  All pending requests tracked        │     │  Rate Limiting:                  │
│  by request ID in a Map              │     │    sign:    10/sec, 100/min      │
│                                      │     │    decrypt: 100/sec, 1000/min    │
│                                      │     │    encrypt: 10/sec, 100/min      │
│                                      │     │                                  │
│                                      │     │  Auto-lock on rate limit breach  │
│                                      │     │  Key zeroed with .fill(0)        │
└──────────────────────────────────────┘     └─────────────────────────────────┘
```

### Worker Security Properties

| Property | Implementation |
|----------|---------------|
| Key isolation | `secretKey`, `hpkePrivateKey`, `_hubKey`, `mlsInstance` in worker closure; never serialized back to main thread |
| Zero on lock | `secretKey.fill(0)` then `null` assignment; CryptoKey handles released |
| Non-extractable keys | HPKE private key and hub AES-GCM key are non-extractable `CryptoKey` handles — WebCrypto prevents export |
| Rate limiting | Per-operation buckets; exceeding triggers immediate auto-lock |
| No key export | No message type returns raw key material; only derived values (signatures, public key, ciphertext) |
| Singleton per tab | Module-level `cryptoWorker` instance; `typeof Worker !== 'undefined'` guard for SSR |
| Combined operations | `decryptEnvelopeField` does ECIES unwrap + symmetric decrypt in one worker round-trip |
| MLS isolation | CoreCrypto WASM instance runs inside worker; MLS epoch state never leaves the closure |

## Decrypt-on-Fetch Pattern

Encrypted data is decrypted inside React Query `queryFn` callbacks, not in components. Components receive plaintext and never handle ciphertext directly.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  React Query queryFn (e.g., rolesListOptions)                           │
│                                                                         │
│  1. Fetch from API:                                                     │
│     const { roles } = await listRoles()                                 │
│                                                                         │
│  2. Decrypt in queryFn:                                                 │
│     Tier 1 (envelope PII):                                              │
│       await decryptObjectFields(user, readerPubkey, LABEL_USER_PII)     │
│       await decryptArrayFields(users, readerPubkey, LABEL_USER_PII)     │
│                                                                         │
│     Tier 2 (hub-key org metadata):                                      │
│       name: decryptHubField(role.encryptedName, hubId, role.name)       │
│                                                                         │
│  3. Return plaintext to React Query cache                               │
│     Components use data as-is — no crypto awareness needed              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  ENCRYPTED_QUERY_KEYS — exhaustive classification                       │
│                                                                         │
│  Every query key domain in queryKeys MUST be classified as either       │
│  ENCRYPTED or PLAINTEXT. A compile-time MissingDomains type check       │
│  enforces exhaustiveness — adding a new domain without classifying it   │
│  produces a type error.                                                 │
│                                                                         │
│  Encrypted domains (cleared on lock, invalidated on unlock):            │
│    users, contacts, notes, calls, audit, blasts, reports,               │
│    conversations, invites, bans, credentials, intakes,                  │
│    shifts, roles, settings, hubs, tags, teams                           │
│                                                                         │
│  Plaintext domains (never cleared):                                     │
│    analytics, preferences, presence, provider                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Lock / Unlock Lifecycle                                                │
│                                                                         │
│  ON LOCK (key-manager → onLock callback):                               │
│    1. Crypto worker zeros nsec                                          │
│    2. queryClient.removeQueries() for all ENCRYPTED_QUERY_KEYS          │
│       → stale ciphertext never served to unauthenticated session        │
│    3. Hub key cache cleared (clearHubKeyCache)                          │
│    4. Decrypt cache cleared (decryptCache.clear)                        │
│                                                                         │
│  ON UNLOCK (auth.tsx, AFTER hub keys loaded):                           │
│    1. PIN entered → KEK derived → crypto worker unlocks                 │
│    2. loadHubKeysForUser(hubIds) — fetch + HPKE-unwrap hub keys         │
│    3. invalidateEncryptedQueries() — mark all encrypted domains stale   │
│    4. React Query refetches → queryFns decrypt with fresh keys          │
│                                                                         │
│  IMPORTANT: invalidation happens AFTER loadHubKeysForUser completes.    │
│  Doing it before caused a race: queries refetched while hub key cache   │
│  was still empty, caching raw ciphertext instead of plaintext.          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Decrypt Cache

Tier 1 decryption (envelope ECIES) involves a crypto worker round-trip per field. A `DecryptCache` (keyed by `label:ciphertext`) avoids redundant worker calls across re-renders and refetches. The cache is a module-level singleton cleared on lock.

## Encryption for Messaging (MLS + Server-Side Ingest)

Stored messages use **MLS groupwise encryption** (Tier 3). Inbound messages from external providers are server-encrypted at the webhook boundary, then MLS-encrypted by the first client to claim them.

```
INBOUND MESSAGE FLOW:

  Provider (Twilio/Vonage/etc)
       │
       │  POST /api/messaging/webhook
       ▼
  ┌──────────────────────────────────────────┐
  │  Server: messaging/router.ts              │
  │                                            │
  │  1. Parse webhook payload                  │
  │  2. Find or create conversation            │
  │  3. Server-side encrypt (AES-GCM under     │
  │     LABEL_MESSAGE) — temporary envelope    │
  │  4. Store server-encrypted ciphertext      │
  │  5. Discard plaintext immediately          │
  │  6. Publish Nostr event (hub-key encrypted)│
  └──────────────────────────────────────────┘
       │
       │  First client to fetch unclaimed message:
       ▼
  ┌──────────────────────────────────────────┐
  │  Client: crypto worker                     │
  │                                            │
  │  1. Decrypt server-side AES-GCM envelope   │
  │  2. Re-encrypt via MLS group:              │
  │     mlsInstance.encrypt(hubGroupId, pt)     │
  │  3. POST MLS ciphertext back to server     │
  │  4. Server replaces server-encrypted blob  │
  │     with MLS ciphertext; discards server   │
  │     key material for that message          │
  └──────────────────────────────────────────┘

OUTBOUND MESSAGE FLOW:

  Volunteer client
       │
       │  1. MLS-encrypt message for hub group:
       │     mlsInstance.encrypt(hubGroupId, messageText)
       │  2. POST /api/conversations/{id}/messages
       │     Body: { plaintextForSending, mlsCiphertext }
       ▼
  ┌──────────────────────────────────────────┐
  │  Server:                                   │
  │  1. Forward plaintext to SMS/WhatsApp      │
  │     provider (inherent transport limitation)│
  │  2. Store ONLY MLS ciphertext              │
  │  3. Discard plaintextForSending            │
  └──────────────────────────────────────────┘
```

**Trust boundary**: The server momentarily sees outbound message plaintext because SMS/WhatsApp/Signal providers require it. This is an inherent limitation of non-E2EE transport protocols. The server discards plaintext immediately after forwarding.

**Remaining ECIES messaging call sites**: Blast content (`LABEL_BLAST_CONTENT`) still uses per-recipient ECIES envelope encryption because blast recipients may not be members of the hub MLS group.

## Hub Key Distribution

Each hub has a random 32-byte symmetric key used for Tier 2 encryption (org metadata) and Nostr event content encryption.

```
GENERATION:
  hubKey = crypto.getRandomValues(32)     ← NOT derived from any identity key

DISTRIBUTION:
  For each hub member (volunteer or admin):
    wrapHubKeyForMember(hubKey, memberX25519PubkeyRaw)
      → hpkeSeal(hubKey, memberPubkey, LABEL_HUB_KEY_WRAP)
      → HpkeEnvelope { v: 3, labelId, enc, ct }
      Suite: DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM (RFC 9180)

  Stored server-side: array of HPKE envelopes per member
  Fetched client-side: GET /api/hub/key → member's envelope

LOADING (client-side, after PIN unlock):
  loadHubKeysForUser(hubIds):
    For each hub:
      1. getMyHubKeyEnvelope(hubId) → fetch my HPKE envelope from server
      2. unwrapHubKey(envelope)     → hpkeOpen in crypto worker
      3. Import as non-extractable AES-256-GCM CryptoKey
      4. hubKeyCache.set(hubId, CryptoKey)

  Cache: module-level Map<hubId, CryptoKey> (non-extractable AES-256-GCM)
  Generation counter prevents stale concurrent loads from writing

ROTATION (on member departure):
  rotateHubKey(currentMemberPubkeys):
    1. Generate new random 32-byte key
    2. Wrap for all CURRENT members (departed member excluded)
    3. Store new envelopes server-side
    4. Re-encrypt hub-scoped data with new key (caller responsibility)

  The departed member's old hub key is useless for new data.
  Old data encrypted with the old key remains readable to anyone
  who had the old key — this is by design (forward secrecy, not
  backward secrecy, for organizational metadata).
```

### Hub Key Properties

| Property | Mechanism |
|----------|-----------|
| Pure random | `crypto.getRandomValues(32)` — no derivation from identity keys |
| Individual wrapping | HPKE per member with `LABEL_HUB_KEY_WRAP` domain separation (DHKEM(X25519, HKDF-SHA256) + AES-256-GCM) |
| No shared admin secret | Each member gets their own HPKE-wrapped copy |
| Non-extractable storage | Hub key imported as non-extractable AES-256-GCM `CryptoKey` — WebCrypto prevents export |
| Rotation breaks access | New key = new random bytes, no mathematical link to old key |
| Server cannot decrypt | Server stores HPKE envelopes; needs member's X25519 private key to unwrap |

## Implemented Architecture

### Data at Rest

| Data Type | Tier | Encryption | Notes |
| --------- | ---- | ---------- | ----- |
| Call notes | 3 | MLS groupwise encryption via hub MLS group (forward secrecy via epoch ratchet) | Epoch advances on membership change |
| Transcripts | 3 | Client-generated via WASM Whisper; MLS-encrypted with note | Audio never leaves browser |
| Reports | 3 | MLS groupwise encryption via hub MLS group | Forward secrecy via epoch ratchet |
| File attachments | 3 | XChaCha20-Poly1305 + ECIES per-file key (legacy) | Stored in RustFS |
| SMS messages | 3 | MLS groupwise encryption via hub MLS group; server AES-GCM at ingest, MLS-encrypted by first client | Server discards plaintext at webhook boundary |
| WhatsApp messages | 3 | MLS groupwise encryption via hub MLS group; server AES-GCM at ingest, MLS-encrypted by first client | Server discards plaintext at webhook boundary |
| Signal messages | 3 | MLS groupwise encryption via hub MLS group; server AES-GCM at ingest, MLS-encrypted by first client | Server discards plaintext at webhook boundary |
| Blast content | 3 | ECIES envelope encryption with LABEL_BLAST_CONTENT (legacy — recipients not in MLS group) | Per-blast key |
| Voicemail transcripts | 3 | ECIES envelope encryption with LABEL_VOICEMAIL_TRANSCRIPT (legacy) | |
| User names | 1 | ECIES envelope with LABEL_USER_PII | Per-user envelopes |
| User phones | 1 | ECIES envelope with LABEL_USER_PII | Per-user envelopes |
| Contact records | 1 | Two-tier: LABEL_CONTACT_SUMMARY (display) + LABEL_CONTACT_PII (full PII) | PBAC-controlled access |
| Contact relationships | 1 | ECIES envelope with LABEL_CONTACT_RELATIONSHIP | Fully E2EE |
| Contact intake payloads | 1 | ECIES envelope with LABEL_CONTACT_INTAKE | Enveloped for submitter + triage |
| Invite details | 1 | ECIES envelope with LABEL_USER_PII | Per-inviter envelopes |
| Ban details | 1 | ECIES envelope with LABEL_USER_PII | Per-admin envelopes |
| Credential fields | 1 | ECIES envelope with LABEL_USER_PII | Per-user envelopes |
| Role names/descriptions | 2 | Hub-key AES-256-GCM (WebCrypto, per-record AAD) | All hub members can decrypt |
| Shift names | 2 | Hub-key AES-256-GCM (WebCrypto, per-record AAD) | All hub members can decrypt |
| Report type names | 2 | Hub-key AES-256-GCM (WebCrypto, per-record AAD) | All hub members can decrypt |
| Custom field labels | 2 | Hub-key AES-256-GCM (WebCrypto, per-record AAD) | All hub members can decrypt |
| Team names | 2 | Hub-key AES-256-GCM (WebCrypto, per-record AAD) | All hub members can decrypt |
| Tag names | 2 | Hub-key AES-256-GCM (WebCrypto, per-record AAD) | All hub members can decrypt |
| Hub names | 2 | Hub-key AES-256-GCM (WebCrypto, per-record AAD) | All hub members can decrypt |
| Volunteer assignments | 1 | Multi-admin envelopes via LABEL_CALL_META | |
| Shift schedules | 2+plaintext | Encrypted details via LABEL_SHIFT_SCHEDULE; routing pubkeys/times plaintext | |
| Audit logs | — | Plaintext + SHA-256 hash chain (previousEntryHash + entryHash) for tamper detection | Server-readable, integrity-protected |
| Caller phone hashes | — | HMAC-SHA256 with operator secret; last 4 digits stored plaintext | For ban list matching |
| JWT tokens | — | Signed (HS256) with HMAC_SECRET; stored server-side only | Session authentication |
| Authentik credentials | — | Stored in Authentik; IdP-bound nsecSecret encrypted at rest via LABEL_IDP_VALUE_WRAP | Server never holds nsecSecret plaintext |
| Provider credentials | 1 | ECIES envelope with LABEL_PROVIDER_CREDENTIAL_WRAP | OAuth/API keys for telephony providers |
| Storage credentials | 2 | Hub-key with LABEL_STORAGE_CREDENTIAL_WRAP | RustFS IAM secret keys |

### Data in Transit (Real-Time)

| Event Type | Implementation |
| ---------- | -------------- |
| Call notifications | Nostr relay ephemeral kind 20001 events, hub-key encrypted, generic tags |
| Presence updates | Nostr relay ephemeral events, hub-key encrypted (volunteer: boolean; admin: ECIES with full counts) |
| Message notifications | Nostr relay ephemeral events, hub-key encrypted |
| Typing indicators | Nostr relay ephemeral events, hub-key encrypted |
| Call state changes | REST API (server-authoritative) + Nostr relay propagation |

### External Data Flows

| Flow | Implementation |
| ---- | -------------- |
| Transcription audio | Local mic only — WASM Whisper in-browser via `@huggingface/transformers`, single-threaded AudioWorklet |
| Volunteer phone numbers | Exposed to telephony provider (Twilio SDK) — inherent limitation of PSTN |
| Push notifications | Not yet implemented — planned: two-tier encryption (wake key + pubkey) |

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │  Web Client       │  │  Desktop Client   │  │  Mobile Client    │       │
│  │  (React SPA)      │  │  (Tauri)          │  │  (React Native)   │       │
│  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘       │
│            │                      │                      │                  │
│            └──────────────────────┼──────────────────────┘                  │
│                                   │                                         │
│  ┌────────────────────────────────┴────────────────────────────────────┐   │
│  │                        SHARED CLIENT CORE                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ Key Manager  │  │ Crypto Worker│  │ Nostr Client │              │   │
│  │  │ (multi-factor│  │ (nsec in     │  │ (Relay Conn) │              │   │
│  │  │  KEK unlock) │  │  Web Worker) │  │              │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ Hub Key Cache│  │ Decrypt-on-  │  │ Transcription│              │   │
│  │  │ (per-hub     │  │ Fetch (React │  │ (WASM Whisper│              │   │
│  │  │  symmetric)  │  │  Query + RQ) │  │  AudioWorklet│              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │  ┌──────────────┐  ┌──────────────┐                                │   │
│  │  │ Twilio Voice │  │ State Sync   │                                │   │
│  │  │ SDK Handler  │  │ (REST+Nostr) │                                │   │
│  │  └──────────────┘  └──────────────┘                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    │ REST API                     │ Nostr Events (ephemeral)
                    │ (state mutations,            │ (encrypted content,
                    │  E2EE blob storage)          │  generic tags only)
                    ▼                              ▼
┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐
│           SERVER LAYER              │  │           NOSTR RELAY               │
│  ┌─────────────────────────────┐   │  │  ┌─────────────────────────────┐   │
│  │ Bun + Hono (VPS / Docker)   │   │  │  │ strfry (self-hosted)       │   │
│  │                             │   │  │  │                             │   │
│  │ • Auth (WebAuthn/session)   │   │  │  │ • NIP-01 Events             │   │
│  │ • Authentik IdP (OIDC)      │   │  │  │ • NIP-42 Auth               │   │
│  │ • Telephony webhooks        │   │  │  │ • Hub-scoped subscriptions  │   │
│  │ • Messaging webhooks        │   │  │  │ • Ephemeral event forwarding│   │
│  │ • E2EE blob storage         │   │  │  │ • E2EE event content        │   │
│  │ • Minimal routing metadata  │   │  │  │                             │   │
│  │ • Server nsec (signing only)│   │  │  └─────────────────────────────┘   │
│  └─────────────────────────────┘   │  │                                     │
│                                     │  │  Relay sees:                        │
│  Server has:                        │  │  • Encrypted event content          │
│  • Server nsec (its own identity)   │  │  • Pubkeys (pseudonymous)           │
│  • Admin/volunteer npubs (pub only) │  │  • Timestamps                       │
│  • Encrypted blobs it can't read    │  │  • Generic tags only (no event type)│
│  • Authentik as identity provider   │  │                                     │
│  • NEVER has admin/volunteer nsec   │  │                                     │
│                                     │  │                                     │
│  Server NEVER:                      │  │                                     │
│  • Decrypts content                 │  │                                     │
│  • Holds user private keys          │  │                                     │
│  • Reads message/note plaintext     │  │                                     │
│  (except outbound SMS/WhatsApp      │  │                                     │
│   momentarily — inherent limit)     │  │                                     │
└─────────────────────────────────────┘  └─────────────────────────────────────┘
                    │
                    │ Telephony/Messaging Webhooks
                    ▼
┌─────────────────────────────────────┐
│      EXTERNAL PROVIDERS             │
│  ┌─────────────┐  ┌──────────────┐ │
│  │ Twilio/etc  │  │ SMS/WhatsApp │ │
│  │ (calls)     │  │ (messages)   │ │
│  └─────────────┘  └──────────────┘ │
│                                     │
│  Providers see:                     │
│  • Call audio (if PSTN)             │
│  • Outbound message content         │
│    (inherent, server discards       │
│     after forwarding)               │
│  • Phone numbers                    │
│                                     │
│  NEW trusted parties:               │
│  • Authentik (IdP, nsecSecret)      │
│  • Apple APNs (push delivery meta)  │
│  • Google FCM (push delivery meta)  │
└─────────────────────────────────────┘
```

## Encryption Key Hierarchy

```
User nsec (secp256k1) — IDENTITY AND SIGNING
    │
    ├─→ Protected by multi-factor KEK:
    │       PIN (PBKDF2) + IdP value (Authentik) + optional WebAuthn PRF
    │       → HKDF → KEK → XChaCha20-Poly1305 encrypts nsec in localStorage
    │
    ├─→ Auth: WebAuthn session tokens (multi-device)
    │       + Schnorr signatures for Nostr events
    │
    ├─→ Tier 1 decryption (legacy ECIES): unwrap of per-field envelope keys
    │       ├─→ User PII envelopes (LABEL_USER_PII)
    │       ├─→ Contact summary envelopes (LABEL_CONTACT_SUMMARY)
    │       ├─→ Contact PII envelopes (LABEL_CONTACT_PII)
    │       ├─→ Contact relationship envelopes (LABEL_CONTACT_RELATIONSHIP)
    │       └─→ Provider credential envelopes (LABEL_PROVIDER_CREDENTIAL_WRAP)
    │
    ├─→ Legacy ECIES call sites (not yet migrated):
    │       ├─→ Blast keys (LABEL_BLAST_CONTENT)
    │       ├─→ Backup encryption (LABEL_BACKUP)
    │       ├─→ Device provisioning (LABEL_DEVICE_PROVISION)
    │       └─→ Key-store PIN-KEK (XChaCha20-Poly1305 under HKDF-derived KEK)
    │
    └─→ Derived X25519 keypair (for HPKE operations)
            ├─→ Hub key unwrap: hpkeOpen(envelope, LABEL_HUB_KEY_WRAP)
            │       → enables Tier 2 decryption
            └─→ HPKE private key held as non-extractable CryptoKey in worker

User HPKE X25519 keypair — HPKE ENCRYPTION/DECRYPTION
    │   Suite: DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM (RFC 9180)
    │   Wire format: HpkeEnvelope { v: 3, labelId, enc, ct }
    │   AAD: buildAad(label, recordId, fieldName)
    │
    ├─→ Hub key unwrap (LABEL_HUB_KEY_WRAP)
    │       → enables Tier 2 decryption
    │
    └─→ Private key: non-extractable CryptoKey in crypto worker closure
        Public key: raw X25519 bytes stored server-side for encryption by others

Hub Key (random 32 bytes, NOT derived from any identity key)
    │   Stored as non-extractable AES-256-GCM CryptoKey in client
    │
    ├─→ Tier 2: Org metadata encryption (AES-256-GCM via WebCrypto)
    │       ├─→ Role names, shift names, report type names
    │       ├─→ Custom field labels, team names, tag names
    │       └─→ Hub names
    │       AAD: buildAad(label, recordId, fieldName) per encrypted field
    │
    ├─→ Nostr event content encryption (AES-256-GCM + HKDF per-event)
    ├─→ Presence encryption (volunteer-tier: boolean only)
    ├─→ Storage credential wrapping (LABEL_STORAGE_CREDENTIAL_WRAP)
    │
    └─→ Distribution: HPKE-wrapped individually for each member
        ├─→ Volunteer A envelope (HpkeEnvelope)
        ├─→ Volunteer B envelope (HpkeEnvelope)
        └─→ Each admin envelope (HpkeEnvelope)

MLS Group (llamenos:hub:<hubId>) — Tier 3
    │   Protocol: MLS (RFC 9420) via @wireapp/core-crypto WASM
    │   Instance: CoreCrypto in crypto worker closure
    │
    ├─→ Call notes: encrypted through group ratchet tree
    ├─→ Messages (SMS/WhatsApp/Signal): MLS-encrypted after ingest
    ├─→ Transcripts: encrypted with group key
    ├─→ Reports: encrypted with group key
    │
    ├─→ Forward secrecy: epoch advances on membership change
    │   Compromising one epoch does not reveal prior epochs
    │
    └─→ NOT used for: blasts (external recipients), voicemail (server-side),
        file attachments (separate per-file key)

Server nsec (secp256k1) — SERVER IDENTITY ONLY
    ├─→ Derived via HKDF from SERVER_NOSTR_SECRET (LABEL_SERVER_NOSTR_KEY)
    ├─→ Signs Nostr events published by server (call:ring, call:answered)
    ├─→ Clients verify server pubkey for authoritative events
    └─→ CANNOT decrypt any user content
```

## Domain Separation Labels (Authoritative Table)

From `src/shared/crypto-labels.ts`. Labels used in HPKE envelopes carry a wire-indexed `labelId` from `LABEL_REGISTRY` (42 active indices 0-41, plus 5 permanently retired indices 42-46) for compact serialization. Non-wire labels (KEK derivation, HKDF info, etc.) use the string directly. There are 88 total constants (76 `LABEL_*` exports, 63 branded `CryptoLabel`).

| Label | Purpose | Used By | Tier |
| ----- | ------- | ------- | ---- |
| `llamenos:note-key` | MLS group encryption of note content | Client crypto (MLS) | 3 |
| `llamenos:message` | MLS group encryption of message content; server-side AES-GCM at ingest | Client + server crypto | 3 |
| `llamenos:blast-content` | Blast content ECIES envelope encryption (legacy — external recipients) | Client + server crypto | 3 |
| `llamenos:transcription` | Transcription key wrapping | Server-side transcription | 3 |
| `llamenos:file-key` | Per-file attachment key wrapping | Client crypto | 3 |
| `llamenos:file-metadata` | File metadata ECIES wrapping | Client crypto | 3 |
| `llamenos:voicemail-audio` | Voicemail audio symmetric key wrapping | Server crypto | 3 |
| `llamenos:voicemail-transcript` | Voicemail transcript encryption | Server crypto | 3 |
| `llamenos:hub-key-wrap` | HPKE wrapping of hub key for member distribution (DHKEM(X25519) + AES-256-GCM) | Admin client | — |
| `llamenos:hub-event` | Hub key encryption of Nostr event content | Client Nostr encryption | 2 |
| `llamenos:call-meta` | Encrypted call record metadata (assignments) | Client + server crypto | 1 |
| `llamenos:shift-schedule` | Encrypted shift schedule details | Client + server crypto | 2 |
| `llamenos:volunteer-pii:v1` | User/invite PII envelope encryption | Server crypto | 1 |
| `llamenos:contact-summary` | Contact display info (Tier 1 contact) | Client crypto | 1 |
| `llamenos:contact-pii` | Contact full PII (Tier 2 contact) | Client crypto | 1 |
| `llamenos:contact-relationship` | Contact relationship payload | Client crypto | 1 |
| `llamenos:contact-intake:v1` | Contact intake payload | Client crypto | 1 |
| `llamenos:provider-credential-wrap:v1` | Provider OAuth/API credentials | Client crypto | 1 |
| `llamenos:storage-credential` | Hub storage IAM secret key | Client crypto | 2 |
| `llamenos:device-provision` | Device provisioning ECDH shared key | Client crypto | — |
| `llamenos:nsec-kek:2f` | HKDF info for 2-factor KEK derivation | Key store | — |
| `llamenos:nsec-kek:3f` | HKDF info for 3-factor KEK derivation | Key store | — |
| `llamenos:kek-prf` | WebAuthn PRF evaluation salt | Key store | — |
| `llamenos:idp-value-wrap` | Envelope encryption of idp_value in IdP | Server crypto | — |
| `llamenos:server-nostr-key` | HKDF derivation of server Nostr keypair | Server startup | — |
| `llamenos:server-nostr-key:v1` | Versioned HKDF info for server Nostr key | Server startup | — |
| `llamenos:push-wake` | Wake-tier push payload (minimal metadata) | Future | — |
| `llamenos:push-full` | Full-tier push payload (nsec-decryptable) | Future | — |
| `llamenos:backup` | Generic backup encryption | Client crypto | — |
| `llamenos:audit-event:v1` | Audit log event encryption | Server crypto | — |
| `llamenos:ivr-audio:v1` | IVR audio prompt encryption | Server crypto | — |
| `llamenos:blast-settings:v1` | Blast settings message encryption | Server crypto | — |
| `llamenos:ephemeral-call:v1` | Ephemeral call data (caller numbers) | Server crypto | — |
| `llamenos:push-credential:v1` | Push notification credential encryption | Server crypto | — |
| `llamenos:contact-identifier` | Contact identifier encryption at rest | Client crypto | — |

## Database Column Types for Encrypted Data

From `src/server/db/crypto-columns.ts`:

```typescript
/** Text column storing ciphertext (AES-256-GCM for Tier 2, ECIES for Tier 1, MLS for Tier 3) */
export const ciphertext = (name: string) => text(name).$type<Ciphertext>()

/** Text column storing an HMAC-SHA256 hash (hex-encoded) */
export const hmacHashed = (name: string) => text(name).$type<HmacHash>()
```

The branded `Ciphertext` and `HmacHash` types provide compile-time safety — you cannot accidentally pass a plaintext string where ciphertext is expected, or vice versa.

## Data Flow Diagrams

### Incoming Call (Target Architecture)

```
1. Telephony webhook arrives at server
   │
   ▼
2. Server extracts minimal info:
   • callId (generated)
   • callerLast4 (masked)
   • timestamp
   │
   ▼
3. Server publishes to Nostr relay (via HTTP):
   Event {
     kind: 20001,  // Ephemeral — relay forwards, never stores
     tags: [["d", hubId], ["t", "llamenos:event"]],  // Generic tag
     content: AES-256-GCM(hubKey, {type: "call:ring", callId, callerLast4}),
     pubkey: serverPubkey  // Server signs with its own nsec
   }
   │
   ▼
4. All on-shift volunteer clients subscribed to relay:
   • Receive event, verify server signature
   • Decrypt with hub key
   • Route by type field ("call:ring")
   • Show incoming call UI
   │
   ▼
5. Volunteer answers:
   • POST /api/calls/{callId}/answer (REST — server is authority)
   • Server atomically sets answeredBy
   • First request: 200 OK
   • Subsequent requests: 409 Conflict
   │
   ▼
6. Server publishes authoritative call:answered event to relay
   • Other clients stop ringing
```

### Message Send (Target Architecture)

```
1. Volunteer types message in conversation view
   │
   ▼
2. Client MLS-encrypts for hub group:
   • mlsCiphertext = mlsInstance.encrypt(hubGroupId, messageText)
   • plaintextForSending = raw text (for SMS/WhatsApp provider)
   │
   ▼
3. POST /api/conversations/{id}/messages
   Body: { plaintextForSending, mlsCiphertext }
   │
   ▼
4. Server:
   • Forwards plaintext to SMS/WhatsApp provider (inherent limitation)
   • Stores ONLY MLS ciphertext (discards plaintext immediately)
   │
   ▼
5. Server publishes to Nostr relay:
   Event {
     kind: 20001,
     tags: [["d", hubId], ["t", "llamenos:event"]],
     content: AES-256-GCM(hubKey, {type: "message:new", threadId}),
   }

Server NEVER stores: plaintext message
Server DOES see: outbound plaintext momentarily (inherent SMS/WhatsApp limitation)
```

## Security Analysis

### Trust Boundaries

| Party | Has | Does NOT Have |
| ----- | --- | ------------- |
| Volunteer | Own nsec + X25519 keypair (in Worker), hub key (non-extractable CryptoKey), MLS group membership | Other volunteers' nsec, admin nsec |
| Admin | Admin nsec + X25519 keypair (in Worker), hub key, MLS group membership | Volunteer nsec |
| Server | Server nsec, all npubs + X25519 public keys | Any user nsec, hub key, MLS group state, HPKE/X25519 private keys |
| Relay | NIP-42 auth tokens | Event content (encrypted), user nsec |
| Authentik (IdP) | nsecSecret (IdP-bound factor), session tokens | User nsec, PIN, WebAuthn PRF |
| Apple/Google | Push delivery metadata | Push content (encrypted), identity |

### Attack Scenarios

| Attack | Before | After |
| ------ | ------ | ----- |
| Server DB dump | Messages readable, metadata exposed | Only ciphertext (Tier 1-3) + encrypted metadata (Tier 2) |
| Server code compromise | Real-time events visible | Real-time via relay, server has no hub key |
| Relay compromise | N/A | Only encrypted events + generic tags |
| Subpoena of hosting | Metadata + activity patterns | Encrypted blobs, relay connection metadata |
| Subpoena of DB only | Full plaintext access | Ciphertext only (relay provides additional protection) |
| Admin nsec compelled | ALL data decryptable | Only auth compromised (Tier 1 ECIES + MLS group membership required for Tier 3) |
| Hub key compromised | N/A | Tier 2 metadata decryptable; Tier 1 still safe (per-user ECIES); Tier 3 still safe (MLS group key ≠ hub key) |
| Device seizure | PIN brute-force → all keys | Multi-factor KEK: need PIN + IdP value + optional PRF |
| Volunteer departure | Historical access retained | Hub key rotated, departed volunteer locked out of new data |
| IdP compromise | N/A | IdP has nsecSecret but not PIN; cannot derive KEK alone |
| PIN-only compromise | N/A | Attacker also needs IdP value; PBKDF2 slows brute force |
| WebAuthn key theft | N/A | Still need PIN + IdP value; PRF is additional factor, not sole factor |

### Remaining Trust Requirements

1. **Telephony providers**: See call audio (PSTN) and outbound message content (SMS/WhatsApp)
   - Mitigation: Twilio SDK for calls (no personal phone numbers), document SMS/WhatsApp limitation

2. **Admin nsec + MLS group membership compromise**: Can decrypt all Tier 3 notes and messages
   - Mitigation: MLS forward secrecy via epoch ratchet, hardware key storage, rotation procedures

3. **Client code integrity**: Malicious client could exfiltrate data
   - Mitigation: Reproducible builds, code signing, SLSA provenance

4. **Relay availability**: If relay is down, real-time is degraded
   - Mitigation: Self-hosted relay, REST polling fallback for state

5. **Authentik (IdP)**: Holds nsecSecret factor; compromise provides one of the KEK factors
   - Mitigation: IdP value alone is insufficient (need PIN + optionally PRF); nsecSecret encrypted at rest via LABEL_IDP_VALUE_WRAP

6. **Apple/Google (mobile)**: See push delivery timing and device identifiers
   - Mitigation: Encrypted push payloads, two-tier wake key separation

## Implementation Approach

### Clean Rewrite (No Migration)

Since Llamenos is **pre-production with no deployed users**, we do a clean rewrite:

- **Delete legacy code entirely** - No WebSocket, no plaintext message storage
- **Build E2EE-first** - All features designed for zero-knowledge from the start
- **No backwards compatibility** - No feature flags, no parallel systems
- **Simpler codebase** - Less code to maintain, fewer edge cases

### What the Server Has vs What It Doesn't

**CRITICAL PRINCIPLE: The server NEVER holds user private keys.**

| The server HAS | The server NEVER HAS |
| --------------- | -------------------- |
| Its own server nsec (for signing Nostr events) | Admin nsec (admin's private key) |
| Admin npub + X25519 public key (for ECIES/HPKE encryption) | Volunteer nsec (any volunteer's private key) |
| Volunteer npubs + X25519 public keys (for ECIES/HPKE encryption) | Hub key (non-extractable CryptoKey, only clients have it) |
| Encrypted blobs it cannot read | Ability to decrypt any user content |
| Auth tokens (proves identity) | Note/message plaintext (except outbound SMS/WhatsApp momentarily) |
| Authentik as identity provider (OIDC) | User PINs or WebAuthn PRF output |
| HPKE envelopes for hub key distribution | HPKE/X25519 private keys (non-extractable, worker-only) |

ECIES and HPKE encryption only need the **public key** to encrypt. The private key is only needed to **decrypt**, and that happens client-side (in the crypto worker). MLS group encryption/decryption also happens entirely in the worker via the CoreCrypto WASM instance.

### What We Still Need a Server API For

Even with Nostr relay handling all real-time events, we still need a thin REST API for:

| Function | Why Server Required | What Server Sees |
| -------- | ------------------- | ---------------- |
| **Telephony webhooks** | Twilio/Vonage POST to our server | Call metadata (unavoidable) |
| **Messaging webhooks** | SMS/WhatsApp providers POST to our server | Inbound message content (unavoidable, encrypt immediately, store only ciphertext) |
| **Outbound message relay** | Client sends plaintext + encrypted; server forwards to provider, stores only encrypted | Outbound plaintext **momentarily** (discarded after send — inherent SMS/WhatsApp limitation) |
| **E2EE blob storage** | Persistent storage for encrypted notes/messages | Ciphertext only |
| **Auth (WebAuthn/session)** | Validate identity, manage sessions | Auth tokens |
| **Call state mutations** | Atomic answer/hangup | Call ID, volunteer pubkey |
| **File uploads** | Encrypted attachments need RustFS | Ciphertext only |
| **Push notification trigger** | Wake sleeping mobile clients | Encrypted payload via APNs/FCM |
| **IdP integration** | Authentik OIDC for multi-factor auth | Session tokens, nsecSecret (KEK factor) |

### Implementation History

1. **Epic 76.0: Security Foundations** (Completed)
   - Domain separation label audit → `src/shared/crypto-labels.ts` with 25+ constants
   - Provisioning channel SAS fix
   - Emergency key revocation procedures documented
   - Threat model updates (6 new sections)
   - Backup file privacy fix (generic format)

2. **Epic 76.1 + 76.2: Architecture Redesign** (Completed)
   - Worker-to-relay communication: `NostrPublisher` with persistent WebSocket
   - Hub key = `crypto.getRandomValues(32)`, ECIES-wrapped per member
   - Multi-admin envelopes: `adminPubkeys[]` → `adminEnvelopes[]`
   - Identity + decryption key separation

3. **Epic 76: Nostr Relay Sync** (Completed)
   - Complete WebSocket removal — deleted `ws.ts`, `websocket.ts`, `websocket-pair.ts`
   - Nostr-only real-time via ephemeral kind 20001 events with generic tags
   - Server-authoritative call state (REST, relay for notification)

4. **Epic 74: E2EE Messaging Storage** (Completed)
   - Envelope encryption: per-message random key, ECIES-wrapped per reader
   - Server encrypts inbound on webhook receipt (plaintext discarded immediately)
   - Client-side decryption in ConversationThread component

5. **Epic 77: Metadata Encryption** (Completed)
   - Per-record storage keys
   - Encrypted call assignments (`LABEL_CALL_META`) and shift schedules (`LABEL_SHIFT_SCHEDULE`)
   - Hash-chained audit log (SHA-256 with `previousEntryHash` + `entryHash`)

6. **Epic 78: Client-Side Transcription** (Completed)
   - WASM Whisper via `@huggingface/transformers` ONNX runtime
   - AudioWorklet ring buffer → Web Worker isolation
   - Local microphone only (Twilio SDK limitation), auto-save encrypted transcript on hangup

7. **Epic 79: Reproducible Builds** (Completed)
   - Deterministic output via `SOURCE_DATE_EPOCH`, content-hashed filenames
   - `Dockerfile.build` for isolated verification
   - `CHECKSUMS.txt` in GitHub Releases, SLSA provenance attestation
   - `scripts/verify-build.sh [version]` for operator verification

8. **Field-Level Encryption (Phases 1-2D)** (Completed)
   - Phase 1: User PII — names, phones envelope-encrypted (LABEL_USER_PII)
   - Phase 2A: Org metadata — role names, shift names hub-key encrypted
   - Phase 2B: Report types, custom field labels hub-key encrypted
   - Phase 2C: Team names, tag names hub-key encrypted
   - Phase 2D: Contact directory — two-tier contact encryption (PBAC-controlled)
   - Zero plaintext PII in database

9. **IdP Auth Hardening (Epic 99)** (Completed)
   - Multi-factor KEK: PIN + IdP value + optional WebAuthn PRF
   - Authentik integration for IdP-bound nsecSecret
   - Synthetic fallback for device-link flows, auto-rotation to real IdP
   - KEK rotation inside crypto worker (nsec never on main thread)

10. **Tier 1 HPKE Migration** (Completed)
    - HPKE RFC 9180 suite: DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM
    - Wire format: `HpkeEnvelope { v: 3, labelId, enc, ct }` with `buildAad(label, recordId, fieldName)`
    - Hub key distribution migrated from ECIES to HPKE (`hpkeSeal` / `hpkeOpen`)
    - Hub field encryption migrated from XChaCha20-Poly1305 to AES-256-GCM via non-extractable WebCrypto CryptoKey
    - HPKE private key held as non-extractable CryptoKey in crypto worker closure
    - CI grep guardrails block new callers of legacy `@noble/ciphers/chacha` or `secp256k1.getSharedSecret`
    - Legacy ECIES retained as sidecar for: envelope PII, blasts, backup, provisioning, key-store PIN-KEK, server-side crypto

11. **Tier 6 MLS Migration** (Completed)
    - MLS (RFC 9420) via vendored @wireapp/core-crypto WASM in crypto worker
    - Persistent MLS group per hub (`llamenos:hub:<hubId>`)
    - Notes and messages encrypted/decrypted through group ratchet tree
    - Epoch advances on membership change provide forward secrecy
    - Deleted legacy ECIES per-note/per-message envelope loop
    - Inbound webhook messages: server AES-GCM at ingest → MLS-encrypted by first client to fetch

12. **Epic 75: Native Clients** (Future)
    - Tauri desktop (macOS + Windows)
    - React Native mobile (Twilio RN SDK)
    - Two-tier push encryption (wake key + nsec)

## Key Architecture Principles

### 1. Hub Key is Random (Not Derived)

**Old (BROKEN):** `hubKey = HKDF(adminNsec, hubId)` — compromise of admin nsec reveals all hub keys past and future.

**New:** `hubKey = crypto.getRandomValues(32)` — random, HPKE-wrapped for each member individually (previously ECIES-wrapped, migrated to HPKE). Rotation generates a genuinely new key with no mathematical link to the old one.

### 2. Server is Authoritative for State, Relay for Events

- **REST for state mutations**: answer call, create note, reassign conversation
- **Nostr for event propagation**: call:ring, call:answered, presence (broadcast to subscribers)
- **REST for state recovery**: on reconnect, poll `/api/calls/active`, `/api/conversations`

### 3. Ephemeral Nostr Events (Not Replaceable)

Kind 20001 (ephemeral) — relay forwards to subscribers but never stores. Kind 1 (regular) for persistent events like shift updates.

### 4. Generic Event Tags (No Operational Tempo Leak)

All events use `["t", "llamenos:event"]`. Actual event type is INSIDE the encrypted content. Relay cannot distinguish `call:ring` from `typing`.

### 5. Presence RBAC Preserved

Two separate presence events:
- Hub-key encrypted: `{ hasAvailable: boolean }` for all members
- Per-admin ECIES: `{ available: N, onCall: N, total: N }` for admins only

### 6. Multi-Admin from Day One

Every admin envelope is per-admin ECIES. Adding/removing admins wraps/revokes keys individually. No shared admin secret.

### 7. nsec Never on Main Thread

The crypto worker holds the nsec in a closure. The main thread communicates via `postMessage` with request/response IDs. Rate limiting in the worker auto-locks on abuse. This prevents XSS from trivially exfiltrating the key — an attacker would need to use the worker API, which is rate-limited and auto-locks.

### 8. HPKE Replaces ECIES for New Crypto Paths

**Tier 1 primitive**: HPKE RFC 9180 with DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM. Wire format: `HpkeEnvelope { v: 3, labelId, enc, ct }` with AAD binding `buildAad(label, recordId, fieldName)`. Hub key distribution and hub field encryption are fully migrated to HPKE/AES-256-GCM. Legacy ECIES (secp256k1 ECDH + XChaCha20-Poly1305) is retained as a sidecar for envelope PII, blasts, backup, provisioning, and key-store PIN-KEK. CI guardrails prevent new ECIES callers. See `docs/security/HPKE_MIGRATION_NOTES.md`.

### 9. MLS Replaces Per-Note/Per-Message Envelopes

**Tier 3 primitive**: MLS (RFC 9420) via @wireapp/core-crypto WASM. Each hub has a persistent MLS group (`llamenos:hub:<hubId>`). Notes and messages are encrypted/decrypted through the group's ratchet tree — no per-recipient key wrapping required. Epoch advances on membership change provide forward secrecy that the old ECIES envelope loop could not achieve. The legacy per-note/per-message ECIES envelope code has been deleted for notes and messages.

### 10. Honest Trust Boundaries

| Claim | Reality |
| ----- | ------- |
| "Server can't read content" | TRUE for stored data. Server sees outbound SMS/WhatsApp plaintext momentarily (inherent provider limitation). |
| "Multi-factor protects the nsec" | TRUE. Need PIN + IdP value + optionally WebAuthn PRF. Single factor compromise is insufficient. |
| "E2EE for all messages" | TRUE for storage. FALSE for the SMS/WhatsApp transport layer (provider sees plaintext — inherent). |
| "Audio never leaves device" | TRUE for transcription. Audio is captured locally only (volunteer mic). |
| "Hub key protects org metadata" | TRUE. Server stores ciphertext. But hub key is shared — any hub member can decrypt Tier 2 data. |
| "MLS provides forward secrecy for notes/messages" | TRUE. Epoch advances on membership change mean departed members cannot decrypt new data. But MLS does not provide backward secrecy — a member added mid-epoch can decrypt prior messages in that epoch. |
| "HPKE replaces ECIES" | PARTIALLY TRUE. Hub key distribution and hub field encryption use HPKE. Envelope PII, blasts, backup, provisioning, and key-store PIN-KEK still use legacy ECIES. Migration is planned but not complete. |

## Implementation Checklist

### Before Starting (Epic 76.0) — Complete

- [x] Domain separation labels audited and fixed (`src/shared/crypto-labels.ts`, 30+ constants)
- [x] Provisioning SAS verification implemented
- [x] Emergency key revocation procedures documented
- [x] Threat model updated with all new trust parties
- [x] Backup file privacy fixed

### Architecture Proven (Epics 76.1 + 76.2) — Complete

- [x] Worker-to-relay publishing PoC passing latency budget (<1s)
- [x] Hub key as random secret with ECIES distribution working
- [x] Multi-admin envelope pattern working
- [x] Correct NIP-44 usage verified

### Per-Feature Implementation — Complete

All features verified:

1. [x] Data flow designed (E2EE from the start)
2. [x] Correct domain separation label used (all labels in `crypto-labels.ts`)
3. [x] Key distribution planned (multi-admin compatible)
4. [x] E2E tests written
5. [x] Performance impact assessed
6. [x] Documentation updated

### Field-Level Encryption — Complete

- [x] Tier 1 envelope encryption for all PII fields
- [x] Tier 2 hub-key encryption for all org metadata
- [x] Tier 3 MLS groupwise encryption for notes, messages, reports
- [x] Decrypt-on-fetch pattern across all React Query domains
- [x] ENCRYPTED_QUERY_KEYS exhaustiveness enforced at compile time
- [x] Zero plaintext PII in database verified

### Multi-Factor KEK — Complete

- [x] PBKDF2 + HKDF KEK derivation (2F and 3F modes)
- [x] Authentik IdP integration for nsecSecret factor
- [x] Synthetic fallback for device-link flows
- [x] Auto-rotation from synthetic to real IdP value
- [x] KEK re-encryption inside crypto worker

### HPKE + MLS Migration — Complete

- [x] HPKE RFC 9180 implementation (`hpkeSeal` / `hpkeOpen` with DHKEM(X25519) + AES-256-GCM)
- [x] Hub key distribution migrated from ECIES to HPKE
- [x] Hub field encryption migrated from XChaCha20-Poly1305 to AES-256-GCM via non-extractable WebCrypto CryptoKey
- [x] MLS groupwise encryption for notes and messages via @wireapp/core-crypto WASM
- [x] Crypto worker updated with HPKE + MLS operations and non-extractable key handles
- [x] CI grep guardrails blocking new ECIES callers
- [x] Legacy ECIES retained as sidecar for remaining call sites (documented)

### Implementation Verification — In Progress

- [x] Server code audit: no private keys held, no plaintext access paths
- [x] Database schema audit: only ciphertext stored for sensitive data
- [x] Network audit: real-time via relay only (WebSocket code deleted)
- [ ] External penetration test of architecture
- [x] Documentation complete and honest about limitations
- [x] Security page updated

## Resolved Design Decisions

1. **Multi-hub key management**: Each hub has an independent random key. Clients store multiple hub keys indexed by hub ID and key version. Hub switcher UI selects the active hub context.

2. **Relay architecture**: Single self-hosted relay (strfry for Docker/K8s). Federation deferred — single relay is sufficient for the target scale. REST polling fallback for state recovery on reconnect.

3. **Offline support**: Notes support full offline operation (local encrypted drafts). Calls require connectivity (telephony is inherently online). Messages queue locally and send when connected.

4. **Transcription scope**: Local microphone only via WASM Whisper (Epic 78). Remote party audio requires replacing Twilio SDK with raw WebRTC — deferred to post-MVP. This is a known limitation documented in the security model.

5. **KEK factor design**: Concatenation + HKDF rather than XOR. HKDF is a proper key derivation function that handles uneven entropy distribution across factors. Separate info labels for 2F vs 3F prevent factor-count downgrade attacks.

## Success Metrics

| Metric | Target |
| ------ | ------ |
| Server private key access | Zero (server has only its own nsec + user npubs) |
| Server plaintext content access | Zero stored (outbound SMS/WhatsApp momentary, discarded) |
| Metadata visible to server | Zero plaintext PII; minimal routing metadata only |
| External data flows | Zero for audio (local transcription) |
| Verification possible | Yes (reproducible builds, GitHub Release checksums) |
| User experience impact | Minimal (< 1s latency increase) |
| nsec exposure surface | Crypto worker only; never on main thread |
| KEK factors required | Minimum 2 (PIN + IdP); optional 3rd (WebAuthn PRF) |

## Source Files

| File | Role |
|------|------|
| `src/shared/crypto-labels.ts` | All domain separation constants (88 constants: 76 LABEL_* exports, 63 branded CryptoLabel, 42 wire-indexed in LABEL_REGISTRY) |
| `src/shared/crypto-types.ts` | Branded `Ciphertext` and `HmacHash` types |
| `src/shared/hpke-primitives.ts` | HPKE RFC 9180 implementation: `hpkeSeal()` / `hpkeOpen()`, suite config |
| `src/shared/hpke-envelope.ts` | `HpkeEnvelope` wire format `{ v: 3, labelId, enc, ct }`, `buildAad()` |
| `src/shared/crypto-suite.ts` | Crypto suite constants and configuration |
| `src/client/lib/crypto-worker.ts` | Web Worker — holds nsec, HPKE private key, hub key, MLS instance |
| `src/client/lib/crypto-worker-client.ts` | Main-thread typed RPC client for crypto worker |
| `src/client/lib/key-manager.ts` | Singleton key manager — multi-factor unlock |
| `src/client/lib/key-store-v2.ts` | KEK derivation (PBKDF2 + HKDF), encrypted storage |
| `src/client/lib/hub-key-manager.ts` | Hub key generation, HPKE wrapping, rotation |
| `src/client/lib/hub-key-cache.ts` | Module-level hub key cache (Map<hubId, CryptoKey>) |
| `src/client/lib/hub-field-crypto.ts` | Tier 2 AES-256-GCM encrypt/decrypt with per-record AAD |
| `src/client/lib/decrypt-fields.ts` | Tier 1 decrypt-on-fetch utilities (legacy ECIES) |
| `src/client/lib/mls/conversation.ts` | MLS group management — encrypt/decrypt via @wireapp/core-crypto |
| `src/client/lib/query-client.ts` | ENCRYPTED_QUERY_KEYS, invalidation |
| `src/client/lib/auth.tsx` | Unlock flow: hub key load → query invalidation |
| `src/server/db/crypto-columns.ts` | Drizzle column type helpers |
| `src/server/messaging/router.ts` | Server-side AES-GCM encryption on webhook ingest |
| `vendor/@wireapp/core-crypto/` | Vendored MLS WASM implementation (RFC 9420) |
| `docs/security/HPKE_MIGRATION_NOTES.md` | HPKE migration status, remaining ECIES call sites, CI guardrails |
