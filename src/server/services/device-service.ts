/**
 * DeviceService — Tier 3 per-device CRUD backed by the `user_devices` and
 * `user_puk_envelopes` Drizzle tables.
 *
 * Provides signing-pubkey lookups used by the audit chain's signer resolution,
 * device registration/revocation (called after sigchain entries are verified),
 * and PUK envelope storage for multi-device key distribution.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db'
import { userDevices, userPukEnvelopes } from '../db/schema'

// ---- types ----

export interface DeviceRow {
  deviceId: string
  userId: string
  signingPubkey: string
  encryptionPubkey: string
  encryptedDisplayName: string
  addedByDeviceId: string | null
  addedSigchainEntryId: string
  revokedAt: Date | null
  revokedBySigchainEntryId: string | null
  revokedReason: string | null
  createdAt: Date
  lastSeenAt: Date
}

export interface RegisterDeviceParams {
  deviceId: string
  userId: string
  signingPubkey: string
  encryptionPubkey: string
  encryptedDisplayName: string
  addedByDeviceId?: string | null
  addedSigchainEntryId: string
}

export interface RevokeDeviceParams {
  deviceId: string
  revokedBySigchainEntryId: string
  revokedReason?: string
}

export interface StorePukEnvelopeParams {
  id: string
  userId: string
  deviceId: string
  generation: number
  envelope: string
  sigchainEntryId: string
}

// ---- service ----

export class DeviceService {
  constructor(private readonly db: Database) {}

  /** Lookup a device by signing pubkey — returns the row or null. */
  async findDeviceBySigningPubkey(pubkey: string): Promise<DeviceRow | null> {
    const rows = await this.db
      .select()
      .from(userDevices)
      .where(eq(userDevices.signingPubkey, pubkey))
      .limit(1)
    return rows[0] ?? null
  }

  /** Lookup a device by deviceId. */
  async findDeviceById(deviceId: string): Promise<DeviceRow | null> {
    const rows = await this.db
      .select()
      .from(userDevices)
      .where(eq(userDevices.deviceId, deviceId))
      .limit(1)
    return rows[0] ?? null
  }

  /** List all active (non-revoked) devices for a user. */
  async listActiveDevices(userId: string): Promise<DeviceRow[]> {
    return this.db
      .select()
      .from(userDevices)
      .where(and(eq(userDevices.userId, userId), isNull(userDevices.revokedAt)))
  }

  /** Register a new device (called after sigchain device_add entry is verified). */
  async registerDevice(params: RegisterDeviceParams): Promise<void> {
    await this.db.insert(userDevices).values({
      deviceId: params.deviceId,
      userId: params.userId,
      signingPubkey: params.signingPubkey,
      encryptionPubkey: params.encryptionPubkey,
      encryptedDisplayName: params.encryptedDisplayName,
      addedByDeviceId: params.addedByDeviceId ?? null,
      addedSigchainEntryId: params.addedSigchainEntryId,
    })
  }

  /** Revoke a device (called after sigchain device_remove entry is verified). */
  async revokeDevice(params: RevokeDeviceParams): Promise<void> {
    await this.db
      .update(userDevices)
      .set({
        revokedAt: new Date(),
        revokedBySigchainEntryId: params.revokedBySigchainEntryId,
        revokedReason: params.revokedReason ?? null,
      })
      .where(eq(userDevices.deviceId, params.deviceId))
  }

  /** Store a PUK envelope for a device at a given generation. */
  async storePukEnvelope(params: StorePukEnvelopeParams): Promise<void> {
    await this.db.insert(userPukEnvelopes).values({
      id: params.id,
      userId: params.userId,
      deviceId: params.deviceId,
      generation: params.generation,
      envelope: params.envelope,
      sigchainEntryId: params.sigchainEntryId,
    })
  }

  /** Get PUK envelope for a device at a specific generation. */
  async getPukEnvelope(deviceId: string, generation: number): Promise<string | null> {
    const rows = await this.db
      .select({ envelope: userPukEnvelopes.envelope })
      .from(userPukEnvelopes)
      .where(
        and(eq(userPukEnvelopes.deviceId, deviceId), eq(userPukEnvelopes.generation, generation))
      )
      .limit(1)
    return rows[0]?.envelope ?? null
  }
}
