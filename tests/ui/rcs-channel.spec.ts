import { expect, test } from '../fixtures/auth'
import { Timeouts, navigateAfterLogin } from '../helpers'

test.describe('RCS Channel Configuration', () => {
  test('RCS section renders core fields', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/rcs')

    await expect(adminPage.getByTestId('admin-rcs-agent-id-input')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })
    await expect(adminPage.getByTestId('admin-rcs-service-key-input')).toBeVisible()
    // Webhook secret is advanced — hidden by default
    await expect(adminPage.getByTestId('admin-rcs-webhook-secret-input')).not.toBeVisible()

    // Reveal advanced fields
    await adminPage.getByTestId('admin-advanced-reveal-rcs').click()
    await expect(adminPage.getByTestId('admin-rcs-webhook-secret-input')).toBeVisible()
  })

  test('RCS form fields accept input values', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/rcs')
    await expect(adminPage.getByTestId('admin-rcs-agent-id-input')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    const testAgentId = 'brands/TEST_BRAND/agents/TEST_AGENT'
    const testServiceKey = '{"type": "service_account", "project_id": "test-project"}'
    const testWebhookSecret = 'whsec_test_secret_12345'

    await adminPage.getByTestId('admin-rcs-agent-id-input').fill(testAgentId)
    await adminPage.getByTestId('admin-rcs-service-key-input').fill(testServiceKey)

    await adminPage.getByTestId('admin-advanced-reveal-rcs').click()
    await adminPage.getByTestId('admin-rcs-webhook-secret-input').fill(testWebhookSecret)

    await expect(adminPage.getByTestId('admin-rcs-agent-id-input')).toHaveValue(testAgentId)
    await expect(adminPage.getByTestId('admin-rcs-service-key-input')).toHaveValue(testServiceKey)
    await expect(adminPage.getByTestId('admin-rcs-webhook-secret-input')).toHaveValue(
      testWebhookSecret
    )
  })

  test('RCS config can be saved', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/rcs')
    await expect(adminPage.getByTestId('admin-rcs-agent-id-input')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    await adminPage
      .getByTestId('admin-rcs-agent-id-input')
      .fill('brands/SAVE_TEST/agents/AGENT_001')
    await adminPage
      .getByTestId('admin-rcs-service-key-input')
      .fill('{"type": "service_account", "project_id": "save-test"}')

    const saveButton = adminPage.getByTestId('admin-rcs-save')
    await expect(saveButton).toBeEnabled()
    await saveButton.click()

    await expect(adminPage.getByTestId('admin-rcs-save-success')).toBeVisible({
      timeout: Timeouts.API,
    })
  })

  test('save button is disabled when agent ID is empty', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/rcs')
    await expect(adminPage.getByTestId('admin-rcs-agent-id-input')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    await adminPage.getByTestId('admin-rcs-agent-id-input').fill('')
    await expect(adminPage.getByTestId('admin-rcs-save')).toBeDisabled()

    await adminPage.getByTestId('admin-rcs-agent-id-input').fill('brands/TEST/agents/TEST')
    await expect(adminPage.getByTestId('admin-rcs-save')).toBeEnabled()
  })

  test('fallback to SMS toggle works', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/rcs')
    await expect(adminPage.getByTestId('admin-rcs-agent-id-input')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    const fallbackSwitch = adminPage.getByTestId('admin-rcs-fallback-sms-switch')
    await expect(fallbackSwitch).toBeVisible()

    const initialState = await fallbackSwitch.getAttribute('data-state')
    const expectedAfterToggle = initialState === 'checked' ? 'unchecked' : 'checked'

    await fallbackSwitch.click()
    await expect(fallbackSwitch).toHaveAttribute('data-state', expectedAfterToggle, {
      timeout: 3000,
    })

    await fallbackSwitch.click()
    await expect(fallbackSwitch).toHaveAttribute('data-state', initialState!, {
      timeout: 3000,
    })
  })

  test('saved RCS config persists after page navigation', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/rcs')
    await expect(adminPage.getByTestId('admin-rcs-agent-id-input')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    const testAgentId = 'brands/PERSIST_TEST/agents/PERSIST_001'
    await adminPage.getByTestId('admin-rcs-agent-id-input').fill(testAgentId)
    await adminPage
      .getByTestId('admin-rcs-service-key-input')
      .fill('{"type": "service_account", "project_id": "persist"}')

    await adminPage.getByTestId('admin-rcs-save').click()
    await expect(adminPage.getByTestId('admin-rcs-save-success')).toBeVisible({
      timeout: Timeouts.API,
    })

    // Navigate away and come back
    await navigateAfterLogin(adminPage, '/')
    await navigateAfterLogin(adminPage, '/admin/rcs')

    await expect(adminPage.getByTestId('admin-rcs-agent-id-input')).toHaveValue(testAgentId, {
      timeout: Timeouts.ELEMENT,
    })
  })
})
