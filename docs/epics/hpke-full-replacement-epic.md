# Epic: HPKE Full Replacement

**Goal:** Replace every remaining ECIES (secp256k1 ECDH + SHA-256 + XChaCha20-Poly1305) usage with HPKE RFC 9180, then delete the ECIES sidecar entirely.

**Assumptions:** Pre-production — TRUNCATE migrations, no backwards compatibility, clean cuts only.

**Brainstorm:** `docs/brainstorms/hpke-full-replacement-brainstorm.md`

---

## Slice 1: Wire Format & Type Foundation

**Goal:** Replace `RecipientEnvelope` / `KeyEnvelope` / `FileKeyEnvelope` / `Envelope` types with HPKE-based equivalents. Update all DB schema columns, zod schemas, and route type casts.

**Files touched (~35):**
- `src/shared/types.ts` — Replace `RecipientEnvelope`, `KeyEnvelope`, `Envelope` with HPKE envelope types. `RecipientEnvelope` becomes `{ pubkey: string; v: 3; labelId: number; enc: string; ct: string }`. `KeyEnvelope` is deprecated → alias to HPKE equivalent. `Envelope` v2 → v3.
- `src/shared/schemas/records.ts` — Update `RecipientEnvelopeSchema`, `KeyEnvelopeSchema` to match HPKE wire format (`v`, `labelId`, `enc`, `ct` instead of `wrappedKey`, `ephemeralPubkey`).
- `src/shared/schemas/files.ts` — Update `FileKeyEnvelopeSchema` to HPKE format.
- `src/shared/schemas/contacts.ts`, `conversations.ts`, `firehose.ts`, `sessions.ts`, `passkeys.ts`, `signal-contact.ts`, `auth-events.ts`, `intakes.ts` — These import `RecipientEnvelopeSchema` from `records.ts` — should auto-cascade.
- `src/server/db/schema/contacts.ts`, `records.ts`, `conversations.ts`, `blasts.ts`, `identity.ts`, `sessions.ts`, `signal-contacts.ts`, `push-subscriptions.ts`, `intakes.ts`, `auth-events.ts` — Update `jsonb<RecipientEnvelope[]>()` column types.
- `src/server/types.ts` — Update all `RecipientEnvelope[]` and `KeyEnvelope` usages.
- `src/server/routes/*` — Update type casts (`as RecipientEnvelope[]`, etc.).
- `src/shared/crypto-primitives.ts` — Delete `KeyEnvelope`, `RecipientKeyEnvelope`, `decryptEnvelope` exports. Delete `eciesWrapKey`, `eciesUnwrapKey`, `eciesUnwrapKeyWithSecret`. Keep `symmetricEncrypt`/`symmetricDecrypt`, key management, and HMAC/HKDF utilities.
- `src/shared/crypto-envelopes.ts` — Delete `encryptNote`, `decryptNoteWithKey`, `encryptMessage`, `encryptBlastContent`, `decryptBlastContentWithKey`. These are replaced by HPKE-based equivalents (new file or rewritten in place).

**Migration:** TRUNCATE (new migration `0055_hpke_envelope_v3_full.sql` or similar). Drops all encrypted data and re-seeds.

**Dependencies:** None — this is the foundation slice.

**Verification:** `bun run typecheck` (will have many errors from callers until subsequent slices land — this slice can use `// @ts-expect-error` on type changes IF needed, or alternatively, the type changes and caller migrations can be co-committed per domain).

**Alternative approach:** Instead of a big-bang type change, do the type change per-domain (one slice per domain). This is safer but slower. Given pre-production, the big-bang approach is preferred — we do the type change once and fix all callers.

---

## Slice 2: Crypto Worker HPKE-Only Migration

**Goal:** Remove ECIES `eciesWrap`/`eciesUnwrap` from the crypto worker. Migrate `handleEncrypt`/`handleDecrypt` to use HPKE. Migrate `envelopeEncryptField`/`decryptEnvelopeField` to HPKE.

