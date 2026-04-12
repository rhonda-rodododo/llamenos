import type { Ciphertext } from '@shared/crypto-types'
import { and, eq } from 'drizzle-orm'
import type { Database } from '../db'
import { activeShifts, ringGroups, shiftOverrides, shiftSchedules } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import type {
  ActiveShift,
  CreateOverrideData,
  CreateRingGroupData,
  CreateScheduleData,
  RingGroup,
  ShiftOverride,
  ShiftSchedule,
  StartShiftData,
} from '../types'
import type { SettingsService } from './settings'

function isValidTimeFormat(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
}

export class ShiftService {
  #settings: SettingsService

  constructor(
    protected readonly db: Database,
    private readonly crypto: CryptoService,
    settings: SettingsService
  ) {
    this.#settings = settings
  }

  // ------------------------------------------------------------------ Schedules

  async getSchedules(hubId?: string): Promise<ShiftSchedule[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(shiftSchedules).where(eq(shiftSchedules.hubId, hId))
    // Client decrypts encryptedName with hub key
    return rows.map((r) => this.#rowToSchedule(r))
  }

  async createSchedule(data: CreateScheduleData): Promise<ShiftSchedule> {
    if (!isValidTimeFormat(data.startTime) || !isValidTimeFormat(data.endTime)) {
      throw new AppError(400, 'Invalid time format — expected HH:MM (00:00–23:59)')
    }
    // Client-provided id is required for AAD binding: the client seals the
    // ciphertext with buildAad(label, id, fieldName) before POST. Accept it
    // verbatim so decrypt on refetch matches. Legacy callers that omit id
    // fall back to a server-generated UUID.
    const id = data.id ?? crypto.randomUUID()
    const hId = data.hubId ?? 'global'
    // Client provides hub-key encrypted name
    const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
    const [row] = await this.db
      .insert(shiftSchedules)
      .values({
        id,
        hubId: hId,
        encryptedName,
        startTime: data.startTime,
        endTime: data.endTime,
        days: data.days,
        userPubkeys: data.userPubkeys,
        ringGroupId: data.ringGroupId ?? null,
      })
      .returning()
    return this.#rowToSchedule(row)
  }

  async updateSchedule(
    id: string,
    hubId: string,
    data: Partial<CreateScheduleData>
  ): Promise<ShiftSchedule> {
    if (
      (data.startTime && !isValidTimeFormat(data.startTime)) ||
      (data.endTime && !isValidTimeFormat(data.endTime))
    ) {
      throw new AppError(400, 'Invalid time format — expected HH:MM (00:00–23:59)')
    }
    const whereClause = and(eq(shiftSchedules.id, id), eq(shiftSchedules.hubId, hubId))
    const rows = await this.db.select().from(shiftSchedules).where(whereClause).limit(1)
    if (!rows[0]) throw new AppError(404, 'Schedule not found')

    // Client provides hub-key encrypted name; fall back to plaintext name
    const encFields: Record<string, unknown> = {}
    if (data.encryptedName !== undefined) {
      encFields.encryptedName = data.encryptedName
    } else if (data.name !== undefined) {
      encFields.encryptedName = data.name as Ciphertext
    }

    const [row] = await this.db
      .update(shiftSchedules)
      .set({
        ...(data.startTime !== undefined ? { startTime: data.startTime } : {}),
        ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
        ...(data.days !== undefined ? { days: data.days } : {}),
        ...(data.userPubkeys !== undefined ? { userPubkeys: data.userPubkeys } : {}),
        ...(data.ringGroupId !== undefined ? { ringGroupId: data.ringGroupId } : {}),
        ...encFields,
      })
      .where(whereClause)
      .returning()
    return this.#rowToSchedule(row)
  }

  async deleteSchedule(id: string, hubId: string): Promise<void> {
    await this.db
      .delete(shiftSchedules)
      .where(and(eq(shiftSchedules.id, id), eq(shiftSchedules.hubId, hubId)))
  }

  // ------------------------------------------------------------------ Overrides

  async getOverrides(hubId?: string): Promise<ShiftOverride[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(shiftOverrides).where(eq(shiftOverrides.hubId, hId))
    return rows.map((r) => this.#rowToOverride(r))
  }

  async createOverride(data: CreateOverrideData): Promise<ShiftOverride> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(shiftOverrides)
      .values({
        id,
        hubId: data.hubId ?? 'global',
        scheduleId: data.scheduleId ?? null,
        date: data.date,
        type: data.type,
        userPubkeys: data.userPubkeys ?? null,
      })
      .returning()
    return this.#rowToOverride(row)
  }

  async deleteOverride(id: string): Promise<void> {
    await this.db.delete(shiftOverrides).where(eq(shiftOverrides.id, id))
  }

  // ------------------------------------------------------------------ Ring Groups

  async getRingGroups(hubId?: string): Promise<RingGroup[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(ringGroups).where(eq(ringGroups.hubId, hId))
    // Client decrypts encryptedName with hub key
    return rows.map((r) => this.#rowToRingGroup(r))
  }

  async createRingGroup(data: CreateRingGroupData): Promise<RingGroup> {
    // Client-provided id is required for AAD binding: the client seals the
    // ciphertext with buildAad(label, id, fieldName) before POST. Accept it
    // verbatim so decrypt on refetch matches. Legacy callers that omit id
    // fall back to a server-generated UUID.
    const id = data.id ?? crypto.randomUUID()
    const hId = data.hubId ?? 'global'
    // Client provides hub-key encrypted name
    const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
    const [row] = await this.db
      .insert(ringGroups)
      .values({
        id,
        hubId: hId,
        encryptedName,
        userPubkeys: data.userPubkeys,
      })
      .returning()
    return this.#rowToRingGroup(row)
  }

  async updateRingGroup(id: string, data: Partial<CreateRingGroupData>): Promise<RingGroup> {
    const rows = await this.db.select().from(ringGroups).where(eq(ringGroups.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Ring group not found')

    // Client provides hub-key encrypted name; fall back to plaintext name
    const encFields: Record<string, unknown> = {}
    if (data.encryptedName !== undefined) {
      encFields.encryptedName = data.encryptedName
    } else if (data.name !== undefined) {
      encFields.encryptedName = data.name as Ciphertext
    }

    const [row] = await this.db
      .update(ringGroups)
      .set({
        ...(data.userPubkeys !== undefined ? { userPubkeys: data.userPubkeys } : {}),
        ...encFields,
      })
      .where(eq(ringGroups.id, id))
      .returning()
    return this.#rowToRingGroup(row)
  }

  async deleteRingGroup(id: string): Promise<void> {
    await this.db.delete(ringGroups).where(eq(ringGroups.id, id))
  }

  // ------------------------------------------------------------------ Active Shifts

  async startShift(data: StartShiftData): Promise<ActiveShift> {
    const hId = data.hubId ?? 'global'
    const [row] = await this.db
      .insert(activeShifts)
      .values({
        pubkey: data.pubkey,
        hubId: hId,
        startedAt: new Date(),
        ringGroupId: data.ringGroupId ?? null,
      })
      .onConflictDoUpdate({
        target: [activeShifts.pubkey, activeShifts.hubId],
        set: {
          startedAt: new Date(),
          ringGroupId: data.ringGroupId ?? null,
        },
      })
      .returning()
    return this.#rowToActiveShift(row)
  }

  async endShift(pubkey: string, hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'
    await this.db
      .delete(activeShifts)
      .where(and(eq(activeShifts.pubkey, pubkey), eq(activeShifts.hubId, hId)))
  }

  async getActiveShifts(hubId?: string): Promise<ActiveShift[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(activeShifts).where(eq(activeShifts.hubId, hId))
    return rows.map((r) => this.#rowToActiveShift(r))
  }

  /**
   * Get the effective set of user pubkeys who should currently be on shift.
   * Applies schedule overrides (cancel/substitute) and filters to only clocked-in users.
   */
  async getEffectiveUsers(hubId?: string): Promise<string[]> {
    const hId = hubId ?? 'global'
    const schedules = await this.getSchedules(hId)
    const now = new Date()
    const currentDay = now.getUTCDay()
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`
    const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`

    // Build a map of schedule id → user pubkeys for active schedules right now
    const activeScheduleUsers = new Map<string, string[]>()
    for (const shift of schedules) {
      if (!shift.days.includes(currentDay)) continue
      const startsBeforeEnds = shift.startTime <= shift.endTime
      let isActive: boolean
      if (startsBeforeEnds) {
        isActive = currentTime >= shift.startTime && currentTime < shift.endTime
      } else {
        // Crosses midnight
        isActive = currentTime >= shift.startTime || currentTime < shift.endTime
      }
      if (isActive) {
        activeScheduleUsers.set(shift.id, [...shift.userPubkeys])
      }
    }

    // Apply today's overrides
    const overrides = await this.getOverrides(hId)
    const todayOverrides = overrides.filter((o) => o.date === todayStr)
    for (const override of todayOverrides) {
      if (override.scheduleId) {
        // Override targets a specific schedule
        if (override.type === 'cancel') {
          activeScheduleUsers.delete(override.scheduleId)
        } else if (override.type === 'substitute' && override.userPubkeys) {
          if (activeScheduleUsers.has(override.scheduleId)) {
            activeScheduleUsers.set(override.scheduleId, override.userPubkeys)
          }
        }
      } else {
        // Override targets all schedules (global cancel/substitute for the day)
        if (override.type === 'cancel') {
          activeScheduleUsers.clear()
        } else if (override.type === 'substitute' && override.userPubkeys) {
          for (const schedId of activeScheduleUsers.keys()) {
            activeScheduleUsers.set(schedId, override.userPubkeys)
          }
        }
      }
    }

    // Collect all schedule-assigned users
    const scheduledSet = new Set<string>()
    for (const pubkeys of activeScheduleUsers.values()) {
      for (const pubkey of pubkeys) {
        scheduledSet.add(pubkey)
      }
    }

    // Filter to only those who are actually clocked in (in activeShifts)
    const clocked = await this.getActiveShifts(hId)
    const clockedSet = new Set(clocked.map((s) => s.pubkey))

    return Array.from(scheduledSet).filter((pk) => clockedSet.has(pk))
  }

  async getUserStatus(
    pubkey: string,
    hubId?: string
  ): Promise<{
    onShift: boolean
    currentShift: { name: string; startTime: string; endTime: string } | null
    nextShift: { name: string; startTime: string; endTime: string; day: number } | null
  }> {
    const hId = hubId ?? 'global'
    const schedules = await this.getSchedules(hId)
    const myShifts = schedules.filter((s) => s.userPubkeys.includes(pubkey))

    const now = new Date()
    const currentDay = now.getUTCDay()
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`

    let currentShift: { name: string; startTime: string; endTime: string } | null = null
    for (const shift of myShifts) {
      if (!shift.days.includes(currentDay)) continue
      const startsBeforeEnds = shift.startTime <= shift.endTime
      let isActive: boolean
      if (startsBeforeEnds) {
        isActive = currentTime >= shift.startTime && currentTime < shift.endTime
      } else {
        isActive = currentTime >= shift.startTime || currentTime < shift.endTime
      }
      if (isActive) {
        currentShift = { name: shift.name, startTime: shift.startTime, endTime: shift.endTime }
        break
      }
    }

    let nextShift: { name: string; startTime: string; endTime: string; day: number } | null = null
    if (myShifts.length > 0) {
      let bestMinutesAway = Number.POSITIVE_INFINITY
      const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()

      for (const shift of myShifts) {
        for (const day of shift.days) {
          const [shiftH, shiftM] = shift.startTime.split(':').map(Number)
          const shiftMinutes = shiftH * 60 + shiftM
          let daysAway = day - currentDay
          if (daysAway < 0) daysAway += 7
          if (daysAway === 0 && shiftMinutes <= currentMinutes) daysAway = 7
          const minutesAway = daysAway * 24 * 60 + (shiftMinutes - currentMinutes)
          if (minutesAway > 0 && minutesAway < bestMinutesAway) {
            if (currentShift && shift.name === currentShift.name && daysAway === 0) continue
            bestMinutesAway = minutesAway
            nextShift = {
              name: shift.name,
              startTime: shift.startTime,
              endTime: shift.endTime,
              day,
            }
          }
        }
      }
    }

    return { onShift: currentShift !== null, currentShift, nextShift }
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToSchedule(r: typeof shiftSchedules.$inferSelect): ShiftSchedule {
    return {
      id: r.id,
      hubId: r.hubId,
      name: '', // Client decrypts encryptedName with hub key
      encryptedName: r.encryptedName ?? undefined,
      startTime: r.startTime,
      endTime: r.endTime,
      days: r.days as number[],
      userPubkeys: r.userPubkeys as string[],
      ringGroupId: r.ringGroupId,
      createdAt: r.createdAt,
    }
  }

  #rowToOverride(r: typeof shiftOverrides.$inferSelect): ShiftOverride {
    return {
      id: r.id,
      hubId: r.hubId,
      scheduleId: r.scheduleId,
      date: r.date,
      type: r.type,
      userPubkeys: r.userPubkeys as string[] | null,
      createdAt: r.createdAt,
    }
  }

  #rowToRingGroup(r: typeof ringGroups.$inferSelect): RingGroup {
    return {
      id: r.id,
      hubId: r.hubId,
      name: '', // Client decrypts encryptedName with hub key
      encryptedName: r.encryptedName ?? undefined,
      userPubkeys: r.userPubkeys as string[],
      createdAt: r.createdAt,
    }
  }

  #rowToActiveShift(r: typeof activeShifts.$inferSelect): ActiveShift {
    return {
      pubkey: r.pubkey,
      hubId: r.hubId,
      startedAt: r.startedAt,
      ringGroupId: r.ringGroupId,
    }
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(activeShifts)
    await this.db.delete(shiftOverrides)
    // Preserve schedules and ring groups — they are configuration, not runtime data
  }
}
