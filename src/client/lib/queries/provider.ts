/**
 * React Query hooks for telephony/messaging provider health monitoring
 * and system (dependency) health.
 */

import { queryOptions, useQuery } from '@tanstack/react-query'
import {
  getProviderHealth,
  getSystemHealth,
  type ProviderHealthStatus,
  type SystemHealthStatus,
} from '@/lib/api'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// providerHealthOptions
// ---------------------------------------------------------------------------

/**
 * Poll provider health every 15 seconds. staleTime matches the poll interval
 * so health data is always refetched from the server on each cycle.
 */
const providerHealthOptions = () =>
  queryOptions({
    queryKey: queryKeys.provider.health(),
    queryFn: (): Promise<ProviderHealthStatus> => getProviderHealth(),
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

// ---------------------------------------------------------------------------
// useProviderHealth
// ---------------------------------------------------------------------------

export function useProviderHealth() {
  return useQuery(providerHealthOptions())
}

// ---------------------------------------------------------------------------
// systemHealthOptions — poll `/api/health` for DB / storage / relay status
// ---------------------------------------------------------------------------

const systemHealthOptions = () =>
  queryOptions({
    queryKey: queryKeys.provider.system(),
    queryFn: (): Promise<SystemHealthStatus> => getSystemHealth(),
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

export function useSystemHealth() {
  return useQuery(systemHealthOptions())
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { ProviderHealthStatus, SystemHealthStatus }
