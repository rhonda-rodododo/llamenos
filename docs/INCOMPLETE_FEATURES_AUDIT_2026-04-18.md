# Incomplete Features Audit — Server-Client Gaps

**Date:** 2026-04-18  
**Branch:** `docs/incomplete-features-audit`  
**Auditor:** Kimi Code CLI (re-dispatch of prompt 78)  
**Scope:** Discovery + planning only. No code changes.

---

## Executive Summary

This audit sweeps the codebase for the pattern identified in PR #166/174 — **server infrastructure complete, client wiring missing** — and finds it is indeed widespread. We identify **8 incomplete features** across three categories, plus **6 orphaned API/query functions** that are defined but never imported by UI code.

No P0 (security-critical) gaps were found in this sweep. The highest-priority gaps are **P1** — functional features that volunteers or admins expect to work but have no UI.

---

## Methodology

1. **Server route inventory** — listed all `createRoute` / `app.(get|post|put|patch|delete)` definitions in `src/server/routes/`.
2. **Client caller mapping** — for each non-webhook/non-health route prefix, checked `src/client/` for API imports, query-hook imports, and UI component usage.
3. **Schema import check** — verified which `src/shared/schemas/*.ts` files are imported by client code.
4. **DB table check** — cross-referenced `pgTable` definitions against services and routes.
5. **Git history** — reviewed recent commits for `feat|wip|partial|scaffold|skeleton` markers.
6. **Admin nav registry** — compared `admin-nav-config.ts` + `registry.ts` against available server routes.

Time-boxed: ~75 min total (30 + 15 + 15 + 15).

---

## Category 1: Server-Only Features (routes + DB + schemas exist, client UI missing)

### 1.1 GDPR / Account Erasure — P1

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `GET /gdpr/me/erasure`, `DELETE /gdpr/me`, `DELETE /gdpr/me/cancel`, `GET /gdpr/export`, `POST /gdpr/admin/erase` |
| DB tables | ✅ Complete | `gdprConsents`, `gdprErasureRequests` in `settings.ts` schema |
| Zod schemas | ✅ Complete | `src/shared/schemas/gdpr.ts` |
| Client API | ⚠️ Exists but unused | `src/client/lib/api/gdpr.ts` defines `getMyErasureRequest`, `requestAccountErasure`, `cancelAccountErasure`, `downloadMyData` |
| Client queries | ❌ Missing | No React Query hooks |
| Client UI | ❌ Missing | No routes, no components, no nav items. The `ConsentGate` component only handles consent-version submission (a different flow). |

**What's missing:**
- React Query hooks for erasure request lifecycle
- User-facing "Download my data" button/page
- User-facing "Delete my account" flow with cancellation grace-period UI
- Admin erasure-request dashboard

**Effort estimate:** 2–3 days (hooks + user profile page additions + admin section)

---

### 1.2 Contacts Bulk Import / Merge — P1

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `POST /contacts/import` (batch, 500 max), `POST /contacts/:primaryId/merge`, `PATCH /contacts/bulk`, `DELETE /contacts/bulk` |
| DB tables | ✅ Complete | `contacts`, `contactRelationships`, `contactCallLinks`, `contactConversationLinks` |
| Zod schemas | ✅ Complete | `src/shared/schemas/contacts.ts` |
| Client API | ✅ Complete | `bulkUpdateContacts`, `bulkDeleteContacts`, `mergeContacts` in `src/client/lib/api/contacts.ts` |
| Client queries | ✅ Complete | `useBulkUpdateContacts`, `useBulkDeleteContacts`, `useMergeContacts` in `src/client/lib/queries/contacts.ts` |
| Client UI | ❌ Missing | **Zero** UI components import these hooks. The contacts route (`src/client/routes/contacts.tsx`) has no batch-selection, no import dialog, no merge UI. |

