import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
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

  test('creates a policy named llamenos', () => {
    let policyName = ''
    globalThis.window = {
      trustedTypes: {
        createPolicy(name: string, _rules: Record<string, unknown>) {
          policyName = name
          return {}
        },
      },
    } as unknown as Window & typeof globalThis

    installTrustedTypesPolicy()
    expect(policyName).toBe('llamenos')
  })

  test('createScriptURL blocks cross-origin URLs', () => {
    let capturedRules: Record<string, (input: string) => string> = {}
    globalThis.window = {
      trustedTypes: {
        createPolicy(_name: string, rules: Record<string, (input: string) => string>) {
          capturedRules = rules
          return {}
        },
      },
      location: { origin: 'https://example.com' },
    } as unknown as Window & typeof globalThis

    installTrustedTypesPolicy()
    expect(() => capturedRules.createScriptURL('https://evil.example/x.js')).toThrow(
      /cross-origin/i
    )
  })

  test('createScriptURL allows same-origin URLs', () => {
    let capturedRules: Record<string, (input: string) => string> = {}
    globalThis.window = {
      trustedTypes: {
        createPolicy(_name: string, rules: Record<string, (input: string) => string>) {
          capturedRules = rules
          return {}
        },
      },
      location: { origin: 'https://example.com' },
    } as unknown as Window & typeof globalThis

    installTrustedTypesPolicy()
    expect(capturedRules.createScriptURL('https://example.com/app.js')).toBe(
      'https://example.com/app.js'
    )
  })

  test('createScript throws unconditionally', () => {
    let capturedRules: Record<string, (input: string) => string> = {}
    globalThis.window = {
      trustedTypes: {
        createPolicy(_name: string, rules: Record<string, (input: string) => string>) {
          capturedRules = rules
          return {}
        },
      },
    } as unknown as Window & typeof globalThis

    installTrustedTypesPolicy()
    expect(() => capturedRules.createScript('console.log(1)')).toThrow(/blocked/i)
  })

  test('createHTML passes through input', () => {
    let capturedRules: Record<string, (input: string) => string> = {}
    globalThis.window = {
      trustedTypes: {
        createPolicy(_name: string, rules: Record<string, (input: string) => string>) {
          capturedRules = rules
          return {}
        },
      },
    } as unknown as Window & typeof globalThis

    installTrustedTypesPolicy()
    expect(capturedRules.createHTML('<div>safe</div>')).toBe('<div>safe</div>')
  })
})
