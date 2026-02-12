---
title: Features
subtitle: Everything a crisis hotline needs, in one open-source package. Built on Cloudflare Workers with zero servers to manage.
---

## Call Routing

**Parallel ringing** — When a caller dials in, every on-shift, non-busy volunteer rings simultaneously. The first volunteer to pick up gets the call; other ringing stops immediately.

**Shift-based scheduling** — Create recurring shifts with specific days and time ranges. Assign volunteers to shifts. The system automatically routes calls to whoever is on duty.

**Queue with hold music** — If all volunteers are busy, callers enter a queue with configurable hold music. Queue timeout is adjustable (30-300 seconds). When no one answers, calls fall through to voicemail.

**Voicemail fallback** — Callers can leave a voicemail (up to 5 minutes) if no volunteer answers. Voicemails are transcribed via Whisper AI and encrypted for admin review.

## Encrypted Notes

**End-to-end encrypted note-taking** — Volunteers write notes during and after calls. Notes are encrypted client-side using ECIES (secp256k1 + XChaCha20-Poly1305) before leaving the browser. The server stores only ciphertext.

**Dual encryption** — Every note is encrypted twice: once for the volunteer who wrote it, and once for the admin. Both can decrypt independently. No one else can read the content.

**Custom fields** — Admins define custom fields for notes: text, number, select, checkbox, textarea. Fields are encrypted alongside note content.

**Draft auto-save** — Notes are auto-saved as encrypted drafts in the browser. If the page reloads or the volunteer navigates away, their work is preserved. Drafts are cleaned on logout.

## AI Transcription

**Whisper-powered transcription** — Call recordings are transcribed using Cloudflare Workers AI with the Whisper model. Transcription happens server-side, then the transcript is encrypted before storage.

**Toggle controls** — Admin can enable/disable transcription globally. Volunteers can opt out individually. Both toggles are independent.

**Encrypted transcripts** — Transcripts use the same ECIES encryption as notes. The stored transcript is ciphertext only.

## Spam Mitigation

**Voice CAPTCHA** — Optional voice bot detection: callers hear a randomized 4-digit number and must enter it on the keypad. Blocks automated dialing while remaining accessible to real callers.

**Rate limiting** — Sliding-window rate limiting per phone number, persisted in Durable Object storage. Survives Worker restarts. Configurable thresholds.

**Real-time ban lists** — Admins manage phone number ban lists with single-entry or bulk import. Bans take effect immediately. Banned callers hear a rejection message.

**Custom IVR prompts** — Record custom voice prompts for each supported language. The system uses your recordings for IVR flows, falling back to text-to-speech when no recording exists.

## Admin Dashboard

**Real-time call monitoring** — See active calls, queued callers, and volunteer status in real time via WebSocket. Metrics update instantly.

**Volunteer management** — Add volunteers with generated keypairs, manage roles, view online status. Invite links for self-registration.

**Audit logging** — Every call answered, note created, setting changed, and admin action is logged. Paginated viewer for admins.

**Call history** — Searchable, filterable call history with date ranges, phone number search, and volunteer assignment. GDPR-compliant data export.

## Multi-Language & Mobile

**12+ languages** — Full UI translations: English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, Portuguese, and German. RTL support for Arabic.

**Progressive Web App** — Installable on any device via the browser. Service worker caches the app shell for offline launch. Push notifications for incoming calls.

**Mobile-first design** — Responsive layout built for phones and tablets. Collapsible sidebar, touch-friendly controls, and adaptive layouts.

## Authentication

**Nostr keypair auth** — Volunteers authenticate with Nostr-compatible keypairs (nsec/npub). BIP-340 Schnorr signature verification. No passwords, no email addresses.

**WebAuthn passkeys** — Optional passkey support for multi-device login. Register a hardware key or biometric, then sign in without typing your secret key.

**Session management** — 8-hour session tokens with idle timeout warnings. Session renewal, expiry dialogs, and automatic cleanup.
