import { createRoute, z } from '@hono/zod-openapi'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import { RecipientEnvelopeSchema } from '@shared/schemas/records'
import type { RecipientEnvelope } from '@shared/types'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

const contactImport = createRouter()

const ContactImportSchema = z.object({
  contacts: z
    .array(
      z.object({
        contactType: z.string(),
        riskLevel: z.string(),
        tags: z.array(z.string()).optional(),
        encryptedDisplayName: z.string(),
        displayNameEnvelopes: z.array(RecipientEnvelopeSchema),
        encryptedFullName: z.string().optional(),
        fullNameEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
        encryptedPhone: z.string().optional(),
        phoneEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
        identifierHash: z.string().optional(),
        encryptedPII: z.string().optional(),
        piiEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
      })
    )
    .min(1, 'contacts array is required')
    .max(500, 'Maximum 500 contacts per batch'),
})

const MergeSchema = z.object({ secondaryId: z.string().min(1, 'secondaryId is required') })

const importRoute = createRoute({
  method: 'post',
  path: '/import',
  tags: ['Contacts'],
  summary: 'Batch import contacts',
  middleware: [requirePermission('contacts:create', 'contacts:envelope-full')],
  request: {
    body: {
      content: { 'application/json': { schema: ContactImportSchema } },
    },
  },
  responses: {
    200: {
      description: 'Import results',
      content: {
        'application/json': {
          schema: z.object({
            created: z.number(),
            errors: z.array(z.object({ index: z.number(), error: z.string() })),
          }),
        },
      },
    },
    400: {
      description: 'Invalid request body',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), details: z.any().optional() }),
        },
      },
    },
  },
})

contactImport.openapi(importRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  let created = 0
  const errors: Array<{ index: number; error: string }> = []

  for (let i = 0; i < body.contacts.length; i++) {
    const contact = body.contacts[i]
    try {
      // Check for duplicates via identifierHash
      if (contact.identifierHash) {
        const existing = await services.contacts.checkDuplicate(
          contact.identifierHash as HmacHash,
          hubId
        )
        if (existing) {
          errors.push({ index: i, error: 'Duplicate contact (identifierHash match)' })
          continue
        }
      }

      await services.contacts.createContact({
        hubId,
        contactType: contact.contactType || 'caller',
        riskLevel: contact.riskLevel || 'low',
        tags: contact.tags ?? [],
        identifierHash: contact.identifierHash as HmacHash | undefined,
        encryptedDisplayName: contact.encryptedDisplayName as Ciphertext,
        displayNameEnvelopes: (contact.displayNameEnvelopes ?? []) as RecipientEnvelope[],
        encryptedFullName: contact.encryptedFullName as Ciphertext | undefined,
        fullNameEnvelopes: (contact.fullNameEnvelopes ?? []) as RecipientEnvelope[],
        encryptedPhone: contact.encryptedPhone as Ciphertext | undefined,
        phoneEnvelopes: (contact.phoneEnvelopes ?? []) as RecipientEnvelope[],
        encryptedPII: contact.encryptedPII as Ciphertext | undefined,
        piiEnvelopes: (contact.piiEnvelopes ?? []) as RecipientEnvelope[],
        createdBy: pubkey ?? '',
      })
      created++
    } catch (err) {
      errors.push({ index: i, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return c.json({ created, errors }, 200)
})

const mergeRoute = createRoute({
  method: 'post',
  path: '/{primaryId}/merge',
  tags: ['Contacts'],
  summary: 'Merge secondary contact into primary',
  middleware: [
    requirePermission('contacts:update-all', 'contacts:envelope-full', 'contacts:delete'),
  ],
  request: {
    params: z.object({
      primaryId: z
        .string()
        .openapi({ param: { name: 'primaryId', in: 'path' }, example: 'contact-abc123' }),
    }),
    body: {
      content: { 'application/json': { schema: MergeSchema } },
    },
  },
  responses: {
    200: {
      description: 'Merge successful',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            primaryId: z.string(),
            mergedTags: z.array(z.string()),
          }),
        },
      },
    },
    400: {
      description: 'Invalid request body',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), details: z.any().optional() }),
        },
      },
    },
    404: {
      description: 'Contact not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

contactImport.openapi(mergeRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { primaryId } = c.req.valid('param')
  const body = c.req.valid('json')

  const primary = await services.contacts.getContact(primaryId, hubId)
  if (!primary) return c.json({ error: 'Primary contact not found' }, 404)

  const secondary = await services.contacts.getContact(body.secondaryId, hubId)
  if (!secondary) return c.json({ error: 'Secondary contact not found' }, 404)

  // Re-link calls from secondary to primary
  const callIds = await services.contacts.getLinkedCallIds(body.secondaryId)
  for (const callId of callIds) {
    await services.contacts.unlinkCall(body.secondaryId, callId)
    try {
      await services.contacts.linkCall(primaryId, callId, hubId, 'merge')
    } catch {
      /* already linked */
    }
  }

  // Re-link conversations
  const convIds = await services.contacts.getLinkedConversationIds(body.secondaryId)
  for (const convId of convIds) {
    await services.contacts.unlinkConversation(body.secondaryId, convId)
    try {
      await services.contacts.linkConversation(primaryId, convId, hubId, 'merge')
    } catch {
      /* already linked */
    }
  }

  // Merge tags
  const mergedTags = [...new Set([...(primary.tags as string[]), ...(secondary.tags as string[])])]
  await services.contacts.updateContact(primaryId, hubId, { tags: mergedTags })

  // Soft-delete secondary with mergedInto reference
  await services.contacts.mergeContact(body.secondaryId, hubId, primaryId)

  return c.json({ ok: true, primaryId, mergedTags }, 200)
})

export default contactImport
