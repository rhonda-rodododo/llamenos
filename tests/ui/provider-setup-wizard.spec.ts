import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Provider Setup Wizard', () => {
  test('wizard opens from phone provider settings', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await expect(adminPage.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
      timeout: 10000,
    })

    await adminPage.getByTestId('admin-phone-provider-wizard-button').click()
    await expect(adminPage.getByTestId('provider-setup-wizard-dialog')).toBeVisible({
      timeout: 5000,
    })
    await expect(adminPage.getByTestId('provider-setup-wizard-title')).toBeVisible()
  })

  test('step 1: credential fields render for each provider', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await adminPage.getByTestId('admin-phone-provider-wizard-button').click()
    await expect(adminPage.getByTestId('provider-setup-wizard-dialog')).toBeVisible({
      timeout: 5000,
    })

    await expect(adminPage.getByTestId('provider-wizard-account-sid')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-auth-token')).toBeVisible()

    await adminPage.getByTestId('provider-wizard-provider-signalwire').click()
    await expect(adminPage.getByTestId('provider-wizard-signalwire-space')).toBeVisible()

    await adminPage.getByTestId('provider-wizard-provider-vonage').click()
    await expect(adminPage.getByTestId('provider-wizard-api-key')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-api-secret')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-application-id')).toBeVisible()

    await adminPage.getByTestId('provider-wizard-provider-plivo').click()
    await expect(adminPage.getByTestId('provider-wizard-auth-id')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-plivo-auth-token')).toBeVisible()

    await adminPage.getByTestId('provider-wizard-provider-asterisk').click()
    await expect(adminPage.getByTestId('provider-wizard-ari-url')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-ari-username')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-ari-password')).toBeVisible()
  })

  test('step 2: A2P skip flow for non-US', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await adminPage.getByTestId('admin-phone-provider-wizard-button').click()
    await expect(adminPage.getByTestId('provider-setup-wizard-dialog')).toBeVisible({
      timeout: 5000,
    })

    await adminPage.getByTestId('provider-wizard-account-sid').fill('AC1234567890abcdef')
    await adminPage.getByTestId('provider-wizard-auth-token').fill('test-auth-token-123')
    await adminPage.getByTestId('provider-wizard-next-credentials').click()

    await expect(adminPage.getByTestId('provider-wizard-a2p-not-applicable')).toBeVisible({
      timeout: 5000,
    })

    await adminPage.getByTestId('provider-wizard-a2p-skip-next').click()
    await expect(adminPage.getByTestId('provider-wizard-search-country')).toBeVisible({
      timeout: 5000,
    })
  })

  test('step 3: manual phone number entry', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await adminPage.getByTestId('admin-phone-provider-wizard-button').click()
    await expect(adminPage.getByTestId('provider-setup-wizard-dialog')).toBeVisible({
      timeout: 5000,
    })

    await adminPage.getByTestId('provider-wizard-account-sid').fill('AC1234567890abcdef')
    await adminPage.getByTestId('provider-wizard-auth-token').fill('test-auth-token-123')
    await adminPage.getByTestId('provider-wizard-next-credentials').click()
    await expect(adminPage.getByTestId('provider-wizard-a2p-not-applicable')).toBeVisible({
      timeout: 5000,
    })
    await adminPage.getByTestId('provider-wizard-a2p-skip-next').click()

    await expect(adminPage.getByTestId('provider-wizard-search-country')).toBeVisible({
      timeout: 5000,
    })

    await adminPage.getByTestId('provider-wizard-manual-number').fill('+15551234567')
    await adminPage.getByTestId('provider-wizard-manual-use-number').click()

    await expect(adminPage.getByTestId('provider-wizard-selected-number')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-selected-number')).toContainText(
      '+15551234567'
    )

    await adminPage.getByTestId('provider-wizard-numbers-next').click()
    await expect(adminPage.getByTestId('provider-wizard-webhooks-copy-all')).toBeVisible({
      timeout: 5000,
    })
  })

  test('step 4: webhooks step renders with URLs', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await adminPage.getByTestId('admin-phone-provider-wizard-button').click()
    await expect(adminPage.getByTestId('provider-setup-wizard-dialog')).toBeVisible({
      timeout: 5000,
    })

    await adminPage.getByTestId('provider-wizard-account-sid').fill('AC1234567890abcdef')
    await adminPage.getByTestId('provider-wizard-auth-token').fill('test-auth-token-123')
    await adminPage.getByTestId('provider-wizard-next-credentials').click()
    await expect(adminPage.getByTestId('provider-wizard-a2p-not-applicable')).toBeVisible({
      timeout: 5000,
    })
    await adminPage.getByTestId('provider-wizard-a2p-skip-next').click()
    await expect(adminPage.getByTestId('provider-wizard-search-country')).toBeVisible({
      timeout: 5000,
    })
    await adminPage.getByTestId('provider-wizard-manual-number').fill('+15551234567')
    await adminPage.getByTestId('provider-wizard-manual-use-number').click()
    await adminPage.getByTestId('provider-wizard-numbers-next').click()

    await expect(adminPage.getByTestId('provider-wizard-webhooks-copy-all')).toBeVisible({
      timeout: 5000,
    })
    await expect(adminPage.getByTestId('provider-wizard-webhook-incoming')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-webhook-status')).toBeVisible()
    await expect(adminPage.getByTestId('provider-wizard-save')).toBeVisible()
  })

  test('wizard can be cancelled', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await adminPage.getByTestId('admin-phone-provider-wizard-button').click()
    await expect(adminPage.getByTestId('provider-setup-wizard-dialog')).toBeVisible({
      timeout: 5000,
    })

    await adminPage.keyboard.press('Escape')
    await expect(adminPage.getByTestId('provider-setup-wizard-dialog')).not.toBeVisible()
  })
})
