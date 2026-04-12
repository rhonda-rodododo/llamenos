import { z } from 'zod/v4'

// ── Create Report Type ──
export const CreateReportTypeSchema = z
  .object({
    // Client-generated UUID for AAD binding. When hub-field encryption is
    // active, the client encrypts the name/description with this ID as part of
    // the AAD. The server MUST use this as the record's primary key so the
    // ciphertext can be decrypted on read-back. If omitted, the server
    // generates its own UUID (plaintext-fallback path).
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(200).optional(),
    encryptedName: z.string().optional(),
    description: z.string().optional(),
    encryptedDescription: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.encryptedName !== undefined, {
    message: 'Either name or encryptedName must be provided',
  })
export type CreateReportTypeInput = z.infer<typeof CreateReportTypeSchema>

// ── Update Report Type ──
export const UpdateReportTypeSchema = z.object({
  name: z.string().optional(),
  encryptedName: z.string().optional(),
  description: z.string().optional(),
  encryptedDescription: z.string().optional(),
})
export type UpdateReportTypeInput = z.infer<typeof UpdateReportTypeSchema>

// ── Full Report Type entity ──
export const ReportTypeSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  encryptedName: z.string().optional(),
  encryptedDescription: z.string().optional(),
  isDefault: z.boolean(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ReportType = z.infer<typeof ReportTypeSchema>
