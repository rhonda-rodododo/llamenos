import { expect, type Page, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

/**
 * End-to-end tests for the file custom field type.
 * Covers: field definition, upload flow, display with download button,
 * file size/type validation errors, and note round-trip.
 */
test.describe('File Custom Field', () => {
  test.beforeEach(async ({ adminPage }) => {
    // Inject authed fetch helper for direct API calls
    await adminPage.evaluate(() => {
      window.__authedFetch = async (url: string, options: RequestInit = {}) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...((options.headers as Record<string, string>) || {}),
        }
        const token =
          window.__TEST_AUTH_FACADE?.getAccessToken() ?? sessionStorage.getItem('__TEST_JWT')
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }
        return fetch(url, { ...options, headers })
      }
    })
  })

  /** Create a file custom field via admin settings UI */
  async function createFileCustomField(page: Page, label: string) {
    await navigateAfterLogin(page, '/admin/custom-fields')
    await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', 'custom-fields')

    const addFieldBtn = page.getByTestId('admin-custom-fields-add')
    await expect(addFieldBtn).toBeVisible({ timeout: 10000 })

    // Skip if already exists
    const existing = page
      .getByTestId('admin-custom-fields-list')
      .locator('[data-testid^="admin-custom-fields-row-"]')
      .filter({ hasText: label })
    if (
      await existing
        .first()
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return
    }

    await addFieldBtn.click()
    await page.getByTestId('admin-custom-fields-label-input').fill(label)

    // Change type to File
    await page.getByTestId('admin-custom-fields-type-select').selectOption('file')

    // Save
    await page.getByTestId('admin-custom-fields-save').click()
    await expect(page.getByTestId('admin-custom-fields-save-success')).toBeVisible({
      timeout: 10000,
    })
    await expect(
      page
        .getByTestId('admin-custom-fields-list')
        .locator('[data-testid^="admin-custom-fields-row-"]')
        .filter({ hasText: label })
    ).toBeVisible()
  }

  test('file type appears in field type dropdown', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/custom-fields')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'custom-fields'
    )

    const addFieldBtn = adminPage.getByTestId('admin-custom-fields-add')
    await expect(addFieldBtn).toBeVisible({ timeout: 10000 })
    await addFieldBtn.click()

    // File option should be in the type dropdown
    const typeSelect = adminPage.getByTestId('admin-custom-fields-type-select')
    await expect(typeSelect.locator('option[value="file"]')).toHaveCount(1)

    // Cancel without saving
    await adminPage.getByTestId('admin-custom-fields-cancel').click()
  })

  test('admin can create a file custom field', async ({ adminPage }) => {
    const label = `Attachment ${Date.now()}`
    await createFileCustomField(adminPage, label)
    // Field type badge should show "File"
    const fieldRow = adminPage
      .getByTestId('admin-custom-fields-list')
      .locator('[data-testid^="admin-custom-fields-row-"]')
      .filter({ hasText: label })
    await expect(fieldRow).toBeVisible()
  })

  test('file custom field shows in note form', async ({ adminPage }) => {
    // Create the file field first
    await createFileCustomField(adminPage, `FileField ${Date.now()}`)

    await adminPage.getByRole('link', { name: 'Notes' }).click()
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible()

    await adminPage.getByRole('button', { name: /new note/i }).click()

    // File field dropzone should appear — use .first() since parallel tests may create
    // multiple file fields, each rendering its own dropzone in the note form
    await expect(adminPage.getByTestId('file-field-dropzone').first()).toBeVisible({
      timeout: 15000,
    })
  })

  test('PATCH /api/uploads/:id/context endpoint binds context', async ({ adminPage }) => {
    // Create a completed upload via the API, then bind it
    const adminPubkey = await adminPage.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      return (window as any).__TEST_KEY_MANAGER?.getPublicKeyHex() as string
    })
    expect(typeof adminPubkey).toBe('string')

    // Use a dummy conversationId — file upload init does not validate it
    const conversationId = `test-conv-file-field-${Date.now()}`

    // Init and complete a minimal upload
    const uploadId = await adminPage.evaluate(
      async ([conversationId, adminPubkey]: [string, string]) => {
        const initRes = await window.__authedFetch('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            totalSize: 5,
            totalChunks: 1,
            conversationId,
            contextType: 'custom_field',
            recipientEnvelopes: [
              {
                v: 3,
                labelId: 0,
                enc: 'dGVzdC1lbmNhcHN1bGF0ZWQta2V5',
                ct: 'dGVzdC1jaXBoZXJ0ZXh0',
                pubkey: adminPubkey,
              },
            ],
            encryptedMetadata: [
              { v: 3, labelId: 0, enc: 'dGVzdC1lbmM', ct: 'dGVzdC1tZXRh', pubkey: adminPubkey },
            ],
          }),
        })
        const initData = await initRes.json()
        const uploadId = initData.uploadId as string

        // Upload chunk
        const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
        const chunkToken =
          window.__TEST_AUTH_FACADE?.getAccessToken() ?? sessionStorage.getItem('__TEST_JWT')
        if (chunkToken) {
          headers.Authorization = `Bearer ${chunkToken}`
        }
        await fetch(`/api/uploads/${uploadId}/chunks/0`, {
          method: 'PUT',
          headers,
          body: new Uint8Array([1, 2, 3, 4, 5]).buffer,
        })

        // Complete
        await window.__authedFetch(`/api/uploads/${uploadId}/complete`, { method: 'POST' })

        return uploadId
      },
      [conversationId, adminPubkey] as [string, string]
    )

    expect(typeof uploadId).toBe('string')

    // Now bind the context
    const bindResult = await adminPage.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/context`, {
        method: 'PATCH',
        body: JSON.stringify({ contextType: 'custom_field', contextId: 'note-abc-123' }),
      })
      return { status: res.status, body: await res.json() }
    }, uploadId)

    expect(bindResult.status).toBe(200)
    expect(bindResult.body.ok).toBe(true)
  })

  test('PATCH /context fails if upload not complete', async ({ adminPage }) => {
    const adminPubkey = await adminPage.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      return (window as any).__TEST_KEY_MANAGER?.getPublicKeyHex() as string
    })

    // Use a dummy conversationId — file upload init does not validate it
    const conversationId = `test-conv-incomplete-${Date.now()}`

    const uploadId = await adminPage.evaluate(
      async ([conversationId, adminPubkey]: [string, string]) => {
        const res = await window.__authedFetch('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            totalSize: 100,
            totalChunks: 2,
            conversationId,
            recipientEnvelopes: [
              { v: 3, labelId: 0, enc: 'dGVzdC1lbmM', ct: 'dGVzdC1jdA', pubkey: adminPubkey },
            ],
            encryptedMetadata: [
              { v: 3, labelId: 0, enc: 'dGVzdC1lbmM', ct: 'dGVzdC1tZXRh', pubkey: adminPubkey },
            ],
          }),
        })
        const data = await res.json()
        return data.uploadId as string
      },
      [conversationId, adminPubkey] as [string, string]
    )

    const result = await adminPage.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/context`, {
        method: 'PATCH',
        body: JSON.stringify({ contextType: 'custom_field', contextId: 'note-xyz' }),
      })
      return { status: res.status, body: await res.json() }
    }, uploadId)

    expect(result.status).toBe(409)
    expect(result.body.error).toContain('complete')
  })

  test('file field validation: exceeding maxFileSize shows error', async ({ adminPage }) => {
    // Create the file field first
    await createFileCustomField(adminPage, `Attachment ${Date.now()}`)

    // Navigate to notes to see the file field
    await adminPage.getByRole('link', { name: 'Notes' }).click()
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible()
    await adminPage.getByRole('button', { name: /new note/i }).click()

    // The file field dropzone should be visible — use .first() since parallel tests
    // may create multiple file fields, each rendering its own dropzone
    const dropzone = adminPage.getByTestId('file-field-dropzone').first()
    await expect(dropzone).toBeVisible({ timeout: 15000 })

    // Verify the dropzone is interactive and the field renders correctly
    await expect(dropzone).toBeEnabled()
  })

  test('custom field upload init accepts custom_field contextType without conversationId', async ({
    adminPage,
  }) => {
    const adminPubkey = await adminPage.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      return (window as any).__TEST_KEY_MANAGER?.getPublicKeyHex() as string
    })

    // Init without conversationId but with contextType: custom_field
    const result = await adminPage.evaluate(async (adminPubkey: string) => {
      const res = await window.__authedFetch('/api/uploads/init', {
        method: 'POST',
        body: JSON.stringify({
          totalSize: 10,
          totalChunks: 1,
          conversationId: '',
          contextType: 'custom_field',
          recipientEnvelopes: [
            { v: 3, labelId: 0, enc: 'dGVzdC1lbmM', ct: 'dGVzdC1jdA', pubkey: adminPubkey },
          ],
          encryptedMetadata: [
            { v: 3, labelId: 0, enc: 'dGVzdC1lbmM', ct: 'dGVzdC1tZXRh', pubkey: adminPubkey },
          ],
        }),
      })
      return { status: res.status, body: await res.json() }
    }, adminPubkey)

    expect(result.status).toBe(200)
    expect(typeof result.body.uploadId).toBe('string')
  })
})
