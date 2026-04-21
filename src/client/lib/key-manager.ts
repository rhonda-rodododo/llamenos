/**
 * Singleton Key Manager — delegates all secret key operations to the crypto worker.
 *
 * The main thread NEVER holds raw nsec bytes. All private-key operations
 * are delegated to the crypto Web Worker via CryptoWorkerClient.
 *
 * Multi-factor unlock: PIN + IdP-bound value + optional WebAuthn PRF output.
 *
 * States:
 *   Locked:   worker has no key — only session-token auth available
 *   Unlocked: worker holds key in its closure — full crypto available
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { asPubkeyHash16 } from '@shared/crypto-types'
import { type UserInfo, authFacadeClient } from './auth-facade-client'
import { LOCK_CHANNEL_NAME, type LockMessage, parseLockMessage } from './cross-tab-messages'
import { cryptoWorker } from './crypto-worker-client'
import { createDebugLog } from './debug-log'
import {
  type EncryptedKeyData,
  type KEKFactors,
  SYNTHETIC_ISSUERS,
  type SyntheticIssuer,
  isValidPin as _isValidPin,
  clearStoredKey,
  deriveKEK,
  encryptNsec,
  loadEncryptedKey,
  storeEncryptedKey,
  syntheticIdpValue,
} from './key-store'
import { clearCapsule, loadCapsule, storeCapsule, updateAutoLockExpiry } from './session-capsule'

// ---- Cross-tab lock propagation ----
// Tabs share IDB but each has its own Worker closure. When one tab locks,
// we broadcast to sibling tabs so they lock their own Worker state too.
// LOCK_CHANNEL_NAME and the parseLockMessage validator live in
// `./cross-tab-messages` so every BroadcastChannel protocol in the client
// goes through the same shape check at the receive boundary.
let lockChannel: BroadcastChannel | null = null
let suppressBroadcast = false

// Test seam — mirrors session-capsule's pattern so key-manager.test.ts can
// inject a MockBroadcastChannel hub without touching globalThis.
let lockChannelFactory: () => BroadcastChannel | null = defaultLockChannelFactory

function defaultLockChannelFactory(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(LOCK_CHANNEL_NAME)
  } catch {
    return null
  }
}

/**
 * Test-only: swap the lock-channel factory. Pass `null` to reset and
 * close the current channel so the next access rebuilds via the default.
 *
 * When a non-null factory is installed, the new channel is instantiated
 * eagerly so the onmessage listener is wired up before any sibling post.
 * This matches production semantics where the channel is created at
 * module-load time (see the eager `getLockChannel()` call below).
 */
export function __setLockChannelFactoryForTests(
  factory: (() => BroadcastChannel | null) | null
): void {
  try {
    lockChannel?.close()
  } catch {
    /* ignore */
  }
  lockChannel = null
  suppressBroadcast = false
  lockChannelFactory = factory ?? defaultLockChannelFactory
  if (factory !== null) {
    // Eagerly bind onmessage so injected mock channels are ready to
    // receive sibling broadcasts in the same tick.
    getLockChannel()
  }
}

function getLockChannel(): BroadcastChannel | null {
  if (lockChannel) return lockChannel
  lockChannel = lockChannelFactory()
  if (lockChannel) {
    lockChannel.onmessage = (e: MessageEvent<unknown>) => {
      const msg: LockMessage | null = parseLockMessage(e.data)
      if (msg === null) return
      // Sibling tab locked — lock this one too, but do NOT re-broadcast
      // (otherwise we'd loop forever).
      suppressBroadcast = true
      void lock().finally(() => {
        suppressBroadcast = false
      })
    }
  }
  return lockChannel
}

function broadcastLock(): void {
  if (suppressBroadcast) return
  const ch = getLockChannel()
  try {
    ch?.postMessage({ type: 'lock' })
  } catch {
    /* channel closed or unsupported */
  }
}

// Eagerly register the listener on module load so tab B receives tab A's
// lock even if tab B never called lock() itself.
if (typeof BroadcastChannel !== 'undefined') {
  getLockChannel()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try {
      lockChannel?.close()
    } catch {
      /* ignore */
    }
    lockChannel = null
  })
}

