import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import type { AuditEntryPayload, SignedAuditEntry } from '@shared/schemas/audit-entries'
import { API_BASE, getAuthHeaders } from './api/client'
import { cryptoWorker } from './crypto-worker-client'

export async function buildSignedAuditEntry(params: {
  hubId: string
  payload: AuditEntryPayload
  prevEntryHash: string | null
  signerDeviceId: string
}): Promise<SignedAuditEntry> {
  const pubkey = await cryptoWorker.getPublicKey()
  if (!pubkey) throw new Error('Crypto worker not unlocked')

  const unsigned = {
    id: crypto.randomUUID(),
    hubId: params.hubId,
    payload: params.payload,
    prevEntryHash: params.prevEntryHash,
    createdAt: new Date().toISOString(),
    signerDeviceId: params.signerDeviceId,
    signerPubkey: pubkey,
  }
  const entryHash = computeEntryHash(unsigned)
  const signature = await cryptoWorker.signAuditEntry(entryHash)
  return { ...unsigned, entryHash, signature }
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
