import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { MessagingChannelType } from '../../shared/types'
import type { Database } from '../db'
import {
  inviteCodes,
  provisionRooms,
  users,
  webauthnChallenges,
  webauthnCredentials,
  webauthnSettings,
} from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import type {
  AddWebAuthnCredentialData,
  CreateInviteData,
  CreateProvisionRoomData,
  CreateUserData,
  CreateWebAuthnChallengeData,
  ProvisionRoomStatus,
  RedeemInviteData,
  SetHubRoleData,
  SetProvisionPayloadData,
  UpdateUserData,
  UpdateWebAuthnCounterData,
} from '../types'
import type { InviteCode, User, WebAuthnCredential, WebAuthnSettings } from '../types'

/** Check if a string is a valid 64-char hex secp256k1 x-only pubkey */
const isValidPubkey = (pk: string) => /^[0-9a-f]{64}$/i.test(pk)

/** Fields users can update on their own profile */
const USER_SAFE_FIELDS = new Set([
  'name',
  'phone',
  'spokenLanguages',
  'uiLanguage',
  'profileCompleted',
  'transcriptionEnabled',
  'onBreak',
  'callPreference',
])

export class IdentityService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  // ------------------------------------------------------------------ Users

  async getUsers(): Promise<User[]> {
    const rows = await this.db.select().from(users)
    return rows.map((r) => this.#rowToUser(r))
  }

  async getUser(pubkey: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.pubkey, pubkey)).limit(1)
    return rows[0] ? this.#rowToUser(rows[0]) : null
  }

  async createUser(data: CreateUserData): Promise<User> {
    // E2EE envelope-encrypt PII for user + admin pubkeys
    const adminPubkeys = (await this.getSuperAdminPubkeys()).filter(isValidPubkey)
    const piiRecipients = [
      ...new Set([...(isValidPubkey(data.pubkey) ? [data.pubkey] : []), ...adminPubkeys]),
    ]

    const nameEnvelope =
      data.name && piiRecipients.length > 0
        ? this.crypto.envelopeEncrypt(data.name, piiRecipients, LABEL_USER_PII)
        : undefined

    const phoneEnvelope =
      data.phone && piiRecipients.length > 0
        ? this.crypto.envelopeEncrypt(data.phone, piiRecipients, LABEL_USER_PII)
        : undefined

    const [row] = await this.db
      .insert(users)
      .values({
        pubkey: data.pubkey,
        roles: data.roleIds ?? data.roles ?? ['role-volunteer'],
        encryptedSecretKey: data.encryptedSecretKey,
        active: true,
        transcriptionEnabled: true,
        spokenLanguages: ['en'],
        uiLanguage: 'en',
        profileCompleted: false,
        onBreak: false,
        callPreference: 'phone',
        // E2EE phone: use envelope ciphertext if available, fallback to server-key
        encryptedPhone: phoneEnvelope
          ? phoneEnvelope.encrypted
          : this.crypto.serverEncrypt(data.phone ?? '', LABEL_USER_PII),
        ...(phoneEnvelope ? { phoneEnvelopes: phoneEnvelope.envelopes } : {}),
        // E2EE name: use envelope ciphertext if available, fallback to server-key
        encryptedName: nameEnvelope
          ? nameEnvelope.encrypted
          : this.crypto.serverEncrypt(data.name ?? '', LABEL_USER_PII),
        ...(nameEnvelope ? { nameEnvelopes: nameEnvelope.envelopes } : {}),
      })
      .returning()
    return this.#rowToUser(row)
  }

  async updateUser(pubkey: string, data: UpdateUserData, isAdmin = false): Promise<User> {
    const existing = await this.getUser(pubkey)
    if (!existing) throw new AppError(404, 'User not found')

    const allowed: Record<string, unknown> = {}
    if (isAdmin) {
      Object.assign(allowed, data)
    } else {
      for (const key of Object.keys(data) as Array<keyof UpdateUserData>) {
        if (USER_SAFE_FIELDS.has(key)) {
          allowed[key] = data[key]
        }
      }
    }

    // E2EE envelope-encrypt PII if being updated (for user + admin pubkeys)
    type EnvelopeResult = {
      encrypted: Ciphertext
      envelopes: import('@shared/types').RecipientEnvelope[]
    }
    let nameEnvelope: EnvelopeResult | undefined
    let phoneEnvelope: EnvelopeResult | undefined

    if (allowed.name !== undefined || allowed.phone !== undefined) {
      const adminPubkeys = (await this.getSuperAdminPubkeys()).filter(isValidPubkey)
      const piiRecipients = [
        ...new Set([...(isValidPubkey(pubkey) ? [pubkey] : []), ...adminPubkeys]),
      ]
      if (piiRecipients.length > 0) {
        if (allowed.name !== undefined) {
          nameEnvelope = this.crypto.envelopeEncrypt(
            allowed.name as string,
            piiRecipients,
            LABEL_USER_PII
          )
        }
        if (allowed.phone !== undefined) {
          phoneEnvelope = this.crypto.envelopeEncrypt(
            allowed.phone as string,
            piiRecipients,
            LABEL_USER_PII
          )
        }
      }
    }

    const [row] = await this.db
      .update(users)
      .set({
        ...(allowed.roles !== undefined ? { roles: allowed.roles as string[] } : {}),
        ...(allowed.active !== undefined ? { active: allowed.active as boolean } : {}),
        ...(allowed.transcriptionEnabled !== undefined
          ? { transcriptionEnabled: allowed.transcriptionEnabled as boolean }
          : {}),
        ...(allowed.spokenLanguages !== undefined
          ? { spokenLanguages: allowed.spokenLanguages as string[] }
          : {}),
        ...(allowed.uiLanguage !== undefined ? { uiLanguage: allowed.uiLanguage as string } : {}),
        ...(allowed.profileCompleted !== undefined
          ? { profileCompleted: allowed.profileCompleted as boolean }
          : {}),
        ...(allowed.onBreak !== undefined ? { onBreak: allowed.onBreak as boolean } : {}),
        ...(allowed.callPreference !== undefined
          ? { callPreference: allowed.callPreference as string }
          : {}),
        ...(allowed.encryptedSecretKey !== undefined
          ? { encryptedSecretKey: allowed.encryptedSecretKey as string }
          : {}),
        ...(allowed.supportedMessagingChannels !== undefined
          ? { supportedMessagingChannels: allowed.supportedMessagingChannels as string[] }
          : {}),
        ...(allowed.messagingEnabled !== undefined
          ? { messagingEnabled: allowed.messagingEnabled as boolean }
          : {}),
        // Encrypted columns — E2EE envelope with server-key fallback
        ...(allowed.phone !== undefined
          ? {
              encryptedPhone: phoneEnvelope
                ? phoneEnvelope.encrypted
                : this.crypto.serverEncrypt(allowed.phone as string, LABEL_USER_PII),
              ...(phoneEnvelope ? { phoneEnvelopes: phoneEnvelope.envelopes } : {}),
            }
          : {}),
        ...(allowed.name !== undefined
          ? {
              encryptedName: nameEnvelope
                ? nameEnvelope.encrypted
                : this.crypto.serverEncrypt(allowed.name as string, LABEL_USER_PII),
              ...(nameEnvelope ? { nameEnvelopes: nameEnvelope.envelopes } : {}),
            }
          : {}),
      })
      .where(eq(users.pubkey, pubkey))
      .returning()
    return this.#rowToUser(row)
  }

  async deleteUser(pubkey: string): Promise<void> {
    await this.db.delete(users).where(eq(users.pubkey, pubkey))
  }

  async hasAdmin(): Promise<boolean> {
    const rows = await this.db
      .select({ roles: users.roles })
      .from(users)
      .where(eq(users.active, true))
    return rows.some((r) => (r.roles as string[]).includes('role-super-admin'))
  }

  async bootstrapAdmin(pubkey: string): Promise<User> {
    return await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ roles: users.roles })
        .from(users)
        .where(eq(users.active, true))
      const adminExists = existing.some((r) => (r.roles as string[]).includes('role-super-admin'))
      if (adminExists) throw new AppError(403, 'Admin already exists')

      // Encrypt bootstrap admin fields with E2EE envelopes
      const recipients = isValidPubkey(pubkey) ? [pubkey] : []
      const nameEnvelope =
        recipients.length > 0
          ? this.crypto.envelopeEncrypt('Admin', recipients, LABEL_USER_PII)
          : undefined
      // Bootstrap admin has no phone — envelope-encrypt empty string for consistency
      const phoneEnvelope =
        recipients.length > 0
          ? this.crypto.envelopeEncrypt('', recipients, LABEL_USER_PII)
          : undefined

      const [row] = await tx
        .insert(users)
        .values({
          pubkey,
          roles: ['role-super-admin'],
          encryptedSecretKey: '',
          active: true,
          transcriptionEnabled: true,
          spokenLanguages: ['en', 'es'],
          uiLanguage: 'en',
          profileCompleted: false,
          onBreak: false,
          callPreference: 'phone',
          // E2EE phone: use envelope ciphertext if available, fallback to server-key
          encryptedPhone: phoneEnvelope
            ? phoneEnvelope.encrypted
            : this.crypto.serverEncrypt('', LABEL_USER_PII),
          ...(phoneEnvelope ? { phoneEnvelopes: phoneEnvelope.envelopes } : {}),
          // E2EE name: use envelope ciphertext if available, fallback to server-key
          encryptedName: nameEnvelope
            ? nameEnvelope.encrypted
            : this.crypto.serverEncrypt('Admin', LABEL_USER_PII),
          ...(nameEnvelope ? { nameEnvelopes: nameEnvelope.envelopes } : {}),
        })
        .returning()
      return this.#rowToUser(row)
    })
  }

  async setHubRole(data: SetHubRoleData): Promise<User> {
    const vol = await this.getUser(data.pubkey)
    if (!vol) throw new AppError(404, 'User not found')

    // Atomic JSONB update: remove existing entry for this hub, then append new one.
    // Prevents lost-update race when concurrent setHubRole calls modify the same user.
    // Build the new entry via jsonb_build_object to avoid parameter-encoding issues.
    const roleIdsJson = JSON.stringify(data.roleIds)
    const [row] = await this.db
      .update(users)
      .set({
        hubRoles: sql`(
          SELECT jsonb_agg(elem)
          FROM (
            SELECT value AS elem FROM jsonb_array_elements(COALESCE(${users.hubRoles}, '[]'::jsonb))
            WHERE value->>'hubId' != ${data.hubId}
            UNION ALL
            SELECT jsonb_build_object('hubId', ${data.hubId}::text, 'roleIds', ${roleIdsJson}::jsonb)
          ) sub
        )`,
      })
      .where(eq(users.pubkey, data.pubkey))
      .returning()
    return this.#rowToUser(row)
  }

  async removeHubRole(pubkey: string, hubId: string): Promise<User> {
    const vol = await this.getUser(pubkey)
    if (!vol) throw new AppError(404, 'User not found')

    // Atomic JSONB filter: removes the entry for this hub without read-modify-write.
    const [row] = await this.db
      .update(users)
      .set({
        hubRoles: sql`(
          SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(${users.hubRoles}, '[]'::jsonb))
          WHERE value->>'hubId' != ${hubId}
        )`,
      })
      .where(eq(users.pubkey, pubkey))
      .returning()
    if (!row) throw new AppError(404, 'User not found')
    return this.#rowToUser(row)
  }

  // ------------------------------------------------------------------ Invites

  async getInvites(): Promise<InviteCode[]> {
    const rows = await this.db.select().from(inviteCodes).where(isNull(inviteCodes.usedAt))
    return rows.map((r) => this.#rowToInvite(r))
  }

  async createInvite(data: CreateInviteData): Promise<InviteCode> {
    const code = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    // Invite names always use server encryption so validateInvite (public, no auth)
    // can decrypt the name for the welcome page. E2EE envelopes are stored alongside
    // for authenticated admin list decryption. The user record created on redeem
    // uses proper E2EE-only encryption.
    //
    // Phone: envelope-encrypt for admin(s) who created the invite. Server also needs
    // phone for invite delivery (SMS/Signal/WhatsApp), so we keep a server-key copy.
    // The envelope is stored alongside for admin-only decryption.
    const adminPubkeys = (await this.getSuperAdminPubkeys()).filter(isValidPubkey)
    const phoneEnvelope =
      data.phone && adminPubkeys.length > 0
        ? this.crypto.envelopeEncrypt(data.phone, adminPubkeys, LABEL_USER_PII)
        : undefined

    const [row] = await this.db
      .insert(inviteCodes)
      .values({
        code,
        roleIds: data.roleIds ?? ['role-volunteer'],
        createdBy: data.createdBy,
        expiresAt,
        // Server-key phone for delivery operations + E2EE envelopes for admin decryption
        encryptedPhone: phoneEnvelope
          ? phoneEnvelope.encrypted
          : this.crypto.serverEncrypt(data.phone ?? '', LABEL_USER_PII),
        ...(phoneEnvelope ? { phoneEnvelopes: phoneEnvelope.envelopes } : {}),
        encryptedName: this.crypto.serverEncrypt(data.name ?? '', LABEL_USER_PII),
      })
      .returning()
    return this.#rowToInvite(row)
  }

  async validateInvite(
    code: string
  ): Promise<{ valid: boolean; error?: string; name?: string; roleIds?: string[] }> {
    const rows = await this.db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1)
    const row = rows[0]
    if (!row) return { valid: false, error: 'not_found' }
    if (row.usedAt !== null) return { valid: false, error: 'already_used' }
    if (row.expiresAt < new Date()) return { valid: false, error: 'expired' }
    // Name is E2EE — server-side decrypt attempt for display (may be server-encrypted fallback)
    let name: string | undefined
    try {
      name = this.crypto.serverDecrypt(row.encryptedName as Ciphertext, LABEL_USER_PII)
    } catch {
      // E2EE-only name — client will decrypt via envelopes
    }
    return { valid: true, name, roleIds: row.roleIds as string[] }
  }

  async redeemInvite(data: RedeemInviteData): Promise<User> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, data.code))
        .limit(1)
      const invite = rows[0]
      if (!invite) throw new AppError(400, 'Invalid invite code')
      if (invite.usedAt !== null) throw new AppError(400, 'Invite already used')
      if (invite.expiresAt < new Date()) throw new AppError(400, 'Invite expired')

      // Mark invite as used
      await tx
        .update(inviteCodes)
        .set({ usedAt: new Date(), usedBy: data.pubkey })
        .where(eq(inviteCodes.code, data.code))

      // Decrypt invite PII from encrypted columns
      let invitePhone = ''
      try {
        invitePhone = this.crypto.serverDecrypt(invite.encryptedPhone as Ciphertext, LABEL_USER_PII)
      } catch {
        /* E2EE-only — leave empty */
      }

      let inviteName = ''
      try {
        inviteName = this.crypto.serverDecrypt(invite.encryptedName as Ciphertext, LABEL_USER_PII)
      } catch {
        /* E2EE-only — leave empty */
      }

      // Encrypt user PII with E2EE envelopes
      const adminPubkeys = (await this.getSuperAdminPubkeys()).filter(isValidPubkey)
      const piiRecipients = [
        ...new Set([...(isValidPubkey(data.pubkey) ? [data.pubkey] : []), ...adminPubkeys]),
      ]

      const nameEnvelope =
        inviteName && piiRecipients.length > 0
          ? this.crypto.envelopeEncrypt(inviteName, piiRecipients, LABEL_USER_PII)
          : undefined
      const phoneEnvelope =
        invitePhone && piiRecipients.length > 0
          ? this.crypto.envelopeEncrypt(invitePhone, piiRecipients, LABEL_USER_PII)
          : undefined

      // Create user
      const [row] = await tx
        .insert(users)
        .values({
          pubkey: data.pubkey,
          roles: (invite.roleIds as string[]) ?? ['role-volunteer'],
          encryptedSecretKey: '',
          active: true,
          transcriptionEnabled: true,
          spokenLanguages: ['en'],
          uiLanguage: 'en',
          profileCompleted: false,
          onBreak: false,
          callPreference: 'phone',
          // E2EE phone: use envelope ciphertext if available, fallback to server-key
          encryptedPhone: phoneEnvelope
            ? phoneEnvelope.encrypted
            : this.crypto.serverEncrypt(invitePhone, LABEL_USER_PII),
          ...(phoneEnvelope ? { phoneEnvelopes: phoneEnvelope.envelopes } : {}),
          // E2EE name: use envelope ciphertext if available, fallback to server-key
          encryptedName: nameEnvelope
            ? nameEnvelope.encrypted
            : this.crypto.serverEncrypt(inviteName, LABEL_USER_PII),
          ...(nameEnvelope ? { nameEnvelopes: nameEnvelope.envelopes } : {}),
        })
        .returning()
      return this.#rowToUser(row)
    })
  }

  async revokeInvite(code: string): Promise<void> {
    await this.db.delete(inviteCodes).where(eq(inviteCodes.code, code))
  }

  async updateInviteDelivery(
    code: string,
    data: { recipientPhoneHash: string; deliveryChannel: string; deliverySentAt: Date }
  ): Promise<InviteCode> {
    const [row] = await this.db
      .update(inviteCodes)
      .set({
        recipientPhoneHash: data.recipientPhoneHash as import('@shared/crypto-types').HmacHash,
        deliveryChannel: data.deliveryChannel,
        deliverySentAt: data.deliverySentAt,
      })
      .where(eq(inviteCodes.code, code))
      .returning()
    if (!row) throw new AppError(404, 'Invite not found')
    return this.#rowToInvite(row)
  }

  // ------------------------------------------------------------------ WebAuthn Credentials

  async getWebAuthnCredentials(pubkey: string): Promise<WebAuthnCredential[]> {
    const rows = await this.db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.pubkey, pubkey))
    return rows.map((r) => this.#rowToCredential(r))
  }

  async getAllWebAuthnCredentials(): Promise<Array<WebAuthnCredential & { ownerPubkey: string }>> {
    const rows = await this.db.select().from(webauthnCredentials)
    return rows.map((r) => ({ ...this.#rowToCredential(r), ownerPubkey: r.pubkey }))
  }

  async addWebAuthnCredential(data: AddWebAuthnCredentialData): Promise<void> {
    const cred = data.credential

    // E2EE encrypt label for the credential owner's pubkey
    const labelEnvelope =
      cred.label && isValidPubkey(data.pubkey)
        ? this.crypto.envelopeEncrypt(cred.label, [data.pubkey], LABEL_USER_PII)
        : undefined

    await this.db.insert(webauthnCredentials).values({
      id: cred.id,
      pubkey: data.pubkey,
      publicKey: cred.publicKey,
      counter: String(cred.counter),
      transports: cred.transports,
      backedUp: cred.backedUp,
      lastUsedAt: new Date(cred.lastUsedAt),
      ...(labelEnvelope
        ? { encryptedLabel: labelEnvelope.encrypted, labelEnvelopes: labelEnvelope.envelopes }
        : {}),
    })
  }

  async deleteWebAuthnCredential(pubkey: string, credId: string): Promise<void> {
    const rows = await this.db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.pubkey, pubkey), eq(webauthnCredentials.id, credId)))
      .limit(1)
    if (!rows[0]) throw new AppError(404, 'Credential not found')
    await this.db
      .delete(webauthnCredentials)
      .where(and(eq(webauthnCredentials.pubkey, pubkey), eq(webauthnCredentials.id, credId)))
  }

  async renameWebAuthnCredential(
    pubkey: string,
    credId: string,
    data: {
      label?: string
      encryptedLabel?: Ciphertext
      labelEnvelopes?: import('../../shared/types').RecipientEnvelope[]
    }
  ): Promise<void> {
    const updates: Record<string, unknown> = {}
    if (data.encryptedLabel !== undefined) updates.encryptedLabel = data.encryptedLabel
    if (data.labelEnvelopes !== undefined) updates.labelEnvelopes = data.labelEnvelopes
    if (Object.keys(updates).length === 0) {
      // No encrypted fields provided. We still need to confirm the credential exists.
      const rows = await this.db
        .select({ id: webauthnCredentials.id })
        .from(webauthnCredentials)
        .where(and(eq(webauthnCredentials.pubkey, pubkey), eq(webauthnCredentials.id, credId)))
        .limit(1)
      if (!rows[0]) throw new AppError(404, 'Credential not found')
      return
    }

    const result = await this.db
      .update(webauthnCredentials)
      .set(updates)
      .where(and(eq(webauthnCredentials.id, credId), eq(webauthnCredentials.pubkey, pubkey)))
      .returning({ id: webauthnCredentials.id })

    if (result.length === 0) {
      throw new AppError(404, 'Credential not found')
    }
  }

  async updateWebAuthnCounter(data: UpdateWebAuthnCounterData): Promise<void> {
    // Atomic conditional UPDATE to avoid TOCTOU race between SELECT and UPDATE.
    // Two concurrent auths must not both observe N and both write N+1.
    const updated = await this.db
      .update(webauthnCredentials)
      .set({ counter: String(data.counter), lastUsedAt: new Date(data.lastUsedAt) })
      .where(
        and(
          eq(webauthnCredentials.pubkey, data.pubkey),
          eq(webauthnCredentials.id, data.credId),
          sql`CAST(${webauthnCredentials.counter} AS BIGINT) < ${data.counter}`
        )
      )
      .returning({ id: webauthnCredentials.id })

    if (updated.length === 0) {
      // Either the credential doesn't exist or the counter condition failed.
      // Distinguish between the two for a clearer error.
      const existing = await this.db
        .select({ id: webauthnCredentials.id })
        .from(webauthnCredentials)
        .where(
          and(eq(webauthnCredentials.pubkey, data.pubkey), eq(webauthnCredentials.id, data.credId))
        )
        .limit(1)
      if (!existing[0]) throw new AppError(404, 'Credential not found')
      throw new AppError(409, 'Counter replay detected — possible authenticator replay attack')
    }
  }

  // ------------------------------------------------------------------ WebAuthn Challenges

  async storeWebAuthnChallenge(data: CreateWebAuthnChallengeData): Promise<void> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    await this.db
      .insert(webauthnChallenges)
      .values({
        id: data.id,
        pubkey: data.pubkey ?? null,
        challenge: data.challenge,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: webauthnChallenges.id,
        set: { challenge: data.challenge, expiresAt },
      })
  }

  async getWebAuthnChallenge(id: string): Promise<string> {
    // Atomic DELETE ... RETURNING to avoid TOCTOU race between select and delete
    const [row] = await this.db
      .delete(webauthnChallenges)
      .where(eq(webauthnChallenges.id, id))
      .returning()
    if (!row) throw new AppError(404, 'Challenge not found')
    if (new Date(row.expiresAt) < new Date()) throw new AppError(410, 'Challenge expired')
    return row.challenge
  }

  // ------------------------------------------------------------------ WebAuthn Settings

  async getWebAuthnSettings(): Promise<WebAuthnSettings> {
    const rows = await this.db
      .select()
      .from(webauthnSettings)
      .where(eq(webauthnSettings.id, 'global'))
      .limit(1)
    const row = rows[0]
    return {
      requireForAdmins: row?.requireForAdmins ?? false,
      requireForUsers: row?.requireForUsers ?? false,
    }
  }

  async updateWebAuthnSettings(data: Partial<WebAuthnSettings>): Promise<WebAuthnSettings> {
    const current = await this.getWebAuthnSettings()
    const updated = { ...current, ...data }
    await this.db
      .insert(webauthnSettings)
      .values({ id: 'global', ...updated })
      .onConflictDoUpdate({
        target: webauthnSettings.id,
        set: updated,
      })
    return updated
  }

  // ------------------------------------------------------------------ Provision Rooms

  async createProvisionRoom(
    data: CreateProvisionRoomData
  ): Promise<{ roomId: string; token: string }> {
    const roomId = crypto.randomUUID()
    const tokenBytes = new Uint8Array(16)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    await this.db.insert(provisionRooms).values({
      roomId,
      ephemeralPubkey: data.ephemeralPubkey,
      token,
      status: 'waiting',
      expiresAt,
    })
    return { roomId, token }
  }

  async getProvisionRoom(id: string, token: string): Promise<ProvisionRoomStatus> {
    // Use a transaction to atomically verify token + consume payload, avoiding TOCTOU race
    const result = await this.db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(provisionRooms)
        .where(and(eq(provisionRooms.roomId, id), eq(provisionRooms.token, token)))
      if (!room) return null
      if (new Date(room.expiresAt) < new Date()) {
        await tx.delete(provisionRooms).where(eq(provisionRooms.roomId, id))
        return { status: 'expired' as const }
      }
      if (room.encryptedNsec) {
        // Atomically consume the payload — delete inside the same transaction
        await tx.delete(provisionRooms).where(eq(provisionRooms.roomId, id))
        return {
          status: 'ready' as const,
          ephemeralPubkey: room.ephemeralPubkey,
          encryptedNsec: room.encryptedNsec,
          primaryPubkey: room.primaryPubkey ?? undefined,
        }
      }
      return { status: 'waiting' as const, ephemeralPubkey: room.ephemeralPubkey }
    })
    if (!result) throw new AppError(404, 'Provision room not found or expired')
    return result as ProvisionRoomStatus
  }

  async setProvisionPayload(id: string, data: SetProvisionPayloadData): Promise<void> {
    const rows = await this.db
      .select()
      .from(provisionRooms)
      .where(eq(provisionRooms.roomId, id))
      .limit(1)
    const row = rows[0]
    if (!row) throw new AppError(404, 'Room not found')
    if (row.token !== data.token) throw new AppError(403, 'Invalid token')
    if (row.expiresAt < new Date()) {
      await this.db.delete(provisionRooms).where(eq(provisionRooms.roomId, id))
      throw new AppError(410, 'Room expired')
    }
    await this.db
      .update(provisionRooms)
      .set({
        encryptedNsec: data.encryptedNsec,
        primaryPubkey: data.primaryPubkey,
        status: 'ready',
      })
      .where(eq(provisionRooms.roomId, id))
  }

  // ------------------------------------------------------------------ Super Admin Helpers

  /**
   * Return pubkeys of all active users who hold the 'role-super-admin' role
   * (which grants the '*' wildcard permission).
   */
  async getSuperAdminPubkeys(): Promise<string[]> {
    const rows = await this.db
      .select({ pubkey: users.pubkey, roles: users.roles })
      .from(users)
      .where(eq(users.active, true))
    return rows
      .filter((r) => (r.roles as string[]).includes('role-super-admin'))
      .map((r) => r.pubkey)
  }

  async isSuperAdmin(pubkey: string): Promise<boolean> {
    const superAdmins = await this.getSuperAdminPubkeys()
    return superAdmins.includes(pubkey)
  }

  // ------------------------------------------------------------------ JWT Revocations

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(webauthnCredentials)
    await this.db.delete(webauthnChallenges)
    await this.db.delete(provisionRooms)
    await this.db.delete(inviteCodes)
    await this.db.delete(users)
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToUser(r: typeof users.$inferSelect): User {
    // Name: if envelopes exist, this is E2EE — server can't decrypt.
    // Otherwise try server-key decrypt for legacy data.
    let name = ''
    const nameEnvelopes = (r.nameEnvelopes as import('@shared/types').RecipientEnvelope[]) ?? []
    if (nameEnvelopes.length > 0) {
      name = '[encrypted]'
    } else if (r.encryptedName) {
      try {
        name = this.crypto.serverDecrypt(r.encryptedName as Ciphertext, LABEL_USER_PII)
      } catch {
        // Decryption failed — leave empty
      }
    }

    // Phone: if envelopes exist, this is E2EE — server can't decrypt.
    // Otherwise try server-key decrypt (guard: empty ciphertext = GDPR-erased).
    let phone = ''
    const phoneEnvelopes = (r.phoneEnvelopes as import('@shared/types').RecipientEnvelope[]) ?? []
    if (phoneEnvelopes.length > 0) {
      phone = '[encrypted]'
    } else if (r.encryptedPhone) {
      try {
        phone = this.crypto.serverDecrypt(r.encryptedPhone as Ciphertext, LABEL_USER_PII)
      } catch {
        // Decryption failed — leave empty
      }
    }

    return {
      pubkey: r.pubkey,
      name,
      phone,
      roles: r.roles as string[],
      hubRoles: r.hubRoles as Array<{ hubId: string; roleIds: string[] }>,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      encryptedSecretKey: r.encryptedSecretKey,
      transcriptionEnabled: r.transcriptionEnabled,
      spokenLanguages: r.spokenLanguages as string[],
      uiLanguage: r.uiLanguage,
      profileCompleted: r.profileCompleted,
      onBreak: r.onBreak,
      callPreference: r.callPreference as 'phone' | 'browser' | 'both',
      supportedMessagingChannels: r.supportedMessagingChannels as
        | MessagingChannelType[]
        | undefined,
      messagingEnabled: r.messagingEnabled ?? undefined,
      // E2EE envelope fields for client-side decryption
      ...(nameEnvelopes.length > 0
        ? {
            encryptedName: r.encryptedName as string,
            nameEnvelopes,
          }
        : {}),
      ...(phoneEnvelopes.length > 0
        ? {
            encryptedPhone: r.encryptedPhone as string,
            phoneEnvelopes,
          }
        : {}),
    }
  }

  #rowToInvite(r: typeof inviteCodes.$inferSelect): InviteCode {
    // Name: if envelopes exist, this is E2EE — server can't decrypt.
    const inviteNameEnvelopes =
      (r.nameEnvelopes as import('@shared/types').RecipientEnvelope[]) ?? []
    let name = ''
    if (inviteNameEnvelopes.length > 0) {
      name = '[encrypted]'
    } else if (r.encryptedName) {
      try {
        name = this.crypto.serverDecrypt(r.encryptedName as Ciphertext, LABEL_USER_PII)
      } catch {
        // Decryption failed — leave empty
      }
    }

    // Phone: if envelopes exist, this is E2EE — server can't decrypt.
    const invitePhoneEnvelopes =
      (r.phoneEnvelopes as import('@shared/types').RecipientEnvelope[]) ?? []
    let phone = ''
    if (invitePhoneEnvelopes.length > 0) {
      phone = '[encrypted]'
    } else if (r.encryptedPhone) {
      try {
        phone = this.crypto.serverDecrypt(r.encryptedPhone as Ciphertext, LABEL_USER_PII)
      } catch {
        // Decryption failed — leave empty
      }
    }

    return {
      code: r.code,
      name,
      phone,
      roleIds: r.roleIds as string[],
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString(),
      usedBy: r.usedBy ?? undefined,
      recipientPhoneHash: r.recipientPhoneHash ?? undefined,
      deliveryChannel: r.deliveryChannel ?? undefined,
      deliverySentAt: r.deliverySentAt?.toISOString() ?? undefined,
      // E2EE envelope fields for client-side decryption
      ...(inviteNameEnvelopes.length > 0
        ? {
            encryptedName: r.encryptedName as string,
            nameEnvelopes: inviteNameEnvelopes,
          }
        : {}),
      ...(invitePhoneEnvelopes.length > 0
        ? {
            encryptedPhone: r.encryptedPhone as string,
            phoneEnvelopes: invitePhoneEnvelopes,
          }
        : {}),
    }
  }

  async updateEncryptedSecretKey(pubkey: string, newCiphertext: string): Promise<void> {
    await this.db
      .update(users)
      .set({ encryptedSecretKey: newCiphertext })
      .where(eq(users.pubkey, pubkey))
  }

  /** Hex-encoded sha256 of the caller-supplied KEK proof. */
  static hashKekProof(proof: string): string {
    return bytesToHex(sha256(utf8ToBytes(proof)))
  }

  async setKekProofHash(pubkey: string, hash: string): Promise<void> {
    await this.db.update(users).set({ kekProofHash: hash }).where(eq(users.pubkey, pubkey))
  }

  async getKekProofHash(pubkey: string): Promise<string | null> {
    const rows = await this.db
      .select({ kekProofHash: users.kekProofHash })
      .from(users)
      .where(eq(users.pubkey, pubkey))
      .limit(1)
    return rows[0]?.kekProofHash ?? null
  }

  /**
   * Constant-time compare the sha256 of the caller-supplied proof against the
   * stored hash. Returns false when no hash is stored yet (pre-migration users).
   */
  async verifyKekProof(pubkey: string, proof: string): Promise<boolean> {
    const stored = await this.getKekProofHash(pubkey)
    if (!stored) return false
    const computed = IdentityService.hashKekProof(proof)
    // Both sides are fixed-length hex strings (64 chars) — length-mismatch short
    // circuit is acceptable and the remaining compare is constant-time on equal
    // lengths via XOR.
    if (computed.length !== stored.length) return false
    let diff = 0
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ stored.charCodeAt(i)
    }
    return diff === 0
  }

  async setUserActive(pubkey: string, active: boolean): Promise<void> {
    await this.db.update(users).set({ active }).where(eq(users.pubkey, pubkey))
  }

  #rowToCredential(r: typeof webauthnCredentials.$inferSelect): WebAuthnCredential {
    const labelEnvelopes = (r.labelEnvelopes as import('@shared/types').RecipientEnvelope[]) ?? []
    return {
      id: r.id,
      publicKey: r.publicKey,
      counter: Number(r.counter),
      transports: r.transports as string[],
      backedUp: r.backedUp,
      label: labelEnvelopes.length > 0 ? '[encrypted]' : '', // E2EE label decrypted client-side
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      // E2EE envelope fields for client-side decryption
      ...(labelEnvelopes.length > 0
        ? {
            encryptedLabel: r.encryptedLabel as string,
            labelEnvelopes,
          }
        : {}),
    }
  }
}
