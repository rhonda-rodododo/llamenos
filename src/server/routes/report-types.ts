import { createRoute, z } from '@hono/zod-openapi'
import type { Ciphertext } from '@shared/crypto-types'
import { CreateReportTypeSchema, UpdateReportTypeSchema } from '@shared/schemas/report-types'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const reportTypesRoutes = createRouter()

// ── Shared schemas ──

const ReportTypeResponseSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  name: z.string(),
  encryptedName: z.string().optional(),
  description: z.string().optional(),
  encryptedDescription: z.string().optional(),
  isDefault: z.boolean(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'rt-abc123' }),
})

// ── GET / — list all report types ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Reports'],
  summary: 'List report types',
  description: 'Returns all active and archived report types for the current hub.',
  responses: {
    200: {
      description: 'Report types list',
      content: {
        'application/json': {
          schema: z.object({ reportTypes: z.array(ReportTypeResponseSchema) }),
        },
      },
    },
  },
})

reportTypesRoutes.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const types = await services.reportTypes.listReportTypes(hubId)
  return c.json({ reportTypes: types }, 200)
})

// ── POST / — create report type ──

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Reports'],
  summary: 'Create a report type',
  middleware: [requirePermission('settings:manage-fields')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateReportTypeSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Report type created',
      content: {
        'application/json': {
          schema: z.object({ reportType: ReportTypeResponseSchema }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

reportTypesRoutes.openapi(createRoute_, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  if (!body.name?.trim() && !body.encryptedName?.trim()) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const reportType = await services.reportTypes.createReportType(hubId, {
    id: body.id,
    name: body.name?.trim() ?? '',
    encryptedName: body.encryptedName?.trim() as Ciphertext | undefined,
    description: body.description?.trim() || undefined,
    encryptedDescription: body.encryptedDescription?.trim() as Ciphertext | undefined,
    isDefault: body.isDefault ?? false,
  })

  await services.records.addAuditEntry(hubId, 'reportTypeCreated', pubkey, {
    reportTypeId: reportType.id,
    name: reportType.name,
  })

  return c.json({ reportType }, 201)
})

// ── PATCH /:id — update report type ──

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Reports'],
  summary: 'Update a report type',
  middleware: [requirePermission('settings:manage-fields')],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateReportTypeSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Report type updated',
      content: {
        'application/json': {
          schema: z.object({ reportType: ReportTypeResponseSchema }),
        },
      },
    },
  },
})

reportTypesRoutes.openapi(updateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const reportType = await services.reportTypes.updateReportType(hubId, id, {
    ...(body.encryptedName !== undefined
      ? { encryptedName: body.encryptedName as Ciphertext }
      : {}),
    ...(body.name !== undefined && body.encryptedName === undefined
      ? { name: body.name.trim() }
      : {}),
    ...(body.encryptedDescription !== undefined
      ? { encryptedDescription: body.encryptedDescription as Ciphertext }
      : {}),
    ...(body.description !== undefined && body.encryptedDescription === undefined
      ? { description: body.description.trim() || undefined }
      : {}),
  })

  await services.records.addAuditEntry(hubId, 'reportTypeUpdated', pubkey, {
    reportTypeId: id,
  })

  return c.json({ reportType }, 200)
})

// ── DELETE /:id — archive report type ──

const archiveRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Reports'],
  summary: 'Archive a report type',
  middleware: [requirePermission('settings:manage-fields')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Report type archived',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

reportTypesRoutes.openapi(archiveRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')

  await services.reportTypes.archiveReportType(hubId, id)
  await services.records.addAuditEntry(hubId, 'reportTypeArchived', pubkey, { reportTypeId: id })

  return c.json({ ok: true }, 200)
})

// ── POST /:id/unarchive — restore archived type ──

const unarchiveRoute = createRoute({
  method: 'post',
  path: '/{id}/unarchive',
  tags: ['Reports'],
  summary: 'Unarchive a report type',
  middleware: [requirePermission('settings:manage-fields')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Report type restored',
      content: {
        'application/json': {
          schema: z.object({ reportType: ReportTypeResponseSchema }),
        },
      },
    },
  },
})

reportTypesRoutes.openapi(unarchiveRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')

  const reportType = await services.reportTypes.unarchiveReportType(hubId, id)
  await services.records.addAuditEntry(hubId, 'reportTypeUnarchived', pubkey, {
    reportTypeId: id,
  })

  return c.json({ reportType }, 200)
})

// ── POST /:id/default — set as default type ──

const setDefaultRoute = createRoute({
  method: 'post',
  path: '/{id}/default',
  tags: ['Reports'],
  summary: 'Set default report type',
  middleware: [requirePermission('settings:manage-fields')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Default report type updated',
      content: {
        'application/json': {
          schema: z.object({ reportType: ReportTypeResponseSchema }),
        },
      },
    },
  },
})

reportTypesRoutes.openapi(setDefaultRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')

  const reportType = await services.reportTypes.setDefaultReportType(hubId, id)
  await services.records.addAuditEntry(hubId, 'reportTypeDefaultChanged', pubkey, {
    reportTypeId: id,
  })

  return c.json({ reportType }, 200)
})

export default reportTypesRoutes
