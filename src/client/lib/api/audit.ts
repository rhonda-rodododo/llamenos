import { hp, request } from './client'

// --- Shared query builder ---

function buildAuditQs(params?: {
  page?: number
  limit?: number
  actorPubkey?: string
  eventType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.actorPubkey) qs.set('actorPubkey', params.actorPubkey)
  if (params?.eventType) qs.set('eventType', params.eventType)
  if (params?.dateFrom) qs.set('dateFrom', params.dateFrom)
  if (params?.dateTo) qs.set('dateTo', params.dateTo)
  if (params?.search) qs.set('search', params.search)
  return qs
}

// --- Types ---

export interface AuditLogEntry {
  id: string
  event: string
  actorPubkey: string
  details: Record<string, unknown>
  createdAt: string
  // Chain integrity (Epic 77)
  previousEntryHash?: string
  entryHash?: string
}

// --- Audit Log (admin only) ---

export async function listAuditLog(params?: {
  page?: number
  limit?: number
  actorPubkey?: string
  eventType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}) {
  const qs = buildAuditQs(params)
  return request<{ entries: AuditLogEntry[]; total: number }>(hp(`/audit?${qs}`))
}

// --- Global (platform) audit log — super-admin only ---
//
// The /audit router is mounted twice in src/server/app.ts:
//   - `/audit` on `authenticated` (no hubContext → rows with hub_id = 'global')
//   - `/hubs/:hubId/audit` on `hubScoped` (hub-scoped rows)
//
// This helper always hits the un-prefixed `/audit` endpoint, returning only
// the platform-wide (global) entries regardless of the active hub.
export async function listGlobalAuditLog(params?: {
  page?: number
  limit?: number
  actorPubkey?: string
  eventType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}) {
  const qs = buildAuditQs(params)
  return request<{ entries: AuditLogEntry[]; total: number }>(`/audit?${qs}`)
}
