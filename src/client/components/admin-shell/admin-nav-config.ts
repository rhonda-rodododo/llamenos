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
        {
          slug: 'passkey-policy',
          labelKey: 'adminNav.items.passkeyPolicy',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-passkey-policy',
        },
      ],
    },
    {
      groupSlug: 'people',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.people',
      items: [
        {
          slug: 'hub-roles',
          labelKey: 'adminNav.items.hubRoles',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-hub-roles',
        },
        {
          slug: 'teams',
          labelKey: 'adminNav.items.teams',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-teams',
        },
        {
          slug: 'tags',
          labelKey: 'adminNav.items.tags',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-tags',
        },
      ],
    },
    {
      groupSlug: 'intake',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.intake',
      items: [
        {
          slug: 'custom-fields',
          labelKey: 'adminNav.items.customFields',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-custom-fields',
        },
        {
          slug: 'report-types',
          labelKey: 'adminNav.items.reportTypes',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-report-types',
        },
        {
          slug: 'firehose',
          labelKey: 'adminNav.items.firehose',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-firehose',
        },
      ],
    },
    {
      groupSlug: 'calls-voice',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.callsVoice',
      items: [
        {
          slug: 'call-settings',
          labelKey: 'adminNav.items.callSettings',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-call-settings',
        },
        {
          slug: 'voice-prompts',
          labelKey: 'adminNav.items.voicePrompts',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-voice-prompts',
        },
        {
          slug: 'phone-menu-languages',
          labelKey: 'adminNav.items.phoneMenuLanguages',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-phone-menu-languages',
        },
        {
          slug: 'transcription',
          labelKey: 'adminNav.items.transcription',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-transcription',
        },
        {
          slug: 'spam-protection',
          labelKey: 'adminNav.items.spamProtection',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-spam-protection',
        },
      ],
    },
    {
      groupSlug: 'channels',
      scope: 'this-hub',
      labelKey: 'adminNav.groups.channels',
      items: [
        {
          slug: 'phone-provider',
          labelKey: 'adminNav.items.phoneProvider',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-phone-provider',
        },
        {
          slug: 'messaging-sms',
          labelKey: 'adminNav.items.messagingSms',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-messaging-sms',
        },
        {
          slug: 'rcs',
          labelKey: 'adminNav.items.rcs',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-rcs',
        },
        {
          slug: 'signal',
          labelKey: 'adminNav.items.signal',
          requiredPermissions: ['settings:read'],
          testid: 'admin-sidebar-item-signal',
        },
      ],
    },
    // Platform
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
          slug: 'bans',
          labelKey: 'adminNav.items.bans',
          requiredPermissions: ['bans:read'],
          requiredRole: 'role-super-admin',
          testid: 'admin-sidebar-item-bans',
        },
        {
          slug: 'audit',
          labelKey: 'adminNav.items.audit',
          requiredPermissions: ['audit:read'],
          requiredRole: 'role-super-admin',
          testid: 'admin-sidebar-item-audit',
        },
      ],
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
