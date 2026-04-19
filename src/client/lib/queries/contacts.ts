/**
 * React Query hooks for contact directory management.
 *
 * List queries decrypt display name fields via the crypto worker
 * when the key manager is unlocked. Mutations invalidate the full
 * contacts cache on success.
 */

import {
  type ContactRecord,
  type ContactRelationshipRecord,
  bulkDeleteContacts,
  bulkUpdateContacts,
  createContact,
  deleteContact,
  getContact,
  getContactTimeline,
  importContacts,
  listContactRelationships,
  listContacts,
  mergeContacts,
  updateContact,
} from '@/lib/api'
import { decryptArrayFields, decryptObjectFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import {
  LABEL_CONTACT_PII,
  LABEL_CONTACT_RELATIONSHIP,
  LABEL_CONTACT_SUMMARY,
} from '@shared/crypto-labels'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ContactFilters = {
  contactType?: string
  riskLevel?: string
}

// Field name sets for decryptObjectFields / decryptArrayFields calls.
// Contact rows carry fields encrypted under two different domain labels —
// splitting them here prevents cross-label decrypt attempts, which would
// fail AEAD authentication and trigger the decrypt-recovery lock flow.
const CONTACT_SUMMARY_FIELDS = ['encryptedDisplayName', 'encryptedNotes'] as const
const CONTACT_PII_FIELDS = ['encryptedFullName', 'encryptedPhone', 'encryptedPII'] as const
const CONTACT_RELATIONSHIP_FIELDS = ['encryptedPayload'] as const

// ---------------------------------------------------------------------------
// contactsListOptions
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt the contact list with optional filters.
 * Decrypts encryptedDisplayName -> displayName via LABEL_CONTACT_SUMMARY.
 */
const contactsListOptions = (filters?: ContactFilters) =>
  queryOptions({
    queryKey: queryKeys.contacts.list(filters),
    queryFn: async () => {
      const { contacts } = await listContacts(filters)
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        // List view only displays display name; don't attempt to decrypt
        // PII fields here (different label, would fail AEAD).
        await decryptArrayFields(
          contacts as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_CONTACT_SUMMARY,
          CONTACT_SUMMARY_FIELDS
        )
      }
      return contacts
    },
  })

// ---------------------------------------------------------------------------
// useContacts
// ---------------------------------------------------------------------------

export function useContacts(filters?: ContactFilters) {
  return useQuery(contactsListOptions(filters))
}

// ---------------------------------------------------------------------------
// useCreateContact
// ---------------------------------------------------------------------------

export function useCreateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateContact
// ---------------------------------------------------------------------------

function useUpdateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateContact(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// contactDetailOptions
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt a single contact. Decrypts both summary-tier and PII-tier
 * encrypted fields via separate ECIES labels.
 */
const contactDetailOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.contacts.detail(id),
    queryFn: async () => {
      const contact = await getContact(id)
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        const obj = contact as unknown as Record<string, unknown>
        // Decrypt summary-tier fields (displayName, notes) — label-scoped.
        await decryptObjectFields(obj, pubkey, LABEL_CONTACT_SUMMARY, CONTACT_SUMMARY_FIELDS)
        // Decrypt PII-tier fields (fullName, phone, PII blob) — label-scoped.
        // Must use a distinct field set: passing the summary fields here
        // would retry them with the wrong label and fail AEAD.
        await decryptObjectFields(obj, pubkey, LABEL_CONTACT_PII, CONTACT_PII_FIELDS)
      }
      return contact
    },
    enabled: !!id,
  })

// ---------------------------------------------------------------------------
// useContact
// ---------------------------------------------------------------------------

export function useContact(id: string) {
  return useQuery(contactDetailOptions(id))
}

// ---------------------------------------------------------------------------
// contactTimelineOptions
// ---------------------------------------------------------------------------

const contactTimelineOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.contacts.timeline(id),
    queryFn: () => getContactTimeline(id),
    enabled: !!id,
  })

// ---------------------------------------------------------------------------
// useContactTimeline
// ---------------------------------------------------------------------------

export function useContactTimeline(id: string) {
  return useQuery(contactTimelineOptions(id))
}

// ---------------------------------------------------------------------------
// contactRelationshipsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt all contact relationships.
 * Payload field is encrypted with LABEL_CONTACT_RELATIONSHIP.
 */
const contactRelationshipsOptions = () =>
  queryOptions({
    queryKey: queryKeys.contacts.relationships(),
    queryFn: async () => {
      const relationships = await listContactRelationships()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          relationships as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_CONTACT_RELATIONSHIP,
          CONTACT_RELATIONSHIP_FIELDS
        )
      }
      return relationships
    },
  })

// ---------------------------------------------------------------------------
// useContactRelationships
// ---------------------------------------------------------------------------

export function useContactRelationships() {
  return useQuery(contactRelationshipsOptions())
}

// ---------------------------------------------------------------------------
// useDeleteContact
// ---------------------------------------------------------------------------

export function useDeleteContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteContact(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useBulkUpdateContacts
// ---------------------------------------------------------------------------

export function useBulkUpdateContacts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkUpdateContacts,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useBulkDeleteContacts
// ---------------------------------------------------------------------------

export function useBulkDeleteContacts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkDeleteContacts,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useMergeContacts
// ---------------------------------------------------------------------------

export function useMergeContacts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ primaryId, secondaryId }: { primaryId: string; secondaryId: string }) =>
      mergeContacts(primaryId, secondaryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useImportContacts
// ---------------------------------------------------------------------------

export function useImportContacts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: importContacts,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { ContactRecord, ContactRelationshipRecord }
