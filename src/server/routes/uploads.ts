import { createRoute, z } from '@hono/zod-openapi'
import { EncryptedMetaItemSchema, FileKeyEnvelopeSchema } from '../../shared/schemas/files'
import type { UploadInit } from '../../shared/types'
import { createRouter } from '../lib/openapi'
import { checkPermission, requirePermission } from '../middleware/permission-guard'

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024 // 100 MB
const MAX_CHUNK_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_CHUNKS = 10000

const uploads = createRouter()
uploads.use('*', requirePermission('files:upload'))

const UploadIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'upload-abc123' }),
})

// ── POST /init — Initialize an upload ──

const initUploadRoute = createRoute({
  method: 'post',
  path: '/init',
  tags: ['Uploads'],
  summary: 'Initialize a chunked upload',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            totalSize: z.number(),
            totalChunks: z.number(),
            conversationId: z.string().optional(),
            recipientEnvelopes: z.array(FileKeyEnvelopeSchema).optional(),
            encryptedMetadata: z.array(EncryptedMetaItemSchema).optional(),
            contextType: z.string().optional(),
            contextId: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Upload initialized',
      content: {
        'application/json': {
          schema: z.object({ uploadId: z.string(), totalChunks: z.number() }),
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    503: {
      description: 'File storage not configured',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

uploads.openapi(initUploadRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json') as unknown as UploadInit

  // conversationId is required for conversation/message attachments but optional for custom_field uploads
  const isCustomField = body.contextType === 'custom_field'
  if (!body.totalSize || !body.totalChunks || (!body.conversationId && !isCustomField)) {
    return c.json({ error: 'Missing required fields: totalSize, totalChunks, conversationId' }, 400)
  }

  if (body.totalSize > MAX_UPLOAD_SIZE) {
    return c.json({ error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` }, 400)
  }

  if (body.totalChunks > MAX_CHUNKS) {
    return c.json({ error: 'Too many chunks (max 10000)' }, 400)
  }

  if (!services.files.hasStorage) {
    return c.json({ error: 'File storage not configured' }, 503)
  }

  const uploadId = crypto.randomUUID()

  await services.files.createFileRecord({
    id: uploadId,
    hubId: hubId ?? 'global',
    conversationId: body.conversationId ?? '',
    uploadedBy: pubkey,
    recipientEnvelopes: body.recipientEnvelopes ?? [],
    encryptedMetadata: body.encryptedMetadata ?? [],
    totalSize: body.totalSize,
    totalChunks: body.totalChunks,
    status: 'uploading',
    contextType: body.contextType,
    contextId: body.contextId,
  })

  await services.records.addAuditEntry(hubId ?? 'global', 'fileUploadStarted', pubkey, {
    uploadId,
    conversationId: body.conversationId,
    totalSize: body.totalSize,
    totalChunks: body.totalChunks,
  })

  return c.json({ uploadId, totalChunks: body.totalChunks }, 200)
})

// ── PUT /{id}/chunks/{chunkIndex} — Upload a chunk ──
// Binary body — kept as standard Hono route

uploads.put('/:id/chunks/:chunkIndex', async (c) => {
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')
  const uploadId = c.req.param('id')
  const chunkIndex = Number.parseInt(c.req.param('chunkIndex'), 10)

  if (Number.isNaN(chunkIndex) || chunkIndex < 0) {
    return c.json({ error: 'Invalid chunk index' }, 400)
  }

  const record = await services.files.getFileRecord(uploadId)
  if (!record) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  if (record.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (chunkIndex >= record.totalChunks) {
    return c.json({ error: `Chunk index out of range (total: ${record.totalChunks})` }, 400)
  }

  const body = await c.req.arrayBuffer()
  if (!body || body.byteLength === 0) {
    return c.json({ error: 'Empty chunk' }, 400)
  }

  if (body.byteLength > MAX_CHUNK_SIZE) {
    return c.json({ error: `Chunk too large (max ${MAX_CHUNK_SIZE / 1024 / 1024}MB)` }, 400)
  }

  const hubId = c.get('hubId')
  await services.files.putChunk(hubId ?? 'global', uploadId, chunkIndex, body)
  const { completedChunks, totalChunks } = await services.files.incrementChunk(uploadId)

  return c.json({ chunkIndex, completedChunks, totalChunks })
})

// ── POST /{id}/complete — Complete an upload (assembles chunks) ──

const completeUploadRoute = createRoute({
  method: 'post',
  path: '/{id}/complete',
  tags: ['Uploads'],
  summary: 'Complete a chunked upload',
  request: {
    params: UploadIdParamSchema,
  },
  responses: {
    200: {
      description: 'Upload completed',
      content: {
        'application/json': {
          schema: z.object({ fileId: z.string(), status: z.string() }),
        },
      },
    },
    400: {
      description: 'Not all chunks uploaded',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Upload not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    500: {
      description: 'Assembly failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

uploads.openapi(completeUploadRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const { id: uploadId } = c.req.valid('param')

  const record = await services.files.getFileRecord(uploadId)
  if (!record) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  if (record.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (record.completedChunks < record.totalChunks) {
    return c.json(
      {
        error: 'Not all chunks uploaded',
        completedChunks: record.completedChunks,
        totalChunks: record.totalChunks,
      },
      400
    )
  }

  // Assemble chunks into a single buffer
  const chunkArrays: Uint8Array[] = []
  for (let i = 0; i < record.totalChunks; i++) {
    const chunkData = await services.files.getChunk(hubId ?? 'global', uploadId, i)
    if (!chunkData) {
      await services.files.failUpload(uploadId)
      return c.json({ error: `Missing chunk ${i}` }, 500)
    }
    chunkArrays.push(new Uint8Array(chunkData))
  }

  const totalLen = chunkArrays.reduce((s, chunk) => s + chunk.length, 0)
  const assembled = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunkArrays) {
    assembled.set(chunk, offset)
    offset += chunk.length
  }

  // Store assembled content
  await services.files.putAssembled(hubId ?? 'global', uploadId, assembled)

  // Write blob copies of envelopes and metadata for backward compat
  await services.files.storeEnvelopesBlob(hubId ?? 'global', uploadId, record.recipientEnvelopes)
  await services.files.storeMetadataBlob(hubId ?? 'global', uploadId, record.encryptedMetadata)

  // Mark DB record as complete FIRST — chunks remain in blob storage and are
  // recoverable if this DB call fails. Never destroy source data before committing.
  await services.files.completeUpload(uploadId)

  // Delete individual chunks only after the record is durably marked complete
  await services.files.deleteAllChunks(hubId ?? 'global', uploadId, record.totalChunks)

  await services.records.addAuditEntry(hubId ?? 'global', 'fileUploadCompleted', pubkey, {
    uploadId,
  })

  return c.json({ fileId: uploadId, status: 'complete' }, 200)
})

// ── GET /{id}/status — Get upload status (for resume) ──

const getUploadStatusRoute = createRoute({
  method: 'get',
  path: '/{id}/status',
  tags: ['Uploads'],
  summary: 'Get upload status',
  request: {
    params: UploadIdParamSchema,
  },
  responses: {
    200: {
      description: 'Upload status',
      content: {
        'application/json': {
          schema: z.object({
            uploadId: z.string(),
            status: z.string(),
            completedChunks: z.number(),
            totalChunks: z.number(),
            totalSize: z.number(),
          }),
        },
      },
    },
    404: {
      description: 'Upload not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

uploads.openapi(getUploadStatusRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')
  const { id: uploadId } = c.req.valid('param')

  const record = await services.files.getFileRecord(uploadId)
  if (!record) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  // Only allow the uploader or users with download-all to check status
  if (record.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  return c.json(
    {
      uploadId: record.id,
      status: record.status,
      completedChunks: record.completedChunks,
      totalChunks: record.totalChunks,
      totalSize: record.totalSize,
    },
    200
  )
})

// ── PATCH /{id}/context — Bind an upload to a parent record ──

const bindContextRoute = createRoute({
  method: 'patch',
  path: '/{id}/context',
  tags: ['Uploads'],
  summary: 'Bind upload to a parent record',
  request: {
    params: UploadIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            contextId: z.string(),
            contextType: z.enum(['note', 'report', 'custom_field']),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Context bound',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid context',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Upload not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    409: {
      description: 'Upload not complete',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

uploads.openapi(bindContextRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { id: uploadId } = c.req.valid('param')

  const body = c.req.valid('json')

  if (
    !body.contextId ||
    !body.contextType ||
    !['note', 'report', 'custom_field'].includes(body.contextType)
  ) {
    return c.json({ error: 'Missing or invalid contextId / contextType' }, 400)
  }

  const record = await services.files.getFileRecord(uploadId)
  if (!record) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  // Only the uploader can bind context
  if (record.uploadedBy !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (record.status !== 'complete') {
    return c.json({ error: 'Upload must be complete before binding context' }, 409)
  }

  await services.files.updateContext(uploadId, body.contextType, body.contextId)

  await services.records.addAuditEntry(hubId ?? 'global', 'fileContextBound', pubkey, {
    fileId: uploadId,
    contextType: body.contextType,
    contextId: body.contextId,
  })

  return c.json({ ok: true }, 200)
})

export default uploads
