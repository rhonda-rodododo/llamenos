/**
 * Main-thread client for the crypto Web Worker.
 *
 * Provides a typed async API over postMessage. The main thread
 * NEVER touches raw secret key bytes — all private-key operations
 * are delegated to the worker.
 */

import { bytesToHex } from '@noble/hashes/utils.js'
import type { CryptoLabel } from '@shared/crypto-labels'
import type { HpkeEnvelope } from '@shared/hpke-envelope'

/** Error messages from the worker that indicate the key is no longer available. */
const LOCKED_ERROR_PATTERNS = [
  'Not unlocked',
  'Worker is locked',
  'Rate limit exceeded — worker auto-locked',
]

/** Distinguishes "worker has no key" from generic timeouts/crashes. */
export class CryptoWorkerLockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CryptoWorkerLockedError'
  }
}

/** Check if an error indicates the worker's key was zeroed/lost. */
export function isWorkerLockedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return LOCKED_ERROR_PATTERNS.some((p) => err.message.includes(p))
}

// Re-export the message types for consumers that need them
interface WorkerSuccessResponse {
  type: 'success'
  id: string
  result: unknown
}

interface WorkerErrorResponse {
  type: 'error'
  id: string
  error: string
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse

interface EncryptResult {
  ephemeralPubkeyHex: string
  wrappedKeyHex: string
}

interface ReEncryptResult {
  nonce: string
  ciphertext: string
}

interface ProvisionNsecResult {
  ciphertext: string
  nonce: string
  pubkey: string
  sas: string
}

interface ExportSessionResult {
  token: string
  encryptedNsecHex: string
  capsuleNonceHex: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

export class CryptoWorkerClient {
  private worker: Worker
  private pending: Map<string, PendingRequest> = new Map()
  private idCounter = 0

