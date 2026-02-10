import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { adminGuard } from '../middleware/admin-guard'

const auditRoutes = new Hono<AppEnv>()
auditRoutes.use('*', adminGuard)

auditRoutes.get('/', async (c) => {
  const dos = getDOs(c.env)
  const params = new URLSearchParams()
  params.set('page', c.req.query('page') || '1')
  params.set('limit', c.req.query('limit') || '50')
  if (c.req.query('actorPubkey')) params.set('actorPubkey', c.req.query('actorPubkey')!)
  return dos.session.fetch(new Request(`http://do/audit?${params}`))
})

export default auditRoutes
