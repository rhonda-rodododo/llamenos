# OPAQUE Library Choice

**Date:** 2026-04-12
**Chosen:** `@serenity-kit/opaque` v1.1.0
**License:** MIT
**PR:** Tier 2 PR-A (feat/sec-tier-2-impl-opaque-pra)

## Why @serenity-kit/opaque

| Criterion | @serenity-kit/opaque | @cloudflare/opaque-ts | opaque-ke-wasm |
|---|---|---|---|
| TypeScript types | Built-in .d.ts | Built-in | Manual |
| WASM bundling | Inlined, no build step | Pure TS (no WASM) | Requires wasm-pack |
| RFC 9807 compliance | Yes (ristretto255) | Partial | Yes |
| Security audit | 7ASecurity via OTF Red Team Lab | Cloudflare internal | None published |
| Browser + Bun | Works in both | Browser-focused | Requires manual init |
| Maintenance | Active (serenity-kit org) | Sporadic updates | Archived |
| API ergonomics | Simple sync functions | Complex async chain | Low-level bindings |

### Decision rationale

1. **Pre-built WASM** — no `wasm-pack` or `cargo` needed. Critical for autonomous CI and developer onboarding.
2. **Audited** — penetration test + whitebox review by 7ASecurity through the Open Technology Fund's Red Team Lab.
3. **Correct cipher suite** — uses ristretto255 (RFC 9807 recommended configuration). P-256 variant available as `@serenity-kit/opaque-p256` if needed.
4. **Stable export key** — `client.finishLogin()` returns a deterministic 64-byte export key derived from the password + server OPRF seed. This is the value we HKDF into an AES-KW wrapping key for the root KEK OPAQUE factor.

## API surface used

```typescript
import { client, server, ready } from '@serenity-kit/opaque'

// One-time WASM init
await ready

// Registration: 3-step (client start → server respond → client finish)
client.startRegistration({ password })
server.createRegistrationResponse({ serverSetup, userIdentifier, registrationRequest })
client.finishRegistration({ clientRegistrationState, registrationResponse, password })

// Login: 4-step (client start → server start → client finish → server finish)
client.startLogin({ password })
server.startLogin({ serverSetup, registrationRecord, startLoginRequest, userIdentifier })
client.finishLogin({ clientLoginState, loginResponse, password })
server.finishLogin({ serverLoginState, finishLoginRequest })

// Server setup (one-time per purpose)
server.createSetup()
server.getPublicKey(serverSetup)
```

All wire values are base64url strings. Export key and session key are also base64url-encoded (decoded to `Uint8Array` in our wrapper).

## Migration path to vendored Rust build

If we later want to vendor `opaque-ke` directly (e.g., for custom cipher suite parameters or to pin a specific WASM build):

1. Set up `vendor/opaque-wrapper/` with a Rust crate wrapping `opaque-ke` v4.x
2. Build via `wasm-pack build --target bundler`
3. Replace `@serenity-kit/opaque` imports in `src/client/lib/opaque-client.ts` with the vendored module
4. The `opaqueClient` / `opaqueServer` interface is stable — callers don't change
5. Remove `@serenity-kit/opaque` from `package.json`

The wrapper layer (`opaque-client.ts`) isolates all callers from the underlying library, so the swap is a single-file change.
