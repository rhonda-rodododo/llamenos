import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'
import { checkPermission, requirePermission } from '../middleware/permission-guard'

const intakes = createRouter()

// ── Shared schemas ──

const PassthroughSchema = z.object({}).passthrough()
const ErrorSchema = z.object({ error: z.string() })

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'intake-abc123' }),
})

const SubmitIntakeBodySchema = z.object({
  contactId: z.string().optional(),
  callId: z.string().optional(),
  encryptedPayload: z.string(),
  payloadEnvelopes: z.array(z.object({}).passthrough()).optional(),
})

const UpdateIntakeStatusBodySchema = z.object({
  status: z.enum(['reviewed', 'merged', 'dismissed']),
})

// ── POST / — submit intake ──

const submitIntakeRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Intakes'],
  summary: 'Submit a new intake',
  middleware: [requirePermission('notes:create')],
  request: {
    body: { content: { 'application/json': { schema: SubmitIntakeBodySchema } } },
  },
  responses: {
    201: {
      description: 'Intake created',
      content: { 'application/json': { schema: z.object({ intake: PassthroughSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

intakes.openapi(submitIntakeRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  if (!body.encryptedPayload) {
    return c.json({ error: 'encryptedPayload is required' }, 400)
  }

  const intake = await services.intakes.submitIntake({
    hubId,
    contactId: body.contactId,
    callId: body.callId,
    encryptedPayload: body.encryptedPayload as import('@shared/crypto-types').Ciphertext,
    payloadEnvelopes:
      (body.payloadEnvelopes as unknown as import('@shared/types').RecipientEnvelope[]) ?? [],
    submittedBy: pubkey ?? '',
  })

  return c.json({ intake }, 201)
})

// ── GET / — list intakes ──

const listIntakesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Intakes'],
  summary: 'List intakes',
  responses: {
    200: {
      description: 'Intakes list',
      content: {
        'application/json': { schema: z.object({ intakes: z.array(PassthroughSchema) }) },
      },
    },
  },
})

intakes.openapi(listIntakesRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const status = c.req.query('status')
  const contactId = c.req.query('contactId')

  let intakesList = await services.intakes.listIntakes(hubId, { status, contactId })

  // Non-triage users only see their own
  if (!checkPermission(permissions, 'contacts:triage')) {
    intakesList = intakesList.filter((i) => i.submittedBy === pubkey)
  }

  return c.json({ intakes: intakesList }, 200)
})

// ── GET /{id} — single intake ──

const getIntakeRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Intakes'],
  summary: 'Get a single intake',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Intake details',
      content: { 'application/json': { schema: z.object({ intake: PassthroughSchema }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

intakes.openapi(getIntakeRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  const intake = await services.intakes.getIntake(id, hubId)
  if (!intake) return c.json({ error: 'Intake not found' }, 404)
  return c.json({ intake }, 200)
})

// ── PATCH /{id} — update intake status (triage) ──

const updateIntakeRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Intakes'],
  summary: 'Update intake status',
  middleware: [requirePermission('contacts:triage')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateIntakeStatusBodySchema } } },
  },
  responses: {
    200: {
      description: 'Intake updated',
      content: { 'application/json': { schema: z.object({ intake: PassthroughSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

intakes.openapi(updateIntakeRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const intake = await services.intakes.updateIntakeStatus(id, hubId, body.status, pubkey ?? '')
  if (!intake) return c.json({ error: 'Intake not found' }, 404)
  return c.json({ intake }, 200)
})

export default intakes
