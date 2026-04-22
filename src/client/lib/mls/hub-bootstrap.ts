/**
 * MLS hub bootstrap — wires MLS group creation into the hub lifecycle.
 *
 * When an admin creates a new hub, this module:
 * 1. Creates the MLS group locally via core-crypto
 * 2. Generates initial key packages and uploads them to the server
 *
 * MLS bootstrap failure does NOT block hub creation — the hub is usable
 * without MLS and bootstrap can be retried on next load.
 */

import { createDebugLog } from '@/lib/debug-log'
import { logMlsGroupInit } from '../audit-log-client'
import type { CryptoWorkerClient } from '../crypto-worker-client'
import { MlsConversation } from './conversation'
import * as mlsApi from './mls-api-client'
import { toBase64 } from './mls-api-client'

const log = createDebugLog('mls:hub-bootstrap')

/** Number of key packages to pre-generate on group creation. */
const INITIAL_KEY_PACKAGE_COUNT = 100

/**
 * Bootstrap an MLS group for a newly created hub.
 *
 * Call this after the server has created the hub (and its mls_hub_state row).
 * The current user becomes the sole initial member.
 *
 * @returns The MlsConversation instance, or null if bootstrap failed.
 */
export async function bootstrapMlsForNewHub(
  hubId: string,
  worker: CryptoWorkerClient,
  deviceId: string,
  ciphersuite = 1
): Promise<MlsConversation | null> {
  try {
    const conv = await MlsConversation.createGroup(hubId, worker, deviceId)
    log('MLS group created for hub %s', hubId)

    try {
      await logMlsGroupInit({
        hubId,
        groupId: conv.groupIdStr,
        ciphersuite,
        creatorDeviceId: deviceId,
      })
      log('Emitted mls_group_init audit entry for hub %s', hubId)
    } catch (_auditErr) {
      log('Audit emission failed for hub %s (non-fatal)', hubId)
    }

    await uploadKeyPackages(hubId, worker, deviceId)
    log('Uploaded %d initial key packages for hub %s', INITIAL_KEY_PACKAGE_COUNT, hubId)

    return conv
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: genuine failure path, not debug logging
    console.error('[mls:hub-bootstrap] Failed to bootstrap MLS for hub', hubId, err)
    return null
  }
}

/**
 * Check if the current device has MLS group state for a hub.
 *
 * @returns true if local MLS state exists, false otherwise.
 */
export async function hasMlsGroupState(
  hubId: string,
  worker: CryptoWorkerClient
): Promise<boolean> {
  const groupIdStr = `llamenos:hub:${hubId}`
  const epoch = await worker.mlsCurrentEpoch(groupIdStr)
  return epoch !== null
}

/**
 * Generate and upload key packages for a device in a hub.
 */
export async function uploadKeyPackages(
  hubId: string,
  worker: CryptoWorkerClient,
  deviceId: string,
  count = INITIAL_KEY_PACKAGE_COUNT
): Promise<number> {
  const keyPackageBytes = await worker.mlsGenerateKeyPackages(count)

  const keyPackages = await Promise.all(
    keyPackageBytes.map(async (kpBytes) => {
      // Derive a ref from the SHA-256 hash of the key package data
      const hashBuffer = await crypto.subtle.digest('SHA-256', kpBytes.buffer as ArrayBuffer)
      const keyPackageRef = toBase64(new Uint8Array(hashBuffer))
      const keyPackageData = toBase64(kpBytes)
      return { keyPackageRef, keyPackageData }
    })
  )

  const result = await mlsApi.uploadKeyPackages(hubId, deviceId, keyPackages)
  return result.uploaded
}
