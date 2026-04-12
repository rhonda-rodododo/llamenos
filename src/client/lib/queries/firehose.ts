/**
 * React Query hooks for firehose connection management.
 *
 * Firehose connections use hub-key encryption for display names.
 * Decryption happens in the queryFn so the cache holds plaintext values.
 */

import {
  createFirehoseConnection,
  deleteFirehoseConnection,
  getFirehoseStatus,
  listFirehoseConnections,
  updateFirehoseConnection,
} from '@/lib/api'
import { decryptHubField } from '@/lib/hub-field-crypto'
import type {
  CreateFirehoseConnectionInput,
  FirehoseConnection,
  FirehoseConnectionHealth,
  UpdateFirehoseConnectionInput,
} from '@shared/schemas/firehose'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// firehoseConnectionsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch all firehose connections for the active hub.
 * Display names are decrypted here so the cache holds plaintext values.
 */
export const firehoseConnectionsOptions = (hubId: string) =>
  queryOptions({
    queryKey: queryKeys.firehose.list(),
    queryFn: async (): Promise<FirehoseConnection[]> => {
      const { connections } = await listFirehoseConnections()
      return Promise.all(
        connections.map(async (c) => ({
          ...c,
          displayName: await decryptHubField(
            c.encryptedDisplayName,
            hubId,
            c.id,
            'encrypted_display_name',
            c.displayName
          ),
        }))
      )
    },
    staleTime: 30_000,
  })

// ---------------------------------------------------------------------------
// useFirehoseConnections
// ---------------------------------------------------------------------------

export function useFirehoseConnections(hubId: string) {
  return useQuery(firehoseConnectionsOptions(hubId))
}

// ---------------------------------------------------------------------------
// firehoseStatusOptions
// ---------------------------------------------------------------------------

/**
 * Poll firehose health status every 30 seconds.
 */
export const firehoseStatusOptions = () =>
  queryOptions({
    queryKey: queryKeys.firehose.status(),
    queryFn: async (): Promise<FirehoseConnectionHealth[]> => {
      const { statuses } = await getFirehoseStatus()
      return statuses
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

// ---------------------------------------------------------------------------
// useFirehoseStatus
// ---------------------------------------------------------------------------

export function useFirehoseStatus() {
  return useQuery(firehoseStatusOptions())
}

// ---------------------------------------------------------------------------
// useCreateFirehoseConnection
// ---------------------------------------------------------------------------

/**
 * Mutation to create a new firehose connection.
 * Invalidates the connections list on success.
 */
export function useCreateFirehoseConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateFirehoseConnectionInput) => createFirehoseConnection(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateFirehoseConnection
// ---------------------------------------------------------------------------

/**
 * Mutation to update an existing firehose connection.
 * Invalidates the connections list and health status on success.
 */
export function useUpdateFirehoseConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFirehoseConnectionInput }) =>
      updateFirehoseConnection(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.status() })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteFirehoseConnection
// ---------------------------------------------------------------------------

/**
 * Mutation to delete a firehose connection.
 * Invalidates the connections list on success.
 */
export function useDeleteFirehoseConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteFirehoseConnection(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { FirehoseConnection, FirehoseConnectionHealth }
