import { LABEL_SESSION_META } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { and, desc, eq, isNull, lt, ne } from 'drizzle-orm'
import type { Database } from '../db'
import { type UserSessionRow, userSessions } from '../db/schema/sessions'

export interface SessionMetaPlain {
  ip: string
  userAgent: string
  city: string
  region: string
  country: string
  lat: number | null
  lon: number | null
}

export type RevokeReason =
  | 'user'
  | 'lockdown_a'
  | 'lockdown_b'
  | 'lockdown_c'
  | 'admin'
  | 'replay'
  | 'expired'

export interface CreateSessionInput {
  id: string
  userPubkey: string
  tokenHash: string
  ipHash: string
  credentialId: string | null
  encryptedMeta: Ciphertext
  metaEnvelope: RecipientEnvelope[]
  expiresAt: Date
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_MS)
}

/**
 * Extract a concise browser-on-OS label from a User-Agent string.
 */
export function formatUserAgent(ua: string): string {
  if (!ua) return 'Unknown browser'
  const lowered = ua.toLowerCase()

  let browser: string | null = null
  if (lowered.includes('firefox/')) browser = 'Firefox'
  else if (lowered.includes('edg/')) browser = 'Edge'
  else if (lowered.includes('chrome/') && !lowered.includes('edg/')) browser = 'Chrome'
  else if (lowered.includes('safari/') && !lowered.includes('chrome/')) browser = 'Safari'

  let os: string | null = null
  if (lowered.includes('iphone') || lowered.includes('ipad')) os = 'iOS'
  else if (lowered.includes('android')) os = 'Android'
  else if (lowered.includes('mac os x')) os = 'macOS'
  else if (lowered.includes('windows')) os = 'Windows'
  else if (lowered.includes('linux')) os = 'Linux'

  if (!browser || !os) return 'Unknown browser'
  return `${browser} on ${os}`
}

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly hmacSecret: string
  ) {}

  /** Get HMAC secret for external token hashing (used by auth-facade). */
  getHmacSecret(): string {
    return this.hmacSecret
  }

  async create(input: CreateSessionInput): Promise<UserSessionRow> {
    const rows = await this.db.insert(userSessions).values(input).returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to create session')
    return row
  }

  async hasSeenIpHash(userPubkey: string, ipHash: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(and(eq(userSessions.userPubkey, userPubkey), eq(userSessions.ipHash, ipHash)))
      .limit(1)
    return rows.length > 0
  }

  async listForUser(userPubkey: string): Promise<UserSessionRow[]> {
    return this.db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.userPubkey, userPubkey), isNull(userSessions.revokedAt)))
      .orderBy(desc(userSessions.lastSeenAt))
  }

  async findByTokenHash(
    tokenHash: string
  ): Promise<{ session: UserSessionRow; viaPrev: boolean } | null> {
    // Try the current token hash first.
    const current = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.tokenHash, tokenHash))
      .limit(1)
    if (current[0]) return { session: current[0], viaPrev: false }
    // Fall back to the previous hash for a one-rotation grace window
    // (concurrent refreshes from two tabs). Callers may treat this as a
    // replay/race signal when the grace window has elapsed.
    const prev = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.prevTokenHash, tokenHash))
      .limit(1)
    if (prev[0]) return { session: prev[0], viaPrev: true }
    return null
  }

  async findByIdForUser(id: string, userPubkey: string): Promise<UserSessionRow | null> {
    const rows = await this.db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.id, id), eq(userSessions.userPubkey, userPubkey)))
      .limit(1)
    return rows[0] ?? null
  }

  async touch(id: string, tokenHash: string): Promise<void> {
    // Move current hash into prev_token_hash so concurrent refreshes still succeed,
    // then set the new hash as current.
    const [existing] = await this.db
      .select({ tokenHash: userSessions.tokenHash })
      .from(userSessions)
      .where(eq(userSessions.id, id))
      .limit(1)
    await this.db
      .update(userSessions)
      .set({
        lastSeenAt: new Date(),
        tokenHash,
        prevTokenHash: existing?.tokenHash ?? null,
      })
      .where(eq(userSessions.id, id))
  }

  async revoke(id: string, reason: RevokeReason): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(userSessions.id, id), isNull(userSessions.revokedAt)))
  }

  async revokeAllForUser(
    userPubkey: string,
    reason: RevokeReason,
    exceptSessionId?: string
  ): Promise<number> {
    const baseWhere = and(eq(userSessions.userPubkey, userPubkey), isNull(userSessions.revokedAt))
    const where = exceptSessionId ? and(baseWhere, ne(userSessions.id, exceptSessionId)) : baseWhere

    const updated = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(where)
      .returning({ id: userSessions.id })
    return updated.length
  }

  async purgeExpired(before: Date = new Date()): Promise<number> {
    const updated = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: 'expired' })
      .where(and(isNull(userSessions.revokedAt), lt(userSessions.expiresAt, before)))
      .returning({ id: userSessions.id })
    return updated.length
  }
}

export { LABEL_SESSION_META }
