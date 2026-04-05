import { adminNavConfig } from '@/components/admin-shell/admin-nav-config'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/')({
  beforeLoad: () => {
    // Redirect to first item in the first non-empty group.
    const firstItem = adminNavConfig.groups.flatMap((g) => g.items)[0]
    if (firstItem) {
      throw redirect({ to: '/admin/$section', params: { section: firstItem.slug } })
    }
  },
  component: () => null,
})
