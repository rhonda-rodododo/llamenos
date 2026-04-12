declare global {
  interface Window {
    trustedTypes?: {
      createPolicy(
        name: string,
        rules: {
          createHTML?: (input: string) => string
          createScript?: (input: string) => string
          createScriptURL?: (input: string) => string
        }
      ): unknown
    }
  }
}

/**
 * The `llamenos` Trusted Types policy, referenced by the CSP header:
 *   `trusted-types llamenos default; require-trusted-types-for 'script'`
 *
 * createHTML throws by default because the app has no sanctioned HTML sinks.
 * A passthrough implementation would defeat require-trusted-types-for by
 * turning any XSS sink that routed through this policy into a silent conduit.
 * React's built-in HTML sinks go through its own `default` policy at runtime,
 * not through this one, so throwing here does not break rendering.
 *
 * createScriptURL is same-origin-only; createScript is unconditionally blocked.
 */
export function installTrustedTypesPolicy(): void {
  if (typeof window === 'undefined' || !window.trustedTypes) return

  window.trustedTypes.createPolicy('llamenos', {
    createHTML(_input: string) {
      throw new Error(
        'HTML creation is blocked by the llamenos Trusted Types policy. ' +
          'If a legitimate sink is ever needed, add a named policy with an ' +
          'explicit sanitizer — do not relax this default.'
      )
    },
    createScriptURL(input: string) {
      const url = new URL(input, window.location.origin)
      if (url.origin !== window.location.origin) {
        throw new Error(`Blocked cross-origin script URL: ${input}`)
      }
      return input
    },
    createScript() {
      throw new Error('Inline script creation is blocked by Trusted Types policy')
    },
  })
}
