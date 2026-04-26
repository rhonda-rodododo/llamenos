import { LABEL_EPHEMERAL_CALL } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { and, eq } from 'drizzle-orm'
import type { Database } from '../db'
import { activeCalls, callLegs, callTokens } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import type {
  ActiveCall,
  CallLeg,
  CallTokenPayload,
  CreateActiveCallData,
  CreateCallLegData,
  CreateCallTokenData,
} from '../types'

export class CallService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  // ------------------------------------------------------------------ Active Calls

  async getActiveCalls(hubId?: string): Promise<ActiveCall[]> {
    if (hubId) {
      const rows = await this.db.select().from(activeCalls).where(eq(activeCalls.hubId, hubId))
      return Promise.all(rows.map((r) => this.#rowToActiveCall(r)))
    }
    // No hub specified — return all active calls (super admin cross-hub view)
    const rows = await this.db.select().from(activeCalls)
    return Promise.all(rows.map((r) => this.#rowToActiveCall(r)))
  }

  async getActiveCall(callSid: string, hubId?: string): Promise<ActiveCall | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(activeCalls)
      .where(and(eq(activeCalls.callSid, callSid), eq(activeCalls.hubId, hId)))
      .limit(1)
    return rows[0] ? await this.#rowToActiveCall(rows[0]) : null
  }

  async createActiveCall(data: CreateActiveCallData): Promise<ActiveCall> {
    // Encrypt caller number with server key (server can decrypt for routing)
    const encryptedCallerNumber = await this.crypto.serverEncrypt(
      data.callerNumber,
      LABEL_EPHEMERAL_CALL
    )

    const [row] = await this.db
      .insert(activeCalls)
      .values({
        callSid: data.callSid,
        hubId: data.hubId ?? 'global',
        encryptedCallerNumber,
        status: data.status ?? 'ringing',
        assignedPubkey: data.assignedPubkey ?? null,
        startedAt: new Date(),
        metadata: {},
      })
      .returning()
    return await this.#rowToActiveCall(row)
  }

  async updateActiveCall(
    callSid: string,
    data: Partial<{
      status: string
      assignedPubkey: string | null
      metadata: Record<string, unknown>
    }>,
    hubId?: string
  ): Promise<ActiveCall> {
    const hId = hubId ?? 'global'
    const existing = await this.getActiveCall(callSid, hId)
    if (!existing) throw new AppError(404, 'Active call not found')

    const [row] = await this.db
      .update(activeCalls)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assignedPubkey !== undefined ? { assignedPubkey: data.assignedPubkey } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      })
      .where(and(eq(activeCalls.callSid, callSid), eq(activeCalls.hubId, hId)))
      .returning()
    return await this.#rowToActiveCall(row)
  }

  async deleteActiveCall(callSid: string, hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'
    await this.db
      .delete(activeCalls)
      .where(and(eq(activeCalls.callSid, callSid), eq(activeCalls.hubId, hId)))
  }

  // ------------------------------------------------------------------ Call Legs

  async getCallLegs(callSid: string, hubId?: string): Promise<CallLeg[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(callLegs)
      .where(and(eq(callLegs.callSid, callSid), eq(callLegs.hubId, hId)))
    return Promise.all(rows.map((r) => this.#rowToCallLeg(r)))
  }

  async createCallLeg(data: CreateCallLegData): Promise<CallLeg> {
    // Encrypt user phone with server key (null for browser-only legs)
    const encryptedPhone = data.phone
      ? await this.crypto.serverEncrypt(data.phone, LABEL_EPHEMERAL_CALL)
      : undefined

    const [row] = await this.db
      .insert(callLegs)
      .values({
        legSid: data.legSid,
        callSid: data.callSid,
        hubId: data.hubId ?? 'global',
        userPubkey: data.userPubkey,
        type: data.type ?? 'phone',
        status: data.status ?? 'ringing',
        ...(encryptedPhone ? { encryptedPhone } : {}),
      })
      .returning()
    return await this.#rowToCallLeg(row)
  }

  async updateCallLeg(legSid: string, status: string): Promise<CallLeg> {
    const [row] = await this.db
      .update(callLegs)
      .set({ status })
      .where(eq(callLegs.legSid, legSid))
      .returning()
    if (!row) throw new AppError(404, 'Call leg not found')
    return await this.#rowToCallLeg(row)
  }

  async deleteCallLeg(legSid: string): Promise<void> {
    await this.db.delete(callLegs).where(eq(callLegs.legSid, legSid))
  }

  /**
   * Cancel all ringing legs except the one answered by the given user.
   * Returns the legSids of phone legs that should be cancelled via the telephony adapter.
   */
  async cancelOtherLegs(
    callSid: string,
    hubId: string | undefined,
    answeredPubkey: string,
    answeredType?: 'phone' | 'browser'
  ): Promise<string[]> {
    const legs = await this.getCallLegs(callSid, hubId)
    const toCancel = legs.filter((leg) => {
      if (leg.userPubkey === answeredPubkey && (!answeredType || leg.type === answeredType))
        return false
      return leg.status === 'ringing'
    })
    for (const leg of toCancel) {
      await this.updateCallLeg(leg.legSid, 'cancelled')
    }
    return toCancel.filter((l) => l.type === 'phone' && l.legSid).map((l) => l.legSid)
  }

  // ------------------------------------------------------------------ Call Tokens

  async createCallToken(data: CreateCallTokenData): Promise<string> {
    const tokenBytes = new Uint8Array(32)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const ttl = data.ttlSeconds ?? 3600
    const expiresAt = new Date(Date.now() + ttl * 1000)
    await this.db.insert(callTokens).values({
      token,
      callSid: data.callSid,
      hubId: data.hubId ?? 'global',
      pubkey: data.pubkey,
      expiresAt,
    })
    return token
  }

  async validateCallToken(token: string): Promise<CallTokenPayload> {
    const rows = await this.db.select().from(callTokens).where(eq(callTokens.token, token)).limit(1)
    const row = rows[0]
    if (!row) throw new AppError(401, 'Invalid call token')
    if (row.expiresAt < new Date()) {
      await this.db.delete(callTokens).where(eq(callTokens.token, token))
      throw new AppError(401, 'Call token expired')
    }
    return {
      token: row.token,
      callSid: row.callSid,
      hubId: row.hubId,
      pubkey: row.pubkey,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }
  }

  async deleteCallToken(token: string): Promise<void> {
    await this.db.delete(callTokens).where(eq(callTokens.token, token))
  }

  // ------------------------------------------------------------------ Private helpers

  async #rowToActiveCall(r: typeof activeCalls.$inferSelect): Promise<ActiveCall> {
    // Guard: empty ciphertext means erased — return empty string
    const callerNumber = r.encryptedCallerNumber
      ? await this.crypto.serverDecrypt(r.encryptedCallerNumber as Ciphertext, LABEL_EPHEMERAL_CALL)
      : ''

    return {
      callSid: r.callSid,
      hubId: r.hubId,
      callerNumber,
      status: r.status,
      assignedPubkey: r.assignedPubkey,
      startedAt: r.startedAt,
      metadata: r.metadata as Record<string, unknown>,
    }
  }

  async #rowToCallLeg(r: typeof callLegs.$inferSelect): Promise<CallLeg> {
    const phone = r.encryptedPhone
      ? await this.crypto.serverDecrypt(r.encryptedPhone as Ciphertext, LABEL_EPHEMERAL_CALL)
      : null

    return {
      legSid: r.legSid,
      callSid: r.callSid,
      hubId: r.hubId,
      userPubkey: r.userPubkey,
      phone,
      type: r.type,
      status: r.status,
      createdAt: r.createdAt,
    }
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(activeCalls)
    await this.db.delete(callLegs)
    await this.db.delete(callTokens)
  }
}