const log = createDebugLog('llamenos:keys')

// --- Unified auto-lock ---
let autoLockTimer: ReturnType<typeof setTimeout> | null = null
const lockCallbacks: Set<() => void> = new Set()
const unlockCallbacks: Set<() => void> = new Set()
let autoLockDisabled = false

const AUTO_LOCK_KEY = 'llamenos-auto-lock'
const DEFAULT_AUTO_LOCK_MS = 15 * 60 * 1000 // 15 minutes
const MIN_AUTO_LOCK_MS = 60_000 // 1 minute
const MAX_AUTO_LOCK_MS = 60 * 60 * 1000 // 60 minutes

let autoLockReadErrorReported = false
function getAutoLock(): number {
  try {
    const stored = localStorage.getItem(AUTO_LOCK_KEY)
    if (stored) {
      const ms = Number.parseInt(stored, 10)
      if (ms >= MIN_AUTO_LOCK_MS && ms <= MAX_AUTO_LOCK_MS) return ms
    }
  } catch (err) {
    // localStorage may be unavailable (private browsing, SSR, tests). A user
    // who had explicitly configured a non-default auto-lock silently loses
    // it — surface the first occurrence per session so the drift is visible.
    if (!autoLockReadErrorReported) {
      autoLockReadErrorReported = true
      log('getAutoLock localStorage read failed — falling back to default (15 min)', { err })
    }
  }
  return DEFAULT_AUTO_LOCK_MS
}

/** Set the auto-lock timeout in milliseconds (1 min – 60 min). */
export function setAutoLockMs(ms: number): void {
  const clamped = Math.max(MIN_AUTO_LOCK_MS, Math.min(MAX_AUTO_LOCK_MS, ms))
  localStorage.setItem(AUTO_LOCK_KEY, String(clamped))
  // Reset timer with new value if currently unlocked
  resetAutoLockTimer()
}

/** Get the current auto-lock timeout in milliseconds. */
export function getAutoLockMs(): number {
  return getAutoLock()
}

/** Reset the auto-lock inactivity timer. Call on any user/API activity. */
export function resetAutoLockTimer(): void {
  if (autoLockDisabled) return
  if (autoLockTimer) clearTimeout(autoLockTimer)
  const expiresAt = Date.now() + getAutoLock()
  autoLockTimer = setTimeout(() => {
    void lock()
  }, getAutoLock())
  // Debounced write — best effort, safe to fire-and-forget
  void updateAutoLockExpiry(expiresAt)
}

function notifyCallbacks(callbacks: Set<() => void>) {
  callbacks.forEach((cb) => cb())
}

// Activity listeners — reset the single timer on user interaction
if (typeof document !== 'undefined') {
  const resetOnActivity = () => resetAutoLockTimer()
  document.addEventListener('click', resetOnActivity, { passive: true })
  document.addEventListener('keydown', resetOnActivity, { passive: true })
  document.addEventListener('touchstart', resetOnActivity, { passive: true })

  // Tab becoming visible counts as activity (resets timer)
  // Tab becoming hidden is NOT a lock trigger — just absence of activity
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resetAutoLockTimer()
  })
}

// --- Rotation handler ---

