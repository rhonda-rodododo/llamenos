// Tier 4 PR-B — SPA-side postMessage RPC client for the crypto sandbox iframe.
//
// Design:
//   - Boots the iframe eagerly. The iframe's 'ready' broadcast resolves
//     `ready` and unblocks the SPA shell.
//   - Every outgoing RPC carries a crypto.randomUUID() id so responses can
//     be correlated independently of ordering.
//   - Every incoming message is origin-checked against VITE_CRYPTO_ORIGIN
//     before it is parsed. Responses from any other origin are dropped.
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
    // Mandatory origin check — FIRST thing. We reject any message whose
    // ev.origin does not exactly equal the configured crypto origin, which
    // blocks both cross-frame spoofing and same-frame self-postMessage forgery.
    if (ev.origin !== this.cryptoOrigin) return

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
   */
  private async call(req: CryptoRpcRequest): Promise<unknown> {
    await this.ready
    const contentWindow = this.iframe?.contentWindow
    if (!contentWindow) {
      throw new Error('CryptoIframeClient: iframe contentWindow is unavailable')
    }
    const id = req.id
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Crypto iframe RPC '${req.op}' timed out`))
        }
      }, this.callTimeoutMs)
      this.pending.set(id, { resolve, reject, timeoutId })
      // Target origin must be the exact crypto origin — never '*'.
      contentWindow.postMessage(req, this.cryptoOrigin)
    })
  }

  // ─── Public API (subset — more wired when call sites migrate) ───

  async isUnlocked(): Promise<boolean> {
    const result = await this.call({ op: 'isUnlocked', id: crypto.randomUUID() })
    return result === true
  }

  async getPublicKey(): Promise<string | null> {
    const result = await this.call({ op: 'getPublicKey', id: crypto.randomUUID() })
    return typeof result === 'string' ? result : null
  }

  async lock(): Promise<void> {
    await this.call({ op: 'lock', id: crypto.randomUUID() })
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
