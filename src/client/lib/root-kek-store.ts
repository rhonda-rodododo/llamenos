/**
 * Tier 2 root-KEK bundle store.
 *
 * This module is the pure data/persistence layer for the Tier 2 root KEK.
 * It holds no key material: the root KEK itself lives inside the crypto
 * worker as a non-extractable AES-KW `CryptoKey`, and per-factor wrapping
 * keys are derived on demand from raw factor bytes via HKDF-SHA256.
 *
 * Responsibilities:
 *   1. Serialize / deserialize the `RootKekEnvelopeBundle` shape.
 *   2. Persist the active bundle in IndexedDB.
 *   3. Enforce the min-two-factor invariant.
 *   4. Provide pure helpers for append / remove / rotate operations that
 *      the crypto worker (which handles wrapKey / unwrapKey) leans on.
 *
 * It deliberately does NOT:
 *   - Call SubtleCrypto directly (that happens in the worker).
 *   - Know about the crypto-worker RPC protocol.
 *   - Touch nsec or legacy key-store state — those are independent.
 *
 * Naming note: the Tier 1 `key-store` handles PIN-wrapped identity + hub
 * keys and is a separate concern. Tier 2's "root KEK" is a higher layer
 * that wraps whatever the account-level secrets turn out to be once the
 * migration settles.
 */

import {
  type RootKekEnvelope,
  type RootKekEnvelopeBundle,
  RootKekEnvelopeBundleSchema,
  RootKekEnvelopeSchema,
} from '@shared/schemas/root-kek-envelope'
import { type IDBPDatabase, openDB } from 'idb'

// ---------------------------------------------------------------------------
// IDB configuration
// ---------------------------------------------------------------------------

export const ROOT_KEK_DB_NAME = 'llamenos-root-kek'
export const ROOT_KEK_STORE_NAME = 'bundles'
export const ROOT_KEK_ACTIVE_KEY = 'active'
const ROOT_KEK_DB_VERSION = 1

interface RootKekDbSchema {
  bundles: {
    key: typeof ROOT_KEK_ACTIVE_KEY
    value: RootKekEnvelopeBundle
  }
}

async function openRootKekDb(): Promise<IDBPDatabase<RootKekDbSchema>> {
  return openDB<RootKekDbSchema>(ROOT_KEK_DB_NAME, ROOT_KEK_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(ROOT_KEK_STORE_NAME)) {
        db.createObjectStore(ROOT_KEK_STORE_NAME)
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MinFactorsError extends Error {
  constructor(message = 'root-kek bundle must contain at least 2 distinct factors') {
    super(message)
    this.name = 'MinFactorsError'
  }
}

export class InvalidBundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidBundleError'
  }
}

// ---------------------------------------------------------------------------
// Pure bundle primitives
// ---------------------------------------------------------------------------

export function encodeBundle(bundle: RootKekEnvelopeBundle): string {
  return JSON.stringify(RootKekEnvelopeBundleSchema.parse(bundle))
}

export function decodeBundle(raw: string): RootKekEnvelopeBundle {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new InvalidBundleError(`bundle is not valid JSON: ${(e as Error).message}`)
  }
  const result = RootKekEnvelopeBundleSchema.safeParse(parsed)
  if (!result.success) {
    throw new InvalidBundleError(`bundle failed schema validation: ${result.error.message}`)
  }
  return result.data
}

export function assertMinFactorInvariant(bundle: RootKekEnvelopeBundle): void {
  if (bundle.envelopes.length < 2) throw new MinFactorsError()
  const keys = new Set(bundle.envelopes.map((e) => `${e.factorType}:${e.factorId}`))
  if (keys.size !== bundle.envelopes.length) {
    throw new InvalidBundleError('bundle envelopes must be unique per (factorType, factorId)')
  }
}

/**
 * Return a new bundle with `env` appended. If an envelope already exists
 * for the same (factorType, factorId) pair it is replaced. The min-factor
 * invariant always holds after this call.
 */
