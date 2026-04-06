import { LogoMark } from '@/components/logo-mark'
import { Button } from '@/components/ui/button'
import { areCookiesBlocked, resetCookieDetection } from '@/lib/cookie-detection'
import { Cookie } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Interstitial shown on /login when the browser has cookies disabled. The
 * auth flow depends on HttpOnly refresh cookies, so without cookies every
 * attempt silently fails and users see confusing PIN errors. Surface the
 * real cause instead.
 */
export function CookiesRequired({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  const [retryCount, setRetryCount] = useState(0)
  const handleRetry = () => {
    resetCookieDetection()
    if (!areCookiesBlocked()) {
      onRetry()
    } else {
      setRetryCount((n) => n + 1)
    }
  }
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background p-4"
      data-testid="cookies-required-notice"
    >
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Cookie className="h-7 w-7 text-primary" />
        </div>
        <LogoMark size="sm" className="mx-auto opacity-60" />
        <h1 className="text-xl font-semibold">
          {t('cookiesRequired.title', 'Cookies are required')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'cookiesRequired.body',
            'Llámenos uses browser cookies to keep your session signed in. No tracking, no third parties — just the cookies this site needs to work. Please enable cookies for this site and try again.'
          )}
        </p>
        <Button onClick={handleRetry} data-testid="cookies-required-retry">
          {t('cookiesRequired.retry', 'I enabled cookies — retry')}
        </Button>
        {retryCount > 0 && (
          <p className="text-xs text-destructive" data-testid="cookies-required-still-blocked">
            {t(
              'cookiesRequired.stillBlocked',
              'Cookies still appear to be blocked. Check your browser settings for this site.'
            )}
          </p>
        )}
      </div>
    </div>
  )
}
