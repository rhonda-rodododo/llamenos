import { createRoute, z } from '@hono/zod-openapi'
import { LABEL_CONTACT_PII, LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

const contactImport = createRouter()

// Use permissive envelope schema (passthrough) to accept both ECIES and HPKE
// formats during the migration period — matches the core contacts route pattern.
const EnvelopeSchema = z.object({}).passthrough()

const ContactImportSchema = z.object({
  contacts: z
    .array(
      z.object({
        contactType: z.string(),
        riskLevel: z.string(),
        tags: z.array(z.string()).optional(),
        displayName: z.string().optional(),
        fullName: z.string().optional(),
        phone: z.string().optional(),
        encryptedDisplayName: z.string().optional(),
        displayNameEnvelopes: z.array(EnvelopeSchema).optional(),
        encryptedFullName: z.string().optional(),
        fullNameEnvelopes: z.array(EnvelopeSchema).optional(),
        encryptedPhone: z.string().optional(),
        phoneEnvelopes: z.array(EnvelopeSchema).optional(),
        identifierHash: z.string().optional(),
        encryptedPII: z.string().optional(),
        piiEnvelopes: z.array(EnvelopeSchema).optional(),
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

      const contactId = crypto.randomUUID()

      // Server-side envelope encryption for plaintext fields
      const hasEncDisplayName = contact.encryptedDisplayName && contact.displayNameEnvelopes
      let encDisplayName = contact.encryptedDisplayName as Ciphertext | undefined
      let dispEnvelopes = contact.displayNameEnvelopes as unknown as RecipientEnvelope[] | undefined
      if (!hasEncDisplayName && contact.displayName) {
        const env = await services.crypto.envelopeEncrypt(
          contact.displayName,
          [],
          LABEL_CONTACT_SUMMARY,
          contactId,
          'displayName'
        )
        encDisplayName = env.encrypted
        dispEnvelopes = env.envelopes
      }

      let encFullName = contact.encryptedFullName as Ciphertext | undefined
      let fnEnv = contact.fullNameEnvelopes as unknown as RecipientEnvelope[] | undefined
      if (!contact.encryptedFullName && contact.fullName) {
        const env = await services.crypto.envelopeEncrypt(
          contact.fullName,
          [],
          LABEL_CONTACT_PII,
          contactId,
          'fullName'
        )
        encFullName = env.encrypted
        fnEnv = env.envelopes
      }

      let encPhone = contact.encryptedPhone as Ciphertext | undefined
      let phoneEnv = contact.phoneEnvelopes as unknown as RecipientEnvelope[] | undefined
      if (!contact.encryptedPhone && contact.phone) {
        const env = await services.crypto.envelopeEncrypt(
          contact.phone,
          [],
          LABEL_CONTACT_PII,
          contactId,
          'phone'
        )
        encPhone = env.encrypted
        phoneEnv = env.envelopes
      }

      if (!encDisplayName) {
        errors.push({ index: i, error: 'displayName or encryptedDisplayName is required' })
        continue
      }

      await services.contacts.createContact({
        hubId,
        contactType: contact.contactType || 'caller',
        riskLevel: contact.riskLevel || 'low',
        tags: contact.tags ?? [],
        identifierHash: contact.identifierHash as HmacHash | undefined,
        encryptedDisplayName: encDisplayName,
        displayNameEnvelopes: (dispEnvelopes ?? []) as RecipientEnvelope[],
        encryptedFullName: encFullName,
        fullNameEnvelopes: (fnEnv ?? []) as RecipientEnvelope[],
        encryptedPhone: encPhone,
        phoneEnvelopes: (phoneEnv ?? []) as RecipientEnvelope[],
        encryptedPII: contact.encryptedPII as Ciphertext | undefined,
        piiEnvelopes: (contact.piiEnvelopes ?? []) as unknown as RecipientEnvelope[],
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
