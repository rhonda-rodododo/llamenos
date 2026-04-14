import { z } from 'zod/v4'
import { RecipientEnvelopeSchema } from './records'

// ── Firehose Connection ──

export const FirehoseConnectionStatusSchema = z.enum(['pending', 'active', 'paused', 'disabled'])
export type FirehoseConnectionStatus = z.infer<typeof FirehoseConnectionStatusSchema>

export const CreateFirehoseConnectionSchema = z.object({
  // Client-generated UUID. Required when `encryptedDisplayName` is provided so
  // the server stores the same id the client used as AAD `recordId`.
  id: z.string().uuid().optional(),
  displayName: z.string().optional(),
  encryptedDisplayName: z.string().optional(),
  reportTypeId: z.string(),
  geoContext: z.string().optional(),
  geoContextCountryCodes: z.array(z.string().length(2)).optional(),
  inferenceEndpoint: z.string().url().optional(),
  extractionIntervalSec: z.number().int().min(30).max(300).optional(),
  systemPromptSuffix: z.string().max(2000).optional(),
  bufferTtlDays: z.number().int().min(1).max(30).optional(),
  notifyViaSignal: z.boolean().optional(),
})
export type CreateFirehoseConnectionInput = z.infer<typeof CreateFirehoseConnectionSchema>

export const UpdateFirehoseConnectionSchema = z.object({
  displayName: z.string().optional(),
  encryptedDisplayName: z.string().optional(),
  reportTypeId: z.string().optional(),
  geoContext: z.string().nullable().optional(),
  geoContextCountryCodes: z.array(z.string().length(2)).nullable().optional(),
  inferenceEndpoint: z.string().url().nullable().optional(),
  extractionIntervalSec: z.number().int().min(30).max(300).optional(),
  systemPromptSuffix: z.string().max(2000).nullable().optional(),
  bufferTtlDays: z.number().int().min(1).max(30).optional(),
  notifyViaSignal: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'disabled']).optional(),
})
export type UpdateFirehoseConnectionInput = z.infer<typeof UpdateFirehoseConnectionSchema>

export const FirehoseConnectionSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  signalGroupId: z.string().nullable(),
  displayName: z.string(),
  encryptedDisplayName: z.string().optional(),
  reportTypeId: z.string(),
  agentPubkey: z.string(),
  geoContext: z.string().nullable(),
  geoContextCountryCodes: z.array(z.string()).nullable(),
  inferenceEndpoint: z.string().nullable(),
  extractionIntervalSec: z.number(),
  systemPromptSuffix: z.string().nullable(),
  bufferTtlDays: z.number(),
  notifyViaSignal: z.boolean(),
  status: FirehoseConnectionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type FirehoseConnection = z.infer<typeof FirehoseConnectionSchema>

// ── Firehose Health/Status ──

export const FirehoseConnectionHealthSchema = z.object({
  id: z.string(),
  status: FirehoseConnectionStatusSchema,
  lastMessageReceived: z.string().nullable(),
  lastReportSubmitted: z.string().nullable(),
  bufferSize: z.number(),
  extractionCount: z.number(),
  inferenceHealthMs: z.number().nullable(),
})
export type FirehoseConnectionHealth = z.infer<typeof FirehoseConnectionHealthSchema>

// ── Buffer Envelope Types ──

export const BufferEnvelopeJsonSchema = z.object({
  encrypted: z.string(),
  envelopes: z.array(RecipientEnvelopeSchema),
})
export type BufferEnvelopeJson = z.infer<typeof BufferEnvelopeJsonSchema>

// ── Extraction Types (internal, not API-facing) ──

export const ExtractedReportFieldsSchema = z.record(z.string(), z.string())

export const SourceMessageSchema = z.object({
  signalUsername: z.string(),
  timestamp: z.string(),
  content: z.string(),
  messageId: z.string(),
})

export const ResolvedLocationSchema = z.object({
  fieldName: z.string(),
  rawText: z.string(),
  resolved: z
    .object({
      address: z.string(),
      displayName: z.string().optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      countryCode: z.string().optional(),
    })
    .nullable(),
})
