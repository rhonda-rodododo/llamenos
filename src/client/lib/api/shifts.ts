import type { Ciphertext } from '@shared/crypto-types'
import { hp, request } from './client'

// --- Types ---

export interface ShiftStatus {
  onShift: boolean
  currentShift: { name: string; startTime: string; endTime: string } | null
  nextShift: { name: string; startTime: string; endTime: string; day: number } | null
}

export interface Shift {
  id: string
  name: string
  /** Hub-key encrypted name (hex ciphertext). */
  encryptedName?: Ciphertext
  startTime: string // HH:mm
  endTime: string // HH:mm
  days: number[] // 0=Sunday, 1=Monday, ..., 6=Saturday
  userPubkeys: string[]
  createdAt: string
}

// --- Shift Status (all users) ---

export async function getMyShiftStatus() {
  return request<ShiftStatus>(hp('/shifts/my-status'))
}

// --- Shifts (admin only) ---

export async function listShifts() {
  return request<{ shifts: Shift[] }>(hp('/shifts'))
}

export async function createShift(data: Omit<Shift, 'id'> & { id?: string }) {
  return request<{ shift: Shift }>(hp('/shifts'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateShift(id: string, data: Partial<Shift>) {
  return request<{ shift: Shift }>(hp(`/shifts/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteShift(id: string) {
  return request<{ ok: true }>(hp(`/shifts/${id}`), { method: 'DELETE' })
}

export async function getFallbackGroup() {
  return request<{ users: string[] }>(hp('/shifts/fallback'))
}

export async function setFallbackGroup(users: string[]) {
  return request<{ ok: true }>(hp('/shifts/fallback'), {
    method: 'PUT',
    body: JSON.stringify({ users }),
  })
}
