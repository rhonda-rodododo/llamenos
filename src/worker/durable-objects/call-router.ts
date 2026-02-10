import { DurableObject } from 'cloudflare:workers'
import type { Env, CallRecord } from '../types'
import { hashPhone } from '../lib/crypto'

/**
 * CallRouterDO — manages real-time call state and WebSocket connections.
 * Uses the Hibernation API: connections survive DO hibernation via
 * ctx.getWebSockets() instead of an in-memory Map.
 *
 * Handles:
 * - WebSocket connections from volunteers
 * - Active call tracking
 * - Parallel ringing coordination
 * - Call history
 */
export class CallRouterDO extends DurableObject<Env> {

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // WebSocket upgrade
    if (path === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request)
    }

    // Active calls
    if (path === '/calls/active' && method === 'GET') {
      return this.getActiveCalls()
    }

    // Volunteer presence (admin only — caller must verify admin status)
    if (path === '/calls/presence' && method === 'GET') {
      return this.getVolunteerPresence()
    }

    // Calls today count
    if (path === '/calls/today-count' && method === 'GET') {
      return this.getCallsTodayCount()
    }

    // Call history
    if (path === '/calls/history' && method === 'GET') {
      const page = parseInt(url.searchParams.get('page') || '1')
      const limit = parseInt(url.searchParams.get('limit') || '50')
      const search = url.searchParams.get('search') || undefined
      const dateFrom = url.searchParams.get('dateFrom') || undefined
      const dateTo = url.searchParams.get('dateTo') || undefined
      return this.getCallHistory(page, limit, { search, dateFrom, dateTo })
    }

    // Incoming call (from telephony webhook)
    if (path === '/calls/incoming' && method === 'POST') {
      return this.handleIncomingCall(await request.json())
    }

    // Call answered
    if (path.startsWith('/calls/') && path.endsWith('/answer') && method === 'POST') {
      const callId = path.split('/calls/')[1].split('/answer')[0]
      return this.handleCallAnswered(callId, await request.json())
    }

    // Call ended
    if (path.startsWith('/calls/') && path.endsWith('/end') && method === 'POST') {
      const callId = path.split('/calls/')[1].split('/end')[0]
      return this.handleCallEnded(callId)
    }

    // Voicemail left (unanswered call with recording)
    if (path.startsWith('/calls/') && path.endsWith('/voicemail') && method === 'POST') {
      const callId = path.split('/calls/')[1].split('/voicemail')[0]
      return this.handleVoicemailLeft(callId)
    }

    // Update call metadata (e.g. hasTranscription)
    if (path.startsWith('/calls/') && path.endsWith('/metadata') && method === 'PATCH') {
      const callId = path.split('/calls/')[1].split('/metadata')[0]
      return this.handleUpdateMetadata(callId, await request.json())
    }

    // Report spam
    if (path.startsWith('/calls/') && path.endsWith('/spam') && method === 'POST') {
      const callId = path.split('/calls/')[1].split('/spam')[0]
      return this.handleReportSpam(callId, await request.json())
    }

    // --- Test Reset (development only) ---
    if (path === '/reset' && method === 'POST') {
      // Close all WebSocket connections
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.close() } catch {}
      }
      await this.ctx.storage.deleteAll()
      return Response.json({ ok: true })
    }

    return new Response('Not Found', { status: 404 })
  }

  private handleWebSocket(request: Request): Response {
    const url = new URL(request.url)
    const pubkey = url.searchParams.get('pubkey')
    if (!pubkey) return new Response('Missing pubkey', { status: 400 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.ctx.acceptWebSocket(server, [pubkey])

    // Notify about current active calls (redact caller numbers)
    this.getActiveCallsList().then(calls => {
      if (server.readyState === WebSocket.OPEN) {
        const redacted = calls.map((c: CallRecord) => ({ ...c, callerNumber: '[redacted]' }))
        server.send(JSON.stringify({ type: 'calls:sync', calls: redacted }))
      }
    })

    // Broadcast presence update to all (new volunteer came online)
    this.broadcastPresenceUpdate()

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': 'llamenos-auth' },
    })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const msg = JSON.parse(message as string)

      const tags = this.ctx.getTags(ws)
      const pubkey = tags[0]
      if (!pubkey) return

      // Volunteer answers a call via WebSocket
      if (msg.type === 'call:answer' && msg.callId) {
        await this.handleCallAnswered(msg.callId, { pubkey })
      }

      // Volunteer hangs up via WebSocket
      if (msg.type === 'call:hangup' && msg.callId) {
        await this.handleCallEnded(msg.callId)
      }

      // Volunteer reports spam via WebSocket
      if (msg.type === 'call:reportSpam' && msg.callId) {
        const result = await this.handleReportSpam(msg.callId, { pubkey })
        // Send back the caller number so the UI can confirm
        if (ws.readyState === WebSocket.OPEN) {
          const data = await result.json() as Record<string, unknown>
          ws.send(JSON.stringify({ type: 'spam:reported', ...data }))
        }
      }
    } catch {
      // ignore malformed messages
    }
  }

  async webSocketClose(_ws: WebSocket): Promise<void> {
    this.broadcastPresenceUpdate()
  }

  async webSocketError(_ws: WebSocket): Promise<void> {
    this.broadcastPresenceUpdate()
  }

  // --- Helpers ---

  /** Get the set of pubkeys currently on an active call */
  private async getOnCallPubkeys(): Promise<Set<string>> {
    const calls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    return new Set(
      calls
        .filter(c => c.answeredBy && c.status === 'in-progress')
        .map(c => c.answeredBy!)
    )
  }

  // --- Call Handling ---

  private async handleIncomingCall(data: {
    callSid: string
    callerNumber: string
    volunteerPubkeys: string[]
  }): Promise<Response> {
    const call: CallRecord = {
      id: data.callSid,
      callerNumber: hashPhone(data.callerNumber),
      answeredBy: null,
      startedAt: new Date().toISOString(),
      status: 'ringing',
      hasTranscription: false,
      hasVoicemail: false,
    }

    // Store active call
    const activeCalls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    activeCalls.push(call)
    await this.ctx.storage.put('activeCalls', activeCalls)

    // Notify all on-shift, available volunteers via WebSocket
    // Redact caller number — volunteers should not see caller phone numbers
    this.broadcast(data.volunteerPubkeys, {
      type: 'call:incoming',
      ...call,
      callerNumber: '[redacted]',
    })

    return Response.json({ call })
  }

  private async handleCallAnswered(callId: string, data: { pubkey: string }): Promise<Response> {
    const activeCalls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    const call = activeCalls.find(c => c.id === callId)
    if (!call) return new Response('Call not found', { status: 404 })

    call.answeredBy = data.pubkey
    call.status = 'in-progress'
    await this.ctx.storage.put('activeCalls', activeCalls)

    // Notify all volunteers that the call was answered (stop ringing for others)
    // Redact caller number in broadcasts
    this.broadcastAll({
      type: 'call:update',
      ...call,
      callerNumber: '[redacted]',
    })
    this.broadcastPresenceUpdate()

    return Response.json({ call })
  }

  private async handleCallEnded(callId: string): Promise<Response> {
    const activeCalls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    const callIdx = activeCalls.findIndex(c => c.id === callId)
    if (callIdx === -1) return new Response('Call not found', { status: 404 })

    const call = activeCalls[callIdx]
    call.status = 'completed'
    call.endedAt = new Date().toISOString()
    call.duration = Math.floor(
      (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
    )

    // Move to history
    activeCalls.splice(callIdx, 1)
    await this.ctx.storage.put('activeCalls', activeCalls)

    const history = await this.ctx.storage.get<CallRecord[]>('callHistory') || []
    history.unshift(call)
    // Keep last 10000 records
    if (history.length > 10000) history.length = 10000
    await this.ctx.storage.put('callHistory', history)

    // Notify all — redact caller number
    this.broadcastAll({
      type: 'call:update',
      ...call,
      callerNumber: '[redacted]',
    })
    this.broadcastPresenceUpdate()

    return Response.json({ call })
  }

  private async handleVoicemailLeft(callId: string): Promise<Response> {
    // Move from active calls to history as 'unanswered' with voicemail
    const activeCalls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    const callIdx = activeCalls.findIndex(c => c.id === callId)

    let call: CallRecord
    if (callIdx !== -1) {
      call = activeCalls[callIdx]
      call.status = 'unanswered'
      call.hasVoicemail = true
      call.endedAt = new Date().toISOString()
      call.duration = Math.floor(
        (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
      )
      activeCalls.splice(callIdx, 1)
      await this.ctx.storage.put('activeCalls', activeCalls)
    } else {
      // Call wasn't tracked (edge case) — create a record
      call = {
        id: callId,
        callerNumber: '[unknown]',
        answeredBy: null,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        duration: 0,
        status: 'unanswered',
        hasTranscription: false,
        hasVoicemail: true,
      }
    }

    // Store in history
    const history = await this.ctx.storage.get<CallRecord[]>('callHistory') || []
    history.unshift(call)
    if (history.length > 10000) history.length = 10000
    await this.ctx.storage.put('callHistory', history)

    // Notify all connected users about the voicemail
    this.broadcastAll({
      type: 'voicemail:new',
      callId: call.id,
      startedAt: call.startedAt,
      callerNumber: '[redacted]',
    })

    return Response.json({ call })
  }

  private async handleUpdateMetadata(callId: string, data: Record<string, unknown>): Promise<Response> {
    // Search active calls first, then history
    const activeCalls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    let call = activeCalls.find(c => c.id === callId)
    let source: 'active' | 'history' | null = call ? 'active' : null

    let history: CallRecord[] = []
    if (!call) {
      history = await this.ctx.storage.get<CallRecord[]>('callHistory') || []
      call = history.find(c => c.id === callId)
      source = call ? 'history' : null
    }

    if (!call || !source) {
      return new Response('Call not found', { status: 404 })
    }

    // Apply allowed metadata fields
    if (data.hasTranscription !== undefined) call.hasTranscription = Boolean(data.hasTranscription)
    if (data.hasVoicemail !== undefined) call.hasVoicemail = Boolean(data.hasVoicemail)

    if (source === 'active') {
      await this.ctx.storage.put('activeCalls', activeCalls)
    } else {
      await this.ctx.storage.put('callHistory', history)
    }

    return Response.json({ call })
  }

  private async handleReportSpam(callId: string, data: { pubkey: string }): Promise<Response> {
    const activeCalls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    const call = activeCalls.find(c => c.id === callId)
    // Return the caller number so the API can add it to the ban list
    return Response.json({
      callId,
      callerNumber: call?.callerNumber || null,
      reportedBy: data.pubkey,
    })
  }

  // --- Query Methods ---

  private async getActiveCalls(): Promise<Response> {
    const calls = await this.getActiveCallsList()
    return Response.json({ calls })
  }

  private async getActiveCallsList(): Promise<CallRecord[]> {
    const calls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    const now = Date.now()
    // Ringing calls older than 5 minutes are stale (Twilio queues timeout well before this)
    // In-progress calls older than 8 hours are stale (no call should last that long)
    const RINGING_TTL = 5 * 60 * 1000
    const IN_PROGRESS_TTL = 8 * 60 * 60 * 1000

    const active = calls.filter(c => {
      const age = now - new Date(c.startedAt).getTime()
      if (c.status === 'ringing' && age > RINGING_TTL) return false
      if (c.status === 'in-progress' && age > IN_PROGRESS_TTL) return false
      return true
    })

    // Persist cleanup if stale calls were removed
    if (active.length < calls.length) {
      await this.ctx.storage.put('activeCalls', active)
    }

    return active
  }

  private async getCallHistory(
    page: number,
    limit: number,
    filters?: { search?: string; dateFrom?: string; dateTo?: string },
  ): Promise<Response> {
    let history = await this.ctx.storage.get<CallRecord[]>('callHistory') || []

    if (filters?.search) {
      const q = filters.search.toLowerCase()
      history = history.filter(c =>
        c.callerNumber.toLowerCase().includes(q) ||
        (c.answeredBy && c.answeredBy.toLowerCase().includes(q))
      )
    }
    if (filters?.dateFrom) {
      const from = new Date(filters.dateFrom).getTime()
      history = history.filter(c => new Date(c.startedAt).getTime() >= from)
    }
    if (filters?.dateTo) {
      const to = new Date(filters.dateTo).getTime() + 86_400_000 // end of day
      history = history.filter(c => new Date(c.startedAt).getTime() <= to)
    }

    const start = (page - 1) * limit
    return Response.json({
      calls: history.slice(start, start + limit),
      total: history.length,
    })
  }

  // --- Presence & Metrics ---

  private async getVolunteerPresence(): Promise<Response> {
    const onCallPubkeys = await this.getOnCallPubkeys()
    const sockets = this.ctx.getWebSockets()
    const seen = new Set<string>()
    const statuses: Array<{ pubkey: string; status: 'available' | 'on-call' | 'online' }> = []

    for (const ws of sockets) {
      const tags = this.ctx.getTags(ws)
      const pubkey = tags[0]
      if (!pubkey || seen.has(pubkey)) continue
      seen.add(pubkey)
      statuses.push({
        pubkey,
        status: onCallPubkeys.has(pubkey) ? 'on-call' : 'available',
      })
    }
    return Response.json({ volunteers: statuses })
  }

  private async getCallsTodayCount(): Promise<Response> {
    const history = await this.ctx.storage.get<CallRecord[]>('callHistory') || []
    const activeCalls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const todayMs = todayStart.getTime()

    const historyToday = history.filter(c => new Date(c.startedAt).getTime() >= todayMs).length
    const activeToday = activeCalls.filter(c => new Date(c.startedAt).getTime() >= todayMs).length
    return Response.json({ count: historyToday + activeToday })
  }

  // --- Broadcasting ---

  private async broadcast(pubkeys: string[], message: Record<string, unknown>) {
    const data = JSON.stringify(message)
    const onCallPubkeys = await this.getOnCallPubkeys()
    for (const pubkey of pubkeys) {
      // Don't send incoming call notifications to volunteers already on a call
      if (onCallPubkeys.has(pubkey)) continue
      for (const ws of this.ctx.getWebSockets(pubkey)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      }
    }
  }

  private broadcastAll(message: Record<string, unknown>) {
    const data = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    }
  }

  private async broadcastPresenceUpdate() {
    const onCallPubkeys = await this.getOnCallPubkeys()
    const sockets = this.ctx.getWebSockets()
    const seen = new Set<string>()
    let available = 0
    let onCall = 0

    for (const ws of sockets) {
      const tags = this.ctx.getTags(ws)
      const pubkey = tags[0]
      if (!pubkey || seen.has(pubkey)) continue
      seen.add(pubkey)
      if (onCallPubkeys.has(pubkey)) onCall++
      else available++
    }

    this.broadcastAll({
      type: 'presence:update',
      counts: { available, onCall, total: seen.size },
    })
  }
}
