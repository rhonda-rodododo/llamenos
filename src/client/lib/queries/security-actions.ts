import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/security-actions'

export function useLockdown() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tier, pinProof }: { tier: 'A' | 'B' | 'C'; pinProof: string }) =>
      api.triggerLockdown(tier, pinProof),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security'] })
    },
  })
}

export function useChangePin() {
  return useMutation({
    mutationFn: ({
      currentPinProof,
      newKekProof,
      newEncryptedSecretKey,
    }: {
      currentPinProof: string
      newKekProof: string
      newEncryptedSecretKey: string
    }) => api.changePin(currentPinProof, newKekProof, newEncryptedSecretKey),
  })
}

export function useRotateRecovery() {
  return useMutation({
    mutationFn: ({
      currentPinProof,
      newEncryptedSecretKey,
    }: {
      currentPinProof: string
      newEncryptedSecretKey: string
    }) => api.rotateRecovery(currentPinProof, newEncryptedSecretKey),
  })
}
