import { z } from 'zod/v4'
import { ChannelTypeSchema, CustomFieldContextSchema } from './common'
import { TelephonyProviderConfigSchema } from './providers'
export type { ChannelType } from './common'

export const HubSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  encryptedName: z.string().optional(),
  encryptedDescription: z.string().optional(),
  status: z.enum(['active', 'suspended', 'archived']),
  phoneNumber: z.string().optional(),
  createdBy: z.string(),
  allowSuperAdminAccess: z.boolean().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Hub = z.infer<typeof HubSchema>

const CreateHubSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  phoneNumber: z.string().optional(),
})
type CreateHubInput = z.infer<typeof CreateHubSchema>

const UpdateHubSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  phoneNumber: z.string().optional(),
  status: z.enum(['active', 'suspended', 'archived']).optional(),
})
type UpdateHubInput = z.infer<typeof UpdateHubSchema>

const RoleSchema = z.object({
  id: z.uuid(),
  hubId: z.string().optional(),
  name: z.string(),
  permissions: z.array(z.string()),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
})
export type Role = z.infer<typeof RoleSchema>

const CreateRoleSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()),
  isDefault: z.boolean().optional(),
  hubId: z.string().optional(),
})
type CreateRoleInput = z.infer<typeof CreateRoleSchema>

const UpdateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
})
type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>

const LocationFieldSettingsSchema = z.object({
  maxPrecision: z.enum(['none', 'city', 'neighborhood', 'block', 'exact']),
  allowGps: z.boolean(),
})

const CustomFieldValidationSchema = z.object({
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})

const CustomFieldDefinitionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  label: z.string(),
  type: z.enum([
    'text',
    'number',
    'select',
    'checkbox',
    'textarea',
    'file',
    'location',
    'contact',
    'contacts',
  ]),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  encryptedFieldName: z.string().optional(),
  encryptedLabel: z.string().optional(),
  encryptedOptions: z.string().optional(),
  validation: CustomFieldValidationSchema.optional(),
  visibleTo: z.string(),
  context: CustomFieldContextSchema,
  reportTypeIds: z.array(z.string()).optional(),
  maxFileSize: z.number().int().optional(),
  allowedMimeTypes: z.array(z.string()).optional(),
  maxFiles: z.number().int().optional(),
  locationSettings: LocationFieldSettingsSchema.optional(),
  order: z.number().int(),
  createdAt: z.string(),
})
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>

const SpamSettingsSchema = z.object({
  voiceCaptchaEnabled: z.boolean(),
  rateLimitEnabled: z.boolean(),
  maxCallsPerMinute: z.number().int().positive(),
  blockDurationMinutes: z.number().int().positive(),
})
export type SpamSettings = z.infer<typeof SpamSettingsSchema>

const CallSettingsSchema = z.object({
  queueTimeoutSeconds: z.number().int().positive(),
  voicemailMaxSeconds: z.number().int().positive(),
  voicemailMaxBytes: z.number().int().positive(),
  voicemailMode: z.enum(['auto', 'always', 'never']).default('auto'),
  voicemailRetentionDays: z.number().int().positive().nullable().optional(),
  callRecordingMaxBytes: z.number().int().positive().optional(),
  // Tier 5 — hub policy for voice call SFrame E2EE.
  voiceCallE2eePolicy: z.enum(['required', 'preferred', 'off']).default('preferred'),
})
export type CallSettings = z.infer<typeof CallSettingsSchema>

const TranscriptionSettingsSchema = z.object({
  globalEnabled: z.boolean(),
  allowUserOptOut: z.boolean(),
})
export type TranscriptionSettings = z.infer<typeof TranscriptionSettingsSchema>

const IvrLanguagesSchema = z.array(z.string())
type IvrLanguages = z.infer<typeof IvrLanguagesSchema>

const TelephonyConfigSchema = TelephonyProviderConfigSchema
type TelephonyConfig = z.infer<typeof TelephonyConfigSchema>

const MessagingChannelConfigSchema = z.object({
  channel: z.enum(['sms', 'whatsapp', 'signal', 'rcs', 'telegram']),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
})
type MessagingChannelConfig = z.infer<typeof MessagingChannelConfigSchema>

const MessagingConfigSchema = z.object({
  channels: z.array(MessagingChannelConfigSchema),
})
export type MessagingConfig = z.infer<typeof MessagingConfigSchema>

export const WebAuthnSettingsSchema = z.object({
  requireForAdmins: z.boolean(),
  requireForUsers: z.boolean(),
})
export type WebAuthnSettings = z.infer<typeof WebAuthnSettingsSchema>

export const GeocodingConfigSchema = z.object({
  provider: z.enum(['opencage', 'geoapify']).nullable(),
  countries: z.array(z.string()),
  enabled: z.boolean(),
})
export type GeocodingConfig = z.infer<typeof GeocodingConfigSchema>

export const SetupStateSchema = z.object({
  setupCompleted: z.boolean(),
  completedSteps: z.array(z.string()),
  pendingChannels: z.array(ChannelTypeSchema),
  selectedChannels: z.array(ChannelTypeSchema),
  demoMode: z.boolean().default(false),
})
export type SetupState = z.infer<typeof SetupStateSchema>

export const EnabledChannelsSchema = z.object({
  voice: z.boolean(),
  sms: z.boolean(),
  whatsapp: z.boolean(),
  signal: z.boolean(),
  rcs: z.boolean(),
  telegram: z.boolean(),
  reports: z.boolean(),
})
export type EnabledChannels = z.infer<typeof EnabledChannelsSchema>
