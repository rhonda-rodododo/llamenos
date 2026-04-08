import { SectionBody, SectionDescription } from '@/components/admin-shell/section-layout'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { updateIvrLanguages } from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { ivrLanguagesOptions } from '@/lib/queries/settings'
import { useToast } from '@/lib/toast'
// Shared constants retain their legacy names (code-level) but UI labels use "Phone Menu" terminology.
import { IVR_LANGUAGES, LANGUAGE_MAP, ivrIndexToDigit } from '@shared/languages'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function PhoneMenuLanguagesSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: enabled = [], isLoading } = useQuery(ivrLanguagesOptions())
  const [showSaved, setShowSaved] = useState(false)

  const saveMutation = useMutation({
    mutationFn: (enabledLanguages: string[]) => updateIvrLanguages({ enabledLanguages }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.settings.ivrLanguages(), res.enabledLanguages)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.ivrLanguages() })
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  if (isLoading) return null

  return (
    <SectionBody className="space-y-4">
      <SectionDescription>{t('phoneMenuLanguages.description')}</SectionDescription>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {IVR_LANGUAGES.map((code, index) => {
          const lang = LANGUAGE_MAP[code]
          if (!lang) return null
          const isEnabled = enabled.includes(code)
          const isLastEnabled = isEnabled && enabled.length === 1
          return (
            <div
              key={code}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-mono">
                  {ivrIndexToDigit(index)}
                </Badge>
                <span className="text-sm">{lang.label}</span>
              </div>
              <Switch
                data-testid={`admin-phone-menu-languages-toggle-${code}`}
                checked={isEnabled}
                disabled={isLastEnabled || saveMutation.isPending}
                onCheckedChange={(checked) => {
                  const next = checked ? [...enabled, code] : enabled.filter((c) => c !== code)
                  saveMutation.mutate(next)
                }}
              />
            </div>
          )
        })}
      </div>
      {enabled.length === 1 && (
        <p className="text-xs text-muted-foreground">{t('phoneMenuLanguages.atLeastOne')}</p>
      )}

      {showSaved && (
        <span
          data-testid="admin-phone-menu-languages-save-success"
          className="text-sm text-green-600"
        >
          {t('common.success')}
        </span>
      )}
    </SectionBody>
  )
}
