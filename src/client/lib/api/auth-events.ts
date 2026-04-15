import type { RecipientEnvelope } from '@shared/types'
import { request } from './client'

interface AuthEventApiRow {
  id: string
  eventType: string
  encryptedPayload: string
  payloadEnvelope: RecipientEnvelope[]
  createdAt: string
  reportedSuspiciousAt: string | null
}

export interface AuthEventListResponse {
  events: AuthEventApiRow[]
}

export interface AuthEventExportResponse {
  userPubkey: string
  exportedAt: string
  events: AuthEventApiRow[]
}

export async function listAuthEvents(
  params: { limit?: number; since?: string } = {}
): Promise<AuthEventListResponse> {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set('limit', String(params.limit))
  if (params.since) qs.set('since', params.since)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return request<AuthEventListResponse>(`/auth/events${suffix}`)
}

export async function reportSuspiciousEvent(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/auth/events/${encodeURIComponent(id)}/report`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function exportAuthEvents(): Promise<AuthEventExportResponse> {
  return request<AuthEventExportResponse>('/auth/events/export')
}
