---
title: Documentation
description: Learn how to deploy, configure, and use Llamenos.
guidesHeading: Guides
guides:
  - title: Getting Started
    description: Prerequisites, installation, Twilio setup, and your first deployment.
    href: /docs/getting-started
  - title: Admin Guide
    description: Manage volunteers, shifts, ban lists, custom fields, and settings.
    href: /docs/admin-guide
  - title: Volunteer Guide
    description: Log in, receive calls, write notes, and use transcription.
    href: /docs/volunteer-guide
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
| Telephony | Twilio (via TelephonyAdapter interface) |
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
