import { DurableObject } from 'cloudflare:workers'
import type { Env, Volunteer, BanEntry, EncryptedNote, AuditLogEntry, SpamSettings, CallSettings, InviteCode, WebAuthnCredential, WebAuthnSettings, ServerSession } from '../types'
import { IVR_LANGUAGES } from '../../shared/languages'
import { hashPhone } from '../lib/crypto'

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
    if (!(await this.ctx.storage.get('ivrLanguages'))) {
      await this.ctx.storage.put('ivrLanguages', [...IVR_LANGUAGES])
    }
    if (!(await this.ctx.storage.get('callSettings'))) {
      await this.ctx.storage.put<CallSettings>('callSettings', {
        queueTimeoutSeconds: 90,
        voicemailMaxSeconds: 120,
      })
    }
    if (!(await this.ctx.storage.get('webauthnSettings'))) {
      await this.ctx.storage.put<WebAuthnSettings>('webauthnSettings', {
        requireForAdmins: false,
        requireForVolunteers: false,
      })
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
    if (path === '/settings/call' && method === 'GET') {
      return this.getCallSettings()
    }
    if (path === '/settings/call' && method === 'PATCH') {
      return this.updateCallSettings(await request.json())
    }
    if (path === '/settings/ivr-languages' && method === 'GET') {
      return this.getIvrLanguages()
    }
    if (path === '/settings/ivr-languages' && method === 'PATCH') {
      return this.updateIvrLanguages(await request.json())
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

    // --- IVR Audio ---
    if (path === '/settings/ivr-audio' && method === 'GET') {
      return this.getIvrAudioList()
    }
    if (path.startsWith('/settings/ivr-audio/') && method === 'PUT') {
      const parts = path.replace('/settings/ivr-audio/', '').split('/')
      if (parts.length !== 2) return new Response('Invalid path', { status: 400 })
      return this.uploadIvrAudio(parts[0], parts[1], await request.arrayBuffer())
    }
    if (path.startsWith('/settings/ivr-audio/') && method === 'GET') {
      const parts = path.replace('/settings/ivr-audio/', '').split('/')
      if (parts.length !== 2) return new Response('Invalid path', { status: 400 })
      return this.getIvrAudio(parts[0], parts[1])
    }
    if (path.startsWith('/settings/ivr-audio/') && method === 'DELETE') {
      const parts = path.replace('/settings/ivr-audio/', '').split('/')
      if (parts.length !== 2) return new Response('Invalid path', { status: 400 })
      return this.deleteIvrAudio(parts[0], parts[1])
    }

    // --- Rate Limiting ---
    if (path === '/rate-limit/check' && method === 'POST') {
      return this.checkRateLimit(await request.json())
    }

    // --- Shifts / Fallback ---
    if (path === '/fallback' && method === 'GET') {
      return this.getFallbackGroup()
    }
    if (path === '/fallback' && method === 'PUT') {
      return this.setFallbackGroup(await request.json())
    }

    // --- WebAuthn Credentials ---
    if (path === '/webauthn/credentials' && method === 'GET') {
      const pubkey = url.searchParams.get('pubkey')
      if (!pubkey) return new Response('Missing pubkey', { status: 400 })
      return this.getWebAuthnCredentials(pubkey)
    }
    if (path === '/webauthn/credentials' && method === 'POST') {
      return this.addWebAuthnCredential(await request.json())
    }
    if (path.startsWith('/webauthn/credentials/') && method === 'DELETE') {
      const credId = decodeURIComponent(path.split('/webauthn/credentials/')[1])
      const pubkey = url.searchParams.get('pubkey')
      if (!pubkey) return new Response('Missing pubkey', { status: 400 })
      return this.deleteWebAuthnCredential(pubkey, credId)
    }
    if (path === '/webauthn/credentials/update-counter' && method === 'POST') {
      return this.updateWebAuthnCounter(await request.json())
    }

    // --- WebAuthn Challenges ---
    if (path === '/webauthn/challenge' && method === 'POST') {
      return this.storeWebAuthnChallenge(await request.json())
    }
    if (path.startsWith('/webauthn/challenge/') && method === 'GET') {
      const challengeId = path.split('/webauthn/challenge/')[1]
      return this.getWebAuthnChallenge(challengeId)
    }

    // --- WebAuthn All Credentials (for login — find by credential ID) ---
    if (path === '/webauthn/all-credentials' && method === 'GET') {
      return this.getAllWebAuthnCredentials()
    }

    // --- WebAuthn Settings ---
    if (path === '/settings/webauthn' && method === 'GET') {
      return this.getWebAuthnSettings()
    }
    if (path === '/settings/webauthn' && method === 'PATCH') {
      return this.updateWebAuthnSettings(await request.json())
    }

    // --- Server Sessions ---
    if (path === '/sessions/create' && method === 'POST') {
      return this.createSession(await request.json())
    }
    if (path.startsWith('/sessions/validate/') && method === 'GET') {
      const token = path.split('/sessions/validate/')[1]
      return this.validateSession(token)
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
    const hashed = hashPhone(data.phone)
    const ban: BanEntry = {
      phone: hashed,
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
      const hashed = hashPhone(phone)
      if (!existing.has(hashed)) {
        bans.push({
          phone: hashed,
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
    // Phone comes pre-hashed from the API layer
    await this.ctx.storage.put('bans', bans.filter(b => b.phone !== phone))
    return Response.json({ ok: true })
  }

  private async checkBan(phone: string): Promise<Response> {
    const bans = await this.ctx.storage.get<BanEntry[]>('bans') || []
    const hashed = hashPhone(phone)
    const banned = bans.some(b => b.phone === hashed)
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

  private async getIvrLanguages(): Promise<Response> {
    const languages = await this.ctx.storage.get<string[]>('ivrLanguages') || [...IVR_LANGUAGES]
    return Response.json({ enabledLanguages: languages })
  }

  private async updateIvrLanguages(data: { enabledLanguages: string[] }): Promise<Response> {
    if (!Array.isArray(data.enabledLanguages) || data.enabledLanguages.length === 0) {
      return new Response(JSON.stringify({ error: 'At least one language must be enabled' }), { status: 400 })
    }
    const valid = data.enabledLanguages.filter(code => IVR_LANGUAGES.includes(code))
    if (valid.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid IVR language codes provided' }), { status: 400 })
    }
    await this.ctx.storage.put('ivrLanguages', valid)
    return Response.json({ enabledLanguages: valid })
  }

  private async getTranscriptionSettings(): Promise<Response> {
    const enabled = await this.ctx.storage.get<boolean>('transcriptionEnabled')
    return Response.json({ globalEnabled: enabled ?? true })
  }

  private async updateTranscriptionSettings(data: { globalEnabled: boolean }): Promise<Response> {
    await this.ctx.storage.put('transcriptionEnabled', data.globalEnabled)
    return Response.json({ globalEnabled: data.globalEnabled })
  }

  private async getCallSettings(): Promise<Response> {
    const settings = await this.ctx.storage.get<CallSettings>('callSettings') || {
      queueTimeoutSeconds: 90,
      voicemailMaxSeconds: 120,
    }
    return Response.json(settings)
  }

  private async updateCallSettings(data: Partial<CallSettings>): Promise<Response> {
    const current = await this.ctx.storage.get<CallSettings>('callSettings') || {
      queueTimeoutSeconds: 90,
      voicemailMaxSeconds: 120,
    }
    const clamp = (v: number) => Math.max(30, Math.min(300, v))
    const updated: CallSettings = {
      queueTimeoutSeconds: data.queueTimeoutSeconds !== undefined ? clamp(data.queueTimeoutSeconds) : current.queueTimeoutSeconds,
      voicemailMaxSeconds: data.voicemailMaxSeconds !== undefined ? clamp(data.voicemailMaxSeconds) : current.voicemailMaxSeconds,
    }
    await this.ctx.storage.put('callSettings', updated)
    return Response.json(updated)
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

  // --- Rate Limit Methods (persistent, survives restarts) ---

  private async checkRateLimit(data: { key: string; maxPerMinute: number }): Promise<Response> {
    const storageKey = `ratelimit:${data.key}`
    const now = Date.now()
    const windowMs = 60_000
    const timestamps = await this.ctx.storage.get<number[]>(storageKey) || []
    const recent = timestamps.filter(t => now - t < windowMs)
    recent.push(now)
    await this.ctx.storage.put(storageKey, recent)

    // Schedule cleanup alarm (1 minute from now)
    try { await this.ctx.storage.setAlarm(now + windowMs + 1000) } catch { /* alarm already set */ }

    const limited = recent.length > data.maxPerMinute
    return Response.json({ limited })
  }

  // --- WebAuthn Credential Methods ---

  private async getWebAuthnCredentials(pubkey: string): Promise<Response> {
    const creds = await this.ctx.storage.get<WebAuthnCredential[]>(`webauthn:creds:${pubkey}`) || []
    return Response.json({ credentials: creds })
  }

  private async addWebAuthnCredential(data: { pubkey: string; credential: WebAuthnCredential }): Promise<Response> {
    const key = `webauthn:creds:${data.pubkey}`
    const creds = await this.ctx.storage.get<WebAuthnCredential[]>(key) || []
    creds.push(data.credential)
    await this.ctx.storage.put(key, creds)
    return Response.json({ ok: true })
  }

  private async deleteWebAuthnCredential(pubkey: string, credId: string): Promise<Response> {
    const key = `webauthn:creds:${pubkey}`
    const creds = await this.ctx.storage.get<WebAuthnCredential[]>(key) || []
    const filtered = creds.filter(c => c.id !== credId)
    if (filtered.length === creds.length) return new Response('Credential not found', { status: 404 })
    await this.ctx.storage.put(key, filtered)
    return Response.json({ ok: true })
  }

  private async updateWebAuthnCounter(data: { pubkey: string; credId: string; counter: number; lastUsedAt: string }): Promise<Response> {
    const key = `webauthn:creds:${data.pubkey}`
    const creds = await this.ctx.storage.get<WebAuthnCredential[]>(key) || []
    const cred = creds.find(c => c.id === data.credId)
    if (!cred) return new Response('Credential not found', { status: 404 })
    cred.counter = data.counter
    cred.lastUsedAt = data.lastUsedAt
    await this.ctx.storage.put(key, creds)
    return Response.json({ ok: true })
  }

  private async getAllWebAuthnCredentials(): Promise<Response> {
    // Iterate all volunteers and collect credentials
    const volunteers = await this.ctx.storage.get<Record<string, Volunteer>>('volunteers') || {}
    const allCreds: Array<WebAuthnCredential & { ownerPubkey: string }> = []
    for (const pubkey of Object.keys(volunteers)) {
      const creds = await this.ctx.storage.get<WebAuthnCredential[]>(`webauthn:creds:${pubkey}`) || []
      for (const c of creds) {
        allCreds.push({ ...c, ownerPubkey: pubkey })
      }
    }
    return Response.json({ credentials: allCreds })
  }

  // --- WebAuthn Challenge Methods ---

  private async storeWebAuthnChallenge(data: { id: string; challenge: string }): Promise<Response> {
    const key = `webauthn:challenge:${data.id}`
    await this.ctx.storage.put(key, { challenge: data.challenge, createdAt: Date.now() })
    // Auto-delete after 5 minutes
    this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000)
    return Response.json({ ok: true })
  }

  private async getWebAuthnChallenge(id: string): Promise<Response> {
    const key = `webauthn:challenge:${id}`
    const data = await this.ctx.storage.get<{ challenge: string; createdAt: number }>(key)
    if (!data) return new Response('Challenge not found', { status: 404 })
    // Delete after retrieval (single-use)
    await this.ctx.storage.delete(key)
    // Verify not expired (5 minutes)
    if (Date.now() - data.createdAt > 5 * 60 * 1000) {
      return new Response('Challenge expired', { status: 410 })
    }
    return Response.json({ challenge: data.challenge })
  }

  // --- WebAuthn Settings Methods ---

  private async getWebAuthnSettings(): Promise<Response> {
    const settings = await this.ctx.storage.get<WebAuthnSettings>('webauthnSettings') || {
      requireForAdmins: false,
      requireForVolunteers: false,
    }
    return Response.json(settings)
  }

  private async updateWebAuthnSettings(data: Partial<WebAuthnSettings>): Promise<Response> {
    const current = await this.ctx.storage.get<WebAuthnSettings>('webauthnSettings') || {
      requireForAdmins: false,
      requireForVolunteers: false,
    }
    const updated = { ...current, ...data }
    await this.ctx.storage.put('webauthnSettings', updated)
    return Response.json(updated)
  }

  // --- Server Session Methods (for WebAuthn-authenticated sessions) ---

  private async createSession(data: { pubkey: string }): Promise<Response> {
    // Generate 256-bit random token
    const tokenBytes = new Uint8Array(32)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('')

    const session: ServerSession = {
      token,
      pubkey: data.pubkey,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // 8 hours
    }
    await this.ctx.storage.put(`session:${token}`, session)
    return Response.json(session)
  }

  private async validateSession(token: string): Promise<Response> {
    const session = await this.ctx.storage.get<ServerSession>(`session:${token}`)
    if (!session) return new Response('Invalid session', { status: 401 })
    if (new Date(session.expiresAt) < new Date()) {
      await this.ctx.storage.delete(`session:${token}`)
      return new Response('Session expired', { status: 401 })
    }
    return Response.json(session)
  }

  // --- Alarm handler for cleaning up expired data ---

  override async alarm() {
    const now = Date.now()

    // Clean up expired WebAuthn challenges
    const challengeKeys = await this.ctx.storage.list({ prefix: 'webauthn:challenge:' })
    for (const [key, value] of challengeKeys) {
      const data = value as { challenge: string; createdAt: number }
      if (now - data.createdAt > 5 * 60 * 1000) {
        await this.ctx.storage.delete(key)
      }
    }

    // Clean up expired rate limit entries
    const rlKeys = await this.ctx.storage.list({ prefix: 'ratelimit:' })
    for (const [key, value] of rlKeys) {
      const timestamps = value as number[]
      const recent = timestamps.filter(t => now - t < 60_000)
      if (recent.length === 0) {
        await this.ctx.storage.delete(key)
      } else {
        await this.ctx.storage.put(key, recent)
      }
    }

    // Clean up expired sessions
    const sessionKeys = await this.ctx.storage.list({ prefix: 'session:' })
    for (const [key, value] of sessionKeys) {
      const session = value as ServerSession
      if (new Date(session.expiresAt) < new Date()) {
        await this.ctx.storage.delete(key)
      }
    }
  }

  // --- IVR Audio Methods ---

  private static readonly VALID_PROMPT_TYPES = ['greeting', 'pleaseHold', 'waitMessage', 'rateLimited', 'captchaPrompt']
  private static readonly MAX_AUDIO_SIZE = 1_048_576 // 1MB

  private async getIvrAudioList(): Promise<Response> {
    const meta = await this.ctx.storage.get<Array<{ promptType: string; language: string; size: number; uploadedAt: string }>>('ivrAudioMeta') || []
    return Response.json({ recordings: meta })
  }

  private async uploadIvrAudio(promptType: string, language: string, data: ArrayBuffer): Promise<Response> {
    if (!SessionManagerDO.VALID_PROMPT_TYPES.includes(promptType)) {
      return new Response(JSON.stringify({ error: 'Invalid prompt type' }), { status: 400 })
    }
    if (data.byteLength > SessionManagerDO.MAX_AUDIO_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large (max 1MB)' }), { status: 400 })
    }
    if (data.byteLength === 0) {
      return new Response(JSON.stringify({ error: 'Empty file' }), { status: 400 })
    }

    const key = `ivr-audio:${promptType}:${language}`
    await this.ctx.storage.put(key, new Uint8Array(data))

    // Update metadata
    const meta = await this.ctx.storage.get<Array<{ promptType: string; language: string; size: number; uploadedAt: string }>>('ivrAudioMeta') || []
    const existing = meta.findIndex(m => m.promptType === promptType && m.language === language)
    const entry = { promptType, language, size: data.byteLength, uploadedAt: new Date().toISOString() }
    if (existing >= 0) {
      meta[existing] = entry
    } else {
      meta.push(entry)
    }
    await this.ctx.storage.put('ivrAudioMeta', meta)

    return Response.json({ ok: true, ...entry })
  }

  private async getIvrAudio(promptType: string, language: string): Promise<Response> {
    const key = `ivr-audio:${promptType}:${language}`
    const data = await this.ctx.storage.get<Uint8Array>(key)
    if (!data) return new Response('Not Found', { status: 404 })
    return new Response(data.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': data.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }

  private async deleteIvrAudio(promptType: string, language: string): Promise<Response> {
    const key = `ivr-audio:${promptType}:${language}`
    await this.ctx.storage.delete(key)

    const meta = await this.ctx.storage.get<Array<{ promptType: string; language: string; size: number; uploadedAt: string }>>('ivrAudioMeta') || []
    await this.ctx.storage.put('ivrAudioMeta', meta.filter(m => !(m.promptType === promptType && m.language === language)))

    return Response.json({ ok: true })
  }
}
