/**
 * React Query hooks for dashboard analytics.
 *
 * All analytics queries are lazy-loaded by default (enabled=false) so they
 * only fire when the analytics section is expanded. staleTime is 5 minutes.
 */

import {
  type CallHourBucket,
  type CallVolumeDay,
  type UserStatEntry,
  getCallAnalytics,
  getCallHoursAnalytics,
  getGlobalCallAnalytics,
  getGlobalCallHoursAnalytics,
  getGlobalUserStats,
  getUserStats,
} from '@/lib/api'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { queryKeys } from './keys'

const STALE_5_MIN = 5 * 60_000

// ---------------------------------------------------------------------------
// callAnalyticsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch call volume data for the given number of days.
 * Pass enabled=false to defer loading (e.g. until analytics panel opens).
 */
const callAnalyticsOptions = (days: 7 | 30 = 7, enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.callVolume(days),
    queryFn: async (): Promise<CallVolumeDay[]> => {
      const res = await getCallAnalytics(days)
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

// ---------------------------------------------------------------------------
// useCallAnalytics
// ---------------------------------------------------------------------------

export function useCallAnalytics(days: 7 | 30 = 7, enabled = true) {
  return useQuery(callAnalyticsOptions(days, enabled))
}

// ---------------------------------------------------------------------------
// callHoursAnalyticsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch peak-hours distribution data.
 * Pass enabled=false to defer loading.
 */
const callHoursAnalyticsOptions = (enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.callHours(),
    queryFn: async (): Promise<CallHourBucket[]> => {
      const res = await getCallHoursAnalytics()
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

// ---------------------------------------------------------------------------
// useCallHoursAnalytics
// ---------------------------------------------------------------------------

export function useCallHoursAnalytics(enabled = true) {
  return useQuery(callHoursAnalyticsOptions(enabled))
}

// ---------------------------------------------------------------------------
// userStatsAnalyticsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch user performance stats.
 * Pass enabled=false to defer loading.
 */
const userStatsAnalyticsOptions = (enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.userStats(),
    queryFn: async (): Promise<UserStatEntry[]> => {
      const res = await getUserStats()
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

// ---------------------------------------------------------------------------
// useUserStatsAnalytics
// ---------------------------------------------------------------------------

export function useUserStatsAnalytics(enabled = true) {
  return useQuery(userStatsAnalyticsOptions(enabled))
}

// ---------------------------------------------------------------------------
// Global (platform) analytics — super-admin only
// ---------------------------------------------------------------------------
//
// Hits the un-prefixed /analytics endpoints, which aggregate across every hub.
// Distinct query keys from the hub-scoped versions so cache writes don't
// cross-contaminate.

const globalCallAnalyticsOptions = (days: 7 | 30 = 7, enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.globalCallVolume(days),
    queryFn: async (): Promise<CallVolumeDay[]> => {
      const res = await getGlobalCallAnalytics(days)
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

export function useGlobalCallAnalytics(days: 7 | 30 = 7, enabled = true) {
  return useQuery(globalCallAnalyticsOptions(days, enabled))
}

const globalCallHoursAnalyticsOptions = (enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.globalCallHours(),
    queryFn: async (): Promise<CallHourBucket[]> => {
      const res = await getGlobalCallHoursAnalytics()
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

export function useGlobalCallHoursAnalytics(enabled = true) {
  return useQuery(globalCallHoursAnalyticsOptions(enabled))
}

const globalUserStatsAnalyticsOptions = (enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.globalUserStats(),
    queryFn: async (): Promise<UserStatEntry[]> => {
      const res = await getGlobalUserStats()
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

export function useGlobalUserStatsAnalytics(enabled = true) {
  return useQuery(globalUserStatsAnalyticsOptions(enabled))
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { CallHourBucket, CallVolumeDay, UserStatEntry }
