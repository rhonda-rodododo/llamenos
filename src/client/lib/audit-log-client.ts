import { computeEntryHash } from '@shared/lib/audit-entry-hash'
import type { AuditEntryPayload, SignedAuditEntry } from '@shared/schemas/audit-entries'
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

export async function appendSignedAuditEntry(
  hubId: string,
  entry: SignedAuditEntry
): Promise<void> {
  const res = await fetch(`/api/hubs/${encodeURIComponent(hubId)}/audit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!res.ok) throw new Error(`Append audit entry failed: ${res.status}`)
}
