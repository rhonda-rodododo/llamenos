import {
  KIND_CALL_RING,
  KIND_CALL_UPDATE,
  KIND_CALL_VOICEMAIL,
  KIND_CONVERSATION_ASSIGNED,
  KIND_MESSAGE_NEW,
  KIND_PRESENCE_UPDATE,
} from '@shared/nostr-events'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ActiveCall,
  answerCall as apiAnswerCall,
  hangupCall as apiHangupCall,
  reportCallSpam as apiReportSpam,
} from './api'
import { useConfig } from './config'
import { useNostrSubscription } from './nostr/hooks'
import type { LlamenosEvent } from './nostr/types'
import { startRinging, stopRinging } from './notifications'
import { useActiveCalls } from './queries/calls'
import { useConversationsList } from './queries/conversations'
import { queryKeys } from './queries/keys'
import { useShiftStatus as useShiftStatusQuery } from './queries/shifts'
import { acceptCall as acceptWebRtcCall, hasIncomingCall } from './webrtc/manager'

/** All call-related Nostr event kinds */
const CALL_KINDS = [KIND_CALL_RING, KIND_CALL_UPDATE, KIND_CALL_VOICEMAIL, KIND_PRESENCE_UPDATE]

/** All conversation-related Nostr event kinds */
const CONVERSATION_KINDS = [KIND_MESSAGE_NEW, KIND_CONVERSATION_ASSIGNED]

/**
 * Hook to manage real-time call state via Nostr relay + React Query REST polling fallback.
 *
 * Real-time updates arrive via Nostr subscription and are written directly into
 * the React Query cache via `queryClient.setQueryData`. REST polling (every 30s,
 * configured in `useActiveCalls`) acts as a safety net for missed events or relay
 * downtime — no manual `setInterval` needed here.
 *
 * Call actions (answer, hangup, spam) are POST requests to REST endpoints.
 * The server is the sole authority for call state mutations.
 */
export function useCalls() {
  const queryClient = useQueryClient()
  const [currentCall, setCurrentCall] = useState<ActiveCall | null>(null)
  const { currentHubId } = useConfig()
  const currentCallRef = useRef(currentCall)
  currentCallRef.current = currentCall

  // React Query manages the canonical calls list (REST polling every 30s)
  const { data: calls = [] } = useActiveCalls()

  // Clear stale current-call tracking when hub switches
  useEffect(() => {
    setCurrentCall(null)
  }, [])

  // Keep currentCall in sync if it disappears from the active list (e.g. after poll refresh)
  useEffect(() => {
    if (currentCall && !calls.some((c) => c.id === currentCall.id)) {
      setCurrentCall(null)
    }
  }, [calls, currentCall])

  // --- Nostr subscription for real-time call events ---
  // Push updates directly into the React Query cache so all consumers stay in sync.
  useNostrSubscription(currentHubId, CALL_KINDS, (_event, content: LlamenosEvent) => {
    switch (content.type) {
      case 'call:ring': {
        const call = content as LlamenosEvent & {
          callId: string
          callerLast4?: string
          startedAt: string
        }
        queryClient.setQueryData<ActiveCall[]>(queryKeys.calls.active(), (prev = []) => {
          if (prev.some((c) => c.id === call.callId)) return prev
          return [
            ...prev,
            {
              id: call.callId,
              callerNumber: '[redacted]',
              callerLast4: call.callerLast4,
              answeredBy: null,
              startedAt: call.startedAt,
              status: 'ringing' as const,
              hasTranscription: false,
              hasVoicemail: false,
            },
          ]
        })
        startRinging('Incoming Call!')
        break
      }
      case 'call:update': {
        const update = content as LlamenosEvent & {
          callId: string
          status: ActiveCall['status']
          answeredBy?: string
        }
        queryClient.setQueryData<ActiveCall[]>(queryKeys.calls.active(), (prev = []) => {
          if (update.status === 'completed') {
            return prev.filter((c) => c.id !== update.callId)
          }
          return prev.map((c) =>
            c.id === update.callId
              ? { ...c, status: update.status, answeredBy: update.answeredBy ?? c.answeredBy }
              : c
          )
        })
        if (update.status === 'in-progress' || update.status === 'completed') {
          stopRinging()
        }
        // Update current call tracking
        if (currentCallRef.current?.id === update.callId) {
          if (update.status === 'completed') {
            setCurrentCall(null)
          } else {
            setCurrentCall((prev) =>
              prev
                ? {
                    ...prev,
                    status: update.status,
                    answeredBy: update.answeredBy ?? prev.answeredBy,
                  }
                : prev
            )
          }
        }
        break
      }
      case 'voicemail:new': {
        const vm = content as LlamenosEvent & { callId: string }
        queryClient.setQueryData<ActiveCall[]>(queryKeys.calls.active(), (prev = []) =>
          prev.filter((c) => c.id !== vm.callId)
        )
        stopRinging()
        break
      }
    }
  })

  // --- Call actions via REST ---

  const answerCall = useCallback(
    async (callId: string) => {
      stopRinging()
      const call = calls.find((c) => c.id === callId)
      if (call) {
        setCurrentCall({ ...call, status: 'in-progress' })
      }
      try {
        // Capture browser call state once to avoid race with state machine transitions
        const isBrowserCall = hasIncomingCall()
        if (isBrowserCall) acceptWebRtcCall()
        await apiAnswerCall(callId, isBrowserCall ? 'browser' : 'phone')
      } catch {
        // Revert optimistic update on failure
        setCurrentCall(null)
      }
    },
    [calls]
  )

  const hangupCall = useCallback(async (callId: string) => {
    setCurrentCall(null)
    try {
      await apiHangupCall(callId)
    } catch {
      // Call may already be ended — safe to ignore
    }
  }, [])

  const reportSpam = useCallback(async (callId: string) => {
    setCurrentCall(null)
    try {
      await apiReportSpam(callId)
    } catch {
      // Report may fail if call already ended — safe to ignore
    }
  }, [])

  return {
    calls,
    currentCall,
    answerCall,
    hangupCall,
    reportSpam,
    ringingCalls: calls.filter((c) => c.status === 'ringing'),
    activeCalls: calls.filter((c) => c.status === 'in-progress'),
  }
}