**Files touched (~4):**
- `src/client/lib/crypto-worker.ts` — Delete `eciesWrap()`, `eciesUnwrap()`. Rewrite `handleEncrypt` to call `hpkeSeal` via the worker's X25519 key. Rewrite `handleDecrypt` to call `hpkeOpen`. Rewrite `envelopeEncryptField` to use HPKE seal per recipient. Rewrite `decryptEnvelopeField` to use HPKE open. Remove `@noble/ciphers/chacha` and `secp256k1` imports (keep `schnorr` for signing).
- `src/client/lib/crypto-worker-client.ts` — Update RPC type signatures for `encrypt`, `decrypt`, `envelopeEncryptField`, `decryptEnvelopeField` to match new HPKE request/response shapes.
- `src/client/lib/crypto-worker-helpers.ts` — Replace `eciesUnwrapKey` helper with HPKE-based equivalent. Update `decryptNote`, `decryptMessage`, `decryptBlast`, `decryptCallRecord` to use HPKE open.
- `src/client/lib/crypto-worker.ts` `handleProvisionNsec` — Rewrite provisioning nsec transfer to use HPKE seal (see Slice 5 for the full provisioning rewrite, but the worker handler changes here).

**Key design:** The worker already holds `hpkePrivateKey` (X25519 CryptoKey) from `unlockWithHandles`. The HPKE sidecar handlers (`hpkeSeal`, `hpkeOpen`) are already there. The migration is: delete the ECIES handlers, make the old `encrypt`/`decrypt` message types route to the HPKE handlers.

**Dependencies:** Slice 1 (types must be updated first).

---

## Slice 3: Server-Side ECIES → HPKE

**Goal:** Migrate all server-side ECIES operations to HPKE via `HpkeService`.

**Files touched (~8):**
- `src/server/lib/crypto-service.ts` — Remove `eciesWrapKey`/`eciesUnwrapKey` imports. Rewrite `encryptAndWrap`, `decryptWithEnvelope`, `encryptForRecipients`, `decryptForRecipient` to use HPKE. Rewrite `unwrapHubKey`, `generateAndWrapHubKey`, `wrapHubKeyForNewMember` to use HPKE with X25519 server key. The server's X25519 key is already available in `HpkeService` — either inject it or derive a second X25519 key from `SERVER_NOSTR_SECRET`.
- `src/server/lib/hpke-service.ts` — May need new methods for multi-recipient HPKE seal (if not already there).
- `src/server/jobs/blast-processor.ts` — Update blast content decryption from ECIES to HPKE.
- `src/server/lib/voicemail-storage.ts` — Update voicemail encryption from ECIES to HPKE.
- `src/server/routes/dev.ts` — Rewrite `wrapHubKeyForPubkey` test helper to use HPKE.
- `src/server/lib/crypto-service.test.ts` — Rewrite hub key and envelope tests.
- `src/server/jobs/blast-processor.test.ts` — Update test.
- `src/server/messaging/router.ts` — Update inbound message encryption path.

**Key design:** Server needs an X25519 keypair for HPKE operations. Options:
1. Derive from `SERVER_NOSTR_SECRET` via HKDF with a new info label (e.g., `LABEL_SERVER_X25519_KEY`). This is the cleanest — one secret, two derived keys (secp256k1 for Nostr signing, X25519 for HPKE).
2. Use the existing `HpkeService` which already has a server HPKE key.

**Dependencies:** Slice 1 (types), can be done in parallel with Slice 2.

---

## Slice 4: Client PII Decryption & Encryption Migration

**Goal:** Migrate all client-side PII envelope encryption/decryption to HPKE.

**Files touched (~15):**
- `src/client/lib/decrypt-fields.ts` — Update `resolveEncryptedFields` to work with HPKE envelope shape. Update `decryptObjectFields`/`decryptArrayFields` to use HPKE open.
- `src/client/lib/queries/notes.ts` — Update note decryption path (if any ECIES remnants — MLS handles most now).
- `src/client/lib/queries/calls.ts` — Update call record decryption.
- `src/client/lib/queries/blasts.ts` — Update blast decryption.
- `src/client/lib/queries/conversations.ts` — Update conversation message decryption.
- `src/client/lib/queries/contacts.ts` — Update contact field decryption.
- `src/client/lib/queries/reports.ts` — Update report decryption.
- `src/client/lib/api/conversations.ts` — Update `MessageKeyEnvelope` type.
- `src/client/lib/api/notes.ts` — Update note envelope types.
- `src/client/lib/api/bans.ts` — Update ban envelope types.
- `src/client/components/contacts/create-contact-dialog.tsx` — Update contact encryption to use HPKE.
- `src/client/components/contacts/import-contacts-dialog.tsx` — Update bulk import encryption.
- `src/client/components/ReportForm.tsx` — Update report encryption.
- `src/client/components/voicemail-player.tsx` — Update voicemail decryption.
- `src/client/routes/calls.$callId.tsx` — Update call detail decryption.

