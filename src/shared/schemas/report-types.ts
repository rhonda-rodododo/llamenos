import { z } from 'zod/v4'

// ── Create Report Type ──
export const CreateReportTypeSchema = z
  .object({
    // Client-generated UUID. Required when `encryptedName` is provided so the
    // server stores the same id the client used as AAD `recordId`.
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
const ReportTypeSchema = z.object({
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
