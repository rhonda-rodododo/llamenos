/**
 * React Query hooks for user resource management.
 *
 * All list/detail queries decrypt PII fields via the crypto worker
 * when the key manager is unlocked. Mutations invalidate the full
 * users cache on success.
 */

import {
  type User,
  createUser,
  deleteUser,
  getUserUnmasked,
  listUsers,
  updateUser,
} from '@/lib/api'
import { decryptArrayFields, decryptObjectFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// usersListOptions
// ---------------------------------------------------------------------------

const usersListOptions = () =>
  queryOptions({
    queryKey: queryKeys.users.list(),
    queryFn: async () => {
      const { users } = await listUsers()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          users as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_USER_PII
        )
      }
      return users
    },
  })

// ---------------------------------------------------------------------------
// useUsers
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt the full user list.
 * Returns already-decrypted User objects — no further decryption needed
 * by consumers (e.g. UserMultiSelect).
 */
export function useUsers() {
  return useQuery(usersListOptions())
}

// ---------------------------------------------------------------------------
// userDetailOptions
// ---------------------------------------------------------------------------

const userDetailOptions = (pubkey: string) =>
  queryOptions({
    queryKey: queryKeys.users.detail(pubkey),
    queryFn: async () => {
      const { user } = await getUserUnmasked(pubkey)
      const readerPubkey = await keyManager.getPublicKeyHex()
      if (readerPubkey && (await keyManager.isUnlocked())) {
        await decryptObjectFields(
          user as unknown as Record<string, unknown>,
          readerPubkey,
          LABEL_USER_PII
        )
      }
      return user
    },
    enabled: !!pubkey,
  })

// ---------------------------------------------------------------------------
// useUser
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt a single user's unmasked data (admin only).
 */
export function useUser(pubkey: string) {
  return useQuery(userDetailOptions(pubkey))
}

// ---------------------------------------------------------------------------
// useCreateUser
// ---------------------------------------------------------------------------

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateUser
// ---------------------------------------------------------------------------

export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pubkey, data }: { pubkey: string; data: Parameters<typeof updateUser>[1] }) =>
      updateUser(pubkey, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteUser
// ---------------------------------------------------------------------------

export function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pubkey: string) => deleteUser(pubkey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export User type for convenience
// ---------------------------------------------------------------------------
export type { User }
