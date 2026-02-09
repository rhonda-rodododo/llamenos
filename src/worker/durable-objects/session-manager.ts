import { DurableObject } from 'cloudflare:workers'
import type { Env, Volunteer, BanEntry, EncryptedNote, AuditLogEntry, SpamSettings, InviteCode } from '../types'

/**
 * SessionManagerDO — manages all persistent data:
 * - Volunteers (CRUD)
 * - Ban list
 * - Notes (encrypted)
 * - Audit log
 * - Spam/transcription settings
 *
 * Uses DO storage (SQL-backed) for persistence.
 * Single global instance accessed via a fixed ID.
 */
export class SessionManagerDO extends DurableObject<Env> {
  private initialized = false

  private async ensureInit() {
    if (this.initialized) return
    this.initialized = true
    // Ensure ADMIN_PUBKEY always exists as an admin volunteer
    const adminPubkey = this.env.ADMIN_PUBKEY
    const volunteers = await this.ctx.storage.get<Record<string, Volunteer>>('volunteers') || {}
    if (adminPubkey && !volunteers[adminPubkey]) {
      volunteers[adminPubkey] = {
        pubkey: adminPubkey,
        name: 'Admin',
        phone: '',
        role: 'admin',
        active: true,
        createdAt: new Date().toISOString(),
        encryptedSecretKey: '',
        transcriptionEnabled: true,
        spokenLanguages: ['en', 'es'],
        uiLanguage: 'en',
        profileCompleted: true,
        onBreak: false,
      }
      await this.ctx.storage.put('volunteers', volunteers)
    }

    // Init defaults
    if (!(await this.ctx.storage.get('spamSettings'))) {
      await this.ctx.storage.put<SpamSettings>('spamSettings', {
        voiceCaptchaEnabled: false,
        rateLimitEnabled: true,
        maxCallsPerMinute: 3,
        blockDurationMinutes: 30,
      })
    }
    if (await this.ctx.storage.get('transcriptionEnabled') === undefined) {
      await this.ctx.storage.put('transcriptionEnabled', true)
    }
    if (!(await this.ctx.storage.get('fallbackGroup'))) {
      await this.ctx.storage.put('fallbackGroup', [] as string[])
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInit()
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // --- Volunteers ---
    if (path === '/volunteers' && method === 'GET') {
      return this.getVolunteers()
    }
    if (path === '/volunteers' && method === 'POST') {
      return this.createVolunteer(await request.json())
    }
    if (path.startsWith('/volunteer/') && method === 'GET') {
      const pubkey = path.split('/volunteer/')[1]
      return this.getVolunteer(pubkey)
    }
    if (path.startsWith('/volunteers/') && method === 'PATCH') {
      const pubkey = path.split('/volunteers/')[1]
      return this.updateVolunteer(pubkey, await request.json())
    }
    if (path.startsWith('/volunteers/') && method === 'DELETE') {
      const pubkey = path.split('/volunteers/')[1]
      return this.deleteVolunteer(pubkey)
    }

    // --- Bans ---
    if (path === '/bans' && method === 'GET') {
      return this.getBans()
    }
    if (path === '/bans' && method === 'POST') {
      return this.addBan(await request.json())
    }
    if (path.startsWith('/bans/bulk') && method === 'POST') {
      return this.bulkAddBans(await request.json())
    }
    if (path.startsWith('/bans/') && method === 'DELETE') {
      const phone = decodeURIComponent(path.split('/bans/')[1])
      return this.removeBan(phone)
    }
    if (path.startsWith('/bans/check/') && method === 'GET') {
      const phone = decodeURIComponent(path.split('/bans/check/')[1])
      return this.checkBan(phone)
    }

    // --- Notes ---
    if (path === '/notes' && method === 'GET') {
      const authorPubkey = url.searchParams.get('author')
      const callId = url.searchParams.get('callId')
      const page = url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!) : undefined
      const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined
      return this.getNotes(authorPubkey, callId, page, limit)
    }
    if (path === '/notes' && method === 'POST') {
      return this.createNoteEntry(await request.json())
    }
    if (path.startsWith('/notes/') && method === 'PATCH') {
      const id = path.split('/notes/')[1]
      return this.updateNoteEntry(id, await request.json())
    }

    // --- Audit Log ---
    if (path === '/audit' && method === 'GET') {
      const page = parseInt(url.searchParams.get('page') || '1')
      const limit = parseInt(url.searchParams.get('limit') || '50')
      return this.getAuditLog(page, limit)
    }
    if (path === '/audit' && method === 'POST') {
      return this.addAuditEntry(await request.json())
    }

    // --- Settings ---
    if (path === '/settings/spam' && method === 'GET') {
      return this.getSpamSettings()
    }
    if (path === '/settings/spam' && method === 'PATCH') {
      return this.updateSpamSettings(await request.json())
    }
    if (path === '/settings/transcription' && method === 'GET') {
      return this.getTranscriptionSettings()
    }
    if (path === '/settings/transcription' && method === 'PATCH') {
      return this.updateTranscriptionSettings(await request.json())
    }

    // --- Invites ---
    if (path === '/invites' && method === 'GET') {
      return this.getInvites()
    }
    if (path === '/invites' && method === 'POST') {
      return this.createInvite(await request.json())
    }
    if (path.startsWith('/invites/validate/') && method === 'GET') {
      const code = path.split('/invites/validate/')[1]
      return this.validateInvite(code)
    }
    if (path === '/invites/redeem' && method === 'POST') {
      return this.redeemInvite(await request.json())
    }
    if (path.startsWith('/invites/') && method === 'DELETE') {
      const code = path.split('/invites/')[1]
      return this.revokeInvite(code)
    }

    // --- Shifts / Fallback ---
    if (path === '/fallback' && method === 'GET') {
      return this.getFallbackGroup()
    }
    if (path === '/fallback' && method === 'PUT') {
      return this.setFallbackGroup(await request.json())
    }

    // --- Test Reset (development only) ---
    if (path === '/reset' && method === 'POST') {
      await this.ctx.storage.deleteAll()
      this.initialized = false
      await this.ensureInit()
      return Response.json({ ok: true })
    }

    return new Response('Not Found', { status: 404 })
  }

