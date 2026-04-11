/**
 * React Query hooks for shift resource management.
 *
 * Shifts are not encrypted PII — they contain hub-encrypted names
 * which are decrypted client-side via decryptHubField. Mutations
 * invalidate the full shifts cache on success.
 */

import {
  type Shift,
  createShift,
  deleteShift,
  getFallbackGroup,
  getMyShiftStatus,
  listShifts,
  setFallbackGroup,
  updateShift,
} from '@/lib/api'
import { decryptHubField } from '@/lib/hub-field-crypto'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// shiftsListOptions
// ---------------------------------------------------------------------------

export const shiftsListOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.shifts.list(),
    queryFn: async () => {
      const { shifts } = await listShifts()
      return shifts.map((shift) => ({
        ...shift,
        name: decryptHubField(shift.encryptedName, hubId, shift.id, 'encrypted_name', shift.name),
      }))
    },
  })

// ---------------------------------------------------------------------------
// useShifts
// ---------------------------------------------------------------------------

export function useShifts(hubId = 'global') {
  return useQuery(shiftsListOptions(hubId))
}

// ---------------------------------------------------------------------------
// fallbackGroupOptions
// ---------------------------------------------------------------------------

export const fallbackGroupOptions = () =>
  queryOptions({
    queryKey: queryKeys.shifts.fallback(),
    queryFn: async () => {
      const { users } = await getFallbackGroup()
      return users
    },
  })

// ---------------------------------------------------------------------------
// useFallbackGroup
// ---------------------------------------------------------------------------

export function useFallbackGroup() {
  return useQuery(fallbackGroupOptions())
}

// ---------------------------------------------------------------------------
// shiftStatusOptions
// ---------------------------------------------------------------------------

export const shiftStatusOptions = () =>
  queryOptions({
    queryKey: queryKeys.shifts.myStatus(),
    queryFn: getMyShiftStatus,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

// ---------------------------------------------------------------------------
// useShiftStatus
// ---------------------------------------------------------------------------

export function useShiftStatus() {
  return useQuery(shiftStatusOptions())
}

// ---------------------------------------------------------------------------
// useCreateShift
// ---------------------------------------------------------------------------

export function useCreateShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<Shift, 'id'>) => createShift(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateShift
// ---------------------------------------------------------------------------

export function useUpdateShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Shift> }) => updateShift(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteShift
// ---------------------------------------------------------------------------

export function useDeleteShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteShift(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useSetFallbackGroup
// ---------------------------------------------------------------------------

export function useSetFallbackGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (users: string[]) => setFallbackGroup(users),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.fallback() })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { Shift }
