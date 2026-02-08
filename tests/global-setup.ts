import { test } from '@playwright/test'

test('reset test state', async ({ request }) => {
  await request.post('/api/test-reset')
})
