import type { Ciphertext } from '@shared/crypto-types'
import type { KeyEnvelope, RecipientEnvelope } from '@shared/types'
import { hp, request } from './client'

// --- Types ---

export interface EncryptedNote {
  id: string
  callId: string
  authorPubkey: string
  encryptedContent?: Ciphertext
  createdAt: string
  updatedAt: string
  ephemeralPubkey?: string
  authorEnvelope?: KeyEnvelope
  adminEnvelopes?: RecipientEnvelope[]
  mlsCiphertext?: string
  mlsEpoch?: number
}

export async function listNotes(params?: { callId?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams()
  if (params?.callId) qs.set('callId', params.callId)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ notes: EncryptedNote[]; total: number }>(hp(`/notes?${qs}`))
}

export async function createNote(data: {
  callId: string
  encryptedContent?: Ciphertext
  authorEnvelope?: KeyEnvelope
  adminEnvelopes?: RecipientEnvelope[]
  mlsCiphertext?: string
  mlsEpoch?: number
}) {
  return request<{ note: EncryptedNote }>(hp('/notes'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateNote(
  id: string,
  data: {
    encryptedContent?: Ciphertext
    authorEnvelope?: KeyEnvelope
    adminEnvelopes?: RecipientEnvelope[]
    mlsCiphertext?: string
    mlsEpoch?: number
  }
) {
  return request<{ note: EncryptedNote }>(hp(`/notes/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Note Detail ---

export async function getNote(noteId: string) {
  return request<{ note: EncryptedNote }>(hp(`/notes/${noteId}`))
}

// --- Note Replies ---

export async function getNoteReplies(noteId: string) {
  return request<{ replies: EncryptedNote[] }>(hp(`/notes/${noteId}/replies`))
}

export async function createNoteReply(
  noteId: string,
  data: {
    encryptedContent?: Ciphertext
    authorEnvelope?: KeyEnvelope
    adminEnvelopes?: RecipientEnvelope[]
    mlsCiphertext?: string
    mlsEpoch?: number
  }
) {
  return request<{ reply: EncryptedNote }>(hp(`/notes/${noteId}/replies`), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
