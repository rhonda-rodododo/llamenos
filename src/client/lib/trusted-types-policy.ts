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

export function installTrustedTypesPolicy(): void {
  if (typeof window === 'undefined' || !window.trustedTypes) return

  window.trustedTypes.createPolicy('llamenos', {
    createHTML(input: string) {
      return input
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
