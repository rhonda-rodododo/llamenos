import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  /** Section slug (for testid prefix). */
  sectionSlug: string
  children: ReactNode
}

export function AdvancedReveal({ sectionSlug, children }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-6 border-t pt-4">
      <CollapsibleTrigger
        data-testid={`admin-advanced-reveal-${sectionSlug}`}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? t('common.hideAdvanced') : t('common.showAdvanced')}
      </CollapsibleTrigger>
      <CollapsibleContent
        data-testid={`admin-advanced-panel-${sectionSlug}`}
        className="mt-4 space-y-4"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
