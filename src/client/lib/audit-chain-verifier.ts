/**
 * Client-side verifier for the Tier 0 signed audit chain.
 *
 * Walks a hub's entry history, verifying per-entry:
 *   1. Zod schema shape
 *   2. prevEntryHash linkage against the running previous hash
 *   3. Deterministic entryHash recomputation via @shared/lib/audit-entry-hash
 *   4. Schnorr signature against the signer pubkey
 *   5. Signer is in the trust set (bootstrapped from admin device pubkeys)
 *
 * The trust set is maintained inline: `device_add` entries extend it,
 * `device_revoke` entries shrink it. This implements the transitive
 * trust model described in spec §0.2.6.
 *
 * Incremental verification: a per-hub cache in IDB (object store
 * `llamenos-audit-chain-cache`) records the last verified entry hash and
 * the trusted device set so subsequent calls in the same session only
 * verify the delta. The cache is cleared on lock/panic-wipe.
 *
 * Testability: the verifier accepts an injected `fetchEntriesSince` and
 * `cacheStore` so unit tests can exercise adversarial inputs without
 * touching the network or IDB.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import { type SignedAuditEntry, SignedAuditEntrySchema } from '@shared/schemas/audit-entries'

// ---- error type ----

export type ChainVerificationErrorCode =
  | 'prev_entry_hash_mismatch'
  | 'entry_hash_mismatch'
  | 'signature_invalid'
  | 'signer_not_trusted'
  | 'schema_invalid'
  | 'empty_chain'
  | 'rotation_trigger_not_at_head'
  | 'invalid_rotation_trigger_type'

export class ChainVerificationError extends Error {
  readonly name = 'ChainVerificationError'
  constructor(
    readonly code: ChainVerificationErrorCode,
    readonly details: Record<string, unknown> = {}
  ) {
    super(`Chain verification failed: ${code}`)
  }
}

// ---- cache store ----

export interface ChainCacheRow {
  hubId: string
  lastVerifiedEntryHash: string | null
  lastVerifiedIndex: number
  trustedDevicePubkeys: string[]
  /**
   * Full last-verified entry, cached so that incremental re-verifications
   * (which fetch an empty delta) can return the head without a backfill
   * fetch. Null iff `lastVerifiedEntryHash` is null.
   */
  headEntry: SignedAuditEntry | null
}

export interface ChainCacheStore {
  get(hubId: string): Promise<ChainCacheRow | null>
  put(row: ChainCacheRow): Promise<void>
  delete(hubId: string): Promise<void>
}

// ---- default IDB cache store ----

const DB_NAME = 'llamenos-audit-chain-cache'
const STORE_NAME = 'chains'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'hubId' })
      }
    }
  })
}

export const idbChainCacheStore: ChainCacheStore = {
  async get(hubId) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(hubId)
      req.onsuccess = () => resolve((req.result as ChainCacheRow | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error('IDB get failed'))
    })
  },
  async put(row) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(row)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
    })
  },
  async delete(hubId) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(hubId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB delete failed'))
    })
  },
}

// ---- default fetcher ----

async function defaultFetchEntriesSince(
  hubId: string,
  since: string | null
): Promise<SignedAuditEntry[]> {
  const url = new URL(`/api/hubs/${encodeURIComponent(hubId)}/audit/signed`, window.location.origin)
  if (since) url.searchParams.set('sinceEntryHash', since)
  const res = await fetch(url.toString(), { credentials: 'include' })
  if (!res.ok) throw new Error(`audit/signed fetch failed: ${res.status}`)
  const body = (await res.json()) as { entries: SignedAuditEntry[] }
  return body.entries ?? []
}

// ---- main verifier ----

export interface VerifyAuditChainOptions {
  fetchEntriesSince?: (hubId: string, since: string | null) => Promise<SignedAuditEntry[]>
  cacheStore?: ChainCacheStore
}

export async function verifyAuditChain(
  hubId: string,
  trustAnchorDevicePubkeys: Set<string>,
  opts: VerifyAuditChainOptions = {}
): Promise<SignedAuditEntry> {
  const fetcher = opts.fetchEntriesSince ?? defaultFetchEntriesSince
  const cache = opts.cacheStore ?? idbChainCacheStore

  const cachedRow = await cache.get(hubId)
  const since = cachedRow?.lastVerifiedEntryHash ?? null
  const trusted = new Set(cachedRow?.trustedDevicePubkeys ?? [...trustAnchorDevicePubkeys])

  const entries = await fetcher(hubId, since)

  let prev: string | null = since
  let head: SignedAuditEntry | null = null

  for (const raw of entries) {
    const parseResult = SignedAuditEntrySchema.safeParse(raw)
    if (!parseResult.success) {
      throw new ChainVerificationError('schema_invalid', {
        issues: parseResult.error.issues,
      })
    }
    const entry = parseResult.data

    if (entry.prevEntryHash !== prev) {
      throw new ChainVerificationError('prev_entry_hash_mismatch', {
        expected: prev,
        actual: entry.prevEntryHash,
        entryId: entry.id,
      })
    }

    const recomputed = computeEntryHash(entry)
    if (recomputed !== entry.entryHash) {
      throw new ChainVerificationError('entry_hash_mismatch', {
        entryId: entry.id,
      })
    }

    const sigOk = schnorr.verify(
      hexToBytes(entry.signature),
      hexToBytes(entry.entryHash),
      hexToBytes(entry.signerPubkey)
    )
    if (!sigOk) {
      throw new ChainVerificationError('signature_invalid', { entryId: entry.id })
    }

    if (!trusted.has(entry.signerPubkey)) {
      throw new ChainVerificationError('signer_not_trusted', {
        pubkey: entry.signerPubkey,
        entryId: entry.id,
      })
    }

    if (entry.payload.type === 'device_add') {
      trusted.add(entry.payload.devicePubkey)
    } else if (entry.payload.type === 'device_revoke') {
      trusted.delete(entry.payload.devicePubkey)
    }

    prev = entry.entryHash
    head = entry
  }

  const effectiveHead = head ?? cachedRow?.headEntry ?? null

  const newRow: ChainCacheRow = {
    hubId,
    lastVerifiedEntryHash: prev,
    lastVerifiedIndex: (cachedRow?.lastVerifiedIndex ?? 0) + entries.length,
    trustedDevicePubkeys: [...trusted],
    headEntry: effectiveHead,
  }
  await cache.put(newRow)

  if (!effectiveHead) throw new ChainVerificationError('empty_chain')
  return effectiveHead
}

/**
 * Clear the IDB-backed chain cache for a given hub. Called from lock /
 * panic-wipe paths and after factor rotations that may invalidate the
 * trust anchor (Tier 3+).
 */
export async function clearChainCache(hubId: string): Promise<void> {
  await idbChainCacheStore.delete(hubId)
}
