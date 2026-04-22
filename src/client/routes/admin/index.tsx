import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { adminNavConfig } from '@/components/admin-shell/admin-nav-config'
import { useAuth } from '@/lib/auth'

export const Route = createFileRoute('/admin/')({
  component: AdminIndex,
})

/**
 * Redirects the bare `/admin` URL to the first nav item the current user
 * can actually access. Runs client-side (not beforeLoad) because permission
 * filtering needs `useAuth` which isn't in the router context.
 */
function AdminIndex() {
  const navigate = useNavigate()
  const auth = useAuth()

  useEffect(() => {
    if (auth.isLoading) return

    const canSee = (requiredPermissions: string[], requiredRole?: string): boolean => {
      if (requiredRole && !auth.roles.includes(requiredRole)) return false
      if (requiredPermissions.length === 0) return true
      return requiredPermissions.every((p) => auth.hasPermission(p))
    }

    // Walk groups in config order, pick the first item whose permissions the
    // user satisfies. Fall back to 'hubs' (super-admin) if no this-hub items
    // are accessible.
    for (const group of adminNavConfig.groups) {
      if (group.scope === 'platform' && !auth.roles.includes('role-super-admin')) continue
      for (const item of group.items) {
        if (canSee(item.requiredPermissions, item.requiredRole)) {
          void navigate({
            to: '/admin/$section',
            params: { section: item.slug },
            replace: true,
          })
          return
        }
      }
    }
  }, [auth.isLoading, auth.roles, auth.hasPermission, navigate])

  return null
}
