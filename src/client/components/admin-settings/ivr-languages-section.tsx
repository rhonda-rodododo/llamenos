import { useTranslation } from 'react-i18next'
import { useToast } from '@/lib/toast'
import { updateIvrLanguages } from '@/lib/api'
import { SettingsSection } from '@/components/settings-section'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Phone } from 'lucide-react'
import { IVR_LANGUAGES, LANGUAGE_MAP, ivrIndexToDigit } from '@shared/languages'

interface Props {
  enabled: string[]
  onChange: (enabled: string[]) => void
  expanded: boolean
  onToggle: (open: boolean) => void
}

export function IvrLanguagesSection({ enabled, onChange, expanded, onToggle }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()

  return (
    <SettingsSection
      id="ivr-languages"
      title={t('ivr.title')}
      description={t('ivr.description')}
      icon={<Phone className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded}
      onToggle={onToggle}
      basePath="/admin/settings"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {IVR_LANGUAGES.map((code, index) => {
          const lang = LANGUAGE_MAP[code]
          if (!lang) return null
          const isEnabled = enabled.includes(code)
          const isLastEnabled = isEnabled && enabled.length === 1
          return (
            <div key={code} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-mono">
                  {ivrIndexToDigit(index)}
                </Badge>
                <span className="text-sm">{lang.label}</span>
              </div>
              <Switch
                checked={isEnabled}
                disabled={isLastEnabled}
                onCheckedChange={async (checked) => {
                  const next = checked
                    ? [...enabled, code]
                    : enabled.filter(c => c !== code)
                  try {
                    const res = await updateIvrLanguages({ enabledLanguages: next })
                    onChange(res.enabledLanguages)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
              />
            </div>
          )
        })}
      </div>
      {enabled.length === 1 && (
        <p className="text-xs text-muted-foreground">{t('ivr.atLeastOne')}</p>
      )}
    </SettingsSection>
  )
}
