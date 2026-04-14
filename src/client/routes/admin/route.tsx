import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { useAuditChainIntegrity } from '@/lib/queries/audit'
import { useToast } from '@/lib/toast'
import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

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
 * render, so the router never sees duplicate queued redirects.
 *
 * Redirect target depends on auth state: unauthenticated users go
 * straight to `/login` instead of bouncing through `/` first. The
 * previous single-target redirect forced a double-hop (`/admin` →
 * `/` → RootLayout useEffect → `/login`) that compounded the CI-load
 * delay beyond the 60s ceiling the auth-guards E2E suite allows.
 */
function AdminRoute() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { currentHubId } = useConfig()
  const { t } = useTranslation()
  const { toast } = useToast()
  const isSuperAdmin = auth.roles.includes('role-super-admin')
  const allowed = auth.isAdmin || isSuperAdmin

  // Tier 0 baseline verification: on successful admin bootstrap, walk the
  // signed audit chain once via the same hook the audit page uses. Results
  // are cached via React Query so the audit page hit is free afterwards. A
  // tampered/error result raises a toast so the admin cannot miss it even
  // if they never open the audit page.
  const chainIntegrity = useAuditChainIntegrity(allowed ? currentHubId : undefined)
  const baselineToastedRef = useRef(false)

  useEffect(() => {
    if (!allowed) return
    if (baselineToastedRef.current) return
    if (chainIntegrity.isLoading || chainIntegrity.isFetching) return

    if (chainIntegrity.isError) {
      baselineToastedRef.current = true
      toast(
        t('auditLog.chain.errorToast', {
          defaultValue: 'Could not verify audit chain: {{message}}',
          message: (chainIntegrity.error as Error).message,
        }),
        'error'
      )
      return
    }

    if (chainIntegrity.data?.state === 'tampered') {
      baselineToastedRef.current = true
      toast(
        t('auditLog.chain.tamperedToast', {
          defaultValue: 'Audit chain TAMPERED — {{code}}',
          code: chainIntegrity.data.error.code,
        }),
        'error'
      )
    }
  }, [
    allowed,
    chainIntegrity.isLoading,
    chainIntegrity.isFetching,
    chainIntegrity.isError,
    chainIntegrity.error,
    chainIntegrity.data,
    t,
    toast,
  ])

  useEffect(() => {
    if (auth.isLoading) return
    if (!auth.isAuthenticated) {
      void navigate({ to: '/login' })
    } else if (!allowed) {
      void navigate({ to: '/' })
    }
  }, [auth.isLoading, auth.isAuthenticated, allowed, navigate])

  if (auth.isLoading) return null
  if (!auth.isAuthenticated) return null
  if (!allowed) return null

  return <Outlet />
}
