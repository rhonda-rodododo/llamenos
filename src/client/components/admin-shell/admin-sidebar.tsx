import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { adminNavConfig } from './admin-nav-config'
import type { AdminNavGroup, AdminNavItem } from './admin-nav-config.types'

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