async function handleRotation(
  pin: string,
  currentBlob: EncryptedKeyData,
  userInfo: UserInfo,
  prfOutput?: Uint8Array
): Promise<void> {
  const newSalt = crypto.getRandomValues(new Uint8Array(32))
  const newKek = deriveKEK({
    pin,
    idpValue: userInfo.nsecSecret, // new (current) value
    prfOutput,
    salt: newSalt,
  })
  // Ask worker to re-encrypt without exposing nsec to the main thread
  // TODO(tier-1 per-record-aad): nsec KEK wire format uses empty inner AAD
  // — it must round-trip with `key-store.encryptNsec` / `handleUnlock`. See
  // POST_OVERHAUL_GAPS_2026-04-13.md Tier 1 P1 "Per-record AAD migration".
  const reEncrypted = await cryptoWorker.reEncrypt(bytesToHex(newKek), new Uint8Array(0))
  const newBlob: EncryptedKeyData = {
    ...currentBlob,
    salt: bytesToHex(newSalt),
    nonce: reEncrypted.nonce,
    ciphertext: reEncrypted.ciphertext,
  }
  storeEncryptedKey(newBlob)
  // Re-export the capsule with the new blob's pubkeyHash — the Worker now
  // holds a re-encrypted-at-rest nsec but the nsec bytes are unchanged, so
  // the exported capsule just needs to match the new blob's pubkeyHash.
  try {
    const session = await cryptoWorker.exportSession()
    await storeCapsule(session.tokenHex, {
      encryptedNsec: session.encryptedNsecHex,
      capsuleNonce: session.capsuleNonceHex,
      autoLockExpiresAt: Date.now() + getAutoLock(),
      pubkeyHash: asPubkeyHash16(newBlob.pubkeyHash),
      encryptedKek: session.encryptedKekHex,
      kekNonce: session.kekNonceHex,
    })
  } catch (err) {
    // Capsule refresh failure is unexpected (the worker just re-encrypted
    // successfully). The next PIN unlock will re-seed the capsule, so this
    // is recoverable — but we want visibility in prod logs.
    log('post-rotation capsule export failed', { err })
  }
  await authFacadeClient.confirmRotation()
}

/**
 * Silently rotate a key encrypted with a synthetic IdP value to a real IdP value.
 * Called after successful unlock when the stored blob has a synthetic issuer.
 * If the IdP is unreachable, the rotation is skipped — it will retry on next unlock.
 */
async function rotateSyntheticToReal(
  pin: string,
  currentBlob: EncryptedKeyData,
  prfOutput?: Uint8Array
): Promise<void> {
  // Phase 1: resolve the real IdP value. A failure here is expected
  // (IdP unreachable, cold cache, first boot) and rotation will retry
  // silently on the next unlock.
  let realUserInfo: Awaited<ReturnType<typeof authFacadeClient.getUserInfo>>
  try {
    realUserInfo = await authFacadeClient.getUserInfo()
  } catch {
    return // IdP not reachable — retry next unlock
  }
  if (!realUserInfo) return

  // Phase 2: re-encrypt with the real IdP value. Failures here are
  // unexpected (crypto worker bug, storage full, KEK derivation error)
  // and must be surfaced — silently leaving the user on a synthetic key
  // forever is a real defect.
  try {
    const newSalt = crypto.getRandomValues(new Uint8Array(32))
    const newKek = deriveKEK({
      pin,
      idpValue: realUserInfo.nsecSecret,
      prfOutput,
      salt: newSalt,
    })
    // Re-encrypt without exposing nsec to the main thread.
    // TODO(tier-1 per-record-aad): nsec KEK wire format uses empty inner AAD
    // — it must round-trip with `key-store.encryptNsec` / `handleUnlock`. See
    // POST_OVERHAUL_GAPS_2026-04-13.md Tier 1 P1 "Per-record AAD migration".
    const reEncrypted = await cryptoWorker.reEncrypt(bytesToHex(newKek), new Uint8Array(0))
    const newBlob: EncryptedKeyData = {
      ...currentBlob,
      salt: bytesToHex(newSalt),
      nonce: reEncrypted.nonce,
      ciphertext: reEncrypted.ciphertext,
      idpIssuer: realUserInfo.pubkey,
    }
    storeEncryptedKey(newBlob)
    // Re-export the capsule with the new blob's pubkeyHash — the Worker now
    // holds a re-encrypted-at-rest nsec but the nsec bytes are unchanged, so
    // the exported capsule just needs to match the new blob's pubkeyHash.
    try {
      const session = await cryptoWorker.exportSession()
      await storeCapsule(session.tokenHex, {
        encryptedNsec: session.encryptedNsecHex,
        capsuleNonce: session.capsuleNonceHex,
        autoLockExpiresAt: Date.now() + getAutoLock(),
        pubkeyHash: asPubkeyHash16(newBlob.pubkeyHash),
        encryptedKek: session.encryptedKekHex,
        kekNonce: session.kekNonceHex,
      })
    } catch (err) {
      log('post-rotation capsule export failed', { err })
    }
  } catch (err) {
    log('rotateSyntheticToReal re-encrypt failed', { err })
  }
}

// --- Public API ---

