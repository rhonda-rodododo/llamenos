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
