/**
 * React Query hooks for audit log resource management.
 *
 * Audit log entries may contain encrypted user names (actorName field).
 * Uses decryptArrayFields with LABEL_USER_PII to decrypt them.
 * Cache is short-lived (60s stale) since audit logs update frequently.
 *
 * Also exposes `useAuditChainIntegrity`, the Tier 0 signed-chain verifier
 * wired against `src/client/lib/audit-chain-verifier.ts`. That hook walks
 * the hub's signed audit chain, validating prevEntryHash linkage, entry
 * hash recomputation, Schnorr signatures, and signer membership in the
 * trust set.
 */

import { listAuditLog, listGlobalAuditLog } from '@/lib/api'
import { ChainVerificationError, verifyAuditChain } from '@/lib/audit-chain-verifier'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import type { AuditLogEntry } from '@shared/schemas'
import type { SignedAuditEntry } from '@shared/schemas/audit-entries'
import type { User } from '@shared/schemas/users'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { queryKeys } from './keys'
import { useUsers } from './users'

// ---------------------------------------------------------------------------
// Filter type (mirrors listAuditLog params)
// ---------------------------------------------------------------------------

export interface AuditLogFilters {
  page?: number
  limit?: number
  actorPubkey?: string
  eventType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

// ---------------------------------------------------------------------------
// auditLogOptions
// ---------------------------------------------------------------------------

export const auditLogOptions = (filters?: AuditLogFilters) =>
  queryOptions({
    queryKey: queryKeys.audit.list(filters),
    queryFn: async () => {
      const { entries, total } = await listAuditLog(filters)
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          entries as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_USER_PII
        )
      }
      return { entries, total }
    },
    staleTime: 60_000,
  })

// ---------------------------------------------------------------------------
// useAuditLog
// ---------------------------------------------------------------------------

export function useAuditLog(filters?: AuditLogFilters) {
  return useQuery(auditLogOptions(filters))
}

// ---------------------------------------------------------------------------
// Global (platform) audit log — super-admin only
// ---------------------------------------------------------------------------
//
// Hits the un-prefixed /audit endpoint which returns rows with hub_id = 'global'
// on the server. A distinct query key from the hub-scoped list() so cache
// writes don't cross-contaminate the two views.

export const globalAuditLogOptions = (filters?: AuditLogFilters) =>
  queryOptions({
    queryKey: queryKeys.audit.globalList(filters),
    queryFn: async () => {
      const { entries, total } = await listGlobalAuditLog(filters)
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          entries as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_USER_PII
        )
      }
      return { entries, total }
    },
    staleTime: 60_000,
  })

export function useGlobalAuditLog(filters?: AuditLogFilters) {
  return useQuery(globalAuditLogOptions(filters))
}

// ---------------------------------------------------------------------------
// Tier 0 signed-chain integrity
// ---------------------------------------------------------------------------

const ADMIN_ROLE_IDS = ['role-admin', 'role-super-admin', 'admin', 'super_admin']

/**
 * Derive the set of pubkeys that should be treated as the trust anchor for a
 * hub's signed audit chain: every user whose global roles or whose hub-scoped
 * roles on `hubId` place them in an administrator role. Exported for testing
 * and for non-React call sites (e.g. boot-time baseline verification).
 */
export function deriveAuditTrustAnchorPubkeys(
  users: Pick<User, 'pubkey' | 'roles' | 'hubRoles'>[],
  hubId: string
): Set<string> {
  const set = new Set<string>()
  for (const u of users) {
    const globalAdmin = u.roles.some((r) => ADMIN_ROLE_IDS.includes(r))
    const hubAdmin = (u.hubRoles ?? []).some(
      (hr) => hr.hubId === hubId && hr.roleIds.some((r) => ADMIN_ROLE_IDS.includes(r))
    )
    if (globalAdmin || hubAdmin) set.add(u.pubkey)
  }
  return set
}

export type ChainIntegrityStatus =
  | { state: 'verified'; head: SignedAuditEntry | null }
  | { state: 'tampered'; error: ChainVerificationError }

/**
 * Walk and verify the Tier 0 signed audit chain for `hubId`. The query only
 * runs once the user list has loaded AND at least one trust-anchor pubkey is
 * known — otherwise verification would trip `signer_not_trusted` against an
 * empty set.
 *
 * Chain-verification failures (tamper detection) are surfaced as a
 * `{ state: 'tampered' }` result rather than thrown, so the UI can render a
 * red banner without React Query retrying. Transport errors (network, 500)
 * are re-thrown so React Query's `error`/`isError` drive a generic failure
 * UI.
 */
export function useAuditChainIntegrity(hubId: string | undefined) {
  const { data: users = [], isLoading: usersLoading } = useUsers()

  const trustAnchor =
    hubId !== undefined ? deriveAuditTrustAnchorPubkeys(users, hubId) : new Set<string>()

  return useQuery({
    queryKey: queryKeys.audit.chainIntegrity(hubId),
    queryFn: async (): Promise<ChainIntegrityStatus> => {
      if (hubId === undefined) {
        throw new Error('useAuditChainIntegrity queryFn ran without a hubId')
      }
      try {
        const head = await verifyAuditChain(hubId, trustAnchor)
        return { state: 'verified', head }
      } catch (err) {
        if (err instanceof ChainVerificationError) {
          return { state: 'tampered', error: err }
        }
        throw err
      }
    },
    enabled: hubId !== undefined && !usersLoading && trustAnchor.size > 0,
    staleTime: 60_000,
    retry: false,
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { AuditLogEntry }
