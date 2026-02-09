# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Llámenos is a secure crisis response hotline webapp. Callers dial a phone number; calls are routed to on-shift volunteers via parallel ringing. Volunteers log notes in a webapp. Admins manage shifts, volunteers, and ban lists. The app must protect volunteer and caller identity against well-funded adversaries (nation states, right-wing groups, private hacking firms).

**Status: Pre-production.** No legacy fallbacks or data migrations needed. No production SDLC yet.

## Tech Stack

- **Runtime/Package Manager**: Bun
- **Frontend**: Vite + TanStack Router (SPA, no SSR) + shadcn/ui (component installer)
- **Backend**: Cloudflare Workers + Durable Objects
- **Telephony**: Twilio via a `TelephonyAdapter` interface (designed for future provider swaps, e.g. SIP trunks)
- **Auth**: Nostr keypairs (with consideration for multi-device auth)
- **i18n**: Built-in from day one — all user-facing strings must be translatable
- **Deployment**: Cloudflare (Workers, DOs, Tunnels), billed to EU/GDPR-compatible account
- **Testing**: E2E only via Playwright — no unit tests

## Architecture Roles

| Role | Can See | Can Do |
|------|---------|--------|
| **Caller** | Nothing (GSM phone) | Call the hotline number |
| **Volunteer** | Own notes only | Answer calls, write notes during shift |
| **Admin** | All notes, audit logs, active calls, billing data | Manage volunteers, shifts, ban lists, spam mitigation settings |

## Security Requirements

These are non-negotiable architectural constraints, not guidelines:

- **E2EE / zero-knowledge**: The server should not be able to read call notes, transcripts, or PII. Encrypt at rest minimum; E2EE where feasible.
- **Volunteer identity protection**: Personal info (name, phone) visible only to admins, never to other volunteers or callers.
- **Call spam mitigation**: Real-time ban lists, optional CAPTCHA-like voice bot detection (randomized digit input), network-level rate limiting. Admins toggle these in real-time.
- **Audit logging**: Every call answered, every note created — visible to admins only.
- **GDPR compliance**: EU parent org, data handling must comply.

## Key Technical Patterns

- **TelephonyAdapter**: Abstract interface for telephony providers. Twilio is the first implementation. All telephony logic goes through this adapter — never call Twilio APIs directly from business logic.
- **Parallel ringing**: All on-shift, non-busy volunteers ring simultaneously. First pickup terminates other calls.
- **Shift routing**: Automated, recurring schedule with ring groups. Fallback group if no schedule is defined.
- **Durable Objects**: Used for real-time state (active calls, shift status, WebSocket connections).

## Development Commands

```bash
# Install dependencies
bun install

# Dev server
bun run dev

# Build
bun run build

# Deploy to Cloudflare
bunx wrangler deploy

# Run E2E tests
bunx playwright test

# Run a single E2E test file
bunx playwright test tests/example.spec.ts

# Type check
bunx tsc --noEmit
```

## Claude Code Working Style

- Implement features completely — no stubs, no shortcuts, no TODOs left behind.
- Edit files in place; never create copies. Git history is the backup. Commit regularly when work is complete.
- Keep the file tree lean. Use git commits frequently to checkpoint progress.
- No legacy fallbacks or migration code until this file notes the app is in production.
- Use `docs/epics/` for planning feature epics. Track backlog in `docs/NEXT_BACKLOG.md` and completed work in `docs/COMPLETED_BACKLOG.md`.
- Use context7 plugin to look up current docs for Twilio, Cloudflare Workers, TanStack, shadcn/ui, and other libraries before implementing.
- Use the feature-dev plugin for guided development of complex features.
- Use Playwright plugin for E2E test development and debugging.
- Clean, modular and DRY patterns!
- When Requirements, Architecture, Design, and Technical changes occur, always update related documentation
