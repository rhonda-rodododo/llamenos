// Tier 4 PR-B — sandbox iframe entry point.
//
// Responsibilities:
//   1. Install a Trusted Types policy. The iframe CSP declares
//      `require-trusted-types-for 'script'` so any attempt to write
//      attacker-controlled HTML/script into the iframe DOM throws. The
//      'llamenos' policy is the ONLY named policy that is allowed to
//      produce trusted script/HTML. Its `createScript`/`createHTML`
//      methods refuse every input — so even our own code cannot
//      accidentally construct trusted HTML at runtime. All UI inside the
//      sandbox is baked in at build time.
//
//   2. Determine the parent origin. When the iframe is embedded with
//      sandbox="allow-scripts" (no allow-same-origin) it has an opaque
//      origin of its own, but `document.location.ancestorOrigins[0]`
//      still reports the embedder's real origin in Chromium. Firefox
//      does not implement ancestorOrigins — on Firefox the iframe
//      accepts only messages whose ev.origin matches
//      VITE_CRYPTO_PARENT_ORIGIN, baked in at build time.
//
//   3. Mount a window 'message' listener that forwards each event into
//      a CryptoRpcRouter configured with that parent origin.
//
//   4. Post a 'ready' broadcast to window.parent so the client can
//      unblock boot. The broadcast carries a protocol version so we
//      can upgrade the RPC protocol without silently crossing wires.

import { CryptoRpcRouter } from './rpc-router'

type TrustedTypesPolicyOptions = {
  createHTML?: (input: string) => string
  createScript?: (input: string) => string
  createScriptURL?: (input: string) => string
}

type TrustedTypesAPI = {
  createPolicy: (name: string, options: TrustedTypesPolicyOptions) => unknown
}

// Trusted Types is a browser API not yet in lib.dom for our TS target.
// Declared locally as a structural type so we can feature-detect at runtime
// without pulling in @types/trusted-types.
declare const trustedTypes: TrustedTypesAPI | undefined

// Install the Trusted Types policy declared in the iframe CSP
// (`trusted-types llamenos-sandbox`). The policy name MUST match the CSP
// allowlist exactly — Chromium will throw `TypeError` on any mismatch. No
// try/catch swallow here: if policy install fails the sandbox is in an
// unsafe state and MUST NOT broadcast `ready` to the parent. Letting the
// error propagate aborts the module so `window.parent.postMessage(...ready)`
// below never runs and the SPA boot times out cleanly instead of unlocking
// against a half-configured sandbox.
if (typeof trustedTypes !== 'undefined' && 'createPolicy' in trustedTypes) {
  trustedTypes.createPolicy('llamenos-sandbox', {
    createHTML: () => {
      throw new Error('trusted-types: HTML construction is forbidden in the crypto sandbox')
    },
    createScript: () => {
      throw new Error('trusted-types: script construction is forbidden in the crypto sandbox')
    },
    createScriptURL: () => {
      throw new Error('trusted-types: scriptURL construction is forbidden in the crypto sandbox')
    },
  })
}

// Parent origin detection. Prefer the compile-time pin; fall back to
// ancestorOrigins for local development.
declare global {
  interface ImportMetaEnv {
    readonly VITE_CRYPTO_PARENT_ORIGIN?: string
  }
}

function resolveParentOrigin(): string {
  const pinned = import.meta.env.VITE_CRYPTO_PARENT_ORIGIN
  if (pinned && pinned.length > 0) return pinned
  // biome-ignore lint/suspicious/noExplicitAny: ancestorOrigins is not in lib.dom
  const ancestors = (document.location as any).ancestorOrigins as
    | { [i: number]: string; length: number }
    | undefined
  if (ancestors && ancestors.length > 0) return ancestors[0]
  // Last-ditch: refuse everything by pinning to an impossible origin.
  return 'about:blank'
}

const parentOrigin = resolveParentOrigin()
const router = new CryptoRpcRouter({ parentOrigin })

window.addEventListener('message', (ev) => {
  void router.handleMessage(ev, (res) => {
    // Always address the response explicitly to the parent origin — never '*'.
    window.parent.postMessage(res, parentOrigin)
  })
})

// One-shot 'ready' broadcast. We cannot use '*' here because a hostile
// parent frame could observe the broadcast to confirm the sandbox booted.
// Post to the resolved parent origin only.
window.parent.postMessage({ kind: 'ready', protocol: 1 }, parentOrigin)
