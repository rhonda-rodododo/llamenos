import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Menu } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminSidebar } from './admin-sidebar'

interface Props {
  currentSlug?: string
  currentLabelKey?: string
  children: ReactNode
}

export function AdminShell({ currentSlug, currentLabelKey, children }: Props) {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div data-testid="admin-shell" className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r lg:block">
        <AdminSidebar />
      </aside>

      {/* Mobile sheet (controlled; trigger is a plain Button outside) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" data-testid="admin-sidebar-drawer" className="w-72 p-0">
          <AdminSidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main pane */}
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            data-testid="admin-sidebar-toggle"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t('adminNav.openMenu')}
            aria-expanded={mobileOpen}
            aria-controls="admin-sidebar-drawer"
          >
            <Menu className="h-5 w-5" />
          </Button>
          {currentLabelKey && (
            <h1 data-testid="admin-section-heading" className="text-base font-semibold lg:text-lg">
              {t(currentLabelKey)}
            </h1>
          )}
        </header>
        <div
          data-testid="admin-section"
          data-section={currentSlug ?? ''}
          className="px-4 py-6 lg:px-8"
        >
          {children}
        </div>
      </main>
    </div>
  )
}
