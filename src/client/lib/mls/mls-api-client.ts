/**
 * MLS API client — typed wrappers around the Slice 1 server MLS routes.
 *
 * Uses the shared `request` helper from `api/client.ts` for auth headers,
 * credentials, and error handling.
 */

import type {
  MlsBootstrapResponse,
  MlsCommitResponse,
  MlsCurrentEpochResponse,
  MlsFetchCommitsResponse,
  MlsFetchKeyPackageResponse,
  MlsKeyPackageCountsResponse,
  MlsPurgeEpochResponse,
  MlsUploadKeyPackagesResponse,
} from '@shared/schemas/mls'
import { request } from '../api/client'

// ---- Key packages ----

/**
 * Upload serialized KeyPackages for a device.
 *
 * @param hubId - Hub the key packages belong to
 * @param deviceId - Uploader's device ID
 * @param keyPackages - Array of `{ keyPackageRef, keyPackageData }` both base64-encoded
 */
export function uploadKeyPackages(
  hubId: string,
  deviceId: string,
  keyPackages: Array<{ keyPackageRef: string; keyPackageData: string }>
): Promise<MlsUploadKeyPackagesResponse> {
  return request<MlsUploadKeyPackagesResponse>(
    `/mls/hub/${encodeURIComponent(hubId)}/key-packages`,
    {
      method: 'POST',
      body: JSON.stringify({ deviceId, keyPackages }),
    }
  )
}

/**
 * Fetch one unconsumed KeyPackage for a device (atomically marks it consumed).
 */
export function fetchKeyPackage(
  hubId: string,
  deviceId: string
): Promise<MlsFetchKeyPackageResponse> {
  return request<MlsFetchKeyPackageResponse>(
    `/mls/hub/${encodeURIComponent(hubId)}/key-packages/${encodeURIComponent(deviceId)}`
  )
}

/**
 * Get unconsumed key package counts per device for a hub.
 */
export function fetchKeyPackageCounts(hubId: string): Promise<MlsKeyPackageCountsResponse> {
  return request<MlsKeyPackageCountsResponse>(
    `/mls/hub/${encodeURIComponent(hubId)}/key-packages/counts`
  )
}

// ---- Commits ----

/**
 * Submit an MLS commit to the server. Returns 409 on epoch collision.
 *
 * @param hubId - Hub the commit belongs to
 * @param deviceId - Committer's device ID
 * @param epoch - The epoch number this commit produces
 * @param commitData - Base64-encoded TLS-serialized Commit
 * @param welcomeData - Base64-encoded Welcome for newly added members (optional)
 */
export function submitCommit(
  hubId: string,
  deviceId: string,
  epoch: number,
  commitData: string,
  welcomeData?: string
): Promise<MlsCommitResponse> {
  return request<MlsCommitResponse>(`/mls/hub/${encodeURIComponent(hubId)}/commits`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, epoch, commitData, welcomeData: welcomeData ?? null }),
  })
}

/**
 * Fetch all commits since a given epoch for client catch-up.
 */
export function fetchCommits(hubId: string, sinceEpoch?: number): Promise<MlsFetchCommitsResponse> {
  const params = sinceEpoch !== undefined ? `?sinceEpoch=${sinceEpoch}` : ''
  return request<MlsFetchCommitsResponse>(`/mls/hub/${encodeURIComponent(hubId)}/commits${params}`)
}

// ---- Group state ----

/**
 * Get the current MLS epoch and group state for a hub.
 */
export function fetchCurrentEpoch(hubId: string): Promise<MlsCurrentEpochResponse> {
  return request<MlsCurrentEpochResponse>(`/mls/hub/${encodeURIComponent(hubId)}/epoch`)
}

/**
 * Bootstrap the MLS group for a hub (admin-only, called once on hub creation).
 */
export function bootstrapGroup(
  hubId: string,
  deviceId: string,
  groupId: string
): Promise<MlsBootstrapResponse> {
  return request<MlsBootstrapResponse>(`/mls/hub/${encodeURIComponent(hubId)}/bootstrap`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, groupId }),
  })
}

/**
 * Purge old epoch commits (admin-only). Keeps the 5 most recent epochs.
 */
export function purgeOldEpochs(hubId: string): Promise<MlsPurgeEpochResponse> {
  return request<MlsPurgeEpochResponse>(`/mls/hub/${encodeURIComponent(hubId)}/commits/purge`, {
    method: 'POST',
  })
}

// ---- Utility ----

/** Encode a Uint8Array to base64 for server transport. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Decode a base64 string to Uint8Array. */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
