import { createRoute, z } from '@hono/zod-openapi'
import type { SignalRegistrationPending } from '../../../shared/types'
import { createRouter } from '../../lib/openapi'
import { validateExternalUrl } from '../../lib/ssrf-guard'
import { completeSignalRegistration } from '../../messaging/signal/registration'
import { requirePermission } from '../../middleware/permission-guard'

const signalRegistration = createRouter()

const RegisterSchema = z.object({
  bridgeUrl: z.string().min(1),
  registeredNumber: z.string().min(1),
  useVoice: z.boolean().optional(),
})

const VerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
})

const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  tags: ['Signal Registration'],
  summary: 'Initiate Signal number registration',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: { 'application/json': { schema: RegisterSchema } },
    },
  },
  responses: {
    200: {
      description: 'Registration initiated',
      content: {
        'application/json': { schema: z.object({ ok: z.boolean(), method: z.string() }) },
      },
    },
    400: {
      description: 'Invalid bridge URL or request',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), details: z.any().optional() }),
        },
      },
    },
    409: {
      description: 'Registration already in progress or Signal already configured',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    502: {
      description: 'Bridge error',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

signalRegistration.openapi(registerRoute, async (c) => {
  const services = c.get('services')

  const body = c.req.valid('json')
  const { bridgeUrl, registeredNumber, useVoice } = body

  try {
    const parsedUrl = new URL(bridgeUrl)
    if (parsedUrl.protocol !== 'https:') {
      return c.json({ error: 'Bridge URL must use HTTPS' }, 400)
    }
  } catch {
    return c.json({ error: 'Invalid bridge URL' }, 400)
  }

  const ssrfError = validateExternalUrl(bridgeUrl, 'Bridge URL')
  if (ssrfError) {
    return c.json({ error: ssrfError }, 400)
  }

  // Check for existing pending registration
  const existingPending = await services.settings.getSignalRegistrationPending()
  if (existingPending && existingPending.status === 'pending') {
    return c.json({ error: 'Registration already in progress' }, 409)
  }

  // Check if Signal is already fully configured
  const msgConfig = await services.settings.getMessagingConfig()
  if (msgConfig?.signal?.registeredNumber && !existingPending) {
    return c.json({ error: 'Signal is already configured' }, 409)
  }

  const method = useVoice ? 'voice' : 'sms'

  // Write pending state BEFORE calling bridge (race condition prevention)
  const pending: SignalRegistrationPending = {
    number: registeredNumber,
    bridgeUrl,
    method,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    status: 'pending',
  }

  await services.settings.setSignalRegistrationPending(pending)

  // Call the bridge to initiate registration
  try {
    const registerUrl = `${bridgeUrl}/v1/register/${encodeURIComponent(registeredNumber)}`
    const bridgeBody = useVoice ? JSON.stringify({ use_voice: true }) : undefined
    const bridgeRes = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bridgeBody,
    })

    if (!bridgeRes.ok) {
      await services.settings.clearSignalRegistrationPending()
      const errorText = await bridgeRes.text().catch(() => `HTTP ${bridgeRes.status}`)
      return c.json({ error: `Bridge error: ${errorText}` }, 502)
    }

    return c.json({ ok: true, method }, 200)
  } catch (err) {
    await services.settings.clearSignalRegistrationPending()
    const errorMsg = err instanceof Error ? err.message : String(err)
    return c.json({ error: `Bridge connection failed: ${errorMsg}` }, 502)
  }
})

const statusRoute = createRoute({
  method: 'get',
  path: '/registration-status',
  tags: ['Signal Registration'],
  summary: 'Get Signal registration status',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Registration status',
      content: {
        'application/json': {
          schema: z.union([
            z.object({ status: z.literal('complete') }),
            z.object({ status: z.literal('idle') }),
            z.object({
              status: z.string(),
              method: z.string(),
              expiresAt: z.string(),
              error: z.string().nullable(),
            }),
          ]),
        },
      },
    },
  },
})

signalRegistration.openapi(statusRoute, async (c) => {
  const services = c.get('services')

  const pending = await services.settings.getSignalRegistrationPending()

  if (!pending) {
    const msgConfig = await services.settings.getMessagingConfig()
    if (msgConfig?.signal?.registeredNumber) {
      return c.json({ status: 'complete' }, 200)
    }
    return c.json({ status: 'idle' }, 200)
  }

  return c.json(
    {
      status: pending.status,
      method: pending.method,
      expiresAt: pending.expiresAt,
      error: pending.error ?? null,
    },
    200
  )
})

const verifyRoute = createRoute({
  method: 'post',
  path: '/verify',
  tags: ['Signal Registration'],
  summary: 'Verify Signal registration code',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: { 'application/json': { schema: VerifySchema } },
    },
  },
  responses: {
    200: {
      description: 'Verification successful',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid code or verification failed',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), details: z.any().optional() }),
        },
      },
    },
    404: {
      description: 'No pending registration',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

signalRegistration.openapi(verifyRoute, async (c) => {
  const services = c.get('services')

  const body = c.req.valid('json')
  const { code } = body

  const pending = await services.settings.getSignalRegistrationPending()

  if (!pending) {
    return c.json({ error: 'No pending registration found' }, 404)
  }

  await completeSignalRegistration(pending, code, services.settings)

  // Re-read pending state to check result
  const result = await services.settings.getSignalRegistrationPending()

  if (!result || result.status === 'complete') {
    return c.json({ ok: true }, 200)
  }

  return c.json({ error: result.error || 'Verification failed' }, 400)
})

export default signalRegistration
