# Llámenos

A secure, self-hosted crisis hotline platform. Callers dial a phone number; calls are routed to on-shift volunteers via parallel ringing. Volunteers log encrypted notes in a webapp. Admins manage shifts, volunteers, and ban lists.

Built for organizations that need to protect the identity of both callers and volunteers against well-funded adversaries.

## Features

- **End-to-end encrypted notes and transcriptions** — the server never sees plaintext
- **Multi-provider telephony** — Twilio, SignalWire, Vonage, Plivo, or self-hosted Asterisk
- **WebRTC browser calling** — volunteers can answer calls directly in the browser
- **Parallel ringing** — all on-shift volunteers ring at once; first pickup wins
- **Automated shift scheduling** — recurring schedules with fallback ring groups
- **Call spam mitigation** — real-time ban lists, voice CAPTCHA, rate limiting
- **AI transcription** — Cloudflare Workers AI (Whisper), E2EE with dual-key encryption
- **Voicemail** — automatic fallback when no volunteers are available
- **Custom note fields** — admin-configurable fields (text, number, select, checkbox)
- **12 languages** — English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, Portuguese
- **Mobile responsive PWA** — works on desktop and phone browsers, installable
- **Accessibility** — skip nav, ARIA labels, RTL support, screen reader friendly
- **Audit log** — every call and note action tracked for admin review
- **GDPR compliant** — designed for EU-based organizations

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- A [Cloudflare](https://cloudflare.com/) account (free tier works for development)
- A telephony provider account (see [Telephony Providers](#telephony-providers))

### 1. Clone and install

```bash
git clone https://github.com/your-org/llamenos.git
cd llamenos
bun install
```

### 2. Generate an admin keypair

Authentication uses [Nostr](https://nostr.com/) keypairs. Generate the first admin:

```bash
bun run bootstrap-admin
```

This outputs:
- An **nsec** (secret key) — give this to the admin, store it securely
- A **hex public key** — you'll need this in the next step

### 3. Configure environment

Copy the example env file and fill in your values:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your admin public key and telephony credentials:

```env
ADMIN_PUBKEY=hex_public_key_from_step_2
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
```

> **Note:** Twilio env vars are the default fallback. You can configure any provider from the admin settings UI after deploying.

### 4. Run locally

```bash
bun run dev          # Frontend dev server (Vite)
bun run dev:worker   # Backend dev server (Wrangler)
```

The app runs at `http://localhost:8787`. Log in with the admin nsec from step 2.

### 5. Set up webhooks

Point your telephony provider's voice webhook to:

```
https://your-domain.com/api/telephony/incoming
```

For local development, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
cloudflared tunnel --url http://localhost:8787
```

## Deploy to Cloudflare

```bash
# Set secrets
bunx wrangler secret put ADMIN_PUBKEY
bunx wrangler secret put TWILIO_ACCOUNT_SID
bunx wrangler secret put TWILIO_AUTH_TOKEN
bunx wrangler secret put TWILIO_PHONE_NUMBER

# Deploy
bun run deploy
```

After deploying, update your telephony provider's webhook URL to point to your Workers URL.

## Telephony Providers

Llámenos supports 5 telephony providers. Configure your provider in **Admin Settings > Telephony Provider**.

| Provider | Type | Pricing | Setup | Best For |
|----------|------|---------|-------|----------|
| **Twilio** | Cloud | Per-minute | Easy | Getting started quickly |
| **SignalWire** | Cloud | Per-minute (cheaper) | Easy | Cost-conscious orgs |
| **Vonage** | Cloud | Per-minute | Medium | International coverage |
| **Plivo** | Cloud | Per-minute | Medium | Budget cloud option |
| **Asterisk** | Self-hosted | SIP trunk only | Advanced | Maximum privacy, at-scale |

See the [setup guides](https://llamenos-hotline.com/docs) for detailed instructions per provider.

## Customization

### Hotline name

Set `HOTLINE_NAME` in `wrangler.jsonc`:

```jsonc
"vars": {
    "HOTLINE_NAME": "Your Hotline Name"
}
```

### Languages

Translation files are in `src/client/locales/`. Language config is centralized in `src/shared/languages.ts`.

## Architecture

```
src/
  client/          # React SPA (Vite + TanStack Router)
    routes/        # File-based routing
    components/    # shadcn/ui components
    locales/       # Translation files (13 locales)
    lib/           # Auth, crypto, WebRTC, API client
  worker/          # Cloudflare Worker backend
    durable-objects/
      session-manager.ts  # Auth, settings, WebSocket, presence
      shift-manager.ts    # Shift scheduling, volunteer management
      call-router.ts      # Call routing, notes, audit log
    telephony/     # Provider adapters (Twilio, SignalWire, Vonage, Plivo, Asterisk)
  shared/          # Code shared between client and worker
```

### Security model

- **Authentication**: Nostr keypairs (BIP-340 Schnorr) + WebAuthn passkeys
- **Note encryption**: XChaCha20-Poly1305 client-side encryption
- **Transcription encryption**: ECIES (ephemeral ECDH + XChaCha20-Poly1305) dual-key
- **Zero-knowledge server**: the Worker never sees plaintext notes or transcriptions
- **Volunteer privacy**: personal info visible only to admins

### Roles

| Role | Can see | Can do |
|------|---------|--------|
| Caller | Nothing (GSM phone) | Call the hotline |
| Volunteer | Own notes only | Answer calls, write notes |
| Admin | All notes, audit logs, active calls | Manage everything |

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full development guide.

```bash
bun run dev          # Vite dev server
bun run dev:worker   # Wrangler dev server
bun run build        # Build frontend
bun run deploy       # Build + deploy to Cloudflare
bun run typecheck    # TypeScript type checking
bunx playwright test # Run E2E tests
```

## License

MIT
