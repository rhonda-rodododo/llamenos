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

// --- Telephony Provider settings: admin only ---
settings.get('/telephony-provider', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  return dos.session.fetch(new Request('http://do/settings/telephony-provider'))
})

settings.patch('/telephony-provider', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.session.fetch(new Request('http://do/settings/telephony-provider', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.session, 'telephonyProviderChanged', pubkey, { type: (body as { type?: string }).type })
  return res
})

settings.post('/telephony-provider/test', adminGuard, async (c) => {
  const body = await c.req.json() as { type: string; accountSid?: string; authToken?: string; phoneNumber?: string; signalwireSpace?: string; apiKey?: string; apiSecret?: string; applicationId?: string; authId?: string; ariUrl?: string; ariUsername?: string; ariPassword?: string }
  try {
    let testUrl: string
    let testHeaders: Record<string, string> = {}

    switch (body.type) {
      case 'twilio':
        testUrl = `https://api.twilio.com/2010-04-01/Accounts/${body.accountSid}.json`
        testHeaders['Authorization'] = 'Basic ' + btoa(`${body.accountSid}:${body.authToken}`)
        break
      case 'signalwire':
        testUrl = `https://${body.signalwireSpace}.signalwire.com/api/relay/rest/phone_numbers`
        testHeaders['Authorization'] = 'Basic ' + btoa(`${body.accountSid}:${body.authToken}`)
        break
      case 'vonage':
        testUrl = `https://rest.nexmo.com/account/get-balance?api_key=${body.apiKey}&api_secret=${body.apiSecret}`
        break
      case 'plivo':
        testUrl = `https://api.plivo.com/v1/Account/${body.authId}/`
        testHeaders['Authorization'] = 'Basic ' + btoa(`${body.authId}:${body.authToken}`)
        break
      case 'asterisk':
        testUrl = `${body.ariUrl}/api/asterisk/info`
        testHeaders['Authorization'] = 'Basic ' + btoa(`${body.ariUsername}:${body.ariPassword}`)
        break
      default:
        return Response.json({ ok: false, error: 'Unknown provider type' }, { status: 400 })
    }

    const testRes = await fetch(testUrl, { headers: testHeaders })
    if (testRes.ok) {
      return Response.json({ ok: true })
    }
    return Response.json({ ok: false, error: `Provider returned ${testRes.status}` }, { status: 400 })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 400 })
  }
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
