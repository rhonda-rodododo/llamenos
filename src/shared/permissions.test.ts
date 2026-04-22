import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_ROLES,
  getEffectiveScope,
  getPermissionsByDomain,
  hasPermission,
  PERMISSION_CATALOG,
  PERMISSION_GROUP_LABELS,
  type Permission,
  type PermissionDomain,
  type PermissionMeta,
  type PermissionOrWildcard,
  permissionGranted,
  type WildcardPermission,
} from './permissions'

describe('typed permission catalog', () => {
  test('every permission has label, group, and subgroup', () => {
    for (const [_key, meta] of Object.entries(PERMISSION_CATALOG)) {
      expect(meta.label).toBeTruthy()
      expect(meta.group).toBeTruthy()
      expect(['scope', 'actions', 'tiers']).toContain(meta.subgroup)
    }
  })

  test('every group has a label', () => {
    const groups = new Set(Object.values(PERMISSION_CATALOG).map((m) => m.group))
    for (const group of groups) {
      expect(PERMISSION_GROUP_LABELS[group]).toBeTruthy()
    }
  })

  test('scope permissions follow naming convention', () => {
    for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
      if (meta.subgroup === 'scope') {
        expect(key).toMatch(/-(own|assigned|all)$/)
      }
    }
  })

  test('scope permissions have a scope field matching the suffix', () => {
    for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
      if (meta.subgroup === 'scope') {
        const suffix = key.match(/-(own|assigned|all)$/)?.[1] as 'own' | 'assigned' | 'all'
        expect((meta as PermissionMeta).scope).toBe(suffix)
      }
    }
  })

  test('tier permissions have a tier field', () => {
    for (const [_key, meta] of Object.entries(PERMISSION_CATALOG)) {
      if (meta.subgroup === 'tiers') {
        expect((meta as PermissionMeta).tier).toBeTruthy()
      }
    }
  })

  test('non-scope/non-tier permissions do NOT have scope or tier fields', () => {
    for (const [_key, meta] of Object.entries(PERMISSION_CATALOG)) {
      if (meta.subgroup === 'actions') {
        expect((meta as PermissionMeta).scope).toBeUndefined()
        expect((meta as PermissionMeta).tier).toBeUndefined()
      }
    }
  })

  test('Permission type includes all catalog keys', () => {
    const keys = Object.keys(PERMISSION_CATALOG) as Permission[]
    expect(keys.length).toBeGreaterThan(60)
  })
})

describe('scope hierarchy', () => {
  test('read-all subsumes read-assigned', () => {
    expect(permissionGranted(['contacts:read-all'], 'contacts:read-assigned')).toBe(true)
  })

  test('read-all subsumes read-own', () => {
    expect(permissionGranted(['contacts:read-all'], 'contacts:read-own')).toBe(true)
  })

  test('read-assigned subsumes read-own', () => {
    expect(permissionGranted(['contacts:read-assigned'], 'contacts:read-own')).toBe(true)
  })

  test('read-own does NOT subsume read-assigned', () => {
    expect(permissionGranted(['contacts:read-own'], 'contacts:read-assigned')).toBe(false)
  })

  test('read-own does NOT subsume read-all', () => {
    expect(permissionGranted(['contacts:read-own'], 'contacts:read-all')).toBe(false)
  })

  test('update-all subsumes update-own', () => {
    expect(permissionGranted(['notes:update-all'], 'notes:update-own')).toBe(true)
  })

  test('scope hierarchy works across domains independently', () => {
    expect(permissionGranted(['contacts:read-all'], 'notes:read-own')).toBe(false)
  })

  test('wildcard still works', () => {
    expect(permissionGranted(['*'], 'contacts:read-own')).toBe(true)
    expect(permissionGranted(['contacts:*'], 'contacts:read-own')).toBe(true)
  })

  test('non-scoped permissions unaffected', () => {
    expect(permissionGranted(['contacts:create'], 'contacts:create')).toBe(true)
    expect(permissionGranted(['contacts:create'], 'contacts:delete')).toBe(false)
  })
})

