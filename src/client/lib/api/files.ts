import type { EncryptedMetaItem } from '@shared/types'
import {
  API_BASE,
  ApiError,
  fireApiActivity,
  fireAuthExpired,
  getAuthHeaders,
  request,
} from './client'

// --- File Uploads ---

export async function initUpload(data: import('@shared/types').UploadInit) {
  return request<{ uploadId: string; totalChunks: number }>('/uploads/init', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function uploadChunk(uploadId: string, chunkIndex: number, data: ArrayBuffer) {
  const headers = {
    ...getAuthHeaders(),
    'Content-Type': 'application/octet-stream',
  }
  const res = await fetch(`${API_BASE}/uploads/${uploadId}/chunks/${chunkIndex}`, {
    method: 'PUT',
    headers,
    body: data,
  })
  if (!res.ok) {
    if (res.status === 401) fireAuthExpired()
    throw new ApiError(res.status, await res.text())
  }
  fireApiActivity()
  return res.json() as Promise<{ chunkIndex: number; completedChunks: number; totalChunks: number }>
}

export async function completeUpload(uploadId: string) {
  return request<{ fileId: string; status: string }>(`/uploads/${uploadId}/complete`, {
    method: 'POST',
  })
}

export async function getUploadStatus(uploadId: string) {
  return request<{
    uploadId: string
    status: string
    completedChunks: number
    totalChunks: number
  }>(`/uploads/${uploadId}/status`)
}

export async function downloadFile(fileId: string): Promise<ArrayBuffer> {
  const headers = getAuthHeaders()
  const res = await fetch(`${API_BASE}/files/${fileId}/content`, { headers })
  if (!res.ok) {
    if (res.status === 401) fireAuthExpired()
    throw new ApiError(res.status, await res.text())
  }
  fireApiActivity()
  return res.arrayBuffer()
}

export async function getFileEnvelopes(fileId: string) {
  return request<{ envelopes: import('@shared/types').FileKeyEnvelope[] }>(
    `/files/${fileId}/envelopes`
  )
}

export async function getFileMetadata(fileId: string) {
  return request<{
    metadata: EncryptedMetaItem[]
  }>(`/files/${fileId}/metadata`)
}

export async function shareFile(
  fileId: string,
  data: {
    envelope: import('@shared/types').FileKeyEnvelope
    encryptedMetadata: EncryptedMetaItem
  }
) {
  return request<{ ok: true }>(`/files/${fileId}/share`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// --- File Upload Context Binding ---

export async function bindUploadContext(fileId: string, contextType: string, contextId: string) {
  return request<{ ok: true }>(`/files/${fileId}/context`, {
    method: 'PATCH',
    body: JSON.stringify({ contextType, contextId }),
  })
}
