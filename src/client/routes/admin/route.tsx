import { useAuth } from '@/lib/auth'
import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/admin')({
  component: AdminRoute,
})

function AdminRoute() {
  const auth = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (auth.isLoading) return
    if (!auth.isAdmin && !auth.roles.includes('role-super-admin')) {
      void navigate({ to: '/' })
    }
  }, [auth.isLoading, auth.isAdmin, auth.roles, navigate])

  if (auth.isLoading) return null
  if (!auth.isAdmin && !auth.roles.includes('role-super-admin')) return null

  return <Outlet />
}
