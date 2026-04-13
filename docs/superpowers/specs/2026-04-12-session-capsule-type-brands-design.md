# Session Capsule Type Brands — Design

**Date:** 2026-04-12
**Related:** PR #50 review item #9 (type-design-analyzer)
**Backlog entry:** "Follow-up: Type-brand hardening for session-capsule types"

## Problem

The session-capsule subsystem passes hex strings through at least three
boundaries — the crypto-worker RPC, IndexedDB (`llamenos-session`), and a
cross-tab `BroadcastChannel` — and every one of those fields is plain
`string`. A field-swap bug like `encryptedNsec ↔ capsuleNonce` typechecks
cleanly today, because the compiler cannot distinguish them. The concrete
asymmetries live in three files:

- `crypto-worker.ts` — `handleExportSession` returns `{ token, encryptedNsecHex, capsuleNonceHex }`.
- `crypto-worker-client.ts` — annotates the result the same way, then `importSession` takes `tokenHex` (asymmetric with export).
- `session-capsule.ts` — IDB uses `encryptedNsec` / `capsuleNonce` (no `Hex` suffix), bridged by hand inside `key-manager.ts`.

Additionally, `CryptoWorkerClient.call` returns `Promise<unknown>`, so every
method has a trailing `as SomeType` cast — another place where a rename
drifts silently.

Finally, two cross-tab BroadcastChannel protocols live side-by-side
(`llamenos-capsule-sync` in session-capsule, `llamenos-lock` in key-manager)
with their message types declared inline in each module, making it easy to
add a third and forget validation.

## Goals

1. Make field-swap bugs in the session-capsule flow a compile-time error.
2. Reject malformed data at runtime the moment it crosses a trust boundary
   (IDB read, BroadcastChannel receive) rather than deep inside the worker.
3. Eliminate the per-method `as T` casts in `CryptoWorkerClient`.
4. Symmetrize the worker RPC field names so `exportSession` and
   `importSession` share the same vocabulary (`tokenHex`, not `token`).
5. Consolidate cross-tab message types in one module.

## Non-goals

- Wire-format changes: the postMessage payloads and the IDB schema keep the
  same field names (other than the `token → tokenHex` symmetry fix). No
  migration, no fallback.
- Runtime PII redaction of hex strings in logs. That is handled by the
  existing `Unloggable` brand and is orthogonal.
- A full zod pass over every worker RPC — the scope is session-capsule
  hex strings and the client-side `call<R>` generic, not the entire worker
  protocol.

## Design

### 1. New brands in `src/shared/crypto-types.ts`

Add a generic length-tagged hex brand plus four named instantiations. The
length parameter is a type-only marker — it carries the *expected* hex
length so accidental assignment of a 48-char nonce into a 64-char token
slot fails to compile.

```ts
export type HexString<N extends number = number> =
  string & { readonly __brand: 'HexString'; readonly __hexLen: N } & Unloggable

/** 32-byte capsule token (64 hex chars). */
export type SessionToken = HexString<64>

/** 24-byte XChaCha20 nonce (48 hex chars). */
export type CapsuleNonceHex = HexString<48>

/** Variable-length worker-encrypted nsec (XChaCha20-Poly1305 of nsec hex). */
export type EncryptedNsecHex =
  string & { readonly __brand: 'EncryptedNsecHex' } & Unloggable

/** First 16 chars of SHA-256(pubkey), used as capsule identity check. */
export type PubkeyHash16 = HexString<16>
```

Runtime helpers, all in the same module:

