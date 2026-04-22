import { createRoute, z } from '@hono/zod-openapi'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { isValidE164 } from '../lib/helpers'
import { createRouter } from '../lib/openapi'
import { projectUser } from '../lib/user-projector'
import { checkPermission, requirePermission } from '../middleware/permission-guard'

/** Check that a string is a valid 64-char hex x-only secp256k1 pubkey (on the curve). */
function isValidSecp256k1Pubkey(pk: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(pk)) return false
  try {
    secp256k1.Point.fromHex(`02${pk}`)
    return true
  } catch {
    return false
  }
}

const users = createRouter()

// All users endpoints require at least users:read
const baseMiddleware = requirePermission('users:read')

// ── Shared schemas ──

const ErrorSchema = z.object({ error: z.string() })

const UserResponseSchema = z.object({}).passthrough()

const TargetPubkeyParamSchema = z.object({
  targetPubkey: z.string().openapi({
    param: { name: 'targetPubkey', in: 'path' },
    example: 'a1b2c3d4e5f6...',
  }),
})

const CreateUserBodySchema = z.object({
  name: z.string(),
  phone: z.string(),
  roleIds: z.array(z.string()),
  pubkey: z.string().optional(),
})

const UpdateUserBodySchema = z.object({}).passthrough()

// ── GET / — list all users ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Users'],
  summary: 'List all users',
  middleware: [baseMiddleware],
  responses: {
    200: {
      description: 'Users list',
      content: {
        'application/json': { schema: z.object({ users: z.array(UserResponseSchema) }) },
      },
    },
  },
})

users.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const requestorPubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const isAdmin = checkPermission(permissions, 'settings:manage')

  const allUsers = await services.identity.getUsers()
  return c.json({ users: allUsers.map((u) => projectUser(u, requestorPubkey, isAdmin)) }, 200)
})

// ── GET /{targetPubkey} — get user by pubkey ──

const getByPubkeyRoute = createRoute({
  method: 'get',
  path: '/{targetPubkey}',
  tags: ['Users'],
  summary: 'Get user by pubkey',
  middleware: [baseMiddleware],
  request: { params: TargetPubkeyParamSchema },
  responses: {
    200: {
      description: 'User details',
      content: { 'application/json': { schema: UserResponseSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

users.openapi(getByPubkeyRoute, async (c) => {
  const services = c.get('services')
  const requestorPubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const isAdmin = checkPermission(permissions, 'settings:manage')
  const { targetPubkey } = c.req.valid('param')

  const user = await services.identity.getUser(targetPubkey)
  if (!user) return c.json({ error: 'Not found' }, 404)

  // ?unmask=true: admin-only; creates audit entry
  const unmask = isAdmin && c.req.query('unmask') === 'true'
  if (unmask) {
    await services.records.addAuditEntry('global', 'phoneUnmasked', requestorPubkey, {
      target: targetPubkey,
    })
  }

  return c.json(projectUser(user, requestorPubkey, isAdmin, unmask), 200)
})

// ── POST / — create a user ──

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Users'],
  summary: 'Create a user',
  middleware: [baseMiddleware, requirePermission('users:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateUserBodySchema } } },
  },
  responses: {
    201: {
      description: 'User created',
      content: { 'application/json': { schema: z.object({ user: UserResponseSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

users.openapi(createRoute_, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  if (body.phone && !isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 400)
  }

  const newPubkey = body.pubkey
  if (!newPubkey) {
    return c.json({ error: 'pubkey is required — generate keypair client-side' }, 400)
  }

  if (!isValidSecp256k1Pubkey(newPubkey)) {
    return c.json(
      { error: 'Invalid pubkey — must be a valid secp256k1 x-only public key (64 hex chars)' },
      400
    )
  }

  const user = await services.identity.createUser({
    pubkey: newPubkey,
    name: body.name,
    phone: body.phone,
    roles: body.roleIds || ['role-volunteer'],
    encryptedSecretKey: '',
  })

  await services.records.addAuditEntry('global', 'userAdded', pubkey, {
    target: newPubkey,
    roles: body.roleIds,
  })

  // Return admin view for the creator (always an admin)
  return c.json({ user: projectUser(user, pubkey, true) }, 201)
})

// ── PATCH /{targetPubkey} — update a user ──

const updateRoute = createRoute({
  method: 'patch',
  path: '/{targetPubkey}',
  tags: ['Users'],
  summary: 'Update a user',
  middleware: [baseMiddleware, requirePermission('users:update')],
  request: {
    params: TargetPubkeyParamSchema,
    body: { content: { 'application/json': { schema: UpdateUserBodySchema } } },
  },
  responses: {
    200: {
      description: 'User updated',
      content: { 'application/json': { schema: z.object({ user: UserResponseSchema }) } },
    },
  },
})

users.openapi(updateRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const { targetPubkey } = c.req.valid('param')
  const body = c.req.valid('json') as Record<string, unknown>

  const updated = await services.identity.updateUser(
    targetPubkey,
    body as Parameters<typeof services.identity.updateUser>[1],
    true // isAdmin=true for admin update
  )

  if (body.roles) {
    await services.records.addAuditEntry('global', 'rolesChanged', pubkey, {
      target: targetPubkey,
      roles: body.roles,
    })
  }

  return c.json({ user: projectUser(updated, pubkey, true) }, 200)
})

// ── DELETE /{targetPubkey} — delete a user ──

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{targetPubkey}',
  tags: ['Users'],
  summary: 'Delete a user',
  middleware: [baseMiddleware, requirePermission('users:delete')],
  request: { params: TargetPubkeyParamSchema },
  responses: {
    200: {
      description: 'User deleted',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

users.openapi(deleteRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const { targetPubkey } = c.req.valid('param')
  await services.identity.deleteUser(targetPubkey)
  await services.records.addAuditEntry('global', 'userRemoved', pubkey, {
    target: targetPubkey,
  })
  return c.json({ ok: true }, 200)
})

export default users
