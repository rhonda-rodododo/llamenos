/**
 * MLS commit sync — polling-based catch-up for pending commits.
 *
 * When another admin adds or removes a member, the MLS epoch advances.
 * This module provides a hook that periodically fetches unprocessed
 * commits from the server and applies them to the local MLS group state.
 *
 * Nostr real-time events for MLS are not yet wired, so this uses polling.
 * When Nostr `mls_epoch_advance` events are added, the poll interval can
 * be lengthened and the Nostr handler can trigger an immediate sync.
 */

import { useConfig } from '@/lib/config'
import { cryptoWorker } from '@/lib/crypto-worker-client'
import { createDebugLog } from '@/lib/debug-log'
import { getDeviceKeypair } from '@/lib/device-identity-store'
import { useEffect, useRef } from 'react'
import { getMlsConversation } from './get-mls-conversation'

const log = createDebugLog('mls:commit-sync')

/** Polling interval in ms. 30s balances freshness vs. server load. */
const POLL_INTERVAL_MS = 30_000

/**
 * Sync pending MLS commits for a hub.
 *
 * Fetches all commits since the local epoch and processes them in order.
 * Returns the number of commits processed, or 0 if already up to date.
 */
export async function syncMlsCommits(hubId: string): Promise<number> {
  if (!cryptoWorker) return 0

  const conv = await getMlsConversation(hubId)
  if (!conv) return 0

  const processed = await conv.catchUp()
  if (processed > 0) {
    log('Processed %d pending MLS commits for hub %s', processed, hubId)
  }
  return processed
}

/**
 * React hook that polls for pending MLS commits on a hub.
 *
 * Runs an immediate sync on mount, then polls at `POLL_INTERVAL_MS`.
 * Stops when the component unmounts or the hub changes.
 *
 * @knipignore — MLS commit sync hook; used by the root layout component once it's wired up
 */
export function useMlsCommitSync(): void {
  const { currentHubId } = useConfig()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!currentHubId || !cryptoWorker) return

    const hubId = currentHubId

    async function doSync() {
      try {
        const keypair = await getDeviceKeypair()
        if (!keypair) return
        await syncMlsCommits(hubId)
      } catch (err) {
        log(
          'MLS commit sync failed for hub %s: %s',
          hubId,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // Immediate sync on mount / hub change
    void doSync()

    // Poll every POLL_INTERVAL_MS
    timerRef.current = setInterval(() => {
      void doSync()
    }, POLL_INTERVAL_MS)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [currentHubId])
}
