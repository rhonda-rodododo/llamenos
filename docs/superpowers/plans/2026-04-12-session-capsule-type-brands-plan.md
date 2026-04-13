# Session Capsule Type Brands — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-12-session-capsule-type-brands-design.md`

## Step 1 — Add brands and helpers to `src/shared/crypto-types.ts`

Add:

- `HexString<N extends number = number>` generic brand
- `SessionToken`, `CapsuleNonceHex`, `EncryptedNsecHex`, `PubkeyHash16`
- `isHex(s: string, length?: number): boolean`
- `asHex<N>(s, length)` — throws on mismatch
- `tryHex<N>(s, length)` — returns null on mismatch
- Named convenience constructors + `try*` variants for the four new brands
- `asEncryptedNsec` / `tryEncryptedNsec` — only validate hex, no length check

Export everything at the module top-level so both shared and client code
can import from `@shared/crypto-types`.

**Verify:** `bun run typecheck` — no regression.

## Step 2 — Unit tests for the helpers

New file `src/shared/__tests__/crypto-types.test.ts`:

- `isHex` accepts lowercase/uppercase hex, rejects non-hex, empty string.
- `isHex` with length enforces exact match.
- `tryHex` returns null on wrong length, returns branded value on match.
- `asHex` throws on mismatch.
- `asSessionToken(64-char-hex)` round-trips.
- `asCapsuleNonce` rejects `SessionToken`-shaped input (length mismatch).
- `asEncryptedNsec` accepts any hex length but rejects non-hex.

**Verify:** `bun run test:unit -- src/shared/__tests__/crypto-types.test.ts`.

## Step 3 — Create `src/client/lib/cross-tab-messages.ts`

Declare:

- `SyncRequestMessage`, `SyncResponseMessage`, `LockMessage`
- Union `CrossTabMessage`
- `parseSyncMessage(data: unknown)` — returns a `SyncRequestMessage | SyncResponseMessage | null`
- `parseLockMessage(data: unknown)` — returns `LockMessage | null`
- Channel name constants: `LOCK_CHANNEL_NAME`, `SYNC_CHANNEL_NAME`

Parse functions:

- Null-guard + object check.
- Switch on `data.type`.
- `request-token`: require `nonce: string`, `pubkeyHash` as 16-hex.
- `token-response`: above + `token` as 64-hex.
- Reject anything else.

## Step 4 — Unit tests for cross-tab-messages

New file `src/client/lib/cross-tab-messages.test.ts`:

- `parseSyncMessage` accepts well-formed request + response.
- Rejects missing fields, wrong discriminants, wrong hex length, non-string fields, non-object input.
- `parseLockMessage` accepts `{type:'lock'}`, rejects everything else.

**Verify:** `bun run test:unit -- src/client/lib/cross-tab-messages.test.ts`.

## Step 5 — Harden `src/client/lib/session-capsule.ts`

- Import `EncryptedNsecHex`, `CapsuleNonceHex`, `PubkeyHash16`, `SessionToken`, `tryHex`, `tryEncryptedNsec` from `@shared/crypto-types`.
- Import `SyncRequestMessage`, `SyncResponseMessage`, `parseSyncMessage`, `SYNC_CHANNEL_NAME` from `./cross-tab-messages`. Delete the local copies and the `SyncMessage` union alias.
- `SessionCapsule` fields become branded.
- Add `parseSessionCapsule(raw: unknown): SessionCapsule | null` — validates all four fields, returns a fresh object.
- `idbGet()` wraps its result in `parseSessionCapsule`; on null, log once and return null.
- Update `updateAutoLockExpiry` to operate on the parsed capsule and pass through the branded fields untouched.
- `storeCapsule(token: SessionToken, capsule: SessionCapsule)`.
- `loadCapsule(currentPubkeyHash: PubkeyHash16)` — signature updated; internal handlers use parsed types.
- `respondToSyncRequest` + sibling response handler use `parseSyncMessage` on `e.data`. No more manual `msg.type !== '...'` discriminant check at top level.
- Re-export `SessionCapsule` type, `SESSION_TOKEN_KEY`, `parseSessionCapsule`.

