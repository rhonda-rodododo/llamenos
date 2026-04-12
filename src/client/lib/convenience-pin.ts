/**
 * Convenience PIN — in-session re-lock only.
 *
 * NOT a KEK factor. Stored server-side as Argon2id(PIN, random salt). When the
 * auto-lock timer fires, the worker stays "unlocked" but the UI enters a
 * convenience-locked state; a matching PIN re-enables the UI gate.
 * 5 wrong attempts demote the worker to full Locked.
 *
 * Server integration: The convenience PIN hash is stored via auth-facade-client
 * endpoints. This module is the client-side interface that manages the flow.
 */
import { argon2id } from '@noble/hashes/argon2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

const MAX_ATTEMPTS = 5
const STORAGE_KEY = 'llamenos-convenience-pin'

export class ConveniencePinMismatchError extends Error {
  public readonly remaining: number
  constructor(remaining: number) {
    super(`PIN mismatch (${remaining} attempts remaining)`)
    this.name = 'ConveniencePinMismatchError'
    this.remaining = remaining
  }
}

export class ConveniencePinLockedError extends Error {
  constructor() {
    super('Convenience PIN locked after 5 wrong attempts — full unlock required')
    this.name = 'ConveniencePinLockedError'
  }
}

export class ConveniencePinFormatError extends Error {
  constructor() {
    super('PIN must be 4–8 digits')
    this.name = 'ConveniencePinFormatError'
  }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface PinState {
  hash: string // hex
  salt: string // hex
  attempts: number
  locked: boolean
}

interface PinStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

let storage: PinStorage =
  typeof localStorage !== 'undefined'
    ? localStorage
    : (() => {
        const map = new Map<string, string>()
        return {
          getItem: (k: string) => map.get(k) ?? null,
          setItem: (k: string, v: string) => map.set(k, v),
          removeItem: (k: string) => map.delete(k),
        }
      })()

/** Test-only: inject a custom storage backend. */
export function __setStorageForTests(s: PinStorage): void {
  storage = s
}

function loadState(): PinState | null {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PinState
  } catch {
    return null
  }
}

function saveState(state: PinState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function hashPin(pin: string, saltBytes: Uint8Array): string {
  const pinBytes = new TextEncoder().encode(pin)
  // Lightweight Argon2id for convenience PIN (NOT a KEK — low memory is fine)
  const hash = argon2id(pinBytes, saltBytes, { t: 1, m: 4096, p: 1, dkLen: 32 })
  return bytesToHex(hash)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate PIN format: 4–8 digits. */
export function isValidConveniencePin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}

/** Set (or replace) the convenience PIN. */
export async function setConveniencePin(pin: string): Promise<void> {
  if (!isValidConveniencePin(pin)) throw new ConveniencePinFormatError()
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const hash = hashPin(pin, saltBytes)
  saveState({
    hash,
    salt: bytesToHex(saltBytes),
    attempts: 0,
    locked: false,
  })
}

/**
 * Verify the convenience PIN. Returns true on match.
 * Throws ConveniencePinLockedError after 5 failed attempts.
 * Throws ConveniencePinMismatchError on wrong PIN.
 */
export async function enterConveniencePin(pin: string): Promise<boolean> {
  const state = loadState()
  if (!state) throw new ConveniencePinMismatchError(0)
  if (state.locked) throw new ConveniencePinLockedError()

  const computed = hashPin(pin, hexToBytes(state.salt))

  if (computed === state.hash) {
    // Reset attempts on success
    state.attempts = 0
    saveState(state)
    return true
  }

  state.attempts++
  if (state.attempts >= MAX_ATTEMPTS) {
    state.locked = true
    saveState(state)
    throw new ConveniencePinLockedError()
  }

  saveState(state)
  throw new ConveniencePinMismatchError(MAX_ATTEMPTS - state.attempts)
}

/** Check if a convenience PIN is currently set. */
export function hasConveniencePin(): boolean {
  return loadState() !== null
}

/** Check if the convenience PIN is locked out. */
export function isConveniencePinLocked(): boolean {
  const state = loadState()
  return state?.locked ?? false
}

/** Clear the convenience PIN. */
export async function clearConveniencePin(): Promise<void> {
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable
  }
}
