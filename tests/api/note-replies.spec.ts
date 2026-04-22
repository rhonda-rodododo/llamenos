import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Note Replies API', () => {
  test.describe.configure({ mode: 'serial' })

  let parentNoteId: string
  let replyNoteId: string
  const CALL_ID = `test-call-replies-${Date.now()}`

  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  test('create parent note', async ({ request }) => {
    const mlsCiphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64')
    const res = await adminApi(request).post('/api/notes', {
      callId: CALL_ID,
      mlsCiphertext,
      mlsEpoch: 1,
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data.note).toHaveProperty('id')
    parentNoteId = data.note.id
  })

  test('get replies to a note returns empty array initially', async ({ request }) => {
    const res = await adminApi(request).get(`/api/notes/${parentNoteId}/replies`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('notes')
    expect(Array.isArray(data.notes)).toBe(true)
    expect(data.notes.length).toBe(0)
  })

  test('create a reply to a note', async ({ request }) => {
    const mlsCiphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64')
    const res = await adminApi(request).post(`/api/notes/${parentNoteId}/replies`, {
      mlsCiphertext,
      mlsEpoch: 2,
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data).toHaveProperty('id')
    expect(data.callId).toBe(CALL_ID)
    expect(data.mlsCiphertext).toBe(mlsCiphertext)
    expect(data.mlsEpoch).toBe(2)
    replyNoteId = data.id
  })

  test('get replies after creating one', async ({ request }) => {
    const res = await adminApi(request).get(`/api/notes/${parentNoteId}/replies`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.notes.length).toBeGreaterThanOrEqual(1)
    const reply = data.notes.find((n: { id: string }) => n.id === replyNoteId)
    expect(reply).toBeTruthy()
    expect(reply.mlsEpoch).toBe(2)
  })

  test('get replies for nonexistent note returns empty array', async ({ request }) => {
    const res = await adminApi(request).get('/api/notes/nonexistent-note-id/replies')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.notes).toEqual([])
  })

  test('create reply to nonexistent note returns 404', async ({ request }) => {
    const mlsCiphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64')
    const res = await adminApi(request).post('/api/notes/nonexistent-note-id/replies', {
      mlsCiphertext,
      mlsEpoch: 1,
    })
    expect(res.status()).toBe(404)
  })

  test('unauthenticated get replies returns 401', async ({ request }) => {
    const res = await request.get(`/api/notes/${parentNoteId}/replies`)
    expect(res.status()).toBe(401)
  })

  test('unauthenticated create reply returns 401', async ({ request }) => {
    const mlsCiphertext = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64')
    const res = await request.post(`/api/notes/${parentNoteId}/replies`, {
      data: { mlsCiphertext, mlsEpoch: 1 },
    })
    expect(res.status()).toBe(401)
  })
})
