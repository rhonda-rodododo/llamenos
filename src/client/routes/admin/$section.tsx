import { createFileRoute, notFound } from '@tanstack/react-router'
import { getSectionComponent } from '@/components/admin-sections/registry'
import { findNavItem } from '@/components/admin-shell/admin-nav-config'
import { AdminShell } from '@/components/admin-shell/admin-shell'

export const Route = createFileRoute('/admin/$section')({
  component: AdminSectionRoute,
})

function AdminSectionRoute() {
  const { section } = Route.useParams()
  const navItem = findNavItem(section)
  if (!navItem) throw notFound()
  const SectionComponent = getSectionComponent(section)
  if (!SectionComponent) throw notFound()
  return (
    <AdminShell currentSlug={section} currentLabelKey={navItem.labelKey}>
      <SectionComponent />
    </AdminShell>
  )
}
