import { LABEL_AUTH_EVENT } from '@shared/crypto-labels'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import type { Database } from '../db'
import {
  AUTH_EVENT_TYPES,
  type AuthEventType,
  type UserAuthEventRow,
  userAuthEvents,
} from '../db/schema/auth-events'
import type { CryptoService } from '../lib/crypto-service'

export { AUTH_EVENT_TYPES, type AuthEventType } from '../db/schema/auth-events'

export function isValidEventType(t: string): t is AuthEventType {
  return (AUTH_EVENT_TYPES as readonly string[]).includes(t)
}

export interface AuthEventPayload {
  sessionId?: string
  ipHash?: string
  city?: string
  country?: string
  userAgent?: string
  credentialId?: string
  credentialLabel?: string
  lockdownTier?: 'A' | 'B' | 'C'
  meta?: Record<string, unknown>
}

export interface RecordAuthEventInput {
  userPubkey: string
  eventType: AuthEventType
  payload: AuthEventPayload
}

const RETENTION_DAYS = 90

export class AuthEventsService {
  constructor(
    private db: Database,
    private crypto: CryptoService
  ) {}

  async record(input: RecordAuthEventInput): Promise<UserAuthEventRow> {
    const plaintext = JSON.stringify(input.payload)
    const { encrypted, envelopes } = this.crypto.envelopeEncrypt(
      plaintext,
      [input.userPubkey],
      LABEL_AUTH_EVENT
    )
    const id = crypto.randomUUID()
    const rows = await this.db
      .insert(userAuthEvents)
      .values({
        id,
        userPubkey: input.userPubkey,
        eventType: input.eventType,
        encryptedPayload: encrypted,
        payloadEnvelope: envelopes,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to record auth event')
    return row
  }

  async listForUser(
    userPubkey: string,
    opts: { limit?: number; since?: Date } = {}
  ): Promise<UserAuthEventRow[]> {
    const limit = Math.min(opts.limit ?? 50, 200)
    const clauses = [eq(userAuthEvents.userPubkey, userPubkey)]
    if (opts.since) {
      clauses.push(gte(userAuthEvents.createdAt, opts.since))
    }
    return this.db
      .select()
      .from(userAuthEvents)
      .where(and(...clauses))
      .orderBy(desc(userAuthEvents.createdAt))
      .limit(limit)
  }

  async markSuspicious(id: string, userPubkey: string): Promise<UserAuthEventRow | null> {
    const rows = await this.db
      .update(userAuthEvents)
      .set({ reportedSuspiciousAt: new Date() })
      .where(and(eq(userAuthEvents.id, id), eq(userAuthEvents.userPubkey, userPubkey)))
      .returning()
    return rows[0] ?? null
  }

  async purgeOld(
    before: Date = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
  ): Promise<number> {
    const rows = await this.db
      .delete(userAuthEvents)
      .where(lt(userAuthEvents.createdAt, before))
      .returning({ id: userAuthEvents.id })
    return rows.length
  }
}
