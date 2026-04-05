import type { AdminNavConfig } from './admin-nav-config.types'

export const adminNavConfig: AdminNavConfig = {
  groups: [
    // This Hub
    {
      groupSlug: 'general',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.general',
      items: [
        {
          slug: 'location-lookup',
          labelKey: 'adminNav.items.locationLookup',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-location-lookup',
        },
      ],
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
