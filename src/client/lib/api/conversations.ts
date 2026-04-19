import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { hp, request } from './client'

// --- Types ---

export interface Conversation {
  id: string
  channelType: string
  contactIdentifierHash: string
  contactLast4?: string
  assignedTo?: string
  status: 'active' | 'waiting' | 'closed'
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  messageCount: number
  metadata?: {
    linkedCallId?: string
    reportId?: string
    type?: 'report'
    reportTitle?: string
    reportCategory?: string
  }
  // E2EE envelope-encrypted contactLast4 (Phase 2D)
  encryptedContactLast4?: Ciphertext
  contactLast4Envelopes?: RecipientEnvelope[]
}

export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

/** ECIES-wrapped message key for a specific reader. */
export interface MessageKeyEnvelope {
  pubkey: string // reader's x-only pubkey (hex)
  wrappedKey: Ciphertext // hex: nonce(24) + ciphertext(48)
  ephemeralPubkey: string // hex: compressed 33-byte ephemeral pubkey
}

export interface ConversationMessage {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound'
  authorPubkey: string
  encryptedContent: Ciphertext // hex: nonce(24) + ciphertext (XChaCha20-Poly1305)
  readerEnvelopes: MessageKeyEnvelope[] // per-reader ECIES-wrapped message keys
  hasAttachments: boolean
  attachmentIds?: string[]
  // Delivery status tracking (Epic 71)
  status?: MessageDeliveryStatus
  /** Alias for status — used by UI delivery indicators. */
  deliveryStatus?: MessageDeliveryStatus
  deliveredAt?: string
  readAt?: string
  failureReason?: string
  /** Alias for failureReason — used by UI delivery indicators. */
  deliveryError?: string
  retryCount?: number
  createdAt: string
  externalId?: string
}

// --- Conversations ---

export async function listConversations(params?: {
  status?: string
  channel?: string
  page?: number
  limit?: number
}) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.channel) qs.set('channel', params.channel)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{
    conversations: Conversation[]
    total?: number
    assignedCount?: number
    waitingCount?: number
  }>(hp(`/conversations?${qs}`))
}

export async function getConversation(id: string) {
  return request<Conversation>(hp(`/conversations/${id}`))
}

export async function getConversationMessages(
  id: string,
  params?: { page?: number; limit?: number }
) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ messages: ConversationMessage[]; total: number }>(
    hp(`/conversations/${id}/messages?${qs}`)
  )
}

export async function sendConversationMessage(
  id: string,
  data: {
    encryptedContent: Ciphertext
    readerEnvelopes: MessageKeyEnvelope[]
    plaintextForSending?: string
  }
) {
  return request<ConversationMessage>(hp(`/conversations/${id}/messages`), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function claimConversation(id: string) {
  return request<Conversation>(hp(`/conversations/${id}/claim`), { method: 'POST' })
}

export async function updateConversation(
  id: string,
  data: { status?: string; assignedTo?: string }
) {
  return request<Conversation>(hp(`/conversations/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getConversationStats() {
  return request<{ waiting: number; active: number; closed: number; today: number; total: number }>(
    hp('/conversations/stats')
  )
}

export async function getUserLoads() {
  return request<{ loads: Record<string, number> }>(hp('/conversations/load'))
}
