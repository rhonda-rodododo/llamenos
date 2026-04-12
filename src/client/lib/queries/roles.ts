/**
 * React Query hooks for role definitions.
 *
 * Roles are not encrypted PII — they are configuration data
 * readable by all authenticated users. Cache is long-lived since
 * roles rarely change.
 */

import {
  type RoleDefinition,
  createRole,
  deleteRole,
  getPermissionsCatalog,
  listRoles,
  updateRole,
} from '@/lib/api'
import { decryptHubField } from '@/lib/hub-field-crypto'
import type { Ciphertext } from '@shared/crypto-types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// rolesListOptions
// ---------------------------------------------------------------------------

/**
 * Fetch the list of role definitions.
 * Hub-key encrypted fields (encryptedName, encryptedDescription) are decrypted
 * in the queryFn so consumers get `name` and `description` populated.
 * Stale for 5 minutes since roles change infrequently.
 */
export const rolesListOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.roles.list(),
    queryFn: async () => {
      const { roles } = await listRoles()
      return Promise.all(
        roles.map(async (role) => ({
          ...role,
          name: await decryptHubField(
            role.encryptedName,
            hubId,
            role.id,
            'encrypted_name',
            role.name
          ),
          description: await decryptHubField(
            role.encryptedDescription,
            hubId,
            role.id,
            'encrypted_description',
            role.description
          ),
        }))
      )
    },
    staleTime: 5 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useRoles
// ---------------------------------------------------------------------------

export function useRoles(hubId = 'global') {
  return useQuery(rolesListOptions(hubId))
}

// ---------------------------------------------------------------------------
// permissionsCatalogOptions
// ---------------------------------------------------------------------------

export const permissionsCatalogOptions = () =>
  queryOptions({
    queryKey: queryKeys.roles.permissions(),
    queryFn: getPermissionsCatalog,
    staleTime: 5 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// usePermissionsCatalog
// ---------------------------------------------------------------------------

export function usePermissionsCatalog() {
  return useQuery(permissionsCatalogOptions())
}

// ---------------------------------------------------------------------------
// useCreateRole
// ---------------------------------------------------------------------------

export function useCreateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      id?: string
      name: string
      permissions: string[]
      description: string
      encryptedName?: Ciphertext
      encryptedDescription?: Ciphertext
    }) => createRole(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateRole
// ---------------------------------------------------------------------------

export function useUpdateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Partial<{
        name: string
        permissions: string[]
        description: string
        encryptedName: Ciphertext
        encryptedDescription: Ciphertext
      }>
    }) => updateRole(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteRole
// ---------------------------------------------------------------------------

export function useDeleteRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { RoleDefinition }
