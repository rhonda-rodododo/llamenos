import { createRoute, z } from '@hono/zod-openapi'
import type { MessagingChannelType, TelephonyProviderType } from '@shared/types'
import { getTelephony } from '../lib/adapters'
import { createRouter } from '../lib/openapi'
import { validateExternalUrlWithDns } from '../lib/ssrf-guard'
import { MESSAGING_CAPABILITIES } from '../messaging/capabilities'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import { TELEPHONY_CAPABILITIES } from '../telephony/capabilities'

const settings = createRouter()

// ── Shared schemas ──

const OkSchema = z.object({ ok: z.boolean() })
const ErrorSchema = z.object({ error: z.string() })
const PassthroughSchema = z.object({}).passthrough()

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'role-abc123' }),
})

const IvrAudioParamSchema = z.object({
  promptType: z
    .string()
    .openapi({ param: { name: 'promptType', in: 'path' }, example: 'greeting' }),
  language: z.string().openapi({ param: { name: 'language', in: 'path' }, example: 'en' }),
})

// ── GET /transcription ──

const getTranscriptionRoute = createRoute({
  method: 'get',
  path: '/transcription',
  tags: ['Settings'],
  summary: 'Get transcription settings',
  responses: {
    200: {
      description: 'Transcription settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getTranscriptionRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const data = await services.settings.getTranscriptionSettings(hubId ?? undefined)
  return c.json(data, 200)
})

// ── PATCH /transcription ──

const updateTranscriptionRoute = createRoute({
  method: 'patch',
  path: '/transcription',
  tags: ['Settings'],
  summary: 'Update transcription settings',
  middleware: [requirePermission('settings:manage-transcription')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Updated transcription settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateTranscriptionRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await services.settings.updateTranscriptionSettings(
    body as Parameters<typeof services.settings.updateTranscriptionSettings>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'transcriptionToggled',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated, 200)
})

// ── GET /custom-fields ──

const getCustomFieldsRoute = createRoute({
  method: 'get',
  path: '/custom-fields',
  tags: ['Settings'],
  summary: 'Get custom field definitions',
  responses: {
    200: {
      description: 'Custom fields list',
      content: { 'application/json': { schema: z.object({ fields: z.array(PassthroughSchema) }) } },
    },
  },
})

settings.openapi(getCustomFieldsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const canManageFields = checkPermission(permissions, 'settings:manage-fields')
  const fields = await services.settings.getCustomFields(
    canManageFields ? 'admin' : 'user',
    hubId ?? undefined
  )
  return c.json({ fields }, 200)
})

// ── PUT /custom-fields ──

const updateCustomFieldsRoute = createRoute({
  method: 'put',
  path: '/custom-fields',
  tags: ['Settings'],
  summary: 'Replace custom field definitions',
  middleware: [requirePermission('settings:manage-fields')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ fields: z.array(PassthroughSchema) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated custom fields',
      content: { 'application/json': { schema: z.object({ fields: z.array(PassthroughSchema) }) } },
    },
  },
})

settings.openapi(updateCustomFieldsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { fields } = c.req.valid('json')
  const updated = await services.settings.updateCustomFields(
    fields as unknown as Parameters<typeof services.settings.updateCustomFields>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'customFieldsUpdated', pubkey, {})
  return c.json({ fields: updated }, 200)
})

// ── GET /spam ──

