import type { ComponentType } from 'react'

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
