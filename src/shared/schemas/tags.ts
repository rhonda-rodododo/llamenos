import { z } from 'zod/v4'

// ── Create Tag ──
// name is the plaintext fallback when hub key is unavailable; encryptedLabel is the
// hub-key-encrypted label. At least one must be provided (server falls back: encryptedLabel ?? name).
export const CreateTagSchema = z
  .object({
    name: z.string().min(1).optional(),
    encryptedLabel: z.string().min(1).optional(),
    color: z.string().optional(),
    encryptedCategory: z.string().optional(),
  })
  .refine((data) => data.name !== undefined || data.encryptedLabel !== undefined, {
    message: 'Either name or encryptedLabel must be provided',
  })
type CreateTagInput = z.infer<typeof CreateTagSchema>

// ── Update Tag ──
export const UpdateTagSchema = z.object({
  encryptedLabel: z.string().optional(),
  color: z.string().optional(),
  encryptedCategory: z.string().nullable().optional(),
})
type UpdateTagInput = z.infer<typeof UpdateTagSchema>
