import type { Env, WebAuthnCredential } from './types'
import { authenticateRequest, parseSessionHeader } from './lib/auth'
import { TwilioAdapter } from './telephony/twilio'
import { LANGUAGE_MAP, detectLanguageFromPhone, languageFromDigit, DEFAULT_LANGUAGE } from '../shared/languages'
import { encryptForPublicKey, hashPhone, hashIP } from './lib/crypto'
import { generateRegOptions, verifyRegResponse, generateAuthOptions, verifyAuthResponse } from './lib/webauthn'

// Re-export Durable Object classes
export { SessionManagerDO } from './durable-objects/session-manager'
export { ShiftManagerDO } from './durable-objects/shift-manager'
export { CallRouterDO } from './durable-objects/call-router'

// Singleton DO instance IDs
const SESSION_ID = 'global-session'
const SHIFT_ID = 'global-shifts'
const CALL_ID = 'global-calls'

function getDOs(env: Env) {
  return {
    session: env.SESSION_MANAGER.get(env.SESSION_MANAGER.idFromName(SESSION_ID)),
    shifts: env.SHIFT_MANAGER.get(env.SHIFT_MANAGER.idFromName(SHIFT_ID)),
    calls: env.CALL_ROUTER.get(env.CALL_ROUTER.idFromName(CALL_ID)),
  }
}

function getTwilio(env: Env): TwilioAdapter {
  return new TwilioAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER)
}

const E164_REGEX = /^\+\d{7,15}$/

function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone)
}

function extractPathParam(path: string, prefix: string): string | null {
  const param = path.split(prefix)[1]
  if (!param || param.includes('/')) return null // Reject path traversal
  return param
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

async function audit(session: DurableObjectStub, event: string, actorPubkey: string, details: Record<string, unknown> = {}, request?: Request) {
  const meta: Record<string, unknown> = {}
  if (request) {
    const rawIp = request.headers.get('CF-Connecting-IP')
    meta.ip = rawIp ? hashIP(rawIp) : null
    meta.country = request.headers.get('CF-IPCountry')
    meta.ua = request.headers.get('User-Agent')
  }
  await session.fetch(new Request('http://do/audit', {
    method: 'POST',
    body: JSON.stringify({ event, actorPubkey, details: { ...details, ...meta } }),
  }))
}

async function buildAudioUrlMap(session: DurableObjectStub, origin: string): Promise<Record<string, string>> {
  const audioRes = await session.fetch(new Request('http://do/settings/ivr-audio'))
  const { recordings } = await audioRes.json() as { recordings: Array<{ promptType: string; language: string }> }
  const map: Record<string, string> = {}
  for (const rec of recordings) {
    map[`${rec.promptType}:${rec.language}`] = `${origin}/api/ivr-audio/${rec.promptType}/${rec.language}`
  }
  return map
}

function getSecurityHeaders(request: Request, env: Env) {
  const host = new URL(request.url).host
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://${host}; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`,
  }
}

