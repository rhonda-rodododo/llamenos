# Admin Settings UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat-collapsible admin settings page with a unified vertical-nav shell, group hub-scoped sections by intent, and populate the super-admin area with UI for every orphaned platform-level endpoint.

**Architecture:** A single admin shell under `/admin` renders a sidebar-driven layout. A declarative `admin-nav-config.ts` is the source of truth for nav structure, routes, required permissions, testids, and i18n keys. Every section lives in its own file and is rendered by a single `$section.tsx` route based on URL slug. Mobile (<1024px) replaces the sidebar with an off-canvas Sheet drawer. Every interactive element gets a stable `data-testid`; E2E tests use helpers backed by those testids.

**Tech Stack:** React 19, TanStack Router (file-based), shadcn/ui (Sheet, Collapsible, Tabs), Tailwind, react-i18next, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-05-admin-settings-ux-overhaul-design.md`

---

## File Structure

### New files
```
src/client/components/admin-shell/
  admin-shell.tsx              # Layout wrapper: sidebar + main pane + mobile sheet
  admin-sidebar.tsx            # Nav rendering, active state, group headers
  admin-nav-config.ts          # Source of truth: groups, items, routes, perms, testids, i18n
  admin-nav-config.types.ts    # Types for config shape
  advanced-reveal.tsx          # Collapsible wrapper for technical fields

src/client/routes/admin/
  route.tsx                    # AdminShell wrapper route
  index.tsx                    # Redirects to first accessible section
  $section.tsx                 # Renders section component by slug

src/client/components/admin-sections/
  # (created via migration from src/client/components/admin-settings/)
  location-lookup-section.tsx        # renamed from geocoding-settings-section.tsx
  passkey-policy-section.tsx
  hub-roles-section.tsx              # wraps roles-section.tsx
  teams-section.tsx
  tags-section.tsx
  custom-fields-section.tsx
  report-types-section.tsx
  firehose-section.tsx
  call-settings-section.tsx
  voice-prompts-section.tsx
  phone-menu-languages-section.tsx   # renamed from ivr-languages-section.tsx
  transcription-section.tsx
  spam-section.tsx
  phone-provider-section.tsx         # renamed from telephony-provider-section.tsx
  messaging-sms-section.tsx          # renamed from channel-settings.tsx
  rcs-channel-section.tsx
  signal-channel-section.tsx
  # super-admin sections (new):
  hubs-section.tsx
  platform-roles-section.tsx
  bans-section.tsx
  audit-section.tsx
  analytics-section.tsx
  health-section.tsx
  platform-section.tsx

tests/helpers/admin-settings.ts
tests/ui/admin-shell.spec.ts
tests/ui/admin-nav-config.spec.ts
tests/ui/admin-platform-roles.spec.ts
tests/ui/admin-bans.spec.ts
tests/ui/admin-audit.spec.ts
tests/ui/admin-analytics.spec.ts
tests/ui/admin-health.spec.ts
tests/ui/admin-advanced-reveal.spec.ts

public/locales/en.json          # new adminNav, bans, audit, analytics, health, platform namespaces
# (all 13 locale files get english-fallback keys)
```

### Deleted files
```
src/client/routes/admin/settings.tsx
src/client/routes/admin/hubs.tsx
src/client/components/settings-section.tsx  (if unused elsewhere after migration)
src/client/components/admin-settings/       (entire directory, after migration)
```

---

## Phase A — Foundation (nav config, shell, routes)

### Task 1: Nav config types

**Files:**
- Create: `src/client/components/admin-shell/admin-nav-config.types.ts`

- [ ] **Step 1: Write the types file**

```typescript
/**
 * Nav config types. Defines the shape of the admin sidebar structure.
 */

export type AdminNavScope = 'this-hub' | 'platform'

export interface AdminNavItem {
  /** URL slug — appears in /admin/{slug}. Must be unique across all items. */
  slug: string
  /** i18n key for the sidebar label, under the adminNav namespace. */
  labelKey: string
  /** Permission strings the user must hold (ANY match). Empty = no permission gate. */
  requiredPermissions: string[]
  /** Role gate — if set, user must have this role in auth.roles. */
  requiredRole?: 'role-super-admin'
  /** data-testid applied to the sidebar link element. */
  testid: string
}

export interface AdminNavGroup {
  /** Stable identifier for the group, used in testids. */
  groupSlug: string
  /** Which sidebar scope this group belongs to. */
  scope: AdminNavScope
  /** i18n key for the group header label. */
  labelKey: string
  items: AdminNavItem[]
}

