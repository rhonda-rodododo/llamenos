import { createRoute, z } from '@hono/zod-openapi'
import { LABEL_HUB_KEY_WRAP, LABEL_STORAGE_CREDENTIAL_WRAP } from '@shared/crypto-labels'
import { MLS_CIPHERSUITE } from '@shared/schemas/mls'
import { eq } from 'drizzle-orm'
import type { Hub } from '../../shared/types'
import { getDb } from '../db'
import { mlsHubState } from '../db/schema/mls'
import { hubStorageCredentials, hubStorageSettings } from '../db/schema/storage'
import { createLogger } from '../lib/logger'
import { createRouter } from '../lib/openapi'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import { STORAGE_NAMESPACES, type StorageNamespace } from '../types'

const log = createLogger('routes.hubs')

const routes = createRouter()

// ── Shared schemas ──

const OkSchema = z.object({ ok: z.boolean() })
const ErrorSchema = z.object({ error: z.string() })
const PassthroughSchema = z.object({}).passthrough()

const HubIdParamSchema = z.object({
  hubId: z.string().openapi({ param: { name: 'hubId', in: 'path' }, example: 'hub-abc123' }),
})

const HubMemberParamSchema = z.object({
  hubId: z.string().openapi({ param: { name: 'hubId', in: 'path' }, example: 'hub-abc123' }),
  pubkey: z.string().openapi({ param: { name: 'pubkey', in: 'path' }, example: 'abc123def456' }),
})

// ── GET / — list hubs ──

const listHubsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Hubs'],
  summary: 'List hubs (filtered by membership)',
  responses: {
    200: {
      description: 'Hub list',
      content: {
        'application/json': {
          schema: z.object({ hubs: z.array(PassthroughSchema) }),
        },
      },
    },
  },
})

routes.openapi(listHubsRoute, async (c) => {
  const services = c.get('services')
  const user = c.get('user')
  const permissions = c.get('permissions')

  const allHubs = await services.settings.getHubs()

  if (checkPermission(permissions, '*')) {
    return c.json({ hubs: allHubs }, 200)
  }

  const userHubIds = new Set((user.hubRoles || []).map((hr) => hr.hubId))
  return c.json({ hubs: allHubs.filter((h) => h.status === 'active' && userHubIds.has(h.id)) }, 200)
})

// ── POST / — create hub ──

const createHubRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Hubs'],
  summary: 'Create a hub',
  middleware: [requirePermission('system:manage-hubs')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().optional(),
            encryptedName: z.string().optional(),
            description: z.string().optional(),
            encryptedDescription: z.string().optional(),
            phoneNumber: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Hub created',
      content: { 'application/json': { schema: z.object({ hub: PassthroughSchema }) } },
    },
    400: {
      description: 'Name required',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(createHubRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  const nameValue = body.encryptedName?.trim() || body.name?.trim()
  if (!nameValue) return c.json({ error: 'Name required' }, 400)

  const hub = await services.settings.createHub({
    id: crypto.randomUUID(),
    name: body.name?.trim(),
    encryptedName: body.encryptedName?.trim(),
    description: body.description?.trim(),
    encryptedDescription: body.encryptedDescription?.trim(),
    status: 'active',
    phoneNumber: body.phoneNumber?.trim(),
    createdBy: pubkey,
  })

  // Bootstrap MLS group state for the new hub
  try {
    const db = getDb()
    const groupIdBytes = Buffer.from(`llamenos:hub:${hub.id}`, 'utf-8')
    await db.insert(mlsHubState).values({
      hubId: hub.id,
      groupId: groupIdBytes,
      ciphersuite: MLS_CIPHERSUITE,
      currentEpoch: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  } catch (err) {
    log.error('Failed to bootstrap MLS group state for hub', err, { hubId: hub.id })
  }

  if (services.storage) {
    try {
      const iamResult = await services.storage.provisionHub(hub.id)

      if (iamResult) {
        const encrypted = await services.crypto.serverEncrypt(
          iamResult.secretAccessKey,
          LABEL_STORAGE_CREDENTIAL_WRAP
        )
        const db = getDb()
        await db.insert(hubStorageCredentials).values({
          hubId: hub.id,
          accessKeyId: iamResult.accessKeyId,
          encryptedSecretKey: encrypted,
          policyName: iamResult.policyName,
          userName: iamResult.userName,
        })
      }
    } catch (err) {
      log.error('Failed to provision storage for hub', err, { hubId: hub.id })
    }
  }

  return c.json({ hub }, 200)
})

// ── GET /{hubId} — get hub details ──

const getHubRoute = createRoute({
  method: 'get',
  path: '/{hubId}',
  tags: ['Hubs'],
  summary: 'Get hub details',
  request: { params: HubIdParamSchema },
  responses: {
    200: {
      description: 'Hub details',
      content: { 'application/json': { schema: z.object({ hub: PassthroughSchema }) } },
    },
    403: {
      description: 'Access denied',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(getHubRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const services = c.get('services')
  const user = c.get('user')
  const permissions = c.get('permissions')

  const hub = await services.settings.getHub(hubId)
  if (!hub) return c.json({ error: 'Hub not found' }, 404)

  const isSuperAdmin = checkPermission(permissions, '*')
  const hasHubAccess = (user.hubRoles || []).some((hr) => hr.hubId === hubId)
  if (!isSuperAdmin && !hasHubAccess) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Include MLS readiness indicator
  const db = getDb()
  const mlsRows = await db
    .select({ currentEpoch: mlsHubState.currentEpoch })
    .from(mlsHubState)
    .where(eq(mlsHubState.hubId, hubId))
    .limit(1)

  const mlsState =
    mlsRows.length > 0 ? { mlsReady: true, mlsEpoch: mlsRows[0].currentEpoch } : { mlsReady: false }

  return c.json({ hub: { ...hub, ...mlsState } }, 200)
})

// ── PATCH /{hubId} — update hub ──

const updateHubRoute = createRoute({
  method: 'patch',
  path: '/{hubId}',
  tags: ['Hubs'],
  summary: 'Update hub',
  middleware: [requirePermission('system:manage-hubs')],
  request: {
    params: HubIdParamSchema,
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Hub updated',
      content: { 'application/json': { schema: z.object({ hub: PassthroughSchema }) } },
    },
    500: {
      description: 'Update failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(updateHubRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const services = c.get('services')
  const body = c.req.valid('json') as Partial<Hub>

  try {
    const updated = await services.settings.updateHub(hubId, body)
    return c.json({ hub: updated }, 200)
  } catch {
    return c.json({ error: 'Failed to update hub' }, 500)
  }
})

// ── POST /{hubId}/archive — archive hub ──

const archiveHubRoute = createRoute({
  method: 'post',
  path: '/{hubId}/archive',
  tags: ['Hubs'],
  summary: 'Archive a hub (soft delete)',
  middleware: [requirePermission('system:manage-hubs')],
  request: { params: HubIdParamSchema },
  responses: {
    200: {
      description: 'Hub archived',
      content: { 'application/json': { schema: z.object({ hub: PassthroughSchema }) } },
    },
    500: {
      description: 'Archive failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(archiveHubRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const services = c.get('services')

  try {
    const updated = await services.settings.updateHub(hubId, { status: 'archived' })
    return c.json({ hub: updated }, 200)
  } catch {
    return c.json({ error: 'Failed to archive hub' }, 500)
  }
})

// ── GET /{hubId}/export — export hub data as ZIP ──

const exportHubRoute = createRoute({
  method: 'get',
  path: '/{hubId}/export',
  tags: ['Hubs'],
  summary: 'Export hub data as ZIP',
  middleware: [requirePermission('system:manage-hubs')],
  request: { params: HubIdParamSchema },
  responses: {
    200: {
      description: 'ZIP archive of hub data',
    },
    400: {
      description: 'Invalid categories',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Hub not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(exportHubRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const services = c.get('services')
  const categoriesParam =
    c.req.query('categories') || 'notes,calls,conversations,audit,voicemails,attachments'
  const validCategories = new Set([
    'notes',
    'calls',
    'conversations',
    'audit',
    'voicemails',
    'attachments',
  ])
  const categories = categoriesParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => validCategories.has(s))

  if (categories.length === 0) {
    return c.json({ error: 'No valid categories specified' }, 400)
  }

  const hub = await services.settings.getHub(hubId)
  if (!hub) return c.json({ error: 'Hub not found' }, 404)

  const { zipSync, strToU8 } = await import('fflate')

  const zipFiles: Record<string, Uint8Array> = {}

  const manifest: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    hubId,
    hubName: hub.name,
    categories,
    note: 'All content fields are E2EE ciphertext. Decryption requires the hub key.',
  }

  if (categories.includes('notes')) {
    const { notes, total } = await services.records.getNotes({ hubId })
    zipFiles['records/notes.json'] = strToU8(JSON.stringify({ total, records: notes }, null, 2))
  }
  if (categories.includes('calls')) {
    const { calls, total } = await services.records.getCallHistory(1, 100_000, hubId)
    zipFiles['records/calls.json'] = strToU8(JSON.stringify({ total, records: calls }, null, 2))
  }
  if (categories.includes('conversations')) {
    const { conversations, total } = await services.conversations.listConversations({ hubId })
    zipFiles['records/conversations.json'] = strToU8(
      JSON.stringify({ total, records: conversations }, null, 2)
    )
  }
  if (categories.includes('audit')) {
    const { entries, total } = await services.records.getAuditLog({ hubId, limit: 100_000 })
    zipFiles['records/audit.json'] = strToU8(JSON.stringify({ total, records: entries }, null, 2))
  }

  const includeBlobs = categories.includes('voicemails') || categories.includes('attachments')
  if (includeBlobs && services.files.hasStorage) {
    const allFiles = await services.files.getFilesByHub(hubId)
    let blobCount = 0

    for (const fileRecord of allFiles) {
      const isVoicemail = fileRecord.contextType === 'voicemail'
      const category = isVoicemail ? 'voicemails' : 'attachments'
      if (!categories.includes(category)) continue

      const namespace = isVoicemail ? ('voicemails' as const) : ('attachments' as const)
      try {
        const blob = await services.storage?.get(hubId, namespace, `${fileRecord.id}/content`)
        if (blob) {
          zipFiles[`${category}/${fileRecord.id}/content.enc`] = new Uint8Array(
            await blob.arrayBuffer()
          )
          blobCount++
        }
      } catch {
        // Skip files that can't be retrieved
      }

      try {
        const envelopes = await services.storage?.get(
          hubId,
          'attachments',
          `${fileRecord.id}/envelopes`
        )
        if (envelopes) {
          zipFiles[`${category}/${fileRecord.id}/envelopes.json`] = new Uint8Array(
            await envelopes.arrayBuffer()
          )
        }
      } catch {}
      try {
        const meta = await services.storage?.get(hubId, 'attachments', `${fileRecord.id}/metadata`)
        if (meta) {
          zipFiles[`${category}/${fileRecord.id}/metadata.json`] = new Uint8Array(
            await meta.arrayBuffer()
          )
        }
      } catch {}
    }

    manifest.blobsIncluded = blobCount
    manifest.fileRecords = allFiles.length
  }

  zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))

  const zipData = zipSync(zipFiles)

  const zipBuffer = new Uint8Array(zipData).buffer as ArrayBuffer
  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="hub-${hubId}-export.zip"`,
      'Content-Length': String(zipData.length),
    },
  })
})

// ── DELETE /{hubId} — delete hub ──

const deleteHubRoute = createRoute({
  method: 'delete',
  path: '/{hubId}',
  tags: ['Hubs'],
  summary: 'Delete a hub (cascades all data)',
  middleware: [requirePermission('system:manage-hubs')],
  request: { params: HubIdParamSchema },
  responses: {
    200: {
      description: 'Hub deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
    404: {
      description: 'Hub not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Hub has active calls',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Delete failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(deleteHubRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const services = c.get('services')

  const hubCalls = await services.calls.getActiveCalls(hubId)
  if (hubCalls.some((call) => call.status === 'ringing' || call.status === 'in-progress')) {
    return c.json({ error: 'Cannot delete hub with active calls in progress' }, 409)
  }

  try {
    let storedUserName: string | undefined
    if (services.storage) {
      try {
        const db = getDb()
        const [cred] = await db
          .select({ userName: hubStorageCredentials.userName })
          .from(hubStorageCredentials)
          .where(eq(hubStorageCredentials.hubId, hubId))
        storedUserName = cred?.userName
      } catch {
        // No credentials stored
      }
    }

    await services.settings.deleteHub(hubId)

    if (services.storage) {
      try {
        await services.storage.destroyHub(hubId, storedUserName)
      } catch (err) {
        log.error('Failed to destroy storage for hub — orphaned buckets', err, { hubId })
      }
    }

    return c.json({ ok: true }, 200)
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return c.json({ error: 'Hub not found' }, 404)
    }
    return c.json({ error: 'Failed to delete hub' }, 500)
  }
})

// ── POST /{hubId}/members — add member ──

const addMemberRoute = createRoute({
  method: 'post',
  path: '/{hubId}/members',
  tags: ['Hubs'],
  summary: 'Add member to hub',
  middleware: [requirePermission('users:manage-roles')],
  request: {
    params: HubIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            pubkey: z.string(),
            roleIds: z.array(z.string()),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Member added',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    400: {
      description: 'Missing required fields',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Add failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(addMemberRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const services = c.get('services')
  const body = c.req.valid('json')

  if (!body.pubkey || !body.roleIds?.length) {
    return c.json({ error: 'pubkey and roleIds required' }, 400)
  }

  try {
    const updated = await services.identity.setHubRole({
      pubkey: body.pubkey,
      hubId,
      roleIds: body.roleIds,
    })
    return c.json(updated, 200)
  } catch {
    return c.json({ error: 'Failed to add member' }, 500)
  }
})

// ── DELETE /{hubId}/members/{pubkey} — remove member ──

const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/{hubId}/members/{pubkey}',
  tags: ['Hubs'],
  summary: 'Remove member from hub',
  middleware: [requirePermission('users:manage-roles')],
  request: { params: HubMemberParamSchema },
  responses: {
    200: {
      description: 'Member removed',
      content: { 'application/json': { schema: OkSchema } },
    },
    500: {
      description: 'Remove failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(removeMemberRoute, async (c) => {
  const { hubId, pubkey } = c.req.valid('param')
  const services = c.get('services')

  try {
    await services.identity.removeHubRole(pubkey, hubId)
    return c.json({ ok: true }, 200)
  } catch {
    return c.json({ error: 'Failed to remove member' }, 500)
  }
})

// ── PATCH /{hubId}/settings — update hub settings ──

const updateHubSettingsRoute = createRoute({
  method: 'patch',
  path: '/{hubId}/settings',
  tags: ['Hubs'],
  summary: 'Update hub settings (zero-trust visibility)',
  middleware: [requirePermission('settings:manage')],
  request: {
    params: HubIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({ allowSuperAdminAccess: z.boolean().optional() }),
        },
      },
    },
  },
  responses: {
    204: { description: 'No content' },
    403: {
      description: 'Super admin cannot self-grant',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(updateHubSettingsRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const body = c.req.valid('json')
  const callerPubkey = c.get('pubkey')
  const services = c.get('services')

  if (body.allowSuperAdminAccess !== undefined) {
    const isSuperAdmin = await services.identity.isSuperAdmin(callerPubkey)
    if (isSuperAdmin) {
      return c.json({ error: 'Super admin cannot modify their own hub access' }, 403)
    }
    await services.settings.updateHub(hubId, { allowSuperAdminAccess: body.allowSuperAdminAccess })
  }
  return c.body(null, 204)
})

// ── GET /{hubId}/key-envelope — get my hub key envelope ──

const getKeyEnvelopeRoute = createRoute({
  method: 'get',
  path: '/{hubId}/key-envelope',
  tags: ['Hubs'],
  summary: 'Get my hub key envelope',
  request: { params: HubIdParamSchema },
  responses: {
    200: {
      description: 'Hub key envelope',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    404: {
      description: 'Not a member',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(getKeyEnvelopeRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const services = c.get('services')

  const envelopes = await services.settings.getHubKeyEnvelopes(hubId)
  log.info('key-envelope request', {
    hubId,
    pubkey: pubkey?.slice(0, 8),
    hpkePubkey: c.req.query('hpkePubkey')?.slice(0, 8),
    envelopeCount: envelopes.length,
  })

  // If the client provides its X25519 HPKE pubkey, the server unwraps its own
  // hub key envelope and re-wraps for the client's X25519 key. This bridges
  // the secp256k1→X25519 gap: the server wraps hub keys for member secp256k1
  // pubkeys (legacy), but HPKE decryption requires the client's X25519 key
  // derived from nsec via HKDF.
  const hpkePubkeyHex = c.req.query('hpkePubkey')
  if (hpkePubkeyHex && hpkePubkeyHex.length === 64) {
    // Verify the user is a member (has any envelope keyed to their secp256k1 pubkey)
    const isMember = envelopes.some((e) => e.pubkeyHex === pubkey)
    if (!isMember) {
      log.info('key-envelope: not a member', { pubkey: pubkey?.slice(0, 8) })
      return c.json({ error: 'not_a_member' }, 404)
    }

    try {
      const hubKey = await services.hpke.unwrapHubKey(envelopes)
      const recipientBytes = new Uint8Array(
        hpkePubkeyHex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16))
      )
      const envelope = await services.hpke.sealFor(
        hubKey,
        recipientBytes,
        LABEL_HUB_KEY_WRAP,
        hubId,
        'hub-key'
      )
      log.info('key-envelope: re-wrapped OK', { hubId })
      return c.json(envelope, 200)
    } catch (err) {
      log.error('key-envelope: re-wrap failed', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Legacy path: return the member's stored envelope directly
  const myEnvelope = envelopes.find((e) => e.pubkeyHex === pubkey)
  if (!myEnvelope) {
    log.info('key-envelope: legacy not found', {
      pubkey: pubkey?.slice(0, 8),
      stored: envelopes.map((e) => e.pubkeyHex.slice(0, 8)),
    })
    return c.json({ error: 'not_a_member' }, 404)
  }

  return c.json(myEnvelope.envelope, 200)
})

// ── GET /{hubId}/key — get my hub key (membership required) ──

const getHubKeyRoute = createRoute({
  method: 'get',
  path: '/{hubId}/key',
  tags: ['Hubs'],
  summary: 'Get hub key envelope (membership required)',
  request: { params: HubIdParamSchema },
  responses: {
    200: {
      description: 'Hub key envelope',
      content: {
        'application/json': { schema: z.object({ envelope: PassthroughSchema }) },
      },
    },
    403: {
      description: 'Access denied',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Hub or envelope not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(getHubKeyRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const user = c.get('user')
  const permissions = c.get('permissions')
  const services = c.get('services')

  const isSuperAdmin = checkPermission(permissions, '*')
  const isMember = (user.hubRoles || []).some((hr) => hr.hubId === hubId)
  if (!isSuperAdmin && !isMember) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const hub = await services.settings.getHub(hubId)
  if (!hub) return c.json({ error: 'Hub not found' }, 404)

  const envelopes = await services.settings.getHubKeyEnvelopes(hubId)
  const myEnvelope = envelopes.find((e) => e.pubkeyHex === pubkey)
  if (!myEnvelope) return c.json({ error: 'No key envelope for this user' }, 404)

  return c.json({ envelope: myEnvelope.envelope }, 200)
})

// ── PUT /{hubId}/key — set hub key envelopes ──

const setHubKeyRoute = createRoute({
  method: 'put',
  path: '/{hubId}/key',
  tags: ['Hubs'],
  summary: 'Set hub key envelopes',
  middleware: [requirePermission('system:manage-hubs')],
  request: {
    params: HubIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            envelopes: z.array(
              z.object({
                pubkeyHex: z.string(),
                envelope: z.object({
                  v: z.literal(3),
                  labelId: z.number(),
                  enc: z.string(),
                  ct: z.string(),
                }),
              })
            ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Hub key envelopes set',
      content: { 'application/json': { schema: OkSchema } },
    },
    400: {
      description: 'At least one envelope required',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Failed to set hub key',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(setHubKeyRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const services = c.get('services')
  const body = c.req.valid('json')

  if (!Array.isArray(body.envelopes) || body.envelopes.length === 0) {
    return c.json({ error: 'At least one envelope required' }, 400)
  }

  try {
    await services.settings.setHubKeyEnvelopes(hubId, body.envelopes)
    return c.json({ ok: true }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set hub key'
    return c.json({ error: message }, 500)
  }
})

// ── GET /{hubId}/storage-settings — get hub storage settings ──

const getStorageSettingsRoute = createRoute({
  method: 'get',
  path: '/{hubId}/storage-settings',
  tags: ['Hubs'],
  summary: 'Get hub storage retention settings',
  middleware: [requirePermission('settings:manage')],
  request: { params: HubIdParamSchema },
  responses: {
    200: {
      description: 'Storage settings per namespace',
      content: {
        'application/json': {
          schema: z.object({ settings: z.array(PassthroughSchema) }),
        },
      },
    },
  },
})

routes.openapi(getStorageSettingsRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const db = getDb()

  const overrides = await db
    .select()
    .from(hubStorageSettings)
    .where(eq(hubStorageSettings.hubId, hubId))

  const overrideMap = new Map(overrides.map((o) => [o.namespace, o.retentionDays]))

  const settingsList = Object.entries(STORAGE_NAMESPACES).map(([ns, defaults]) => ({
    namespace: ns as StorageNamespace,
    retentionDays: overrideMap.has(ns) ? overrideMap.get(ns)! : defaults.defaultRetentionDays,
    isOverridden: overrideMap.has(ns),
    platformDefault: defaults.defaultRetentionDays,
  }))

  return c.json({ settings: settingsList }, 200)
})

// ── PATCH /{hubId}/storage-settings — update hub storage retention ──

const updateStorageSettingsRoute = createRoute({
  method: 'patch',
  path: '/{hubId}/storage-settings',
  tags: ['Hubs'],
  summary: 'Update hub storage retention for a namespace',
  middleware: [requirePermission('settings:manage')],
  request: {
    params: HubIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            namespace: z.string(),
            retentionDays: z.number().nullable(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Retention updated',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    400: {
      description: 'Invalid input',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

routes.openapi(updateStorageSettingsRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const db = getDb()

  const body = c.req.valid('json')

  if (!body.namespace || !(body.namespace in STORAGE_NAMESPACES)) {
    return c.json(
      { error: `Invalid namespace. Must be one of: ${Object.keys(STORAGE_NAMESPACES).join(', ')}` },
      400
    )
  }

  const ns = body.namespace as StorageNamespace
  const platformDefault = STORAGE_NAMESPACES[ns].defaultRetentionDays

  if (
    body.retentionDays !== null &&
    platformDefault !== null &&
    body.retentionDays > platformDefault
  ) {
    return c.json(
      { error: `Retention cannot exceed platform default of ${platformDefault} days` },
      400
    )
  }

  if (body.retentionDays !== null) {
    if (!Number.isInteger(body.retentionDays) || body.retentionDays < 1) {
      return c.json({ error: 'retentionDays must be a positive integer or null' }, 400)
    }
  }

  await db
    .insert(hubStorageSettings)
    .values({
      hubId,
      namespace: ns,
      retentionDays: body.retentionDays,
    })
    .onConflictDoUpdate({
      target: [hubStorageSettings.hubId, hubStorageSettings.namespace],
      set: { retentionDays: body.retentionDays },
    })

  if (services.storage) {
    try {
      await services.storage.setRetention(hubId, ns, body.retentionDays)
    } catch (err) {
      log.error('Failed to apply retention to storage backend', err)
    }
  }

  await services.records.addAuditEntry(hubId, 'storage.retention.updated', pubkey, {
    namespace: ns,
    retentionDays: body.retentionDays,
    platformDefault,
  })

  return c.json({ ok: true, namespace: ns, retentionDays: body.retentionDays }, 200)
})

export default routes
