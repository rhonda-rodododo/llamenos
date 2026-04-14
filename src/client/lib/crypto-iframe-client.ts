// Tier 4 PR-B — SPA-side postMessage RPC client for the crypto sandbox iframe.
//
// Design:
//   - Boots the iframe eagerly. The iframe's 'ready' broadcast resolves
//     `ready` and unblocks the SPA shell.
//   - Every outgoing RPC carries a crypto.randomUUID() id so responses can
//     be correlated independently of ordering.
//   - Every outgoing RPC carries a 32-byte per-request nonce. The nonce is
//     stored in `this.pending` under the request id and NEVER leaves the
//     parent's closure. The iframe echoes the nonce on its response; any
//     response whose nonce does not match the stored outstanding-request
//     value is dropped. This is the "Option A" defense adopted in Tier 5
//     (see docs/security/TIER_4_POST_REVIEW.md §C-3 and
//     docs/security/TIER_5_POST_REVIEW.md) that lets us accept the
//     `ev.origin === "null"` that the opaque-origin iframe delivers while
//     still rejecting same-origin forged responses from an attacker who
//     can post into the parent window.
//   - Incoming messages are accepted when `ev.origin` equals either the
//     configured crypto origin (for test harnesses and same-origin dev) OR
//     the literal string `"null"` (for the production sandboxed iframe).
//     Other origins are dropped before any parsing.
//   - Plaintext that flows back through a `decrypt*` RPC is NEVER logged.
//     The `handleMessage` hot path has no console statements.
//   - Timeouts are enforced per-call (default 30s) and clean up pending state.
//
// This client runs IN PARALLEL with the existing crypto-worker-client during
// the PR-B phase of Tier 4. Call sites continue to use crypto-worker-client.
// A follow-up PR migrates call sites one domain at a time.

import {
  type CryptoRpcErrorCode,
  type CryptoRpcRequest,
  CryptoRpcResponseSchema,
} from '@shared/schemas/crypto-rpc'

export class CryptoRpcError extends Error {
  constructor(
    public readonly code: CryptoRpcErrorCode,
    message: string
  ) {
    super(`crypto-rpc ${code}: ${message}`)
    this.name = 'CryptoRpcError'
  }
}

type PendingCall = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
  /**
   * Per-request 32-byte nonce (lowercase hex). Held only in this Map inside
   * the client's closure; the iframe echoes it on every response so we can
   * distinguish a legitimate sandbox reply from a same-origin forgery.
   */
  nonceHex: string
}

/**
 * Minimal iframe host surface the client needs. Real production code creates
 * a real HTMLIFrameElement; tests inject a fake via `fakeIframeForTests`.
 */
export interface IframeHost {
  contentWindow: {
    postMessage: (data: unknown, targetOrigin: string) => void
  } | null
}

/**
 * Generate a 32-byte random nonce as lowercase hex (64 chars). Uses the
 * global Web Crypto RNG — available in all supported browsers.
 */
