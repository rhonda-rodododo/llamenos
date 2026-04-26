/**
 * React Query hooks for call resource management.
 *
 * Call records have admin-only envelope-encrypted metadata
 * (answeredBy, callerNumber) decrypted client-side via HPKE.
 */

import { queryOptions, useQuery } from '@tanstack/react-query'
import {
  type ActiveCall,
  type CallRecord,
  getCallHistory,
  getCallsTodayCount,
  getUserPresence,
  listActiveCalls,
  type UserPresence,
} from '@/lib/api'
import { decryptCallRecord } from '@/lib/crypto-worker-helpers'
import * as keyManager from '@/lib/key-manager'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CallHistoryFilters = {
  page?: number
  limit?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  voicemailOnly?: boolean
}

// ---------------------------------------------------------------------------
// callHistoryOptions
// ---------------------------------------------------------------------------

/**
 * Fetch call history with optional filters. Decrypts encrypted call record
 * metadata (answeredBy, callerNumber) via admin ECIES envelopes when unlocked.
 */
const callHistoryOptions = (filters?: CallHistoryFilters) =>
  queryOptions({
    queryKey: queryKeys.calls.history(filters),
    queryFn: async (): Promise<{ calls: CallRecord[]; total: number }> => {
      const res = await getCallHistory(filters)
      const pubkey = await keyManager.getPublicKeyHex()
      const unlocked = pubkey ? await keyManager.isUnlocked() : false

      if (!pubkey || !unlocked) return res

      const decrypted: CallRecord[] = []
      for (const call of res.calls) {
        if (call.answeredBy !== undefined) {
          decrypted.push(call)
          continue
        }
        if (!call.encryptedContent || !call.adminEnvelopes?.length) {
          decrypted.push(call)
          continue
        }
        const env = call.adminEnvelopes?.find((e) => e.pubkey === pubkey)
        if (!env) {
          decrypted.push(call)
          continue
        }
        // @ts-expect-error Slice 4: adminEnvelopes will carry HpkeEnvelope per recipient
        const meta = await decryptCallRecord(env, call.id)
        if (meta) {
          decrypted.push({ ...call, answeredBy: meta.answeredBy, callerNumber: meta.callerNumber })
        } else {
          decrypted.push(call)
        }
      }

      return { calls: decrypted, total: res.total }
    },
  })

// ---------------------------------------------------------------------------
// useCallHistory
// ---------------------------------------------------------------------------

export function useCallHistory(filters?: CallHistoryFilters) {
  return useQuery(callHistoryOptions(filters))
}

// ---------------------------------------------------------------------------
// activeCallsOptions
// ---------------------------------------------------------------------------

/**
 * staleTime=0 ensures the data is always considered stale (Nostr is primary
 * for real-time updates; this is the REST fallback/seed).
 * refetchInterval=30_000 polls every 30s as a safety net.
 */
const activeCallsOptions = () =>
  queryOptions({
    queryKey: queryKeys.calls.active(),
    queryFn: async (): Promise<ActiveCall[]> => {
      const { calls } = await listActiveCalls()
      return calls
    },
    staleTime: 0,
    refetchInterval: 30_000,
  })

// ---------------------------------------------------------------------------
// useActiveCalls
// ---------------------------------------------------------------------------

/**
 * Fetch the current list of active/ringing calls.
 */
export function useActiveCalls() {
  return useQuery(activeCallsOptions())
}

// ---------------------------------------------------------------------------
// callsTodayCountOptions
// ---------------------------------------------------------------------------

/**
 * Refreshes every 60s — used by dashboard stats.
 */
const callsTodayCountOptions = () =>
  queryOptions({
    queryKey: queryKeys.calls.todayCount(),
    queryFn: async (): Promise<number> => {
      const { count } = await getCallsTodayCount()
      return count
    },
    staleTime: 60_000,
  })

// ---------------------------------------------------------------------------
// useCallsTodayCount
// ---------------------------------------------------------------------------

/**
 * Fetch the number of calls received today.
 */
export function useCallsTodayCount() {
  return useQuery(callsTodayCountOptions())
}

// ---------------------------------------------------------------------------
// presenceOptions
// ---------------------------------------------------------------------------

/**
 * Refreshes every 15s to keep the dashboard sidebar current.
 */
const presenceOptions = () =>
  queryOptions({
    queryKey: queryKeys.presence.list(),
    queryFn: async (): Promise<UserPresence[]> => {
      const { users } = await getUserPresence()
      return users
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

// ---------------------------------------------------------------------------
// usePresence
// ---------------------------------------------------------------------------

/**
 * Fetch user presence/availability (admin only).
 */
export function usePresence() {
  return useQuery(presenceOptions())
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { ActiveCall, CallRecord, UserPresence }
