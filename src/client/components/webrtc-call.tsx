import { useAuth } from '@/lib/auth'
import {
  type E2eeStatus,
  type WebRtcState,
  destroyWebRtc,
  getE2eeReason,
  getE2eeStatus,
  getState,
  initWebRtc,
  onE2eeStatusChange,
  onStateChange,
  toggleMute,
  acceptCall as webrtcAccept,
  hangupCall as webrtcHangup,
} from '@/lib/webrtc/manager'
import { Mic, MicOff, Monitor, PhoneCall, PhoneOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActiveCallBadge, type E2eeBadgeState } from './call/ActiveCallBadge'
import { E2eeFallbackBanner, type E2eeFallbackReason } from './call/E2eeFallbackBanner'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

function e2eeStatusToBadge(status: E2eeStatus): E2eeBadgeState {
  switch (status) {
    case 'active':
      return 'e2ee-direct'
    case 'unavailable':
    case 'unknown':
      return 'not-e2ee'
  }
}

function e2eeReasonToFallback(reason: string | undefined): E2eeFallbackReason {
  switch (reason) {
    case 'browser_unsupported':
      return 'browser_unsupported'
    case 'sframe_hook_failed':
    case 'sframe_init_failed':
      return 'policy_required'
    default:
      return 'browser_unsupported'
  }
}

/**
 * WebRTC status indicator shown in the dashboard header.
 * Shows connection state and provides controls for browser-based calling.
 */
export function WebRtcStatus() {
  const { t } = useTranslation()
  const { callPreference } = useAuth()
  const [state, setState] = useState<WebRtcState>(getState)

  useEffect(() => {
    return onStateChange((newState) => setState(newState))
  }, [])

  // Initialize WebRTC when call preference includes browser
  useEffect(() => {
    if (callPreference === 'browser' || callPreference === 'both') {
      initWebRtc()
    }
    return () => {
      if (callPreference !== 'phone') {
        destroyWebRtc()
      }
    }
  }, [callPreference])

  if (callPreference === 'phone') return null

  return (
    <div className="flex items-center gap-2">
      <Monitor className="h-4 w-4 text-muted-foreground" />
      <Badge
        variant="outline"
        className={
          state === 'ready'
            ? 'border-green-500/50 text-green-700 dark:text-green-400'
            : state === 'connected'
              ? 'border-blue-500/50 text-blue-700 dark:text-blue-400'
              : state === 'error'
                ? 'border-destructive/50 text-destructive'
                : 'border-border text-muted-foreground'
        }
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            state === 'ready'
              ? 'bg-green-500'
              : state === 'connected'
                ? 'bg-blue-500 animate-pulse'
                : state === 'error'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground'
          }`}
        />
        {state === 'ready' && t('settings.callPrefBrowser')}
        {state === 'connected' && t('calls.active')}
        {state === 'initializing' && t('common.loading')}
        {state === 'error' && t('common.error')}
        {state === 'idle' && t('settings.callPrefBrowser')}
        {state === 'ringing' && t('calls.incoming')}
      </Badge>
    </div>
  )
}

/**
 * WebRTC call controls shown when there's an active browser call.
 * Provides mute/unmute and hangup buttons.
 */
export function WebRtcCallControls() {
  const { t } = useTranslation()
  const [state, setState] = useState<WebRtcState>(getState)
  const [muted, setMuted] = useState(false)
  const [e2eeStatus, setE2eeStatus] = useState<E2eeStatus>(getE2eeStatus)
  const [e2eeReason, setE2eeReason] = useState<string | undefined>(getE2eeReason)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    return onStateChange((newState) => setState(newState))
  }, [])

  useEffect(() => {
    return onE2eeStatusChange((next, reason) => {
      setE2eeStatus(next)
      setE2eeReason(reason)
      // Re-show banner whenever a new unavailable event fires.
      if (next === 'unavailable') setBannerDismissed(false)
    })
  }, [])

  const handleMute = useCallback(() => {
    const newMuted = toggleMute()
    setMuted(newMuted)
  }, [])

  const handleHangup = useCallback(() => {
    webrtcHangup()
    setMuted(false)
  }, [])

  const handleAccept = useCallback(() => {
    webrtcAccept()
  }, [])

  const handleBannerCancel = useCallback(() => {
    setBannerDismissed(true)
    webrtcHangup()
  }, [])

  // Fallback banner: show whenever SFrame is unavailable and the operator has
  // not yet dismissed it. Policy is `required` — no `Continue without E2EE`
  // button is offered. This is a hard fail-closed, not a soft warning.
  const showFallbackBanner = e2eeStatus === 'unavailable' && !bannerDismissed

  if (state === 'ringing') {
    return (
      <>
        {showFallbackBanner && (
          <E2eeFallbackBanner
            policy="required"
            reason={e2eeReasonToFallback(e2eeReason)}
            onCancel={handleBannerCancel}
            onContinue={() => {
              /* required policy — no continue button rendered */
            }}
          />
        )}
        <div className="flex items-center gap-2">
          <Button
            onClick={handleAccept}
            className="animate-pulse bg-green-600 hover:bg-green-700"
            size="sm"
            data-testid="button-call-accept"
          >
            <PhoneCall className="h-4 w-4" />
            {t('calls.answer')}
          </Button>
        </div>
      </>
    )
  }

  if (state !== 'connected') {
    // Even when idle/ready, if SFrame is unavailable we must warn the operator
    // so they don't think the next call will be E2EE.
    if (showFallbackBanner) {
      return (
        <E2eeFallbackBanner
          policy="required"
          reason={e2eeReasonToFallback(e2eeReason)}
          onCancel={handleBannerCancel}
          onContinue={() => {
            /* required policy */
          }}
        />
      )
    }
    return null
  }

  return (
    <>
      {showFallbackBanner && (
        <E2eeFallbackBanner
          policy="required"
          reason={e2eeReasonToFallback(e2eeReason)}
          onCancel={handleBannerCancel}
          onContinue={() => {
            /* required policy */
          }}
        />
      )}
      <div
        className="flex items-center gap-2"
        data-testid="webrtc-call-controls"
        data-e2ee-status={e2eeStatus}
      >
        <ActiveCallBadge state={e2eeStatusToBadge(e2eeStatus)} />
        <Button variant="outline" size="sm" onClick={handleMute} data-testid="button-call-mute">
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {muted ? t('calls.unmute') : t('calls.mute')}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleHangup}
          data-testid="button-call-hangup"
        >
          <PhoneOff className="h-4 w-4" />
          {t('calls.hangUp')}
        </Button>
      </div>
    </>
  )
}
