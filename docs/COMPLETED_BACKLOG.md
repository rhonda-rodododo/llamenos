# Completed Backlog

## 2026-02-07: Initial MVP Build

### Epic 1: Project Foundation
- [x] Vite + TanStack Router SPA with file-based routing
- [x] Tailwind CSS v4 with dark theme
- [x] i18n with English + Spanish translations
- [x] Nostr keypair authentication
- [x] XChaCha20-Poly1305 note encryption
- [x] WebSocket real-time updates
- [x] Cloudflare Workers + Durable Objects backend
- [x] CLI admin bootstrap script

### Epic 2: Admin System
- [x] Volunteer management (CRUD, role assignment)
- [x] Client-side keypair generation for new volunteers
- [x] Shift scheduling with recurring days and time ranges
- [x] Fallback ring group configuration
- [x] Ban list management (single + bulk import)
- [x] Audit log viewer with pagination
- [x] Settings page (spam mitigation, transcription)

### Epic 3: Telephony
- [x] TelephonyAdapter interface (provider-agnostic)
- [x] Twilio implementation (incoming calls, parallel ringing, CAPTCHA)
- [x] Voice CAPTCHA with randomized 4-digit input
- [x] Sliding-window rate limiting per phone number
- [x] Ban check on incoming calls
- [x] Shift-based routing with fallback group
- [x] Call queue with hold music

### Epic 4: Volunteer Experience
- [x] Real-time dashboard with call status cards
- [x] Incoming call UI with answer button
- [x] Active call panel with timer and note-taking
- [x] Spam reporting from active call
- [x] Notes page with call grouping
- [x] Client-side note encryption/decryption

### Epic 5: Transcription
- [x] Cloudflare Workers AI (Whisper) integration
- [x] Admin toggle for global transcription enable/disable
- [x] Volunteer toggle for per-user transcription preference
- [x] Post-call transcript viewing in notes
- [x] Post-call transcript editing by volunteers

### Epic 6: UI Polish & Quality
- [x] shadcn/ui component system (button, card, badge, dialog, input, label, select, switch, separator)
- [x] Toast notification system (success, error, info)
- [x] Loading skeletons on all data pages
- [x] Call history page for admins with pagination
- [x] Profile setup flow (language selection on first login)
- [x] Volunteer on-break availability toggle (pause calls without leaving shift)
- [x] Server-side E.164 phone number validation
- [x] Session expiry with 5-minute token window (replay attack prevention)

### Epic 7: E2EE for Transcriptions
- [x] ECIES encryption using ephemeral ECDH with secp256k1
- [x] Server-side: encrypt transcription for volunteer's pubkey + admin's pubkey
- [x] Client-side: decrypt transcription via ECDH shared secret
- [x] XChaCha20-Poly1305 symmetric encryption with domain-separated key derivation
- [x] Ephemeral private key discarded immediately (forward secrecy)
- [x] Dual encryption: volunteer copy + admin copy for independent decryption
- [x] Backward compatibility with legacy plaintext transcriptions

### Epic 8: Call History Search/Filter
- [x] TanStack Router validateSearch for URL-persisted search params
- [x] Search by phone number or volunteer pubkey
- [x] Date range filtering (from/to)
- [x] Backend filtering in CallRouter DO

### Epic 9: Security Audit & Hardening
- [x] Twilio webhook signature validation (HMAC-SHA1)
- [x] Auth rate limiting (10 attempts/min per IP)
- [x] CORS restricted to same-origin (dev: localhost:5173)
- [x] Content-Security-Policy header added
- [x] Caller phone number redacted for non-admin users
- [x] Path traversal protection via extractPathParam helper
- [x] Confirmation dialogs replaced browser confirm() (ConfirmDialog component)

### Epic 10: E2E Tests
- [x] Smoke test: app loads, shows login, rejects invalid nsec
- [x] Admin flow: login, nav, volunteer CRUD, shifts, bans, audit log, settings, call history, notes, i18n, logout
- [x] Updated tests for ConfirmDialog (replaced window.confirm)
