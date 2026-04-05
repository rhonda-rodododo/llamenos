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
import { type UserInfo, authFacadeClient } from './auth-facade-client'
import { cryptoWorker } from './crypto-worker-client'
import { createDebugLog } from './debug-log'
import {
  type EncryptedKeyDataV2,
  type KEKFactors,
  SYNTHETIC_ISSUERS,
  type SyntheticIssuer,
  isValidPin as _isValidPin,
  clearStoredKeyV2,
  deriveKEK,
  encryptNsec,
  hasStoredKeyV2,
  loadEncryptedKeyV2,
  storeEncryptedKeyV2,
  syntheticIdpValue,
} from './key-store-v2'

const log = createDebugLog('llamenos:keys')

// --- Auto-lock ---
let idleTimer: ReturnType<typeof setTimeout> | null = null
const lockCallbacks: Set<() => void> = new Set()
const unlockCallbacks: Set<() => void> = new Set()
const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
let autoLockDisabled = false

function resetAutoLockTimers() {
  if (autoLockDisabled) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    void lock()
  }, IDLE_TIMEOUT_MS)
}

function notifyCallbacks(callbacks: Set<() => void>) {
  callbacks.forEach((cb) => cb())
}

// Lock on tab hide — with configurable grace period so users can switch windows to copy/paste
let visibilityTimer: ReturnType<typeof setTimeout> | null = null
const LOCK_DELAY_KEY = 'llamenos-lock-delay'
const DEFAULT_LOCK_DELAY_MS = 30_000 // 30 seconds

function getLockDelay(): number {
  try {
    const stored = localStorage.getItem(LOCK_DELAY_KEY)
    if (stored) {
      const ms = Number.parseInt(stored, 10)
      if (ms >= 0 && ms <= 600_000) return ms // 0 = immediate, max 10 min
    }
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_LOCK_DELAY_MS
}

/** Set the tab-switch lock delay in milliseconds (0 = lock immediately, max 600000 = 10 min) */
export function setLockDelay(ms: number) {
  const clamped = Math.max(0, Math.min(600_000, ms))
  localStorage.setItem(LOCK_DELAY_KEY, String(clamped))
}

/** Get the current tab-switch lock delay in milliseconds */
export function getLockDelayMs(): number {
  return getLockDelay()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (autoLockDisabled) return
    // Check worker state asynchronously — the visibility handler
    // needs to guard on whether the worker is unlocked
    void (async () => {
      const unlocked = await cryptoWorker.isUnlocked()
      if (document.hidden && unlocked) {
        const delay = getLockDelay()
        if (delay === 0) {
          await lock()
        } else {
          visibilityTimer = setTimeout(() => {
            void lock()
          }, delay)
        }
      } else if (!document.hidden && visibilityTimer) {
        // User came back within grace period — cancel the lock
        clearTimeout(visibilityTimer)
        visibilityTimer = null
      }
    })()
  })
}

// --- Rotation handler ---

async function handleRotation(
  pin: string,
  currentBlob: EncryptedKeyDataV2,
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
  const reEncrypted = await cryptoWorker.reEncrypt(bytesToHex(newKek))
  const newBlob: EncryptedKeyDataV2 = {
    ...currentBlob,
    salt: bytesToHex(newSalt),
    nonce: reEncrypted.nonce,
    ciphertext: reEncrypted.ciphertext,
  }
  storeEncryptedKeyV2(newBlob)
  await authFacadeClient.confirmRotation()
}

/**
 * Silently rotate a key encrypted with a synthetic IdP value to a real IdP value.
 * Called after successful unlock when the stored blob has a synthetic issuer.
 * If the IdP is unreachable, the rotation is skipped — it will retry on next unlock.
 */