export interface AdminNavConfig {
  groups: AdminNavGroup[]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/components/admin-shell/admin-nav-config.types.ts
git commit -m "feat(admin): nav config types"
```

---

### Task 2: Nav config source of truth (empty scaffold)

**Files:**
- Create: `src/client/components/admin-shell/admin-nav-config.ts`

- [ ] **Step 1: Write the config file with all groups but empty item lists**

This file will be populated item-by-item as sections migrate. Empty initially so the shell can render.

```typescript
import type { AdminNavConfig } from './admin-nav-config.types'

export const adminNavConfig: AdminNavConfig = {
  groups: [
    // This Hub
    {
      groupSlug: 'general',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.general',
      items: [],
    },
    {
      groupSlug: 'people',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.people',
      items: [],
    },
    {
      groupSlug: 'intake',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.intake',
      items: [],
    },
    {
      groupSlug: 'calls-voice',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.callsVoice',
      items: [],
    },
    {
      groupSlug: 'channels',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.channels',
      items: [],
    },
    // Platform
    {
      groupSlug: 'platform',
      scope: 'platform',
      labelKey: 'adminNav.groups.platform',
      items: [],
    },
  ],
}

/** Flat list of all items across all groups. */
export function allNavItems() {
  return adminNavConfig.groups.flatMap((g) => g.items)
}

/** Find a nav item by slug. */
export function findNavItem(slug: string) {
  return allNavItems().find((i) => i.slug === slug)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/components/admin-shell/admin-nav-config.ts
git commit -m "feat(admin): nav config scaffold"
```

---

### Task 3: AdvancedReveal primitive

**Files:**
- Create: `src/client/components/admin-shell/advanced-reveal.tsx`

- [ ] **Step 1: Read existing Collapsible usage pattern**

```bash
grep -rn "from '@/components/ui/collapsible'" src/client --include='*.tsx' | head -5
```

- [ ] **Step 2: Write the AdvancedReveal component**

```tsx
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  /** Section slug (for testid prefix). */
  sectionSlug: string
  children: ReactNode
}

export function AdvancedReveal({ sectionSlug, children }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-6 border-t pt-4">
      <CollapsibleTrigger
        data-testid={`admin-advanced-reveal-${sectionSlug}`}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        {open ? t('common.hideAdvanced') : t('common.showAdvanced')}
      </CollapsibleTrigger>
      <CollapsibleContent
        data-testid={`admin-advanced-panel-${sectionSlug}`}
        className="mt-4 space-y-4"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
```

- [ ] **Step 3: Add i18n keys to `public/locales/en.json` under `common` namespace**

Read current en.json `common` namespace, then add these two keys:

```json
{
  "common": {
    "showAdvanced": "Show advanced settings",
    "hideAdvanced": "Hide advanced settings"
  }
}
```

Also add the same keys (English fallback text) to all 12 other locale files: `ar.json`, `de.json`, `es.json`, `fr.json`, `ht.json`, `hi.json`, `ko.json`, `pt.json`, `ru.json`, `tl.json`, `vi.json`, `zh.json`.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/admin-shell/advanced-reveal.tsx public/locales/
git commit -m "feat(admin): AdvancedReveal primitive + i18n"
```

---

### Task 4: AdminSidebar component

**Files:**
- Create: `src/client/components/admin-shell/admin-sidebar.tsx`

- [ ] **Step 1: Read existing auth permission helpers**

```bash
grep -rn "hasPermission\|isSuperAdmin" src/client/lib/auth* src/client/hooks/ 2>/dev/null | head -10
```

- [ ] **Step 2: Write the sidebar**

```tsx
import { adminNavConfig } from './admin-nav-config'
import type { AdminNavGroup, AdminNavItem, AdminNavScope } from './admin-nav-config.types'
import { useAuth } from '@/lib/auth'
import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface Props {
  /** Called when a nav item is clicked; used by mobile drawer to close itself. */
  onNavigate?: () => void
}

export function AdminSidebar({ onNavigate }: Props) {
  const { t } = useTranslation()
  const auth = useAuth()
  const { location } = useRouterState()
  const activeSlug = location.pathname.replace(/^\/admin\/?/, '') || ''

  function canSee(item: AdminNavItem): boolean {
    if (item.requiredRole && !auth.roles.includes(item.requiredRole)) return false
    if (item.requiredPermissions.length === 0) return true
    return item.requiredPermissions.some((p) => auth.hasPermission(p))
  }

  function canSeeGroup(group: AdminNavGroup): boolean {
    if (group.scope === 'platform' && !auth.roles.includes('role-super-admin')) return false
    return group.items.some(canSee)
  }

  const visibleGroups = adminNavConfig.groups.filter(canSeeGroup)
  const thisHubGroups = visibleGroups.filter((g) => g.scope === 'this-hub')
  const platformGroups = visibleGroups.filter((g) => g.scope === 'platform')

  function renderGroup(group: AdminNavGroup) {
    return (
      <div key={group.groupSlug} className="space-y-1">
        <div
          data-testid={`admin-sidebar-group-${group.groupSlug}`}
          className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {t(group.labelKey)}
        </div>
        {group.items.filter(canSee).map((item) => (
          <Link
            key={item.slug}
            to="/admin/$section"
            params={{ section: item.slug }}
            data-testid={item.testid}
            onClick={onNavigate}
            className={cn(
              'block rounded px-3 py-2 text-sm transition-colors',
              activeSlug === item.slug
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {t(item.labelKey)}
          </Link>
        ))}
      </div>
    )
  }

  return (
    <nav data-testid="admin-sidebar" className="flex flex-col gap-2 p-4">
      {thisHubGroups.length > 0 && (
        <div data-testid="admin-sidebar-scope-this-hub" className="space-y-1">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            {t('adminNav.scopes.thisHub')}
          </div>
          {thisHubGroups.map(renderGroup)}
        </div>
      )}
      {platformGroups.length > 0 && (
        <div data-testid="admin-sidebar-scope-platform" className="mt-6 space-y-1 border-t pt-4">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            {t('adminNav.scopes.platform')}
          </div>
          {platformGroups.map(renderGroup)}
        </div>
      )}
    </nav>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/client/components/admin-shell/admin-sidebar.tsx
git commit -m "feat(admin): AdminSidebar component"
```

---

### Task 5: AdminShell layout + mobile drawer

**Files:**
- Create: `src/client/components/admin-shell/admin-shell.tsx`

- [ ] **Step 1: Find existing Sheet usage for pattern match**

```bash
grep -rn "from '@/components/ui/sheet'" src/client --include='*.tsx' | head -3
```

- [ ] **Step 2: Write the shell**

```tsx
import { AdminSidebar } from './admin-sidebar'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  currentSlug?: string
  currentLabelKey?: string
  children: ReactNode
}

export function AdminShell({ currentSlug, currentLabelKey, children }: Props) {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div data-testid="admin-shell" className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r lg:block">
        <AdminSidebar />
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          data-testid="admin-sidebar-drawer"
          className="w-72 p-0"
        >
          <AdminSidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main pane */}
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-8">
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid="admin-sidebar-toggle"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t('adminNav.openMenu')}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          {currentLabelKey && (
            <h1
              data-testid="admin-section-heading"
              className="text-base font-semibold lg:text-lg"
            >
              {t(currentLabelKey)}
            </h1>
          )}
        </header>
        <div
          data-testid="admin-section"
          data-section={currentSlug ?? ''}
          className="px-4 py-6 lg:px-8"
        >
          {children}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Add adminNav scope/menu keys to en.json**

```json
{
  "adminNav": {
    "scopes": {
      "thisHub": "This Hub",
      "platform": "Platform"
    },
    "groups": {
      "general": "General",
      "people": "People",
      "intake": "Intake",
      "callsVoice": "Calls & Voice",
      "channels": "Channels",
      "platform": "Platform"
    },
    "openMenu": "Open navigation menu"
  }
}
```

Copy same keys to all 12 other locale files with English fallback values.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/admin-shell/admin-shell.tsx public/locales/
git commit -m "feat(admin): AdminShell layout with mobile drawer"
```

---

### Task 6: Route wrapper + section route + index redirect

**Files:**
- Create: `src/client/routes/admin/route.tsx`
- Create: `src/client/routes/admin/index.tsx`
- Create: `src/client/routes/admin/$section.tsx`

- [ ] **Step 1: Read current admin route shape to understand auth gating**

```bash
cat src/client/routes/admin/settings.tsx | head -30
grep -rn "createFileRoute" src/client/routes/admin/ 2>/dev/null
```

- [ ] **Step 2: Write `route.tsx`** (wraps all /admin/* children)

```tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useAuth } from '@/lib/auth'

export const Route = createFileRoute('/admin')({
  beforeLoad: () => {
    // Auth gate handled by wrapping layout — TanStack reads auth from root context
  },
  component: AdminRouteComponent,
})

function AdminRouteComponent() {
  const auth = useAuth()
  if (!auth.isAdmin && !auth.roles.includes('role-super-admin')) {
    throw redirect({ to: '/' })
  }
  return <Outlet />
}
```

- [ ] **Step 3: Write `$section.tsx`** (renders section by slug)

```tsx
import { createFileRoute, notFound } from '@tanstack/react-router'
import { AdminShell } from '@/components/admin-shell/admin-shell'
import { findNavItem } from '@/components/admin-shell/admin-nav-config'
import { getSectionComponent } from '@/components/admin-sections/registry'

export const Route = createFileRoute('/admin/$section')({
  component: AdminSectionRoute,
})

function AdminSectionRoute() {
  const { section } = Route.useParams()
  const navItem = findNavItem(section)
  if (!navItem) throw notFound()
  const SectionComponent = getSectionComponent(section)
  if (!SectionComponent) throw notFound()
  return (
    <AdminShell currentSlug={section} currentLabelKey={navItem.labelKey}>
      <SectionComponent />
    </AdminShell>
  )
}
```

- [ ] **Step 4: Write `index.tsx`** (redirects to first accessible section)

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminNavConfig } from '@/components/admin-shell/admin-nav-config'

export const Route = createFileRoute('/admin/')({
  beforeLoad: () => {
    // Redirect to first item in the first non-empty group.
    const firstItem = adminNavConfig.groups.flatMap((g) => g.items)[0]
    if (firstItem) {
      throw redirect({ to: '/admin/$section', params: { section: firstItem.slug } })
    }
  },
  component: () => null,
})
```

- [ ] **Step 5: Create the section registry file**

Create: `src/client/components/admin-sections/registry.ts`

```typescript
import type { ComponentType } from 'react'

/**
 * Maps nav item slugs to section components. Populated as sections migrate.
 * Keep in sync with admin-nav-config.ts.
 */
const registry: Record<string, () => Promise<{ default: ComponentType }>> = {
  // Populated per section migration task
}

/**
 * Synchronous lookup after lazy load — for now, resolve eagerly.
 * Until items are registered, returns undefined.
 */
const components: Record<string, ComponentType> = {}

export function registerSection(slug: string, component: ComponentType) {
  components[slug] = component
}

export function getSectionComponent(slug: string): ComponentType | undefined {
  return components[slug]
}
```

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS (or only pre-existing errors unrelated to this change).

- [ ] **Step 7: Commit**

```bash
git add src/client/routes/admin/ src/client/components/admin-sections/registry.ts
git commit -m "feat(admin): shell routes + section registry"
```

---

### Task 7: Nav-config snapshot test (scaffold — passes with empty config)

**Files:**
- Create: `tests/ui/admin-nav-config.spec.ts`

- [ ] **Step 1: Read existing E2E test pattern**

```bash
cat tests/ui/smoke.spec.ts 2>/dev/null | head -40
ls tests/fixtures/auth.ts 2>/dev/null && head -30 tests/fixtures/auth.ts
```

- [ ] **Step 2: Write the snapshot test**

```typescript
import { test, expect } from '@playwright/test'
import { adminNavConfig } from '../../src/client/components/admin-shell/admin-nav-config'
import { loginAsAdmin } from '../fixtures/auth'

test.describe('admin nav config snapshot', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  for (const group of adminNavConfig.groups) {
    for (const item of group.items) {
      // super-admin-only items skipped for regular admin
      if (item.requiredRole === 'role-super-admin') continue

      test(`renders section: ${item.slug}`, async ({ page }) => {
        await page.goto(`/admin/${item.slug}`)
        await expect(page.getByTestId('admin-section')).toHaveAttribute(
          'data-section',
          item.slug,
        )
      })
    }
  }
})
```

- [ ] **Step 3: Commit**

```bash
git add tests/ui/admin-nav-config.spec.ts
git commit -m "test(admin): nav config snapshot test"
```

---

## Phase B — Migrate hub-scoped sections

**Migration pattern** (apply to every hub-scoped section task):

1. Copy the file from `src/client/components/admin-settings/<old-name>.tsx` to `src/client/components/admin-sections/<new-name>.tsx`.
2. Remove the `SettingsSection` wrapper import and usage — the section now renders as a plain `<section className="space-y-4">` with an optional heading, since the AdminShell header renders the title.
3. Remove `expanded`, `onToggle`, `statusSummary` props. If status info is useful, render it as a top-level summary card inside the section.
4. The section now reads its own data via React Query hooks directly; prop-drilled `config` + `onChange` become internal queries/mutations.
5. Add `data-testid` to every button, input, switch, select using pattern `admin-{slug}-{element}`.
6. Add entry to `admin-nav-config.ts` items array.
7. Register the component in `registry.ts`.
8. Add/update i18n keys where labels changed.
9. Run `bun run typecheck`.
10. Commit.

---

### Task 8: Migrate Location Lookup (was Geocoding)

**Files:**
- Create: `src/client/components/admin-sections/location-lookup-section.tsx`
- Modify: `src/client/components/admin-shell/admin-nav-config.ts`
- Modify: `src/client/components/admin-sections/registry.ts`
- Modify: `public/locales/en.json` + 12 others
- Delete: `src/client/components/admin-settings/geocoding-settings-section.tsx` (after verifying no other imports)

- [ ] **Step 1: Read the existing component**

```bash
cat src/client/components/admin-settings/geocoding-settings-section.tsx
```

- [ ] **Step 2: Find callers to understand data flow**

```bash
grep -rn "GeocodingSettingsSection" src/client --include='*.tsx'
```

- [ ] **Step 3: Create new file removing wrapper + renaming**

The new component:
- Drops `SettingsSection` wrapper, `expanded`/`onToggle`/`statusSummary` props
- Reads `GeocodingConfigAdmin` via React Query instead of prop
- Adds testids: `admin-location-lookup-provider-select`, `admin-location-lookup-enabled-switch`, `admin-location-lookup-save`, `admin-location-lookup-test-button`
- Uses new i18n key prefix `locationLookup.*` (copy values from existing `geocoding.*` keys)

```tsx
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  type GeocodingConfigAdmin,
  getGeocodingSettings,
  testGeocodingProvider,
  updateGeocodingSettings,
} from '@/lib/api'
import { useToast } from '@/lib/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client'
import { GEOCODING_PROVIDER_LABELS } from '@shared/types'
import type { GeocodingProvider } from '@shared/types'
import { Loader2, Save, TestTube2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function LocationLookupSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.settings.geocoding(),
    queryFn: getGeocodingSettings,
  })
  const [draft, setDraft] = useState<GeocodingConfigAdmin | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; latency?: number; error?: string } | null>(null)

  useEffect(() => {
    if (config && !draft) setDraft(config)
  }, [config, draft])

  const saveMutation = useMutation({
    mutationFn: (next: GeocodingConfigAdmin) => updateGeocodingSettings(next),
    onSuccess: (updated) => {
      setDraft(updated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.geocoding() })
      toast(t('common.success'), 'success')
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  const testMutation = useMutation({
    mutationFn: testGeocodingProvider,
    onSuccess: (result) => setTestResult(result),
    onError: (err) => setTestResult({ ok: false, error: String(err) }),
  })

  if (isLoading || !draft) return null

  return (
    <section className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('locationLookup.description')}</p>

      <div className="flex items-center justify-between">
        <Label htmlFor="location-lookup-enabled">{t('locationLookup.enable')}</Label>
        <Switch
          id="location-lookup-enabled"
          data-testid="admin-location-lookup-enabled-switch"
          checked={draft.enabled}
          onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('locationLookup.provider')}</Label>
        <Select
          value={draft.provider}
          onValueChange={(v) => setDraft({ ...draft, provider: v as GeocodingProvider })}
        >
          <SelectTrigger data-testid="admin-location-lookup-provider-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(GEOCODING_PROVIDER_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button
          data-testid="admin-location-lookup-save"
          onClick={() => saveMutation.mutate(draft)}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {t('common.save')}
        </Button>
        <Button
          variant="outline"
          data-testid="admin-location-lookup-test-button"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
        >
          {testMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}
          {t('locationLookup.testConnection')}
        </Button>
      </div>

      {testResult && (
        <div data-testid="admin-location-lookup-test-result" className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
          {testResult.ok ? t('locationLookup.testOk', { latency: testResult.latency }) : testResult.error}
        </div>
      )}
    </section>
  )
}
```

**Adapt to actual `GeocodingConfigAdmin` shape** as found in Step 1 — props may have additional fields (apiKey, etc.) that go under an AdvancedReveal.

- [ ] **Step 4: Register in `registry.ts`**

```typescript
import { LocationLookupSection } from './location-lookup-section'
registerSection('location-lookup', LocationLookupSection)
```

Add an import block and register call at the bottom of `registry.ts`.

- [ ] **Step 5: Add nav config entry**

In `admin-nav-config.ts`, inside the `general` group's items:

```typescript
{
  slug: 'location-lookup',
  labelKey: 'adminNav.items.locationLookup',
  requiredPermissions: ['settings:read'],
  testid: 'admin-sidebar-item-location-lookup',
},
```

- [ ] **Step 6: Add i18n keys**

In `en.json`:
```json
{
  "adminNav": { "items": { "locationLookup": "Location Lookup" } },
  "locationLookup": {
    "description": "Configure how addresses are converted to map coordinates.",
    "enable": "Enable location lookup",
    "provider": "Provider",
    "testConnection": "Test connection",
    "testOk": "OK ({{latency}}ms)"
  }
}
```

Copy to 12 other locales with English fallback.

- [ ] **Step 7: Typecheck + commit**

```bash
bun run typecheck
git add src/client/components/admin-sections/location-lookup-section.tsx \
       src/client/components/admin-shell/admin-nav-config.ts \
       src/client/components/admin-sections/registry.ts \
       public/locales/
