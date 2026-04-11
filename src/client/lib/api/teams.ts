import type { Ciphertext } from '@shared/crypto-types'
import { request } from './client'

// --- Types ---

export interface Team {
  id: string
  hubId: string
  encryptedName: Ciphertext
  encryptedDescription: Ciphertext | null
  /** Decrypted name (populated by queryFn). */
  name?: string
  /** Decrypted description (populated by queryFn). */
  description?: string
  createdBy: string
  createdAt: string
  updatedAt: string
  memberCount: number
  contactCount: number
}

export interface TeamMember {
  teamId: string
  userPubkey: string
  addedBy: string
  createdAt: string
}

export interface ContactTeamAssignment {
  id: string
  contactId: string
  teamId: string
  hubId: string
  assignedBy: string
  createdAt: string
}

// --- Teams ---

export async function listTeams() {
  return request<{ teams: Team[] }>('/teams')
}

export async function createTeam(data: {
  id?: string
  encryptedName: Ciphertext
  encryptedDescription?: Ciphertext
}) {
  return request<{ team: Team }>('/teams', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateTeam(
  id: string,
  data: {
    encryptedName?: Ciphertext
    encryptedDescription?: Ciphertext | null
  }
) {
  return request<{ team: Team }>(`/teams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteTeam(id: string) {
  return request<{ ok: true }>(`/teams/${id}`, { method: 'DELETE' })
}

export async function listTeamMembers(teamId: string) {
  return request<{ members: TeamMember[] }>(`/teams/${teamId}/members`)
}

export async function addTeamMembers(teamId: string, pubkeys: string[]) {
  return request<{ members: TeamMember[]; added: number }>(`/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify({ pubkeys }),
  })
}

export async function removeTeamMember(teamId: string, pubkey: string) {
  return request<{ ok: true }>(`/teams/${teamId}/members/${pubkey}`, { method: 'DELETE' })
}

export async function listTeamContacts(teamId: string) {
  return request<{ assignments: ContactTeamAssignment[] }>(`/teams/${teamId}/contacts`)
}

export async function assignTeamContacts(teamId: string, contactIds: string[]) {
  return request<{ assigned: number }>(`/teams/${teamId}/contacts`, {
    method: 'POST',
    body: JSON.stringify({ contactIds }),
  })
}

export async function unassignTeamContact(teamId: string, contactId: string) {
  return request<{ ok: true }>(`/teams/${teamId}/contacts/${contactId}`, { method: 'DELETE' })
}
