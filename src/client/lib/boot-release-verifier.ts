// Tier 4 — SPA boot release verifier wiring.
//
// This module is the single caller of `runBinaryVerifier()` at SPA boot and
// the single caller of `GossipVersionClient.publishOwnAttest()` after a
// successful verification. It is intentionally the only place in the client
// bundle that knows how those two halves fit together.
//
// Contract with `main.tsx`:
//
//   1. `runBootReleaseVerifier()` resolves when the gate decides boot may
//      proceed. For a signed release build that is the `match` status only.
//      For unsigned builds (dev server, Playwright CI) the gate allows boot
//      via two narrowly-scoped escape hatches documented on the function
//      itself — neither is reachable from a release bundle.
//   2. On any other non-match status (mismatch, signature-invalid,
//      key-not-pinned, fetch-error against a signed build, verifier
//      exception) it renders a hard fail-closed HTML screen into `#root`
//      and throws `VerifierFailure`.
//   3. The caller MUST `await` this before touching any state — network,
//      crypto, router mount, service worker registration. A throw is a
//      hard refusal to boot.
//
// The gossip publisher is launched as a detached best-effort side effect
// only after an actual signature match — unsigned/dev boots never publish
// a gossip attest because there is no verified release tag to attest to.
// Gossip failure does not block boot (that would couple SPA uptime to the
// nostr relay, which is a weaker dependency than the verifier). Gossip
// success gives fleet-wide divergence detection as a defense-in-depth
// signal on top of the binary verifier's single-client integrity check.

import {
  type VerifierConfig,
  VerifierFailure,
  type VerifierResult,
  runBinaryVerifier,
} from './binary-verifier'
import { startBootGossip } from './boot-gossip'

// Vite statically replaces `import.meta.env.DEV` with a boolean literal at
// build time, so Rollup tree-shakes the dev-only branch out of every
// production bundle. In the `bun:test` runner used by the unit tests below
// the field is runtime-undefined; we coerce to `false` so tests exercise
// the production code path unless they inject their own test seams.
const IS_VITE_DEV: boolean = import.meta.env.DEV === true

// ---- Fail-closed screen ----------------------------------------------------

/**
 * Render a hard refusal screen directly into `document.body`. No React, no
 * router, no i18n — those subsystems are exactly the things we cannot trust
 * when the bundle integrity check has failed.
 *
 * The styling is deliberately inline and minimal; a tampered bundle might be
 * withholding our stylesheet and we don't want the fail screen to inherit
 * anything from the (potentially-injected) app CSS.
 */
export function renderFailClosedScreen(result: VerifierResult | null, error: unknown): void {
  if (typeof document === 'undefined') return
  const root = document.getElementById('root')
  if (root) {
    // Nuke anything React may have put there before we threw.
    while (root.firstChild) root.removeChild(root.firstChild)
  }
  const host = root ?? document.body
  if (!host) return

  const detail =
    result?.detail ??
    (error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown')
  const status = result?.status ?? 'verifier-crashed'
  const mismatches = result?.mismatches ?? []

  // All strings below are hard-coded English — this screen deliberately does
  // NOT touch i18n, because i18n lives in the bundle we just refused.
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-testid', 'release-verifier-fail-closed')
  wrapper.setAttribute('role', 'alert')
  wrapper.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:#0b0b0c',
    'color:#f4f4f5',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'padding:2rem',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'text-align:center',
    'z-index:2147483647',
    'overflow:auto',
  ].join(';')

  const heading = document.createElement('h1')
  heading.textContent = 'Refusing to load — release integrity check failed.'
  heading.style.cssText = 'font-size:1.5rem;font-weight:700;margin:0 0 1rem;max-width:40rem'
  wrapper.appendChild(heading)

  const body = document.createElement('p')
  body.textContent =
    'This device downloaded a copy of the app that does not match the signed release manifest. ' +
    'The app has stopped before any sensitive data is touched.'
  body.style.cssText = 'font-size:1rem;max-width:40rem;line-height:1.5;margin:0 0 1rem'
  wrapper.appendChild(body)

  const what = document.createElement('p')
  what.textContent =
    'What to do: hard-reload the page (Ctrl/Cmd + Shift + R). If the error persists on a ' +
    'known-good network, stop using this deployment and report it to your hub administrator.'
  what.style.cssText = 'font-size:0.95rem;max-width:40rem;line-height:1.5;margin:0 0 1.5rem'
  wrapper.appendChild(what)

  const details = document.createElement('pre')
  details.setAttribute('data-testid', 'release-verifier-fail-detail')
  const lines = [
    `status: ${status}`,
    `detail: ${detail}`,
    ...(result
      ? [`releaseTag: ${result.releaseTag || '(unknown)'}`, `checkedFiles: ${result.checkedFiles}`]
      : []),
    ...mismatches.slice(0, 20).map((m) => `mismatch: ${m.path} (expected ${m.expected})`),
    ...(mismatches.length > 20 ? [`… and ${mismatches.length - 20} more`] : []),
  ]
  details.textContent = lines.join('\n')
  details.style.cssText = [
    'font-family:ui-monospace,SFMono-Regular,Consolas,monospace',
    'font-size:0.8rem',
    'background:#18181b',
    'color:#a1a1aa',
    'border:1px solid #27272a',
    'border-radius:0.5rem',
    'padding:0.75rem 1rem',
    'max-width:40rem',
    'white-space:pre-wrap',
    'text-align:left',
  ].join(';')
  wrapper.appendChild(details)

  host.appendChild(wrapper)
  // Also force title + documentElement class so anything watching for the
  // tampered bundle's shell renders can notice the refusal.
  try {
    document.title = 'Integrity check failed — Hotline refused to load'
    document.documentElement.setAttribute('data-release-verifier', 'failed')
  } catch {
    /* ignore */
  }
}

