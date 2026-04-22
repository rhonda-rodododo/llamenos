/**
 * React Query hooks for invite management.
 *
 * List queries decrypt PII fields (name/phone) via the crypto worker
 * when the key manager is unlocked. Mutations invalidate the full
 * invites cache on success.
 */

import { LABEL_USER_PII } from '@shared/crypto-labels'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createInvite,
  getAvailableInviteChannels,
  type InviteCode,
  type InviteDeliveryChannel,
  listInvites,
  revokeInvite,
  sendInvite,
} from '@/lib/api'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// invitesListOptions
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt the full pending invite list.
 * Invite name/phone fields are encrypted with LABEL_USER_PII.
 */
const invitesListOptions = () =>
  queryOptions({
    queryKey: queryKeys.invites.list(),
    queryFn: async () => {
      const { invites } = await listInvites()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          invites as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_USER_PII
        )
      }
      return invites
    },
  })

// ---------------------------------------------------------------------------
// useInvites
// ---------------------------------------------------------------------------

export function useInvites() {
  return useQuery(invitesListOptions())
}

// ---------------------------------------------------------------------------
// inviteChannelsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch available invite delivery channels (Signal, WhatsApp, SMS).
 * Stale for 10 minutes since channel availability rarely changes.
 */
const inviteChannelsOptions = () =>
  queryOptions({
    queryKey: queryKeys.invites.channels(),
    queryFn: () =>
      getAvailableInviteChannels().catch(() => ({ signal: false, whatsapp: false, sms: false })),
    staleTime: 10 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useInviteChannels
// ---------------------------------------------------------------------------

export function useInviteChannels() {
  return useQuery(inviteChannelsOptions())
}

// ---------------------------------------------------------------------------
// useCreateInvite
// ---------------------------------------------------------------------------

export function useCreateInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; phone: string; roleIds: string[] }) => createInvite(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useRevokeInvite
// ---------------------------------------------------------------------------

export function useRevokeInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => revokeInvite(code),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useSendInvite
// ---------------------------------------------------------------------------

export function useSendInvite() {
  return useMutation({
    mutationFn: ({
      code,
      data,
    }: {
      code: string
      data: {
        recipientPhone: string
        channel: InviteDeliveryChannel
        acknowledgedInsecure?: boolean
      }
    }) => sendInvite(code, data),
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { InviteCode, InviteDeliveryChannel }
