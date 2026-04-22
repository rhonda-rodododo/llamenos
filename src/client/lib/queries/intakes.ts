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
import { decryptObjectFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { LABEL_CONTACT_INTAKE } from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

export interface DecryptedIntake extends IntakeRecord {
  decryptedPayload?: string
  payload?: unknown
}

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

const INTAKE_FIELDS = ['encryptedPayload'] as const

const intakeDetailOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.intakes.detail(id),
    queryFn: async (): Promise<DecryptedIntake> => {
      const { intake } = await getIntake(id)
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptObjectFields(
          intake as unknown as Record<string, unknown>,
          pubkey,
          LABEL_CONTACT_INTAKE,
          INTAKE_FIELDS
        )
        const decrypted = (intake as unknown as Record<string, unknown>).payload
        if (typeof decrypted === 'string') {
          ;(intake as DecryptedIntake).decryptedPayload = decrypted
          try {
            ;(intake as DecryptedIntake).payload = JSON.parse(decrypted)
          } catch {
            ;(intake as DecryptedIntake).payload = decrypted
          }
        }
      }
      return intake as DecryptedIntake
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
