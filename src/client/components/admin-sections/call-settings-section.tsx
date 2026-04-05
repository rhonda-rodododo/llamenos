import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type CallSettings, getCallSettings, updateCallSettings } from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function CallSettingsSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: queryKeys.settings.call(),
    queryFn: getCallSettings,
  })
  const [showSaved, setShowSaved] = useState(false)

  const saveMutation = useMutation({
    mutationFn: (data: Partial<CallSettings>) => updateCallSettings(data),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings.call(), updated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.call() })
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  if (isLoading || !settings) return null

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('callSettings.description')}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>{t('callSettings.voicemailMode')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('callSettings.voicemailModeDescription')}
          </p>
          <Select
            value={settings.voicemailMode}
            onValueChange={(val) =>
              saveMutation.mutate({ voicemailMode: val as 'auto' | 'always' | 'never' })
            }
          >
            <SelectTrigger
              className="w-full"
              data-testid="admin-call-settings-voicemail-mode-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('callSettings.voicemailModeAuto')}</SelectItem>
              <SelectItem value="always">{t('callSettings.voicemailModeAlways')}</SelectItem>
              <SelectItem value="never">{t('callSettings.voicemailModeNever')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="queue-timeout">{t('callSettings.queueTimeout')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('callSettings.queueTimeoutDescription')}
          </p>
          <Input
            id="queue-timeout"
            data-testid="admin-call-settings-queue-timeout-input"
            type="number"
            value={settings.queueTimeoutSeconds}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value) || 90
              saveMutation.mutate({ queueTimeoutSeconds: val })
            }}
            min={30}
            max={300}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voicemail-max">{t('callSettings.voicemailMax')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('callSettings.voicemailMaxDescription')}
          </p>
          <Input
            id="voicemail-max"
            data-testid="admin-call-settings-voicemail-max-input"
            type="number"
            value={settings.voicemailMaxSeconds}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value) || 120
              saveMutation.mutate({ voicemailMaxSeconds: val })
            }}
            min={30}
            max={300}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('callSettings.retentionDays')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('callSettings.retentionDaysDescription')}
          </p>
          <Input
            type="number"
            value={settings.voicemailRetentionDays ?? ''}
            placeholder="∞"
            disabled
          />
          <p className="text-xs text-amber-600">{t('callSettings.retentionNotYetActive')}</p>
        </div>
      </div>

      {showSaved && (
        <span data-testid="admin-call-settings-save-success" className="text-sm text-green-600">
          {t('common.success')}
        </span>
      )}
    </section>
  )
}
