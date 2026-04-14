/**
 * React Query hooks for notes resource management.
 *
 * Notes have special per-note ECIES decryption:
 *   - Regular notes: decrypted via authorEnvelope (author) or adminEnvelopes (admin)
 *   - Transcriptions: decrypted via decryptTranscription + ephemeralPubkey
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
  getCustomFields,
  getNote,
  listNotes,
  updateNote,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptNote, decryptTranscription } from '@/lib/crypto-worker-helpers'
import { decryptHubField } from '@/lib/hub-field-crypto'
import * as keyManager from '@/lib/key-manager'
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
// notesListOptions
// ---------------------------------------------------------------------------

/**
 * queryOptions factory for the notes list.
 * auth values must be passed explicitly (extracted from useAuth() in the hook wrapper)
 * since queryOptions cannot call React hooks.
 */
export const notesListOptions = (filters: NoteFilters | undefined, auth: NotesAuth) =>
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
            (await decryptTranscription(note.encryptedContent, note.ephemeralPubkey)) ||
            '[Decryption failed]'
          payload = { text }
        } else if (isTranscription && !note.ephemeralPubkey) {
          payload = { text: note.encryptedContent }
        } else if (hasNsec && unlocked && publicKey) {
          const myPubkey = publicKey
          const envelope = isAdmin
            ? (note.adminEnvelopes?.find((e) => e.pubkey === myPubkey) ?? note.adminEnvelopes?.[0])
            : note.authorEnvelope
          if (envelope) {
            payload = (await decryptNote(note.encryptedContent, envelope)) || {
              text: '[Decryption failed]',
            }
          } else {
            payload = { text: '[Decryption failed]' }
          }
        } else {
          payload = { text: '[No key]' }
        }

        decryptedNotes.push({ ...note, decrypted: payload.text, payload, isTranscription })
      }

      return { notes: decryptedNotes, total: res.total }
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

// ---------------------------------------------------------------------------
// useNotes
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt the notes list with optional filters.
 *
 * Replicates the exact decryption + role-based filtering logic from the
 * legacy `loadNotes` callback in notes.tsx:
 *   - Admins see system:transcription:admin notes; non-admins see system:transcription
 *   - Transcriptions with ephemeralPubkey are ECIES-decrypted via decryptTranscription
 *   - Transcriptions without ephemeralPubkey use encryptedContent as plain text
 *   - Regular notes: admin looks up their envelope in adminEnvelopes, author uses authorEnvelope
 */
export function useNotes(filters?: NoteFilters) {
  const { hasNsec, publicKey, isAdmin } = useAuth()
  return useQuery(notesListOptions(filters, { isAdmin, publicKey, hasNsec }))
}

// ---------------------------------------------------------------------------
// noteDetailOptions
// ---------------------------------------------------------------------------

/**
 * queryOptions factory for a single note detail (with custom fields).
 * Fetches the note + custom field definitions and decrypts the note content
 * in the queryFn — per the decrypt-on-fetch architecture.
 */
export const noteDetailOptions = (noteId: string, auth: NotesAuth) =>
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
          (await decryptTranscription(rawNote.encryptedContent, rawNote.ephemeralPubkey)) ||
          '[Decryption failed]'
        payload = { text }
      } else if (isTranscription && !rawNote.ephemeralPubkey) {
        payload = { text: rawNote.encryptedContent }
      } else if (hasNsec && unlocked) {
        const myPubkey = publicKey ?? ''
        const envelope = isAdmin
          ? (rawNote.adminEnvelopes?.find((e) => e.pubkey === myPubkey) ??
            rawNote.adminEnvelopes?.[0])
          : rawNote.authorEnvelope
        if (envelope) {
          payload = (await decryptNote(rawNote.encryptedContent, envelope)) || {
            text: '[Decryption failed]',
          }
        } else {
          payload = { text: '[Decryption failed]' }
        }
      } else {
        payload = { text: '[No key]' }
      }

      const note: DecryptedNote = {
        ...rawNote,
        decrypted: payload.text,
        payload,
        isTranscription,
      }
      return { note, customFields: cfRes.fields }
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

// ---------------------------------------------------------------------------
// useNoteDetail
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt a single note by id, along with custom field definitions.
 */
export function useNoteDetail(noteId: string) {
  const { hasNsec, publicKey, isAdmin } = useAuth()
  return useQuery(noteDetailOptions(noteId, { isAdmin, publicKey, hasNsec }))
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
            'encrypted_options',
            ''
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
    staleTime: 10 * 60 * 1000, // 10 minutes
  })

// ---------------------------------------------------------------------------
// useCustomFields
// ---------------------------------------------------------------------------

/**
 * Fetch custom field definitions from settings.
 */
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
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { CustomFieldDefinition, EncryptedNote }
