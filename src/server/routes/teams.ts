import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const teams = createRouter()

// ── Shared schemas ──

const PassthroughSchema = z.object({}).passthrough()
const ErrorSchema = z.object({ error: z.string() })
const OkSchema = z.object({ ok: z.boolean() })

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'team-abc123' }),
})

const IdMemberParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'team-abc123' }),
  pubkey: z.string().openapi({ param: { name: 'pubkey', in: 'path' }, example: 'abc123def456' }),
})

const IdContactParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'team-abc123' }),
  contactId: z
    .string()
    .openapi({ param: { name: 'contactId', in: 'path' }, example: 'contact-abc123' }),
})

const CreateTeamBodySchema = z.object({
  // Client-generated UUID. Required so the server stores the same id the
  // client used as AAD `recordId` when sealing `encryptedName`.
  id: z.string().uuid().optional(),
  encryptedName: z.string(),
  encryptedDescription: z.string().optional(),
})

const UpdateTeamBodySchema = z.object({
  encryptedName: z.string().optional(),
  encryptedDescription: z.string().nullable().optional(),
})

const AddMembersBodySchema = z.object({
  pubkeys: z.array(z.string()).min(1),
})

const AssignContactsBodySchema = z.object({
  contactIds: z.array(z.string()).min(1),
})

// All routes require users:read as base permission
const baseMiddleware = [requirePermission('users:read')]
const manageMiddleware = [requirePermission('users:read'), requirePermission('users:manage-roles')]

// ── GET / — list teams ──

const listTeamsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Teams'],
  summary: 'List teams for hub',
  middleware: baseMiddleware,
  responses: {
    200: {
      description: 'Teams list',
      content: {
        'application/json': { schema: z.object({ teams: z.array(PassthroughSchema) }) },
      },
    },
  },
})

teams.openapi(listTeamsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const teamsList = await services.teams.listTeams(hubId)
  return c.json({ teams: teamsList }, 200)
})

// ── POST / — create team ──

const createTeamRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Teams'],
  summary: 'Create a team',
  middleware: manageMiddleware,
  request: {
    body: { content: { 'application/json': { schema: CreateTeamBodySchema } } },
  },
  responses: {
    201: {
      description: 'Team created',
      content: { 'application/json': { schema: z.object({ team: PassthroughSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

teams.openapi(createTeamRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  if (!body.encryptedName) {
    return c.json({ error: 'encryptedName is required' }, 400)
  }

  const team = await services.teams.createTeam({
    id: body.id,
    hubId,
    encryptedName: body.encryptedName as import('@shared/crypto-types').Ciphertext,
    encryptedDescription:
      (body.encryptedDescription as import('@shared/crypto-types').Ciphertext | undefined) ?? null,
    createdBy: pubkey ?? '',
  })

  return c.json({ team }, 201)
})

// ── PATCH /{id} — update team ──

const updateTeamRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Teams'],
  summary: 'Update a team',
  middleware: manageMiddleware,
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateTeamBodySchema } } },
  },
  responses: {
    200: {
      description: 'Team updated',
      content: { 'application/json': { schema: z.object({ team: PassthroughSchema }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

teams.openapi(updateTeamRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  const body = c.req.valid('json')

  const team = await services.teams.updateTeam(id, hubId, body as Record<string, unknown>)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  return c.json({ team }, 200)
})

// ── DELETE /{id} — delete team ──

const deleteTeamRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Teams'],
  summary: 'Delete a team',
  middleware: manageMiddleware,
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Team deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

teams.openapi(deleteTeamRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  const deleted = await services.teams.deleteTeam(id, hubId)
  if (!deleted) return c.json({ error: 'Team not found' }, 404)
  return c.json({ ok: true }, 200)
})

// ── GET /{id}/members — list team members ──

const listMembersRoute = createRoute({
  method: 'get',
  path: '/{id}/members',
  tags: ['Teams'],
  summary: 'List team members',
  middleware: baseMiddleware,
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Team members',
      content: {
        'application/json': { schema: z.object({ members: z.array(PassthroughSchema) }) },
      },
    },
  },
})

teams.openapi(listMembersRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const members = await services.teams.listMembers(id)
  return c.json({ members }, 200)
})

// ── POST /{id}/members — add members ──

const addMembersRoute = createRoute({
  method: 'post',
  path: '/{id}/members',
  tags: ['Teams'],
  summary: 'Add members to team',
  middleware: manageMiddleware,
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: AddMembersBodySchema } } },
  },
  responses: {
    200: {
      description: 'Members added',
      content: {
        'application/json': {
          schema: z.object({ members: z.array(PassthroughSchema), added: z.number() }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

teams.openapi(addMembersRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const members = await services.teams.addMembers(id, body.pubkeys, pubkey ?? '')
  return c.json({ members, added: members.length }, 200)
})

// ── DELETE /{id}/members/{pubkey} — remove member ──

const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/{id}/members/{pubkey}',
  tags: ['Teams'],
  summary: 'Remove a team member',
  middleware: manageMiddleware,
  request: { params: IdMemberParamSchema },
  responses: {
    200: {
      description: 'Member removed',
      content: { 'application/json': { schema: OkSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

teams.openapi(removeMemberRoute, async (c) => {
  const services = c.get('services')
  const { id, pubkey: memberPubkey } = c.req.valid('param')

  const removed = await services.teams.removeMember(id, memberPubkey)
  if (!removed) return c.json({ error: 'Member not found' }, 404)
  return c.json({ ok: true }, 200)
})

// ── GET /{id}/contacts — list contacts assigned to team ──

const listTeamContactsRoute = createRoute({
  method: 'get',
  path: '/{id}/contacts',
  tags: ['Teams'],
  summary: 'List contacts assigned to team',
  middleware: [...baseMiddleware, requirePermission('contacts:read-assigned')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Team contact assignments',
      content: {
        'application/json': { schema: z.object({ assignments: z.array(PassthroughSchema) }) },
      },
    },
  },
})

teams.openapi(listTeamContactsRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const assignments = await services.teams.listTeamContacts(id)
  return c.json({ assignments }, 200)
})

// ── POST /{id}/contacts — assign contacts (bulk) ──

const assignContactsRoute = createRoute({
  method: 'post',
  path: '/{id}/contacts',
  tags: ['Teams'],
  summary: 'Assign contacts to team',
  middleware: [...baseMiddleware, requirePermission('contacts:update-assigned')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: AssignContactsBodySchema } } },
  },
  responses: {
    200: {
      description: 'Contacts assigned',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

teams.openapi(assignContactsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const result = await services.teams.assignContacts(id, body.contactIds, hubId, pubkey ?? '')
  return c.json(result, 200)
})

// ── DELETE /{id}/contacts/{contactId} — unassign contact ──

const unassignContactRoute = createRoute({
  method: 'delete',
  path: '/{id}/contacts/{contactId}',
  tags: ['Teams'],
  summary: 'Unassign a contact from team',
  middleware: [...baseMiddleware, requirePermission('contacts:update-assigned')],
  request: { params: IdContactParamSchema },
  responses: {
    200: {
      description: 'Contact unassigned',
      content: { 'application/json': { schema: OkSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

teams.openapi(unassignContactRoute, async (c) => {
  const services = c.get('services')
  const { id, contactId } = c.req.valid('param')

  const removed = await services.teams.unassignContact(id, contactId)
  if (!removed) return c.json({ error: 'Assignment not found' }, 404)
  return c.json({ ok: true }, 200)
})

export default teams
