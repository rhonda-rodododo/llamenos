# User Security & Device Management — Design Spec

**Date:** 2026-04-04
**Branch:** `feat/device-management`
**Status:** Draft — pending user review

## 1. Overview

A new user-facing **Security** area that gives volunteers and admins autonomy over their account security: active session management, passkey management, auth event history, PIN & recovery-key self-rotation, Signal login alerts, and a tiered emergency lockdown. Enabled by the recently completed IdP auth work.

The app protects volunteer identity against well-funded adversaries (nation-state actors, targeted hacking). Users currently have no visibility into active login sessions, no way to see where/when they've logged in, no server-side emergency lockdown, and no way to rotate their PIN or recovery key. This spec closes those gaps.

## 2. Goals & Non-Goals

### Goals

- Give users a single Security dashboard that surfaces all active logins with approximate geolocation and one-click revocation.
- Enable users to rotate security factors (PIN, recovery key) without admin intervention.
- Notify users via Signal when security-relevant events occur on their account.
- Provide a tiered emergency lockdown flow for volunteers who suspect account compromise.
- Enforce Signal-only delivery for all user-facing notifications and user onboarding invites.
- Preserve zero-knowledge posture: the app server holds no plaintext Signal identifiers post-onboarding.

### Non-Goals

- Step-up re-authentication for sensitive actions (deferred to backlog).
- "Trusted browser" / remember-this-device (deferred to backlog).
- WebAuthn-as-KEK-factor add/remove (deferred to backlog).
- Removing email notifications application-wide (separate audit effort).
- Changing the existing client-only panic-wipe (triple-Escape) behavior.

## 3. Feature Scope

| # | Feature | Type |
|---|---|---|
| 1 | Active Sessions list + individual revoke + sign-out-everywhere | New |
| 2 | Passkey UI polish — rename endpoint, label-rename UI, transport display, route rename `/devices` → `/passkeys` | Extension |
| 3 | User Auth Event History (90-day rolling, user-envelope encrypted, user-scoped) | New |
| 4 | Emergency Lockdown (tiered server-side: A/B/C) with inline recovery-key rotation | New |
| 5 | Signal login alerts (always-on security events + weekly digest, user-configurable cadence) | New |
| 6 | PIN change | New |
| 7 | Rotate Recovery Key (standalone + embedded in lockdown modal) | New |
| 8 | Auth-history export (user downloads their own history JSON) | New |
| 9 | Signal-only user invites (remove WhatsApp/SMS from user invite flow; blasts unchanged) | Fix |
| 10 | Idle auto-lock slider UI (bind existing `setLockDelay()` to Security page) | Glue |
| 11 | Delete dead `jwt_revocations` table | Cleanup |

## 4. Architecture

### 4.1 Session Model — Opaque Tokens + Sessions Table

Replaces the current stateless JWT refresh-token path. Allows per-session revocation, IP+geo tracking, and replay detection via rotation.

**New table `user_sessions`:**

```ts
user_sessions
  id               uuid primary key
  userPubkey       text not null  (fk → users.pubkey, indexed)
  tokenHash        text not null  (HMAC-SHA256 of 32-byte opaque token, indexed)
  ipHash           text not null  (reuses existing hashIP())
  credentialId     text nullable  (WebAuthn credential id used for login; null for non-WebAuthn auth)
  encryptedMeta    ciphertext not null  (XChaCha20, user-envelope: {ip, userAgent, city, region, country, lat, lon})
  metaEnvelope     jsonb<RecipientEnvelope[]> not null  (single recipient = session owner)
  createdAt        timestamp not null
  lastSeenAt       timestamp not null
  revokedAt        timestamp nullable
  revokedReason    text nullable  ('user' | 'lockdown_a' | 'lockdown_b' | 'lockdown_c' | 'admin' | 'replay' | 'expired')
  expiresAt        timestamp not null  (createdAt + 30d sliding)
```

**Flows:**
- **Login success** (`/webauthn/login-verify`): insert session row, set opaque 32-byte random token (base64url) in HttpOnly cookie, persist only `sha256(token)` hash.
- **Token refresh** (`/token/refresh`): look up by `tokenHash` → validate `revokedAt IS NULL AND expiresAt > now()` → rotate token (generate new, replace hash, return new cookie), update `lastSeenAt`.
- **Replay detection**: if presented cookie's hash doesn't match current row but matches a prior hash chain entry, treat as theft → set `revokedAt + revokedReason='replay'` + fire Signal alert.
- **Drop `jwt_revocations`** table (currently orphaned, never queried).

