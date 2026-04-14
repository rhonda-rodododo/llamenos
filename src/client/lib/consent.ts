import { CONSENT_VERSION } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { getConsentStatus, submitConsent } from './api'

interface UseConsentResult {
  needsConsent: boolean
  isLoading: boolean
  submitConsentVersion: (version: string) => Promise<void>
}

// Module-level consent cache so non-React code (e.g. the SFrame call hook)
// can ask `isConsentGranted()` synchronously without threading a React context
// through the WebRTC manager. The state defaults to `false`, so any code path
// that runs before the ConsentGate has fetched status fails closed until the
// user has explicitly consented to the current version.
//
// Single-writer: only `useConsent` mutates it in production. Tests use
// `__resetConsentState` and `__setConsentGrantedForTest`.
let consentGranted = false

export function isConsentGranted(): boolean {
  return consentGranted
}

export function __setConsentGrantedForTest(value: boolean): void {
  consentGranted = value
}

export function __resetConsentState(): void {
  consentGranted = false
}

/**
 * Hook to check and record data processing consent for the authenticated user.
 * Used by ConsentGate to show/hide the consent overlay.
 */
export function useConsent(): UseConsentResult {
  const [needsConsent, setNeedsConsent] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getConsentStatus()
      .then((status) => {
        const needs = !status.hasConsented || status.consentVersion !== CONSENT_VERSION
        setNeedsConsent(needs)
        consentGranted = !needs
      })
      .catch(() => {
        // Transient status-fetch failure: don't block the UI (fail-open for
        // the overlay), but leave `consentGranted` false so sensitive call
        // paths still fail closed until the user has completed consent.
        setNeedsConsent(false)
      })
      .finally(() => setIsLoading(false))
  }, [])

  const submitConsentVersion = useCallback(async (version: string) => {
    await submitConsent(version)
    consentGranted = true
    setNeedsConsent(false)
  }, [])

  return { needsConsent, isLoading, submitConsentVersion }
}
