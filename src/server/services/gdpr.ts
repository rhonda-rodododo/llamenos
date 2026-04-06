import { LABEL_AUDIT_EVENT } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, lt, sql } from 'drizzle-orm'
import {
  CONSENT_VERSION,
  DEFAULT_RETENTION_SETTINGS,
  type GdprConsentStatus,
  type GdprErasureRequest,
  type RetentionSettings,
} from '../../shared/types'
import type { Database } from '../db'
import {
  activeShifts,
  auditLog,
  callLegs,
  callRecords,
  conversations,
  gdprConsents,
  gdprErasureRequests,
  messageEnvelopes,
  noteEnvelopes,
  provisionRooms,
  retentionSettings,
  shiftSchedules,
  users,
  webauthnCredentials,
} from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'

export interface GdprExport {
  exportedAt: string
  version: string
  profile: Record<string, unknown> | null
  credentials: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string }>
  shifts: Array<{ hubId: string; startedAt: string }>
  calls: Array<{ id: string; startedAt: string; status: string }>
  notes: Array<{ id: string; createdAt: string; encryptedContent: string }>
  messages: Array<{ id: string; createdAt: string; encryptedContent: string }>
  auditLog: Array<{ id: string; event: string; createdAt: string }>
  hubs: Array<{ hubId: string; roleIds: string[] }>
}

export interface PurgeSummary {
  callRecordsDeleted: number
  notesDeleted: number
  messagesDeleted: number
  auditLogDeleted: number
}

export class GdprService {
  constructor(
    protected readonly db: Database,
    private readonly crypto: CryptoService
  ) {}

  // ------------------------------------------------------------------ Consent

  async getConsentStatus(pubkey: string): Promise<GdprConsentStatus> {
    const rows = await this.db
      .select()
      .from(gdprConsents)
      .where(eq(gdprConsents.pubkey, pubkey))
      .orderBy(sql`${gdprConsents.consentedAt} DESC`)
      .limit(1)
    const row = rows[0]
    if (!row) {
      return {
        hasConsented: false,
        consentVersion: null,
        consentedAt: null,
        currentPlatformVersion: CONSENT_VERSION,
      }
    }
    return {
      hasConsented: row.consentVersion === CONSENT_VERSION,
      consentVersion: row.consentVersion,
      consentedAt: row.consentedAt.toISOString(),
      currentPlatformVersion: CONSENT_VERSION,
    }
  }

  async recordConsent(pubkey: string, version: string): Promise<void> {
    if (version !== CONSENT_VERSION) {
      throw new AppError(400, `Invalid consent version. Expected ${CONSENT_VERSION}`)
    }
    await this.db
      .insert(gdprConsents)
      .values({ pubkey, consentVersion: version, consentedAt: new Date() })
  }

  // ------------------------------------------------------------------ Export

