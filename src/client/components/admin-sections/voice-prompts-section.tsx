import { AudioRecorder } from '@/components/audio-recorder'
import { Badge } from '@/components/ui/badge'
import {
  type IvrAudioRecording,
  deleteIvrAudio,
  getIvrAudioUrl,
  listIvrAudio,
  uploadIvrAudio,
} from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { ivrAudioOptions, ivrLanguagesOptions } from '@/lib/queries/settings'
import { useToast } from '@/lib/toast'
import { LANGUAGE_MAP } from '@shared/languages'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const PROMPT_TYPES = [
  'greeting',
  'pleaseHold',
  'waitMessage',
  'rateLimited',
  'captchaPrompt',
] as const

export function VoicePromptsSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: ivrEnabled = [] } = useQuery(ivrLanguagesOptions())
  const { data: recordings = [], isLoading } = useQuery(ivrAudioOptions())
  const [audioSaving, setAudioSaving] = useState<string | null>(null)
  const [showSaved, setShowSaved] = useState(false)

  function flashSaved() {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const uploadMutation = useMutation({
    mutationFn: async (args: { promptType: string; langCode: string; blob: Blob }) => {
      await uploadIvrAudio(args.promptType, args.langCode, args.blob)
      const res = await listIvrAudio()
      return res.recordings
    },
    onSuccess: (recs) => {
      queryClient.setQueryData(queryKeys.settings.ivrAudio(), recs)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.ivrAudio() })
      toast(t('common.success'), 'success')
      flashSaved()
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (args: { promptType: string; langCode: string }) => {
      await deleteIvrAudio(args.promptType, args.langCode)
      return args
    },
    onSuccess: (args) => {
      queryClient.setQueryData<IvrAudioRecording[]>(queryKeys.settings.ivrAudio(), (old) =>
        (old ?? []).filter(
          (r) => !(r.promptType === args.promptType && r.language === args.langCode)
        )
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.ivrAudio() })
      toast(t('common.success'), 'success')
      flashSaved()
    },
    onError: () => toast(t('common.error'), 'error'),
  })

  if (isLoading) return null

  return (
    <section className="space-y-4" data-testid="admin-voice-prompts-section">
      <p className="text-sm text-muted-foreground">{t('ivrAudio.description')}</p>

      {PROMPT_TYPES.map((promptType) => (
        <div key={promptType} className="space-y-2">
          <h4 className="text-sm font-medium">{t(`ivrAudio.prompt.${promptType}`)}</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ivrEnabled.map((langCode) => {
              const lang = LANGUAGE_MAP[langCode]
              if (!lang) return null
              const existing = recordings.find(
                (r) => r.promptType === promptType && r.language === langCode
              )
              const key = `${promptType}:${langCode}`
              return (
                <div
                  key={key}
                  data-testid={`admin-voice-prompts-cell-${promptType}-${langCode}`}
                  className="rounded-lg border border-border p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      {lang.flag} {lang.label}
                    </span>
                    {existing && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t('ivrAudio.uploaded')}
                      </Badge>
                    )}
                  </div>
                  <AudioRecorder
                    existingUrl={existing ? getIvrAudioUrl(promptType, langCode) : undefined}
                    onRecorded={async (blob) => {
                      setAudioSaving(key)
                      try {
                        await uploadMutation.mutateAsync({ promptType, langCode, blob })
                      } finally {
                        setAudioSaving(null)
                      }
                    }}
                    onDelete={
                      existing
                        ? async () => {
                            setAudioSaving(key)
                            try {
                              await deleteMutation.mutateAsync({ promptType, langCode })
                            } finally {
                              setAudioSaving(null)
                            }
                          }
                        : undefined
                    }
                  />
                  {audioSaving === key && (
                    <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {showSaved && (
        <span data-testid="admin-voice-prompts-save-success" className="text-sm text-green-600">
          {t('common.success')}
        </span>
      )}
    </section>
  )
}