  // --- Volunteer Methods ---

  private async getVolunteers(): Promise<Response> {
    const volunteers = await this.ctx.storage.get<Record<string, Volunteer>>('volunteers') || {}
    return Response.json({
      volunteers: Object.values(volunteers).map(v => ({ ...v, encryptedSecretKey: undefined })),
    })
  }

  private async getVolunteer(pubkey: string): Promise<Response> {
    const volunteers = await this.ctx.storage.get<Record<string, Volunteer>>('volunteers') || {}
    const vol = volunteers[pubkey]
    if (!vol) return new Response('Not found', { status: 404 })
    return Response.json({ ...vol, encryptedSecretKey: undefined })
  }

  private async createVolunteer(data: {
    pubkey: string
    name: string
    phone: string
    role: 'volunteer' | 'admin'
    encryptedSecretKey: string
  }): Promise<Response> {
    const volunteers = await this.ctx.storage.get<Record<string, Volunteer>>('volunteers') || {}
    const volunteer: Volunteer = {
      pubkey: data.pubkey,
      name: data.name,
      phone: data.phone,
      role: data.role,
      active: true,
      createdAt: new Date().toISOString(),
      encryptedSecretKey: data.encryptedSecretKey,
      transcriptionEnabled: true,
      spokenLanguages: ['en'],
      uiLanguage: 'en',
      profileCompleted: false,
      onBreak: false,
    }
    volunteers[data.pubkey] = volunteer
    await this.ctx.storage.put('volunteers', volunteers)
    return Response.json({ volunteer: { ...volunteer, encryptedSecretKey: undefined } })
  }

  private async updateVolunteer(pubkey: string, data: Partial<Volunteer>): Promise<Response> {
    const volunteers = await this.ctx.storage.get<Record<string, Volunteer>>('volunteers') || {}
    const vol = volunteers[pubkey]
    if (!vol) return new Response('Not found', { status: 404 })
    Object.assign(vol, data, { pubkey }) // Don't allow changing pubkey
    volunteers[pubkey] = vol
    await this.ctx.storage.put('volunteers', volunteers)
    return Response.json({ volunteer: { ...vol, encryptedSecretKey: undefined } })
  }

  private async deleteVolunteer(pubkey: string): Promise<Response> {
    const volunteers = await this.ctx.storage.get<Record<string, Volunteer>>('volunteers') || {}
    delete volunteers[pubkey]
    await this.ctx.storage.put('volunteers', volunteers)
    return Response.json({ ok: true })
  }

  // --- Ban Methods ---

