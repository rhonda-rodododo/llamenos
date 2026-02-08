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

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation()
  const { isAdmin, transcriptionEnabled } = useAuth()
  const [spam, setSpam] = useState<SpamSettings | null>(null)
  const [globalTranscription, setGlobalTranscription] = useState(false)
  const [myTranscription, setMyTranscription] = useState(transcriptionEnabled)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isAdmin) {
      Promise.all([
        getSpamSettings().then(setSpam),
        getTranscriptionSettings().then(r => setGlobalTranscription(r.globalEnabled)),
      ]).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [isAdmin])

  if (loading) {
    return <div className="text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">{t('settings.title')}</h2>

      {/* Transcription - available to all */}
      <section className="rounded-lg border border-border p-6 space-y-4">
        <h3 className="text-lg font-medium">{t('settings.transcriptionSettings')}</h3>

        {isAdmin && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('settings.enableTranscription')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.transcriptionDescription')}</p>
            </div>
            <button
              onClick={async () => {
                const res = await updateTranscriptionSettings({ globalEnabled: !globalTranscription })
                setGlobalTranscription(res.globalEnabled)
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                globalTranscription
                  ? 'bg-green-900/50 text-green-300'
                  : 'bg-red-900/50 text-red-300'
              }`}
            >
              {globalTranscription ? t('spam.enabled') : t('spam.disabled')}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {myTranscription ? t('transcription.disableForCalls') : t('transcription.enableForCalls')}
            </p>
          </div>
          <button
            onClick={async () => {
              await updateMyTranscriptionPreference(!myTranscription)
              setMyTranscription(!myTranscription)
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              myTranscription
                ? 'bg-green-900/50 text-green-300'
                : 'bg-red-900/50 text-red-300'
            }`}
          >
            {myTranscription ? t('spam.enabled') : t('spam.disabled')}
          </button>
        </div>
      </section>

      {/* Spam mitigation - admin only */}
      {isAdmin && spam && (
        <section className="rounded-lg border border-border p-6 space-y-4">
          <h3 className="text-lg font-medium">{t('spam.title')}</h3>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('spam.voiceCaptcha')}</p>
              <p className="text-xs text-muted-foreground">{t('spam.voiceCaptchaDescription')}</p>
            </div>
            <button
              onClick={async () => {
                const res = await updateSpamSettings({ voiceCaptchaEnabled: !spam.voiceCaptchaEnabled })
                setSpam(res)
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                spam.voiceCaptchaEnabled
                  ? 'bg-green-900/50 text-green-300'
                  : 'bg-red-900/50 text-red-300'
              }`}
            >
              {spam.voiceCaptchaEnabled ? t('spam.enabled') : t('spam.disabled')}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('spam.rateLimiting')}</p>
              <p className="text-xs text-muted-foreground">{t('spam.rateLimitingDescription')}</p>
            </div>
            <button
              onClick={async () => {
                const res = await updateSpamSettings({ rateLimitEnabled: !spam.rateLimitEnabled })
                setSpam(res)
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                spam.rateLimitEnabled
                  ? 'bg-green-900/50 text-green-300'
                  : 'bg-red-900/50 text-red-300'
              }`}
            >
              {spam.rateLimitEnabled ? t('spam.enabled') : t('spam.disabled')}
            </button>
          </div>

          {spam.rateLimitEnabled && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('spam.maxCallsPerMinute')}</label>
                <input
                  type="number"
                  value={spam.maxCallsPerMinute}
                  onChange={async (e) => {
                    const val = parseInt(e.target.value) || 3
                    const res = await updateSpamSettings({ maxCallsPerMinute: val })
                    setSpam(res)
                  }}
                  min={1}
                  max={60}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('spam.blockDuration')}</label>
                <input
                  type="number"
                  value={spam.blockDurationMinutes}
                  onChange={async (e) => {
                    const val = parseInt(e.target.value) || 30
                    const res = await updateSpamSettings({ blockDurationMinutes: val })
                    setSpam(res)
                  }}
                  min={1}
                  max={1440}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
