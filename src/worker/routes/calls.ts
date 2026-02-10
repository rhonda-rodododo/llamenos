import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { adminGuard } from '../middleware/admin-guard'

const calls = new Hono<AppEnv>()

calls.get('/active', async (c) => {
  const dos = getDOs(c.env)
  const isAdmin = c.get('isAdmin')
  const res = await dos.calls.fetch(new Request('http://do/calls/active'))
  if (!isAdmin) {
    const data = await res.json() as { calls: Array<{ callerNumber: string; [key: string]: unknown }> }
    data.calls = data.calls.map(call => ({ ...call, callerNumber: '[redacted]' }))
    return c.json(data)
  }
  return res
})

calls.get('/today-count', async (c) => {
  const dos = getDOs(c.env)
  return dos.calls.fetch(new Request('http://do/calls/today-count'))
})

calls.get('/presence', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.calls.fetch(new Request('http://do/calls/presence'))
})

calls.get('/history', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const params = new URLSearchParams()
  params.set('page', c.req.query('page') || '1')
  params.set('limit', c.req.query('limit') || '50')
  if (c.req.query('search')) params.set('search', c.req.query('search')!)
  if (c.req.query('dateFrom')) params.set('dateFrom', c.req.query('dateFrom')!)
  if (c.req.query('dateTo')) params.set('dateTo', c.req.query('dateTo')!)
  return dos.calls.fetch(new Request(`http://do/calls/history?${params}`))
})

export default calls
