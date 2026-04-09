import { useAuth } from '@/lib/auth'
import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/admin')({
  component: AdminRoute,
})

/**
 * Admin layout route guard.
 *
 * Previously used render-time `<Navigate to="/" />` to avoid a delay in
 * reload-based E2E tests. Under React 18 concurrent rendering that
 * approach can leave a stale pending navigation in TanStack Router's
 * internal queue if AdminRoute re-renders before the navigation commits
 * (auth state going `isLoading → resolved`, permissions arriving from
 * /api/auth/me, etc.) — the symptom is React error #185 ("Maximum
 * update depth exceeded") fired from `Router.load` inside a Set.forEach,
 * followed by the page stalling on the RootLayout loading spinner.
 *
 * Using a useEffect-scheduled imperative navigate avoids the loop
 * entirely: the navigate call fires once per mount, from a committed
 * render, so the router never sees duplicate queued redirects. The
 * reload-based tests are unaffected because the redirect still fires
 * on the very next microtask after auth state resolves.
 */
function AdminRoute() {
  const auth = useAuth()
  const navigate = useNavigate()
  const notAdmin = !auth.isLoading && !auth.isAdmin && !auth.roles.includes('role-super-admin')

  useEffect(() => {
    if (notAdmin) {
      void navigate({ to: '/' })
    }
  }, [notAdmin, navigate])

  if (auth.isLoading) return null
  if (notAdmin) return null

  return <Outlet />
}
