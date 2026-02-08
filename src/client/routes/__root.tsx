import { createRootRoute, Outlet, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect } from 'react'
import { connectWebSocket, disconnectWebSocket } from '@/lib/ws'
import { setLanguage } from '@/lib/i18n'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { t, i18n } = useTranslation()
  const { isAuthenticated, isAdmin, signOut, name, isLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isAuthenticated) {
      connectWebSocket()
      return () => disconnectWebSocket()
    }
  }, [isAuthenticated])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Outlet />
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="flex w-64 flex-col border-r border-border bg-sidebar p-4">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-sidebar-foreground">{t('common.appName')}</h1>
          {name && <p className="mt-1 text-sm text-muted-foreground">{name}</p>}
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <NavLink to="/">{t('nav.dashboard')}</NavLink>
          <NavLink to="/notes">{t('nav.notes')}</NavLink>

          {isAdmin && (
            <>
              <div className="my-3 border-t border-border" />
              <NavLink to="/shifts">{t('nav.shifts')}</NavLink>
              <NavLink to="/volunteers">{t('nav.volunteers')}</NavLink>
              <NavLink to="/bans">{t('nav.banList')}</NavLink>
              <NavLink to="/audit">{t('nav.auditLog')}</NavLink>
              <NavLink to="/settings">{t('nav.settings')}</NavLink>
            </>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          <div className="flex gap-1">
            <button
              onClick={() => setLanguage('en')}
              className={`rounded px-2 py-1 text-xs ${i18n.language === 'en' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              EN
            </button>
            <button
              onClick={() => setLanguage('es')}
              className={`rounded px-2 py-1 text-xs ${i18n.language === 'es' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              ES
            </button>
          </div>
          <button
            onClick={() => {
              signOut()
              navigate({ to: '/login' })
            }}
            className="rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {t('common.logout')}
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
      activeProps={{ className: 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' }}
    >
      {children}
    </Link>
  )
}
