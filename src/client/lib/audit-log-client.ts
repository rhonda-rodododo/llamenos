import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import type {
  AuditEntryPayload,
  SignedAuditEntry,
  UnsignedAuditEntry,
} from '@shared/schemas/audit-entries'
import { API_BASE, getAuthHeaders } from './api/client'
import { cryptoWorker } from './crypto-worker-client'

/**
 * Signs an {@link UnsignedAuditEntry}, producing the only valid
 * {@link SignedAuditEntry}. This is the sole transition between the two
 * types — no other code path may construct a `SignedAuditEntry` from an
 * `UnsignedAuditEntry`.
 *
 * @knipignore — audit log signing scaffolding; called from audit entry submission UI (not yet built)
 */
export async function signAuditEntry(unsigned: UnsignedAuditEntry): Promise<SignedAuditEntry> {
  const entryHash = computeEntryHash(unsigned)
  const signature = await cryptoWorker.signAuditEntry(entryHash)
  return { ...unsigned, entryHash, signature }
}

export async function buildSignedAuditEntry(params: {
  hubId: string
  payload: AuditEntryPayload
  prevEntryHash: string | null
  signerDeviceId: string
}): Promise<SignedAuditEntry> {
  const pubkey = await cryptoWorker.getPublicKey()
  if (!pubkey) throw new Error('Crypto worker not unlocked')

  const unsigned: UnsignedAuditEntry = {
    id: crypto.randomUUID(),
    hubId: params.hubId,
    payload: params.payload,
    prevEntryHash: params.prevEntryHash,
    createdAt: new Date().toISOString(),
    signerDeviceId: params.signerDeviceId,
    signerPubkey: pubkey,
  }
  return signAuditEntry(unsigned)
}

async function appendSignedAuditEntry(hubId: string, entry: SignedAuditEntry): Promise<void> {
  const res = await fetch(`${API_BASE}/hubs/${encodeURIComponent(hubId)}/audit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(entry),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Append audit entry failed: ${res.status}`)
}

/**
 * Fetch the current chain head entryHash for a hub. Returns `null` when the
 * chain is empty. Callers use the returned value as `prevEntryHash` when
 * constructing the next entry via {@link buildSignedAuditEntry}.
 *
 * This is intentionally lightweight — it hits `GET /hubs/:hubId/audit/head`
 * and only reads back a 64-char hex hash, so it can be called in the hot path
 * of any admin mutation that needs to append an audit entry without pulling
 * the full chain.
 */
export async function fetchAuditHead(hubId: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/hubs/${encodeURIComponent(hubId)}/audit/head`, {
    method: 'GET',
    headers: { ...getAuthHeaders() },
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Fetch audit head failed: ${res.status}`)
  const body = (await res.json()) as { entryHash: string | null }
  return body.entryHash ?? null
}

// ---- Tier 6: MLS group lifecycle helpers ----

/**
 * Emit an `mls_group_init` audit entry.
 * Call after successfully creating an MLS group for a hub.
 */
export async function logMlsGroupInit(params: {
  hubId: string
  groupId: string
  ciphersuite: number
  creatorDeviceId: string
}): Promise<SignedAuditEntry> {
  const prevEntryHash = await fetchAuditHead(params.hubId)
  const entry = await buildSignedAuditEntry({
    hubId: params.hubId,
    payload: {
      type: 'mls_group_init',
      hubId: params.hubId,
      groupId: params.groupId,
      ciphersuite: params.ciphersuite,
      creatorDeviceId: params.creatorDeviceId,
      epoch: 0,
    },
    prevEntryHash,
    signerDeviceId: params.creatorDeviceId,
  })
  await appendSignedAuditEntry(params.hubId, entry)
  return entry
}

/**
 * Emit an `mls_members_added` audit entry.
 * Call after successfully adding members to an MLS group.
 */
export async function logMlsMembersAdded(params: {
  hubId: string
  addedDeviceIds: string[]
  epoch: number
  committerId: string
}): Promise<SignedAuditEntry> {
  const prevEntryHash = await fetchAuditHead(params.hubId)
  const entry = await buildSignedAuditEntry({
    hubId: params.hubId,
    payload: {
      type: 'mls_members_added',
      hubId: params.hubId,
      addedDeviceIds: params.addedDeviceIds,
      epoch: params.epoch,
      committerId: params.committerId,
    },
    prevEntryHash,
    signerDeviceId: params.committerId,
  })
  await appendSignedAuditEntry(params.hubId, entry)
  return entry
}

