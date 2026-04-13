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
 * The `llamenos` and `default` Trusted Types policies, referenced by the CSP:
 *   `trusted-types llamenos default; require-trusted-types-for 'script'`
 *
 * Two policies are installed:
 *
 * 1. `default` — the implicit policy the browser applies to ANY DOM sink fed
 *    a plain string instead of a Trusted Type. Required because Vite emits
 *    `new Worker(new URL('./crypto-worker.ts', import.meta.url))` and
 *    `vite-plugin-pwa` registers `/registerSW.js`, both as plain strings,
 *    and React's reconciler hands plain HTML strings to its own sinks. Under
 *    `require-trusted-types-for 'script'` the browser blocks every such sink
 *    unless a `default` policy is installed to convert. createHTML passes
 *    through unchanged because the surrounding script-src CSP
 *    (`'self' 'nonce-XXX' 'strict-dynamic'`) already prevents an injected
 *    `<script>` tag from executing — Trusted Types here is defense in depth
 *    for *script* sinks, not a sanitizer.
 *
 * 2. `llamenos` — strict opt-in policy. Callers go through
 *    `trustedTypes.createPolicy('llamenos').createHTML(x)` to explicitly say
 *    "reject my HTML if I haven't sanitized it myself". No caller currently
 *    uses this; it exists for future code that wants stricter guarantees.
 *
 * The two policies are kept in sync with the inline installer block in
 * `index.html` — that copy is what actually runs in production because it has
 * to execute before the module bundle's top-level Worker constructions.
 */
const sharedScriptRules = {
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
}

const defaultRules = {
  createHTML(input: string) {
    return input
  },
  ...sharedScriptRules,
}

const llamenosStrictRules = {
  createHTML(_input: string) {
    throw new Error(
      'HTML creation is blocked by the llamenos Trusted Types policy. ' +
        'If a legitimate sink is ever needed, sanitize via DOMPurify and add ' +
        'a named policy — do not relax this default.'
    )
  },
  ...sharedScriptRules,
}

export function installTrustedTypesPolicy(): void {
  if (typeof window === 'undefined' || !window.trustedTypes) return

  // Idempotent: index.html ships an inline installer that runs synchronously
  // before the module bundle (see comment block in index.html for why), so by
  // the time main.tsx calls this function the policies normally already exist.
  // Re-creating a named policy is rejected by both the runtime (TypeError) and
  // the CSP (which logs a violation), so we swallow any error here and rely on
  // the inline installer being correct. The function still exists so unit tests
  // and any future caller in a non-browser environment have a single entry
  // point — see trusted-types-policy.test.ts.
  try {
    window.trustedTypes.createPolicy('llamenos', llamenosStrictRules)
  } catch {}
  try {
    window.trustedTypes.createPolicy('default', defaultRules)
  } catch {}
}
