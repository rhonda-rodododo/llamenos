import { test } from '@playwright/test'

test('reset test state', async ({ request }) => {
  // Retry in case the server is still initializing
  for (let i = 0; i < 5; i++) {
    try {
      const res = await request.post('/api/test-reset')
      if (res.ok()) return
    } catch {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  // Final attempt — let it throw if it fails
  await request.post('/api/test-reset')
})