async function rotateSyntheticToReal(
  pin: string,
  currentBlob: EncryptedKeyDataV2,
  prfOutput?: Uint8Array
): Promise<void> {
  try {
    const realUserInfo = await authFacadeClient.getUserInfo()
    if (!realUserInfo) return // IdP not reachable — retry next unlock

    const newSalt = crypto.getRandomValues(new Uint8Array(32))
    const newKek = deriveKEK({
      pin,
      idpValue: realUserInfo.nsecSecret,
      prfOutput,
      salt: newSalt,
    })
    // Re-encrypt without exposing nsec to the main thread
    const reEncrypted = await cryptoWorker.reEncrypt(bytesToHex(newKek))
    const newBlob: EncryptedKeyDataV2 = {
      ...currentBlob,
      salt: bytesToHex(newSalt),
      nonce: reEncrypted.nonce,
      ciphertext: reEncrypted.ciphertext,
      idpIssuer: realUserInfo.pubkey,
    }
    storeEncryptedKeyV2(newBlob)
  } catch {
    // IdP not reachable or re-encryption failed — rotation will happen on next unlock
  }
}

// --- Public API ---

/**
 * Unlock the key store by decrypting the nsec with multi-factor authentication.
 * Factors: PIN + IdP-bound value + optional WebAuthn PRF output.
 * Returns the hex pubkey on success, null on wrong PIN / missing factors.
 */
export async function unlock(pin: string): Promise<string | null> {
  const blob = loadEncryptedKeyV2()
  if (!blob) return null

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
      return null
    }
    idpValue = userInfo.nsecSecret
  }

  // 3. Request PRF if this device uses it
  let prfOutput: Uint8Array | undefined
  if (blob.prfUsed) {
    // requestWebAuthnPRF is Task 12 — dynamically import to handle absence
    try {
      const webauthnModule = await import('./webauthn')
      if ('requestWebAuthnPRF' in webauthnModule) {
        const requestPRF = webauthnModule.requestWebAuthnPRF as () => Promise<Uint8Array | null>
        prfOutput = (await requestPRF()) ?? undefined
      }
    } catch {
      // PRF not available yet
    }
  }

  // 4. Derive KEK
  const salt = hexToBytes(blob.salt)
  const kek = deriveKEK({ pin, idpValue, prfOutput, salt })

  // 5. Send to worker for decryption
  try {
    const pubkey = await cryptoWorker.unlock(bytesToHex(kek), blob.nonce, blob.ciphertext)
    if (pubkey) {
      resetAutoLockTimers()
      notifyCallbacks(unlockCallbacks)

      // Handle idp_value rotation if pending (real IdP changed)
      if (userInfo?.pendingRotation) {
        await handleRotation(pin, blob, userInfo, prfOutput)
      }

      // Auto-rotate synthetic issuer to real IdP value (silent, no user interaction)
      if (isSynthetic) {
        await rotateSyntheticToReal(pin, blob, prfOutput)
      }
    }
    return pubkey
  } catch (err) {
    log('unlock failed:', err instanceof Error ? err.message : 'unknown')
    return null
  }
}

/**
 * Lock the key manager — delegates zeroing to the crypto worker.
 */
export async function lock(): Promise<void> {
  await cryptoWorker.lock()
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (visibilityTimer) {
    clearTimeout(visibilityTimer)
    visibilityTimer = null
  }
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

  // Encrypt and store as v2 blob
  const blob = encryptNsec(nsecHex, kek, pubkey, !!prfOutput, idpIssuer, salt)
  storeEncryptedKeyV2(blob)

  // Load into worker
  const workerPubkey = await cryptoWorker.unlock(bytesToHex(kek), blob.nonce, blob.ciphertext)

  resetAutoLockTimers()
  notifyCallbacks(unlockCallbacks)

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

/**
 * Check if there's an encrypted key in local storage (v2 format).
 */
export function hasStoredKey(): boolean {
  return hasStoredKeyV2()
}

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
  clearStoredKeyV2()
}

/**
 * Disable auto-lock timers (idle + tab-hide).
 * Used in demo mode where frequent lock-outs ruin the experience.
 */
export function disableAutoLock() {
  autoLockDisabled = true
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (visibilityTimer) {
    clearTimeout(visibilityTimer)
    visibilityTimer = null
  }
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

/** Validate a PIN format (6-8 digits). Re-exported from key-store-v2. */
export function isValidPin(pin: string): boolean {
  return _isValidPin(pin)
}
