import type { User } from '../types'
import { verifyAccessToken } from './jwt'
import { createLogger } from './logger'

const log = createLogger('lib.auth')

export async function authenticateRequest(
  request: Request,
  identity: {
    getUser(pubkey: string): Promise<User | null>
    isJtiRevoked?(jti: string): Promise<boolean>
  }
): Promise<{ pubkey: string; user: User } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) throw new Error('JWT_SECRET not configured')

  try {
    const payload = await verifyAccessToken(token, jwtSecret)
    // Reject revoked tokens. If the token lacks a jti claim, log a warning
    // and allow through (backward compat during rollout) — new tokens always
    // have a jti set by signAccessToken().
    if (payload.jti) {
      if (identity.isJtiRevoked && (await identity.isJtiRevoked(payload.jti))) {
        return null
      }
    } else {
      log.warn('JWT missing jti claim — cannot check revocation')
    }
    const user = await identity.getUser(payload.sub)
    if (!user) return null
    return { pubkey: payload.sub, user }
  } catch {
    return null
  }
}