git commit -m "feat(admin): migrate Geocoding → Location Lookup"
```

- [ ] **Step 8: Migrate E2E test `tests/ui/geocoding.spec.ts`**

Update selectors to use new testids:
- Replace `page.getByRole('switch', ...)` with `page.getByTestId('admin-location-lookup-enabled-switch')`
- Replace `page.getByRole('button', { name: /save/i })` with `page.getByTestId('admin-location-lookup-save')`
- Replace navigation with `page.goto('/admin/location-lookup')`

Run: `bunx playwright test tests/ui/geocoding.spec.ts`. Expected: PASS.

Commit: `test(admin): migrate geocoding E2E to testid selectors`

---

### Task 9: Migrate Passkey Policy

**Files:**
- Create: `src/client/components/admin-sections/passkey-policy-section.tsx`
- Modify: nav-config, registry, locales, delete old

- [ ] **Step 1: Apply migration pattern (see Phase B preamble)**

Follow the same 10-step migration pattern as Task 8. Source file: `src/client/components/admin-settings/passkey-policy-section.tsx`.

Testids: `admin-passkey-policy-enforcement-select`, `admin-passkey-policy-save`.

Nav config entry (in `general` group):
```typescript
{
  slug: 'passkey-policy',
  labelKey: 'adminNav.items.passkeyPolicy',
  requiredPermissions: ['settings:read'],
  testid: 'admin-sidebar-item-passkey-policy',
},
```

i18n key `adminNav.items.passkeyPolicy` = "Passkey Policy". Existing section strings in `webauthn` namespace can stay as-is.

- [ ] **Step 2: Migrate E2E tests** in `tests/ui/webauthn*.spec.ts` that interact with this section.

- [ ] **Step 3: Typecheck + commit**

---

### Task 10: Migrate People group (Hub Roles, Teams, Tags)

**Files:**
- Create: `src/client/components/admin-sections/hub-roles-section.tsx`
- Create: `src/client/components/admin-sections/teams-section.tsx`
- Create: `src/client/components/admin-sections/tags-section.tsx`

- [ ] **Step 1: Verify whether `/api/settings/roles` is hub-scoped or platform-scoped**

```bash
grep -n "roles" src/server/routes/settings.ts | head -20
grep -n "hub" src/server/services/*role*.ts 2>/dev/null | head -10
```

If the endpoint is platform-scoped (not hub-scoped), the "Hub Roles" section wraps the SAME endpoint as the Platform Roles section — in that case, drop `hub-roles-section.tsx` and the People group's Roles item, keeping only Platform Roles. Document finding in commit message.

- [ ] **Step 2: Migrate each section per the Phase B pattern**

Source files:
- `src/client/components/admin-settings/roles-section.tsx` → `hub-roles-section.tsx`
- `src/client/components/admin-settings/teams-section.tsx` → `teams-section.tsx`
- `src/client/components/admin-settings/tags-section.tsx` → `tags-section.tsx`

Testids follow pattern `admin-hub-roles-*`, `admin-teams-*`, `admin-tags-*`.

Nav config entries in `people` group:
```typescript
{ slug: 'hub-roles', labelKey: 'adminNav.items.hubRoles', requiredPermissions: ['system:manage-roles'], testid: 'admin-sidebar-item-hub-roles' },
{ slug: 'teams', labelKey: 'adminNav.items.teams', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-teams' },
{ slug: 'tags', labelKey: 'adminNav.items.tags', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-tags' },
```

i18n: `adminNav.items.hubRoles` = "Hub Roles" (or "Roles" if platform/hub roles merged per Step 1 finding), `.teams` = "Teams", `.tags` = "Tags".

- [ ] **Step 3: Typecheck + commit per section (three commits)**

---

### Task 11: Migrate Intake group (Custom Fields, Report Types, Firehose)

Apply Phase B pattern to:
- `custom-fields-section.tsx` → `admin-sections/custom-fields-section.tsx`
- `report-types-section.tsx` → `admin-sections/report-types-section.tsx`
- `firehose-section.tsx` → `admin-sections/firehose-section.tsx`

Nav config entries in `intake` group:
```typescript
{ slug: 'custom-fields', labelKey: 'adminNav.items.customFields', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-custom-fields' },
{ slug: 'report-types', labelKey: 'adminNav.items.reportTypes', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-report-types' },
{ slug: 'firehose', labelKey: 'adminNav.items.firehose', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-firehose' },
```

Testids follow `admin-custom-fields-*`, `admin-report-types-*`, `admin-firehose-*`.

Three commits.

---

### Task 12: Migrate Calls & Voice group (5 sections)

Apply Phase B pattern:
- `call-settings-section.tsx` — keep name, move to admin-sections/. Testid prefix `admin-call-settings-*`.
- `voice-prompts-section.tsx` — keep name. Testid prefix `admin-voice-prompts-*`.
- `ivr-languages-section.tsx` → `phone-menu-languages-section.tsx`. Testid prefix `admin-phone-menu-languages-*`. i18n key `adminNav.items.phoneMenuLanguages` = "Phone Menu Languages".
- `transcription-section.tsx` — keep name. Testid prefix `admin-transcription-*`.
- `spam-section.tsx` — keep name. Testid prefix `admin-spam-protection-*` (slug is `spam-protection`).

**Spam section gets an AdvancedReveal** for numeric thresholds (maxCallsPerMinute, blockDurationMinutes, captchaMaxAttempts). Wrap those fields:

```tsx
<AdvancedReveal sectionSlug="spam-protection">
  {/* threshold inputs */}
