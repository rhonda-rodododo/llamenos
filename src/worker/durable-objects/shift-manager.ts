import { DurableObject } from 'cloudflare:workers'
import type { Env, Shift } from '../types'

/**
 * ShiftManagerDO — manages shift schedules and routing.
 * Determines which volunteers should receive calls at any given time.
 */
export class ShiftManagerDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    if (path === '/shifts' && method === 'GET') {
      return this.getShifts()
    }
    if (path === '/shifts' && method === 'POST') {
      return this.createShift(await request.json())
    }
    if (path.startsWith('/shifts/') && method === 'PATCH') {
      const id = path.split('/shifts/')[1]
      return this.updateShift(id, await request.json())
    }
    if (path.startsWith('/shifts/') && method === 'DELETE') {
      const id = path.split('/shifts/')[1]
      return this.deleteShift(id)
    }
    if (path === '/current-volunteers' && method === 'GET') {
      return this.getCurrentVolunteers()
    }
    if (path === '/my-status' && method === 'GET') {
      const pubkey = url.searchParams.get('pubkey') || ''
      return this.getMyStatus(pubkey)
    }

    // --- Test Reset (development only) ---
    if (path === '/reset' && method === 'POST') {
      await this.ctx.storage.deleteAll()
      return Response.json({ ok: true })
    }

    return new Response('Not Found', { status: 404 })
  }

  private async getShifts(): Promise<Response> {
    const shifts = await this.ctx.storage.get<Shift[]>('shifts') || []
    return Response.json({ shifts })
  }

  private async createShift(data: Omit<Shift, 'id' | 'createdAt'>): Promise<Response> {
    const shifts = await this.ctx.storage.get<Shift[]>('shifts') || []
    const shift: Shift = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    shifts.push(shift)
    await this.ctx.storage.put('shifts', shifts)
    return Response.json({ shift })
  }

  private async updateShift(id: string, data: Partial<Shift>): Promise<Response> {
    const shifts = await this.ctx.storage.get<Shift[]>('shifts') || []
    const idx = shifts.findIndex(s => s.id === id)
    if (idx === -1) return new Response('Not found', { status: 404 })
    shifts[idx] = { ...shifts[idx], ...data, id } // Don't change id
    await this.ctx.storage.put('shifts', shifts)
    return Response.json({ shift: shifts[idx] })
  }

  private async deleteShift(id: string): Promise<Response> {
    const shifts = await this.ctx.storage.get<Shift[]>('shifts') || []
    await this.ctx.storage.put('shifts', shifts.filter(s => s.id !== id))
    return Response.json({ ok: true })
  }

  /**
   * Returns the list of volunteer pubkeys who should be on shift right now.
   * Based on current time and day of week.
   */
  private async getCurrentVolunteers(): Promise<Response> {
    const shifts = await this.ctx.storage.get<Shift[]>('shifts') || []
    const now = new Date()
    const currentDay = now.getUTCDay()
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`

    const activeVolunteers = new Set<string>()

    for (const shift of shifts) {
      if (!shift.days.includes(currentDay)) continue

      // Handle shifts that cross midnight
      const startsBeforeEnds = shift.startTime <= shift.endTime

      let isActive: boolean
      if (startsBeforeEnds) {
        isActive = currentTime >= shift.startTime && currentTime < shift.endTime
      } else {
        // Crosses midnight: e.g., 22:00 - 06:00
        isActive = currentTime >= shift.startTime || currentTime < shift.endTime
      }

      if (isActive) {
        for (const pubkey of shift.volunteerPubkeys) {
          activeVolunteers.add(pubkey)
        }
      }
    }

    return Response.json({ volunteers: Array.from(activeVolunteers) })
  }

  /**
   * Returns the shift status for a specific volunteer:
   * - Whether they're currently on shift
   * - Their current shift details (if on shift)
   * - Their next upcoming shift (if any)
   */
  private async getMyStatus(pubkey: string): Promise<Response> {
    const shifts = await this.ctx.storage.get<Shift[]>('shifts') || []
    const now = new Date()
    const currentDay = now.getUTCDay()
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`

    // Find shifts that include this volunteer
    const myShifts = shifts.filter(s => s.volunteerPubkeys.includes(pubkey))

    // Find current active shift
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

    // Find next upcoming shift
    let nextShift: { name: string; startTime: string; endTime: string; day: number } | null = null
    if (myShifts.length > 0) {
      let bestMinutesAway = Infinity
      const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()

      for (const shift of myShifts) {
        for (const day of shift.days) {
          const shiftHours = parseInt(shift.startTime.split(':')[0])
          const shiftMins = parseInt(shift.startTime.split(':')[1])
          const shiftMinutes = shiftHours * 60 + shiftMins

          let daysAway = day - currentDay
          if (daysAway < 0) daysAway += 7
          if (daysAway === 0 && shiftMinutes <= currentMinutes) daysAway = 7

          const minutesAway = daysAway * 24 * 60 + (shiftMinutes - currentMinutes)
          if (minutesAway > 0 && minutesAway < bestMinutesAway) {
            // Skip if this is the currently active shift
            if (currentShift && shift.name === currentShift.name && daysAway === 0) continue
            bestMinutesAway = minutesAway
            nextShift = { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, day }
          }
        }
      }
    }

    return Response.json({
      onShift: currentShift !== null,
      currentShift,
      nextShift,
    })
  }
}
