import { useAuth } from '@/lib/auth'
import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin')({
  component: AdminRoute,
})

/**
 * Admin layout route guard. Uses synchronous render-time checks only —
 * no useEffect navigate. This avoids an async redirect race that breaks
 * reload-based E2E tests (reenterPinAfterReload depends on the page
 * reaching /login promptly after a blocked-refresh reload).
 */
function AdminRoute() {
  const auth = useAuth()

  if (auth.isLoading) return null
  if (!auth.isAdmin && !auth.roles.includes('role-super-admin')) {
    return <Navigate to="/" />
  }

  return <Outlet />
}
