/**
 * React Query hooks for hub resource management.
 *
 * Hubs are configuration objects -- names are hub-encrypted and
 * decrypted in the queryFn so the cache holds plaintext values.
 * Cache is long-lived (10 min) since hubs rarely change.
 * Mutations invalidate the full hubs cache on success.
 *
 * Archive/delete mutations also immediately remove the hub from the cache
 * to match the original useState behavior (filter out archived/deleted hubs).
 * The server returns all hubs (including archived) for super admins, so without
 * the immediate cache update, the hub would reappear after the invalidation refetch.
 */

import { archiveHub, createHub, deleteHub, listHubs, updateHub } from '@/lib/api'
import { cryptoWorker } from '@/lib/crypto-worker-client'
import { getDeviceKeypair } from '@/lib/device-identity-store'
import { decryptHubField } from '@/lib/hub-field-crypto'
import { bootstrapMlsForNewHub } from '@/lib/mls/hub-bootstrap'
import type { Hub } from '@shared/schemas'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// hubsListOptions
// ---------------------------------------------------------------------------

const hubsListOptions = (_hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.hubs.list(),
    queryFn: async () => {
      const { hubs } = await listHubs()
      return Promise.all(
        hubs.map(async (hub) => ({
          ...hub,
          name: await decryptHubField(hub.encryptedName, hub.id, hub.id, 'encrypted_name'),
          description: await decryptHubField(
            hub.encryptedDescription,
            hub.id,
            hub.id,
            'encrypted_description'
          ),
        }))
      )
    },
    staleTime: 10 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useHubs
// ---------------------------------------------------------------------------

export function useHubs(hubId = 'global') {
  return useQuery(hubsListOptions(hubId))
}

// ---------------------------------------------------------------------------
// useCreateHub
// ---------------------------------------------------------------------------

export function useCreateHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; description?: string; phoneNumber?: string }) =>
      createHub(data),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })

      // Bootstrap MLS group for the new hub (fire-and-forget — failure is non-fatal)
      if (result.hub?.id && cryptoWorker) {
        void (async () => {
          const keypair = await getDeviceKeypair()
          if (!keypair) return
          await bootstrapMlsForNewHub(result.hub.id, cryptoWorker, keypair.deviceId)
        })()
      }
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateHub
// ---------------------------------------------------------------------------

export function useUpdateHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Hub> }) => updateHub(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteHub
// ---------------------------------------------------------------------------

export function useDeleteHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteHub(id),
    onSuccess: (_result, id) => {
      // Immediately remove the deleted hub from cache so it disappears from the UI.
      // No immediate invalidation: the server-side list is now stale but since deleted
      // hubs are gone for good, the next navigation will fetch fresh data naturally.
      queryClient.setQueryData<Hub[]>(queryKeys.hubs.list(), (old) =>
        old?.filter((h) => h.id !== id)
      )
    },
  })
}

// ---------------------------------------------------------------------------
// useArchiveHub
// ---------------------------------------------------------------------------

export function useArchiveHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => archiveHub(id),
    onSuccess: (_result, id) => {
      // Immediately remove the archived hub from the cache so it disappears from the UI
      // (matches original useState behavior: setHubs(prev => prev.filter(h => h.id !== id))).
      // No immediate invalidation: the server returns all hubs (including archived) for super
      // admins, so calling invalidateQueries would immediately re-add the archived hub via
      // background refetch, undoing the optimistic removal. The next page navigation triggers
      // a fresh fetch which correctly shows archived hubs with their archived badge.
      queryClient.setQueryData<Hub[]>(queryKeys.hubs.list(), (old) =>
        old?.filter((h) => h.id !== id)
      )
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { Hub }
