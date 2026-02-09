import { getStoredSession, keyPairFromNsec, createAuthToken } from './crypto'

type MessageHandler = (data: unknown) => void

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
const MAX_RECONNECT_DELAY = 30_000 // 30 seconds
const BASE_RECONNECT_DELAY = 1_000 // 1 second
const handlers = new Map<string, Set<MessageHandler>>()

function getReconnectDelay(): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY)
  return delay + Math.random() * 500 // Add jitter
}

export function connectWebSocket() {
  if (socket?.readyState === WebSocket.OPEN) return

  const nsec = getStoredSession()
  if (!nsec) return

  const keyPair = keyPairFromNsec(nsec)
  if (!keyPair) return

  const token = createAuthToken(keyPair.secretKey, Date.now())
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/api/ws`

  // Pass auth via Sec-WebSocket-Protocol header (not URL params which get logged)
  // Use base64url encoding (no padding, URL-safe chars) — valid as HTTP token / subprotocol
  const authB64 = btoa(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  socket = new WebSocket(url, ['llamenos-auth', authB64])

  socket.onopen = () => {
    reconnectAttempts = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      const { type, ...data } = msg
      const typeHandlers = handlers.get(type)
      if (typeHandlers) {
        typeHandlers.forEach(handler => handler(data))
      }
    } catch {
      // ignore malformed messages
    }
  }

  socket.onclose = () => {
    socket = null
    const delay = getReconnectDelay()
    reconnectAttempts++
    reconnectTimer = setTimeout(connectWebSocket, delay)
  }

  socket.onerror = () => {
    socket?.close()
  }
}

export function disconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  socket?.close()
  socket = null
}

export function onMessage(type: string, handler: MessageHandler): () => void {
  if (!handlers.has(type)) {
    handlers.set(type, new Set())
  }
  handlers.get(type)!.add(handler)
  return () => {
    handlers.get(type)?.delete(handler)
  }
}

export function sendMessage(type: string, data: Record<string, unknown> = {}) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, ...data }))
  }
}
