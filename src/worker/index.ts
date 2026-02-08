import type { Env } from './types'
import { authenticateRequest } from './lib/auth'
import { TwilioAdapter, getPrompt } from './telephony/twilio'
import { detectLanguageFromPhone, LANGUAGE_MAP, DEFAULT_LANGUAGE } from '../shared/languages'
import { encryptForPublicKey } from './lib/crypto'

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

async function audit(session: DurableObjectStub, event: string, actorPubkey: string, details: Record<string, unknown> = {}) {
  await session.fetch(new Request('http://do/audit', {
    method: 'POST',
    body: JSON.stringify({ event, actorPubkey, details }),
  }))
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';",
}

function addSecurityHeaders(response: Response): Response {
  const newHeaders = new Headers(response.headers)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    newHeaders.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Only handle /api/* routes — everything else goes to static assets
    if (!url.pathname.startsWith('/api/')) {
      const assetResponse = await env.ASSETS.fetch(request)
      return addSecurityHeaders(assetResponse)
    }

    const path = url.pathname.slice(4) // Remove /api prefix
    const method = request.method
    const dos = getDOs(env)

    // --- CORS headers (same-origin in production, permissive in dev for Vite proxy) ---
    const allowedOrigin = env.ENVIRONMENT === 'development' ? 'http://localhost:5173' : url.origin
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
      return json({ hotlineName: env.HOTLINE_NAME || 'Hotline' })
    }

    // --- Telephony Webhooks (no auth — validated by Twilio signature) ---
    if (path.startsWith('/telephony/')) {
      return handleTelephonyWebhook(path, request, env, dos)
    }

    // --- Test Reset (development only) ---
    if (path === '/test-reset' && method === 'POST' && env.ENVIRONMENT === 'development') {
      await dos.session.fetch(new Request('http://do/reset', { method: 'POST' }))
      await dos.shifts.fetch(new Request('http://do/reset', { method: 'POST' }))
      await dos.calls.fetch(new Request('http://do/reset', { method: 'POST' }))
      rateLimitMap.clear()
      return json({ ok: true })
    }

    // --- Auth Routes ---
    if (path === '/auth/login' && method === 'POST') {
      // Rate limit login attempts by IP (skip in development for testing)
      if (env.ENVIRONMENT !== 'development') {
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown'
        if (checkRateLimit(null as never, `auth:${clientIp}`, 10)) {
          return error('Too many login attempts. Try again later.', 429)
        }
      }
      return handleLogin(request, dos.session)
    }

    // --- WebSocket (auth via query param) ---
    if (path === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      const authParam = url.searchParams.get('auth')
      if (!authParam) return error('Unauthorized', 401)
      let auth: { pubkey: string; timestamp: number; token: string }
      try {
        auth = JSON.parse(decodeURIComponent(authParam))
      } catch {
        return error('Invalid auth', 401)
      }
      const { verifyAuthToken } = await import('./lib/auth')
      if (!(await verifyAuthToken(auth))) return error('Unauthorized', 401)
      const volRes = await dos.session.fetch(new Request(`http://do/volunteer/${auth.pubkey}`))
      if (!volRes.ok) return error('Unknown user', 401)
      // Forward to CallRouter DO with pubkey
      const wsUrl = new URL(request.url)
      wsUrl.pathname = '/ws'
      wsUrl.searchParams.set('pubkey', auth.pubkey)
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
      return json({
        pubkey: volunteer.pubkey,
        role: volunteer.role,
        name: volunteer.name,
        transcriptionEnabled: volunteer.transcriptionEnabled,
        spokenLanguages: volunteer.spokenLanguages || ['en'],
        uiLanguage: volunteer.uiLanguage || 'en',
        profileCompleted: volunteer.profileCompleted ?? true,
        onBreak: volunteer.onBreak ?? false,
      })
    }
    if (path === '/auth/me/profile' && method === 'PATCH') {
      const body = await request.json() as { spokenLanguages?: string[]; uiLanguage?: string; profileCompleted?: boolean }
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
      await dos.session.fetch(new Request(`http://do/volunteers/${pubkey}`, {
        method: 'PATCH',
        body: JSON.stringify({ transcriptionEnabled: body.enabled }),
      }))
      await audit(dos.session, 'transcriptionToggled', pubkey, { enabled: body.enabled })
      return json({ ok: true })
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
      if (res.ok) await audit(dos.session, 'numberUnbanned', pubkey, { phone })
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
      const page = url.searchParams.get('page') || '1'
      const limit = url.searchParams.get('limit') || '50'
      return dos.session.fetch(new Request(`http://do/audit?page=${page}&limit=${limit}`))
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
      if (!isAdmin) return error('Forbidden', 403)
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

    return error('Not Found', 404)
  },
} satisfies ExportedHandler<Env>

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

async function handleTelephonyWebhook(
  path: string,
  request: Request,
  env: Env,
  dos: ReturnType<typeof getDOs>,
): Promise<Response> {
  const twilio = getTwilio(env)

  // Validate Twilio webhook signature (skip in development for testing)
  if (env.ENVIRONMENT !== 'development') {
    const isValid = await twilio.validateWebhook(request)
    if (!isValid) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  // Incoming call from Twilio
  if (path === '/telephony/incoming' && request.method === 'POST') {
    const formData = await request.formData()
    const callSid = formData.get('CallSid') as string
    const callerNumber = formData.get('From') as string

    // Check ban list
    const banCheck = await dos.session.fetch(new Request(`http://do/bans/check/${encodeURIComponent(callerNumber)}`))
    const { banned } = await banCheck.json() as { banned: boolean }

    // Check spam settings
    const spamRes = await dos.session.fetch(new Request('http://do/settings/spam'))
    const spamSettings = await spamRes.json() as { voiceCaptchaEnabled: boolean; rateLimitEnabled: boolean; maxCallsPerMinute: number }

    // Rate limiting check (simplified — uses DO storage)
    let rateLimited = false
    if (spamSettings.rateLimitEnabled) {
      rateLimited = checkRateLimit(dos.session, callerNumber, spamSettings.maxCallsPerMinute)
    }

    const callerLanguage = detectLanguageFromPhone(callerNumber)

    const response = await twilio.handleIncomingCall({
      callSid,
      callerNumber,
      isBanned: banned,
      voiceCaptchaEnabled: spamSettings.voiceCaptchaEnabled,
      rateLimited,
      callerLanguage,
      hotlineName: env.HOTLINE_NAME || 'Llámenos',
    })

    // If not banned and not rate limited, start ringing volunteers
    if (!banned && !rateLimited && !spamSettings.voiceCaptchaEnabled) {
      await startParallelRinging(callSid, callerNumber, env, dos)
    }

    return new Response(response.body, {
      headers: { 'Content-Type': response.contentType },
    })
  }

  // CAPTCHA response
  if (path === '/telephony/captcha' && request.method === 'POST') {
    const formData = await request.formData()
    const digits = formData.get('Digits') as string
    const url = new URL(request.url)
    const expected = url.searchParams.get('expected') || ''
    const callSid = url.searchParams.get('callSid') || ''
    const callerLang = url.searchParams.get('lang') || DEFAULT_LANGUAGE

    const response = await twilio.handleCaptchaResponse({ callSid, digits, expectedDigits: expected, callerLanguage: callerLang })

    // If CAPTCHA passed, start ringing
    if (digits === expected) {
      const callerNumber = formData.get('From') as string || ''
      await startParallelRinging(callSid, callerNumber, env, dos)
    }

    return new Response(response.body, {
      headers: { 'Content-Type': response.contentType },
    })
  }

  // Volunteer answered the outbound leg
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

    // Connect the call
    return new Response(`
      <Response>
        <Dial>
          <Queue>${parentCallSid}</Queue>
        </Dial>
      </Response>
    `.trim(), { headers: { 'Content-Type': 'text/xml' } })
  }

  // Call status callback
  if (path === '/telephony/call-status' && request.method === 'POST') {
    const formData = await request.formData()
    const callStatus = formData.get('CallStatus') as string
    const url = new URL(request.url)
    const parentCallSid = url.searchParams.get('parentCallSid') || ''

    if (callStatus === 'completed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed') {
      // Check if this was the active call ending
      const pubkey = url.searchParams.get('pubkey') || ''
      if (callStatus === 'completed') {
        await dos.calls.fetch(new Request(`http://do/calls/${parentCallSid}/end`, { method: 'POST' }))
        await audit(dos.session, 'callEnded', pubkey, { callSid: parentCallSid })

        // Trigger transcription if enabled
        await maybeTranscribe(parentCallSid, pubkey, env, dos)
      }
    }

    return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // Wait music for callers in queue
  if (path === '/telephony/wait-music') {
    const url = new URL(request.url)
    const lang = url.searchParams.get('lang') || DEFAULT_LANGUAGE
    const tLang = LANGUAGE_MAP[lang]?.twilioVoice ?? LANGUAGE_MAP[DEFAULT_LANGUAGE].twilioVoice
    const waitMsg = getPrompt('waitMessage', lang)
    return new Response(`
      <Response>
        <Say language="${tLang}">${waitMsg}</Say>
        <Play>http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-B4Da.mp3</Play>
      </Response>
    `.trim(), { headers: { 'Content-Type': 'text/xml' } })
  }

  return new Response('Not Found', { status: 404 })
}

// --- Parallel Ringing ---

async function startParallelRinging(
  callSid: string,
  callerNumber: string,
  env: Env,
  dos: ReturnType<typeof getDOs>,
) {
  // Get on-shift volunteers
  const shiftRes = await dos.shifts.fetch(new Request('http://do/current-volunteers'))
  let { volunteers: onShiftPubkeys } = await shiftRes.json() as { volunteers: string[] }

  // If no one is on shift, use fallback group
  if (onShiftPubkeys.length === 0) {
    const fallbackRes = await dos.session.fetch(new Request('http://do/fallback'))
    const fallback = await fallbackRes.json() as { volunteers: string[] }
    onShiftPubkeys = fallback.volunteers
  }

  if (onShiftPubkeys.length === 0) return

  // Get volunteer phone numbers
  const volRes = await dos.session.fetch(new Request('http://do/volunteers'))
  const { volunteers: allVolunteers } = await volRes.json() as { volunteers: Array<{ pubkey: string; phone: string; active: boolean; onBreak?: boolean }> }

  const toRing = allVolunteers
    .filter(v => onShiftPubkeys.includes(v.pubkey) && v.active && v.phone && !v.onBreak)
    .map(v => ({ pubkey: v.pubkey, phone: v.phone }))

  if (toRing.length === 0) return

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
  const baseUrl = env.ENVIRONMENT === 'development'
    ? 'https://localhost:8787' // Will need a tunnel in dev
    : `https://llamenos.${env.TWILIO_ACCOUNT_SID}.workers.dev` // Will be replaced with actual domain
  await twilio.ringVolunteers({
    callSid,
    callerNumber,
    volunteers: toRing,
    callbackUrl: baseUrl,
  })
}

// --- Rate Limiting ---

// Simple sliding-window rate limiter using in-memory Map (resets on worker restart).
// Fine for a single-instance Worker + DO architecture.
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(_session: DurableObjectStub | null, phone: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const windowMs = 60_000
  const timestamps = rateLimitMap.get(phone) || []

  // Remove timestamps outside the window
  const recent = timestamps.filter(t => now - t < windowMs)
  recent.push(now)
  rateLimitMap.set(phone, recent)

  // Clean up old entries periodically (keep map from growing unbounded)
  if (rateLimitMap.size > 10000) {
    for (const [key, val] of rateLimitMap) {
      if (val.every(t => now - t > windowMs)) {
        rateLimitMap.delete(key)
      }
    }
  }

  return recent.length > maxPerMinute
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
    // Transcription failed — not critical, just log
    console.error('Transcription failed for call', callSid)
  }
}
