/**
 * React Query hooks for notes resource management.
 *
 * Notes are encrypted/decrypted via MLS group encryption (Slice 5).
 * Transcriptions still use ECIES via ephemeralPubkey.
 *
 * Role-based filtering:
 *   - system:transcription:admin → admins only
 *   - system:transcription       → non-admins only
 *   - All other notes            → always visible
 */

import {
  type CustomFieldDefinition,
  type EncryptedNote,
  createNote,
  createNoteReply,
  getCustomFields,
  getNote,
  getNoteReplies,
  listNotes,
  updateNote,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useConfig } from '@/lib/config'
import { decryptTranscription } from '@/lib/crypto-worker-helpers'
import { decryptHubField } from '@/lib/hub-field-crypto'
import * as keyManager from '@/lib/key-manager'
import { getMlsConversation } from '@/lib/mls/get-mls-conversation'
import type { NotePayload } from '@shared/types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecryptedNote extends EncryptedNote {
  decrypted: string
  payload: NotePayload
  isTranscription: boolean
}

type NoteFilters = {
  callId?: string
  page?: number
  limit?: number
}

type NotesAuth = {
  isAdmin: boolean
  publicKey: string | null
  hasNsec: boolean
}

// ---------------------------------------------------------------------------
// Decryption helper
// ---------------------------------------------------------------------------

const PRE_UPGRADE_TEXT = 'Note from before security upgrade — no longer available'

async function decryptNoteMls(note: EncryptedNote, hubId: string): Promise<NotePayload> {
  if (!note.mlsCiphertext) {
    if (
      note.encryptedContent ||
      note.authorEnvelope ||
      (note.adminEnvelopes && note.adminEnvelopes.length > 0)
    ) {
      return { text: PRE_UPGRADE_TEXT }
    }
    return { text: '[Decryption failed]' }
  }

  const unlocked = await keyManager.isUnlocked()
  if (!unlocked) {
    return { text: '[No key]' }
  }

  try {
    const conv = await getMlsConversation(hubId)
    if (!conv) return { text: '[MLS not available]' }
    const result = await conv.decrypt(new Uint8Array(Buffer.from(note.mlsCiphertext, 'base64')))
    if (!result.message) {
      return { text: '[Decryption failed]' }
    }
    const decoded = new TextDecoder().decode(result.message)
    try {
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return parsed as NotePayload
      }
    } catch {
      // Not JSON
    }
    return { text: decoded }
  } catch {
    return { text: '[Decryption failed]' }
  }
}

// ---------------------------------------------------------------------------
// notesListOptions
// ---------------------------------------------------------------------------

