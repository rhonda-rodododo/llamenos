/**
 * Contacts Directory — API Integration Tests
 *
 * These tests exercise the full CRUD + relationships + timeline + linking
 * API surface of the contacts directory feature.
 *
 * NOTE: Tests require a running dev server (`bun run dev:server`) and backing
 * services (`bun run dev:docker`). They will fail with connection errors if
 * the server is not running — that is expected.
 */
import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

// Minimal stub ciphertext/envelope structures — the server treats these as
// opaque blobs and never decrypts them (zero-knowledge design).
const stubCiphertext = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
const stubEnvelope = {
  v: 3 as const,
  labelId: 0,
  enc: 'dGVzdC1lbmNhcHN1bGF0ZWQta2V5',
  ct: 'dGVzdC1jaXBoZXJ0ZXh0',
  pubkey: 'aabb0000aabb0000',
}

test.describe('Contacts Directory — API', () => {
  test.describe.configure({ mode: 'serial' })

  let contactId = ''
  let relationshipId = ''

  // ------------------------------------------------------------------ Create

  test('POST /api/contacts creates a contact and returns 201', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      tags: ['test'],
      encryptedDisplayName: stubCiphertext,
      displayNameEnvelopes: [stubEnvelope],
    })
    expect(res.status()).toBe(201)
    const data = (await res.json()) as { contact: { id: string } }
    expect(data.contact.id).toBeTruthy()
    contactId = data.contact.id
  })

  // ------------------------------------------------------------------ List

  test('GET /api/contacts lists contacts and returns 200', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get('/api/contacts')
    expect(res.status()).toBe(200)
    const data = (await res.json()) as { contacts: unknown[] }
    expect(Array.isArray(data.contacts)).toBe(true)
    expect(data.contacts.length).toBeGreaterThanOrEqual(1)
  })

  // ------------------------------------------------------------------ Get single

  test('GET /api/contacts/:id returns the correct contact', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
    const data = (await res.json()) as { contact: { id: string } }
    expect(data.contact.id).toBe(contactId)
  })

  // ------------------------------------------------------------------ Update

  test('PATCH /api/contacts/:id updates riskLevel and returns 200', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.patch(`/api/contacts/${contactId}`, {
      riskLevel: 'high',
    })
    expect(res.status()).toBe(200)
    const data = (await res.json()) as { contact: { riskLevel: string } }
    expect(data.contact.riskLevel).toBe('high')
  })

  // ------------------------------------------------------------------ Timeline

  test('GET /api/contacts/:id/timeline returns calls/conversations/notes', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get(`/api/contacts/${contactId}/timeline`)
    expect(res.status()).toBe(200)
    const data = (await res.json()) as {
      calls: unknown[]
      conversations: unknown[]
      notes: unknown[]
    }
    expect(Array.isArray(data.calls)).toBe(true)
    expect(Array.isArray(data.conversations)).toBe(true)
    expect(Array.isArray(data.notes)).toBe(true)
  })

  // ------------------------------------------------------------------ Link / unlink

  test('POST /api/contacts/:id/link returns 400 without callId or conversationId', async ({
    request,
  }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post(`/api/contacts/${contactId}/link`, {})
    expect(res.status()).toBe(400)
  })

  // ------------------------------------------------------------------ Dedup check

  test('GET /api/contacts/check-duplicate returns 200 with exists: false for unknown hash', async ({
    request,
  }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const unknownHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const res = await api.get(`/api/contacts/check-duplicate?identifierHash=${unknownHash}`)
    expect(res.status()).toBe(200)
    const data = (await res.json()) as { exists: boolean }
    expect(data.exists).toBe(false)
  })

  // ------------------------------------------------------------------ Relationships

  test('POST /api/contacts/relationships creates a relationship and returns 201', async ({
    request,
  }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/contacts/relationships', {
      encryptedPayload: stubCiphertext,
      payloadEnvelopes: [stubEnvelope],
    })
    expect(res.status()).toBe(201)
    const data = (await res.json()) as { relationship: { id: string } }
    expect(data.relationship.id).toBeTruthy()
    relationshipId = data.relationship.id
  })

  test('GET /api/contacts/relationships lists relationships and returns 200', async ({
    request,
  }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get('/api/contacts/relationships')
    expect(res.status()).toBe(200)
    const data = (await res.json()) as { relationships: unknown[] }
    expect(Array.isArray(data.relationships)).toBe(true)
    expect(data.relationships.length).toBeGreaterThanOrEqual(1)
  })

  test('DELETE /api/contacts/relationships/:id removes the relationship', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.delete(`/api/contacts/relationships/${relationshipId}`)
    expect(res.status()).toBe(200)
    const data = (await res.json()) as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  // ------------------------------------------------------------------ Delete

  test('DELETE /api/contacts/:id removes the contact and returns 200', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.delete(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
    const data = (await res.json()) as { ok: boolean }
    expect(data.ok).toBe(true)

    // Confirm it's gone
    const getRes = await api.get(`/api/contacts/${contactId}`)
    expect(getRes.status()).toBe(404)
  })

  // ------------------------------------------------------------------ Auth guard

  test('unauthenticated requests return 401', async ({ request }) => {
    const res = await request.get('/api/contacts', {
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(401)
  })
})