// ---- Boot entry point ------------------------------------------------------

interface BootReleaseVerifierOptions extends VerifierConfig {
  /** Test seam: substitute the verifier implementation. */
  verifyFn?: (config: VerifierConfig) => Promise<VerifierResult>
  /**
   * Test seam: override the gossip launcher so tests don't open WebSockets.
   * Default in production is `startBootGossip` from `./boot-gossip`.
   */
  gossipFn?: (result: VerifierResult) => void
  /** Test seam: override the fail screen renderer (default: DOM mutation). */
  renderFailClosed?: (result: VerifierResult | null, error: unknown) => void
}

/**
 * SPA boot verifier. Call this BEFORE React mounts and before any network /
 * crypto / service-worker code runs. Resolves with the verifier result on
 * success; throws `VerifierFailure` after rendering a hard fail screen on any
 * failure.
 *
 * Two narrow escape hatches let non-release builds boot without a signed
 * manifest. Both are load-bearing for CI (unit + Playwright suites all run
 * against unsigned bundles) and neither weakens production guarantees:
 *
 *   1. `import.meta.env.DEV === true` — only true under Vite's dev server
 *      (`bun run dev`). Vite statically replaces this to `false` in any
 *      production build and Rollup tree-shakes the branch. Cannot be
 *      reached in a release bundle even if an attacker tampers with
 *      runtime env vars.
 *
 *   2. `status === 'not-configured'` with the pinned key empty — means the
 *      bundle was built without `VITE_RELEASE_SIGNING_PUBKEY` baked in, so
 *      the verifier has no key to check against. A real release pipeline
 *      MUST inject the key at build time (enforced in CI); if the key is
 *      missing, this bundle provably did not come from the release
 *      pipeline, and there is no signature to trust or mistrust. We log a
 *      warning and let the SPA boot. Production CI must fail the release
 *      build when the key is empty — that enforcement lives outside this
 *      module.
 *
 * Everything else (mismatch, signature-invalid, key-not-pinned, fetch-error
 * when the key IS pinned, verifier exceptions) still renders the hard
 * fail-closed screen and throws.
 */
export async function runBootReleaseVerifier(
  options: BootReleaseVerifierOptions = {}
): Promise<VerifierResult> {
  // Default verifier is the non-throwing `runBinaryVerifier` so the gate
  // can switch on the discrete status and apply the escape hatches above
  // before deciding to refuse boot. Tests can still inject throwing
  // `verifyFn` impls to exercise the catch path.
  const verifyImpl = options.verifyFn ?? runBinaryVerifier
  const renderFail = options.renderFailClosed ?? renderFailClosedScreen
  const gossipImpl = options.gossipFn ?? startBootGossip

  let result: VerifierResult
  try {
    result = await verifyImpl(options)
  } catch (err) {
    const underlying = err instanceof VerifierFailure ? err.result : null
    renderFail(underlying, err)
    throw err
  }

  // Escape hatch 1: Vite dev server. Statically false in production builds.
  if (IS_VITE_DEV && result.status !== 'match') {
    // biome-ignore lint/suspicious/noConsole: boot path — no structured logger pre-mount
    console.info(
      `[boot-release-verifier] dev build: skipping release verification (status=${result.status})`
    )
    return result
  }

  // Escape hatch 2: unsigned build (no pinned key baked in). Release CI
  // must enforce that the pinned key is set for every published build.
  if (result.status === 'not-configured') {
    // biome-ignore lint/suspicious/noConsole: boot path — no structured logger pre-mount
    console.warn(
      `[boot-release-verifier] release verifier not configured (${result.detail ?? 'no detail'}); allowing boot of unsigned build`
    )
    return result
  }

  if (result.status !== 'match') {
    renderFail(result, new VerifierFailure(result))
    throw new VerifierFailure(result)
  }

  // Best-effort fleet gossip — never blocks boot, never throws into the
  // caller, never couples SPA uptime to relay availability. Only fires on
  // an actual signature match so we never attest to an unsigned build.
  try {
    gossipImpl(result)
  } catch {
    /* swallow */
  }

  return result
}
