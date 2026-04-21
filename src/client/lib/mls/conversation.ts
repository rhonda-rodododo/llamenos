/**
 * MlsConversation — wraps core-crypto group lifecycle for a single hub.
 *
 * Each hub gets exactly one MLS group with a deterministic group ID
 * (`llamenos:hub:<hubId>` as UTF-8 bytes). The class delegates all
 * cryptographic operations to the crypto-worker via RPC and communicates
 * with the server via the MLS API client.
 *
 * This class does NOT handle hub creation bootstrap (Slice 4) or
 * notes/messages cutover (Slices 5+6).
 */

import type { CryptoWorkerClient } from '../crypto-worker-client'
import * as mlsApi from './mls-api-client'
import { fromBase64, toBase64 } from './mls-api-client'
import type { MlsCommitBundle, MlsDecryptResult } from './types'

const GROUP_ID_PREFIX = 'llamenos:hub:'

export class MlsConversation {
  /** The MLS group ID as UTF-8 bytes. */
  readonly groupId: Uint8Array
  /** The MLS group ID as a UTF-8 string. */
  readonly groupIdStr: string

  private constructor(
    readonly hubId: string,
    private readonly worker: CryptoWorkerClient,
    private readonly deviceId: string
  ) {
    this.groupIdStr = `${GROUP_ID_PREFIX}${hubId}`
    this.groupId = new TextEncoder().encode(this.groupIdStr)
  }

  /**
   * Derive the deterministic MLS group ID bytes for a hub.
   */
  static groupIdForHub(hubId: string): Uint8Array {
    return new TextEncoder().encode(`${GROUP_ID_PREFIX}${hubId}`)
  }

  // ---- Group lifecycle ----

  /**
   * Create a new MLS group for a hub and bootstrap it on the server.
   * The creator becomes the sole member. Use `addMembers` to add others.
   */
  static async createGroup(
    hubId: string,
    worker: CryptoWorkerClient,
    deviceId: string
  ): Promise<MlsConversation> {
    const conv = new MlsConversation(hubId, worker, deviceId)
    await worker.mlsCreateGroup(conv.groupIdStr)
    await mlsApi.bootstrapGroup(hubId, deviceId, conv.groupIdStr)
    return conv
  }

  /**
   * Join an existing MLS group via a Welcome message.
   * The hub ID is extracted from the conversation ID returned by core-crypto.
   */
  static async joinViaWelcome(
    welcomeBytes: Uint8Array,
    worker: CryptoWorkerClient,
    deviceId: string
  ): Promise<MlsConversation> {
    const convIdStr = await worker.mlsProcessWelcome(welcomeBytes)
    const hubId = convIdStr.startsWith(GROUP_ID_PREFIX)
      ? convIdStr.slice(GROUP_ID_PREFIX.length)
      : convIdStr
    return new MlsConversation(hubId, worker, deviceId)
  }
  /**
   * Open an existing MLS group for encryption/decryption.
   * Assumes the group was already created or joined in a previous session.
   */
  static open(hubId: string, worker: CryptoWorkerClient, deviceId: string): MlsConversation {
    return new MlsConversation(hubId, worker, deviceId)
  }

  /**
   * Join an existing MLS group via external commit (re-enrollment).
   * Used when the client's KeyPackage was already consumed or for recovery.
   */
  static async joinViaExternalCommit(
    hubId: string,
    groupInfoBytes: Uint8Array,
    worker: CryptoWorkerClient,
    deviceId: string
  ): Promise<MlsConversation> {
    await worker.mlsExternalJoin(groupInfoBytes)
    return new MlsConversation(hubId, worker, deviceId)
  }

  /**
   * Reconstruct an MlsConversation for a hub that already has local state.
   * Does NOT verify the group exists — callers should check `mlsCurrentEpoch` first.
   */
  static fromExisting(
    hubId: string,
    worker: CryptoWorkerClient,
    deviceId: string
  ): MlsConversation {
    return new MlsConversation(hubId, worker, deviceId)
  }

  // ---- Encryption / decryption ----

  /**
   * Encrypt a plaintext message for the group.
   * Returns the MLS ciphertext to send to the server for fan-out.
   */
  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    return this.worker.mlsEncryptMessage(this.groupIdStr, plaintext)
  }

  /**
   * Decrypt an incoming MLS message.
   * For application messages, returns the plaintext and sender ID.
   * For commits/proposals, `message` is undefined and `hasEpochChanged` may be true.
   */
  async decrypt(ciphertext: Uint8Array): Promise<MlsDecryptResult> {
    return this.worker.mlsDecryptMessage(this.groupIdStr, ciphertext)
  }

  // ---- Membership management ----

  /**
   * Add members to the group by their KeyPackages.
   * Produces a Commit + Welcome, submits the Commit to the server,
   * and returns the bundle for the caller to distribute the Welcome.
   */
  async addMembers(keyPackages: Uint8Array[]): Promise<MlsCommitBundle> {
    const bundle = await this.worker.mlsAddMembers(this.groupIdStr, keyPackages)
    const epoch = await this.currentEpoch()
    await mlsApi.submitCommit(
      this.hubId,
      this.deviceId,
      epoch,
      toBase64(bundle.commit),
      bundle.welcome ? toBase64(bundle.welcome) : undefined
    )
    return bundle
  }

  /**
   * Remove members from the group by their client IDs.
   * Produces a Commit, submits it to the server, and returns the bundle.
   */
  async removeMembers(clientIds: string[]): Promise<MlsCommitBundle> {
    const bundle = await this.worker.mlsRemoveMembers(this.groupIdStr, clientIds)
    const epoch = await this.currentEpoch()
    await mlsApi.submitCommit(
      this.hubId,
      this.deviceId,
      epoch,
      toBase64(bundle.commit),
      bundle.welcome ? toBase64(bundle.welcome) : undefined
    )
    return bundle
  }

  /**
   * Process an incoming Commit from another member (fetched from the server).
   * Advances the local epoch. This is a convenience wrapper around `decrypt`
   * for commit messages.
   */
  async processCommit(commitBytes: Uint8Array): Promise<void> {
    await this.worker.mlsDecryptMessage(this.groupIdStr, commitBytes)
  }

  /**
   * Catch up with the server by fetching and processing all commits
   * since a given epoch.
   */
  async catchUp(sinceEpoch?: number): Promise<number> {
    const localEpoch = sinceEpoch ?? (await this.currentEpoch())
    const { commits } = await mlsApi.fetchCommits(this.hubId, localEpoch)
    for (const commit of commits) {
      const commitBytes = fromBase64(commit.commitData)
      await this.processCommit(commitBytes)
    }
    return commits.length
  }

  // ---- Epoch / state ----

  /**
   * Return the current MLS epoch for this group.
   */
  async currentEpoch(): Promise<number> {
    const epoch = await this.worker.mlsCurrentEpoch(this.groupIdStr)
    return epoch ?? 0
  }

  /**
   * Wipe the local MLS group state. Does not affect the server.
   * After calling this, the conversation instance should be discarded.
   */
  async destroy(): Promise<void> {
    await this.worker.mlsWipeGroup(this.groupIdStr)
  }
}