**Verify:** `bun run typecheck`.

## Step 6 — Extend session-capsule tests

`src/client/lib/session-capsule.test.ts`:

- Update `makeCapsule` / fixtures to cast plain strings through the
  brand constructors so the test stays type-safe.
- Add `parseSessionCapsule` test block: happy path, missing field,
  wrong length hex, negative expiry, non-object.
- Add `idbGet returns null on tampered raw IDB record`: put an
  unstructured object directly into the fake IDB store and confirm
  `loadCapsule` returns null without throwing.

**Verify:** `bun run test:unit -- src/client/lib/session-capsule.test.ts`.

## Step 7 — Worker handler rename

`src/client/lib/crypto-worker.ts`:

- `handleExportSession` return shape: `{ tokenHex, encryptedNsecHex, capsuleNonceHex }` (was `token`).
- `WorkerRequest` discriminant union stays at raw `string` on the wire; no brand imports into the worker file (the worker is a separate bundle).

## Step 8 — Generic `call<R>` + branded surface in `crypto-worker-client.ts`

- Change `call(message)` to `call<R = unknown>(message): Promise<R>`.
  Cast `resolve as (v: unknown) => void` inside the pending map.
- Replace every `(await this.call({...})) as T` with `await this.call<T>({...})`.
- `exportSession()` returns `{ tokenHex: SessionToken; encryptedNsecHex: EncryptedNsecHex; capsuleNonceHex: CapsuleNonceHex }` via `asSessionToken` / `asCapsuleNonce` / `asEncryptedNsec` at the seam — the worker's hex comes from `bytesToHex`, so the lengths are known-good; use `asHex` not `tryHex` and let any length mismatch throw.
- `importSession(tokenHex: SessionToken, encryptedNsecHex: EncryptedNsecHex, capsuleNonceHex: CapsuleNonceHex)`.

**Verify:** `bun run typecheck`.

## Step 9 — Update `src/client/lib/key-manager.ts`

- Import `LockMessage`, `parseLockMessage`, `LOCK_CHANNEL_NAME` from `./cross-tab-messages`. Delete the local `LOCK_CHANNEL_NAME` constant.
- `getLockChannel` → use `parseLockMessage(e.data)` in its onmessage handler.
- Three call sites that bridge `exportSession` → `storeCapsule`:
  - `rotateSyntheticToReal`, `rotateKEK` (line ~229), and `unlock` (line ~417).
  - Each unpacks `session.tokenHex` (was `session.token`) into `storeCapsule(session.tokenHex, { encryptedNsec: session.encryptedNsecHex, capsuleNonce: session.capsuleNonceHex, ... })`.
- `trySessionRestore` passes branded values through to `cryptoWorker.importSession(loaded.token, loaded.capsule.encryptedNsec, loaded.capsule.capsuleNonce)`.
- The `pubkeyHash` the manager computes for `storeCapsule` comes from `blob.pubkeyHash` which is a plain `string` today — wrap it once via `asPubkeyHash16` (or `tryPubkeyHash16` with a throw-on-null guard) at the bridge point so the branded surface is complete.

**Verify:** `bun run typecheck`.

## Step 10 — Full verification

Run in order:

```bash
bun run typecheck
bun run lint
bun run test:unit -- src/shared src/client/lib
bun run build
```

All must pass. No `--no-verify`. No skipping.

## Step 11 — Commit, push, PR

- Single commit per logical chunk is fine — two commits total is acceptable here:
  1. `chore(deps): restore shamir-secret-sharing dependency` (prerequisite for green typecheck on main)
  2. `refactor(crypto): brand session-capsule hex fields and consolidate cross-tab messages`
- Push branch, open PR against `main`, link spec + plan in body, note risk surface (type-only, no wire changes).
