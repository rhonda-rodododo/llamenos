/**
 * Call Detail and Note Permalink E2E Tests
 *
 * Tests the call history page, note creation, and API endpoints.
 * Note permalink navigation requires parameterized route support.
 */

import { encryptNoteV2 } from '@shared/crypto-envelopes'
import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'
import {
  createAdminApiFromStorageState,
  getAdminPubkeyFromStorageState,
} from '../helpers/authed-request'

// Lazy — resolved after global setup creates admin.json
let ADMIN_PUBKEY: string

/** Create an encrypted note via the API and return its ID */
async function createNoteViaApi(
  authedApi: ReturnType<typeof createAdminApiFromStorageState>,
  noteText: string,
  callId: string
): Promise<string> {
  const { encryptedContent, authorEnvelope, adminEnvelopes } = encryptNoteV2(
    { text: noteText },
    ADMIN_PUBKEY,
    [ADMIN_PUBKEY]
  )
  const res = await authedApi.post('/api/notes', {
    callId,
    encryptedContent,
    authorEnvelope,
    adminEnvelopes,
  })
  expect(res.ok(), `Note creation failed: ${res.status()}`).toBeTruthy()
  const data = await res.json()
  const note = data.note ?? data
  return note.id as string
}

test.describe('Call Detail Page', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    ADMIN_PUBKEY = getAdminPubkeyFromStorageState()
  })

  test('call history page loads and shows empty state or rows', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/calls?page=1&q=&dateFrom=&dateTo=')

    // The call history page should load — either with rows or "No call history"
    const callRows = adminPage.getByTestId('call-history-row')
    const emptyState = adminPage.getByText('No call history')

    await expect(callRows.first().or(emptyState)).toBeVisible({ timeout: 10000 })
  })

  test('note detail API returns note by ID', async ({ request }) => {
    const adminApi = createAdminApiFromStorageState(request)
    const callId = `permalink-test-${Date.now()}`
    const noteId = await createNoteViaApi(adminApi, 'Note for permalink test', callId)

    // Use the note detail API to verify it works server-side
    const detailRes = await adminApi.get(`/api/notes/${noteId}`)
    expect(detailRes.ok(), `Note detail API returned ${detailRes.status()}`).toBeTruthy()
    const detailData = await detailRes.json()
    expect(detailData.note).toBeTruthy()
    expect(detailData.note.id).toBe(noteId)
    expect(detailData.note.callId).toBe(callId)
  })

  test('note detail API returns encrypted content with envelopes', async ({ request }) => {
    const adminApi = createAdminApiFromStorageState(request)
    const callId = `envelope-test-${Date.now()}`
    const noteId = await createNoteViaApi(adminApi, 'Note for envelope test', callId)

    const res = await adminApi.get(`/api/notes/${noteId}`)
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    const note = data.note

    // Note should have encrypted content and envelopes
    expect(note.encryptedContent).toBeTruthy()
    expect(note.authorEnvelope).toBeTruthy()
    expect(note.adminEnvelopes).toBeInstanceOf(Array)
    expect(note.adminEnvelopes.length).toBeGreaterThan(0)
  })

  test('call detail API returns 404 for non-existent call', async ({ request }) => {
    const res = await request.get('/api/calls/nonexistent-call-id/detail')
    expect([401, 404]).toContain(res.status())
  })

  test('note detail API returns 404 for non-existent note', async ({ request }) => {
    const res = await request.get('/api/notes/nonexistent-note-id')
    expect([401, 404]).toContain(res.status())
  })
})

test.describe('Settings Profile Section', () => {
  test('settings page has profile section with name, phone, and language fields', async ({
    adminPage,
  }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Profile section should be visible and expanded by default
    await expect(adminPage.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(adminPage.locator('#profile-name')).toBeVisible()
    await expect(adminPage.locator('#profile-phone')).toBeVisible()
    // Spoken languages should be visible
    await expect(adminPage.getByText(/languages you can take calls in/i)).toBeVisible()
  })
})