  constructor() {
    this.worker = new Worker(new URL('./crypto-worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = this.handleMessage.bind(this)
    this.worker.onerror = this.handleError.bind(this)
  }

  private handleMessage(event: MessageEvent<WorkerResponse>): void {
    const resp = event.data
    const pending = this.pending.get(resp.id)
    if (!pending) return

    this.pending.delete(resp.id)
    clearTimeout(pending.timeoutId)

    if (resp.type === 'error') {
      const err = isWorkerLockedError(new Error(resp.error))
        ? new CryptoWorkerLockedError(resp.error)
        : new Error(resp.error)
      pending.reject(err)
    } else {
      pending.resolve(resp.result)
    }
  }

  private handleError(event: ErrorEvent): void {
    // Reject all pending requests on unhandled worker error
    const error = new Error(`Worker error: ${event.message}`)
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private nextId(): string {
    return String(++this.idCounter)
  }

  private call(message: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId()
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('Crypto worker request timed out'))
        }
      }, 30_000)
      this.pending.set(id, { resolve, reject, timeoutId })
      this.worker.postMessage({ ...message, id })
    })
  }

  /**
   * Unlock the worker by decrypting the nsec blob with the provided KEK.
   * Returns the derived x-only public key hex.
   */
  async unlock(kekHex: string, nonceHex: string, ciphertextHex: string): Promise<string> {
    return (await this.call({
      type: 'unlock',
      kekHex,
      nonceHex,
      ciphertextHex,
    })) as string
  }

  /**
   * Lock the worker — zeros out the secret key bytes in the worker.
   */
  async lock(): Promise<void> {
    await this.call({ type: 'lock' })
  }

  /**
   * Schnorr sign a message hash (hex). Returns signature hex.
   * Rate limited in the worker — exceeding triggers auto-lock.
   */
  async sign(messageHex: string): Promise<string> {
    return (await this.call({ type: 'sign', messageHex })) as string
  }

  /**
   * ECIES key unwrap using the worker's secret key. Returns the unwrapped
   * 32-byte key as hex. Domain separation is provided via the `label` used
   * to derive the inner wrapping key — there is intentionally no AAD
   * parameter because the inner AEAD is called with empty AAD today. Adding
   * an AAD here would be a silent no-op; hardening that end-to-end is a
   * Tier 1 item.
   */
  async decrypt(
    ephemeralPubkeyHex: string,
    wrappedKeyHex: string,
    label: CryptoLabel
  ): Promise<string> {
    return (await this.call({
      type: 'decrypt',
      ephemeralPubkeyHex,
      wrappedKeyHex,
      label,
    })) as string
  }

  /**
   * Decrypt an envelope-encrypted field entirely inside the worker.
   * Combines ECIES unwrap + XChaCha20-Poly1305 decrypt in one round trip.
   * Returns the decrypted plaintext string.
   */
  async decryptEnvelopeField(
    encryptedHex: string,
    ephemeralPubkeyHex: string,
    wrappedKeyHex: string,
    label: CryptoLabel,
    aad: Uint8Array
  ): Promise<string> {
    return (await this.call({
      type: 'decryptEnvelopeField',
      encryptedHex,
      ephemeralPubkeyHex,
      wrappedKeyHex,
      label,
      aad: bytesToHex(aad),
    })) as string
  }

  /**
   * ECIES key wrap for a recipient. Uses an ephemeral key inside the worker.
   * See {@link decrypt} for why there is no `aad` parameter today.
   */
  async encrypt(
    plaintextHex: string,
    recipientPubkeyHex: string,
    label: CryptoLabel
  ): Promise<EncryptResult> {
    return (await this.call({
      type: 'encrypt',
      plaintextHex,
      recipientPubkeyHex,
      label,
    })) as EncryptResult
  }

  /**
   * Get the x-only public key hex, or null if locked.
   */
  async getPublicKey(): Promise<string | null> {
    return (await this.call({ type: 'getPublicKey' })) as string | null
  }

  /**
   * Check if the worker is currently unlocked.
   */
  async isUnlocked(): Promise<boolean> {
    return (await this.call({ type: 'isUnlocked' })) as boolean
  }

  /**
   * Re-encrypt the held nsec under a new KEK.
   * Used for idp_value rotation without exposing nsec to the main thread.
   */
  async reEncrypt(newKekHex: string): Promise<ReEncryptResult> {
    return (await this.call({ type: 'reEncrypt', newKekHex })) as ReEncryptResult
  }

  /**
   * Encrypt the held nsec for a recipient device using ECDH.
   * The nsec is encrypted inside the worker and never exposed as plaintext to the main thread.
   * Returns the encrypted payload plus our public key for the recipient to verify.
   */
  async provisionNsec(recipientEphemeralPubkeyHex: string): Promise<ProvisionNsecResult> {
    return (await this.call({
      type: 'provisionNsec',
      recipientEphemeralPubkeyHex,
    })) as ProvisionNsecResult
  }

  /**
   * Export the unlocked nsec as an opaque session capsule encrypted with a
   * random token. Caller persists `{encryptedNsecHex, capsuleNonceHex}` in
   * IDB and `token` in sessionStorage — on reload, feed both back to
   * importSession() to restore the worker without a PBKDF2 round.
   */
  async exportSession(): Promise<ExportSessionResult> {
    return (await this.call({ type: 'exportSession' })) as ExportSessionResult
  }

  /**
   * Restore the worker state from a session capsule. Throws if the capsule
   * is invalid, tampered, or the token does not match. On success the
   * worker holds the nsec and returns the derived x-only public key hex.
   */
  async importSession(
    tokenHex: string,
    encryptedNsecHex: string,
    capsuleNonceHex: string
  ): Promise<string> {
    return (await this.call({
      type: 'importSession',
      tokenHex,
      encryptedNsecHex,
      capsuleNonceHex,
    })) as string
  }

  /**
   * Envelope-encrypt a plaintext field for a set of recipients.
   * Generates a random symmetric key, XChaCha20-Poly1305-encrypts the plaintext,
   * and ECIES-wraps the key for each recipient pubkey.
   */
  async envelopeEncryptField(
    plaintext: string,
    recipientPubkeysHex: string[],
    label: CryptoLabel,
    aad: Uint8Array
  ): Promise<{
    encryptedHex: string
    envelopes: Array<{
      recipientPubkey: string
      ephemeralPubkeyHex: string
      wrappedKeyHex: string
    }>
  }> {
    return (await this.call({
      type: 'envelopeEncryptField',
      plaintext,
      recipientPubkeysHex,
      label,
      aad: bytesToHex(aad),
    })) as {
      encryptedHex: string
      envelopes: Array<{
        recipientPubkey: string
        ephemeralPubkeyHex: string
        wrappedKeyHex: string
      }>
    }
  }

  /**
   * Schnorr sign an audit entry hash (hex-encoded SHA-256). Returns the 64-byte
   * Schnorr signature as 128 hex chars. Rate limited via the 'sign' bucket;
   * exceeding the limit triggers auto-lock.
   */
  async signAuditEntry(entryHashHex: string): Promise<string> {
    return (await this.call({ type: 'signAuditEntry', entryHashHex })) as string
  }

  /**
   * Compute HMAC-SHA256 of the input string using the provided hex-encoded secret.
   * Returns the hex-encoded MAC.
   */
  async computeHmac(input: string, secretHex: string): Promise<string> {
    return (await this.call({ type: 'computeHmac', input, secretHex })) as string
  }

  // ---- Tier 1 HPKE sidecar ----

  /**
   * Unlock the worker from a key-store unlock result. Accepts raw nsec
   * bytes (consumed and zeroed inside the worker), the non-extractable HPKE
   * private CryptoKey, and the non-extractable hub AES-GCM CryptoKey.
   * Returns the derived x-only public key hex.
   */
  async unlockWithHandles(
    nsecRaw: Uint8Array,
    hpkePrivateKey: CryptoKey,
    hubKey: CryptoKey
  ): Promise<string> {
    return (await this.call({
      type: 'unlockWithHandles',
      nsecRaw,
      hpkePrivateKey,
      hubKey,
    })) as string
  }

  /**
   * HPKE single-shot seal against a recipient's raw X25519 public key.
   * Produces an HpkeEnvelope `{ v: 3, labelId, enc, ct }`. Never falls back to
   * ECIES — callers that can tolerate either format must branch on label
   * themselves.
   */
  async hpkeSeal(
    plaintext: string,
    recipientPublicKeyRaw: Uint8Array,
    label: CryptoLabel,
    recordId: string,
    fieldName: string
  ): Promise<HpkeEnvelope> {
    return (await this.call({
      type: 'hpkeSeal',
      plaintext,
      recipientPublicKeyRaw,
      label,
      recordId,
      fieldName,
    })) as HpkeEnvelope
  }

  /**
   * HPKE single-shot open against the held non-extractable HPKE private key.
   * Throws on version, label, or AAD mismatch — never falls back to ECIES.
   */
  async hpkeOpen(
    envelope: HpkeEnvelope,
    expectedLabel: CryptoLabel,
    recordId: string,
    fieldName: string
  ): Promise<string> {
    return (await this.call({
      type: 'hpkeOpen',
      envelope,
      expectedLabel,
      recordId,
      fieldName,
    })) as string
  }

  // ---- Tier 2 root-KEK handlers ----

  /**
   * Generate a fresh random root KEK inside the worker. Replaces any
   * existing root KEK handle. No value is returned — the key is held only
   * in the worker closure and is wrapped for persistence via
   * {@link rootKekWrap}.
   */
  async rootKekCreate(): Promise<void> {
    await this.call({ type: 'rootKekCreate' })
  }

  /**
   * Wrap the currently loaded root KEK under a factor. Raw factor bytes
   * (32 bytes, hex-encoded) enter the worker, are HKDF-stretched with the
   * per-envelope salt and `LABEL_ROOT_KEK_WRAP`, and used to produce a
   * single AES-KW wrapped blob. The caller is responsible for persisting
   * `{ hkdfSalt, wrappedKey }` into the root-KEK envelope bundle.
   *
   * SECURITY: The caller MUST zero its own copy of the factor bytes after
   * this call returns. The worker zeros its own internal copy.
   */
  async rootKekWrap(factorBytesHex: string, hkdfSaltHex: string): Promise<string> {
    return (await this.call({
      type: 'rootKekWrap',
      factorBytesHex,
      hkdfSaltHex,
    })) as string
  }

  /**
   * Unwrap a persisted root-KEK envelope and install it as the worker's
   * current root KEK. Any previously loaded root KEK is replaced.
   *
   * SECURITY: same as {@link rootKekWrap} — caller must zero its factor
   * bytes after the promise resolves.
   */
  async rootKekUnwrap(
    factorBytesHex: string,
    hkdfSaltHex: string,
    wrappedKeyHex: string
  ): Promise<void> {
    await this.call({
      type: 'rootKekUnwrap',
      factorBytesHex,
      hkdfSaltHex,
      wrappedKeyHex,
    })
  }

  /** Drop the loaded root KEK handle. */
  async rootKekClear(): Promise<void> {
    await this.call({ type: 'rootKekClear' })
  }

  /** Return true if a root KEK is currently loaded in the worker. */
  async rootKekIsLoaded(): Promise<boolean> {
    return (await this.call({ type: 'rootKekIsLoaded' })) as boolean
  }

  /**
   * Terminate the current worker and create a fresh one.
   * Used when the worker is in a broken state (responding but not functioning).
   */
  reinitialize(): void {
    const error = new Error('Worker reinitialized')
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.pending.clear()

    this.worker.terminate()
    this.worker = new Worker(new URL('./crypto-worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = this.handleMessage.bind(this)
    this.worker.onerror = this.handleError.bind(this)
  }

  /**
   * Terminate the worker. After this, the client is unusable.
   */
  terminate(): void {
    this.worker.terminate()
    const error = new Error('Worker terminated')
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

/** Singleton instance — shared by key-manager and decrypt-fields. */
export const cryptoWorker =
  typeof Worker !== 'undefined' ? new CryptoWorkerClient() : (null as unknown as CryptoWorkerClient)
