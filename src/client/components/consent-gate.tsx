import { CONSENT_VERSION } from '@shared/types'
import { ShieldCheck } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useConsent } from '@/lib/consent'

interface ConsentGateProps {
  isKeyUnlocked: boolean
  children: ReactNode
}

/**
 * Full-screen, non-dismissable consent overlay.
 * Shown when the user is authenticated (key unlocked) but has not yet agreed
 * to the current platform privacy policy / data processing consent.
 *
 * The "I agree" button is only enabled after the user scrolls to the bottom.
 */
export function ConsentGate({ isKeyUnlocked, children }: ConsentGateProps) {
  const { t } = useTranslation()
  const { needsConsent, isLoading, submitConsentVersion } = useConsent()
  const [hasScrolled, setHasScrolled] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Only show when key is unlocked (user authenticated with nsec) and consent is needed
  const showGate = isKeyUnlocked && !isLoading && needsConsent

  useEffect(() => {
    if (!showGate) return
    // Reset scroll tracking when gate appears
    setHasScrolled(false)
  }, [showGate])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    // Consider scrolled when within 32px of bottom
    if (scrollHeight - scrollTop - clientHeight < 32) {
      setHasScrolled(true)
    }
  }

  async function handleAgree() {
    if (!hasScrolled || submitting) return
    setSubmitting(true)
    try {
      await submitConsentVersion(CONSENT_VERSION)
    } finally {
      setSubmitting(false)
    }
  }

  if (!showGate) {
    return <>{children}</>
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm"
      data-testid="consent-gate"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border p-6">
          <ShieldCheck className="h-7 w-7 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold leading-tight">{t('consent.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('consent.subtitle')}</p>
          </div>
        </div>

        {/* Scrollable body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-6 text-sm leading-relaxed text-foreground"
          data-testid="consent-scroll-area"
        >
          <p className="mb-4">{t('consent.intro')}</p>

          <h3 className="mb-2 font-semibold">{t('consent.dataCollected.title')}</h3>
          <ul className="mb-4 list-inside list-disc space-y-1 text-muted-foreground">
            <li>{t('consent.dataCollected.accountInfo')}</li>
            <li>{t('consent.dataCollected.callNotes')}</li>
            <li>{t('consent.dataCollected.sessions')}</li>
            <li>{t('consent.dataCollected.auditLog')}</li>
          </ul>

          <h3 className="mb-2 font-semibold">{t('consent.howWeProtect.title')}</h3>
          <ul className="mb-4 list-inside list-disc space-y-1 text-muted-foreground">
            <li>{t('consent.howWeProtect.e2ee')}</li>
            <li>{t('consent.howWeProtect.noPlaintext')}</li>
            <li>{t('consent.howWeProtect.retention')}</li>
          </ul>

          <h3 className="mb-2 font-semibold">{t('consent.yourRights.title')}</h3>
          <ul className="mb-4 list-inside list-disc space-y-1 text-muted-foreground">
            <li>{t('consent.yourRights.access')}</li>
            <li>{t('consent.yourRights.portability')}</li>
            <li>{t('consent.yourRights.erasure')}</li>
          </ul>

          <p className="mb-2 text-muted-foreground">{t('consent.gdprNote')}</p>
          <p className="text-xs text-muted-foreground">
            {t('consent.version', { version: CONSENT_VERSION })}
          </p>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-6">
          {!hasScrolled && (
            <p className="mb-3 text-center text-xs text-muted-foreground">
              {t('consent.scrollToRead')}
            </p>
          )}
          <Button
            className="w-full"
            disabled={!hasScrolled || submitting}
            onClick={handleAgree}
            data-testid="consent-agree-button"
          >
            {submitting ? t('consent.submitting') : t('consent.agree')}
          </Button>
        </div>
      </div>
    </div>
  )
}