</AdvancedReveal>
```

Testid prefix throughout is `admin-spam-protection-*` (matches nav slug).

Nav config entries in `calls-voice` group:
```typescript
{ slug: 'call-settings', labelKey: 'adminNav.items.callSettings', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-call-settings' },
{ slug: 'voice-prompts', labelKey: 'adminNav.items.voicePrompts', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-voice-prompts' },
{ slug: 'phone-menu-languages', labelKey: 'adminNav.items.phoneMenuLanguages', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-phone-menu-languages' },
{ slug: 'transcription', labelKey: 'adminNav.items.transcription', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-transcription' },
{ slug: 'spam-protection', labelKey: 'adminNav.items.spamProtection', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-spam-protection' },
```

Migrate E2E tests: `tests/ui/voice-captcha.spec.ts` → use `admin-spam-*` testids.

Five commits.

---

### Task 13: Migrate Channels group (4 sections)

Apply Phase B pattern:
- `telephony-provider-section.tsx` → `phone-provider-section.tsx`. Testid prefix `admin-phone-provider-*`. i18n key `adminNav.items.phoneProvider` = "Phone Provider". **Wrap SIP URI + credentials fields in AdvancedReveal.**
- `channel-settings.tsx` → `messaging-sms-section.tsx`. Testid prefix `admin-messaging-sms-*`. i18n key `adminNav.items.messagingSms` = "Messaging / SMS".
- `rcs-channel-section.tsx` — keep name. Testid prefix `admin-rcs-*`. **Wrap webhook URL + HMAC secret in AdvancedReveal.**
- `signal-channel-section.tsx` — keep name. Testid prefix `admin-signal-*`. **Wrap webhook URL + HMAC secret in AdvancedReveal.**

Nav config entries in `channels` group:
```typescript
{ slug: 'phone-provider', labelKey: 'adminNav.items.phoneProvider', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-phone-provider' },
{ slug: 'messaging-sms', labelKey: 'adminNav.items.messagingSms', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-messaging-sms' },
{ slug: 'rcs', labelKey: 'adminNav.items.rcs', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-rcs' },
{ slug: 'signal', labelKey: 'adminNav.items.signal', requiredPermissions: ['settings:read'], testid: 'admin-sidebar-item-signal' },
```

Migrate E2E tests: `tests/ui/telephony-provider.spec.ts`, `tests/ui/rcs-channel.spec.ts`.

Four commits.

---

## Phase C — New super-admin sections

### Task 14: Migrate Hubs section with Edit dialog tabs

**Files:**
- Create: `src/client/components/admin-sections/hubs-section.tsx`
- Create: `src/client/components/admin-sections/hubs-edit-dialog.tsx` (extracted from current hubs.tsx)

- [ ] **Step 1: Read current `admin/hubs.tsx`**

```bash
cat src/client/routes/admin/hubs.tsx
```

- [ ] **Step 2: Extract the list view into `hubs-section.tsx`**

Contents: current hub list table + Create button. Wire to existing hub API functions.

Testids: `admin-hubs-create-button`, `admin-hubs-row-{hubId}`, `admin-hubs-edit-button-{hubId}`, `admin-hubs-archive-button-{hubId}`, `admin-hubs-delete-button-{hubId}`.

- [ ] **Step 3: Extract Edit dialog with internal Tabs**

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

<Dialog ...>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{t('hubs.editHub')}</DialogTitle>
    </DialogHeader>
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general" data-testid="admin-hubs-edit-dialog-tab-general">{t('hubs.tabs.general')}</TabsTrigger>
        <TabsTrigger value="access" data-testid="admin-hubs-edit-dialog-tab-access">{t('hubs.tabs.access')}</TabsTrigger>
        <TabsTrigger value="export" data-testid="admin-hubs-edit-dialog-tab-export">{t('hubs.tabs.export')}</TabsTrigger>
        <TabsTrigger value="danger" data-testid="admin-hubs-edit-dialog-tab-danger">{t('hubs.tabs.danger')}</TabsTrigger>
      </TabsList>
      <TabsContent value="general">{/* name, description, phone */}</TabsContent>
      <TabsContent value="access">{/* allow-super-admin-access toggle */}</TabsContent>
      <TabsContent value="export">{/* category checkboxes + download */}</TabsContent>
      <TabsContent value="danger">{/* archive + delete buttons */}</TabsContent>
    </Tabs>
  </DialogContent>
</Dialog>
```

The Access tab calls `PATCH /api/hubs/{hubId}/settings/allow-super-admin-access` with a toggle + confirmation dialog. Per spec `2026-03-22-hub-admin-zero-trust-visibility-design.md`, this was the UI that was never built.

- [ ] **Step 4: Register in `registry.ts` + nav config entry**

```typescript
{
  slug: 'hubs',
  labelKey: 'adminNav.items.hubs',
  requiredPermissions: ['system:manage-hubs'],
  requiredRole: 'role-super-admin',
  testid: 'admin-sidebar-item-hubs',
},
```

Add to `platform` group.

- [ ] **Step 5: Delete `src/client/routes/admin/hubs.tsx`**

- [ ] **Step 6: Add i18n keys for tabs** (`hubs.tabs.general`, `.access`, `.export`, `.danger`) and access control strings.

- [ ] **Step 7: Typecheck, commit**

```bash
bun run typecheck
git add ... && git commit -m "feat(admin): hubs section with tabbed edit dialog + access control UI"
```

---

### Task 15: Platform Roles section

**Files:**
- Create: `src/client/components/admin-sections/platform-roles-section.tsx`
- Create: `tests/ui/admin-platform-roles.spec.ts`

- [ ] **Step 1: Verify endpoint shape**

```bash
grep -n "roles" src/server/routes/settings.ts
cat src/server/routes/settings.ts | sed -n '830,960p'
```

Confirm: `GET /api/settings/roles`, `POST /api/settings/roles`, `PATCH /api/settings/roles/{id}`, `DELETE /api/settings/roles/{id}`, and that `role-super-admin` is flagged as read-only.

- [ ] **Step 2: Add API client functions** in `src/client/lib/api.ts`

```typescript
export async function listRoles(): Promise<Role[]> { ... }
export async function createRole(input: CreateRoleInput): Promise<Role> { ... }
export async function updateRole(id: string, patch: UpdateRoleInput): Promise<Role> { ... }
export async function deleteRole(id: string): Promise<void> { ... }
```

Use the existing `apiFetch` / `apiPost` / etc. helpers — read `src/client/lib/api.ts` top 100 lines for pattern.

- [ ] **Step 3: Write the section component**

```tsx
export function PlatformRolesSection() {
  const { t } = useTranslation()
  const { data: roles = [] } = useQuery({ queryKey: queryKeys.platform.roles(), queryFn: listRoles })

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('platformRoles.description')}</p>
        <Button data-testid="admin-platform-roles-create-button">{t('platformRoles.create')}</Button>
      </div>
      <table data-testid="admin-platform-roles-table">
        {/* list roles with edit/delete; role-super-admin shown but disabled */}
      </table>
    </section>
  )
}
```

Include: create dialog, edit dialog, delete confirmation. System role `role-super-admin` rendered read-only with disabled buttons + tooltip.

- [ ] **Step 4: Add query keys** in `src/client/lib/query-client.ts` under `queryKeys.platform`

```typescript
platform: {
  roles: () => ['platform', 'roles'] as const,
  bans: (scope: 'global' | string) => ['platform', 'bans', scope] as const,
  audit: (filters: AuditFilters) => ['platform', 'audit', filters] as const,
  analytics: (range: string) => ['platform', 'analytics', range] as const,
  health: () => ['platform', 'health'] as const,
},
```

Classify each under `PLAINTEXT_QUERY_KEYS` since these are admin metadata, not user PII.

- [ ] **Step 5: Register, add to nav config, add i18n, write E2E test, commit**

Nav config entry in `platform` group:
```typescript
{
  slug: 'platform-roles',
  labelKey: 'adminNav.items.platformRoles',
  requiredPermissions: ['system:manage-roles'],
  requiredRole: 'role-super-admin',
  testid: 'admin-sidebar-item-platform-roles',
},
```

Write `tests/ui/admin-platform-roles.spec.ts`:
```typescript
test('create and delete custom role', async ({ page }) => {
  await loginAsSuperAdmin(page)
  await page.goto('/admin/platform-roles')
  await page.getByTestId('admin-platform-roles-create-button').click()
  await page.getByTestId('admin-platform-roles-name-input').fill('Test Role')
  await page.getByTestId('admin-platform-roles-save').click()
  await expect(page.getByText('Test Role')).toBeVisible()
  // delete
  await page.getByTestId('admin-platform-roles-delete-Test Role').click()
  await page.getByTestId('admin-platform-roles-confirm-delete').click()
  await expect(page.getByText('Test Role')).not.toBeVisible()
})

test('system super-admin role is read-only', async ({ page }) => {
  await loginAsSuperAdmin(page)
  await page.goto('/admin/platform-roles')
  const editButton = page.getByTestId('admin-platform-roles-edit-role-super-admin')
  await expect(editButton).toBeDisabled()
})
```

Commit: `feat(admin): platform roles CRUD UI`

---

### Task 16: Bans section

**Files:**
- Create: `src/client/components/admin-sections/bans-section.tsx`
- Create: `tests/ui/admin-bans.spec.ts`

- [ ] **Step 1: Verify ban endpoint scope**

```bash
cat src/server/routes/bans.ts | head -60
```

Determine how "global" (no hubId) vs hub-scoped bans are distinguished. If there's no schema flag, document as open question — may need server change (out of scope for this task; fall back to listing all bans super-admin can see).

- [ ] **Step 2: Add API client functions** — `listBans(scope)`, `createBan(input)`, `deleteBan(phone)`, `bulkCreateBans(phones)`.

- [ ] **Step 3: Write component**

Fields: phone number input, reason text, ban button. Table of bans with delete button per row. Bulk upload via file input (CSV).

Testids: `admin-bans-add-phone-input`, `admin-bans-add-reason-input`, `admin-bans-add-button`, `admin-bans-table`, `admin-bans-row-{phone}`, `admin-bans-delete-{phone}`, `admin-bans-bulk-upload-input`, `admin-bans-bulk-submit`.

- [ ] **Step 4: Register, nav config entry, i18n, E2E test, commit**

Nav config:
```typescript
{
  slug: 'bans',
  labelKey: 'adminNav.items.bans',
  requiredPermissions: ['bans:read'],
  requiredRole: 'role-super-admin',
  testid: 'admin-sidebar-item-bans',
},
```

---

### Task 17: Audit section

**Files:**
- Create: `src/client/components/admin-sections/audit-section.tsx`
- Create: `tests/ui/admin-audit.spec.ts`

- [ ] **Step 1: Read endpoint spec**

```bash
cat src/server/routes/audit.ts
```

Understand: filter params (actorPubkey, eventType, dateRange, search), pagination (cursor/offset?), response shape.

- [ ] **Step 2: Add API client** — `listAuditEntries(filters, pagination)`.

- [ ] **Step 3: Write component with filter bar + paginated table**

Filters: actor select, event type select, date range picker, search input. Pagination: prev/next buttons.

Testids: `admin-audit-filter-actor`, `admin-audit-filter-event-type`, `admin-audit-filter-date-from`, `admin-audit-filter-date-to`, `admin-audit-search-input`, `admin-audit-prev-page`, `admin-audit-next-page`, `admin-audit-table`, `admin-audit-row-{entryId}`.

- [ ] **Step 4: Register, nav config, i18n, E2E test, commit**

```typescript
{
  slug: 'audit',
  labelKey: 'adminNav.items.audit',
  requiredPermissions: ['audit:read'],
  requiredRole: 'role-super-admin',
  testid: 'admin-sidebar-item-audit',
},
```

---

### Task 18: Analytics section

**Files:**
- Create: `src/client/components/admin-sections/analytics-section.tsx`
- Create: `tests/ui/admin-analytics.spec.ts`

- [ ] **Step 1: Read analytics endpoints**

```bash
cat src/server/routes/analytics.ts
```

- [ ] **Step 2: Add API client** — `getCallVolume(range: 7|30)`, `getHourlyDistribution(range)`, `getUserStats()`.

- [ ] **Step 3: Write component with three chart cards**

Use `recharts` (already a dep). Range toggle (7 days / 30 days). Three cards: call volume line chart, hour-of-day bar chart, per-user table.

Testids: `admin-analytics-range-7`, `admin-analytics-range-30`, `admin-analytics-call-volume-chart`, `admin-analytics-hours-chart`, `admin-analytics-users-table`.

- [ ] **Step 4: Register, nav config, i18n, E2E test, commit**

```typescript
{
  slug: 'analytics',
  labelKey: 'adminNav.items.analytics',
  requiredPermissions: ['calls:read-history', 'audit:read'],
  requiredRole: 'role-super-admin',
  testid: 'admin-sidebar-item-analytics',
},
```

E2E smoke test: load page, switch range, assert charts render.

---

### Task 19: Health section

**Files:**
- Create: `src/client/components/admin-sections/health-section.tsx`
- Create: `tests/ui/admin-health.spec.ts`

- [ ] **Step 1: Read endpoints**

```bash
cat src/server/routes/health.ts | head -80
grep -rn "provider-health" src/server/routes/ src/server/services/ | head -10
```

- [ ] **Step 2: Add API client** — `getSystemHealth()`, `getProviderHealth()`.

- [ ] **Step 3: Write component**

Two cards:
1. **System Health** — PostgreSQL, object storage, Nostr relay status dots + latency + version + uptime
2. **Provider Health** — per-provider badges (green/yellow/red) with latency, last check, consecutive failures

Testids: `admin-health-system-card`, `admin-health-system-db-status`, `admin-health-system-storage-status`, `admin-health-system-relay-status`, `admin-health-providers-card`, `admin-health-provider-{providerName}-status`.

Poll `getProviderHealth()` every 15s via React Query `refetchInterval`.

- [ ] **Step 4: Register, nav config, i18n, E2E test, commit**

```typescript
{
  slug: 'health',
  labelKey: 'adminNav.items.health',
  requiredPermissions: ['settings:read'],
  requiredRole: 'role-super-admin',
  testid: 'admin-sidebar-item-health',
},
```

E2E smoke test: load page, assert all health cards render.

---

### Task 20: Platform scaffold section

**Files:**
- Create: `src/client/components/admin-sections/platform-section.tsx`

- [ ] **Step 1: Write placeholder**

```tsx
import { useTranslation } from 'react-i18next'

export function PlatformSection() {
  const { t } = useTranslation()
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('platform.description')}</p>
      <div
        data-testid="admin-platform-empty-state"
        className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
      >
        {t('platform.emptyState')}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Register, nav config, i18n**

```typescript
{
  slug: 'platform',
  labelKey: 'adminNav.items.platform',
  requiredPermissions: [],
  requiredRole: 'role-super-admin',
  testid: 'admin-sidebar-item-platform',
},
```

i18n:
- `adminNav.items.platform` = "Platform"
- `platform.description` = "Platform-wide settings and configuration."
- `platform.emptyState` = "No platform-level settings yet."

Commit.

---

## Phase D — Cleanup + tests + final polish

### Task 21: Delete old files + legacy redirects

**Files:**
- Delete: `src/client/routes/admin/settings.tsx`
- Delete: `src/client/components/settings-section.tsx` (only if no remaining imports)
- Delete: `src/client/components/admin-settings/` directory (only if fully migrated)
- Create: Legacy redirect handler in `src/client/routes/admin/route.tsx`

- [ ] **Step 1: Verify no remaining imports of deleted components**

```bash
grep -rn "from '@/components/settings-section'" src/client --include='*.tsx' --include='*.ts'
grep -rn "from '@/components/admin-settings/" src/client --include='*.tsx' --include='*.ts'
```

Expected: no matches (outside the deleted files themselves).

- [ ] **Step 2: Delete `src/client/routes/admin/settings.tsx`** and regenerate TanStack routeTree.

- [ ] **Step 3: Delete `src/client/components/admin-settings/` directory.**

- [ ] **Step 4: Delete `src/client/components/settings-section.tsx`** if no other routes reference it (volunteer `/settings` may still use it — check first).

```bash
grep -rn "SettingsSection\|settings-section" src/client --include='*.tsx' --include='*.ts'
```

If volunteer `/settings.tsx` still uses it, leave the file in place.

- [ ] **Step 5: Add legacy deeplink redirect**

In `src/client/routes/admin/route.tsx`, add a `useEffect` that reads `window.location.hash` on mount and if it matches a known old anchor (`#roles`, `#geocoding`, etc.), redirects to the new slug.

```typescript
const LEGACY_ANCHOR_MAP: Record<string, string> = {
  'profile': 'location-lookup',  // settings.tsx had no section matching this; skip
  'geocoding': 'location-lookup',
  'telephony-provider': 'phone-provider',
  'ivr-languages': 'phone-menu-languages',
  'channels': 'messaging-sms',
  // direct renames stay: roles, teams, tags, custom-fields, report-types, firehose,
  // call-settings, voice-prompts, transcription, spam-protection, rcs, signal, passkey-policy
}

useEffect(() => {
  const hash = window.location.hash.replace('#', '')
  if (!hash) return
  const newSlug = LEGACY_ANCHOR_MAP[hash] ?? hash
  if (window.location.pathname === '/admin/settings' || window.location.pathname === '/admin/hubs') {
    navigate({ to: '/admin/$section', params: { section: newSlug }, replace: true })
  }
}, [])
```

- [ ] **Step 6: Run typecheck + full build**

```bash
bun run typecheck && bun run build
```

Expected: PASS with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(admin): delete legacy settings page + settings-section wrapper"
```

---

### Task 22: Write E2E test helpers

**Files:**
- Create: `tests/helpers/admin-settings.ts`

- [ ] **Step 1: Read existing helper for reference**

```bash
cat tests/helpers/authed-request.ts 2>/dev/null | head -30
ls tests/helpers/
```

- [ ] **Step 2: Write helpers**

```typescript
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function gotoAdminSection(page: Page, slug: string) {
  await page.goto(`/admin/${slug}`)
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', slug)
}

export async function expectActiveNavItem(page: Page, slug: string) {
  const item = page.getByTestId(`admin-sidebar-item-${slug}`)
  await expect(item).toHaveClass(/bg-accent/)
}

export async function openMobileNav(page: Page) {
  await page.getByTestId('admin-sidebar-toggle').click()
  await expect(page.getByTestId('admin-sidebar-drawer')).toBeVisible()
}

export async function closeMobileNav(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('admin-sidebar-drawer')).not.toBeVisible()
}

export async function expectSectionLoaded(page: Page, slug: string) {
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', slug)
  await expect(page.getByTestId('admin-section-heading')).toBeVisible()
}

export async function revealAdvanced(page: Page, sectionSlug: string) {
  await page.getByTestId(`admin-advanced-reveal-${sectionSlug}`).click()
  await expect(page.getByTestId(`admin-advanced-panel-${sectionSlug}`)).toBeVisible()
}

export async function hideAdvanced(page: Page, sectionSlug: string) {
  await page.getByTestId(`admin-advanced-reveal-${sectionSlug}`).click()
  await expect(page.getByTestId(`admin-advanced-panel-${sectionSlug}`)).not.toBeVisible()
}

export async function saveSection(page: Page, sectionSlug: string) {
  await page.getByTestId(`admin-${sectionSlug}-save`).click()
  await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 5000 })
}

export async function expectNavGroupVisible(page: Page, groupSlug: string) {
  await expect(page.getByTestId(`admin-sidebar-group-${groupSlug}`)).toBeVisible()
}

export async function expectNavGroupHidden(page: Page, groupSlug: string) {
  await expect(page.getByTestId(`admin-sidebar-group-${groupSlug}`)).not.toBeVisible()
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/admin-settings.ts
git commit -m "test(admin): E2E helpers for settings navigation + assertions"
```

---

### Task 23: Write admin-shell E2E test

**Files:**
- Create: `tests/ui/admin-shell.spec.ts`

- [ ] **Step 1: Write shell tests**

```typescript
import { test, expect } from '@playwright/test'
import { loginAsAdmin, loginAsSuperAdmin } from '../fixtures/auth'
import {
  gotoAdminSection, expectActiveNavItem, openMobileNav, closeMobileNav,
  expectNavGroupVisible, expectNavGroupHidden,
} from '../helpers/admin-settings'

test.describe('admin shell', () => {
  test('hub admin sees this-hub groups, not platform', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin')
    await expectNavGroupVisible(page, 'general')
    await expectNavGroupVisible(page, 'people')
    await expectNavGroupHidden(page, 'platform')
  })

  test('super-admin sees platform group', async ({ page }) => {
    await loginAsSuperAdmin(page)
    await page.goto('/admin')
    await expectNavGroupVisible(page, 'platform')
  })

  test('nav item click updates active state', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin')
    await page.getByTestId('admin-sidebar-item-teams').click()
    await expectActiveNavItem(page, 'teams')
  })

  test('deeplink loads correct section', async ({ page }) => {
    await loginAsAdmin(page)
    await gotoAdminSection(page, 'spam-protection')
  })

  test('mobile drawer opens + closes', async ({ page, viewport }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await loginAsAdmin(page)
    await page.goto('/admin')
    await openMobileNav(page)
    await closeMobileNav(page)
  })

  test('legacy /admin/settings redirects', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/\/admin\/(location-lookup|passkey-policy|hub-roles|teams)/)
  })
})
```

- [ ] **Step 2: Commit**

---

### Task 24: AdvancedReveal E2E test

**Files:**
- Create: `tests/ui/admin-advanced-reveal.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../fixtures/auth'
import { gotoAdminSection, revealAdvanced, hideAdvanced } from '../helpers/admin-settings'

test('spam-protection advanced reveal shows/hides thresholds', async ({ page }) => {
  await loginAsAdmin(page)
  await gotoAdminSection(page, 'spam-protection')
  await expect(page.getByTestId('admin-advanced-panel-spam-protection')).not.toBeVisible()
  await revealAdvanced(page, 'spam-protection')
  await expect(page.getByTestId('admin-spam-protection-max-calls-per-minute-input')).toBeVisible()
  await hideAdvanced(page, 'spam-protection')
  await expect(page.getByTestId('admin-advanced-panel-spam-protection')).not.toBeVisible()
})

test('phone-provider advanced reveal hides SIP URI by default', async ({ page }) => {
  await loginAsAdmin(page)
  await gotoAdminSection(page, 'phone-provider')
  await expect(page.getByTestId('admin-phone-provider-sip-uri-input')).not.toBeVisible()
  await revealAdvanced(page, 'phone-provider')
  await expect(page.getByTestId('admin-phone-provider-sip-uri-input')).toBeVisible()
})
```

- [ ] **Step 2: Commit**

---

### Task 25: Final verification

- [ ] **Step 1: Run typecheck**

```bash
cd ~/projects/llamenos-hotline-settings-ux && bun run typecheck
```

Expected: PASS, no errors.

- [ ] **Step 2: Run build**

```bash
bun run build
```

Expected: successful build.

- [ ] **Step 3: Run unit tests**

```bash
bun run test:unit
```

Expected: all green.

- [ ] **Step 4: Start docker services + server, run E2E**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
SERVER_PID=$!
sleep 8
bunx playwright test tests/ui/admin-shell.spec.ts tests/ui/admin-advanced-reveal.spec.ts tests/ui/admin-nav-config.spec.ts tests/ui/admin-platform-roles.spec.ts tests/ui/admin-bans.spec.ts tests/ui/admin-audit.spec.ts tests/ui/admin-analytics.spec.ts tests/ui/admin-health.spec.ts tests/ui/geocoding.spec.ts tests/ui/telephony-provider.spec.ts tests/ui/voice-captcha.spec.ts tests/ui/rcs-channel.spec.ts
kill $SERVER_PID
```

Expected: all green.

- [ ] **Step 5: Run full E2E suite**

```bash
bunx playwright test
```

Expected: no new failures vs main.

- [ ] **Step 6: Lint**

```bash
bun run lint:fix
```

- [ ] **Step 7: Commit any lint fixes**

---

## Self-Review Checklist

After plan is written, verify:

- [ ] Every spec section ("Design Overview", "Component & File Layout", "data-testid Conventions", "Test Strategy", "i18n", etc.) is covered by at least one task.
- [ ] No "TBD" or "implement later" strings in the plan.
- [ ] Every `admin-*` testid used in a test has a corresponding code-level testid in its component task.
- [ ] Every new API client function referenced in a section task has its definition step.
- [ ] Every nav config slug added matches the file name of its section component and the URL path used in tests.
- [ ] i18n key additions are enumerated per task.
- [ ] The three open questions in the spec have verification steps in Tasks 10, 15, and 16.
