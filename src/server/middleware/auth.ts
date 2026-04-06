import { createHash } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import type { Role } from '../../shared/permissions'
import { resolvePermissions } from '../../shared/permissions'
import { authenticateRequest } from '../lib/auth'
import { runWithLogContext } from '../lib/log-context'
import type { AppEnv } from '../types'

export const auth = createMiddleware<AppEnv>(async (c, next) => {
  const services = c.get('services')
  const authResult = await authenticateRequest(c.req.raw, services.identity)
  if (!authResult) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Load all roles from SettingsService (cached per-request)
  let allRoles: Role[] = await services.settings.listRoles()

  // If user has role IDs not found in the cached list (e.g. recently created custom role),
  // fetch missing roles directly from DB and merge them in
  const missingIds = authResult.user.roles.filter((rid) => !allRoles.find((r) => r.id === rid))
  if (missingIds.length > 0) {
    const fetched = await services.settings.getRolesByIds(missingIds)
    if (fetched.length > 0) {
      allRoles = [...allRoles, ...fetched]
    }
  }

  // Resolve effective permissions from user's role IDs
  const permissions = resolvePermissions(authResult.user.roles, allRoles)

  c.set('pubkey', authResult.pubkey)
  c.set('user', authResult.user)
  c.set('permissions', permissions)
  c.set('allRoles', allRoles)

  let userIdHash: string
  try {
    userIdHash = createHash('sha256').update(authResult.pubkey).digest('hex').slice(0, 8)
  } catch {
    userIdHash = 'hash-err'
  }
  await runWithLogContext({ userId: userIdHash }, async () => {
    await next()
  })
})
