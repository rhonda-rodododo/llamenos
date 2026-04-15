/**
 * Nostr client types for the Llamenos relay integration.
 */

import type { Event as NostrEvent } from 'nostr-tools/core'

/** Decrypted event content with type discriminator */
export interface LlamenosEvent {
  type: string
  [key: string]: unknown
}

/** Call ring notification */
interface CallRingEvent extends LlamenosEvent {
  type: 'call:ring'
  callId: string
  callerLast4?: string
  startedAt: string
}

/** Call answered notification */
interface CallAnsweredEvent extends LlamenosEvent {
  type: 'call:answered'
  callId: string
  userPubkey: string
}

/** Call ended notification */
interface CallEndedEvent extends LlamenosEvent {
  type: 'call:ended'
  callId: string
}

/** Call update (status change) */
interface CallUpdateEvent extends LlamenosEvent {
  type: 'call:update'
  callId: string
  status: string
  answeredBy?: string
}

/** Voicemail notification */
interface VoicemailEvent extends LlamenosEvent {
  type: 'voicemail:new'
  callId: string
  startedAt: string
}

/** Presence summary (all hub members) */
interface PresenceSummaryEvent extends LlamenosEvent {
  type: 'presence:summary'
  hasAvailable: boolean
}

/** Presence detail (admins only) */
interface PresenceDetailEvent extends LlamenosEvent {
  type: 'presence:detail'
  available: number
  onCall: number
  total: number
}

/** New conversation message */
interface MessageNewEvent extends LlamenosEvent {
  type: 'message:new'
  conversationId: string
  channelType: string
}

/** Conversation assigned */
interface ConversationAssignedEvent extends LlamenosEvent {
  type: 'conversation:assigned'
  conversationId: string
  assignedTo: string
}

/** Conversation closed */
interface ConversationClosedEvent extends LlamenosEvent {
  type: 'conversation:closed'
  conversationId: string
}

/** New conversation */
interface ConversationNewEvent extends LlamenosEvent {
  type: 'conversation:new'
  conversationId: string
}

/** Message delivery status update */
interface MessageStatusEvent extends LlamenosEvent {
  type: 'message:status'
  conversationId: string
  messageId: string
  status: string
}

/** Nostr relay connection state */
export type RelayState = 'disconnected' | 'connecting' | 'connected' | 'authenticating'

/** Event handler type */
export type NostrEventHandler = (event: NostrEvent, content: LlamenosEvent) => void
