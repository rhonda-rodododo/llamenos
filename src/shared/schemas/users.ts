import { z } from 'zod/v4'

export const UserSchema = z.object({
  pubkey: z.string(),
  name: z.string(),
  phone: z.string().optional(),
  roles: z.array(z.string()),
  hubRoles: z.array(z.object({ hubId: z.string(), roleIds: z.array(z.string()) })).optional(),
  active: z.boolean(),
  transcriptionEnabled: z.boolean(),
  spokenLanguages: z.array(z.string()),
  uiLanguage: z.string(),
  profileCompleted: z.boolean(),
  onBreak: z.boolean(),
  callPreference: z.enum(['phone', 'browser', 'both']),
  supportedMessagingChannels: z.array(z.string()).optional(),
  messagingEnabled: z.boolean().optional(),
  createdAt: z.iso.datetime(),
})
export type User = z.infer<typeof UserSchema>

export const CreateUserSchema = z.object({
  pubkey: z.string().length(64),
  name: z.string().min(1).max(100),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .optional()
    .or(z.literal('')),
  roleIds: z.array(z.string()).default(['role-volunteer']),
  encryptedSecretKey: z.string().optional().default(''),
})
type CreateUserInput = z.infer<typeof CreateUserSchema>

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .optional()
    .or(z.literal('')),
  roles: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  transcriptionEnabled: z.boolean().optional(),
  spokenLanguages: z.array(z.string()).optional(),
  uiLanguage: z.string().optional(),
  profileCompleted: z.boolean().optional(),
  onBreak: z.boolean().optional(),
  callPreference: z.enum(['phone', 'browser', 'both']).optional(),
  supportedMessagingChannels: z.array(z.string()).optional(),
  messagingEnabled: z.boolean().optional(),
})
type UpdateUserInput = z.infer<typeof UpdateUserSchema>

export const InviteCodeSchema = z.object({
  code: z.string(),
  name: z.string(),
  phone: z.string(),
  roleIds: z.array(z.string()),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  usedAt: z.iso.datetime().optional(),
  usedBy: z.string().optional(),
})
export type InviteCode = z.infer<typeof InviteCodeSchema>

export const CreateInviteSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .optional()
    .or(z.literal('')),
  roleIds: z.array(z.string()).default(['role-volunteer']),
})
type CreateInviteInput = z.infer<typeof CreateInviteSchema>

export const ServerSessionSchema = z.object({
  token: z.string(),
  pubkey: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
})
export type ServerSession = z.infer<typeof ServerSessionSchema>
