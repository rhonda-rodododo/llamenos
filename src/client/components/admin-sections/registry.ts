import type { ComponentType } from 'react'
import { AnalyticsSection } from './analytics-section'
import { AuditSection } from './audit-section'
import { BansSection } from './bans-section'
import { CallSettingsSection } from './call-settings-section'
import { CustomFieldsSection } from './custom-fields-section'
import { FirehoseSection } from './firehose-section'
import { HealthSection } from './health-section'
import { HubRolesSection } from './hub-roles-section'
import { HubsSection } from './hubs-section'
import { LocationLookupSection } from './location-lookup-section'
import { MessagingSmsSection } from './messaging-sms-section'
import { PasskeyPolicySection } from './passkey-policy-section'
import { PhoneMenuLanguagesSection } from './phone-menu-languages-section'
import { PhoneProviderSection } from './phone-provider-section'
import { PlatformRolesSection } from './platform-roles-section'
import { PlatformSection } from './platform-section'
import { RcsChannelSection } from './rcs-channel-section'
import { ReportTypesSection } from './report-types-section'
import { SignalChannelSection } from './signal-channel-section'
import { SpamProtectionSection } from './spam-section'
import { TagsSection } from './tags-section'
import { TeamsSection } from './teams-section'
import { TranscriptionSection } from './transcription-section'
import { VoicePromptsSection } from './voice-prompts-section'

/**
 * Maps nav item slugs to section components. Populated as sections migrate.
 * Keep in sync with admin-nav-config.ts.
 */
const components: Record<string, ComponentType> = {}

export function registerSection(slug: string, component: ComponentType) {
  components[slug] = component
}

export function getSectionComponent(slug: string): ComponentType | undefined {
  return components[slug]
}

registerSection('location-lookup', LocationLookupSection)
registerSection('passkey-policy', PasskeyPolicySection)
registerSection('hub-roles', HubRolesSection)
registerSection('teams', TeamsSection)
registerSection('tags', TagsSection)
registerSection('custom-fields', CustomFieldsSection)
registerSection('report-types', ReportTypesSection)
registerSection('firehose', FirehoseSection)
registerSection('call-settings', CallSettingsSection)
registerSection('voice-prompts', VoicePromptsSection)
registerSection('phone-menu-languages', PhoneMenuLanguagesSection)
registerSection('transcription', TranscriptionSection)
registerSection('spam-protection', SpamProtectionSection)
registerSection('phone-provider', PhoneProviderSection)
registerSection('messaging-sms', MessagingSmsSection)
registerSection('rcs', RcsChannelSection)
registerSection('signal', SignalChannelSection)
registerSection('hubs', HubsSection)
registerSection('platform-roles', PlatformRolesSection)
registerSection('bans', BansSection)
registerSection('audit', AuditSection)
registerSection('analytics', AnalyticsSection)
registerSection('health', HealthSection)
registerSection('platform', PlatformSection)
