import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Link as LinkIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface SettingsSectionProps {
  id: string
  title: string
  description?: string
  icon: ReactNode
  expanded: boolean
  onToggle: (open: boolean) => void
  children: ReactNode
}

export function SettingsSection({
  id,
  title,
  description,
  icon,
  expanded,
  onToggle,
  children,
}: SettingsSectionProps) {
  const { t } = useTranslation()
  const { toast } = useToast()

  function handleCopyLink(e: React.MouseEvent) {
    e.stopPropagation()
    const url = `${window.location.origin}/settings?section=${id}`
    navigator.clipboard.writeText(url).then(() => {
      toast(t('settings.linkCopied'), 'success')
      // Auto-clear clipboard after 30s (security pattern)
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {})
      }, 30_000)
    }).catch(() => {})
  }

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <Card id={id}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none transition-colors hover:bg-muted/50">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {icon}
                {title}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={handleCopyLink}
                  aria-label={t('settings.copyLink')}
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                </Button>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform duration-200',
                    expanded && 'rotate-180'
                  )}
                />
              </div>
            </div>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <CardContent className="space-y-4">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
