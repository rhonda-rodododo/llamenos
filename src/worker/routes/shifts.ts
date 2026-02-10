import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { adminGuard } from '../middleware/admin-guard'
import { audit } from '../services/audit'

const shifts = new Hono<AppEnv>()

// All authenticated users can check their shift status
shifts.get('/my-status', async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  return dos.shifts.fetch(new Request(`http://do/my-status?pubkey=${pubkey}`))
})

// --- Admin-only routes ---

shifts.get('/fallback', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/fallback'))
})

shifts.put('/fallback', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/fallback', {
    method: 'PUT',
    body: JSON.stringify(await c.req.json()),
  }))
})

shifts.get('/', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.shifts.fetch(new Request('http://do/shifts'))
})

shifts.post('/', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const res = await dos.shifts.fetch(new Request('http://do/shifts', {
    method: 'POST',
    body: JSON.stringify(await c.req.json()),
  }))
  if (res.ok) await audit(dos.session, 'shiftCreated', pubkey)
  return res
})

shifts.patch('/:id', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)
  const res = await dos.shifts.fetch(new Request(`http://do/shifts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(await c.req.json()),
  }))
  if (res.ok) await audit(dos.session, 'shiftEdited', pubkey, { shiftId: id })
  return res
})

shifts.delete('/:id', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)
  const res = await dos.shifts.fetch(new Request(`http://do/shifts/${id}`, { method: 'DELETE' }))
  if (res.ok) await audit(dos.session, 'shiftDeleted', pubkey, { shiftId: id })
  return res
})

export default shifts