describe('getEffectiveScope()', () => {
  test('returns highest scope level from granted permissions', () => {
    expect(
      getEffectiveScope(['contacts:read-own', 'contacts:read-assigned'], 'contacts', 'read')
    ).toBe('assigned')
  })

  test('returns "all" when read-all is granted', () => {
    expect(getEffectiveScope(['contacts:read-all'], 'contacts', 'read')).toBe('all')
  })

  test('returns "own" when only read-own is granted', () => {
    expect(getEffectiveScope(['contacts:read-own'], 'contacts', 'read')).toBe('own')
  })

  test('returns null when no matching scope permission exists', () => {
    expect(getEffectiveScope(['contacts:create', 'notes:read-all'], 'contacts', 'read')).toBeNull()
  })

  test('handles domain wildcard as "all"', () => {
    expect(getEffectiveScope(['contacts:*'], 'contacts', 'read')).toBe('all')
  })

  test('handles global wildcard as "all"', () => {
    expect(getEffectiveScope(['*'], 'contacts', 'update')).toBe('all')
  })

  test('scopes are independent per action (read vs update)', () => {
    const perms = ['contacts:read-all', 'contacts:update-own']
    expect(getEffectiveScope(perms, 'contacts', 'read')).toBe('all')
    expect(getEffectiveScope(perms, 'contacts', 'update')).toBe('own')
  })

  test('scopes are independent per domain', () => {
    const perms = ['contacts:read-all', 'notes:read-own']
    expect(getEffectiveScope(perms, 'contacts', 'read')).toBe('all')
    expect(getEffectiveScope(perms, 'notes', 'read')).toBe('own')
  })

  test('returns null for empty permissions', () => {
    expect(getEffectiveScope([], 'contacts', 'read')).toBeNull()
  })

  test('files:download scope works correctly', () => {
    expect(getEffectiveScope(['files:download-assigned'], 'files', 'download')).toBe('assigned')
  })
})

describe('voicemail permissions', () => {
  test('voicemail:* permissions exist in catalog', () => {
    expect(PERMISSION_CATALOG['voicemail:listen']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:read']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:notify']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:delete']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:manage']).toBeDefined()
  })

  test('Hub Admin has voicemail:* wildcard', () => {
    const hubAdmin = DEFAULT_ROLES.find((r) => r.id === 'role-hub-admin')!
    // Cast to Role[] to satisfy hasPermission signature (createdAt/updatedAt optional in runtime)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasPermission([hubAdmin.id], DEFAULT_ROLES as any, 'voicemail:listen')).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasPermission([hubAdmin.id], DEFAULT_ROLES as any, 'voicemail:manage')).toBe(true)
  })

  test('User role has voicemail:read and calls:read-history', () => {
    const volunteerRole = DEFAULT_ROLES.find((r) => r.id === 'role-volunteer')!
    expect(volunteerRole.permissions).toContain('voicemail:read')
    expect(volunteerRole.permissions).toContain('calls:read-history')
    expect(volunteerRole.permissions).not.toContain('voicemail:listen')
  })

  test('Voicemail Reviewer role exists with correct permissions', () => {
    const reviewer = DEFAULT_ROLES.find((r) => r.id === 'role-voicemail-reviewer')!
    expect(reviewer).toBeDefined()
    expect(reviewer.permissions).toContain('voicemail:listen')
    expect(reviewer.permissions).toContain('voicemail:read')
    expect(reviewer.permissions).toContain('voicemail:notify')
    expect(reviewer.permissions).toContain('notes:read-all')
    expect(reviewer.permissions).toContain('calls:read-history')
    expect(reviewer.permissions).toContain('contacts:envelope-summary')
    expect(reviewer.permissions).toContain('contacts:read-assigned')
    expect(reviewer.permissions).not.toContain('contacts:read-summary')
  })
})

describe('case manager role', () => {
  test('Case Manager role exists in DEFAULT_ROLES', () => {
    const cm = DEFAULT_ROLES.find((r) => r.id === 'role-case-manager')
    expect(cm).toBeDefined()
    expect(cm?.isDefault).toBe(true)
    expect(cm?.isSystem).toBe(false)
  })

  test('Case Manager has expected permissions', () => {
    const cm = DEFAULT_ROLES.find((r) => r.id === 'role-case-manager')!
    expect(cm.permissions).toContain('contacts:read-assigned')
    expect(cm.permissions).toContain('contacts:update-assigned')
    expect(cm.permissions).toContain('contacts:envelope-summary')
    expect(cm.permissions).toContain('contacts:envelope-full')
    expect(cm.permissions).toContain('contacts:create')
    expect(cm.permissions).toContain('contacts:link')
    expect(cm.permissions).toContain('notes:read-all')
    expect(cm.permissions).toContain('notes:create')
    expect(cm.permissions).toContain('conversations:read-assigned')
    expect(cm.permissions).toContain('conversations:send')
    expect(cm.permissions).toContain('calls:read-history')
    expect(cm.permissions).toContain('files:upload')
    expect(cm.permissions).toContain('files:download-assigned')
    expect(cm.permissions).toContain('gdpr:consent')
    expect(cm.permissions).toContain('gdpr:export')
    expect(cm.permissions).toContain('gdpr:erase-self')
  })

  test('Case Manager does NOT have admin-level permissions', () => {
    const cm = DEFAULT_ROLES.find((r) => r.id === 'role-case-manager')!
    expect(cm.permissions).not.toContain('*')
    expect(cm.permissions).not.toContain('users:delete')
    expect(cm.permissions).not.toContain('settings:manage')
    expect(cm.permissions).not.toContain('contacts:delete')
    expect(cm.permissions).not.toContain('contacts:read-all')
  })
})