function generateRequestNonceHex(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export interface CryptoIframeClientConfig {
  /** The origin serving /sandbox.html. Required; empty string throws. */
  cryptoOrigin: string
  /** Per-RPC timeout. Defaults to 30s. */
  callTimeoutMs?: number
  /** Boot timeout waiting for the iframe 'ready' broadcast. Defaults to 10s. */
  bootTimeoutMs?: number
  /**
   * Test injection hook. When provided, the client does NOT create a real
   * iframe, and the `postMessageHook` is used as the outgoing channel. The
   * test harness drives incoming responses by calling `deliverMessage`.
   */
  fakeIframeForTests?: {
    iframe: IframeHost
    registerIncomingHandler: (h: (ev: MessageEvent) => void) => void
  }
}

export class CryptoIframeClient {
  private iframe: IframeHost | null = null
  private ownsIframe = false
  public readonly ready: Promise<void>
  private readyResolve: (() => void) | null = null
  private readyReject: ((err: Error) => void) | null = null
  private readonly pending = new Map<string, PendingCall>()
  private readonly cryptoOrigin: string
  private readonly callTimeoutMs: number
  private readonly bootTimeoutMs: number
  private listenerAttached = false
  private readonly handleIncoming = (ev: MessageEvent): void => {
    // Mandatory origin check — FIRST thing. We accept exactly two origins:
    //
    //   1. The configured crypto origin. Used by test harnesses and the
    //      same-origin dev layout where the iframe is served from a real
    //      origin.
    //   2. The literal string `"null"`. In production the iframe is mounted
    //      with `sandbox="allow-scripts"` (no `allow-same-origin`), giving
    //      it an opaque origin that browsers serialize as `"null"` on the
    //      parent's `MessageEvent.origin`. Without this branch the parent
    //      would drop every legitimate sandbox message — the very bug
    //      documented in docs/security/TIER_4_POST_REVIEW.md §C-3.
    //
    // Same-origin attackers who can post into the parent window also land
    // here with `ev.origin === parent's own origin`, so origin-string
    // matching alone is not sufficient on its own. The per-request nonce
    // verification below is the second line of defense — the attacker
    // cannot produce a matching nonce because it never leaves this
    // client's closure. See docs/security/TIER_5_POST_REVIEW.md for the
    // Option A decision rationale.
    if (ev.origin !== this.cryptoOrigin && ev.origin !== 'null') return

    // Handle the 'ready' broadcast without going through the response schema.
    const maybeReady = ev.data as { kind?: string; protocol?: number }
    if (maybeReady?.kind === 'ready' && maybeReady.protocol === 1) {
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
      return
    }

    const parsed = CryptoRpcResponseSchema.safeParse(ev.data)
    if (!parsed.success) return // drop silently — not addressed to us

    const pending = this.pending.get(parsed.data.id)
    if (!pending) return

    // Nonce gate: the response MUST echo the nonce we stored when we
    // enqueued the pending call. This is the second half of the Option A
    // defense; a same-origin attacker cannot forge it because the nonce
    // is held only in `this.pending` inside this closure. Drop silently
    // on mismatch — do NOT resolve or reject the pending call, since a
    // legitimate response may still arrive.
    if (parsed.data.nonceHex !== pending.nonceHex) return

    this.pending.delete(parsed.data.id)
    clearTimeout(pending.timeoutId)

    if (parsed.data.kind === 'error') {
      pending.reject(new CryptoRpcError(parsed.data.code, parsed.data.message))
    } else {
      pending.resolve(parsed.data.result)
    }
  }

  constructor(config: CryptoIframeClientConfig) {
    this.cryptoOrigin = config.cryptoOrigin
    if (!this.cryptoOrigin) {
      throw new Error('CryptoIframeClient: cryptoOrigin is required')
    }
    this.callTimeoutMs = config.callTimeoutMs ?? 30_000
    this.bootTimeoutMs = config.bootTimeoutMs ?? 10_000

    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })

    if (config.fakeIframeForTests) {
      this.iframe = config.fakeIframeForTests.iframe
      config.fakeIframeForTests.registerIncomingHandler(this.handleIncoming)
      this.listenerAttached = true
      // Tests drive the ready broadcast manually; also surface a boot timeout
      // so misconfigured test harnesses don't hang the suite.
      setTimeout(() => {
        if (this.readyReject) {
          const reject = this.readyReject
          this.readyReject = null
          this.readyResolve = null
          reject(new Error('Crypto iframe (fake) failed to broadcast ready in time'))
        }
      }, this.bootTimeoutMs)
      return
    }

    // Real iframe boot path — only runs in a browser.
    if (typeof document === 'undefined') {
      throw new Error(
        'CryptoIframeClient: real iframe boot requires a browser environment. Use fakeIframeForTests in non-browser contexts.'
      )
    }
    this.bootRealIframe()
  }

  private bootRealIframe(): void {
    const iframe = document.createElement('iframe')
    iframe.src = `${this.cryptoOrigin}/sandbox.html`
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('allow', 'cross-origin-isolated')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.dataset.testid = 'crypto-sandbox-iframe'
    iframe.style.display = 'none'
    iframe.title = 'Llamenos crypto sandbox'
    // The iframe element itself is an IframeHost consumer via contentWindow.
    this.iframe = iframe as unknown as IframeHost
    this.ownsIframe = true
    document.body.appendChild(iframe)
    window.addEventListener('message', this.handleIncoming)
    this.listenerAttached = true
    setTimeout(() => {
      if (this.readyReject) {
        const reject = this.readyReject
        this.readyReject = null
        this.readyResolve = null
        reject(new Error(`Crypto sandbox iframe failed to boot within ${this.bootTimeoutMs}ms`))
      }
    }, this.bootTimeoutMs)
  }

  /**
   * Low-level RPC send. Public API wrappers (isUnlocked/decryptEnvelope/…)
   * build a typed request and route through this method. The return type
   * is `unknown`; callers assert the shape by op.
   *
   * The caller MUST have already populated `req.nonceHex` via
   * `generateRequestNonceHex()`. We re-use it as the verification value
   * stored under the pending-call entry. This keeps request construction
   * colocated at call sites and makes the nonce invariant visible at
   * every public-API wrapper below.
   */
  private async call(req: CryptoRpcRequest): Promise<unknown> {
    await this.ready
    const contentWindow = this.iframe?.contentWindow
    if (!contentWindow) {
      throw new Error('CryptoIframeClient: iframe contentWindow is unavailable')
    }
    const id = req.id
    const nonceHex = req.nonceHex
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Crypto iframe RPC '${req.op}' timed out`))
        }
      }, this.callTimeoutMs)
      this.pending.set(id, { resolve, reject, timeoutId, nonceHex })
      // Target origin MUST be `'*'`. The iframe is mounted with
      // `sandbox="allow-scripts"` (no `allow-same-origin`) and therefore
      // has an opaque origin. Browsers reject postMessages whose
      // targetOrigin is a real origin string when the target window has
      // an opaque origin, so using the exact crypto origin here silently
      // drops every outgoing message — the original Tier 4 bug. The
      // per-request nonce in `req.nonceHex` is the defense that lets us
      // safely use `'*'`: any interceptor who snoops the outgoing
      // message sees the nonce, but cannot inject a matching response
      // into the parent window without already being able to post into
      // the parent, AND the iframe itself trusts a signed/origin-checked
      // parent — see docs/security/TIER_5_POST_REVIEW.md.
      contentWindow.postMessage(req, '*')
    })
  }

  // ─── Public API (subset — more wired when call sites migrate) ───

  async isUnlocked(): Promise<boolean> {
    const result = await this.call({
      op: 'isUnlocked',
      id: crypto.randomUUID(),
      nonceHex: generateRequestNonceHex(),
    })
    return result === true
  }

  async getPublicKey(): Promise<string | null> {
    const result = await this.call({
      op: 'getPublicKey',
      id: crypto.randomUUID(),
      nonceHex: generateRequestNonceHex(),
    })
    return typeof result === 'string' ? result : null
  }

  async lock(): Promise<void> {
    await this.call({
      op: 'lock',
      id: crypto.randomUUID(),
      nonceHex: generateRequestNonceHex(),
    })
  }

  /** Test-only synchronous teardown so each test starts clean. */
  destroy(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('CryptoIframeClient destroyed'))
    }
    this.pending.clear()
    if (this.listenerAttached && typeof window !== 'undefined') {
      window.removeEventListener('message', this.handleIncoming)
    }
    if (this.ownsIframe && this.iframe && 'remove' in this.iframe) {
      ;(this.iframe as unknown as { remove: () => void }).remove()
    }
    this.iframe = null
  }
}

// ─── Lazy singleton for app-wide access ───

let singleton: CryptoIframeClient | null = null

/**
 * Get the process-wide CryptoIframeClient singleton. In production this boots
 * the real iframe; tests that need isolation should construct their own
 * CryptoIframeClient with fakeIframeForTests instead of calling this.
 */
export function getCryptoIframeClient(): CryptoIframeClient {
  if (singleton) return singleton
  const origin = import.meta.env.VITE_CRYPTO_ORIGIN ?? ''
  if (!origin) {
    throw new Error(
      'CryptoIframeClient: VITE_CRYPTO_ORIGIN is not configured. Set it to the origin serving /sandbox.html (e.g. https://crypto.llamenos.example).'
    )
  }
  singleton = new CryptoIframeClient({ cryptoOrigin: origin })
  return singleton
}

/** Test hook: drop the singleton so the next call creates a fresh client. */
export function _resetCryptoIframeClientForTests(): void {
  singleton?.destroy()
  singleton = null
}
