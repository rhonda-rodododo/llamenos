/**
 * Main-thread client for the crypto Web Worker.
 *
 * Provides a typed async API over postMessage. The main thread
 * NEVER touches raw secret key bytes — all private-key operations
 * are delegated to the worker.
 */

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

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const resp = event.data
      const pending = this.pending.get(resp.id)
      if (!pending) return

      this.pending.delete(resp.id)
      clearTimeout(pending.timeoutId)

      if (resp.type === 'error') {
        pending.reject(new Error(resp.error))
      } else {
        pending.resolve(resp.result)
      }
    }

    this.worker.onerror = (event: ErrorEvent) => {
      // Reject all pending requests on unhandled worker error
      const error = new Error(`Worker error: ${event.message}`)
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeoutId)
        pending.reject(error)
        this.pending.delete(id)
      }
    }
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
   * ECIES decrypt (unwrap) using the worker's secret key.
   * Returns decrypted plaintext as hex.
   */
  async decrypt(ephemeralPubkeyHex: string, wrappedKeyHex: string, label: string): Promise<string> {
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
    label: string
  ): Promise<string> {
    return (await this.call({
      type: 'decryptEnvelopeField',
      encryptedHex,
      ephemeralPubkeyHex,
      wrappedKeyHex,
      label,
    })) as string
  }

  /**
   * ECIES encrypt (wrap) for a recipient. Uses an ephemeral key inside the worker.
   * Returns the envelope (ephemeralPubkeyHex + wrappedKeyHex).
   */
  async encrypt(
    plaintextHex: string,
    recipientPubkeyHex: string,
    label: string
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
   * Envelope-encrypt a plaintext field for a set of recipients.
   * Generates a random symmetric key, XChaCha20-Poly1305-encrypts the plaintext,
   * and ECIES-wraps the key for each recipient pubkey.
   */
  async envelopeEncryptField(
    plaintext: string,
    recipientPubkeysHex: string[],
    label: string
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
   * Compute HMAC-SHA256 of the input string using the provided hex-encoded secret.
   * Returns the hex-encoded MAC.
   */
  async computeHmac(input: string, secretHex: string): Promise<string> {
    return (await this.call({ type: 'computeHmac', input, secretHex })) as string
  }

  /**
   * Terminate the worker. After this, the client is unusable.
   */
  terminate(): void {
    this.worker.terminate()
    // Reject any pending requests
    const error = new Error('Worker terminated')
    for (const [id, pending] of this.pending) {
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

/** Singleton instance — shared by key-manager and decrypt-fields. */
export const cryptoWorker =
  typeof Worker !== 'undefined' ? new CryptoWorkerClient() : (null as unknown as CryptoWorkerClient)
