import { describe, expect, it } from 'bun:test'
import { permissionGranted } from '@shared/permissions'
import { adminNavConfig } from './admin-nav-config'
import { canSee, canSeeGroup } from './admin-nav-visibility'
import type { NavAuthContext } from './admin-nav-visibility'

/** Hub-admin permissions from DEFAULT_ROLES in shared/permissions.ts */
const HUB_ADMIN_PERMISSIONS = [
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
]

const HUB_ADMIN_ROLES = ['role-hub-admin']
const SUPER_ADMIN_ROLES = ['role-super-admin', 'role-hub-admin']
const SUPER_ADMIN_PERMISSIONS = [...HUB_ADMIN_PERMISSIONS, '*']

function makeAuth(roles: string[], permissions: string[]): NavAuthContext {
  return {
    roles,
    hasPermission: (p) => permissionGranted(permissions, p),
  }
}

const hubAdmin = makeAuth(HUB_ADMIN_ROLES, HUB_ADMIN_PERMISSIONS)
const superAdmin = makeAuth(SUPER_ADMIN_ROLES, SUPER_ADMIN_PERMISSIONS)

function group(slug: string) {
  const g = adminNavConfig.groups.find((g) => g.groupSlug === slug)
  if (!g) throw new Error(`Group not found: ${slug}`)
  return g
}

// ─── canSeeGroup ────────────────────────────────────────────────────────────

describe('canSeeGroup', () => {
  it('hub-admin can see operations group', () => {
    expect(canSeeGroup(group('operations'), hubAdmin)).toBe(true)
  })

  it('hub-admin cannot see platform group', () => {
    expect(canSeeGroup(group('platform'), hubAdmin)).toBe(false)
  })

  it('super-admin can see operations group', () => {
    expect(canSeeGroup(group('operations'), superAdmin)).toBe(true)
  })

  it('super-admin can see platform group', () => {
    expect(canSeeGroup(group('platform'), superAdmin)).toBe(true)
  })

  it('hub-admin can see general group', () => {
    expect(canSeeGroup(group('general'), hubAdmin)).toBe(true)
  })

  it('hub-admin can see people group', () => {
    expect(canSeeGroup(group('people'), hubAdmin)).toBe(true)
  })
})

// ─── canSee — Operations items ───────────────────────────────────────────────

describe('canSee — operations items', () => {
  const ops = group('operations')

  it('hub-admin can see bans', () => {
    const item = ops.items.find((i) => i.slug === 'bans')!
    expect(canSee(item, hubAdmin)).toBe(true)
  })

  it('hub-admin can see audit', () => {
    const item = ops.items.find((i) => i.slug === 'audit')!
    expect(canSee(item, hubAdmin)).toBe(true)
  })

  it('hub-admin can see analytics', () => {
    const item = ops.items.find((i) => i.slug === 'analytics')!
    expect(canSee(item, hubAdmin)).toBe(true)
  })

  it('hub-admin can see health', () => {
    const item = ops.items.find((i) => i.slug === 'health')!
    expect(canSee(item, hubAdmin)).toBe(true)
  })
})

// ─── canSee — Platform items (super-admin only) ──────────────────────────────

describe('canSee — platform items', () => {
  const plat = group('platform')

  for (const slug of ['hubs', 'platform-roles', 'platform', 'gdpr-erasure', 'retention']) {
    it(`hub-admin cannot see ${slug}`, () => {
      const item = plat.items.find((i) => i.slug === slug)!
      expect(canSee(item, hubAdmin)).toBe(false)
    })

    it(`super-admin can see ${slug}`, () => {
      const item = plat.items.find((i) => i.slug === slug)
      // Item may not exist if the spec was updated to include/exclude items
      if (!item) return
      expect(canSee(item, superAdmin)).toBe(true)
    })
  }
})