**What's missing:**
- Bulk import CSV/JSON dialog (`POST /contacts/import`)
- Contact merge UI (`POST /contacts/:primaryId/merge`)
- Batch select + bulk update/delete in contacts table

**Effort estimate:** 3–4 days (import dialog with file parsing, merge modal, batch selection state)

---

### 1.3 Telephony Provider Setup Wizard (OAuth, A2P, Provisioning) — P1

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `/setup/provider/*` — validate, webhooks, list/search/provision phone numbers, configure-webhooks, oauth/start, oauth/status, a2p/brand, a2p/status, a2p/campaign, a2p/skip |
| Client API | ✅ Complete | `validateProviderCredentials`, `listProviderPhoneNumbers`, `searchAvailablePhoneNumbers`, `provisionPhoneNumber`, `startProviderOAuth`, `getWebhookUrls`, etc. in `src/client/lib/api/settings.ts` |
| Client queries | ⚠️ Partial | No dedicated query hooks; functions are called ad-hoc or not at all |
| Client UI | ❌ Missing | `PhoneProviderSection` only uses `getTelephonyProvider`, `updateTelephonyProvider`, `testTelephonyProvider`. OAuth flow, A2P brand/campaign setup, phone-number search/provisioning UI are absent. |

**What's missing:**
- OAuth redirect handler / callback page
- A2P brand registration form
- A2P campaign creation form
- Phone number search + provision UI
- Webhook URL display/copy UI

**Effort estimate:** 4–5 days (multi-step wizard, OAuth callback route, A2P forms)

---

### 1.4 Retention Settings — P2

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `GET /settings/retention`, `PATCH /settings/retention` |
| Client API | ✅ Complete | `getRetentionSettings`, `updateRetentionSettings` in `src/client/lib/api/settings.ts` |
| Client queries | ❌ Missing | No React Query hooks |
| Client UI | ❌ Missing | No admin section component |

**What's missing:**
- Admin UI for configuring data-retention policies (call history, notes, audit log TTL)

**Effort estimate:** 1 day

---

### 1.5 Settings Fallback Group — P2

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `GET /settings/fallback-group`, `PATCH /settings/fallback-group` |
| Client API | ❌ Missing | No functions in `src/client/lib/api/settings.ts` |
| Client queries | ❌ Missing | No hooks |
| Client UI | ⚠️ Partially covered | Shifts page uses `/shifts/fallback` (different endpoint) via `useFallbackGroup` / `useSetFallbackGroup`. The `/settings/fallback-group` endpoint is orphaned. |

**Note:** The shifts endpoint and settings endpoint may be redundant. Verify if `/settings/fallback-group` is the canonical one and `/shifts/fallback` should be deprecated, or vice versa.

**Effort estimate:** 0.5 day (unify endpoints) or 1 day (add settings UI)

---

### 1.6 Note Replies — P2

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `GET /notes/:id/replies`, `POST /notes/:id/replies` |
| Client API | ❌ Missing | No functions in `src/client/lib/api/notes.ts` |
| Client queries | ❌ Missing | No hooks |
| Client UI | ❌ Missing | No reply UI in notes page or call detail |

**What's missing:**
- `getNoteReplies`, `createNoteReply` API functions
- `useNoteReplies`, `useCreateNoteReply` query hooks
- Reply thread UI in note detail view

**Effort estimate:** 1–2 days

---

### 1.7 Intake Detail View — P2

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `GET /intakes/:id` |
| Client API | ❌ Missing | No `getIntake` function in `src/client/lib/api/intakes.ts` |
| Client queries | ❌ Missing | No `useIntake` hook |
| Client UI | ⚠️ Partial | Intakes list exists (`src/client/routes/intakes.tsx`), but no individual intake detail page/route. |

**What's missing:**
- `getIntake` API function
- `useIntake` query hook
- Intake detail route + page (review, approve, merge into contact)

**Effort estimate:** 1–2 days

---

