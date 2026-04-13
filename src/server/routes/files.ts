import { createRoute, z } from '@hono/zod-openapi'
import type { EncryptedMetaItem, FileKeyEnvelope } from '../../shared/types'
import { createRouter } from '../lib/openapi'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const files = createRouter()

const FileIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'file-abc123' }),
})

// ── GET /{id}/content — Download encrypted file content ──
// Binary response — kept as standard Hono route (not OpenAPI) since it returns raw binary

files.get('/:id/content', requirePermission('files:download-own'), async (c) => {
  const fileId = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')

  if (!services.files.hasStorage) {
    return c.json({ error: 'File storage not configured' }, 503)
  }

  const record = await services.files.getFileRecord(fileId)
  if (!record) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canDownloadAll = checkPermission(permissions, 'files:download-all')
  const isRecipient = record.recipientEnvelopes.some((e) => e.pubkey === pubkey)

  if (!canDownloadAll && !isRecipient) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const namespace =
    record.contextType === 'voicemail' ? ('voicemails' as const) : ('attachments' as const)
  const obj = await services.files.getAssembled(record.hubId ?? 'global', fileId, namespace)
  if (!obj) {
    return c.json({ error: 'File content not found' }, 404)
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Cache-Control': 'private, no-cache',
    },
  })
})

// ── GET /{id}/envelopes — Get file envelopes (recipient key wrappers) ──

const getEnvelopesRoute = createRoute({
  method: 'get',
  path: '/{id}/envelopes',
  tags: ['Files'],
  summary: 'Get file key envelopes',
  middleware: [requirePermission('files:download-own')],
  request: { params: FileIdParamSchema },
  responses: {
    200: {
      description: 'File key envelopes',
      content: { 'application/json': { schema: z.array(z.object({}).passthrough()) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'File not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

files.openapi(getEnvelopesRoute, async (c) => {
  const { id: fileId } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')

  const record = await services.files.getFileRecord(fileId)
  if (!record) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canDownloadAll = checkPermission(permissions, 'files:download-all')
  const isRecipient = record.recipientEnvelopes.some((e) => e.pubkey === pubkey)

  if (!canDownloadAll && !isRecipient) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json(record.recipientEnvelopes, 200)
})

// ── GET /{id}/metadata — Get encrypted file metadata ──

const getMetadataRoute = createRoute({
  method: 'get',
  path: '/{id}/metadata',
  tags: ['Files'],
  summary: 'Get encrypted file metadata',
  middleware: [requirePermission('files:download-own')],
  request: { params: FileIdParamSchema },
  responses: {
    200: {
      description: 'Encrypted file metadata',
      content: { 'application/json': { schema: z.array(z.object({}).passthrough()) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'File not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

files.openapi(getMetadataRoute, async (c) => {
  const { id: fileId } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')

  const record = await services.files.getFileRecord(fileId)
  if (!record) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canDownloadAll = checkPermission(permissions, 'files:download-all')
  const isRecipient = record.recipientEnvelopes.some((e) => e.pubkey === pubkey)

  if (!canDownloadAll && !isRecipient) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json(record.encryptedMetadata, 200)
})

// ── POST /{id}/share — Share file with a new recipient ──

const shareFileRoute = createRoute({
  method: 'post',
  path: '/{id}/share',
  tags: ['Files'],
  summary: 'Share file with a new recipient',
  middleware: [requirePermission('files:share')],
  request: {
    params: FileIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            envelope: z.object({
              v: z.literal(2),
              labelId: z.number().int(),
              pubkey: z.string(),
              wrappedKey: z.string(),
              ephemeralPubkey: z.string(),
            }),
            encryptedMetadata: z.object({
              pubkey: z.string(),
              encryptedContent: z.string(),
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'File shared',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: {
      description: 'Invalid envelope or metadata',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'File not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

files.openapi(shareFileRoute, async (c) => {
  const { id: fileId } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const services = c.get('services')

  const body = c.req.valid('json')

  if (!body.envelope?.pubkey || !body.envelope?.wrappedKey || !body.envelope?.ephemeralPubkey) {
    return c.json({ error: 'Invalid envelope' }, 400)
  }

  if (!body.encryptedMetadata?.pubkey || !body.encryptedMetadata?.encryptedContent) {
    return c.json({ error: 'Invalid encryptedMetadata' }, 400)
  }

  const record = await services.files.getFileRecord(fileId)
  if (!record) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canDownloadAll = checkPermission(permissions, 'files:download-all')
  const isUploader = record.uploadedBy === pubkey

  if (!canDownloadAll && !isUploader) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await services.files.addRecipientEnvelope(
    fileId,
    body.envelope as FileKeyEnvelope,
    body.encryptedMetadata as EncryptedMetaItem
  )

  await services.records.addAuditEntry(hubId ?? 'global', 'fileShared', pubkey, {
    fileId,
    sharedWith: body.envelope.pubkey,
  })

  return c.json({ success: true }, 200)
})

export default files