  private async getBans(): Promise<Response> {
    const bans = await this.ctx.storage.get<BanEntry[]>('bans') || []
    return Response.json({ bans })
  }

  private async addBan(data: { phone: string; reason: string; bannedBy: string }): Promise<Response> {
    const bans = await this.ctx.storage.get<BanEntry[]>('bans') || []
    const ban: BanEntry = {
      phone: data.phone,
      reason: data.reason,
      bannedBy: data.bannedBy,
      bannedAt: new Date().toISOString(),
    }
    bans.push(ban)
    await this.ctx.storage.put('bans', bans)
    return Response.json({ ban })
  }

  private async bulkAddBans(data: { phones: string[]; reason: string; bannedBy: string }): Promise<Response> {
    const bans = await this.ctx.storage.get<BanEntry[]>('bans') || []
    const existing = new Set(bans.map(b => b.phone))
    let count = 0
    for (const phone of data.phones) {
      if (!existing.has(phone)) {
        bans.push({
          phone,
          reason: data.reason,
          bannedBy: data.bannedBy,
          bannedAt: new Date().toISOString(),
        })
        count++
      }
    }
    await this.ctx.storage.put('bans', bans)
    return Response.json({ count })
  }

  private async removeBan(phone: string): Promise<Response> {
    const bans = await this.ctx.storage.get<BanEntry[]>('bans') || []
    await this.ctx.storage.put('bans', bans.filter(b => b.phone !== phone))
    return Response.json({ ok: true })
  }

  private async checkBan(phone: string): Promise<Response> {
    const bans = await this.ctx.storage.get<BanEntry[]>('bans') || []
    const banned = bans.some(b => b.phone === phone)
    return Response.json({ banned })
  }

  // --- Note Methods ---

  private async getNotes(authorPubkey: string | null, callId: string | null, page?: number, limit?: number): Promise<Response> {
    const notes = await this.ctx.storage.get<EncryptedNote[]>('notes') || []
    let filtered = notes
    if (authorPubkey) {
      filtered = filtered.filter(n => n.authorPubkey === authorPubkey)
    }
    if (callId) {
      filtered = filtered.filter(n => n.callId === callId)
    }
    // Sort newest first
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const total = filtered.length
    if (page && limit) {
      const start = (page - 1) * limit
      filtered = filtered.slice(start, start + limit)
    }
    return Response.json({ notes: filtered, total })
  }

  private async createNoteEntry(data: { callId: string; authorPubkey: string; encryptedContent: string; ephemeralPubkey?: string }): Promise<Response> {
    const notes = await this.ctx.storage.get<EncryptedNote[]>('notes') || []
    const note: EncryptedNote = {
      id: crypto.randomUUID(),
      callId: data.callId,
      authorPubkey: data.authorPubkey,
      encryptedContent: data.encryptedContent,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(data.ephemeralPubkey ? { ephemeralPubkey: data.ephemeralPubkey } : {}),
    }
    notes.push(note)
    await this.ctx.storage.put('notes', notes)
    return Response.json({ note })
  }

  private async updateNoteEntry(id: string, data: { encryptedContent: string; authorPubkey: string }): Promise<Response> {
    const notes = await this.ctx.storage.get<EncryptedNote[]>('notes') || []
    const note = notes.find(n => n.id === id)
    if (!note) return new Response('Not found', { status: 404 })
    if (note.authorPubkey !== data.authorPubkey) return new Response('Forbidden', { status: 403 })
    note.encryptedContent = data.encryptedContent
    note.updatedAt = new Date().toISOString()
    await this.ctx.storage.put('notes', notes)
    return Response.json({ note })
  }

  // --- Audit Log Methods ---

  private async getAuditLog(page: number, limit: number): Promise<Response> {
    const entries = await this.ctx.storage.get<AuditLogEntry[]>('auditLog') || []
    const sorted = entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const start = (page - 1) * limit
    return Response.json({
      entries: sorted.slice(start, start + limit),
      total: sorted.length,
    })
  }

