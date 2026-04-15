/**
 * React Query hooks for reports resource management.
 *
 * Reports use per-message envelope encryption (XChaCha20-Poly1305 + ECIES).
 * Message decryption is done client-side via decryptMessage() from crypto.ts.
 */

import {
  type ConversationMessage,
  type Report,
  type ReportType,
  assignReport,
  getReportCategories,
  getReportMessages,
  listReportTypes,
  listReports,
  sendReportMessage,
  updateReport,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptMessage } from '@/lib/crypto-worker-helpers'
import { decryptHubField } from '@/lib/hub-field-crypto'
import * as keyManager from '@/lib/key-manager'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReportFilters = {
  status?: string
  category?: string
}

interface DecryptedReportMessages {
  messages: ConversationMessage[]
  decryptedContent: Map<string, string>
}

type ReportMessagesAuth = {
  hasNsec: boolean
  publicKey: string | null
}

// ---------------------------------------------------------------------------
// reportsListOptions
// ---------------------------------------------------------------------------

/**
 * Fetch the list of reports with optional filters.
 * Polls every 30s as a safety net alongside Nostr real-time events.
 */
const reportsListOptions = (filters?: ReportFilters) => {
  const normalizedFilters: { status?: string; category?: string } = {}
  if (filters?.status && filters.status !== 'all') normalizedFilters.status = filters.status
  if (filters?.category && filters.category !== 'all') normalizedFilters.category = filters.category

  return queryOptions({
    queryKey: queryKeys.reports.list(normalizedFilters),
    queryFn: async (): Promise<Report[]> => {
      const { conversations } = await listReports(normalizedFilters)
      return conversations
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

// ---------------------------------------------------------------------------
// useReports
// ---------------------------------------------------------------------------

export function useReports(filters?: ReportFilters) {
  return useQuery(reportsListOptions(filters))
}

// ---------------------------------------------------------------------------
// reportMessagesOptions
// ---------------------------------------------------------------------------

/**
 * queryOptions factory for report messages.
 * auth values must be passed explicitly since queryOptions cannot call React hooks.
 */
const reportMessagesOptions = (reportId: string | null, auth: ReportMessagesAuth) =>
  queryOptions({
    queryKey: reportId ? queryKeys.reports.messages(reportId) : ['reports', 'messages', null],
    enabled: !!reportId,
    queryFn: async (): Promise<DecryptedReportMessages> => {
      if (!reportId) return { messages: [], decryptedContent: new Map() }

      const { hasNsec, publicKey } = auth
      const { messages } = await getReportMessages(reportId, { limit: 100 })
      const decryptedContent = new Map<string, string>()

      const unlocked = hasNsec && publicKey ? await keyManager.isUnlocked() : false
      if (unlocked && publicKey) {
        for (const msg of messages) {
          if (msg.encryptedContent && msg.readerEnvelopes?.length) {
            const plaintext = await decryptMessage(
              msg.encryptedContent,
              msg.readerEnvelopes,
              publicKey
            )
            if (plaintext !== null) {
              decryptedContent.set(msg.id, plaintext)
            }
          }
        }
      }

      return { messages, decryptedContent }
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
  })

// ---------------------------------------------------------------------------
// useReportMessages
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt messages for a selected report.
 * Only enabled when a reportId is provided.
 * Returns messages + a Map of decrypted content keyed by message id.
 */
export function useReportMessages(reportId: string | null) {
  const { hasNsec, publicKey } = useAuth()
  return useQuery(reportMessagesOptions(reportId, { hasNsec, publicKey }))
}

// ---------------------------------------------------------------------------
// useSendReportMessage
// ---------------------------------------------------------------------------

/**
 * Mutation to send an encrypted message to a report thread.
 * Invalidates the messages cache for the specific report on success.
 */
export function useSendReportMessage(reportId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof sendReportMessage>[1]) =>
      sendReportMessage(reportId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.messages(reportId) })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateReport
// ---------------------------------------------------------------------------

/**
 * Mutation to update a report (e.g. close it).
 * When a report is closed, removes it from all cached report lists immediately
 * (matching the original useState behavior of filtering out closed reports).
 * Then invalidates the full reports cache to sync with the server.
 */
export function useUpdateReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      reportId,
      data,
    }: { reportId: string; data: Parameters<typeof updateReport>[1] }) =>
      updateReport(reportId, data),
    onSuccess: (_result, variables) => {
      // If the report was closed, immediately remove it from all cached lists and
      // skip immediate cache invalidation. This matches the original useState behavior
      // (setReports(prev => prev.filter(r => r.id !== reportId))) where closing a report
      // removes it from the current view. Calling invalidateQueries immediately after
      // setQueriesData would trigger a background refetch that re-adds the closed report
      // (server returns closed reports in the 'all' filter), undoing the optimistic removal.
      // The next navigation or filter change will fetch fresh data from the server.
      if (variables.data.status === 'closed') {
        queryClient.setQueriesData<Report[]>(
          { queryKey: queryKeys.reports.all, exact: false },
          (oldData) => oldData?.filter((r) => r.id !== variables.reportId)
        )
        return
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useAssignReport
// ---------------------------------------------------------------------------

/**
 * Mutation to assign a report to a user.
 * Invalidates the full reports cache on success.
 */
export function useAssignReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reportId, pubkey }: { reportId: string; pubkey: string }) =>
      assignReport(reportId, pubkey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    },
  })
}

// ---------------------------------------------------------------------------
// reportCategoriesOptions
// ---------------------------------------------------------------------------

/**
 * Fetch available report category strings.
 * Used by ReportForm to populate the category select.
 */
const reportCategoriesOptions = () =>
  queryOptions({
    queryKey: ['reports', 'categories'] as const,
    queryFn: async (): Promise<string[]> => {
      const { categories } = await getReportCategories()
      return categories
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

// ---------------------------------------------------------------------------
// useReportCategories
// ---------------------------------------------------------------------------

export function useReportCategories() {
  return useQuery(reportCategoriesOptions())
}

// ---------------------------------------------------------------------------
// reportTypesOptions
// ---------------------------------------------------------------------------

/**
 * Fetch report type definitions (admin-configured).
 * Used by ReportForm to populate the report type select.
 */
const reportTypesOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.settings.reportTypes(),
    queryFn: async (): Promise<ReportType[]> => {
      const { reportTypes } = await listReportTypes()
      return Promise.all(
        reportTypes.map(async (rt) => ({
          ...rt,
          name: await decryptHubField(rt.encryptedName, hubId, rt.id, 'encrypted_name'),
          description: await decryptHubField(
            rt.encryptedDescription,
            hubId,
            rt.id,
            'encrypted_description'
          ),
        }))
      )
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

// ---------------------------------------------------------------------------
// useReportTypes
// ---------------------------------------------------------------------------

export function useReportTypes(hubId = 'global') {
  return useQuery(reportTypesOptions(hubId))
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { ConversationMessage, Report, ReportType }
