import type { Ciphertext } from '@shared/crypto-types'
import type { BlastContent, BlastSettings } from '@shared/schemas'
import type { Blast, RecipientEnvelope, Subscriber } from '@shared/types'
import { hp, request } from './client'

export type { Blast, BlastContent, BlastSettings, Subscriber }

// --- Subscribers ---

export async function listSubscribers(params?: {
  tag?: string
  channel?: string
  status?: string
}) {
  const searchParams = new URLSearchParams()
  if (params?.tag) searchParams.set('tag', params.tag)
  if (params?.channel) searchParams.set('channel', params.channel)
  if (params?.status) searchParams.set('status', params.status)
  const qs = searchParams.toString()
  return request<{ subscribers: Subscriber[] }>(hp(`/blasts/subscribers${qs ? `?${qs}` : ''}`))
}

export async function importSubscribers(data: {
  subscribers: Array<{ identifier: string; channel: string; tags?: string[]; language?: string }>
}) {
  return request<{ imported: number; skipped: number }>(hp('/blasts/subscribers/import'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function removeSubscriber(id: string) {
  return request<{ ok: boolean }>(hp(`/blasts/subscribers/${id}`), { method: 'DELETE' })
}

export async function getSubscriberStats() {
  return request<{
    total: number
    active: number
    paused: number
    byChannel: Record<string, number>
  }>(hp('/blasts/subscribers/stats'))
}

// --- Blasts ---

export async function listBlasts() {
  return request<{ blasts: Blast[] }>(hp('/blasts'))
}

export async function createBlast(data: {
  name: string
  encryptedContent: Ciphertext
  contentEnvelopes: RecipientEnvelope[]
  targetChannels: string[]
  targetTags?: string[]
  targetLanguages?: string[]
}) {
  return request<{ blast: Blast }>(hp('/blasts'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** @knipignore — blast update API scaffolding for future admin blast management UI */
export async function updateBlast(id: string, data: Partial<Blast>) {
  return request<{ blast: Blast }>(hp(`/blasts/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteBlast(id: string) {
  return request<{ ok: boolean }>(hp(`/blasts/${id}`), { method: 'DELETE' })
}

export async function sendBlast(id: string) {
  return request<{ blast: Blast }>(hp(`/blasts/${id}/send`), { method: 'POST' })
}

async function _scheduleBlast(id: string, scheduledAt: string) {
  return request<{ blast: Blast }>(hp(`/blasts/${id}/schedule`), {
    method: 'POST',
    body: JSON.stringify({ scheduledAt }),
  })
}

export async function cancelBlast(id: string) {
  return request<{ blast: Blast }>(hp(`/blasts/${id}/cancel`), { method: 'POST' })
}

export async function getBlastSettings() {
  return request<BlastSettings>(hp('/blasts/settings'))
}

export async function updateBlastSettings(data: Partial<BlastSettings>) {
  return request<BlastSettings>(hp('/blasts/settings'), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}
