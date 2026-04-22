import type { MessagingConfig, SignalRegistrationPending } from '../../../shared/types'
import { createLogger } from '../../lib/logger'
import type { SettingsService } from '../../services/settings'

const log = createLogger('messaging.signal-registration')

const SIGNAL_VERIFICATION_PATTERN = /^Your Signal code: \d{6}/
const SIGNAL_CODE_PATTERN = /Your Signal code: (\d{6})/

/**
 * Check if an SMS body is a Signal verification code message.
 * No side effects — purely a pattern match.
 *
 * @knipignore — Signal verification SMS detector; used by inbound SMS handler (not yet wired)
 */
export function isSignalVerificationSMS(body: string): boolean {
  return SIGNAL_VERIFICATION_PATTERN.test(body)
}

/**
 * Extract the 6-digit verification code from a Signal verification SMS.
 * Throws if no match — caller should guard with `isSignalVerificationSMS` first.
 *
 * @knipignore — Signal code extractor; used together with isSignalVerificationSMS by inbound handler
 */
export function extractSignalCode(body: string): string {
  const match = body.match(SIGNAL_CODE_PATTERN)
  if (!match) {
    throw new Error('No Signal verification code found in message body')
  }
  return match[1]
}

/**
 * Complete Signal registration by verifying the code with the bridge,
 * then persisting the Signal config to SettingsService.
 *
 * Never throws — errors are written back to settings as `status: 'failed'`.
 */
export async function completeSignalRegistration(
  pending: SignalRegistrationPending,
  code: string,
  settings: SettingsService
): Promise<void> {
  try {
    // SSRF allow-list validation: ensure pending.bridgeUrl matches configured bridge URL
    const messagingConfig = await settings.getMessagingConfig()
    const configuredBridgeUrl = messagingConfig?.signal?.bridgeUrl

    if (configuredBridgeUrl) {
      if (pending.bridgeUrl !== configuredBridgeUrl) {
        await settings.clearSignalRegistrationPending()
        return
      }
    }

    // Call the bridge to verify the code
    const verifyUrl = `${pending.bridgeUrl}/v1/register/${encodeURIComponent(pending.number)}/verify/${encodeURIComponent(code)}`
    const bridgeRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (bridgeRes.ok) {
      const signalConfig = {
        bridgeUrl: pending.bridgeUrl,
        bridgeApiKey: '',
        webhookSecret: '',
        registeredNumber: pending.number,
      }

      const currentConfig = await settings.getMessagingConfig()
      const updatedConfig: MessagingConfig = {
        ...currentConfig,
        signal: {
          ...signalConfig,
          bridgeApiKey: currentConfig.signal?.bridgeApiKey || '',
          webhookSecret: currentConfig.signal?.webhookSecret || '',
        },
        enabledChannels: currentConfig.enabledChannels.includes('signal')
          ? currentConfig.enabledChannels
          : [...currentConfig.enabledChannels, 'signal'],
      }

      await settings.updateMessagingConfig(updatedConfig)
      await settings.setSignalRegistrationPending({ ...pending, status: 'complete' })
    } else {
      const errorText = await bridgeRes.text().catch(() => `HTTP ${bridgeRes.status}`)
      await settings.setSignalRegistrationPending({
        ...pending,
        status: 'failed',
        error: errorText,
      })
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    try {
      await settings.setSignalRegistrationPending({
        ...pending,
        status: 'failed',
        error: errorMsg,
      })
    } catch (writeErr) {
      log.error('Failed to write error state', writeErr)
    }
  }
}
