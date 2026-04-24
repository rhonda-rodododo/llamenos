import { permissionGranted } from '@shared/permissions'
import type { DeviceKeypair } from '@shared/types'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { ConsentGate } from '@/components/consent-gate'
import { createDebugLog } from '@/lib/debug-log'
import { decryptObjectFields, resetMismatchFired, setOnDecryptMismatch } from '@/lib/decrypt-fields'
import { getDeviceKeypair } from '@/lib/device-identity-store'
import {
  logout as apiLogout,
  getMe,
  setOnApiActivity,
  setOnAuthExpired,
  updateMyAvailability,
} from './api'
import { authFacadeClient } from './auth-facade-client'
import { clearHubKeyCache, loadHubKeysForUser } from './hub-key-cache'
import * as keyManager from './key-manager'
import { invalidateEncryptedQueries } from './query-client'
import { loginWithPasskey as webauthnLogin } from './webauthn'

const log = createDebugLog('llamenos:auth')

interface AuthState {
  isKeyUnlocked: boolean
  publicKey: string | null
  roles: string[]
  hubRoles: { hubId: string; roleIds: string[] }[]
  permissions: string[]
  primaryRoleName: string | null
  name: string | null
  isLoading: boolean
  error: string | null
  transcriptionEnabled: boolean
  spokenLanguages: string[]
  uiLanguage: string
  profileCompleted: boolean
  onBreak: boolean
  callPreference: 'phone' | 'browser' | 'both'
  sessionExpiring: boolean
  sessionExpired: boolean
  adminPubkey: string
  adminDecryptionPubkey: string
  /** True when passkey login succeeded but no local key exists — needs PIN setup */
  needsKeySetup: boolean
  /** True when decrypt-fields detects no envelope matches the reader's pubkey. Cleared on sign-out and unlock. */
  keyMismatchDetected: boolean
  /**
   * Persistent per-device identity loaded from IDB (`llamenos-device` DB).
   * Ed25519 signing + X25519 encryption keypair, created once during admin
   * bootstrap and preserved across lock/logout. `null` on signed-out state
   * or if the device keypair is not yet provisioned on this browser.
   */
  deviceKeypair: DeviceKeypair | null
}

