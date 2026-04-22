/**
 * Permission-Based Access Control (PBAC)
 *
 * Permissions are colon-separated strings: "domain:action"
 * Roles are named bundles of permissions.
 * Users can have multiple roles — effective permissions = union of all.
 * Wildcard "*" grants all permissions; "domain:*" grants all within domain.
 */

import type { Ciphertext } from './crypto-types'

// --- Permission Catalog ---

export interface PermissionMeta {
  label: string
  group: string
  subgroup: 'scope' | 'actions' | 'tiers'
  /** For scope permissions: the scope level this permission grants */
  scope?: 'own' | 'assigned' | 'all'
  /** For contact tier permissions: the envelope tier */
  tier?: 'envelope-summary' | 'envelope-full'
}

export const PERMISSION_GROUP_LABELS: Record<string, string> = {
  contacts: 'Contact Directory',
  tags: 'Tags',
  notes: 'Notes',
  calls: 'Calls',
  reports: 'Reports',
  conversations: 'Conversations',
  users: 'User Management',
  shifts: 'Shifts',
  files: 'Files',
  bans: 'Ban List',
  invites: 'Invites',
  settings: 'Settings',
  audit: 'Audit Log',
  blasts: 'Blasts',
  voicemail: 'Voicemail',
  firehose: 'Firehose Agents',
  gdpr: 'GDPR / Privacy',
  system: 'System',
}

