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

// ── Add Members ──
const AddTeamMembersSchema = z.object({
  pubkeys: z.array(z.string().min(1)).min(1),
})
export type AddTeamMembersInput = z.infer<typeof AddTeamMembersSchema>

// ── Assign Contacts ──
const AssignTeamContactsSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1),
})
export type AssignTeamContactsInput = z.infer<typeof AssignTeamContactsSchema>