/**
 * Attempt a fast-path unlock by restoring the Worker from a previously
 * exported session capsule. Called on app mount before any PIN prompt.
 *
 * Returns true on success (worker is now unlocked, unlock callbacks fired),
 * false if no capsule was found, it's expired, or restore failed. Callers
 * should fall through to the PIN entry flow on false.
 */
export async function trySessionRestore(): Promise<boolean> {
  const blob = loadEncryptedKey()
  if (!blob) return false

  const loaded = await loadCapsule(asPubkeyHash16(blob.pubkeyHash))
  if (!loaded) return false

  try {
    const pubkey = await cryptoWorker.importSession(
      loaded.token,
      loaded.capsule.encryptedNsec,
      loaded.capsule.capsuleNonce,
      loaded.capsule.encryptedKek ?? undefined,
      loaded.capsule.kekNonce ?? undefined
    )
    resetAutoLockTimer()
    notifyCallbacks(unlockCallbacks)

    // Initialize MLS core-crypto (non-fatal — session restore must succeed
    // even if MLS fails). The worker restored kekBytes from the capsule
    // during importSession, so mlsInit can derive the IDB key internally.
    try {
      await cryptoWorker.mlsInit(pubkey)
    } catch (err) {
      log(
        'MLS init after session restore failed (non-fatal):',
        err instanceof Error ? err.message : 'unknown'
      )
    }

    return true
  } catch (err) {
    // Import failure after a successful loadCapsule means the capsule was
    // present and pubkeyHash-matched but decryption failed. Legitimate cases
    // are rare (worker-side corruption or a token/capsule mismatch from a
    // partial clearCapsule race); suspicious cases include devtools
    // tampering with IDB. Surface it in prod logs and clear the capsule so
    // the next unlock goes through PIN.
    log('trySessionRestore importSession failed, clearing capsule', { err })
    await clearCapsule()
    return false
  }
}

/**
 * Discriminated result of `unlock`. The legacy `Promise<string | null>`
 * shape collapsed four distinct failure modes into a single `null` and
 * every caller treated `null` as "wrong PIN" — which silently burned the
 * user's 3-attempt lockout budget whenever the real problem was that
 * WebAuthn PRF was unavailable or the IdP session had expired. Callers
 * MUST branch on `reason` before incrementing a wrong-PIN counter or
 * wiping the key.
 *
 * - `ok`: unlock succeeded, `pubkey` is the hex-encoded Nostr pubkey.
 * - `no-blob`: no stored encrypted key — caller should send user through
 *   initial setup, not retry the PIN.
 * - `idp-unavailable`: facade could not resolve a real IdP value
 *   (session expired, network down). Fatal for this attempt but the user
 *   can retry once the session is restored — do NOT count as a PIN miss.
 * - `prf-unavailable`: the stored blob was sealed with a WebAuthn PRF
 *   factor but the authenticator/browser did not return a PRF output on
 *   this attempt (user cancelled the prompt, hardware missing, different
 *   browser). Do NOT count as a PIN miss — the PIN may be correct.
 * - `wrong-pin`: KEK derivation succeeded but AEAD authentication in the
 *   worker failed. This is the ONLY case that should increment the
 *   PIN-attempt counter and trigger key wipe after max attempts.
 */
export type UnlockResult =
  | { ok: true; pubkey: string }
  | { ok: false; reason: 'no-blob' }
  | { ok: false; reason: 'idp-unavailable' }
  | { ok: false; reason: 'prf-unavailable' }
  | { ok: false; reason: 'wrong-pin' }

/**
 * Unlock the key store by decrypting the nsec with multi-factor authentication.
 * Factors: PIN + IdP-bound value + optional WebAuthn PRF output.
 *
 * See `UnlockResult` for the full failure taxonomy. Callers must branch on
 * `reason` — treating any failure as "wrong PIN" leaks lockout budget to
 * transient PRF/IdP failures and can wipe keys on correct PINs.
 */
