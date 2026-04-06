import type { User } from '../types'
import { verifyAccessToken } from './jwt'

export async function authenticateRequest(
  request: Request,
  identity: {
    getUser(pubkey: string): Promise<User | null>
  }
): Promise<{ pubkey: string; user: User } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) throw new Error('JWT_SECRET not configured')

  try {
    const payload = await verifyAccessToken(token, jwtSecret)
    const user = await identity.getUser(payload.sub)
    if (!user) return null
    return { pubkey: payload.sub, user }
  } catch {
    return null
  }
}
