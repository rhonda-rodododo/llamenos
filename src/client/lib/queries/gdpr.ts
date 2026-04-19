import {
  type ErasureRequest,
  cancelAccountErasure,
  downloadMyData,
  getMyErasureRequest,
  requestAccountErasure,
} from '@/lib/api'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// myErasureRequestOptions / useMyErasureRequest
// ---------------------------------------------------------------------------

const myErasureRequestOptions = () =>
  queryOptions({
    queryKey: queryKeys.gdpr.myErasureRequest(),
    queryFn: (): Promise<ErasureRequest | null> => getMyErasureRequest(),
    staleTime: 60_000,
  })

export function useMyErasureRequest() {
  return useQuery(myErasureRequestOptions())
}

// ---------------------------------------------------------------------------
// useRequestAccountErasure
// ---------------------------------------------------------------------------

export function useRequestAccountErasure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (): Promise<ErasureRequest> => requestAccountErasure(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gdpr.myErasureRequest() })
    },
  })
}

// ---------------------------------------------------------------------------
// useCancelAccountErasure
// ---------------------------------------------------------------------------

export function useCancelAccountErasure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (): Promise<{ ok: true }> => cancelAccountErasure(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gdpr.myErasureRequest() })
    },
  })
}

// ---------------------------------------------------------------------------
// useExportMyData
// Triggers the export and initiates a browser download of the returned blob.
// ---------------------------------------------------------------------------

export function useExportMyData() {
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const blob = await downloadMyData()
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `llamenos-export-${date}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    },
  })
}
