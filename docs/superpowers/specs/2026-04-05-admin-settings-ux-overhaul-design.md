# Admin Settings UX Overhaul — Design Spec

**Date:** 2026-04-05
**Branch:** `feat/settings-ux-overhaul`
**Worktree:** `~/projects/llamenos-hotline-settings-ux`
**Out of scope:** Volunteer `/settings` page (handled in PR #43)

## Problem

The admin settings experience has become unwieldy:

- `src/client/routes/admin/settings.tsx` has **15 flat collapsible sections** on a single page (1,038 lines).
- `src/client/routes/admin/hubs.tsx` is a 854-line super-admin page covering only hub CRUD — yet the app has ~15 platform-level API endpoints with no corresponding UI (platform roles, global bans, global audit, cross-hub analytics, provider health, super-admin hub visibility toggle).
- Section titles use technical jargon ("IVR Languages", "Telephony Provider", "Geocoding") that non-technical admins shouldn't have to parse.
- Webhook URLs, HMAC secrets, SIP URIs, and other truly-technical fields sit alongside everyday controls, raising the cognitive load for every admin.
- E2E tests that exercise settings rely on fragile `getByText` / `getByRole` selectors; any label change breaks tests.

## Goals

1. Replace the flat collapsible list with a unified vertical-nav admin shell that scales freely as sections are added.
2. Group hub-scoped settings by intent (General / People / Intake / Calls & Voice / Channels) so admins find things faster.
3. Rename acronym-heavy section labels to plainer language; hide technical fields behind an "Advanced" reveal inside each section.
4. Build out the super-admin area so every platform-wide API endpoint has a UI.
5. Put stable `data-testid` attributes on every interactive element in the admin shell and provide test helpers, so E2E tests become short and stable.

## Non-Goals

- Touching `src/client/routes/settings.tsx` (volunteer personal settings).
- Adding new backend endpoints. Every new UI binds to endpoints that already exist in the server.
- Auto-translating new i18n strings into all 13 locales. English ships; other locales fall back to English until translated.
- Feature-flagging the new UX. Pre-production, direct cutover.

## Design Overview

### Unified admin shell

A single `/admin` route becomes the entry point for both hub-admin and super-admin settings, rendered in a sidebar-plus-main-pane layout. The sidebar shows two groups:

- **This Hub** — 15 hub-scoped sections, subdivided by intent.
- **Platform** — 7 super-admin-only items. Rendered only if the user holds the `role-super-admin` role.

One section is visible in the main pane at a time. URL shape: `/admin/$section` where `$section` is the slug from `admin-nav-config.ts`.

### Hub-admin sidebar groups

```
This Hub
├── General
│   ├── Location Lookup       (was: Geocoding)
│   └── Passkey Policy
├── People
│   ├── Hub Roles
│   ├── Teams
│   └── Tags
├── Intake
│   ├── Custom Fields
│   ├── Report Types
│   └── Firehose
├── Calls & Voice
│   ├── Call Settings
│   ├── Voice Prompts
│   ├── Phone Menu Languages  (was: IVR Languages)
│   ├── Transcription
│   └── Spam Protection
└── Channels
    ├── Phone Provider        (was: Telephony Provider)
    ├── Messaging / SMS       (was: Channels)
    ├── RCS
    └── Signal
```

Group headers (General, People, Intake, Calls & Voice, Channels) are visual dividers only — not collapsible.

### Super-admin sidebar

```
Platform
├── Hubs
├── Roles
├── Bans
├── Audit
├── Analytics
├── Health
└── Platform
```

- **Hubs** — the existing list + Create/Edit/Archive/Delete dialogs. The Edit dialog gains internal tabs: **General** (name/description/phone), **Access** (super-admin visibility toggle, from spec `2026-03-22-hub-admin-zero-trust-visibility-design.md`), **Export** (existing export checkboxes), **Danger** (archive/delete).
- **Roles** — new UI for the 5 orphaned role endpoints (`GET/POST/PATCH/DELETE /api/settings/roles`). The `role-super-admin` system role is read-only.
- **Bans** — new UI for `GET/POST/DELETE /api/bans` and `POST /api/bans/bulk` at the global (cross-hub) scope.
- **Audit** — new UI for `GET /api/audit` with filters (actor pubkey, event type, date range, free-text search), pagination.
- **Analytics** — new UI for `GET /api/analytics/calls`, `/hours`, `/users` at platform scope.
- **Health** — new UI for `GET /api/health`, `/live`, `/ready` plus `GET /provider-health` (from spec `2026-03-23-health-monitoring-admin-management-design.md`). Renders provider health badges + system health status.
- **Platform** — scaffolded placeholder for future platform-wide settings (storage namespaces, telemetry, license). Renders "No platform-level settings yet" until populated.

### Mobile behavior

Below 1024px the sidebar collapses to an off-canvas shadcn `Sheet` drawer. A sticky header in the main pane shows the current section name + hamburger. Above 1024px the sidebar is always visible.

### Advanced reveal

New primitive `<AdvancedReveal>` wraps a shadcn `<Collapsible>`. Sections that have truly-technical fields (webhook URLs, HMAC signing secrets, SIP URIs, ICE server URIs) render them inside `<AdvancedReveal>` at the bottom of the section. The reveal is closed by default. Strings live in the `common` i18n namespace: `"Show advanced settings"` / `"Hide advanced settings"`.

Candidates for Advanced reveals:
- **RCS** — webhook URL, HMAC secret
- **Signal** — webhook URL, HMAC secret, registration flow controls
- **Phone Provider** — SIP URI, provider credentials fields
- **Spam Protection** — exact numeric thresholds (maxCallsPerMinute, blockDurationMinutes, captchaMaxAttempts)

Sections without technical fields don't include the reveal.

## Component & File Layout

### New files

```
src/client/components/admin-shell/
  admin-shell.tsx              # Layout: sidebar + main pane + mobile Sheet
  admin-sidebar.tsx            # Renders nav groups/items from config; active-state highlighting
  admin-nav-config.ts          # Source of truth: groups, items, routes, required permissions, testids, i18n keys
  advanced-reveal.tsx          # <Collapsible> wrapper with "Show advanced"/"Hide advanced" label

src/client/components/admin-sections/
  # Hub-scoped (renamed-and-moved from existing admin-settings/ components):
  location-lookup-section.tsx        # was geocoding-settings-section.tsx
  passkey-policy-section.tsx
  hub-roles-section.tsx              # thin wrapper around existing roles-section.tsx
  teams-section.tsx
  tags-section.tsx
  custom-fields-section.tsx
  report-types-section.tsx
  firehose-section.tsx
  call-settings-section.tsx
  voice-prompts-section.tsx
  phone-menu-languages-section.tsx   # was ivr-languages-section.tsx
  transcription-section.tsx
  spam-section.tsx
  phone-provider-section.tsx         # was telephony-provider-section.tsx
  messaging-sms-section.tsx          # was channel-settings.tsx
  rcs-channel-section.tsx
  signal-channel-section.tsx
  # Super-admin (NEW):
  hubs-section.tsx                   # contents from current admin/hubs.tsx
  platform-roles-section.tsx
  bans-section.tsx
  audit-section.tsx
  analytics-section.tsx
  health-section.tsx
  platform-section.tsx               # placeholder scaffold
```

### Route changes

```
src/client/routes/admin/
  route.tsx        # NEW — wraps children in <AdminShell>
  index.tsx        # NEW — redirects to first accessible section (location-lookup for hub admin, hubs for super-admin-only)
  $section.tsx     # NEW — renders section component by slug, 404s on unknown slug
  settings.tsx     # DELETED — replaced by shell + $section
  hubs.tsx         # DELETED — content moved to components/admin-sections/hubs-section.tsx
```

### Legacy redirects

`/admin/settings` → `/admin/location-lookup`
`/admin/settings#{slug}` → `/admin/{slug}` (client-side redirect for deeplinks)
`/admin/hubs` naturally resolves via `$section.tsx` — no redirect needed.

### Deletions after migration

- `src/client/components/settings-section.tsx` — the collapsible wrapper is no longer used.
- Any sessionStorage-backed expanded-set hook (`usePersistedExpanded` or similar) if it's not used elsewhere.
- Old directory `src/client/components/admin-settings/` once all sections are migrated.

## Authorization Shape

- Sidebar renders the **Platform** group only when `auth.roles.includes('role-super-admin')`.
- Server still enforces per-endpoint permission strings (`system:manage-roles`, `bans:read`, `audit:read`, `calls:read-history`) — UI gating is defense-in-depth, not the security boundary.
- `admin-nav-config.ts` declares `requiredPermissions: string[]` per item. A nav item is hidden if the user lacks every listed permission; this keeps sidebar visibility consistent with server behavior.

## `data-testid` Conventions

### Naming pattern

```
admin-{scope}-{element}[-{modifier}]
```

### Shell-level testids

```
admin-shell                          # root layout
admin-sidebar                        # nav container
admin-sidebar-group-this-hub         # group header
admin-sidebar-group-platform
admin-sidebar-item-{section-slug}    # each nav link
admin-sidebar-toggle                 # mobile hamburger
admin-sidebar-drawer                 # mobile Sheet
admin-section                        # currently-rendered section wrapper; also has data-section="{slug}"
admin-section-heading
admin-advanced-reveal-{slug}         # the "Advanced" collapsible trigger
admin-advanced-panel-{slug}          # the revealed content
```

### Section-level testids

Every interactive element inside a section is prefixed by the section slug:

```
admin-phone-provider-save
admin-phone-provider-credentials-field
admin-bans-bulk-upload-input
admin-audit-search-input
admin-hubs-create-button
admin-hubs-edit-dialog-tab-access
```

Rule: the sidebar, section wrapper, every button, input, select, switch, and confirm-dialog button carries a testid. Text-based selectors are banned in new and migrated E2E tests.

## Test Strategy

### New test helpers (`tests/helpers/admin-settings.ts`)

```ts
// Navigation
gotoAdminSection(page, slug)
expectActiveNavItem(page, slug)
openMobileNav(page)
closeMobileNav(page)

// Section interactions
expectSectionLoaded(page, slug)
revealAdvanced(page, slug)
hideAdvanced(page, slug)
saveSection(page, slug)
expectSectionSaved(page, slug)

// Visibility assertions
expectNavGroupVisible(page, groupSlug)  // 'this-hub' | 'platform'
expectNavGroupHidden(page, groupSlug)
```

### E2E test migration

Fragile tests to migrate to testid selectors during this PR:

- `tests/ui/telephony-provider.spec.ts`
- `tests/ui/geocoding.spec.ts`
- `tests/ui/voice-captcha.spec.ts`
- `tests/ui/rcs-channel.spec.ts`
- Admin portions of `tests/ui/admin-flow.spec.ts`
- Admin portions of `tests/ui/webauthn*.spec.ts`

Each test migrates in the same commit as the section it targets.

### New tests to write

- `tests/ui/admin-shell.spec.ts` — shell navigation, mobile drawer, deeplinks, super-admin group gating
- `tests/ui/admin-platform-roles.spec.ts` — platform Roles CRUD (create custom role, edit, delete, assert system role read-only)
- `tests/ui/admin-bans.spec.ts` — global ban list CRUD + bulk upload
- `tests/ui/admin-audit.spec.ts` — filters, pagination, date-range
- `tests/ui/admin-analytics.spec.ts` — charts render, respond to range switcher
- `tests/ui/admin-health.spec.ts` — provider + system health badges render
- `tests/ui/admin-advanced-reveal.spec.ts` — reveal shows/hides, state is per-section

### Nav-config snapshot test

`tests/ui/admin-nav-config.spec.ts` iterates over `admin-nav-config.ts` and asserts that every declared route renders its section component without error and renders its expected heading. Catches "added a nav item, forgot to wire the section" at test-run time.

### API tests

`tests/api/settings-management.spec.ts` and `tests/api/settings-extended.spec.ts` don't change — they're JSON-level, not UI-level.

## i18n

- New namespace `adminNav` holds all sidebar group + item labels (~20 keys).
- Per-section strings stay in their existing namespaces (`roles`, `teams`, `telephonyProvider` → stays but rendered under new label, etc.).
- Advanced reveal strings (`"Show advanced settings"`, `"Hide advanced settings"`) go in `common` (2 keys).
- New super-admin sections add ~30 keys total across `bans`, `audit`, `analytics`, `health`, `platform`, `adminNav`.
- Renames replace existing keys; old keys are removed. No migration.
- **Total new/renamed keys: ~50, × 13 locales = ~650 locale entries.** English is authoritative; other locales ship with English fallback text until translated. No missing-key errors.

## Risks

| Risk | Mitigation |
|---|---|
| Losing sessionStorage-backed "expanded sections" state | New model has no expanded concept; each section is its own page. State becomes obsolete. |
| URL slugs drift from nav config | Single source of truth in `admin-nav-config.ts`; `$section.tsx` reads from it; nav-config snapshot test validates every slug renders. |
| Non-super-admins seeing Platform group | Sidebar gates on role + permissions, server gates on permission strings. `admin-shell.spec.ts` asserts absence for hub-admin users. |
| Deeplinks in docs/bookmarks using old `#anchor` pattern | Client redirect in `route.tsx` translates `#{slug}` → `/admin/{slug}`. |
| Renamed sections (IVR → Phone Menu) confuse existing users | Pre-production; note in PR description. |
| Platform-level endpoints turn out to be stubbed/incomplete | Verify each endpoint returns real data during implementation; scope out any stubbed ones. |
| "Roles" label collision between hub and platform scope | Sidebar labels "Hub Roles" and "Roles"; verify during plan whether both are distinct or the hub-level is actually platform data mis-scoped. If merged, drop hub-level. |
| E2E tests flake during transition | Migrate test-by-test as each section ships, not in a separate batch. |

## Success Criteria

- `bun run typecheck`, `bun run build`, `bun run test:unit`, `bunx playwright test` all green.
- Sidebar renders 15 hub-scoped sections + 7 platform sections.
- Every nav item, section heading, and interactive element has a `data-testid`.
- Mobile drawer opens/closes; all sections reachable on a 375px viewport.
- Hub admin (non-super-admin) user sees no Platform group in sidebar.
- Every orphaned platform-level endpoint in the investigation report has a UI.
- At least one test per section passes using only testid selectors.
- Nav-config snapshot test exercises every declared route.

## Open Questions for Planning Phase

- Does `/api/settings/roles` actually manage platform-wide or hub-scoped roles? Determines whether "Hub Roles" and "Platform Roles" are distinct UIs or the same data.
- Does `/api/bans` meaningfully distinguish "global" (no hubId) bans from hub-scoped bans at the schema level? If not, global bans may need a new server flag before the UI can call itself "global".
- Is `provider-health` gated on `settings:read` or a super-admin permission? Need to confirm the permission string for the sidebar gating.

These will be resolved during the `writing-plans` phase by reading the server routes, not by re-brainstorming.
