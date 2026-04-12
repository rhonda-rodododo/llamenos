import { useTranslation } from 'react-i18next'

/**
 * Why the fallback modal is being shown. Determines the body copy and
 * allows the caller to drive policy enforcement (e.g. required + reason
 * browser_unsupported → no continue button).
 */
export type E2eeFallbackReason = 'browser_unsupported' | 'caller_pstn_leg' | 'policy_required'

interface E2eeFallbackBannerProps {
  /**
   * Hub-level voice E2EE policy in effect.
   * - `required`  — user cannot proceed; only cancel is shown.
   * - `preferred` — user may continue without E2EE after explicit consent.
   */
  policy: 'required' | 'preferred'
  reason: E2eeFallbackReason
  onContinue: () => void
  onCancel: () => void
}

const REASON_TO_BODY_KEY: Record<E2eeFallbackReason, string> = {
  browser_unsupported: 'voice.e2ee.fallback.body.browser_unsupported',
  caller_pstn_leg: 'voice.e2ee.fallback.body.caller_pstn_leg',
  policy_required: 'voice.e2ee.fallback.body.policy_required',
}

/**
 * Active-consent modal shown when an E2EE call cannot be established and
 * the hub policy requires the user to make a deliberate decision.
 *
 * Uses role=alertdialog + aria-modal=true per WAI-ARIA spec — this is
 * intentionally a MODAL, not a passive banner. The overnight tier-5 mandate
 * requires explicit user consent before proceeding with a non-E2EE call,
 * so the UI must block the happy-path call button rather than just warning
 * beside it.
 */
export function E2eeFallbackBanner({
  policy,
  reason,
  onContinue,
  onCancel,
}: E2eeFallbackBannerProps) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="e2ee-fallback-title"
        aria-describedby="e2ee-fallback-body"
        data-testid="banner-e2ee-fallback"
        data-policy={policy}
        data-reason={reason}
        className="relative z-10 max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <h2
          id="e2ee-fallback-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-50"
        >
          {t('voice.e2ee.fallback.title')}
        </h2>
        <p id="e2ee-fallback-body" className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          {t(REASON_TO_BODY_KEY[reason])}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            data-testid="button-fallback-cancel"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t('voice.e2ee.fallback.cancel')}
          </button>
          {policy === 'preferred' && (
            <button
              type="button"
              data-testid="button-fallback-continue"
              onClick={onContinue}
              className="rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700"
            >
              {t('voice.e2ee.fallback.continue')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
