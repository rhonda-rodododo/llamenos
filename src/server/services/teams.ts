import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '../db'
import { contactTeamAssignments, teamMembers, teams } from '../db/schema/teams'
import { TtlCache } from '../lib/cache'
import type { CryptoService } from '../lib/crypto-service'

export type TeamRow = typeof teams.$inferSelect
export type TeamMemberRow = typeof teamMembers.$inferSelect
export type ContactTeamAssignmentRow = typeof contactTeamAssignments.$inferSelect

export interface TeamWithCounts extends TeamRow {
  memberCount: number
  contactCount: number
}

export class TeamsService {
  private teamListCache = new TtlCache<TeamWithCounts[]>(10_000) // 10s TTL

  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  async createTeam(input: {
    id?: string
    hubId: string
    encryptedName: Ciphertext
    encryptedDescription?: Ciphertext | null
    createdBy: string
  }): Promise<TeamRow> {
    // Client-provided id is required for AAD binding: the client seals the
    // ciphertext with buildAad(label, id, fieldName) before POST. Accept it
    // verbatim so decrypt on refetch matches. Legacy callers that omit id
    // fall back to a server-generated UUID.
    const id = input.id ?? crypto.randomUUID()
    const now = new Date()
    const [row] = await this.db
      .insert(teams)
      .values({
        id,
        hubId: input.hubId,
        encryptedName: input.encryptedName,
        encryptedDescription: input.encryptedDescription ?? null,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    this.teamListCache.clear()
    return row
  }

  async listTeams(hubId: string): Promise<TeamWithCounts[]> {
    const cached = this.teamListCache.get(hubId)
    if (cached) return cached

    const rows = await this.db.execute<{
      id: string
      hub_id: string
      encrypted_name: Ciphertext
      encrypted_description: Ciphertext | null
      created_by: string
      created_at: string
      updated_at: string
      member_count: number
      contact_count: number
    }>(sql`
      SELECT t.*,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id)::int AS member_count,
        (SELECT COUNT(*) FROM contact_team_assignments cta WHERE cta.team_id = t.id)::int AS contact_count
      FROM teams t
      WHERE t.hub_id = ${hubId}
      ORDER BY t.created_at DESC
    `)
    const result = rows.map((r) => ({
      id: r.id,
      hubId: r.hub_id,
      encryptedName: r.encrypted_name,
      encryptedDescription: r.encrypted_description,
      createdBy: r.created_by,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
      memberCount: r.member_count,
      contactCount: r.contact_count,
    }))
    this.teamListCache.set(hubId, result)
    return result
  }

  async getTeam(id: string, hubId: string): Promise<TeamRow | null> {
    const rows = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.hubId, hubId)))
      .limit(1)
    return rows[0] ?? null
  }

  async updateTeam(
    id: string,
    hubId: string,
    data: {
      encryptedName?: Ciphertext
      encryptedDescription?: Ciphertext | null
    }
  ): Promise<TeamRow | null> {
    const [row] = await this.db
      .update(teams)
      .set({
        ...(data.encryptedName !== undefined ? { encryptedName: data.encryptedName } : {}),
        ...(data.encryptedDescription !== undefined
          ? { encryptedDescription: data.encryptedDescription }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(teams.id, id), eq(teams.hubId, hubId)))
      .returning()
    this.teamListCache.clear()
    return row ?? null
  }

  async deleteTeam(id: string, hubId: string): Promise<boolean> {
    // Cascade: delete members and assignments first
    await this.db.delete(contactTeamAssignments).where(eq(contactTeamAssignments.teamId, id))
    await this.db.delete(teamMembers).where(eq(teamMembers.teamId, id))
    const [row] = await this.db
      .delete(teams)
      .where(and(eq(teams.id, id), eq(teams.hubId, hubId)))
      .returning({ id: teams.id })
    this.teamListCache.clear()
    return !!row
  }

  // --- Members ---

  async addMembers(teamId: string, pubkeys: string[], addedBy: string): Promise<TeamMemberRow[]> {
    if (pubkeys.length === 0) return []
    const now = new Date()
    const rows = await this.db
      .insert(teamMembers)
      .values(
        pubkeys.map((pk) => ({
          teamId,
          userPubkey: pk,
          addedBy,
          createdAt: now,
        }))
      )
      .onConflictDoNothing()
      .returning()
    this.teamListCache.clear()
    return rows
  }

  async removeMember(teamId: string, pubkey: string): Promise<boolean> {
    const rows = await this.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userPubkey, pubkey)))
      .returning()
    this.teamListCache.clear()
    return rows.length > 0
  }

  async listMembers(teamId: string): Promise<TeamMemberRow[]> {
    return this.db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(teamMembers.createdAt)
  }

  async getUserTeamIds(userPubkey: string, hubId: string): Promise<string[]> {
    const rows = await this.db.execute<{ team_id: string }>(sql`
      SELECT tm.team_id FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_pubkey = ${userPubkey} AND t.hub_id = ${hubId}
    `)
    return rows.map((r) => r.team_id)
  }

  // --- Contact Assignment ---

  async assignContacts(
    teamId: string,
    contactIds: string[],
    hubId: string,
    assignedBy: string
  ): Promise<{ assigned: number; skipped: number }> {
    if (contactIds.length === 0) return { assigned: 0, skipped: 0 }
    const now = new Date()
    const rows = await this.db
      .insert(contactTeamAssignments)
      .values(
        contactIds.map((cid) => ({
          id: crypto.randomUUID(),
          contactId: cid,
          teamId,
          hubId,
          assignedBy,
          createdAt: now,
        }))
      )
      .onConflictDoNothing()
      .returning()
    this.teamListCache.clear()
    return { assigned: rows.length, skipped: contactIds.length - rows.length }
  }

  async unassignContact(teamId: string, contactId: string): Promise<boolean> {
    const rows = await this.db
      .delete(contactTeamAssignments)
      .where(
        and(
          eq(contactTeamAssignments.teamId, teamId),
          eq(contactTeamAssignments.contactId, contactId)
        )
      )
      .returning()
    this.teamListCache.clear()
    return rows.length > 0
  }

  async listTeamContacts(teamId: string): Promise<ContactTeamAssignmentRow[]> {
    return this.db
      .select()
      .from(contactTeamAssignments)
      .where(eq(contactTeamAssignments.teamId, teamId))
      .orderBy(contactTeamAssignments.createdAt)
  }

  async autoAssignForUser(contactId: string, userPubkey: string, hubId: string): Promise<void> {
    const teamIds = await this.getUserTeamIds(userPubkey, hubId)
    if (teamIds.length === 0) return
    const now = new Date()
    await this.db
      .insert(contactTeamAssignments)
      .values(
        teamIds.map((tid) => ({
          id: crypto.randomUUID(),
          contactId,
          teamId: tid,
          hubId,
          assignedBy: 'auto',
          createdAt: now,
        }))
      )
      .onConflictDoNothing()
  }

  // --- Test Reset ---

  async resetForTest(hubId: string): Promise<void> {
    const hubTeams = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.hubId, hubId))
    const teamIds = hubTeams.map((t) => t.id)
    if (teamIds.length > 0) {
      await this.db.delete(contactTeamAssignments).where(eq(contactTeamAssignments.hubId, hubId))
      for (const tid of teamIds) {
        await this.db.delete(teamMembers).where(eq(teamMembers.teamId, tid))
      }
      await this.db.delete(teams).where(eq(teams.hubId, hubId))
    }
  }
}
