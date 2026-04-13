import { beforeAll, describe, expect, test } from 'bun:test'
import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { ActiveCallBadge, type E2eeBadgeState } from './ActiveCallBadge'

// Minimal i18n bootstrap so `useTranslation().t(...)` returns real strings
// during SSR rendering. This is a bun:test-friendly alternative to
// @testing-library/react, which is not installed in this project.
const BADGE_RESOURCES = {
  voice: {
    e2ee: {
      badge: {
        direct: 'End-to-end encrypted (direct)',
        relayed: 'End-to-end encrypted (relayed)',
        none: 'Not end-to-end encrypted',
      },
    },
  },
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: BADGE_RESOURCES } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })
  } else {
    // i18n is a singleton — merge keys into the existing bundle when another
    // test file has already initialised i18next.
    i18n.addResourceBundle('en', 'translation', BADGE_RESOURCES, true, true)
  }
})

function renderBadge(state: E2eeBadgeState): string {
  return renderToStaticMarkup(<ActiveCallBadge state={state} />)
}

describe('ActiveCallBadge', () => {
  test('renders e2ee-direct state with direct label and green chip', () => {
    const html = renderBadge('e2ee-direct')
    expect(html).toContain('data-testid="call-e2ee-badge"')
    expect(html).toContain('data-badge-state="e2ee-direct"')
    expect(html).toContain('aria-label="End-to-end encrypted (direct)"')
    expect(html).toContain('End-to-end encrypted (direct)')
    expect(html).toContain('bg-green-100')
  })

  test('renders e2ee-relayed state with relayed label and blue chip', () => {
    const html = renderBadge('e2ee-relayed')
    expect(html).toContain('data-badge-state="e2ee-relayed"')
    expect(html).toContain('aria-label="End-to-end encrypted (relayed)"')
    expect(html).toContain('End-to-end encrypted (relayed)')
    expect(html).toContain('bg-blue-100')
  })

  test('renders not-e2ee state with none label and yellow chip', () => {
    const html = renderBadge('not-e2ee')
    expect(html).toContain('data-badge-state="not-e2ee"')
    expect(html).toContain('aria-label="Not end-to-end encrypted"')
    expect(html).toContain('Not end-to-end encrypted')
    expect(html).toContain('bg-yellow-100')
  })
})