const notesListOptions = (filters: NoteFilters | undefined, auth: NotesAuth, hubId: string) =>
  queryOptions({
    queryKey: queryKeys.notes.list(filters),
    queryFn: async (): Promise<{ notes: DecryptedNote[]; total: number }> => {
      const { isAdmin, publicKey, hasNsec } = auth
      const res = await listNotes(filters)
      const unlocked = await keyManager.isUnlocked()

      const filtered = (res.notes ?? []).filter((note) => {
        if (note.authorPubkey === 'system:transcription:admin') return isAdmin
        if (note.authorPubkey === 'system:transcription') return !isAdmin
        return true
      })

      const decryptedNotes: DecryptedNote[] = []
      for (const note of filtered) {
        const isTranscription = note.authorPubkey.startsWith('system:transcription')
        let payload: NotePayload

        if (isTranscription && note.ephemeralPubkey && hasNsec && unlocked) {
          const text =
            (await decryptTranscription(note.encryptedContent ?? '', note.ephemeralPubkey)) ||
            '[Decryption failed]'
          payload = { text }
        } else if (isTranscription && !note.ephemeralPubkey) {
          payload = { text: note.encryptedContent ?? '' }
        } else {
          payload = await decryptNoteMls(note, hubId)
        }

        decryptedNotes.push({ ...note, decrypted: payload.text, payload, isTranscription })
      }

      return { notes: decryptedNotes, total: res.total }
    },
    staleTime: 2 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useNotes
// ---------------------------------------------------------------------------

export function useNotes(filters?: NoteFilters) {
  const { hasNsec, publicKey, isAdmin } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  return useQuery(notesListOptions(filters, { isAdmin, publicKey, hasNsec }, hubId))
}

// ---------------------------------------------------------------------------
// noteDetailOptions
// ---------------------------------------------------------------------------

const noteDetailOptions = (noteId: string, auth: NotesAuth, hubId: string) =>
  queryOptions({
    queryKey: queryKeys.notes.detail(noteId),
    queryFn: async (): Promise<{
      note: DecryptedNote
      customFields: CustomFieldDefinition[]
    }> => {
      const { isAdmin, publicKey, hasNsec } = auth
      const [res, cfRes] = await Promise.all([
        getNote(noteId),
        getCustomFields().catch(() => ({ fields: [] as CustomFieldDefinition[] })),
      ])

      const rawNote = res.note
      const isTranscription = rawNote.authorPubkey.startsWith('system:transcription')
      const unlocked = await keyManager.isUnlocked()
      let payload: NotePayload

      if (isTranscription && rawNote.ephemeralPubkey && hasNsec && unlocked) {
        const text =
          (await decryptTranscription(rawNote.encryptedContent ?? '', rawNote.ephemeralPubkey)) ||
          '[Decryption failed]'
        payload = { text }
      } else if (isTranscription && !rawNote.ephemeralPubkey) {
        payload = { text: rawNote.encryptedContent ?? '' }
      } else {
        payload = await decryptNoteMls(rawNote, hubId)
      }

      const note: DecryptedNote = {
        ...rawNote,
        decrypted: payload.text,
        payload,
        isTranscription,
      }
      return { note, customFields: cfRes.fields }
    },
    staleTime: 2 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useNoteDetail
// ---------------------------------------------------------------------------

export function useNoteDetail(noteId: string) {
  const { hasNsec, publicKey, isAdmin } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  return useQuery(noteDetailOptions(noteId, { isAdmin, publicKey, hasNsec }, hubId))
}

// ---------------------------------------------------------------------------
// customFieldsOptions
// ---------------------------------------------------------------------------

export const customFieldsOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.settings.customFields(),
    queryFn: async (): Promise<CustomFieldDefinition[]> => {
      const res = await getCustomFields()
      return Promise.all(
        (res.fields ?? []).map(async (field) => {
          const decryptedOptions = await decryptHubField(
            field.encryptedOptions,
            hubId,
            field.id,
            'encrypted_options'
          )
          return {
            ...field,
            name: await decryptHubField(
              field.encryptedFieldName,
              hubId,
              field.id,
              'encrypted_field_name'
            ),
            label: await decryptHubField(field.encryptedLabel, hubId, field.id, 'encrypted_label'),
            options: decryptedOptions
              ? (() => {
                  try {
                    return JSON.parse(decryptedOptions) as string[]
                  } catch {
                    return field.options
                  }
                })()
              : field.options,
          }
        })
      )
    },
    staleTime: 10 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useCustomFields
// ---------------------------------------------------------------------------

export function useCustomFields(hubId = 'global') {
  return useQuery(customFieldsOptions(hubId))
}

// ---------------------------------------------------------------------------
// useCreateNote
// ---------------------------------------------------------------------------

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateNote
// ---------------------------------------------------------------------------

export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateNote>[1] }) =>
      updateNote(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
    },
  })
}

// ---------------------------------------------------------------------------
// noteRepliesOptions
// ---------------------------------------------------------------------------

/**
 * queryOptions factory for a note's reply thread.
 * Replies share the same ECIES encryption shape as notes.
 * Decryption deferred to the component via auth context.
 */
const noteRepliesOptions = (noteId: string, auth: NotesAuth, hubId: string) =>
  queryOptions({
    queryKey: queryKeys.notes.replies(noteId),
    queryFn: async (): Promise<DecryptedNote[]> => {
      const { isAdmin, publicKey, hasNsec } = auth
      const { replies } = await getNoteReplies(noteId)
      const unlocked = await keyManager.isUnlocked()

      const decryptedReplies: DecryptedNote[] = []
      for (const reply of replies) {
        const isTranscription = reply.authorPubkey.startsWith('system:transcription')
        let payload: NotePayload

        if (isTranscription && reply.ephemeralPubkey && hasNsec && unlocked) {
          const text =
            (await decryptTranscription(reply.encryptedContent ?? '', reply.ephemeralPubkey)) ||
            '[Decryption failed]'
          payload = { text }
        } else if (isTranscription && !reply.ephemeralPubkey) {
          payload = { text: reply.encryptedContent ?? '' }
        } else {
          payload = await decryptNoteMls(reply, hubId)
        }

        decryptedReplies.push({ ...reply, decrypted: payload.text, payload, isTranscription })
      }
      return decryptedReplies
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!noteId,
  })

// ---------------------------------------------------------------------------
// useNoteReplies
// ---------------------------------------------------------------------------

export function useNoteReplies(noteId: string) {
  const { hasNsec, publicKey, isAdmin } = useAuth()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  return useQuery(noteRepliesOptions(noteId, { isAdmin, publicKey, hasNsec }, hubId))
}

// ---------------------------------------------------------------------------
// useCreateNoteReply
// ---------------------------------------------------------------------------

export function useCreateNoteReply(noteId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof createNoteReply>[1]) => createNoteReply(noteId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.replies(noteId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { CustomFieldDefinition, EncryptedNote }
