import { useAuth } from '@/lib/auth'
import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

// Old section anchors that got renamed. Direct renames that keep the same
// slug (roles, teams, tags, custom-fields, report-types, firehose,
// call-settings, voice-prompts, transcription, spam-protection, rcs, signal,
// passkey-policy) are not listed — they just work.
const LEGACY_ANCHOR_MAP: Record<string, string> = {
  geocoding: 'location-lookup',
  'telephony-provider': 'phone-provider',
  'ivr-languages': 'phone-menu-languages',
  channels: 'messaging-sms',
}

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

  useEffect(() => {
    const { pathname, hash } = window.location
    if (pathname !== '/admin/settings' && pathname !== '/admin/hubs') return
    const anchor = hash.replace('#', '')
    const slug = LEGACY_ANCHOR_MAP[anchor] ?? anchor
    if (slug) {
      void navigate({ to: '/admin/$section', params: { section: slug }, replace: true })
    }
  }, [navigate])

  if (auth.isLoading) return null
  if (!auth.isAdmin && !auth.roles.includes('role-super-admin')) return null

  return <Outlet />
}