/**
 * Emit an `mls_members_removed` audit entry.
 * Call after successfully removing members from an MLS group.
 */
export async function logMlsMembersRemoved(params: {
  hubId: string
  removedDeviceIds: string[]
  epoch: number
  committerId: string
}): Promise<SignedAuditEntry> {
  const prevEntryHash = await fetchAuditHead(params.hubId)
  const entry = await buildSignedAuditEntry({
    hubId: params.hubId,
    payload: {
      type: 'mls_members_removed',
      hubId: params.hubId,
      removedDeviceIds: params.removedDeviceIds,
      epoch: params.epoch,
      committerId: params.committerId,
    },
    prevEntryHash,
    signerDeviceId: params.committerId,
  })
  await appendSignedAuditEntry(params.hubId, entry)
  return entry
}

/**
 * Emit an `mls_path_update` audit entry.
 * Call after a self-update (path refresh) in an MLS group.
 */
export async function logMlsPathUpdate(params: {
  hubId: string
  epoch: number
  updaterId: string
}): Promise<SignedAuditEntry> {
  const prevEntryHash = await fetchAuditHead(params.hubId)
  const entry = await buildSignedAuditEntry({
    hubId: params.hubId,
    payload: {
      type: 'mls_path_update',
      hubId: params.hubId,
      epoch: params.epoch,
      updaterId: params.updaterId,
    },
    prevEntryHash,
    signerDeviceId: params.updaterId,
  })
  await appendSignedAuditEntry(params.hubId, entry)
  return entry
}

/**
 * Emit an `mls_epoch_purge` audit entry.
 * Call after purging old epoch commits from the server.
 */
export async function logMlsEpochPurge(params: {
  hubId: string
  purgedEpochRange: string
  reason: string
  signerDeviceId: string
}): Promise<SignedAuditEntry> {
  const prevEntryHash = await fetchAuditHead(params.hubId)
  const entry = await buildSignedAuditEntry({
    hubId: params.hubId,
    payload: {
      type: 'mls_epoch_purge',
      hubId: params.hubId,
      purgedEpochRange: params.purgedEpochRange,
      reason: params.reason,
    },
    prevEntryHash,
    signerDeviceId: params.signerDeviceId,
  })
  await appendSignedAuditEntry(params.hubId, entry)
  return entry
}

/**
 * Emit an `mls_ciphersuite_upgrade_planned` audit entry.
 * Call when scheduling a ciphersuite upgrade for an MLS group.
 */
export async function logMlsCiphersuiteUpgradePlanned(params: {
  hubId: string
  fromCs: number
  toCs: number
  targetDate: string
  signerDeviceId: string
}): Promise<SignedAuditEntry> {
  const prevEntryHash = await fetchAuditHead(params.hubId)
  const entry = await buildSignedAuditEntry({
    hubId: params.hubId,
    payload: {
      type: 'mls_ciphersuite_upgrade_planned',
      hubId: params.hubId,
      fromCs: params.fromCs,
      toCs: params.toCs,
      targetDate: params.targetDate,
    },
    prevEntryHash,
    signerDeviceId: params.signerDeviceId,
  })
  await appendSignedAuditEntry(params.hubId, entry)
  return entry
}

/**
 * Emit an `mls_ciphersuite_upgrade_completed` audit entry.
 * Call after a ciphersuite upgrade has been applied to an MLS group.
 */
export async function logMlsCiphersuiteUpgradeCompleted(params: {
  hubId: string
  fromCs: number
  toCs: number
  epoch: number
  signerDeviceId: string
}): Promise<SignedAuditEntry> {
  const prevEntryHash = await fetchAuditHead(params.hubId)
  const entry = await buildSignedAuditEntry({
    hubId: params.hubId,
    payload: {
      type: 'mls_ciphersuite_upgrade_completed',
      hubId: params.hubId,
      fromCs: params.fromCs,
      toCs: params.toCs,
      epoch: params.epoch,
    },
    prevEntryHash,
    signerDeviceId: params.signerDeviceId,
  })
  await appendSignedAuditEntry(params.hubId, entry)
  return entry
}
