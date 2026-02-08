import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { type KeyPair, keyPairFromNsec, getStoredSession, storeSession, clearSession, createAuthToken } from './crypto'
import { getMe, login, updateMyAvailability } from './api'

interface AuthState {
  keyPair: KeyPair | null
  role: 'volunteer' | 'admin' | null
  name: string | null
  isLoading: boolean
  error: string | null
  transcriptionEnabled: boolean
  spokenLanguages: string[]
  uiLanguage: string
  profileCompleted: boolean
  onBreak: boolean
}

interface AuthContextValue extends AuthState {
  signIn: (nsec: string) => Promise<void>
  signOut: () => void
  refreshProfile: () => Promise<void>
  toggleBreak: () => Promise<void>
  isAdmin: boolean
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    keyPair: null,
    role: null,
    name: null,
    isLoading: true,
    error: null,
    transcriptionEnabled: true,
    spokenLanguages: ['en'],
    uiLanguage: 'en',
    profileCompleted: true,
    onBreak: false,
  })

  // Restore session on mount
  useEffect(() => {
    const nsec = getStoredSession()
    if (nsec) {
      const keyPair = keyPairFromNsec(nsec)
      if (keyPair) {
        // Validate session with server
        getMe()
          .then((me) => {
            setState({
              keyPair,
              role: me.role,
              name: me.name,
              isLoading: false,
              error: null,
              transcriptionEnabled: me.transcriptionEnabled,
              spokenLanguages: me.spokenLanguages || ['en'],
              uiLanguage: me.uiLanguage || 'en',
              profileCompleted: me.profileCompleted ?? true,
              onBreak: me.onBreak ?? false,
            })
          })
          .catch(() => {
            clearSession()
            setState(s => ({ ...s, keyPair: null, isLoading: false }))
          })
        return
      }
    }
    setState(s => ({ ...s, isLoading: false }))
  }, [])

  const signIn = useCallback(async (nsec: string) => {
    setState(s => ({ ...s, isLoading: true, error: null }))
    const keyPair = keyPairFromNsec(nsec)
    if (!keyPair) {
      setState(s => ({ ...s, isLoading: false, error: 'Invalid secret key' }))
      return
    }
    try {
      const token = createAuthToken(keyPair.secretKey, Date.now())
      const parsed = JSON.parse(token)
      const result = await login(parsed.pubkey, parsed.token)
      storeSession(nsec)
      const me = await getMe()
      setState({
        keyPair,
        role: result.role,
        name: me.name,
        isLoading: false,
        error: null,
        transcriptionEnabled: me.transcriptionEnabled,
        spokenLanguages: me.spokenLanguages || ['en'],
        uiLanguage: me.uiLanguage || 'en',
        profileCompleted: me.profileCompleted ?? true,
        onBreak: me.onBreak ?? false,
      })
    } catch (err) {
      setState(s => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Login failed',
      }))
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    try {
      const me = await getMe()
      setState(s => ({
        ...s,
        name: me.name,
        role: me.role,
        transcriptionEnabled: me.transcriptionEnabled,
        spokenLanguages: me.spokenLanguages || ['en'],
        uiLanguage: me.uiLanguage || 'en',
        profileCompleted: me.profileCompleted ?? true,
        onBreak: me.onBreak ?? false,
      }))
    } catch {
      // ignore — if the refresh fails the user stays on the current page
    }
  }, [])

  const toggleBreak = useCallback(async () => {
    const newValue = !state.onBreak
    try {
      await updateMyAvailability(newValue)
      setState(s => ({ ...s, onBreak: newValue }))
    } catch {
      // ignore — toast handled by caller
      throw new Error('Failed to update availability')
    }
  }, [state.onBreak])

  const signOut = useCallback(() => {
    clearSession()
    setState({
      keyPair: null,
      role: null,
      name: null,
      isLoading: false,
      error: null,
      transcriptionEnabled: true,
      spokenLanguages: ['en'],
      uiLanguage: 'en',
      profileCompleted: true,
      onBreak: false,
    })
  }, [])

  const value: AuthContextValue = {
    ...state,
    signIn,
    signOut,
    refreshProfile,
    toggleBreak,
    isAdmin: state.role === 'admin',
    isAuthenticated: state.keyPair !== null && state.role !== null,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
