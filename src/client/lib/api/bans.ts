import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { hp, request } from './client'

// --- Types ---

export interface BanEntry {
  phone: string
  reason: string
  bannedBy: string
  bannedAt: string
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedPhone?: Ciphertext
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedReason?: Ciphertext
  reasonEnvelopes?: RecipientEnvelope[]
}

// --- Ban List ---

export async function listBans() {
  return request<{ bans: BanEntry[] }>(hp('/bans'))
}

export async function addBan(data: { phone: string; reason: string }) {
  return request<{ ban: BanEntry }>(hp('/bans'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function removeBan(phone: string) {
  return request<{ ok: true }>(hp(`/bans/${encodeURIComponent(phone)}`), { method: 'DELETE' })
}

export async function bulkAddBans(data: { phones: string[]; reason: string }) {
  return request<{ count: number }>(hp('/bans/bulk'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// --- Platform (global) ban list ---
//
// The bans router is mounted twice in src/server/app.ts:
//   - `/bans` on `authenticated` (no hubContext → hubId is undefined → global bans)
//   - `/hubs/:hubId/bans` on `hubScoped` (hubContext → hubId set → hub-scoped bans)
//
// These `global*` variants always hit the un-prefixed `/bans` endpoint, which
// reads/writes rows with `hub_id = 'global'` regardless of which hub is currently
// active in the UI. Super-admin only.

export async function listGlobalBans() {
  return request<{ bans: BanEntry[] }>('/bans')
}

export async function addGlobalBan(data: { phone: string; reason: string }) {
  return request<{ ban: BanEntry }>('/bans', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function removeGlobalBan(phone: string) {
  return request<{ ok: true }>(`/bans/${encodeURIComponent(phone)}`, { method: 'DELETE' })
}

export async function bulkAddGlobalBans(data: { phones: string[]; reason: string }) {
  return request<{ count: number }>('/bans/bulk', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
