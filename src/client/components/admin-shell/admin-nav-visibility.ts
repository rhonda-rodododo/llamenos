import type { AdminNavGroup, AdminNavItem } from './admin-nav-config.types'

export interface NavAuthContext {
  roles: string[]
  hasPermission: (permission: string) => boolean
}

/** Returns true if the user can see the given nav item. */
export function canSee(item: AdminNavItem, auth: NavAuthContext): boolean {
  if (item.requiredRole && !auth.roles.includes(item.requiredRole)) return false
  if (item.requiredPermissions.length === 0) return true
  return item.requiredPermissions.every((p) => auth.hasPermission(p))
}

/** Returns true if the user can see at least one item in the group. */
export function canSeeGroup(group: AdminNavGroup, auth: NavAuthContext): boolean {
  return group.items.some((item) => canSee(item, auth))
}
