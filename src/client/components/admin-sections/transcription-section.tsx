import { ConfirmDialog } from '@/components/confirm-dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { getTranscriptionSettings, updateTranscriptionSettings } from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface TranscriptionSettings {
  globalEnabled: boolean
  allowUserOptOut: boolean
}

export function TranscriptionSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: queryKeys.settings.transcription(),
    queryFn: (): Promise<TranscriptionSettings> => getTranscriptionSettings(),
  })
  const [pendingGlobal, setPendingGlobal] = useState<boolean | null>(null)
  const [showSaved, setShowSaved] = useState(false)

  const saveMutation = useMutation({
    mutationFn: (data: { globalEnabled?: boolean; allowUserOptOut?: boolean }) =>
      updateTranscriptionSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.settings.transcription(), res)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.transcription() })
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  if (isLoading || !settings) return null

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('settings.transcriptionDescription')}</p>

      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="space-y-0.5">
          <Label>{t('settings.enableTranscription')}</Label>
          <p className="text-xs text-muted-foreground">{t('transcription.enabledGlobal')}</p>
        </div>
        <Switch
          data-testid="admin-transcription-global-switch"
          checked={settings.globalEnabled}
          onCheckedChange={(checked) => setPendingGlobal(checked)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="space-y-0.5">
          <Label>{t('transcription.allowOptOut')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('transcription.allowOptOutDescription')}
          </p>
        </div>
        <Switch
          data-testid="admin-transcription-opt-out-switch"
          checked={settings.allowUserOptOut}
          onCheckedChange={(checked) => saveMutation.mutate({ allowUserOptOut: checked })}
        />
      </div>

      {showSaved && (
        <span data-testid="admin-transcription-save-success" className="text-sm text-green-600">
          {t('common.success')}
        </span>
      )}

      <ConfirmDialog
        open={pendingGlobal !== null}
        onOpenChange={(open) => {
          if (!open) setPendingGlobal(null)
        }}
        title={t('confirm.transcriptionTitle')}
        description={
          pendingGlobal ? t('confirm.transcriptionEnable') : t('confirm.transcriptionDisable')
        }
        variant={pendingGlobal ? 'default' : 'destructive'}
        onConfirm={async () => {
          if (pendingGlobal === null) return
          await saveMutation.mutateAsync({ globalEnabled: pendingGlobal })
          setPendingGlobal(null)
        }}
      />
    </section>
  )
}
