import { useTranslation } from 'react-i18next'

/**
 * Visual state for the E2EE indicator shown on an active call.
 *
 * - `e2ee-direct`   — SFrame end-to-end encryption is active over a direct
 *   browser-to-browser media path.
 * - `e2ee-relayed`  — SFrame end-to-end encryption is active but media is
 *   traversing a TURN relay. Still E2EE, but latency may be higher.
 * - `e2ee-degraded` — SFrame is installed but the worker has reported frame
 *   decrypt errors above threshold. The call may still be running but its
 *   integrity is suspect — operator should consider hanging up.
 * - `not-e2ee`      — The call is NOT end-to-end encrypted (e.g. PSTN caller
 *   leg, unsupported browser, or policy set to `off`).
 */
export type E2eeBadgeState = 'e2ee-direct' | 'e2ee-relayed' | 'e2ee-degraded' | 'not-e2ee'

interface ActiveCallBadgeProps {
  state: E2eeBadgeState
}

const STATE_TO_KEY: Record<E2eeBadgeState, string> = {
  'e2ee-direct': 'voice.e2ee.badge.direct',
  'e2ee-relayed': 'voice.e2ee.badge.relayed',
  'e2ee-degraded': 'voice.e2ee.badge.degraded',
  'not-e2ee': 'voice.e2ee.badge.none',
}

const STATE_TO_CLASS: Record<E2eeBadgeState, string> = {
  'e2ee-direct':
    'inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800',
  'e2ee-relayed':
    'inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800',
  'e2ee-degraded':
    'inline-flex items-center gap-1 rounded-full bg-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-900',
  'not-e2ee':
    'inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-900',
}

/**
 * Compact badge that communicates the E2EE status of the active call.
 *
 * Presentational only — the parent component owns the state transition
 * machinery (SFrame install event, ICE connection-type probe, MITM teardown).
 */
export function ActiveCallBadge({ state }: ActiveCallBadgeProps) {
  const { t } = useTranslation()
  const label = t(STATE_TO_KEY[state])
  return (
    <div
      data-testid="call-e2ee-badge"
      data-badge-state={state}
      aria-label={label}
      className={STATE_TO_CLASS[state]}
    >
      {label}
    </div>
  )
}
