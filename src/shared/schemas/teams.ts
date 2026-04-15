import { z } from 'zod/v4'

// ── Create Team ──
export const CreateTeamSchema = z.object({
  encryptedName: z.string().min(1),
  encryptedDescription: z.string().optional(),
})
type CreateTeamInput = z.infer<typeof CreateTeamSchema>

// ── Update Team ──
export const UpdateTeamSchema = z.object({
  encryptedName: z.string().optional(),
  encryptedDescription: z.string().nullable().optional(),
})
type UpdateTeamInput = z.infer<typeof UpdateTeamSchema>

// ── Add Members ──
export const AddTeamMembersSchema = z.object({
  pubkeys: z.array(z.string().min(1)).min(1),
})
type AddTeamMembersInput = z.infer<typeof AddTeamMembersSchema>

// ── Assign Contacts ──
export const AssignTeamContactsSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1),
})
type AssignTeamContactsInput = z.infer<typeof AssignTeamContactsSchema>