const getSpamRoute = createRoute({
  method: 'get',
  path: '/spam',
  tags: ['Settings'],
  summary: 'Get spam mitigation settings',
  middleware: [requirePermission('settings:manage-spam')],
  responses: {
    200: {
      description: 'Spam settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getSpamRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.settings.getSpamSettings(hubId ?? undefined), 200)
})

// ── PATCH /spam ──

const updateSpamRoute = createRoute({
  method: 'patch',
  path: '/spam',
  tags: ['Settings'],
  summary: 'Update spam mitigation settings',
  middleware: [requirePermission('settings:manage-spam')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Updated spam settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateSpamRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await services.settings.updateSpamSettings(
    body as Parameters<typeof services.settings.updateSpamSettings>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'spamMitigationToggled',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated, 200)
})

// ── GET /call ──

const getCallRoute = createRoute({
  method: 'get',
  path: '/call',
  tags: ['Settings'],
  summary: 'Get call settings',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Call settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getCallRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.settings.getCallSettings(hubId ?? undefined), 200)
})

// ── PATCH /call ──

const updateCallRoute = createRoute({
  method: 'patch',
  path: '/call',
  tags: ['Settings'],
  summary: 'Update call settings',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Updated call settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateCallRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await services.settings.updateCallSettings(
    body as Parameters<typeof services.settings.updateCallSettings>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'callSettingsUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated, 200)
})

// ── GET /ivr-languages ──

const getIvrLanguagesRoute = createRoute({
  method: 'get',
  path: '/ivr-languages',
  tags: ['Settings'],
  summary: 'Get enabled IVR languages',
  middleware: [requirePermission('settings:manage-ivr')],
  responses: {
    200: {
      description: 'Enabled IVR languages',
      content: {
        'application/json': {
          schema: z.object({ enabledLanguages: z.array(z.string()) }),
        },
      },
    },
  },
})

settings.openapi(getIvrLanguagesRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const enabledLanguages = await services.settings.getIvrLanguages(hubId ?? undefined)
  return c.json({ enabledLanguages }, 200)
})

// ── PATCH /ivr-languages ──

const updateIvrLanguagesRoute = createRoute({
  method: 'patch',
  path: '/ivr-languages',
  tags: ['Settings'],
  summary: 'Update enabled IVR languages',
  middleware: [requirePermission('settings:manage-ivr')],
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ enabledLanguages: z.array(z.string()) }) },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated IVR languages config',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateIvrLanguagesRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { enabledLanguages } = c.req.valid('json')
  const updated = await services.settings.updateIvrLanguages(enabledLanguages, hubId ?? undefined)
  await services.records.addAuditEntry(hubId ?? 'global', 'ivrLanguagesUpdated', pubkey, {
    enabledLanguages,
  } as Record<string, unknown>)
  return c.json({ enabledLanguages: updated }, 200)
})

// ── GET /webauthn ──

const getWebauthnRoute = createRoute({
  method: 'get',
  path: '/webauthn',
  tags: ['Settings'],
  summary: 'Get WebAuthn settings',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'WebAuthn settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getWebauthnRoute, async (c) => {
  const services = c.get('services')
  return c.json(await services.identity.getWebAuthnSettings(), 200)
})

// ── PATCH /webauthn ──

