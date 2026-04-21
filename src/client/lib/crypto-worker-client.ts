/**
 * Main-thread client for the crypto Web Worker.
 *
 * Provides a typed async API over postMessage. The main thread
 * NEVER touches raw secret key bytes — all private-key operations
 * are delegated to the worker.
 */

import { bytesToHex } from '@noble/hashes/utils.js'
import type { CryptoLabel } from '@shared/crypto-labels'
import {
  type CapsuleNonceHex,
  type EncryptedNsecHex,
  type SessionToken,
  asCapsuleNonce,
  asEncryptedNsec,
  asSessionToken,
} from '@shared/crypto-types'
import type { HpkeEnvelope } from '@shared/hpke-envelope'
import type { AesGcmKey, X25519EncryptionKey } from '@shared/types'

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
  tokenHex: SessionToken
  encryptedNsecHex: EncryptedNsecHex
  capsuleNonceHex: CapsuleNonceHex
  /** Encrypted KEK bytes (hex) for MLS re-init on session restore. Null if KEK was not available at export time. */
  encryptedKekHex: string | null
  /** XChaCha20 nonce for the encrypted KEK (hex). */
  kekNonceHex: string | null
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

  /**
   * Send a request to the worker and await its reply. The generic `R` lets
   * call sites bind the expected result shape once at the invocation — eg
   * `await this.call<string>({...})` — instead of a trailing `as T` cast on
   * the returned promise, which was easy to forget and unsafe to compare to
   * the actual runtime shape.
   */
  private call<R = unknown>(message: Record<string, unknown>): Promise<R> {
    const id = this.nextId()
    return new Promise<R>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('Crypto worker request timed out'))
        }
      }, 30_000)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      })
      this.worker.postMessage({ ...message, id })
    })
  }

  /**
   * Unlock the worker by decrypting the nsec blob with the provided KEK.
   * Returns the derived x-only public key hex.
   */
  async unlock(kekHex: string, nonceHex: string, ciphertextHex: string): Promise<string> {
    return this.call<string>({
      type: 'unlock',
      kekHex,
      nonceHex,
      ciphertextHex,
    })
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
    return this.call<string>({ type: 'sign', messageHex })
  }

  /**
   * ECIES key unwrap using the worker's secret key. Returns the unwrapped
   * 32-byte key as hex.
   *
   * The caller-supplied `aad` is threaded into the inner XChaCha20-Poly1305
   * AEAD alongside the label-derived key. Callers SHOULD pass
   * `buildAad(label, recordId, fieldName)` (from `@shared/hpke-primitives`)
   * to bind the ciphertext to its per-record context. Legacy call sites that
   * must preserve an on-wire empty-AAD format may pass `new Uint8Array(0)`
   * with a `// TODO(tier-1 per-record-aad)` comment referencing
   * `POST_OVERHAUL_GAPS_2026-04-13.md` Tier 1 P1 "Per-record AAD migration".
   */
  async decrypt(
    ephemeralPubkeyHex: string,
    wrappedKeyHex: string,
    label: CryptoLabel,
    aad: Uint8Array
  ): Promise<string> {
    return this.call<string>({
      type: 'decrypt',
      ephemeralPubkeyHex,
      wrappedKeyHex,
      label,
      aadHex: bytesToHex(aad),
    })
  }

  /**
   * Decrypt an envelope-encrypted field entirely inside the worker.
   * Combines ECIES unwrap + XChaCha20-Poly1305 decrypt in one round trip.
   * Returns the decrypted plaintext string.
   *
   * `aad` is threaded into the outer field AEAD (must match what was passed
   * to {@link envelopeEncryptField} at seal time).
   */
  async decryptEnvelopeField(
    encryptedHex: string,
    ephemeralPubkeyHex: string,
    wrappedKeyHex: string,
    label: CryptoLabel,
    aad: Uint8Array
  ): Promise<string> {
    return this.call<string>({
      type: 'decryptEnvelopeField',
      encryptedHex,
      ephemeralPubkeyHex,
      wrappedKeyHex,
      label,
      aadHex: bytesToHex(aad),
    })
  }

  /**
   * ECIES key wrap for a recipient. Uses an ephemeral key inside the worker.
   *
   * The caller-supplied `aad` is threaded into the inner XChaCha20-Poly1305
   * AEAD. See {@link decrypt} for the recommended AAD shape.
   */
  async encrypt(
    plaintextHex: string,
    recipientPubkeyHex: string,
    label: CryptoLabel,
    aad: Uint8Array
  ): Promise<EncryptResult> {
    return this.call<EncryptResult>({
      type: 'encrypt',
      plaintextHex,
      recipientPubkeyHex,
      label,
      aadHex: bytesToHex(aad),
    })
  }

  /**
   * Get the x-only public key hex, or null if locked.
   */
  async getPublicKey(): Promise<string | null> {
    return this.call<string | null>({ type: 'getPublicKey' })
  }

  /**
   * Check if the worker is currently unlocked.
   */
  async isUnlocked(): Promise<boolean> {
    return this.call<boolean>({ type: 'isUnlocked' })
  }

  /**
   * Re-encrypt the held nsec under a new KEK.
   * Used for idp_value rotation without exposing nsec to the main thread.
   *
   * The caller-supplied `aad` is threaded into the inner AEAD. It MUST
   * match what `key-store.encryptNsec` uses at first enrollment and what
   * `unlock` expects — today that is `new Uint8Array(0)` so the shared
   * nsec wire format stays consistent across enrollment, unlock, and
   * rotation. See POST_OVERHAUL_GAPS_2026-04-13.md Tier 1 P1
   * "Per-record AAD migration" for the planned nsec-blob migration.
   */
  async reEncrypt(newKekHex: string, aad: Uint8Array): Promise<ReEncryptResult> {
    return this.call<ReEncryptResult>({
      type: 'reEncrypt',
      newKekHex,
      aadHex: bytesToHex(aad),
    })
  }

  /**
   * Encrypt the held nsec for a recipient device using ECDH.
   * The nsec is encrypted inside the worker and never exposed as plaintext to the main thread.
   * Returns the encrypted payload plus our public key for the recipient to verify.
   */
  async provisionNsec(recipientEphemeralPubkeyHex: string): Promise<ProvisionNsecResult> {
    return this.call<ProvisionNsecResult>({
      type: 'provisionNsec',
      recipientEphemeralPubkeyHex,
    })
  }

  /**
   * Export the unlocked nsec as an opaque session capsule encrypted with a
   * random token. Caller persists `{encryptedNsecHex, capsuleNonceHex}` in
   * IDB and `token` in sessionStorage — on reload, feed both back to
   * importSession() to restore the worker without a PBKDF2 round.
   */
  async exportSession(): Promise<ExportSessionResult> {
    // The worker returns plain strings; validate and brand them here so the
    // rest of the main thread can only see `SessionToken` / `EncryptedNsecHex`
    // / `CapsuleNonceHex`. `asHex` throws on any length or charset drift,
    // which surfaces a worker-contract bug loudly instead of silently
    // corrupting IDB.
    const raw = await this.call<{
      tokenHex: string
      encryptedNsecHex: string
      capsuleNonceHex: string
      encryptedKekHex: string | null
      kekNonceHex: string | null
    }>({ type: 'exportSession' })
    return {
      tokenHex: asSessionToken(raw.tokenHex),
      encryptedNsecHex: asEncryptedNsec(raw.encryptedNsecHex),
      capsuleNonceHex: asCapsuleNonce(raw.capsuleNonceHex),
      encryptedKekHex: raw.encryptedKekHex,
      kekNonceHex: raw.kekNonceHex,
    }
  }

  /**
   * Restore the worker state from a session capsule. Throws if the capsule
   * is invalid, tampered, or the token does not match. On success the
   * worker holds the nsec and returns the derived x-only public key hex.
   */
  async importSession(
    tokenHex: SessionToken,
    encryptedNsecHex: EncryptedNsecHex,
    capsuleNonceHex: CapsuleNonceHex,
    encryptedKekHex?: string,
    kekNonceHex?: string
  ): Promise<string> {
    return this.call<string>({
      type: 'importSession',
      tokenHex,
      encryptedNsecHex,
      capsuleNonceHex,
      encryptedKekHex,
      kekNonceHex,
    })
  }

  /**
   * Envelope-encrypt a plaintext field for a set of recipients.
   * Generates a random symmetric key, XChaCha20-Poly1305-encrypts the plaintext,
   * and ECIES-wraps the key for each recipient pubkey.
   *
   * `aad` is threaded into the outer field AEAD. Pair with
   * {@link decryptEnvelopeField} which MUST receive the same AAD at open time.
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
    return this.call<{
      encryptedHex: string
      envelopes: Array<{
        recipientPubkey: string
        ephemeralPubkeyHex: string
        wrappedKeyHex: string
      }>
    }>({
      type: 'envelopeEncryptField',
      plaintext,
      recipientPubkeysHex,
      label,
      aadHex: bytesToHex(aad),
    })
  }

  /**
   * Schnorr sign an audit entry hash (hex-encoded SHA-256). Returns the 64-byte
   * Schnorr signature as 128 hex chars. Rate limited via the 'sign' bucket;
   * exceeding the limit triggers auto-lock.
   */
  async signAuditEntry(entryHashHex: string): Promise<string> {
    return this.call<string>({ type: 'signAuditEntry', entryHashHex })
  }

  /**
   * Compute HMAC-SHA256 of the input string using the provided hex-encoded secret.
   * Returns the hex-encoded MAC.
   */
  async computeHmac(input: string, secretHex: string): Promise<string> {
    return this.call<string>({ type: 'computeHmac', input, secretHex })
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
    hpkePrivateKey: X25519EncryptionKey,
    hubKey: AesGcmKey
  ): Promise<string> {
    return this.call<string>({
      type: 'unlockWithHandles',
      nsecRaw,
      hpkePrivateKey,
      hubKey,
    })
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
    return this.call<HpkeEnvelope>({
      type: 'hpkeSeal',
      plaintext,
      recipientPublicKeyRaw,
      label,
      recordId,
      fieldName,
    })
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
    return this.call<string>({
      type: 'hpkeOpen',
      envelope,
      expectedLabel,
      recordId,
      fieldName,
    })
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
    return this.call<string>({
      type: 'rootKekWrap',
      factorBytesHex,
      hkdfSaltHex,
    })
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
    return this.call<boolean>({ type: 'rootKekIsLoaded' })
  }

  // ---- Tier 6 MLS sidecar ----

  /**
   * Initialize the MLS core-crypto client inside the worker. Derives the IDB
   * encryption key from the stored KEK via HKDF + LABEL_MLS_PROVISION.
   *
   * @param clientId - MLS client identifier (e.g. `userId:deviceId`)
   * @param kekHex - Optional KEK hex; if omitted, uses KEK stored from prior unlock
   */
  async mlsInit(clientId: string, kekHex?: string): Promise<void> {
    await this.call({ type: 'mlsInit', clientId, ...(kekHex ? { kekHex } : {}) })
  }

  /**
   * Generate MLS KeyPackages for upload to the server. Returns serialized
   * KeyPackage byte arrays ready for POST /api/mls/hub/:hubId/key-packages.
   */
  async mlsGenerateKeyPackages(count: number): Promise<Uint8Array[]> {
    return this.call<Uint8Array[]>({ type: 'mlsGenerateKeyPackages', count })
  }

  /**
   * Return the current MLS epoch for a group, or null if the group doesn't
   * exist locally yet.
   */
  async mlsCurrentEpoch(groupId: string): Promise<number | null> {
    return this.call<number | null>({ type: 'mlsCurrentEpoch', groupId })
  }

  /**
   * Close the core-crypto instance and clear MLS key material from the worker.
   * Does not delete the IDB database — call mlsClearState for that.
   */
  async mlsLock(): Promise<void> {
    await this.call({ type: 'mlsLock' })
  }

  /**
   * Close core-crypto and delete the MLS IDB database entirely.
   * Used for factory reset / recovery flows.
   */
  async mlsClearState(): Promise<void> {
    await this.call({ type: 'mlsClearState' })
  }

  // ---- Tier 6 MLS group management (Slice 3) ----

  /**
   * Create a new MLS group (conversation) for the given group ID.
   * Uses CS 1 (MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519) and Basic credentials.
   *
   * @param groupId - MLS group identifier (e.g. `llamenos:hub:<hubId>`)
   */
  async mlsCreateGroup(groupId: string): Promise<void> {
    await this.call({ type: 'mlsCreateGroup', groupId })
  }

  /**
   * Join an existing MLS group via a Welcome message received from the server.
   * Returns the conversation ID (group ID) as a UTF-8 string.
   */
  async mlsProcessWelcome(welcomeBytes: Uint8Array): Promise<string> {
    return this.call<string>({ type: 'mlsProcessWelcome', welcomeBytes })
  }

  /**
   * Join an existing MLS group via external commit using GroupInfo.
   * Used for re-enrollment when the original KeyPackage was consumed.
   * Returns the conversation ID (group ID) as a UTF-8 string.
   */
  async mlsExternalJoin(groupInfoBytes: Uint8Array): Promise<string> {
    return this.call<string>({ type: 'mlsExternalJoin', groupInfoBytes })
  }

  /**
   * Encrypt a plaintext message for the MLS group.
   * Returns the TLS-serialized MLS ciphertext to fan out to members.
   */
  async mlsEncryptMessage(groupId: string, plaintext: Uint8Array): Promise<Uint8Array> {
    return this.call<Uint8Array>({ type: 'mlsEncryptMessage', groupId, plaintext })
  }

  /**
   * Decrypt an incoming MLS message (application message or handshake).
   * For application messages, `message` contains the plaintext.
   * For commits/proposals, `message` is undefined and `hasEpochChanged` may be true.
   */
  async mlsDecryptMessage(
    groupId: string,
    ciphertext: Uint8Array
  ): Promise<{
    message: Uint8Array | undefined
    senderClientId: string | undefined
    hasEpochChanged: boolean
    isActive: boolean
  }> {
    return this.call<{
      message: Uint8Array | undefined
      senderClientId: string | undefined
      hasEpochChanged: boolean
      isActive: boolean
    }>({ type: 'mlsDecryptMessage', groupId, ciphertext })
  }

  /**
   * Add members to an MLS group by their KeyPackages.
   * Returns the captured commit bundle (commit + optional welcome + groupInfo)
   * that the caller must submit to the server.
   */
  async mlsAddMembers(
    groupId: string,
    keyPackages: Uint8Array[]
  ): Promise<{
    commit: Uint8Array
    welcome: Uint8Array | undefined
    groupInfo: Uint8Array | undefined
  }> {
    return this.call<{
      commit: Uint8Array
      welcome: Uint8Array | undefined
      groupInfo: Uint8Array | undefined
    }>({ type: 'mlsAddMembers', groupId, keyPackages })
  }

  /**
   * Remove members from an MLS group by their client IDs.
   * Returns the captured commit bundle that the caller must submit to the server.
   */
  async mlsRemoveMembers(
    groupId: string,
    clientIds: string[]
  ): Promise<{
    commit: Uint8Array
    welcome: Uint8Array | undefined
    groupInfo: Uint8Array | undefined
  }> {
    return this.call<{
      commit: Uint8Array
      welcome: Uint8Array | undefined
      groupInfo: Uint8Array | undefined
    }>({ type: 'mlsRemoveMembers', groupId, clientIds })
  }

  /**
   * Wipe a local MLS group. Removes all local state for the group.
   * Does not affect the server — used for cleanup after removal or reset.
   */
  async mlsWipeGroup(groupId: string): Promise<void> {
    await this.call({ type: 'mlsWipeGroup', groupId })
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
