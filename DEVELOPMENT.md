# Development Guide

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+) — runtime and package manager
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — Cloudflare Workers CLI (installed via `bun install`)
- [Playwright](https://playwright.dev/) — E2E testing (installed via `bun install`)

## Setup

```bash
bun install
bun run bootstrap-admin    # Generate admin keypair
cp .dev.vars.example .dev.vars   # Configure env vars
```

## Commands

```bash
bun run dev          # Vite dev server (frontend only, hot reload)
bun run dev:worker   # Wrangler dev server (full app with Workers + DOs)
bun run build        # Vite build → dist/client/
bun run deploy       # Build + wrangler deploy
bun run typecheck    # TypeScript type checking (tsc --noEmit)
bunx playwright test # Run all E2E tests
bunx playwright test tests/smoke.spec.ts  # Run a single test file
bun run test:ui      # Playwright UI mode
```

## Project Structure

```
src/
  client/              # Frontend SPA
    routes/            # TanStack Router file-based routes
    components/        # App components + ui/ (shadcn primitives)
    lib/               # Client utilities
      api.ts           # REST API client
      auth.tsx         # Auth context (Nostr + WebAuthn)
      crypto.ts        # E2EE encryption/decryption
      webrtc.ts        # WebRTC call handling
      ws.ts            # WebSocket connection
    locales/           # 13 locale JSON files
  worker/              # Cloudflare Worker backend
    routes/            # Hono API route handlers
    durable-objects/   # 3 singleton DOs
      session-manager.ts  # Auth, settings, presence, WebSocket
      shift-manager.ts    # Shifts, volunteers, invites
      call-router.ts      # Calls, notes, audit, recordings
    telephony/         # Provider adapters
      adapter.ts       # TelephonyAdapter interface
      twilio.ts        # Twilio implementation
      signalwire.ts    # SignalWire (extends Twilio)
      vonage.ts        # Vonage (NCCO format)
      plivo.ts         # Plivo (Plivo XML format)
      asterisk.ts      # Asterisk ARI (JSON commands)
      webrtc-tokens.ts # WebRTC token generation
    lib/               # Server utilities
  shared/              # Cross-boundary code
    types.ts           # Shared types (CustomFieldDefinition, NotePayload, etc.)
    languages.ts       # Language config (codes, labels, voice IDs)
tests/                 # Playwright E2E tests
site/                  # Marketing site (Astro + Tailwind)
asterisk-bridge/       # ARI bridge service (standalone)
```

## Path Aliases

Configured in both `tsconfig.json` and `vite.config.ts`:

- `@/*` → `./src/client/*`
- `@worker/*` → `./src/worker/*`
- `@shared/*` → `./src/shared/*`

## Key Config Files

- `wrangler.jsonc` — Worker config, DO bindings, env vars
- `playwright.config.ts` — E2E test config
- `.dev.vars` — Local secrets (gitignored): Twilio creds, ADMIN_PUBKEY
- `vite.config.ts` — Frontend build config
- `tsconfig.json` — TypeScript config

## Architecture

### Durable Objects

Three singleton DOs accessed via `idFromName()`:

| DO | ID | Purpose |
|----|-----|---------|
| SessionManagerDO | `global-session` | Auth, settings, WebSocket, presence |
| ShiftManagerDO | `global-shifts` | Shifts, volunteers, invites |
| CallRouterDO | `global-calls` | Calls, notes, audit, recordings |

### Authentication

Dual auth modes:
1. **Schnorr signatures** — `Authorization: Bearer {timestamp}:{hex-signature}` (BIP-340)
2. **WebAuthn sessions** — `Authorization: Session {token}` (256-bit random, 8hr expiry)

### Telephony

The `TelephonyAdapter` interface abstracts provider-specific APIs. All adapters implement the same interface for call flow (IVR, CAPTCHA, queueing, ringing, recording, voicemail).

Provider responses vary:
- **Twilio/SignalWire**: TwiML (XML)
- **Vonage**: NCCO (JSON)
- **Plivo**: Plivo XML
- **Asterisk**: JSON commands (via ARI bridge)

### Encryption

- **Notes**: XChaCha20-Poly1305, client-side encrypt/decrypt
- **Transcriptions**: ECIES — ephemeral ECDH (secp256k1) + XChaCha20-Poly1305, dual-encrypted for volunteer + admin
- **Key derivation**: `sha256("llamenos:transcription" + sharedX)` domain separation

## Testing

E2E tests only (no unit tests). Tests run against the Wrangler dev server.

```bash
# Full suite
bunx playwright test

# Single file
bunx playwright test tests/smoke.spec.ts

# UI mode (interactive)
bun run test:ui

# Debug mode
bunx playwright test --debug
```

Test helpers in `tests/helpers.ts` provide `loginAsAdmin()`, `loginAsVolunteer()`, `resetTestState()`.

### Writing Tests

- Always reset state in `beforeAll` or `beforeEach`
- Use `{ exact: true }` for heading/text matchers to avoid ambiguity
- For Settings navigation: `page.getByRole('link', { name: 'Settings' }).last()` (`.first()` matches "Admin Settings")
- `PhoneInput` onBlur can swallow clicks — `await input.blur()` before clicking Save
- Playwright runs with `workers: 1` for serial execution

## Common Gotchas

- `@noble/ciphers` and `@noble/hashes` require `.js` extension in imports
- `schnorr` is a separate named export: `import { schnorr } from '@noble/curves/secp256k1.js'`
- Nostr pubkeys are x-only (32 bytes) — prepend `"02"` for ECDH
- `secp256k1.getSharedSecret()` returns 33 bytes — extract x-coord with `.slice(1, 33)`
- Workbox `navigateFallbackDenylist` excludes `/api/` and `/telephony/` routes

## Marketing Site

The marketing site lives in `site/` (Astro + Tailwind):

```bash
cd site
bun install
bun run dev         # Local dev server
bun run build       # Build static site
bunx wrangler pages deploy dist --project-name llamenos-site  # Deploy
```

Content collections in `site/src/content/docs/` for documentation pages (en + es).
