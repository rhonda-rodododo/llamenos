import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { isValidNsec } from '@/lib/crypto'
import { setLanguage } from '@/lib/i18n'
import { LANGUAGES } from '@shared/languages'
import { Phone, KeyRound, LogIn, Globe, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t, i18n } = useTranslation()
  const { signIn, error, isLoading } = useAuth()
  const navigate = useNavigate()
  const [nsec, setNsec] = useState('')
  const [validationError, setValidationError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setValidationError('')

    if (!nsec.trim()) {
      setValidationError(t('auth.invalidKey'))
      return
    }

    if (!isValidNsec(nsec.trim())) {
      setValidationError(t('auth.invalidKey'))
      return
    }

    await signIn(nsec.trim())
    navigate({ to: '/' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Phone className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t('auth.loginTitle')}</CardTitle>
          <CardDescription>{t('auth.loginDescription')}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Language toggle */}
          <div className="flex flex-wrap items-center justify-center gap-1">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            {LANGUAGES.map(lang => (
              <Button
                key={lang.code}
                variant={i18n.language === lang.code ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setLanguage(lang.code)}
                title={lang.label}
              >
                {lang.flag}
              </Button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nsec">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                {t('auth.secretKey')}
              </Label>
              <Input
                id="nsec"
                type="password"
                value={nsec}
                onChange={(e) => setNsec(e.target.value)}
                placeholder={t('auth.secretKeyPlaceholder')}
                autoComplete="off"
                autoFocus
              />
            </div>

            {(validationError || error) && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                {validationError || error}
              </p>
            )}

            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? (
                t('common.loading')
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  {t('auth.login')}
                </>
              )}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            {t('auth.securityNote', { defaultValue: 'Your key never leaves your device' })}
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