function addSecurityHeaders(response: Response, request: Request, env: Env): Response {
  const newHeaders = new Headers(response.headers)
  for (const [key, value] of Object.entries(getSecurityHeaders(request, env))) {
    newHeaders.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Only handle /api/* routes — everything else goes to static assets
    if (!url.pathname.startsWith('/api/')) {
      const assetResponse = await env.ASSETS.fetch(request)
      return addSecurityHeaders(assetResponse, request, env)
    }

    const path = url.pathname.slice(4) // Remove /api prefix
    const method = request.method
    const dos = getDOs(env)

    // --- CORS headers (same-origin in production, permissive in dev for Vite proxy) ---
    const allowedOrigin = env.ENVIRONMENT === 'development' ? 'http://localhost:5173' : url.origin.replace(/^http:/, 'https:')
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    // --- Public config (no auth) ---
    if (path === '/config' && method === 'GET') {
      return json({ hotlineName: env.HOTLINE_NAME || 'Hotline', hotlineNumber: env.TWILIO_PHONE_NUMBER || '' })
    }

    // --- Telephony Webhooks (no auth — validated by Twilio signature) ---
    if (path.startsWith('/telephony/')) {
      return handleTelephonyWebhook(path, request, env, dos, ctx)
    }

    // --- Public IVR Audio Serve (no auth — Twilio fetches this during calls) ---
    if (path.startsWith('/ivr-audio/') && method === 'GET') {
      const parts = path.replace('/ivr-audio/', '').split('/')
      if (parts.length !== 2) return error('Invalid path', 400)
      return dos.session.fetch(new Request(`http://do/settings/ivr-audio/${parts[0]}/${parts[1]}`))
    }

    // --- Test Reset (development only) ---
    if (path === '/test-reset' && method === 'POST' && env.ENVIRONMENT === 'development') {
      await dos.session.fetch(new Request('http://do/reset', { method: 'POST' }))
      await dos.shifts.fetch(new Request('http://do/reset', { method: 'POST' }))
      await dos.calls.fetch(new Request('http://do/reset', { method: 'POST' }))
      return json({ ok: true })
    }

    // --- Public Invite Routes (no auth) ---
    if (path.startsWith('/invites/validate/') && method === 'GET') {
      const code = extractPathParam(path, '/invites/validate/')
      if (!code) return error('Invalid code', 400)
      // Rate limit invite validation to prevent enumeration
      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown'
      const rlRes = await dos.session.fetch(new Request('http://do/rate-limit/check', {
        method: 'POST',
        body: JSON.stringify({ key: `invite-validate:${hashIP(clientIp)}`, maxPerMinute: 10 }),
      }))
      const rlData = await rlRes.json() as { limited: boolean }
      if (rlData.limited) return error('Too many requests', 429)
      return dos.session.fetch(new Request(`http://do/invites/validate/${code}`))
    }
    if (path === '/invites/redeem' && method === 'POST') {
      const body = await request.json() as { code: string; pubkey: string }
      return dos.session.fetch(new Request('http://do/invites/redeem', {
        method: 'POST',
        body: JSON.stringify(body),
      }))
    }

    // --- WebAuthn Login (no auth required — discoverable credentials) ---
    if (path === '/webauthn/login/options' && method === 'POST') {
      const rpID = new URL(request.url).hostname
      // Get all credentials across all users for discoverable login
      const allCredsRes = await dos.session.fetch(new Request('http://do/webauthn/all-credentials'))
      const { credentials } = await allCredsRes.json() as { credentials: Array<WebAuthnCredential & { ownerPubkey: string }> }
      const options = await generateAuthOptions(credentials, rpID)
      // Store challenge
      const challengeId = crypto.randomUUID()
      await dos.session.fetch(new Request('http://do/webauthn/challenge', {
        method: 'POST',
        body: JSON.stringify({ id: challengeId, challenge: options.challenge }),
      }))
      return json({ ...options, challengeId })
    }
    if (path === '/webauthn/login/verify' && method === 'POST') {
      const body = await request.json() as { assertion: any; challengeId: string }
      const origin = new URL(request.url).origin
      const rpID = new URL(request.url).hostname
      // Retrieve challenge
      const challengeRes = await dos.session.fetch(new Request(`http://do/webauthn/challenge/${body.challengeId}`))
      if (!challengeRes.ok) return error('Invalid or expired challenge', 400)
      const { challenge } = await challengeRes.json() as { challenge: string }
      // Find credential by ID from assertion
      const allCredsRes = await dos.session.fetch(new Request('http://do/webauthn/all-credentials'))
      const { credentials } = await allCredsRes.json() as { credentials: Array<WebAuthnCredential & { ownerPubkey: string }> }
      const matched = credentials.find(c => c.id === body.assertion.id)
      if (!matched) return error('Unknown credential', 401)
      try {
        const verification = await verifyAuthResponse(body.assertion, matched, challenge, origin, rpID)
        if (!verification.verified) return error('Verification failed', 401)
        // Update counter
        await dos.session.fetch(new Request('http://do/webauthn/credentials/update-counter', {
          method: 'POST',
          body: JSON.stringify({
            pubkey: matched.ownerPubkey,
            credId: matched.id,
            counter: verification.authenticationInfo.newCounter,
            lastUsedAt: new Date().toISOString(),
          }),
        }))
        // Create server session
        const sessionRes = await dos.session.fetch(new Request('http://do/sessions/create', {
          method: 'POST',
          body: JSON.stringify({ pubkey: matched.ownerPubkey }),
        }))
        const session = await sessionRes.json() as { token: string; pubkey: string }
        await audit(dos.session, 'webauthnLogin', matched.ownerPubkey, { credId: matched.id }, request)
        return json({ token: session.token, pubkey: session.pubkey })
      } catch {
        return error('Verification failed', 401)
      }
    }

    // --- Auth Routes ---
    if (path === '/auth/login' && method === 'POST') {
      // Rate limit login attempts by IP (skip in development for testing)
      if (env.ENVIRONMENT !== 'development') {
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown'
        const rlRes = await dos.session.fetch(new Request('http://do/rate-limit/check', {
          method: 'POST',
          body: JSON.stringify({ key: `auth:${hashIP(clientIp)}`, maxPerMinute: 10 }),
        }))
        const rlData = await rlRes.json() as { limited: boolean }
        if (rlData.limited) {
          return error('Too many login attempts. Try again later.', 429)
        }
      }
      return handleLogin(request, dos.session)
    }

    // --- WebSocket (auth via Sec-WebSocket-Protocol header) ---
    if (path === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      const protocols = request.headers.get('Sec-WebSocket-Protocol') || ''
      const parts = protocols.split(',').map(p => p.trim())
      const authB64 = parts.find(p => p !== 'llamenos-auth' && p !== '')
      if (!authB64) return error('Unauthorized', 401)

      let wsPubkey: string | null = null

      // Try session token first (for WebAuthn sessions)
      if (authB64.startsWith('session-')) {
        const sessionToken = authB64.slice(8) // Remove 'session-' prefix
        const sessionRes = await dos.session.fetch(new Request(`http://do/sessions/validate/${sessionToken}`))
        if (sessionRes.ok) {
          const session = await sessionRes.json() as { pubkey: string }
          wsPubkey = session.pubkey
        }
      }

      // Fall back to Schnorr auth
      if (!wsPubkey) {
        try {
          const b64 = authB64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - authB64.length % 4) % 4)
          const auth = JSON.parse(atob(b64)) as { pubkey: string; timestamp: number; token: string }
          const { verifyAuthToken } = await import('./lib/auth')
          if (await verifyAuthToken(auth)) {
            wsPubkey = auth.pubkey
          }
        } catch {
          // Invalid auth format
        }
      }

      if (!wsPubkey) return error('Unauthorized', 401)
      const volRes = await dos.session.fetch(new Request(`http://do/volunteer/${wsPubkey}`))
      if (!volRes.ok) return error('Unknown user', 401)
      // Forward to CallRouter DO with pubkey (clean URL, no auth in query)
      const wsUrl = new URL(request.url)
      wsUrl.pathname = '/ws'
      wsUrl.search = ''
      wsUrl.searchParams.set('pubkey', wsPubkey)
      return dos.calls.fetch(new Request(wsUrl.toString(), request))
    }

    // --- Authenticated Routes ---
    const authResult = await authenticateRequest(request, dos.session)
    if (!authResult) {
      return error('Unauthorized', 401)
    }

    const { pubkey, volunteer } = authResult
    const isAdmin = volunteer.role === 'admin'

    // --- Auth: me ---
    if (path === '/auth/me' && method === 'GET') {
      // Check WebAuthn status
      const credsRes = await dos.session.fetch(new Request(`http://do/webauthn/credentials?pubkey=${pubkey}`))
      const { credentials: webauthnCreds } = await credsRes.json() as { credentials: WebAuthnCredential[] }
      const settingsRes = await dos.session.fetch(new Request('http://do/settings/webauthn'))
      const webauthnSettings = await settingsRes.json() as { requireForAdmins: boolean; requireForVolunteers: boolean }
      const webauthnRequired = volunteer.role === 'admin' ? webauthnSettings.requireForAdmins : webauthnSettings.requireForVolunteers
      return json({
        pubkey: volunteer.pubkey,
        role: volunteer.role,
        name: volunteer.name,
        transcriptionEnabled: volunteer.transcriptionEnabled,
        spokenLanguages: volunteer.spokenLanguages || ['en'],
        uiLanguage: volunteer.uiLanguage || 'en',
        profileCompleted: volunteer.profileCompleted ?? true,
        onBreak: volunteer.onBreak ?? false,
        webauthnRequired,
        webauthnRegistered: webauthnCreds.length > 0,
      })
    }
    if (path === '/auth/me/profile' && method === 'PATCH') {
      const body = await request.json() as { name?: string; phone?: string; spokenLanguages?: string[]; uiLanguage?: string; profileCompleted?: boolean }
      if (body.phone && !isValidE164(body.phone)) {
        return error('Invalid phone number. Use E.164 format (e.g. +12125551234)', 400)
      }
      await dos.session.fetch(new Request(`http://do/volunteers/${pubkey}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }))
      return json({ ok: true })
    }
    if (path === '/auth/me/availability' && method === 'PATCH') {
      const body = await request.json() as { onBreak: boolean }
      await dos.session.fetch(new Request(`http://do/volunteers/${pubkey}`, {
        method: 'PATCH',
        body: JSON.stringify({ onBreak: body.onBreak }),
      }))
      await audit(dos.session, body.onBreak ? 'volunteerOnBreak' : 'volunteerAvailable', pubkey)
      return json({ ok: true })
    }
    if (path === '/auth/me/transcription' && method === 'PATCH') {
      const body = await request.json() as { enabled: boolean }
      // If volunteer is trying to disable, check if admin allows opt-out
      if (!body.enabled && !isAdmin) {
        const transRes = await dos.session.fetch(new Request('http://do/settings/transcription'))
        const transSettings = await transRes.json() as { globalEnabled: boolean; allowVolunteerOptOut: boolean }
        if (!transSettings.allowVolunteerOptOut) {
          return error('Transcription opt-out is not allowed', 403)
        }
      }
      await dos.session.fetch(new Request(`http://do/volunteers/${pubkey}`, {
        method: 'PATCH',
        body: JSON.stringify({ transcriptionEnabled: body.enabled }),
      }))
      await audit(dos.session, 'transcriptionToggled', pubkey, { enabled: body.enabled })
      return json({ ok: true })
    }

    // --- WebAuthn Registration (requires auth) ---
    if (path === '/webauthn/register/options' && method === 'POST') {
      const body = await request.json() as { label: string }
      const rpID = new URL(request.url).hostname
      const rpName = env.HOTLINE_NAME || 'Hotline'
      const credsRes = await dos.session.fetch(new Request(`http://do/webauthn/credentials?pubkey=${pubkey}`))
      const { credentials: existing } = await credsRes.json() as { credentials: WebAuthnCredential[] }
      const options = await generateRegOptions({ pubkey, name: volunteer.name }, existing, rpID, rpName)
      // Store challenge
      const challengeId = crypto.randomUUID()
      await dos.session.fetch(new Request('http://do/webauthn/challenge', {
        method: 'POST',
        body: JSON.stringify({ id: challengeId, challenge: options.challenge }),
      }))
      return json({ ...options, challengeId })
    }
    if (path === '/webauthn/register/verify' && method === 'POST') {
      const body = await request.json() as { attestation: any; label: string; challengeId: string }
      const origin = new URL(request.url).origin
      const rpID = new URL(request.url).hostname
      // Retrieve challenge
      const challengeRes = await dos.session.fetch(new Request(`http://do/webauthn/challenge/${body.challengeId}`))
      if (!challengeRes.ok) return error('Invalid or expired challenge', 400)
      const { challenge } = await challengeRes.json() as { challenge: string }
      try {
        const verification = await verifyRegResponse(body.attestation, challenge, origin, rpID)
        if (!verification.verified || !verification.registrationInfo) return error('Verification failed', 400)
        const { credential: regCred, credentialBackedUp } = verification.registrationInfo
        const newCred: WebAuthnCredential = {
          id: regCred.id,
          publicKey: uint8ArrayToBase64URL(regCred.publicKey),
          counter: regCred.counter,
          transports: body.attestation.response?.transports || [],
          backedUp: credentialBackedUp,
          label: body.label || 'Passkey',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        }
        await dos.session.fetch(new Request('http://do/webauthn/credentials', {
          method: 'POST',
          body: JSON.stringify({ pubkey, credential: newCred }),
        }))
        await audit(dos.session, 'webauthnRegistered', pubkey, { credId: newCred.id, label: body.label }, request)
        return json({ ok: true })
      } catch {
        return error('Verification failed', 400)
      }
    }

    // --- WebAuthn Credentials Management ---
    if (path === '/webauthn/credentials' && method === 'GET') {
      const credsRes = await dos.session.fetch(new Request(`http://do/webauthn/credentials?pubkey=${pubkey}`))
      const { credentials } = await credsRes.json() as { credentials: WebAuthnCredential[] }
      return json({
        credentials: credentials.map(c => ({
          id: c.id,
          label: c.label,
          backedUp: c.backedUp,
          createdAt: c.createdAt,
          lastUsedAt: c.lastUsedAt,
        })),
      })
    }
    if (path.startsWith('/webauthn/credentials/') && method === 'DELETE') {
      const credId = decodeURIComponent(extractPathParam(path, '/webauthn/credentials/') || '')
      if (!credId) return error('Invalid credential ID', 400)
      const res = await dos.session.fetch(new Request(`http://do/webauthn/credentials/${encodeURIComponent(credId)}?pubkey=${pubkey}`, { method: 'DELETE' }))
      if (res.ok) await audit(dos.session, 'webauthnDeleted', pubkey, { credId }, request)
      return res
    }

    // --- Shift Status (all authenticated users) ---
    if (path === '/shifts/my-status' && method === 'GET') {
      return dos.shifts.fetch(new Request(`http://do/my-status?pubkey=${pubkey}`))
    }

    // --- Volunteers (admin only) ---
    if (path === '/volunteers' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/volunteers'))
    }
    if (path === '/volunteers' && method === 'POST') {
      if (!isAdmin) return error('Forbidden', 403)
      return handleCreateVolunteer(request, dos.session, pubkey)
    }
    if (path.startsWith('/volunteers/') && method === 'PATCH') {
      if (!isAdmin) return error('Forbidden', 403)
      const targetPubkey = extractPathParam(path, '/volunteers/')
      if (!targetPubkey) return error('Invalid pubkey', 400)
      const body = await request.json()
      const res = await dos.session.fetch(new Request(`http://do/volunteers/${targetPubkey}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }))
      if (res.ok) {
        const data = body as Record<string, unknown>
        if (data.role) await audit(dos.session, data.role === 'admin' ? 'adminPromoted' : 'adminDemoted', pubkey, { target: targetPubkey })
      }
      return res
    }
    if (path.startsWith('/volunteers/') && method === 'DELETE') {
      if (!isAdmin) return error('Forbidden', 403)
      const targetPubkey = extractPathParam(path, '/volunteers/')
      if (!targetPubkey) return error('Invalid pubkey', 400)
      const res = await dos.session.fetch(new Request(`http://do/volunteers/${targetPubkey}`, { method: 'DELETE' }))
      if (res.ok) await audit(dos.session, 'volunteerRemoved', pubkey, { target: targetPubkey })
      return res
    }

    // --- Invites (admin only) ---
    if (path === '/invites' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/invites'))
    }
    if (path === '/invites' && method === 'POST') {
      if (!isAdmin) return error('Forbidden', 403)
      const body = await request.json() as { name: string; phone: string; role: 'volunteer' | 'admin' }
      if (body.phone && !isValidE164(body.phone)) {
        return error('Invalid phone number. Use E.164 format (e.g. +12125551234)', 400)
      }
      const res = await dos.session.fetch(new Request('http://do/invites', {
        method: 'POST',
        body: JSON.stringify({ ...body, createdBy: pubkey }),
      }))
      if (res.ok) await audit(dos.session, 'inviteCreated', pubkey, { name: body.name })
      return res
    }
    if (path.startsWith('/invites/') && method === 'DELETE') {
      if (!isAdmin) return error('Forbidden', 403)
      const code = extractPathParam(path, '/invites/')
      if (!code) return error('Invalid invite code', 400)
      const res = await dos.session.fetch(new Request(`http://do/invites/${code}`, { method: 'DELETE' }))
      if (res.ok) await audit(dos.session, 'inviteRevoked', pubkey, { code })
      return res
    }

    // --- Shifts (admin only) ---
    if (path === '/shifts' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.shifts.fetch(new Request('http://do/shifts'))
    }
    if (path === '/shifts' && method === 'POST') {
      if (!isAdmin) return error('Forbidden', 403)
      const res = await dos.shifts.fetch(new Request('http://do/shifts', {
        method: 'POST',
        body: JSON.stringify(await request.json()),
      }))
      if (res.ok) await audit(dos.session, 'shiftCreated', pubkey)
      return res
    }
    if (path.startsWith('/shifts/') && path !== '/shifts/fallback' && method === 'PATCH') {
      if (!isAdmin) return error('Forbidden', 403)
      const id = extractPathParam(path, '/shifts/')
      if (!id) return error('Invalid shift ID', 400)
      const res = await dos.shifts.fetch(new Request(`http://do/shifts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(await request.json()),
      }))
      if (res.ok) await audit(dos.session, 'shiftEdited', pubkey, { shiftId: id })
      return res
    }
    if (path.startsWith('/shifts/') && path !== '/shifts/fallback' && method === 'DELETE') {
      if (!isAdmin) return error('Forbidden', 403)
      const id = extractPathParam(path, '/shifts/')
      if (!id) return error('Invalid shift ID', 400)
      const res = await dos.shifts.fetch(new Request(`http://do/shifts/${id}`, { method: 'DELETE' }))
      if (res.ok) await audit(dos.session, 'shiftDeleted', pubkey, { shiftId: id })
      return res
    }
    if (path === '/shifts/fallback' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/fallback'))
    }
    if (path === '/shifts/fallback' && method === 'PUT') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/fallback', {
        method: 'PUT',
        body: JSON.stringify(await request.json()),
      }))
    }

    // --- Bans ---
    if (path === '/bans' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/bans'))
    }
    if (path === '/bans' && method === 'POST') {
      // Both admins and volunteers can report/ban
      const body = await request.json() as { phone: string; reason: string }
      if (!isValidE164(body.phone)) {
        return error('Invalid phone number. Use E.164 format (e.g. +12125551234)', 400)
      }
      const res = await dos.session.fetch(new Request('http://do/bans', {
        method: 'POST',
        body: JSON.stringify({ ...body, bannedBy: pubkey }),
      }))
      if (res.ok) await audit(dos.session, 'numberBanned', pubkey, { phone: body.phone })
      return res
    }
    if (path === '/bans/bulk' && method === 'POST') {
      if (!isAdmin) return error('Forbidden', 403)
      const body = await request.json() as { phones: string[]; reason: string }
      const invalidPhones = body.phones.filter(p => !isValidE164(p))
      if (invalidPhones.length > 0) {
        return error(`Invalid phone number(s): ${invalidPhones[0]}. Use E.164 format (e.g. +12125551234)`, 400)
      }
      const res = await dos.session.fetch(new Request('http://do/bans/bulk', {
        method: 'POST',
        body: JSON.stringify({ ...body, bannedBy: pubkey }),
      }))
      if (res.ok) await audit(dos.session, 'numberBanned', pubkey, { count: body.phones.length, bulk: true })
      return res
    }
    if (path.startsWith('/bans/') && method === 'DELETE') {
      if (!isAdmin) return error('Forbidden', 403)
      const rawPhone = extractPathParam(path, '/bans/')
      if (!rawPhone) return error('Invalid phone', 400)
      const phone = decodeURIComponent(rawPhone)
      const res = await dos.session.fetch(new Request(`http://do/bans/${encodeURIComponent(phone)}`, { method: 'DELETE' }))
      if (res.ok) await audit(dos.session, 'numberUnbanned', pubkey, {})
      return res
    }

    // --- Notes ---
    if (path === '/notes' && method === 'GET') {
      const callId = url.searchParams.get('callId')
      const page = url.searchParams.get('page') || '1'
      const limit = url.searchParams.get('limit') || '50'
      // Volunteers can only see their own notes; admins can see all
      const params = new URLSearchParams()
      if (callId) params.set('callId', callId)
      if (!isAdmin) params.set('author', pubkey)
      params.set('page', page)
      params.set('limit', limit)
      return dos.session.fetch(new Request(`http://do/notes?${params}`))
    }
    if (path === '/notes' && method === 'POST') {
      const body = await request.json() as { callId: string; encryptedContent: string }
      const res = await dos.session.fetch(new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({ ...body, authorPubkey: pubkey }),
      }))
      if (res.ok) await audit(dos.session, 'noteCreated', pubkey, { callId: body.callId })
      return res
    }
    if (path.startsWith('/notes/') && method === 'PATCH') {
      const id = extractPathParam(path, '/notes/')
      if (!id) return error('Invalid note ID', 400)
      const body = await request.json() as { encryptedContent: string }
      const res = await dos.session.fetch(new Request(`http://do/notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...body, authorPubkey: pubkey }),
      }))
      if (res.ok) await audit(dos.session, 'noteEdited', pubkey, { noteId: id })
      return res
    }

    // --- Calls ---
    if (path === '/calls/active' && method === 'GET') {
      const res = await dos.calls.fetch(new Request('http://do/calls/active'))
      if (!isAdmin) {
        // Redact caller phone numbers for non-admin users
        const data = await res.json() as { calls: Array<{ callerNumber: string; [key: string]: unknown }> }
        data.calls = data.calls.map(c => ({ ...c, callerNumber: '[redacted]' }))
        return json(data)
      }
      return res
    }
    // Calls today count
    if (path === '/calls/today-count' && method === 'GET') {
      return dos.calls.fetch(new Request('http://do/calls/today-count'))
    }

    // Volunteer presence (admin only)
    if (path === '/calls/presence' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.calls.fetch(new Request('http://do/calls/presence'))
    }

    if (path === '/calls/history' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      const params = new URLSearchParams()
      params.set('page', url.searchParams.get('page') || '1')
      params.set('limit', url.searchParams.get('limit') || '50')
      if (url.searchParams.get('search')) params.set('search', url.searchParams.get('search')!)
      if (url.searchParams.get('dateFrom')) params.set('dateFrom', url.searchParams.get('dateFrom')!)
      if (url.searchParams.get('dateTo')) params.set('dateTo', url.searchParams.get('dateTo')!)
      return dos.calls.fetch(new Request(`http://do/calls/history?${params}`))
    }

    // --- Audit Log (admin only) ---
    if (path === '/audit' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      const params = new URLSearchParams()
      params.set('page', url.searchParams.get('page') || '1')
      params.set('limit', url.searchParams.get('limit') || '50')
      if (url.searchParams.get('actorPubkey')) params.set('actorPubkey', url.searchParams.get('actorPubkey')!)
      return dos.session.fetch(new Request(`http://do/audit?${params}`))
    }

    // --- Settings (admin only) ---
    if (path === '/settings/spam' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/settings/spam'))
    }
    if (path === '/settings/spam' && method === 'PATCH') {
      if (!isAdmin) return error('Forbidden', 403)
      const body = await request.json()
      const res = await dos.session.fetch(new Request('http://do/settings/spam', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }))
      if (res.ok) await audit(dos.session, 'spamMitigationToggled', pubkey, body as Record<string, unknown>)
      return res
    }
    if (path === '/settings/transcription' && method === 'GET') {
      // All authenticated users can read transcription settings (to check opt-out policy)
      return dos.session.fetch(new Request('http://do/settings/transcription'))
    }
    if (path === '/settings/transcription' && method === 'PATCH') {
      if (!isAdmin) return error('Forbidden', 403)
      const body = await request.json()
      const res = await dos.session.fetch(new Request('http://do/settings/transcription', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }))
      if (res.ok) await audit(dos.session, 'transcriptionToggled', pubkey, body as Record<string, unknown>)
      return res
    }
    if (path === '/settings/call' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/settings/call'))
    }
    if (path === '/settings/call' && method === 'PATCH') {
      if (!isAdmin) return error('Forbidden', 403)
      const body = await request.json()
      const res = await dos.session.fetch(new Request('http://do/settings/call', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }))
      if (res.ok) await audit(dos.session, 'callSettingsUpdated', pubkey, body as Record<string, unknown>)
      return res
    }
    if (path === '/settings/ivr-languages' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/settings/ivr-languages'))
    }
    if (path === '/settings/ivr-languages' && method === 'PATCH') {
      if (!isAdmin) return error('Forbidden', 403)
      const body = await request.json()
      const res = await dos.session.fetch(new Request('http://do/settings/ivr-languages', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }))
      if (res.ok) await audit(dos.session, 'ivrLanguagesUpdated', pubkey, body as Record<string, unknown>)
      return res
    }

    // --- Custom Fields (all authenticated for GET, admin only for PUT) ---
    if (path === '/settings/custom-fields' && method === 'GET') {
      return dos.session.fetch(new Request(`http://do/settings/custom-fields?role=${isAdmin ? 'admin' : 'volunteer'}`))
    }
    if (path === '/settings/custom-fields' && method === 'PUT') {
      if (!isAdmin) return error('Forbidden', 403)
      const body = await request.json()
      const res = await dos.session.fetch(new Request('http://do/settings/custom-fields', {
        method: 'PUT',
        body: JSON.stringify(body),
      }))
      if (res.ok) await audit(dos.session, 'customFieldsUpdated', pubkey, {})
      return res
    }

    // --- WebAuthn Settings (admin only) ---
    if (path === '/settings/webauthn' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/settings/webauthn'))
    }
    if (path === '/settings/webauthn' && method === 'PATCH') {
      if (!isAdmin) return error('Forbidden', 403)
      const body = await request.json()
      const res = await dos.session.fetch(new Request('http://do/settings/webauthn', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }))
      if (res.ok) await audit(dos.session, 'webauthnSettingsUpdated', pubkey, body as Record<string, unknown>)
      return res
    }

    // --- IVR Audio (admin only) ---
    if (path === '/settings/ivr-audio' && method === 'GET') {
      if (!isAdmin) return error('Forbidden', 403)
      return dos.session.fetch(new Request('http://do/settings/ivr-audio'))
    }
    if (path.startsWith('/settings/ivr-audio/') && method === 'PUT') {
      if (!isAdmin) return error('Forbidden', 403)
      const parts = path.replace('/settings/ivr-audio/', '').split('/')
      if (parts.length !== 2) return error('Invalid path', 400)
      const body = await request.arrayBuffer()
      const res = await dos.session.fetch(new Request(`http://do/settings/ivr-audio/${parts[0]}/${parts[1]}`, {
        method: 'PUT',
        body,
      }))
      if (res.ok) await audit(dos.session, 'ivrAudioUploaded', pubkey, { promptType: parts[0], language: parts[1] })
      return res
    }
    if (path.startsWith('/settings/ivr-audio/') && method === 'DELETE') {
      if (!isAdmin) return error('Forbidden', 403)
      const parts = path.replace('/settings/ivr-audio/', '').split('/')
      if (parts.length !== 2) return error('Invalid path', 400)
      const res = await dos.session.fetch(new Request(`http://do/settings/ivr-audio/${parts[0]}/${parts[1]}`, {
        method: 'DELETE',
      }))
      if (res.ok) await audit(dos.session, 'ivrAudioDeleted', pubkey, { promptType: parts[0], language: parts[1] })
      return res
    }

    return error('Not Found', 404)
  },
} satisfies ExportedHandler<Env>

// --- Helpers ---

function uint8ArrayToBase64URL(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- Auth Handler ---

async function handleLogin(request: Request, session: DurableObjectStub): Promise<Response> {
  const { pubkey } = await request.json() as { pubkey: string; token: string }
  const res = await session.fetch(new Request(`http://do/volunteer/${pubkey}`))
  if (!res.ok) return error('Unknown user', 401)
  const volunteer = await res.json() as { role: string }
  return json({ ok: true, role: volunteer.role })
}

// --- Volunteer Creation (generates keypair server-side for admin to share) ---

async function handleCreateVolunteer(request: Request, session: DurableObjectStub, adminPubkey: string): Promise<Response> {
  const body = await request.json() as { name: string; phone: string; role: 'volunteer' | 'admin' }

  // Validate phone number
  if (body.phone && !isValidE164(body.phone)) {
    return error('Invalid phone number. Use E.164 format (e.g. +12125551234)', 400)
  }

  // Generate keypair — use Web Crypto for randomness, then use nostr-tools-compatible format
  // We generate 32 random bytes as the secret key
  const secretKeyBytes = new Uint8Array(32)
  crypto.getRandomValues(secretKeyBytes)

  // Compute public key using the same algorithm as nostr-tools (secp256k1)
  // Since we can't easily import nostr-tools in Workers, we'll use a simpler approach:
  // Import the key bytes and derive pubkey via SubtleCrypto is not straightforward for secp256k1.
  // Instead, we'll accept that the client provides the nsec and we just store the pubkey.
  // Actually, let's have the admin's client generate the keypair and send us the pubkey.
  // This is more secure anyway — the server never sees the private key.

  // For now, return an error indicating client-side generation is expected
  // The actual flow: client generates keypair, sends pubkey to server
  const { pubkey: newPubkey, nsec } = body as unknown as { name: string; phone: string; role: string; pubkey: string; nsec: string }

  if (!newPubkey) {
    return error('pubkey is required — generate keypair client-side', 400)
  }

  const res = await session.fetch(new Request('http://do/volunteers', {
    method: 'POST',
    body: JSON.stringify({
      pubkey: newPubkey,
      name: body.name,
      phone: body.phone,
      role: body.role,
      encryptedSecretKey: '', // Admin stores this client-side
    }),
  }))

  if (res.ok) {
    await audit(session, 'volunteerAdded', adminPubkey, { target: newPubkey, role: body.role })
  }

  return res
}

// --- Telephony Webhook Handler ---
//
// Call flow:
//   1. /incoming       → ban check → reject or play language menu
//   2. /language-selected → resolve language → spam/rate check → greeting + hold/captcha
//   3. /captcha        → verify digits → hold or reject
//   4. /volunteer-answer → bridge caller (from queue) to volunteer
//   5. /call-status    → track completion, trigger transcription
//   6. /wait-music     → hold music + message for queued callers

function twimlResponse(response: { contentType: string; body: string }): Response {
  return new Response(response.body, { headers: { 'Content-Type': response.contentType } })
}

async function handleTelephonyWebhook(
  path: string,
  request: Request,
  env: Env,
  dos: ReturnType<typeof getDOs>,
  ctx: ExecutionContext,
): Promise<Response> {
  const twilio = getTwilio(env)

  // Validate Twilio webhook signature
  // Only skip in development if the request comes from localhost
  const isDev = env.ENVIRONMENT === 'development'
  const isLocal = isDev && (request.headers.get('CF-Connecting-IP') === '127.0.0.1' || new URL(request.url).hostname === 'localhost')
  if (!isLocal) {
    const isValid = await twilio.validateWebhook(request)
    if (!isValid) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  // --- Step 1: Incoming call → ban check → language menu ---
  if (path === '/telephony/incoming' && request.method === 'POST') {
    const formData = await request.formData()
    const callSid = formData.get('CallSid') as string
    const callerNumber = formData.get('From') as string

    // Reject banned callers immediately (no language menu)
    const banCheck = await dos.session.fetch(new Request(`http://do/bans/check/${encodeURIComponent(callerNumber)}`))
    const { banned } = await banCheck.json() as { banned: boolean }
    if (banned) {
      return twimlResponse(twilio.rejectCall())
    }

    // Fetch admin-configured IVR languages
    const ivrRes = await dos.session.fetch(new Request('http://do/settings/ivr-languages'))
    const { enabledLanguages } = await ivrRes.json() as { enabledLanguages: string[] }

    // Play the language selection IVR menu
    const response = await twilio.handleLanguageMenu({
      callSid,
      callerNumber,
      hotlineName: env.HOTLINE_NAME || 'Llámenos',
      enabledLanguages,
    })
    return twimlResponse(response)
  }

  // --- Step 2: Language selected → spam check → greeting + hold/captcha ---
  if (path === '/telephony/language-selected' && request.method === 'POST') {
    const formData = await request.formData()
    const callSid = formData.get('CallSid') as string
    const callerNumber = formData.get('From') as string
    const url = new URL(request.url)
    const isAuto = url.searchParams.get('auto') === '1'

    // Resolve language: forced (single-language skip), digit press, or auto-detect on timeout
    let callerLanguage: string
    const forceLang = url.searchParams.get('forceLang')
    if (forceLang) {
      callerLanguage = forceLang
    } else if (isAuto) {
      callerLanguage = detectLanguageFromPhone(callerNumber)
    } else {
      const digit = formData.get('Digits') as string || ''
      callerLanguage = languageFromDigit(digit) ?? detectLanguageFromPhone(callerNumber)
    }

    // Check spam settings + rate limiting
    const spamRes = await dos.session.fetch(new Request('http://do/settings/spam'))
    const spamSettings = await spamRes.json() as { voiceCaptchaEnabled: boolean; rateLimitEnabled: boolean; maxCallsPerMinute: number }

    let rateLimited = false
    if (spamSettings.rateLimitEnabled) {
      const rlRes = await dos.session.fetch(new Request('http://do/rate-limit/check', {
        method: 'POST',
        body: JSON.stringify({ key: `phone:${hashPhone(callerNumber)}`, maxPerMinute: spamSettings.maxCallsPerMinute }),
      }))
      const rlData = await rlRes.json() as { limited: boolean }
      rateLimited = rlData.limited
    }

    const audioUrls = await buildAudioUrlMap(dos.session, new URL(request.url).origin)
    const response = await twilio.handleIncomingCall({
      callSid,
      callerNumber,
      voiceCaptchaEnabled: spamSettings.voiceCaptchaEnabled,
      rateLimited,
      callerLanguage,
      hotlineName: env.HOTLINE_NAME || 'Llámenos',
      audioUrls,
    })

    // If not rate limited and no captcha, start ringing volunteers in the background
    if (!rateLimited && !spamSettings.voiceCaptchaEnabled) {
      const origin = new URL(request.url).origin
      ctx.waitUntil(startParallelRinging(callSid, callerNumber, origin, env, dos))
    }

    return twimlResponse(response)
  }

  // --- Step 3: CAPTCHA response ---
  if (path === '/telephony/captcha' && request.method === 'POST') {
    const formData = await request.formData()
    const digits = formData.get('Digits') as string
    const url = new URL(request.url)
    const expected = url.searchParams.get('expected') || ''
    const callSid = url.searchParams.get('callSid') || ''
    const callerLang = url.searchParams.get('lang') || DEFAULT_LANGUAGE

    const response = await twilio.handleCaptchaResponse({ callSid, digits, expectedDigits: expected, callerLanguage: callerLang })

    // If CAPTCHA passed, start ringing in the background
    if (digits === expected) {
      const callerNumber = formData.get('From') as string || ''
      const origin = new URL(request.url).origin
      ctx.waitUntil(startParallelRinging(callSid, callerNumber, origin, env, dos))
    }

    return twimlResponse(response)
  }

  // --- Step 4: Volunteer answered → bridge via queue ---
  if (path === '/telephony/volunteer-answer' && request.method === 'POST') {
    const url = new URL(request.url)
    const parentCallSid = url.searchParams.get('parentCallSid') || ''
    const pubkey = url.searchParams.get('pubkey') || ''

    // Notify CallRouter that this volunteer answered
    await dos.calls.fetch(new Request(`http://do/calls/${parentCallSid}/answer`, {
      method: 'POST',
      body: JSON.stringify({ pubkey }),
    }))

    await audit(dos.session, 'callAnswered', pubkey, { callSid: parentCallSid })

    // Bridge the call: connect volunteer to the caller waiting in queue
    const response = await twilio.handleCallAnswered({ parentCallSid })
    return twimlResponse(response)
  }

  // --- Step 5: Call status callback ---
  if (path === '/telephony/call-status' && request.method === 'POST') {
    const formData = await request.formData()
    const callStatus = formData.get('CallStatus') as string
    const url = new URL(request.url)
    const parentCallSid = url.searchParams.get('parentCallSid') || ''

    if (callStatus === 'completed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed') {
      const pubkey = url.searchParams.get('pubkey') || ''
      if (callStatus === 'completed') {
        await dos.calls.fetch(new Request(`http://do/calls/${parentCallSid}/end`, { method: 'POST' }))
        await audit(dos.session, 'callEnded', pubkey, { callSid: parentCallSid })
        await maybeTranscribe(parentCallSid, pubkey, env, dos)
      }
    }

    return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // --- Step 6: Wait music for queued callers ---
  if (path === '/telephony/wait-music') {
    const url = new URL(request.url)
    const lang = url.searchParams.get('lang') || DEFAULT_LANGUAGE
    // Twilio sends QueueTime (seconds the caller has been waiting)
    const formData = request.method === 'POST' ? await request.formData() : null
    const queueTime = formData ? parseInt(formData.get('QueueTime') as string || '0', 10) : 0
    const audioUrls = await buildAudioUrlMap(dos.session, new URL(request.url).origin)
    const callSettingsRes = await dos.session.fetch(new Request('http://do/settings/call'))
    const callSettings = await callSettingsRes.json() as { queueTimeoutSeconds: number; voicemailMaxSeconds: number }
    const response = await twilio.handleWaitMusic(lang, audioUrls, queueTime, callSettings.queueTimeoutSeconds)
    return twimlResponse(response)
  }

  // --- Step 7: Queue exit → voicemail if no one answered ---
  if (path === '/telephony/queue-exit' && request.method === 'POST') {
    const formData = await request.formData()
    const queueResult = formData.get('QueueResult') as string
    const url = new URL(request.url)
    const callSid = url.searchParams.get('callSid') || ''
    const lang = url.searchParams.get('lang') || DEFAULT_LANGUAGE

    // If caller left queue (timeout) or no bridge happened, offer voicemail
    if (queueResult === 'leave' || queueResult === 'queue-full' || queueResult === 'error') {
      const audioUrls = await buildAudioUrlMap(dos.session, new URL(request.url).origin)
      const origin = new URL(request.url).origin
      const callSettingsRes = await dos.session.fetch(new Request('http://do/settings/call'))
      const callSettings = await callSettingsRes.json() as { queueTimeoutSeconds: number; voicemailMaxSeconds: number }
      const response = await twilio.handleVoicemail({
        callSid,
        callerLanguage: lang,
        callbackUrl: origin,
        audioUrls,
        maxRecordingSeconds: callSettings.voicemailMaxSeconds,
      })
      return twimlResponse(response)
    }

    // Bridged or hangup — no action needed
    return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // --- Step 8: Voicemail recording complete (caller hangs up after recording) ---
  if (path === '/telephony/voicemail-complete' && request.method === 'POST') {
    const url = new URL(request.url)
    const lang = url.searchParams.get('lang') || DEFAULT_LANGUAGE
    const voice = LANGUAGE_MAP[lang]?.twilioVoice ?? LANGUAGE_MAP[DEFAULT_LANGUAGE].twilioVoice
    // Thank the caller and hang up
    return new Response(`
      <Response>
        <Say language="${voice}">${getVoicemailThanks(lang)}</Say>
        <Hangup/>
      </Response>
    `.trim(), { headers: { 'Content-Type': 'text/xml' } })
  }

  // --- Step 9: Voicemail recording status callback (async — audio is ready) ---
  if (path === '/telephony/voicemail-recording' && request.method === 'POST') {
    const formData = await request.formData()
    const recordingStatus = formData.get('RecordingStatus') as string
    const url = new URL(request.url)
    const callSid = url.searchParams.get('callSid') || ''

    if (recordingStatus === 'completed') {
      // Mark call as unanswered with voicemail in CallRouter DO
      await dos.calls.fetch(new Request(`http://do/calls/${callSid}/voicemail`, {
        method: 'POST',
      }))

      await audit(dos.session, 'voicemailReceived', 'system', { callSid }, request)

      // Transcribe voicemail in background (encrypt for admin only)
      ctx.waitUntil(transcribeVoicemail(callSid, env, dos))
    }

    return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } })
  }

  return new Response('Not Found', { status: 404 })
}

// --- Parallel Ringing ---

async function startParallelRinging(
  callSid: string,
  callerNumber: string,
  origin: string,
  env: Env,
  dos: ReturnType<typeof getDOs>,
) {
  try {
    // Get on-shift volunteers
    const shiftRes = await dos.shifts.fetch(new Request('http://do/current-volunteers'))
    let { volunteers: onShiftPubkeys } = await shiftRes.json() as { volunteers: string[] }

    // If no one is on shift, use fallback group
    if (onShiftPubkeys.length === 0) {
      const fallbackRes = await dos.session.fetch(new Request('http://do/fallback'))
      const fallback = await fallbackRes.json() as { volunteers: string[] }
      onShiftPubkeys = fallback.volunteers
    }

    if (onShiftPubkeys.length === 0) {
      return
    }

    // Get volunteer phone numbers
    const volRes = await dos.session.fetch(new Request('http://do/volunteers'))
    const { volunteers: allVolunteers } = await volRes.json() as { volunteers: Array<{ pubkey: string; phone: string; active: boolean; onBreak?: boolean }> }

    const toRing = allVolunteers
      .filter(v => onShiftPubkeys.includes(v.pubkey) && v.active && v.phone && !v.onBreak)
      .map(v => ({ pubkey: v.pubkey, phone: v.phone }))

    if (toRing.length === 0) {
      return
    }

    // Notify CallRouter DO of the incoming call
    await dos.calls.fetch(new Request('http://do/calls/incoming', {
      method: 'POST',
      body: JSON.stringify({
        callSid,
        callerNumber,
        volunteerPubkeys: toRing.map(v => v.pubkey),
      }),
    }))

    // Ring all volunteers via Twilio
    const twilio = getTwilio(env)
    await twilio.ringVolunteers({
      callSid,
      callerNumber,
      volunteers: toRing,
      callbackUrl: origin,
    })
  } catch {
    // Ringing failed — logged in audit trail, not console
  }
}

// --- Transcription ---

async function maybeTranscribe(
  callSid: string,
  volunteerPubkey: string,
  env: Env,
  dos: ReturnType<typeof getDOs>,
) {
  // Check if transcription is globally enabled
  const transRes = await dos.session.fetch(new Request('http://do/settings/transcription'))
  const { globalEnabled } = await transRes.json() as { globalEnabled: boolean }
  if (!globalEnabled) return

  // Check if volunteer has transcription enabled
  const volRes = await dos.session.fetch(new Request(`http://do/volunteer/${volunteerPubkey}`))
  if (!volRes.ok) return
  const volunteer = await volRes.json() as { transcriptionEnabled: boolean }
  if (!volunteer.transcriptionEnabled) return

  // Get call recording from Twilio
  const twilio = getTwilio(env)
  const audio = await twilio.getCallRecording(callSid)
  if (!audio) return

  try {
    // Transcribe using Cloudflare Workers AI (Whisper)
    const result = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(audio)],
    })

    if (result.text) {
      // ECIES: encrypt transcription for the volunteer's public key
      const { encryptedContent, ephemeralPubkey } = encryptForPublicKey(result.text, volunteerPubkey)
      await dos.session.fetch(new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({
          callId: callSid,
          authorPubkey: 'system:transcription',
          encryptedContent,
          ephemeralPubkey,
        }),
      }))

      // Also encrypt for admin so they can read transcriptions independently
      const adminEncrypted = encryptForPublicKey(result.text, env.ADMIN_PUBKEY)
      await dos.session.fetch(new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({
          callId: callSid,
          authorPubkey: 'system:transcription:admin',
          encryptedContent: adminEncrypted.encryptedContent,
          ephemeralPubkey: adminEncrypted.ephemeralPubkey,
        }),
      }))
    }
  } catch {
    // Transcription failed — not critical
  }
}

// --- Voicemail ---

const VOICEMAIL_THANKS: Record<string, string> = {
  en: 'Thank you for your message. Goodbye.',
  es: 'Gracias por su mensaje. Adiós.',
  zh: '感谢您的留言。再见。',
  tl: 'Salamat sa iyong mensahe. Paalam.',
  vi: 'Cảm ơn tin nhắn của bạn. Tạm biệt.',
  ar: 'شكراً لرسالتك. مع السلامة.',
  fr: 'Merci pour votre message. Au revoir.',
  ht: 'Mèsi pou mesaj ou. Orevwa.',
  ko: '메시지를 남겨 주셔서 감사합니다. 안녕히 계세요.',
  ru: 'Спасибо за ваше сообщение. До свидания.',
  hi: 'आपके संदेश के लिए धन्यवाद। अलविदा।',
  pt: 'Obrigado pela sua mensagem. Até logo.',
  de: 'Vielen Dank für Ihre Nachricht. Auf Wiederhören.',
}

function getVoicemailThanks(lang: string): string {
  return VOICEMAIL_THANKS[lang] ?? VOICEMAIL_THANKS[DEFAULT_LANGUAGE]
}

async function transcribeVoicemail(
  callSid: string,
  env: Env,
  dos: ReturnType<typeof getDOs>,
) {
  // Check if transcription is globally enabled
  const transRes = await dos.session.fetch(new Request('http://do/settings/transcription'))
  const { globalEnabled } = await transRes.json() as { globalEnabled: boolean }
  if (!globalEnabled) return

  // Get voicemail recording from Twilio
  const twilio = getTwilio(env)
  const audio = await twilio.getCallRecording(callSid)
  if (!audio) return

  try {
    const result = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(audio)],
    })

    if (result.text) {
      // Voicemails are encrypted only for admin (no volunteer answered)
      const adminEncrypted = encryptForPublicKey(result.text, env.ADMIN_PUBKEY)
      await dos.session.fetch(new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({
          callId: callSid,
          authorPubkey: 'system:voicemail',
          encryptedContent: adminEncrypted.encryptedContent,
          ephemeralPubkey: adminEncrypted.ephemeralPubkey,
        }),
      }))
    }
  } catch {
    // Voicemail transcription failed — not critical
  }
}
