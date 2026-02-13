---
title: Documentation
description: Learn how to deploy, configure, and use Llamenos.
guidesHeading: Guides
guides:
  - title: Getting Started
    description: Prerequisites, installation, telephony setup, and your first deployment.
    href: /docs/getting-started
  - title: Admin Guide
    description: Manage volunteers, shifts, ban lists, custom fields, and settings.
    href: /docs/admin-guide
  - title: Volunteer Guide
    description: Log in, receive calls, write notes, and use transcription.
    href: /docs/volunteer-guide
  - title: Telephony Providers
    description: Compare supported telephony providers and choose the best fit for your hotline.
    href: /docs/telephony-providers
  - title: "Setup: Twilio"
    description: Step-by-step guide to configure Twilio as your telephony provider.
    href: /docs/setup-twilio
  - title: "Setup: SignalWire"
    description: Step-by-step guide to configure SignalWire as your telephony provider.
    href: /docs/setup-signalwire
  - title: "Setup: Vonage"
    description: Step-by-step guide to configure Vonage as your telephony provider.
    href: /docs/setup-vonage
  - title: "Setup: Plivo"
    description: Step-by-step guide to configure Plivo as your telephony provider.
    href: /docs/setup-plivo
  - title: "Setup: Asterisk (Self-Hosted)"
    description: Deploy Asterisk with the ARI bridge for maximum privacy and control.
    href: /docs/setup-asterisk
  - title: WebRTC Browser Calling
    description: Enable in-browser call answering for volunteers using WebRTC.
    href: /docs/webrtc-calling
  - title: Security Model
    description: Understand what's encrypted, what isn't, and the threat model.
    href: /security
---

## Architecture overview

Llamenos is a single-page application (SPA) backed by Cloudflare Workers and Durable Objects. There are no traditional servers to manage.

| Component | Technology |
|---|---|
| Frontend | Vite + React + TanStack Router |
| Backend | Cloudflare Workers + Durable Objects |
| Telephony | Twilio, SignalWire, Vonage, Plivo, or Asterisk (via TelephonyAdapter interface) |
| Auth | Nostr keypairs (BIP-340 Schnorr) + WebAuthn |
| Encryption | ECIES (secp256k1 + XChaCha20-Poly1305) |
| Transcription | Cloudflare Workers AI (Whisper) |
| i18n | i18next (12+ languages) |

## Roles

| Role | Can see | Can do |
|---|---|---|
| **Caller** | Nothing (GSM phone) | Call the hotline number |
| **Volunteer** | Own notes only | Answer calls, write notes during shift |
| **Admin** | All notes, audit logs, call data | Manage volunteers, shifts, bans, settings |
