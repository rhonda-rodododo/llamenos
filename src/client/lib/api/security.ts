import type { RecipientEnvelope } from '@shared/types'
import { request } from './client'

export interface SessionApiRow {
  id: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  isCurrent: boolean
  encryptedMeta: string
  metaEnvelope: RecipientEnvelope[]
  credentialId: string | null
}

export async function listSessions(): Promise<{ sessions: SessionApiRow[] }> {
  return request('/auth/sessions')
}

export async function revokeSession(id: string): Promise<{ ok: boolean }> {
  return request(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function revokeOtherSessions(): Promise<{ revokedCount: number }> {
  return request('/auth/sessions/revoke-others', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export interface PasskeyApiRow {
  id: string
  label: string
  transports: string[]
  backedUp: boolean
  createdAt: string
  lastUsedAt: string
  encryptedLabel?: string
  labelEnvelopes?: RecipientEnvelope[]
}

export async function listPasskeys(): Promise<{ credentials: PasskeyApiRow[]; warning?: string }> {
  return request('/auth/passkeys')
}

export interface RenamePasskeyInput {
  label?: string
  encryptedLabel?: string
  labelEnvelopes?: RecipientEnvelope[]
}

export async function renamePasskey(
  id: string,
  data: RenamePasskeyInput
): Promise<{ ok: boolean }> {
  return request(`/auth/passkeys/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deletePasskey(id: string): Promise<{ ok: boolean }> {
  return request(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
