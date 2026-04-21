import type { RecipientEnvelope } from '@shared/types'
import { hp, request } from './client'

// --- Types ---

export interface IntakeRecord {
  id: string
  hubId: string
  contactId: string | null
  callId: string | null
  encryptedPayload: string
  payloadEnvelopes: RecipientEnvelope[]
  status: string
  reviewedBy: string | null
  reviewedAt: string | null
  submittedBy: string
  createdAt: string
}

// --- Intakes ---

export async function listIntakes(filters?: {
  status?: string
  contactId?: string
}): Promise<{ intakes: IntakeRecord[] }> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.contactId) params.set('contactId', filters.contactId)
  const qs = params.toString()
  return request(hp(`/intakes${qs ? `?${qs}` : ''}`))
}

export async function submitIntake(data: {
  contactId?: string
  callId?: string
  encryptedPayload: string
  payloadEnvelopes: RecipientEnvelope[]
}): Promise<{ intake: IntakeRecord }> {
  return request(hp('/intakes'), { method: 'POST', body: JSON.stringify(data) })
}

export async function getIntake(id: string): Promise<{ intake: IntakeRecord }> {
  return request(hp(`/intakes/${id}`))
}

export async function updateIntakeStatus(
  id: string,
  status: 'reviewed' | 'merged' | 'dismissed'
): Promise<{ intake: IntakeRecord }> {
  return request(hp(`/intakes/${id}`), {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}
