import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { HMAC_PHONE_PREFIX, LABEL_AUDIT_EVENT, LABEL_USER_PII } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { and, count, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'
import type { RecipientEnvelope } from '../../shared/types'
import type { Database } from '../db'
import { auditLog, bans, callRecords, noteEnvelopes, users } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import type {
  AuditFilters,
  AuditLogEntry,
  BanEntry,
  BulkBanData,
  CallHourBucket,
  CallRecordFilters,
  CallVolumeDay,
  CreateBanData,
  CreateCallRecordData,
  CreateNoteData,
  EncryptedCallRecord,
  EncryptedNote,
  NoteFilters,
  UpdateNoteData,
} from '../types'

/** Check if a string is a valid 64-char hex secp256k1 x-only pubkey */
const isValidPubkey = (pk: string) => /^[0-9a-f]{64}$/i.test(pk)

export class RecordsService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  // ------------------------------------------------------------------ Bans

  async getBans(hubId?: string): Promise<BanEntry[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(bans).where(eq(bans.hubId, hId))
    return rows.map((r) => {
      // Phone: if envelopes exist, this is E2EE — server can't decrypt
      const pEnv = (r.phoneEnvelopes as RecipientEnvelope[]) ?? []
      let phone = ''
      if (pEnv.length > 0) {
        phone = '[encrypted]'
      } else {
        try {
          phone = this.crypto.serverDecrypt(r.encryptedPhone as Ciphertext, LABEL_USER_PII)
        } catch {
          // Decryption failed — leave empty
        }
      }

      // Reason: if envelopes exist, this is E2EE — server can't decrypt
      const rEnv = (r.reasonEnvelopes as RecipientEnvelope[]) ?? []
      let reason = ''
      if (rEnv.length > 0) {
        reason = '[encrypted]'
      } else {
        try {
          reason = this.crypto.serverDecrypt(r.encryptedReason as Ciphertext, LABEL_USER_PII)
        } catch {
          // Decryption failed — leave empty
        }
      }

      return {
        phone,
        reason,
        bannedBy: r.bannedBy,
        bannedAt: r.createdAt.toISOString(),
        // E2EE envelope fields for client-side decryption
        ...(pEnv.length > 0
          ? {
              encryptedPhone: r.encryptedPhone as string,
              phoneEnvelopes: pEnv,
            }
          : {}),
        ...(rEnv.length > 0
          ? {
              encryptedReason: r.encryptedReason as string,
              reasonEnvelopes: rEnv,
            }
          : {}),
      }
    })
  }

  async addBan(data: CreateBanData): Promise<BanEntry> {
    const hId = data.hubId ?? 'global'
    const id = crypto.randomUUID()

    // HMAC hash phone for ban-check lookups
    const phoneHash = this.crypto.hmac(data.phone, HMAC_PHONE_PREFIX)

    // E2EE encrypt phone + reason for bannedBy + admin pubkeys
    const adminPubkeys = (await this.#getSuperAdminPubkeys()).filter(isValidPubkey)
    const recipientPubkeys = [
      ...new Set([...(isValidPubkey(data.bannedBy) ? [data.bannedBy] : []), ...adminPubkeys]),
    ]
    const phoneEnvelope =
      recipientPubkeys.length > 0
        ? await this.crypto.envelopeEncrypt(data.phone, recipientPubkeys, LABEL_USER_PII)
        : undefined
    const reasonEnvelope =
      data.reason && recipientPubkeys.length > 0
        ? await this.crypto.envelopeEncrypt(data.reason, recipientPubkeys, LABEL_USER_PII)
        : undefined

    // E2EE phone+reason: use envelope ciphertext if available, fallback to server-key
    const encryptedPhone = phoneEnvelope
      ? phoneEnvelope.encrypted
      : this.crypto.serverEncrypt(data.phone, LABEL_USER_PII)
    const encryptedReason = reasonEnvelope
      ? reasonEnvelope.encrypted
      : this.crypto.serverEncrypt(data.reason ?? '', LABEL_USER_PII)

    const [row] = await this.db
      .insert(bans)
      .values({
        id,
        hubId: hId,
        bannedBy: data.bannedBy,
        phoneHash,
        encryptedPhone,
        phoneEnvelopes: phoneEnvelope?.envelopes ?? [],
        encryptedReason,
        reasonEnvelopes: reasonEnvelope?.envelopes ?? [],
      })
      .returning()
    return {
      phone: data.phone,
      reason: data.reason ?? '',
      bannedBy: row.bannedBy,
      bannedAt: row.createdAt.toISOString(),
    }
  }

  async bulkAddBans(data: BulkBanData): Promise<number> {
    const hId = data.hubId ?? 'global'
    // Check existing bans by phone hash to avoid duplicates
    const existingHashes = new Set<string>()
    const existingRows = await this.db
      .select({ phoneHash: bans.phoneHash })
      .from(bans)
      .where(eq(bans.hubId, hId))
    for (const row of existingRows) {
      if (row.phoneHash) existingHashes.add(row.phoneHash)
    }
    const newPhones = data.phones.filter((p) => {
      const hash = this.crypto.hmac(p, HMAC_PHONE_PREFIX)
      return !existingHashes.has(hash)
    })
    if (newPhones.length === 0) return 0
    const bulkAdminPubkeys = (await this.#getSuperAdminPubkeys()).filter(isValidPubkey)
    const banValues = await Promise.all(
      newPhones.map(async (phone) => {
        const phoneHash = this.crypto.hmac(phone, HMAC_PHONE_PREFIX)
        const recipientPubkeys = [
          ...new Set([
            ...(isValidPubkey(data.bannedBy) ? [data.bannedBy] : []),
            ...bulkAdminPubkeys,
          ]),
        ]
        const phoneEnvelope =
          recipientPubkeys.length > 0
            ? await this.crypto.envelopeEncrypt(phone, recipientPubkeys, LABEL_USER_PII)
            : undefined
        const reasonEnvelope =
          data.reason && recipientPubkeys.length > 0
            ? await this.crypto.envelopeEncrypt(data.reason, recipientPubkeys, LABEL_USER_PII)
            : undefined
        return {
          id: crypto.randomUUID(),
          hubId: hId,
          bannedBy: data.bannedBy,
          phoneHash,
          // E2EE: use envelope ciphertext if available, fallback to server-key
          encryptedPhone: phoneEnvelope
            ? phoneEnvelope.encrypted
            : this.crypto.serverEncrypt(phone, LABEL_USER_PII),
          phoneEnvelopes: phoneEnvelope?.envelopes ?? [],
          encryptedReason: reasonEnvelope
            ? reasonEnvelope.encrypted
            : this.crypto.serverEncrypt(data.reason ?? '', LABEL_USER_PII),
          reasonEnvelopes: reasonEnvelope?.envelopes ?? [],
        }
      })
    )
    await this.db.insert(bans).values(banValues)
    return newPhones.length
  }

  async removeBan(phone: string, hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'
    const phoneHash = this.crypto.hmac(phone, HMAC_PHONE_PREFIX)
    await this.db.delete(bans).where(and(eq(bans.hubId, hId), eq(bans.phoneHash, phoneHash)))
  }

  async isBanned(phone: string, hubId?: string): Promise<boolean> {
    const hId = hubId ?? 'global'
    // Check both hub-specific and global bans — a globally banned number
    // should be rejected regardless of which hub the call routes to
    const hubConditions =
      hId === 'global'
        ? eq(bans.hubId, 'global')
        : or(eq(bans.hubId, hId), eq(bans.hubId, 'global'))

    const phoneHash = this.crypto.hmac(phone, HMAC_PHONE_PREFIX)
    const rows = await this.db
      .select({ id: bans.id })
      .from(bans)
      .where(and(hubConditions!, eq(bans.phoneHash, phoneHash)))
      .limit(1)
    return rows.length > 0
  }

  // ------------------------------------------------------------------ Call Records

  async createCallRecord(data: CreateCallRecordData): Promise<EncryptedCallRecord> {
    // E2EE encrypt callerLast4 for admin pubkeys if present
    // Note: adminEnvelopes for callerLast4 are separate from the content adminEnvelopes
    // For now, callerLast4 encryption uses the same admin envelopes pattern
    // but the actual callerLast4Envelopes are for the callerLast4 field specifically
    let encryptedCallerLast4: Ciphertext | undefined
    let callerLast4Envelopes: RecipientEnvelope[] = []
    if (data.callerLast4 && data.adminEnvelopes && data.adminEnvelopes.length > 0) {
      const adminPubkeys = data.adminEnvelopes.map((e) => e.pubkey)
      const envelope = await this.crypto.envelopeEncrypt(
        data.callerLast4,
        adminPubkeys,
        LABEL_USER_PII
      )
      encryptedCallerLast4 = envelope.encrypted
      callerLast4Envelopes = envelope.envelopes
    }

    const [row] = await this.db
      .insert(callRecords)
      .values({
        id: data.id,
        hubId: data.hubId ?? 'global',
        startedAt: data.startedAt,
        endedAt: data.endedAt ?? null,
        duration: data.duration ?? null,
        status: data.status,
        hasTranscription: data.hasTranscription ?? false,
        hasVoicemail: data.hasVoicemail ?? false,
        hasRecording: data.hasRecording ?? false,
        recordingSid: data.recordingSid ?? null,
        encryptedContent: data.encryptedContent ?? null,
        adminEnvelopes: (data.adminEnvelopes ?? []) as RecipientEnvelope[],
        ...(encryptedCallerLast4 ? { encryptedCallerLast4, callerLast4Envelopes } : {}),
      })
      .returning()
    return this.#rowToCallRecord(row)
  }

  async getCallRecord(id: string, hubId?: string): Promise<EncryptedCallRecord | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(callRecords)
      .where(and(eq(callRecords.id, id), eq(callRecords.hubId, hId)))
      .limit(1)
    return rows[0] ? this.#rowToCallRecord(rows[0]) : null
  }

  /** Find a call record by ID across all hubs. Returns hubId for webhook hub resolution. */
  async findCallRecordHubId(id: string): Promise<string | null> {
    const rows = await this.db
      .select({ hubId: callRecords.hubId })
      .from(callRecords)
      .where(eq(callRecords.id, id))
      .limit(1)
    return rows[0]?.hubId ?? null
  }

  async updateCallRecord(
    id: string,
    hubId: string,
    data: Partial<CreateCallRecordData>
  ): Promise<EncryptedCallRecord> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(callRecords)
      .where(and(eq(callRecords.id, id), eq(callRecords.hubId, hId)))
      .limit(1)
    if (!rows[0]) throw new AppError(404, 'Call record not found')
    const [row] = await this.db
      .update(callRecords)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.endedAt !== undefined ? { endedAt: data.endedAt } : {}),
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
        ...(data.hasTranscription !== undefined ? { hasTranscription: data.hasTranscription } : {}),
        ...(data.hasVoicemail !== undefined ? { hasVoicemail: data.hasVoicemail } : {}),
        ...(data.hasRecording !== undefined ? { hasRecording: data.hasRecording } : {}),
        ...(data.recordingSid !== undefined ? { recordingSid: data.recordingSid } : {}),
        ...(data.voicemailFileId !== undefined ? { voicemailFileId: data.voicemailFileId } : {}),
        ...(data.encryptedContent !== undefined ? { encryptedContent: data.encryptedContent } : {}),
        ...(data.adminEnvelopes !== undefined
          ? { adminEnvelopes: data.adminEnvelopes as RecipientEnvelope[] }
          : {}),
      })
      .where(and(eq(callRecords.id, id), eq(callRecords.hubId, hId)))
      .returning()
    return this.#rowToCallRecord(row)
  }

  /**
   * Create a call record if it doesn't exist, or update it if it does.
   * Used by webhook handlers that may fire before or after the call record is created.
   */
  async upsertCallRecord(
    id: string,
    hubId: string,
    data: Partial<CreateCallRecordData> & { startedAt?: Date; status?: string }
  ): Promise<EncryptedCallRecord> {
    const hId = hubId ?? 'global'
    const existing = await this.getCallRecord(id, hId)
    if (existing) {
      return this.updateCallRecord(id, hId, data)
    }
    return this.createCallRecord({
      id,
      hubId: hId,
      startedAt: data.startedAt ?? new Date(),
      status: data.status ?? 'voicemail',
      ...data,
    })
  }

  async getCallHistory(
    page: number,
    limit: number,
    hubId?: string,
    filters?: CallRecordFilters
  ): Promise<{ calls: EncryptedCallRecord[]; total: number }> {
    const hId = hubId ?? 'global'
    const conditions = [eq(callRecords.hubId, hId)]
    if (filters?.dateFrom) {
      conditions.push(gte(callRecords.startedAt, new Date(filters.dateFrom)))
    }
    if (filters?.dateTo) {
      const toDate = new Date(filters.dateTo)
      toDate.setUTCHours(23, 59, 59, 999)
      conditions.push(lte(callRecords.startedAt, toDate))
    }
    const whereClause = and(...conditions)

    // If no post-decrypt filters, use SQL pagination
    if (!filters?.voicemailOnly && !filters?.search) {
      const [{ value: rawTotal }] = await this.db
        .select({ value: count() })
        .from(callRecords)
        .where(whereClause)
      const total = Number(rawTotal)
      const offset = (page - 1) * limit
      const rows = await this.db
        .select()
        .from(callRecords)
        .where(whereClause)
        .orderBy(desc(callRecords.startedAt))
        .limit(limit)
        .offset(offset)
      return { calls: rows.map((r) => this.#rowToCallRecord(r)), total }
    }

    // With post-decrypt filters, still load all (can't filter in SQL due to encryption)
    const allRows = await this.db
      .select()
      .from(callRecords)
      .where(whereClause)
      .orderBy(desc(callRecords.startedAt))
    let filtered = allRows.map((r) => this.#rowToCallRecord(r))
    if (filters?.voicemailOnly) {
      filtered = filtered.filter((c) => c.hasVoicemail)
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase()
      filtered = filtered.filter(
        (c) => c.callerLast4?.includes(q) || c.id.toLowerCase().includes(q)
      )
    }
    const filteredTotal = filtered.length
    const start = (page - 1) * limit
    return { calls: filtered.slice(start, start + limit), total: filteredTotal }
  }

  async getCallsTodayCount(hubId?: string): Promise<number> {
    const hId = hubId ?? 'global'
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(callRecords)
      .where(and(eq(callRecords.hubId, hId), gte(callRecords.startedAt, todayStart)))
    return Number(value)
  }

  // ------------------------------------------------------------------ Notes

  async createNote(data: CreateNoteData): Promise<EncryptedNote> {
    const id = data.id ?? crypto.randomUUID()
    const now = new Date()
    const [row] = await this.db
      .insert(noteEnvelopes)
      .values({
        id,
        hubId: data.hubId ?? 'global',
        callId: data.callId ?? null,
        conversationId: data.conversationId ?? null,
        contactHash: data.contactHash ?? null,
        authorPubkey: data.authorPubkey,
        // encryptedContent + ephemeralPubkey only set by server-side transcription
        encryptedContent: data.encryptedContent ?? null,
        ephemeralPubkey: data.ephemeralPubkey ?? null,
        authorEnvelope: null,
        adminEnvelopes: [],
        mlsCiphertext: data.mlsCiphertext ?? null,
        mlsEpoch: data.mlsEpoch ?? null,
        replyCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return this.#rowToNote(row)
  }

  async updateNote(id: string, data: UpdateNoteData): Promise<EncryptedNote> {
    const rows = await this.db.select().from(noteEnvelopes).where(eq(noteEnvelopes.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Note not found')
    if (rows[0].authorPubkey !== data.authorPubkey) throw new AppError(403, 'Forbidden')

    const [row] = await this.db
      .update(noteEnvelopes)
      .set({
        ...(data.mlsCiphertext !== undefined ? { mlsCiphertext: data.mlsCiphertext } : {}),
        ...(data.mlsEpoch !== undefined ? { mlsEpoch: data.mlsEpoch } : {}),
        updatedAt: new Date(),
      })
      .where(eq(noteEnvelopes.id, id))
      .returning()
    return this.#rowToNote(row)
  }

  async getNotes(filters: NoteFilters): Promise<{ notes: EncryptedNote[]; total: number }> {
    const hId = filters.hubId ?? 'global'
    const conditions: ReturnType<typeof eq>[] = [eq(noteEnvelopes.hubId, hId)]
    if (filters.authorPubkey) conditions.push(eq(noteEnvelopes.authorPubkey, filters.authorPubkey))
    if (filters.callId) conditions.push(eq(noteEnvelopes.callId, filters.callId))
    if (filters.conversationId)
      conditions.push(eq(noteEnvelopes.conversationId, filters.conversationId))
    if (filters.contactHash) conditions.push(eq(noteEnvelopes.contactHash, filters.contactHash))
    const whereClause = and(...conditions)

    const [{ value: rawTotal }] = await this.db
      .select({ value: count() })
      .from(noteEnvelopes)
      .where(whereClause)
    const total = Number(rawTotal)

    if (filters.page && filters.limit) {
      const offset = (filters.page - 1) * filters.limit
      const rows = await this.db
        .select()
        .from(noteEnvelopes)
        .where(whereClause)
        .orderBy(desc(noteEnvelopes.createdAt))
        .limit(filters.limit)
        .offset(offset)
      return { notes: rows.map((r) => this.#rowToNote(r)), total }
    }
    const rows = await this.db
      .select()
      .from(noteEnvelopes)
      .where(whereClause)
      .orderBy(desc(noteEnvelopes.createdAt))
    return { notes: rows.map((r) => this.#rowToNote(r)), total }
  }

  async getNote(id: string): Promise<EncryptedNote | null> {
    const rows = await this.db.select().from(noteEnvelopes).where(eq(noteEnvelopes.id, id)).limit(1)
    return rows[0] ? this.#rowToNote(rows[0]) : null
  }

  async getContacts(
    page: number,
    limit: number,
    hubId?: string
  ): Promise<{
    contacts: Array<{ contactHash: string; firstSeen: string; lastSeen: string; noteCount: number }>
    total: number
  }> {
    const hId = hubId ?? 'global'
    const aggregated = await this.db
      .select({
        contactHash: noteEnvelopes.contactHash,
        firstSeen: sql<Date>`min(${noteEnvelopes.createdAt})`,
        lastSeen: sql<Date>`max(${noteEnvelopes.createdAt})`,
        noteCount: count(),
      })
      .from(noteEnvelopes)
      .where(and(eq(noteEnvelopes.hubId, hId), sql`${noteEnvelopes.contactHash} IS NOT NULL`))
      .groupBy(noteEnvelopes.contactHash)
      .orderBy(sql`max(${noteEnvelopes.createdAt}) DESC`)

    const total = aggregated.length
    const start = (page - 1) * limit
    const pageResults = aggregated.slice(start, start + limit)
    return {
      contacts: pageResults.map((r) => ({
        contactHash: r.contactHash!,
        firstSeen: new Date(r.firstSeen).toISOString(),
        lastSeen: new Date(r.lastSeen).toISOString(),
        noteCount: Number(r.noteCount),
      })),
      total,
    }
  }

  async getContactNotes(contactHash: string, hubId?: string): Promise<EncryptedNote[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(noteEnvelopes)
      .where(and(eq(noteEnvelopes.hubId, hId), eq(noteEnvelopes.contactHash, contactHash)))
      .orderBy(desc(noteEnvelopes.createdAt))
    return rows.map((r) => this.#rowToNote(r))
  }

  // ------------------------------------------------------------------ Audit Log

  async addAuditEntry(
    hubId: string,
    event: string,
    actorPubkey: string,
    details?: Record<string, unknown>
  ): Promise<AuditLogEntry> {
    const hId = hubId ?? 'global'

    // Encrypt event and details with server-key (done outside transaction to minimize hold time)
    const encryptedEvent = this.crypto.serverEncrypt(event, LABEL_AUDIT_EVENT)
    const encryptedDetails = this.crypto.serverEncrypt(
      JSON.stringify(details ?? {}),
      LABEL_AUDIT_EVENT
    )

    const id = crypto.randomUUID()

    // Wrap SELECT + INSERT in a transaction to prevent hash chain branching under concurrency.
    // Default PostgreSQL isolation (READ COMMITTED) does NOT prevent two concurrent transactions
    // from both reading the same "last entry" and then both inserting with identical
    // previousEntryHash — branching the chain. We serialize per-hub via an advisory lock
    // keyed on the hub id, which holds for the duration of the transaction.
    const row = await this.db.transaction(async (tx) => {
      // Acquire a transaction-scoped advisory lock keyed on hubId. Concurrent
      // addAuditEntry calls for the same hub will wait here until the lock is released.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${hId}))`)

      // Capture the timestamp via clock_timestamp() AFTER acquiring the advisory lock,
      // so that two concurrent inserts (Promise.all) get strictly monotonic timestamps.
      // JS `new Date()` has only millisecond resolution and races on fast event loops —
      // postgres clock_timestamp() has microsecond resolution and is captured serially
      // because the lock has already serialized us. This makes ORDER BY createdAt
      // a stable read order for hash-chain verification.
      const tsRow = await tx.execute(sql`SELECT clock_timestamp() AS now`)
      const now = new Date((tsRow as Array<{ now: string | Date }>)[0].now as string | Date)

      // Get last entry hash for chain (within transaction for consistency)
      const lastRows = await tx
        .select({ entryHash: auditLog.entryHash })
        .from(auditLog)
        .where(eq(auditLog.hubId, hId))
        .orderBy(desc(auditLog.createdAt))
        .limit(1)
      const previousEntryHash = lastRows[0]?.entryHash ?? null

      // Compute hash chain
      const payload = `${event}${actorPubkey}${JSON.stringify(details ?? {})}${previousEntryHash ?? ''}${now.toISOString()}`
      const entryHash = bytesToHex(sha256(utf8ToBytes(payload)))

      const [inserted] = await tx
        .insert(auditLog)
        .values({
          id,
          hubId: hId,
          actorPubkey,
          encryptedEvent,
          encryptedDetails,
          previousEntryHash,
          entryHash,
          createdAt: now,
        })
        .returning()
      return inserted
    })

    return {
      id: row.id,
      event,
      actorPubkey: row.actorPubkey,
      details: details ?? {},
      createdAt: row.createdAt.toISOString(),
      previousEntryHash: row.previousEntryHash ?? undefined,
      entryHash: row.entryHash ?? undefined,
    }
  }

  async getAuditLog(filters: AuditFilters): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const hId = filters.hubId ?? 'global'
    const page = filters.page ?? 1
    const limit = filters.limit ?? 50

    const conditions: ReturnType<typeof eq>[] = [eq(auditLog.hubId, hId)]
    if (filters.actorPubkey) {
      conditions.push(eq(auditLog.actorPubkey, filters.actorPubkey))
    }
    if (filters.dateFrom) {
      conditions.push(gte(auditLog.createdAt, new Date(filters.dateFrom)))
    }
    if (filters.dateTo) {
      const toDate = new Date(`${filters.dateTo}T23:59:59.999Z`)
      conditions.push(lte(auditLog.createdAt, toDate))
    }

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))

    // Event type category filtering (in-memory)
    const eventCategories: Record<string, string[]> = {
      authentication: [
        'login',
        'logout',
        'sessionCreated',
        'sessionExpired',
        'passkeyRegistered',
        'deviceLinked',
      ],
      users: [
        'userAdded',
        'userRemoved',
        'userRoleChanged',
        'userActivated',
        'userDeactivated',
        'userOnBreak',
        'userOffBreak',
        'inviteCreated',
        'inviteRedeemed',
      ],
      calls: ['callAnswered', 'callEnded', 'callMissed', 'spamReported', 'voicemailReceived'],
      settings: [
        'settingsUpdated',
        'telephonyConfigured',
        'transcriptionToggled',
        'ivrUpdated',
        'customFieldsUpdated',
        'spamSettingsUpdated',
        'callSettingsUpdated',
      ],
      shifts: ['shiftCreated', 'shiftUpdated', 'shiftDeleted'],
      notes: ['noteCreated', 'noteUpdated'],
      messaging: [
        'messageSent',
        'conversationClaimed',
        'conversationClosed',
        'conversationUpdated',
        'reportCreated',
        'reportAssigned',
        'reportUpdated',
      ],
    }

    let entries = rows.map((r) => {
      const decryptedEvent = this.crypto.serverDecrypt(
        r.encryptedEvent as Ciphertext,
        LABEL_AUDIT_EVENT
      )
      const decryptedDetails = JSON.parse(
        this.crypto.serverDecrypt(r.encryptedDetails as Ciphertext, LABEL_AUDIT_EVENT)
      ) as Record<string, unknown>

      return {
        id: r.id,
        event: decryptedEvent,
        actorPubkey: r.actorPubkey,
        details: decryptedDetails,
        createdAt: r.createdAt.toISOString(),
        previousEntryHash: r.previousEntryHash ?? undefined,
        entryHash: r.entryHash ?? undefined,
      }
    })

    if (filters.eventType && eventCategories[filters.eventType]) {
      const allowed = eventCategories[filters.eventType]
      entries = entries.filter((e) => allowed.includes(e.event))
    }
    if (filters.search) {
      const lower = filters.search.toLowerCase()
      entries = entries.filter(
        (e) =>
          e.event.toLowerCase().includes(lower) ||
          e.actorPubkey.toLowerCase().includes(lower) ||
          JSON.stringify(e.details).toLowerCase().includes(lower)
      )
    }

    const total = entries.length
    const start = (page - 1) * limit
    return { entries: entries.slice(start, start + limit), total }
  }

  // ------------------------------------------------------------------ Analytics

  async getCallVolumeByDay(hubId: string | undefined, days: 7 | 30): Promise<CallVolumeDay[]> {
    const hId = hubId ?? 'global'
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setUTCHours(0, 0, 0, 0)

    const rows = await this.db
      .select({
        date: sql<string>`DATE(${callRecords.startedAt})`.as('date'),
        count: sql<number>`COUNT(*)::int`.as('count'),
        answered:
          sql<number>`SUM(CASE WHEN ${callRecords.status} = 'completed' AND NOT ${callRecords.hasVoicemail} THEN 1 ELSE 0 END)::int`.as(
            'answered'
          ),
        voicemail:
          sql<number>`SUM(CASE WHEN ${callRecords.hasVoicemail} THEN 1 ELSE 0 END)::int`.as(
            'voicemail'
          ),
      })
      .from(callRecords)
      .where(and(eq(callRecords.hubId, hId), gte(callRecords.startedAt, since)))
      .groupBy(sql`DATE(${callRecords.startedAt})`)
      .orderBy(sql`DATE(${callRecords.startedAt}) ASC`)

    return rows.map((r) => ({
      date: r.date,
      count: Number(r.count),
      answered: Number(r.answered),
      voicemail: Number(r.voicemail),
    }))
  }

  async getCallHourDistribution(hubId: string | undefined, days: 30): Promise<CallHourBucket[]> {
    const hId = hubId ?? 'global'
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setUTCHours(0, 0, 0, 0)

    const rows = await this.db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${callRecords.startedAt})::int`.as('hour'),
        count: sql<number>`COUNT(*)::int`.as('count'),
      })
      .from(callRecords)
      .where(and(eq(callRecords.hubId, hId), gte(callRecords.startedAt, since)))
      .groupBy(sql`EXTRACT(HOUR FROM ${callRecords.startedAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${callRecords.startedAt}) ASC`)

    // Fill all 24 hours, defaulting to 0
    const map = new Map<number, number>()
    for (const r of rows) {
      map.set(Number(r.hour), Number(r.count))
    }
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, count: map.get(h) ?? 0 }))
  }

  async getUserCallStats(
    hubId: string | undefined,
    days: 30
  ): Promise<Array<{ pubkey: string; callsAnswered: number; avgDuration: number }>> {
    const hId = hubId ?? 'global'
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setUTCHours(0, 0, 0, 0)

    // NOTE: answeredBy (user pubkey) is stored inside encrypted content for privacy.
    // We can only do user-level stats from the audit log where callAnswered events record actorPubkey.
    // Event column is encrypted — fetch all entries in range and filter post-decrypt.
    const rows = await this.db
      .select({
        actorPubkey: auditLog.actorPubkey,
        encryptedEvent: auditLog.encryptedEvent,
      })
      .from(auditLog)
      .where(and(eq(auditLog.hubId, hId), gte(auditLog.createdAt, since)))

    // Decrypt event and keep only callAnswered entries
    const callAnsweredByPubkey = new Map<string, number>()
    for (const r of rows) {
      const event = this.crypto.serverDecrypt(r.encryptedEvent as Ciphertext, LABEL_AUDIT_EVENT)
      if (event === 'callAnswered') {
        callAnsweredByPubkey.set(r.actorPubkey, (callAnsweredByPubkey.get(r.actorPubkey) ?? 0) + 1)
      }
    }

    return Array.from(callAnsweredByPubkey.entries())
      .map(([pubkey, callsAnswered]) => ({
        pubkey,
        callsAnswered,
        avgDuration: 0, // Duration is encrypted; not available without decryption
      }))
      .sort((a, b) => b.callsAnswered - a.callsAnswered)
  }

  // ------------------------------------------------------------------ Admin Pubkey Helper

  /** Return pubkeys of all active super-admin users for E2EE envelope recipients */
  async #getSuperAdminPubkeys(): Promise<string[]> {
    const rows = await this.db
      .select({ pubkey: users.pubkey, roles: users.roles })
      .from(users)
      .where(eq(users.active, true))
    return rows
      .filter((r) => (r.roles as string[]).includes('role-super-admin'))
      .map((r) => r.pubkey)
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToCallRecord(r: typeof callRecords.$inferSelect): EncryptedCallRecord {
    const cl4Env = (r.callerLast4Envelopes as RecipientEnvelope[]) ?? []
    return {
      id: r.id,
      callerLast4: cl4Env.length > 0 ? '[encrypted]' : undefined,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString(),
      duration: r.duration ?? undefined,
      status: r.status as 'completed' | 'unanswered',
      hasTranscription: r.hasTranscription,
      hasVoicemail: r.hasVoicemail,
      hasRecording: r.hasRecording ?? undefined,
      recordingSid: r.recordingSid ?? undefined,
      voicemailFileId: r.voicemailFileId ?? null,
      encryptedContent: r.encryptedContent ?? '',
      adminEnvelopes: (r.adminEnvelopes as RecipientEnvelope[]) ?? [],
      // E2EE envelope fields for client-side decryption
      ...(cl4Env.length > 0
        ? {
            encryptedCallerLast4: r.encryptedCallerLast4 as string,
            callerLast4Envelopes: cl4Env,
          }
        : {}),
    }
  }

  #rowToNote(r: typeof noteEnvelopes.$inferSelect): EncryptedNote {
    return {
      id: r.id,
      hubId: r.hubId,
      callId: r.callId ?? undefined,
      conversationId: r.conversationId ?? undefined,
      contactHash: r.contactHash ?? undefined,
      authorPubkey: r.authorPubkey,
      // encryptedContent + ephemeralPubkey retained for server-created transcription notes
      encryptedContent: r.encryptedContent ?? undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      ephemeralPubkey: r.ephemeralPubkey ?? undefined,
      mlsCiphertext: r.mlsCiphertext ?? undefined,
      mlsEpoch: r.mlsEpoch ?? undefined,
      replyCount: r.replyCount,
    }
  }

  async getCallRecordsByIds(ids: string[], hubId: string) {
    if (ids.length === 0) return []
    return this.db
      .select()
      .from(callRecords)
      .where(and(eq(callRecords.hubId, hubId), inArray(callRecords.id, ids)))
      .orderBy(desc(callRecords.startedAt))
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(auditLog)
    await this.db.delete(bans)
    await this.db.delete(callRecords)
    await this.db.delete(noteEnvelopes)
  }
}
