/**
 * React hooks for Nostr relay subscriptions.
 */

import { useEffect, useRef } from 'react'
import { useRelay, useRelayState } from './context'
import type { NostrEventHandler } from './types'

/**
 * Subscribe to Nostr events for a specific hub.
 *
 * Automatically manages subscription lifecycle: subscribes when the relay
 * is connected, unsubscribes on unmount or when deps change.
 *
 * @param hubId - Hub to subscribe to (from config)
 * @param kinds - Nostr event kinds to listen for
 * @param handler - Callback receiving (raw Nostr event, decrypted Llamenos event)
 * @param enabled - Set to false to disable the subscription (default: true)
 */
export function useNostrSubscription(
  hubId: string | undefined,
  kinds: number[],
  handler: NostrEventHandler,
  enabled = true
): void {
  const relay = useRelay()
  const state = useRelayState()
  // Keep handler ref stable to avoid resubscribing on every render
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!relay || !hubId || !enabled || state !== 'connected') return

    const subId = relay.subscribe(hubId, kinds, (event, content) => {
      handlerRef.current(event, content)
    })

    return () => {
      relay.unsubscribe(subId)
    }
    // Resubscribe when relay instance, hub, kinds, or enabled state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relay, hubId, kinds.join(','), enabled, state])
}

/**
 * Subscribe to Nostr events for multiple hubs simultaneously.
 *
 * Used to receive call and conversation events from all hubs the user belongs
 * to, not just the currently active hub. Each hub gets its own subscription.
 *
 * @param hubIds - Array of hub IDs to subscribe to
 * @param kinds - Nostr event kinds to listen for
 * @param handler - Callback receiving (raw Nostr event, decrypted Llamenos event)
 * @param enabled - Set to false to disable all subscriptions (default: true)
 */
function useMultiHubNostrSubscription(
  hubIds: string[] | undefined,
  kinds: number[],
  handler: NostrEventHandler,
  enabled = true
): void {
  const relay = useRelay()
  const state = useRelayState()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  // Stable key for dependency comparison — avoids resubscribing on array identity changes
  const hubIdsKey = hubIds?.join(',') ?? ''

  useEffect(() => {
    if (!relay || !hubIds?.length || !enabled || state !== 'connected') return

    const subIds = hubIds.map((hubId) =>
      relay.subscribe(hubId, kinds, (event, content) => {
        handlerRef.current(event, content)
      })
    )

    return () => {
      for (const subId of subIds) relay.unsubscribe(subId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relay, hubIdsKey, kinds.join(','), enabled, state])
}
