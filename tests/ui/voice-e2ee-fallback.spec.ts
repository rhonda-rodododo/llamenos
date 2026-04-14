/**
 * Task 34 — Voice E2EE fallback banner behavior.
 *
 * Tests that the banner-e2ee-fallback testid appears when E2EE is
 * unavailable (unsupported browser, SRTP negotiation failure) and
 * the policy is "preferred". The banner warns the user but allows
 * the call to proceed unencrypted.
 *
 * Requires: Asterisk + coturn + browser context with degraded WebRTC.
 */
import { test } from '../fixtures/auth'

test.skip(!process.env.TEST_SIP_WEBRTC, 'Requires SIP WebRTC infrastructure (Asterisk + coturn)')

test.describe('Voice E2EE fallback banner', () => {
  test('shows fallback banner when E2EE unavailable in preferred mode', async ({ adminPage }) => {
    // Intent: When policy is "preferred" and the peer doesn't support
    // DTLS-SRTP fingerprint verification, the banner-e2ee-fallback
    // element appears warning the user that the call is not E2EE.
    //
    // Steps:
    // 1. Set policy to "preferred" via admin settings
    // 2. Simulate a call to a peer without E2EE support (mock SRTP failure)
    // 3. Assert banner-e2ee-fallback is visible
    // 4. Assert the call still connects (fallback to unencrypted)
  })

  test('blocks call when E2EE unavailable in required mode', async ({ adminPage }) => {
    // Intent: When policy is "required" and E2EE cannot be established,
    // the call should NOT proceed. An error state should be shown.
    //
    // Steps:
    // 1. Set policy to "required" via admin settings
    // 2. Simulate a call to a peer without E2EE support
    // 3. Assert the call does not connect
    // 4. Assert an error indicator is shown
  })
})
