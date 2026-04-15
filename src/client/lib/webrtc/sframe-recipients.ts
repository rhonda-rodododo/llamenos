/**
 * Resolve call participants to per-device HPKE recipients.
 *
 * Post-Tier-3 (device-aware): one entry per device with its own HPKE pubkey.
 * Pre-Tier-3 fallback: one entry per user, keyed by the user's identity pubkey.
 * The `deviceId` field is used as the envelope recipient key in the key-event
 * schema — so for pre-Tier-3 users we set `deviceId = userId`. Callers that
 * pass plain (non-hex) userIds must hash them to hex beforehand; this helper
 * does NOT perform that transformation and will produce schema-invalid
 * deviceIds in that case. That hashing is the caller's responsibility.
 */
export interface UserCallRecipient {
  userId: string
  identityPublicKey: CryptoKey
  /** Present post-Tier-3; empty or undefined pre-Tier-3. */
  devices?: Array<{ deviceId: string; publicKey: CryptoKey }>
}

interface ResolvedRecipient {
  deviceId: string
  publicKey: CryptoKey
}

export function resolveCallRecipients(users: UserCallRecipient[]): ResolvedRecipient[] {
  if (users.length === 0) throw new Error('at least one participant required')
  const out: ResolvedRecipient[] = []
  for (const u of users) {
    if (u.devices && u.devices.length > 0) {
      for (const d of u.devices) {
        out.push({ deviceId: d.deviceId, publicKey: d.publicKey })
      }
    } else {
      out.push({ deviceId: u.userId, publicKey: u.identityPublicKey })
    }
  }
  return out
}
