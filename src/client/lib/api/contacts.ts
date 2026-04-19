import type { RecipientEnvelope } from '@shared/types'
import { hp, request } from './client'

// --- Types ---

export interface ContactRecord {
  id: string
  hubId: string
  contactType: string
  riskLevel: string
  tags: string[]
  identifierHash: string | null
  encryptedDisplayName: string
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes: string | null
  notesEnvelopes: RecipientEnvelope[]
  encryptedFullName: string | null
  fullNameEnvelopes: RecipientEnvelope[]
  encryptedPhone: string | null
  phoneEnvelopes: RecipientEnvelope[]
  encryptedPII: string | null
  piiEnvelopes: RecipientEnvelope[]
  createdBy: string
  createdAt: string
  updatedAt: string
  lastInteractionAt: string | null
}

export interface ContactRelationshipRecord {
  id: string
  hubId: string
  encryptedPayload: string
  payloadEnvelopes: RecipientEnvelope[]
  createdBy: string
  createdAt: string
}

export interface ContactNotification {
  contactId: string
  channel: { type: string; identifier: string }
  message: string
}

export interface NotifyResult {
  contactId: string
  status: 'sent' | 'failed'
  error?: string
}

// --- Contacts ---

export async function listContacts(filters?: {
  contactType?: string
  riskLevel?: string
}): Promise<{ contacts: ContactRecord[]; total: number }> {
  const params = new URLSearchParams()
  if (filters?.contactType) params.set('contactType', filters.contactType)
  if (filters?.riskLevel) params.set('riskLevel', filters.riskLevel)
  const qs = params.toString()
  return request(hp(`/contacts${qs ? `?${qs}` : ''}`))
}

export async function getContact(id: string): Promise<ContactRecord> {
  const data = await request<{ contact: ContactRecord }>(hp(`/contacts/${id}`))
  return data.contact
}

export async function createContact(data: {
  contactType: string
  riskLevel: string
  tags: string[]
  identifierHash?: string
  encryptedDisplayName: string
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes?: string
  notesEnvelopes?: RecipientEnvelope[]
  encryptedFullName?: string
  fullNameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedPII?: string
  piiEnvelopes?: RecipientEnvelope[]
}): Promise<ContactRecord> {
  return request(hp('/contacts'), { method: 'POST', body: JSON.stringify(data) })
}

export async function updateContact(
  id: string,
  data: Record<string, unknown>
): Promise<ContactRecord> {
  return request(hp(`/contacts/${id}`), { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteContact(id: string): Promise<void> {
  return request(hp(`/contacts/${id}`), { method: 'DELETE' })
}

export async function bulkUpdateContacts(data: {
  contactIds: string[]
  addTags?: string[]
  removeTags?: string[]
  riskLevel?: string
}): Promise<{ updated: number; skipped: number }> {
  return request(hp('/contacts/bulk'), { method: 'PATCH', body: JSON.stringify(data) })
}

export async function bulkDeleteContacts(
  contactIds: string[]
): Promise<{ deleted: number; skipped: number }> {
  return request(hp('/contacts/bulk'), {
    method: 'DELETE',
    body: JSON.stringify({ contactIds }),
  })
}

export async function getContactTimeline(id: string): Promise<{
  calls: unknown[]
  conversations: unknown[]
  notes: unknown[]
}> {
  return request(hp(`/contacts/${id}/timeline`))
}

export async function linkToContact(
  contactId: string,
  type: 'call' | 'conversation',
  targetId: string
): Promise<void> {
  return request(hp(`/contacts/${contactId}/link`), {
    method: 'POST',
    body: JSON.stringify({ type, targetId }),
  })
}

export async function checkContactDuplicate(phone: string): Promise<{
  exists: boolean
  contactId?: string
}> {
  return request(hp(`/contacts/check-duplicate?phone=${encodeURIComponent(phone)}`))
}

export async function hashContactPhone(phone: string): Promise<{ identifierHash: string }> {
  return request(hp('/contacts/hash-phone'), {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
}

export async function getContactRecipients(): Promise<{
  summaryPubkeys: string[]
  piiPubkeys: string[]
}> {
  return request(hp('/contacts/recipients'))
}

export async function listContactRelationships(): Promise<ContactRelationshipRecord[]> {
  const data = await request<{ relationships: ContactRelationshipRecord[] }>(
    hp('/contacts/relationships')
  )
  return data.relationships
}

async function createContactRelationship(data: {
  encryptedPayload: string
  payloadEnvelopes: RecipientEnvelope[]
}): Promise<ContactRelationshipRecord> {
  return request(hp('/contacts/relationships'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function deleteContactRelationship(id: string): Promise<void> {
  return request(hp(`/contacts/relationships/${id}`), { method: 'DELETE' })
}

async function createContactFromCall(
  callId: string,
  data: {
    contactType: string
    riskLevel: string
    tags?: string[]
    encryptedDisplayName: string
    displayNameEnvelopes: RecipientEnvelope[]
    encryptedPhone?: string
    phoneEnvelopes?: RecipientEnvelope[]
    identifierHash?: string
    encryptedFullName?: string
    fullNameEnvelopes?: RecipientEnvelope[]
    encryptedPII?: string
    piiEnvelopes?: RecipientEnvelope[]
  }
): Promise<{ contact: ContactRecord; linked: boolean }> {
  return request(hp(`/contacts/from-call/${callId}`), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function notifyContacts(
  contactId: string,
  notifications: ContactNotification[]
): Promise<{ results: NotifyResult[] }> {
  return request(hp(`/contacts/${contactId}/notify`), {
    method: 'POST',
    body: JSON.stringify({ notifications }),
  })
}

export async function importContacts(data: {
  contacts: Array<{
    contactType: string
    riskLevel: string
    tags?: string[]
    encryptedDisplayName: string
    displayNameEnvelopes: RecipientEnvelope[]
    encryptedFullName?: string
    fullNameEnvelopes?: RecipientEnvelope[]
    encryptedPhone?: string
    phoneEnvelopes?: RecipientEnvelope[]
    identifierHash?: string
    encryptedPII?: string
    piiEnvelopes?: RecipientEnvelope[]
  }>
}): Promise<{ created: number; errors: Array<{ index: number; error: string }> }> {
  return request(hp('/contacts/import'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function mergeContacts(
  primaryId: string,
  secondaryId: string
): Promise<{ ok: true; primaryId: string; mergedTags: string[] }> {
  return request(hp(`/contacts/${primaryId}/merge`), {
    method: 'POST',
    body: JSON.stringify({ secondaryId }),
  })
}