describe('getPermissionsByDomain()', () => {
  test('returns a record keyed by domain', () => {
    const byDomain = getPermissionsByDomain()
    expect(typeof byDomain).toBe('object')
    expect(Object.keys(byDomain).length).toBeGreaterThan(0)
  })

  test('every entry has key and meta with correct types', () => {
    const byDomain = getPermissionsByDomain()
    for (const [domain, entries] of Object.entries(byDomain)) {
      expect(entries.length).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(entry.key).toMatch(new RegExp(`^${domain}:`))
        expect(entry.meta).toHaveProperty('label')
        expect(entry.meta).toHaveProperty('group')
        expect(entry.meta).toHaveProperty('subgroup')
        expect(entry.meta.group).toBe(domain)
      }
    }
  })

  test('contacts domain includes scope, tiers, and actions subgroups', () => {
    const byDomain = getPermissionsByDomain()
    const contacts = byDomain.contacts
    expect(contacts).toBeDefined()
    const subgroups = new Set(contacts.map((e) => e.meta.subgroup))
    expect(subgroups.has('scope')).toBe(true)
    expect(subgroups.has('tiers')).toBe(true)
    expect(subgroups.has('actions')).toBe(true)
  })

  test('all catalog permissions are represented exactly once', () => {
    const byDomain = getPermissionsByDomain()
    const allKeys = Object.values(byDomain)
      .flat()
      .map((e) => e.key)
      .sort()
    const catalogKeys = (Object.keys(PERMISSION_CATALOG) as Permission[]).sort()
    expect(allKeys).toEqual(catalogKeys)
  })
})

describe('default role permission completeness', () => {
  test('every permission in every default role exists in PERMISSION_CATALOG or is a wildcard', () => {
    const catalogKeys = new Set(Object.keys(PERMISSION_CATALOG))
    const domains = new Set(Object.keys(PERMISSION_CATALOG).map((k) => k.split(':')[0]))

    for (const role of DEFAULT_ROLES) {
      for (const perm of role.permissions) {
        if (perm === '*') continue
        if (perm.endsWith(':*')) {
          // Domain wildcard — the domain must exist
          const domain = perm.replace(':*', '')
          expect(domains.has(domain)).toBe(true)
          continue
        }
        expect(catalogKeys.has(perm)).toBe(true)
      }
    }
  })

  test('no duplicate permissions within any default role', () => {
    for (const role of DEFAULT_ROLES) {
      const unique = new Set(role.permissions)
      expect(unique.size).toBe(role.permissions.length)
    }
  })
})

describe('wildcard types', () => {
  test('WildcardPermission accepts domain wildcards', () => {
    const w1: WildcardPermission = 'contacts:*'
    const w2: WildcardPermission = '*'
    const w3: WildcardPermission = 'notes:*'
    expect(w1).toBe('contacts:*')
    expect(w2).toBe('*')
    expect(w3).toBe('notes:*')
  })

  test('PermissionOrWildcard accepts both concrete and wildcard', () => {
    const p1: PermissionOrWildcard = 'contacts:create'
    const p2: PermissionOrWildcard = 'contacts:*'
    const p3: PermissionOrWildcard = '*'
    expect(p1).toBe('contacts:create')
    expect(p2).toBe('contacts:*')
    expect(p3).toBe('*')
  })

  test('PermissionDomain extracts all domains', () => {
    // This is a compile-time check — just verify it narrows correctly
    const domain: PermissionDomain = 'contacts'
    expect(domain).toBe('contacts')
  })
})

describe('volunteer role permission renames', () => {
  test('Volunteer has contacts:envelope-summary (renamed from contacts:read-summary)', () => {
    const vol = DEFAULT_ROLES.find((r) => r.id === 'role-volunteer')!
    expect(vol.permissions).toContain('contacts:envelope-summary')
    expect(vol.permissions).not.toContain('contacts:read-summary')
  })

  test('Volunteer has contacts:read-own', () => {
    const vol = DEFAULT_ROLES.find((r) => r.id === 'role-volunteer')!
    expect(vol.permissions).toContain('contacts:read-own')
  })

  test('Volunteer does not have contacts:envelope-full', () => {
    const volunteerRole = DEFAULT_ROLES.find((r) => r.id === 'role-volunteer')!
    expect(volunteerRole.permissions).not.toContain('contacts:envelope-full')
  })
})
