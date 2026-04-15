/**
 * React Query hooks for conversations resource management.
 *
 * Conversations use per-message envelope encryption (XChaCha20-Poly1305 + ECIES).
 * The list is decrypted via decryptArrayFields + LABEL_USER_PII.
 * Message decryption is done client-side via decryptMessage().
 *
 * Real-time updates arrive via Nostr (useConversations in hooks.ts);
 * these hooks provide the React Query cache layer that Nostr events invalidate.
 */

import {
  type Conversation,
  type ConversationMessage,
  claimConversation,
  getConversationMessages,
  listConversations,
  sendConversationMessage,
  updateConversation,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptMessage } from '@/lib/crypto-worker-helpers'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
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
  publicKey: string | null
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
export const conversationsListOptions = () =>
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
export const conversationMessagesOptions = (
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

      const { hasNsec, publicKey } = auth
      const { messages } = await getConversationMessages(conversationId, { limit: 100 })
      const decryptedContent = new Map<string, string>()

      const unlocked = hasNsec && publicKey ? await keyManager.isUnlocked() : false
      if (unlocked && publicKey) {
        for (const msg of messages) {
          if (msg.encryptedContent && msg.readerEnvelopes?.length) {
            const plaintext = await decryptMessage(
              msg.encryptedContent,
              msg.readerEnvelopes,
              publicKey
            )
            if (plaintext !== null) {
              decryptedContent.set(msg.id, plaintext)
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
  const { hasNsec, publicKey } = useAuth()
  return useQuery(conversationMessagesOptions(conversationId, { hasNsec, publicKey }))
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
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { Conversation, ConversationMessage }
