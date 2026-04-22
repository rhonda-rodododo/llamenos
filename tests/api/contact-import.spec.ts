/**
 * Contact Import & Merge — API Integration Tests
 *
 * Tests batch import, duplicate detection, and merge operations.
 *
 * NOTE: Tests require a running dev server (`bun run dev:server`) and backing
 * services (`bun run dev:docker`). They will fail with connection errors if
 * the server is not running — that is expected.
 */
import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

const stubCiphertext = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
const stubEnvelope = {
  v: 3 as const,
  labelId: 0,
  enc: 'dGVzdC1lbmNhcHN1bGF0ZWQta2V5',
  ct: 'dGVzdC1jaXBoZXJ0ZXh0',
  pubkey: 'aabb0000aabb0000',
}

test.describe('Contact Import & Merge — API', () => {
  test.describe.configure({ mode: 'serial' })

  const importedIds: string[] = []
  let primaryId = ''
  let secondaryId = ''

  // ------------------------------------------------------------------ Import

  test('POST /api/contacts/import creates multiple contacts', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/contacts/import', {
      contacts: [
        {
          contactType: 'caller',
          riskLevel: 'low',
          tags: ['import-test'],
          encryptedDisplayName: stubCiphertext,
          displayNameEnvelopes: [stubEnvelope],
        },
        {
          contactType: 'partner-org',
          riskLevel: 'medium',
          tags: ['import-test', 'partner'],
          encryptedDisplayName: stubCiphertext,
          displayNameEnvelopes: [stubEnvelope],
        },
        {
          contactType: 'caller',
          riskLevel: 'high',
          tags: ['import-test'],
          encryptedDisplayName: stubCiphertext,
          displayNameEnvelopes: [stubEnvelope],
        },
      ],
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.created).toBe(3)
    expect(data.errors).toHaveLength(0)
  })

  test('POST /api/contacts/import rejects empty contacts array', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/contacts/import', { contacts: [] })
    expect(res.status()).toBe(400)
  })

  test('POST /api/contacts/import detects duplicates via identifierHash', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const uniqueHash = `hash-dedup-${Date.now()}`

    // First import with identifierHash
    const res1 = await api.post('/api/contacts/import', {
      contacts: [
        {
          contactType: 'caller',
          riskLevel: 'low',
          identifierHash: uniqueHash,
          encryptedDisplayName: stubCiphertext,
          displayNameEnvelopes: [stubEnvelope],
        },
      ],
    })
    expect(res1.status()).toBe(200)
    const data1 = await res1.json()
    expect(data1.created).toBe(1)

    // Second import with same identifierHash — should be duplicate
    const res2 = await api.post('/api/contacts/import', {
      contacts: [
        {
          contactType: 'caller',
          riskLevel: 'low',
          identifierHash: uniqueHash,
          encryptedDisplayName: stubCiphertext,
          displayNameEnvelopes: [stubEnvelope],
        },
      ],
    })
    expect(res2.status()).toBe(200)
    const data2 = await res2.json()
    expect(data2.created).toBe(0)
    expect(data2.errors).toHaveLength(1)
    expect(data2.errors[0].error).toContain('Duplicate')
  })

  // ------------------------------------------------------------------ Setup for Merge

  test('create two contacts for merge test', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Primary contact
    const res1 = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      tags: ['merge-primary'],
      encryptedDisplayName: stubCiphertext,
      displayNameEnvelopes: [stubEnvelope],
    })
    expect(res1.status()).toBe(201)
    const primary = await res1.json()
    primaryId = primary.contact.id

    // Secondary contact
    const res2 = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'medium',
      tags: ['merge-secondary', 'extra-tag'],
      encryptedDisplayName: stubCiphertext,
      displayNameEnvelopes: [stubEnvelope],
    })
    expect(res2.status()).toBe(201)
    const secondary = await res2.json()
    secondaryId = secondary.contact.id
  })

  // ------------------------------------------------------------------ Merge

  test('POST /api/contacts/:primaryId/merge merges tags and soft-deletes secondary', async ({
    request,
  }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const res = await api.post(`/api/contacts/${primaryId}/merge`, {
      secondaryId,
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.primaryId).toBe(primaryId)
    expect(data.mergedTags).toContain('merge-primary')
    expect(data.mergedTags).toContain('merge-secondary')
    expect(data.mergedTags).toContain('extra-tag')
  })

  test('secondary contact is no longer accessible after merge', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const res = await api.get(`/api/contacts/${secondaryId}`)
    expect(res.status()).toBe(404)
  })

  test('primary contact still accessible and has merged tags', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const res = await api.get(`/api/contacts/${primaryId}`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.contact.tags).toContain('merge-primary')
    expect(data.contact.tags).toContain('merge-secondary')
    expect(data.contact.tags).toContain('extra-tag')
  })

  test('merge rejects missing secondaryId', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const res = await api.post(`/api/contacts/${primaryId}/merge`, {})
    expect(res.status()).toBe(400)
  })

  test('merge rejects non-existent primary', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const res = await api.post('/api/contacts/00000000-0000-0000-0000-000000000000/merge', {
      secondaryId: primaryId,
    })
    expect(res.status()).toBe(404)
  })
})