### 4.2 Geolocation — DB-IP Lite (Offline, City-Level)

- Bundle `dbip-city-lite.mmdb` (~150MB) in server image at `/app/data/geoip/dbip-city.mmdb`.
- Refresh monthly via Ansible cron job (`deploy/ansible/roles/app/tasks/geoip-refresh.yml`).
- New `src/server/lib/geoip.ts` wraps the `maxmind` npm package (reads both MaxMind and DB-IP MMDB formats).
- IP → `{city, region, country, lat, lon}` looked up once at session creation, stored inside `encryptedMeta` envelope. No runtime dependency after lookup.
- DB miss fallback: `{country: 'unknown'}`. UI renders "Unknown location." Never fails a login.

### 4.3 Auth Event History

**New table `user_auth_events`** (user-envelope encrypted, user-scoped):

```ts
user_auth_events
  id                      uuid primary key
  userPubkey              text not null (indexed)
  eventType               text not null
  encryptedPayload        ciphertext  (user-envelope: {sessionId?, ipHash?, city?, country?, userAgent?, meta?})
  payloadEnvelope         jsonb<RecipientEnvelope[]>
  createdAt               timestamp not null (indexed, descending for query)
  reportedSuspiciousAt    timestamp nullable
```

**Event types:**
- `login`, `login_failed`, `logout`
- `session_revoked`, `sessions_revoked_others`
- `passkey_added`, `passkey_removed`, `passkey_renamed`
- `pin_changed`, `recovery_rotated`
- `lockdown_triggered` (records tier)
- `alert_sent` (records notification delivery)
- `signal_contact_changed`

**Retention:** 90-day rolling purge via existing retention cron pattern (`src/server/services/gdpr.ts`).

**Client decrypt:** in React Query `queryFn` per project convention (not in components). Payload decrypted via crypto-worker.

**Report suspicious:** `POST /api/auth/events/:id/report` sets `reportedSuspiciousAt` AND writes entry to existing admin audit log (hash-chained, server-encrypted) so admins see the flag with their forensics tools.

### 4.4 Signal Alerts — Resolver Pattern (Zero-Knowledge)

**Key privacy property:** app server never holds plaintext Signal identifiers after onboarding. Server only sees an HMAC hash; the bridge maps hash → plaintext.

**New table `user_signal_contacts`:**

```ts
user_signal_contacts
  userPubkey            text primary key
  identifierHash        text not null  (HMAC-SHA256 of normalized identifier, indexed)
  identifierEnvelope    jsonb<RecipientEnvelope[]>  (user-envelope: {identifier, type: 'phone'|'username'})
  identifierCiphertext  ciphertext not null
  verifiedAt            timestamp nullable
  updatedAt             timestamp not null
```

Identifier is either Signal username (`@handle.01`) or E.164 phone number — user's choice. Normalized before hashing (lowercased usernames, stripped formatting on phones).

**Bridge extension** (extend `signal-cli-rest-api` container or thin proxy sidecar):

- `POST /identities/register` — body `{identifierPlaintext, identifierHash, registrationToken}` — bridge stores plaintext keyed by hash in its own persistence. Called directly by client, not app server.
- `POST /notify` — body `{identifierHash, message, disappearingTimer}` — bridge resolves hash → plaintext → sends via Signal. Hash miss returns 404.
- Existing `POST /send` path (plaintext recipient) kept for invite delivery — one-shot moment where plaintext is acceptable (admin typed it).

**Registration flow** (user-initiated, post-onboarding):

1. User enters Signal identifier in Security page UI.
2. Client requests bridge registration token from app server (`GET /api/auth/signal-contact/register-token`).
3. Client computes HMAC hash with shared secret from server.
4. Client POSTs `{plaintextIdentifier, identifierHash, registrationToken}` **directly to bridge**.
5. Bridge confirms → client POSTs `{identifierHash, identifierEnvelope, identifierCiphertext}` to app server to record.
6. App server writes `user_signal_contacts` row. **App server never sees plaintext**.

**Onboarding path** (existing invite delivery, unchanged): admin types recipient phone, server sees it, encrypts for user envelope, forwards to bridge. On first login the user is prompted to register their ongoing Signal contact (can keep same number, switch to username, or use a different number).

**Notification flow** (server-triggered):

