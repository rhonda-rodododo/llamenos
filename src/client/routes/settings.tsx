import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import {
  getSpamSettings,
  updateSpamSettings,
  getTranscriptionSettings,
  updateTranscriptionSettings,
  updateMyTranscriptionPreference,
  type SpamSettings,
} from '@/lib/api'
import { useToast } from '@/lib/toast'
import { Settings2, Mic, ShieldAlert, Bot, Timer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation()
  const { isAdmin, transcriptionEnabled } = useAuth()
  const { toast } = useToast()
  const [spam, setSpam] = useState<SpamSettings | null>(null)
  const [globalTranscription, setGlobalTranscription] = useState(false)
  const [myTranscription, setMyTranscription] = useState(transcriptionEnabled)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isAdmin) {
      Promise.all([
        getSpamSettings().then(setSpam),
        getTranscriptionSettings().then(r => setGlobalTranscription(r.globalEnabled)),
      ]).catch(() => toast(t('common.error'), 'error'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [isAdmin])

  if (loading) {
    return <div className="text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-muted-foreground" />
        <h2 className="text-2xl font-bold">{t('settings.title')}</h2>
      </div>

      {/* Transcription */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-muted-foreground" />
            {t('settings.transcriptionSettings')}
          </CardTitle>
          <CardDescription>{t('settings.transcriptionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label>{t('settings.enableTranscription')}</Label>
                <p className="text-xs text-muted-foreground">{t('transcription.enabledGlobal')}</p>
              </div>
              <Switch
                checked={globalTranscription}
                onCheckedChange={async (checked) => {
                  try {
                    const res = await updateTranscriptionSettings({ globalEnabled: checked })
                    setGlobalTranscription(res.globalEnabled)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
              />
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label>
                {myTranscription ? t('transcription.disableForCalls') : t('transcription.enableForCalls')}
              </Label>
            </div>
            <Switch
              checked={myTranscription}
              onCheckedChange={async (checked) => {
                try {
                  await updateMyTranscriptionPreference(checked)
                  setMyTranscription(checked)
                } catch {
                  toast(t('common.error'), 'error')
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Spam mitigation */}
      {isAdmin && spam && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              {t('spam.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Bot className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="space-y-0.5">
                  <Label>{t('spam.voiceCaptcha')}</Label>
                  <p className="text-xs text-muted-foreground">{t('spam.voiceCaptchaDescription')}</p>
                </div>
              </div>
              <Switch
                checked={spam.voiceCaptchaEnabled}
                onCheckedChange={async (checked) => {
                  try {
                    const res = await updateSpamSettings({ voiceCaptchaEnabled: checked })
                    setSpam(res)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Timer className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="space-y-0.5">
                  <Label>{t('spam.rateLimiting')}</Label>
                  <p className="text-xs text-muted-foreground">{t('spam.rateLimitingDescription')}</p>
                </div>
              </div>
              <Switch
                checked={spam.rateLimitEnabled}
                onCheckedChange={async (checked) => {
                  try {
                    const res = await updateSpamSettings({ rateLimitEnabled: checked })
                    setSpam(res)
                  } catch {
                    toast(t('common.error'), 'error')
                  }
                }}
              />
            </div>

            {spam.rateLimitEnabled && (
              <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4">
                <div className="space-y-2">
                  <Label htmlFor="max-calls">{t('spam.maxCallsPerMinute')}</Label>
                  <Input
                    id="max-calls"
                    type="number"
                    value={spam.maxCallsPerMinute}
                    onChange={async (e) => {
                      try {
                        const val = parseInt(e.target.value) || 3
                        const res = await updateSpamSettings({ maxCallsPerMinute: val })
                        setSpam(res)
                      } catch {
                        toast(t('common.error'), 'error')
                      }
                    }}
                    min={1}
                    max={60}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="block-duration">{t('spam.blockDuration')}</Label>
                  <Input
                    id="block-duration"
                    type="number"
                    value={spam.blockDurationMinutes}
                    onChange={async (e) => {
                      try {
                        const val = parseInt(e.target.value) || 30
                        const res = await updateSpamSettings({ blockDurationMinutes: val })
                        setSpam(res)
                      } catch {
                        toast(t('common.error'), 'error')
                      }
                    }}
                    min={1}
                    max={1440}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
