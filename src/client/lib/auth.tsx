import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { type KeyPair, keyPairFromNsec, getStoredSession, storeSession, clearSession, createAuthToken } from './crypto'
import { getMe, login } from './api'

interface AuthState {
  keyPair: KeyPair | null
  role: 'volunteer' | 'admin' | null
  name: string | null
  isLoading: boolean
  error: string | null
  transcriptionEnabled: boolean
}

interface AuthContextValue extends AuthState {
  signIn: (nsec: string) => Promise<void>
  signOut: () => void
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
      })
    } catch (err) {
      setState(s => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Login failed',
      }))
    }
  }, [])

  const signOut = useCallback(() => {
    clearSession()
    setState({
      keyPair: null,
      role: null,
      name: null,
      isLoading: false,
      error: null,
      transcriptionEnabled: true,
    })
  }, [])

  const value: AuthContextValue = {
    ...state,
    signIn,
    signOut,
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