1. Auth event fires (new device, passkey removed, etc.).
2. Server looks up `identifierHash` for target user from `user_signal_contacts`.
3. Server POSTs `{identifierHash, message, disappearingTimer: userPref}` to bridge `/notify`.
4. Bridge resolves → Signal. Server records `alert_sent` event in `user_auth_events`.

**Delivery retry:** bounded queue, max 3 retries with exponential backoff. Drop after exhaustion (logged server-side, user can see "Alert queued but not delivered" in history).

### 4.5 Alert Trigger Logic

**Always-on alerts (cannot be disabled):**
- New device: first login from a never-seen IP hash for this user.
- Passkey added or removed.
- PIN changed.
- Recovery key rotated.
- Emergency lockdown triggered (tier included in message).
- Session revoked from a different session than the current one.

**Digest alerts (cadence configurable, default weekly):**
- Summary: N logins, M alerts in the period, any failed-login attempts.
- Cadence options: off | daily | weekly (default).

**Disappearing message timer:** user-configurable, default 1 day, max 7 days. Stored in `user_security_prefs`.

### 4.6 Emergency Lockdown — Tiered

**Modal with three tier buttons + inline recovery-key rotation:**

- **Tier A — "Sign out everywhere else"**: revoke all sessions except current. Passkeys untouched.
- **Tier B — "Remove other devices + passkeys"**: revoke all sessions except current + delete all WebAuthn credentials except the one used for current session (credential id stored in session meta at login).
- **Tier C — "Full lockdown"**: revoke ALL sessions (including current) + delete ALL passkeys + mark user as `active=false` pending admin reactivation. Forces recovery flow on next login.

**Confirmation gate:** user must type `LOCKDOWN` (case-sensitive) AND re-enter PIN before any tier executes.

**Pre-flight safety — Rotate Recovery Key:** modal includes "Rotate & download recovery key" button. Rotating generates new recovery key, displays once, invalidates old. User saves it before confirming lockdown.

**Always fires regardless of tier:**
- Signal alert to user: "Emergency lockdown tier X triggered from [device label] at [time]".
- Signal alert to all admins: "Volunteer [user initials] triggered emergency lockdown at [time]" (no reason disclosed).
- Entry in user's auth event history + admin audit log.

**Distinction from existing client-only panic-wipe:** panic-wipe (triple-Escape, `src/client/lib/panic-wipe.ts`) wipes local key material only, no server interaction. Emergency Lockdown is server-side, user-initiated, for "I'm safe but worried about another session/device." Both coexist.

### 4.7 PIN Change & Recovery Key Rotation

Both are KEK factor rotations. Client unlocks KEK with current factor → re-wraps with new factor → uploads new ciphertext.

**PIN change** (`POST /api/auth/pin/change`):
- Client-side: user enters current PIN + new PIN → crypto-worker unlocks KEK, re-derives with new PIN, re-encrypts nsec → sends `{currentPinProof, newEncryptedKeyMaterial}` to server.
- Server: verifies currentPinProof (derived value matches stored), updates `users.encryptedSecretKey`.
- Rate limited: 5/hour per user.
- Fires `pin_changed` event.

**Rotate recovery key** (`POST /api/auth/recovery/rotate`):
- Client generates new 128-bit recovery key (Base32 formatted per existing `generateRecoveryKey()`).
- Client re-wraps KEK with new recovery factor.
- Server stores new recovery-factor ciphertext, displays new key once in UI for user to save.
- Old recovery key invalidated.
- Fires `recovery_rotated` event.

## 5. API Surface

All under `/api/auth/` using `OpenAPIHono` + zod schemas per project convention. **Every endpoint validates request bodies and path params via zod schemas in `src/shared/schemas/`.**

### 5.1 Schemas (new files in `src/shared/schemas/`)

- `sessions.ts` — `SessionSchema`, `SessionListResponseSchema`, `RevokeSessionParamsSchema`, `LockdownRequestSchema` (tier enum)
- `auth-events.ts` — `AuthEventSchema`, `AuthEventListQuerySchema`, `ReportEventResponseSchema`, `EventTypeSchema` (enum)
- `signal-contact.ts` — `SignalContactSchema`, `SignalContactRegisterSchema`, `SignalIdentifierTypeSchema` (enum)
- `security-prefs.ts` — `SecurityPrefsSchema`, `UpdateSecurityPrefsSchema`, `DigestCadenceSchema` (enum)
- `passkey-rename.ts` — `PasskeyRenameSchema` (extends existing passkey schemas)
- `pin-change.ts` — `PinChangeSchema`
- `recovery-rotate.ts` — `RecoveryRotateSchema`, `RecoveryRotateResponseSchema`

