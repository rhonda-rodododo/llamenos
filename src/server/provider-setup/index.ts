import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_PROVIDER_CREDENTIAL_WRAP } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import type { NumberInfo, ProviderConfig, SupportedProvider } from '../../shared/types'
import type { CryptoService } from '../lib/crypto-service'
import type { SettingsService } from '../services/settings'
import { PlivoProvider } from './plivo'
import { SignalWireProvider } from './signalwire'
import { TelnyxProvider } from './telnyx'
import { TwilioProvider } from './twilio'
import type {
  A2pBrandResult,
  A2pStatusResult,
  ApiKeyCredentials,
  ConfigureResult,
  OAuthStartResult,
  ProvisionNumberResult,
  SelectNumberResult,
  TwilioCredentials,
} from './types'
import { OAuthStateError, ProviderApiError } from './types'
import { VonageProvider } from './vonage'

/**
 * Unified provider setup interface.
 *
 * Orchestrates OAuth flows, credential validation, number management,
 * webhook configuration, and SIP trunk provisioning across all supported
 * telephony providers.
 *
 * Credentials are encrypted using ECIES with LABEL_PROVIDER_CREDENTIAL_WRAP
 * before storage via SettingsService.
 */
export class ProviderSetup {
  private readonly twilio: TwilioProvider
  private readonly telnyx: TelnyxProvider
  private readonly signalwire: SignalWireProvider
  private readonly vonage: VonageProvider
  private readonly plivo: PlivoProvider
  private readonly domain: string
  private readonly settings: SettingsService
  private readonly crypto: CryptoService

  constructor(
    settings: SettingsService,
    crypto: CryptoService,
    env: {
      HOTLINE_NAME?: string
      TWILIO_OAUTH_CLIENT_ID?: string
      TWILIO_OAUTH_CLIENT_SECRET?: string
      TELNYX_OAUTH_CLIENT_ID?: string
      TELNYX_OAUTH_CLIENT_SECRET?: string
    }
  ) {
    this.settings = settings
    this.crypto = crypto
    this.domain = env.HOTLINE_NAME || 'localhost'

    this.twilio = new TwilioProvider(
      this.domain,
      env.TWILIO_OAUTH_CLIENT_ID || '',
      env.TWILIO_OAUTH_CLIENT_SECRET || ''
    )
    this.telnyx = new TelnyxProvider(
      this.domain,
      env.TELNYX_OAUTH_CLIENT_ID || '',
      env.TELNYX_OAUTH_CLIENT_SECRET || ''
    )
    this.signalwire = new SignalWireProvider()
    this.vonage = new VonageProvider()
    this.plivo = new PlivoProvider()
  }

  // --- OAuth Flows ---

  async oauthStart(provider: 'twilio' | 'telnyx'): Promise<OAuthStartResult> {
    const stateBytes = crypto.getRandomValues(new Uint8Array(32))
    const state = bytesToHex(stateBytes)

    const expiresAt = Date.now() + 10 * 60 * 1000 // 10-minute TTL
    await this.settings.setOAuthState({ state, provider, expiresAt })

    if (provider === 'twilio') {
      return this.twilio.oauthStart(state)
    }
    return this.telnyx.oauthStart(state)
  }

  async oauthCallback(provider: 'twilio' | 'telnyx', code: string, state: string): Promise<void> {
    const stored = await this.settings.getOAuthState(provider)

    if (!stored) {
      throw new OAuthStateError('OAuth state not found or expired')
    }
    if (stored.state !== state) {
      throw new OAuthStateError('OAuth state mismatch (possible CSRF)')
    }
    if (Date.now() > stored.expiresAt) {
      throw new OAuthStateError('OAuth state expired')
    }

    let encryptedCredentials: string
    const config: ProviderConfig = {
      provider,
      connected: true,
      webhooksConfigured: false,
      sipConfigured: false,
    }

    if (provider === 'twilio') {
      const credentials = await this.twilio.oauthCallback(code)
      encryptedCredentials = this.crypto.serverEncrypt(
        JSON.stringify(credentials),
        LABEL_PROVIDER_CREDENTIAL_WRAP
      ) as string
    } else {
      const credentials = await this.telnyx.oauthCallback(code)
      encryptedCredentials = this.crypto.serverEncrypt(
        JSON.stringify(credentials),
        LABEL_PROVIDER_CREDENTIAL_WRAP
      ) as string
    }

    await this.settings.setProviderConfig(config, encryptedCredentials)
    await this.settings.clearOAuthState(provider)
  }

  // --- API Key Configuration ---

