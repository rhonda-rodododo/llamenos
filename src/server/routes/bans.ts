import { createRoute, z } from '@hono/zod-openapi'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import { isValidE164 } from '../lib/helpers'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

const bans = createRouter()

// ── Shared schemas ──

const BanResponseSchema = z.object({
  phone: z.string(),
  reason: z.string(),
  bannedBy: z.string(),
  bannedAt: z.string(),
  encryptedPhone: z.string().optional(),
  encryptedReason: z.string().optional(),
})

const CreateBanBodySchema = z.object({
  phone: z.string(),
  reason: z.string(),
})

const BulkBanBodySchema = z.object({
  phones: z.array(z.string()),
  reason: z.string(),
})

const PhoneParamSchema = z.object({
  phone: z.string().openapi({ param: { name: 'phone', in: 'path' }, example: '%2B12125551234' }),
})

// ── POST / — create a ban ──

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Bans'],
  summary: 'Ban a phone number',
  middleware: [requirePermission('bans:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateBanBodySchema } } },
  },
  responses: {
    201: {
      description: 'Ban created',
      content: { 'application/json': { schema: z.object({ ban: BanResponseSchema }) } },
    },
    400: {
      description: 'Invalid phone number',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

bans.openapi(createRoute_, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  if (!isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 400)
  }
  const ban = await services.records.addBan({ ...body, bannedBy: pubkey, hubId: hubId ?? 'global' })
  await services.records.addAuditEntry(hubId ?? 'global', 'numberBanned', pubkey, {
    // HIGH-W3: Store HMAC hash of phone, never plaintext, per DATA_CLASSIFICATION rules
    phoneHash: services.crypto.hmac(body.phone, HMAC_PHONE_PREFIX),
  })
  return c.json({ ban }, 201)
})

// ── GET / — list bans ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Bans'],
  summary: 'List banned phone numbers',
  middleware: [requirePermission('bans:read')],
  responses: {
    200: {
      description: 'Bans list',
      content: {
        'application/json': { schema: z.object({ bans: z.array(BanResponseSchema) }) },
      },
    },
  },
})

bans.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const banList = await services.records.getBans(hubId)
  return c.json({ bans: banList }, 200)
})

// ── POST /bulk — bulk ban ──

const bulkRoute = createRoute({
  method: 'post',
  path: '/bulk',
  tags: ['Bans'],
  summary: 'Bulk ban phone numbers',
  middleware: [requirePermission('bans:bulk-create')],
  request: {
    body: { content: { 'application/json': { schema: BulkBanBodySchema } } },
  },
  responses: {
    200: {
      description: 'Bulk ban count',
      content: { 'application/json': { schema: z.object({ count: z.number() }) } },
    },
    400: {
      description: 'Invalid phone number(s)',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

bans.openapi(bulkRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const invalidPhones = body.phones.filter((p) => !isValidE164(p))
  if (invalidPhones.length > 0) {
    return c.json(
      {
        error: `Invalid phone number(s): ${invalidPhones[0]}. Use E.164 format (e.g. +12125551234)`,
      },
      400
    )
  }
  const count = await services.records.bulkAddBans({
    phones: body.phones,
    reason: body.reason,
    bannedBy: pubkey,
    hubId: hubId ?? 'global',
  })
  await services.records.addAuditEntry(hubId ?? 'global', 'numberBanned', pubkey, {
    count: body.phones.length,
    bulk: true,
  })
  return c.json({ count }, 200)
})

// ── DELETE /{phone} — remove a ban ──

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{phone}',
  tags: ['Bans'],
  summary: 'Remove a ban',
  middleware: [requirePermission('bans:delete')],
  request: { params: PhoneParamSchema },
  responses: {
    200: {
      description: 'Ban removed',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

bans.openapi(deleteRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { phone } = c.req.valid('param')
  const decodedPhone = decodeURIComponent(phone)
  await services.records.removeBan(decodedPhone, hubId)
  await services.records.addAuditEntry(hubId ?? 'global', 'numberUnbanned', pubkey, {})
  return c.json({ ok: true }, 200)
})

export default bans