Types derived via `z.infer<>`. OpenAPI docs auto-generated at `/api/docs`.

### 5.2 Endpoints

**Sessions:**
- `GET    /api/auth/sessions` — list caller's sessions (encrypted meta + `isCurrent` flag)
- `DELETE /api/auth/sessions/:id` — revoke one session
- `POST   /api/auth/sessions/revoke-others` — revoke all except current
- `POST   /api/auth/sessions/lockdown` — body `{tier: 'A'|'B'|'C', confirmation: 'LOCKDOWN', pin: string}`

**Passkeys** (rename route group from `/devices` → `/passkeys`, one-release alias):
- `GET    /api/auth/passkeys` (existing, moved)
- `POST   /api/auth/passkeys/register-options` (existing, moved)
- `POST   /api/auth/passkeys/register-verify` (existing, moved)
- `PATCH  /api/auth/passkeys/:id` — rename label `{label?, encryptedLabel?, labelEnvelopes?}`
- `DELETE /api/auth/passkeys/:id` (existing, moved)

**Auth history:**
- `GET    /api/auth/events?since=&limit=&cursor=` — paginated encrypted events
- `POST   /api/auth/events/:id/report` — mark suspicious + raise admin audit entry
- `GET    /api/auth/events/export` — JSON export (client decrypts post-fetch)

**Security factors:**
- `POST   /api/auth/pin/change`
- `POST   /api/auth/recovery/rotate`

**Signal contact:**
- `GET    /api/auth/signal-contact` — current hash + envelope
- `GET    /api/auth/signal-contact/register-token` — bridge registration token
- `POST   /api/auth/signal-contact` — record post-bridge registration
- `DELETE /api/auth/signal-contact`

**Security preferences:**
- `GET    /api/auth/security-prefs`
- `PATCH  /api/auth/security-prefs`

### 5.3 New table `user_security_prefs`

```ts
user_security_prefs
  userPubkey            text primary key
  lockDelayMs           integer not null default 30000  (0..600000)
  disappearingTimerDays integer not null default 1      (1..7)
  digestCadence         text not null default 'weekly'  ('off'|'daily'|'weekly')
  alertOnNewDevice      boolean not null default true   (always-on UI; this is a safety rail, always true)
  alertOnPasskeyChange  boolean not null default true
  alertOnPinChange      boolean not null default true
  updatedAt             timestamp not null
```

The always-on alerts (new device, passkey change, PIN change, lockdown) cannot be disabled in UI; columns exist for future-proofing.

## 6. UI Layout

New route tree `/security` (new parent, not folded into existing `/settings`):

```
/security                  → redirects to /security/sessions
/security/sessions         → Active sessions list, individual revoke, sign-out-everywhere, Emergency Lockdown button
/security/passkeys         → Passkey list (renamed from /devices), add/rename/remove, transport display
/security/history          → 90-day timeline, "Report suspicious", "Export history" button
/security/factors          → Change PIN, Rotate recovery key, Signal contact, Idle lock delay slider, Alert preferences
```

- Existing `/devices` route redirects to `/security/passkeys` for one release.
- Navigation: new "Security" entry in user menu (Profile entry retained separately).
- Passkey list shows: label, transport badges (USB / Internal / Hybrid / QR), `backedUp` indicator, `createdAt`, `lastUsedAt`, rename + delete actions.
- Session list shows: approximate location ("Berlin, DE"), user-agent summary ("Firefox on macOS"), last-seen relative, "Current session" badge, revoke button.

## 7. Testing Strategy

Per project's three-suite architecture. All tests written using the `test-writer` skill patterns.

### 7.1 Unit tests (`bun:test`, colocated `.test.ts`)
- `session-service.test.ts` — token generation, hashing, rotation semantics, replay detection, expiry
- `geoip.test.ts` — lookup, DB-miss fallback, MMDB reader wrapping
- `user-notifications.test.ts` — message formatting, bridge client mock, retry logic
- `auth-events-service.test.ts` — event recording, retention purge, user-envelope encryption
- `signal-contact-service.test.ts` — hash normalization, contact lifecycle

### 7.2 API E2E (`tests/api/`, Playwright no-browser)
- Session lifecycle: login → list sessions → revoke one → verify revoked → refresh fails
- Sign-out-everywhere leaves current session alive
- Lockdown tiers A/B/C: behavior verification (sessions revoked, passkeys present/removed, user active flag)
- PIN change: happy path, wrong current PIN, rate limit
- Recovery rotation: new key valid, old key rejected
- Signal contact register → notify flow (bridge mocked)
- History pagination + report-suspicious raises admin audit entry
- History export returns valid JSON

