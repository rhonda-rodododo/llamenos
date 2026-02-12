---
title: Getting Started
description: Deploy your own Llamenos hotline in under an hour.
---

Deploy your own Llamenos hotline in under an hour. You'll need a Cloudflare account, a Twilio account, and a machine with Bun installed.

## Prerequisites

- [Bun](https://bun.sh) v1.0 or later (runtime and package manager)
- A [Cloudflare](https://www.cloudflare.com) account (free tier works for development)
- A [Twilio](https://www.twilio.com) account with a phone number that supports voice
- Git

## 1. Clone and install

```bash
git clone https://github.com/rikki-llamenos/llamenos.git
cd llamenos
bun install
```

## 2. Bootstrap the admin keypair

Generate a Nostr keypair for the admin account. This produces a secret key (nsec) and public key (npub/hex).

```bash
bun run bootstrap-admin
```

Save the `nsec` securely — this is your admin login credential. You'll need the hex public key for the next step.

## 3. Configure secrets

Create a `.dev.vars` file in the project root for local development:

```bash
# .dev.vars
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
ADMIN_PUBKEY=your_hex_public_key_from_step_2
ENVIRONMENT=development
```

For production, set these as Wrangler secrets:

```bash
bunx wrangler secret put TWILIO_ACCOUNT_SID
bunx wrangler secret put TWILIO_AUTH_TOKEN
bunx wrangler secret put TWILIO_PHONE_NUMBER
bunx wrangler secret put ADMIN_PUBKEY
```

## 4. Configure Twilio webhooks

In your Twilio console, configure your phone number's voice webhook:

- **Webhook URL**: `https://your-worker.your-domain.com/telephony/incoming`
- **HTTP Method**: POST
- **Status callback URL**: `https://your-worker.your-domain.com/telephony/status`

For local development, you'll need a tunnel (like Cloudflare Tunnel or ngrok) to expose your local Worker to Twilio.

## 5. Run locally

Start the Worker dev server (backend + frontend):

```bash
# Build frontend assets first
bun run build

# Start the Worker dev server
bun run dev:worker
```

The app will be available at `http://localhost:8787`. Log in with the admin nsec from step 2.

## 6. Deploy to Cloudflare

```bash
bun run deploy
```

This builds the frontend and deploys the Worker with Durable Objects to Cloudflare. After deploying, update your Twilio webhook URLs to point to the production Worker URL.

## Next steps

- [Admin Guide](/docs/admin-guide) — add volunteers, create shifts, configure settings
- [Volunteer Guide](/docs/volunteer-guide) — share with your volunteers
- [Security Model](/security) — understand the encryption and threat model
