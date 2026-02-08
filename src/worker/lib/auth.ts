import type { AuthPayload, Env, Volunteer } from '../types'

const TOKEN_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

export function parseAuthHeader(header: string | null): AuthPayload | null {
  if (!header?.startsWith('Bearer ')) return null
  try {
    return JSON.parse(header.slice(7))
  } catch {
    return null
  }
}

export function validateToken(auth: AuthPayload): boolean {
  if (!auth.pubkey || !auth.timestamp || !auth.token) return false
  // Check token freshness
  const age = Date.now() - auth.timestamp
  if (age > TOKEN_MAX_AGE_MS || age < -TOKEN_MAX_AGE_MS) return false
  // We'll verify the token hash matches on the server side
  // The token is SHA-256("llamenos:auth:{pubkey}:{timestamp}")
  // Since we can't use noble-hashes in the worker easily, we'll use Web Crypto
  return true
}

export async function verifyAuthToken(auth: AuthPayload): Promise<boolean> {
  if (!validateToken(auth)) return false
  const message = `llamenos:auth:${auth.pubkey}:${auth.timestamp}`
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return hashHex === auth.token
}

export async function authenticateRequest(
  request: Request,
  sessionManager: DurableObjectStub
): Promise<{ pubkey: string; volunteer: Volunteer } | null> {
  const authHeader = request.headers.get('Authorization')
  const auth = parseAuthHeader(authHeader)
  if (!auth) return null
  if (!(await verifyAuthToken(auth))) return null

  // Look up volunteer in session manager
  const res = await sessionManager.fetch(new Request('http://do/volunteer/' + auth.pubkey))
  if (!res.ok) return null
  const volunteer = await res.json() as Volunteer
  return { pubkey: auth.pubkey, volunteer }
}
