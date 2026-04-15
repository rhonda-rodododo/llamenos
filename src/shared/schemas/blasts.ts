import { z } from 'zod/v4'

const BlastChannelEnum = z.enum(['sms', 'whatsapp', 'signal', 'rcs'])

const BlastStatusEnum = z.enum(['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'])

export const BlastStatsSchema = z.object({
  totalRecipients: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  optedOut: z.number().int(),
})
export type BlastStats = z.infer<typeof BlastStatsSchema>

export const BlastSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  /** Plaintext name — populated client-side after hub-key decryption */
  name: z.string().optional(),
  /** Plaintext content — populated client-side after hub-key decryption */
  content: z.string().optional(),
  /** Hub-key encrypted name */
  encryptedName: z.string().optional(),
  /** Hub-key encrypted content */
  encryptedContent: z.string().optional(),
  targetChannels: z.array(BlastChannelEnum),
  status: BlastStatusEnum,
  stats: BlastStatsSchema,
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().optional(),
  scheduledAt: z.iso.datetime().optional(),
  error: z.string().optional(),
})
export type Blast = z.infer<typeof BlastSchema>

export const CreateBlastSchema = z.object({
  hubId: z.string().optional(),
  name: z.string().min(1).max(200),
  encryptedName: z.string().optional(),
  content: z.string().min(1),
  encryptedContent: z.string().optional(),
  targetChannels: z.array(BlastChannelEnum).min(1),
  scheduledAt: z.iso.datetime().optional(),
})
type CreateBlastInput = z.infer<typeof CreateBlastSchema>

export const SubscriberSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  phoneNumber: z.string(),
  channel: z.string(),
  active: z.boolean(),
  token: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
})
export type Subscriber = z.infer<typeof SubscriberSchema>

export const CreateSubscriberSchema = z.object({
  hubId: z.string().optional(),
  phoneNumber: z.string(),
  channel: z.string(),
  token: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
type CreateSubscriberInput = z.infer<typeof CreateSubscriberSchema>

export const BlastDeliverySchema = z.object({
  id: z.uuid(),
  blastId: z.string(),
  subscriberId: z.string(),
  status: z.enum(['pending', 'sent', 'delivered', 'failed', 'opted_out']),
  error: z.string().optional(),
  sentAt: z.iso.datetime().optional(),
})
export type BlastDelivery = z.infer<typeof BlastDeliverySchema>

export const BlastContentSchema = z.object({
  text: z.string(),
  mediaUrl: z.string().optional(),
  mediaType: z.string().optional(),
  smsText: z.string().optional(),
  whatsappTemplateId: z.string().optional(),
  rcsRichCard: z.boolean().optional(),
})
export type BlastContent = z.infer<typeof BlastContentSchema>

export const BlastSettingsSchema = z.object({
  subscribeKeyword: z.string(),
  unsubscribeKeyword: z.string(),
  confirmationMessage: z.string(),
  unsubscribeMessage: z.string(),
  doubleOptIn: z.boolean(),
  optOutFooter: z.string(),
  maxBlastsPerDay: z.number().int(),
  rateLimitPerSecond: z.number().int(),
})
export type BlastSettings = z.infer<typeof BlastSettingsSchema>

// ── Subscriber Preferences (public, token-validated) ──
export const PreferencesUpdateSchema = z.object({
  status: z.enum(['active', 'unsubscribed']).optional(),
  language: z.string().max(10).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
})
export type PreferencesUpdateInput = z.infer<typeof PreferencesUpdateSchema>