const updateWebauthnRoute = createRoute({
  method: 'patch',
  path: '/webauthn',
  tags: ['Settings'],
  summary: 'Update WebAuthn settings',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Updated WebAuthn settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateWebauthnRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await services.identity.updateWebAuthnSettings(
    body as Parameters<typeof services.identity.updateWebAuthnSettings>[0]
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'webauthnSettingsUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated, 200)
})

// ── GET /provider-health ──

const providerHealthRoute = createRoute({
  method: 'get',
  path: '/provider-health',
  tags: ['Settings'],
  summary: 'Get provider health status',
  middleware: [requirePermission('settings:read')],
  responses: {
    200: {
      description: 'Provider health status',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    503: {
      description: 'Health service unavailable',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

settings.openapi(providerHealthRoute, async (c) => {
  const healthService = c.get('services').providerHealth
  if (!healthService) return c.json({ error: 'Health service not available' }, 503)
  return c.json(healthService.getHealthStatus(), 200)
})

// ── GET /telephony-provider ──

const getTelephonyProviderRoute = createRoute({
  method: 'get',
  path: '/telephony-provider',
  tags: ['Settings'],
  summary: 'Get telephony provider config',
  middleware: [requirePermission('settings:manage-telephony')],
  responses: {
    200: {
      description: 'Telephony provider configuration',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getTelephonyProviderRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const config = await services.settings.getTelephonyProvider(hubId ?? undefined)
  return c.json(config ?? {}, 200)
})

// ── PATCH /telephony-provider ──

const updateTelephonyProviderRoute = createRoute({
  method: 'patch',
  path: '/telephony-provider',
  tags: ['Settings'],
  summary: 'Update telephony provider config',
  middleware: [requirePermission('settings:manage-telephony')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Updated telephony provider config',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateTelephonyProviderRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await services.settings.updateTelephonyProvider(
    body as Parameters<typeof services.settings.updateTelephonyProvider>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'telephonyProviderChanged', pubkey, {
    type: (body as { type?: string }).type,
  })
  return c.json(updated, 200)
})

// ── POST /telephony-provider/test ──

const testTelephonyRoute = createRoute({
  method: 'post',
  path: '/telephony-provider/test',
  tags: ['Settings'],
  summary: 'Test telephony provider connection',
  middleware: [requirePermission('settings:manage-telephony')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Connection test result',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    400: {
      description: 'Invalid config or connection failed',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(testTelephonyRoute, async (c) => {
  const config = c.req.valid('json') as { type: string; [key: string]: unknown }
  const capabilities = TELEPHONY_CAPABILITIES[config.type as TelephonyProviderType]
  if (!capabilities) return c.json({ ok: false, error: `Unknown provider: ${config.type}` }, 400)

  const parsed = capabilities.credentialSchema.safeParse(config)
  if (!parsed.success)
    return c.json({ ok: false, error: 'Invalid config', details: parsed.error }, 400)

  // DNS rebinding protection: validate any URL fields in self-hosted provider configs
  const data = parsed.data as Record<string, unknown>
  for (const key of ['ariUrl', 'eslUrl'] as const) {
    const val = data[key]
    if (typeof val === 'string') {
      const err = await validateExternalUrlWithDns(val, key)
      if (err) return c.json({ ok: false, error: err }, 400)
    }
  }

  try {
    const result = await capabilities.testConnection(parsed.data)
    return c.json({ ok: result.connected, ...result }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return c.json({ ok: false, error: message }, 400)
  }
})

// ── GET /telephony-provider/verify-webhook ──

const verifyWebhookRoute = createRoute({
  method: 'get',
  path: '/telephony-provider/verify-webhook',
  tags: ['Settings'],
  summary: 'Verify telephony webhook configuration',
  middleware: [requirePermission('settings:manage-telephony')],
  responses: {
    200: {
      description: 'Webhook verification result',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    400: {
      description: 'Missing configuration',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    503: {
      description: 'Provider not configured',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

settings.openapi(verifyWebhookRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const env = c.env

  const adapter = await getTelephony(services.settings, hubId ?? undefined, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) {
    return c.json({ error: 'Telephony provider not configured' }, 503)
  }

  const config = await services.settings.getTelephonyProvider(hubId ?? undefined)
  const phoneNumber = config?.phoneNumber || env.TWILIO_PHONE_NUMBER
  if (!phoneNumber) {
    return c.json({ error: 'No phone number configured' }, 400)
  }

  const appUrl = env.APP_URL
  if (!appUrl) {
    return c.json({ error: 'APP_URL not configured — cannot verify webhook' }, 400)
  }

  const result = await adapter.verifyWebhookConfig(phoneNumber, appUrl)
  return c.json(result, 200)
})

// ── POST /messaging/test ──

const testMessagingRoute = createRoute({
  method: 'post',
  path: '/messaging/test',
  tags: ['Settings'],
  summary: 'Test messaging channel connection',
  middleware: [requirePermission('settings:manage-messaging')],
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ channel: z.string() }) } },
    },
  },
  responses: {
    200: {
      description: 'Connection test result',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    400: {
      description: 'Invalid or unconfigured channel',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

settings.openapi(testMessagingRoute, async (c) => {
  const hubId = c.get('hubId')
  const body = c.req.valid('json')
  const channel = body.channel as MessagingChannelType
  const capabilities = MESSAGING_CAPABILITIES[channel]
  if (!capabilities) return c.json({ error: `Unknown channel: ${body.channel}` }, 400)

  const services = c.get('services')
  const messagingConfig = await services.settings.getMessagingConfig(hubId ?? undefined)
  if (!messagingConfig) return c.json({ error: 'Messaging not configured' }, 400)

  const channelConfig = messagingConfig[channel as keyof typeof messagingConfig]
  if (!channelConfig || typeof channelConfig !== 'object') {
    return c.json({ error: `Channel ${body.channel} not configured` }, 400)
  }

  try {
    const result = await capabilities.testConnection(
      channelConfig as Parameters<typeof capabilities.testConnection>[0]
    )
    return c.json(result, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return c.json({ error: message } as { error: string }, 400)
  }
})

// ── GET /messaging ──

const getMessagingRoute = createRoute({
  method: 'get',
  path: '/messaging',
  tags: ['Settings'],
  summary: 'Get messaging config',
  middleware: [requirePermission('settings:manage-messaging')],
  responses: {
    200: {
      description: 'Messaging configuration',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getMessagingRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.settings.getMessagingConfig(hubId ?? undefined), 200)
})

// ── PATCH /messaging ──

const updateMessagingRoute = createRoute({
  method: 'patch',
  path: '/messaging',
  tags: ['Settings'],
  summary: 'Update messaging config',
  middleware: [requirePermission('settings:manage-messaging')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Updated messaging config',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateMessagingRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await services.settings.updateMessagingConfig(
    body as Parameters<typeof services.settings.updateMessagingConfig>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'messagingConfigUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated, 200)
})

// ── GET /setup ──

const getSetupRoute = createRoute({
  method: 'get',
  path: '/setup',
  tags: ['Settings'],
  summary: 'Get setup wizard state',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Setup state',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getSetupRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.settings.getSetupState(hubId ?? undefined), 200)
})

// ── PATCH /setup ──

const updateSetupRoute = createRoute({
  method: 'patch',
  path: '/setup',
  tags: ['Settings'],
  summary: 'Update setup wizard state',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Updated setup state',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateSetupRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await services.settings.updateSetupState(
    body as Parameters<typeof services.settings.updateSetupState>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'setupStateUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated, 200)
})

// ── GET /ivr-audio ──

const getIvrAudioRoute = createRoute({
  method: 'get',
  path: '/ivr-audio',
  tags: ['Settings'],
  summary: 'List IVR audio recordings',
  middleware: [requirePermission('settings:manage-ivr')],
  responses: {
    200: {
      description: 'IVR audio recordings list',
      content: {
        'application/json': {
          schema: z.object({ recordings: z.array(PassthroughSchema) }),
        },
      },
    },
  },
})

settings.openapi(getIvrAudioRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const recordings = await services.settings.getIvrAudioList(hubId ?? undefined)
  return c.json({ recordings }, 200)
})

// ── PUT /ivr-audio/{promptType}/{language} ──

const uploadIvrAudioRoute = createRoute({
  method: 'put',
  path: '/ivr-audio/{promptType}/{language}',
  tags: ['Settings'],
  summary: 'Upload IVR audio recording',
  middleware: [requirePermission('settings:manage-ivr')],
  request: {
    params: IvrAudioParamSchema,
  },
  responses: {
    200: {
      description: 'Audio uploaded',
      content: { 'application/json': { schema: OkSchema } },
    },
  },
})

settings.openapi(uploadIvrAudioRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { promptType, language } = c.req.valid('param')
  const rawBuffer = await c.req.arrayBuffer()
  const audioData = btoa(String.fromCharCode(...new Uint8Array(rawBuffer)))
  const mimeType = c.req.header('content-type') || 'audio/wav'
  await services.settings.upsertIvrAudio({
    hubId: hubId ?? 'global',
    promptType,
    language,
    audioData,
    mimeType,
  })
  await services.records.addAuditEntry(hubId ?? 'global', 'ivrAudioUploaded', pubkey, {
    promptType,
    language,
  })
  return c.json({ ok: true }, 200)
})

// ── DELETE /ivr-audio/{promptType}/{language} ──

const deleteIvrAudioRoute = createRoute({
  method: 'delete',
  path: '/ivr-audio/{promptType}/{language}',
  tags: ['Settings'],
  summary: 'Delete IVR audio recording',
  middleware: [requirePermission('settings:manage-ivr')],
  request: {
    params: IvrAudioParamSchema,
  },
  responses: {
    200: {
      description: 'Audio deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
  },
})

settings.openapi(deleteIvrAudioRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { promptType, language } = c.req.valid('param')
  await services.settings.deleteIvrAudio(promptType, language, hubId ?? undefined)
  await services.records.addAuditEntry(hubId ?? 'global', 'ivrAudioDeleted', pubkey, {
    promptType,
    language,
  })
  return c.json({ ok: true }, 200)
})

// ── GET /roles ──

const listRolesRoute = createRoute({
  method: 'get',
  path: '/roles',
  tags: ['Settings'],
  summary: 'List roles',
  responses: {
    200: {
      description: 'Roles list',
      content: {
        'application/json': {
          schema: z.object({ roles: z.array(PassthroughSchema) }),
        },
      },
    },
  },
})

settings.openapi(listRolesRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const rolesList = await services.settings.listRoles(hubId ?? undefined)
  return c.json({ roles: rolesList }, 200)
})

// ── POST /roles ──

const createRoleRoute = createRoute({
  method: 'post',
  path: '/roles',
  tags: ['Settings'],
  summary: 'Create a role',
  middleware: [requirePermission('system:manage-roles')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    201: {
      description: 'Role created',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(createRoleRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const role = await services.settings.createRole(
    body as unknown as Parameters<typeof services.settings.createRole>[0]
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'roleCreated', pubkey, {
    name: (body as { name?: string }).name,
  })
  return c.json(role, 201)
})

// ── PATCH /roles/{id} ──

const updateRoleRoute = createRoute({
  method: 'patch',
  path: '/roles/{id}',
  tags: ['Settings'],
  summary: 'Update a role',
  middleware: [requirePermission('system:manage-roles')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Role updated',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateRoleRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const role = await services.settings.updateRole(
    id,
    body as Parameters<typeof services.settings.updateRole>[1]
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'roleUpdated', pubkey, { roleId: id })
  return c.json(role, 200)
})

// ── DELETE /roles/{id} ──

const deleteRoleRoute = createRoute({
  method: 'delete',
  path: '/roles/{id}',
  tags: ['Settings'],
  summary: 'Delete a role',
  middleware: [requirePermission('system:manage-roles')],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: {
      description: 'Role deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
  },
})

settings.openapi(deleteRoleRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  await services.settings.deleteRole(id)
  await services.records.addAuditEntry(hubId ?? 'global', 'roleDeleted', pubkey, { roleId: id })
  return c.json({ ok: true }, 200)
})

// ── GET /retention ──

const getRetentionRoute = createRoute({
  method: 'get',
  path: '/retention',
  tags: ['Settings'],
  summary: 'Get data retention settings',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Retention settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getRetentionRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.gdpr.getRetentionSettings(hubId ?? undefined), 200)
})

// ── PUT /retention ──

const updateRetentionRoute = createRoute({
  method: 'put',
  path: '/retention',
  tags: ['Settings'],
  summary: 'Update data retention settings',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Updated retention settings',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(updateRetentionRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json') as Record<string, unknown>
  const updated = await services.gdpr.updateRetentionSettings(
    body as Parameters<typeof services.gdpr.updateRetentionSettings>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'retentionSettingsUpdated', pubkey, {})
  return c.json(updated, 200)
})

// ── GET /permissions ──

const getPermissionsRoute = createRoute({
  method: 'get',
  path: '/permissions',
  tags: ['Settings'],
  summary: 'Get permissions catalog',
  middleware: [requirePermission('system:manage-roles')],
  responses: {
    200: {
      description: 'Permissions catalog',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

settings.openapi(getPermissionsRoute, async (c) => {
  const { PERMISSION_CATALOG, getPermissionsByDomain } = await import('../../shared/permissions')
  return c.json(
    {
      permissions: PERMISSION_CATALOG,
      byDomain: getPermissionsByDomain(),
    },
    200
  )
})

// ── GET /fallback-group ──

const getFallbackGroupRoute = createRoute({
  method: 'get',
  path: '/fallback-group',
  tags: ['Settings'],
  summary: 'Get fallback group pubkeys',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Fallback group',
      content: {
        'application/json': {
          schema: z.object({ pubkeys: z.array(z.string()) }),
        },
      },
    },
  },
})

settings.openapi(getFallbackGroupRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkeys = await services.settings.getFallbackGroup(hubId ?? undefined)
  return c.json({ pubkeys }, 200)
})

// ── PUT /fallback-group ──

const updateFallbackGroupRoute = createRoute({
  method: 'put',
  path: '/fallback-group',
  tags: ['Settings'],
  summary: 'Update fallback group pubkeys',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ pubkeys: z.array(z.string()) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated fallback group',
      content: {
        'application/json': {
          schema: z.object({ pubkeys: z.array(z.string()) }),
        },
      },
    },
  },
})

settings.openapi(updateFallbackGroupRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { pubkeys } = c.req.valid('json')
  await services.settings.setFallbackGroup(pubkeys, hubId ?? undefined)
  await services.records.addAuditEntry(hubId ?? 'global', 'fallbackGroupUpdated', pubkey, {
    pubkeys,
  })
  return c.json({ pubkeys }, 200)
})

export default settings