export const PERMISSION_CATALOG = {
  // --- Contacts ---
  //
  // Contact permissions compose three orthogonal dimensions:
  //   1. Scope (whose contacts):   read-own / read-assigned / read-all
  //                                update-own / update-assigned / update-all
  //   2. Tier (what fields):       envelope-summary (display name, tags, notes)
  //                                envelope-full (legal name, phone, address, channels)
  //   3. Actions (what ops):       create, update-summary, update-pii, delete, link
  //
  // A full auth check composes all three. Example: "can this user edit this contact's PII?"
  // requires scope (update-own/assigned/all) + tier (envelope-full) + action (update-pii).

  // --- Contacts: Scope ---
  'contacts:read-own': {
    label: 'View contacts they created or handled',
    group: 'contacts',
    subgroup: 'scope',
    scope: 'own',
  },
  'contacts:read-assigned': {
    label: 'View contacts assigned to them',
    group: 'contacts',
    subgroup: 'scope',
    scope: 'assigned',
  },
  'contacts:read-all': {
    label: 'View all contacts in this hub',
    group: 'contacts',
    subgroup: 'scope',
    scope: 'all',
  },
  'contacts:update-own': {
    label: 'Edit contacts they created',
    group: 'contacts',
    subgroup: 'scope',
    scope: 'own',
  },
  'contacts:update-assigned': {
    label: 'Edit contacts assigned to them',
    group: 'contacts',
    subgroup: 'scope',
    scope: 'assigned',
  },
  'contacts:update-all': {
    label: 'Edit any contact',
    group: 'contacts',
    subgroup: 'scope',
    scope: 'all',
  },

  // --- Contacts: Tiers ---
  'contacts:envelope-summary': {
    label: 'Access display name, tags, risk level, notes',
    group: 'contacts',
    subgroup: 'tiers',
    tier: 'envelope-summary',
  },
  'contacts:envelope-full': {
    label: 'Access full details (legal name, phone, address, channels)',
    group: 'contacts',
    subgroup: 'tiers',
    tier: 'envelope-full',
  },

  // --- Contacts: Actions ---
  'contacts:create': {
    label: 'Create new contacts and relationships',
    group: 'contacts',
    subgroup: 'actions',
  },
  'contacts:update-summary': {
    label: 'Edit contact summary fields (display name, notes, tags)',
    group: 'contacts',
    subgroup: 'actions',
  },
  'contacts:update-pii': {
    label: 'Edit contact PII fields (legal name, phone, address)',
    group: 'contacts',
    subgroup: 'actions',
  },
  'contacts:delete': { label: 'Delete contacts', group: 'contacts', subgroup: 'actions' },
  'contacts:link': {
    label: 'Link/unlink calls and conversations to contacts',
    group: 'contacts',
    subgroup: 'actions',
  },
  'contacts:triage': {
    label: 'Review and merge intake submissions into contact records',
    group: 'contacts',
    subgroup: 'actions',
  },

  // --- Tags: Actions ---
  'tags:create': {
    label: 'Create new tags',
    group: 'tags',
    subgroup: 'actions',
  },

  // --- Notes: Scope ---
  'notes:read-own': { label: 'Read own notes', group: 'notes', subgroup: 'scope', scope: 'own' },
  'notes:read-assigned': {
    label: 'Read notes from assigned users',
    group: 'notes',
    subgroup: 'scope',
    scope: 'assigned',
  },
  'notes:read-all': { label: 'Read all notes', group: 'notes', subgroup: 'scope', scope: 'all' },
  'notes:update-own': {
    label: 'Update own notes',
    group: 'notes',
    subgroup: 'scope',
    scope: 'own',
  },
  'notes:update-assigned': {
    label: 'Update notes from assigned users',
    group: 'notes',
    subgroup: 'scope',
    scope: 'assigned',
  },
  'notes:update-all': {
    label: 'Update any note',
    group: 'notes',
    subgroup: 'scope',
    scope: 'all',
  },

  // --- Notes: Actions ---
  'notes:create': { label: 'Create call notes', group: 'notes', subgroup: 'actions' },
  'notes:reply': { label: 'Reply to notes', group: 'notes', subgroup: 'actions' },

  // --- Calls: Actions ---
  'calls:answer': { label: 'Answer incoming calls', group: 'calls', subgroup: 'actions' },
  'calls:read-active': {
    label: 'See active calls (caller info redacted)',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:read-active-full': {
    label: 'See active calls with full caller info',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:read-history': { label: 'View call history', group: 'calls', subgroup: 'actions' },
  'calls:read-presence': { label: 'View user presence', group: 'calls', subgroup: 'actions' },
  'calls:read-recording': {
    label: 'Listen to call recordings',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:debug': { label: 'Debug call state', group: 'calls', subgroup: 'actions' },

  // --- Reports: Scope ---
  'reports:read-own': {
    label: 'Read own reports',
    group: 'reports',
    subgroup: 'scope',
    scope: 'own',
  },
  'reports:read-assigned': {
    label: 'Read assigned reports',
    group: 'reports',
    subgroup: 'scope',
    scope: 'assigned',
  },
  'reports:read-all': {
    label: 'Read all reports',
    group: 'reports',
    subgroup: 'scope',
    scope: 'all',
  },

  // --- Reports: Actions ---
  'reports:create': { label: 'Submit reports', group: 'reports', subgroup: 'actions' },
  'reports:assign': { label: 'Assign reports to reviewers', group: 'reports', subgroup: 'actions' },
  'reports:update': { label: 'Update report status', group: 'reports', subgroup: 'actions' },
  'reports:send-message-own': {
    label: 'Send messages in own reports',
    group: 'reports',
    subgroup: 'actions',
  },
  'reports:send-message': {
    label: 'Send messages in any report',
    group: 'reports',
    subgroup: 'actions',
  },

  // --- Conversations: Scope ---
  'conversations:read-own': {
    label: 'Read conversations they initiated',
    group: 'conversations',
    subgroup: 'scope',
    scope: 'own',
  },
  'conversations:read-assigned': {
    label: 'Read assigned and waiting conversations',
    group: 'conversations',
    subgroup: 'scope',
    scope: 'assigned',
  },
  'conversations:read-all': {
    label: 'Read all conversations',
    group: 'conversations',
    subgroup: 'scope',
    scope: 'all',
  },

  // --- Conversations: Actions ---
  'conversations:claim': {
    label: 'Claim a waiting conversation',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-sms': {
    label: 'Claim SMS conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-whatsapp': {
    label: 'Claim WhatsApp conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-signal': {
    label: 'Claim Signal conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-rcs': {
    label: 'Claim RCS conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-web': {
    label: 'Claim web conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-any': {
    label: 'Claim any channel (bypass restrictions)',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:send': {
    label: 'Send messages in assigned conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:send-any': {
    label: 'Send messages in any conversation',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:update': {
    label: 'Reassign/close/reopen conversations',
    group: 'conversations',
    subgroup: 'actions',
  },

  // --- Users: Actions ---
  'users:read': { label: 'List/view user profiles', group: 'users', subgroup: 'actions' },
  'users:create': { label: 'Create new users', group: 'users', subgroup: 'actions' },
  'users:update': { label: 'Update user profiles', group: 'users', subgroup: 'actions' },
  'users:delete': { label: 'Deactivate/delete users', group: 'users', subgroup: 'actions' },
  'users:manage-roles': { label: 'Assign/change user roles', group: 'users', subgroup: 'actions' },

  // --- Shifts: Scope ---
  'shifts:read-own': {
    label: 'Check own shift status',
    group: 'shifts',
    subgroup: 'scope',
    scope: 'own',
  },
  'shifts:read-assigned': {
    label: 'View shifts they are scheduled on',
    group: 'shifts',
    subgroup: 'scope',
    scope: 'assigned',
  },
  'shifts:read-all': {
    label: 'View all shifts',
    group: 'shifts',
    subgroup: 'scope',
    scope: 'all',
  },

  // --- Shifts: Actions ---
  'shifts:create': { label: 'Create shifts', group: 'shifts', subgroup: 'actions' },
  'shifts:update': { label: 'Modify shifts', group: 'shifts', subgroup: 'actions' },
  'shifts:delete': { label: 'Delete shifts', group: 'shifts', subgroup: 'actions' },
  'shifts:manage-fallback': {
    label: 'Manage fallback ring group',
    group: 'shifts',
    subgroup: 'actions',
  },

  // --- Files: Scope ---
  'files:download-own': {
    label: 'Download own/authorized files',
    group: 'files',
    subgroup: 'scope',
    scope: 'own',
  },
  'files:download-assigned': {
    label: 'Download files from assigned resources',
    group: 'files',
    subgroup: 'scope',
    scope: 'assigned',
  },
  'files:download-all': {
    label: 'Download any file',
    group: 'files',
    subgroup: 'scope',
    scope: 'all',
  },

  // --- Files: Actions ---
  'files:upload': { label: 'Upload files', group: 'files', subgroup: 'actions' },
  'files:share': {
    label: 'Re-encrypt/share files with others',
    group: 'files',
    subgroup: 'actions',
  },

  // --- Bans: Actions ---
  'bans:report': { label: 'Report/flag a number', group: 'bans', subgroup: 'actions' },
  'bans:read': { label: 'View ban list', group: 'bans', subgroup: 'actions' },
  'bans:create': { label: 'Ban numbers', group: 'bans', subgroup: 'actions' },
  'bans:bulk-create': { label: 'Bulk ban import', group: 'bans', subgroup: 'actions' },
  'bans:delete': { label: 'Remove bans', group: 'bans', subgroup: 'actions' },

  // --- Invites: Actions ---
  'invites:read': { label: 'View pending invites', group: 'invites', subgroup: 'actions' },
  'invites:create': { label: 'Create invite codes', group: 'invites', subgroup: 'actions' },
  'invites:revoke': { label: 'Revoke invite codes', group: 'invites', subgroup: 'actions' },

  // --- Settings: Actions ---
  'settings:read': { label: 'View settings', group: 'settings', subgroup: 'actions' },
  'settings:manage': { label: 'Modify all settings', group: 'settings', subgroup: 'actions' },
  'settings:manage-telephony': {
    label: 'Modify telephony provider',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-messaging': {
    label: 'Modify messaging channels',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-spam': { label: 'Modify spam settings', group: 'settings', subgroup: 'actions' },
  'settings:manage-ivr': {
    label: 'Modify IVR/language settings',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-fields': {
    label: 'Modify custom fields',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-transcription': {
    label: 'Modify transcription settings',
    group: 'settings',
    subgroup: 'actions',
  },

  // --- Audit: Actions ---
  'audit:read': { label: 'View audit log', group: 'audit', subgroup: 'actions' },

  // --- Blasts: Actions ---
  'blasts:read': { label: 'View blast history', group: 'blasts', subgroup: 'actions' },
  'blasts:send': { label: 'Send blasts', group: 'blasts', subgroup: 'actions' },
  'blasts:manage': {
    label: 'Manage subscriber lists and templates',
    group: 'blasts',
    subgroup: 'actions',
  },
  'blasts:schedule': { label: 'Schedule future blasts', group: 'blasts', subgroup: 'actions' },

  // --- Voicemail: Actions ---
  'voicemail:listen': {
    label: 'Play/decrypt voicemail audio',
    group: 'voicemail',
    subgroup: 'actions',
  },
  'voicemail:read': {
    label: 'View voicemail metadata in call history',
    group: 'voicemail',
    subgroup: 'actions',
  },
  'voicemail:notify': {
    label: 'Receive notifications for new voicemails',
    group: 'voicemail',
    subgroup: 'actions',
  },
  'voicemail:delete': {
    label: 'Delete voicemail audio and transcript',
    group: 'voicemail',
    subgroup: 'actions',
  },
  'voicemail:manage': {
    label: 'Configure voicemail settings',
    group: 'voicemail',
    subgroup: 'actions',
  },

  // --- Firehose ---
  'firehose:manage': {
    label: 'Create, update, and delete firehose connections',
    group: 'firehose',
    subgroup: 'actions',
  },
  'firehose:read': {
    label: 'View firehose connection status and health',
    group: 'firehose',
    subgroup: 'actions',
  },

  // --- GDPR: Actions ---
  'gdpr:consent': {
    label: 'Record and check own data processing consent',
    group: 'gdpr',
    subgroup: 'actions',
  },
  'gdpr:export': {
    label: 'Export own data (GDPR data portability)',
    group: 'gdpr',
    subgroup: 'actions',
  },
  'gdpr:erase-self': {
    label: 'Request erasure of own account',
    group: 'gdpr',
    subgroup: 'actions',
  },
  'gdpr:admin': {
    label: 'Admin-level GDPR operations (export/erase any user)',
    group: 'gdpr',
    subgroup: 'actions',
  },

  // --- System: Actions ---
  'system:manage-roles': {
    label: 'Create/edit/delete custom roles',
    group: 'system',
    subgroup: 'actions',
  },
  'system:manage-hubs': { label: 'Create/manage hubs', group: 'system', subgroup: 'actions' },
  'system:manage-instance': {
    label: 'Instance-level settings',
    group: 'system',
    subgroup: 'actions',
  },
} as const satisfies Record<string, PermissionMeta>

export type Permission = keyof typeof PERMISSION_CATALOG

/** All permission domains (first part before the colon) */
export type PermissionDomain = Permission extends `${infer D}:${string}` ? D : never

/** Domain wildcard (e.g. "contacts:*") or global wildcard "*" */
export type WildcardPermission = `${PermissionDomain}:*` | '*'

/** A concrete permission or a wildcard */
export type PermissionOrWildcard = Permission | WildcardPermission

/** Group permissions by domain for the role editor UI */
export function getPermissionsByDomain(): Record<
  string,
  { key: Permission; meta: PermissionMeta }[]
> {
  const result: Record<string, { key: Permission; meta: PermissionMeta }[]> = {}
  for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
    const domain = key.split(':')[0]
    if (!result[domain]) result[domain] = []
    result[domain].push({ key: key as Permission, meta })
  }
  return result
}

// --- Role Definition ---

export interface Role {
  id: string
  name: string
  permissions: string[]
  isDefault: boolean // ships with system
  isSystem: boolean // can't be modified at all (super-admin)
  description: string
  /** Hub-key encrypted name (hex ciphertext). */
  encryptedName?: Ciphertext
  /** Hub-key encrypted description (hex ciphertext). */
  encryptedDescription?: Ciphertext
  createdAt: string
  updatedAt: string
}

// --- Default Role Definitions ---

export const DEFAULT_ROLES: Omit<Role, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'role-super-admin',
    name: 'Super Admin',
    permissions: ['*'],
    isDefault: true,
    isSystem: true,
    description: 'Full system access — creates hubs, manages all settings and users',
  },
  {
    id: 'role-hub-admin',
    name: 'Hub Admin',
    permissions: [
      'users:*',
      'shifts:*',
      'settings:*',
      'audit:read',
      'bans:*',
      'invites:*',
      'notes:read-all',
      'notes:create',
      'notes:update-own',
      'notes:reply',
      'reports:*',
      'conversations:*',
      'calls:*',
      'blasts:*',
      'files:*',
      'contacts:*',
      'voicemail:*',
      'firehose:manage',
      'firehose:read',
      'gdpr:consent',
      'gdpr:export',
      'gdpr:erase-self',
    ],
    isDefault: true,
    isSystem: false,
    description: 'Full control within assigned hub(s) — manages users, shifts, settings',
  },
  {
    id: 'role-reviewer',
    name: 'Reviewer',
    permissions: [
      'notes:read-assigned',
      'notes:reply',
      'reports:read-assigned',
      'reports:assign',
      'reports:update',
      'reports:send-message',
      'conversations:read-assigned',
      'conversations:send',
      'shifts:read-own',
      'files:download-own',
      'files:upload',
      'gdpr:consent',
      'gdpr:export',
      'gdpr:erase-self',
    ],
    isDefault: true,
    isSystem: false,
    description: 'Reviews notes and reports from assigned users or shifts',
  },
  {
    id: 'role-case-manager',
    name: 'Case Manager',
    permissions: [
      'contacts:read-assigned',
      'contacts:update-assigned',
      'contacts:envelope-summary',
      'contacts:envelope-full',
      'contacts:create',
      'contacts:link',
      'contacts:triage',
      'tags:create',
      'notes:read-all',
      'notes:create',
      'notes:update-own',
      'notes:reply',
      'conversations:read-assigned',
      'conversations:send',
      'reports:read-assigned',
      'reports:update',
      'reports:send-message',
      'calls:read-history',
      'calls:read-active',
      'files:upload',
      'files:download-assigned',
      'shifts:read-own',
      'voicemail:read',
      'gdpr:consent',
      'gdpr:export',
      'gdpr:erase-self',
    ],
    isDefault: true,
    isSystem: false,
    description: 'Triages intake, manages assigned contact records, coordinates support networks',
  },
  {
    id: 'role-volunteer',
    name: 'Volunteer',
    permissions: [
      'calls:answer',
      'calls:read-active',
      'notes:create',
      'notes:read-own',
      'notes:update-own',
      'notes:reply',
      'conversations:claim',
      'conversations:send',
      'conversations:read-assigned',
      'conversations:claim-sms',
      'conversations:claim-whatsapp',
      'conversations:claim-signal',
      'conversations:claim-rcs',
      'conversations:claim-web',
      'shifts:read-own',
      'users:read',
      'bans:report',
      'reports:read-assigned',
      'reports:send-message',
      'files:upload',
      'files:download-own',
      'gdpr:consent',
      'gdpr:export',
      'gdpr:erase-self',
      'voicemail:read',
      'calls:read-history',
      'contacts:create',
      'contacts:read-own',
      'contacts:envelope-summary',
    ],
    isDefault: true,
    isSystem: false,
    description: 'Answers calls, writes notes, handles assigned conversations',
  },
  {
    id: 'role-reporter',
    name: 'Reporter',
    permissions: [
      'reports:create',
      'reports:read-own',
      'reports:send-message-own',
      'files:upload',
      'files:download-own',
    ],
    isDefault: true,
    isSystem: false,
    description: 'Submits reports and tracks their own submissions',
  },
  {
    id: 'role-voicemail-reviewer',
    name: 'Voicemail Reviewer',
    permissions: [
      'voicemail:listen',
      'voicemail:read',
      'voicemail:notify',
      'notes:read-all',
      'contacts:read-assigned',
      'contacts:envelope-summary',
      'calls:read-history',
    ],
    isDefault: true,
    isSystem: false,
    description: 'Triages voicemails — listens, reads transcripts, and receives notifications',
  },
]

export const DEFAULT_ROLE_I18N_KEYS: Record<string, { name: string; description: string }> = {
  'role-super-admin': {
    name: 'defaultRoles.superAdmin.name',
    description: 'defaultRoles.superAdmin.description',
  },
  'role-hub-admin': {
    name: 'defaultRoles.hubAdmin.name',
    description: 'defaultRoles.hubAdmin.description',
  },
  'role-reviewer': {
    name: 'defaultRoles.reviewer.name',
    description: 'defaultRoles.reviewer.description',
  },
  'role-case-manager': {
    name: 'defaultRoles.caseManager.name',
    description: 'defaultRoles.caseManager.description',
  },
  'role-volunteer': {
    name: 'defaultRoles.volunteer.name',
    description: 'defaultRoles.volunteer.description',
  },
  'role-reporter': {
    name: 'defaultRoles.reporter.name',
    description: 'defaultRoles.reporter.description',
  },
  'role-voicemail-reviewer': {
    name: 'defaultRoles.voicemailReviewer.name',
    description: 'defaultRoles.voicemailReviewer.description',
  },
}

// --- Permission Resolution ---

const SCOPE_LEVELS: Record<string, number> = {
  own: 0,
  assigned: 1,
  all: 2,
}

/**
 * Check if a set of permissions grants a specific permission.
 * Supports exact match, domain wildcards (e.g. "calls:*"), and global wildcard "*".
 * Also resolves scope hierarchy: -all subsumes -assigned subsumes -own.
 */
export function permissionGranted(grantedPermissions: string[], required: string): boolean {
  // Global wildcard
  if (grantedPermissions.includes('*')) return true
  // Exact match
  if (grantedPermissions.includes(required)) return true
  // Domain wildcard (e.g. "calls:*" matches "calls:answer")
  const domain = required.split(':')[0]
  if (grantedPermissions.includes(`${domain}:*`)) return true

  // Scope hierarchy: -all subsumes -assigned subsumes -own
  const scopeMatch = required.match(/^(.+)-(own|assigned|all)$/)
  if (scopeMatch) {
    const [, base, requiredScope] = scopeMatch
    const requiredLevel = SCOPE_LEVELS[requiredScope]
    if (requiredLevel === undefined) return false
    for (const granted of grantedPermissions) {
      const grantedMatch = granted.match(/^(.+)-(own|assigned|all)$/)
      if (grantedMatch && grantedMatch[1] === base) {
        const grantedLevel = SCOPE_LEVELS[grantedMatch[2]]
        if (grantedLevel !== undefined && grantedLevel >= requiredLevel) return true
      }
    }
  }

  return false
}

/** Scope levels in ascending order of access breadth */
export type ScopeLevel = 'own' | 'assigned' | 'all'

const SCOPE_LEVEL_ORDER: ScopeLevel[] = ['own', 'assigned', 'all']

/**
 * Get the effective (highest) scope level a user has for a given domain + action.
 *
 * Example: getEffectiveScope(['contacts:read-assigned', 'contacts:read-own'], 'contacts', 'read')
 *   → 'assigned' (because assigned subsumes own)
 *
 * Returns null if no scope permission is granted for that domain:action.
 */
export function getEffectiveScope(
  permissions: string[],
  domain: string,
  action: string
): ScopeLevel | null {
  // Global or domain wildcard → all
  if (permissions.includes('*') || permissions.includes(`${domain}:*`)) return 'all'

  let highest = -1
  const prefix = `${domain}:${action}`

  for (const perm of permissions) {
    const match = perm.match(/^(.+)-(own|assigned|all)$/)
    if (match && match[1] === prefix) {
      const level = SCOPE_LEVELS[match[2]]
      if (level !== undefined && level > highest) {
        highest = level
      }
    }
  }

  return highest >= 0 ? SCOPE_LEVEL_ORDER[highest] : null
}

/**
 * Resolve effective permissions from multiple role IDs.
 * Returns the union of all permissions from all roles.
 */
export function resolvePermissions(roleIds: string[], roles: Role[]): string[] {
  const perms = new Set<string>()
  for (const roleId of roleIds) {
    const role = roles.find((r) => r.id === roleId)
    if (role) {
      for (const p of role.permissions) perms.add(p)
    }
  }
  return Array.from(perms)
}

/**
 * Check if a user with given role IDs has a specific permission.
 */
export function hasPermission(roleIds: string[], roles: Role[], permission: string): boolean {
  const perms = resolvePermissions(roleIds, roles)
  return permissionGranted(perms, permission)
}

/**
 * Get the "primary" role for display purposes — the highest-privilege role.
 * Order: super-admin > hub-admin > case-manager > reviewer > volunteer > reporter > custom
 */
const ROLE_PRIORITY: Record<string, number> = {
  'role-super-admin': 0,
  'role-hub-admin': 1,
  'role-case-manager': 2,
  'role-reviewer': 3,
  'role-volunteer': 4,
  'role-reporter': 5,
}

export function getPrimaryRole(roleIds: string[], roles: Role[]): Role | undefined {
  const userRoles = roleIds
    .map((id) => roles.find((r) => r.id === id))
    .filter((r): r is Role => !!r)
    .sort((a, b) => {
      const pa = ROLE_PRIORITY[a.id] ?? 99
      const pb = ROLE_PRIORITY[b.id] ?? 99
      return pa - pb
    })
  return userRoles[0]
}

// --- Hub-Scoped Permission Resolution ---

/**
 * Check if a user has a specific permission within a hub.
 * Super-admin (global '*' permission) bypasses hub checks.
 * Otherwise, checks hub-specific role assignments.
 */
function _hasHubPermission(
  globalRoles: string[],
  hubRoles: { hubId: string; roleIds: string[] }[],
  allRoleDefs: Role[],
  hubId: string,
  permission: string
): boolean {
  // Super-admin bypasses all hub checks
  const globalPerms = resolvePermissions(globalRoles, allRoleDefs)
  if (permissionGranted(globalPerms, permission)) return true

  // Check hub-specific roles
  const assignment = hubRoles.find((hr) => hr.hubId === hubId)
  if (!assignment) return false

  const hubPerms = resolvePermissions(assignment.roleIds, allRoleDefs)
  return permissionGranted(hubPerms, permission)
}

/**
 * Resolve all effective permissions for a user within a specific hub.
 * Includes global permissions (from globalRoles) plus hub-specific permissions.
 */
export function resolveHubPermissions(
  globalRoles: string[],
  hubRoles: { hubId: string; roleIds: string[] }[],
  allRoleDefs: Role[],
  hubId: string
): string[] {
  const perms = new Set<string>()
  // Global permissions always apply
  for (const p of resolvePermissions(globalRoles, allRoleDefs)) {
    perms.add(p)
  }
  // Hub-specific permissions
  const assignment = hubRoles.find((hr) => hr.hubId === hubId)
  if (assignment) {
    for (const p of resolvePermissions(assignment.roleIds, allRoleDefs)) {
      perms.add(p)
    }
  }
  return Array.from(perms)
}

/**
 * Get all hub IDs a user has access to (any role assignment).
 * Super-admin has access to all hubs (returns null = all).
 */
function _getUserHubIds(
  globalRoles: string[],
  hubRoles: { hubId: string; roleIds: string[] }[],
  allRoleDefs: Role[]
): string[] | null {
  const globalPerms = resolvePermissions(globalRoles, allRoleDefs)
  if (permissionGranted(globalPerms, '*')) return null // all hubs
  return hubRoles.map((hr) => hr.hubId)
}

// --- Channel Permission Helpers ---

/** Map of channel types to their claim permission */
const CHANNEL_CLAIM_PERMISSIONS: Record<string, string> = {
  sms: 'conversations:claim-sms',
  whatsapp: 'conversations:claim-whatsapp',
  signal: 'conversations:claim-signal',
  rcs: 'conversations:claim-rcs',
  web: 'conversations:claim-web',
}

/**
 * Check if a user can claim conversations on a specific channel.
 * Returns true if user has:
 * - Global wildcard (*)
 * - conversations:* wildcard
 * - conversations:claim-any (bypass channel restrictions)
 * - The specific channel claim permission (e.g., conversations:claim-sms)
 */
export function canClaimChannel(permissions: string[], channelType: string): boolean {
  // Global or domain wildcard
  if (permissionGranted(permissions, 'conversations:claim-any')) return true

  // Check specific channel permission
  const channelPerm = CHANNEL_CLAIM_PERMISSIONS[channelType]
  if (channelPerm && permissionGranted(permissions, channelPerm)) return true

  return false
}

/**
 * Get the list of channels a user can claim based on their permissions.
 */
export function getClaimableChannels(permissions: string[]): string[] {
  // If has claim-any, return all channels
  if (permissionGranted(permissions, 'conversations:claim-any')) {
    return Object.keys(CHANNEL_CLAIM_PERMISSIONS)
  }

  // Filter to channels they have specific permissions for
  return Object.entries(CHANNEL_CLAIM_PERMISSIONS)
    .filter(([, perm]) => permissionGranted(permissions, perm))
    .map(([channel]) => channel)
}