### 1.8 Report Detail + Files — P2

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `GET /reports/:id`, `GET /reports/:id/files` |
| Client API | ⚠️ Exists but not exported | `getReport` (line 50) and `getReportFiles` (line 73) are defined as `async function` (not `export async function`) in `src/client/lib/api/reports.ts` |
| Client queries | ❌ Missing | No `useReport` or `useReportFiles` hooks |
| Client UI | ⚠️ Partial | Reports list and messages exist, but no dedicated report detail view or file attachment viewer. |

**What's missing:**
- Export `getReport` and `getReportFiles`
- `useReport`, `useReportFiles` query hooks
- Report detail page with file download/viewer

**Effort estimate:** 1–2 days

---

### 1.9 Conversation Load Balancing — P2

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `GET /conversations/load` |
| Client API | ⚠️ Exists but not exported | `getUserLoads` (line 133) defined as non-exported `async function` in `src/client/lib/api/conversations.ts` |
| Client queries | ❌ Missing | No hook |
| Client UI | ❌ Missing | No load-balancing indicator in conversations UI |

**What's missing:**
- Export `getUserLoads`
- `useConversationLoads` query hook
- Load indicator in conversation claim UI

**Effort estimate:** 0.5–1 day

---

### 1.10 Team Contact Assignment — P2

| Layer | Status | Details |
|-------|--------|---------|
| Server routes | ✅ Complete | `GET /teams/:id/contacts`, `POST /teams/:id/contacts`, `DELETE /teams/:id/contacts/:contactId` |
| Client API | ✅ Complete | `listTeamContacts`, `assignTeamContacts`, `unassignTeamContact` in `src/client/lib/api/teams.ts` |
| Client queries | ✅ Complete | `useTeamContacts`, `useAssignTeamContacts`, `useUnassignTeamContact` in `src/client/lib/queries/teams.ts` |
| Client UI | ❌ Missing | `TeamsSection` manages members but **never** imports the contact-assignment hooks. `contactCount` is displayed but cannot be modified. |

**What's missing:**
- Contact assignment UI inside team detail / team members panel
- Contact-to-team assignment from contacts page

**Effort estimate:** 1–2 days

---

## Category 2: Orphaned Client Code (defined but never imported by UI)

| Module | Symbol | Type | Last known importer |
|--------|--------|------|---------------------|
| `src/client/lib/api/reports.ts` | `getReport` | API function | **Never exported** — dead code |
| `src/client/lib/api/reports.ts` | `getReportFiles` | API function | **Never exported** — dead code |
| `src/client/lib/api/conversations.ts` | `getUserLoads` | API function | **Never exported** — dead code |
| `src/client/lib/queries/teams.ts` | `useAssignTeamContacts` | Query hook | **Zero imports** in `src/client/` |
| `src/client/lib/queries/teams.ts` | `useUnassignTeamContact` | Query hook | **Zero imports** in `src/client/` |
| `src/client/lib/queries/contacts.ts` | `useMergeContacts` | Query hook | **Zero imports** in `src/client/` |
| `src/client/lib/queries/contacts.ts` | `useBulkUpdateContacts` | Query hook | **Zero imports** in `src/client/` |
| `src/client/lib/queries/contacts.ts` | `useBulkDeleteContacts` | Query hook | **Zero imports** in `src/client/` |

These are safe to keep — they will be wired once the corresponding UI is built — but they should be flagged in knip/CI as "intentionally unused" to prevent accidental deletion.

---

## Category 3: Skeleton Implementations

### 3.1 MLS (Message Layer Security) — Already tracked

- **Server:** 8 routes, 3 DB tables (`mls_hub_state`, `mls_key_packages`, `mls_epoch_commits`), full zod schemas
- **Client crypto infra:** `core-crypto-loader.ts`, `emoji-table.ts`, `sas.ts` (for fingerprint verification)
- **Client wiring:** NO API module, NO query hooks, NO UI. `src/client/lib/mls/conversation.ts` is an 11-line skeleton per `NEXT_BACKLOG.md`.
- **Action:** Continue as planned in `NEXT_BACKLOG.md` Tier 6 PR #2.