export function appendEnvelope(
  bundle: RootKekEnvelopeBundle,
  env: RootKekEnvelope
): RootKekEnvelopeBundle {
  RootKekEnvelopeSchema.parse(env)
  const without = bundle.envelopes.filter(
    (e) => !(e.factorType === env.factorType && e.factorId === env.factorId)
  )
  const next: RootKekEnvelopeBundle = {
    ...bundle,
    envelopes: [...without, env],
  }
  assertMinFactorInvariant(next)
  return next
}

/**
 * Return a new bundle with the matching envelope removed. Throws
 * `MinFactorsError` if doing so would drop the bundle below 2 envelopes.
 */
export function removeEnvelope(
  bundle: RootKekEnvelopeBundle,
  factorType: RootKekEnvelope['factorType'],
  factorId: string
): RootKekEnvelopeBundle {
  const remaining = bundle.envelopes.filter(
    (e) => !(e.factorType === factorType && e.factorId === factorId)
  )
  if (remaining.length === bundle.envelopes.length) {
    throw new InvalidBundleError(
      `no envelope matches factorType=${factorType} factorId=${factorId}`
    )
  }
  const next: RootKekEnvelopeBundle = { ...bundle, envelopes: remaining }
  assertMinFactorInvariant(next)
  return next
}

/**
 * Build a rotated bundle from an explicit envelope set. Used after the
 * crypto worker has freshly wrapped the new root KEK under every factor.
 */
export function buildRotatedBundle(params: {
  userId: string
  newRootKeyId: string
  envelopes: RootKekEnvelope[]
  createdAt?: string
}): RootKekEnvelopeBundle {
  const next: RootKekEnvelopeBundle = {
    v: 3,
    userId: params.userId,
    rootKeyId: params.newRootKeyId,
    envelopes: params.envelopes,
    createdAt: params.createdAt ?? new Date().toISOString(),
  }
  return RootKekEnvelopeBundleSchema.parse(next)
}

// ---------------------------------------------------------------------------
// IDB persistence
// ---------------------------------------------------------------------------

export async function storeBundleInIdb(bundle: RootKekEnvelopeBundle): Promise<void> {
  assertMinFactorInvariant(bundle)
  const db = await openRootKekDb()
  try {
    await db.put(ROOT_KEK_STORE_NAME, bundle, ROOT_KEK_ACTIVE_KEY)
  } finally {
    db.close()
  }
}

export async function loadBundleFromIdb(): Promise<RootKekEnvelopeBundle | null> {
  const db = await openRootKekDb()
  try {
    const bundle = await db.get(ROOT_KEK_STORE_NAME, ROOT_KEK_ACTIVE_KEY)
    if (!bundle) return null
    const parsed = RootKekEnvelopeBundleSchema.safeParse(bundle)
    if (!parsed.success) {
      throw new InvalidBundleError(
        `stored bundle failed validation on load: ${parsed.error.message}`
      )
    }
    return parsed.data
  } finally {
    db.close()
  }
}

export async function clearBundleFromIdb(): Promise<void> {
  const db = await openRootKekDb()
  try {
    await db.delete(ROOT_KEK_STORE_NAME, ROOT_KEK_ACTIVE_KEY)
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// v2 → root-KEK migration descriptor
// ---------------------------------------------------------------------------

/**
 * Describe the work the unlock screen must perform to migrate from a legacy
 * v2 blob to a root-KEK bundle. Actually *running* the migration requires
 * user input (PIN / recovery key / PRF unlock) and worker-side crypto, so
 * this module only produces the descriptor — the UI drives it and calls
 * `storeBundleInIdb()` on success.
 */
export interface V2MigrationDescriptor {
  needsMigration: true
  prfAvailable: boolean
  idpIssuer: string
}

export function describeV2Migration(
  raw: {
    version: number
    prfUsed?: boolean
    idpIssuer?: string
  } | null
): V2MigrationDescriptor | null {
  if (!raw || raw.version !== 2) return null
  return {
    needsMigration: true,
    prfAvailable: Boolean(raw.prfUsed),
    idpIssuer: raw.idpIssuer ?? 'unknown',
  }
}
