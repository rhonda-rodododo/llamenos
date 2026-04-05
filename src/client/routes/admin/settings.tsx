import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * Legacy redirect route. The old flat-collapsible admin settings page lived
 * here; it has been replaced by the vertical-nav shell under `/admin/$section`.
 * Any incoming `/admin/settings#<anchor>` deeplinks get mapped to the
 * matching new slug.
 */
const LEGACY_ANCHOR_MAP: Record<string, string> = {
  geocoding: 'location-lookup',
  'telephony-provider': 'phone-provider',
  'ivr-languages': 'phone-menu-languages',
  channels: 'messaging-sms',
}

export const Route = createFileRoute('/admin/settings')({
  component: LegacySettingsRedirect,
})

function LegacySettingsRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    const anchor = window.location.hash.replace('#', '')
    if (anchor) {
      const slug = LEGACY_ANCHOR_MAP[anchor] ?? anchor
      void navigate({ to: '/admin/$section', params: { section: slug }, replace: true })
    } else {
      // No anchor — fall through to the /admin index which picks the first
      // accessible section for this user.
      void navigate({ to: '/admin', replace: true })
    }
  }, [navigate])
  return null
}
