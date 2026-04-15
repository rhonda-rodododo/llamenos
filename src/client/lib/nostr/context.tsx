/**
 * React context for the Nostr relay connection.
 *
 * Manages the RelayManager lifecycle: connects when authenticated,
 * disconnects on sign-out, and exposes relay state to the component tree.
 */

import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react'
import { RelayManager } from './relay'
import type { RelayState } from './types'

/** Async accessor for the current Nostr x-only pubkey (or null when locked). */
type GetPubkey = () => Promise<string | null>
/** Async Schnorr signer delegated to the crypto worker. */
type SignEvent = (messageHex: string) => Promise<string>

interface NostrContextValue {
  relay: RelayManager | null
  state: RelayState
}

const NostrContext = createContext<NostrContextValue>({
  relay: null,
  state: 'disconnected',
})

interface NostrProviderProps {
  children: ReactNode
  /** Relay WebSocket URL (from /api/config serverNostrPubkey presence) */
  relayUrl: string | undefined
  /** Server's Nostr pubkey for verifying authoritative events */
  serverPubkey: string | undefined
  /** Whether the user is authenticated */
  isAuthenticated: boolean
  /** Returns the user's Nostr x-only pubkey hex, or null if the worker is locked */
  getPubkey: GetPubkey
  /** Signs a Nostr event hash (hex) via the crypto worker. Returns signature hex. */
  signEvent: SignEvent
  /** Returns the hub symmetric key for a given hubId, or null if unavailable */
  getHubKey: (hubId: string) => Uint8Array | null
}

export function NostrProvider({
  children,
  relayUrl,
  serverPubkey,
  isAuthenticated,
  getPubkey,
  signEvent,
  getHubKey,
}: NostrProviderProps) {
  const [state, setState] = useState<RelayState>('disconnected')
  const relayRef = useRef<RelayManager | null>(null)

  // Stable refs for callbacks to avoid recreating RelayManager on every render
  const getPubkeyRef = useRef(getPubkey)
  getPubkeyRef.current = getPubkey
  const signEventRef = useRef(signEvent)
  signEventRef.current = signEvent
  const getHubKeyRef = useRef(getHubKey)
  getHubKeyRef.current = getHubKey

  useEffect(() => {
    if (!isAuthenticated || !relayUrl || !serverPubkey) {
      // Tear down if not authenticated or no relay configured
      if (relayRef.current) {
        relayRef.current.close()
        relayRef.current = null
        setState('disconnected')
      }
      return
    }

    // Build the relay URL — if the config gives a relative URL or just a path,
    // construct a full WebSocket URL from the current host.
    let wsUrl: string
    if (relayUrl.startsWith('ws://') || relayUrl.startsWith('wss://')) {
      wsUrl = relayUrl
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      wsUrl = `${protocol}//${window.location.host}${relayUrl}`
    }

    const manager = new RelayManager({
      relayUrl: wsUrl,
      serverPubkey,
      getPubkey: () => getPubkeyRef.current(),
      signEvent: (messageHex: string) => signEventRef.current(messageHex),
      getHubKey: (hubId: string) => getHubKeyRef.current(hubId),
      onStateChange: setState,
    })

    relayRef.current = manager
    manager.connect().catch(() => {
      // Reconnection is handled internally by RelayManager
    })

    return () => {
      manager.close()
      relayRef.current = null
      setState('disconnected')
    }
  }, [isAuthenticated, relayUrl, serverPubkey])

  return (
    <NostrContext.Provider value={{ relay: relayRef.current, state }}>
      {children}
    </NostrContext.Provider>
  )
}

/** Access the RelayManager instance (null when no relay is configured or disconnected) */
export function useRelay(): RelayManager | null {
  return useContext(NostrContext).relay
}

/** Current relay connection state */
export function useRelayState(): RelayState {
  return useContext(NostrContext).state
}
