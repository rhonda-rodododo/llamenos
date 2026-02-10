import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { adminGuard } from '../middleware/admin-guard'
import { audit } from '../services/audit'

const settings = new Hono<AppEnv>()

// --- Transcription settings: readable by all authenticated, writable by admin ---
settings.get('/transcription', async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/settings/transcription'))
})

settings.patch('/transcription', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.session.fetch(new Request('http://do/settings/transcription', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.session, 'transcriptionToggled', pubkey, body as Record<string, unknown>)
  return res
})

// --- Custom fields: readable by all authenticated (role-filtered), writable by admin ---
settings.get('/custom-fields', async (c) => {
  const dos = getDOs(c.env)
  const isAdmin = c.get('isAdmin')
  return dos.session.fetch(new Request(`http://do/settings/custom-fields?role=${isAdmin ? 'admin' : 'volunteer'}`))
})

settings.put('/custom-fields', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.session.fetch(new Request('http://do/settings/custom-fields', {
    method: 'PUT',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.session, 'customFieldsUpdated', pubkey, {})
  return res
})

// --- All remaining settings: admin only ---
settings.get('/spam', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/settings/spam'))
})

settings.patch('/spam', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.session.fetch(new Request('http://do/settings/spam', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.session, 'spamMitigationToggled', pubkey, body as Record<string, unknown>)
  return res
})

settings.get('/call', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/settings/call'))
})

settings.patch('/call', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.session.fetch(new Request('http://do/settings/call', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.session, 'callSettingsUpdated', pubkey, body as Record<string, unknown>)
  return res
})

settings.get('/ivr-languages', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/settings/ivr-languages'))
})

settings.patch('/ivr-languages', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.session.fetch(new Request('http://do/settings/ivr-languages', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.session, 'ivrLanguagesUpdated', pubkey, body as Record<string, unknown>)
  return res
})

settings.get('/webauthn', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/settings/webauthn'))
})

settings.patch('/webauthn', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.session.fetch(new Request('http://do/settings/webauthn', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.session, 'webauthnSettingsUpdated', pubkey, body as Record<string, unknown>)
  return res
})

settings.get('/ivr-audio', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/settings/ivr-audio'))
})

settings.put('/ivr-audio/:promptType/:language', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const promptType = c.req.param('promptType')
  const language = c.req.param('language')
  const body = await c.req.arrayBuffer()
  const res = await dos.session.fetch(new Request(`http://do/settings/ivr-audio/${promptType}/${language}`, {
    method: 'PUT',
    body,
  }))
  if (res.ok) await audit(dos.session, 'ivrAudioUploaded', pubkey, { promptType, language })
  return res
})

settings.delete('/ivr-audio/:promptType/:language', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const promptType = c.req.param('promptType')
  const language = c.req.param('language')
  const res = await dos.session.fetch(new Request(`http://do/settings/ivr-audio/${promptType}/${language}`, {
    method: 'DELETE',
  }))
  if (res.ok) await audit(dos.session, 'ivrAudioDeleted', pubkey, { promptType, language })
  return res
})

export default settings