export async function unlock(pin: string): Promise<UnlockResult> {
  const blob = loadEncryptedKey()
  if (!blob) return { ok: false, reason: 'no-blob' }

  // 1. Determine if blob was encrypted with a synthetic IdP value
  const isSynthetic = (SYNTHETIC_ISSUERS as readonly string[]).includes(blob.idpIssuer)

  // 2. Resolve IdP value for KEK derivation
  let idpValue: Uint8Array
  let userInfo: UserInfo | null = null

  if (isSynthetic) {
    // Use the deterministic synthetic value that was used during importKey
    idpValue = syntheticIdpValue(blob.idpIssuer)
  } else {
    // Fetch real IdP value from facade (requires valid session).
    // If no access token is available, try refreshing from the httpOnly cookie first.
    userInfo = await authFacadeClient.getUserInfo()
    if (!userInfo) {
      log('getUserInfo failed, attempting token refresh...')
      try {
        const refreshResult = await authFacadeClient.refreshToken()
        log('refresh succeeded:', !!refreshResult)
        userInfo = await authFacadeClient.getUserInfo()
        log('getUserInfo after refresh:', !!userInfo)
      } catch (err) {
        log('refresh failed:', (err as Error)?.message)
      }
    }
    if (!userInfo) {
      log('no userInfo available — cannot derive KEK')
      return { ok: false, reason: 'idp-unavailable' }
    }
    idpValue = userInfo.nsecSecret
  }

  // 3. Request PRF if this device uses it
  let prfOutput: Uint8Array | undefined
  if (blob.prfUsed) {
    // Dynamically imported so a worker bundle without webauthn still links.
    try {
      const webauthnModule = await import('./webauthn')
      if ('requestWebAuthnPRF' in webauthnModule) {
        const requestPRF = webauthnModule.requestWebAuthnPRF as () => Promise<Uint8Array | null>
        prfOutput = (await requestPRF()) ?? undefined
      }
    } catch (err) {
      log('webauthn module import failed', { err })
    }
    // Blob was sealed with a PRF factor, but we could not obtain PRF bytes
    // on this attempt. Deriving a KEK without the PRF factor would always
    // produce a wrong-pin indication to the worker, burning the user's
    // lockout budget even though the PIN is likely correct.
    if (!prfOutput) {
      log('prf-required blob but PRF output unavailable')
      return { ok: false, reason: 'prf-unavailable' }
    }
  }

  // 4. Derive KEK
  const salt = hexToBytes(blob.salt)
  const kek = deriveKEK({ pin, idpValue, prfOutput, salt })

  // 5. Send to worker for decryption
  let pubkey: string | null
  try {
    pubkey = await cryptoWorker.unlock(bytesToHex(kek), blob.nonce, blob.ciphertext)
  } catch (err) {
    log('unlock failed:', err instanceof Error ? err.message : 'unknown')
    return { ok: false, reason: 'wrong-pin' }
  }
  if (!pubkey) {
    return { ok: false, reason: 'wrong-pin' }
  }

  resetAutoLockTimer()
  notifyCallbacks(unlockCallbacks)

  // Initialize MLS core-crypto (non-fatal — unlock must succeed even if MLS fails).
  // The worker stored the KEK during unlock; mlsInit derives the IDB key internally.
  try {
    await cryptoWorker.mlsInit(pubkey)
  } catch (err) {
    log('MLS init failed (non-fatal):', err instanceof Error ? err.message : 'unknown')
  }

  // Export a session capsule so subsequent reloads can skip PBKDF2.
  // Fire-and-forget — capsule persistence is an optimisation, not a
  // correctness requirement — but surface failures because this path
  // should succeed (the worker was just unlocked).
  try {
    const session = await cryptoWorker.exportSession()
    await storeCapsule(session.tokenHex, {
      encryptedNsec: session.encryptedNsecHex,
      capsuleNonce: session.capsuleNonceHex,
      autoLockExpiresAt: Date.now() + getAutoLock(),
      pubkeyHash: asPubkeyHash16(blob.pubkeyHash),
      encryptedKek: session.encryptedKekHex,
      kekNonce: session.kekNonceHex,
    })
  } catch (err) {
    log('session capsule export failed', { err })
  }

  // Handle idp_value rotation if pending (real IdP changed)
  if (userInfo?.pendingRotation) {
    await handleRotation(pin, blob, userInfo, prfOutput)
  }

  // Auto-rotate synthetic issuer to real IdP value (silent, no user interaction)
  if (isSynthetic) {
    await rotateSyntheticToReal(pin, blob, prfOutput)
  }

  // NOTE: Server-side KEK proof seeding is handled on-demand: when the user
  // attempts a security action (PIN change, recovery rotate, lockdown) and
  // the server has no hash stored, it returns 409 and the client re-POSTs
  // the proof then retries. We used to auto-sync during unlock, but that
  // introduced an extra fetch on a hot path that could affect timing in
  // parallel Playwright workers. On-demand is sufficient.

  return { ok: true, pubkey }
}

