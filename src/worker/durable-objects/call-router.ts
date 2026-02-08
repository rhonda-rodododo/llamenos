import { DurableObject } from 'cloudflare:workers'
import type { Env, CallRecord } from '../types'

interface ConnectedVolunteer {
  pubkey: string
  ws: WebSocket
  onCall: boolean
}

/**
 * CallRouterDO — manages real-time call state and WebSocket connections.
 * Handles:
 * - WebSocket connections from volunteers
 * - Active call tracking
 * - Parallel ringing coordination
 * - Call history
 */
export class CallRouterDO extends DurableObject<Env> {
  private connections: Map<string, ConnectedVolunteer> = new Map()

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

    // Call history
    if (path === '/calls/history' && method === 'GET') {
      const page = parseInt(url.searchParams.get('page') || '1')
      const limit = parseInt(url.searchParams.get('limit') || '50')
      return this.getCallHistory(page, limit)
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

    // Report spam
    if (path.startsWith('/calls/') && path.endsWith('/spam') && method === 'POST') {
      const callId = path.split('/calls/')[1].split('/spam')[0]
      return this.handleReportSpam(callId, await request.json())
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

    this.connections.set(pubkey, {
      pubkey,
      ws: server,
      onCall: false,
    })

    // Notify about current active calls
    this.getActiveCallsList().then(calls => {
      if (server.readyState === WebSocket.OPEN) {
        server.send(JSON.stringify({ type: 'calls:sync', calls }))
      }
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const msg = JSON.parse(message as string)

      if (msg.type === 'status:update') {
        const tags = this.ctx.getTags(ws)
        const pubkey = tags[0]
        if (pubkey) {
          const conn = this.connections.get(pubkey)
          if (conn) {
            conn.onCall = msg.onCall ?? conn.onCall
          }
        }
      }
    } catch {
      // ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const tags = this.ctx.getTags(ws)
    const pubkey = tags[0]
    if (pubkey) {
      this.connections.delete(pubkey)
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const tags = this.ctx.getTags(ws)
    const pubkey = tags[0]
    if (pubkey) {
      this.connections.delete(pubkey)
    }
  }

  // --- Call Handling ---

  private async handleIncomingCall(data: {
    callSid: string
    callerNumber: string
    volunteerPubkeys: string[]
  }): Promise<Response> {
    const call: CallRecord = {
      id: data.callSid,
      callerNumber: data.callerNumber,
      answeredBy: null,
      startedAt: new Date().toISOString(),
      status: 'ringing',
      hasTranscription: false,
    }

    // Store active call
    const activeCalls = await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
    activeCalls.push(call)
    await this.ctx.storage.put('activeCalls', activeCalls)

    // Notify all on-shift, available volunteers via WebSocket
    this.broadcast(data.volunteerPubkeys, {
      type: 'call:incoming',
      ...call,
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

    // Mark volunteer as on-call
    const conn = this.connections.get(data.pubkey)
    if (conn) conn.onCall = true

    // Notify all volunteers that the call was answered (stop ringing for others)
    this.broadcastAll({
      type: 'call:update',
      ...call,
    })

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

    // Mark volunteer as available
    if (call.answeredBy) {
      const conn = this.connections.get(call.answeredBy)
      if (conn) conn.onCall = false
    }

    // Notify all
    this.broadcastAll({
      type: 'call:update',
      ...call,
    })

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
    return await this.ctx.storage.get<CallRecord[]>('activeCalls') || []
  }

  private async getCallHistory(page: number, limit: number): Promise<Response> {
    const history = await this.ctx.storage.get<CallRecord[]>('callHistory') || []
    const start = (page - 1) * limit
    return Response.json({
      calls: history.slice(start, start + limit),
      total: history.length,
    })
  }

  // --- Broadcasting ---

  private broadcast(pubkeys: string[], message: Record<string, unknown>) {
    const data = JSON.stringify(message)
    for (const pubkey of pubkeys) {
      const conn = this.connections.get(pubkey)
      if (conn?.ws.readyState === WebSocket.OPEN && !conn.onCall) {
        conn.ws.send(data)
      }
    }
  }

  private broadcastAll(message: Record<string, unknown>) {
    const data = JSON.stringify(message)
    for (const conn of this.connections.values()) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(data)
      }
    }
  }
}
