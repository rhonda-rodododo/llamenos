import { useState, useEffect, useCallback, useRef } from 'react'
import { onMessage, sendMessage } from './ws'
import { startRinging, stopRinging } from './notifications'
import type { ActiveCall } from './api'

/**
 * Hook to manage real-time call state via WebSocket.
 */
export function useCalls() {
  const [calls, setCalls] = useState<ActiveCall[]>([])
  const [currentCall, setCurrentCall] = useState<ActiveCall | null>(null)

  useEffect(() => {
    // Sync initial state
    const unsubSync = onMessage('calls:sync', (data) => {
      const { calls: syncCalls } = data as { calls: ActiveCall[] }
      setCalls(syncCalls)
    })

    const unsubIncoming = onMessage('call:incoming', (data) => {
      const call = data as ActiveCall
      setCalls(prev => [...prev, call])
      // Start ringing notification
      startRinging(
        call.callerNumber || 'Unknown',
        'Incoming Call!'
      )
    })

    const unsubUpdate = onMessage('call:update', (data) => {
      const call = data as ActiveCall
      setCalls(prev => {
        if (call.status === 'completed') {
          return prev.filter(c => c.id !== call.id)
        }
        const idx = prev.findIndex(c => c.id === call.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = call
          return next
        }
        return [...prev, call]
      })

      // Stop ringing when call is answered or completed
      if (call.status === 'in-progress' || call.status === 'completed') {
        stopRinging()
      }

      // Update current call if it's the one we're on
      if (currentCall?.id === call.id) {
        if (call.status === 'completed') {
          setCurrentCall(null)
        } else {
          setCurrentCall(call)
        }
      }
    })

    return () => {
      unsubSync()
      unsubIncoming()
      unsubUpdate()
    }
  }, [currentCall])

  const answerCall = useCallback((callId: string) => {
    sendMessage('call:answer', { callId })
    stopRinging()
    const call = calls.find(c => c.id === callId)
    if (call) {
      setCurrentCall({ ...call, status: 'in-progress' })
    }
  }, [calls])

  const hangupCall = useCallback((callId: string) => {
    sendMessage('call:hangup', { callId })
    setCurrentCall(null)
  }, [])

  const reportSpam = useCallback((callId: string) => {
    sendMessage('call:reportSpam', { callId })
    setCurrentCall(null)
  }, [])

  return {
    calls,
    currentCall,
    answerCall,
    hangupCall,
    reportSpam,
    ringingCalls: calls.filter(c => c.status === 'ringing'),
    activeCalls: calls.filter(c => c.status === 'in-progress'),
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
