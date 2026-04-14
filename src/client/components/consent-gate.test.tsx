/**
 * Adversarial tests for the ConsentGate overlay.
 *
 * The gate is the last UI-level enforcement point between an authenticated
 * user and the rest of the app. Its invariants:
 *
 *   - When the user is not authenticated (key locked), the gate MUST pass
 *     through children — there's no sensitive data behind it yet, and
 *     blocking would strand the user on the lock screen.
 *   - When the user is authenticated AND the consent status is still
 *     loading, the gate MUST pass through children (transient — the
 *     module-level `isConsentGranted()` is still false, so sensitive
 *     non-UI call paths still fail closed).
 *   - When the user is authenticated AND consent IS needed, the gate
 *     MUST render the overlay and hide children — children disappearing
 *     is the only thing preventing pre-consent React code from running.
 *   - When the user is authenticated AND consent is NOT needed, children
 *     render normally.
 *
 * `bun:test` has no @testing-library/react harness, so we drive the
 * component via `renderToStaticMarkup` after mocking `useConsent` to
 * control the hook return value.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import * as realConsentNS from '../lib/consent'

// Snapshot the real module before the mock is installed so `afterAll` can
// restore it — `mock.module` is process-wide in Bun, and sibling test files
// (e.g. `sframe-call-hook.test.ts`) import the real `isConsentGranted` /
// `__setConsentGrantedForTest`. Without this, the mocked noops leak into
// later suites.
const realConsent = { ...realConsentNS }

// Mock `useConsent` before importing ConsentGate so the module binding is
// replaced at import time. Each test overrides the implementation.
const mockUseConsent = mock(() => ({
  needsConsent: false,
  isLoading: false,
  submitConsentVersion: async () => {},
}))

mock.module('../lib/consent', () => ({
  ...realConsent,
  useConsent: mockUseConsent,
}))

const CONSENT_RESOURCES = {
  consent: {
    title: 'Data processing consent',
    subtitle: 'Review and agree before continuing',
    intro: 'We process your data to provide the hotline service.',
    dataCollected: {
      title: 'Data we collect',
      accountInfo: 'Account info',
      callNotes: 'Call notes',
      sessions: 'Session metadata',
      auditLog: 'Audit trail',
    },
    howWeProtect: {
      title: 'How we protect it',
      e2ee: 'End-to-end encryption',
      noPlaintext: 'No plaintext on servers',
      retention: 'Minimal retention',
    },
    yourRights: {
      title: 'Your rights',
      access: 'Access',
      portability: 'Portability',
      erasure: 'Erasure',
    },
    gdprNote: 'EU GDPR applies.',
    version: 'Policy version {{version}}',
    scrollToRead: 'Scroll to the bottom to enable the agree button.',
    agree: 'I agree',
    submitting: 'Submitting...',
  },
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: CONSENT_RESOURCES } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })
  } else {
    i18n.addResourceBundle('en', 'translation', CONSENT_RESOURCES, true, true)
  }
})

afterAll(() => {
  // Restore the real module so sibling test files that import
  // `isConsentGranted` / `__setConsentGrantedForTest` see the real
  // implementation instead of the stubs installed above.
  mock.module('../lib/consent', () => realConsent)
})

// Import ConsentGate AFTER the mock is installed so it binds to the stub.
import { ConsentGate } from './consent-gate'

const CHILDREN_MARKER = '<span data-testid="child-content">child-content</span>'
const GATE_TESTID = 'data-testid="consent-gate"'
const AGREE_BUTTON_TESTID = 'data-testid="consent-agree-button"'

function renderGate(props: {
  isKeyUnlocked: boolean
  needsConsent: boolean
  isLoading: boolean
}): string {
  mockUseConsent.mockImplementation(() => ({
    needsConsent: props.needsConsent,
    isLoading: props.isLoading,
    submitConsentVersion: async () => {},
  }))
  return renderToStaticMarkup(
    <ConsentGate isKeyUnlocked={props.isKeyUnlocked}>
      <span data-testid="child-content">child-content</span>
    </ConsentGate>
  )
}

describe('ConsentGate — authenticated + consent needed (gate ACTIVE)', () => {
  test('renders overlay and HIDES children when needsConsent=true', () => {
    const html = renderGate({ isKeyUnlocked: true, needsConsent: true, isLoading: false })
    expect(html).toContain(GATE_TESTID)
    expect(html).toContain(AGREE_BUTTON_TESTID)
    expect(html).not.toContain(CHILDREN_MARKER)
  })

  test('agree button is disabled until user scrolls to bottom', () => {
    const html = renderGate({ isKeyUnlocked: true, needsConsent: true, isLoading: false })
    // The button is rendered with `disabled` on initial mount (hasScrolled=false).
    // Attribute order isn't guaranteed by React's SSR renderer, so match both.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="consent-agree-button"/)
  })

  test('scroll-to-read hint is visible on initial render', () => {
    const html = renderGate({ isKeyUnlocked: true, needsConsent: true, isLoading: false })
    expect(html).toContain('Scroll to the bottom to enable the agree button.')
  })

  test('overlay contains policy version string', () => {
    const html = renderGate({ isKeyUnlocked: true, needsConsent: true, isLoading: false })
    // CONSENT_VERSION is interpolated by the t('consent.version') call
    expect(html).toContain('Policy version')
  })
})

describe('ConsentGate — bypass paths (gate INACTIVE)', () => {
  test('key locked → children render, no overlay (no data to protect yet)', () => {
    const html = renderGate({ isKeyUnlocked: false, needsConsent: true, isLoading: false })
    expect(html).toContain(CHILDREN_MARKER)
    expect(html).not.toContain(GATE_TESTID)
  })

  test('still loading consent status → children render (transient)', () => {
    const html = renderGate({ isKeyUnlocked: true, needsConsent: true, isLoading: true })
    expect(html).toContain(CHILDREN_MARKER)
    expect(html).not.toContain(GATE_TESTID)
  })

  test('consent already granted (needsConsent=false) → children render', () => {
    const html = renderGate({ isKeyUnlocked: true, needsConsent: false, isLoading: false })
    expect(html).toContain(CHILDREN_MARKER)
    expect(html).not.toContain(GATE_TESTID)
  })
})

describe('ConsentGate — adversarial: inconsistent states', () => {
  test('unauthenticated + not-loading + needsConsent still bypasses (auth gate wins)', () => {
    // An attacker who can flip needsConsent to true but can't unlock the key
    // cannot use that to render the overlay — the auth gate short-circuits.
    const html = renderGate({ isKeyUnlocked: false, needsConsent: true, isLoading: false })
    expect(html).not.toContain(GATE_TESTID)
  })

  test('authenticated + loading + needsConsent=false still bypasses', () => {
    // The isLoading flag alone is enough to bypass, so a race where loading
    // is true but needsConsent has been flipped to false doesn't strand
    // the user behind a nonexistent gate.
    const html = renderGate({ isKeyUnlocked: true, needsConsent: false, isLoading: true })
    expect(html).toContain(CHILDREN_MARKER)
    expect(html).not.toContain(GATE_TESTID)
  })
})
