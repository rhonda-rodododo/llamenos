/**
 * React Query hooks for intake management.
 *
 * Intakes are post-call data entry forms submitted by users.
 * Case Managers with contacts:triage permission review and merge them
 * into contact records.
 */

import {
  type IntakeRecord,
  getIntake,
  listIntakes,
  submitIntake,
  updateIntakeStatus,
} from '@/lib/api'
import type { RecipientEnvelope } from '@shared/types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// intakesListOptions
// ---------------------------------------------------------------------------

const intakesListOptions = (status?: string) =>
  queryOptions({
    queryKey: queryKeys.intakes.list(status),
    queryFn: async () => {
      const { intakes } = await listIntakes(status ? { status } : undefined)
      return intakes
    },
    staleTime: 30 * 1000, // 30s — intakes change frequently during triage
  })

// ---------------------------------------------------------------------------
// useIntakes
// ---------------------------------------------------------------------------

export function useIntakes(status?: string) {
  return useQuery(intakesListOptions(status))
}

// ---------------------------------------------------------------------------
// intakeDetailOptions / useIntake
// ---------------------------------------------------------------------------

const intakeDetailOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.intakes.detail(id),
    queryFn: async () => {
      const { intake } = await getIntake(id)
      return intake
    },
    staleTime: 30 * 1000,
    enabled: !!id,
  })

export function useIntake(id: string) {
  return useQuery(intakeDetailOptions(id))
}

// ---------------------------------------------------------------------------
// useSubmitIntake
// ---------------------------------------------------------------------------

function useSubmitIntake() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      contactId?: string
      callId?: string
      encryptedPayload: string
      payloadEnvelopes: RecipientEnvelope[]
    }) => submitIntake(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.intakes.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateIntakeStatus
// ---------------------------------------------------------------------------

export function useUpdateIntakeStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'reviewed' | 'merged' | 'dismissed' }) =>
      updateIntakeStatus(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.intakes.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { IntakeRecord }
