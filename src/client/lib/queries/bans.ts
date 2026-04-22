/**
 * React Query hooks for ban list resource management.
 *
 * Ban entries contain HMAC-encrypted phone numbers. Mutations
 * invalidate the full bans cache on success.
 */

import { LABEL_USER_PII } from '@shared/crypto-labels'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addBan,
  addGlobalBan,
  type BanEntry,
  bulkAddBans,
  bulkAddGlobalBans,
  listBans,
  listGlobalBans,
  removeBan,
  removeGlobalBan,
} from '@/lib/api'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// bansListOptions
// ---------------------------------------------------------------------------

const bansListOptions = () =>
  queryOptions({
    queryKey: queryKeys.bans.list(),
    queryFn: async () => {
      const { bans } = await listBans()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        // Ban phone/reason fields use LABEL_USER_PII envelope encryption
        await decryptArrayFields(
          bans as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_USER_PII
        )
      }
      return bans
    },
  })

// ---------------------------------------------------------------------------
// useBans
// ---------------------------------------------------------------------------

export function useBans() {
  return useQuery(bansListOptions())
}

// ---------------------------------------------------------------------------
// useAddBan
// ---------------------------------------------------------------------------

export function useAddBan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ phone, reason }: { phone: string; reason: string }) => addBan({ phone, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useBulkAddBans
// ---------------------------------------------------------------------------

export function useBulkAddBans() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ phones, reason }: { phones: string[]; reason: string }) =>
      bulkAddBans({ phones, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useRemoveBan
// ---------------------------------------------------------------------------

export function useRemoveBan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (phone: string) => removeBan(phone),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Global (platform) bans — super-admin only
// ---------------------------------------------------------------------------
//
// Hits the un-prefixed /bans endpoint, which reads/writes rows with
// `hub_id = 'global'` on the server. A distinct query key from the hub-scoped
// `list()` so cache writes don't cross-contaminate the two views.

const globalBansListOptions = () =>
  queryOptions({
    queryKey: queryKeys.bans.globalList(),
    queryFn: async () => {
      const { bans } = await listGlobalBans()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          bans as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_USER_PII
        )
      }
      return bans
    },
  })

export function useGlobalBans() {
  return useQuery(globalBansListOptions())
}

export function useAddGlobalBan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ phone, reason }: { phone: string; reason: string }) =>
      addGlobalBan({ phone, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.globalList() })
    },
  })
}

export function useBulkAddGlobalBans() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ phones, reason }: { phones: string[]; reason: string }) =>
      bulkAddGlobalBans({ phones, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.globalList() })
    },
  })
}

export function useRemoveGlobalBan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (phone: string) => removeGlobalBan(phone),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.globalList() })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { BanEntry }
