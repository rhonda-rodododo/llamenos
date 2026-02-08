import { getStoredSession, keyPairFromNsec, createAuthToken } from './crypto'

type MessageHandler = (data: unknown) => void

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const handlers = new Map<string, Set<MessageHandler>>()

export function connectWebSocket() {
  if (socket?.readyState === WebSocket.OPEN) return

  const nsec = getStoredSession()
  if (!nsec) return

  const keyPair = keyPairFromNsec(nsec)
  if (!keyPair) return

  const token = createAuthToken(keyPair.secretKey, Date.now())
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/api/ws?auth=${encodeURIComponent(token)}`

  socket = new WebSocket(url)

  socket.onopen = () => {
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
    // Reconnect after 3 seconds
    reconnectTimer = setTimeout(connectWebSocket, 3000)
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
