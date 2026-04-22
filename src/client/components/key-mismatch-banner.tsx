import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'

export function KeyMismatchBanner() {
  const { keyMismatchDetected } = useAuth()
  const { t } = useTranslation()

  if (!keyMismatchDetected) return null

  return (
    <div
      role="alert"
      data-testid="key-mismatch-banner"
      className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 dark:bg-amber-600 dark:text-amber-50"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {t('crypto.keyMismatch', {
        defaultValue:
          'Your encryption key doesn\u2019t match your stored data. Contact an admin to re-verify your identity.',
      })}
    </div>
  )
}
