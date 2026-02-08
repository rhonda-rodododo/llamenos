# Llamenos

A secure, self-hosted crisis hotline platform. Callers dial a phone number; calls are routed to on-shift volunteers via parallel ringing. Volunteers log encrypted notes in a webapp. Admins manage shifts, volunteers, and ban lists.

Built for organizations that need to protect the identity of both callers and volunteers against well-funded adversaries.

## Features

- **End-to-end encrypted notes and transcriptions** — the server never sees plaintext
- **Parallel ringing** — all on-shift volunteers ring at once; first pickup wins
- **Automated shift scheduling** — recurring schedules with fallback ring groups
- **Call spam mitigation** — real-time ban lists, voice CAPTCHA, rate limiting
- **AI transcription** — Cloudflare Workers AI (Whisper), E2EE with dual-key encryption
- **12 languages** — English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, Portuguese
- **Mobile responsive** — works on desktop and phone browsers
- **Accessibility** — skip nav, ARIA labels, RTL support, screen reader friendly
- **Audit log** — every call and note action tracked for admin review
- **GDPR compliant** — designed for EU-based organizations

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- A [Cloudflare](https://cloudflare.com/) account (free tier works for development)
- A [Twilio](https://twilio.com/) account with a phone number

## Quick Start

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

Edit `.dev.vars`:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
ADMIN_PUBKEY=hex_public_key_from_step_2
```

### 4. Run locally

```bash
bun run dev          # Frontend dev server (Vite)
bun run dev:worker   # Backend dev server (Wrangler)
```

The app runs at `http://localhost:8787`. Log in with the admin nsec from step 2.

### 5. Set up Twilio webhooks

In your Twilio console, point your phone number's voice webhook to:

```
https://your-domain.com/api/telephony/incoming
```

For local development, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose your local worker:

```bash
cloudflared tunnel --url http://localhost:8787
```

## Deploy to Cloudflare

### 1. Set secrets

```bash
bunx wrangler secret put ADMIN_PUBKEY
bunx wrangler secret put TWILIO_ACCOUNT_SID
bunx wrangler secret put TWILIO_AUTH_TOKEN
bunx wrangler secret put TWILIO_PHONE_NUMBER
```

### 2. Deploy

```bash
bun run deploy
```

This builds the frontend and deploys everything to Cloudflare Workers. The deploy script runs `vite build` then `wrangler deploy`.

### 3. Update Twilio webhook

Point your Twilio phone number's voice webhook to your Workers URL:

```
https://your-app.your-subdomain.workers.dev/api/telephony/incoming
```

## Customization

### Hotline name

Set the `HOTLINE_NAME` variable in `wrangler.jsonc` to change the name shown in the UI and caller greetings:

```jsonc
"vars": {
    "HOTLINE_NAME": "Your Hotline Name"
}
```

### Languages

The app ships with 12 languages. Translation files are in `src/client/i18n/`. To add a new language:

1. Add the language config to `src/shared/languages.ts`
2. Create a translation file in `src/client/i18n/`
3. Add voice prompts in `src/worker/telephony/twilio.ts`

### Telephony provider

Twilio is the default provider, but the telephony layer is abstracted behind a `TelephonyAdapter` interface. To use a different provider (e.g., SIP trunks), implement the adapter interface in `src/worker/telephony/`.

## Architecture

```
src/
  client/          # React SPA (Vite + TanStack Router)
    routes/        # File-based routing
    components/    # shadcn/ui components
    i18n/          # Translation files (13 locales)
    lib/           # Auth, crypto, API client
  worker/          # Cloudflare Worker backend
    api/           # REST API routes
    durable-objects/
      session.ts   # Auth sessions, WebSocket connections, presence
      shift.ts     # Shift scheduling, volunteer management
      call-router.ts  # Call routing, notes, audit log
    telephony/     # TelephonyAdapter + Twilio implementation
  shared/          # Code shared between client and worker
```

### Security model

- **Authentication**: Nostr keypairs (nsec/npub) — no passwords, no email
- **Note encryption**: XChaCha20-Poly1305 client-side encryption
- **Transcription encryption**: ECIES (ephemeral ECDH + XChaCha20-Poly1305) with dual keys — one copy for the volunteer, one for the admin
- **Zero-knowledge server**: the Worker never sees plaintext notes or transcriptions
- **Volunteer privacy**: personal info visible only to admins

### Roles

| Role | Can see | Can do |
|------|---------|--------|
| Caller | Nothing (GSM phone) | Call the hotline |
| Volunteer | Own notes only | Answer calls, write notes |
| Admin | All notes, audit logs, active calls | Manage volunteers, shifts, bans, settings |

## Development

```bash
bun run dev          # Vite dev server
bun run dev:worker   # Wrangler dev server
bun run build        # Build frontend
bun run deploy       # Build + deploy to Cloudflare
bun run typecheck    # TypeScript type checking
bun run test         # Run Playwright E2E tests
bun run test:ui      # Playwright test UI
```

## License

MIT