**Dependencies:** Slices 1 + 2 (types + worker).

---

## Slice 5: File Crypto & Provisioning Migration

**Goal:** Migrate file encryption and device provisioning from ECIES/secp256k1 to HPKE/X25519.

**Files touched (~6):**
- `src/client/lib/file-crypto.ts` — Rewrite `encryptFile` to use `hpkeSeal` for key wrapping and HPKE-based metadata encryption. Rewrite `decryptFile` and `rewrapFileKey` to use `hpkeOpen`. Remove `encryptMetadataForPubkey` raw ECDH path — use HPKE single-shot instead.
- `src/client/lib/file-upload.ts` — Update types and encryption calls.
- `src/client/lib/file-crypto.test.ts` — Rewrite all ECIES-based test helpers.
- `src/client/lib/provisioning.ts` — Rewrite `decryptProvisionedNsec`, `encryptNsecForDevice`, `computeSharedX`, SAS functions to use X25519 (either via HPKE or raw X25519 ECDH). SAS verification needs X25519 shared secret instead of secp256k1.
- `src/client/lib/crypto-worker.ts` `handleProvisionNsec` — (if not fully done in Slice 2) complete the X25519 HPKE transition for provisioning.

**Dependencies:** Slices 1 + 2.

---

## Slice 6: Hub Key Cache & Distribution Cleanup

**Goal:** Ensure hub key distribution is fully on HPKE end-to-end (client cache + server operations).

**Files touched (~4):**
- `src/client/lib/hub-key-cache.ts` — Replace `eciesUnwrapKey` call with HPKE open. The hub key envelope from the server is now an HPKE envelope.
- `src/server/routes/hubs.ts` — Update hub key distribution endpoints to handle HPKE envelopes.
- `src/server/routes/setup.ts` — Update initial hub key generation.
- `src/server/routes/invites.ts` — Update hub key wrapping for new members.

**Note:** `hub-key-manager.ts` (client-side) was already migrated to HPKE per the migration notes. This slice cleans up the server-side and cache-side remnants.

**Dependencies:** Slices 1 + 3.

---

## Slice 7: Symmetric XChaCha20 → AES-256-GCM & Full Cleanup

**Goal:** Migrate remaining symmetric-only XChaCha20 uses to AES-256-GCM, then remove `@noble/ciphers/chacha` dependency entirely. Delete all ECIES code. Update CI guardrails.

**Files touched (~15):**
- `src/client/lib/key-store.ts` — Replace `xchacha20poly1305` with WebCrypto `AES-GCM` or `@noble/ciphers/aes` AES-256-GCM. Nonce changes from 24 bytes to 12 bytes.
- `src/client/lib/backup.ts` — Same XChaCha20 → AES-GCM conversion.
- `src/client/lib/crypto-worker.ts` — Remove `xchacha20poly1305` import, update `handleUnlock`/`handleReEncrypt`/`handleExportSession`/`handleImportSession` to AES-GCM.
- `src/shared/crypto-envelopes.ts` — If any symmetric helpers remain (drafts, exports), convert to AES-GCM. Or delete entirely if all callers have migrated.
- `src/shared/crypto-primitives.ts` — Convert `symmetricEncrypt`/`symmetricDecrypt` from XChaCha20 to AES-256-GCM. This cascades to `CryptoService.serverEncrypt`/`serverDecrypt` and hub-field primitives.
- `src/server/lib/hub-event-crypto.ts` — XChaCha20 → AES-GCM.
- `src/server/lib/agent-identity.ts` — XChaCha20 → AES-GCM.
- `src/server/idp/authentik-adapter.ts` — XChaCha20 → AES-GCM.
- `src/shared/crypto-labels.ts` — Update comments that reference "ECIES". Add/update comments to reference HPKE.
- `src/shared/crypto-types.ts` — Update `Ciphertext` documentation, `SessionCapsuleNonce` from 24-byte to 12-byte.
- **CI grep guardrails** — Tighten from "no new ECIES callers" to "no ECIES callers at all". Block `@noble/ciphers/chacha`, `secp256k1.getSharedSecret`, `eciesWrapKey`, `eciesUnwrapKey`. The only remaining `secp256k1` import should be `schnorr` for signing.
- **Test files** — Update all test files that import `xchacha20poly1305` or `ecies*` functions.
- `package.json` — Verify `@noble/ciphers` can be removed (or kept only if other `@noble/ciphers` exports are used, e.g., `utils.js`).

