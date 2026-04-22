import { DEFAULT_BLAST_SETTINGS } from '@shared/types'
import { Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { BlastSettings } from '@/lib/api'
import { useBlastSettings, useUpdateBlastSettings } from '@/lib/queries/blasts'
import { useToast } from '@/lib/toast'

export function BlastSettingsPanel() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const { data: fetchedSettings, isLoading } = useBlastSettings()
  const updateMutation = useUpdateBlastSettings()

  // Local draft for editing before save
  const [settings, setSettings] = useState<BlastSettings>({ ...DEFAULT_BLAST_SETTINGS })

  // Sync local draft when remote data loads
  useEffect(() => {
    if (fetchedSettings) {
      setSettings(fetchedSettings)
    }
  }, [fetchedSettings])

  async function handleSave() {
    try {
      const updated = await updateMutation.mutateAsync(settings)
      setSettings(updated)
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  if (isLoading) return <div className="text-muted-foreground">{t('common.loading')}</div>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4" />
          {t('blasts.blastSettings')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('blasts.subscribeKeyword')}</Label>
            <Input
              value={settings.subscribeKeyword}
              onChange={(e) => setSettings({ ...settings, subscribeKeyword: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('blasts.unsubscribeKeyword')}</Label>
            <Input
              value={settings.unsubscribeKeyword}
              onChange={(e) => setSettings({ ...settings, unsubscribeKeyword: e.target.value })}
              disabled
            />
            <p className="text-xs text-muted-foreground">{t('blasts.stopRequired')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('blasts.confirmationMsg')}</Label>
          <Input
            value={settings.confirmationMessage}
            onChange={(e) => setSettings({ ...settings, confirmationMessage: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('blasts.unsubscribeMsg')}</Label>
          <Input
            value={settings.unsubscribeMessage}
            onChange={(e) => setSettings({ ...settings, unsubscribeMessage: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('blasts.optOutFooter')}</Label>
          <Input
            value={settings.optOutFooter}
            onChange={(e) => setSettings({ ...settings, optOutFooter: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <Label>{t('blasts.doubleOptIn')}</Label>
            <p className="text-xs text-muted-foreground">{t('blasts.doubleOptInDesc')}</p>
          </div>
          <Switch
            checked={settings.doubleOptIn}
            onCheckedChange={(c) => setSettings({ ...settings, doubleOptIn: c })}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('blasts.maxPerDay')}</Label>
            <Input
              type="number"
              value={settings.maxBlastsPerDay}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxBlastsPerDay: Number.parseInt(e.target.value, 10) || 10,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>{t('blasts.rateLimit')}</Label>
            <Input
              type="number"
              value={settings.rateLimitPerSecond}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  rateLimitPerSecond: Number.parseInt(e.target.value, 10) || 10,
                })
              }
            />
          </div>
        </div>

        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? t('common.loading') : t('common.save')}
        </Button>
      </CardContent>
    </Card>
  )
}
