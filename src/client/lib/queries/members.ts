/**
 * React Query hooks for hub member management with MLS epoch advances.
 *
 * When an admin adds or removes a hub member, the MLS group epoch advances
 * so excluded members can't decrypt future content. These mutations
 * coordinate the server-side member change with client-side MLS operations.
 */

import { addHubMember, removeHubMember } from '@/lib/api'
import { logMlsMembersAdded, logMlsMembersRemoved } from '@/lib/audit-log-client'
import { cryptoWorker } from '@/lib/crypto-worker-client'
import { createDebugLog } from '@/lib/debug-log'
import { getDeviceKeypair } from '@/lib/device-identity-store'
import { getMlsConversation } from '@/lib/mls/get-mls-conversation'
import * as mlsApi from '@/lib/mls/mls-api-client'
import { fromBase64 } from '@/lib/mls/mls-api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

const log = createDebugLog('llamenos:members')

// ---------------------------------------------------------------------------
// useAddHubMember
// ---------------------------------------------------------------------------

/**
 * Add a member to a hub, then advance the MLS epoch.
 *
 * Flow:
 * 1. Server confirms member addition (role assignment)
 * 2. Fetch new member's key packages
 * 3. MLS addMembers → Commit + Welcome
 * 4. Submit Commit to server (epoch advance)
 * 5. Store Welcome for the new member's device
 * 6. Emit mls_members_added audit entry
 */
export function useAddHubMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      hubId,
      pubkey,
      roleIds,
      targetDeviceId,
    }: {
      hubId: string
      pubkey: string
      roleIds: string[]
      /** Device ID of the member being added (for key package fetch + Welcome delivery). */
      targetDeviceId?: string
    }) => {
      // 1. Server-side member addition
      await addHubMember(hubId, pubkey, roleIds)

      // 2-6. MLS epoch advance (non-fatal — member is added even if MLS fails)
      if (cryptoWorker && targetDeviceId) {
        try {
          await advanceMlsEpochForAdd(hubId, targetDeviceId)
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: genuine failure path
          console.error('[members] MLS epoch advance failed on add', { hubId, err })
        }
      }

      return { ok: true as const }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useRemoveHubMember
// ---------------------------------------------------------------------------

/**
 * Remove a member from a hub, then advance the MLS epoch.
 *
 * Flow:
 * 1. Server confirms member removal
 * 2. MLS removeMembers → Commit
 * 3. Submit Commit to server (epoch advance)
 * 4. Emit mls_members_removed audit entry
 */
export function useRemoveHubMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      hubId,
      pubkey,
      targetClientIds,
    }: {
      hubId: string
      pubkey: string
      /** MLS client IDs of the removed member's devices (format: "userId:deviceId"). */
      targetClientIds?: string[]
    }) => {
      // 1. Server-side member removal
      await removeHubMember(hubId, pubkey)

      // 2-4. MLS epoch advance (non-fatal — member is removed even if MLS fails)
      if (cryptoWorker && targetClientIds?.length) {
        try {
          await advanceMlsEpochForRemove(hubId, targetClientIds)
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: genuine failure path
          console.error('[members] MLS epoch advance failed on remove', { hubId, err })
        }
      }

      return { ok: true as const }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

// ---------------------------------------------------------------------------
// MLS epoch advance helpers
// ---------------------------------------------------------------------------

async function advanceMlsEpochForAdd(hubId: string, targetDeviceId: string): Promise<void> {
  const conv = await getMlsConversation(hubId)
  if (!conv) return

  const keypair = await getDeviceKeypair()
  if (!keypair) return

  // Fetch one unconsumed key package for the new member's device
  let keyPackageData: string
  try {
    const kpResponse = await mlsApi.fetchKeyPackage(hubId, targetDeviceId)
    keyPackageData = kpResponse.keyPackageData
  } catch {
    log('No key packages available for device %s — skipping MLS add', targetDeviceId)
    return
  }

  const keyPackageBytes = fromBase64(keyPackageData)

  // addMembers produces a Commit + Welcome, submits the Commit (with Welcome)
  // to the server via mlsApi.submitCommit. The new device fetches the Welcome
  // alongside the commit from GET /mls/hub/:hubId/commits.
  await conv.addMembers([keyPackageBytes])

  // Emit audit entry
  const epoch = await conv.currentEpoch()
  try {
    await logMlsMembersAdded({
      hubId,
      addedDeviceIds: [targetDeviceId],
      epoch,
      committerId: keypair.deviceId,
    })
  } catch {
    log('Audit emission failed for mls_members_added (non-fatal)')
  }

  log('MLS epoch advanced to %d after adding device %s to hub %s', epoch, targetDeviceId, hubId)
}

async function advanceMlsEpochForRemove(hubId: string, clientIds: string[]): Promise<void> {
  const conv = await getMlsConversation(hubId)
  if (!conv) return

  const keypair = await getDeviceKeypair()
  if (!keypair) return

  await conv.removeMembers(clientIds)

  // Emit audit entry
  const epoch = await conv.currentEpoch()
  try {
    await logMlsMembersRemoved({
      hubId,
      removedDeviceIds: clientIds,
      epoch,
      committerId: keypair.deviceId,
    })
  } catch {
    log('Audit emission failed for mls_members_removed (non-fatal)')
  }

  log(
    'MLS epoch advanced to %d after removing %d devices from hub %s',
    epoch,
    clientIds.length,
    hubId
  )
}
