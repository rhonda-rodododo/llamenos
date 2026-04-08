/**
 * React Query hooks for audit log resource management.
 *
 * Audit log entries may contain encrypted user names (actorName field).
 * Uses decryptArrayFields with LABEL_USER_PII to decrypt them.
 * Cache is short-lived (60s stale) since audit logs update frequently.
 */

import { listAuditLog, listGlobalAuditLog } from '@/lib/api'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import type { AuditLogEntry } from '@shared/schemas'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { queryKeys } from './keys'

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
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { AuditLogEntry }
