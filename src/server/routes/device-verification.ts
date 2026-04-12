import { SignedAuditEntrySchema } from '@shared/schemas/audit-entries'
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
 *   1. Caller has admin permission
 *   2. Payload type is device_fingerprint_verified
 *   3. hubId in payload matches the hub context
 *   4. verifiedDeviceId in payload matches the path param
 *   5. signerPubkey matches the authenticated caller
 *
 * On success, appends to the audit chain and returns 201 with the entry hash.
 */
deviceVerificationRoutes.post(
  '/devices/:deviceId/verify',
  requirePermission('audit:read'),
  async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId')
    const deviceId = c.req.param('deviceId')
    const callerPubkey = c.get('pubkey')

    const body = await c.req.json().catch(() => null)
    const parsed = SignedAuditEntrySchema.safeParse(body?.signedEntry ?? body)
    if (!parsed.success) {
      return c.json(
        { error: 'Invalid signed audit entry', code: 'validation_failed' as const },
        400
      )
    }

    const entry = parsed.data

    if (entry.payload.type !== 'device_fingerprint_verified') {
      return c.json({ error: 'Payload type must be device_fingerprint_verified' }, 400)
    }

    if (hubId && entry.hubId !== hubId) {
      return c.json({ error: 'hubId in payload does not match path' }, 400)
    }

    if (entry.payload.verifiedDeviceId !== deviceId) {
      return c.json({ error: 'verifiedDeviceId does not match path deviceId' }, 400)
    }

    if (!callerPubkey || entry.signerPubkey !== callerPubkey) {
      return c.json({ error: 'signerPubkey does not match authenticated user' }, 403)
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
  }
)

export default deviceVerificationRoutes
