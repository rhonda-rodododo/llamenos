import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * Legacy redirect route. The old flat-collapsible admin settings page lived
 * here; it has been replaced by the vertical-nav shell under `/admin/$section`.
 * Translates both old URL shapes:
 *   - `/admin/settings#<anchor>` (hash deeplink from in-app buttons)
 *   - `/admin/settings?section=<name>` (query-string deeplink used in E2E tests)
 * to the new `/admin/<slug>` routes, renaming acronyms where needed.
 * Hub-level "roles" maps to `hub-roles` (platform roles live at `/admin/platform-roles`).
 */
const LEGACY_SLUG_MAP: Record<string, string> = {
  geocoding: 'location-lookup',
  'telephony-provider': 'phone-provider',
  'ivr-languages': 'phone-menu-languages',
  channels: 'messaging-sms',
  // Hub-scoped roles renamed to disambiguate from platform roles
  roles: 'hub-roles',
  // Identity rename (section kept same slug everywhere else):
  // spam → spam-protection (old hash anchor used the short form)
  spam: 'spam-protection',
}

export const Route = createFileRoute('/admin/settings')({
  component: LegacySettingsRedirect,
})

function LegacySettingsRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    // Try hash first, then ?section= query param
    const hash = window.location.hash.replace('#', '')
    const search = new URLSearchParams(window.location.search)
    const raw = hash || search.get('section') || ''
    if (raw) {
      const slug = LEGACY_SLUG_MAP[raw] ?? raw
      void navigate({ to: '/admin/$section', params: { section: slug }, replace: true })
    } else {
      // No deeplink — fall through to the /admin index which picks the
      // first accessible section for this user.
      void navigate({ to: '/admin', replace: true })
    }
  }, [navigate])
  return null
}
