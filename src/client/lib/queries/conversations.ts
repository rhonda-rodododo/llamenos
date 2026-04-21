/**
 * React Query hooks for conversations resource management.
 *
 * Messages use MLS group encryption (Slice 6).
 * Inbound messages arrive server-encrypted; the first client to fetch
 * claims them by decrypting the server blob, re-encrypting via MLS,
 * and PATCHing the record back.
 *
 * Real-time updates arrive via Nostr (useConversations in hooks.ts);
 * these hooks provide the React Query cache layer that Nostr events invalidate.
 */

import {
  type Conversation,
  type ConversationMessage,
  claimConversation,
  claimMessage,
  getConversationMessages,
  getUserLoads,
  listConversations,
  sendConversationMessage,
  updateConversation,
  upgradeMessageToMls,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { getMlsConversation } from '@/lib/mls/get-mls-conversation'
import * as mlsApi from '@/lib/mls/mls-api-client'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DecryptedConversationMessages {
  messages: ConversationMessage[]
  decryptedContent: Map<string, string>
}

type ConversationMessagesAuth = {
  hasNsec: boolean
  hubId: string | undefined
}

// ---------------------------------------------------------------------------
// conversationsListOptions
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt the conversation list.
 * Decrypts PII fields (contactLast4, etc.) via decryptArrayFields + LABEL_USER_PII.
 * staleTime=0: Nostr is primary for real-time updates; REST is the fallback/seed.
 * refetchInterval=30_000 polls every 30s as safety net.
 */
const conversationsListOptions = () =>
  queryOptions({
    queryKey: queryKeys.conversations.list(),
    queryFn: async (): Promise<Conversation[]> => {
      const { conversations } = await listConversations()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          conversations as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_USER_PII
        )
      }
      return conversations
    },
    staleTime: 0,
    refetchInterval: 30_000,
  })

// ---------------------------------------------------------------------------
// useConversationsList
// ---------------------------------------------------------------------------

export function useConversationsList() {
  return useQuery(conversationsListOptions())
}

// ---------------------------------------------------------------------------
// conversationMessagesOptions
// ---------------------------------------------------------------------------

/**
 * queryOptions factory for conversation messages.
 * auth values must be passed explicitly since queryOptions cannot call React hooks.
 */
const conversationMessagesOptions = (
  conversationId: string | null,
  auth: ConversationMessagesAuth
) =>
  queryOptions({
    queryKey: conversationId
      ? queryKeys.conversations.messages(conversationId)
      : ['conversations', 'messages', null],
    enabled: !!conversationId,
    queryFn: async (): Promise<DecryptedConversationMessages> => {
      if (!conversationId) return { messages: [], decryptedContent: new Map() }

      const { hasNsec, hubId } = auth
      const { messages } = await getConversationMessages(conversationId, { limit: 100 })
      const decryptedContent = new Map<string, string>()

      const unlocked = hasNsec ? await keyManager.isUnlocked() : false
      const mlsConv = unlocked && hubId ? await getMlsConversation(hubId) : null

      if (mlsConv) {
        for (const msg of messages) {
          if (msg.mlsCiphertext) {
            try {
              const result = await mlsConv.decrypt(mlsApi.fromBase64(msg.mlsCiphertext))
              if (result.message) {
                decryptedContent.set(msg.id, new TextDecoder().decode(result.message))
              }
            } catch {
              // Decryption failed — leave as encrypted
            }
          } else if (msg.serverEncryptedBody) {
            // Claim: server decrypts and returns plaintext, client re-encrypts via MLS
            try {
              const { plaintext } = await claimMessage(conversationId, msg.id)
              const mlsBytes = await mlsConv.encrypt(new TextEncoder().encode(plaintext))
              const mlsCiphertext = mlsApi.toBase64(mlsBytes)
              const epoch = await mlsConv.currentEpoch()

              // Upgrade the message on the server
              await upgradeMessageToMls(conversationId, msg.id, {
                mlsCiphertext,
                mlsEpoch: epoch,
              })

              decryptedContent.set(msg.id, plaintext)
            } catch {
              // Claim failed — leave as encrypted
            }
          }
        }
      }

      return { messages, decryptedContent }
    },
    staleTime: 0,
  })

// ---------------------------------------------------------------------------
// useConversationMessages
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt messages for a selected conversation.
 * Only enabled when a conversationId is provided.
 * Returns messages + a Map of decrypted content keyed by message id.
 */
export function useConversationMessages(conversationId: string | null) {
  const { hasNsec } = useAuth()
  const { currentHubId } = useConfig()
  return useQuery(conversationMessagesOptions(conversationId, { hasNsec, hubId: currentHubId }))
}

// ---------------------------------------------------------------------------
// useSendConversationMessage
// ---------------------------------------------------------------------------

/**
 * Mutation to send an encrypted message to a conversation.
 * Invalidates the messages cache for the specific conversation on success.
 */
export function useSendConversationMessage(conversationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof sendConversationMessage>[1]) =>
      sendConversationMessage(conversationId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(conversationId),
      })
    },
  })
}

// ---------------------------------------------------------------------------
// useClaimConversation
// ---------------------------------------------------------------------------

/**
 * Mutation to claim (self-assign) a waiting conversation.
 * Invalidates the full conversations cache on success.
 */
export function useClaimConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: string) => claimConversation(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateConversation
// ---------------------------------------------------------------------------

/**
 * Mutation to update a conversation (status, assignedTo).
 * Invalidates the full conversations cache on success.
 */
export function useUpdateConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      conversationId,
      data,
    }: {
      conversationId: string
      data: Parameters<typeof updateConversation>[1]
    }) => updateConversation(conversationId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
  })
}

// ---------------------------------------------------------------------------
// conversationLoadsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch per-user conversation load counts (how many active conversations each
 * user is currently handling). Used to surface load-balancing indicators.
 * Polls every 30s alongside Nostr real-time events.
 */
const conversationLoadsOptions = () =>
  queryOptions({
    queryKey: queryKeys.conversations.loads(),
    queryFn: async (): Promise<Record<string, number>> => {
      const { loads } = await getUserLoads()
      return loads
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

// ---------------------------------------------------------------------------
// useConversationLoads
// ---------------------------------------------------------------------------

export function useConversationLoads() {
  return useQuery(conversationLoadsOptions())
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { Conversation, ConversationMessage }
