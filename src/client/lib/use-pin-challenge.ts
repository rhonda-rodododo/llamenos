/**
 * Hook for re-authentication via PIN challenge before sensitive operations.
 *
 * Usage:
 *   const { requirePin, PinChallengeDialog } = usePinChallenge()
 *   const ok = await requirePin()
 *   if (!ok) return // user cancelled or max attempts exceeded
 */

import { useCallback, useRef, useState } from 'react'
import { authFacadeClient } from './auth-facade-client'
import * as keyManager from './key-manager'

const MAX_ATTEMPTS = 3

/**
 * Transient states surfaced to the PIN dialog so the user knows WHY their
 * attempt failed. Only `wrong-pin` counts toward the 3-attempt wipe budget —
 * every other state is a retriable environment problem and the counter
 * must NOT advance.
 */
type PinChallengeErrorState = null | 'wrong-pin' | 'prf-unavailable' | 'idp-unavailable'

interface PinChallengeState {
  isOpen: boolean
  attempts: number
  error: PinChallengeErrorState
}

interface PinChallengeReturn {
  /** Call this to require PIN entry. Returns true if verified, false if cancelled/failed. */
  requirePin: () => Promise<boolean>
  /** Whether the dialog is currently open */
  isOpen: boolean
  /** Current PIN attempt count */
  attempts: number
  /** Last error state (null if no error or dialog just opened) */
  error: PinChallengeErrorState
  /** Handle PIN completion (called by dialog component) */
  handleComplete: (pin: string) => Promise<void>
  /** Handle dialog cancel */
  handleCancel: () => void
}

export function usePinChallenge(): PinChallengeReturn {
  const [state, setState] = useState<PinChallengeState>({
    isOpen: false,
    attempts: 0,
    error: null,
  })

  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const requirePin = useCallback((): Promise<boolean> => {
    // If key manager is already unlocked, verify via unlock (re-enter PIN)
    // The key needs to be re-verified even if unlocked
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState({ isOpen: true, attempts: 0, error: null })
    })
  }, [])

  const handleComplete = useCallback(
    async (pin: string) => {
      // Try to verify the PIN by attempting unlock
      // If already unlocked, we need to verify against stored key
      const result = await keyManager.unlock(pin)

      if (result.ok) {
        // PIN correct
        setState({ isOpen: false, attempts: 0, error: null })
        resolveRef.current?.(true)
        resolveRef.current = null
        return
      }

      // Transient, non-PIN failures: do NOT advance the attempt counter.
      // A PRF cancel or expired IdP session would otherwise burn the 3-try
      // lockout budget and wipe the user's keys despite a correct PIN.
      if (result.reason === 'prf-unavailable' || result.reason === 'idp-unavailable') {
        setState((prev) => ({ ...prev, error: result.reason }))
        return
      }

      // no-blob means there's nothing to verify against — abort the challenge.
      if (result.reason === 'no-blob') {
        setState({ isOpen: false, attempts: 0, error: null })
        resolveRef.current?.(false)
        resolveRef.current = null
        return
      }

      // Genuine wrong PIN — advance the counter, wipe after MAX_ATTEMPTS.
      const currentAttempts = state.attempts + 1
      if (currentAttempts >= MAX_ATTEMPTS) {
        // Max attempts exceeded — wipe key + clear session, then close dialog.
        // await ensures key is fully wiped and onLock callbacks fire
        // before we resolve, so auth state updates before dialog closes.
        // clearAccessToken ensures isAuthenticated becomes false immediately.
        await keyManager.wipeKey()
        authFacadeClient.clearAccessToken()
        setState({ isOpen: false, attempts: 0, error: null })
        resolveRef.current?.(false)
        resolveRef.current = null
      } else {
        setState((prev) => ({
          ...prev,
          attempts: prev.attempts + 1,
          error: 'wrong-pin',
        }))
      }
    },
    [state.attempts]
  )

  const handleCancel = useCallback(() => {
    setState({ isOpen: false, attempts: 0, error: null })
    resolveRef.current?.(false)
    resolveRef.current = null
  }, [])

  return {
    requirePin,
    isOpen: state.isOpen,
    attempts: state.attempts,
    error: state.error,
    handleComplete,
    handleCancel,
  }
}
