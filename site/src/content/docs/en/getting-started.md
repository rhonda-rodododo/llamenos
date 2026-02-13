---
title: Getting Started
description: Deploy your own Llamenos hotline in under an hour.
---

Deploy your own Llamenos hotline in under an hour. You'll need a Cloudflare account, a telephony provider account, and a machine with Bun installed.

## Prerequisites

- [Bun](https://bun.sh) v1.0 or later (runtime and package manager)
- A [Cloudflare](https://www.cloudflare.com) account (free tier works for development)
- A telephony provider account — [Twilio](https://www.twilio.com) is the easiest to start with, but Llamenos also supports [SignalWire](/docs/setup-signalwire), [Vonage](/docs/setup-vonage), [Plivo](/docs/setup-plivo), and [self-hosted Asterisk](/docs/setup-asterisk). See the [Telephony Providers](/docs/telephony-providers) comparison for help choosing.
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

Create a `.dev.vars` file in the project root for local development. This example uses Twilio — if you're using a different provider, you can skip the Twilio variables and configure your provider through the admin UI after first login.

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
bunx wrangler secret put ADMIN_PUBKEY
# If using Twilio as the default provider via env vars:
bunx wrangler secret put TWILIO_ACCOUNT_SID
bunx wrangler secret put TWILIO_AUTH_TOKEN
bunx wrangler secret put TWILIO_PHONE_NUMBER
```

> **Note**: You can also configure your telephony provider entirely through the admin Settings UI instead of using environment variables. This is required for non-Twilio providers. See the [setup guide for your provider](/docs/telephony-providers).

## 4. Configure telephony webhooks

Configure your telephony provider to send voice webhooks to your Worker. The webhook URLs are the same regardless of provider:

- **Incoming call URL**: `https://your-worker.your-domain.com/telephony/incoming` (POST)
- **Status callback URL**: `https://your-worker.your-domain.com/telephony/status` (POST)

For provider-specific webhook setup instructions, see: [Twilio](/docs/setup-twilio), [SignalWire](/docs/setup-signalwire), [Vonage](/docs/setup-vonage), [Plivo](/docs/setup-plivo), or [Asterisk](/docs/setup-asterisk).

For local development, you'll need a tunnel (like Cloudflare Tunnel or ngrok) to expose your local Worker to your telephony provider.

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

This builds the frontend and deploys the Worker with Durable Objects to Cloudflare. After deploying, update your telephony provider's webhook URLs to point to the production Worker URL.

## Next steps

- [Admin Guide](/docs/admin-guide) — add volunteers, create shifts, configure settings
- [Volunteer Guide](/docs/volunteer-guide) — share with your volunteers
- [Telephony Providers](/docs/telephony-providers) — compare providers and switch from Twilio if needed
- [Security Model](/security) — understand the encryption and threat model
