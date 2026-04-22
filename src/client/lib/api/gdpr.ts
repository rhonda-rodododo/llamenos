import {
  API_BASE,
  ApiError,
  fireApiActivity,
  fireAuthExpired,
  getAuthHeaders,
  request,
} from './client'

// --- Types ---

export interface ErasureRequest {
  pubkey: string
  status: 'pending' | 'cancelled' | 'executed'
  requestedAt: string
  executeAt: string
}

// --- Account Erasure (GDPR) ---

export async function getMyErasureRequest() {
  const res = await request<{ request: ErasureRequest | null }>('/gdpr/me/erasure')
  return res.request
}

export async function requestAccountErasure() {
  const res = await request<{ request: ErasureRequest }>('/gdpr/me', { method: 'DELETE' })
  return res.request
}

export async function cancelAccountErasure() {
  return request<{ ok: true }>('/gdpr/me/cancel', { method: 'DELETE' })
}

// --- Admin Erasure Requests ---

export async function listErasureRequests(statusFilter?: ErasureRequest['status']) {
  const params = statusFilter ? `?status=${statusFilter}` : ''
  const res = await request<{ requests: ErasureRequest[] }>(`/gdpr/erasure-requests${params}`)
  return res.requests
}

export async function adminEraseUser(targetPubkey: string) {
  return request<{ ok: true }>(`/gdpr/${encodeURIComponent(targetPubkey)}`, { method: 'DELETE' })
}

export async function downloadMyData() {
  const headers = getAuthHeaders()
  const res = await fetch(`${API_BASE}/gdpr/export`, { headers })
  if (!res.ok) {
    if (res.status === 401) fireAuthExpired()
    throw new ApiError(res.status, await res.text())
  }
  fireApiActivity()
  return res.blob()
}
