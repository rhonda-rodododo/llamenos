import type { Ciphertext } from '@shared/crypto-types'
import type { CreateReportTypeInput, ReportType, UpdateReportTypeInput } from '@shared/types'
import { hp, request } from './client'
import type { Conversation, ConversationMessage, MessageKeyEnvelope } from './conversations'

export type { ReportType }

// --- Types ---

export interface Report extends Conversation {
  metadata: {
    type: 'report'
    reportTitle?: string
    reportCategory?: string
    customFieldValues?: string
    linkedCallId?: string
    reportId?: string
  }
}

// --- Reports ---

export async function listReports(params?: {
  status?: string
  category?: string
  page?: number
  limit?: number
}) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.category) qs.set('category', params.category)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ conversations: Report[]; total: number }>(hp(`/reports?${qs}`))
}

export async function createReport(data: {
  title: string
  category?: string
  reportTypeId?: string
  encryptedContent: Ciphertext
  readerEnvelopes: MessageKeyEnvelope[]
}) {
  return request<Report>(hp('/reports'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getReport(id: string) {
  return request<Report>(hp(`/reports/${id}`))
}

export async function getReportMessages(id: string, params?: { page?: number; limit?: number }) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ messages: ConversationMessage[]; total: number }>(
    hp(`/reports/${id}/messages?${qs}`)
  )
}

export async function sendReportMessage(
  id: string,
  data: {
    encryptedContent: Ciphertext
    readerEnvelopes: MessageKeyEnvelope[]
    attachmentIds?: string[]
  }
) {
  return request<ConversationMessage>(hp(`/reports/${id}/messages`), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function assignReport(id: string, assignedTo: string) {
  return request<Report>(hp(`/reports/${id}/assign`), {
    method: 'POST',
    body: JSON.stringify({ assignedTo }),
  })
}

export async function updateReport(id: string, data: { status?: string }) {
  return request<Report>(hp(`/reports/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getReportCategories() {
  return request<{ categories: string[] }>(hp('/reports/categories'))
}

export async function getReportFiles(id: string) {
  return request<{ files: import('@shared/types').FileRecord[] }>(hp(`/reports/${id}/files`))
}

// --- Report Types ---

export async function listReportTypes() {
  return request<{ reportTypes: ReportType[] }>(hp('/report-types'))
}

export async function createReportType(data: CreateReportTypeInput) {
  return request<{ reportType: ReportType }>(hp('/report-types'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateReportType(id: string, data: UpdateReportTypeInput) {
  return request<{ reportType: ReportType }>(hp(`/report-types/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function archiveReportType(id: string) {
  return request<{ reportType: ReportType }>(hp(`/report-types/${id}`), {
    method: 'DELETE',
  })
}

export async function unarchiveReportType(id: string) {
  return request<{ reportType: ReportType }>(hp(`/report-types/${id}/unarchive`), {
    method: 'POST',
  })
}

export async function setDefaultReportType(id: string) {
  return request<{ reportType: ReportType }>(hp(`/report-types/${id}/default`), {
    method: 'POST',
  })
}
