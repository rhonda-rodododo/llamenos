import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Timer } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdvancedReveal } from '@/components/admin-shell/advanced-reveal'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SectionBody, SectionDescription, SectionField } from '@/components/section-layout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { getSpamSettings, type SpamSettings, updateSpamSettings } from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { useToast } from '@/lib/toast'

type PendingToggleKey = 'captcha' | 'rateLimit'

export function SpamProtectionSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: queryKeys.settings.spam(),
    queryFn: getSpamSettings,
  })
  const [pendingToggle, setPendingToggle] = useState<{
    key: PendingToggleKey
    newValue: boolean
  } | null>(null)
  const [showSaved, setShowSaved] = useState(false)

  const saveMutation = useMutation({
    mutationFn: (data: Partial<SpamSettings>) => updateSpamSettings(data),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings.spam(), updated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.spam() })
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  if (isLoading || !settings) return null

  const confirmTitle =
    pendingToggle?.key === 'captcha' ? t('confirm.captchaTitle') : t('confirm.rateLimitTitle')
  const confirmDescription =
    pendingToggle?.key === 'captcha'
      ? pendingToggle.newValue
        ? t('confirm.captchaEnable')
        : t('confirm.captchaDisable')
      : pendingToggle?.newValue
        ? t('confirm.rateLimitEnable')
        : t('confirm.rateLimitDisable')

  return (
    <SectionBody className="space-y-4">
      <SectionDescription>{t('spam.description')}</SectionDescription>

      {/* Voice CAPTCHA toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="space-y-0.5">
            <Label>{t('spam.voiceCaptcha')}</Label>
            <p className="text-xs text-muted-foreground">{t('spam.voiceCaptchaDescription')}</p>
          </div>
        </div>
        <Switch
          data-testid="admin-spam-protection-captcha-switch"
          checked={settings.voiceCaptchaEnabled}
          onCheckedChange={(checked) => setPendingToggle({ key: 'captcha', newValue: checked })}
        />
      </div>

      {/* Rate Limiting toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <Timer className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="space-y-0.5">
            <Label>{t('spam.rateLimiting')}</Label>
            <p className="text-xs text-muted-foreground">{t('spam.rateLimitingDescription')}</p>
          </div>
        </div>
        <Switch
          data-testid="admin-spam-protection-rate-limit-switch"
          checked={settings.rateLimitEnabled}
          onCheckedChange={(checked) => setPendingToggle({ key: 'rateLimit', newValue: checked })}
        />
      </div>

      {showSaved && (
        <span data-testid="admin-spam-protection-save-success" className="text-sm text-green-600">
          {t('common.success')}
        </span>
      )}

      {/* Technical thresholds — hidden by default */}
      <AdvancedReveal sectionSlug="spam-protection">
        {settings.voiceCaptchaEnabled && (
          <div className="rounded-lg border border-border p-4">
            <SectionField
              label={t('spam.captchaMaxAttempts')}
              htmlFor="captcha-max-attempts"
              help={t('spam.captchaMaxAttemptsDescription')}
            >
              <Input
                id="captcha-max-attempts"
                data-testid="admin-spam-protection-captcha-max-attempts-input"
                type="number"
                value={settings.captchaMaxAttempts}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(5, Number.parseInt(e.target.value, 10) || 2))
                  saveMutation.mutate({ captchaMaxAttempts: val })
                }}
                min={1}
                max={5}
                className="w-24"
              />
            </SectionField>
          </div>
        )}

        {settings.rateLimitEnabled && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
            <SectionField label={t('spam.maxCallsPerMinute')} htmlFor="max-calls">
              <Input
                id="max-calls"
                data-testid="admin-spam-protection-max-calls-per-minute-input"
                type="number"
                value={settings.maxCallsPerMinute}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10) || 3
                  saveMutation.mutate({ maxCallsPerMinute: val })
                }}
                min={1}
                max={60}
              />
            </SectionField>
            <SectionField label={t('spam.blockDuration')} htmlFor="block-duration">
              <Input
                id="block-duration"
                data-testid="admin-spam-protection-block-duration-input"
                type="number"
                value={settings.blockDurationMinutes}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10) || 30
                  saveMutation.mutate({ blockDurationMinutes: val })
                }}
                min={1}
                max={1440}
              />
            </SectionField>
          </div>
        )}

        {!settings.voiceCaptchaEnabled && !settings.rateLimitEnabled && (
          <p className="text-xs text-muted-foreground">{t('spam.noAdvancedSettings')}</p>
        )}
      </AdvancedReveal>

      <ConfirmDialog
        open={pendingToggle !== null}
        onOpenChange={(open) => {
          if (!open) setPendingToggle(null)
        }}
        title={confirmTitle}
        description={confirmDescription}
        variant={pendingToggle?.newValue ? 'default' : 'destructive'}
        onConfirm={async () => {
          if (!pendingToggle) return
          const data: Partial<SpamSettings> =
            pendingToggle.key === 'captcha'
              ? { voiceCaptchaEnabled: pendingToggle.newValue }
              : { rateLimitEnabled: pendingToggle.newValue }
          await saveMutation.mutateAsync(data)
          setPendingToggle(null)
        }}
      />
    </SectionBody>
  )
}