/**
 * Hook to fetch and periodically refresh the current user's shift status.
 * Delegates to the React Query hook from queries/shifts (60s polling + stale time).
 */
export function useShiftStatus() {
  const { data, isLoading: loading } = useShiftStatusQuery()
  return {
    onShift: data?.onShift ?? false,
    currentShift: data?.currentShift ?? null,
    nextShift: data?.nextShift ?? null,
    loading,
  }
}

/**
 * Hook to manage real-time conversation state via Nostr relay + React Query REST polling fallback.
 *
 * Real-time updates arrive via Nostr subscription and trigger cache invalidation via
 * `queryClient.invalidateQueries`. The React Query cache (useConversationsList) handles
 * REST polling (every 30s) as a safety net — no manual setInterval needed here.
 *
 * For `message:new` events, the messages query for the specific conversation is also
 * invalidated so the thread refreshes immediately.
 */
export function useConversations() {
  const queryClient = useQueryClient()
  const { currentHubId } = useConfig()

  // React Query manages the canonical conversation list (REST polling every 30s)
  const { data: conversations = [] } = useConversationsList()

  // --- Nostr subscription for real-time conversation events ---
  useNostrSubscription(currentHubId, CONVERSATION_KINDS, (_event, content: LlamenosEvent) => {
    switch (content.type) {
      case 'conversation:new':
      case 'conversation:assigned':
      case 'conversation:closed': {
        // Invalidate the full list so REST refetch picks up the change
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
        break
      }
      case 'message:new': {
        const { conversationId } = content as LlamenosEvent & { conversationId: string }
        // Invalidate list (message count / lastMessageAt changed) and the specific thread
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(conversationId),
        })
        break
      }
    }
  })

  const waitingConversations = conversations.filter((c) => c.status === 'waiting')
  const activeConversations = conversations.filter((c) => c.status === 'active')

  return {
    conversations,
    waitingConversations,
    activeConversations,
  }
}

/**
 * Hook for a call timer.
 */
export function useCallTimer(startedAt: string | null) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0)
      return
    }

    const start = new Date(startedAt).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    intervalRef.current = setInterval(tick, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [startedAt])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return { elapsed, formatted }
}