  async configure(
    provider: SupportedProvider,
    credentials: ApiKeyCredentials
  ): Promise<ConfigureResult> {
    switch (provider) {
      case 'signalwire':
        await this.signalwire.validateCredentials(
          credentials.projectId,
          credentials.apiToken,
          credentials.spaceUrl
        )
        break
      case 'vonage':
        await this.vonage.validateCredentials(credentials.apiKey, credentials.apiSecret)
        break
      case 'plivo':
        await this.plivo.validateCredentials(credentials.authId, credentials.authToken)
        break
      case 'twilio':
      case 'telnyx':
        break
    }

    const config: ProviderConfig = {
      provider,
      connected: true,
      webhooksConfigured: false,
      sipConfigured: false,
    }
    const encryptedCredentials = this.crypto.serverEncrypt(
      JSON.stringify(credentials),
      LABEL_PROVIDER_CREDENTIAL_WRAP
    ) as string
    await this.settings.setProviderConfig(config, encryptedCredentials)

    return { ok: true }
  }

  // --- Number Management ---

  async listNumbers(provider: SupportedProvider): Promise<NumberInfo[]> {
    const creds = await this.decryptCredentials()
    if (!creds) throw new ProviderApiError('No credentials stored', 401, 'Not connected')

    const parsed = JSON.parse(creds) as Record<string, string>

    switch (provider) {
      case 'twilio':
        return this.twilio.listNumbers(parsed as unknown as TwilioCredentials)
      case 'telnyx':
        return this.telnyx.listNumbers(parsed.accessToken)
      case 'signalwire':
        return this.signalwire.listNumbers(parsed.projectId, parsed.apiToken, parsed.spaceUrl)
      case 'vonage':
        return this.vonage.listNumbers(parsed.apiKey, parsed.apiSecret)
      case 'plivo':
        return this.plivo.listNumbers(parsed.authId, parsed.authToken)
    }
  }

  async selectNumber(
    provider: SupportedProvider,
    phoneNumber: string,
    options: { enableSms?: boolean; createSipTrunk?: boolean }
  ): Promise<SelectNumberResult> {
    const creds = await this.decryptCredentials()
    if (!creds) throw new ProviderApiError('No credentials stored', 401, 'Not connected')

    const parsed = JSON.parse(creds) as Record<string, string>
    const domain = this.domain
    const result: SelectNumberResult = { ok: true, webhooksConfigured: true }

    const numbers = await this.listNumbers(provider)
    const numberInfo = numbers.find((n) => n.phoneNumber === phoneNumber)
    const numberSid = numberInfo?.sid || phoneNumber

    switch (provider) {
      case 'twilio':
        await this.twilio.configureWebhooks(
          parsed as unknown as TwilioCredentials,
          numberSid,
          domain,
          options.enableSms ?? false
        )
        if (options.createSipTrunk) {
          result.sipTrunk = await this.twilio.createSipTrunk(
            parsed as unknown as TwilioCredentials,
            domain
          )
        }
        break
      case 'telnyx':
        await this.telnyx.configureWebhooks(
          parsed.accessToken,
          numberSid,
          domain,
          options.enableSms ?? false
        )
        if (options.createSipTrunk) {
          result.sipTrunk = await this.telnyx.createSipConnection(parsed.accessToken, domain)
        }
        break
      case 'signalwire':
        await this.signalwire.configureWebhooks(
          parsed.projectId,
          parsed.apiToken,
          parsed.spaceUrl,
          numberSid,
          domain,
          options.enableSms ?? false
        )
        break
      case 'vonage':
        await this.vonage.configureWebhooks(
          parsed.apiKey,
          parsed.apiSecret,
          phoneNumber,
          domain,
          options.enableSms ?? false
        )
        break
      case 'plivo':
        await this.plivo.configureWebhooks(
          parsed.authId,
          parsed.authToken,
          phoneNumber,
          domain,
          options.enableSms ?? false
        )
        break
    }

    // Update provider config
    const currentConfig = await this.settings.getProviderConfig()
    if (currentConfig) {
      const updatedConfig: ProviderConfig = {
        ...currentConfig,
        phoneNumber,
        webhooksConfigured: true,
        sipConfigured: !!result.sipTrunk,
      }
      const existingCreds = await this.settings.getEncryptedCredentials()
      await this.settings.setProviderConfig(updatedConfig, existingCreds ?? undefined)
    }

    return result
  }

  async provisionNumber(
    provider: SupportedProvider,
    options: { areaCode?: string; country?: string }
  ): Promise<ProvisionNumberResult> {
    const creds = await this.decryptCredentials()
    if (!creds) throw new ProviderApiError('No credentials stored', 401, 'Not connected')

    const parsed = JSON.parse(creds) as Record<string, string>

    switch (provider) {
      case 'twilio':
        return this.twilio.provisionNumber(
          parsed as unknown as TwilioCredentials,
          options.areaCode,
          options.country
        )
      case 'telnyx':
        return this.telnyx.provisionNumber(parsed.accessToken, options.areaCode)
      case 'signalwire':
        return this.signalwire.provisionNumber(
          parsed.projectId,
          parsed.apiToken,
          parsed.spaceUrl,
          options.areaCode
        )
      case 'vonage':
        return this.vonage.provisionNumber(parsed.apiKey, parsed.apiSecret, options.country)
      case 'plivo':
        return this.plivo.provisionNumber(parsed.authId, parsed.authToken, options.country)
    }
  }

