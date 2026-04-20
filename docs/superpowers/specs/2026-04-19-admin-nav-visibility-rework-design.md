# Admin Nav Visibility Rework

**Date:** 2026-04-19
**Status:** Approved

## Problem

The admin sidebar's `canSeeGroup` function blanket-hides the entire "Platform" group from non-super-admins:

```typescript
if (group.scope === 'platform' && !auth.roles.includes('role-super-admin')) return false
```

This means hub-admins (who hold `bans:*`, `audit:read`, `settings:*`, `calls:read-history`) cannot see bans, audit, analytics, or health items — even though they have the permissions to use them. Hub-admins see only 19 of 27 nav items.

## Solution

Split the current Platform group into two groups and remove the blanket role gate. Individual items' `requiredPermissions` + `requiredRole` fields control visibility.

## Changes

### 1. `src/client/components/admin-shell/admin-nav-config.ts`

Replace the single "Platform" group with two groups:

**New group: "Operations"** (placed after "Channels", before "Platform"):

```typescript
{
  groupSlug: 'operations',
  scope: 'this-hub',
  labelKey: 'adminNav.groups.operations',
  items: [
    {
      slug: 'bans',
      labelKey: 'adminNav.items.bans',
      requiredPermissions: ['bans:read'],
      testid: 'admin-sidebar-item-bans',
    },
    {
      slug: 'audit',
      labelKey: 'adminNav.items.audit',
      requiredPermissions: ['audit:read'],
      testid: 'admin-sidebar-item-audit',
    },
    {
      slug: 'analytics',
      labelKey: 'adminNav.items.analytics',
      requiredPermissions: ['calls:read-history', 'audit:read'],
      testid: 'admin-sidebar-item-analytics',
    },
    {
      slug: 'health',
      labelKey: 'adminNav.items.health',
      requiredPermissions: ['settings:read'],
      testid: 'admin-sidebar-item-health',
    },
  ],
}
```

**Remaining "Platform" group** (super-admin-only items):

```typescript
{
  groupSlug: 'platform',
  scope: 'platform',
  labelKey: 'adminNav.groups.platform',
  items: [
    {
      slug: 'hubs',
      labelKey: 'adminNav.items.hubs',
      requiredPermissions: ['system:manage-hubs'],
      requiredRole: 'role-super-admin',
      testid: 'admin-sidebar-item-hubs',
    },
    {
      slug: 'platform-roles',
      labelKey: 'adminNav.items.platformRoles',
      requiredPermissions: ['system:manage-roles'],
      requiredRole: 'role-super-admin',
      testid: 'admin-sidebar-item-platform-roles',
    },
    {
      slug: 'platform',
      labelKey: 'adminNav.items.platform',
      requiredPermissions: [],
      requiredRole: 'role-super-admin',
      testid: 'admin-sidebar-item-platform',
    },
    {
      slug: 'gdpr-erasure',
      labelKey: 'adminNav.items.gdprErasure',
      requiredPermissions: ['gdpr:admin'],
      requiredRole: 'role-super-admin',
      testid: 'admin-sidebar-item-gdpr-erasure',
    },
  ],
}
```

### 2. `src/client/components/admin-shell/admin-sidebar.tsx`

Remove the blanket platform gate from `canSeeGroup`:

```diff
  function canSeeGroup(group: AdminNavGroup): boolean {
-   if (group.scope === 'platform' && !auth.roles.includes('role-super-admin')) return false
    return group.items.some(canSee)
  }
```

The remaining Platform group items all carry `requiredRole: 'role-super-admin'` individually, so `canSee` rejects them for non-super-admins. The group becomes invisible naturally (no visible items → `items.some(canSee)` returns false).

### 3. i18n (all 22 locale files)

Add one key per locale:

```json
"adminNav.groups.operations": "Operations"
```

(Translate appropriately per locale.)

### 4. No server-side changes

The server already enforces permissions per-endpoint. This change only affects client-side sidebar visibility. A hub-admin who somehow navigates to `/admin/hubs` directly will still get a 403 from the server.

## Visibility Matrix (after change)

| Role | Groups visible | Item count |
|------|---------------|------------|
| Super Admin | General, People, Intake, Calls & Voice, Channels, Operations, Platform | 27 |
| Hub Admin | General, People, Intake, Calls & Voice, Channels, Operations | 23 |
| Volunteer | *(no admin access)* | 0 |

## Testing

- Unit test: `canSeeGroup` with hub-admin permissions returns true for Operations, false for Platform
- Unit test: `canSee` for each Operations item with hub-admin role permissions
- E2E: hub-admin user navigates to `/admin` and sees bans, audit, analytics, health items
- E2E: hub-admin does NOT see hubs, platform-roles, platform, gdpr-erasure items