### 7.3 UI E2E (`tests/ui/`, Chromium)
- Navigate `/security` → tab renders
- Revoke session from list, current session marker unchanged
- Rename passkey label (both E2EE label and envelope)
- Lockdown modal: typed-word + PIN gate, tier selection
- Signal contact entry flow (bridge mocked)
- Idle lock delay slider persists

### 7.4 Security/adversarial tests
- Replayed refresh token → 401 + session revoked + alert fired
- Cross-user session access attempt → 404 (no info leak)
- Invalid HMAC on signal identifier → 400
- Rate limits on PIN change, recovery rotation, report-suspicious

## 8. Migration Sequencing

Drizzle migrations in order:
1. Create `user_sessions` + indexes (before auth-facade code changes)
2. Create `user_auth_events` + retention cron wiring
3. Create `user_signal_contacts`
4. Create `user_security_prefs`
5. Drop `jwt_revocations` (orphaned, never queried)

Since this app is pre-production (per CLAUDE.md), server code migration is atomic — no JWT-refresh/opaque-token dual-write phase. Single PR swaps the refresh flow.

## 9. Error Handling

| Case | Response |
|---|---|
| Session not found at refresh | 401, client redirects to login |
| Session revoked at refresh | 401, client redirects to login |
| Replay detected (hash mismatch, prior hash seen) | 401 + revoke session + Signal alert, reason=`replay` |
| Bridge unreachable during notification | Log + enqueue retry (max 3, exp backoff), drop after; user sees status in history |
| GeoIP DB miss | Fallback `{country: 'unknown'}`, log miss, never fail login |
| PIN change wrong current PIN | 401, rate-limited 5/hour per user |
| Recovery rotation fails mid-flow | Transaction rollback, old key still valid |
| Lockdown without confirmation phrase | 400 with descriptive error |
| Lockdown with wrong PIN | 401, rate-limited 3/15min per user |
| Signal contact hash collision (vanishingly rare) | 409, ask user to retry with different identifier |

## 10. Security Considerations

- **Opaque token strength**: 32 random bytes (CSPRNG), base64url-encoded. ~256 bits entropy.
- **Token storage**: only HMAC-SHA256 hash stored (not plaintext). Secret: existing `HMAC_SECRET` env var.
- **Replay detection adds defense against stolen cookies**: rotation on each refresh invalidates copies immediately.
- **Signal-only for user notifications**: removes SMS/WhatsApp attack surface (SIM swap, intercept).
- **No plaintext Signal identifiers in app server DB** post-onboarding: compromise of app DB doesn't leak contact list.
- **User-envelope encryption for session meta**: admin cannot see user IP history (distinct from admin audit log).
- **Rate limits on security-sensitive endpoints**: PIN change (5/hr), recovery rotation (3/day), report-suspicious (20/day), lockdown (3/15min).
- **90-day retention minimizes data liability** while preserving useful forensic window.
- **Confirmation gate on lockdown** prevents accidental/fat-finger triggering.
- **Admins notified on volunteer lockdown** (no reason disclosed): ops awareness without surveillance.

## 11. Open Questions

- Should admin audit log include the user's IP/city for `login` events for admin forensics, or does that conflict with user-envelope-only principle? (Proposed: admin audit log keeps the hashed IP + server-derived country only; city stays in user envelope.)
- Disappearing-message support in signal-cli bridge — confirm the bridge's API surface supports per-message timer. (Action: verify during planning.)
- DB-IP Lite license acceptance in production image — verify CC-BY attribution bundled. (Action: include LICENSE file in image build.)

## 12. Rollout & Ops

- Ansible role `geoip` downloads DB-IP Lite at first boot + monthly refresh cron.
- Signal bridge version bump required for `/identities/register` + `/notify` endpoints (if extending existing signal-cli-rest-api) or sidecar proxy added.
- Retention cron extended to purge `user_auth_events` older than 90 days.
- Migration PR is atomic: old refresh-JWT path removed in same PR new sessions table is added.

## 13. Deferred to Backlog

Recorded in `docs/NEXT_BACKLOG.md` (Deferred from User Security & Device Management section):
- WebAuthn-as-KEK-factor add/remove
- Trusted browser / "remember this device"
- Step-up re-auth for sensitive actions
