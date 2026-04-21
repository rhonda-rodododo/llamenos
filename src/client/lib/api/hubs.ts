import type { Ciphertext } from '@shared/crypto-types'
import type { Hub } from '@shared/schemas'
import {
  API_BASE,
  ApiError,
  fireApiActivity,
  fireAuthExpired,
  getAuthHeaders,
  request,
} from './client'

export type { Hub }

// --- Hub Management ---

export async function listHubs() {
  return request<{ hubs: Hub[] }>('/hubs')
}

export async function createHub(data: {
  name: string
  slug?: string
  description?: string
  phoneNumber?: string
}) {
  return request<{ hub: Hub }>('/hubs', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getHub(hubId: string) {
  return request<{ hub: Hub }>(`/hubs/${hubId}`)
}

export async function updateHub(hubId: string, data: Partial<Hub>) {
  return request<{ hub: Hub }>(`/hubs/${hubId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function addHubMember(hubId: string, pubkey: string, roleIds: string[]) {
  return request<{ ok: true }>(`/hubs/${hubId}/members`, {
    method: 'POST',
    body: JSON.stringify({ pubkey, roleIds }),
  })
}

export async function removeHubMember(hubId: string, pubkey: string) {
  return request<{ ok: true }>(`/hubs/${hubId}/members/${pubkey}`, { method: 'DELETE' })
}

// --- Hub Key Envelopes ---

export async function getMyHubKeyEnvelope(hubId: string) {
  return request<{
    wrappedKey: Ciphertext
    ephemeralPubkey: string
    ephemeralPk?: string
  } | null>(`/hubs/${hubId}/key-envelope`)
}

// --- Hub Archive & Delete ---

export async function archiveHub(hubId: string) {
  return request<{ hub: Hub }>(`/hubs/${hubId}/archive`, { method: 'POST' })
}

export async function deleteHub(hubId: string) {
  return request<{ ok: true }>(`/hubs/${hubId}`, { method: 'DELETE' })
}

export type HubExportCategory =
  | 'notes'
  | 'calls'
  | 'conversations'
  | 'audit'
  | 'voicemails'
  | 'attachments'

export async function exportHubData(hubId: string, categories: HubExportCategory[]) {
  const params = new URLSearchParams({ categories: categories.join(',') })
  const path = `/hubs/${hubId}/export?${params.toString()}`
  const headers = getAuthHeaders()
  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) {
    if (res.status === 401) fireAuthExpired()
    throw new ApiError(res.status, await res.text())
  }
  fireApiActivity()
  return res.blob()
}
