// Tier 4 PR-B — iframe-side RPC router.
//
// Every message received by the crypto sandbox iframe is first origin-checked,
// then parsed through CryptoRpcRequestSchema, then dispatched to the
// corresponding handler. Any schema violation or origin mismatch is treated as
// adversarial and returns a coded error (or, for origin mismatches, is
// silently dropped).
//
// This router is intentionally self-contained and stub-driven. Real crypto
// handlers are wired in later tasks of workstream 4.2. Each stub returns
// 'not_implemented' via an internal error so the router surface can be
// exercised and regression-tested ahead of the handler migration.

import {
  type CryptoRpcErrorCode,
  type CryptoRpcRequest,
  CryptoRpcRequestSchema,
  type CryptoRpcResponse,
} from '@shared/schemas/crypto-rpc'

export interface CryptoRpcRouterConfig {
  /**
   * The origin the iframe is embedded from. This must be set to the SPA's
   * origin (APP_ORIGIN). Any message whose ev.origin does not match is
   * silently dropped — no response is ever sent back to a wrong origin.
   */
  parentOrigin: string
}

export type CryptoRpcResponder = (res: CryptoRpcResponse) => void

/** Placeholder the router uses when an invalid payload has no usable id. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000'
/** Placeholder nonce for responses to schema-invalid payloads that carry no usable nonce. */
const NIL_NONCE_HEX = '0'.repeat(64)

/**
 * Classify an arbitrary thrown value into one of the closed error codes
 * carried by CryptoRpcErrorSchema.
 */
function classifyError(err: unknown): CryptoRpcErrorCode {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('label_mismatch')) return 'label_mismatch'
  if (msg.includes('aad_mismatch')) return 'aad_mismatch'
  if (msg.includes('locked')) return 'locked'
  if (msg.includes('rate_limited')) return 'rate_limited'
  if (msg.includes('chain_unverified')) return 'chain_unverified'
  if (msg.includes('unknown_hub')) return 'unknown_hub'
  return 'internal'
}

/**
 * The RPC router that lives inside the crypto-sandbox iframe.
 *
 * Discipline:
 *   1. Origin check runs BEFORE schema parse. Wrong-origin messages are
 *      dropped without ever calling the responder.
 *   2. Schema parse runs BEFORE dispatch. Malformed payloads return a
 *      `schema_invalid` error.
 *   3. Handler errors are mapped to a closed error-code enum — the raw
 *      error message is preserved for debugging but the code is machine-
 *      readable.
 *   4. Each op has its own handler method; adding new ops is purely additive.
 *
 * The stub handlers below throw a scoped 'not_implemented' error so they
 * light up as `internal` errors until PR-B wires the real bodies.
 */
export class CryptoRpcRouter {
  constructor(private readonly config: CryptoRpcRouterConfig) {}