**TRUNCATE migration:** New migration wipes all encrypted data (key-store blobs, session capsules, hub event data, agent identity blobs, provider configs). Pre-production so this is fine.

**Dependencies:** All previous slices.

---

## Summary: Slice Dependency Graph

```
Slice 1 (Types + Wire Format)
├── Slice 2 (Crypto Worker)
│   ├── Slice 4 (Client PII)
│   └── Slice 5 (Files + Provisioning)
├── Slice 3 (Server ECIES → HPKE)  ← can run in parallel with Slice 2
│   └── Slice 6 (Hub Key Cache)
└── Slice 7 (Symmetric Cleanup + Delete ECIES)  ← after ALL above
```

**Parallelizable:** Slices 2 and 3 can run in parallel. Slices 4, 5, and 6 can run in parallel (after their deps).

---

## PR Sizing

| Slice | Est. Files | Complexity | PR Title |
|-------|-----------|------------|----------|
| 1 | ~35 | High | `feat(sec): HPKE wire format — replace RecipientEnvelope types` |
| 2 | ~4 | High | `feat(sec): crypto worker ECIES → HPKE migration` |
| 3 | ~8 | Medium | `feat(sec): server-side ECIES → HPKE migration` |
| 4 | ~15 | Medium | `feat(sec): client PII envelope encryption → HPKE` |
| 5 | ~6 | Medium | `feat(sec): file crypto + provisioning → HPKE/X25519` |
| 6 | ~4 | Low | `feat(sec): hub key distribution HPKE cleanup` |
| 7 | ~15 | Medium | `feat(sec): XChaCha20 → AES-GCM + remove ECIES sidecar` |

---

## CI Guardrail Updates (Slice 7)

Current guardrails (Tier 1):
- `TIER1_LEGACY_ALLOW` list permits specific files to import `@noble/ciphers/chacha` and call `getSharedSecret`
- "No new ECIES callers" — blocks files outside the allow list

Target guardrails (post-epic):
- **Hard block on ALL `@noble/ciphers/chacha` imports** — no allow list
- **Hard block on ALL `secp256k1.getSharedSecret` calls** — only `schnorr.*` allowed from `@noble/curves/secp256k1`
- **Hard block on `eciesWrapKey` / `eciesUnwrapKey` / `eciesUnwrapKeyWithSecret`** — these functions will be deleted
- **Hard block on `RecipientEnvelope` with `wrappedKey`/`ephemeralPubkey` shape** — all envelopes must be HPKE format
- **Block `xchacha20poly1305` anywhere** — zero uses after full migration

---

## Rollback Strategy

Pre-production → no rollback needed. If a slice breaks, fix forward or `git revert` the PR. TRUNCATE migration means no data to preserve.

---

## Open Questions

1. **Server X25519 key derivation:** Derive from `SERVER_NOSTR_SECRET` with a new HKDF label, or use the existing `HpkeService` key? Recommendation: use `HpkeService` — it already has the key management.

2. **Provisioning SAS with X25519:** Keep ECDH-based SAS (just switch curve) or derive SAS from HPKE `enc` bytes? Recommendation: keep ECDH-based SAS with X25519 — it's cleaner and the SAS derivation is well-understood.

3. **Nonce size for symmetric AES-GCM (Slice 7):** 12 bytes (standard) vs 12 bytes with counter (safer for high-volume). Recommendation: 12-byte random nonces — volume is too low to worry about birthday attacks.

4. **`@noble/ciphers` package retention:** After removing `chacha`, check if `utils.js` (`utf8ToBytes`, `bytesToHex`) is still needed. If yes, keep the package. If those utils come from `@noble/hashes/utils`, remove `@noble/ciphers` entirely. Note: `utf8ToBytes` is imported from `@noble/ciphers/utils.js` in several files, but `@noble/hashes/utils` also exports `utf8ToBytes`. Can consolidate.
