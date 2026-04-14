import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Tier 5 P1 fail-closed defender. Returns:
 *  - `markDecided`: call from button handlers BEFORE invoking onCancel /
 *    onContinue so the cleanup knows the user made a deliberate choice.
 *  - `cleanup`: call from a `useEffect` cleanup; defaults to `onCancel` if
 *    `markDecided` was never called (i.e. the modal unmounted without a
 *    decision — route change, parent crash, race on call teardown, etc.).
 *
 * Extracted as a pure factory so the unmount-defaults-to-cancel contract
 * can be unit-tested in bun:test without spinning up a DOM. Tests call
 * `cleanup()` directly to simulate React's effect cleanup phase.
 */
export function makeUnmountDefender(onCancel: () => void): {
  markDecided: () => void
  cleanup: () => void
} {
  let decided = false
  return {
    markDecided() {
      decided = true
    },
    cleanup() {
      if (!decided) onCancel()
    },
  }
}

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

  // Tier 5 P1 fail-closed defense: if the parent unmounts the modal without
  // the user having clicked either button (e.g. route change, error boundary
  // remount, race on call teardown), default to "cancel". A silent unmount
  // would otherwise leave the call in an indeterminate state where the user
  // never made a deliberate consent decision.
  //
  // Always read the latest handler so the cleanup never fires a stale
  // closure if the parent passes a new onCancel prop mid-lifecycle.
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  // The defender lives for the entire mounted lifetime of the component —
  // create it once, never recreate, so the `decided` flag survives prop
  // changes. The effect cleanup runs only on unmount because of the empty
  // dep array.
  const defenderRef = useRef<ReturnType<typeof makeUnmountDefender> | null>(null)
  if (defenderRef.current === null) {
    defenderRef.current = makeUnmountDefender(() => onCancelRef.current())
  }

  useEffect(() => {
    const defender = defenderRef.current
    return () => {
      defender?.cleanup()
    }
  }, [])

  const handleCancel = useCallback(() => {
    defenderRef.current?.markDecided()
    onCancel()
  }, [onCancel])

  const handleContinue = useCallback(() => {
    defenderRef.current?.markDecided()
    onContinue()
  }, [onContinue])

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
            onClick={handleCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t('voice.e2ee.fallback.cancel')}
          </button>
          {policy === 'preferred' && (
            <button
              type="button"
              data-testid="button-fallback-continue"
              onClick={handleContinue}
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