- `isHex(s: string, length?: number): boolean` — `length !== undefined` enforces a match.
- `asHex<N extends number>(s: string, length: N): HexString<N>` — throws on mismatch, for call sites that already know the value is trusted (e.g. the worker's own freshly-generated output).
- `tryHex<N extends number>(s: unknown, length: N): HexString<N> | null` — nullable, for untrusted input at boundaries.
- Convenience wrappers: `asSessionToken`, `asCapsuleNonce`, `asPubkeyHash16`, `asEncryptedNsec`, plus their `try*` variants.

The `Unloggable` intersection keeps the existing policy that branded hex
blobs can never be passed to a logger helper without explicit unsealing.

### 2. Generic `CryptoWorkerClient.call`

```ts
private call<R = unknown>(message: Record<string, unknown>): Promise<R> {
  const id = this.nextId()
  return new Promise<R>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id)
        reject(new Error('Crypto worker request timed out'))
      }
    }, 30_000)
    this.pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeoutId,
    })
    this.worker.postMessage({ ...message, id })
  })
}
```

Each public method calls `this.call<SpecificReturn>({ ... })`, which lets
us delete every `as string`, `as EncryptResult`, etc. cast in the file.
The `pending` map still stores the untyped resolver because the dispatch
table is dynamic — only the per-call generic narrows at the call site.

### 3. `exportSession` / `importSession` symmetry

- `handleExportSession` in the worker renames its return field from
  `token` to `tokenHex`. Worker is plain JS — this is a mechanical rename.
- `CryptoWorkerClient.exportSession` returns:
  `{ tokenHex: SessionToken; encryptedNsecHex: EncryptedNsecHex; capsuleNonceHex: CapsuleNonceHex }`
- `CryptoWorkerClient.importSession` already takes `tokenHex`; its
  parameter types become branded.
- `key-manager.ts` updates both call sites (`export` — passes to
  `storeCapsule`; `trySessionRestore` — passes to `importSession`).

### 4. `SessionCapsule` becomes typed, with a parse function

```ts
export interface SessionCapsule {
  encryptedNsec: EncryptedNsecHex
  capsuleNonce: CapsuleNonceHex
  autoLockExpiresAt: number
  pubkeyHash: PubkeyHash16
}

export function parseSessionCapsule(raw: unknown): SessionCapsule | null
```

`parseSessionCapsule` is the ONLY way a `SessionCapsule` is constructed
from untrusted input. It:

1. Checks that `raw` is a non-null object.
2. Validates every field's type and hex length via `tryHex`.
3. Validates `autoLockExpiresAt` is a finite positive number.
4. Returns a fresh object (not `raw`) so callers can't accidentally
   retain a reference to a partially-typed value.

`idbGet()` calls `parseSessionCapsule` on its raw IDB result and returns
`null` on any failure. That closes the gap where a tampered IDB entry
would propagate deeper into the system before failing in a non-obvious
way. Parse failures are logged via the existing `log()` helper so they
show up in dev debug without crashing the tab.

A trusted constructor `buildSessionCapsule({...})` is exported for call
sites that already have branded values (e.g. after `exportSession`
returns). It does no validation — the branded types guarantee shape.

### 5. Cross-tab message types in one module

New file: `src/client/lib/cross-tab-messages.ts`

```ts
export type CrossTabMessage =
  | SyncRequestMessage
  | SyncResponseMessage
  | LockMessage

export interface SyncRequestMessage {
  type: 'request-token'
  nonce: string
  pubkeyHash: PubkeyHash16
}
export interface SyncResponseMessage {
  type: 'token-response'
  nonce: string
  pubkeyHash: PubkeyHash16
  token: SessionToken
}
export interface LockMessage { type: 'lock' }

export function parseSyncMessage(data: unknown): SyncRequestMessage | SyncResponseMessage | null
export function parseLockMessage(data: unknown): LockMessage | null
```

`session-capsule.ts` imports `SyncRequestMessage`, `SyncResponseMessage`,
and `parseSyncMessage`. Its two `MessageEvent<SyncMessage>` handlers
call `parseSyncMessage(e.data)` and bail on `null`.

`key-manager.ts` imports `LockMessage` and `parseLockMessage` and does
the same for its lock-channel handler.

Nothing beyond parsing moves — each module still owns its channel
lifecycle, factory seam, and test injection. Only the type declarations
and validators are consolidated.

### 6. Test coverage

Unit tests (`src/shared/__tests__/crypto-types.test.ts`):
- `isHex` / `tryHex` — happy path, wrong length, non-hex chars, non-string.
- Convenience constructors for SessionToken, CapsuleNonceHex, PubkeyHash16.
- `asHex` throws on mismatch, `tryHex` returns null.

Unit tests (`src/client/lib/session-capsule.test.ts` — extend existing):
- `parseSessionCapsule` accepts a well-formed capsule.
- Rejects missing fields, wrong types, wrong hex lengths, negative `autoLockExpiresAt`.
- `idbGet` returns null on a tampered raw payload (inject via fake-indexeddb).

Unit tests (new file `src/client/lib/cross-tab-messages.test.ts`):
- `parseSyncMessage` accepts request/response, rejects unknown discriminants, rejects wrong hex lengths.
- `parseLockMessage` accepts `{type:'lock'}`, rejects anything else.

No E2E changes — this is a type-level + parse-gate refactor and the
existing session-capsule E2E already exercises the happy path.

## Files touched

- `src/shared/crypto-types.ts` — new brands + helpers
- `src/shared/__tests__/crypto-types.test.ts` — new
- `src/client/lib/cross-tab-messages.ts` — new
- `src/client/lib/cross-tab-messages.test.ts` — new
- `src/client/lib/session-capsule.ts` — branded capsule + `parseSessionCapsule` + `idbGet` parse gate + import messages from cross-tab-messages
- `src/client/lib/session-capsule.test.ts` — extend for parse cases
- `src/client/lib/crypto-worker.ts` — `handleExportSession` renames `token → tokenHex`, dispatcher unchanged
- `src/client/lib/crypto-worker-client.ts` — generic `call<R>`, drop `as` casts, branded `exportSession` / `importSession` surface
- `src/client/lib/key-manager.ts` — import `LockMessage`/`parseLockMessage`, update `storeCapsule` / `importSession` call sites to use new field names + branded types

## Risks

- **Worker message schema drift:** The worker and client must agree on
  the new `tokenHex` field name. Mitigated because both files change in
  the same commit and the client's generic `call<R>` means the worker's
  raw field name is the single source of truth on the wire.
- **Hex-length invariant at boundaries:** `asHex` at the worker's output
  edge runs `length` checks on freshly-generated `bytesToHex` output —
  if the underlying noble implementation ever returns an unexpected
  length we'd throw instead of storing garbage. That is the desired
  behavior.
- **Test flakiness:** None expected; parsing is pure and sync.
