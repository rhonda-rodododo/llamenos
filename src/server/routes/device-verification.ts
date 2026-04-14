import { createRoute } from '@hono/zod-openapi'
import {
  DeviceVerificationErrorSchema,
  DeviceVerificationParamsSchema,
  DeviceVerificationRequestSchema,
  DeviceVerificationSuccessSchema,
} from '@shared/schemas/device-verification'
import { createLogger } from '../lib/logger'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'
import { AuditChainError } from '../services/audit-log-service'

const log = createLogger('api:device-verification')
const deviceVerificationRoutes = createRouter()

/**
 * POST /devices/:deviceId/verify
 *
 * Submit a signed `device_fingerprint_verified` audit entry after out-of-band
 * SAS verification. Only admins can verify device fingerprints.
 *
 * The route validates:
 *   1. Caller has `audit:read` permission (granted to admin roles)
 *   2. Hub context is present (fail-closed if middleware did not set it)
 *   3. Payload type is device_fingerprint_verified
 *   4. hubId in the signed entry AND payload match the hub context
 *   5. verifiedDeviceId in payload matches the path param
 *   6. signerPubkey matches the authenticated caller
 *
 * On success, appends to the audit chain and returns 201 with the entry hash.
 *
 * Wire-format note: the route returns `{ error, code }` for every error
 * response. The `code` field is part of the wire contract — clients (and the
 * API E2E suite) discriminate on it. The route-level hook below preserves the
 * historical `code: 'validation_failed'` shape on zod parse failures, which
 * the default OpenAPI hook would otherwise drop.
 */
const verifyDeviceRoute = createRoute({
  method: 'post',
  path: '/{deviceId}/verify',
  tags: ['DeviceVerification'],
  summary: 'Submit a signed device_fingerprint_verified audit entry',
  middleware: [requirePermission('audit:read')] as const,
  request: {
    params: DeviceVerificationParamsSchema,
    body: {
      content: {
        'application/json': { schema: DeviceVerificationRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Audit entry appended to the hub chain',
      content: {
        'application/json': { schema: DeviceVerificationSuccessSchema },
      },
    },
    400: {
      description: 'Malformed request, payload mismatch, or audit-chain rejection',
      content: { 'application/json': { schema: DeviceVerificationErrorSchema } },
    },
    403: {
      description: 'signerPubkey does not match the authenticated caller',
      content: { 'application/json': { schema: DeviceVerificationErrorSchema } },
    },
    500: {
      description: 'Hub context missing — middleware misconfiguration',
      content: { 'application/json': { schema: DeviceVerificationErrorSchema } },
    },
  },
})

deviceVerificationRoutes.openapi(
  verifyDeviceRoute,
  async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId')
    const { deviceId } = c.req.valid('param')
    const callerPubkey = c.get('pubkey')

    if (!hubId) {
      log.error('device verification called without hub context')
      return c.json({ error: 'Hub context missing', code: 'server_error' as const }, 500)
    }

    const { signedEntry: entry } = c.req.valid('json')

    if (entry.payload.type !== 'device_fingerprint_verified') {
      return c.json(
        {
          error: 'Payload type must be device_fingerprint_verified',
          code: 'payload_type_mismatch' as const,
        },
        400
      )
    }

    if (entry.hubId !== hubId) {
      return c.json(
        { error: 'hubId in signed entry does not match path', code: 'hub_id_mismatch' as const },
        400
      )
    }

    if (entry.payload.hubId !== hubId) {
      return c.json(
        { error: 'hubId in payload does not match path', code: 'hub_id_mismatch' as const },
        400
      )
    }

    if (entry.payload.verifiedDeviceId !== deviceId) {
      return c.json(
        {
          error: 'verifiedDeviceId does not match path deviceId',
          code: 'device_id_mismatch' as const,
        },
        400
      )
    }

    if (!callerPubkey || entry.signerPubkey !== callerPubkey) {
      return c.json(
        {
          error: 'signerPubkey does not match authenticated user',
          code: 'signer_pubkey_mismatch' as const,
        },
        403
      )
    }

    try {
      await services.auditLog.appendSigned(entry)
      return c.json({ entryHash: entry.entryHash, appendedAt: entry.createdAt }, 201)
    } catch (err) {
      if (err instanceof AuditChainError) {
        log.warn('device verification audit entry rejected', {
          code: err.code,
          details: err.details,
        })
        return c.json({ error: err.message, code: err.code }, 400)
      }
      throw err
    }
  },
  // Per-route hook: keep the wire-contract `code: 'validation_failed'` shape
  // on zod parse failures. The router-level defaultHook only emits `error`,
  // and the API E2E suite discriminates on `body.code`.
  (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      return c.json(
        {
          error: `Invalid signed audit entry: ${issues.join('; ')}`,
          code: 'validation_failed' as const,
        },
        400
      )
    }
  }
)

export default deviceVerificationRoutes
