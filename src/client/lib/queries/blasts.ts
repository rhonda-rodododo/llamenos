/**
 * React Query hooks for blast messaging resource management.
 *
 * Blast content is E2EE — decrypted client-side via ECIES envelopes
 * when the key manager is unlocked.
 */

import type { Blast, BlastContent, BlastSettings, Subscriber } from '@shared/types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelBlast,
  deleteBlast,
  getBlastSettings,
  getSubscriberStats,
  listBlasts,
  listSubscribers,
  sendBlast,
  updateBlastSettings,
} from '@/lib/api'
import { decryptBlastContent } from '@/lib/crypto-worker-helpers'
import { decryptHubField } from '@/lib/hub-field-crypto'
import * as keyManager from '@/lib/key-manager'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DecryptedBlastContent = Record<string, BlastContent | null>

interface SubscriberStatsData {
  total: number
  active: number
  paused: number
  byChannel: Record<string, number>
}

// ---------------------------------------------------------------------------
// blastsListOptions
// ---------------------------------------------------------------------------

/**
 * Fetch all blasts and decrypt their content when the key manager is unlocked.
 * Returns both the raw blast array and a map of decrypted content keyed by blast id.
 */
const blastsListOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.blasts.list(),
    queryFn: async (): Promise<{ blasts: Blast[]; decryptedContent: DecryptedBlastContent }> => {
      const res = await listBlasts()
      const blasts = await Promise.all(
        res.blasts.map(async (blast) => ({
          ...blast,
          name: await decryptHubField(blast.encryptedName, hubId, blast.id, 'encrypted_name'),
        }))
      )

      const unlocked = await keyManager.isUnlocked()
      if (!unlocked) return { blasts, decryptedContent: {} }

      const pk = await keyManager.getPublicKeyHex()
      if (!pk) return { blasts, decryptedContent: {} }

      const decryptedContent: DecryptedBlastContent = {}
      for (const blast of blasts) {
        if (blast.encryptedContent && blast.contentEnvelopes?.length) {
          decryptedContent[blast.id] = await decryptBlastContent(
            blast.encryptedContent,
            blast.contentEnvelopes,
            pk
          )
        }
      }

      return { blasts, decryptedContent }
    },
  })

// ---------------------------------------------------------------------------
// useBlasts
// ---------------------------------------------------------------------------

export function useBlasts(hubId = 'global') {
  return useQuery(blastsListOptions(hubId))
}

// ---------------------------------------------------------------------------
// blastSettingsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch blast settings with a 10-minute stale window.
 */
const blastSettingsOptions = () =>
  queryOptions({
    queryKey: queryKeys.blasts.settings(),
    queryFn: (): Promise<BlastSettings> => getBlastSettings(),
    staleTime: 10 * 60_000,
  })

// ---------------------------------------------------------------------------
// useBlastSettings
// ---------------------------------------------------------------------------

export function useBlastSettings() {
  return useQuery(blastSettingsOptions())
}

// ---------------------------------------------------------------------------
// subscribersListOptions
// ---------------------------------------------------------------------------

/**
 * Fetch the subscriber list.
 */
const subscribersListOptions = () =>
  queryOptions({
    queryKey: queryKeys.blasts.subscribers(),
    queryFn: async (): Promise<Subscriber[]> => {
      const res = await listSubscribers()
      return res.subscribers
    },
  })

// ---------------------------------------------------------------------------
// useSubscribers
// ---------------------------------------------------------------------------

export function useSubscribers() {
  return useQuery(subscribersListOptions())
}

// ---------------------------------------------------------------------------
// subscriberStatsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch aggregate subscriber statistics.
 */
const subscriberStatsOptions = () =>
  queryOptions({
    queryKey: queryKeys.blasts.subscriberStats(),
    queryFn: (): Promise<SubscriberStatsData> => getSubscriberStats(),
  })

// ---------------------------------------------------------------------------
// useSubscriberStats
// ---------------------------------------------------------------------------

export function useSubscriberStats() {
  return useQuery(subscriberStatsOptions())
}

// ---------------------------------------------------------------------------
// useSendBlast
// ---------------------------------------------------------------------------

export function useSendBlast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sendBlast(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteBlast
// ---------------------------------------------------------------------------

export function useDeleteBlast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBlast(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useCancelBlast
// ---------------------------------------------------------------------------

export function useCancelBlast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelBlast(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateBlastSettings
// ---------------------------------------------------------------------------

export function useUpdateBlastSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<BlastSettings>) => updateBlastSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.settings() })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { Blast, BlastSettings, Subscriber }
