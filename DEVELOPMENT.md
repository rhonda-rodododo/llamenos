# Development Guide

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+) — runtime and package manager
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2 — backing services (PostgreSQL, RustFS, strfry)
- [Playwright](https://playwright.dev/) — E2E testing (installed via `bun install`)

## Setup

```bash
bun install
bun run bootstrap-admin    # Generate admin keypair
cp .env.local.example .env # Configure env vars
bun run dev:docker         # Start backing services (postgres, rustfs, strfry)
bun run migrate            # Apply database migrations
```

## Commands

```bash
bun run dev              # Vite dev server (frontend only, hot reload)
bun run dev:server       # Bun watch server (full backend, localhost:3000)
bun run dev:docker       # Start backing services
bun run dev:docker:down  # Stop backing services
bun run build            # Vite build → dist/client/
bun run migrate          # Apply pending Drizzle migrations
bun run migrate:generate # Generate SQL migration files from schema changes
bun run typecheck        # TypeScript type checking (tsc --noEmit)
bun run lint             # Biome lint check
bun run lint:fix         # Biome lint auto-fix
bun run test:unit        # Run colocated unit tests (bun:test)
bun run test:api         # Run API integration tests (no browser)
bun run test:e2e         # Run UI E2E tests (Chromium)
bun run test:all         # Run all tests (unit + playwright)
bun run start            # Start Bun server (production)
bun run deploy:site      # Deploy marketing site
```

## Project Structure

```
src/
  client/              # Frontend SPA (Vite + React)
    routes/            # TanStack Router file-based routes
    components/        # App components + ui/ (shadcn primitives)
    lib/               # Client utilities (auth, crypto, ws, i18n, hooks)
    locales/           # 13 locale JSON files
  server/              # Bun/Hono backend
    routes/            # REST API route handlers
    services/          # Business logic services (PostgreSQL-backed)
    telephony/         # TelephonyAdapter interface + 5 adapters
    messaging/         # MessagingAdapter interface + SMS, WhatsApp, Signal
    lib/               # Server utilities (auth, crypto, webauthn)
    db/                # Drizzle ORM schema + migrations
    server.ts          # Entry point
    app.ts             # Hono app wiring
  shared/              # Cross-boundary types and config
    types.ts           # Shared types
    languages.ts       # Language config (codes, labels, voice IDs)
    crypto-labels.ts   # Domain separation constants
tests/                 # Playwright tests (API + UI E2E)
site/                  # Marketing site (Astro + Tailwind)
sip-bridge/            # Unified SIP bridge service (Asterisk/FreeSWITCH/Kamailio, standalone Bun service)
deploy/                # Docker Compose + Ansible deployment configs
```

## Path Aliases

Configured in both `tsconfig.json` and `vite.config.ts`:

- `@/*` → `./src/client/*`
- `@server/*` → `./src/server/*`
- `@shared/*` → `./src/shared/*`

## Key Config Files

- `playwright.config.ts` — E2E test config
- `.env` — Local secrets (gitignored): DATABASE_URL, HMAC_SECRET, Twilio creds, ADMIN_PUBKEY
- `vite.config.ts` — Frontend build config
- `tsconfig.json` — TypeScript config
- `docker-compose.dev.yml` — Local backing services

## Architecture

### Services

Seven PostgreSQL-backed services (replacing former Durable Objects):

| Service | Purpose |
|---------|---------|
| IdentityService | Auth, WebSocket, presence, device provisioning |
| SettingsService | Settings, custom fields, IVR audio, messaging config |
| RecordsService | Audit log, call history, recordings |
| ShiftManagerService | Shifts, volunteers, invites |
| CallRouterService | Calls, notes, active call state |
| ConversationService | Threaded messaging conversations |
| AuditService | Hash-chained audit logging |

### Authentication

Dual auth modes:
1. **Schnorr signatures** — `Authorization: Bearer {timestamp}:{hex-signature}` (BIP-340)
2. **WebAuthn sessions** — `Authorization: Session {token}` (256-bit random, 8hr expiry)

### Key Management

Client-side key protection via `src/client/lib/key-manager.ts`:

- **PIN-encrypted local store** — nsec encrypted with PBKDF2 (600K iterations) + XChaCha20-Poly1305, stored in localStorage
- **In-memory closure** — decrypted nsec held in a closure variable only, never in sessionStorage or any browser API
- **Auto-lock** — key zeroed on idle timeout or `document.hidden`; components show "Enter PIN" overlay when locked
- **Device linking** — Signal-style QR provisioning via ephemeral ECDH key exchange through relay rooms (5-min TTL)

### Telephony (Voice)

The `TelephonyAdapter` interface abstracts provider-specific voice APIs. All adapters implement the same interface for call flow (IVR, CAPTCHA, queueing, ringing, recording, voicemail).

Provider responses vary:
- **Twilio/SignalWire**: TwiML (XML)
- **Vonage**: NCCO (JSON)
- **Plivo**: Plivo XML
- **Asterisk**: JSON commands (via ARI bridge)

### Messaging (SMS, WhatsApp, Signal)

The `MessagingAdapter` interface abstracts text messaging across channels. Each adapter implements `sendMessage()`, `sendMediaMessage()`, `parseInboundWebhook()`, and `validateWebhook()`.

| Channel | Adapter | Webhook Endpoint |
|---------|---------|-----------------|
| SMS | Per-provider (Twilio, SignalWire, Vonage, Plivo) | `POST /api/messaging/sms/webhook` |
| WhatsApp | Meta Graph API v21.0 | `POST /api/messaging/whatsapp/webhook` |
| Signal | signal-cli-rest-api bridge | `POST /api/messaging/signal/webhook` |

### Roles

| Role | Permissions |
|------|------------|
| `admin` | Full access: settings, volunteers, shifts, notes, calls, conversations, reports, audit |
| `volunteer` | Answer calls, write notes, respond to conversations, view own data |
| `reporter` | Submit encrypted reports with file attachments, view own reports |

### Encryption

- **Notes**: Per-note forward secrecy — unique random key per note, wrapped via ECIES for each reader
- **Transcriptions**: ECIES — ephemeral ECDH (secp256k1) + XChaCha20-Poly1305, dual-encrypted for volunteer + admin
- **Reports**: ECIES encrypted body + encrypted file attachments, dual-encrypted for reporter + admin
- **Key derivation**: HKDF-SHA256 with application salt (`llamenos:hkdf-salt:v1`)

## Testing

Three test suites:

```bash
# Unit tests (bun:test, colocated .test.ts files)
bun run test:unit

# API integration tests (Playwright, no browser)
bun run test:api

# UI E2E tests (Playwright, Chromium)
bun run test:e2e

# All tests
bun run test:all

# Interactive UI mode
bun run test:interactive

# Single file
bunx playwright test tests/ui/smoke.spec.ts
```

Test helpers in `tests/helpers/` provide `authedRequest()` for authenticated API tests and `resetTestState()` for state cleanup.

### Writing Tests

- Always reset state via global-setup or `beforeAll`
- Use `data-testid` selectors for stability in E2E tests
- Some unit tests require PostgreSQL — start backing services with `bun run dev:docker` first

## Local Dev Port Offsets

V1 and V2 run concurrently with different ports:

| Service | V2 (llamenos) | V1 (llamenos-hotline) |
|---------|---------------|----------------------|
| PostgreSQL | 5432 | 5433 |
| RustFS | 9000/9001 | 9002/9003 |
| strfry | 7777 | 7778 |

## Split-Origin Dev Setup (Tier 4 PR-A)

In production the SPA, the API, and the crypto sandbox live on three distinct
origins — `app.<parent>`, `api.<parent>`, and `crypto.<parent>`. CORS, cookie
scoping, and iframe sandboxing all depend on that separation. Local dev mirrors
the same layout using `llamenos.localhost` subdomains.

**One-time /etc/hosts setup:**

```bash
./scripts/dev-hosts.sh        # adds the three hosts to /etc/hosts (sudo)
./scripts/dev-hosts.sh --check
```

The script installs an idempotent managed block:

```
# >>> llamenos-dev-hosts >>>
127.0.0.1 app.llamenos.localhost
127.0.0.1 api.llamenos.localhost
127.0.0.1 crypto.llamenos.localhost
# <<< llamenos-dev-hosts <<<
```

Running the script a second time is a no-op. Use `./scripts/dev-hosts.sh --remove`
to strip the block cleanly. Colocated unit tests in `scripts/dev-hosts.test.ts`
cover install / idempotency / remove / `--check`.

For now `bun run dev` still serves the SPA on `http://localhost:5173` and the
backend on `http://localhost:3000`. The split-origin layout is exercised
end-to-end in the production Docker compose + Ansible deployments. The
split-origin dev-time Caddy lands in a follow-up PR.

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
```

**Deploy via** `bun run deploy:site` from the project root. Never run `wrangler pages deploy` directly from root.