  private async addAuditEntry(data: { event: string; actorPubkey: string; details: Record<string, unknown> }): Promise<Response> {
    const entries = await this.ctx.storage.get<AuditLogEntry[]>('auditLog') || []
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      event: data.event,
      actorPubkey: data.actorPubkey,
      details: data.details,
      createdAt: new Date().toISOString(),
    }
    entries.push(entry)
    await this.ctx.storage.put('auditLog', entries)
    return Response.json({ entry })
  }

  // --- Invite Methods ---

  private async getInvites(): Promise<Response> {
    const invites = await this.ctx.storage.get<InviteCode[]>('invites') || []
    return Response.json({ invites: invites.filter(i => !i.usedAt) })
  }

  private async createInvite(data: { name: string; phone: string; role: 'volunteer' | 'admin'; createdBy: string }): Promise<Response> {
    const invites = await this.ctx.storage.get<InviteCode[]>('invites') || []
    const code = crypto.randomUUID()
    const invite: InviteCode = {
      code,
      name: data.name,
      phone: data.phone,
      role: data.role,
      createdBy: data.createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    }
    invites.push(invite)
    await this.ctx.storage.put('invites', invites)
    return Response.json({ invite })
  }

  private async validateInvite(code: string): Promise<Response> {
    const invites = await this.ctx.storage.get<InviteCode[]>('invites') || []
    const invite = invites.find(i => i.code === code)
    if (!invite) return Response.json({ valid: false, error: 'not_found' })
    if (invite.usedAt) return Response.json({ valid: false, error: 'already_used' })
    if (new Date(invite.expiresAt) < new Date()) return Response.json({ valid: false, error: 'expired' })
    return Response.json({ valid: true, name: invite.name, role: invite.role })
  }

  private async redeemInvite(data: { code: string; pubkey: string }): Promise<Response> {
    const invites = await this.ctx.storage.get<InviteCode[]>('invites') || []
    const invite = invites.find(i => i.code === data.code)
    if (!invite) return new Response(JSON.stringify({ error: 'Invalid invite code' }), { status: 400 })
    if (invite.usedAt) return new Response(JSON.stringify({ error: 'Invite already used' }), { status: 400 })
    if (new Date(invite.expiresAt) < new Date()) return new Response(JSON.stringify({ error: 'Invite expired' }), { status: 400 })

    // Mark invite as used
    invite.usedAt = new Date().toISOString()
    invite.usedBy = data.pubkey
    await this.ctx.storage.put('invites', invites)

    // Create volunteer
    const volunteers = await this.ctx.storage.get<Record<string, Volunteer>>('volunteers') || {}
    const volunteer: Volunteer = {
      pubkey: data.pubkey,
      name: invite.name,
      phone: invite.phone,
      role: invite.role,
      active: true,
      createdAt: new Date().toISOString(),
      encryptedSecretKey: '',
      transcriptionEnabled: true,
      spokenLanguages: ['en'],
      uiLanguage: 'en',
      profileCompleted: false,
      onBreak: false,
    }
    volunteers[data.pubkey] = volunteer
    await this.ctx.storage.put('volunteers', volunteers)
    return Response.json({ volunteer: { ...volunteer, encryptedSecretKey: undefined } })
  }

  private async revokeInvite(code: string): Promise<Response> {
    const invites = await this.ctx.storage.get<InviteCode[]>('invites') || []
    await this.ctx.storage.put('invites', invites.filter(i => i.code !== code))
    return Response.json({ ok: true })
  }

  // --- Settings Methods ---

  private async getSpamSettings(): Promise<Response> {
    const settings = await this.ctx.storage.get<SpamSettings>('spamSettings')
    return Response.json(settings)
  }

  private async updateSpamSettings(data: Partial<SpamSettings>): Promise<Response> {
    const settings = await this.ctx.storage.get<SpamSettings>('spamSettings')!
    const updated = { ...settings, ...data }
    await this.ctx.storage.put('spamSettings', updated)
    return Response.json(updated)
  }

  private async getTranscriptionSettings(): Promise<Response> {
    const enabled = await this.ctx.storage.get<boolean>('transcriptionEnabled')
    return Response.json({ globalEnabled: enabled ?? true })
  }

  private async updateTranscriptionSettings(data: { globalEnabled: boolean }): Promise<Response> {
    await this.ctx.storage.put('transcriptionEnabled', data.globalEnabled)
    return Response.json({ globalEnabled: data.globalEnabled })
  }

  // --- Fallback Group ---

  private async getFallbackGroup(): Promise<Response> {
    const group = await this.ctx.storage.get<string[]>('fallbackGroup') || []
    return Response.json({ volunteers: group })
  }

  private async setFallbackGroup(data: { volunteers: string[] }): Promise<Response> {
    await this.ctx.storage.put('fallbackGroup', data.volunteers)
    return Response.json({ ok: true })
  }
}