  // --- Status ---

  async getStatus(): Promise<ProviderConfig> {
    const config = await this.settings.getProviderConfig()
    if (!config) {
      return {
        provider: 'twilio',
        connected: false,
        webhooksConfigured: false,
        sipConfigured: false,
      }
    }
    return config
  }

  // --- A2P (Twilio Only) ---

  async submitA2pBrand(brandInfo: Record<string, string>): Promise<A2pBrandResult> {
    const creds = await this.decryptCredentials()
    if (!creds) throw new ProviderApiError('No credentials stored', 401, 'Not connected')

    const parsed = JSON.parse(creds) as TwilioCredentials
    const result = await this.twilio.submitA2pBrand(parsed, brandInfo)

    const currentConfig = await this.settings.getProviderConfig()
    if (currentConfig) {
      const updatedConfig: ProviderConfig = {
        ...currentConfig,
        brandSid: result.brandSid,
        a2pStatus: 'pending',
      }
      const existingCreds = await this.settings.getEncryptedCredentials()
      await this.settings.setProviderConfig(updatedConfig, existingCreds ?? undefined)
    }

    return result
  }

  async submitA2pCampaign(
    campaignBody: Record<string, unknown>
  ): Promise<{ campaignSid: string; status: 'pending' }> {
    const creds = await this.decryptCredentials()
    if (!creds) throw new ProviderApiError('No credentials stored', 401, 'Not connected')

    const parsed = JSON.parse(creds) as TwilioCredentials
    const currentConfig = await this.settings.getProviderConfig()
    if (!currentConfig?.brandSid) {
      throw new ProviderApiError('No brand registration found', 400, 'Submit A2P brand first')
    }
    if (!currentConfig.messagingServiceSid) {
      throw new ProviderApiError(
        'No messaging service SID configured',
        400,
        'Configure messaging service first'
      )
    }

    const result = await this.twilio.submitA2pCampaign(
      parsed,
      currentConfig.brandSid,
      currentConfig.messagingServiceSid,
      campaignBody
    )

    const updatedConfig: ProviderConfig = {
      ...currentConfig,
      campaignSid: result.campaignSid,
      a2pStatus: 'pending',
    }
    const existingCreds = await this.settings.getEncryptedCredentials()
    await this.settings.setProviderConfig(updatedConfig, existingCreds ?? undefined)

    return result
  }

  async getA2pStatus(): Promise<A2pStatusResult> {
    const creds = await this.decryptCredentials()
    if (!creds) throw new ProviderApiError('No credentials stored', 401, 'Not connected')

    const parsed = JSON.parse(creds) as TwilioCredentials
    const currentConfig = await this.settings.getProviderConfig()
    if (!currentConfig?.brandSid) {
      throw new ProviderApiError('No brand registration found', 400, 'Submit A2P brand first')
    }

    const result = await this.twilio.getA2pStatus(
      parsed,
      currentConfig.brandSid,
      currentConfig.campaignSid,
      currentConfig.messagingServiceSid
    )

    let a2pStatus: ProviderConfig['a2pStatus'] = 'pending'
    if (result.brandStatus === 'failed' || result.campaignStatus === 'failed') {
      a2pStatus = 'failed'
    } else if (
      result.brandStatus === 'approved' &&
      (!result.campaignStatus || result.campaignStatus === 'approved')
    ) {
      a2pStatus =
        result.campaignStatus === 'approved' ? 'approved' : currentConfig.a2pStatus || 'pending'
    }

    const updatedConfig: ProviderConfig = { ...currentConfig, a2pStatus }
    const existingCreds = await this.settings.getEncryptedCredentials()
    await this.settings.setProviderConfig(updatedConfig, existingCreds ?? undefined)

    return result
  }

  async skipA2p(): Promise<void> {
    const currentConfig = await this.settings.getProviderConfig()
    if (!currentConfig) {
      throw new ProviderApiError('No provider configured', 400, 'Connect a provider first')
    }

    const updatedConfig: ProviderConfig = { ...currentConfig, a2pStatus: 'skipped' }
    const existingCreds = await this.settings.getEncryptedCredentials()
    await this.settings.setProviderConfig(updatedConfig, existingCreds ?? undefined)
  }

  // --- Private Helpers ---

  private async decryptCredentials(): Promise<string | null> {
    const encrypted = await this.settings.getEncryptedCredentials()
    if (!encrypted) return null
    return this.crypto.serverDecrypt(encrypted as Ciphertext, LABEL_PROVIDER_CREDENTIAL_WRAP)
  }
}

export { OAuthStateError, ProviderApiError } from './types'