/**
 * Lock the key manager — delegates zeroing to the crypto worker, clears the
 * session capsule, and broadcasts a lock message to sibling tabs.
 */
export async function lock(): Promise<void> {
  // Broadcast BEFORE destruction so sibling tabs see the message even if
  // this tab races to close.
  broadcastLock()
  await cryptoWorker.lock()
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
  await clearCapsule()
  notifyCallbacks(lockCallbacks)
}

/**
 * Import a key (onboarding / recovery): encrypt with multi-factor KEK and store,
 * then load into the crypto worker.
 *
 * @param nsecHex - The nsec as a hex string (raw 32-byte secret key)
 * @param pin - User's PIN (6-8 digits)
 * @param pubkey - The corresponding x-only public key hex
 * @param idpValue - The IdP-bound value for KEK derivation
 * @param prfOutput - Optional WebAuthn PRF output
 * @param idpIssuer - The IdP issuer identifier
 */
export async function importKey(
  nsecHex: string,
  pin: string,
  pubkey: string,
  idpValue: Uint8Array,
  prfOutput: Uint8Array | undefined,
  idpIssuer: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const kek = deriveKEK({ pin, idpValue, prfOutput, salt })

  const blob = encryptNsec(nsecHex, kek, pubkey, !!prfOutput, idpIssuer, salt)
  storeEncryptedKey(blob)

  // Load into worker
  const workerPubkey = await cryptoWorker.unlock(bytesToHex(kek), blob.nonce, blob.ciphertext)

  resetAutoLockTimer()
  notifyCallbacks(unlockCallbacks)

  try {
    await cryptoWorker.mlsInit(workerPubkey)
  } catch (err) {
    log('MLS init failed (non-fatal):', err instanceof Error ? err.message : 'unknown')
  }

  return workerPubkey
}

/**
 * Check if the key manager is currently unlocked (delegates to worker).
 */
export async function isUnlocked(): Promise<boolean> {
  return cryptoWorker.isUnlocked()
}

/**
 * Get the public key (hex). Available when unlocked.
 * Delegates to the crypto worker.
 */
export async function getPublicKeyHex(): Promise<string | null> {
  return cryptoWorker.getPublicKey()
}

export { hasStoredKey } from './key-store'

/**
 * Register a callback for lock events.
 */
export function onLock(cb: () => void): () => void {
  lockCallbacks.add(cb)
  return () => lockCallbacks.delete(cb)
}

/**
 * Register a callback for unlock events.
 */
export function onUnlock(cb: () => void): () => void {
  unlockCallbacks.add(cb)
  return () => unlockCallbacks.delete(cb)
}

/**
 * Wipe the encrypted key from localStorage and lock the worker.
 * Used when max PIN attempts exceeded or account deletion.
 */
export async function wipeKey(): Promise<void> {
  await lock()
  clearStoredKey()
}

/**
 * Disable the unified auto-lock timer.
 * Used in demo mode where frequent lock-outs ruin the experience.
 * Also extends the session capsule expiry effectively indefinitely.
 */
export function disableAutoLock() {
  autoLockDisabled = true
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
  // Bump the capsule expiry far into the future so restore always wins.
  void updateAutoLockExpiry(Number.MAX_SAFE_INTEGER)
}

/**
 * Error thrown when crypto operations are attempted while locked.
 */
export class KeyLockedError extends Error {
  constructor() {
    super('Key is locked. Enter PIN to unlock.')
    this.name = 'KeyLockedError'
  }
}

/** Validate a PIN format (6-8 digits). Re-exported from key-store. */
export function isValidPin(pin: string): boolean {
  return _isValidPin(pin)
}
