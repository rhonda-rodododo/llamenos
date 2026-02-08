import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { updateMyProfile } from '@/lib/api'
import { setLanguage } from '@/lib/i18n'
import { useToast } from '@/lib/toast'
import { LANGUAGES } from '@shared/languages'
import { Globe, Languages, Phone, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export const Route = createFileRoute('/profile-setup')({
  component: ProfileSetupPage,
})

function ProfileSetupPage() {
  const { t, i18n } = useTranslation()
  const { name, refreshProfile } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [uiLang, setUiLang] = useState(i18n.language || 'en')
  const [spokenLangs, setSpokenLangs] = useState<string[]>(['en'])
  const [saving, setSaving] = useState(false)

  function toggleSpokenLang(code: string) {
    setSpokenLangs(prev =>
      prev.includes(code)
        ? prev.filter(l => l !== code)
        : [...prev, code]
    )
  }

  async function handleComplete() {
    if (spokenLangs.length === 0) {
      toast(t('profile.selectLanguage'), 'error')
      return
    }
    setSaving(true)
    try {
      setLanguage(uiLang)
      await updateMyProfile({
        uiLanguage: uiLang,
        spokenLanguages: spokenLangs,
        profileCompleted: true,
      })
      await refreshProfile()
      navigate({ to: '/' })
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Phone className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t('profile.welcome')}</CardTitle>
          {name && (
            <CardDescription>
              {t('profile.setupDescription', { name })}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {/* UI Language */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4 text-muted-foreground" />
              {t('profile.uiLanguage')}
            </div>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => {
                    setUiLang(lang.code)
                    setLanguage(lang.code)
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    uiLang === lang.code
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <span>{lang.flag}</span>
                  {lang.label}
                  {uiLang === lang.code && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>

          {/* Spoken Languages */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Languages className="h-4 w-4 text-muted-foreground" />
              {t('profile.spokenLanguages')}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('profile.spokenLanguagesHelp')}
            </p>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => toggleSpokenLang(lang.code)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    spokenLangs.includes(lang.code)
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <span>{lang.flag}</span>
                  {lang.label}
                  {spokenLangs.includes(lang.code) && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleComplete}
            disabled={saving || spokenLangs.length === 0}
            className="w-full"
            size="lg"
          >
            {saving ? t('common.loading') : (
              <>
                {t('profile.getStarted')}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
