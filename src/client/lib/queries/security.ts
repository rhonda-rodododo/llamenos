import { useAuth } from '@/lib/auth'
import { LABEL_SESSION_META } from '@shared/crypto-labels'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/security'
import { decryptEnvelopeJson } from '../decrypt-fields'
import { queryKeys } from './keys'

export interface SessionMetaDecrypted {
  userAgent: string
  city: string
  region: string
  country: string
}

export interface SessionViewModel {
  id: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  isCurrent: boolean
  credentialId: string | null
  meta: SessionMetaDecrypted | null
}

export function useSessions() {
  const { publicKey } = useAuth()
  return useQuery({
    queryKey: queryKeys.security.sessions(),
    queryFn: async (): Promise<SessionViewModel[]> => {
      const { sessions } = await api.listSessions()
      return Promise.all(
        sessions.map(async (s) => {
          const envelope = s.metaEnvelope.find((e) => e.pubkey === publicKey)
          const meta = envelope
            ? await decryptEnvelopeJson<SessionMetaDecrypted>(
                s.encryptedMeta,
                envelope,
                LABEL_SESSION_META
              )
            : null
          return {
            id: s.id,
            createdAt: s.createdAt,
            lastSeenAt: s.lastSeenAt,
            expiresAt: s.expiresAt,
            isCurrent: s.isCurrent,
            credentialId: s.credentialId,
            meta,
          }
        })
      )
    },
    enabled: !!publicKey,
  })
}

export function useRevokeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.sessions() })
    },
  })
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.sessions() })
    },
  })
}

export interface PasskeyViewModel {
  id: string
  label: string
  transports: string[]
  backedUp: boolean
  createdAt: string
  lastUsedAt: string
}

export function usePasskeys() {
  return useQuery({
    queryKey: queryKeys.security.passkeys(),
    queryFn: async (): Promise<{ credentials: PasskeyViewModel[]; warning?: string }> => {
      const { credentials, warning } = await api.listPasskeys()
      return {
        credentials: credentials.map((c) => ({
          id: c.id,
          label: c.label,
          transports: c.transports,
          backedUp: c.backedUp,
          createdAt: c.createdAt,
          lastUsedAt: c.lastUsedAt,
        })),
        warning,
      }
    },
  })
}

export function useRenamePasskey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: api.RenamePasskeyInput }) =>
      api.renamePasskey(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.passkeys() })
    },
  })
}

export function useDeletePasskey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deletePasskey(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.security.passkeys() })
    },
  })
}