  async handleMessage(ev: MessageEvent, respond: CryptoRpcResponder): Promise<void> {
    // Mandatory origin check — first thing. See
    // feedback_cross_tab_sessionstorage_gotcha: we never trust the source of a
    // postMessage without checking ev.origin.
    //
    // The iframe is mounted with `sandbox="allow-scripts"` (no
    // `allow-same-origin`), but the *parent* is NOT sandboxed — so the
    // parent's origin is a real origin and we match it exactly here.
    // The opaque-origin direction is handled on the parent side
    // (crypto-iframe-client.ts); see docs/security/TIER_4_POST_REVIEW.md
    // §C-3 and docs/security/TIER_5_POST_REVIEW.md for the Option A
    // decision that pairs this exact-match check with a per-request nonce
    // to defend the parent against same-origin forged responses.
    if (ev.origin !== this.config.parentOrigin) return

    const parsed = CryptoRpcRequestSchema.safeParse(ev.data)
    if (!parsed.success) {
      const maybeId =
        typeof (ev.data as { id?: unknown })?.id === 'string'
          ? (ev.data as { id: string }).id
          : NIL_UUID
      // Echo the caller's nonce if it is structurally valid (64 lowercase
      // hex chars). If not, fall back to the nil nonce — this still
      // satisfies the response schema. The parent will drop any response
      // whose nonce does not match its stored outstanding-request nonce.
      const maybeNonce = (ev.data as { nonceHex?: unknown })?.nonceHex
      const echoedNonce =
        typeof maybeNonce === 'string' && /^[0-9a-f]{64}$/.test(maybeNonce)
          ? maybeNonce
          : NIL_NONCE_HEX
      // The nil UUID is allowed by the schema's regex, so we can safely place
      // it on the error response without failing response validation.
      respond({
        kind: 'error',
        id: this.sanitizeId(maybeId),
        nonceHex: echoedNonce,
        code: 'schema_invalid',
        message: parsed.error.issues[0]?.message ?? 'invalid request shape',
      })
      return
    }

    const req = parsed.data
    try {
      const result = await this.dispatch(req)
      respond({ kind: 'success', id: req.id, nonceHex: req.nonceHex, result })
    } catch (err) {
      respond({
        kind: 'error',
        id: req.id,
        nonceHex: req.nonceHex,
        code: classifyError(err),
        message: err instanceof Error ? err.message : 'internal error',
      })
    }
  }

  private sanitizeId(id: string): string {
    // Refuse to echo a caller-supplied id back unless it is a recognizable
    // UUID shape. Drop to the nil UUID otherwise.
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id
      : NIL_UUID
  }

  private async dispatch(req: CryptoRpcRequest): Promise<unknown> {
    switch (req.op) {
      case 'isUnlocked':
        return this.isUnlocked()
      case 'getPublicKey':
        return this.getPublicKey()
      case 'unlock':
        return this.unlock(req)
      case 'lock':
        return this.lock()
      case 'decryptEnvelope':
        return this.decryptEnvelope(req)
      case 'decryptHubField':
        return this.decryptHubField(req)
      case 'encryptHubField':
        return this.encryptHubField(req)
      case 'signAuditEntry':
        return this.signAuditEntry(req)
      case 'rotateHubKey':
        return this.rotateHubKey(req)
      case 'reportBundleHash':
        return this.reportBundleHash(req)
    }
  }

  // ─── Handlers ───
  //
  // These are deliberately minimal in PR-B. The real bodies are wired in a
  // later pass (workstream 4.2 continues) by delegating to the existing
  // crypto modules via the crypto-sandbox's `@/crypto/*` path alias.

  private isUnlocked(): boolean {
    return false
  }

  private async getPublicKey(): Promise<string | null> {
    return null
  }

  private async unlock(_req: Extract<CryptoRpcRequest, { op: 'unlock' }>): Promise<null> {
    throw new Error('unlock: not_implemented')
  }

  private async lock(): Promise<null> {
    return null
  }

  private async decryptEnvelope(
    _req: Extract<CryptoRpcRequest, { op: 'decryptEnvelope' }>
  ): Promise<string> {
    throw new Error('decryptEnvelope: locked')
  }

  private async decryptHubField(
    _req: Extract<CryptoRpcRequest, { op: 'decryptHubField' }>
  ): Promise<string> {
    throw new Error('decryptHubField: locked')
  }

  private async encryptHubField(
    _req: Extract<CryptoRpcRequest, { op: 'encryptHubField' }>
  ): Promise<string> {
    throw new Error('encryptHubField: locked')
  }

  private async signAuditEntry(
    _req: Extract<CryptoRpcRequest, { op: 'signAuditEntry' }>
  ): Promise<string> {
    throw new Error('signAuditEntry: locked')
  }

  private async rotateHubKey(
    _req: Extract<CryptoRpcRequest, { op: 'rotateHubKey' }>
  ): Promise<unknown> {
    throw new Error('rotateHubKey: locked')
  }

  private async reportBundleHash(
    _req: Extract<CryptoRpcRequest, { op: 'reportBundleHash' }>
  ): Promise<null> {
    return null
  }
}