---

## Priority Matrix

| Priority | Feature | Security / Ops Impact | Effort |
|----------|---------|----------------------|--------|
| P1 | GDPR erasure + data export | **High** — legal compliance (GDPR/CCPA) | 2–3 d |
| P1 | Contacts bulk import / merge | **Medium** — ops efficiency for onboarding | 3–4 d |
| P1 | Provider setup wizard (OAuth, A2P) | **Medium** — blocks telephony self-serve | 4–5 d |
| P2 | Retention settings | **Medium** — compliance + storage cost | 1 d |
| P2 | Settings fallback-group | **Low** — redundancy with shifts endpoint | 0.5–1 d |
| P2 | Note replies | **Low** — UX polish | 1–2 d |
| P2 | Intake detail view | **Medium** — case-management workflow | 1–2 d |
| P2 | Report detail + files | **Low** — UX polish | 1–2 d |
| P2 | Conversation load balancing | **Low** — ops visibility | 0.5–1 d |
| P2 | Team contact assignment | **Low** — feature completeness | 1–2 d |
| — | MLS (Tier 6) | **High** — E2EE for messaging | Epic (multi-PR) |

---

## Recommendations

1. **Knip safelist** — Add the orphaned API functions and query hooks to a knip `ignore` list (or JSDoc `@knipignore`) so a future sweep does not delete them like the Signal contact registration UI was deleted.

2. **Endpoint deduplication review** — `/settings/fallback-group` and `/shifts/fallback` appear redundant. Pick one as canonical and deprecate the other.

3. **Provider-setup UI milestone** — The telephony provider setup is the biggest P1 gap. Consider splitting it: (a) OAuth callback handler + phone search, (b) A2P brand/campaign forms.

4. **GDPR UI priority** — Even a minimal "Download my data" button on the profile page and a simple "Request account deletion" flow would satisfy baseline compliance. No need for a full admin erasure dashboard in the first pass.

5. **Report exports** — `getReport` and `getReportFiles` should be exported and wired; this is a ~1-hour fix.

---

## Appendix: Server Routes with Confirmed Client Wiring

The following route prefixes have **full** client coverage (API module + query hooks + UI components/routes) and were **not** flagged:

- `auth` (facade, webauthn, opaque, recovery, sessions, devices)
- `users` (list, create, update, delete)
- `calls` (list, detail, analytics)
- `contacts` (core CRUD, discovery, relationships, outreach) — *bulk/merge excluded*
- `conversations` (list, messages, claim, update) — *load endpoint excluded*
- `reports` (list, messages, assign, update) — *detail/files excluded*
- `report-types` (list, create, update, archive, default)
- `notes` (list, create, update, detail) — *replies excluded*
- `intakes` (list, submit, update status) — *detail excluded*
- `blasts` (list, send, cancel, delete, subscribers, settings)
- `shifts` (list, create, update, delete, fallback) — *settings fallback-group excluded*
- `tags` (list, create, update, delete)
- `teams` (list, create, update, delete, members) — *contact assignment excluded*
- `settings` (transcription, custom-fields, spam, call, ivr-languages, webauthn, provider-health, telephony-provider, messaging, setup, ivr-audio, roles, permissions) — *retention, fallback-group excluded*
- `firehose` (list, create, update, delete, status)
- `bans` (list, add, remove, bulk)
- `audit` (list, chain verification)
- `hubs` (list, create, update, delete)
- `analytics` (call volume, hours, user stats — global + hub-scoped)
- `notifications` (push subscribe/unsubscribe, VAPID public key)
- `setup` (state, complete) — *provider-setup excluded*
- `files` / `uploads`
- `invites`
- `config`
- `health` / `metrics` / `csp-report` / `releases`

---

*End of audit.*
