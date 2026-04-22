import { afterEach, describe, expect, test } from 'bun:test'
import { installTrustedTypesPolicy } from './trusted-types-policy'

describe('installTrustedTypesPolicy', () => {
  const origWindow = globalThis.window

  afterEach(() => {
    globalThis.window = origWindow
  })

  test('no-op when trustedTypes is absent', () => {
    globalThis.window = {} as Window & typeof globalThis
    expect(() => installTrustedTypesPolicy()).not.toThrow()
  })

  test('no-op when window is undefined', () => {
    // biome-ignore lint/performance/noDelete: test cleanup
    delete (globalThis as Record<string, unknown>).window
    expect(() => installTrustedTypesPolicy()).not.toThrow()
    globalThis.window = origWindow
  })

  test('creates both llamenos and default policies', () => {
    const policyNames: string[] = []
    globalThis.window = {
      trustedTypes: {
        createPolicy(name: string, _rules: Record<string, unknown>) {
          policyNames.push(name)
          return {}
        },
      },
    } as unknown as Window & typeof globalThis

    installTrustedTypesPolicy()
    expect(policyNames).toEqual(['llamenos', 'default'])
  })

  function captureBothPolicies() {
    const rulesByName: Record<string, Record<string, (input: string) => string>> = {}
    globalThis.window = {
      trustedTypes: {
        createPolicy(name: string, rules: Record<string, (input: string) => string>) {
          rulesByName[name] = rules
          return {}
        },
      },
      location: { origin: 'https://example.com' },
    } as unknown as Window & typeof globalThis
    installTrustedTypesPolicy()
    return rulesByName
  }

  test('createScriptURL blocks cross-origin URLs in both policies', () => {
    const rules = captureBothPolicies()
    for (const name of ['llamenos', 'default']) {
      expect(() => rules[name].createScriptURL('https://evil.example/x.js')).toThrow(
        /cross-origin/i
      )
    }
  })

  test('createScriptURL allows same-origin URLs in both policies', () => {
    const rules = captureBothPolicies()
    for (const name of ['llamenos', 'default']) {
      expect(rules[name].createScriptURL('https://example.com/app.js')).toBe(
        'https://example.com/app.js'
      )
    }
  })

  test('createScript throws unconditionally in both policies', () => {
    const rules = captureBothPolicies()
    for (const name of ['llamenos', 'default']) {
      expect(() => rules[name].createScript('console.log(1)')).toThrow(/blocked/i)
    }
  })

  test('llamenos createHTML throws (strict opt-in)', () => {
    const rules = captureBothPolicies()
    expect(() => rules.llamenos.createHTML('<div>safe</div>')).toThrow(/blocked/i)
    expect(() => rules.llamenos.createHTML('')).toThrow(/blocked/i)
  })

  test('default createHTML passes through (browser-implicit fallback)', () => {
    // The `default` policy must allow HTML through unchanged because React's
    // reconciler and other libs feed plain HTML strings into Trusted Types
    // sinks. The script-src CSP (`'self' 'nonce' 'strict-dynamic'`) provides
    // the actual XSS defense; this policy is defense in depth for script
    // sinks (Worker, SW), not a sanitizer.
    const rules = captureBothPolicies()
    expect(rules.default.createHTML('<div>x</div>')).toBe('<div>x</div>')
    expect(rules.default.createHTML('')).toBe('')
  })
})
