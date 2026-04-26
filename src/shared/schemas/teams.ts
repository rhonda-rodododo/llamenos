import { z } from 'zod/v4'

// ── Create Team ──
const CreateTeamSchema = z.object({
  encryptedName: z.string().min(1),
  encryptedDescription: z.string().optional(),
})
export type CreateTeamInput = z.infer<typeof CreateTeamSchema>

// ── Update Team ──
const UpdateTeamSchema = z.object({
  encryptedName: z.string().optional(),
  encryptedDescription: z.string().nullable().optional(),
})
export type UpdateTeamInput = z.infer<typeof UpdateTeamSchema>
