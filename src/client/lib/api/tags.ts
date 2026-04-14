import type { Ciphertext } from '@shared/crypto-types'
import { request } from './client'

// --- Types ---

export interface Tag {
  id: string
  hubId: string
  name: string
  encryptedLabel: Ciphertext
  color: string
  encryptedCategory: Ciphertext | null
  /** Decrypted label (populated by queryFn). */
  label?: string
  /** Decrypted category (populated by queryFn). */
  category?: string
  createdBy: string
  createdAt: string
}

// --- Tags ---

export async function listTags() {
  return request<{ tags: Tag[] }>('/tags')
}

export async function createTag(data: {
  id?: string
  name: string
  encryptedLabel: Ciphertext
  color?: string
  encryptedCategory?: Ciphertext
}) {
  return request<{ tag: Tag }>('/tags', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateTag(
  id: string,
  data: {
    encryptedLabel?: Ciphertext
    color?: string
    encryptedCategory?: Ciphertext | null
  }
) {
  return request<{ tag: Tag }>(`/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteTag(id: string) {
  return request<{ ok: true; removedFromContacts: number }>(`/tags/${id}`, { method: 'DELETE' })
}