  async exportForUser(pubkey: string): Promise<GdprExport> {
    const now = new Date().toISOString()

    // Profile
    const volRows = await this.db.select().from(users).where(eq(users.pubkey, pubkey)).limit(1)
    const vol = volRows[0]
    const profile: Record<string, unknown> | null = vol
      ? {
          pubkey: vol.pubkey,
          // name and phone are encrypted — omitted from export (client decrypts via envelopes)
          roles: vol.roles,
          hubRoles: vol.hubRoles,
          active: vol.active,
          spokenLanguages: vol.spokenLanguages,
          uiLanguage: vol.uiLanguage,
          profileCompleted: vol.profileCompleted,
          createdAt: vol.createdAt.toISOString(),
        }
      : null

    // WebAuthn credentials (metadata only)
    const credRows = await this.db
      .select({
        id: webauthnCredentials.id,
        createdAt: webauthnCredentials.createdAt,
        lastUsedAt: webauthnCredentials.lastUsedAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.pubkey, pubkey))
    const credentials = credRows.map((r) => ({
      id: r.id,
      label: '', // Plaintext dropped — E2EE label decrypted client-side
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
    }))

    // Active shifts
    const shiftRows = await this.db
      .select({
        hubId: activeShifts.hubId,
        startedAt: activeShifts.startedAt,
      })
      .from(activeShifts)
      .where(eq(activeShifts.pubkey, pubkey))
    const shifts = shiftRows.map((r) => ({
      hubId: r.hubId,
      startedAt: r.startedAt.toISOString(),
    }))

    // Call records — only calls the user was involved in (via callLegs join)
    const callRows = await this.db
      .selectDistinct({
        id: callRecords.id,
        startedAt: callRecords.startedAt,
        status: callRecords.status,
      })
      .from(callRecords)
      .innerJoin(callLegs, eq(callLegs.callSid, callRecords.id))
      .where(eq(callLegs.userPubkey, pubkey))
    const calls = callRows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      status: r.status,
    }))

    // Notes — ciphertext envelopes only
    const noteRows = await this.db
      .select({
        id: noteEnvelopes.id,
        createdAt: noteEnvelopes.createdAt,
        encryptedContent: noteEnvelopes.encryptedContent,
      })
      .from(noteEnvelopes)
      .where(eq(noteEnvelopes.authorPubkey, pubkey))
    const notes = noteRows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      encryptedContent: r.encryptedContent,
    }))

    // Messages (encrypted, assigned to user)
    const msgRows = await this.db
      .select({
        id: messageEnvelopes.id,
        createdAt: messageEnvelopes.createdAt,
        encryptedContent: messageEnvelopes.encryptedContent,
      })
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.authorPubkey, pubkey))
    const messages = msgRows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      encryptedContent: r.encryptedContent,
    }))

    // Audit log entries where actor = this user
    const auditRows = await this.db
      .select({
        id: auditLog.id,
        encryptedEvent: auditLog.encryptedEvent,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(eq(auditLog.actorPubkey, pubkey))
    const auditEntries = auditRows.map((r) => ({
      id: r.id,
      event: this.crypto.serverDecrypt(r.encryptedEvent as Ciphertext, LABEL_AUDIT_EVENT),
      createdAt: r.createdAt.toISOString(),
    }))

    // Hub memberships
    const hubs =
      vol?.hubRoles?.map((hr: { hubId: string; roleIds: string[] }) => ({
        hubId: hr.hubId,
        roleIds: hr.roleIds,
      })) ?? []

    return {
      exportedAt: now,
      version: '1.0',
      profile,
      credentials,
      shifts,
      calls,
      notes,
      messages,
      auditLog: auditEntries,
      hubs,
    }
  }

  // ------------------------------------------------------------------ Erasure Requests

  async getErasureRequest(pubkey: string): Promise<GdprErasureRequest | null> {
    const rows = await this.db
      .select()
      .from(gdprErasureRequests)
      .where(and(eq(gdprErasureRequests.pubkey, pubkey), eq(gdprErasureRequests.status, 'pending')))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      pubkey: row.pubkey,
      requestedAt: row.requestedAt.toISOString(),
      executeAt: row.executeAt.toISOString(),
      status: row.status as GdprErasureRequest['status'],
    }
  }

  async createErasureRequest(pubkey: string): Promise<GdprErasureRequest> {
    const existing = await this.getErasureRequest(pubkey)
    if (existing && existing.status === 'pending') {
      return existing
    }

    const now = new Date()
    const executeAt = new Date(now.getTime() + 72 * 60 * 60 * 1000) // 72 hours

    await this.db
      .insert(gdprErasureRequests)
      .values({
        pubkey,
        requestedAt: now,
        executeAt,
        status: 'pending',
      })
      .onConflictDoUpdate({
        target: gdprErasureRequests.pubkey,
        set: { requestedAt: now, executeAt, status: 'pending' },
      })

    return {
      pubkey,
      requestedAt: now.toISOString(),
      executeAt: executeAt.toISOString(),
      status: 'pending',
    }
  }

  async cancelErasureRequest(pubkey: string): Promise<void> {
    const existing = await this.getErasureRequest(pubkey)
    if (!existing || existing.status !== 'pending') {
      throw new AppError(404, 'No pending erasure request found')
    }
    await this.db
      .update(gdprErasureRequests)
      .set({ status: 'cancelled' })
      .where(eq(gdprErasureRequests.pubkey, pubkey))
  }

  async eraseUser(pubkey: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Delete WebAuthn credentials
      await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.pubkey, pubkey))

      // Delete provision rooms
      await tx.delete(provisionRooms).where(eq(provisionRooms.primaryPubkey, pubkey))

      // Remove user from shift schedules (jsonb array)
      const schedules = await tx.select().from(shiftSchedules)
      for (const schedule of schedules) {
        const existing = (schedule.userPubkeys as string[]) ?? []
        if (existing.includes(pubkey)) {
          await tx
            .update(shiftSchedules)
            .set({ userPubkeys: existing.filter((p: string) => p !== pubkey) })
            .where(eq(shiftSchedules.id, schedule.id))
        }
      }

      // Remove user from active shifts
      await tx.delete(activeShifts).where(eq(activeShifts.pubkey, pubkey))

      // Delete note author envelopes (delete notes authored by this user)
      await tx.delete(noteEnvelopes).where(eq(noteEnvelopes.authorPubkey, pubkey))

      // Replace actorPubkey in audit log
      await tx
        .update(auditLog)
        .set({ actorPubkey: '[erased]' })
        .where(eq(auditLog.actorPubkey, pubkey))

      // Anonymize the user record (clear encrypted PII, keep the row for relational integrity)
      await tx
        .update(users)
        .set({
          active: false,
          encryptedSecretKey: '',
          encryptedName: '' as import('@shared/crypto-types').Ciphertext,
          encryptedPhone: '' as import('@shared/crypto-types').Ciphertext,
          nameEnvelopes: [],
          phoneEnvelopes: [],
          spokenLanguages: [],
          hubRoles: [],
        })
        .where(eq(users.pubkey, pubkey))

      // Mark erasure request as executed
      await tx
        .update(gdprErasureRequests)
        .set({ status: 'executed' })
        .where(eq(gdprErasureRequests.pubkey, pubkey))
    })
  }

  async processPendingErasures(): Promise<number> {
    const now = new Date()
    const pending = await this.db
      .select()
      .from(gdprErasureRequests)
      .where(and(eq(gdprErasureRequests.status, 'pending'), lt(gdprErasureRequests.executeAt, now)))

    let count = 0
    for (const req of pending) {
      await this.eraseUser(req.pubkey)
      count++
    }
    return count
  }

  // ------------------------------------------------------------------ Retention Settings

  async getRetentionSettings(hubId?: string): Promise<RetentionSettings> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(retentionSettings)
      .where(eq(retentionSettings.hubId, hId))
      .limit(1)
    const row = rows[0]
    if (!row?.settings) return { ...DEFAULT_RETENTION_SETTINGS }
    const s = row.settings as Record<string, number>
    return {
      callRecordsDays: s.callRecordsDays ?? DEFAULT_RETENTION_SETTINGS.callRecordsDays,
      notesDays: s.notesDays ?? DEFAULT_RETENTION_SETTINGS.notesDays,
      messagesDays: s.messagesDays ?? DEFAULT_RETENTION_SETTINGS.messagesDays,
      auditLogDays: s.auditLogDays ?? DEFAULT_RETENTION_SETTINGS.auditLogDays,
    }
  }

  async updateRetentionSettings(
    data: Partial<RetentionSettings>,
    hubId?: string
  ): Promise<RetentionSettings> {
    const hId = hubId ?? 'global'
    const current = await this.getRetentionSettings(hId)
    const clampCall = (v: number) => Math.max(30, Math.min(3650, v))
    const clampAudit = (v: number) => Math.max(365, Math.min(3650, v))
    const updated: RetentionSettings = {
      callRecordsDays:
        data.callRecordsDays !== undefined
          ? clampCall(data.callRecordsDays)
          : current.callRecordsDays,
      notesDays: data.notesDays !== undefined ? clampCall(data.notesDays) : current.notesDays,
      messagesDays:
        data.messagesDays !== undefined ? clampCall(data.messagesDays) : current.messagesDays,
      auditLogDays:
        data.auditLogDays !== undefined ? clampAudit(data.auditLogDays) : current.auditLogDays,
    }
    await this.db
      .insert(retentionSettings)
      .values({
        hubId: hId,
        settings: updated as unknown as Record<string, number>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: retentionSettings.hubId,
        set: { settings: updated as unknown as Record<string, number>, updatedAt: new Date() },
      })
    return updated
  }

  // ------------------------------------------------------------------ Retention Purge

  async purgeExpiredData(settings?: RetentionSettings, hubId?: string): Promise<PurgeSummary> {
    const hId = hubId ?? 'global'
    const s = settings ?? (await this.getRetentionSettings(hId))
    const now = new Date()

    const callCutoff = new Date(now.getTime() - s.callRecordsDays * 86400_000)
    const noteCutoff = new Date(now.getTime() - s.notesDays * 86400_000)
    const msgCutoff = new Date(now.getTime() - s.messagesDays * 86400_000)
    const auditCutoff = new Date(now.getTime() - s.auditLogDays * 86400_000)

    const deletedCalls = await this.db
      .delete(callRecords)
      .where(and(eq(callRecords.hubId, hId), lt(callRecords.startedAt, callCutoff)))
      .returning({ id: callRecords.id })
    const callRecordsDeleted = deletedCalls.length

    const deletedNotes = await this.db
      .delete(noteEnvelopes)
      .where(and(eq(noteEnvelopes.hubId, hId), lt(noteEnvelopes.createdAt, noteCutoff)))
      .returning({ id: noteEnvelopes.id })
    const notesDeleted = deletedNotes.length

    // messageEnvelopes doesn't have hubId — filter via conversations join
    const hubConversationIds = this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.hubId, hId))
    const deletedMessages = await this.db
      .delete(messageEnvelopes)
      .where(
        and(
          sql`${messageEnvelopes.conversationId} IN (${hubConversationIds})`,
          lt(messageEnvelopes.createdAt, msgCutoff)
        )
      )
      .returning({ id: messageEnvelopes.id })
    const messagesDeleted = deletedMessages.length

    const deletedAudit = await this.db
      .delete(auditLog)
      .where(and(eq(auditLog.hubId, hId), lt(auditLog.createdAt, auditCutoff)))
      .returning({ id: auditLog.id })
    const auditLogDeleted = deletedAudit.length

    return { callRecordsDeleted, notesDeleted, messagesDeleted, auditLogDeleted }
  }
}
