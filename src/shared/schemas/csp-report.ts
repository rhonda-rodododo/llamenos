import { z } from 'zod'

export const LegacyCspReportSchema = z.object({
  'csp-report': z.object({
    'document-uri': z.string().optional(),
    'violated-directive': z.string(),
    'effective-directive': z.string().optional(),
    'original-policy': z.string().optional(),
    'blocked-uri': z.string().optional(),
    'status-code': z.number().optional(),
    'source-file': z.string().optional(),
    'line-number': z.number().optional(),
    'column-number': z.number().optional(),
    disposition: z.enum(['enforce', 'report']).optional(),
    referrer: z.string().optional(),
    'script-sample': z.string().optional(),
  }),
})

const ReportingApiBodySchema = z.object({
  type: z.string(),
  url: z.string().optional(),
  body: z.object({
    documentURL: z.string().optional(),
    violatedDirective: z.string().optional(),
    effectiveDirective: z.string().optional(),
    originalPolicy: z.string().optional(),
    blockedURL: z.string().optional(),
    statusCode: z.number().optional(),
    sourceFile: z.string().optional(),
    lineNumber: z.number().optional(),
    columnNumber: z.number().optional(),
    disposition: z.enum(['enforce', 'report']).optional(),
    referrer: z.string().optional(),
    sample: z.string().optional(),
  }),
})

export const ReportingApiBatchSchema = z.array(ReportingApiBodySchema).min(1).max(100)

export type LegacyCspReport = z.infer<typeof LegacyCspReportSchema>
export type ReportingApiBatch = z.infer<typeof ReportingApiBatchSchema>
