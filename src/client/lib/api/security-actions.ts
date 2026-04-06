import { ApiError, request } from './client'

export interface LockdownResult {
  tier: 'A' | 'B' | 'C'
  revokedSessions: number
  deletedPasskeys: number
  accountDeactivated: boolean
  notificationDelivered: boolean
}

/**
 * Ensure the server has a KEK proof hash stored for this user.
 * Call before any security-action endpoint that expects one. Safe to call
 * repeatedly — the server accepts the first hash and returns 409 only if
 * the stored hash differs from what's presented.
 */
async function seedKekProof(pinProof: string): Promise<void> {
  const { hasProof } = await request<{ hasProof: boolean }>('/auth/kek-proof/status')
  if (!hasProof) {
    await request('/auth/kek-proof', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proof: pinProof }),
    })
  }
}

/**
 * Retry a request once if the server responds 409 (no KEK proof hash yet) by
 * seeding the hash first. This handles the post-migration window without
 * requiring every caller to manage it.
 */
async function withKekProofRetry<T>(pinProof: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      await seedKekProof(pinProof)
      return await fn()
    }
    throw err
  }
}

export async function triggerLockdown(
  tier: 'A' | 'B' | 'C',
  pinProof: string
): Promise<LockdownResult> {
  return withKekProofRetry(pinProof, () =>
    request<LockdownResult>('/auth/sessions/lockdown', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier, confirmation: 'LOCKDOWN', pinProof }),
    })
  )
}

export async function changePin(
  currentPinProof: string,
  newKekProof: string,
  newEncryptedSecretKey: string
): Promise<{ ok: boolean }> {
  return withKekProofRetry(currentPinProof, () =>
    request<{ ok: boolean }>('/auth/pin/change', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPinProof, newKekProof, newEncryptedSecretKey }),
    })
  )
}

export async function rotateRecovery(
  currentPinProof: string,
  newEncryptedSecretKey: string
): Promise<{ ok: boolean }> {
  return withKekProofRetry(currentPinProof, () =>
    request<{ ok: boolean }>('/auth/recovery/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPinProof, newEncryptedSecretKey }),
    })
  )
}
