import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { UnsignedAuditEntry } from '../schemas/audit-entries'
import { canonicalize } from './canonical-json'

export function computeEntryHash(entry: UnsignedAuditEntry): string {
  const canonical = canonicalize({
    v: 1,
    id: entry.id,
    hubId: entry.hubId,
    payload: entry.payload,
    prevEntryHash: entry.prevEntryHash,
    createdAt: entry.createdAt,
    signerDeviceId: entry.signerDeviceId,
    signerPubkey: entry.signerPubkey,
  })
  return bytesToHex(sha256(utf8ToBytes(canonical)))
}
