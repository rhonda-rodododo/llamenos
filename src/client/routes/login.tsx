import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { useTheme } from '@/lib/theme'
import { isValidNsec } from '@/lib/crypto'
import { readBackupFile } from '@/lib/backup'
import { Phone, KeyRound, LogIn, Lock, Sun, Moon, Monitor, Upload, ChevronDown, ChevronUp } from 'lucide-react'
import { LanguageSelect } from '@/components/language-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
  const { signIn, error, isLoading } = useAuth()
  const { hotlineName } = useConfig()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [nsec, setNsec] = useState('')
  const [validationError, setValidationError] = useState('')
  const [showRestore, setShowRestore] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const backup = await readBackupFile(file)
    if (!backup) {
      setValidationError(t('auth.invalidBackup'))
      return
    }
    // For now, just show the backup was loaded — user still needs nsec from backup
    // The backup file contains encrypted nsec; we'd need PIN to decrypt
    setValidationError('')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Phone className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t('auth.loginTitle', { name: hotlineName })}</CardTitle>
          <CardDescription>{t('auth.loginDescription')}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Language & theme toggles */}
          <div className="flex items-center justify-center gap-2">
            <LanguageSelect size="sm" />
            <span className="h-4 w-px bg-border" />
            {([['system', Monitor], ['light', Sun], ['dark', Moon]] as const).map(([value, Icon]) => (
              <Button
                key={value}
                variant={theme === value ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setTheme(value)}
                title={t(`a11y.theme${value.charAt(0).toUpperCase() + value.slice(1)}`)}
                aria-label={t(`a11y.theme${value.charAt(0).toUpperCase() + value.slice(1)}`)}
              >
                <Icon className="h-3 w-3" />
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

          {/* Restore from backup */}
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setShowRestore(!showRestore)}
            >
              <Upload className="h-3.5 w-3.5" />
              {t('auth.restoreFromBackup')}
              {showRestore ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
            {showRestore && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <p className="text-sm text-muted-foreground">{t('auth.selectBackupFile')}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
                />
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter className="justify-center">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            {t('auth.securityNote')}
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
