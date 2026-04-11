# AEAD Audit — 2026-04-10

**Scope:** Every `ciphertext()` column in the Drizzle schema.
**Methodology:** For each column, document the encrypt call site, decrypt call site, label, AAD construction, and status (PASS / FIX / INFO). FIX rows are tracked for resolution in subsequent Tier 0 tasks per the per-schema breakdown in `docs/superpowers/plans/2026-04-10-security-tier-0-albrecht-hardening.md`.

## Schema-by-schema audit

### records / bans

Source files audited:

- Schema: `src/server/db/schema/records.ts`
- Server write sites: `src/server/services/records.ts`
- Bans route: `src/server/routes/bans.ts`
- Client decrypt sites: `src/client/lib/queries/bans.ts`, `src/client/routes/calls.$callId.tsx`, `src/client/lib/queries/notes.ts`
- Crypto primitives: `src/server/lib/crypto-service.ts`

| Column | Label | AAD (actual) | Encrypt site | Decrypt site | Status |
|---|---|---|---|---|---|
| `bans.encrypted_phone` | `LABEL_USER_PII` | `utf8Bytes(LABEL_USER_PII)` — label only, **not** bound to `banId` | `records.ts#addBan` / `records.ts#bulkAddBans` (via `crypto.envelopeEncrypt(..., LABEL_USER_PII)`; falls back to `crypto.serverEncrypt(..., LABEL_USER_PII)` when no recipient pubkeys) | `queries/bans.ts#useBans` (queryFn decrypts via envelope; server-side fallback decrypt in `records.ts#getBans`) | **FIX** — AAD is label-only; envelopes are not bound to `banId`, so a ciphertext could be moved between bans rows of the same label without detection. Target: bind AAD to `${LABEL_USER_PII}:${banId}:encrypted_phone` on both encrypt and decrypt. |
| `bans.encrypted_reason` | `LABEL_USER_PII` | `utf8Bytes(LABEL_USER_PII)` — label only, **not** bound to `banId` | `records.ts#addBan` / `records.ts#bulkAddBans` (via `crypto.envelopeEncrypt(..., LABEL_USER_PII)`; fallback `crypto.serverEncrypt(..., LABEL_USER_PII)`) | `queries/bans.ts#useBans` (queryFn); `records.ts#getBans` server-fallback | **FIX** — same reasoning as `encrypted_phone`. Target: `${LABEL_USER_PII}:${banId}:encrypted_reason`. Also note: `LABEL_USER_PII` is shared with user PII (identity), so label alone does not even separate the bans domain from the volunteer-identity domain — AAD must bind to the column + record id, or the label must be split (e.g. `LABEL_BAN_META`). |
| `call_records.encrypted_caller_last4` | `LABEL_USER_PII` | `utf8Bytes(LABEL_USER_PII)` — label only, **not** bound to `callRecordId` or column name | `records.ts#createCallRecord` (via `crypto.envelopeEncrypt(data.callerLast4, adminPubkeys, LABEL_USER_PII)`; the envelope is only produced when `adminEnvelopes` are present, otherwise the column is left null) | `routes/calls.$callId.tsx` → `decryptObjectFields(..., LABEL_USER_PII)` (note: this goes through the shared `decryptObjectFields` helper, which currently does not thread an AAD prefix per field) | **FIX** — AAD is label-only and reused across every call record; no binding to `callRecordId` or to the field name. Target: `${LABEL_USER_PII}:${callRecordId}:encrypted_caller_last4`. The client decrypt helper `decryptObjectFields` will need to accept an AAD-suffix builder so the field name and record id can flow through. |
| `audit_log.encrypted_event` | `LABEL_AUDIT_EVENT` | `utf8Bytes(LABEL_AUDIT_EVENT)` — label only | Currently `records.ts#addAuditEntry` (via `crypto.serverEncrypt(event, LABEL_AUDIT_EVENT)`) — scheduled for replacement in Workstream 0.2 (plan Tasks 17–22) | Currently `records.ts#getAuditLog` / `records.ts#getAuditEntry` (via `crypto.serverDecrypt(..., LABEL_AUDIT_EVENT)`) | **INFO** — encrypted audit log is replaced by the hash-chained signed audit log in Workstream 0.2 (plan Tasks 17–22). This column and its sibling are removed in that workstream; no AAD fix is needed here because the storage format changes entirely. |
| `audit_log.encrypted_details` | `LABEL_AUDIT_EVENT` | `utf8Bytes(LABEL_AUDIT_EVENT)` — label only | Currently `records.ts#addAuditEntry` (via `crypto.serverEncrypt(JSON.stringify(details), LABEL_AUDIT_EVENT)`) — scheduled for replacement in Workstream 0.2 (plan Tasks 17–22) | Currently `records.ts#getAuditLog` / `records.ts#getAuditEntry` | **INFO** — same as `encrypted_event`; removed in Workstream 0.2. |

#### Notes on columns outside the `ciphertext()` type but in the same schema

The plan template originally listed `records.call_records.encrypted_content` with `LABEL_NOTE_KEY`. In the current schema that field is declared as `text('encrypted_content')` on both `call_records` and `note_envelopes`, **not** as a `ciphertext()` column. The note content is encrypted entirely client-side (E2EE, per-note forward secrecy; see `encryptNoteV2` / `decryptNoteV2` in `src/client/lib/crypto-worker-helpers.ts` and `src/client/lib/queries/notes.ts`). The server only stores the opaque ciphertext blob and never performs an AEAD operation on it, so it is not in scope for this audit. It is documented here only to record that the template entry has been intentionally removed after reality-checking the schema.

#### Per-service write-path inventory for records/bans

- `records.ts#addBan` — encrypts `phone`, `reason` with `envelopeEncrypt(..., LABEL_USER_PII)` (or `serverEncrypt` fallback). AAD binding FIX.
- `records.ts#bulkAddBans` — same as `addBan`, per row. AAD binding FIX.
- `records.ts#getBans` — decrypts via envelope (client) or `serverDecrypt(..., LABEL_USER_PII)` (server fallback). Must gain matching AAD when the write-side fix lands.
- `records.ts#createCallRecord` — optionally produces `encryptedCallerLast4` via `envelopeEncrypt(..., LABEL_USER_PII)`. AAD binding FIX.
- `records.ts#updateCallRecord` — does not touch `encryptedCallerLast4` directly; passes through `encryptedContent` verbatim (which is client-side E2EE, out of scope).
- `records.ts#createNote` / `records.ts#updateNote` — store client-provided `encryptedContent` verbatim; no server AEAD operation; out of scope.
- `records.ts#addAuditEntry` — INFO, scheduled for replacement in Workstream 0.2 (plan Tasks 17–22).
