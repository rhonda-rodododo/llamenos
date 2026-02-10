import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'

const dev = new Hono<AppEnv>()

dev.post('/test-reset', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Not Found' }, 404)
  }
  const dos = getDOs(c.env)
  await dos.session.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.shifts.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.calls.fetch(new Request('http://do/reset', { method: 'POST' }))
  return c.json({ ok: true })
})

export default dev
