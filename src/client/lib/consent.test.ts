/**
 * Unit tests for the consent module-state cache.
 *
 * `isConsentGranted()` is the authoritative source of truth for non-React
 * code (the SFrame call hook) that needs to refuse sensitive operations
 * pre-consent. These tests pin its adversarial invariants:
 *
 *   - Defaults to false (any code that runs before `useConsent` has fetched
 *     status must fail closed, not fail open).
 *   - Test helpers (`__setConsentGrantedForTest`, `__resetConsentState`)
 *     flip the cache deterministically so other suites can isolate state.
 *
 * The `useConsent` React hook is exercised indirectly via the ConsentGate
 * static-render tests in `consent-gate.test.tsx` — this file keeps its
 * scope limited to the pure module state machine so it doesn't need a
 * DOM or an i18n bootstrap.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetConsentState, __setConsentGrantedForTest, isConsentGranted } from './consent'

describe('consent module state', () => {
  beforeEach(() => {
    __resetConsentState()
  })

  afterEach(() => {
    __resetConsentState()
  })

  test('defaults to false before any status is loaded', () => {
    expect(isConsentGranted()).toBe(false)
  })

  test('__setConsentGrantedForTest(true) flips the cache', () => {
    __setConsentGrantedForTest(true)
    expect(isConsentGranted()).toBe(true)
  })

  test('__setConsentGrantedForTest(false) resets the cache', () => {
    __setConsentGrantedForTest(true)
    __setConsentGrantedForTest(false)
    expect(isConsentGranted()).toBe(false)
  })

  test('__resetConsentState brings the cache back to false', () => {
    __setConsentGrantedForTest(true)
    __resetConsentState()
    expect(isConsentGranted()).toBe(false)
  })

  test('cache persists across multiple isConsentGranted() reads', () => {
    __setConsentGrantedForTest(true)
    expect(isConsentGranted()).toBe(true)
    expect(isConsentGranted()).toBe(true)
    expect(isConsentGranted()).toBe(true)
  })

  test('reset is idempotent', () => {
    __resetConsentState()
    __resetConsentState()
    __resetConsentState()
    expect(isConsentGranted()).toBe(false)
  })
})
