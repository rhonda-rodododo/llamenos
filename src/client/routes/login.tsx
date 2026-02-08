import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { isValidNsec } from '@/lib/crypto'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
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
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">{t('auth.loginTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('auth.loginDescription')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="nsec" className="mb-1.5 block text-sm font-medium">
              {t('auth.secretKey')}
            </label>
            <input
              id="nsec"
              type="password"
              value={nsec}
              onChange={(e) => setNsec(e.target.value)}
              placeholder={t('auth.secretKeyPlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              autoComplete="off"
              autoFocus
            />
          </div>

          {(validationError || error) && (
            <p className="text-sm text-destructive-foreground">{validationError || error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? t('common.loading') : t('auth.login')}
          </button>
        </form>
      </div>
    </div>
  )
}
