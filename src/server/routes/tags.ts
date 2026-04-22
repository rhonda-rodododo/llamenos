import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'
import { checkPermission, requirePermission } from '../middleware/permission-guard'

const tags = createRouter()

// ── Shared schemas ──

const PassthroughSchema = z.object({}).passthrough()
const ErrorSchema = z.object({ error: z.string() })
const OkSchema = z.object({ ok: z.boolean(), removedFromContacts: z.number() })

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'tag-abc123' }),
})

// Hub-key-encrypted create: either name (plaintext fallback) OR encryptedLabel
// (hub-key ciphertext) must be provided. See CreateTagSchema in shared/schemas/tags.ts.
const CreateTagBodySchema = z
  .object({
    // Client-generated UUID. Required when `encryptedLabel` is provided so
    // the server stores the same id the client used as AAD `recordId`.
    id: z.string().uuid().optional(),
    name: z.string().min(1).optional(),
    encryptedLabel: z.string().min(1).optional(),
    color: z.string().optional(),
    encryptedCategory: z.string().optional(),
  })
  .refine((data) => data.name !== undefined || data.encryptedLabel !== undefined, {
    message: 'Either name or encryptedLabel must be provided',
  })

const UpdateTagBodySchema = z.object({
  encryptedLabel: z.string().optional(),
  color: z.string().optional(),
  encryptedCategory: z.string().nullable().optional(),
})

// ── GET / — list tags ──

const listTagsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Tags'],
  summary: 'List tags for hub',
  responses: {
    200: {
      description: 'Tags list',
      content: {
        'application/json': { schema: z.object({ tags: z.array(PassthroughSchema) }) },
      },
    },
  },
})

tags.openapi(listTagsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const tagsList = await services.tags.listTags(hubId)
  return c.json({ tags: tagsList }, 200)
})

// ── POST / — create tag ──

const createTagRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Tags'],
  summary: 'Create a tag',
  request: {
    body: { content: { 'application/json': { schema: CreateTagBodySchema } } },
  },
  responses: {
    201: {
      description: 'Tag created',
      content: { 'application/json': { schema: z.object({ tag: PassthroughSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    409: {
      description: 'Conflict — tag already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

tags.openapi(createTagRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  if (
    !checkPermission(permissions, 'tags:create') &&
    !checkPermission(permissions, 'settings:manage-fields')
  ) {
    return c.json({ error: 'Forbidden', required: 'tags:create' }, 403)
  }

  const body = c.req.valid('json')

  if (!body.name && !body.encryptedLabel) {
    return c.json({ error: 'Either name or encryptedLabel must be provided' }, 400)
  }

  // Check if strictTags prevents this user from creating (admins with settings:manage-fields bypass)
  if (!checkPermission(permissions, 'settings:manage-fields')) {
    const strict = await services.tags.isStrictTags(hubId)
    if (strict) {
      return c.json({ error: 'Tag creation is restricted — strictTags is enabled' }, 403)
    }
  }

  try {
    const tag = await services.tags.createTag({
      id: body.id,
      hubId,
      name: body.name,
      encryptedLabel: body.encryptedLabel as import('@shared/crypto-types').Ciphertext | undefined,
      color: body.color,
      encryptedCategory:
        (body.encryptedCategory as import('@shared/crypto-types').Ciphertext | undefined) ?? null,
      createdBy: pubkey ?? '',
    })
    return c.json({ tag }, 201)
  } catch (err: unknown) {
    const cause = (err as { cause?: unknown }).cause
    const isUniqueViolation =
      (typeof (cause as { errno?: unknown })?.errno === 'string' &&
        (cause as { errno: string }).errno === '23505') ||
      (err instanceof Error &&
        (err.message.includes('unique') || err.message.includes('duplicate key'))) ||
      (cause instanceof Error &&
        (cause.message.includes('unique') || cause.message.includes('duplicate key')))
    if (isUniqueViolation) {
      return c.json({ error: 'Tag already exists' }, 409)
    }
    throw err
  }
})

// ── PATCH /{id} — update tag ──

const updateTagRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Tags'],
  summary: 'Update a tag',
  middleware: [requirePermission('settings:manage-fields')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateTagBodySchema } } },
  },
  responses: {
    200: {
      description: 'Tag updated',
      content: { 'application/json': { schema: z.object({ tag: PassthroughSchema }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

tags.openapi(updateTagRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  const body = c.req.valid('json')

  const tag = await services.tags.updateTag(id, hubId, body as Record<string, unknown>)
  if (!tag) return c.json({ error: 'Tag not found' }, 404)
  return c.json({ tag }, 200)
})

// ── DELETE /{id} — delete tag ──

const deleteTagRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Tags'],
  summary: 'Delete a tag',
  middleware: [requirePermission('settings:manage-fields')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Tag deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

tags.openapi(deleteTagRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  const usageCount = await services.tags.getTagUsageCount(id, hubId)
  const deleted = await services.tags.deleteTag(id, hubId)
  if (!deleted) return c.json({ error: 'Tag not found' }, 404)
  return c.json({ ok: true, removedFromContacts: usageCount }, 200)
})

export default tags
