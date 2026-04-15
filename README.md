# Llámenos (v1)

A secure, self-hosted crisis response platform. Supports voice calls, SMS, WhatsApp, and Signal — all routed to on-shift volunteers. Volunteers log encrypted notes and manage conversations in a webapp. Admins manage shifts, volunteers, channels, and ban lists. Reporters can submit encrypted reports through a dedicated portal.

Built for organizations that need to protect the identity of callers, reporters, and volunteers against well-funded adversaries.

A more sophisticated Llámenos v2 (aka [Llámenos Platform](https://github.com/rhonda-rodododo/llamenos-platform)) is under development, however we will be continuing to support Llámenos Hotline (v1) as a robust application into 2027, and provide a migration path once the v2 platform lands in app stores.

## Screenshots

<p align="center">
  <img src="site/public/screenshots/dashboard-desktop.png" alt="Dashboard" width="600" />
</p>

<p align="center">
  <em>Admin dashboard with real-time volunteer presence and active calls</em>
</p>

<details>
<summary><strong>More screenshots</strong></summary>

### Conversations
<p align="center">
  <img src="site/public/screenshots/conversations-desktop.png" alt="Conversations" width="600" />
</p>
<p align="center"><em>Unified messaging view for SMS, WhatsApp, and Signal</em></p>

### Volunteers
<p align="center">
  <img src="site/public/screenshots/volunteers-desktop.png" alt="Volunteers" width="600" />
</p>
<p align="center"><em>Manage volunteer accounts and permissions</em></p>

### Shifts
<p align="center">
  <img src="site/public/screenshots/shifts-desktop.png" alt="Shifts" width="600" />
</p>
<p align="center"><em>Create recurring shift schedules</em></p>

### Mobile
<p align="center">
  <img src="site/public/screenshots/dashboard-mobile.png" alt="Mobile Dashboard" width="200" />
  <img src="site/public/screenshots/conversations-mobile.png" alt="Mobile Conversations" width="200" />
  <img src="site/public/screenshots/notes-mobile.png" alt="Mobile Notes" width="200" />
</p>
<p align="center"><em>Fully responsive mobile interface</em></p>

</details>

## How it works

```mermaid
flowchart TD
    A["Incoming Call"] --> B{"Shift Active?"}
    B -->|Yes| C["Ring All On-Shift Volunteers"]
    B -->|No| D["Ring Fallback Group"]
    C --> E{"First Pickup"}
    D --> E
    E -->|Answered| F["Connect Call"]
    E -->|No Answer| G["Voicemail"]
    F --> H["Save Encrypted Note"]
```

## Features

### Voice Calling
- **Multi-provider telephony** — Twilio, SignalWire, Vonage, Plivo, or self-hosted Asterisk
- **Parallel ringing** — all on-shift volunteers ring at once; first pickup wins
- **WebRTC browser calling** — volunteers can answer calls directly in the browser
- **Automated shift scheduling** — recurring schedules with fallback ring groups
- **Call spam mitigation** — real-time ban lists, voice CAPTCHA, rate limiting
- **Client-side transcription** — WASM Whisper via ONNX runtime, audio never leaves the browser
- **Voicemail** — automatic fallback when no volunteers are available
- **Reproducible builds** — deterministic Docker builds with SLSA provenance and checksum verification

### Multi-Channel Messaging
- **SMS** — inbound/outbound SMS via Twilio, SignalWire, Vonage, or Plivo
- **WhatsApp Business** — Meta Cloud API with template messages, media support, and 24-hour window handling
- **Signal** — via signal-cli-rest-api bridge with voice message transcription
- **Threaded conversations** — all messaging channels flow into a unified conversation view with message bubbles, timestamps, and direction indicators
- **Real-time updates** — new messages and conversations appear instantly via WebSocket
- **E2EE messaging** — per-message envelope encryption; server never sees plaintext

### Encrypted Notes & Reports
- **End-to-end encrypted notes** — the server never sees plaintext
- **Custom note fields** — admin-configurable fields (text, number, select, checkbox)
- **Reporter role** — dedicated portal for submitting encrypted reports with file attachments
- **Report workflow** — categories, status tracking (open/claimed/resolved), threaded replies

### Contact Directory
- **E2EE contact records** — organizations, individuals, and relationships with encrypted fields
- **PBAC (policy-based access control)** — team-scoped visibility and granular permissions
- **Tags and intake forms** — categorize contacts and capture structured data
- **Bulk operations** — import, export, and batch updates with encryption

### Volunteer Experience
- **Command palette** — Ctrl/Cmd+K for quick navigation, search, and one-click note creation
- **Real-time notifications** — ringtone, browser push notifications, and tab title flash on incoming calls
- **Volunteer presence** — real-time online/offline/on-break status visible to admins
- **Note draft auto-save** — encrypted drafts preserved in the browser across reloads
- **Keyboard shortcuts** — press `?` for a full shortcut reference dialog
- **Dark/light/system themes** — toggle in sidebar, persisted per session

### Administration
- **Setup wizard** — guided multi-step setup on first admin login (name, channels, providers)
- **In-app help** — FAQ, role-specific guides, getting started checklist
- **Custom IVR voice prompts** — record greetings per language via MediaRecorder; falls back to TTS
- **Configurable call settings** — queue timeout and voicemail duration (30-300s each)
- **Audit log** — every call, note, message, and admin action tracked with hashed IP metadata
- **Encrypted data export** — GDPR-compliant notes export encrypted with user's key (.enc format)
- **Session management** — idle timeout warnings, auto-renewal, and forced re-auth on expiry
- **13 languages** — English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, Portuguese, German
- **Mobile responsive PWA** — installable on any device with push notifications
- **Accessibility** — skip nav, ARIA labels, RTL support, screen reader friendly
- **GDPR compliant** — designed for EU-based organizations

## Quick Start

Only Docker is required. No Node.js, Bun, or other runtimes needed.

```bash
git clone https://github.com/your-org/llamenos.git
cd llamenos
./scripts/docker-setup.sh
```

This generates secrets, builds the app, and starts all services. Once running, visit **http://localhost:8000** — the setup wizard walks you through creating an admin account and configuring your hotline.

### Try demo mode

To explore with pre-seeded data and one-click demo login:

```bash
./scripts/docker-setup.sh --demo
```

## Deployment

### Self-Hosted (Docker Compose) — Recommended

Run Llamenos on your own infrastructure. All data stays on your server.

**Local development:**

```bash
./scripts/docker-setup.sh
```

Runs at http://localhost:8000 with plain HTTP.

**Production deployment:**

```bash
./scripts/docker-setup.sh --domain hotline.yourorg.com --email admin@yourorg.com
```

Caddy auto-provisions TLS certificates via Let's Encrypt. The `--domain` flag activates the production Docker Compose overlay (`docker-compose.production.yml`) which adds TLS termination, log rotation, and resource limits.

**Core services:** app, PostgreSQL, Caddy (reverse proxy), RustFS (S3-compatible blob storage), strfry (Nostr relay), Authentik (authentik-server + authentik-worker, IdP/OIDC).

**Optional profiles:**

```bash
# Self-hosted transcription (Whisper)
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.production.yml --profile transcription up -d

# Self-hosted Asterisk PBX
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.production.yml --profile asterisk up -d

# Signal messaging bridge
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.production.yml --profile signal up -d
```

See the full [self-hosting guide](https://llamenos-hotline.com/docs/self-hosting) and [QUICKSTART.md](docs/QUICKSTART.md) for VPS provisioning, server hardening, and operational runbooks.

### Kubernetes (Helm)

```bash
helm install llamenos deploy/helm/llamenos/ \
  --set secrets.storageAccessKey=your-access-key \
  --set secrets.storageSecretKey=your-secret-key \
  --set ingress.hosts[0].host=hotline.yourdomain.com
```

## Telephony Providers

Configure your provider in **Admin Settings > Telephony Provider** or during the setup wizard.

| Provider | Type | Voice | SMS | Best For |
|----------|------|-------|-----|----------|
| **Twilio** | Cloud | Yes | Yes | Getting started quickly |
| **SignalWire** | Cloud | Yes | Yes | Cost-conscious orgs |
| **Vonage** | Cloud | Yes | Yes | International coverage |
| **Plivo** | Cloud | Yes | Yes | Budget cloud option |
| **Asterisk** | Self-hosted | Yes | No | Maximum privacy, at-scale |

## Messaging Channels

| Channel | Provider | Setup |
|---------|----------|-------|
| **SMS** | Twilio, SignalWire, Vonage, or Plivo | Configure in admin settings; point inbound webhook to `/api/messaging/sms/webhook` |
| **WhatsApp** | Meta WhatsApp Business Cloud API | Requires Meta Business account; configure webhook at `/api/messaging/whatsapp/webhook` |
| **Signal** | signal-cli-rest-api bridge | Self-hosted bridge service; configure bridge URL in admin settings |

All messaging channels flow into a unified **Conversations** view. Enable/disable channels from Admin Settings or the setup wizard.

See the [setup guides](https://llamenos-hotline.com/docs) for detailed instructions per provider and channel.

## Webhooks

Point your telephony provider's webhooks to your deployment URL:

| Webhook | URL |
|---------|-----|
| Voice (incoming) | `https://your-domain/api/telephony/incoming` |
| Voice (status) | `https://your-domain/api/telephony/status` |
| SMS | `https://your-domain/api/messaging/sms/webhook` |
| WhatsApp | `https://your-domain/api/messaging/whatsapp/webhook` |
| Signal | Configure bridge to forward to `https://your-domain/api/messaging/signal/webhook` |

## Customization

### Hotline name

Set during the setup wizard, or via `HOTLINE_NAME` environment variable.

### Languages

Translation files are in `src/client/locales/`. Language config is centralized in `src/shared/languages.ts`.

## Architecture

```
src/
  client/          # React SPA (Vite + TanStack Router)
    routes/        # File-based routing (/setup, /conversations, /reports, /help, etc.)
    components/    # shadcn/ui components
    locales/       # Translation files (13 locales)
    lib/           # Auth, crypto, WebRTC, API client
  server/          # Bun/Hono backend
    services/      # PostgreSQL-backed business logic services
    telephony/     # Voice provider adapters (Twilio, SignalWire, Vonage, Plivo, Asterisk)
    messaging/     # Messaging channel adapters (SMS, WhatsApp, Signal)
    idp/           # Identity provider adapter interface + Authentik implementation
    routes/        # API route handlers (includes auth-facade.ts for /api/auth/*)
    db/            # Drizzle ORM schema + migrations
    lib/           # Server utilities (auth, crypto, webauthn)
  shared/          # Code shared between client and server
    types.ts       # Shared types (roles, conversations, reports, etc.)
    languages.ts   # Centralized language config
deploy/
  docker/          # Docker Compose deployment (Dockerfile, Caddyfile, .env.example)
  ansible/         # Ansible deployment for VPS
  helm/            # Kubernetes Helm chart
sip-bridge/        # Unified SIP bridge for self-hosted PBX (Asterisk default, FreeSWITCH/Kamailio also supported)
site/              # Marketing site (Astro + Tailwind, Cloudflare Pages)
```

### Security model

- **Self-hosted by design** — all data stays on your infrastructure
- **Authentication**: JWT + Authentik IdP (OIDC) + multi-factor KEK + WebAuthn passkeys
- **Local key protection**: PIN-encrypted key store (PBKDF2 600K iterations + XChaCha20-Poly1305); raw nsec never in sessionStorage — in-memory closure only, zeroed on lock
- **Note encryption**: Per-note forward secrecy — each note encrypted with a unique random key, wrapped via ECIES for each authorized reader
- **Transcription encryption**: ECIES (ephemeral ECDH + XChaCha20-Poly1305) dual-key
- **Report encryption**: ECIES encrypted body + encrypted file attachments
- **Device linking**: Signal-style QR provisioning via ephemeral ECDH key exchange; 5-minute single-use relay rooms
- **Recovery keys**: 128-bit Base32 recovery keys with mandatory encrypted backup download
- **Zero-knowledge server**: the server never sees plaintext notes, transcriptions, report content, or per-note encryption keys
- **Volunteer privacy**: personal info visible only to admins

### Roles

| Role | Can see | Can do |
|------|---------|--------|
| Caller | Nothing (GSM/SMS/WhatsApp/Signal) | Call or message the hotline |
| Volunteer | Own notes, assigned conversations | Answer calls, write notes, respond to messages |
| Reporter | Own reports only | Submit encrypted reports with file attachments |
| Admin | All notes, reports, audit logs, conversations | Manage everything |

## Development

Requires [Bun](https://bun.sh/) and [Docker](https://docs.docker.com/get-docker/) for local development.

```bash
bun install
bun run dev:docker   # Start backing services (postgres, rustfs, strfry, authentik)
bun run migrate      # Apply database migrations
bun run dev          # Vite dev server (frontend)
bun run dev:server   # Bun watch server (backend, localhost:3000)
bun run build        # Build frontend
bun run typecheck    # TypeScript type checking
bun run test:all     # Run all tests
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full development guide.

## CI/CD

Every push to `main` triggers two workflows:

1. **CI** (`.github/workflows/ci.yml`) — typecheck, Vite build, Astro site build, unit/API/E2E tests. Cancels older in-progress runs when a newer push lands.
2. **Knope release PR** (`.github/workflows/knope-release-pr.yml`) — runs [knope](https://knope.tech) `prepare-release` to open or force-update a release PR on branch `release`. The PR contains the next version bump and an updated `CHANGELOG.md`, computed from conventional commits since the last tag.

A release is cut **only when the release PR is merged**, not on every main push. Merging the release PR triggers `release.yml`, which:

1. Builds the app and computes `CHECKSUMS.txt`
2. Generates a CycloneDX SBOM, signs artifacts with cosign keyless, GPG-signs the checksums, attaches SLSA build provenance
3. Runs `knope release` to create the git tag + GitHub Release
4. Calls `docker.yml` to build and push versioned Docker images to GHCR
5. Triggers `auto-deploy-demo.yml` (via the `release: published` event) to deploy to the demo VPS

### Versioning

Uses [conventional commits](https://www.conventionalcommits.org/) to determine the version bump:

- `feat:` → minor bump (0.x.0)
- `fix:`, `docs:`, `chore:`, etc. → patch bump (0.0.x)
- `feat!:` or `BREAKING CHANGE` → major bump (x.0.0)

## License

AGPL-3.0-or-later
