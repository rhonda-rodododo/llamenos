/**
 * HubKeyService — Tier 3 per-device hub key envelope management.
 *
 * Manages HPKE-wrapped hub key envelopes in the `hub_key_envelopes` table and
 * generation tracking in `hub_ptk_generations`. Supports initial issuance,
 * per-device fetch, CLKR rotation, and revocation cleanup.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import type { Database } from '../db'
import { hubKeyEnvelopes, hubPtkGenerations } from '../db/schema'

// ---- types ----

export interface HubKeyEnvelopeInput {
  deviceId: string
  userId: string
  envelope: string
}

export interface IssueInitialHubKeyEnvelopesParams {
  hubId: string
  generation: number
  envelopes: HubKeyEnvelopeInput[]
  sigchainEntryId: string
}

export interface RotateHubParams {
  hubId: string
  newGeneration: number
  oldGenWrappedUnderNew: string
  envelopes: HubKeyEnvelopeInput[]
  sigchainEntryId: string
}

export interface HubKeyEnvelopeResult {
  envelope: string
  generation: number
}

export interface GenerationChainEntry {
  generation: number
  oldGenWrappedUnderNew: string | null
}

// ---- service ----

export class HubKeyService {
  constructor(private readonly db: Database) {}

  /**
   * Issue initial hub key envelopes for a hub — one per device per member.
   * Also creates the initial hub_ptk_generations row at the given generation.
   */
  async issueInitialHubKeyEnvelopes(params: IssueInitialHubKeyEnvelopesParams): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Create the initial generation row
      await tx.insert(hubPtkGenerations).values({
        id: crypto.randomUUID(),
        hubId: params.hubId,
        generation: params.generation,
        oldGenWrappedUnderNew: null,
        rotatedBySigchainEntryId: params.sigchainEntryId,
      })

      // Insert all device envelopes
      if (params.envelopes.length > 0) {
        await tx.insert(hubKeyEnvelopes).values(
          params.envelopes.map((env) => ({
            id: crypto.randomUUID(),
            hubId: params.hubId,
            generation: params.generation,
            deviceId: env.deviceId,
            userId: env.userId,
            envelope: env.envelope,
            sigchainEntryId: params.sigchainEntryId,
          }))
        )
      }
    })
  }

  /**
   * Get the current-generation hub key envelope for a specific device in a hub.
   * Returns the envelope with the highest generation, or null if none exists.
   */
  async getHubKeyEnvelopeForDevice(
    deviceId: string,
    hubId: string
  ): Promise<HubKeyEnvelopeResult | null> {
    const rows = await this.db
      .select({
        envelope: hubKeyEnvelopes.envelope,
        generation: hubKeyEnvelopes.generation,
      })
      .from(hubKeyEnvelopes)
      .where(and(eq(hubKeyEnvelopes.deviceId, deviceId), eq(hubKeyEnvelopes.hubId, hubId)))
      .orderBy(desc(hubKeyEnvelopes.generation))
      .limit(1)
    return rows[0] ?? null
  }

  /**
   * Get the current (highest) generation number for a hub.
   * Returns null if no generations exist.
   */
  async getCurrentGeneration(hubId: string): Promise<number | null> {
    const rows = await this.db
      .select({ generation: hubPtkGenerations.generation })
      .from(hubPtkGenerations)
      .where(eq(hubPtkGenerations.hubId, hubId))
      .orderBy(desc(hubPtkGenerations.generation))
      .limit(1)
    return rows[0]?.generation ?? null
  }

  /**
   * Rotate the hub key (CLKR). Atomically creates a new generation row
   * with the old-gen-wrapped-under-new blob and inserts new envelopes for
   * all remaining devices.
   */
  async rotateHub(params: RotateHubParams): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Insert new generation row with the wrapping blob
      await tx.insert(hubPtkGenerations).values({
        id: crypto.randomUUID(),
        hubId: params.hubId,
        generation: params.newGeneration,
        oldGenWrappedUnderNew: params.oldGenWrappedUnderNew,
        rotatedBySigchainEntryId: params.sigchainEntryId,
      })

      // Insert new envelopes for all remaining devices
      if (params.envelopes.length > 0) {
        await tx.insert(hubKeyEnvelopes).values(
          params.envelopes.map((env) => ({
            id: crypto.randomUUID(),
            hubId: params.hubId,
            generation: params.newGeneration,
            deviceId: env.deviceId,
            userId: env.userId,
            envelope: env.envelope,
            sigchainEntryId: params.sigchainEntryId,
          }))
        )
      }
    })
  }

  /**
   * Fetch the oldGenWrappedUnderNew blobs for a range of generations.
   * Used by clients to walk the CLKR chain and derive older keys.
   * Returns entries ordered by generation DESC.
   */
  async getGenerationChain(
    hubId: string,
    fromGen: number,
    toGen: number
  ): Promise<GenerationChainEntry[]> {
    const rows = await this.db
      .select({
        generation: hubPtkGenerations.generation,
        oldGenWrappedUnderNew: hubPtkGenerations.oldGenWrappedUnderNew,
      })
      .from(hubPtkGenerations)
      .where(
        and(
          eq(hubPtkGenerations.hubId, hubId),
          gte(hubPtkGenerations.generation, fromGen),
          lte(hubPtkGenerations.generation, toGen)
        )
      )
      .orderBy(desc(hubPtkGenerations.generation))
    return rows
  }

  /**
   * Remove all hub key envelopes for a specific device in a hub.
   * Called during device revocation before hub key rotation.
   */
  async removeDeviceEnvelopes(deviceId: string, hubId: string): Promise<void> {
    await this.db
      .delete(hubKeyEnvelopes)
      .where(and(eq(hubKeyEnvelopes.deviceId, deviceId), eq(hubKeyEnvelopes.hubId, hubId)))
  }

  /**
   * List all hub IDs that have envelopes for a given device.
   * Used by the revoke worker to determine which hubs need rotation.
   */
  async getHubsWithDeviceEnvelopes(deviceId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ hubId: hubKeyEnvelopes.hubId })
      .from(hubKeyEnvelopes)
      .where(eq(hubKeyEnvelopes.deviceId, deviceId))
    return rows.map((r) => r.hubId)
  }
}
