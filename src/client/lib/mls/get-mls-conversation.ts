import { cryptoWorker } from '@/lib/crypto-worker-client'
import { createDebugLog } from '@/lib/debug-log'
import { generateDeviceKeypair } from '@/lib/device-identity'
import { getDeviceKeypair, putDeviceKeypair } from '@/lib/device-identity-store'
import { MlsConversation } from './conversation'

const log = createDebugLog('mls:get-conversation')

/**
 * Get or create an MlsConversation for a hub.
 *
 * If local MLS group state exists, returns immediately. Otherwise, creates
 * the group locally and attempts server bootstrap. If the server already has
 * the group (409), the local state is still valid for encryption — the
 * server-side group was created during hub creation.
 *
 * This handles the common case of a new browser context (cleared IndexedDB,
 * restored from storageState, etc.) where the user is already a hub member
 * but lacks local MLS state. When IndexedDB was cleared (e.g. Playwright
 * storageState restore), the device keypair is also regenerated on demand.
 */
export async function getMlsConversation(hubId: string): Promise<MlsConversation | null> {
  if (!cryptoWorker) return null

  let keypair = await getDeviceKeypair()
  if (!keypair) {
    // IndexedDB was cleared (new browser context, storageState restore, etc.)
    // — regenerate a device keypair so MLS can proceed.
    keypair = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(keypair)
    log('Regenerated missing device keypair %s', keypair.deviceId)
  }

  const groupIdStr = `llamenos:hub:${hubId}`
  const epoch = await cryptoWorker.mlsCurrentEpoch(groupIdStr)

  if (epoch !== null) {
    return MlsConversation.open(hubId, cryptoWorker, keypair.deviceId)
  }

  // Local state missing — create the group locally and try server bootstrap.
  // Server returns 409 if the group already exists, which is fine.
  try {
    const conv = await MlsConversation.createGroup(hubId, cryptoWorker, keypair.deviceId)
    log('Created local MLS group for hub %s', hubId)
    return conv
  } catch (err) {
    // createGroup calls bootstrapGroup which may 409 if server already
    // has the group. The local group was created before the server call, so
    // check if local state now exists.
    const retryEpoch = await cryptoWorker.mlsCurrentEpoch(groupIdStr)
    if (retryEpoch !== null) {
      log('Local MLS group exists after bootstrap 409 for hub %s', hubId)
      return MlsConversation.open(hubId, cryptoWorker, keypair.deviceId)
    }

    // Genuine failure — MLS not available
    // biome-ignore lint/suspicious/noConsole: genuine failure path
    console.error('[mls:get-conversation] Failed to create MLS group for hub', hubId, err)
    return null
  }
}
