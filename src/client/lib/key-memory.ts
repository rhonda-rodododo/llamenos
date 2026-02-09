/**
 * Module-level in-memory keyPair storage.
 * Separate from auth.tsx to avoid circular dependencies with api.ts and ws.ts.
 */

import type { KeyPair } from './crypto'

let inMemoryKeyPair: KeyPair | null = null

export function getInMemoryKeyPair(): KeyPair | null {
  return inMemoryKeyPair
}

export function setInMemoryKeyPair(kp: KeyPair | null) {
  inMemoryKeyPair = kp
}
