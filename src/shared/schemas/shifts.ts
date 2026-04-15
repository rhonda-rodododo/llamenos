import { z } from 'zod/v4'

const ShiftScheduleSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  name: z.string(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().int().min(0).max(6)),
  userPubkeys: z.array(z.string()),
  ringGroupId: z.string().optional(),
  createdAt: z.iso.datetime(),
})
export type ShiftSchedule = z.infer<typeof ShiftScheduleSchema>

const CreateShiftScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().int().min(0).max(6)),
  userPubkeys: z.array(z.string()),
  ringGroupId: z.string().optional(),
  hubId: z.string().optional(),
})
type CreateShiftScheduleInput = z.infer<typeof CreateShiftScheduleSchema>

const UpdateShiftScheduleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  days: z.array(z.number().int().min(0).max(6)).optional(),
  userPubkeys: z.array(z.string()).optional(),
  ringGroupId: z.string().optional(),
  hubId: z.string().optional(),
})
type UpdateShiftScheduleInput = z.infer<typeof UpdateShiftScheduleSchema>

const RingGroupSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  name: z.string(),
  userPubkeys: z.array(z.string()),
  createdAt: z.iso.datetime(),
})
export type RingGroup = z.infer<typeof RingGroupSchema>

const CreateRingGroupSchema = z.object({
  name: z.string().min(1).max(100),
  userPubkeys: z.array(z.string()),
  hubId: z.string().optional(),
})
type CreateRingGroupInput = z.infer<typeof CreateRingGroupSchema>

const ActiveShiftSchema = z.object({
  pubkey: z.string(),
  hubId: z.string(),
  startedAt: z.iso.datetime(),
  ringGroupId: z.string().optional(),
})
export type ActiveShift = z.infer<typeof ActiveShiftSchema>

const ShiftOverrideSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  scheduleId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['cancel', 'substitute']),
  userPubkeys: z.array(z.string()).optional(),
})
export type ShiftOverride = z.infer<typeof ShiftOverrideSchema>
