/**
 * React Query hooks for tag management.
 *
 * Tags are hub-scoped organizational labels for contacts. Names and categories
 * are encrypted with the hub key. Cache is moderately long-lived since tags
 * change infrequently.
 */

import { type Tag, createTag, deleteTag, listTags, updateTag } from '@/lib/api'
import { decryptHubField } from '@/lib/hub-field-crypto'
import type { Ciphertext } from '@shared/crypto-types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// tagsListOptions
// ---------------------------------------------------------------------------

export const tagsListOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.tags.list(),
    queryFn: async () => {
      const { tags } = await listTags()
      return Promise.all(
        tags.map(async (tag) => ({
          ...tag,
          label: await decryptHubField(
            tag.encryptedLabel,
            hubId,
            tag.id,
            'encrypted_label',
            tag.name
          ),
          category: await decryptHubField(
            tag.encryptedCategory,
            hubId,
            tag.id,
            'encrypted_category',
            ''
          ),
        }))
      )
    },
    staleTime: 5 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useTags
// ---------------------------------------------------------------------------

export function useTags(hubId = 'global') {
  return useQuery(tagsListOptions(hubId))
}

// ---------------------------------------------------------------------------
// useCreateTag
// ---------------------------------------------------------------------------

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      encryptedLabel: Ciphertext
      color?: string
      encryptedCategory?: Ciphertext
    }) => createTag(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateTag
// ---------------------------------------------------------------------------

export function useUpdateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: {
        encryptedLabel?: Ciphertext
        color?: string
        encryptedCategory?: Ciphertext | null
      }
    }) => updateTag(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteTag
// ---------------------------------------------------------------------------

export function useDeleteTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { Tag }
