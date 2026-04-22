import { LABEL_AUTH_EVENT } from '@shared/crypto-labels'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import * as api from '../api/auth-events'
import { decryptEnvelopeJson } from '../decrypt-fields'
import { queryKeys } from './keys'

interface AuthEventPayloadDecrypted {
  sessionId?: string
  ipHash?: string
  city?: string
  country?: string
  userAgent?: string
  credentialId?: string
  credentialLabel?: string
  lockdownTier?: 'A' | 'B' | 'C'
  meta?: Record<string, unknown>
}

interface AuthEventViewModel {
  id: string
  eventType: string
  createdAt: string
  reportedSuspiciousAt: string | null
  payload: AuthEventPayloadDecrypted | null
}

export function useAuthEvents(limit = 50) {
  const { publicKey } = useAuth()
  return useQuery({
    queryKey: queryKeys.security.history({ limit }),
    queryFn: async (): Promise<AuthEventViewModel[]> => {
      const { events } = await api.listAuthEvents({ limit })
      return Promise.all(
        events.map(async (e) => {
          const envelope = e.payloadEnvelope.find((env) => env.pubkey === publicKey)
          const payload = envelope
            ? await decryptEnvelopeJson<AuthEventPayloadDecrypted>(
                // Slice 4: payloadEnvelope will carry HpkeEnvelope per recipient
                envelope as unknown as import('@shared/hpke-envelope').HpkeEnvelope,
                LABEL_AUTH_EVENT,
                e.id,
                'payload'
              )
            : null
          return {
            id: e.id,
            eventType: e.eventType,
            createdAt: e.createdAt,
            reportedSuspiciousAt: e.reportedSuspiciousAt,
            payload,
          }
        })
      )
    },
    enabled: !!publicKey,
  })
}

export function useReportSuspicious() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.reportSuspiciousEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.all })
    },
  })
}

export function useExportAuthEvents() {
  return useMutation({
    mutationFn: () => api.exportAuthEvents(),
  })
}
