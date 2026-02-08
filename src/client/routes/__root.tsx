import { createRootRoute, Outlet, Link, useNavigate, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, type ReactNode } from 'react'
import { connectWebSocket, disconnectWebSocket } from '@/lib/ws'
import { setLanguage } from '@/lib/i18n'
import { LANGUAGES } from '@shared/languages'
import {
  LayoutDashboard,
  StickyNote,
  Clock,
  Users,
  ShieldBan,
  PhoneIncoming,
  ScrollText,
  Settings,
  LogOut,
  Globe,
  Phone,
} from 'lucide-react'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { t, i18n } = useTranslation()
  const { isAuthenticated, isAdmin, signOut, name, role, isLoading, profileCompleted } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (isAuthenticated) {
      connectWebSocket()
      return () => disconnectWebSocket()
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isLoading && !isAuthenticated && location.pathname !== '/login') {
      navigate({ to: '/login' })
    }
  }, [isLoading, isAuthenticated, location.pathname, navigate])

  useEffect(() => {
    if (!isLoading && isAuthenticated && location.pathname === '/login') {
      navigate({ to: profileCompleted ? '/' : '/profile-setup' })
    }
  }, [isLoading, isAuthenticated, location.pathname, navigate, profileCompleted])

  // Redirect to profile setup if not completed
  useEffect(() => {
    if (!isLoading && isAuthenticated && !profileCompleted && location.pathname !== '/profile-setup' && location.pathname !== '/login') {
      navigate({ to: '/profile-setup' })
    }
  }, [isLoading, isAuthenticated, profileCompleted, location.pathname, navigate])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Phone className="h-5 w-5 animate-pulse" />
          {t('common.loading')}
        </div>
      </div>
    )
  }

  if (!isAuthenticated || !profileCompleted) {
    return <Outlet />
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="flex w-64 flex-col border-r border-border bg-sidebar">
        <div className="border-b border-border px-4 py-5">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-sidebar-foreground">{t('common.appName')}</h1>
          </div>
          {name && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-medium text-primary">
                {name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-sidebar-foreground">{name}</p>
                <p className="text-xs text-muted-foreground capitalize">{role}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-0.5 p-3">
          <NavLink to="/" icon={<LayoutDashboard className="h-4 w-4" />}>{t('nav.dashboard')}</NavLink>
          <NavLink to="/notes" icon={<StickyNote className="h-4 w-4" />}>{t('nav.notes')}</NavLink>
          {!isAdmin && (
            <NavLink to="/settings" icon={<Settings className="h-4 w-4" />}>{t('nav.settings')}</NavLink>
          )}

          {isAdmin && (
            <>
              <div className="my-2 border-t border-border" />
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('nav.admin', { defaultValue: 'Admin' })}
              </p>
              <NavLink to="/shifts" icon={<Clock className="h-4 w-4" />}>{t('nav.shifts')}</NavLink>
              <NavLink to="/volunteers" icon={<Users className="h-4 w-4" />}>{t('nav.volunteers')}</NavLink>
              <NavLink to="/bans" icon={<ShieldBan className="h-4 w-4" />}>{t('nav.banList')}</NavLink>
              <NavLink to="/calls" icon={<PhoneIncoming className="h-4 w-4" />}>{t('nav.callHistory')}</NavLink>
              <NavLink to="/audit" icon={<ScrollText className="h-4 w-4" />}>{t('nav.auditLog')}</NavLink>
              <NavLink to="/settings" icon={<Settings className="h-4 w-4" />}>{t('nav.settings')}</NavLink>
            </>
          )}
        </div>

        <div className="border-t border-border p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex flex-wrap gap-0.5">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => setLanguage(lang.code)}
                  className={`rounded px-1.5 py-0.5 text-xs transition-colors ${i18n.language === lang.code ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  title={lang.label}
                >
                  {lang.flag}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              signOut()
              navigate({ to: '/login' })
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            {t('common.logout')}
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-background p-6">
        <Outlet />
      </main>
    </div>
  )
}

function NavLink({ to, children, icon }: { to: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      activeProps={{ className: 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' }}
    >
      {icon && <span className="text-muted-foreground">{icon}</span>}
      {children}
    </Link>
  )
}
