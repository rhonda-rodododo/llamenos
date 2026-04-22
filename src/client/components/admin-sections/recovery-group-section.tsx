import { bytesToHex } from '@noble/hashes/utils.js'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { authFacadeClient } from '@/lib/auth-facade-client'
import { useConfig } from '@/lib/config'
import {
  commitShare,
  generateRecoveryGroupKeyPair,
  splitRecoveryGroupSecret,
} from '@/lib/recovery-group-share'

export function RecoveryGroupSection() {
  const { t } = useTranslation()
  const { currentHubId } = useConfig()
  const [threshold, setThreshold] = useState(2)
  const [total, setTotal] = useState(3)
  const [enrolling, setEnrolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleEnroll() {
    if (!currentHubId) return
    setEnrolling(true)
    setError(null)
    setSuccess(false)
    try {
      const { privateKey, publicKey } = generateRecoveryGroupKeyPair()
      const shares = await splitRecoveryGroupSecret(privateKey, total, threshold)
      privateKey.fill(0)
      const commitments = await Promise.all(shares.map((s) => commitShare(s)))
      // In full implementation, shares would be HPKE-wrapped per admin pubkey.
      // For now, store hex-encoded shares as placeholder envelopes.
      const shareEnvelopes = shares.map((s, i) => ({
        adminPubkey: `admin-${i + 1}`,
        envelope: bytesToHex(s),
      }))
      for (const s of shares) s.fill(0)

      await authFacadeClient.recoveryGroupEnroll({
        hubId: currentHubId,
        threshold,
        totalShares: total,
        groupPublicKey: bytesToHex(publicKey),
        shareEnvelopes,
        shareCommitments: commitments,
      })
      setSuccess(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="recovery-group-section">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.recoveryGroup.title')}</CardTitle>
          <CardDescription>{t('admin.recoveryGroup.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium" htmlFor="rg-threshold">
                {t('admin.recoveryGroup.threshold')}
              </label>
              <Input
                id="rg-threshold"
                data-testid="rg-threshold"
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                min={2}
                max={5}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="rg-total">
                {t('admin.recoveryGroup.totalShares')}
              </label>
              <Input
                id="rg-total"
                data-testid="rg-total"
                type="number"
                value={total}
                onChange={(e) => setTotal(Number(e.target.value))}
                min={3}
                max={5}
              />
            </div>
          </div>
          <Button
            data-testid="rg-enroll-submit"
            disabled={enrolling || threshold > total || threshold < 2 || total < 3}
            onClick={handleEnroll}
          >
            {enrolling ? t('admin.recoveryGroup.enrolling') : t('admin.recoveryGroup.enroll')}
          </Button>
          {error && (
            <div data-testid="rg-error" className="text-sm text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div data-testid="rg-success" className="text-sm text-green-600">
              {t('admin.recoveryGroup.enrollSuccess')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