interface AuthContextValue extends AuthState {
  signIn: (nsec: string) => Promise<void>
  /** Returns true if key setup is needed (no local key on this device) */
  signInWithPasskey: () => Promise<boolean>
  signOut: () => void
  refreshProfile: () => Promise<void>
  toggleBreak: () => Promise<void>
  renewSession: () => Promise<void>
  unlockWithPin: (pin: string) => Promise<keyManager.UnlockResult>
  /** Complete key setup after passkey login on a new device (imports nsec with PIN) */
  completePasskeyKeySetup: (pin: string) => Promise<boolean>
  lockKey: () => void
  hasPermission: (permission: string) => boolean
  isAdmin: boolean
  isAuthenticated: boolean
  hasNsec: boolean
  isKeyUnlocked: boolean
  adminPubkey: string
  adminDecryptionPubkey: string
  keyMismatchDetected: boolean
  deviceKeypair: DeviceKeypair | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Helper to build a full AuthState from a /auth/me response */
function stateFromMe(
  me: Awaited<ReturnType<typeof getMe>>,
  overrides: Partial<AuthState> = {}
): AuthState {
  // Record auth establishment for grace-period guard in onAuthExpired
  if ((me.roles?.length ?? 0) > 0) {
    lastAuthEstablishedAt = Date.now()
  }
  return {
    isKeyUnlocked: false,
    publicKey: me.pubkey,
    roles: me.roles || [],
    hubRoles: me.hubRoles ?? [],
    permissions: me.permissions || [],
    primaryRoleName: me.primaryRole?.name || null,
    name: me.name,
    isLoading: false,
    error: null,
    transcriptionEnabled: me.transcriptionEnabled,
    spokenLanguages: me.spokenLanguages || ['en'],
    uiLanguage: me.uiLanguage || 'en',
    profileCompleted: me.profileCompleted ?? true,
    onBreak: me.onBreak ?? false,
    callPreference: me.callPreference ?? 'phone',
    adminPubkey: me.adminDecryptionPubkey || '',
    adminDecryptionPubkey: me.adminDecryptionPubkey || '',
    sessionExpiring: false,
    sessionExpired: false,
    needsKeySetup: false,
    keyMismatchDetected: false,
    deviceKeypair: null,
    ...overrides,
  }
}

/**
 * Best-effort load of the persistent device keypair from IDB. Never throws:
 * if the store is empty, corrupted, or unavailable we log and return null so
 * callers can still land the user in an authenticated state.
 */
async function loadDeviceKeypairSafe(): Promise<DeviceKeypair | null> {
  try {
    return await getDeviceKeypair()
  } catch (err) {
    log('device keypair load failed', { err })
    return null
  }
}

/** Interval for silent JWT refresh (10 minutes) */
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000

/**
 * Timestamp of last successful auth establishment (PIN unlock, session restore).
 * Used to ignore stale 401 responses from pre-auth requests that arrive after
 * authentication completes. Without this grace period, React Query queries and
 * custom fetch calls that fire before auth can trigger onAuthExpired AFTER
 * the user is already authenticated, causing the session-expired modal to flash.
 */
let lastAuthEstablishedAt = 0
const AUTH_GRACE_PERIOD_MS = 10_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isKeyUnlocked: false,
    publicKey: null,
    roles: [],
    hubRoles: [],
    permissions: [],
    primaryRoleName: null,
    name: null,
    isLoading: true,
    error: null,
    transcriptionEnabled: true,
    spokenLanguages: ['en'],
    uiLanguage: 'en',
    profileCompleted: true,
    onBreak: false,
    callPreference: 'phone',
    sessionExpiring: false,
    sessionExpired: false,
    adminPubkey: '',
    adminDecryptionPubkey: '',
    needsKeySetup: false,
    keyMismatchDetected: false,
    deviceKeypair: null,
  })

  const lastApiActivity = useRef(Date.now())
  /** Holds nsec hex temporarily after passkey login when no local key — cleared after PIN setup */
  const pendingNsecRef = useRef<{ nsecHex: string; pubkey: string; idpValue: Uint8Array } | null>(
    null
  )

  // Track API activity — called after each successful request
  const markActivity = useCallback(() => {
    lastApiActivity.current = Date.now()
    setState((s) => (s.sessionExpiring ? { ...s, sessionExpiring: false } : s))
    keyManager.resetAutoLockTimer()
  }, [])

  // Listen for key manager lock/unlock events
  useEffect(() => {
    const unsubLock = keyManager.onLock(() => {
      setState((s) => ({ ...s, isKeyUnlocked: false }))
    })
    const unsubUnlock = keyManager.onUnlock(() => {
      // getPublicKeyHex is async now — update state when it resolves.
      // Also hydrate the persistent device keypair from IDB so components
      // like devices-section have access to the signing key without each
      // hitting IDB independently.
      void Promise.all([keyManager.getPublicKeyHex(), loadDeviceKeypairSafe()]).then(
        ([pubkey, deviceKeypair]) => {
          // Clear keyMismatchDetected on unlock — fresh decryption will re-detect
          // if the mismatch persists. Re-arm the fire-once guard so the handler
          // can fire again with the new key state.
          resetMismatchFired()
          setState((s) => ({
            ...s,
            isKeyUnlocked: true,
            keyMismatchDetected: false,
            publicKey: pubkey ?? s.publicKey,
            deviceKeypair: deviceKeypair ?? s.deviceKeypair,
          }))
        }
      )
    })
    return () => {
      unsubLock()
      unsubUnlock()
    }
  }, [])

  // Listen for decrypt envelope mismatches (no envelope for our pubkey).
  // We only need the boolean signal for the banner — field-level details
  // are logged in dev mode by decrypt-fields.ts.
  useEffect(() => {
    setOnDecryptMismatch((_info) => {
      setState((s) => {
        if (s.keyMismatchDetected) return s // already flagged
        return { ...s, keyMismatchDetected: true }
      })
    })
    return () => setOnDecryptMismatch(null)
  }, [])

  // Register auth expiry callback — called by api.ts when a 401 is received.
  // Guards against stale 401s from pre-auth requests that arrive after
  // authentication is established:
  //   1. publicKey not set or still loading → auth hasn't started yet
  //   2. Within grace period of auth establishment → stale 401 from pre-auth request
  useEffect(() => {
    setOnAuthExpired(() => {
      setState((s) => {
        if (!s.publicKey || s.isLoading) return s
        if (Date.now() - lastAuthEstablishedAt < AUTH_GRACE_PERIOD_MS) return s
        return {
          ...s,
          sessionExpired: true,
          sessionExpiring: false,
          ...(s.isKeyUnlocked
            ? {}
            : { roles: [], permissions: [], primaryRoleName: null, name: null }),
        }
      })
    })
    return () => setOnAuthExpired(null)
  }, [])

  // Register API activity callback
  useEffect(() => {
    setOnApiActivity(markActivity)
    return () => setOnApiActivity(null)
  }, [markActivity])

  // Session expiry warning — check every 60s if idle > 30 min.
  useEffect(() => {
    const hasToken = !!authFacadeClient.getAccessToken()
    if (!state.isKeyUnlocked && !hasToken) return
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastApiActivity.current
      const WARN_THRESHOLD = 30 * 60 * 1000 // 30 minutes
      if (elapsed >= WARN_THRESHOLD && !state.sessionExpired) {
        setState((s) => ({ ...s, sessionExpiring: true }))
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [state.isKeyUnlocked, state.sessionExpired])

  // Restore session on mount — try JWT refresh (httpOnly cookie)
  useEffect(() => {
    let cancelled = false
    async function restoreSession() {
      // Phase 1 — Authentication. Any failure here means the user has no
      // valid session and must log in again.
      let me: Awaited<ReturnType<typeof getMe>> | null = null
      let restored = false
      try {
        // Attempt silent token refresh using the httpOnly refresh cookie
        await authFacadeClient.refreshToken()
        if (cancelled) return

        // Fast path: restore Worker from a session capsule if one is present.
        // This skips PBKDF2 and keeps the user on their current page.
        restored = await keyManager.trySessionRestore()
        if (cancelled) return
        if (restored) {
          resetMismatchFired()
        }

        me = await getMe()
        if (cancelled) return
      } catch {
        // No valid refresh cookie, network failure, or /auth/me rejection —
        // the user needs to log in.
        if (!cancelled) {
          setState((s) => ({ ...s, isLoading: false }))
        }
        return
      }

      if (!me) return // cancelled mid-try

      // Phase 2 — Post-auth enrichment (decrypt PII, load hub keys, warm
      // the React Query cache). This is best-effort: if anything throws we
      // still set auth state from `me` so the user lands authenticated-
      // but-locked. Returning early here would silently redirect the user
      // to /login despite a valid session.
      lastApiActivity.current = Date.now()
      let isUnlocked = false
      let pubkey: string | null = null
      try {
        isUnlocked = restored || (await keyManager.isUnlocked())
        pubkey = isUnlocked ? await keyManager.getPublicKeyHex() : null
        if (cancelled) return

        // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
        if (pubkey) {
          await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
          // Load hub keys so hub-key-encrypted fields (Twilio SID, report type
          // names, etc.) can decrypt. Normally unlockWithPin handles this after
          // PIN entry; when the capsule auto-restores we must do it here too.
          const hubIds = (me.hubRoles ?? []).map((hr) => hr.hubId)
          await loadHubKeysForUser(hubIds)
          if (cancelled) return
          invalidateEncryptedQueries()
        }
      } catch (err) {
        // Enrichment failed — land the user on the locked-key screen via
        // their authenticated session rather than kicking them to /login.
        // The root-layout effect will then redirect to /login where they
        // can re-enter their PIN, which retries the decrypt+hub-key path.
        log('post-auth enrichment failed', { err })
        isUnlocked = false
        pubkey = null
      }

      if (cancelled) return
      const deviceKeypair = isUnlocked ? await loadDeviceKeypairSafe() : null
      if (cancelled) return
      setState(
        stateFromMe(me, {
          isKeyUnlocked: isUnlocked,
          publicKey: pubkey ?? me.pubkey,
          deviceKeypair,
        })
      )
    }
    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  // Silent JWT refresh on interval (10 minutes)
  useEffect(() => {
    const hasToken = !!authFacadeClient.getAccessToken()
    if (!hasToken) return

    const interval = setInterval(() => {
      void authFacadeClient.refreshToken().catch(() => {
        // Refresh failed — token will expire, 401 handler will catch it
      })
    }, TOKEN_REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, []) // re-establish when auth state changes

  // Sign in with nsec (admin bootstrap / recovery only)
  // NOTE: This flow is kept for admin bootstrap. It does NOT use the facade
  // because nsec import is a local-only operation (encrypt + store + worker load).
  // Sign in after key import + JWT acquisition (used by demo mode and admin bootstrap).
  // Assumes: (1) crypto worker already holds the nsec (via importKey), (2) authFacadeClient
  // already has a valid access token. Just fetches the profile and sets auth state.
  const signIn = useCallback(async (_nsec: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }))
    try {
      const isUnlocked = await keyManager.isUnlocked()
      const pubkey = isUnlocked ? await keyManager.getPublicKeyHex() : null
      if (!isUnlocked || !pubkey) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: 'Key not loaded. Use the full onboarding flow.',
        }))
        return
      }
      const me = await getMe()
      lastApiActivity.current = Date.now()
      await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      const hubIds = (me.hubRoles ?? []).map((hr) => hr.hubId)
      await loadHubKeysForUser(hubIds)
      invalidateEncryptedQueries()
      const deviceKeypair = await loadDeviceKeypairSafe()
      setState(
        stateFromMe(me, {
          isKeyUnlocked: true,
          publicKey: pubkey,
          deviceKeypair,
        })
      )
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Sign-in failed',
      }))
    }
  }, [])

  // Unlock with PIN (primary day-to-day auth after passkey session)
  const unlockWithPin = useCallback(async (pin: string): Promise<keyManager.UnlockResult> => {
    const result = await keyManager.unlock(pin)
    if (!result.ok) return result
    const { pubkey } = result

    try {
      const me = await getMe()
      lastApiActivity.current = Date.now()
      // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
      await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      // Load hub keys after unlocking (crypto worker handles decryption internally)
      const hubIds = (me.hubRoles ?? []).map((hr) => hr.hubId)
      await loadHubKeysForUser(hubIds)
      invalidateEncryptedQueries()
      const deviceKeypair = await loadDeviceKeypairSafe()
      setState(
        stateFromMe(me, {
          isKeyUnlocked: true,
          publicKey: pubkey,
          deviceKeypair,
        })
      )
      return { ok: true, pubkey }
    } catch (err) {
      // Post-unlock bootstrap failed (getMe, decrypt, hub key load). The
      // key unlock itself succeeded — this is a session/IdP/network issue,
      // NOT a wrong PIN. Re-lock the worker so we're in a consistent state
      // and surface it as idp-unavailable so the PIN attempt counter is
      // not incremented.
      log('unlockWithPin bootstrap failed', err)
      await keyManager.lock()
      return { ok: false, reason: 'idp-unavailable' }
    }
  }, [])

  const lockKey = useCallback(() => {
    void keyManager.lock()
  }, [])

  const signInWithPasskey = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, isLoading: true, error: null, needsKeySetup: false }))
    pendingNsecRef.current = null
    try {
      const { pubkey } = await webauthnLogin()
      // The facade client already holds the JWT access token from verifyLogin.
      // The httpOnly refresh cookie is also set by the server response.
      const me = await getMe()
      lastApiActivity.current = Date.now()
      const isUnlocked = await keyManager.isUnlocked()
      const hasKey = keyManager.hasStoredKey()

      // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
      if (isUnlocked) {
        await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      }

      // If no local key exists (fresh device), fetch nsec from server so the user
      // can create a PIN and provision the key on this device.
      if (!isUnlocked && !hasKey) {
        const userInfo = await authFacadeClient.getUserInfo()
        if (userInfo?.nsecSecret) {
          const { bytesToHex } = await import('@noble/hashes/utils.js')
          pendingNsecRef.current = {
            nsecHex: bytesToHex(userInfo.nsecSecret),
            pubkey,
            idpValue: userInfo.nsecSecret,
          }
          setState(
            stateFromMe(me, {
              isKeyUnlocked: false,
              publicKey: pubkey,
              needsKeySetup: true,
            })
          )
          return true // key setup needed
        }
      }

      const deviceKeypair = isUnlocked ? await loadDeviceKeypairSafe() : null
      setState(
        stateFromMe(me, {
          isKeyUnlocked: isUnlocked,
          publicKey: pubkey,
          deviceKeypair,
        })
      )
      return false // no key setup needed
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Passkey login failed',
        needsKeySetup: false,
      }))
      throw err // re-throw so handlePasskeyLogin can catch
    }
  }, [])

  /**
   * Complete key setup on a new device after passkey login.
   * Imports the nsec (fetched from server during signInWithPasskey) encrypted with the given PIN.
   * Returns true on success, false if no pending nsec or import fails.
   */
  const completePasskeyKeySetup = useCallback(async (pin: string): Promise<boolean> => {
    const pending = pendingNsecRef.current
    if (!pending) return false

    try {
      const { nsecHex, pubkey, idpValue } = pending
      // Import the key — this encrypts nsec with PIN+idpValue and stores in localStorage.
      // Use window.location.origin as issuer (real IdP value, not synthetic).
      await keyManager.importKey(
        nsecHex,
        pin,
        pubkey,
        idpValue,
        undefined, // no PRF for passkey key setup
        window.location.origin
      )

      // Clear the pending nsec from memory
      pendingNsecRef.current = null

      // Fetch fresh profile and set fully authenticated state
      const me = await getMe()
      lastApiActivity.current = Date.now()
      await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      const hubIds = (me.hubRoles ?? []).map((hr) => hr.hubId)
      await loadHubKeysForUser(hubIds)
      invalidateEncryptedQueries()
      const deviceKeypair = await loadDeviceKeypairSafe()
      setState(
        stateFromMe(me, {
          isKeyUnlocked: true,
          publicKey: pubkey,
          needsKeySetup: false,
          deviceKeypair,
        })
      )
      return true
    } catch (err) {
      log('completePasskeyKeySetup failed:', err instanceof Error ? err.message : 'unknown')
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Key setup failed',
      }))
      return false
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    try {
      const me = await getMe()
      lastApiActivity.current = Date.now()
      // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey) {
        await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      }
      setState((s) => ({
        ...s,
        name: me.name,
        roles: me.roles || [],
        permissions: me.permissions || [],
        primaryRoleName: me.primaryRole?.name || null,
        publicKey: me.pubkey,
        transcriptionEnabled: me.transcriptionEnabled,
        spokenLanguages: me.spokenLanguages || ['en'],
        uiLanguage: me.uiLanguage || 'en',
        profileCompleted: me.profileCompleted ?? true,
        onBreak: me.onBreak ?? false,
        callPreference: me.callPreference ?? 'phone',
        adminPubkey: me.adminDecryptionPubkey || '',
        adminDecryptionPubkey: me.adminDecryptionPubkey || '',
        sessionExpiring: false,
        sessionExpired: false,
      }))
    } catch {
      // ignore — if the refresh fails the user stays on the current page
    }
  }, [])

  const renewSession = useCallback(async () => {
    try {
      // Use facade to refresh the JWT, then fetch fresh profile
      await authFacadeClient.refreshToken()
      const me = await getMe()
      lastApiActivity.current = Date.now()
      // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey) {
        await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      }
      setState((s) => ({
        ...s,
        name: me.name,
        roles: me.roles || [],
        permissions: me.permissions || [],
        primaryRoleName: me.primaryRole?.name || null,
        publicKey: me.pubkey,
        transcriptionEnabled: me.transcriptionEnabled,
        spokenLanguages: me.spokenLanguages || ['en'],
        uiLanguage: me.uiLanguage || 'en',
        profileCompleted: me.profileCompleted ?? true,
        onBreak: me.onBreak ?? false,
        callPreference: me.callPreference ?? 'phone',
        adminPubkey: me.adminDecryptionPubkey || '',
        adminDecryptionPubkey: me.adminDecryptionPubkey || '',
        sessionExpiring: false,
        sessionExpired: false,
      }))
    } catch {
      // Renewal failed — session truly expired
      setState((s) => ({ ...s, sessionExpired: true, sessionExpiring: false }))
    }
  }, [])

  const toggleBreak = useCallback(async () => {
    const newValue = !state.onBreak
    try {
      await updateMyAvailability(newValue)
      setState((s) => ({ ...s, onBreak: newValue }))
    } catch {
      // ignore — toast handled by caller
      throw new Error('Failed to update availability')
    }
  }, [state.onBreak])

  const signOut = useCallback(() => {
    // Revoke server-side session via facade (clears httpOnly cookie + server session)
    void authFacadeClient.revokeSession().catch(() => {
      // Best-effort — clear local state regardless
    })
    // Also call the old API logout endpoint for backward compatibility during migration
    void apiLogout()
    void keyManager.lock()
    clearHubKeyCache()
    resetMismatchFired()
    // Clean up encrypted drafts from localStorage
    const draftKeys = Object.keys(localStorage).filter((k) => k.startsWith('llamenos-draft:'))
    for (const k of draftKeys) localStorage.removeItem(k)
    pendingNsecRef.current = null
    // Note: we clear the deviceKeypair *state*, but deliberately do NOT
    // clear the IDB-backed store. Device identity is persistent across
    // lock/logout and is only removed on an explicit "forget this device"
    // action.
    setState({
      isKeyUnlocked: false,
      publicKey: null,
      roles: [],
      hubRoles: [],
      permissions: [],
      primaryRoleName: null,
      name: null,
      isLoading: false,
      error: null,
      transcriptionEnabled: true,
      spokenLanguages: ['en'],
      uiLanguage: 'en',
      profileCompleted: true,
      onBreak: false,
      callPreference: 'phone',
      adminPubkey: '',
      adminDecryptionPubkey: '',
      sessionExpiring: false,
      sessionExpired: false,
      needsKeySetup: false,
      keyMismatchDetected: false,
      deviceKeypair: null,
    })
  }, [])

  const hasAccessToken = typeof window !== 'undefined' && !!authFacadeClient.getAccessToken()

  const value: AuthContextValue = {
    ...state,
    signIn,
    signInWithPasskey,
    signOut,
    refreshProfile,
    toggleBreak,
    renewSession,
    unlockWithPin,
    completePasskeyKeySetup,
    lockKey,
    hasPermission: (permission: string) => permissionGranted(state.permissions, permission),
    isAdmin: permissionGranted(state.permissions, 'settings:manage'),
    isAuthenticated: (state.isKeyUnlocked || hasAccessToken) && state.roles.length > 0,
    hasNsec: state.isKeyUnlocked,
    isKeyUnlocked: state.isKeyUnlocked,
    keyMismatchDetected: state.keyMismatchDetected,
  }

  return (
    <AuthContext.Provider value={value}>
      <ConsentGate isKeyUnlocked={state.isKeyUnlocked}>{children}</ConsentGate>
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
