import type { ComponentType } from 'react'
import { CustomFieldsSection } from './custom-fields-section'
import { HubRolesSection } from './hub-roles-section'
import { LocationLookupSection } from './location-lookup-section'
import { PasskeyPolicySection } from './passkey-policy-section'
import { TagsSection } from './tags-section'
import { TeamsSection } from './teams-section'

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
