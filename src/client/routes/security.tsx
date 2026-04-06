import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/security')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/security') {
      throw redirect({ to: '/security/sessions' })
    }
  },
  component: SecurityLayout,
})

function SecurityLayout() {
  const { t } = useTranslation()
  return (
    <div className="container mx-auto max-w-5xl p-4">
      <h1 className="text-2xl font-bold mb-4">{t('security.title', 'Security')}</h1>
      <nav className="flex gap-4 border-b mb-4" data-testid="security-tabs">
        <Link
          to="/security/sessions"
          className="px-3 py-2 [&.active]:border-b-2 [&.active]:border-primary"
          data-testid="tab-sessions"
        >
          {t('security.tabs.sessions', 'Active sessions')}
        </Link>
        <Link
          to="/security/passkeys"
          className="px-3 py-2 [&.active]:border-b-2 [&.active]:border-primary"
          data-testid="tab-passkeys"
        >
          {t('security.tabs.passkeys', 'Passkeys')}
        </Link>
        <Link
          to="/security/history"
          className="px-3 py-2 [&.active]:border-b-2 [&.active]:border-primary"
          data-testid="tab-history"
        >
          {t('security.tabs.history', 'History')}
        </Link>
        <Link
          to="/security/factors"
          className="px-3 py-2 [&.active]:border-b-2 [&.active]:border-primary"
          data-testid="tab-factors"
        >
          {t('security.tabs.factors', 'Factors')}
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
