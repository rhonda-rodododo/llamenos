import { createRoute, z } from '@hono/zod-openapi'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import { permissionGranted, resolveHubPermissions } from '@shared/permissions'
import type { RecipientEnvelope } from '@shared/types'
import { createRouter } from '../../lib/openapi'
import { requirePermission } from '../../middleware/permission-guard'
import { baseMiddleware, CallIdParamSchema, ErrorSchema, PassthroughSchema } from './shared'

const discovery = createRouter()

// ── GET /recipients ──

const getRecipientsRoute = createRoute({
  method: 'get',
  path: '/recipients',
  tags: ['Contacts'],
  summary: 'Get pubkeys by contact permission tier',
  middleware: baseMiddleware,
  responses: {
    200: {
      description: 'Recipient pubkeys',
      content: {
        'application/json': {
          schema: z.object({
            summaryPubkeys: z.array(z.string()),
            piiPubkeys: z.array(z.string()),
          }),
        },
      },
    },
  },
})

discovery.openapi(getRecipientsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'

  const [allUsers, allRoles] = await Promise.all([
    services.identity.getUsers(),
    services.settings.listRoles(),
  ])

  const summaryPubkeys: string[] = []
  const piiPubkeys: string[] = []

  for (const usr of allUsers) {
    if (!usr.active) continue
    const perms = resolveHubPermissions(usr.roles, usr.hubRoles ?? [], allRoles, hubId)
    if (permissionGranted(perms, 'contacts:envelope-summary')) {
      summaryPubkeys.push(usr.pubkey)
    }
    if (permissionGranted(perms, 'contacts:envelope-full')) {
      piiPubkeys.push(usr.pubkey)
    }
  }

  return c.json({ summaryPubkeys, piiPubkeys }, 200)
})

// ── GET /check-duplicate ──

const checkDuplicateRoute = createRoute({
  method: 'get',
  path: '/check-duplicate',
  tags: ['Contacts'],
  summary: 'Check for duplicate contact by identifier hash or phone',
  middleware: baseMiddleware,
  responses: {
    200: {
      description: 'Duplicate check result',
      content: {
        'application/json': {
          schema: z.object({
            exists: z.boolean(),
            contactId: z.string().optional(),
          }),
        },
      },
    },
    400: {
      description: 'Missing parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

discovery.openapi(checkDuplicateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'

  let hash = c.req.query('identifierHash') as HmacHash | undefined
  const phone = c.req.query('phone')

  if (!hash && phone) {
    hash = services.crypto.hmac(phone, HMAC_PHONE_PREFIX) as HmacHash
  }

  if (!hash) {
    return c.json({ error: 'identifierHash or phone query parameter is required' }, 400)
  }

  const existing = await services.contacts.checkDuplicate(hash, hubId)
  return c.json({ exists: existing !== null, contactId: existing?.id ?? undefined }, 200)
})

// ── POST /hash-phone ──

const HashPhoneBodySchema = z.object({
  phone: z.string(),
})

const hashPhoneRoute = createRoute({
  method: 'post',
  path: '/hash-phone',
  tags: ['Contacts'],
  summary: 'Compute HMAC for a phone number',
  middleware: baseMiddleware,
  request: {
    body: { content: { 'application/json': { schema: HashPhoneBodySchema } } },
  },
  responses: {
    200: {
      description: 'Phone hash',
      content: {
        'application/json': { schema: z.object({ identifierHash: z.string() }) },
      },
    },
    400: {
      description: 'Missing phone',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

discovery.openapi(hashPhoneRoute, async (c) => {
  const services = c.get('services')
  const body = c.req.valid('json')
  if (!body.phone) {
    return c.json({ error: 'phone is required' }, 400)
  }
  const identifierHash = services.crypto.hmac(body.phone, HMAC_PHONE_PREFIX)
  return c.json({ identifierHash }, 200)
})

// ── POST /from-call/{callId} ──

const CreateFromCallBodySchema = z.object({
  contactType: z.string(),
  riskLevel: z.string(),
  tags: z.array(z.string()).optional(),
  encryptedDisplayName: z.string(),
  displayNameEnvelopes: z.array(z.object({}).passthrough()),
  encryptedPhone: z.string().optional(),
  phoneEnvelopes: z.array(z.object({}).passthrough()).optional(),
  identifierHash: z.string().optional(),
  encryptedFullName: z.string().optional(),
  fullNameEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPII: z.string().optional(),
  piiEnvelopes: z.array(z.object({}).passthrough()).optional(),
})

const createFromCallRoute = createRoute({
  method: 'post',
  path: '/from-call/{callId}',
  tags: ['Contacts'],
  summary: 'Create contact from call + auto-link + auto-assign',
  middleware: [...baseMiddleware, requirePermission('contacts:create')],
  request: {
    params: CallIdParamSchema,
    body: { content: { 'application/json': { schema: CreateFromCallBodySchema } } },
  },
  responses: {
    201: {
      description: 'Contact created and linked',
      content: {
        'application/json': {
          schema: z.object({ contact: PassthroughSchema, linked: z.boolean() }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

discovery.openapi(createFromCallRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { callId } = c.req.valid('param')

  const body = c.req.valid('json')

  if (
    !body.contactType ||
    !body.riskLevel ||
    !body.encryptedDisplayName ||
    !body.displayNameEnvelopes
  ) {
    return c.json(
      {
        error:
          'contactType, riskLevel, encryptedDisplayName, and displayNameEnvelopes are required',
      },
      400
    )
  }

  const contact = await services.contacts.createContact({
    hubId,
    contactType: body.contactType,
    riskLevel: body.riskLevel,
    tags: body.tags ?? [],
    identifierHash: body.identifierHash as HmacHash | undefined,
    encryptedDisplayName: body.encryptedDisplayName as Ciphertext,
    displayNameEnvelopes: body.displayNameEnvelopes as unknown as RecipientEnvelope[],
    encryptedPhone: body.encryptedPhone as Ciphertext | undefined,
    phoneEnvelopes: body.phoneEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedFullName: body.encryptedFullName as Ciphertext | undefined,
    fullNameEnvelopes: body.fullNameEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPII: body.encryptedPII as Ciphertext | undefined,
    piiEnvelopes: body.piiEnvelopes as unknown as RecipientEnvelope[] | undefined,
    createdBy: pubkey ?? '',
  })

  await services.contacts.linkCall(contact.id, callId, hubId, pubkey ?? '')

  return c.json({ contact, linked: true }, 201)
})

export default discovery
